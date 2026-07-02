import fs from "node:fs";
import { buildProfile, PROFILE_PATH } from "./buildProfile.js";
import { ProfileSchema } from "./schema.js";

// The Stage 0 trigger. Runs as a side-effect of search-job, not as its own step.
//   - profile.json missing, empty, or schema-invalid → generate it, then return it.
//   - profile.json valid                             → skip generation, load and return it.
//
// There is no auto-refresh: once a valid profile.json exists, editing your resume
// won't update it. To refresh, delete data/profile.json (or run
// `npm run profile:rebuild`) before the next run — that delete IS the refresh action.
export async function ensureProfile({ profilePath = PROFILE_PATH } = {}) {
  if (hasProfile(profilePath)) {
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    console.log(`✔ Using existing profile for ${profile.basics?.name ?? "candidate"}`);
    return profile;
  }

  console.log("• No usable profile found — generating from data/resume.pdf ...");
  const profile = await buildProfile();
  console.log(`✔ Generated profile for ${profile.basics?.name ?? "candidate"} → ${PROFILE_PATH}`);
  return profile;
}

// Missing file, empty/whitespace file, unparsable JSON, or a JSON object that
// doesn't match the locked ProfileSchema all count as "no profile" and trigger
// regeneration — a drifted/corrupt profile is as good as a missing one, and
// letting it flow downstream would silently degrade every later stage.
export function hasProfile(filePath = PROFILE_PATH) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return false;
    const result = ProfileSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      console.warn(
        `  ! ${filePath} exists but doesn't match the profile schema — regenerating.`
      );
    }
    return result.success;
  } catch {
    return false;
  }
}
