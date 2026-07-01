import { httpJSON, normalizeJob, collectLocations } from "./_shared.js";

// Jooble — free API key, aggregates thousands of boards. Key goes in the URL path.
// Loops the location cascade (free).
export async function fetchJooble(query) {
  const key = process.env.JOOBLE_API_KEY;
  if (!key) {
    console.warn("  [jooble] skipped: JOOBLE_API_KEY not set");
    return [];
  }
  return collectLocations(query.locations, async (loc) => {
    const data = await httpJSON(`https://jooble.org/api/${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: query.keywords, location: loc }),
    });
    return (data.jobs || []).map((j) =>
      normalizeJob("jooble", {
        title: j.title,
        company: j.company,
        location: j.location,
        description: j.snippet,
        url: j.link,
        salaryText: j.salary || null,
        postedAt: j.updated,
        raw: j,
      })
    );
  });
}
