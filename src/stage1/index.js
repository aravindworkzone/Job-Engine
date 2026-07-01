import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchNotion } from "./fetchNotion.js";
import { fetchGithub } from "./fetchGithub.js";
import { fetchPortfolio } from "./fetchPortfolio.js";
import { fetchPublicFootprint } from "./fetchPublicFootprint.js";
import { mergeProfile, ENRICHED_PATH } from "./mergeProfile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LOG_PATH = path.join(ROOT, "stage1.log");
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // enriched.json is stale after 2 days

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  try {
    fs.appendFileSync(LOG_PATH, stamped);
  } catch {
    /* logging must never crash the stage */
  }
}

// Fresh = enriched.json exists and was modified less than 2 days ago.
function isFresh() {
  try {
    return Date.now() - fs.statSync(ENRICHED_PATH).mtimeMs < MAX_AGE_MS;
  } catch {
    return false; // missing file
  }
}

// Enrich profile.json with dynamic data. Skips when enriched.json is fresh.
// Runs the four fetchers in parallel; one failing fetcher never crashes the
// stage (Promise.allSettled + each fetcher returns null on failure). Whatever
// succeeded is merged and written. Returns the enriched object (or null).
export async function runStage1(profile) {
  if (isFresh()) {
    console.log("✔ Stage 1: enriched.json is fresh (< 2 days) — skipping fetch.");
    try {
      return JSON.parse(fs.readFileSync(ENRICHED_PATH, "utf8"));
    } catch {
      return null;
    }
  }

  console.log("• Stage 1: enriching profile ...");

  // Start all four in parallel, then wait for all to settle.
  const names = ["notion", "github", "portfolio", "footprint"];
  const settled = await Promise.allSettled([
    fetchNotion(profile),
    fetchGithub(profile),
    fetchPortfolio(profile),
    fetchPublicFootprint(profile),
  ]);

  const results = {};
  settled.forEach((r, i) => {
    const name = names[i];
    if (r.status === "fulfilled" && r.value != null) {
      results[name] = r.value;
      console.log(`  ✓ ${name}`);
    } else {
      results[name] = null;
      const reason =
        r.status === "rejected" ? r.reason?.message ?? String(r.reason) : "returned no data";
      console.log(`  ✗ ${name} (${reason})`);
      log(`fetcher failed: ${name} — ${reason}`);
    }
  });

  const { valid } = mergeProfile(profile, results, new Date().toISOString());
  const okCount = Object.values(results).filter(Boolean).length;
  console.log(
    `✔ Stage 1: wrote enriched.json (${okCount}/4 sources${valid ? "" : ", schema warnings logged"}).`
  );
  if (!valid) log("merge: enriched.json written with schema validation warnings");

  try {
    return JSON.parse(fs.readFileSync(ENRICHED_PATH, "utf8"));
  } catch {
    return null;
  }
}
