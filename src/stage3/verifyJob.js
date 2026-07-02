import { resolveCareerPage } from "./resolveCareerPage.js";
import { greenhouseListings } from "./ats/greenhouseAPI.js";
import { leverListings } from "./ats/leverAPI.js";
import { genericExtract } from "./ats/genericFallback.js";
import { matchRole } from "./matchRole.js";

// Verify one job entry against the company's live career listings.
// Returns "yes" | "no" | "manual" | null. NEVER throws.
//   yes    → the role fuzzy-matches a live ATS listing (or appears verbatim on the page)
//   no     → the ATS board loaded but the role is not currently listed (likely expired/fake)
//   manual → page was reached but couldn't be judged (no ATS + title absent, extract failed)
//   null   → career page could NOT be found: the entry stays UNVERIFIED and in
//            the pipeline — it is retried on a later run once the negative
//            career-page cache expires. Never dropped, never pushed.
//
// `resolved` may be passed in by the orchestrator (resolved once per company) to
// avoid redundant career-page lookups; otherwise it's resolved here.
// `deps` is injectable for tests — callers use the real implementations.
const DEPS = { greenhouseListings, leverListings, genericExtract, matchRole };

export async function verifyJob(entry, resolved = null, deps = {}) {
  const d = { ...DEPS, ...deps };
  try {
    const r = resolved || (await resolveCareerPage(entry.company));
    if (!r || !r.url) return null; // no career page found — stay unverified, retry later

    if (r.atsType === "greenhouse" && r.token) {
      const titles = (await d.greenhouseListings(r.token)).map((l) => l.title);
      return d.matchRole(entry.title, titles).matched ? "yes" : "no";
    }
    if (r.atsType === "lever" && r.leverCompany) {
      const titles = (await d.leverListings(r.leverCompany)).map((l) => l.title);
      return d.matchRole(entry.title, titles).matched ? "yes" : "no";
    }

    // No ATS detected → generic fallback: extract page text and look for the title.
    const text = (await d.genericExtract(r.url)).toLowerCase();
    if (!text) return "manual";
    const title = entry.title.toLowerCase().trim();
    return title && text.includes(title) ? "yes" : "manual";
  } catch {
    return "manual"; // never drop a job over an error — flag it for a human
  }
}
