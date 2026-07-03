import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLocations, getSalaryBandLpa, getCountry, getCountryName } from "../controller/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENRICHED_PATH = path.resolve(__dirname, "../../data/enriched.json");

// enriched.json (targetRoles, skills, basics) → per-source query params.
// Locations, salary band, and country come from the search controller
// (src/controller/search.controller.js) — env-overridable, never hardcoded here.
export function buildQuery(enriched) {
  const roles = (enriched.targetRoles || []).filter(Boolean);
  const role = roles[0] || enriched.basics?.headline || "Full Stack Developer";
  const skills = (enriched.skills || []).filter(Boolean);
  const remoteOk = roles.some((r) => /remote/i.test(r));
  const locations = getLocations();
  const country = getCountry();

  return {
    role,
    roles,
    skills,
    keywords: role,
    locations, // free aggregators loop this (priority order)
    primaryLocation: locations[0], // paid sources use this
    remoteOk,
    country, // Adzuna path segment
    countryCode: country.toUpperCase(), // JSearch/Apify/TheirStack
    countryName: getCountryName(), // Jooble location suffix ("Chennai, India")
    salaryBandLpa: getSalaryBandLpa(),
  };
}
