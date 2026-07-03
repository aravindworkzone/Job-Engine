import test from "node:test";
import assert from "node:assert/strict";

import { verifyJob } from "../src/stage3/verifyJob.js";
import { selectCompaniesForRun } from "../src/stage3/orchestrator.js";
import { isPushable } from "../src/stage4/pushToNotion.js";

const ENTRY = { id: "x", title: "Dev", company: "Acme" };
const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-07-02T00:00:00Z");

test("no career page → null verdict: entry stays UNVERIFIED, not manual", async () => {
  // NOTE: always pass a resolved object here — passing null/undefined makes
  // verifyJob resolve the career page itself (a live Tavily call).
  assert.equal(await verifyJob(ENTRY, { url: null }), null);
  assert.equal(await verifyJob(ENTRY, { url: null, atsType: null }), null);
});

test("an unverified (null) entry is never pushable to Notion", () => {
  assert.equal(isPushable({ pushedToNotion: false, verified: null }), false);
});

test("selectCompaniesForRun defers fresh-negative companies instead of burning cap slots", () => {
  const cache = {
    "deadco": { url: null, resolvedAt: new Date(now - 1 * day).toISOString() }, // fresh miss
    "oldmiss": { url: null, resolvedAt: new Date(now - 10 * day).toISOString() }, // expired miss
    "resolved": { url: "https://r.example/careers", resolvedAt: "2020-01-01" },
  };
  const { selected, deferred } = selectCompaniesForRun(
    ["deadco", "oldmiss", "resolved", "brandnew"],
    cache,
    10,
    now
  );
  assert.deepEqual(deferred, ["deadco"], "only the fresh miss is deferred");
  assert.deepEqual(selected, ["oldmiss", "resolved", "brandnew"], "expired misses get retried");
});

test("the cap applies to eligible companies only — deferred ones don't count", () => {
  const cache = { "d1": { url: null, resolvedAt: new Date(now - day).toISOString() } };
  const { selected, deferred } = selectCompaniesForRun(["d1", "a", "b", "c"], cache, 2, now);
  assert.deepEqual(deferred, ["d1"]);
  assert.deepEqual(selected, ["a", "b"], "two real slots go to verifiable companies");
});

test("deferral never drops entries — every company is either selected or deferred", () => {
  const keys = ["a", "b", "c", "d", "e"];
  const cache = { c: { url: null, resolvedAt: new Date(now - day).toISOString() } };
  const { selected, deferred } = selectCompaniesForRun(keys, cache, 3, now);
  const accounted = new Set([...selected, ...deferred]);
  // beyond-cap companies (e) wait for the next run, but nothing is ever removed
  assert.ok(selected.length <= 3);
  assert.ok(accounted.size <= keys.length);
  assert.equal(deferred.includes("c"), true);
  assert.equal([...accounted].every((k) => keys.includes(k)), true);
});
