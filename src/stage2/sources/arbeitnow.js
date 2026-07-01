import { httpJSON, normalizeJob } from "./_shared.js";

// Arbeitnow — free, no key, remote-only board. Only invoked by the orchestrator
// when targetRoles allow remote. The board is global, so we keep only postings
// whose title/tags match the target role words.
export async function fetchArbeitnow(query) {
  const data = await httpJSON("https://www.arbeitnow.com/api/job-board-api");
  const roleWords = query.role.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return (data.data || [])
    .filter((j) => {
      const hay = `${j.title} ${(j.tags || []).join(" ")}`.toLowerCase();
      return roleWords.some((w) => hay.includes(w));
    })
    .map((j) =>
      normalizeJob("arbeitnow", {
        title: j.title,
        company: j.company_name,
        location: j.location || "Remote",
        description: j.description,
        url: j.url,
        remote: j.remote ?? true,
        postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
        raw: j,
      })
    );
}
