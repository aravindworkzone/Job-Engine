import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectATS } from "../src/stage3/ats/detectATS.js";
import { matchRole } from "../src/stage3/matchRole.js";
import { verifyJob } from "../src/stage3/verifyJob.js";

const ENTRY = { id: "1", title: "Full Stack Developer", company: "Acme" };

// ---- ATS detection (D1–D5) -----------------------------------------------------

test("D1: direct Greenhouse board URL → token", () => {
  assert.deepEqual(detectATS("https://boards.greenhouse.io/acmecorp"), {
    atsType: "greenhouse",
    token: "acmecorp",
  });
  assert.deepEqual(detectATS("https://job-boards.greenhouse.io/acme-2"), {
    atsType: "greenhouse",
    token: "acme-2",
  });
});

test("D2: direct Lever URL → company slug", () => {
  assert.deepEqual(detectATS("https://jobs.lever.co/acme"), { atsType: "lever", company: "acme" });
});

test("D3: embedded Greenhouse board found in page HTML", () => {
  const html = '<iframe src="https://boards.greenhouse.io/embed/job_board?for=acmecorp">';
  assert.deepEqual(detectATS("https://acme.example/careers", html), {
    atsType: "greenhouse",
    token: "acmecorp",
  });
});

test("D4: embedded Lever board found in page HTML", () => {
  const html = '<a href="https://jobs.lever.co/acme/123">Apply</a>';
  assert.deepEqual(detectATS("https://acme.example/careers", html), {
    atsType: "lever",
    company: "acme",
  });
});

test("D5: plain career page with no ATS → null", () => {
  assert.deepEqual(detectATS("https://acme.example/careers", "<html>join us</html>"), { atsType: null });
});

// ---- fuzzy role matching (M1–M4) -------------------------------------------------

test("M1: exact and near-exact titles match", () => {
  assert.equal(matchRole("Full Stack Developer", ["Full Stack Developer"]).matched, true);
  assert.equal(matchRole("Full Stack Developer", ["Full-Stack Developer (MERN)"]).matched, true);
});

test("M2: unrelated titles do not match", () => {
  const r = matchRole("Full Stack Developer", ["Accountant", "HR Manager"]);
  assert.equal(r.matched, false);
});

test("M3: empty inputs never match", () => {
  assert.equal(matchRole("", ["Dev"]).matched, false);
  assert.equal(matchRole("Dev", []).matched, false);
  assert.equal(matchRole("Dev", [null, ""]).matched, false);
});

test("M4: threshold is honored — stricter threshold rejects a fuzzy match", () => {
  const loose = matchRole("Full Stack Developer", ["Fullstack Web Developer"], 0.6);
  const strict = matchRole("Full Stack Developer", ["Fullstack Web Developer"], 0.01);
  assert.equal(loose.matched, true);
  assert.equal(strict.matched, false);
});

// ---- verdict paths (V1–V5), all with injected deps — zero network ------------------

const gh = (titles) => ({ url: "https://x", atsType: "greenhouse", token: "t" , listings: titles });

test("V1: greenhouse — live listing match → yes, absent → no", async () => {
  const deps = (titles) => ({ greenhouseListings: async () => titles.map((t) => ({ title: t })) });
  const resolved = { url: "https://x", atsType: "greenhouse", token: "t" };
  assert.equal(await verifyJob(ENTRY, resolved, deps(["Full Stack Developer", "QA"])), "yes");
  assert.equal(await verifyJob(ENTRY, resolved, deps(["Accountant"])), "no");
});

test("V2: lever — live listing match → yes, absent → no", async () => {
  const deps = (titles) => ({ leverListings: async () => titles.map((t) => ({ title: t })) });
  const resolved = { url: "https://x", atsType: "lever", leverCompany: "acme" };
  assert.equal(await verifyJob(ENTRY, resolved, deps(["Full Stack Developer"])), "yes");
  assert.equal(await verifyJob(ENTRY, resolved, deps(["Accountant"])), "no");
});

test("V3: generic — title on page → yes, absent → manual, empty page → manual", async () => {
  const resolved = { url: "https://x", atsType: null };
  const deps = (text) => ({ genericExtract: async () => text });
  assert.equal(await verifyJob(ENTRY, resolved, deps("Join us! Full Stack Developer wanted")), "yes");
  assert.equal(await verifyJob(ENTRY, resolved, deps("We hire designers")), "manual");
  assert.equal(await verifyJob(ENTRY, resolved, deps("")), "manual");
});

test("V4: infrastructure errors → manual (never dropped, never thrown)", async () => {
  const boom = async () => { throw new Error("ATS down"); };
  assert.equal(
    await verifyJob(ENTRY, { url: "https://x", atsType: "greenhouse", token: "t" }, { greenhouseListings: boom }),
    "manual"
  );
  assert.equal(
    await verifyJob(ENTRY, { url: "https://x", atsType: null }, { genericExtract: boom }),
    "manual"
  );
});

test("V5: greenhouse resolution without a token falls through to generic", async () => {
  const resolved = { url: "https://x", atsType: "greenhouse", token: null };
  const verdict = await verifyJob(ENTRY, resolved, { genericExtract: async () => "full stack developer" });
  assert.equal(verdict, "yes", "no token → generic path is used");
});

// ---- controller compliance ---------------------------------------------------------

test("no stage3 file re-implements the fetch timeout (controller rule)", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/stage3");
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      return e.isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
    });
  const offenders = walk(dir).filter((f) =>
    /Number\(process\.env\.FETCH_TIMEOUT_MS\)/.test(fs.readFileSync(f, "utf8"))
  );
  assert.deepEqual(offenders, []);
});
