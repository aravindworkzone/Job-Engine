import { z } from "zod";

// The locked shape of data/profile.json. Every downstream stage (cold emails,
// LinkedIn DMs, resume tailoring) reads from this instead of re-asking for the
// user's own info. Fields that may legitimately be absent from a resume are
// nullable (single values) or default to empty arrays (lists) — the parser is
// told to use null / [] rather than invent data.
export const ProfileSchema = z.object({
  basics: z.object({
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    headline: z.string().nullable(),
    summary: z.string().nullable(),
  }),
  // Every URL found in the resume, each with a short label ("GitHub", "LinkedIn",
  // "Portfolio", ...). A later stage fetches these; Stage 0 only records them.
  links: z.array(
    z.object({
      label: z.string(),
      url: z.string(),
    })
  ),
  // Flat, de-duplicated list of concrete skills (languages, frameworks, tools, DBs).
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      location: z.string().nullable(),
      highlights: z.array(z.string()),
    })
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      techStack: z.array(z.string()),
      url: z.string().nullable(),
    })
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      gpa: z.string().nullable(),
    })
  ),
  certifications: z.array(z.string()),
  // 3-6 job titles this candidate is a strong fit for, inferred from the resume.
  targetRoles: z.array(z.string()),
});
