import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJSON, writeJSONAtomic } from "./jobsStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.resolve(__dirname, "../../data/notionState.json");

// Original spec id — still the first candidate so nothing changes for a
// workspace where it exists and is shared.
const DEFAULT_JOBHUNT_DB = "6e50df73695b4c94a101eb95fa3f8a50";

// EXACT copy of the real 🎯 Job Hunt DB schema, snapshotted from the live
// workspace on 2026-07-02 (databases.retrieve, option ids stripped). If the DB
// ever has to be recreated, it comes back with every column — including the
// manually-curated ones (Contact, Next Action, Follow-up Date) — and the full
// Status workflow with the original colors. Re-snapshot if you change the DB.
export const JOB_HUNT_TITLE = "🎯 Job Hunt";
export const JOB_HUNT_SCHEMA = {
  Company: { title: {} },
  Role: { rich_text: {} },
  Location: { rich_text: {} },
  Salary: { rich_text: {} },
  Growth: { rich_text: {} },
  Score: { number: { format: "number" } },
  Source: { url: {} },
  Status: {
    select: {
      options: [
        { name: "New Lead", color: "pink" },
        { name: "Draft Ready", color: "yellow" },
        { name: "Sent", color: "blue" },
        { name: "Follow-up", color: "orange" },
        { name: "No HR Found", color: "gray" },
        { name: "Bounced", color: "red" },
        { name: "Revival", color: "purple" },
        { name: "Replied", color: "green" },
        { name: "Rejected", color: "red" },
        { name: "Expired", color: "brown" },
      ],
    },
  },
  Verified: {
    select: {
      options: [
        { name: "yes", color: "green" },
        { name: "no", color: "red" },
        { name: "manual", color: "yellow" },
      ],
    },
  },
  VerifiedAt: { date: {} },
  "Follow-up Date": { date: {} },
  "Next Action": { rich_text: {} },
  Contact: { rich_text: {} },
};

// Resolve the Job Hunt database id, creating the database if it doesn't exist.
// This is the ONE way every stage obtains the id. Resolution order:
//   1. NOTION_JOBHUNT_DB env override, then the cached auto-discovered id
//      (data/notionState.json), then the original spec default — first one the
//      token can retrieve wins.
//   2. Search the workspace for a database titled "Job Hunt".
//   3. Create "🎯 Job Hunt" (confirmed schema) under the first accessible page,
//      preferring a workspace-level page.
// Discovered/created ids are cached in data/notionState.json so steps 2–3 run
// at most once. Takes the client as an argument — this module must never import
// the Notion client itself (Notion is touched only by Stage 1 and Stage 4).
export async function ensureJobHuntDb(notion, { statePath = STATE_PATH, log = console.warn } = {}) {
  const state = readJSON(statePath, {});
  const candidates = [process.env.NOTION_JOBHUNT_DB, state.jobHuntDbId, DEFAULT_JOBHUNT_DB];
  for (const id of candidates) {
    if (!id) continue;
    try {
      await notion.databases.retrieve({ database_id: id });
      return id;
    } catch {
      /* not found / not shared — try the next candidate */
    }
  }

  // Not reachable by id — find it by name (e.g. recreated or re-shared under a new id).
  const found = await notion.search({
    query: "Job Hunt",
    filter: { property: "object", value: "database" },
  });
  const hit = found.results.find((r) =>
    (r.title?.[0]?.plain_text || "").toLowerCase().includes("job hunt")
  );
  if (hit) {
    writeJSONAtomic(statePath, { ...state, jobHuntDbId: hit.id, discoveredAt: new Date().toISOString() });
    log(`  [notion] Job Hunt DB found by search → ${hit.id} (cached in data/notionState.json)`);
    return hit.id;
  }

  // Truly absent — create it. An internal integration can only create a database
  // under a page it can access, so pick one (workspace-level pages first).
  const pages = await notion.search({ filter: { property: "object", value: "page" }, page_size: 50 });
  const parent =
    pages.results.find((p) => p.parent?.type === "workspace") ||
    pages.results.find((p) => p.parent?.type === "page_id") ||
    pages.results[0];
  if (!parent) {
    throw new Error(
      "Job Hunt DB not found and no page is shared with the integration to create it under — share a page (e.g. Life HQ) with the integration in Notion."
    );
  }

  const db = await notion.databases.create({
    parent: { type: "page_id", page_id: parent.id },
    title: [{ type: "text", text: { content: JOB_HUNT_TITLE } }], // exact original title, no icon
    properties: JOB_HUNT_SCHEMA,
  });
  writeJSONAtomic(statePath, { ...state, jobHuntDbId: db.id, createdAt: new Date().toISOString() });
  log(`  [notion] Job Hunt DB not found — created "${JOB_HUNT_TITLE}" (${db.id}) under "${parent.id}"`);
  return db.id;
}
