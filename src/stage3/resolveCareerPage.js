import fetch from "node-fetch";
import { detectATS } from "./ats/detectATS.js";
import { readJSON, writeJSONAtomic, CAREER_PAGES_PATH } from "../lib/jobsStore.js";
import { fetchTimeoutMs, careerPageNegativeTtlMs } from "../controller/index.js";

const norm = (s) => (s || "").toLowerCase().trim();

// Find a company's careers page and detect its ATS. Successful resolutions are
// cached in data/careerPages.json permanently (companies rarely switch ATS), so
// we only pay for discovery once per company. FAILED lookups (url:null) expire
// after the controller's negative TTL so a transient Tavily outage or missing
// key doesn't permanently mark a company unresolvable.

// A cached entry is usable if it resolved a URL (permanent), or if it's a
// still-fresh negative entry (don't re-pay for discovery every run).
export function cacheEntryUsable(entry, now = Date.now()) {
  if (!entry) return false;
  if (entry.url) return true;
  const at = Date.parse(entry.resolvedAt || "");
  return Number.isFinite(at) && now - at < careerPageNegativeTtlMs();
}

async function tavilySearch(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY not set (needed to find career pages)");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, query, max_results: 5, search_depth: "basic" }),
    signal: AbortSignal.timeout(fetchTimeoutMs()),
  });
  if (!res.ok) throw new Error(`Tavily search HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => r.url).filter(Boolean);
}

// Aggregator/job-board domains are last-resort picks: LinkedIn blocks bots
// (extract comes back empty → guaranteed "manual"), and a generic board result
// can belong to a different company entirely — the company's own page is the
// only URL the ATS detector or title match can trust.
const AGGREGATOR =
  /linkedin\.com|naukri\.com|indeed\.|ziprecruiter\.com|glassdoor\.|instahyre\.com|monster(?:india)?\.com|foundit\.in|shine\.com|timesjobs\.com|simplyhired\.com|wellfound\.com|cutshort\.io|hirist\.(?:com|tech)|irishjobs\.ie|jooble\.org|adzuna\./i;

// Prefer a known ATS URL, then a non-aggregator careers/jobs page, then any
// non-aggregator result, then an aggregator careers page — never a bare
// aggregator result (that's how "Plantz" resolved to another company's board).
export function pickCareersUrl(urls) {
  const careersish = (u) => /career|careers|jobs|join-us|work-with-us/i.test(u);
  return (
    urls.find((u) => /greenhouse\.io|jobs\.lever\.co/i.test(u)) ||
    urls.find((u) => careersish(u) && !AGGREGATOR.test(u)) ||
    urls.find((u) => !AGGREGATOR.test(u)) ||
    urls.find(careersish) ||
    null
  );
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "job-search-pipeline/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(fetchTimeoutMs()),
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
  if (cacheEntryUsable(cache[key])) return cache[key]; // hit (or fresh negative)

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
