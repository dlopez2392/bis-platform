// Pure, database-free by design. The real-query proof that this sanitizer
// actually fixes the interpolated .or() filter lives in contacts.test.ts's
// existing search cycle — folded in there rather than opening a fixture
// account of its own, because blueprints.test.ts is contention-marginal and
// one extra withTestAccount cycle tips it into a 20s timeout.
import { describe, it, expect } from "vitest";
import { sanitizeSearchTerm } from "../search-term";

describe("sanitizeSearchTerm", () => {
  it("strips every character that breaks PostgREST's filter grammar", () => {
    // A double quote or comma terminates the operand inside an interpolated
    // .or() string — contacts.ts:23-49 documents a real past incident where a
    // broken filter came back as "no match" instead of an error.
    expect(sanitizeSearchTerm(`ro"se,(x)`)).toBe("rosex");
  });

  it("strips ILIKE and PostgREST wildcards so a query matches literally", () => {
    // % and _ are ILIKE wildcards; * is PostgREST's own alias for %. A user
    // typing one must not silently turn their search into "match everything".
    expect(sanitizeSearchTerm("a%b_c*d")).toBe("abcd");
    expect(sanitizeSearchTerm("back\\slash")).toBe("backslash");
  });

  it("trims, collapses inner whitespace, and caps length", () => {
    expect(sanitizeSearchTerm("  rosa   trevino  ")).toBe("rosa trevino");
    expect(sanitizeSearchTerm("x".repeat(200))).toHaveLength(80);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeSearchTerm("   ")).toBe("");
  });
});
