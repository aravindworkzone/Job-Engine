import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureJobHuntDb, JOB_HUNT_SCHEMA, JOB_HUNT_TITLE } from "../src/lib/notionJobHunt.js";
import { notionNewLeadStatus } from "../src/controller/index.js";

const silent = () => {};
const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jobhunt-")), "notionState.json");

// Minimal fake of the Notion client surface ensureJobHuntDb uses.
function fakeNotion({ retrievable = [], databases = [], pages = [], created = [] }) {
  return {
    databases: {
      retrieve: async ({ database_id }) => {
        if (retrievable.includes(database_id)) return { id: database_id };
        const err = new Error("Could not find database");
        err.code = "object_not_found";
        throw err;
      },
      create: async (args) => {
        created.push(args);
        return { id: "created-db-id" };
      },
    },
    search: async ({ filter }) =>
      filter?.value === "database" ? { results: databases } : { results: pages },
  };
}

test("ensureJobHuntDb: returns the default id when it is retrievable (no create)", async () => {
  const created = [];
  const notion = fakeNotion({ retrievable: ["6e50df73695b4c94a101eb95fa3f8a50"], created });
  const id = await ensureJobHuntDb(notion, { statePath: tmpState(), log: silent });
  assert.equal(id, "6e50df73695b4c94a101eb95fa3f8a50");
  assert.equal(created.length, 0);
});

test("ensureJobHuntDb: falls back to searching by name and caches the discovered id", async () => {
  const statePath = tmpState();
  const notion = fakeNotion({
    databases: [{ id: "found-db-id", title: [{ plain_text: "🎯 Job Hunt" }] }],
  });
  const id = await ensureJobHuntDb(notion, { statePath, log: silent });
  assert.equal(id, "found-db-id");
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).jobHuntDbId, "found-db-id");
});

test("ensureJobHuntDb: creates the DB under an accessible page when truly absent", async () => {
  const statePath = tmpState();
  const created = [];
  const notion = fakeNotion({
    pages: [
      { id: "row-page", parent: { type: "database_id" } },
      { id: "life-hq", parent: { type: "workspace" } },
    ],
    created,
  });
  const id = await ensureJobHuntDb(notion, { statePath, log: silent });
  assert.equal(id, "created-db-id");
  assert.equal(created.length, 1);
  assert.equal(created[0].parent.page_id, "life-hq", "prefers a workspace-level page as parent");
  assert.deepEqual(created[0].properties, JOB_HUNT_SCHEMA);
  assert.equal(created[0].title[0].text.content, JOB_HUNT_TITLE, "exact original title");
  assert.equal("icon" in created[0], false, "original DB has no icon — none must be set");
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).jobHuntDbId, "created-db-id");
});

test("create schema is the EXACT copy of the real Job Hunt DB (snapshot 2026-07-02)", () => {
  // every column of the real DB, including the manually-curated ones
  assert.deepEqual(
    Object.keys(JOB_HUNT_SCHEMA).sort(),
    ["Company", "Contact", "Follow-up Date", "Growth", "Location", "Next Action", "Role", "Salary", "Score", "Source", "Status", "Verified", "VerifiedAt"].sort()
  );
  // the full Status workflow, in order, with the original colors
  assert.deepEqual(
    JOB_HUNT_SCHEMA.Status.select.options.map((o) => `${o.name}:${o.color}`),
    [
      "New Lead:pink", "Draft Ready:yellow", "Sent:blue", "Follow-up:orange",
      "No HR Found:gray", "Bounced:red", "Revival:purple", "Replied:green",
      "Rejected:red", "Expired:brown",
    ]
  );
  assert.deepEqual(JOB_HUNT_SCHEMA.Score, { number: { format: "number" } });
  assert.deepEqual(JOB_HUNT_SCHEMA["Follow-up Date"], { date: {} });
  assert.deepEqual(JOB_HUNT_SCHEMA.Contact, { rich_text: {} });
});

test("the controller's default push status exists in the Status options (no drift)", () => {
  const names = JOB_HUNT_SCHEMA.Status.select.options.map((o) => o.name);
  assert.ok(
    names.includes(notionNewLeadStatus()),
    `Stage 4 pushes Status "${notionNewLeadStatus()}" but the schema only offers: ${names.join(", ")}`
  );
});

test("ensureJobHuntDb: cached id from a previous create is reused first", async () => {
  const statePath = tmpState();
  fs.writeFileSync(statePath, JSON.stringify({ jobHuntDbId: "cached-db-id" }));
  const created = [];
  const notion = fakeNotion({ retrievable: ["cached-db-id"], created });
  const id = await ensureJobHuntDb(notion, { statePath, log: silent });
  assert.equal(id, "cached-db-id");
  assert.equal(created.length, 0);
});

test("ensureJobHuntDb: clear error when nothing is shared with the integration", async () => {
  const notion = fakeNotion({});
  await assert.rejects(
    () => ensureJobHuntDb(notion, { statePath: tmpState(), log: silent }),
    /no page is shared with the integration/
  );
});

test("Job Hunt schema matches every property entryToProperties can write", async () => {
  const { entryToProperties } = await import("../src/stage2/writeToNotion.js");
  const props = entryToProperties({
    company: "Acme",
    title: "Dev",
    location: "Chennai",
    salary: "₹5L",
    growth: "fast",
    score: 70,
    url: "https://x.example/j/1",
    verified: "yes",
    verifiedAt: "2026-07-02T00:00:00Z",
  });
  for (const key of Object.keys(props)) {
    assert.ok(key in JOB_HUNT_SCHEMA, `entryToProperties writes "${key}" but the auto-create schema lacks it`);
  }
});
