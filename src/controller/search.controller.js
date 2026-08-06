// Search controller — every knob that shapes WHAT jobs are searched, filtered,
// and scored. Nothing here is hardcoded in the stages: Stage 2 reads this at
// run time, and every value can be overridden via env without touching code.

import { onUnlessOff } from "./pipeline.controller.js";

const csv = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const num = (v, fallback) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

// Location priority, highest first. Override: JOB_LOCATIONS="Pune,Mumbai,Remote"
export function getLocations() {
  const fromEnv = csv(process.env.JOB_LOCATIONS);
  // return fromEnv.length ? fromEnv : ["Chennai", "Coimbatore", "Bengaluru"];
  return fromEnv.length ? fromEnv : ["Tirupur", "Coimbatore", "Chennai", "Remote"];
}

// Alternate spellings that must score the same as the canonical name. Listings
// are matched by substring, so a spelling variant is a total miss without an
// entry here ("tirupur" is NOT a substring of "tiruppur"). Both spellings are
// mapped in each direction so either one may be the configured canonical.
export const LOCATION_ALIASES = {
  tirupur: ["tiruppur"],
  tiruppur: ["tirupur"],
  bengaluru: ["bangalore"],
};

// Scoring weight per location, derived from list position (1st: 25, 2nd: 15,
// 3rd: 10, then decreasing) — so reordering JOB_LOCATIONS reorders the scoring.
export function getLocationWeights(locations = getLocations()) {
  const base = [25, 15, 10];
  const weights = {};
  locations.forEach((loc, i) => {
    const pts = base[i] ?? Math.max(4, 10 - 2 * (i - 2));
    const key = loc.toLowerCase().trim();
    weights[key] = pts;
    for (const alias of LOCATION_ALIASES[key] || []) weights[alias] = pts;
  });
  return weights;
}

// Treat the configured locations as a hard requirement, not just a scoring hint.
// Without this a job's city only affects its score (max SCORING.locationMax), so
// country-wide sources (TheirStack filters by country alone) and the paid
// single-query sources keep landing other cities in jobs.json. Remote roles stay
// in scope when the profile targets remote. Override: STRICT_LOCATION=off
export function strictLocation() {
  return onUnlessOff(process.env.STRICT_LOCATION);
}

// Foreign-stack titles. The role phrases the sources search for are
// stack-agnostic — "Full Stack Developer" matches a Java or .NET listing exactly
// as well as a MERN one — so the stack has to be rejected explicitly. Matched
// against the TITLE only, on word boundaries: a JD that mentions Java in passing
// is not a mismatch, a title that leads with it is, and a title naming both
// ("Java + Angular/React") is still a Java role.
// Extend: EXTRA_STACK_REJECT="scala,rust"   Disable: STACK_REJECT=off
const STACK_REJECT_TITLE = [
  "java",
  ".net",
  "dotnet",
  "c#",
  "php",
  "laravel",
  "python",
  "django",
  "ruby",
  "rails",
  "golang",
  "spring boot",
  "salesforce",
  "sap",
  "abap",
  "wordpress",
  "drupal",
  "magento",
  "sharepoint",
  "servicenow",
  "cobol",
];
export function getStackRejectTitle() {
  if (!onUnlessOff(process.env.STACK_REJECT)) return [];
  return [...STACK_REJECT_TITLE, ...csv(process.env.EXTRA_STACK_REJECT).map((s) => s.toLowerCase())];
}

// A listing must mention at least this many of the profile's skills. Skills only
// ever added score (up to SCORING.skillsMax), so a generic title in the right
// city cleared the filter with zero real overlap. MIN_SKILL_HITS=0 disables;
// raise it to tighten. Override: MIN_SKILL_HITS=3
export function minSkillHits() {
  return num(process.env.MIN_SKILL_HITS, 2);
}

// Target salary band in LPA. Override: SALARY_BAND_LPA="6,10"
export function getSalaryBandLpa() {
  const band = csv(process.env.SALARY_BAND_LPA).map(Number).filter(Number.isFinite);
  return band.length === 2 ? band : [4, 6];
}

// Country for source APIs. Override: JOB_COUNTRY="us"
export function getCountry() {
  return (process.env.JOB_COUNTRY || "in").toLowerCase();
}

// Human-readable country name — some sources (Jooble) only filter correctly
// when the location string carries it ("Chennai, India", not "Chennai").
// Override: JOB_COUNTRY_NAME="United States"
const COUNTRY_NAMES = { in: "India", us: "United States", gb: "United Kingdom", de: "Germany", ca: "Canada", au: "Australia" };
export function getCountryName() {
  return process.env.JOB_COUNTRY_NAME || COUNTRY_NAMES[getCountry()] || getCountry().toUpperCase();
}

// Soft-score weights (sum of maxima = 100 with the salary bonus).
export const SCORING = {
  skillsMax: 40, // skill overlap with the profile
  roleMax: 25, // role words present in the title
  locationMax: 25, // taken from getLocationWeights
  remotePts: 12, // remote counts when the profile targets remote roles
  salary: { bonusGood: 15, bonusOk: 8, penaltyBelow: 10 }, // vs. the salary band
};

// Drop scored jobs below this before storing. Override: STAGE2_MIN_SCORE=30
export function getMinScore() {
  return num(process.env.STAGE2_MIN_SCORE, 0);
}

// Hard-reject blocklists (deal-breakers from the profile constraints).
// Extend at runtime without code changes: EXTRA_REJECT_KEYWORDS="unpaid,commission only"
const BOND_KEYWORDS = [
  "bond",
  "service agreement",
  "service bond",
  "training bond",
  "surety",
  "minimum service period",
  "minimum period of service",
  "penalty if you leave",
  "lock-in period",
  "lock in period",
  "agreement period",
];
const SHIFT_KEYWORDS = [
  "night shift",
  "night-shift",
  "rotational shift",
  "rotating shift",
  "rotational night",
  "us shift",
  "uk shift",
  "graveyard",
  "24/7",
  "24x7",
  "extended shift",
  "12 hour shift",
  "12-hour shift",
  "shift timing",
  "shift timings",
];

export function getRejectKeywords() {
  return {
    bond: BOND_KEYWORDS,
    shift: SHIFT_KEYWORDS,
    extra: csv(process.env.EXTRA_REJECT_KEYWORDS).map((k) => k.toLowerCase()),
  };
}

export const SOURCE_ROLES = {
  jsearch: {
    tier: "critical",
    impact: "quality coverage lost (Google-for-Jobs aggregation) — primary-location results will thin out",
  },
  jooble: {
    tier: "critical",
    impact: "volume + non-primary locations lost — only the primary city is still covered this run",
  },
  adzuna: { tier: "backup", impact: "free breadth + numeric salary data unavailable" },
  careerjet: { tier: "backup", impact: "free breadth reduced" },
  theirstack: { tier: "useful", impact: "tech-stack-matched leads unavailable" },
  serpapi: { tier: "redundant", impact: "overlaps jsearch — no real loss while jsearch is alive" },
  apifyAllJobs: { tier: "situational", impact: "scraper leads unavailable" },
  arbeitnow: { tier: "situational", impact: "remote-only listings unavailable" },
};
