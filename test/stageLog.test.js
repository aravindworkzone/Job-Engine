import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stageLogger } from "../src/lib/stageLog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("under the test runner, loggers are silent — real logs are never polluted", () => {
  assert.ok(
    process.env.NODE_TEST_CONTEXT || process.execArgv.includes("--test"),
    "test runner must be detectable, or silence cannot work"
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-"));
  const log = stageLogger("stageX", { dir });
  log("fake failure that must not be written");
  assert.equal(fs.existsSync(path.join(dir, "stageX.log")), false);
});

test("outside tests, the logger appends timestamped lines to <stage>.log", () => {
  const saved = { ctx: process.env.NODE_TEST_CONTEXT, silent: process.env.LOG_SILENT };
  const savedArgv = process.execArgv;
  try {
    delete process.env.NODE_TEST_CONTEXT;
    delete process.env.LOG_SILENT;
    Object.defineProperty(process, "execArgv", { value: [], configurable: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-"));
    const log = stageLogger("stageY", { dir });
    log("first line");
    log("second line");
    const content = fs.readFileSync(path.join(dir, "stageY.log"), "utf8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\[\d{4}-\d{2}-\d{2}T.*\] first line$/);
  } finally {
    if (saved.ctx !== undefined) process.env.NODE_TEST_CONTEXT = saved.ctx;
    if (saved.silent !== undefined) process.env.LOG_SILENT = saved.silent;
    Object.defineProperty(process, "execArgv", { value: savedArgv, configurable: true });
  }
});

test("LOG_SILENT=1 silences even outside the test runner", () => {
  const savedArgv = process.execArgv;
  const savedCtx = process.env.NODE_TEST_CONTEXT;
  try {
    delete process.env.NODE_TEST_CONTEXT;
    Object.defineProperty(process, "execArgv", { value: [], configurable: true });
    process.env.LOG_SILENT = "1";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-"));
    stageLogger("stageZ", { dir })("nope");
    assert.equal(fs.existsSync(path.join(dir, "stageZ.log")), false);
  } finally {
    delete process.env.LOG_SILENT;
    if (savedCtx !== undefined) process.env.NODE_TEST_CONTEXT = savedCtx;
    Object.defineProperty(process, "execArgv", { value: savedArgv, configurable: true });
  }
});

test("every stage has a logger wired (stage1–stage4)", () => {
  for (const [file, stage] of [
    ["src/stage1/index.js", "stage1"],
    ["src/stage2/orchestrator.js", "stage2"],
    ["src/stage3/orchestrator.js", "stage3"],
    ["src/stage4/pushToNotion.js", "stage4"],
  ]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(src.includes(`stageLogger("${stage}")`), `${file} must log to ${stage}.log`);
  }
});
