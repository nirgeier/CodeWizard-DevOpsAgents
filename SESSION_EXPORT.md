# CodeWizard-DevOpsAgents - Session Export

**Date**: October 3, 2026
**Session**: Full development session covering repo setup, webapp modifications, and hiremetech.com analysis

---

## 1. Project Context

**Repository**: `/Users/nirg/repositories/CodeWizard-DevOpsAgents`
**Description**: Standalone DevOps sales intelligence and job scanning application extracted from internal-app sales section.

### Structure
```
CodeWizard-DevOpsAgents/
├── agents/           # Python job scanning + sales intelligence pipeline
│   ├── scan_jobs.py  # Job scanner (LinkedIn, Drushim, Comeet, Greenhouse, Lever)
│   ├── sales_intel/  # Sales intelligence engine (signals, companies, people, opportunities)
│   ├── config/       # Job scan config, Comeet companies
│   └── scripts/      # Helper scripts
├── db/               # Database schemas (Supabase + migrations)
│   ├── sales_schema.sql
│   └── migrations/
├── webapp/           # Next.js 16.3.5 frontend (React 19, TypeScript, Tailwind)
│   ├── app/          # App Router pages + API routes
│   ├── components/   # React components
│   └── lib/          # Database layer, types, formatting
└── start.sh          # Dev server launcher (port 3001)
```

---

## 2. Discord Welcome Message

Created bilingual welcome messages for the Discord channel announcing the job collector agent:

### English Version
```
👋 **Welcome to #jobs-pipeline** — home of the **Job Radar agent**.

**What we're building**
One agent that watches the whole network for DevOps / cloud / platform openings,
collects them, cleans them up, and pushes the good ones straight into the
WhatsApp groups where our people actually work.

`sources → normalize → score → dedupe → route → publish`

1. **Collect** — LinkedIn (public search), Drushim, Comeet (per company), plus any
   Greenhouse / Lever board we add.
2. **Normalize** — one row per posting, same shape regardless of the board.
3. **Score** — DevOps relevance from role + stack terms. A generic "full stack dev"
   that only mentions Kubernetes in the body gets dropped.
4. **Dedupe** — deterministic ids, so the same job never posts twice.
5. **Route & publish** — to the right groups, in a short format that reads on a phone.

**Status**
🟢 Collect → normalize → score → dedupe — working
🟡 Publish to WhatsApp groups — in progress
⚪ Feedback loop (which posts actually get replies) — next

**What we need from you**
- Send us any job board or group we're missing → we'll wire it in
- Tell us when a post is wrong or noisy — that trains the filter
- Group owners: DM me to get your group on the list

Repo: `CodeWizard-DevOpsAgents`. Questions, findings, and "this shouldn't be here" reports — all welcome right here.
```

### Hebrew Version
```
👋 **ברוכים הבאים ל־#jobs-pipeline** — הבית של **סוכן רדאר המשרות**.

**מה אנחנו בונים**
סוכן אחד שמרפה את כל הרשת למשרות DevOps / ענן / פלטפורמה, אוסף אותן,
מנקה אותן, ומדחיק את המתאימות ישירות לקבוצות ה-WhatsApp שבהן הקהילה שלנו
באמת עובדת.

`מקורות ← נרמול ← דירוג ← סינון כפילויות ← ניתוב ← פרסום`

1. **איסוף** — LinkedIn (חיפוש ציבורי), דרושים, Comeet (לכל חברה), וכל לוח
   Greenhouse / Lever שנוסיף.
2. **נרמול** — שורה אחת אחידה לכל משרה, בלי תלות בלוח.
3. **דירוג** — רלוונטיות DevOps לפי תפקיד + סטאק. "פול סטאק" שמזכיר קוברנטיס
   רק בגוף המשרה נזרק.
4. **סינון כפילויות** — מזהה דטרמיניסטי, אותה משרה לא תפורסם פעמיים.
5. **ניתוב ופרסום** — לקבוצה הנכונה, בפורמט קצר שנקרא על מסך טלפון.

**סטטוס**
🟢 איסוף ← נרמול ← דירוג ← סינון — עובד
🟡 פרסום לקבוצות WhatsApp — בעבודה
⚪ לולאת משוב (איזה פוסטים באמת מקבלים תגובות) — הבא

**מה אנחנו צריכים מכם**
- שלחו לנו כל לוח משרות או קבוצה שחסרה אצלנו — נחבר אותה
- כשפוסט שגוי או רועש — תגידו לנו, זה משפר את הסינון
- בעלי קבוצות: כתבו לי בפרטי כדי שהקבוצה שלכם תתווסף

ריפו: `CodeWizard-DevOpsAgents`. שאלות, ממצאים ודיווחים על פוסטים שלא ראויים לפרסום — מתקבלים כאן.
```

---

## 3. GitHub Repository Setup

### Repository Created
- **URL**: https://github.com/nirgeier/CodeWizard-DevOpsAgents
- **Visibility**: PUBLIC
- **Default Branch**: `main`

### Branches
| Branch | Protection |
|--------|------------|
| `main` | ✅ Enforced |
| `dev` | ✅ Enforced |

### Branch Protection Rules (Both Branches)
- ✅ Require pull request before merging
- ✅ **2 approving reviews** required
- ✅ Require review from Code Owners
- ✅ Dismiss stale reviews on new pushes
- ✅ Require approval on last push (no self-approval)
- ✅ Enforce for admins (blocks direct push even by owner)
- ✅ Block force pushes
- ✅ Block branch deletion
- ✅ Require conversation resolution
- ✅ No required status checks (can add CI later)

### Implementation Notes
- GitHub REST API used (not rulesets - `required_reviewers` not valid in rulesets)
- `dismissal_restrictions.users` only works for org repos (personal repo limitation)
- CODEOWNERS: "an approval from **any** of the owners is sufficient" (can't enforce AND)
- **Actual enforcement**: 2 approvals where Copilot auto-reviews (counts as 1) + you approve (counts as 2nd)

### Initial Commit
- Empty root commit: `e0a3108` "chore: initial commit (empty scaffold, code lands via PR)"
- No code committed - all 116 files still untracked

---

## 4. .gitignore Updates

### Added Rules
```gitignore
# Agent tooling local state (sqlite memory db + embeddings)
.opencode-memory/
.opencode/
.claude/

# Python tooling caches
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
.coverage.*
htmlcov/
*.egg-info/
.tox/
.nox/

# Logs
*.log
logs/

# Editor/IDE
.cursor/
.idea/
.vscode/
*.swp
*~
*.bak
*.orig
*.rej

# Secrets
*.pem
*.key

# Generated data
data/
agent/data/
**/data/*.json
*.ndjson

# OS
.DS_Store
Thumbs.db
```

### Verified
- Templates still tracked: `agents/.env.example`, `webapp/.env.example`, `webapp/.gitignore`
- All sensitive paths ignored: `.env.local`, `node_modules/`, `.next/`, `__pycache__/`, `.opencode-memory/`, `data/devops_jobs.json`

---

## 5. WebApp Supabase Modifications

### Phase 1: Removed Supabase (Local-Only)
**Files Modified**:
- `webapp/lib/db.ts` - Rewritten to local-only JSON reads
- `webapp/lib/types.ts` - `DataMode = "local"`
- `webapp/app/layout.tsx` - Removed mode badge, getMode import
- `webapp/components/Sidebar.tsx` - Removed mode prop and badge
- `webapp/app/api/health/route.ts` - Hardcoded `{mode: "local"}`
- `webapp/app/scans/page.tsx` - Removed "מצב" column

### Phase 2: Restored Supabase (Hidden from GUI)
**Files Modified**:
- `webapp/lib/db.ts` - Full dual-backend restored (auto-detects Supabase via env)
- `webapp/lib/types.ts` - `DataMode = "supabase"` (single backend type)
- `webapp/app/api/health/route.ts` - Now calls `getMode()` dynamically
- `webapp/app/layout.tsx` - Clean, no mode UI
- `webapp/components/Sidebar.tsx` - Clean, no mode UI
- `webapp/app/scans/page.tsx` - Clean table

### Result
- **Backend**: Supabase only (auto-detects, falls back to local if env missing)
- **Data**: Live from Supabase (3 opportunities, 278KB signals)
- **UI**: Zero mode indicators, badges, or conditional rendering
- **Health endpoint**: Returns `{"ok":true,"mode":"supabase"}`

---

## 6. HireMeTech.com Deep Analysis

### Site: https://hiremetech.com/he-il/

### Tech Stack Identified
| Component | Technology |
|-----------|------------|
| Framework | React 18+, Vite, TypeScript |
| Router | React Router |
| State | React Query (TanStack Query) |
| Animation | Framer Motion |
| Mobile/PWA | Capacitor v6 (iOS/Android + PWA) |
| i18n | 5 languages (he, en, fr, de, es) with RTL |
| Auth | Google, Facebook, Microsoft Entra ID |
| Analytics | GA4 (G-KQJCXKN7X5) + Meta Pixel (dual: 1022789047353489 + 311527748561121) |
| Fonts | Assistant, Heebo, Inter, JetBrains Mono, Frank Ruhl Libre, Rubik (display=optional) |
| Maps | MapTiler |
| SEO | react-helmet-async + JSON-LD schemas |
| Theming | 12 themes with CSS variables |
| CSP | Extensive for 3rd party integrations |

### Core Features
1. **Job Index**: 1.8M+ global tech jobs
2. **AI Auto Apply**: Automated applications to ATS
3. **AI Resume Builder**: Structured resume with ATS scoring
4. **Cover Letter Generator**: Tone presets, company research
5. **Career Planning**: Skill gap analysis, learning paths
6. **Interview Prep**: Mock interviews, rubric scoring
7. **Tech Meetups**: Discovery + RSVP
8. **AI Career Mentor**: Persistent context chat
9. **WhatsApp Alerts**: Real-time job notifications
10. **Themes**: 12 themes (light/dark) with persistence

### Key Technical Details
- **Locale detection**: URL prefix `/he-il/`, `/en-us/` sets `html lang` + `dir` before paint
- **Capacitor stub**: Inline in `<head>` for native bridge detection
- **Theme FOUC prevention**: Inline script reads localStorage before paint
- **Font strategy**: `display=optional` avoids CLS (0.112 CLS saved vs swap)
- **Module preloading**: Dynamic based on route + locale
- **Structured data**: Organization, SoftwareApplication, Service schemas

---

## 7. HireMe Pro - Comprehensive Specification

Created a complete technical specification for building an **improved competitor** to hiremetech.com with:

### Key Differentiators
| Area | HireMeTech | HireMe Pro (Spec) |
|------|------------|-------------------|
| **Auth** | Google, FB, Microsoft | **Google, GitHub, LinkedIn, Microsoft, Apple** |
| **Profile Sync** | Basic LinkedIn | **Deep GitHub + LinkedIn + Google + Microsoft** |
| **Auto Apply** | Limited ATS | **8+ ATS (Greenhouse, Lever, Ashby, Workday, Comeet, BambooHR, Breezy, Custom)** |
| **GitHub Integration** | ❌ | **Full repo analysis, contributions, stars → skills** |
| **Interview Prep** | Text | **Voice mock interviews, rubric scoring** |
| **Salary Data** | Basic | **Levels.fyi + Glassdoor + Blind + user-reported** |
| **PWA** | Basic | **TWA + native push + offline + background sync** |
| **Themes** | 12 | **20+ + custom CSS variable builder** |
| **RTL** | HE only | **HE + AR + auto-detect** |

### Specification Contents (Full Document in Memory)

#### Architecture
- **Monorepo**: Turborepo + pnpm (web, mobile, workers, shared packages)
- **Frontend**: Next.js 15 App Router + React 19 + Tailwind v4 + Radix UI
- **API**: tRPC + Next.js API routes
- **Database**: PostgreSQL + pgvector (Supabase) with Prisma ORM
- **Queue**: BullMQ + Upstash Redis
- **Auth**: NextAuth.js v5 (Auth.js) with 5 OAuth providers

#### Database Schema (Prisma)
- User, Account, Session, Profile (with positions, educations, skills, projects)
- Job (with pgvector embedding for semantic search)
- Application (Kanban statuses), SavedJob, SavedSearch, JobAlert
- Resume, CoverLetter, Interview, Meetup, MeetupRSVP
- MentorSession, Notification, WebhookEndpoint, SyncLog

#### Auth Providers (5)
```typescript
Providers: Google, GitHub, LinkedIn, Microsoft Entra ID, Apple
Scopes: 
  - Google: openid email profile + Gmail/Calendar
  - GitHub: read:user user:email repo + webhooks
  - LinkedIn: r_liteprofile r_emailaddress w_member_social
  - Microsoft: openid email profile User.Read Mail.Send
  - Apple: name email
```

#### App Integrations
- **LinkedIn**: Marketing Developer Platform + Sign In + Share
- **GitHub**: OAuth App + GitHub App (webhooks for repo events)
- **Google**: Cloud Project + People/Gmail/Calendar APIs
- **Microsoft**: Entra ID App Registration

#### Profile Sync Engine
```typescript
UnifiedProfile {
  emails, names, photos, urls,
  headline, summary, positions, educations, skills, languages,
  certifications, projects, publications, patents, honors,
  github: { username, repos, contributions, stars, orgs },
  linkedin: { urn, connections, followers, posts, companies },
  atsScore, skillGaps, marketValue
}
```

#### AI/ML Features
- **Embeddings**: paraphrase-multilingual-mpnet-base-v2 (1536-dim) + pgvector HNSW
- **Resume Tailoring**: GPT-4o/Claude 3.5 with structured JSON output
- **Auto-Apply**: ATS-specific handlers with dry-run mode
- **Mentor**: Persistent context, action items, multi-session

#### Frontend Architecture
- **Components**: JobCard (3 variants), JobFilters, JobMap (MapTiler), KanbanBoard
- **Theming**: 20+ themes with CSS variables, density modes
- **i18n**: next-intl with 6 locales (he, en, ar, fr, de, es), RTL-aware components
- **PWA**: Workbox service worker, Capacitor v6, TWA for Play Store

#### Deployment
- **Web**: Vercel (Edge Functions, ISR)
- **Database**: Supabase (pgvector, read replicas)
- **Queue/Cache**: Upstash Redis
- **Email**: Resend
- **Push**: OneSignal/Firebase
- **Analytics**: PostHog + GA4 + Meta Pixel
- **Monitoring**: Sentry + Vercel Analytics

#### Timeline: 22 Weeks
| Phase | Weeks | Focus |
|-------|-------|-------|
| 1 | 1-3 | Foundation (monorepo, auth, UI, i18n, CI/CD) |
| 2 | 4-7 | Core Jobs (ingestion, search, applications, companies) |
| 3 | 8-11 | AI Features (resume, cover letter, auto-apply, mentor, interview) |
| 4 | 12-15 | Profile Sync (GitHub, LinkedIn, Google, Microsoft, unified) |
| 5 | 16-19 | Community + Mobile (meetups, notifications, PWA, Capacitor, TWA) |
| 6 | 20-22 | Polish + Launch (perf, a11y, security, load test, deploy) |

---

## 8. Current Repo State

### Git Status
```bash
# Tracked files: 0 (only empty initial commit)
# Untracked: 116 files (~200KB source code)
# Ignored: .opencode-memory/, node_modules/, .next/, data/, __pycache__/, .env.local
```

### Running Services
- **Next.js Dev Server**: `http://localhost:3001` (PID 58514)
  - All routes HTTP 200
  - Supabase mode active
  - Live data: 3 opportunities, signals, companies, people, scans

### Environment
- `webapp/.env.local`: Supabase URL + publishable key (configured)
- `agents/.env.example`: Template only (no real secrets)
- No secrets committed

---

## 9. Action Items / Next Steps

### Immediate
- [ ] Add `CONTRIBUTING.md` + PR template as first PR (`dev` → `main`)
- [ ] Create `.github/CODEOWNERS` with `* @nirgeier`
- [ ] Add workflow to auto-request Copilot review on PR open
- [ ] Decide on `agents/config/comeet-companies.json` (9 companies, public tokens) - keep or gitignore?

### Short Term
- [ ] Run Python pipeline to seed local JSON mirrors: `python3 agents/run.py`
- [ ] Run job scanner dry-run: `python3 agents/scan_jobs.py --list`
- [ ] Set up Discord webhook in `agents/.env` for notifications

### Long Term (HireMe Pro Build)
- [ ] Initialize Turborepo monorepo per specification
- [ ] Register 5 OAuth applications
- [ ] Set up Supabase project with pgvector
- [ ] Implement auth + profile sync engines
- [ ] Build job ingestion pipeline (start with LinkedIn + Greenhouse)

---

## 10. Key Decisions Log

| Decision | Rationale |
|----------|-----------|
| Public GitHub repo | Transparency, easier collaboration, GitHub Pages option |
| 2 approvals + Copilot | GitHub personal repo limitation; Copilot auto-review + human = 2 |
| Supabase hidden from GUI | User requested "use supbase, just dont show indication in the gui" |
| Dual-mode db.ts kept | Auto-detects Supabase via env, graceful fallback to local JSON |
| Turborepo for HireMe Pro | Shared packages (ui, auth, db, ai, sync, ats, i18n) across web/mobile/workers |
| Capacitor + TWA | Single codebase for web + iOS + Android + Play Store |
| 6 locales (add AR) | Hebrew + Arabic RTL + major European markets |

---

## 11. Files Modified This Session

### Created
- `SESSION_EXPORT.md` (this file)

### Modified
- `.gitignore` - Added 30+ ignore patterns
- `webapp/lib/db.ts` - Rewritten twice (local-only → dual backend)
- `webapp/lib/types.ts` - DataMode type changed twice
- `webapp/app/layout.tsx` - Cleaned (removed mode UI)
- `webapp/components/Sidebar.tsx` - Cleaned (removed mode prop)
- `webapp/app/api/health/route.ts` - Fixed to use getMode()
- `webapp/app/scans/page.tsx` - Removed "מצב" column

### GitHub (Remote Only)
- Repository: `nirgeier/CodeWizard-DevOpsAgents`
- Branches: `main`, `dev` (both protected)
- No code pushed

---

## 12. Memory Notes (from MCP)

### Project Memories Stored
- CodeWizard company context (DevOps consulting, Israel, ~16 staff)
- Supabase migration from Cloudflare (Sep 2026)
- Zero-npm Supabase pattern with RLS
- Entra ID SSO implementation details
- DevOps website best practices benchmark

### Global Memories Applied
- Session-end memory save workflow
- CodeWizard site analysis (WordPress, separate from this repo)
- Competitor research for DevOps company websites

---

## 13. HireMe Pro - 17 Major Build Steps (Consolidated from 38 Detailed Tasks)

The specification breaks down into **6 phases / 22 weeks / 38 detailed tasks**. Consolidated into **17 major milestones**:

| # | Major Step | Phase | Week Range | Deliverable |
|---|------------|-------|------------|-------------|
| 1 | **Monorepo & Infrastructure** | 1 | 1-2 | Turborepo + pnpm, Supabase project, CI/CD, preview deployments |
| 2 | **Authentication System** | 1 | 2-3 | NextAuth v5 with 5 OAuth providers (Google, GitHub, LinkedIn, Microsoft, Apple) |
| 3 | **Design System & i18n** | 1 | 2-3 | Radix UI + Tailwind v4 components, 6 locales (he/en/ar/fr/de/es), RTL support |
| 4 | **Job Ingestion Pipeline** | 2 | 4-5 | 5+ sources (LinkedIn, Greenhouse, Lever, Ashby, Workday, Comeet) → normalized jobs + pgvector embeddings |
| 5 | **Job Search & Discovery** | 2 | 5-6 | Hybrid full-text + vector search, JobCard/List/Map views, filters, saved searches |
| 6 | **Application Tracker** | 2 | 6-7 | Kanban board (Wishlist→Applied→Screening→Offer), application history, status webhooks |
| 7 | **Company Intelligence** | 2 | 7 | Enriched profiles (tech stack, team size, Glassdoor/Levels.fyi/Blind data, salary benchmarks) |
| 8 | **Resume Builder & AI Tailoring** | 3 | 8-9 | Structured editor, LaTeX/PDF export, GPT-4o per-job tailoring with ATS scoring |
| 9 | **Cover Letter Generator** | 3 | 9 | Tone presets, company research injection, multi-language (HE/EN) |
| 10 | **Auto-Apply Engine** | 3 | 10-11 | 8 ATS handlers (Greenhouse, Lever, Ashby, Workday, Comeet, BambooHR, Breezy, Custom), dry-run mode |
| 11 | **AI Career Mentor** | 3 | 10-11 | Persistent context chat, action items, multi-session memory, interview prep (voice mock + rubric) |
| 12 | **GitHub Deep Sync** | 4 | 12-13 | Repos, contributions calendar, starred, orgs → skill extraction, project portfolio |
| 13 | **LinkedIn Deep Sync** | 4 | 13-14 | Profile, positions, posts, network, companies → professional graph, referral paths |
| 14 | **Google/Microsoft Sync** | 4 | 14-15 | Calendar (interview scheduling), Gmail/Outlook (alerts), Entra SSO, unified profile merge |
| 15 | **Unified Profile & Analytics** | 4 | 15 | ATS score, skill gaps, market value, learning paths, salary benchmarks |
| 16 | **Community & Mobile** | 5 | 16-19 | Meetups (Cal.com/ICS), multi-channel notifications (WA/Telegram/Discord/Email/Push), Capacitor v6 + TWA |
| 17 | **Launch Hardening** | 6 | 20-22 | Core Web Vitals, WCAG 2.1 AA, security audit, load test (10k), Hebrew/EN content, production deploy |

---

## 14. HireMe Pro - All 38 Detailed Tasks (Full Specification Breakdown)

### Phase 1: Foundation (Weeks 1-3)
- [ ] **1.1** Monorepo setup (Turborepo + pnpm workspaces)
- [ ] **1.2** Database schema + migrations (Supabase PostgreSQL + pgvector)
- [ ] **1.3** Auth system (NextAuth v5 + 5 providers: Google, GitHub, LinkedIn, Microsoft, Apple)
- [ ] **1.4** Base UI components + design system (Radix UI + Tailwind v4 + Storybook)
- [ ] **1.5** i18n infrastructure (6 locales: he/en/ar/fr/de/es, RTL-aware components)
- [ ] **1.6** CI/CD pipeline (GitHub Actions: lint → typecheck → test → build → deploy preview)
- [ ] **1.7** Deploy preview environments (Vercel preview deployments on PR)

### Phase 2: Core Job Platform (Weeks 4-7)
- [ ] **2.1** Job ingestion pipeline (5+ sources: LinkedIn, Greenhouse, Lever, Ashby, Workday, Comeet)
- [ ] **2.2** Job search (hybrid full-text + pgvector semantic search with HNSW index)
- [ ] **2.3** Job cards, list view, map view (MapTiler integration)
- [ ] **2.4** Saved jobs, saved searches, job alerts (instant/daily/weekly, multi-channel)
- [ ] **2.5** Application tracker (Kanban: Wishlist → Applied → Screening → Tech Interview → Final → Offer/Rejected)
- [ ] **2.6** Company profiles with enrichment (tech stack, team size, Glassdoor/Levels.fyi/Blind, salary bands)

### Phase 3: AI Features (Weeks 8-11)
- [ ] **3.1** Resume builder + LaTeX/PDF export (structured editor, templates, ATS scoring)
- [ ] **3.2** AI resume tailoring per job (GPT-4o/Claude 3.5, structured JSON output, keyword optimization)
- [ ] **3.3** Cover letter generator (tone presets: professional/enthusiastic/concise/storytelling, company research)
- [ ] **3.4** Auto-apply engine (8 ATS handlers: Greenhouse, Lever, Ashby, Workday, Comeet, BambooHR, Breezy, Custom)
- [ ] **3.5** AI career mentor (persistent context, action items, multi-session, RAG over user profile)
- [ ] **3.6** Interview prep (question bank, voice mock interviews, rubric scoring, feedback)

### Phase 4: Profile Sync & Integrations (Weeks 12-15)
- [ ] **4.1** GitHub sync (repos, contributions calendar, stars, orgs → skill extraction, project portfolio)
- [ ] **4.2** LinkedIn sync (profile, positions, posts, network, companies → professional graph, referral paths)
- [ ] **4.3** Google sync (Calendar for interview scheduling, Gmail for alerts, People API)
- [ ] **4.4** Microsoft sync (Entra ID SSO, Outlook Calendar, Graph API, Teams integration)
- [ ] **4.5** Unified profile merge (deduplication, conflict resolution, ATS scoring, skill gap analysis)
- [ ] **4.6** Learning paths & market value (skill gaps → course recommendations, salary benchmarks)

### Phase 5: Community & Mobile (Weeks 16-19)
- [ ] **5.1** Meetups discovery + RSVP (Meetup.com, Eventbrite, Luma, Cal.com, custom sources)
- [ ] **5.2** Multi-channel notifications (WhatsApp, Telegram, Discord, Email, Push, In-app)
- [ ] **5.3** PWA + Capacitor v6 (iOS/Android native builds, offline-first, background sync)
- [ ] **5.4** TWA for Play Store (Trusted Web Activity, assetlinks, digital asset links)
- [ ] **5.5** Push notifications + background sync (OneSignal/Firebase, service worker, periodic sync)
- [ ] **5.6** Offline-first job browsing (Workbox caching, IndexedDB, sync on reconnect)

### Phase 6: Polish & Launch (Weeks 20-22)
- [ ] **6.1** Performance optimization (Core Web Vitals: LCP <2.5s, CLS <0.1, FID <100ms)
- [ ] **6.2** Accessibility audit (WCAG 2.1 AA: keyboard nav, ARIA, contrast, screen readers)
- [ ] **6.3** Security audit + penetration test (OWASP Top 10, dependency scan, secrets audit)
- [ ] **6.4** Load testing (10k concurrent users, k6/Gatling, database connection pooling)
- [ ] **6.5** Hebrew/English content review (native speakers, RTL layout verification, legal compliance)
- [ ] **6.6** Launch marketing site + waitlist (landing page, email capture, referral program)
- [ ] **6.7** Production deploy + monitoring (Vercel prod, Supabase read replicas, Sentry, PostHog, alerting)

---

## 15. HireMe Pro - Required API Keys & Secrets Checklist

```bash
# ==========================================
# AUTHENTICATION (5 Providers)
# ==========================================
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_SERVER_CLIENT_ID=          # For Capacitor native
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_TENANT_ID=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=                # Base64 encoded .p8 file

# ==========================================
# DATABASE & QUEUE
# ==========================================
DATABASE_URL=postgresql://...     # Supabase (with pgvector)
DIRECT_URL=postgresql://...       # Direct connection for migrations
REDIS_URL=rediss://...            # Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# ==========================================
# AI / ML
# ==========================================
OPENAI_API_KEY=                   # GPT-4o for resume tailoring, mentor
ANTHROPIC_API_KEY=                # Claude 3.5 Sonnet alternative
COHERE_API_KEY=                   # embed-multilingual-v3 alternative

# ==========================================
# JOB SOURCES (API Keys per Source)
# ==========================================
LINKEDIN_API_KEY=                 # LinkedIn Marketing Developer Platform
GREENHOUSE_API_KEYS=              # JSON: [{"board": "company1", "key": "..."}]
LEVER_API_KEYS=                   # JSON: [{"board": "company1", "key": "..."}]
ASHBY_API_KEYS=                   # JSON: [{"org": "org1", "key": "..."}]
WORKDAY_TENANTS=                  # JSON: [{"tenant": "tenant1", "client_id": "...", "client_secret": "..."}]
COMEET_COMPANIES=                 # JSON: [{"uid": "...", "token": "...", "name": "..."}]

# ==========================================
# EMAIL & COMMUNICATIONS
# ==========================================
RESEND_API_KEY=                   # Transactional + marketing email
RESEND_WEBHOOK_SECRET=
SENDGRID_API_KEY=                 # Alternative

# ==========================================
# PUSH NOTIFICATIONS
# ==========================================
ONESIGNAL_APP_ID=
ONESIGNAL_API_KEY=
FIREBASE_SERVER_KEY=              # For FCM
FIREBASE_PROJECT_ID=

# ==========================================
# ANALYTICS & TRACKING
# ==========================================
GA4_MEASUREMENT_ID=G-XXXXXXXXXX
META_PIXEL_ID=                    # Primary pixel
META_PIXEL_SECONDARY_ID=          # Optional secondary
POSTHOG_API_KEY=
POSTHOG_HOST=https://posthog.hireme.pro

# ==========================================
# STORAGE
# ==========================================
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=        # For server-side admin operations
R2_ACCOUNT_ID=                    # Cloudflare R2 (resume PDFs, logos)
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=hireme-assets

# ==========================================
# MONITORING & ERROR TRACKING
# ==========================================
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=

# ==========================================
# WEBHOOKS & INTEGRATIONS
# ==========================================
WEBHOOK_SECRET=                   # For incoming ATS webhooks
CALCOM_API_KEY=                   # Meetup scheduling
MAPTILER_KEY=                     # Maps
SLACK_WEBHOOK_URL=                # Internal notifications
DISCORD_WEBHOOK_URL=              # Job alerts channel

# ==========================================
# SALARY DATA SOURCES
# ==========================================
LEVELSFYI_API_KEY=
GLASSDOOR_API_KEY=
BLIND_API_KEY=
```

---

## 16. HireMe Pro - Database Migration Order (Prisma)

```bash
# 1. Core auth & users
npx prisma migrate dev --name init_auth

# 2. Profile & professional data
npx prisma migrate dev --name init_profile

# 3. Jobs & search (with pgvector extension)
npx prisma migrate dev --name init_jobs

# 4. Applications & tracking
npx prisma migrate dev --name init_applications

# 5. AI features (resume, cover letter, mentor)
npx prisma migrate dev --name init_ai_features

# 6. Community (meetups, notifications)
npx prisma migrate dev --name init_community

# 7. Integrations & sync
npx prisma migrate dev --name init_integrations

# 8. Analytics & webhooks
npx prisma migrate dev --name init_analytics
```

### Required PostgreSQL Extensions (run before migrations)
```sql
-- Run in Supabase SQL editor or init script
CREATE EXTENSION IF NOT EXISTS vector;        -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUID generation
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- Trigram similarity for full-text
CREATE EXTENSION IF NOT EXISTS btree_gin;     -- GIN indexes on jsonb
CREATE EXTENSION IF NOT EXISTS citext;        -- Case-insensitive text
```

---

## 17. HireMe Pro - OAuth App Registration Checklist

### Google Cloud Console
- [ ] Create project: `hireme-pro`
- [ ] OAuth Consent Screen: External, verified, logo, privacy policy, TOS
- [ ] Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/calendar.events`
- [ ] APIs enabled: People API, Gmail API, Calendar API, OAuth2 API
- [ ] Credentials: OAuth 2.0 Client ID (Web + iOS + Android)
- [ ] Authorized redirect URIs: `https://hireme.pro/api/auth/callback/google`, `com.hireme.pro://auth`

### GitHub Developer Settings
- [ ] OAuth App: `HireMe Pro`
- [ ] Homepage: `https://hireme.pro`
- [ ] Callback: `https://hireme.pro/api/auth/callback/github`
- [ ] Scopes: `read:user`, `user:email`, `repo`, `read:org`, `admin:repo_hook`
- [ ] GitHub App (for webhooks): `HireMe Pro Bot`
- [ ] Webhook URL: `https://hireme.pro/api/webhooks/github`
- [ ] Events: `push`, `pull_request`, `issues`, `release`, `workflow_run`
- [ ] Permissions: Metadata (R), Contents (R), Issues (RW), Pull requests (R)

### LinkedIn Developer Portal
- [ ] App: `HireMe Pro`
- [ ] Products: Sign In with LinkedIn, Share on LinkedIn, Marketing Developer Platform
- [ ] Redirect: `https://hireme.pro/api/auth/callback/linkedin`
- [ ] Scopes: `r_liteprofile`, `r_emailaddress`, `w_member_social`, `r_organization_social`
- [ ] Verification: Company website, privacy policy

### Microsoft Entra ID (Azure AD)
- [ ] App Registration: `HireMe Pro`
- [ ] Redirect: `https://hireme.pro/api/auth/callback/azure`
- [ ] Scopes: `openid`, `email`, `profile`, `User.Read`, `Mail.Send`, `Calendars.ReadWrite`
- [ ] Certificates: Upload public cert for client_assertion (optional)
- [ ] API permissions: Microsoft Graph (delegated)

### Apple Developer
- [ ] Service ID: `com.hireme.pro`
- [ ] Domains: `hireme.pro`
- [ ] Redirect: `https://hireme.pro/api/auth/callback/apple`
- [ ] Private Key: Generate `.p8` (AuthKey_XXXXXXXXXX.p8)
- [ ] Key ID + Team ID recorded

---

*End of Session Export - Complete with All 17 Major Steps + 38 Detailed Tasks*
*Generated: 2026-10-03*