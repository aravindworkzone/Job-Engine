import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetKeepFiles, runsLogName } from "../controller/index.js";
import { isSilent } from "./stageLog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = path.join(ROOT, "data");

// Pipeline-start reset: every run begins on a clean slate. Deletes all *.log in
// the root and all *.json in data/ EXCEPT the controller's protected list
// (profile.json, the runs log, and any PIPELINE_RESET_KEEP extras). Everything
// deleted here is state the stages rebuild themselves — that's the self-heal
// contract. Returns the basenames it removed. Dirs are injectable for tests.
export function resetPipelineFiles({ rootDir = ROOT, dataDir = DATA_DIR, keep = resetKeepFiles() } = {}) {
  const protectedNames = new Set(keep);
  const removed = [];
  const wipe = (dir, ext) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return; // missing dir — nothing to reset
    }
    for (const name of names) {
      if (!name.endsWith(ext) || protectedNames.has(name)) continue;
      try {
        fs.rmSync(path.join(dir, name));
        removed.push(name);
      } catch {
        /* a locked file must not stop the pipeline — it will be overwritten anyway */
      }
    }
  };
  wipe(rootDir, ".log");
  wipe(dataDir, ".json");
  return removed;
}

// The run-history log: append-only, by contract. This function is the ONLY
// writer, and appendFileSync is the only operation — nothing in the codebase
// may delete, truncate, or rewrite the file (the reset above protects it via
// resetKeepFiles). Silent under the test runner like every logger.
export function logPipelineRun(line, { rootDir = ROOT } = {}) {
  if (isSilent()) return;
  try {
    fs.appendFileSync(path.join(rootDir, runsLogName()), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* never crash the pipeline over logging */
  }
}
