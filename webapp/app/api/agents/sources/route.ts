import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

// Resolve config directory
const WEBAPP_DIR = process.cwd();
function firstExisting(candidates: string[], fallback: string): string {
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return fallback;
}
const CONFIG_DIR = firstExisting(
  [path.resolve(WEBAPP_DIR, "..", "agents", "config"), path.resolve(WEBAPP_DIR, "agents", "config")],
  path.resolve(WEBAPP_DIR, "..", "agents", "config"),
);

const COMEET_CONFIG = path.join(CONFIG_DIR, "comeet-companies.json");
const ATS_CONFIG = path.join(CONFIG_DIR, "ats-companies.json");
const SCAN_CONFIG = path.join(CONFIG_DIR, "job-scan.json");

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

export async function GET() {
  const comeetData = readJson(COMEET_CONFIG, { companies: [] });
  const atsData = readJson(ATS_CONFIG, { companies: [] });
  const scanConfig = readJson(SCAN_CONFIG, {});

  const comeetCompanies = (comeetData.companies || []).map((c: any) => ({
    id: `comeet:${c.uid}`,
    name: c.name,
    type: "comeet",
    domain: c.domain,
    uid: c.uid,
    token: c.token ? "***" : "",
    discoverFrom: c.discover_from,
    enabled: true,
    lastScannedAt: null,
    nextScanAt: null,
  }));

  const atsCompanies = (atsData.companies || []).map((c: any) => ({
    id: `ats:${c.slug}`,
    name: c.name,
    type: "ats",
    domain: c.domain,
    slug: c.slug,
    enabled: true,
    lastScannedAt: null,
    nextScanAt: null,
  }));

  const builtinSources = [
    { id: "linkedin", name: "LinkedIn", type: "board", domain: "linkedin.com", enabled: (scanConfig as any).sources?.includes("linkedin") ?? true },
    { id: "drushim", name: "Drushim", type: "board", domain: "drushim.co.il", enabled: (scanConfig as any).sources?.includes("drushim") ?? true },
    { id: "comeet-global", name: "Comeet (all)", type: "board", domain: "comeet.co", enabled: (scanConfig as any).sources?.includes("comeet") ?? true },
  ];

  return NextResponse.json({
    sources: [...builtinSources, ...comeetCompanies, ...atsCompanies],
    summary: {
      total: builtinSources.length + comeetCompanies.length + atsCompanies.length,
      boards: builtinSources.length,
      comeet: comeetCompanies.length,
      ats: atsCompanies.length,
    },
  });
}