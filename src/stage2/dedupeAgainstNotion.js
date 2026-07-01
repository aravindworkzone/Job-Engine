import { hashId } from "../lib/jobsStore.js";

// NOTE: filename kept for continuity, but dedupe no longer queries Notion.
// data/jobs.json is now the single source of truth, so we dedupe candidate jobs
// by their stable id (hashId of company+title+source) against existing entries.
//
// Given normalized source jobs and the current jobs.json array, return only the
// genuinely new ones as jobs.json entries — de-duplicated against BOTH what's
// already stored and other candidates in the same batch.
export function selectNewJobs(candidates, existingJobs, toEntry) {
  const seen = new Set(existingJobs.map((j) => j.id));
  const fresh = [];
  for (const job of candidates) {
    const id = hashId(job.company, job.title, job.source);
    if (seen.has(id)) continue; // already stored, or already added this batch
    seen.add(id);
    fresh.push(toEntry(job));
  }
  return fresh;
}
