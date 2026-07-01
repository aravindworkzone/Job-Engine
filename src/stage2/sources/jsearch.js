import { httpJSON, normalizeJob, enc } from "./_shared.js";

// JSearch (RapidAPI) — broad coverage aggregating Google-for-Jobs sources. Paid
// (RapidAPI quota), so a single query on the primary location. Salary fields are
// best-effort and their period varies — treated as approximate downstream.
export async function fetchJSearch(query) {
  const key = process.env.JSEARCH_RAPIDAPI_KEY;
  if (!key) {
    console.warn("  [jsearch] skipped: JSEARCH_RAPIDAPI_KEY not set");
    return [];
  }
  const q = `${query.keywords} in ${query.primaryLocation}, India`;
  const url =
    `https://jsearch.p.rapidapi.com/search?query=${enc(q)}` +
    `&page=1&num_pages=1&country=in&date_posted=month`;
  const data = await httpJSON(url, {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": "jsearch.p.rapidapi.com" },
  });
  return (data.data || []).map((j) =>
    normalizeJob("jsearch", {
      title: j.job_title,
      company: j.employer_name,
      location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "),
      description: j.job_description,
      url: j.job_apply_link,
      salaryMin: j.job_min_salary,
      salaryMax: j.job_max_salary,
      remote: j.job_is_remote ?? null,
      postedAt: j.job_posted_at_datetime_utc,
      raw: j,
    })
  );
}
