import { z } from "zod";
import { ProfileSchema } from "../profile/schema.js";

// The enriched profile = Stage 0's locked profile shape + four dynamic sections,
// each of which is null when its fetcher failed (partial enrichment is allowed).
// We reuse ProfileSchema so the base fields keep Stage 0's discipline without
// duplicating (or touching) that file.

// A Notion page flattened to { propertyName: value }. Column types vary per DB,
// so values are permissive.
const NotionRecord = z.record(z.string(), z.any());

// Only the Job Hunt DB is read (Skill Levels / LinkedIn Posts removed
// 2026-07-02 — not required for the search).
const NotionData = z
  .object({
    jobHunt: z.array(NotionRecord),
  })
  .nullable();

const GithubActivity = z
  .object({
    username: z.string(),
    profile: z.object({
      name: z.string().nullable(),
      bio: z.string().nullable(),
      company: z.string().nullable(),
      location: z.string().nullable(),
      followers: z.number(),
      following: z.number(),
      publicRepos: z.number(),
      htmlUrl: z.string(),
    }),
    repos: z.array(
      z.object({
        name: z.string(),
        description: z.string().nullable(),
        language: z.string().nullable(),
        stars: z.number(),
        forks: z.number(),
        isFork: z.boolean(),
        updatedAt: z.string().nullable(),
        url: z.string(),
        topics: z.array(z.string()),
      })
    ),
    commitActivity: z.object({
      windowDays: z.number(),
      totalRecentCommits: z.number(),
      perRepo: z.array(z.object({ repo: z.string(), commits: z.number() })),
    }),
    readmeHighlights: z.array(z.object({ repo: z.string(), excerpt: z.string() })),
  })
  .nullable();

const PortfolioExtras = z
  .object({
    url: z.string(),
    title: z.string().nullable(),
    headings: z.array(z.string()),
    newSnippets: z.array(z.string()),
  })
  .nullable();

const PublicFootprint = z
  .object({
    query: z.string(),
    source: z.enum(["exa", "tavily"]),
    results: z.array(
      z.object({
        title: z.string().nullable(),
        url: z.string(),
        snippet: z.string().nullable(),
      })
    ),
  })
  .nullable();

export const EnrichedSchema = ProfileSchema.extend({
  enrichedAt: z.string(), // ISO timestamp of the enrichment run
  notionData: NotionData,
  githubActivity: GithubActivity,
  portfolioExtras: PortfolioExtras,
  publicFootprint: PublicFootprint,
});
