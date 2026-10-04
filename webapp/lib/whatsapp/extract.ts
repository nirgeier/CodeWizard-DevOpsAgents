/**
 * WhatsApp message -> devops_jobs row.
 *
 * Job posts in Israeli WhatsApp groups are unstructured: a title line, a company,
 * a city, a stack, and often a phone number or a link buried mid-paragraph.
 * This scores a message on DevOps vocabulary (Hebrew and English) and pulls out
 * the handful of fields the `devops_jobs` table cares about.
 *
 * Nothing here writes to the database - `persistJobs` does that, so the same
 * extractor can be used for a dry run.
 */

import type { WaMessage } from "./session";

/** English + Hebrew DevOps vocabulary, weighted so a title match beats a mention. */
const KEYWORDS: Array<{ term: string; weight: number }> = [
  { term: "devops", weight: 3 },
  { term: "dev ops", weight: 3 },
  { term: "devsecops", weight: 3 },
  { term: "sre", weight: 2.5 },
  { term: "site reliability", weight: 2.5 },
  { term: "platform engineer", weight: 2.5 },
  { term: "infrastructure engineer", weight: 2.5 },
  { term: "cloud engineer", weight: 2.5 },
  { term: "build engineer", weight: 2 },
  { term: "release engineer", weight: 2 },
  { term: "kubernetes", weight: 2 },
  { term: "k8s", weight: 1.5 },
  { term: "terraform", weight: 2 },
  { term: "argocd", weight: 2 },
  { term: "gitops", weight: 2 },
  { term: "ci/cd", weight: 2 },
  { term: "cicd", weight: 2 },
  { term: "docker", weight: 1.5 },
  { term: "ansible", weight: 1.5 },
  { term: "jenkins", weight: 1.5 },
  { term: "prometheus", weight: 1.5 },
  { term: "grafana", weight: 1.5 },
  { term: "openshift", weight: 1.5 },
  { term: "helm", weight: 1 },
  { term: "aws", weight: 1 },
  { term: "eks", weight: 1.5 },
  { term: "gke", weight: 1.5 },
  { term: "gcp", weight: 1 },
  { term: "azure", weight: 1 },
  { term: "linux", weight: 1 },
  { term: "devopsops", weight: 3 },
  // Hebrew
  { term: "דוופס", weight: 3 },
  { term: "תשתיות", weight: 2 },
  { term: "ענן", weight: 2 },
  { term: "פלטפורמה", weight: 1.5 },
  { term: "קונטיינרים", weight: 1.5 },
  { term: "מערכות", weight: 1 },
  { term: "אדמין", weight: 1.5 },
];

/** Role-adjacent words: a message with one of these is asking for a person. */
const ROLE_TERMS = [
  "hiring",
  "we are looking",
  "join us",
  "recruit",
  "מחפשים",
  "מחפש",
  "דרוש",
  "דרושים",
  "מי עובד",
  "הצטרפו",
  "הצטרפות",
  "פתח משרה",
  "משרה",
  "role",
  "position",
  "opening",
  "vacancy",
];

/** Words that mean "this is chatter, not an offer". */
const NEGATIVE_TERMS = [
  "פונדקאות",
  "בוקר טוב",
  "good morning",
  "good night",
  "לילה טוב",
  "סוף שבוע",
  "thank you",
  "תודה",
];

const IL_CITIES = [
  "תל אביב", "ירושלים", "חיפה", "באר שבע", "ראשון לציון", "פתח תקווה", "נתניה",
  "רמת גן", "חולון", "הרצליה", "רעננה", "כפר סבא", "מודיעין", "גבעתיים", "בת ים",
  "אשדוד", "אשקלון", "רחובות", "נס ציונה", "הוד השרון", "קריית", "יבנה", "לוד",
  "רמלה", "אילת", "שדרות", "קריית שמונה", "טבריה", "עכו",
];

const EN_CITIES = [
  "tel aviv", "jerusalem", "haifa", "beer sheva", "rishon lezion", "petah tikva",
  "netanya", "ramat gan", "holon", "herzliya", "raanana", "kfar saba", "modiin",
  "givatayim", "bat yam", "ashdod", "ashkelon", "rehovot", "nes ziona",
  "hod hasharon", "remote", "hybrid",
];

const SENIORITY: Array<{ terms: string[]; level: string }> = [
  { terms: ["senior", "סיניור", "6+ שנים", "5 שנים ומעלה", "מומחה"], level: "senior" },
  { terms: ["lead", "tech lead", "team lead", "ראש צוות", "מוביל טכני"], level: "lead" },
  { terms: ["principal", "staff engineer", "ארכיטקט", "דירקטור"], level: "principal" },
  { terms: ["head of", "director", "ראש מחלקה", "מנהל"], level: "head" },
  { terms: ["junior", "ג'וניור", "ללא נסיון", "סטודנט", "fresh grad", "התחלתי"], level: "junior" },
];

/** A job post needs a role word AND a DevOps signal; one alone is noise. */
const MIN_SCORE = 2.5;

export interface ExtractedJob {
  external_id: string;
  source: string;
  title: string;
  company: string | null;
  company_domain: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  work_mode: string | null;
  employment: string | null;
  seniority: string | null;
  department: string | null;
  url: string | null;
  description: string;
  posted_at: string;
  posted_text: string;
  keywords: string[];
  tags: string[];
  score: number;
  is_devops: boolean;
  raw: Record<string, unknown>;
}

function matches(text: string, terms: string[]): string[] {
  const hits: string[] = [];
  for (const t of terms) {
    // \b does not work on Hebrew, so pad with spaces and match substrings.
    if (text.includes(t)) hits.push(t);
  }
  return hits;
}

/** First meaningful line: title, or the line naming the role. */
function guessTitle(lines: string[]): string {
  const skip = /^(https?:\/\/|www\.)/i;
  for (const line of lines) {
    const clean = line.replace(/[*_#>`~]/g, "").trim();
    if (!clean || clean.length < 3 || skip.test(clean)) continue;
    if (clean.includes("@") && clean.split(/\s+/).length > 3) continue;
    if (clean.length > 110) continue;
    return clean;
  }
  return lines[0]?.slice(0, 110) || "משרה מ-WhatsApp";
}

function guessCompany(lines: string[]): string | null {
  // No \b here: a word boundary needs a \w on one side, and Hebrew letters are
  // not \w - so "חברה:" never matched a \b-anchored pattern.
  const labelled = lines.find((l) =>
    /^\s*(?:ה?חברה|לחברת|לחברה|חברות|company|at)\s*[:\-–]/i.test(l),
  );
  if (labelled) {
    const v = labelled.replace(/^[^:–\-]+[:\-–]\s*/, "").trim().replace(/^@/, "");
    if (v) return v.slice(0, 100);
  }
  // "@Company" as a line, the way Israeli groups tag the hiring company.
  const tagged = lines.find((l) => /^@\S+/.test(l.trim()));
  if (tagged) return tagged.trim().replace(/^@/, "").slice(0, 100);
  return null;
}

function guessLocation(text: string, lines: string[]): { location: string | null; city: string | null } {
  const labelled = lines.find((l) =>
    /^\s*(?:ה?מיקום|מקום|עירה|עיר|city|location|מדינה)\s*[:\-–]/i.test(l),
  );
  if (labelled) {
    const v = labelled.replace(/^[^:–\-]+[:\-–]\s*/, "").trim();
    if (v) return { location: v.slice(0, 100), city: v.slice(0, 60) };
  }
  for (const city of IL_CITIES) {
    if (text.includes(city)) return { location: city, city };
  }
  for (const city of EN_CITIES) {
    if (!text.includes(city)) continue;
    if (city === "remote") return { location: "Remote", city: null };
    if (city === "hybrid") return { location: "Hybrid", city: null };
    // "tel aviv" -> "Tel Aviv"
    const pretty = city.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    return { location: pretty, city: pretty };
  }
  return { location: null, city: null };
}

function guessSeniority(text: string): string | null {
  for (const { terms, level } of SENIORITY) {
    if (matches(text, terms).length) return level;
  }
  return null;
}

/** ATS and company sites link out from the post; their hostname is a decent guess. */
function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // Aggregators (linkedin, indeed, drushim) say nothing about the employer.
    const NOISE =
      /(^|\.)(linkedin|facebook|instagram|twitter|indeed|glassdoor|jobvector|techloop|wellfound|hashnode|medium|reddit|github|drushim|afriit|israel)\./i;
    if (NOISE.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0].replace(/[.,)]+$/, "") : null;
}

/**
 * Score and structure one message. Returns null when it does not read as a job
 * post - a WhatsApp group is mostly noise and the table should stay clean.
 */
export function extractJob(msg: WaMessage, groupSubject?: string | null): ExtractedJob | null {
  const text = (msg.text || "").trim();
  if (text.length < 25) return null;

  const lower = text.toLowerCase();
  if (matches(lower, NEGATIVE_TERMS).length) return null;

  const keywords = matches(lower, KEYWORDS.map((k) => k.term));
  if (!keywords.length) return null;
  const roleHits = matches(lower, ROLE_TERMS);
  if (!roleHits.length) return null;

  let score = 0;
  for (const k of KEYWORDS) {
    if (lower.includes(k.term)) score += k.weight;
  }
  // A role word is what separates an actual opening from a passing mention.
  score += Math.min(roleHits.length * 2, 6);
  if (msg.kind === "image" || msg.kind === "video") score += 1;
  if (text.length > 200) score += 1;
  if (lower.includes("@") && /[0-9]{2,}/.test(lower)) score += 0.5;
  score = Math.min(1, Math.round((score / 22) * 100) / 100);
  if (score < MIN_SCORE / 22) return null;

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const { location, city } = guessLocation(lower, lines);
  const url = firstUrl(text);
  const title = guessTitle(lines);

  return {
    external_id: `wa:${msg.jid || "dm"}:${msg.id}`,
    source: "whatsapp",
    title,
    // Only a company the post actually names. Falling back to the group name
    // would file every opening under "משרות DevOps IL", which is the channel,
    // not the employer - the group is kept in tags instead.
    company: guessCompany(lines),
    company_domain: domainFromUrl(url),
    location,
    city,
    country: "IL",
    work_mode: /remote|היימיש|רמוט/.test(lower) ? "remote" : /hybrid/.test(lower) ? "hybrid" : null,
    employment: /מלאי\s*משרה|משרת\s*מלאה|מלאי\s*הכמות|full[-\s]?time/i.test(lower)
      ? "full-time"
      : /חלקי\s*משרה|חלקית\s*משרה|part[-\s]?time/i.test(lower)
        ? "part-time"
        : null,
    seniority: guessSeniority(lower),
    department: null,
    url,
    description: text,
    posted_at: new Date(msg.ts || Date.now()).toISOString(),
    posted_text: text,
    keywords,
    tags: ["whatsapp", ...(msg.jid ? [msg.jid] : []), ...(groupSubject ? [groupSubject] : [])],
    score,
    is_devops: true,
    raw: {
      whatsapp: {
        jid: msg.jid,
        messageId: msg.id,
        author: msg.author,
        pushName: msg.pushName,
        kind: msg.kind,
        ts: msg.ts,
        groupSubject: groupSubject || null,
        roleHits,
      },
    },
  };
}

export function extractJobs(messages: WaMessage[], groupFor?: (m: WaMessage) => string | null | undefined): {
  jobs: ExtractedJob[];
  scanned: number;
} {
  const jobs: ExtractedJob[] = [];
  for (const m of messages) {
    const subject = groupFor?.(m) ?? m.groupSubject;
    const job = extractJob(m, subject);
    if (job) jobs.push(job);
  }
  jobs.sort((a, b) => b.score - a.score);
  return { jobs, scanned: messages.length };
}

/** How many messages would qualify, without building the rows. */
export function countMatches(messages: WaMessage[]): number {
  let n = 0;
  for (const m of messages) if (extractJob(m, m.groupSubject)) n++;
  return n;
}