export type Channel = "Direct" | "Google" | "Bing" | "DuckDuckGo" | "Yahoo" | "Social" | "Other websites";

const SEARCH: [RegExp, Channel][] = [
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"], [/(^|\.)yahoo\.com$/, "Yahoo"],
];
const SOCIAL = /(^|\.)(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com)$/;

/** The words a business owner reads for a referrer hostname. Shared by the
 *  Website section and, later, the leads report, so "Google" means one thing. */
export function channelOf(referrerHostname: string): Channel {
  const host = referrerHostname.trim().toLowerCase();
  if (host === "") return "Direct";
  for (const [re, channel] of SEARCH) if (re.test(host)) return channel;
  if (SOCIAL.test(host)) return "Social";
  return "Other websites";
}
