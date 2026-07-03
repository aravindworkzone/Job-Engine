import "dotenv/config";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { readJobs, updateJobs, readJSON, CAREER_PAGES_PATH } from "../lib/jobsStore.js";
import { resolveNotionDb } from "../controller/index.js";
import { createJobRow } from "../stage2/writeToNotion.js";
import { stageLogger } from "../lib/stageLog.js";

const log = stageLogger("stage4");

// Stage 4 — the ONLY recurring path that writes to Notion, and it's manual-trigger
// only (never chained from the cron). Pushes verified, not-yet-pushed leads and
// marks each pushedToNotion:true immediately after its write, so a mid-batch crash
// is safe to resume (already-pushed rows won't be duplicated).

// Only Stage-3-approved leads are pushable: verified must be exactly "yes" or
// "manual". Unverified (null) entries are NOT pushed — Stage 3 caps companies
// per run, so unverified entries are normal and must wait for verification.
export const isPushable = (j) =>
  j.pushedToNotion === false && (j.verified === "yes" || j.verified === "manual");

async function main() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set.");
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  // Job Hunt is mandatory (controller/notion.controller.js) — resolved or auto-created;
  // an unresolvable DB is a hard error, Stage 4 cannot run without its target.
  const DB_ID = await resolveNotionDb(notion, "jobHunt");

  const jobs = readJobs();
  const pending = jobs.filter(isPushable);
  const unverified = jobs.filter((j) => j.verified === null).length;
  console.log(`• Stage 4: ${pending.length} verified lead(s) to push (verified yes/manual, not yet pushed)`);
  if (unverified) {
    console.log(`  (${unverified} unverified entr${unverified === 1 ? "y" : "ies"} skipped — run npm run verify-jobs)`);
  }

  // Stage 3's resolved careers pages become the Contact starting point — the
  // best contact lead the pipeline has without a human in the loop.
  const careerPages = readJSON(CAREER_PAGES_PATH, {});
  const careerUrlFor = (company) => careerPages[(company || "").toLowerCase().trim()]?.url || null;

  let written = 0;
  let errors = 0;
  for (const entry of pending) {
    try {
      await createJobRow(notion, DB_ID, entry, { careerPageUrl: careerUrlFor(entry.company) });
      // Persist the pushed flag immediately under the jobs.json lock (same lock
      // Stages 2/3 use), so a concurrent cron run can't be clobbered — crash-safe
      // resume point.
      await updateJobs((all) =>
        all.map((j) => (j.id === entry.id ? { ...j, pushedToNotion: true } : j))
      );
      written++;
      console.log(`  ✓ ${entry.company} — ${entry.title} (${entry.verified})`);
      log(`pushed: ${entry.company} — ${entry.title} (${entry.verified})`);
    } catch (e) {
      errors++;
      console.warn(`  ✗ ${entry.company} — ${entry.title}: ${e.message}`);
      log(`push failed: ${entry.company} — ${entry.title} — ${e.message}`);
    }
  }

  const remaining = readJobs().filter(isPushable).length;
  console.log(`✔ Stage 4: wrote ${written}, errors ${errors}, remaining unpushed ${remaining}`);
  log(`run ok — wrote ${written}, errors ${errors}, remaining unpushed ${remaining}`);
}

// Only run when executed directly (node src/stage4/pushToNotion.js) — importing
// this module (e.g. from tests) must not trigger a push.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("❌", err.message);
    process.exit(1);
  });
}
