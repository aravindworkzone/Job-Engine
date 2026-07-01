import { httpJSON, normalizeJob, collectLocations, enc } from "./_shared.js";

// Adzuna — free REST API with India coverage + salary data. Loops the location
// cascade (it's free). Salaries are annual INR.
export async function fetchAdzuna(query) {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) {
    console.warn("  [adzuna] skipped: ADZUNA_APP_ID / ADZUNA_APP_KEY not set");
    return [];
  }
  const salaryMin = Math.round(query.salaryBandLpa[0] * 100000);
  return collectLocations(query.locations, async (loc) => {
    const url =
      `https://api.adzuna.com/v1/api/jobs/${query.country}/search/1` +
      `?app_id=${enc(id)}&app_key=${enc(key)}&results_per_page=50` +
      `&what=${enc(query.keywords)}&where=${enc(loc)}&salary_min=${salaryMin}` +
      `&max_days_old=30&content-type=application/json`;
    const data = await httpJSON(url);
    return (data.results || []).map((r) =>
      normalizeJob("adzuna", {
        title: r.title,
        company: r.company?.display_name,
        location: r.location?.display_name,
        description: r.description,
        url: r.redirect_url,
        salaryMin: r.salary_min,
        salaryMax: r.salary_max,
        postedAt: r.created,
        raw: r,
      })
    );
  });
}
