import fetch from "node-fetch";

const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 15000;

// When no ATS is detected, pull the raw text of the career page via Tavily's
// extract endpoint (handles JS-rendered pages better than a plain fetch).
// Returns the extracted page text (may be "").
export async function genericExtract(url) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY not set (needed for generic career-page extract)");
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, urls: [url] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily extract HTTP ${res.status}`);
  const data = await res.json();
  const first = (data.results || [])[0];
  return (first?.raw_content || "").trim();
}
