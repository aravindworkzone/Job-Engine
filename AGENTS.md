# job-search

A multi-stage job-search pipeline. Parses a resume PDF, enriches it with dynamic data, sources jobs from multiple backends, verifies them against live career pages, and pushes verified leads to Notion.

## Commands

- `npm install` — install deps (ES modules project, Node 24, `"type": "module"`).
- `npm run search` — runs Stage 0 (build profile) then Stage 1 (enrich profile).
- `npm run profile:rebuild` — force-regenerate `data/profile.json` from `data/resume.pdf`.
- `npm run source-jobs` — Stage 2: source jobs from 7+ backends into `data/jobs.json`.
- `npm run verify-jobs` — Stage 3: verify unverified entries against live career pages.
- `npm run cron` — Stage 2 then Stage 3 (chained for CI/CD).
- `npm run push-notion` — Stage 4: push verified leads to Notion (manual only, never in cron).
- `npm run seed-jobs` — one-time seed: import existing Notion Job Hunt rows into `jobs.json`.

No test suite, linter, or build step. Verify by running the pipeline.

## Architecture

A 4-stage pipeline. Data flows through files under `data/` (all gitignored):

```
resume.pdf → Stage 0 → profile.json → Stage 1 → enriched.json → Stage 2 → jobs.json → Stage 3 → jobs.json (verified) → Stage 4 → Notion
```

All stages are **idempotent and cache-on-disk**: they check whether their output already exists and skip expensive work if so. Delete the output file to force re-run.

### Stage 0 — Build Profile (`src/profile/`, `src/llm/`)
Parses `data/resume.pdf` into a schema-locked `data/profile.json` via a swappable LLM provider layer:
- `anthropic` (default) — Claude reads PDF natively (base64 document block) + structured outputs
- `groq` — OpenAI-compatible, text-extracts PDF first via `pdf-parse`, won't work on scanned PDFs

Both return the same zod-validated shape. Adding an OpenAI-compatible engine = one file in `src/llm/` + one line in `src/llm/index.js`.

### Stage 1 — Enrich Profile (`src/stage1/`, `src/schema/`)
Adds dynamic data Stage 0 deliberately excludes. Runs 4 fetchers in parallel via `Promise.allSettled` (never `Promise.all`):
- `fetchNotion` — queries 3 Notion DBs (Skill Levels, LinkedIn Posts, Job Hunt)
- `fetchGithub` — profile, repos, commit activity (90-day), pinned repos, README highlights
- `fetchPortfolio` — scrapes portfolio URL via cheerio, deduplicates against profile corpus
- `fetchPublicFootprint` — web search via Exa (primary) or Tavily (fallback)

Core invariant: **one failing fetcher must never crash the stage.** Failures are logged to `stage1.log`; partial enrichment is expected.

### Stage 2 — Source Jobs (`src/stage2/`)
Sources jobs from 7+ backends in parallel. Builds query from enriched profile (roles, skills, locations: Chennai > Coimbatore > Bengaluru), hard-filters by bond/night-shift keywords, soft-scores 0-100, deduplicates by hash ID against `jobs.json`, and atomically appends new entries under an advisory dir-based lock.

Sources:
| Source | Auth | Cost | Loop locations? |
|--------|------|------|-----------------|
| Adzuna | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | Free | Yes |
| Jooble | `JOOBLE_API_KEY` | Free | Yes |
| Careerjet | `CAREERJET_AFFID` | Free | Yes |
| JSearch (RapidAPI) | `JSEARCH_RAPIDAPI_KEY` | Paid | No (primary only) |
| SerpApi | `SERPAPI_KEY` | Paid | No (primary only) |
| Apify AllJobs Scraper | `APIFY_TOKEN` + `APIFY_ALLJOBS_ACTOR_ID` | Paid | No |
| TheirStack | `THEIRSTACK_API_KEY` | Free (200/mo) | No |
| Arbeitnow | None (free) | Free | Remote-only; only invoked when `remoteOk: true`; dynamically imported |

### Stage 3 — Verify Jobs (`src/stage3/`)
Reads `jobs.json`, groups unverified entries by company, resolves each company's career page once (cached in `data/careerPages.json`), verifies each listing against live data:
- **Greenhouse**: public board API + fuzzy title match
- **Lever**: public postings API + fuzzy title match  
- **Unknown ATS**: Tavily extract + text inclusion check (fallback)
- Errors → verdict `"manual"` (never throws)

Capped by `STAGE3_COMPANIES_PER_RUN` (default 10) for credit discipline.

### Stage 4 — Push to Notion (`src/stage4/`)
Manual-trigger only. Reads `jobs.json`, finds entries where `pushedToNotion === false` and `verified !== "no"`. Pushes each to Notion via `createJobRow` (reused from Stage 2). Immediately marks `pushedToNotion: true` after successful write (crash-safe resume).

## Schema Discipline

Output shapes are locked with zod:
- `src/profile/schema.js` (`ProfileSchema`) — base schema
- `src/schema/enrichedSchema.js` extends `ProfileSchema` with 4 nullable enrichment sections
- `mergeProfile` validates with `.safeParse`; on mismatch, still writes raw merge with a warning
- Stage 2 and Stage 3 validate input on read

## Non-obvious Constraints

- **Do not add `output_config.effort`** to the Anthropic call — errors on Haiku 4.5.
- **`@notionhq/client` pinned to v2** — v5 breaks `fetchNotion.js`.
- **octokit retry + throttle plugins disabled** in `fetchGithub.js` — fail-fast is intentional.
- **Every network fetcher has an abort timeout** (`FETCH_TIMEOUT_MS`, default 15s).
- **Three Notion DB IDs** baked into `fetchNotion.js` as env-overridable defaults.
- **Arbeitnow is dynamically imported** (`await import()`) only when `remoteOk: true`.
- **Careerjet uses HTTP** (`http://public.api.careerjet.net`), not HTTPS.
- **TheirStack is in `mcp/` dir but is REST** — comment explains MCP tools aren't available in standalone node context.
- **Seed hash collision caveat**: `seedFromNotion.js` uses `source: "notion-seed"`, so a sourced job with same company+title from e.g. Adzuna won't be deduped.
- **CI/CD**: `data/enriched.json` is required (< 3 days old) for Stage 2. CI workflow needs it restored from cache or re-generated.

## Remaining Gaps

- **`data/resume.pdf`** does not exist — pipeline can't run without it.  
  → Place your resume PDF at this path.

## Environment (`.env`)

### Stage 0
| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `groq` |
| `ANTHROPIC_API_KEY` | — | Claude API key |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | Claude model |
| `GROQ_API_KEY` | — | Groq API key |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq endpoint |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model |

### Stage 1
| Variable | Default | Description |
|----------|---------|-------------|
| `NOTION_TOKEN` | — | Notion internal integration token |
| `NOTION_DB_SKILL_LEVELS` | (hardcoded) | Skill Levels DB override |
| `NOTION_DB_LINKEDIN_POSTS` | (hardcoded) | LinkedIn Posts DB override |
| `NOTION_DB_JOB_HUNT` | (hardcoded) | Job Hunt DB override |
| `GITHUB_TOKEN` | — | GitHub PAT (optional, raises rate limit) |
| `GITHUB_USERNAME` | `aravindworkzone` | GitHub username |
| `PORTFOLIO_URL` | `https://aravind-mern.vercel.app` | Portfolio URL |
| `EXA_API_KEY` | — | Exa search API key (primary) |
| `TAVILY_API_KEY` | — | Tavily search API key (fallback) |

### Stage 2
| Variable | Description |
|----------|-------------|
| `ADZUNA_APP_ID` | Adzuna app ID |
| `ADZUNA_APP_KEY` | Adzuna app key |
| `JOOBLE_API_KEY` | Jooble API key |
| `CAREERJET_AFFID` | Careerjet affiliate ID |
| `JSEARCH_RAPIDAPI_KEY` | JSearch RapidAPI key |
| `SERPAPI_KEY` | SerpApi key |
| `APIFY_TOKEN` | Apify token |
| `APIFY_ALLJOBS_ACTOR_ID` | Apify AllJobs actor ID |
| `THEIRSTACK_API_KEY` | TheirStack API key |
| `STAGE2_MIN_SCORE` | Min score threshold (default 0) |
| `NOTION_JOBHUNT_DB` | Job Hunt DB override |

### Stage 3
| Variable | Default | Description |
|----------|---------|-------------|
| `TAVILY_API_KEY` | — | Career page discovery + fallback extraction |
| `STAGE3_COMPANIES_PER_RUN` | 10 | Cap companies verified per run |

### Stage 4
Reuses `NOTION_TOKEN` from Stage 1. Reuses `NOTION_JOBHUNT_DB` from Stage 2.

## Project Layout

```
src/
  searchJob.js            entry point (Stage 0 → 1)
  lib/
    jobsStore.js          central jobs data store (hashId, JSON read/write, advisory lock)
  llm/
    index.js              provider registry
    anthropic.js          Claude — native PDF + structured outputs
    groq.js               Groq — text-extracted PDF + JSON mode
    pdfText.js            PDF → text (for text-only providers)
  profile/
    schema.js             ProfileSchema (zod)
    buildProfile.js       resume.pdf → provider → profile.json
    ensureProfile.js      Stage 0 trigger (missing/empty check)
    rebuild.js            CLI force-refresh
  schema/
    enrichedSchema.js     EnrichedSchema (extends ProfileSchema)
  stage1/
    index.js              orchestrator + cache check
    fetchNotion.js        queries 3 Notion DBs
    fetchGithub.js        GitHub profile, repos, commits, pinned, README
    fetchPortfolio.js     portfolio URL scraper
    fetchPublicFootprint.js  Exa/Tavily web search
    mergeProfile.js       merge + validate + write enriched.json
  stage2/
    orchestrator.js       Stage 2 entry point (sources → jobs.json)
    buildQuery.js         query params from enriched profile
    filterAndScore.js     hard reject + soft score 0-100
    dedupeAgainstNotion.js  dedupe by hash ID against jobs.json
    seedFromNotion.js     one-time seed from Notion Job Hunt DB
    writeToNotion.js      shared Notion row writer (used by Stage 4)
    enrichedSchema.js     re-exports EnrichedSchema
    sources/
      _shared.js          shared helpers (timeout, normalizeJob, httpJSON, collectLocations)
      _validate.js        standalone source validation harness
      adzuna.js
      jooble.js
      careerjet.js
      jsearch.js
      serpapi.js
      apifyAllJobsScraper.js
      arbeitnow.js        remote-only, dynamically imported
    mcp/
      theirstackQuery.js  TheirStack REST API
  stage3/
    orchestrator.js       Stage 3 entry point (verify → jobs.json)
    resolveCareerPage.js  career page resolution + ATS detection (Tavily)
    matchRole.js          fuzzy title matching (Fuse.js)
    verifyJob.js          verify one job against live listings
    ats/
      detectATS.js        Greenhouse/Lever detection from URL/HTML
      greenhouseAPI.js    public Greenhouse board API
      leverAPI.js         public Lever postings API
      genericFallback.js  Tavily extract fallback
  stage4/
    pushToNotion.js       Stage 4 entry point (push verified leads to Notion)
data/
  resume.pdf              your resume (you provide; gitignored)
  profile.json            Stage 0 output (gitignored)
  enriched.json           Stage 1 output (gitignored)
  jobs.json               Stages 2-4 state (gitignored)
  careerPages.json        Stage 3 career page cache (gitignored)
  stage1.log              Stage 1 failure log
  stage2.log              Stage 2 log
.github/workflows/
  source-jobs.yml         CI/CD (Mon/Wed/Fri 04:00 UTC)
```
