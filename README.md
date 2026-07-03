# job-search

A multi-stage job-search pipeline. Parses your resume, enriches it with live data (GitHub, Notion, portfolio, web footprint), sources jobs from 7+ backends, verifies them against live career pages, and pushes verified leads to Notion.

## Pipeline

```
resume.pdf → Stage 0 → profile.json → Stage 1 → enriched.json → Stage 2 → jobs.json → Stage 3 → jobs.json (verified) → Stage 4 → Notion
```

All stages are **idempotent and cache-on-disk** — delete the output file to force a re-run.

### Stage 0 — Build Profile
Turns `data/resume.pdf` into a schema-locked `data/profile.json` via a swappable LLM provider (Anthropic Claude or Groq).

### Stage 1 — Enrich Profile
Fetches dynamic data Stage 0 excludes: Notion DBs, GitHub activity, portfolio content, and public web footprint. Runs the fetchers in parallel. The resume profile and the **Notion read are mandatory** (a Notion failure fails the stage); GitHub/portfolio/footprint are **optional** — partial success is fine, and each can be turned off (`STAGE1_GITHUB=off`, `STAGE1_PORTFOLIO=off`, `STAGE1_FOOTPRINT=off`).

### Stage 2 — Source Jobs
Searches 7+ job backends (Adzuna, Jooble, Careerjet, JSearch, SerpApi, Apify, TheirStack, Arbeitnow) in parallel. Hard-filters bonds/night-shifts, soft-scores 0-100, deduplicates by hash ID (company + title — source-independent, so the same role from two aggregators is one entry), and appends new entries to `data/jobs.json`. Query building prefers a fresh `enriched.json` but falls back to a stale one, then to `profile.json`.

### Stage 3 — Verify Jobs
Resolves each company's career page, matches listings against stored entries using Greenhouse/Lever APIs or generic fallback (Tavily). Tags as `yes`/`no`/`manual`. If the career page **cannot be found**, the entry is **left unverified** (`verified: null`) — never removed, never pushed — and its company is retried after the negative cache expires (7 days); meanwhile it doesn't occupy a slot in the per-run company cap.

### Stage 4 — Push to Notion
Pushes verified (`yes`/`manual`) leads to the Notion Job Hunt DB — unverified (`null`) and rejected (`no`) entries are never pushed. Runs at the end of the CI pipeline and via `npm run push-notion`.

**Notion touch policy:** the pipeline touches Notion exactly twice per run — Stage 1 reads (profile enrichment), Stage 4 writes (verified leads). Stages 2–3 never talk to Notion; `npm test` enforces this.

**Notion DB policy (`src/controller/notion.controller.js`):** the 🎯 Job Hunt DB is **mandatory** — every stage resolves it through the controller (env override → cached id → spec default → search by name → auto-create under an accessible page; id cached in `data/notionState.json`), and an unresolvable Job Hunt DB is a hard error. It is the **only** Notion DB the pipeline reads or writes (Skill Levels / LinkedIn Posts were removed — not required for the search); any DB registered as `required: false` is optional by contract and can never stop a stage. The auto-create schema is an **exact snapshot of the real DB** (all 13 columns incl. Contact / Next Action / Follow-up Date, plus the full 10-option Status workflow with original colors) — re-snapshot `JOB_HUNT_SCHEMA` in `src/lib/notionJobHunt.js` if you change the DB's columns.

## Control plane

Everything dynamic is centralized in `src/controller/` and env-overridable — locations (`JOB_LOCATIONS`), salary band (`SALARY_BAND_LPA`), country (`JOB_COUNTRY`), reject keywords (`EXTRA_REJECT_KEYWORDS`), freshness windows, per-run caps, TTLs, timeouts, and the fuzzy-match threshold. See `CLAUDE.md` for the full knob list; stages never hardcode policy.

## Setup

```bash
npm install
cp .env.example .env      # fill in API keys
mkdir -p data             # drop your resume as data/resume.pdf
```

Put your resume at **`data/resume.pdf`**, then configure `.env`.

## Commands

| Command | Runs | Description |
|---------|------|-------------|
| `npm run search` | Stage 0 → 1 | Build profile then enrich |
| `npm run source-jobs` | Stage 2 | Source jobs into `jobs.json` |
| `npm run verify-jobs` | Stage 3 | Verify unverified entries |
| `npm run cron` | Stage 2 → 3 | Chained for CI/CD |
| `npm run push-notion` | Stage 4 | Push verified leads to Notion |
| `npm run profile:rebuild` | Stage 0 | Force-rebuild profile from resume |
| `npm run seed-jobs` | — | Import existing Notion rows into `jobs.json` |
| `npm test` | — | Unit tests + Notion two-touch audit |

## AI Providers (Stage 0)

| `LLM_PROVIDER` | Engine | PDF handling | Default model |
|---|---|---|---|
| `anthropic` (default) | Claude | **Native** — PDF goes straight in | `claude-haiku-4-5` |
| `groq` | Groq (OpenAI-compatible) | **Text-extracted first** | `llama-3.3-70b-versatile` |

Only Claude reads PDFs natively. Groq loses layout and won't work on scanned/image-only PDFs.

## Job Sources (Stage 2)

| Source | Auth | Cost | Loops locations? |
|--------|------|------|-----------------|
| Adzuna | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | Free | Yes |
| Jooble | `JOOBLE_API_KEY` | Free | Yes |
| Careerjet | `CAREERJET_AFFID` | Free | Yes |
| JSearch (RapidAPI) | `JSEARCH_RAPIDAPI_KEY` | Paid | No |
| SerpApi | `SERPAPI_KEY` | Paid | No |
| Apify AllJobs | `APIFY_TOKEN` + `APIFY_ALLJOBS_ACTOR_ID` | Paid | No |
| TheirStack | `THEIRSTACK_API_KEY` | Free (200/mo) | No |
| Arbeitnow | None | Free | Remote only |

## Verification (Stage 3)

Companies verified against live career pages using Greenhouse public API, Lever public API, or generic HTML extraction via Tavily (fallback). Career pages are cached in `data/careerPages.json` — successful resolutions permanently, failed lookups for 7 days (then retried).

## Refreshing

There is **no auto-refresh** — delete the output file to force regeneration:

```bash
npm run profile:rebuild     # force Stage 0
rm data/enriched.json       # force Stage 1 (or wait 3 days)
```

## Layout

```
src/
  searchJob.js            entry point (Stage 0 → 1)
  controller/             control plane — all dynamic knobs (Notion policy, search, pipeline)
  lib/                    shared utilities
  llm/                    LLM provider layer
  profile/                Stage 0 — build profile
  schema/                 zod schemas
  stage1/                 Stage 1 — enrich profile
  stage2/                 Stage 2 — source jobs
    sources/              7+ job backends
    mcp/                  TheirStack integration
  stage3/                 Stage 3 — verify jobs
    ats/                  ATS detectors (Greenhouse, Lever, generic)
  stage4/                 Stage 4 — push to Notion
data/                     runtime data (all gitignored)
.github/workflows/        CI/CD
```
