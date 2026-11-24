# GitHub MCP: the exact calls this skill makes

Verified against `https://api.githubcopilot.com/mcp/` on 2026-10-05 with the
`context,issues,labels` toolsets. 16 tools register, which is the whole point of
pinning the toolsets — the full server advertises 100+ and eats the context.

Tool names here are the bare MCP names. In OpenCode they arrive namespaced
(`github_issue_write`); in Claude Code likewise (`mcp__github__issue_write`). If a
name does not resolve, check what the server actually registered before assuming
the argument shape changed — `opencode mcp list` shows connection status, and
`opencode mcp debug github` shows auth and HTTP diagnostics.

## Contents

- [Preflight](#preflight)
- [The four calls this skill needs](#the-four-calls-this-skill-needs)
- [Gotchas that will bite you](#gotchas-that-will-bite-you)
- [Connection](#connection)

## Preflight

`get_me` — no arguments. Confirms auth *and* gives you the default Issuer.

```json
{ "name": "get_me", "arguments": {} }
```

Returns `{"login":"nirgeier", ...}`. If this fails the PAT is wrong or expired;
nothing downstream will work, so do it before composing anything.

## The four calls this skill needs

### 1. `list_issues` — allocate the taskId and sanity-check labels

```json
{
  "name": "list_issues",
  "arguments": {
    "owner": "nirgeier",
    "repo": "CodeWizard-DevOpsAgents",
    "perPage": 100,
    "fields": ["number", "title"]
  }
}
```

- **Omit `state`.** With no filter both open and closed issues come back. That is
  what you want: a closed `T-014` still owns its number, and allocating `T-014`
  again would collide with a closed issue someone is reading for history.
- **`fields` is not optional in practice.** The untrimmed response embeds every
  issue body — 100 issues of markdown is tens of thousands of tokens for two
  fields of information.
- **Pagination is cursor-based.** The response carries
  `pageInfo: { hasNextPage, startCursor, endCursor }` and `totalCount`. Pass
  `endCursor` back as `after` and repeat while `hasNextPage` is true. There is no
  page-number argument on this tool.
- The repo has **492 issues** (snapshot 2026-10-05), so expect ~5 calls at
  `perPage: 100`. Collect `number` + `title` into a list and pipe it to
  `scripts/issue_meta.py next-id`.

### 2. `list_issues` with the `epic` label — resolve the section epic

```json
{
  "name": "list_issues",
  "arguments": {
    "owner": "nirgeier",
    "repo": "CodeWizard-DevOpsAgents",
    "perPage": 100,
    "labels": ["epic"],
    "fields": ["number", "title", "labels"]
  }
}
```

Exactly 14 results, one per `task/` document, currently numbered **#9–#22**.
Each carries the `phase:*` and `area:*` labels for its section, which is how the
skill knows which labels to apply instead of inventing new ones.

Pipe the response into `scripts/issue_meta.py sections --live-epics-json <file>`
to prove the embedded table in `references/sections.json` still matches. It exits
1 and names the drifted section if an epic was renumbered or retitled.

Watch the dash characters: sections 01–07 use `-`, 08–14 use `—` (em dash). Copy
the live title, never retype it.

### 3. `issue_write` — create

```json
{
  "name": "issue_write",
  "arguments": {
    "method": "create",
    "owner": "nirgeier",
    "repo": "CodeWizard-DevOpsAgents",
    "title": "[T-001] Companies table has no server-side pagination",
    "body": "<rendered body>",
    "labels": ["area:webapp", "phase:1-now"]
  }
}
```

`method` is `create` or `update`. For `update`, `issue_number` is required and
`title`/`body` are optional. There is no separate `create_issue` tool — older
docs and tutorials show one, and it is an alias the server still resolves, but
`issue_write` is the canonical name.

Useful extras on `create`: `assignees`, `milestone` (number),
`parent_issue_number` (attach to an issue as a sub-issue in the same call), `type`
(only when issue types are enabled — this repo has none, so omit it).

Returns the created issue including `number` and `html_url`.

### 4. `issue_read` — verify

```json
{
  "name": "issue_read",
  "arguments": {
    "owner": "nirgeier",
    "repo": "CodeWizard-DevOpsAgents",
    "issue_number": 501,
    "method": "get"
  }
}
```

`method` is one of `get`, `get_comments`, `get_sub_issues`, `get_parent`,
`get_labels`. Use `get`, take `.body`, and pipe it to
`scripts/issue_meta.py check`. A successful create call is not evidence the body
arrived intact — the read-back is.

## Gotchas that will bite you

**This repo has no native Issue Fields.** `list_issue_fields` returns `[]` —
verified 2026-10-05. GitHub Issue Fields are scoped to an *organization*, and
`nirgeier/CodeWizard-DevOpsAgents` is a personal-account repository, so there is
no org to inherit fields from and none can be created from here. The `issue_fields`
argument on `issue_write` is therefore unusable for this repo, and the four fields
live in the body metadata block instead. Do not spend calls probing it. If the repo
ever moves under an org, `list_issue_fields` starts working and the fields can be
promoted to native fields; the body block stays as the readable copy.

**`search_issues` is natural language now, not GitHub search syntax.** Its
`query` parameter takes plain words and the tool description explicitly says to
include alternative wordings as plain words rather than joining them with `OR`.
Writing `repo:x in:title T-001` is a legacy habit that no longer means what it
used to. For deterministic lookups prefer `list_issues` plus local filtering, which
is what this skill does.

**`search_issues` also does not filter by repo the way you would expect.** Pass
`owner` and `repo` to scope it, and prefer `list_issues` when you need exhaustive
coverage — search can silently cap results, and "next free id" cannot be built on
a result set that might be truncated.

**`createdAt` comes back null from `issue_read`.** The field name differs from
what you expect; do not use it to populate the Date field. The Date field is
whatever the user means by "date" — today by default, overridable with `--date`
when backfilling historical work.

**Labels do not auto-create.** Passing a label that does not exist fails the call.
`list_label` to check, or `label_write` to create:

```json
{ "name": "label_write", "arguments": { "owner": "...", "repo": "...", "name": "section:04-webapp-product", "color": "0e8a16", "description": "..." } }
```

The 33 labels this repo already has are listed by `list_label`. The skill's
`references/sections.json` maps each section to an existing `area:*` + `phase:*`
pair precisely so it does not invent label names.

## Connection

Configured in `~/.config/opencode/opencode.jsonc`:

```jsonc
"github": {
  "type": "remote",
  "url": "https://api.githubcopilot.com/mcp/",
  "enabled": true,
  "oauth": false,
  "headers": {
    "Authorization": "Bearer {file:~/.config/opencode/github-mcp-token}",
    "X-MCP-Toolsets": "context,issues,labels"
  }
}
```

- `oauth: false` is required when the token rides in `Authorization`. Without it
  OpenCode tries OAuth discovery first and may pick a different identity than the
  one the PAT belongs to.
- `{file:...}` keeps the token out of the config. The file is mode 600. `{env:...}`
  works too but needs the variable exported in every shell that launches OpenCode.
- `X-MCP-Toolsets` is server-side filtering and cuts 100+ tools to 16. Add
  `pull_requests` only when the task actually touches PRs.

Rotate the token with `gh auth refresh -s repo` and rewrite the file; nothing
else needs to change.
