import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readProperty, flatten } from "../src/stage1/fetchNotion.js";
import { mergeProfile } from "../src/stage1/mergeProfile.js";
import { runStage1, collectStage1 } from "../src/stage1/index.js";
import { fetchPublicFootprint } from "../src/stage1/fetchPublicFootprint.js";
import { EnrichedSchema } from "../src/schema/enrichedSchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const tmpPath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stage1-")), "enriched.json");

const PROFILE = {
  basics: { name: "Test User", email: null, phone: null, location: null, headline: null, summary: null },
  links: [],
  skills: ["javascript"],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  targetRoles: ["Full Stack Developer"],
};

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const out = fn();
  return out instanceof Promise ? out.finally(restore) : (restore(), out);
}

// ---- Notion property flattening (F1–F5) --------------------------------------

test("F1: readProperty joins title/rich_text runs, empty runs become null", () => {
  assert.equal(readProperty({ type: "title", title: [{ plain_text: "Acme " }, { plain_text: "Corp" }] }), "Acme Corp");
  assert.equal(readProperty({ type: "rich_text", rich_text: [] }), null);
  assert.equal(readProperty({ type: "rich_text", rich_text: [{ plain_text: "  " }] }), null);
});

test("F2: readProperty maps select/status/multi_select/number/checkbox", () => {
  assert.equal(readProperty({ type: "select", select: { name: "yes" } }), "yes");
  assert.equal(readProperty({ type: "select", select: null }), null);
  assert.equal(readProperty({ type: "status", status: { name: "Applied" } }), "Applied");
  assert.deepEqual(readProperty({ type: "multi_select", multi_select: [{ name: "a" }, { name: "b" }] }), ["a", "b"]);
  assert.equal(readProperty({ type: "number", number: 7 }), 7);
  assert.equal(readProperty({ type: "checkbox", checkbox: false }), false);
});

test("F3: readProperty maps url/email/phone/date/people/files", () => {
  assert.equal(readProperty({ type: "url", url: "https://x" }), "https://x");
  assert.equal(readProperty({ type: "email", email: "a@b.c" }), "a@b.c");
  assert.equal(readProperty({ type: "phone_number", phone_number: "123" }), "123");
  assert.deepEqual(readProperty({ type: "date", date: { start: "2026-01-01" } }), { start: "2026-01-01", end: null });
  assert.deepEqual(readProperty({ type: "people", people: [{ name: "A" }, { id: "u2" }] }), ["A", "u2"]);
  assert.deepEqual(readProperty({ type: "files", files: [{ name: "cv.pdf" }] }), ["cv.pdf"]);
});

test("F4: readProperty maps formula/rollup and nulls unknown types", () => {
  assert.equal(readProperty({ type: "formula", formula: { type: "number", number: 42 } }), 42);
  assert.deepEqual(
    readProperty({ type: "rollup", rollup: { type: "array", array: [{ type: "number", number: 1 }] } }),
    [1]
  );
  assert.equal(readProperty({ type: "does_not_exist" }), null);
  assert.equal(readProperty(undefined), null);
});

test("F5: flatten turns a Notion page into { propertyName: value }", () => {
  const page = {
    properties: {
      Company: { type: "title", title: [{ plain_text: "Acme" }] },
      Score: { type: "number", number: 70 },
      Verified: { type: "select", select: { name: "yes" } },
    },
  };
  assert.deepEqual(flatten(page), { Company: "Acme", Score: 70, Verified: "yes" });
  assert.deepEqual(flatten({}), {});
});

// ---- merge + schema (M1–M4) ---------------------------------------------------

const NOTION = { jobHunt: [{ Company: "Acme", Status: "Sent" }] };

test("M1: mergeProfile writes a schema-valid enriched.json with all sections", () => {
  const out = tmpPath();
  const { valid, data } = mergeProfile(PROFILE, { notion: NOTION, github: null, portfolio: null, footprint: null }, "2026-07-02T00:00:00Z", out);
  assert.equal(valid, true);
  assert.equal(data.enrichedAt, "2026-07-02T00:00:00Z");
  const onDisk = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual(onDisk.notionData, NOTION);
  assert.equal(onDisk.githubActivity, null);
});

test("M2: partial enrichment (null sections) is schema-valid", () => {
  const { valid } = mergeProfile(PROFILE, { notion: null, github: null, portfolio: null, footprint: null }, undefined, tmpPath());
  assert.equal(valid, true);
});

test("M3: a schema-invalid merge still writes the raw data (nothing lost)", () => {
  const out = tmpPath();
  const badFootprint = { query: "x", source: "bing", results: [] }; // invalid enum
  const { valid } = mergeProfile(PROFILE, { notion: null, github: null, portfolio: null, footprint: badFootprint }, undefined, out);
  assert.equal(valid, false);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).publicFootprint.source, "bing");
});

test("M4: the REAL data/enriched.json conforms to EnrichedSchema", (t) => {
  const real = path.join(DATA_DIR, "enriched.json");
  if (!fs.existsSync(real)) return t.skip("no data/enriched.json on this machine");
  const parsed = EnrichedSchema.safeParse(JSON.parse(fs.readFileSync(real, "utf8")));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues?.slice(0, 5), null, 2));
});

// ---- orchestration (O1–O4) -----------------------------------------------------

test("O1: runStage1 fresh path returns the cached enriched.json without fetching", async (t) => {
  if (!fs.existsSync(path.join(DATA_DIR, "enriched.json"))) return t.skip("no enriched.json");
  await withEnv({ STAGE1_MAX_AGE_DAYS: "9999" }, async () => {
    const out = await runStage1(PROFILE); // must return before any fetcher runs
    assert.ok(out.enrichedAt, "returned the cached enriched object");
  });
});

test("O2: collectStage1 always returns all four section keys (mergeProfile contract)", async () => {
  const results = await collectStage1(
    {},
    { notion: true, github: false, portfolio: false, footprint: false },
    { notion: async () => NOTION, github: async () => ({}), portfolio: async () => ({}), footprint: async () => ({}) }
  );
  assert.deepEqual(Object.keys(results).sort(), ["footprint", "github", "notion", "portfolio"]);
});

test("O3: mandatory notion + all optionals failing still succeeds with nulls", async () => {
  const boom = async () => { throw new Error("down"); };
  const results = await collectStage1(
    {},
    { notion: true, github: true, portfolio: true, footprint: true },
    { notion: async () => NOTION, github: boom, portfolio: boom, footprint: boom }
  );
  assert.deepEqual(results.notion, NOTION);
  assert.equal(results.github, null);
  assert.equal(results.portfolio, null);
  assert.equal(results.footprint, null);
});

test("O4: footprint returns null offline (no Exa/Tavily keys) instead of throwing", async () => {
  await withEnv({ EXA_API_KEY: undefined, TAVILY_API_KEY: undefined }, async () => {
    assert.equal(await fetchPublicFootprint(PROFILE), null);
  });
});

// ---- controller compliance (C1–C2) ----------------------------------------------

test("C1: no stage1 file re-implements the fetch timeout (controller rule)", () => {
  const dir = path.resolve(__dirname, "../src/stage1");
  const offenders = fs.readdirSync(dir).filter((f) => {
    if (!f.endsWith(".js")) return false;
    return /Number\(process\.env\.FETCH_TIMEOUT_MS\)/.test(fs.readFileSync(path.join(dir, f), "utf8"));
  });
  assert.deepEqual(offenders, [], `stage1 files bypassing the controller timeout: ${offenders.join(", ")}`);
});

test("C2: stage1 freshness window follows the controller env knob", async () => {
  // With a 0-day window nothing is ever fresh, so runStage1 must attempt a fetch
  // — we prove it by making the mandatory notion fetch fail (no token) with the
  // optional fetchers toggled off so the test never touches the network.
  await withEnv(
    {
      STAGE1_MAX_AGE_DAYS: "0",
      NOTION_TOKEN: undefined,
      STAGE1_GITHUB: "off",
      STAGE1_PORTFOLIO: "off",
      STAGE1_FOOTPRINT: "off",
    },
    async () => {
      await assert.rejects(() => runStage1(PROFILE), /Notion read is mandatory/);
    }
  );
});
