import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProvider } from "../llm/index.js";
import { ProfileSchema } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

export const RESUME_PATH = path.join(DATA_DIR, "resume.pdf");
export const PROFILE_PATH = path.join(DATA_DIR, "profile.json");

const INSTRUCTIONS = `You are a resume parser. Extract the candidate's profile from the provided resume and return it in the exact JSON shape requested.

Rules:
- Use only information present in the resume. Do not invent facts.
- For any single field you cannot find, use null. For any list you cannot fill, use an empty array.
- "links": every URL in the resume (GitHub, LinkedIn, portfolio, personal site, ...), each with a short label.
- "skills": a flat, de-duplicated list of concrete skills (languages, frameworks, tools, databases).
- "targetRoles": 3-6 job titles this candidate is a strong fit for, inferred from their experience and skills (e.g. "Full Stack Developer", "MERN Developer", "Backend Engineer").`;

// Reads data/resume.pdf, sends it to the configured LLM provider (LLM_PROVIDER)
// with the locked schema, and writes data/profile.json. The provider layer
// handles engine differences (Claude reads the PDF natively; Groq text-extracts
// it first) — both return the same schema-validated shape.
export async function buildProfile() {
  if (!fs.existsSync(RESUME_PATH)) {
    throw new Error(
      `Resume not found at ${RESUME_PATH}\n  → Drop your resume there as "resume.pdf" and run again.`
    );
  }

  const provider = getProvider();
  console.log(`  engine: ${provider.describe()}`);

  const profile = await provider.extractProfileFromPdf({
    pdfPath: RESUME_PATH,
    instructions: INSTRUCTIONS,
    schema: ProfileSchema,
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2) + "\n", "utf8");
  return profile;
}
