import {
  getRejectKeywords,
  getLocationWeights,
  getSalaryBandLpa,
  getStackRejectTitle,
  minSkillHits,
  strictLocation,
  SCORING,
} from "../controller/index.js";

// Hard-reject and scoring rules. The keyword lists, location weights, salary
// band, and score weights all come from the search controller
// (src/controller/search.controller.js) — this file only applies them.

const hay = (job) => `${job.title} ${job.company} ${job.description}`.toLowerCase();

// Word-boundary term match. Plain substring matching is wrong for both skills and
// stack names — "git" hits "legitimate", "java" hits "javascript" — which quietly
// inflated skill scores. A boundary is asserted only on the sides where the term
// itself starts/ends with a word character, so ".net" still matches "ASP.NET" and
// "c#" still matches "C# Developer". Compiled once per term.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termCache = new Map();
export function mentions(haystack, term) {
  const t = String(term || "").toLowerCase().trim();
  if (!t) return false;
  let re = termCache.get(t);
  if (!re) {
    const lead = /^[a-z0-9]/.test(t) ? "(?<![a-z0-9])" : "";
    const tail = /[a-z0-9]$/.test(t) ? "(?![a-z0-9])" : "";
    re = new RegExp(`${lead}${escapeRe(t)}${tail}`);
    termCache.set(t, re);
  }
  return re.test(haystack);
}

// True when the job sits in one of the query's locations (aliases included), or
// is remote and the profile targets remote roles. An empty/unknown location can
// never be confirmed in scope, so it counts as out.
export function inConfiguredLocation(job, query) {
  const loc = (job.location || "").toLowerCase();
  const keys = Object.keys(getLocationWeights(query.locations));
  if (keys.some((k) => loc.includes(k))) return true;
  return Boolean(job.remote && query.remoteOk);
}

// Returns a reason for hard-rejecting the job, else null. The reason is always
// "<category>: <detail>" so callers can tally rejects by category without
// re-deriving them. `query` is optional — without it the location and skill
// rules are skipped (keyword and stack rules still apply).
export function hardRejectReason(job, query) {
  const h = hay(job);

  if (query && strictLocation() && !inConfiguredLocation(job, query)) {
    return `location: "${job.location || "unknown"}" outside ${query.locations.join(", ")}`;
  }

  // Off-stack titles. Checked before the keyword lists because it's the most
  // common miss: the sources are searched with stack-agnostic role phrases.
  const title = (job.title || "").toLowerCase();
  const stackHit = getStackRejectTitle().find((s) => mentions(title, s));
  if (stackHit) return `off-stack: title names "${stackHit}"`;

  const { bond, shift, extra } = getRejectKeywords();
  const bondHit = bond.find((k) => h.includes(k));
  if (bondHit) return `bond: "${bondHit}"`;
  const shiftHit = shift.find((k) => h.includes(k));
  if (shiftHit) return `shift: "${shiftHit}"`;
  const extraHit = extra.find((k) => h.includes(k));
  if (extraHit) return `custom: "${extraHit}"`;

  // Real overlap with the profile, not just a matching city and a generic title.
  const skills = (query?.skills || []).filter(Boolean);
  const need = minSkillHits();
  if (need > 0 && skills.length) {
    const hits = skills.filter((s) => mentions(h, s)).length;
    if (hits < need) return `skills: only ${hits} of ${skills.length} matched, need ${need}`;
  }

  return null;
}

// Soft score 0..100: skill overlap + role-in-title + location priority + salary band.
export function scoreJob(job, query) {
  const h = hay(job);
  let score = 0;

  // skill overlap → up to SCORING.skillsMax
  const skills = (query.skills || []).filter(Boolean);
  if (skills.length) {
    const hits = skills.filter((s) => mentions(h, s)).length;
    score += Math.min(SCORING.skillsMax, Math.round((hits / skills.length) * SCORING.skillsMax));
  }

  // role words present in the title → up to SCORING.roleMax. EVERY target role is
  // tried and the best match wins: scoring only query.role (roles[0], here
  // "Full Stack Developer") gave a spot-on "MERN Developer" title zero points
  // while a generic — and off-stack — "Full Stack Developer" title got all 25.
  const titleLc = job.title.toLowerCase();
  const roleList = query.roles?.length ? query.roles : [query.role];
  let bestRoleFraction = 0;
  for (const candidate of roleList) {
    const words = String(candidate || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!words.length) continue;
    const hits = words.filter((w) => titleLc.includes(w)).length;
    bestRoleFraction = Math.max(bestRoleFraction, hits / words.length);
  }
  score += Math.min(SCORING.roleMax, Math.round(bestRoleFraction * SCORING.roleMax));

  // location priority → weights derived from the query's location order
  const loc = job.location.toLowerCase();
  let locPts = 0;
  for (const [k, v] of Object.entries(getLocationWeights(query.locations))) {
    if (loc.includes(k)) locPts = Math.max(locPts, v);
  }
  if (!locPts && job.remote && query.remoteOk) locPts = SCORING.remotePts;
  score += locPts;

  // salary vs. the configured band (only when disclosed): band[0]+0.5 LPA and
  // above earns the full bonus, at least band[0] a partial one, below a penalty.
  if (job.salaryMin) {
    const [okLpa] = query.salaryBandLpa || getSalaryBandLpa();
    const lpa = job.salaryMin / 100000;
    if (lpa >= okLpa + 0.5) score += SCORING.salary.bonusGood;
    else if (lpa >= okLpa) score += SCORING.salary.bonusOk;
    else score -= SCORING.salary.penaltyBelow;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Hard filter → soft score. Dedupe is handled separately (by job id, against
// data/jobs.json — see dedupeAgainstNotion.js), so it is intentionally NOT here.
// Returns { kept (sorted, score attached), stats }.
export function filterAndScore(jobs, query, { minScore = 0 } = {}) {
  // byReason tallies the "<category>:" prefix of every hard reject, so a thin
  // run says WHY it was thin (wrong city vs. wrong stack vs. no skill overlap)
  // instead of just reporting a smaller number.
  const stats = { input: jobs.length, hardRejected: 0, byReason: {}, belowMin: 0, kept: 0 };
  const kept = [];
  for (const job of jobs) {
    const reason = hardRejectReason(job, query);
    if (reason) {
      stats.hardRejected++;
      const category = reason.slice(0, reason.indexOf(":"));
      stats.byReason[category] = (stats.byReason[category] || 0) + 1;
      continue;
    }
    const score = scoreJob(job, query);
    if (score < minScore) {
      stats.belowMin++;
      continue;
    }
    kept.push({ ...job, score });
  }
  kept.sort((a, b) => b.score - a.score);
  stats.kept = kept.length;
  return { kept, stats };
}
