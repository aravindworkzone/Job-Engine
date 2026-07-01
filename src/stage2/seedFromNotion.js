import "dotenv/config";
import { Client } from "@notionhq/client";
import { readJobs, writeJobs, hashId } from "../lib/jobsStore.js";

// ONE-TIME seed. Reads the current Job Hunt DB and records each existing row in
// data/jobs.json as an already-handled entry (pushedToNotion:true, verified:"manual"),
// so the recurring pipeline treats them as done: Stage 2 won't re-add them,
// Stage 3 won't spend credits verifying them, Stage 4 won't re-push them.
//
// Reconciliation: spec'd as "via Notion MCP", but a standalone node run can't call
// this Claude session's MCP tools, so this uses @notionhq/client (same as Stage 1).
//
// ⚠️ Dedup caveat: job id = hash(company + title + source). Existing Notion rows
// have no source-name, so they're seeded with source "notion-seed" and their id
// therefore won't collide with the same job freshly sourced from e.g. adzuna.
// Seeding makes the rows inert (pushed+verified), but does NOT by itself stop a
// future adzuna hit for the same role from being added. If you want the seed to
// block re-sourcing regardless of source, drop `source` from hashId().

const DB_ID = process.env.NOTION_JOBHUNT_DB || "6e50df73695b4c94a101eb95fa3f8a50";

function readText(prop) {
  if (!prop) return "";
  if (prop.type === "title") return (prop.title || []).map((t) => t.plain_text).join("");
  if (prop.type === "rich_text") return (prop.rich_text || []).map((t) => t.plain_text).join("");
  if (prop.type === "url") return prop.url || "";
  return "";
}
const readNumber = (prop) => (prop?.type === "number" ? prop.number : null);

async function main() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set.");
  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  const rows = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const p = page.properties || {};
      rows.push({
        company: readText(p.Company),
        title: readText(p.Role),
        url: readText(p.Source),
        salary: readText(p.Salary) || null,
        score: readNumber(p.Score) ?? 0,
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  const existing = readJobs();
  const existingIds = new Set(existing.map((j) => j.id));
  const now = new Date().toISOString();
  const seeded = [...existing];
  let added = 0;

  for (const r of rows) {
    const id = hashId(r.company, r.title, "notion-seed");
    if (existingIds.has(id)) continue;
    existingIds.add(id);
    seeded.push({
      id,
      title: r.title,
      company: r.company,
      url: r.url || "",
      source: "notion-seed",
      score: r.score,
      salary: r.salary,
      growth: null,
      sourcedAt: now,
      verified: "manual", // already curated by hand — don't re-verify
      verifiedAt: now,
      pushedToNotion: true, // already in Notion — don't re-push
    });
    added++;
  }

  writeJobs(seeded);
  console.log(`Seeded ${added} existing Job Hunt row(s) into data/jobs.json (total ${seeded.length}).`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
