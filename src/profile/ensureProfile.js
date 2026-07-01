import fs from "node:fs";
import { buildProfile, PROFILE_PATH } from "./buildProfile.js";

// The Stage 0 trigger. Runs as a side-effect of search-job, not as its own step.
//   - profile.json missing or empty  → generate it, then return it.
//   - profile.json already populated  → skip generation, just load and return it.
//
// There is no auto-refresh: once profile.json exists, editing your resume won't
// update it. To refresh, delete data/profile.json (or run `npm run profile:rebuild`)
// before the next run — that delete IS the refresh action.
export async function ensureProfile() {
  if (hasProfile()) {
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
    console.log(`✔ Using existing profile for ${profile.basics?.name ?? "candidate"}`);
    return profile;
  }

  console.log("• No profile found — generating from data/resume.pdf ...");
  const profile = await buildProfile();
  console.log(`✔ Generated profile for ${profile.basics?.name ?? "candidate"} → ${PROFILE_PATH}`);
  return profile;
}

// Missing file, empty/whitespace file, or anything that isn't a non-empty JSON
// object all count as "no profile" and trigger regeneration.
function hasProfile() {
  try {
    const raw = fs.readFileSync(PROFILE_PATH, "utf8").trim();
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}
