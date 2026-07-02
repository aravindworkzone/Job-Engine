import { hashId } from "../lib/jobsStore.js";

// NOTE: filename kept for continuity, but dedupe no longer queries Notion.
// data/jobs.json is now the single source of truth, so we dedupe candidate jobs
// by their stable id (hashId of company+title — source-independent) against
// existing entries. The same role from two aggregators collapses to one entry.
//
// Since the pipeline start wipes jobs.json, the leads already pushed to Notion
// would otherwise re-enter as "new" and get re-pushed as duplicates. Stage 1's
// (mandatory, allowed) Notion read puts the Job Hunt rows into enriched.json —
// hash them into the same source-independent ids Stage 2 dedupes by.
export function notionSeenIds(enriched) {
  const rows = enriched?.notionData?.jobHunt || [];
  return new Set(
    rows.filter((r) => r.Company || r.Role).map((r) => hashId(r.Company, r.Role))
  );
}

// Given normalized source jobs and the current jobs.json array, return only the
// genuinely new ones as jobs.json entries — de-duplicated against what's
// already stored, other candidates in the same batch, AND (via alreadyInNotion,
// see notionSeenIds) rows that already live in the Notion Job Hunt DB.
export function selectNewJobs(candidates, existingJobs, toEntry, alreadyInNotion = new Set()) {
  const seen = new Set([...existingJobs.map((j) => j.id), ...alreadyInNotion]);
  const fresh = [];
  for (const job of candidates) {
    const id = hashId(job.company, job.title);
    if (seen.has(id)) continue; // already stored, or already added this batch
    seen.add(id);
    fresh.push(toEntry(job));
  }
  return fresh;
}
