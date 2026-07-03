import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashId, toJobEntry } from "../src/lib/jobsStore.js";
import { selectNewJobs } from "../src/stage2/dedupeAgainstNotion.js";
import { entryToProperties } from "../src/stage2/writeToNotion.js";
import { isPushable } from "../src/stage4/pushToNotion.js";
import { cacheEntryUsable, pickCareersUrl } from "../src/stage3/resolveCareerPage.js";
import { normalizeJob } from "../src/stage2/sources/_shared.js";
import { filterAndScore } from "../src/stage2/filterAndScore.js";
import { buildQuery } from "../src/stage2/buildQuery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../src");

// ---- job identity & dedupe -------------------------------------------------

test("hashId is source-independent and normalizes case/whitespace", () => {
  assert.equal(hashId("Acme Corp", "MERN Developer"), hashId("  acme corp ", "mern developer"));
  assert.notEqual(hashId("Acme", "Dev"), hashId("Acm", "eDev")); // separator prevents collisions
});

test("selectNewJobs collapses the same job arriving from two sources", () => {
  const a = { company: "Acme", title: "MERN Developer", source: "adzuna" };
  const b = { company: "acme", title: "MERN Developer", source: "jooble" };
  const fresh = selectNewJobs([a, b], [], (j) => toJobEntry(j, "2026-07-02T00:00:00Z"));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].source, "adzuna"); // first occurrence wins
});

test("selectNewJobs: a seeded Notion row blocks re-sourcing the same role from any source", () => {
  const seeded = toJobEntry(
    { company: "Acme", title: "MERN Developer", source: "notion-seed" },
    "2026-07-01T00:00:00Z"
  );
  const candidate = { company: "Acme", title: "MERN Developer", source: "adzuna" };
  const fresh = selectNewJobs([candidate], [seeded], (j) => toJobEntry(j));
  assert.equal(fresh.length, 0);
});

test("toJobEntry carries location and postedAt into jobs.json", () => {
  const entry = toJobEntry({
    company: "Acme",
    title: "Dev",
    source: "jooble",
    location: "Chennai",
    postedAt: "2026-06-30",
    url: "https://x.example/j/1",
    salaryText: "₹4.0L–₹6.0L",
  });
  assert.equal(entry.location, "Chennai");
  assert.equal(entry.postedAt, "2026-06-30");
  assert.equal(entry.verified, null);
  assert.equal(entry.pushedToNotion, false);
});

// ---- Stage 4 push filter -----------------------------------------------------

test("isPushable: only verified yes/manual and not-yet-pushed entries", () => {
  const base = { pushedToNotion: false };
  assert.equal(isPushable({ ...base, verified: "yes" }), true);
  assert.equal(isPushable({ ...base, verified: "manual" }), true);
  assert.equal(isPushable({ ...base, verified: "no" }), false);
  assert.equal(isPushable({ ...base, verified: null }), false, "unverified must NOT be pushed");
  assert.equal(isPushable({ verified: "yes", pushedToNotion: true }), false);
});

// ---- Notion row mapping ------------------------------------------------------

test("entryToProperties maps Location and Verified when present", () => {
  const props = entryToProperties({
    company: "Acme",
    title: "Dev",
    location: "Chennai",
    salary: "₹5L",
    score: 70,
    url: "https://x.example/j/1",
    verified: "yes",
    verifiedAt: "2026-07-02T00:00:00Z",
  });
  assert.equal(props.Location.rich_text[0].text.content, "Chennai");
  assert.equal(props.Verified.select.name, "yes");
  assert.equal(props.Source.url, "https://x.example/j/1");
});

test("entryToProperties omits Location/Source/Verified when absent or invalid", () => {
  const props = entryToProperties({ company: "Acme", title: "Dev", url: "not-a-url" });
  assert.equal("Location" in props, false);
  assert.equal("Source" in props, false);
  assert.equal("Verified" in props, false);
});

// ---- Stage 3 career-page cache ----------------------------------------------

test("cacheEntryUsable: resolved pages are permanent, failed lookups expire", () => {
  const now = Date.parse("2026-07-02T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const resolved = { url: "https://acme.example/careers", resolvedAt: "2020-01-01T00:00:00Z" };
  const freshMiss = { url: null, resolvedAt: new Date(now - 2 * day).toISOString() };
  const staleMiss = { url: null, resolvedAt: new Date(now - 8 * day).toISOString() };
  assert.equal(cacheEntryUsable(resolved, now), true);
  assert.equal(cacheEntryUsable(freshMiss, now), true, "fresh miss: don't re-pay for discovery");
  assert.equal(cacheEntryUsable(staleMiss, now), false, "stale miss: retry discovery");
  assert.equal(cacheEntryUsable(undefined, now), false);
  assert.equal(cacheEntryUsable({ url: null }, now), false, "no timestamp = retry");
});

test("pickCareersUrl: ATS URL beats everything, aggregators are last resort", () => {
  assert.equal(
    pickCareersUrl(["https://linkedin.com/jobs/acme", "https://boards.greenhouse.io/acme"]),
    "https://boards.greenhouse.io/acme",
    "known ATS wins even when listed after an aggregator"
  );
  assert.equal(
    pickCareersUrl(["https://www.naukri.com/acme-jobs", "https://acme.example/careers"]),
    "https://acme.example/careers",
    "own careers page beats an aggregator careers page"
  );
  assert.equal(
    pickCareersUrl(["https://linkedin.com/jobs/acme", "https://acme.example/about"]),
    "https://acme.example/about",
    "any non-aggregator URL beats an aggregator"
  );
  assert.equal(
    pickCareersUrl(["https://www.naukri.com/acme-jobs-123"]),
    "https://www.naukri.com/acme-jobs-123",
    "aggregator careers page is an acceptable last resort"
  );
  assert.equal(
    pickCareersUrl(["https://www.ziprecruiter.com/co/some-other-company"]),
    null,
    "a bare aggregator result is worse than no URL (wrong-company risk)"
  );
  assert.equal(pickCareersUrl([]), null);
});

// ---- Stage 2 query + scoring stay consistent with the profile contract -------

test("buildQuery works from a bare profile (no enrichment fields)", () => {
  const q = buildQuery({
    basics: { headline: "Full Stack Developer" },
    skills: ["react", "node"],
    targetRoles: ["MERN Developer"],
  });
  assert.equal(q.role, "MERN Developer");
  assert.deepEqual(q.locations, ["Chennai", "Coimbatore", "Bengaluru"]);
});

test("filterAndScore hard-rejects bond/shift listings and scores the rest", () => {
  const query = buildQuery({ basics: {}, skills: ["react"], targetRoles: ["React Developer"] });
  const jobs = [
    normalizeJob("test", { title: "React Developer", company: "A", location: "Chennai", description: "react work" }),
    normalizeJob("test", { title: "React Developer", company: "B", location: "Chennai", description: "2 year service bond required" }),
    normalizeJob("test", { title: "Support Engineer", company: "C", location: "Chennai", description: "night shift role" }),
  ];
  const { kept, stats } = filterAndScore(jobs, query);
  assert.equal(stats.hardRejected, 2);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].company, "A");
  assert.ok(kept[0].score > 0);
});

// ---- Notion two-touch audit ---------------------------------------------------
// The recurring pipeline must touch Notion exactly twice:
//   1st touch — Stage 1 READS  (src/stage1/fetchNotion.js)
//   2nd touch — Stage 4 WRITES (src/stage4/pushToNotion.js)
// seedFromNotion.js is a manual one-time utility (npm run seed-jobs), never part
// of search/cron, so it's allowlisted separately.

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}

test("Notion client is imported ONLY by Stage 1 (read) + Stage 4 (write) + manual seed", () => {
  const allowed = new Set([
    path.join(SRC, "stage1", "fetchNotion.js"), // touch 1: read
    path.join(SRC, "stage4", "pushToNotion.js"), // touch 2: write
    path.join(SRC, "stage2", "seedFromNotion.js"), // manual one-time utility
  ]);
  const offenders = walk(SRC).filter(
    (f) => !allowed.has(f) && fs.readFileSync(f, "utf8").includes("@notionhq/client")
  );
  assert.deepEqual(offenders, [], `unexpected Notion access in: ${offenders.join(", ")}`);
});

test("the cron path (Stage 2 + Stage 3) never references the Notion API", () => {
  const cronFiles = [...walk(path.join(SRC, "stage2")), ...walk(path.join(SRC, "stage3"))].filter(
    (f) => !f.endsWith("seedFromNotion.js") // manual utility, not in the cron
  );
  for (const f of cronFiles) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!src.includes("@notionhq/client"), `${f} imports the Notion client`);
    assert.ok(!src.includes("api.notion.com"), `${f} calls the Notion API directly`);
  }
});
