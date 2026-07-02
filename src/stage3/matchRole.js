import Fuse from "fuse.js";
import { matchThreshold } from "../controller/index.js";

// Fuzzy-match a job title against live listing titles from an ATS. Fuse scores
// 0 (perfect) → 1 (no match); its `threshold` is the max score it will return,
// so ~0.4 means "reasonably close". Default comes from the pipeline controller.
// Returns { matched, best, score }.
export function matchRole(title, listingTitles, threshold = matchThreshold()) {
  const titles = (listingTitles || []).filter(Boolean);
  if (!title || titles.length === 0) return { matched: false, best: null, score: null };

  const fuse = new Fuse(titles, {
    includeScore: true,
    threshold,
    ignoreLocation: true, // match anywhere in the string, not just the start
    minMatchCharLength: 3,
  });
  const results = fuse.search(title);
  if (results.length === 0) return { matched: false, best: null, score: null };
  return { matched: true, best: results[0].item, score: results[0].score };
}
