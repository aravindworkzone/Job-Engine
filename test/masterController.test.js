import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NOTION_DBS, resolveNotionDb } from "../src/controller/index.js";

const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mc-")), "notionState.json");
const silent = () => {};

test("policy: Job Hunt is the ONLY Notion DB, and it is mandatory", () => {
  assert.deepEqual(Object.keys(NOTION_DBS), ["jobHunt"], "Skill Levels / LinkedIn Posts removed — not required for search");
  assert.equal(NOTION_DBS.jobHunt.required, true);
});

test("removed DBs are unknown to the controller", async () => {
  await assert.rejects(() => resolveNotionDb(null, "skillLevels"), /unknown Notion DB/);
  await assert.rejects(() => resolveNotionDb(null, "linkedinPosts"), /unknown Notion DB/);
});

test("jobHunt resolves through ensureJobHuntDb (auto-create path included)", async () => {
  const created = [];
  const notion = {
    databases: {
      retrieve: async () => {
        throw new Error("not shared");
      },
      create: async (args) => {
        created.push(args);
        return { id: "created-db-id" };
      },
    },
    search: async ({ filter }) =>
      filter?.value === "database"
        ? { results: [] }
        : { results: [{ id: "life-hq", parent: { type: "workspace" } }] },
  };
  const id = await resolveNotionDb(notion, "jobHunt", { statePath: tmpState(), log: silent });
  assert.equal(id, "created-db-id");
  assert.equal(created.length, 1);
});

test("jobHunt failure is a hard error (mandatory), not a silent null", async () => {
  const notion = {
    databases: {
      retrieve: async () => {
        throw new Error("not shared");
      },
      create: async () => {
        throw new Error("should not get here");
      },
    },
    search: async () => ({ results: [] }), // nothing shared at all
  };
  await assert.rejects(
    () => resolveNotionDb(notion, "jobHunt", { statePath: tmpState(), log: silent }),
    /no page is shared/
  );
});

test("unknown DB key is rejected", async () => {
  await assert.rejects(() => resolveNotionDb(null, "nope"), /unknown Notion DB/);
});
