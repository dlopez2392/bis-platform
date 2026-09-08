import { describe, it, expect } from "vitest";
import { channelOf } from "./channel";

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
});
