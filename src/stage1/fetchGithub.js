import { Octokit } from "octokit";

const DEFAULT_USER = "aravindworkzone";
// The public events API only covers roughly the last 90 days / 300 events.
const COMMIT_WINDOW_DAYS = 90;
// Per-request abort timeout so a stalled connection can't hang the pipeline.
const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 15000;
const req = () => ({ request: { signal: AbortSignal.timeout(TIMEOUT_MS) } });

function pickRepos(repos) {
  return repos.map((r) => ({
    name: r.name,
    description: r.description ?? null,
    language: r.language ?? null,
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    isFork: !!r.fork,
    updatedAt: r.updated_at ?? null,
    url: r.html_url,
    topics: r.topics ?? [],
  }));
}

// Count commits from recent public PushEvents → a cheap recent-activity signal
// without hitting every repo. Best-effort: never throws.
async function recentCommitActivity(octokit, username) {
  const perRepo = new Map();
  let total = 0;
  try {
    const events = await octokit.paginate("GET /users/{username}/events/public", {
      username,
      per_page: 100,
      ...req(),
    });
    for (const ev of events) {
      if (ev.type !== "PushEvent") continue;
      const n = ev.payload?.commits?.length ?? 0;
      total += n;
      const repo = ev.repo?.name ?? "unknown";
      perRepo.set(repo, (perRepo.get(repo) || 0) + n);
    }
  } catch {
    /* activity is best-effort */
  }
  return {
    windowDays: COMMIT_WINDOW_DAYS,
    totalRecentCommits: total,
    perRepo: [...perRepo.entries()]
      .map(([repo, commits]) => ({ repo, commits }))
      .sort((a, b) => b.commits - a.commits),
  };
}

// Pinned repos need GraphQL (requires a token). Returns [] if unavailable.
async function pinnedRepoNames(octokit, username) {
  try {
    const query = `query($login:String!){ user(login:$login){ pinnedItems(first:6, types:REPOSITORY){ nodes{ ... on Repository { name } } } } }`;
    const data = await octokit.graphql(query, { login: username, ...req() });
    return (data?.user?.pinnedItems?.nodes || []).map((n) => n.name).filter(Boolean);
  } catch {
    return [];
  }
}

// Pull the first few meaningful lines out of a README as a highlight.
function firstMeaningful(markdown) {
  const kept = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^!\[/.test(line)) continue; // image
    if (/^<.*>$/.test(line)) continue; // bare html tag
    const clean = line
      .replace(/^#+\s*/, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`>]/g, "")
      .trim();
    if (clean) kept.push(clean);
    if (kept.length >= 3) break;
  }
  return kept.join(" — ");
}

async function readmeHighlights(octokit, username, repoNames) {
  const out = [];
  for (const repo of repoNames.slice(0, 5)) {
    try {
      const res = await octokit.rest.repos.getReadme({ owner: username, repo, ...req() });
      const md = Buffer.from(res.data.content, "base64").toString("utf8");
      const excerpt = firstMeaningful(md);
      if (excerpt) out.push({ repo, excerpt: excerpt.slice(0, 300) });
    } catch {
      /* repo may have no README */
    }
  }
  return out;
}

// Returns a githubActivity object or null on total failure.
export async function fetchGithub() {
  try {
    const username = process.env.GITHUB_USERNAME || DEFAULT_USER;
    // Works unauthenticated for public data (low rate limit); a token raises the
    // limit and enables the pinned-repos GraphQL query.
    // Disable the bundled retry/throttle plugins so a stalled request fails fast
    // (honoring the abort timeout) instead of retrying with backoff — this is a
    // best-effort enrichment source, so we'd rather return null than hang.
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
      retry: { enabled: false },
      throttle: { enabled: false },
    });

    const { data: user } = await octokit.rest.users.getByUsername({ username, ...req() });
    const repoPages = await octokit.paginate(octokit.rest.repos.listForUser, {
      username,
      sort: "updated",
      per_page: 100,
      ...req(),
    });
    const repos = pickRepos(repoPages);

    const commitActivity = await recentCommitActivity(octokit, username);

    let highlightRepos = await pinnedRepoNames(octokit, username);
    if (highlightRepos.length === 0) {
      highlightRepos = repos.filter((r) => !r.isFork).slice(0, 3).map((r) => r.name);
    }
    const highlights = await readmeHighlights(octokit, username, highlightRepos);

    return {
      username,
      profile: {
        name: user.name ?? null,
        bio: user.bio ?? null,
        company: user.company ?? null,
        location: user.location ?? null,
        followers: user.followers ?? 0,
        following: user.following ?? 0,
        publicRepos: user.public_repos ?? 0,
        htmlUrl: user.html_url,
      },
      repos,
      commitActivity,
      readmeHighlights: highlights,
    };
  } catch (err) {
    console.warn(`  [github] ${err.message}`);
    return null;
  }
}
