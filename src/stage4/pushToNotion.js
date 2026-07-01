import "dotenv/config";
import { Client } from "@notionhq/client";
import { readJobs, writeJobs } from "../lib/jobsStore.js";
import { createJobRow } from "../stage2/writeToNotion.js";

// Stage 4 — the ONLY recurring path that writes to Notion, and it's manual-trigger
// only (never chained from the cron). Pushes verified, not-yet-pushed leads and
// marks each pushedToNotion:true immediately after its write, so a mid-batch crash
// is safe to resume (already-pushed rows won't be duplicated).

const DB_ID = process.env.NOTION_JOBHUNT_DB || "6e50df73695b4c94a101eb95fa3f8a50";

async function main() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set.");
  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  // Keep "yes" and "manual"; skip "no" (and anything already pushed).
  const pending = readJobs().filter((j) => j.pushedToNotion === false && j.verified !== "no");
  console.log(`• Stage 4: ${pending.length} lead(s) to push (pushedToNotion=false, verified≠"no")`);

  let written = 0;
  let errors = 0;
  for (const entry of pending) {
    try {
      await createJobRow(notion, DB_ID, entry);
      // Persist the pushed flag immediately (re-read to avoid clobbering any
      // concurrent change), then write atomically — crash-safe resume point.
      writeJobs(readJobs().map((j) => (j.id === entry.id ? { ...j, pushedToNotion: true } : j)));
      written++;
      console.log(`  ✓ ${entry.company} — ${entry.title} (${entry.verified})`);
    } catch (e) {
      errors++;
      console.warn(`  ✗ ${entry.company} — ${entry.title}: ${e.message}`);
    }
  }

  const remaining = readJobs().filter((j) => !j.pushedToNotion && j.verified !== "no").length;
  console.log(`✔ Stage 4: wrote ${written}, errors ${errors}, remaining unpushed ${remaining}`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
