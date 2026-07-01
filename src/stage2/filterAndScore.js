// Hard-reject blocklists (from profile constraints). Scanned against title +
// company + JD text. These are deal-breakers — a match drops the listing outright.
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

const hay = (job) => `${job.title} ${job.company} ${job.description}`.toLowerCase();

// Returns a reason string if the job must be hard-rejected, else null.
export function hardRejectReason(job) {
  const h = hay(job);
  const bond = BOND_KEYWORDS.find((k) => h.includes(k));
  if (bond) return `bond keyword "${bond}"`;
  const shift = SHIFT_KEYWORDS.find((k) => h.includes(k));
  if (shift) return `shift keyword "${shift}"`;
  return null;
}

// Location priority weights (Chennai > Coimbatore > Bengaluru).
const LOCATION_WEIGHT = { chennai: 25, coimbatore: 15, bengaluru: 10, bangalore: 10 };

// Soft score 0..100: skill overlap + role-in-title + location priority + salary band.
export function scoreJob(job, query) {
  const h = hay(job);
  let score = 0;

  // skill overlap → up to 40
  const skills = (query.skills || []).map((s) => s.toLowerCase()).filter(Boolean);
  if (skills.length) {
    const hits = skills.filter((s) => h.includes(s)).length;
    score += Math.min(40, Math.round((hits / skills.length) * 40));
  }

  // role words present in the title → up to 25
  const roleWords = query.role.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (roleWords.length) {
    const titleLc = job.title.toLowerCase();
    const hits = roleWords.filter((w) => titleLc.includes(w)).length;
    score += Math.min(25, Math.round((hits / roleWords.length) * 25));
  }

  // location priority → up to 25 (remote counts if remote is acceptable)
  const loc = job.location.toLowerCase();
  let locPts = 0;
  for (const [k, v] of Object.entries(LOCATION_WEIGHT)) {
    if (loc.includes(k)) locPts = Math.max(locPts, v);
  }
  if (!locPts && job.remote && query.remoteOk) locPts = 12;
  score += locPts;

  // salary band → +15 for 4.5L+, +8 for 4–4.5L, −10 below 4L (only when disclosed)
  if (job.salaryMin) {
    const lpa = job.salaryMin / 100000;
    if (lpa >= 4.5) score += 15;
    else if (lpa >= 4) score += 8;
    else score -= 10;
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
