import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProfileSchema } from "../src/profile/schema.js";
import { ensureProfile, hasProfile } from "../src/profile/ensureProfile.js";
import { getProvider } from "../src/llm/index.js";
import { extractPdfText } from "../src/llm/pdfText.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const tmpFile = (content) => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stage0-")), "profile.json");
  if (content !== undefined) fs.writeFileSync(p, content);
  return p;
};

// A minimal but complete profile fixture that must satisfy the locked schema.
const VALID_PROFILE = {
  basics: { name: "Test User", email: null, phone: null, location: null, headline: null, summary: null },
  links: [{ label: "GitHub", url: "https://github.com/test" }],
  skills: ["javascript"],
  experience: [
    { company: "Acme", role: "Dev", startDate: null, endDate: null, location: null, highlights: [] },
  ],
  projects: [{ name: "P", description: null, techStack: [], url: null }],
  education: [
    { institution: "U", degree: null, field: null, startDate: null, endDate: null, gpa: null },
  ],
  certifications: [],
  targetRoles: ["Full Stack Developer"],
};

// T1 — the schema accepts a complete, well-formed profile.
test("T1: ProfileSchema accepts a valid profile", () => {
  assert.equal(ProfileSchema.safeParse(VALID_PROFILE).success, true);
});

// T2 — required fields are enforced (no name → invalid).
test("T2: ProfileSchema rejects a profile missing basics.name", () => {
  const { basics, ...rest } = VALID_PROFILE;
  const bad = { ...rest, basics: { ...basics } };
  delete bad.basics.name;
  assert.equal(ProfileSchema.safeParse(bad).success, false);
});

// T3 — the schema lock catches type drift (skills must be an array, not a string).
test("T3: ProfileSchema rejects wrong types (schema-lock guarantee)", () => {
  assert.equal(ProfileSchema.safeParse({ ...VALID_PROFILE, skills: "javascript" }).success, false);
  assert.equal(ProfileSchema.safeParse({ ...VALID_PROFILE, targetRoles: null }).success, false);
});

// T4 — the REAL profile.json produced by the live Stage 0 run validates.
test("T4: real data/profile.json conforms to ProfileSchema", (t) => {
  const real = path.join(DATA_DIR, "profile.json");
  if (!fs.existsSync(real)) return t.skip("no data/profile.json on this machine");
  const parsed = ProfileSchema.safeParse(JSON.parse(fs.readFileSync(real, "utf8")));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues, null, 2));
});

// T5 — missing file counts as "no profile".
test("T5: hasProfile is false for a missing file", () => {
  assert.equal(hasProfile(path.join(os.tmpdir(), "does-not-exist-profile.json")), false);
});

// T6 — empty / whitespace-only file counts as "no profile".
test("T6: hasProfile is false for empty or whitespace files", () => {
  assert.equal(hasProfile(tmpFile("")), false);
  assert.equal(hasProfile(tmpFile("   \n\t ")), false);
});

// T7 — corrupt JSON, {}, and schema-drifted objects all count as "no profile".
test("T7: hasProfile is false for corrupt, empty-object, or drifted JSON", () => {
  assert.equal(hasProfile(tmpFile("{not json")), false);
  assert.equal(hasProfile(tmpFile("{}")), false);
  assert.equal(hasProfile(tmpFile(JSON.stringify({ foo: 1 }))), false, "junk object must not pass as a profile");
});

// T8 — an existing valid profile is returned as-is, with NO regeneration (no LLM call).
test("T8: ensureProfile loads an existing valid profile without rebuilding", async () => {
  const p = tmpFile(JSON.stringify(VALID_PROFILE));
  const profile = await ensureProfile({ profilePath: p });
  assert.equal(profile.basics.name, "Test User");
  // If it had tried to rebuild, it would have thrown (no LLM reachable in tests)
  // or overwritten the file — verify the file is untouched.
  assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf8")), VALID_PROFILE);
});

// T9 — the Groq path's PDF text extraction works on the real resume (offline, no API).
test("T9: extractPdfText pulls non-empty text from data/resume.pdf", async (t) => {
  const pdf = path.join(DATA_DIR, "resume.pdf");
  if (!fs.existsSync(pdf)) return t.skip("no data/resume.pdf on this machine");
  const text = await extractPdfText(pdf);
  assert.ok(text.length > 200, `extracted only ${text.length} chars`);
  assert.match(text.toLowerCase(), /aravind/, "candidate name should appear in extracted text");
});

// T10 — provider selection honors LLM_PROVIDER and fails clearly on unknowns.
test("T10: getProvider picks groq/anthropic and rejects unknown providers", () => {
  const saved = process.env.LLM_PROVIDER;
  try {
    process.env.LLM_PROVIDER = "groq";
    assert.equal(getProvider().name, "groq");
    process.env.LLM_PROVIDER = "claude";
    assert.equal(getProvider().name, "anthropic");
    delete process.env.LLM_PROVIDER;
    assert.equal(getProvider().name, "anthropic", "default provider is anthropic");
    process.env.LLM_PROVIDER = "gpt5";
    assert.throws(() => getProvider(), /Unknown LLM_PROVIDER "gpt5".*Supported:/s);
  } finally {
    process.env.LLM_PROVIDER = saved;
  }
});
