import "dotenv/config";
import { ensureProfile } from "./profile/ensureProfile.js";
import { runStage1 } from "./stage1/index.js";
import { resetOnStart } from "./controller/index.js";
import { resetPipelineFiles, logPipelineRun } from "./lib/pipelineReset.js";

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function main() {
  // Pipeline start: clean slate — wipe all logs and data JSONs except the
  // protected files (profile.json + runs.log; see resetKeepFiles in the
  // controller). PIPELINE_RESET_ON_START=off skips this.
  if (resetOnStart()) {
    const removed = resetPipelineFiles();
    console.log(
      `• Pipeline start: fresh run — cleared ${removed.length} file(s)${removed.length ? ` (${removed.join(", ")})` : ""}; kept profile.json + runs.log`
    );
  }
  logPipelineRun("pipeline run started");

  // Stage 0: guarantee we have a base profile (generates it from resume.pdf if missing).
  const profile = await ensureProfile();

  // Stage 1: enrich the profile with dynamic data Stage 0 deliberately excluded
  // (Notion DBs, GitHub activity, portfolio, public footprint). Never crashes the
  // pipeline — partial enrichment is fine.
  const enriched = await runStage1(profile);

  // Stages 2-4 are run via separate scripts:
  //   npm run source-jobs   (Stage 2 — sources jobs into data/jobs.json)
  //   npm run verify-jobs   (Stage 3 — verifies entries against live career pages)
  //   npm run push-notion   (Stage 4 — pushes verified leads to Notion)
  const roles = profile.targetRoles?.length ? profile.targetRoles.join(", ") : "(none inferred)";
  console.log(`\nProfile ready. Target roles: ${roles}`);
  if (enriched) {
    const sources = ["notionData", "githubActivity", "portfolioExtras", "publicFootprint"].filter(
      (k) => enriched[k]
    );
    console.log(`Enriched sources: ${sources.length ? sources.join(", ") : "(none succeeded)"}`);
  }
  console.log("Next: npm run source-jobs (Stage 2) → npm run verify-jobs (Stage 3) → npm run push-notion (Stage 4)");
  logPipelineRun(`pipeline run finished in ${elapsed()}`);
}

main().catch((err) => {
  logPipelineRun(`pipeline run FAILED after ${elapsed()} — ${err.message}`);
  console.error("❌", err.message);
  process.exit(1);
});
