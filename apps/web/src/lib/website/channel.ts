export type Channel =
  "Direct" | "Google" | "Bing" | "DuckDuckGo" | "Yahoo" | "Social" | "AI assistants" | "Other websites";

const SEARCH: [RegExp, Channel][] = [
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"], [/(^|\.)yahoo\.com$/, "Yahoo"],
];
const SOCIAL = /(^|\.)(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com)$/;

/**
 * F-157: the hostnames of the AI assistants a customer's own search or chat
 * can click through from, named — one list, two readers. `channelOf` below
 * buckets every one of these as the single "AI assistants" channel (the
 * Website section's rollup stays a small fixed set); `aiAssistantNameOf`
 * answers the SPECIFIC product name for the contact drawer's one line
 * ("Found through ChatGPT"), which is the more useful fact for one lead.
 *
 * Checked BEFORE `SEARCH` in `channelOf`: gemini.google.com would otherwise
 * match `(^|\.)google\.` and read as a Google referral — exactly the
 * miscount the plan names (`docs/crm-features.md` §4.3, rider 6).
 */
const AI_ASSISTANTS: [RegExp, string][] = [
  [/(^|\.)chat\.openai\.com$/, "ChatGPT"], [/(^|\.)chatgpt\.com$/, "ChatGPT"],
  [/(^|\.)gemini\.google\.com$/, "Gemini"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)copilot\.microsoft\.com$/, "Copilot"],
  [/(^|\.)claude\.ai$/, "Claude"],
];

// Production bug fix: `site_traffic_breakdown` (dimension="source") stores
// BARE values from Vercel Web Analytics' own `source` dimension — "google",
// "direct", "facebook", "nextdoor" — never hostnames (lib/vercel/web-
// analytics.ts's `aggregate("source", ...)` call; confirmed read-only, the
// sync itself is untouched). Every real row fell through the hostname-regex
// path straight to "Other websites": "From Google" read ~0% and the
// sentence said "found you on Other websites" against 1,664 real Google
// rows (Sep 1 – Oct 30). A bare value is checked FIRST, by exact match, so
// it can never be shadowed by (or shadow) the hostname patterns below.
// Note the one deliberate asymmetry: the bare source "nextdoor" is Vercel's
// own label for Nextdoor-app social traffic and reads Social, while the
// HOSTNAME "nextdoor.com" (someone linked from the review site itself)
// keeps reading "Other websites" — two different real-world referrals that
// happen to share a word, not an inconsistency.
const BARE_SEARCH: Record<string, Channel> = { google: "Google", bing: "Bing", duckduckgo: "DuckDuckGo", yahoo: "Yahoo" };
const BARE_SOCIAL = new Set([
  "facebook", "instagram", "nextdoor", "tiktok", "x", "twitter", "linkedin", "youtube", "whatsapp",
]);
const BARE_AI = new Set(["chatgpt", "perplexity", "claude", "gemini", "copilot"]);

/** The words a business owner reads for a referrer value — a hostname
 *  ("google.com") or, in production, Vercel's own bare source label
 *  ("google"). Shared by the Website section and, later, the leads report,
 *  so "Google" means one thing. */
export function channelOf(referrerHostname: string): Channel {
  const host = (referrerHostname ?? "").trim().toLowerCase();
  if (host === "" || host === "direct") return "Direct";
  if (host in BARE_SEARCH) return BARE_SEARCH[host]!;
  if (BARE_SOCIAL.has(host)) return "Social";
  if (BARE_AI.has(host)) return "AI assistants";
  if (AI_ASSISTANTS.some(([re]) => re.test(host))) return "AI assistants";
  for (const [re, channel] of SEARCH) if (re.test(host)) return channel;
  if (SOCIAL.test(host)) return "Social";
  return "Other websites";
}

/** The specific assistant's name for a referrer hostname `channelOf` would
 *  bucket as "AI assistants" — null for anything else, never guessed. */
export function aiAssistantNameOf(referrerHostname: string): string | null {
  const host = referrerHostname.trim().toLowerCase();
  for (const [re, name] of AI_ASSISTANTS) if (re.test(host)) return name;
  return null;
}
