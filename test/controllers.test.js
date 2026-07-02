import test from "node:test";
import assert from "node:assert/strict";

import {
  getLocations,
  getLocationWeights,
  getSalaryBandLpa,
  getCountry,
  getMinScore,
  getRejectKeywords,
  stage1MaxAgeMs,
  stage3CompaniesPerRun,
  matchThreshold,
  notionNewLeadStatus,
} from "../src/controller/index.js";
import { buildQuery } from "../src/stage2/buildQuery.js";
import { hardRejectReason, scoreJob } from "../src/stage2/filterAndScore.js";
import { entryToProperties } from "../src/stage2/writeToNotion.js";

// Every test sets env, asserts the pipeline actually changed behavior, and
// restores env — proving the knobs are dynamic (read at run time, not baked in).
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("controller defaults match the original hardcoded pipeline behavior", () => {
  withEnv(
    {
      JOB_LOCATIONS: undefined, SALARY_BAND_LPA: undefined, JOB_COUNTRY: undefined,
      STAGE2_MIN_SCORE: undefined, STAGE3_COMPANIES_PER_RUN: undefined,
      MATCH_THRESHOLD: undefined, NOTION_STATUS_NEW: undefined, STAGE1_MAX_AGE_DAYS: undefined,
    },
    () => {
      assert.deepEqual(getLocations(), ["Chennai", "Coimbatore", "Bengaluru"]);
      assert.deepEqual(getSalaryBandLpa(), [4, 6]);
      assert.equal(getCountry(), "in");
      assert.equal(buildQuery({ basics: {}, targetRoles: ["Dev"] }).countryName, "India");
      assert.equal(getMinScore(), 0);
      assert.equal(stage3CompaniesPerRun(), 10);
      assert.equal(matchThreshold(), 0.4);
      assert.equal(notionNewLeadStatus(), "New Lead");
      assert.equal(stage1MaxAgeMs(), 2 * 24 * 60 * 60 * 1000);
      // the bengaluru/bangalore alias keeps working
      assert.equal(getLocationWeights().bangalore, getLocationWeights().bengaluru);
    }
  );
});

test("JOB_LOCATIONS dynamically re-steers buildQuery and location scoring", () => {
  withEnv({ JOB_LOCATIONS: "Pune, Mumbai" }, () => {
    const q = buildQuery({ basics: {}, skills: [], targetRoles: ["Dev"] });
    assert.deepEqual(q.locations, ["Pune", "Mumbai"]);
    assert.equal(q.primaryLocation, "Pune");
    // first listed location now carries the top weight
    const w = getLocationWeights(q.locations);
    assert.equal(w.pune, 25);
    assert.equal(w.mumbai, 15);
    // and scoring follows: a Pune job outscores a Chennai one under this config
    const base = { title: "Dev", company: "A", description: "", remote: null, salaryMin: null };
    const pune = scoreJob({ ...base, location: "Pune" }, q);
    const chennai = scoreJob({ ...base, location: "Chennai" }, q);
    assert.ok(pune > chennai, `pune(${pune}) should outscore chennai(${chennai})`);
  });
});

test("SALARY_BAND_LPA and JOB_COUNTRY flow into the query", () => {
  withEnv({ SALARY_BAND_LPA: "8,12", JOB_COUNTRY: "us" }, () => {
    const q = buildQuery({ basics: {}, skills: [], targetRoles: ["Dev"] });
    assert.deepEqual(q.salaryBandLpa, [8, 12]);
    assert.equal(q.country, "us");
    assert.equal(q.countryCode, "US");
    assert.equal(q.countryName, "United States", "country name derived for location strings");
    // salary scoring respects the new band: 9 LPA is now full bonus, 5 LPA a penalty
    const job = (lpa) => ({ title: "Dev", company: "A", description: "", location: "", remote: null, salaryMin: lpa * 100000 });
    assert.ok(scoreJob(job(9), q) > scoreJob(job(5), q));
  });
});

test("EXTRA_REJECT_KEYWORDS adds hard-reject rules without code changes", () => {
  const job = { title: "Dev", company: "A", description: "commission only role" };
  assert.equal(hardRejectReason(job), null, "not rejected by default");
  withEnv({ EXTRA_REJECT_KEYWORDS: "unpaid,commission only" }, () => {
    assert.match(hardRejectReason(job), /custom keyword "commission only"/);
    assert.equal(getRejectKeywords().extra.length, 2);
  });
});

test("NOTION_STATUS_NEW dynamically renames the pushed row status", () => {
  withEnv({ NOTION_STATUS_NEW: "Inbox" }, () => {
    const props = entryToProperties({ company: "Acme", title: "Dev" });
    assert.equal(props.Status.select.name, "Inbox");
  });
});

test("numeric knobs: caps, thresholds, and windows follow env", () => {
  withEnv({ STAGE3_COMPANIES_PER_RUN: "3", MATCH_THRESHOLD: "0.2", STAGE1_MAX_AGE_DAYS: "1", STAGE2_MIN_SCORE: "35" }, () => {
    assert.equal(stage3CompaniesPerRun(), 3);
    assert.equal(matchThreshold(), 0.2);
    assert.equal(stage1MaxAgeMs(), 24 * 60 * 60 * 1000);
    assert.equal(getMinScore(), 35);
  });
});

test("no stage file hardcodes the location list or blocklists anymore", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      return d.isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
    });
  const offenders = walk(SRC).filter((f) => {
    if (f.includes(`${path.sep}controller${path.sep}`)) return false; // the one allowed home
    const src = fs.readFileSync(f, "utf8");
    return /Coimbatore|night shift|training bond/.test(src);
  });
  assert.deepEqual(offenders, [], `hardcoded search policy found in: ${offenders.join(", ")}`);
});
