// Shared types for the CodeWizard Jobs Intelligence webapp.
// Mirrors /Users/nirg/repositories/CodeWizard/Jobs/db/Jobs_schema.sql

// Two backends: Supabase (production) or local JSON files (development)
export type DataMode = "supabase" | "local";

export type OpportunityStatus =
  | "new"
  | "review"
  | "approved"
  | "rejected"
  | "contacted"
  | "meeting"
  | "lost"
  | "archived";

export interface OpportunitySignal {
  type?: string | null;
  headline?: string | null;
  source?: string | null;
  url?: string | null;
  occurred_at?: string | null;
  company_name?: string | null;
}

export interface OpportunityEvidence {
  label?: string | null;
  url?: string | null;
  source?: string | null;
  quote?: string | null;
}

export interface Opportunity {
  id: string;
  run_id?: string | null;
  company_id?: string | null;
  company_name: string;
  domain?: string | null;
  target_person_name?: string | null;
  target_title?: string | null;
  persona?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
  country?: string | null;
  employees?: string | number | null;
  what_is_happening?: string | null;
  why_now?: string | null;
  potential_pain?: string | null;
  context?: string | null;
  recommended_approach?: string | null;
  opening_question?: string | null;
  confidence?: number | string | null;
  status?: string | null;
  outreach_status?: string | null;
  priority?: number | null;
  tags?: string[] | null;
  signals?: OpportunitySignal[] | null;
  evidence?: OpportunityEvidence[] | null;
  owner_notes?: string | null;
  next_action?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Signal {
  id: string;
  source?: string | null;
  type?: string | null;
  company_name?: string | null;
  domain?: string | null;
  person_name?: string | null;
  title?: string | null;
  url?: string | null;
  headline?: string | null;
  summary?: string | null;
  occurred_at?: string | null;
  ingested_at?: string | null;
  confidence?: number | string | null;
  relevance?: number | string | null;
  tags?: string[] | null;
  location?: string | null;
  implication?: string | null;
  intent?: string | null;
  topics?: string[] | null;
}

export interface Company {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  employees_range?: string | null;
  country?: string | null;
  hq_city?: string | null;
  tech_stack?: string[] | null;
  cloud?: string[] | null;
  k8s?: boolean | null;
  devops_hiring?: boolean | null;
  devops_hiring_count?: number | null;
  platform_fit?: number | string | null;
  confidence?: number | string | null;
  score?: number | null;
  service?: string | null;
  status?: string | null;
  tags?: string[] | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
}

export interface Person {
  id: string;
  full_name: string;
  title?: string | null;
  persona?: string | null;
  seniority?: string | null;
  company_name?: string | null;
  domain?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
  country?: string | null;
  relevance?: number | string | null;
  decision_power?: number | string | null;
  confidence?: number | string | null;
  source?: string | null;
  tags?: string[] | null;
}

export interface Scan {
  id: string;
  mode?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  filters?: unknown;
  query?: string | null;
  market_signals?: number | null;
  company_profiles?: number | null;
  people_profiles?: number | null;
  social_signals?: number | null;
  opportunities_found?: number | null;
  opportunities_saved?: number | null;
  error?: string | null;
  duration_ms?: number | null;
}

export interface Stats {
  opportunities: number;
  qualified: number;
  review: number;
  approved: number;
  signals: number;
  companies: number;
  people: number;
  lastScan: string | null;
  mode: DataMode;
}

export interface ListOpportunitiesArgs {
  status?: string | null;
  minConfidence?: number | null;
  limit?: number | null;
}

export type OpportunityPatch = Partial<
  Pick<Opportunity, "status" | "owner_notes" | "next_action">
>;

// DevOps Job (from devops_jobs table - scanned job postings)
export interface DevOpsJob {
  id: string;
  external_id: string | null;
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
  description: string | null;
  posted_at: string | null;
  posted_text: string | null;
  keywords: string[];
  tags: string[];
  score: number | string;
  is_devops: boolean;
  raw: Record<string, unknown> | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  ingested_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ListJobsArgs {
  source?: string | null;
  company?: string | null;
  is_devops?: boolean | null;
  minScore?: number | null;
  limit?: number | null;
}
