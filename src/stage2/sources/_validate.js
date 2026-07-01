import "dotenv/config";

// Per-source validation harness (satisfies the "confirm response shape, don't
// assume" step). Runs ONE source against a sample query and logs the normalized
// output plus the raw field names, so mappings can be confirmed before trusting
// the orchestrator.
//
//   node src/stage2/sources/_validate.js adzuna
//   node src/stage2/sources/_validate.js serpapi
const SAMPLE = {
  role: "MERN Stack Developer",
  roles: ["MERN Stack Developer", "Full Stack Developer"],
  keywords: "MERN Stack Developer",
  skills: ["react", "node", "mongodb", "express", "javascript"],
  locations: ["Chennai", "Coimbatore", "Bengaluru"],
  primaryLocation: "Chennai",
  remoteOk: false,
  country: "in",
  countryCode: "IN",
  salaryBandLpa: [4, 6],
};

const REGISTRY = {
  adzuna: () => import("./adzuna.js").then((m) => m.fetchAdzuna),
  jooble: () => import("./jooble.js").then((m) => m.fetchJooble),
  careerjet: () => import("./careerjet.js").then((m) => m.fetchCareerjet),
  jsearch: () => import("./jsearch.js").then((m) => m.fetchJSearch),
  serpapi: () => import("./serpapi.js").then((m) => m.fetchSerpApi),
  apifyAllJobs: () => import("./apifyAllJobsScraper.js").then((m) => m.fetchApifyAllJobs),
  arbeitnow: () => import("./arbeitnow.js").then((m) => m.fetchArbeitnow),
  theirstack: () => import("../mcp/theirstackQuery.js").then((m) => m.fetchTheirStack),
};

const name = process.argv[2];
if (!name || !REGISTRY[name]) {
  console.error(`Usage: node src/stage2/sources/_validate.js <${Object.keys(REGISTRY).join("|")}>`);
  process.exit(1);
}

const fetchFn = await REGISTRY[name]();
try {
  const jobs = await fetchFn(SAMPLE);
  console.log(`\n${name}: ${jobs.length} job(s)`);
  if (jobs[0]) {
    const { raw, ...normalized } = jobs[0];
    console.log("normalized[0]:", JSON.stringify(normalized, null, 2));
    console.log("raw[0] keys:", raw ? Object.keys(raw).join(", ") : "(none captured)");
  }
} catch (e) {
  console.error(`${name} failed:`, e.message);
  process.exit(1);
}
