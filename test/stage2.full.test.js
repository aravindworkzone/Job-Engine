import test from "node:test";
import assert from "node:assert/strict";

import { buildQuery } from "../src/stage2/buildQuery.js";
import { hardRejectReason, scoreJob, filterAndScore } from "../src/stage2/filterAndScore.js";
import { normalizeJob, collectLocations } from "../src/stage2/sources/_shared.js";
import { assembleSources, criticalDeadWarnings } from "../src/stage2/orchestrator.js";
import { SOURCE_ROLES } from "../src/controller/index.js";

const PROFILE = { basics: { headline: "MERN Developer" }, skills: ["react", "node"], targetRoles: [] };
const JOB = (over = {}) => ({
  title: "Dev", company: "Acme", description: "", location: "", remote: null, salaryMin: null, ...over,
});

// ---- query building (Q1–Q3) ---------------------------------------------------

test("Q1: role fallback chain — targetRoles[0] → headline → generic default", () => {
  assert.equal(buildQuery({ basics: {}, skills: [], targetRoles: ["Backend Engineer"] }).role, "Backend Engineer");
  assert.equal(buildQuery(PROFILE).role, "MERN Developer");
  assert.equal(buildQuery({ basics: {}, skills: [], targetRoles: [] }).role, "Full Stack Developer");
});

test("Q2: remoteOk is inferred only from a target role mentioning remote", () => {
  assert.equal(buildQuery({ basics: {}, targetRoles: ["Remote Full Stack Developer"] }).remoteOk, true);
  assert.equal(buildQuery({ basics: {}, targetRoles: ["Full Stack Developer"] }).remoteOk, false);
});

test("Q3: falsy skills/roles are filtered out of the query", () => {
  const q = buildQuery({ basics: {}, skills: ["react", "", null], targetRoles: ["Dev", ""] });
  assert.deepEqual(q.skills, ["react"]);
  assert.deepEqual(q.roles, ["Dev"]);
});

// ---- scoring components (S1–S6) -------------------------------------------------

const QUERY = buildQuery({ basics: {}, skills: ["react", "node"], targetRoles: ["React Developer"] });

test("S1: full skill overlap earns the full skills weight (40)", () => {
  const all = scoreJob(JOB({ description: "react and node work", location: "nowhere" }), QUERY);
  const half = scoreJob(JOB({ description: "react only", location: "nowhere" }), QUERY);
  const none = scoreJob(JOB({ description: "java spring", location: "nowhere" }), QUERY);
  assert.equal(all - none, 40, "2/2 skills = full 40-point weight");
  assert.equal(half - none, 20, "1/2 skills = half the weight");
  assert.ok(all > half && half > none);
});

test("S2: exact role words in the title earn the full role weight (25)", () => {
  const exact = scoreJob(JOB({ title: "React Developer", location: "nowhere" }), QUERY);
  const partial = scoreJob(JOB({ title: "React Intern", location: "nowhere" }), QUERY);
  assert.equal(exact - partial, 12, "1/2 role words = 13 of 25 → 12 point gap");
});

test("S3: location weights follow priority order, with the bangalore alias", () => {
  const at = (location) => scoreJob(JOB({ location, title: "x" }), QUERY);
  assert.equal(at("Chennai, TN") - at("nowhere"), 25);
  assert.equal(at("Coimbatore") - at("nowhere"), 15);
  assert.equal(at("Bengaluru") - at("nowhere"), 10);
  assert.equal(at("Bangalore"), at("Bengaluru"), "alias must score identically");
});

test("S4: remote earns 12 only when the profile wants remote", () => {
  const remoteQ = { ...QUERY, remoteOk: true };
  const job = JOB({ remote: true, location: "anywhere", title: "x" });
  assert.equal(scoreJob(job, remoteQ) - scoreJob(JOB({ location: "anywhere", title: "x" }), remoteQ), 12);
  assert.equal(scoreJob(job, { ...QUERY, remoteOk: false }), scoreJob(JOB({ location: "anywhere", title: "x" }), QUERY));
});

test("S5: salary vs band — +15 at band+0.5, +8 at band, −10 below, 0 undisclosed", () => {
  // give the job a positive baseline (one skill hit = 20) so the −10 penalty
  // is visible under the 0-clamp
  const withSalary = (over) => JOB({ title: "x", location: "z", description: "react work", ...over });
  const base = scoreJob(withSalary({}), QUERY); // no salary disclosed
  assert.equal(base, 20);
  const at = (lpa) => scoreJob(withSalary({ salaryMin: lpa * 100000 }), QUERY);
  assert.equal(at(4.5) - base, 15);
  assert.equal(at(4) - base, 8);
  assert.equal(at(3) - base, -10, "penalty below band");
});

test("S6: score is clamped to 0..100", () => {
  assert.equal(scoreJob(JOB({ title: "x", location: "z", salaryMin: 100000 }), QUERY), 0, "never negative");
  const maxed = scoreJob(
    JOB({ title: "React Developer", description: "react node", location: "Chennai", salaryMin: 500000 }),
    QUERY
  );
  assert.ok(maxed <= 100);
});

// ---- filtering mechanics (FL1–FL3) ----------------------------------------------

test("FL1: hard-reject scans title + company + description, case-insensitive", () => {
  assert.match(hardRejectReason(JOB({ title: "Dev (NIGHT SHIFT)" })), /shift/);
  assert.match(hardRejectReason(JOB({ company: "Bond Technologies" })), /bond/);
  assert.match(hardRejectReason(JOB({ description: "2-year Training Bond applies" })), /bond/);
  assert.equal(hardRejectReason(JOB({ description: "day shift only... nope, clean role" })), null);
});

test("FL2: minScore drops low scorers and counts them in stats", () => {
  const jobs = [
    JOB({ title: "React Developer", description: "react node", location: "Chennai" }), // high
    JOB({ title: "Peon", company: "X", location: "nowhere" }), // ~0
  ];
  const { kept, stats } = filterAndScore(jobs, QUERY, { minScore: 50 });
  assert.equal(kept.length, 1);
  assert.deepEqual([stats.input, stats.belowMin, stats.kept], [2, 1, 1]);
});

test("FL3: kept jobs are sorted by score, highest first", () => {
  const jobs = [
    JOB({ title: "Peon", location: "Bengaluru" }),
    JOB({ title: "React Developer", description: "react node", location: "Chennai" }),
  ];
  const { kept } = filterAndScore(jobs, QUERY);
  assert.ok(kept[0].score >= kept[1].score);
  assert.equal(kept[0].title, "React Developer");
});

// ---- normalization & location cascade (N1–N2) -----------------------------------

test("N1: normalizeJob trims fields and formats a salary range in lakhs", () => {
  const j = normalizeJob("test", {
    title: "  Dev ", company: " Acme ", location: " Chennai ",
    salaryMin: 400000, salaryMax: 600000,
  });
  assert.equal(j.title, "Dev");
  assert.equal(j.company, "Acme");
  assert.equal(j.salaryText, "₹4.0L–₹6.0L");
  assert.equal(normalizeJob("test", { salaryMin: 400000 }).salaryText, "₹4.0L+");
  assert.equal(normalizeJob("test", {}).salaryText, null);
  assert.equal(normalizeJob("test", {}).postedAt, null);
});

test("N2: collectLocations keeps partial results; total wipeout throws", async () => {
  const jobs = await collectLocations(["a", "b", "c"], async (loc) => {
    if (loc === "b") throw new Error("boom");
    return [{ loc }];
  });
  assert.equal(jobs.length, 2, "one bad location must not lose the others");
  await assert.rejects(
    () => collectLocations(["a", "b"], async () => { throw new Error("all down"); }),
    /all down/
  );
});

// ---- source registry wiring (R1–R2) ----------------------------------------------

test("R1: every assembled source has a SOURCE_ROLES entry; arbeitnow is remote-gated", async () => {
  const normal = (await assembleSources({ remoteOk: false })).map(([n]) => n);
  const remote = (await assembleSources({ remoteOk: true })).map(([n]) => n);
  assert.equal(normal.includes("arbeitnow"), false);
  assert.equal(remote.includes("arbeitnow"), true);
  for (const name of remote) {
    assert.ok(SOURCE_ROLES[name], `source "${name}" missing from SOURCE_ROLES registry`);
  }
  assert.deepEqual(
    Object.entries(SOURCE_ROLES).filter(([, r]) => r.tier === "critical").map(([n]) => n).sort(),
    ["jooble", "jsearch"],
    "exactly JSearch + Jooble are critical"
  );
});

test("R2: dead critical sources produce warnings; others stay quiet", () => {
  const warnings = criticalDeadWarnings(["jooble", "serpapi", "adzuna"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CRITICAL source "jooble".*non-primary locations/);
  assert.deepEqual(criticalDeadWarnings([]), []);
  assert.deepEqual(criticalDeadWarnings(["careerjet"]), []);
});
