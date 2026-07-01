import { httpJSON, normalizeJob, collectLocations, enc } from "./_shared.js";

// Careerjet — free public search API (rate-limited). Requires an affiliate id.
// Loops the location cascade (free). Backup aggregator; overlaps Jooble/Adzuna.
export async function fetchCareerjet(query) {
  const affid = process.env.CAREERJET_AFFID;
  if (!affid) {
    console.warn("  [careerjet] skipped: CAREERJET_AFFID not set");
    return [];
  }
  return collectLocations(query.locations, async (loc) => {
    const url =
      `http://public.api.careerjet.net/search?locale_code=en_IN` +
      `&keywords=${enc(query.keywords)}&location=${enc(loc)}&affid=${enc(affid)}` +
      `&pagesize=50&sort=date&contenttype=application/json`;
    const data = await httpJSON(url);
    return (data.jobs || []).map((j) =>
      normalizeJob("careerjet", {
        title: j.title,
        company: j.company,
        location: j.locations,
        description: j.description,
        url: j.url,
        salaryText: j.salary || null,
        postedAt: j.date,
        raw: j,
      })
    );
  });
}
