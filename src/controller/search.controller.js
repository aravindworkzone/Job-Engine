// Search controller — every knob that shapes WHAT jobs are searched, filtered,
// and scored. Nothing here is hardcoded in the stages: Stage 2 reads this at
// run time, and every value can be overridden via env without touching code.

const csv = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const num = (v, fallback) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

// Location priority, highest first. Override: JOB_LOCATIONS="Pune,Mumbai,Remote"
export function getLocations() {
  const fromEnv = csv(process.env.JOB_LOCATIONS);
  return fromEnv.length ? fromEnv : ["Chennai", "Coimbatore", "Bengaluru"];
}

// Alternate spellings that must score the same as the canonical name.
export const LOCATION_ALIASES = { bengaluru: ["bangalore"] };

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

// Source importance registry. NO source is mandatory (a dead one is retried,
// then skipped — the run always completes), but they are not equal: when a
// "critical" source dies, the orchestrator warns loudly about what was lost.
//   critical    — the search engine: JSearch (quality: Google-for-Jobs aggregation
//                 of LinkedIn/Indeed/Naukri, but paid quota → ONE query on the
//                 primary location only) + Jooble (volume: thousands of boards,
//                 loops EVERY configured location — it alone covers the
//                 non-primary cities).
//   backup      — free redundancy; Adzuna also has numeric INR salaries that
//                 feed the salary scoring.
//   useful      — niche, high-signal.
//   redundant   — overlaps a critical source; not worth paid credits.
//   situational — only meaningful in specific configs.
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
