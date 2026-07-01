import "dotenv/config";
import { buildProfile, PROFILE_PATH } from "./buildProfile.js";

// Manual refresh: force-regenerate data/profile.json from the current resume,
// ignoring any existing profile. Same effect as deleting profile.json first.
buildProfile()
  .then((p) => console.log(`✅ Rebuilt profile for ${p.basics?.name ?? "candidate"} → ${PROFILE_PATH}`))
  .catch((err) => {
    console.error("❌", err.message);
    process.exit(1);
  });
