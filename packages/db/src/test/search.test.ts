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

  it("strips % and * (ILIKE/PostgREST wildcards) so a query matches literally", () => {
    // % is an ILIKE wildcard and * is PostgREST's own alias for it. A user
    // typing one must not silently turn their search into "match everything".
    expect(sanitizeSearchTerm("a%b*d")).toBe("abd");
    expect(sanitizeSearchTerm("back\\slash")).toBe("backslash");
  });

  // D-009: `_` is ALSO an ILIKE wildcard (matches any one character), but
  // deleting it — the old behaviour — turned "john_doe" into "johndoe",
  // which is not even a substring of "john_doe" (there's a character
  // between "john" and "doe"), so the search for a real username NEVER
  // matched it. Escaping it instead (`\_`, ILIKE's own default escape
  // convention) keeps it literal without having to delete it.
  it("escapes an underscore for ILIKE instead of deleting it, so a literal '_' still matches (D-009, mutation: delete it like % → FAILS)", () => {
    expect(sanitizeSearchTerm("john_doe")).toBe("john\\_doe");
  });

  it("trims, collapses inner whitespace, and caps length", () => {
    expect(sanitizeSearchTerm("  rosa   trevino  ")).toBe("rosa trevino");
    expect(sanitizeSearchTerm("x".repeat(200))).toHaveLength(80);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeSearchTerm("   ")).toBe("");
  });
});
