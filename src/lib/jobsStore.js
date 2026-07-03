import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

export const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
export const CAREER_PAGES_PATH = path.join(DATA_DIR, "careerPages.json");

// Stable job identity: sha256 of company + title, each lowercased + trimmed
// before hashing. `source` is deliberately NOT part of the identity — the same
// role at the same company arriving from two aggregators (or from the Notion
// seed) is ONE job, not two. This SAME function must be used by every stage
// (sourcing, seed, dedupe) or ids won't line up. A separator prevents
// ("ab","c") colliding with ("a","bc").
export function hashId(company, title) {
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  return crypto
    .createHash("sha256")
    .update([norm(company), norm(title)].join("|"))
    .digest("hex");
}

// Map a normalized source job (from Stage 2 fetchers) → a data/jobs.json entry.
export function toJobEntry(job, sourcedAt) {
  return {
    id: hashId(job.company, job.title),
    title: job.title,
    company: job.company,
    url: job.url || "",
    source: job.source,
    location: job.location || "",
    postedAt: job.postedAt || null,
    score: job.score ?? 0,
    salary: job.salaryText || null,
    growth: null, // reserved for a future company-growth signal
    sourcedAt: sourcedAt || new Date().toISOString(),
    verified: null, // null | "yes" | "no" | "manual"  (set by Stage 3)
    verifiedAt: null,
    pushedToNotion: false, // set true by Stage 4 after a successful write
  };
}

// ---- Generic JSON read + atomic write ------------------------------------

export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Write via temp-file + rename so a crash can never leave a half-written file.
// On Windows, rename-over-existing can transiently fail with EPERM/EACCES/EBUSY
// while antivirus or the search indexer briefly holds the destination open, so
// the rename is retried with backoff; each attempt is still atomic.
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function writeJSONAtomic(file, data, { retries = 10 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      const transient = e.code === "EPERM" || e.code === "EACCES" || e.code === "EBUSY";
      if (!transient || i >= retries) {
        try {
          fs.rmSync(tmp, { force: true }); // don't leave a stray tmp file behind
        } catch {
          /* best effort */
        }
        throw e;
      }
      sleepSync(20 * (i + 1));
    }
  }
}

export const readJobs = () => readJSON(JOBS_PATH, []);
export const writeJobs = (jobs) => writeJSONAtomic(JOBS_PATH, jobs);

// ---- Advisory lock (dir-based, atomic mkdir) -----------------------------

const LOCK_DIR = `${JOBS_PATH}.lock`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock({ retries = 100, delayMs = 100, staleMs = 30000 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.mkdirSync(LOCK_DIR); // atomic: fails if it already exists
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // Steal a lock left behind by a crashed process.
      try {
        if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > staleMs) {
          fs.rmdirSync(LOCK_DIR);
          continue;
        }
      } catch {
        /* lock vanished between calls — loop and retry mkdir */
      }
      await sleep(delayMs);
    }
  }
  throw new Error("Could not acquire jobs.json lock (held too long).");
}

const releaseLock = () => {
  try {
    fs.rmdirSync(LOCK_DIR);
  } catch {
    /* already released */
  }
};

// Safe read-modify-write of jobs.json under the lock. `mutator(jobs)` returns the
// next array to persist; its return value is written atomically and returned.
export async function updateJobs(mutator) {
  await acquireLock();
  try {
    const next = await mutator(readJobs());
    writeJobs(next);
    return next;
  } finally {
    releaseLock();
  }
}
