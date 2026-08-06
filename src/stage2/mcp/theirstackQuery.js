import { httpJSON, normalizeJob } from "../sources/_shared.js";

// TheirStack — spec'd as an "MCP" source, but a standalone `node orchestrator.js`
// run can't call this Claude session's MCP tools, so this hits TheirStack's REST
// API directly with a Bearer token (same reconciliation as Stage 1's Notion).
// Free tier is ~200 credits/mo, so keep it to one small page. TheirStack is
// company/hiring-signal centric — confirm the mapping with _validate.js.
export async function fetchTheirStack(query) {
  const key = process.env.THEIRSTACK_API_KEY;
  if (!key) {
    console.warn("  [theirstack] skipped: THEIRSTACK_API_KEY not set");
    return [];
  }
  const body = {
    page: 0,
    limit: 25,
    job_title_or: query.roles.length ? query.roles : [query.role],
    job_country_code_or: [query.countryCode],
    posted_at_max_age_days: 30,
  };
  const post = (payload) =>
    httpJSON("https://api.theirstack.com/v1/jobs/search", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  // TheirStack filters by COUNTRY by default, so an unnarrowed query spends the
  // whole page budget on nationwide results that the Stage 2 location filter
  // then throws away. Narrow to the configured cities — but this field was not
  // confirmed against a live response like the output mapping below, so a 4xx
  // rejection falls back to the country-wide query rather than killing the source.
  let data;
  try {
    data = await post({ ...body, job_location_pattern_or: query.locations });
  } catch (e) {
    if (!/HTTP 4\d\d/.test(e.message)) throw e;
    console.warn(`  [theirstack] location filter rejected (${e.message}) — retrying country-wide`);
    data = await post(body);
  }
  const arr = data.data || data.results || [];
  return arr.map((j) =>
    normalizeJob("theirstack", {
      title: j.job_title || j.title,
      company: j.company_name || j.company?.name || j.company,
      location: j.location || j.short_location || j.city || "",
      description: j.description || j.job_description || "",
      url: j.url || j.final_url || j.source_url,
      salaryText: j.salary_string || null, // USD-denominated; kept as text only
      postedAt: j.date_posted || j.posted_at || null,
      raw: j,
    })
  );
}
