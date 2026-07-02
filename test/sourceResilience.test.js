import test from "node:test";
import assert from "node:assert/strict";

import { fetchSourceWithRetries, runSources } from "../src/stage2/orchestrator.js";
import { sourceRetries, sourceRetryDelayMs } from "../src/controller/index.js";

const QUERY = { role: "Dev" };
const fast = { delayMs: 0 };

test("a flaky source succeeds on a retry (dead twice, alive on 3rd attempt)", async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) throw new Error("ECONNRESET");
    return [{ title: "Dev", company: "Acme" }];
  };
  const jobs = await fetchSourceWithRetries("flaky", flaky, QUERY, { retries: 2, ...fast });
  assert.equal(calls, 3, "1 attempt + 2 retries");
  assert.equal(jobs.length, 1);
});

test("a dead source is abandoned after exactly 2 retries (3 attempts)", async () => {
  let calls = 0;
  const dead = async () => {
    calls++;
    throw new Error("HTTP 503");
  };
  await assert.rejects(
    () => fetchSourceWithRetries("dead", dead, QUERY, { retries: 2, ...fast }),
    /HTTP 503/
  );
  assert.equal(calls, 3, "must stop trying after the retry budget");
});

test("retry budget is controller-driven (SOURCE_RETRIES / SOURCE_RETRY_DELAY_MS)", () => {
  const saved = { r: process.env.SOURCE_RETRIES, d: process.env.SOURCE_RETRY_DELAY_MS };
  try {
    delete process.env.SOURCE_RETRIES;
    delete process.env.SOURCE_RETRY_DELAY_MS;
    assert.equal(sourceRetries(), 2, "default: retry twice");
    assert.equal(sourceRetryDelayMs(), 1000);
    process.env.SOURCE_RETRIES = "5";
    process.env.SOURCE_RETRY_DELAY_MS = "50";
    assert.equal(sourceRetries(), 5);
    assert.equal(sourceRetryDelayMs(), 50);
  } finally {
    if (saved.r === undefined) delete process.env.SOURCE_RETRIES;
    else process.env.SOURCE_RETRIES = saved.r;
    if (saved.d === undefined) delete process.env.SOURCE_RETRY_DELAY_MS;
    else process.env.SOURCE_RETRY_DELAY_MS = saved.d;
  }
});

test("one dead source never blocks the others (survivors deliver)", async () => {
  const sources = [
    ["deadA", async () => { throw new Error("down"); }],
    ["aliveB", async () => [{ title: "Dev", company: "Acme" }]],
    ["aliveC", async () => [{ title: "QA", company: "Beta", source: "custom" }]],
  ];
  const { merged, srv } = await runSources(sources, QUERY, { retries: 1, ...fast });
  assert.equal(srv.ok, 2);
  assert.equal(srv.failed, 1);
  assert.deepEqual(srv.dead, ["deadA"]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].source, "aliveB", "untagged jobs get the source name");
  assert.equal(merged[1].source, "custom", "explicit source tags are kept");
});

test("ALL sources dead → run still completes with empty results, never throws", async () => {
  const sources = [
    ["a", async () => { throw new Error("down"); }],
    ["b", async () => { throw new Error("down"); }],
  ];
  const { merged, srv } = await runSources(sources, QUERY, { retries: 2, ...fast });
  assert.deepEqual(merged, []);
  assert.equal(srv.ok, 0);
  assert.deepEqual(srv.dead, ["a", "b"]);
});

test("retries=0 means exactly one attempt (no retry storm when disabled)", async () => {
  let calls = 0;
  await assert.rejects(() =>
    fetchSourceWithRetries("x", async () => { calls++; throw new Error("nope"); }, QUERY, { retries: 0, ...fast })
  );
  assert.equal(calls, 1);
});
