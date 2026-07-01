import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENRICHED_PATH = path.resolve(__dirname, "../../data/enriched.json");

// Hard location priority from profile constraints — this overrides whatever the
// resume/profile says the candidate's location is.
export const LOCATION_PRIORITY = ["Chennai", "Coimbatore", "Bengaluru"];
export const SALARY_BAND_LPA = [4, 6]; // weighted toward 4.5L+ in scoring

// enriched.json (targetRoles, skills, basics) → per-source query params.
export function buildQuery(enriched) {
  const roles = (enriched.targetRoles || []).filter(Boolean);
  const role = roles[0] || enriched.basics?.headline || "Full Stack Developer";
  const skills = (enriched.skills || []).filter(Boolean);
  const remoteOk = roles.some((r) => /remote/i.test(r));

  return {
    role,
    roles,
    skills,
    keywords: role,
    locations: LOCATION_PRIORITY, // free aggregators loop this
    primaryLocation: LOCATION_PRIORITY[0], // paid sources use this
    remoteOk,
    country: "in", // Adzuna path segment
    countryCode: "IN", // JSearch/Apify/TheirStack
    salaryBandLpa: SALARY_BAND_LPA,
  };
}
