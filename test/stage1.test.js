import test from "node:test";
import assert from "node:assert/strict";

import { stage1Fetchers } from "../src/controller/index.js";
import { collectStage1 } from "../src/stage1/index.js";

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

const NOTION_DATA = { jobHunt: [{ Company: "Acme" }] };
const impls = (overrides = {}) => ({
  notion: async () => NOTION_DATA,
  github: async () => ({ username: "x" }),
  portfolio: async () => ({ url: "https://x" }),
  footprint: async () => ({ query: "x", source: "exa", results: [] }),
  ...overrides,
});

test("stage1 policy: notion mandatory (locked on), the rest optional and on by default", () => {
  withEnv(
    { STAGE1_GITHUB: undefined, STAGE1_PORTFOLIO: undefined, STAGE1_FOOTPRINT: undefined, STAGE1_NOTION: "off" },
    () => {
      const t = stage1Fetchers();
      assert.equal(t.notion, true, "notion cannot be turned off — even STAGE1_NOTION=off is ignored");
      assert.equal(t.github, true);
      assert.equal(t.portfolio, true);
      assert.equal(t.footprint, true);
    }
  );
});

test("stage1 toggles accept off/false/0/no/disabled (and anything else means on)", () => {
  for (const off of ["off", "false", "0", "no", "disabled", " OFF "]) {
    withEnv({ STAGE1_GITHUB: off }, () => {
      assert.equal(stage1Fetchers().github, false, `"${off}" should disable`);
    });
  }
  for (const on of ["on", "true", "1", "yes", ""]) {
    withEnv({ STAGE1_GITHUB: on }, () => {
      assert.equal(stage1Fetchers().github, true, `"${on}" should keep it on`);
    });
  }
});

test("collectStage1 skips disabled fetchers without ever calling them", async () => {
  let githubCalled = false;
  const results = await collectStage1(
    {},
    { notion: true, github: false, portfolio: false, footprint: true },
    impls({
      github: async () => {
        githubCalled = true;
        return { username: "x" };
      },
    })
  );
  assert.equal(githubCalled, false, "disabled fetcher must not run");
  assert.equal(results.github, null);
  assert.equal(results.portfolio, null);
  assert.deepEqual(results.notion, NOTION_DATA);
  assert.ok(results.footprint);
});

test("collectStage1: a failed OPTIONAL fetcher is tolerated (null section)", async () => {
  const results = await collectStage1(
    {},
    { notion: true, github: true, portfolio: true, footprint: true },
    impls({ github: async () => { throw new Error("rate limited"); }, portfolio: async () => null })
  );
  assert.equal(results.github, null);
  assert.equal(results.portfolio, null);
  assert.deepEqual(results.notion, NOTION_DATA);
});

test("collectStage1: a failed or empty MANDATORY notion fetch fails the stage", async () => {
  const toggles = { notion: true, github: true, portfolio: true, footprint: true };
  await assert.rejects(
    () => collectStage1({}, toggles, impls({ notion: async () => null })),
    /Notion read is mandatory/
  );
  await assert.rejects(
    () => collectStage1({}, toggles, impls({ notion: async () => { throw new Error("401"); } })),
    /Notion read is mandatory/
  );
});
