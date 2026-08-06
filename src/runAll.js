import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Single-command local run of the whole pipeline (Stage 0 → 4), mirroring what
// .github/workflows/main.yml does on its schedule.
//
// SELF-HEALING CONTRACT — same as CI: every stage is cache-on-disk and rebuilds
// its own state, so a failing stage must never block the ones after it. Stage 2
// falls back to profile.json when enrichment fails, Stage 3 verifies the existing
// backlog when sourcing fails, Stage 4 pushes already-verified leads when
// verification fails. Each stage therefore runs regardless of its predecessor;
// the summary at the end reports what broke, and the exit code stays non-zero so
// failures remain visible without stopping the rest of the run.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STAGES = [
  ["Stage 0→1  profile + enrichment", "searchJob.js"],
  ["Stage 2    source jobs", "stage2/orchestrator.js"],
  ["Stage 3    verify jobs", "stage3/orchestrator.js"],
  ["Stage 4    push to Notion", "stage4/pushToNotion.js"],
];

// Run one stage in its own process (same node binary), streaming its output.
// Resolves with the exit code — it never rejects, so one stage can't abort main.
function runStage(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`❌ could not start ${script}: ${err.message}`);
      resolve(1);
    });
  });
}

async function main() {
  const results = [];
  for (const [label, script] of STAGES) {
    console.log(`\n${"─".repeat(60)}\n▶ ${label}\n${"─".repeat(60)}`);
    const code = await runStage(script);
    results.push([label, code]);
    if (code !== 0) console.warn(`  ! ${label} exited ${code} — continuing (self-heal contract)`);
  }

  console.log(`\n${"═".repeat(60)}\nPipeline summary\n${"═".repeat(60)}`);
  for (const [label, code] of results) console.log(`${code === 0 ? "✅" : "❌"} ${label}`);

  const failed = results.filter(([, code]) => code !== 0).length;
  console.log(failed ? `\n${failed} stage(s) failed — see the output above.` : "\nAll stages completed.");
  process.exit(failed ? 1 : 0);
}

main();
