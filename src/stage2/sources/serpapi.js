import { httpJSON, normalizeJob, enc } from "./_shared.js";

// SerpApi (Google Jobs) — fast, high-quality path. Paid (SerpApi credits), so a
// single query on the primary location.
export async function fetchSerpApi(query) {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    console.warn("  [serpapi] skipped: SERPAPI_KEY not set");
    return [];
  }
  const url =
    `https://serpapi.com/search.json?engine=google_jobs` +
    `&q=${enc(`${query.keywords} ${query.primaryLocation}`)}` +
    `&location=India&hl=en&gl=in&api_key=${enc(key)}`;
  const data = await httpJSON(url);
  return (data.jobs_results || []).map((j) =>
    normalizeJob("serpapi", {
      title: j.title,
      company: j.company_name,
      location: j.location,
      description: j.description,
      url: j.apply_options?.[0]?.link || j.share_link,
      salaryText: j.detected_extensions?.salary || null,
      remote: j.detected_extensions?.work_from_home ?? null,
      postedAt: j.detected_extensions?.posted_at || null,
      raw: j,
    })
  );
}
