import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EnrichedSchema } from "../schema/enrichedSchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
export const ENRICHED_PATH = path.join(DATA_DIR, "enriched.json");

// Merge the base profile with the four fetcher outputs (any of which may be null),
// validate against EnrichedSchema, and write data/enriched.json.
// Returns { data, valid }. Partial enrichment is always written — a schema
// mismatch downgrades to writing the raw merge with a logged warning, so nothing
// that succeeded is lost. `outPath` is injectable for tests.
export function mergeProfile(profile, { notion, github, portfolio, footprint }, enrichedAt, outPath = ENRICHED_PATH) {
  const merged = {
    ...profile,
    enrichedAt: enrichedAt || new Date().toISOString(),
    notionData: notion ?? null,
    githubActivity: github ?? null,
    portfolioExtras: portfolio ?? null,
    publicFootprint: footprint ?? null,
  };

  const parsed = EnrichedSchema.safeParse(merged);
  let toWrite = merged;
  if (parsed.success) {
    toWrite = parsed.data;
  } else {
    const issues = parsed.error.issues
      .map((i) => `    - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.warn(`  [merge] schema validation warnings:\n${issues}`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(toWrite, null, 2) + "\n", "utf8");
  return { data: toWrite, valid: parsed.success };
}
