import "dotenv/config";
import { pathToFileURL } from "node:url";
import { readJobs, updateJobs, readJSON, CAREER_PAGES_PATH } from "../lib/jobsStore.js";
import { resolveCareerPage, cacheEntryUsable } from "./resolveCareerPage.js";
import { verifyJob } from "./verifyJob.js";
import { stage3CompaniesPerRun } from "../controller/index.js";
import { stageLogger } from "../lib/stageLog.js";

const log = stageLogger("stage3");
const norm = (s) => (s || "").toLowerCase().trim();

function summarize(jobs) {
  const c = { new: 0, yes: 0, no: 0, manual: 0 };
  for (const j of jobs) {
    if (j.verified === null) c.new++;
    else if (j.verified === "yes") c.yes++;
    else if (j.verified === "no") c.no++;
    else if (j.verified === "manual") c.manual++;
  }
  console.log(
    `\nStage 3 summary — new(unverified): ${c.new} | yes: ${c.yes} | no: ${c.no} | manual: ${c.manual}`
  );
  console.log("Review data/jobs.json, then run Stage 4 (npm run push-notion) to push verified yes/manual leads.");
  return c;
}

// Split pending companies into { selected, deferred } for this run.
// A company whose career-page lookup recently failed (fresh negative cache
// entry) is DEFERRED: it cannot be verified until the cache expires, so it must
// not occupy one of the capped slots — its entries simply stay unverified in
// the pipeline. Everything else is eligible, capped at `cap`. Exported for tests.
export function selectCompaniesForRun(companyKeys, cache, cap, now = Date.now()) {
  const deferred = [];
  const eligible = [];
  for (const key of companyKeys) {
    const cached = cache[key];
    if (cached && !cached.url && cacheEntryUsable(cached, now)) deferred.push(key);
    else eligible.push(key);
  }
  return { selected: eligible.slice(0, cap), deferred };
}

async function main() {
  const jobs = readJobs();
  const pending = jobs.filter((j) => j.verified === null);
  if (pending.length === 0) {
    console.log("• Stage 3: nothing to verify.");
    summarize(jobs);
    return;
  }

  // Group pending entries by company so we resolve each career page once and can
  // cap the run by company count.
  const byCompany = new Map();
  for (const j of pending) {
    const k = norm(j.company);
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(j);
  }

  const cap = stage3CompaniesPerRun();
  const cache = readJSON(CAREER_PAGES_PATH, {});
  const { selected, deferred } = selectCompaniesForRun([...byCompany.keys()], cache, cap);
  if (deferred.length) {
    console.log(
      `• Stage 3: ${deferred.length} company(ies) deferred (career page not found recently) — their entries stay unverified until the cache expires.`
    );
  }
  console.log(
    `• Stage 3: verifying ${selected.length}/${byCompany.size} companies (cap ${cap}), ${pending.length} pending entries`
  );

  for (const ck of selected) {
    const entries = byCompany.get(ck);
    const companyName = entries[0].company;
    const resolved = await resolveCareerPage(companyName); // one resolution per company

    const verdicts = new Map();
    for (const e of entries) {
      verdicts.set(e.id, await verifyJob(e, resolved));
    }
    const verifiedAt = new Date().toISOString();

    // Atomic write-back for this company's entries (crash-safe between companies).
    // A null verdict (career page not found) writes NOTHING — the entry stays
    // exactly as it was: unverified, in the pipeline, retried on a later run.
    await updateJobs((all) =>
      all.map((j) => {
        const v = verdicts.get(j.id);
        return v ? { ...j, verified: v, verifiedAt } : j;
      })
    );

    if (!resolved.url) {
      console.log(
        `  ${companyName} [no career page]: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} left unverified — will retry after cache expiry`
      );
      log(`${companyName}: no career page — ${entries.length} entries left unverified`);
    } else {
      const via = resolved.atsType || "generic/manual";
      const line = `${companyName} [${via}]: ${entries.map((e) => verdicts.get(e.id) ?? "unverified").join(", ")}`;
      console.log(`  ${line}`);
      log(line);
    }
  }

  const counts = summarize(readJobs());
  log(
    `run ok — verified ${selected.length} companies | new: ${counts.new} | yes: ${counts.yes} | no: ${counts.no} | manual: ${counts.manual}${deferred.length ? ` | deferred: ${deferred.length}` : ""}`
  );
}

// Only run when executed directly — importing this module (tests) must not verify.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("❌", err.message);
    process.exit(1);
  });
}
