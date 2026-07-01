import { httpJSON, normalizeJob } from "./_shared.js";

// Apify multi-platform "All Jobs" scraper — covers Naukri / Foundit / Shine etc.
// in one actor run (replaces separate single-platform actors). Paid (Apify credit),
// so a single query on the primary location.
//
// The actor ID and its input/output field names vary by actor, so:
//   - set APIFY_ALLJOBS_ACTOR_ID to the actor you use,
//   - confirm the field mapping with _validate.js against a real run.
// Field picking below is intentionally defensive across common actor shapes.
export async function fetchApifyAllJobs(query) {
  const token = process.env.APIFY_TOKEN;
  const actorId = process.env.APIFY_ALLJOBS_ACTOR_ID;
  if (!token || !actorId) {
    console.warn("  [apifyAllJobs] skipped: APIFY_TOKEN / APIFY_ALLJOBS_ACTOR_ID not set");
    return [];
  }
  // run-sync-get-dataset-items runs the actor and returns dataset items in one call.
  const url =
    `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}` +
    `/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const input = {
    position: query.keywords,
    location: query.primaryLocation,
    country: query.countryCode,
    maxItems: 50,
  };
  const items = await httpJSON(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const arr = Array.isArray(items) ? items : items.items || [];
  return arr.map((it) =>
    normalizeJob("apifyAllJobs", {
      title: it.title || it.position || it.jobTitle,
      company: it.company || it.companyName || it.employer,
      location: it.location || it.jobLocation || it.city,
      description: it.description || it.jobDescription || it.summary || "",
      url: it.url || it.link || it.jobUrl || it.applyUrl,
      salaryText: it.salary || it.salaryText || null,
      postedAt: it.postedAt || it.postedDate || it.date || null,
      raw: it,
    })
  );
}
