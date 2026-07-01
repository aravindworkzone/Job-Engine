import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EnrichedSchema } from "./enrichedSchema.js";
import { buildQuery, ENRICHED_PATH } from "./buildQuery.js";
import { filterAndScore } from "./filterAndScore.js";
import { selectNewJobs } from "./dedupeAgainstNotion.js";
import { toJobEntry, updateJobs, readJobs } from "../lib/jobsStore.js";

import { fetchAdzuna } from "./sources/adzuna.js";
import { fetchJooble } from "./sources/jooble.js";
import { fetchCareerjet } from "./sources/careerjet.js";
import { fetchJSearch } from "./sources/jsearch.js";
import { fetchSerpApi } from "./sources/serpapi.js";
import { fetchApifyAllJobs } from "./sources/apifyAllJobsScraper.js";
import { fetchTheirStack } from "./mcp/theirstackQuery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.resolve(__dirname, "../../stage2.log");
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MIN_SCORE = Number(process.env.STAGE2_MIN_SCORE) || 0;

const log = (line) => {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* logging must never crash the run */
  }
};

// Stage 2 depends on Stage 1's output; refuse to run on missing/stale enriched.json.
function loadFreshEnriched() {
  let stat;
  try {
    stat = fs.statSync(ENRICHED_PATH);
  } catch {
    throw new Error("data/enriched.json not found — run Stage 1 (npm run search) first.");
  }
  if (Date.now() - stat.mtimeMs > MAX_AGE_MS) {
    throw new Error("data/enriched.json is stale (> 3 days) — re-run Stage 1 before sourcing.");
  }
  const data = JSON.parse(fs.readFileSync(ENRICHED_PATH, "utf8"));
  const parsed = EnrichedSchema.safeParse(data);
  return parsed.success ? parsed.data : data; // validate, but don't hard-fail on drift
}

async function main() {
  const enriched = loadFreshEnriched();
  const query = buildQuery(enriched);
  console.log(`• Stage 2: sourcing "${query.role}" in ${query.locations.join(" > ")}`);

  // Assemble sources. Arbeitnow (remote-only) is included only when remote is OK.
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

  // Step 3: run all sources in parallel — one failure must not kill the run.
  const settled = await Promise.allSettled(sources.map(([, fn]) => fn(query)));
  const merged = [];
  const srv = { attempted: sources.length, ok: 0, failed: 0 };
  settled.forEach((r, i) => {
    const name = sources[i][0];
    if (r.status === "fulfilled") {
      srv.ok++;
      const tagged = (r.value || []).map((j) => ({ ...j, source: j.source || name }));
      merged.push(...tagged);
      console.log(`  ✓ ${name}: ${tagged.length} jobs`);
    } else {
      srv.failed++;
      const msg = r.reason?.message ?? String(r.reason);
      console.log(`  ✗ ${name}: ${msg}`);
      log(`source failed: ${name} — ${msg}`);
    }
  });

  // Step 5: hard filter + score (dedupe is by id, below).
  const { kept, stats } = filterAndScore(merged, query, { minScore: MIN_SCORE });

  // Append only genuinely new (unseen id) jobs to data/jobs.json under a lock.
  const sourcedAt = new Date().toISOString();
  let added = 0;
  await updateJobs((jobs) => {
    const fresh = selectNewJobs(kept, jobs, (job) => toJobEntry(job, sourcedAt));
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

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
