// Shared Notion row writer for the Job Hunt DB. Stage 2 no longer calls this
// (jobs.json is the source of truth now); Stage 4 reuses it to push verified
// leads. Property mapping follows the confirmed schema:
//   Company (title) · Role/Location/Salary/Growth/Contact/Next Action (text) ·
//   Score (number) · Source (url) · Status (select) · Follow-up Date (date)

import { notionNewLeadStatus, notionFieldDefaults, followupDays } from "../controller/index.js";

const rt = (s) => ({ rich_text: [{ type: "text", text: { content: (s || "").slice(0, 2000) } }] });
const isUrl = (u) => /^https?:\/\//i.test(u || "");
const isoDate = (d) => d.toISOString().slice(0, 10);

// Builds the `properties` object for a Notion page from a jobs.json entry.
// Every working column gets a value: real data when the pipeline has it
// (source salary, Stage 3's resolved careers page in `careerPageUrl`),
// controller fallbacks otherwise — a pushed row is never half-empty.
//
// `allowedProps` (a Set of the live DB's property names) makes the write
// schema-aware: any mapped column the DB no longer has is dropped instead of
// 400-ing the whole page. This self-heals column drift — e.g. the user removing
// Verified/VerifiedAt — so the pipeline never hard-fails on a renamed/deleted
// column. Omit it to get the full mapping (used by tests).
export function entryToProperties(entry, { careerPageUrl = null, now = new Date(), allowedProps = null } = {}) {
  const d = notionFieldDefaults();
  const followup = new Date(now.getTime() + followupDays() * 24 * 60 * 60 * 1000);
  const properties = {
    Company: { title: [{ type: "text", text: { content: (entry.company || "(unknown company)").slice(0, 2000) } }] },
    Role: rt(entry.title),
    Salary: rt(entry.salary || d.salary),
    Growth: rt(entry.growth || d.growth),
    Contact: rt(careerPageUrl ? `Careers page: ${careerPageUrl}` : d.contact),
    "Next Action": rt(d.nextAction),
    "Follow-up Date": { date: { start: isoDate(followup) } },
    Score: { number: typeof entry.score === "number" ? entry.score : null },
    Status: { select: { name: notionNewLeadStatus() } },
  };
  if (entry.location) properties.Location = rt(entry.location);
  if (isUrl(entry.url)) properties.Source = { url: entry.url };
  // Stage 3's verdict (entry.verified/verifiedAt) is NOT mirrored to Notion —
  // the user removed the Verified/VerifiedAt columns on 2026-07-25; the verdict
  // lives in jobs.json and gates the push (isPushable), it isn't a DB column.
  // Drop anything the live DB doesn't actually have (schema drift → no 400).
  if (allowedProps) {
    for (const key of Object.keys(properties)) {
      if (!allowedProps.has(key)) delete properties[key];
    }
  }
  return properties;
}

// Create one Job Hunt row. Throws on failure so the caller can decide (Stage 4
// keeps going and leaves pushedToNotion=false so the entry is retried next run).
export async function createJobRow(notion, databaseId, entry, opts = {}) {
  return notion.pages.create({
    parent: { database_id: databaseId },
    properties: entryToProperties(entry, opts),
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: `Sourced via ${entry.source} · score ${entry.score}` } },
          ],
        },
      },
    ],
  });
}
