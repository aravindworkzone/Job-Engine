import "dotenv/config";
import { readJobs, updateJobs } from "../lib/jobsStore.js";
import { resolveCareerPage } from "./resolveCareerPage.js";
import { verifyJob } from "./verifyJob.js";

// Cap companies per run for credit discipline (career-page discovery costs Tavily
// credits). Pending entries beyond the cap are picked up on the next run.
const COMPANIES_PER_RUN = Number(process.env.STAGE3_COMPANIES_PER_RUN) || 10;
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
  console.log("Review data/jobs.json, then run Stage 4 (npm run push-notion) to push verified≠no leads.");
  return c;
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
  const companies = [...byCompany.keys()].slice(0, COMPANIES_PER_RUN);
  console.log(
    `• Stage 3: verifying ${companies.length}/${byCompany.size} companies (cap ${COMPANIES_PER_RUN}), ${pending.length} pending entries`
  );

  for (const ck of companies) {
    const entries = byCompany.get(ck);
    const companyName = entries[0].company;
    const resolved = await resolveCareerPage(companyName); // one resolution per company

    const verdicts = new Map();
    for (const e of entries) {
      verdicts.set(e.id, await verifyJob(e, resolved));
    }
    const verifiedAt = new Date().toISOString();

    // Atomic write-back for this company's entries (crash-safe between companies).
    await updateJobs((all) =>
      all.map((j) =>
        verdicts.has(j.id) ? { ...j, verified: verdicts.get(j.id), verifiedAt } : j
      )
    );

    const via = resolved.atsType || "generic/manual";
    console.log(`  ${companyName} [${via}]: ${entries.map((e) => verdicts.get(e.id)).join(", ")}`);
  }

  summarize(readJobs());
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
