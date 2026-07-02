import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { fetchTimeoutMs } from "../controller/index.js";

const DEFAULT_URL = "https://aravind-mern.vercel.app";
const TIMEOUT_MS = fetchTimeoutMs();

// Lowercase corpus of everything already in profile.json, so we can drop
// portfolio text that merely repeats the resume.
function profileCorpus(profile) {
  const parts = [];
  const b = profile.basics || {};
  parts.push(b.name, b.headline, b.summary, b.location);
  (profile.skills || []).forEach((s) => parts.push(s));
  (profile.experience || []).forEach((e) => {
    parts.push(e.company, e.role);
    (e.highlights || []).forEach((h) => parts.push(h));
  });
  (profile.projects || []).forEach((p) => {
    parts.push(p.name, p.description);
    (p.techStack || []).forEach((t) => parts.push(t));
  });
  (profile.education || []).forEach((ed) => parts.push(ed.institution, ed.degree, ed.field));
  return parts.filter(Boolean).join(" \n ").toLowerCase();
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

// A snippet is "already known" if most of its longer words appear in the profile.
function alreadyKnown(text, corpus) {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  if (!words.length) return false;
  const overlap = words.filter((w) => corpus.includes(w)).length;
  return overlap / words.length > 0.6;
}

// Returns portfolioExtras or null on failure.
// NOTE: node-fetch + cheerio only see the server-sent HTML. aravind-mern.vercel.app
// is a client-rendered MERN SPA, so most text arrives via JS and won't be visible
// here — we still capture <title>, meta description, and any SSR/static text.
export async function fetchPortfolio(profile) {
  try {
    const url = process.env.PORTFOLIO_URL || DEFAULT_URL;
    const res = await fetch(url, {
      headers: { "user-agent": "job-search-pipeline/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();

    const title = norm($("title").first().text()) || null;
    const headings = [
      ...new Set($("h1,h2,h3").map((_, el) => norm($(el).text())).get().filter(Boolean)),
    ];

    // Candidate text blocks: headings, paragraphs, list items + meta description.
    const blocks = $("h1,h2,h3,h4,p,li")
      .map((_, el) => norm($(el).text()))
      .get();
    const metaDesc = $('meta[name="description"]').attr("content");
    const ogDesc = $('meta[property="og:description"]').attr("content");
    if (metaDesc) blocks.push(norm(metaDesc));
    if (ogDesc) blocks.push(norm(ogDesc));

    const corpus = profileCorpus(profile);
    const seen = new Set();
    const newSnippets = [];
    for (const t of blocks) {
      if (t.length < 15) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (alreadyKnown(t, corpus)) continue;
      newSnippets.push(t);
    }

    return { url, title, headings, newSnippets: newSnippets.slice(0, 40) };
  } catch (err) {
    console.warn(`  [portfolio] ${err.message}`);
    return null;
  }
}
