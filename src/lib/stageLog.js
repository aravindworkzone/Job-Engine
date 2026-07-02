import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Unit tests exercise failure paths on purpose — their fake errors must NEVER
// land in the real stage logs (that noise once made healthy logs look broken).
// node's test runner marks its processes with NODE_TEST_CONTEXT; LOG_SILENT=1
// forces the same behavior manually.
export const isSilent = () =>
  !!(process.env.NODE_TEST_CONTEXT || process.env.LOG_SILENT) ||
  process.execArgv.includes("--test");

// Append-only per-stage logger: stageLogger("stage3") → writes ./stage3.log.
// Logging must never crash a stage; failures to write are swallowed.
// `dir` is injectable for tests.
export function stageLogger(stage, { dir = ROOT } = {}) {
  const file = path.join(dir, `${stage}.log`);
  return (line) => {
    if (isSilent()) return;
    try {
      fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
    } catch {
      /* never crash the stage over logging */
    }
  };
}
