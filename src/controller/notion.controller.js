import { ensureJobHuntDb } from "../lib/notionJobHunt.js";

// Notion controller — the single policy point for Notion database access.
//
// Policy: the 🎯 Job Hunt DB is the ONLY Notion DB the pipeline uses, and it is
// MANDATORY — it is the pipeline's whole output target, so it is ensured (found
// or auto-created) and a resolution failure is a hard error. Skill Levels and
// LinkedIn Posts were removed 2026-07-02 (user decision: not required for the
// job search). Any DB added here as required:false is optional by contract —
// its failure or absence must never stop a stage.
//
// This module must never import the Notion client (the pipeline touches Notion
// only in Stage 1 and Stage 4); callers pass their client instance in.

export const NOTION_DBS = {
  jobHunt: {
    label: "Job Hunt",
    required: true,
    envVar: "NOTION_JOBHUNT_DB",
    // Found or auto-created via ensureJobHuntDb; throws only when creation is
    // impossible (nothing shared with the integration).
    ensure: (notion, opts) => ensureJobHuntDb(notion, opts),
  },
};

// Resolve one DB id under the policy above.
//   required DB → resolves via its `ensure` hook (or env/default) and THROWS
//                 when unresolvable: the caller must not continue without it.
//   optional DB → returns the configured id, or null meaning "skip this DB".
export async function resolveNotionDb(notion, key, opts = {}) {
  const spec = NOTION_DBS[key];
  if (!spec) throw new Error(`notion.controller: unknown Notion DB "${key}"`);

  if (spec.ensure) return spec.ensure(notion, opts);

  const id = process.env[spec.envVar] || spec.defaultId || null;
  if (!id && spec.required) {
    throw new Error(`notion.controller: "${spec.label}" is mandatory but has no id (set ${spec.envVar})`);
  }
  return id;
}
