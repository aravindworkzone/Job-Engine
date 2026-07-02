// Pipeline controller — every knob that shapes HOW the stages run: freshness
// windows, per-run caps, cache TTLs, network timeouts, and matching thresholds.
// Stages read these at run time; all are env-overridable without code changes.

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v, fallback) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

// Stage 1: enriched.json is refreshed when older than this. STAGE1_MAX_AGE_DAYS=2
export function stage1MaxAgeMs() {
  return num(process.env.STAGE1_MAX_AGE_DAYS, 2) * DAY_MS;
}

// Stage 1 fetcher toggles. The resume-derived profile (Stage 0's output) and
// the Notion read are MANDATORY — notion is locked on and a failed Notion fetch
// fails the stage. GitHub, portfolio, and public footprint are OPTIONAL:
//   STAGE1_GITHUB=off  STAGE1_PORTFOLIO=off  STAGE1_FOOTPRINT=off
// (accepted off-values: off / false / 0 / no / disabled; anything else = on)
const OFF_VALUES = new Set(["off", "false", "0", "no", "disabled"]);
const onUnlessOff = (v) => !(v !== undefined && OFF_VALUES.has(String(v).trim().toLowerCase()));

export function stage1Fetchers() {
  return {
    notion: true, // mandatory — cannot be turned off
    github: onUnlessOff(process.env.STAGE1_GITHUB),
    portfolio: onUnlessOff(process.env.STAGE1_PORTFOLIO),
    footprint: onUnlessOff(process.env.STAGE1_FOOTPRINT),
  };
}

// Stage 2: prefer enriched.json younger than this before falling back. STAGE2_MAX_AGE_DAYS=3
export function stage2MaxAgeMs() {
  return num(process.env.STAGE2_MAX_AGE_DAYS, 3) * DAY_MS;
}

// Stage 2: a failing source is retried this many times (then left for this run,
// never stopping the pipeline — surviving sources still deliver). SOURCE_RETRIES=2
export function sourceRetries() {
  return num(process.env.SOURCE_RETRIES, 2);
}

// Stage 2: pause between source retry attempts. SOURCE_RETRY_DELAY_MS=1000
export function sourceRetryDelayMs() {
  return num(process.env.SOURCE_RETRY_DELAY_MS, 1000);
}

// Stage 3: companies verified per run (Tavily credit discipline). STAGE3_COMPANIES_PER_RUN=10
export function stage3CompaniesPerRun() {
  return num(process.env.STAGE3_COMPANIES_PER_RUN, 10);
}

// Stage 3: failed career-page lookups are retried after this. CAREERPAGE_NEGATIVE_TTL_DAYS=7
export function careerPageNegativeTtlMs() {
  return num(process.env.CAREERPAGE_NEGATIVE_TTL_DAYS, 7) * DAY_MS;
}

// Per-request abort timeout for all outbound fetches. FETCH_TIMEOUT_MS=15000
export function fetchTimeoutMs() {
  return num(process.env.FETCH_TIMEOUT_MS, 15000);
}

// Apify run-sync calls RUN the actor inside the request (typically 1–5 min;
// Apify hard-caps run-sync at 300s and answers 408 beyond it — a 408 is then
// handled like any dead source: retried, then skipped). APIFY_SYNC_TIMEOUT_MS=300000
export function apifySyncTimeoutMs() {
  return num(process.env.APIFY_SYNC_TIMEOUT_MS, 300000);
}

// Stage 3: Fuse.js fuzzy-match threshold, 0 (exact) → 1 (anything). MATCH_THRESHOLD=0.4
export function matchThreshold() {
  return num(process.env.MATCH_THRESHOLD, 0.4);
}

// Stage 4: the Status a freshly pushed Notion row gets. NOTION_STATUS_NEW="New Lead"
export function notionNewLeadStatus() {
  return process.env.NOTION_STATUS_NEW || "New Lead";
}

// Stage 4: Follow-up Date on a pushed row = push date + this many days.
// NOTION_FOLLOWUP_DAYS=3
export function followupDays() {
  return num(process.env.NOTION_FOLLOWUP_DAYS, 3);
}

// Stage 4: fill values for Job Hunt columns the job sources cannot populate —
// a pushed row must never land with empty working columns. Real data always
// wins (a source-provided salary, a Stage-3-resolved careers page); these are
// the honest fallbacks. Each is env-overridable.
export function notionFieldDefaults() {
  return {
    salary: process.env.NOTION_DEFAULT_SALARY || "Not disclosed",
    growth: process.env.NOTION_DEFAULT_GROWTH || "Growth research pending",
    contact: process.env.NOTION_DEFAULT_CONTACT || "HR contact research pending",
    nextAction:
      process.env.NOTION_DEFAULT_NEXT_ACTION ||
      "Open the Source link, confirm the role is live, find an HR/engineering contact, then apply or DM.",
  };
}

// Pipeline start (npm run search): wipe every *.log and data/*.json so each run
// starts from a clean slate — EXCEPT the protected files below. Only the true
// pipeline entry resets; stage scripts / cron never do (they'd destroy state
// mid-flight). PIPELINE_RESET_ON_START=off disables the wipe.
export function resetOnStart() {
  return onUnlessOff(process.env.PIPELINE_RESET_ON_START);
}

// The append-only run-history file (root). It records the date & time of every
// pipeline run and is NEVER reset, deleted, or rewritten — the only allowed
// operation anywhere in the codebase is appending a line. RUNS_LOG_FILE=runs.log
export function runsLogName() {
  return process.env.RUNS_LOG_FILE || "runs.log";
}

// Files the pipeline-start reset must never touch: the base profile (Stage 0's
// expensive LLM output) and the run-history log. Extra names via
// PIPELINE_RESET_KEEP="a.json,b.log" (comma-separated basenames).
export function resetKeepFiles() {
  const extra = (process.env.PIPELINE_RESET_KEEP || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ["profile.json", runsLogName(), ...extra];
}
