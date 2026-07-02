import {
  getRejectKeywords,
  getLocationWeights,
  getSalaryBandLpa,
  SCORING,
} from "../controller/index.js";

// Hard-reject and scoring rules. The keyword lists, location weights, salary
// band, and score weights all come from the search controller
// (src/controller/search.controller.js) — this file only applies them.

const hay = (job) => `${job.title} ${job.company} ${job.description}`.toLowerCase();

// Returns a reason string if the job must be hard-rejected, else null.
export function hardRejectReason(job) {
  const h = hay(job);
  const { bond, shift, extra } = getRejectKeywords();
  const bondHit = bond.find((k) => h.includes(k));
  if (bondHit) return `bond keyword "${bondHit}"`;
  const shiftHit = shift.find((k) => h.includes(k));
  if (shiftHit) return `shift keyword "${shiftHit}"`;
  const extraHit = extra.find((k) => h.includes(k));
  if (extraHit) return `custom keyword "${extraHit}"`;
  return null;
}

// Soft score 0..100: skill overlap + role-in-title + location priority + salary band.
export function scoreJob(job, query) {
  const h = hay(job);
  let score = 0;

  // skill overlap → up to SCORING.skillsMax
  const skills = (query.skills || []).map((s) => s.toLowerCase()).filter(Boolean);
  if (skills.length) {
    const hits = skills.filter((s) => h.includes(s)).length;
    score += Math.min(SCORING.skillsMax, Math.round((hits / skills.length) * SCORING.skillsMax));
  }

  // role words present in the title → up to SCORING.roleMax
  const roleWords = query.role.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (roleWords.length) {
    const titleLc = job.title.toLowerCase();
    const hits = roleWords.filter((w) => titleLc.includes(w)).length;
    score += Math.min(SCORING.roleMax, Math.round((hits / roleWords.length) * SCORING.roleMax));
  }

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
  const stats = { input: jobs.length, hardRejected: 0, belowMin: 0, kept: 0 };
  const kept = [];
  for (const job of jobs) {
    if (hardRejectReason(job)) {
      stats.hardRejected++;
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
