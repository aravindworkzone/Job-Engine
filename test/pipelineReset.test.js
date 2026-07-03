import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resetPipelineFiles, logPipelineRun } from "../src/lib/pipelineReset.js";
import { resetOnStart, runsLogName, resetKeepFiles } from "../src/controller/index.js";
import { selectNewJobs, notionSeenIds } from "../src/stage2/dedupeAgainstNotion.js";
import { hashId } from "../src/lib/jobsStore.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeFakePipelineDirs() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "reset-"));
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir);
  for (const f of ["stage1.log", "stage2.log", "stage3.log", "stage4.log", "runs.log"]) {
    fs.writeFileSync(path.join(rootDir, f), "old\n");
  }
  for (const f of ["profile.json", "enriched.json", "jobs.json", "careerPages.json", "notionState.json"]) {
    fs.writeFileSync(path.join(dataDir, f), "{}");
  }
  fs.writeFileSync(path.join(dataDir, "resume.pdf"), "not-a-json"); // must never be touched
  return { rootDir, dataDir };
}

test("reset wipes every *.log and data/*.json EXCEPT profile.json and runs.log", () => {
  const { rootDir, dataDir } = makeFakePipelineDirs();
  const removed = resetPipelineFiles({ rootDir, dataDir });

  assert.deepEqual(
    removed.sort(),
    ["careerPages.json", "enriched.json", "jobs.json", "notionState.json", "stage1.log", "stage2.log", "stage3.log", "stage4.log"]
  );
  // protected + non-matching files survive
  assert.ok(fs.existsSync(path.join(dataDir, "profile.json")), "profile.json must survive");
  assert.ok(fs.existsSync(path.join(rootDir, "runs.log")), "runs.log must survive");
  assert.ok(fs.existsSync(path.join(dataDir, "resume.pdf")), "non-log/json files must survive");
  // runs.log content untouched — reset may never rewrite it
  assert.equal(fs.readFileSync(path.join(rootDir, "runs.log"), "utf8"), "old\n");
  // everything else is gone
  assert.equal(fs.existsSync(path.join(dataDir, "jobs.json")), false);
  assert.equal(fs.existsSync(path.join(rootDir, "stage1.log")), false);
});

test("PIPELINE_RESET_KEEP protects extra files from the wipe", () => {
  const { rootDir, dataDir } = makeFakePipelineDirs();
  const saved = process.env.PIPELINE_RESET_KEEP;
  try {
    process.env.PIPELINE_RESET_KEEP = "jobs.json, stage3.log";
    resetPipelineFiles({ rootDir, dataDir });
    assert.ok(fs.existsSync(path.join(dataDir, "jobs.json")));
    assert.ok(fs.existsSync(path.join(rootDir, "stage3.log")));
    assert.equal(fs.existsSync(path.join(dataDir, "enriched.json")), false);
  } finally {
    if (saved === undefined) delete process.env.PIPELINE_RESET_KEEP;
    else process.env.PIPELINE_RESET_KEEP = saved;
  }
});

test("reset of missing dirs is a no-op, never a crash (self-heal)", () => {
  const gone = path.join(os.tmpdir(), "reset-does-not-exist-" + Date.now());
  assert.deepEqual(resetPipelineFiles({ rootDir: gone, dataDir: gone }), []);
});

test("controller: reset is on by default, PIPELINE_RESET_ON_START=off disables it", () => {
  const saved = process.env.PIPELINE_RESET_ON_START;
  try {
    delete process.env.PIPELINE_RESET_ON_START;
    assert.equal(resetOnStart(), true);
    process.env.PIPELINE_RESET_ON_START = "off";
    assert.equal(resetOnStart(), false);
  } finally {
    if (saved === undefined) delete process.env.PIPELINE_RESET_ON_START;
    else process.env.PIPELINE_RESET_ON_START = saved;
  }
});

test("controller: protected list always contains profile.json and the runs log", () => {
  const keep = resetKeepFiles();
  assert.ok(keep.includes("profile.json"));
  assert.ok(keep.includes(runsLogName()));
});

test("runs log: logPipelineRun APPENDS timestamped lines and never rewrites history", () => {
  const saved = { ctx: process.env.NODE_TEST_CONTEXT, silent: process.env.LOG_SILENT };
  const savedArgv = process.execArgv;
  try {
    delete process.env.NODE_TEST_CONTEXT;
    delete process.env.LOG_SILENT;
    Object.defineProperty(process, "execArgv", { value: [], configurable: true });
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "runs-"));
    const file = path.join(rootDir, runsLogName());
    fs.writeFileSync(file, "[old] previous run\n"); // pre-existing history

    logPipelineRun("pipeline run started", { rootDir });
    logPipelineRun("pipeline run finished in 1.0s", { rootDir });

    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "[old] previous run"); // history preserved — append-only
    assert.match(lines[1], /^\[\d{4}-\d{2}-\d{2}T.*\] pipeline run started$/);
    assert.match(lines[2], /^\[\d{4}-\d{2}-\d{2}T.*\] pipeline run finished in 1\.0s$/);
  } finally {
    if (saved.ctx !== undefined) process.env.NODE_TEST_CONTEXT = saved.ctx;
    if (saved.silent !== undefined) process.env.LOG_SILENT = saved.silent;
    Object.defineProperty(process, "execArgv", { value: savedArgv, configurable: true });
  }
});

test("runs log: silent under the test runner — tests never pollute run history", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "runs-"));
  logPipelineRun("must not be written", { rootDir });
  assert.equal(fs.existsSync(path.join(rootDir, runsLogName())), false);
});

test("append-only contract: pipelineReset.js is the only runs-log writer and only ever appends", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/pipelineReset.js"), "utf8");
  assert.ok(src.includes("appendFileSync"), "runs log must be written via append");
  assert.ok(!src.includes("writeFileSync"), "pipelineReset.js must never rewrite files");
  assert.ok(!src.includes("truncateSync") && !src.includes("ftruncate"), "pipelineReset.js must never truncate files");
  // no other src file may touch the runs log
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".js") && !p.endsWith("pipelineReset.js") && !p.includes("controller")) {
        const s = fs.readFileSync(p, "utf8");
        const touchesFs = ["appendFileSync", "writeFileSync", "rmSync", "unlink", "createWriteStream"].some((op) => s.includes(op));
        if (s.includes("runsLogName") || (s.includes("runs.log") && touchesFs)) offenders.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  assert.deepEqual(offenders, [], "only pipelineReset.js (and the controller) may reference the runs log");
});

test("wiring: the pipeline entry resets on start and logs to the runs log", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/searchJob.js"), "utf8");
  assert.ok(src.includes("resetOnStart()"), "entry must consult the controller toggle");
  assert.ok(src.includes("resetPipelineFiles("), "entry must reset at pipeline start");
  assert.ok(src.includes('logPipelineRun("pipeline run started")'), "entry must record run start");
  assert.ok(src.includes("pipeline run finished"), "entry must record run finish");
  assert.ok(src.includes("pipeline run FAILED"), "entry must record run failure");
  // reset must live ONLY in the pipeline entry — stage scripts would destroy state mid-flight
  for (const f of ["src/stage2/orchestrator.js", "src/stage3/orchestrator.js", "src/stage4/pushToNotion.js"]) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!s.includes("resetPipelineFiles"), `${f} must never reset pipeline files`);
  }
});

test("post-reset dedupe: jobs already in the Notion Job Hunt DB are not re-added after jobs.json is wiped", () => {
  const enriched = {
    notionData: {
      jobHunt: [
        { Company: "Contus Tech", Role: "React.js Developer" },
        { Company: null, Role: null }, // junk row — must not poison the set
      ],
    },
  };
  const seen = notionSeenIds(enriched);
  assert.equal(seen.size, 1);
  assert.ok(seen.has(hashId("Contus Tech", "React.js Developer")));

  const candidates = [
    { company: "Contus Tech", title: "React.js Developer" }, // already a Notion row
    { company: "Acme", title: "Node Developer" }, // genuinely new
  ];
  // existingJobs = [] simulates the post-reset wiped jobs.json
  const fresh = selectNewJobs(candidates, [], (j) => ({ ...j, id: hashId(j.company, j.title) }), seen);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].company, "Acme");
});

test("notionSeenIds tolerates missing enrichment (null / no notionData)", () => {
  assert.equal(notionSeenIds(null).size, 0);
  assert.equal(notionSeenIds({}).size, 0);
  assert.equal(notionSeenIds({ notionData: null }).size, 0);
});
