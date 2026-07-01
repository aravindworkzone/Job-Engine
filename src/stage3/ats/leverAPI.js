import { httpJSON } from "../../stage2/sources/_shared.js";

// Public Lever postings API — no auth. Returns live listings for a company slug.
export async function leverListings(company) {
  const data = await httpJSON(
    `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`
  );
  const arr = Array.isArray(data) ? data : [];
  return arr.map((p) => ({
    title: p.text,
    location: p.categories?.location || "",
    url: p.hostedUrl,
  }));
}
