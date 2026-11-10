import { describe, it, expect } from "vitest";
import { PRICES, isPricedModel, costMicroUsd, estimatedTokens } from "./prices";
import { TEXT_MODEL } from "./models";

describe("the price table (spec 3.5)", () => {
  it("gpt-6-luna at $0.10 and $0.50 per million tokens, in micro-dollars, and it is the only row (mutation: 100 instead of 100_000 -> FAILS)", () => {
    expect(PRICES).toEqual({ "gpt-6-luna": { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 } });
  });
  it("the text model is priced, so the gateway lets it through (mutation: TEXT_MODEL = 'gpt-6' -> FAILS)", () => {
    expect(isPricedModel(TEXT_MODEL)).toBe(true);
  });
  it("a post-call completion of 4,000 in and 200 out costs 500 micro-dollars", () => {
    expect(costMicroUsd("gpt-6-luna", 4000, 200)).toBe(500);
  });
  it("rounds UP, so a tiny call is never free (mutation: Math.round -> 0 -> FAILS)", () => {
    expect(costMicroUsd("gpt-6-luna", 1, 0)).toBe(1);
  });
  it("only a model in the table is priced, and never a prototype name or the retired gpt-4o-mini (mutation: `model in PRICES` -> 'toString' passes -> FAILS)", () => {
    expect([isPricedModel("gpt-6-luna"), isPricedModel("gpt-4o-mini"), isPricedModel("gpt-9"), isPricedModel("toString"), isPricedModel("")]).toEqual([true, false, false, false, false]);
  });
  it("estimates a token per four characters, rounding up (mutation: Math.floor -> FAILS)", () => {
    expect([estimatedTokens(0), estimatedTokens(1), estimatedTokens(8), estimatedTokens(9)]).toEqual([0, 1, 2, 3]);
  });
});
