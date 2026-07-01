// Detect whether a career page is powered by Greenhouse or Lever, from the URL
// and (optionally) the page HTML. Many company career pages aren't the ATS URL
// themselves but *embed* a Greenhouse/Lever board, so we also scan the HTML for
// the board token.
//
// Returns { atsType: "greenhouse"|"lever"|null, token?, company? }
//   greenhouse → { token }        (board token for boards-api.greenhouse.io)
//   lever      → { company }      (company slug for api.lever.co)

const GH_URL = /(?:job-)?boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i;
const GH_EMBED = /grnhse\.com\/[^"'\s]*?for=([a-z0-9_-]+)/i;
const LEVER_URL = /jobs\.lever\.co\/([a-z0-9_-]+)/i;

export function detectATS(url = "", html = "") {
  // 1. Direct ATS URL.
  let m = url.match(GH_URL);
  if (m && /greenhouse\.io/i.test(url)) return { atsType: "greenhouse", token: m[1] };
  m = url.match(LEVER_URL);
  if (m) return { atsType: "lever", company: m[1] };

  // 2. Career page that embeds an ATS board — scan the HTML.
  if (html) {
    m = html.match(GH_URL) || html.match(GH_EMBED);
    if (m) return { atsType: "greenhouse", token: m[1] };
    m = html.match(LEVER_URL);
    if (m) return { atsType: "lever", company: m[1] };
  }

  return { atsType: null };
}
