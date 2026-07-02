import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EnrichedSchema } from "./enrichedSchema.js";
import { buildQuery, ENRICHED_PATH } from "./buildQuery.js";
import { filterAndScore } from "./filterAndScore.js";
import { selectNewJobs, notionSeenIds } from "./dedupeAgainstNotion.js";
import { toJobEntry, updateJobs, readJobs } from "../lib/jobsStore.js";

import { fetchAdzuna } from "./sources/adzuna.js";
import { fetchJooble } from "./sources/jooble.js";
import { fetchCareerjet } from "./sources/careerjet.js";
import { fetchJSearch } from "./sources/jsearch.js";
import { fetchSerpApi } from "./sources/serpapi.js";
import { fetchApifyAllJobs } from "./sources/apifyAllJobsScraper.js";
import { fetchTheirStack } from "./mcp/theirstackQuery.js";

import {
  stage2MaxAgeMs,
  getMinScore,
  sourceRetries,
  sourceRetryDelayMs,
  SOURCE_ROLES,
} from "../controller/index.js";

import { stageLogger } from "../lib/stageLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = stageLogger("stage2");

const PROFILE_PATH = path.resolve(__dirname, "../../data/profile.json");

// Load the input for buildQuery. buildQuery only reads base-profile fields
// (targetRoles, skills, basics), so Stage 2 can run without Stage 1's dynamic
// enrichment: prefer fresh enriched.json, fall back to stale enriched.json,
// then to profile.json (e.g. on CI where Stage 1 never runs), else fail.
function loadQueryInput() {
  try {
    const stat = fs.statSync(ENRICHED_PATH);
    const data = JSON.parse(fs.readFileSync(ENRICHED_PATH, "utf8"));
    if (Date.now() - stat.mtimeMs <= stage2MaxAgeMs()) {
      const parsed = EnrichedSchema.safeParse(data);
      return parsed.success ? parsed.data : data; // validate, but don't hard-fail on drift
    }
    // Stale enrichment is fine for query building (base fields only) — warn so
    // the user knows to refresh for the stages that DO use dynamic data.
    console.warn("  ! enriched.json is stale — using its base fields; re-run npm run search to refresh.");
    return data;
  } catch {
    /* enriched.json missing — try the base profile */
  }
  try {
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
    console.warn("  ! enriched.json missing — building query from data/profile.json (run npm run search for enrichment).");
    return profile;
  } catch {
    throw new Error("Neither data/enriched.json nor data/profile.json found — run `npm run search` first.");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call one source, retrying transient failures per the controller (SOURCE_RETRIES,
// default 2 → up to 3 attempts). A source that still fails after the retries is
// left for THIS run only — it throws so the caller marks it dead and moves on.
// Exported for tests.
export async function fetchSourceWithRetries(name, fn, query, opts = {}) {
  const retries = opts.retries ?? sourceRetries();
  const delayMs = opts.delayMs ?? sourceRetryDelayMs();
  const attempts = 1 + Math.max(0, retries);
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(query);
    } catch (e) {
      lastErr = e;
      log(`source ${name}: attempt ${attempt}/${attempts} failed — ${e.message}`);
      if (attempt < attempts) {
        console.log(`  ↻ ${name}: attempt ${attempt}/${attempts} failed (${e.message}) — retrying`);
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

// Run every source in parallel (each with its own retry budget). NO source can
// stop the run: dead sources are recorded and skipped, survivors deliver, and
// with zero survivors the pipeline still completes on the existing jobs.json.
// Exported for tests.
export async function runSources(sources, query, opts = {}) {
  const settled = await Promise.allSettled(
    sources.map(([name, fn]) => fetchSourceWithRetries(name, fn, query, opts))
  );
  const merged = [];
  const srv = { attempted: sources.length, ok: 0, failed: 0, dead: [] };
  settled.forEach((r, i) => {
    const name = sources[i][0];
    if (r.status === "fulfilled") {
      srv.ok++;
      const tagged = (r.value || []).map((j) => ({ ...j, source: j.source || name }));
      merged.push(...tagged);
      console.log(`  ✓ ${name}: ${tagged.length} jobs`);
    } else {
      srv.failed++;
      srv.dead.push(name);
      const msg = r.reason?.message ?? String(r.reason);
      console.log(`  ✗ ${name}: dead after retries (${msg}) — skipped this run`);
      log(`source dead: ${name} — ${msg}`);
    }
  });
  return { merged, srv };
}

// Assemble the source list for a query. Arbeitnow (remote-only) joins only when
// the profile targets remote roles. Exported for tests.
export async function assembleSources(query) {
  const sources = [
    ["adzuna", fetchAdzuna],
    ["jooble", fetchJooble],
    ["careerjet", fetchCareerjet],
    ["jsearch", fetchJSearch],
    ["serpapi", fetchSerpApi],
    ["apifyAllJobs", fetchApifyAllJobs],
    ["theirstack", fetchTheirStack],
  ];
  if (query.remoteOk) {
    const { fetchArbeitnow } = await import("./sources/arbeitnow.js");
    sources.push(["arbeitnow", fetchArbeitnow]);
  }
  return sources;
}

// One warning line per dead CRITICAL source (see SOURCE_ROLES in the search
// controller) — the run continues either way. Exported for tests.
export function criticalDeadWarnings(deadNames) {
  return deadNames
    .filter((name) => SOURCE_ROLES[name]?.tier === "critical")
    .map((name) => `CRITICAL source "${name}" is dead this run — ${SOURCE_ROLES[name].impact}`);
}

async function main() {
  const enriched = loadQueryInput();
  const query = buildQuery(enriched);
  console.log(`• Stage 2: sourcing "${query.role}" in ${query.locations.join(" > ")}`);

  const sources = await assembleSources(query);
  const { merged, srv } = await runSources(sources, query);
  for (const warning of criticalDeadWarnings(srv.dead)) {
    console.warn(`  ! ${warning}`);
    log(warning);
  }
  if (srv.ok === 0) {
    console.warn(
      `  ! every source is dead this run — continuing with existing data (jobs.json untouched, ${readJobs().length} entries)`
    );
    log("all sources dead — run completed on existing data");
  }

  // Step 5: hard filter + score (dedupe is by id, below).
  const { kept, stats } = filterAndScore(merged, query, { minScore: getMinScore() });

  // Append only genuinely new (unseen id) jobs to data/jobs.json under a lock.
  // Rows already in the Notion Job Hunt DB (read by Stage 1 into enriched.json)
  // are skipped too — the pipeline-start reset wipes jobs.json, and without this
  // seed those leads would re-enter and be re-pushed to Notion as duplicates.
  const alreadyInNotion = notionSeenIds(enriched);
  const sourcedAt = new Date().toISOString();
  let added = 0;
  await updateJobs((jobs) => {
    const fresh = selectNewJobs(kept, jobs, (job) => toJobEntry(job, sourcedAt), alreadyInNotion);
    added = fresh.length;
    return [...jobs, ...fresh];
  });

  const total = readJobs().length;
  const line =
    `sources ${srv.ok}/${srv.attempted} ok (${srv.failed} failed) | found ${stats.input} | ` +
    `afterHardFilter ${stats.input - stats.hardRejected} | scored ${stats.kept} | ` +
    `newlyAdded ${added} | jobs.json total ${total}`;
  console.log(`✔ Stage 2: ${line}`);
  log(line);
}

// Only run when executed directly — importing this module (tests) must not source.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("❌", err.message);
    process.exit(1);
  });
}
