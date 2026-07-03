import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { entryToProperties } from "../src/stage2/writeToNotion.js";
import { notionFieldDefaults, followupDays } from "../src/controller/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const text = (p) => p.rich_text[0].text.content;

const BARE_ENTRY = { company: "Acme", title: "Dev", score: 50 }; // no salary/growth — the empty-columns case

test("pushed rows are never half-empty: Salary, Growth, Contact, Next Action, Follow-up Date all get values", () => {
  const props = entryToProperties(BARE_ENTRY);
  const d = notionFieldDefaults();
  assert.equal(text(props.Salary), d.salary);
  assert.equal(text(props.Growth), d.growth);
  assert.equal(text(props.Contact), d.contact);
  assert.equal(text(props["Next Action"]), d.nextAction);
  assert.match(props["Follow-up Date"].date.start, /^\d{4}-\d{2}-\d{2}$/);
});

test("real data always beats the fallback: source salary, entry growth, resolved careers page", () => {
  const props = entryToProperties(
    { ...BARE_ENTRY, salary: "₹6–8 LPA", growth: "Series B, hiring fast" },
    { careerPageUrl: "https://acme.com/careers" }
  );
  assert.equal(text(props.Salary), "₹6–8 LPA");
  assert.equal(text(props.Growth), "Series B, hiring fast");
  assert.equal(text(props.Contact), "Careers page: https://acme.com/careers");
});

test("Follow-up Date = push date + NOTION_FOLLOWUP_DAYS (controller-driven)", () => {
  const now = new Date("2026-07-02T10:00:00Z");
  assert.equal(followupDays(), 3); // default
  const props = entryToProperties(BARE_ENTRY, { now });
  assert.equal(props["Follow-up Date"].date.start, "2026-07-05");

  const saved = process.env.NOTION_FOLLOWUP_DAYS;
  try {
    process.env.NOTION_FOLLOWUP_DAYS = "7";
    const overridden = entryToProperties(BARE_ENTRY, { now });
    assert.equal(overridden["Follow-up Date"].date.start, "2026-07-09");
  } finally {
    if (saved === undefined) delete process.env.NOTION_FOLLOWUP_DAYS;
    else process.env.NOTION_FOLLOWUP_DAYS = saved;
  }
});

test("every field default is env-overridable", () => {
  const saved = {};
  const vars = {
    NOTION_DEFAULT_SALARY: "TBD",
    NOTION_DEFAULT_GROWTH: "see research doc",
    NOTION_DEFAULT_CONTACT: "ask referral network",
    NOTION_DEFAULT_NEXT_ACTION: "custom action",
  };
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    process.env[k] = vars[k];
  }
  try {
    const props = entryToProperties(BARE_ENTRY);
    assert.equal(text(props.Salary), "TBD");
    assert.equal(text(props.Growth), "see research doc");
    assert.equal(text(props.Contact), "ask referral network");
    assert.equal(text(props["Next Action"]), "custom action");
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("wiring: Stage 4 feeds Stage 3's resolved careers page into the push", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/stage4/pushToNotion.js"), "utf8");
  assert.ok(src.includes("CAREER_PAGES_PATH"), "Stage 4 must read the careers-page cache");
  assert.ok(src.includes("careerPageUrl"), "Stage 4 must pass careerPageUrl to createJobRow");
});
