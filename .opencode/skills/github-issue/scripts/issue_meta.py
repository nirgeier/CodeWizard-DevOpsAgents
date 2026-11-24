#!/usr/bin/env python3
"""Render and validate the CodeWizard issue metadata block.

Four subcommands, all stdlib-only so they run anywhere:

  next-id  read issue titles on stdin, print the next free taskId
  render   build a full issue body from the four fields
  check    validate an existing body (stdin or --file) - exit 1 on any problem
  sections list the section vocabulary, optionally resolved against live epics

The model gets the narrative right and this gets the bookkeeping right. Task-id
allocation and field validation are mechanical and span ~500 issues, which is
exactly the kind of thing that is easy to get subtly wrong by hand.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SECTIONS_JSON = HERE.parent / "references" / "sections.json"

# A GitHub login: alphanumeric with single inner hyphens.
LOGIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TASKID_RE = re.compile(r"^T-\d{3,}$")
SLUG_RE = re.compile(r"^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")
# Any T-id anywhere in a title, bracketed or not, so a hand-written title that
# forgot the brackets still reserves its number instead of colliding.
ANY_TASKID_RE = re.compile(r"\bT-(\d+)\b")

FIELDS = ("issuer", "date", "taskId", "section")
BLOCK_RE = re.compile(
    r"<!--\s*cw-issue-meta\s*\n(?P<body>.*?)\n-->", re.DOTALL
)


# ── section vocabulary ──────────────────────────────────────────────────────

def load_sections() -> tuple[dict, list[dict]]:
    if not SECTIONS_JSON.exists():
        sys.exit(
            f"missing {SECTIONS_JSON} - the section vocabulary is part of the "
            "skill and must travel with it"
        )
    data = json.loads(SECTIONS_JSON.read_text(encoding="utf-8"))
    sections = data["sections"]
    by_slug = {f"{s['id']}-{s['slug']}": s for s in sections}
    return data, sections


def section_for(slug: str, sections: list[dict]) -> dict:
    by_slug = {f"{s['id']}-{s['slug']}": s for s in sections}
    if slug not in by_slug:
        valid = ", ".join(sorted(by_slug))
        sys.exit(f"unknown section {slug!r}\nvalid values: {valid}")
    return by_slug[slug]


# ── next-id ─────────────────────────────────────────────────────────────────

def cmd_next_id(args: argparse.Namespace) -> int:
    """Max taskId seen + 1, so two agents racing do not both pick T-001."""
    seen: list[int] = []
    malformed: list[str] = []

    raw = pathlib.Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    for line in raw.splitlines():
        # Tolerate "number<TAB>title", "number title", or a bare title.
        title = line.split("\t", 1)[-1]
        title = re.sub(r"^\s*\d+[:\s]\s*", "", title)
        for m in ANY_TASKID_RE.finditer(title):
            n = int(m.group(1))
            seen.append(n)
            if n < 1:
                malformed.append(title.strip())
        for m in re.finditer(r"T-\d{1,2}\b", title):
            malformed.append(title.strip())

    if malformed:
        print(
            "warning: titles carry a taskId too short to be valid "
            f"(want T-NNN): {sorted(set(malformed))}",
            file=sys.stderr,
        )

    nxt = (max(seen) + 1) if seen else 1
    print(f"T-{nxt:03d}")
    print(
        f"scanned {len(raw.splitlines())} title(s), {len(set(seen))} taskId(s), "
        f"highest T-{max(seen):03d}" if seen else "scanned 0 taskIds, starting at T-001",
        file=sys.stderr,
    )
    return 0


# ── render ──────────────────────────────────────────────────────────────────

def build_block(meta: dict[str, str]) -> str:
    lines = "\n".join(f"{k}: {meta[k]}" for k in FIELDS)
    return f"<!-- cw-issue-meta\n{lines}\n-->"


def build_table(meta: dict[str, str], section: dict, subsection: str | None) -> str:
    slug = f"{section['id']}-{section['slug']}"
    label = section["epicTitle"]
    if subsection:
        label = f"{label} §{subsection}"
    return "\n".join(
        [
            "| Field | Value |",
            "| --- | --- |",
            f"| **Issuer** | [@{meta['issuer']}](https://github.com/{meta['issuer']}) |",
            f"| **Date** | {meta['date']} |",
            f"| **Task ID** | `{meta['taskId']}` |",
            f"| **Section (in the app)** | `{slug}` — {label} |",
        ]
    )


def cmd_render(args: argparse.Namespace) -> int:
    data, sections = load_sections()
    section = section_for(args.section, sections)
    slug = f"{section['id']}-{section['slug']}"

    meta = {
        "issuer": args.issuer,
        "date": args.date or dt.date.today().isoformat(),
        "taskId": args.task_id,
        "section": slug,
    }

    problems = validate_meta(meta, sections)
    if problems:
        for p in problems:
            print(f"error: {p}", file=sys.stderr)
        return 1

    repo = data["repo"]
    repo_url = f"https://github.com/{repo['owner']}/{repo['name']}"
    labels = [section["area"], section["phase"]] + list(args.label or [])

    out: list[str] = [build_block(meta), "", build_table(meta, section, args.subsection), ""]

    # Source line, matching the convention the existing 500 issues already use.
    if args.source_file:
        src = f"[`{args.source_file}`"
        if args.subsection:
            src += f" §{args.subsection}"
        src += f"]({repo_url}/blob/main/{args.source_file}"
        if args.source_line:
            src += f"#L{args.source_line}"
        src += ")"
        if args.source_title:
            src += f" — {args.source_title}"
        out += [f"**Source:** {src}", ""]

    out += [
        f"Part of epic: [{section['epicTitle']}]({repo_url}/issues/"
        f"{section['epicIssue']})",
        "",
        "### Task",
        "",
        args.task.strip() or "(no description supplied)",
        "",
        "---",
        "",
        "<sub>Created via the `github-issue` skill. One checkbox = one issue, so "
        "each can be reviewed, assigned and closed on its own.</sub>",
        "",
        f"<sub>Labels: {', '.join(f'`{l}`' for l in labels)}</sub>",
        "",
    ]

    body = "\n".join(out)
    if args.check_too:
        problems = check_body(body, sections)
        if problems:
            for p in problems:
                print(f"error: {p}", file=sys.stderr)
            return 1
        print("rendered body passes check", file=sys.stderr)
    print(body)
    return 0


# ── validation ──────────────────────────────────────────────────────────────

def validate_meta(meta: dict[str, str], sections: list[dict]) -> list[str]:
    problems: list[str] = []
    for key in FIELDS:
        if not meta.get(key):
            problems.append(f"{key} is empty")

    if meta.get("issuer") and not LOGIN_RE.match(meta["issuer"]):
        problems.append(
            f"issuer {meta['issuer']!r} is not a GitHub login "
            "(alphanumeric, single inner hyphens, max 39)"
        )

    if meta.get("date"):
        if not DATE_RE.match(meta["date"]):
            problems.append(f"date {meta['date']!r} must be YYYY-MM-DD")
        else:
            try:
                dt.date.fromisoformat(meta["date"])
            except ValueError:
                problems.append(f"date {meta['date']!r} is not a real calendar date")

    if meta.get("taskId") and not TASKID_RE.match(meta["taskId"]):
        problems.append(
            f"taskId {meta['taskId']!r} must match T-NNN (zero padded to 3+ digits)"
        )

    if meta.get("section"):
        known = {f"{s['id']}-{s['slug']}" for s in sections}
        if not SLUG_RE.match(meta["section"]):
            problems.append(
                f"section {meta['section']!r} must be NN-slug, e.g. 04-webapp-product"
            )
        elif meta["section"] not in known:
            problems.append(
                f"section {meta['section']!r} is well formed but unknown; "
                f"valid: {', '.join(sorted(known))}"
            )
    return problems


def parse_block(body: str) -> dict[str, str] | None:
    m = BLOCK_RE.search(body)
    if not m:
        return None
    meta: dict[str, str] = {}
    for line in m.group("body").splitlines():
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip()
    return meta


def check_body(body: str, sections: list[dict]) -> list[str]:
    problems: list[str] = []

    meta = parse_block(body)
    if meta is None:
        return ["no <!-- cw-issue-meta ... --> block found at the top of the body"]
    if list(meta.keys()) != list(FIELDS):
        problems.append(
            f"metadata block keys are {list(meta.keys())}, want exactly "
            f"{list(FIELDS)} in that order"
        )

    problems += validate_meta(meta, sections)

    # The human table is a second rendering of the same values. If they drift,
    # whichever one a reader trusts is the one that is wrong, so check them
    # against each other rather than just checking each independently.
    for key, needle in (
        ("issuer", f"@{meta.get('issuer', '')}]"),
        ("date", f"| {meta.get('date', '')} |"),
        ("taskId", f"`{meta.get('taskId', '')}`"),
        ("section", f"`{meta.get('section', '')}`"),
    ):
        if needle and needle not in body:
            problems.append(
                f"{key}: the table row is missing or disagrees with the metadata "
                f"block (expected {needle!r} in the body)"
            )

    for label in ("**Issuer**", "**Date**", "**Task ID**", "**Section (in the app)**"):
        if label not in body:
            problems.append(f"the metadata table has no {label} row")

    slug = meta.get("section", "")
    if slug in {f"{s['id']}-{s['slug']}" for s in sections}:
        section = section_for(slug, sections)
        if f"/issues/{section['epicIssue']}" not in body:
            problems.append(
                f"no 'Part of epic:' link to #{section['epicIssue']} "
                f"({section['epicTitle']}) - every issue in this repo hangs off "
                "its section epic"
            )

    return problems


def cmd_check(args: argparse.Namespace) -> int:
    _, sections = load_sections()
    body = pathlib.Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    if not body.strip():
        print("error: empty body", file=sys.stderr)
        return 1
    problems = check_body(body, sections)
    if problems:
        for p in problems:
            print(f"FAIL {p}", file=sys.stderr)
        print(f"{len(problems)} problem(s)", file=sys.stderr)
        return 1
    meta = parse_block(body) or {}
    print(
        "OK  " + "  ".join(f"{k}={meta[k]}" for k in FIELDS if k in meta),
        file=sys.stderr,
    )
    return 0


# ── sections ────────────────────────────────────────────────────────────────

def cmd_sections(args: argparse.Namespace) -> int:
    data, sections = load_sections()
    repo = data["repo"]
    epics: dict[str, dict] = {}
    if args.live_epics_json:
        try:
            payload = json.loads(pathlib.Path(args.live_epics_json).read_text(encoding="utf-8"))
            issues = payload.get("issues", payload) if isinstance(payload, dict) else payload
            epics = {i.get("title", "").strip(): i for i in issues or []}
        except (OSError, ValueError) as exc:
            print(f"warning: could not read live epics ({exc})", file=sys.stderr)

    drift = 0
    for s in sections:
        slug = f"{s['id']}-{s['slug']}"
        note = ""
        live = epics.get(s["epicTitle"])
        if epics:
            if live is None:
                note = "  <-- no live epic with this title"
                drift += 1
            elif live.get("number") != s["epicIssue"]:
                note = f"  <-- live epic is #{live['number']}"
                drift += 1
        labels = f"{s['area']}, {s['phase']}"
        print(
            f"{slug:32} epic #{s['epicIssue']:<4} {labels:34} {s['epicTitle']}{note}"
        )

    print(f"\nrepo: {repo['owner']}/{repo['name']}", file=sys.stderr)
    if args.live_epics_json:
        if drift:
            print(f"{drift} section(s) drifted from the live epics", file=sys.stderr)
            return 1
        print(f"all {len(sections)} sections agree with the live epics", file=sys.stderr)
    return 0


# ── cli ─────────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    n = sub.add_parser("next-id", help="print the next free taskId")
    n.add_argument("--file", help="file of issue titles (default stdin)")
    n.set_defaults(func=cmd_next_id)

    r = sub.add_parser("render", help="render a full issue body")
    r.add_argument("--issuer", required=True, help="GitHub login of the person raising this")
    r.add_argument("--task-id", required=True, help="T-NNN, from next-id")
    r.add_argument("--section", required=True, help="NN-slug, e.g. 04-webapp-product")
    r.add_argument("--task", default="", help="the task description (### Task body)")
    r.add_argument("--date", help="YYYY-MM-DD (default today)")
    r.add_argument("--subsection", help="task/ subsection, e.g. 4.2")
    r.add_argument("--source-file", help="e.g. task/04-webapp-product.md")
    r.add_argument("--source-line", help="line number for the permalink anchor")
    r.add_argument("--source-title", help="subsection title for the Source line")
    r.add_argument("--label", action="append", help="extra label (repeatable)")
    r.add_argument("--check-too", action="store_true", help="validate the rendered body")
    r.set_defaults(func=cmd_render)

    c = sub.add_parser("check", help="validate an issue body")
    c.add_argument("--file", help="body file (default stdin)")
    c.set_defaults(func=cmd_check)

    s = sub.add_parser("sections", help="show the section vocabulary")
    s.add_argument(
        "--live-epics-json",
        help="MCP list_issues response for the 'epic' label, to detect renumbering",
    )
    s.set_defaults(func=cmd_sections)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
