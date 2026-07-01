import { httpJSON } from "../../stage2/sources/_shared.js";

// Public Greenhouse board API — no auth. Returns live listings for a board token.
export async function greenhouseListings(token) {
  const data = await httpJSON(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`
  );
  return (data.jobs || []).map((j) => ({
    title: j.title,
    location: j.location?.name || "",
    url: j.absolute_url,
  }));
}
