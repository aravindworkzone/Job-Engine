import fetch from "node-fetch";
import { fetchTimeoutMs } from "../../controller/index.js";

// Per-request abort timeout so a stalled source can't hang the run (shared with
// Stage 1). Sourced from the pipeline controller (FETCH_TIMEOUT_MS).
export const TIMEOUT_MS = fetchTimeoutMs();
export const enc = encodeURIComponent;

const fmt = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${Math.round(n)}`);
function salaryFromRange(min, max) {
  if (min && max) return `${fmt(min)}–${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  if (max) return `up to ${fmt(max)}`;
  return null;
}

// The single shape every source returns. `raw` is kept for the validation harness
// and dropped before anything is written to Notion.
export function normalizeJob(source, j) {
  return {
    source,
    title: (j.title || "").trim(),
    company: (j.company || "").trim(),
    location: (j.location || "").trim(),
    description: (j.description || "").trim(),
    url: (j.url || "").trim(),
    remote: j.remote ?? null,
    salaryText: j.salaryText || salaryFromRange(j.salaryMin, j.salaryMax),
    salaryMin: j.salaryMin ?? null,
    salaryMax: j.salaryMax ?? null,
    postedAt: j.postedAt || null,
    raw: j.raw ?? null,
  };
}

export async function httpJSON(url, { method = "GET", headers = {}, body, timeoutMs } = {}) {
  const res = await fetch(url, {
    method,
    headers: { accept: "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs || TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// Run a fetch across the location cascade (free aggregators). One location erroring
// doesn't lose the others; only a total wipeout (no jobs, all errored) rethrows so
// the orchestrator can mark the source failed.
export async function collectLocations(locations, fetchOne) {
  const jobs = [];
  const errors = [];
  for (const loc of locations) {
    try {
      jobs.push(...(await fetchOne(loc)));
    } catch (e) {
      errors.push(e);
    }
  }
  if (jobs.length === 0 && errors.length) throw errors[0];
  return jobs;
}
