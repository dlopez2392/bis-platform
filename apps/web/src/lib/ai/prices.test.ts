import { describe, it, expect } from "vitest";
import { PRICES, isPricedModel, costMicroUsd, estimatedTokens } from "./prices";

describe("the price table (spec 3.5)", () => {
  it("gpt-4o-mini at $0.15 and $0.60 per million tokens, in micro-dollars (mutation: 150 instead of 150_000 -> FAILS)", () => {
    expect(PRICES["gpt-4o-mini"]).toEqual({ inputMicroUsdPerMTok: 150_000, outputMicroUsdPerMTok: 600_000 });
  });
  it("a post-call completion of 4,000 in and 200 out costs 720 micro-dollars (spec 3.4's $0.0007)", () => {
    expect(costMicroUsd("gpt-4o-mini", 4000, 200)).toBe(720);
  });
  it("rounds UP, so a tiny call is never free (mutation: Math.round -> 0 -> FAILS)", () => {
    expect(costMicroUsd("gpt-4o-mini", 1, 0)).toBe(1);
  });
  it("only a model in the table is priced, and never a prototype name (mutation: `model in PRICES` -> 'toString' passes -> FAILS)", () => {
    expect([isPricedModel("gpt-4o-mini"), isPricedModel("gpt-9"), isPricedModel("toString"), isPricedModel("")]).toEqual([true, false, false, false]);
  });
  it("estimates a token per four characters, rounding up (mutation: Math.floor -> FAILS)", () => {
    expect([estimatedTokens(0), estimatedTokens(1), estimatedTokens(8), estimatedTokens(9)]).toEqual([0, 1, 2, 3]);
  });
});
