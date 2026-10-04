create extension if not exists pgcrypto;
create extension if not exists unaccent;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique,
  website text,
  industry text,
  subindustry text,
  stage text,
  employees_range text,
  employees_est int,
  founded int,
  hq_city text,
  country text,
  region text,
  linkedin_url text,
  crunchbase_url text,
  tech_stack jsonb default '[]',
  cloud text[] default '{}',
  k8s boolean default false,
  k8s_conf numeric(3,2) default 0.00,
  devops_hiring boolean default false,
  devops_hiring_count int default 0,
  platform_fit numeric(3,2) default 0.00,
  devops_readiness numeric(3,2) default 0.00,
  confidence numeric(3,2) default 0.50,
  status text default 'active',
  notes text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  last_enriched_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  first_name text,
  last_name text,
  title text,
  persona text,
  seniority text,
  department text,
  company_id uuid references companies(id) on delete set null,
  company_name text,
  domain text,
  email text,
  phone text,
  linkedin_url text unique,
  location text,
  country text,
  city text,
  prior_company text,
  skills jsonb default '[]',
  background_excerpt text,
  decision_power numeric(3,2) default 0.50,
  relevance numeric(3,2) default 0.50,
  confidence numeric(3,2) default 0.50,
  status text default 'active',
  source text,
  last_seen_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  type text not null,
  company_id uuid references companies(id) on delete set null,
  company_name text,
  domain text,
  person_id uuid references people(id) on delete set null,
  person_name text,
  title text,
  url text,
  headline text,
  summary text,
  content text,
  occurred_at timestamptz,
  ingested_at timestamptz default now(),
  confidence numeric(3,2) default 0.50,
  relevance numeric(3,2) default 0.50,
  tags text[] default '{}',
  location text,
  country text,
  implication text,
  intent text,
  topics text[] default '{}',
  hash text unique,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  company_id uuid references companies(id) on delete set null,
  company_name text,
  domain text,
  occurred_at timestamptz not null,
  source text,
  url text,
  summary text,
  impact text,
  confidence numeric(3,2) default 0.50,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists company_signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  signal_id uuid references signals(id) on delete cascade,
  weight numeric(3,2) default 0.50,
  created_at timestamptz default now(),
  unique(company_id, signal_id)
);

create table if not exists person_signals (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete cascade,
  signal_id uuid references signals(id) on delete cascade,
  weight numeric(3,2) default 0.50,
  created_at timestamptz default now(),
  unique(person_id, signal_id)
);

create table if not exists social_signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  type text not null,
  company_id uuid references companies(id) on delete set null,
  company_name text,
  domain text,
  person_id uuid references people(id) on delete set null,
  person_name text,
  title text,
  url text unique,
  text_excerpt text,
  content text,
  intent text,
  topics text[] default '{}',
  occurred_at timestamptz,
  ingested_at timestamptz default now(),
  relevance numeric(3,2) default 0.50,
  confidence numeric(3,2) default 0.50,
  sentiment text,
  hash text unique,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  filters jsonb default '{}',
  query text,
  market_signals int default 0,
  company_profiles int default 0,
  people_profiles int default 0,
  social_signals int default 0,
  opportunities_found int default 0,
  opportunities_saved int default 0,
  error text,
  duration_ms int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists job_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  query text,
  keywords text[] not null default '{}'::text[],
  enabled boolean not null default true,
  scan_interval_hours int not null default 24,
  last_scanned_at timestamptz,
  next_scan_at timestamptz,
  error_count int not null default 0,
  last_error text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_sources_enabled_idx on job_sources (enabled, next_scan_at);

create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references scans(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  company_name text not null,
  domain text,
  target_person_id uuid references people(id) on delete set null,
  target_person_name text,
  target_title text,
  persona text,
  linkedin_url text,
  location text,
  country text,
  employees text,
  what_is_happening text not null,
  why_now text not null,
  potential_pain text not null,
  context text not null,
  recommended_approach text not null,
  opening_question text not null,
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  status text not null default 'review' check (status in ('new','review','approved','rejected','contacted','meeting','lost','archived')),
  outreach_status text default 'pending' check (outreach_status in ('pending','ready','sent','replied','bounced','n/a')),
  priority int default 0,
  tags text[] default '{}',
  signals jsonb default '[]',
  evidence jsonb default '[]',
  owner_notes text,
  next_action text,
  next_action_at timestamptz,
  contacted_at timestamptz,
  replied_at timestamptz,
  meeting_at timestamptz,
  lost_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists outreach (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities(id) on delete cascade,
  channel text not null check (channel in ('linkedin','whatsapp','email')),
  status text not null default 'draft' check (status in ('draft','approved','queued','sent','delivered','opened','replied','bounced','failed','skipped')),
  template text,
  message_text text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  replied_at timestamptz,
  error text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists digest_logs (
  id uuid primary key default gen_random_uuid(),
  jid text,
  channel text default 'whatsapp',
  count int default 0,
  min_confidence numeric(3,2),
  max_opps int,
  ok boolean default false,
  error text,
  payload jsonb,
  sent_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null,
  description text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists embeddings (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('company','person','signal','opportunity')),
  entity_id uuid not null,
  content text not null,
  embedding vector(1536),
  model text,
  created_at timestamptz default now(),
  unique(entity_type, entity_id)
);
