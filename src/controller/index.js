// Controller folder — the pipeline's single control plane. Every dynamic
// behavior lives here (and only here); stages import from this index and never
// hardcode policy, ids, thresholds, or limits themselves.
//
//   notion.controller.js   — Notion DB policy (Job Hunt mandatory, others optional)
//   search.controller.js   — what to search: locations, salary band, country,
//                            scoring weights, reject keywords, min score
//   pipeline.controller.js — how stages run: freshness windows, per-run caps,
//                            cache TTLs, timeouts, match threshold
//
// Everything is env-overridable at run time — see each controller for the vars.

export * from "./notion.controller.js";
export * from "./search.controller.js";
export * from "./pipeline.controller.js";
