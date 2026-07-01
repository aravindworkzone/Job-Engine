// Shared Notion row writer for the Job Hunt DB. Stage 2 no longer calls this
// (jobs.json is the source of truth now); Stage 4 reuses it to push verified
// leads. Property mapping follows the confirmed schema:
//   Company (title) · Role/Location/Salary/Growth (text) · Score (number) ·
//   Source (url) · Status (select) · Verified (select) · VerifiedAt (date)

const rt = (s) => ({ rich_text: [{ type: "text", text: { content: (s || "").slice(0, 2000) } }] });
const isUrl = (u) => /^https?:\/\//i.test(u || "");

// Builds the `properties` object for a Notion page from a jobs.json entry.
export function entryToProperties(entry) {
  const properties = {
    Company: { title: [{ type: "text", text: { content: (entry.company || "(unknown company)").slice(0, 2000) } }] },
    Role: rt(entry.title),
    Salary: rt(entry.salary || ""),
    Score: { number: typeof entry.score === "number" ? entry.score : null },
    Status: { select: { name: "New Lead" } },
  };
  if (isUrl(entry.url)) properties.Source = { url: entry.url };
  if (entry.growth) properties.Growth = rt(entry.growth);
  // Verified is a select of yes/no/manual; only set when Stage 3 tagged it.
  if (entry.verified) properties.Verified = { select: { name: entry.verified } };
  if (entry.verifiedAt) properties.VerifiedAt = { date: { start: entry.verifiedAt } };
  return properties;
}

// Create one Job Hunt row. Throws on failure so the caller can decide (Stage 4
// keeps going and leaves pushedToNotion=false so the entry is retried next run).
export async function createJobRow(notion, databaseId, entry) {
  return notion.pages.create({
    parent: { database_id: databaseId },
    properties: entryToProperties(entry),
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
