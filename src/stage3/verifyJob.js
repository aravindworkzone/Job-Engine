import { resolveCareerPage } from "./resolveCareerPage.js";
import { greenhouseListings } from "./ats/greenhouseAPI.js";
import { leverListings } from "./ats/leverAPI.js";
import { genericExtract } from "./ats/genericFallback.js";
import { matchRole } from "./matchRole.js";

// Verify one job entry against the company's live career listings.
// Returns "yes" | "no" | "manual". NEVER throws — anything uncertain → "manual".
//   yes    → the role fuzzy-matches a live ATS listing (or appears verbatim on the page)
//   no     → the ATS board loaded but the role is not currently listed (likely expired/fake)
//   manual → couldn't determine (no career page, no ATS, extract failed, error)
//
// `resolved` may be passed in by the orchestrator (resolved once per company) to
// avoid redundant career-page lookups; otherwise it's resolved here.
export async function verifyJob(entry, resolved = null) {
  try {
    const r = resolved || (await resolveCareerPage(entry.company));
    if (!r || !r.url) return "manual"; // no career page found

    if (r.atsType === "greenhouse" && r.token) {
      const titles = (await greenhouseListings(r.token)).map((l) => l.title);
      return matchRole(entry.title, titles).matched ? "yes" : "no";
    }
    if (r.atsType === "lever" && r.leverCompany) {
      const titles = (await leverListings(r.leverCompany)).map((l) => l.title);
      return matchRole(entry.title, titles).matched ? "yes" : "no";
    }

    // No ATS detected → generic fallback: extract page text and look for the title.
    const text = (await genericExtract(r.url)).toLowerCase();
    if (!text) return "manual";
    const title = entry.title.toLowerCase().trim();
    return title && text.includes(title) ? "yes" : "manual";
  } catch {
    return "manual"; // never drop a job over an error — flag it for a human
  }
}
