import "server-only";
import fs from "node:fs";
import path from "node:path";

export interface AgentSource {
  id: string;
  name: string;
  type: "board" | "comeet" | "ats" | "portal" | "company";
  domain?: string;
  uid?: string;
  token?: string;
  slug?: string;
  discoverFrom?: string;
  foundOn?: string;
  enabled: boolean;
  lastScannedAt?: string | null;
  nextScanAt?: string | null;
}

function firstExisting(candidates: string[], fallback: string): string {
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return fallback;
}

const WEBAPP_DIR = process.cwd();
export const CONFIG_DIR = firstExisting(
  [path.resolve(WEBAPP_DIR, "..", "agents", "config"), path.resolve(WEBAPP_DIR, "agents", "config")],
  path.resolve(WEBAPP_DIR, "..", "agents", "config"),
);
export const COMEET_CONFIG = path.join(CONFIG_DIR, "comeet-companies.json");
export const ATS_CONFIG = path.join(CONFIG_DIR, "ats-companies.json");
export const SCAN_CONFIG = path.join(CONFIG_DIR, "job-scan.json");
export const BOARD_COMPANIES_CONFIG = path.join(CONFIG_DIR, "board-companies.json");

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

function hostname(url: string): string | undefined {
  try { return new URL(url).hostname; } catch { return undefined; }
}

export function listAgentSources(): AgentSource[] {
  const comeetData = readJson<{ companies?: any[] }>(COMEET_CONFIG, { companies: [] });
  const atsData = readJson<{ companies?: any[] }>(ATS_CONFIG, { companies: [] });
  const scanConfig = readJson<{ sources?: string[]; portals?: { name: string; slug: string; url: string }[] }>(SCAN_CONFIG, {});
  const enabled = (name: string) => scanConfig.sources?.includes(name) ?? true;

  const builtin: AgentSource[] = [
    { id: "linkedin", name: "LinkedIn", type: "board", domain: "linkedin.com", enabled: enabled("linkedin") },
    { id: "drushim", name: "Drushim", type: "board", domain: "drushim.co.il", enabled: enabled("drushim") },
    { id: "comeet-global", name: "Comeet (all)", type: "board", domain: "comeet.co", enabled: enabled("comeet") },
  ];
  const comeet: AgentSource[] = (comeetData.companies || []).filter((c) => c?.uid).map((c) => ({
    id: `comeet:${c.uid}`, name: c.name || c.uid, type: "comeet", domain: c.domain, uid: c.uid,
    token: c.token ? "***" : "", discoverFrom: c.discover_from, enabled: true, lastScannedAt: null, nextScanAt: null,
  }));
  const ats: AgentSource[] = (atsData.companies || []).filter((c) => c?.slug).map((c) => ({
    id: `ats:${c.slug}`, name: c.name || c.slug, type: "ats", domain: c.domain, slug: c.slug,
    enabled: true, lastScannedAt: null, nextScanAt: null,
  }));
  const portals: AgentSource[] = (scanConfig.portals || []).filter((p) => p?.slug).map((p) => ({
    id: `portal:${p.slug}`, name: p.name, type: "portal", domain: hostname(p.url), slug: p.slug,
    discoverFrom: p.url, enabled: true,
  }));
  const boardData = readJson<{ companies?: any[] }>(BOARD_COMPANIES_CONFIG, { companies: [] });
  const boardCompanies: AgentSource[] = (boardData.companies || []).filter((c) => c?.slug).map((c) => ({
    id: `company:${c.slug}`, name: c.name, type: "company", domain: c.domain || undefined, slug: c.slug,
    foundOn: c.found_on, enabled: true, lastScannedAt: null, nextScanAt: null,
  }));
  return [...builtin, ...comeet, ...ats, ...portals, ...boardCompanies];
}

export function scanArgsForSource(sourceId: string, options: Record<string, unknown> = {}): string[] {
  const args: string[] = [];
  if (sourceId === "linkedin" || sourceId === "drushim" || sourceId === "ats") args.push("--source", sourceId);
  else if (sourceId === "comeet-global") args.push("--source", "comeet");
  else if (sourceId.startsWith("comeet:")) args.push("--comeet-company", sourceId.slice("comeet:".length));
  else if (sourceId.startsWith("ats:")) args.push("--ats-company", sourceId.slice("ats:".length));
  else if (sourceId.startsWith("portal:")) args.push("--portal", sourceId.slice("portal:".length));
  else if (sourceId.startsWith("company:")) args.push("--board-company", sourceId.slice("company:".length));
  else args.push("--source", "linkedin,drushim,comeet,ats");

  if (options.pages) args.push("--pages", sourceId.startsWith("company:") ? "1" : String(Number(options.pages) || 1));
  if (options.maxAgeDays) args.push("--max-age-days", String(Number(options.maxAgeDays) || 30));
  if (typeof options.keywords === "string" && options.keywords) args.push("--keywords", options.keywords);
  if (options.limit) args.push("--limit", String(Number(options.limit) || 0));
  return args;
}
