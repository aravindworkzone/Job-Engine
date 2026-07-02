import test from "node:test";
import assert from "node:assert/strict";

import { createJobRow, entryToProperties } from "../src/stage2/writeToNotion.js";
import { isPushable } from "../src/stage4/pushToNotion.js";
import { JOB_HUNT_SCHEMA } from "../src/lib/notionJobHunt.js";

const ENTRY = {
  id: "abc",
  title: "Full Stack Developer",
  company: "Acme",
  location: "Chennai",
  url: "https://x.example/j/1",
  source: "jooble",
  score: 72,
  salary: "₹5.0L+",
  verified: "yes",
  verifiedAt: "2026-07-02T00:00:00Z",
  pushedToNotion: false,
};

// ---- row creation (fake Notion client — zero network) ----------------------------

test("createJobRow writes to the resolved DB with the exact mapped properties", async () => {
  const calls = [];
  const notion = { pages: { create: async (args) => (calls.push(args), { id: "page-1" }) } };
  await createJobRow(notion, "db-123", ENTRY);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parent.database_id, "db-123");
  assert.deepEqual(calls[0].properties, entryToProperties(ENTRY));
  const note = calls[0].children[0].paragraph.rich_text[0].text.content;
  assert.match(note, /jooble/, "provenance note carries the source");
  assert.match(note, /72/, "provenance note carries the score");
});

test("createJobRow propagates API failures (caller keeps pushedToNotion=false)", async () => {
  const notion = { pages: { create: async () => { throw new Error("validation_error"); } } };
  await assert.rejects(() => createJobRow(notion, "db-123", ENTRY), /validation_error/);
});

// ---- property mapping edges --------------------------------------------------------

test("entryToProperties truncates overlong text to Notion's 2000-char limit", () => {
  const props = entryToProperties({ ...ENTRY, title: "x".repeat(5000) });
  assert.equal(props.Role.rich_text[0].text.content.length, 2000);
});

test("entryToProperties: unknown company gets a placeholder title", () => {
  const props = entryToProperties({ title: "Dev" });
  assert.equal(props.Company.title[0].text.content, "(unknown company)");
});

test("entryToProperties: non-numeric score maps to null, never NaN", () => {
  const props = entryToProperties({ ...ENTRY, score: "high" });
  assert.equal(props.Score.number, null);
});

// ---- push gate + schema consistency -------------------------------------------------

test("push gate: only yes/manual + unpushed qualify — full matrix", () => {
  const cases = [
    [{ verified: "yes", pushedToNotion: false }, true],
    [{ verified: "manual", pushedToNotion: false }, true],
    [{ verified: "no", pushedToNotion: false }, false],
    [{ verified: null, pushedToNotion: false }, false],
    [{ verified: "yes", pushedToNotion: true }, false],
    [{ verified: "manual", pushedToNotion: true }, false],
  ];
  for (const [entry, want] of cases) {
    assert.equal(isPushable(entry), want, JSON.stringify(entry));
  }
});

test("every property a push can write exists in the auto-create schema", () => {
  const props = entryToProperties({ ...ENTRY, growth: "fast" });
  for (const key of Object.keys(props)) {
    assert.ok(key in JOB_HUNT_SCHEMA, `push writes "${key}" but a recreated DB would lack it`);
  }
});
