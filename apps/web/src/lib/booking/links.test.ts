import { describe, it, expect } from "vitest";
import { newCancelToken } from "@bis/db";
import { bookingMoveUrl, bookingCancelUrl, isBookingToken } from "./links";

describe("the customer's own booking links (F-048)", () => {
  it("the move link sits beside the cancel link, on the same origin and token, in the customer's language (mutation: drop ?locale=es → FAILS)", () => {
    expect(bookingMoveUrl("https://x.example", "pub1", "tok", "en")).toBe("https://x.example/b/pub1/move/tok");
    expect(bookingMoveUrl("https://x.example", "pub1", "tok", "es")).toBe("https://x.example/b/pub1/move/tok?locale=es");
    expect(bookingCancelUrl("https://x.example", "pub1", "tok", "en")).toBe("https://x.example/b/pub1/cancel/tok");
    expect(bookingCancelUrl("https://x.example", "pub1", "tok", "es")).toBe("https://x.example/b/pub1/cancel/tok?locale=es");
  });

  it("no origin, no link: \"\", the empty-means-omit shape every template already honours (never \"null/b/…\")", () => {
    expect(bookingMoveUrl(null, "pub1", "tok", "es")).toBe("");
    expect(bookingCancelUrl(null, "pub1", "tok", "en")).toBe("");
  });

  it("a token is exactly newCancelToken's shape, so a malformed one is refused before any read (mutation: accept any 24 characters → \"l\" and \"0\" pass, FAILS)", () => {
    for (let i = 0; i < 50; i++) expect(isBookingToken(newCancelToken())).toBe(true);
    const good = newCancelToken();
    expect(isBookingToken(`${good}a`)).toBe(false);
    expect(isBookingToken(good.slice(1))).toBe(false);
    // `l`, `o`, `0` and `1` are not in the alphabet; neither is upper case.
    expect(isBookingToken(`l${good.slice(1)}`)).toBe(false);
    expect(isBookingToken(`0${good.slice(1)}`)).toBe(false);
    expect(isBookingToken(good.toUpperCase())).toBe(false);
    expect(isBookingToken("")).toBe(false);
    expect(isBookingToken(`${good.slice(0, 12)}/../${good.slice(16)}`)).toBe(false);
  });
});
