import { httpJSON, normalizeJob } from "./_shared.js";
import { apifySyncTimeoutMs } from "../../controller/index.js";

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
  // Input contract of agentx/all-jobs-scraper (discovered live 2026-07-02 from
  // its validation errors): keyword + location + country (FULL name, e.g.
  // "India") + max_results are all required, snake_case.
  const input = {
    keyword: query.keywords,
    location: query.primaryLocation,
    country: query.countryName || "India",
    max_results: Number(process.env.APIFY_MAX_RESULTS) || 50,
  };
  const items = await httpJSON(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    timeoutMs: apifySyncTimeoutMs(), // the actor runs inside this request
  });
  const arr = Array.isArray(items) ? items : items.items || [];
  // `location` is an OBJECT in this actor's output — flatten its string values.
  const locText = (loc) =>
    typeof loc === "string" ? loc : Object.values(loc || {}).filter((v) => typeof v === "string").join(", ");
  return arr.map((it) =>
    normalizeJob("apifyAllJobs", {
      title: it.title || it.position || it.jobTitle,
      company: it.company_name || it.company || it.companyName || it.employer,
      location: locText(it.location) || it.city || "",
      description: it.description || it.jobDescription || it.summary || "",
      url: it.official_url || it.platform_url || it.url || it.link || it.applyUrl,
      remote: it.is_remote ?? null,
      // numeric salary feeds LPA scoring, which assumes INR — only pass it through
      // when the currency is INR (or undisclosed)
      salaryMin: !it.salary_currency || it.salary_currency === "INR" ? it.salary_minimum ?? null : null,
      salaryMax: !it.salary_currency || it.salary_currency === "INR" ? it.salary_maximum ?? null : null,
      postedAt: it.posted_date || it.postedAt || it.date || null,
      raw: it,
    })
  );
}
