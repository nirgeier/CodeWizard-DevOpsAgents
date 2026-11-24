import { NextResponse } from "next/server";
import fs from "node:fs";
import { ATS_CONFIG, COMEET_CONFIG, SCAN_CONFIG, listAgentSources } from "@/lib/agent-sources";

export const dynamic = "force-dynamic";

export async function GET() {
  const sources = listAgentSources();
  const count = (type: string) => sources.filter((s) => s.type === type).length;
  return NextResponse.json({
    sources,
    summary: {
      total: sources.length,
      boards: count("board"),
      comeet: count("comeet"),
      ats: count("ats"),
      portals: count("portal"),
      companies: count("company"),
    },
  });
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const type = input?.type;
  const slug = typeof input?.slug === "string" ? input.slug.trim().toLowerCase() : "";
  const uid = typeof input?.uid === "string" ? input.uid.trim() : "";
  const token = typeof input?.token === "string" ? input.token.trim() : "";
  const domain = typeof input?.domain === "string" ? input.domain.trim().toLowerCase() : "";
  const discoverFrom = typeof input?.discoverFrom === "string" ? input.discoverFrom.trim() : "";
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  let portalUrl: URL | null = null;
  if (type === "portal") {
    try { portalUrl = new URL(url); } catch {}
  }

  if (!name || name.length > 120 || (type !== "ats" && type !== "comeet" && type !== "portal") ||
      ((type === "ats" || type === "portal") && !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) ||
      (type === "comeet" && (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(uid) || !/^[a-zA-Z0-9]{16,}$/.test(token))) ||
      (type === "portal" && (!portalUrl || portalUrl.protocol !== "https:" || portalUrl.username || portalUrl.password ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(portalUrl.hostname) || portalUrl.port)) ||
      (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) ||
      (discoverFrom && !/^https?:\/\/\S+$/.test(discoverFrom))) {
    return NextResponse.json({ error: "יש להזין שם חברה ופרטי מקור תקינים." }, { status: 400 });
  }

  const file = type === "ats" ? ATS_CONFIG : type === "comeet" ? COMEET_CONFIG : SCAN_CONFIG;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = type === "portal" ? data.portals || [] : data.companies;
    if (!Array.isArray(entries)) throw new Error("Invalid source config");
    if (entries.some((company: { slug?: string; uid?: string }) =>
      String(type === "comeet" ? company.uid : company.slug).toLowerCase() === (type === "comeet" ? uid : slug).toLowerCase())) {
      return NextResponse.json({ error: "החברה כבר קיימת ברשימה." }, { status: 409 });
    }
    const company = type === "ats"
      ? { name, slug, ...(domain && { domain }) }
      : type === "comeet"
        ? { name, uid, token, ...(domain && { domain }), ...(discoverFrom && { discover_from: discoverFrom }) }
        : { name, slug, url: portalUrl!.href };
    const updated = type === "portal" ? { ...data, portals: [...entries, company] } : { ...data, companies: [...entries, company] };
    fs.writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`);
    return NextResponse.json({ id: `${type}:${type === "comeet" ? uid : slug}` }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "לא ניתן לשמור מקורות בסביבה זו. נדרשת גישת כתיבה לקובצי התצורה." }, { status: 503 });
  }
}