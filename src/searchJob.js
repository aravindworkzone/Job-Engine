import "dotenv/config";
import { ensureProfile } from "./profile/ensureProfile.js";
import { runStage1 } from "./stage1/index.js";

async function main() {
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
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
