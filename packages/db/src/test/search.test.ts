// Pure, database-free by design. The real-query proof that this sanitizer
// actually fixes the interpolated .or() filter lives in contacts.test.ts's
// existing search cycle — folded in there rather than opening a fixture
// account of its own, because blueprints.test.ts is contention-marginal and
// one extra withTestAccount cycle tips it into a 20s timeout.
import { describe, it, expect } from "vitest";
import { sanitizeSearchTerm, searchTermLength } from "../search-term";

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

  // Review correction: whitespace collapse used to run BEFORE character
  // removal, so "a ( b" — a single space on each side of a lone "(" —
  // removed the "(" and left the two now-adjacent spaces uncollapsed
  // ("a  b"), since each one was already a single-space run when the
  // collapse ran.
  it("collapses whitespace AFTER removing characters, not before (mutation: swap the order back → FAILS)", () => {
    expect(sanitizeSearchTerm("a ( b")).toBe("a b");
  });
});

describe("searchTermLength", () => {
  // The floor every "long enough to search" caller (the ⌘K palette,
  // api/accounts/[accountId]/search's own MIN_QUERY) must measure instead
  // of `sanitizeSearchTerm(value).length` — see that function's own doc
  // comment for why: a lone "_" escapes to TWO characters ("\_"), which
  // would clear a 2-character floor measured on the escaped form.
  it("measures the term BEFORE the underscore escape, not after (mutation: measure sanitizeSearchTerm's output instead → FAILS)", () => {
    expect(searchTermLength("_")).toBe(1);
    expect(searchTermLength("__")).toBe(2);
  });

  it("agrees with sanitizeSearchTerm everywhere there's no underscore to escape", () => {
    expect(searchTermLength("rosa")).toBe(sanitizeSearchTerm("rosa").length);
    expect(searchTermLength(`ro"se,(x)`)).toBe(sanitizeSearchTerm(`ro"se,(x)`).length);
  });
});
