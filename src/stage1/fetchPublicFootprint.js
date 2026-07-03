import fetch from "node-fetch";
import Exa from "exa-js";
import { fetchTimeoutMs } from "../controller/index.js";

// Query = who the candidate is + what they're targeting + where. Purpose is to
// sanity-check the public online footprint, NOT to match jobs.
function buildQuery(profile) {
  const b = profile.basics || {};
  const role = (profile.targetRoles && profile.targetRoles[0]) || b.headline || "developer";
  return [b.name, role, b.location].filter(Boolean).join(" ");
}

const TIMEOUT_MS = fetchTimeoutMs();
const clip = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 400) || null;

// Primary source: Exa. Returns a footprint object or null if it yields nothing.
async function viaExa(query) {
  if (!process.env.EXA_API_KEY) return null;
  const exa = new Exa(process.env.EXA_API_KEY);
  const res = await exa.searchAndContents(query, { numResults: 5, text: true });
  const results = (res.results || []).map((r) => ({
    title: r.title ?? null,
    url: r.url,
    snippet: clip(r.text),
  }));
  return results.length ? { query, source: "exa", results } : null;
}

// Fallback: Tavily via its REST API (no SDK needed — uses node-fetch).
async function viaTavily(query) {
  if (!process.env.TAVILY_API_KEY) return null;
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 5,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  const results = (data.results || []).map((r) => ({
    title: r.title ?? null,
    url: r.url,
    snippet: clip(r.content),
  }));
  return results.length ? { query, source: "tavily", results } : null;
}

// Returns publicFootprint or null. Exa first; Tavily only if Exa gives nothing.
export async function fetchPublicFootprint(profile) {
  const query = buildQuery(profile);
  try {
    let out = null;
    try {
      out = await viaExa(query);
    } catch (e) {
      console.warn(`  [footprint] exa: ${e.message}`);
    }
    if (!out) {
      try {
        out = await viaTavily(query);
      } catch (e) {
        console.warn(`  [footprint] tavily: ${e.message}`);
      }
    }
    return out; // null when both produced nothing
  } catch (err) {
    console.warn(`  [footprint] ${err.message}`);
    return null;
  }
}
