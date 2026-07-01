import { Client } from "@notionhq/client";

// DB IDs discovered from the workspace; override via env if they ever change.
const DB = {
  skillLevels: process.env.NOTION_DB_SKILL_LEVELS ?? null,
  linkedinPosts: process.env.NOTION_DB_LINKEDIN_POSTS ?? null,
  jobHunt: process.env.NOTION_DB_JOB_HUNT ?? null,
};

// Map any Notion property to a plain JS value — so callers get structured data,
// not raw Notion blocks.
function readProperty(prop) {
  switch (prop?.type) {
    case "title":
    case "rich_text":
      return (prop[prop.type] || []).map((t) => t.plain_text).join("").trim() || null;
    case "select":
      return prop.select?.name ?? null;
    case "status":
      return prop.status?.name ?? null;
    case "multi_select":
      return (prop.multi_select || []).map((s) => s.name);
    case "number":
      return prop.number ?? null;
    case "checkbox":
      return !!prop.checkbox;
    case "url":
      return prop.url ?? null;
    case "email":
      return prop.email ?? null;
    case "phone_number":
      return prop.phone_number ?? null;
    case "date":
      return prop.date ? { start: prop.date.start, end: prop.date.end ?? null } : null;
    case "people":
      return (prop.people || []).map((p) => p.name ?? p.id);
    case "files":
      return (prop.files || []).map((f) => f.name);
    case "created_time":
      return prop.created_time ?? null;
    case "last_edited_time":
      return prop.last_edited_time ?? null;
    case "formula":
      return prop.formula?.[prop.formula?.type] ?? null;
    case "rollup":
      return prop.rollup?.type === "array"
        ? (prop.rollup.array || []).map(readProperty)
        : prop.rollup?.[prop.rollup?.type] ?? null;
    default:
      return null;
  }
}

function flatten(page) {
  const out = {};
  for (const [key, prop] of Object.entries(page.properties || {})) {
    out[key] = readProperty(prop);
  }
  return out;
}

async function queryAll(notion, databaseId) {
  const rows = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    rows.push(...res.results.filter((r) => r.object === "page").map(flatten));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return rows;
}

// Query one DB; on failure log and return [] so one bad DB doesn't sink the others.
async function safeQuery(notion, id, label) {
  try {
    return await queryAll(notion, id);
  } catch (err) {
    console.warn(`  [notion] failed to read ${label}: ${err.message}`);
    return [];
  }
}

// Returns { skillLevels, linkedinPosts, jobHunt } or null on total failure.
export async function fetchNotion() {
  try {
    if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
    const notion = new Client({ auth: process.env.NOTION_TOKEN });

    const [skillLevels, linkedinPosts, jobHunt] = await Promise.all([
      safeQuery(notion, DB.skillLevels, "Skill Levels"),
      safeQuery(notion, DB.linkedinPosts, "LinkedIn Posts"),
      safeQuery(notion, DB.jobHunt, "Job Hunt"),
    ]);

    return { skillLevels, linkedinPosts, jobHunt };
  } catch (err) {
    console.warn(`  [notion] ${err.message}`);
    return null;
  }
}
