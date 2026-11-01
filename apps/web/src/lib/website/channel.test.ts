import { describe, it, expect } from "vitest";
import { channelOf, aiAssistantNameOf } from "./channel";

/** Mutation: make SOCIAL require `^facebook\.com$` — the l.facebook.com row fails. */
describe("channelOf", () => {
  it.each([
    ["", "Direct"], ["google.com", "Google"], ["www.google.com.mx", "Google"], ["bing.com", "Bing"],
    ["duckduckgo.com", "DuckDuckGo"], ["search.yahoo.com", "Yahoo"],
    ["facebook.com", "Social"], ["l.facebook.com", "Social"], ["m.facebook.com", "Social"], ["instagram.com", "Social"],
    ["t.co", "Social"], ["linkedin.com", "Social"], ["youtube.com", "Social"], ["tiktok.com", "Social"],
    ["nextdoor.com", "Other websites"], ["yelp.com", "Other websites"],
  ])("%s → %s", (host, channel) => {
    expect(channelOf(host)).toBe(channel);
  });

  /**
   * F-157: an AI assistant's referral is its own channel, never folded into
   * the search engine whose domain it happens to sit under — gemini.google.com
   * is the one that was silently miscounted as Google before this. Mutation:
   * remove the AI_ASSISTANTS check (or run it after SEARCH) → gemini.google.com
   * reads "Google" again, FAILS.
   */
  it.each([
    ["chat.openai.com", "AI assistants"], ["chatgpt.com", "AI assistants"],
    ["gemini.google.com", "AI assistants"], ["perplexity.ai", "AI assistants"],
    ["www.perplexity.ai", "AI assistants"], ["copilot.microsoft.com", "AI assistants"],
    ["claude.ai", "AI assistants"],
  ])("%s → %s, not folded into Google/Other websites", (host, channel) => {
    expect(channelOf(host)).toBe(channel);
  });
});

// Production bug: site_traffic_breakdown (dimension="source") stores BARE
// values ("google", "direct", "facebook", "nextdoor", ...), never hostnames
// — every real row fell through to "Other websites" (mutation: drop the
// bare-value tables and run this against live data → "google" reads "Other
// websites", FAILS).
describe("channelOf — bare source values (not hostnames)", () => {
  it.each([
    ["google", "Google"], ["bing", "Bing"], ["duckduckgo", "DuckDuckGo"], ["yahoo", "Yahoo"],
    ["direct", "Direct"], ["", "Direct"],
    ["facebook", "Social"], ["instagram", "Social"], ["nextdoor", "Social"], ["tiktok", "Social"],
    ["x", "Social"], ["twitter", "Social"], ["linkedin", "Social"], ["youtube", "Social"], ["whatsapp", "Social"],
    ["chatgpt", "AI assistants"], ["perplexity", "AI assistants"], ["claude", "AI assistants"],
    ["gemini", "AI assistants"], ["copilot", "AI assistants"],
  ])("%s → %s", (bare, channel) => {
    expect(channelOf(bare)).toBe(channel);
  });

  it("a bare value is case/whitespace-insensitive, same as a hostname", () => {
    expect(channelOf("  Google  ")).toBe("Google");
  });

  it("null/undefined read as Direct, same as empty string (mutation: drop the null guard → throws)", () => {
    expect(channelOf(null as unknown as string)).toBe("Direct");
    expect(channelOf(undefined as unknown as string)).toBe("Direct");
  });

  it("hostnames still work unchanged alongside bare values (mutation: make bare-value lookup shadow the hostname path → nextdoor.com reads Social, FAILS)", () => {
    expect(channelOf("google.com")).toBe("Google");
    expect(channelOf("nextdoor.com")).toBe("Other websites");
  });
});

describe("aiAssistantNameOf", () => {
  /** The drawer's finer-grained name, for the SAME hostnames channelOf buckets
   *  as "AI assistants" — one list, two readers. Mutation: return the generic
   *  bucket name here too → "AI assistants" !== "Gemini", FAILS. */
  it.each([
    ["chat.openai.com", "ChatGPT"], ["chatgpt.com", "ChatGPT"],
    ["gemini.google.com", "Gemini"], ["perplexity.ai", "Perplexity"],
    ["copilot.microsoft.com", "Copilot"], ["claude.ai", "Claude"],
  ])("%s → %s", (host, name) => {
    expect(aiAssistantNameOf(host)).toBe(name);
  });

  it("a non-assistant hostname answers null", () => {
    expect(aiAssistantNameOf("google.com")).toBeNull();
  });
});
