import fetch from "node-fetch";
import { detectATS } from "./ats/detectATS.js";
import { readJSON, writeJSONAtomic, CAREER_PAGES_PATH } from "../lib/jobsStore.js";

const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 15000;
const norm = (s) => (s || "").toLowerCase().trim();

// Find a company's careers page and detect its ATS. Results are cached in
// data/careerPages.json permanently (companies rarely switch ATS), so we only pay
// for discovery once per company across all runs.

async function tavilySearch(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY not set (needed to find career pages)");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, query, max_results: 5, search_depth: "basic" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily search HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => r.url).filter(Boolean);
}

// Prefer a known ATS URL, then a careers/jobs page, else the first result.
function pickCareersUrl(urls) {
  return (
    urls.find((u) => /greenhouse\.io|jobs\.lever\.co/i.test(u)) ||
    urls.find((u) => /career|careers|jobs|join-us|work-with-us/i.test(u)) ||
    urls[0] ||
    null
  );
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "job-search-pipeline/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}

// Returns { company, url, atsType, token, leverCompany, resolvedAt }.
export async function resolveCareerPage(company) {
  const cache = readJSON(CAREER_PAGES_PATH, {});
  const key = norm(company);
  if (cache[key]) return cache[key]; // permanent cache hit

  let url = null;
  let det = { atsType: null };
  try {
    const urls = await tavilySearch(`${company} careers jobs`);
    url = pickCareersUrl(urls);
    if (url) {
      det = detectATS(url);
      if (!det.atsType) det = detectATS(url, await fetchHtml(url)); // scan for embedded board
    }
  } catch {
    /* discovery failed — cache the miss so we don't retry every run */
  }

  const resolved = {
    company,
    url: url || null,
    atsType: det.atsType || null,
    token: det.token || null,
    leverCompany: det.company || null,
    resolvedAt: new Date().toISOString(),
  };
  cache[key] = resolved;
  writeJSONAtomic(CAREER_PAGES_PATH, cache);
  return resolved;
}
