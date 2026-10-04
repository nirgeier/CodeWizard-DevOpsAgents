-- CodeWizard Jobs Intelligence - full schema (one-time paste).
-- Supabase Dashboard -> SQL Editor -> Run. Safe to re-run (idempotent).
--
-- Creates the Jobs Intelligence tables used by:
--   * Jobs/agents  (the rule-based pipeline that writes signals/companies/people/opportunities)
--   * Jobs/webapp  (the Next.js viewer)
--   * web/          (the internal app "Jobs Intelligence" tab)
--
-- Access model mirrors web/schema.sql: the tables are protected by RLS but the
-- app's publishable (anon) key gets explicit select/insert/update/delete
-- policies, so the internal tools work with the same key the rest of the app
-- already uses. Do NOT expose these tables publicly.

-- 1) Extensions ------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- fuzzy company-name search
create extension if not exists "vector";   -- optional embeddings

-- 2) Tables ----------------------------------------------------------------
create table if not exists public.companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  domain              text,
  website             text,
  industry            text,
  employees_range     text,
  employees_est       int,
  country             text,
  hq_city             text,
  location            text,
  linkedin_url        text,
  tech_stack          jsonb not null default '[]'::jsonb,
  cloud               text[] not null default '{}',
  k8s                 boolean not null default false,
  devops_hiring       boolean not null default false,
  devops_hiring_count int not null default 0,
  platform_fit        numeric(3,2) not null default 0.00,
  confidence          numeric(3,2) not null default 0.50,
  score               int not null default 0,
  service             text,
  status              text not null default 'active',
  tags                text[] not null default '{}',
  notes               text,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.people (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null,
  title              text,
  persona            text,
  seniority          text,
  company_id         uuid references public.companies(id) on delete set null,
  company_name       text,
  domain             text,
  email              text,
  phone              text,
  linkedin_url       text,
  location           text,
  country            text,
  city               text,
  background_excerpt text,
  decision_power     numeric(3,2) not null default 0.50,
  relevance          numeric(3,2) not null default 0.50,
  confidence         numeric(3,2) not null default 0.50,
  source             text,
  tags               text[] not null default '{}',
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.signals (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,
  type         text not null,
  company_id   uuid references public.companies(id) on delete set null,
  company_name text,
  domain       text,
  person_id    uuid references public.people(id) on delete set null,
  person_name  text,
  title        text,
  url          text,
  headline     text,
  summary      text,
  content      text,
  occurred_at  timestamptz,
  ingested_at  timestamptz not null default now(),
  confidence   numeric(3,2) not null default 0.50,
  relevance    numeric(3,2) not null default 0.50,
  tags         text[] not null default '{}',
  location     text,
  country      text,
  implication  text,
  intent       text,
  topics       text[] not null default '{}',
  hash         text unique,
  raw          jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.scans (
  id                  uuid primary key default gen_random_uuid(),
  mode                text not null default 'daily',
  status              text not null default 'queued',
  started_at          timestamptz,
  finished_at         timestamptz,
  filters             jsonb not null default '{}'::jsonb,
  query               text,
  market_signals      int not null default 0,
  company_profiles    int not null default 0,
  people_profiles     int not null default 0,
  social_signals      int not null default 0,
  opportunities_found int not null default 0,
  opportunities_saved int not null default 0,
  error               text,
  duration_ms         int,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.job_sources (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  provider              text not null default 'comeet'
                          check (provider in ('comeet','greenhouse','lever')),
  source_key            text not null default 'comeet',
  url                   text not null default '',
  query                 text,
  keywords              text[] not null default '{}'::text[],
  config                jsonb not null default '{}'::jsonb,
  enabled               boolean not null default true,
  scan_interval_hours   int not null default 24,
  last_scanned_at       timestamptz,
  next_scan_at          timestamptz,
  error_count           int not null default 0,
  last_error            text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (provider, name)
);

create index if not exists idx_job_sources_enabled_next on public.job_sources (enabled, next_scan_at);

create table if not exists public.devops_jobs (
  id             uuid primary key default gen_random_uuid(),
  external_id    text,
  source         text not null,
  title          text not null,
  company        text,
  company_domain text,
  location       text,
  city           text,
  country        text,
  work_mode      text,
  employment     text,
  seniority      text,
  department     text,
  url            text,
  description    text,
  posted_at      timestamptz,
  posted_text    text,
  keywords       text[] not null default '{}',
  tags           text[] not null default '{}',
  score          numeric(4,2) not null default 0.00,
  is_devops      boolean not null default true,
  raw            jsonb,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  ingested_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (source, external_id)
);

-- Shortlist: jobs the team starred in the internal app's "Agents" tab.
-- One row per starred posting; deleting the row unstars it.
create table if not exists public.job_stars (
  job_id     uuid primary key references public.devops_jobs(id) on delete cascade,
  note       text,
  starred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.opportunities (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid references public.scans(id) on delete set null,
  company_id           uuid references public.companies(id) on delete set null,
  company_name         text not null,
  domain               text,
  target_person_id     uuid references public.people(id) on delete set null,
  target_person_name   text,
  target_title         text,
  persona              text,
  linkedin_url         text,
  location             text,
  country              text,
  employees            text,
  what_is_happening    text not null,
  why_now              text not null,
  potential_pain       text not null,
  context              text not null,
  recommended_approach text not null,
  opening_question     text not null,
  confidence           numeric(3,2) not null default 0.50 check (confidence >= 0 and confidence <= 1),
  status               text not null default 'review'
                       check (status in ('new','review','approved','rejected','contacted','meeting','lost','archived')),
  outreach_status      text not null default 'pending'
                       check (outreach_status in ('pending','ready','sent','replied','bounced','n/a')),
  priority             int not null default 0,
  tags                 text[] not null default '{}',
  signals              jsonb not null default '[]'::jsonb,
  evidence             jsonb not null default '[]'::jsonb,
  owner_notes          text,
  next_action          text,
  next_action_at       timestamptz,
  contacted_at         timestamptz,
  replied_at           timestamptz,
  meeting_at           timestamptz,
  lost_reason          text,
  dedupe_key           text unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.outreach (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  channel        text not null check (channel in ('linkedin','whatsapp','email')),
  status         text not null default 'draft'
                 check (status in ('draft','approved','queued','sent','delivered','opened','replied','bounced','failed','skipped')),
  template       text,
  message_text   text,
  sent_at        timestamptz,
  delivered_at   timestamptz,
  opened_at      timestamptz,
  replied_at     timestamptz,
  error          text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.digest_logs (
  id             uuid primary key default gen_random_uuid(),
  jid            text,
  channel        text not null default 'whatsapp',
  count          int not null default 0,
  min_confidence numeric(3,2),
  max_opps       int,
  ok             boolean not null default false,
  error          text,
  payload        jsonb,
  sent_at        timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create table if not exists public.settings (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  value       jsonb not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.embeddings (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('company','person','signal','opportunity')),
  entity_id   uuid not null,
  content     text not null,
  embedding   vector(1536),
  model       text,
  created_at  timestamptz not null default now(),
  unique (entity_type, entity_id)
);

-- 3) Indexes ---------------------------------------------------------------
create index if not exists idx_companies_domain      on public.companies (domain);
create index if not exists idx_companies_name_trgm   on public.companies using gin (name gin_trgm_ops);
create index if not exists idx_companies_score       on public.companies (score desc);
create index if not exists idx_people_company        on public.people (company_id);
create index if not exists idx_people_domain         on public.people (domain);
create index if not exists idx_signals_company       on public.signals (company_id);
create index if not exists idx_signals_type          on public.signals (type);
create index if not exists idx_signals_occurred      on public.signals (occurred_at desc);
create index if not exists idx_signals_domain        on public.signals (domain);
create index if not exists idx_signals_tags          on public.signals using gin (tags);
create index if not exists idx_opps_run              on public.opportunities (run_id);
create index if not exists idx_opps_company          on public.opportunities (company_id);
create index if not exists idx_opps_status           on public.opportunities (status);
create index if not exists idx_opps_confidence       on public.opportunities (confidence desc);
create index if not exists idx_opps_created          on public.opportunities (created_at desc);
create index if not exists idx_scans_started         on public.scans (started_at desc);
create index if not exists idx_outreach_opp          on public.outreach (opportunity_id);
create index if not exists idx_embeddings_entity     on public.embeddings (entity_type, entity_id);
create index if not exists idx_jobs_source           on public.devops_jobs (source);
create index if not exists idx_jobs_company          on public.devops_jobs (company);
create index if not exists idx_jobs_posted           on public.devops_jobs (posted_at desc);
create index if not exists idx_jobs_score            on public.devops_jobs (score desc);
create index if not exists idx_jobs_last_seen        on public.devops_jobs (last_seen_at desc);
create index if not exists idx_job_stars_starred      on public.job_stars (starred_at desc);

-- 4) updated_at trigger ----------------------------------------------------
create or replace function public.cw_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['companies','people','signals','scans','opportunities','outreach','settings','devops_jobs','job_sources']
  loop
    execute format('drop trigger if exists trg_%s_upd on public.%I', t, t);
    execute format('create trigger trg_%s_upd before update on public.%I for each row execute function public.cw_set_updated_at()', t, t);
  end loop;
end $$;

-- 5) RLS + anon policies ---------------------------------------------------
-- Internal tool: the publishable (anon) key may read and write these rows.
alter table public.companies     enable row level security;
alter table public.people        enable row level security;
alter table public.signals       enable row level security;
alter table public.scans         enable row level security;
alter table public.opportunities enable row level security;
alter table public.outreach      enable row level security;
alter table public.digest_logs   enable row level security;
alter table public.settings      enable row level security;
alter table public.embeddings    enable row level security;
alter table public.devops_jobs   enable row level security;
alter table public.job_stars    enable row level security;
alter table public.job_sources  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','people','signals','scans','opportunities','outreach','digest_logs','settings','embeddings','devops_jobs','job_stars','job_sources']
  loop
    execute format('drop policy if exists cw_anon_all on public.%I', t);
    execute format('create policy cw_anon_all on public.%I for all to anon using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 6) Seed: ICP / keywords / guardrails -------------------------------------
insert into public.settings (key, value, description) values
  ('icp', jsonb_build_object(
     'company_sizes', jsonb_build_array('50-100','101-200','201-500'),
     'personas', jsonb_build_array('cto','vp_rnd','vp_engineering','head_of_devops','head_of_platform','recruiter'),
     'use_cases', jsonb_build_array('cloud','platform','devops_transformation','devops_training','devops_placement'),
     'countries', jsonb_build_array('IL','US','GB','DE','NL','FR','CA','AU','SE')),
     'ICP defaults'),
  ('keywords', jsonb_build_object(
     'market', jsonb_build_array('devops','platform engineering','kubernetes','aws','azure','gcp','cloud migration','sre','ci/cd','terraform','internal developer platform'),
     'hiring', jsonb_build_array('devops','platform engineer','sre','infrastructure','cloud engineer','system administrator')),
     'Keywords'),
  ('guardrails', jsonb_build_object(
     'require_approval_before_outreach', true,
     'human_in_loop', true,
     'require_why_now', true,
     'require_evidence', true,
     'min_confidence', 0.70),
     'Guardrails')
on conflict (key) do update set value = excluded.value, updated_at = now();
