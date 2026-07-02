import fs from "node:fs";
import { fetchNotion } from "./fetchNotion.js";
import { fetchGithub } from "./fetchGithub.js";
import { fetchPortfolio } from "./fetchPortfolio.js";
import { fetchPublicFootprint } from "./fetchPublicFootprint.js";
import { mergeProfile, ENRICHED_PATH } from "./mergeProfile.js";
import { stage1MaxAgeMs, stage1Fetchers } from "../controller/index.js";
import { stageLogger } from "../lib/stageLog.js";

const log = stageLogger("stage1");

// Fresh = enriched.json exists and is younger than the controller's window.
function isFresh() {
  try {
    return Date.now() - fs.statSync(ENRICHED_PATH).mtimeMs < stage1MaxAgeMs();
  } catch {
    return false; // missing file
  }
}

const DEFAULT_IMPLS = {
  notion: fetchNotion,
  github: fetchGithub,
  portfolio: fetchPortfolio,
  footprint: fetchPublicFootprint,
};
const DISABLED = Symbol("disabled");

// Run the fetchers under the controller's on/off toggles (stage1Fetchers).
// Policy: the profile (resume) and Notion are MANDATORY — a failed or empty
// Notion fetch throws and fails the stage. GitHub / portfolio / footprint are
// OPTIONAL: turned-off ones are skipped (○), failed ones logged (✗) — either
// way their section is null and the stage carries on.
// `toggles`/`impls` are injectable for tests; callers use the defaults.
export async function collectStage1(profile, toggles = stage1Fetchers(), impls = DEFAULT_IMPLS) {
  const names = Object.keys(impls);
  const settled = await Promise.allSettled(
    names.map((name) => (toggles[name] === false ? Promise.resolve(DISABLED) : impls[name](profile)))
  );

  const results = {};
  settled.forEach((r, i) => {
    const name = names[i];
    if (r.status === "fulfilled" && r.value === DISABLED) {
      results[name] = null;
      console.log(`  ○ ${name} (off — set STAGE1_${name.toUpperCase()}=on to enable)`);
    } else if (r.status === "fulfilled" && r.value != null) {
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

  if (!results.notion) {
    throw new Error(
      "Stage 1: the Notion read is mandatory — fix NOTION_TOKEN / DB sharing and re-run. (GitHub, portfolio, and footprint are optional and can be toggled off.)"
    );
  }
  return results;
}

// Enrich profile.json with dynamic data. Skips when enriched.json is fresh.
// Returns the enriched object (or null when only the fresh-cache read failed).
export async function runStage1(profile) {
  if (isFresh()) {
    console.log("✔ Stage 1: enriched.json is fresh — skipping fetch.");
    try {
      return JSON.parse(fs.readFileSync(ENRICHED_PATH, "utf8"));
    } catch {
      return null;
    }
  }

  console.log("• Stage 1: enriching profile ...");
  const toggles = stage1Fetchers();
  const results = await collectStage1(profile, toggles);

  const { valid } = mergeProfile(profile, results, new Date().toISOString());
  const enabled = Object.values(toggles).filter(Boolean).length;
  const okCount = Object.values(results).filter(Boolean).length;
  const offCount = Object.values(toggles).filter((v) => v === false).length;
  console.log(
    `✔ Stage 1: wrote enriched.json (${okCount}/${enabled} sources${offCount ? `, ${offCount} off` : ""}${valid ? "" : ", schema warnings logged"}).`
  );
  log(`run ok — ${okCount}/${enabled} sources${offCount ? `, ${offCount} off` : ""}${valid ? "" : ", schema warnings"}`);
  if (!valid) log("merge: enriched.json written with schema validation warnings");

  try {
    return JSON.parse(fs.readFileSync(ENRICHED_PATH, "utf8"));
  } catch {
    return null;
  }
}
