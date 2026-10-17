import { describe, it, expect } from "vitest";
import { parseNeverLogPattern, neverLogMatches, NEVER_LOG_MAX, type NeverLogPattern } from "@bis/db/never-log-rules";

/** S-06 part 2 (spec "The Never record list", "Pipeline order" 2, "Tests"). The real module, never a mock. */
describe("parseNeverLogPattern", () => {
  it("an address becomes its email key; a domain stays itself, lowercase (mutation: skip emailKey → '+tag' survives, FAILS)", () => {
    expect(parseNeverLogPattern("  Billing+Q3@Supplier.COM ")).toEqual({ pattern: "billing@supplier.com", kind: "address" });
    expect(parseNeverLogPattern("Supplier.com")).toEqual({ pattern: "supplier.com", kind: "domain" });
    expect(parseNeverLogPattern("mail.supplier.co")).toEqual({ pattern: "mail.supplier.co", kind: "domain" });
  });

  it("refuses everything else (mutation: accept a dotless domain → 'supplier' parses, FAILS)", () => {
    for (const bad of ["", "   ", "supplier", "@supplier.com", "a@@supplier.com", "a b@supplier.com", "a@supplier", "+x@supplier.com", "supplier..com", "-supplier.com", `${"a".repeat(250)}.com`, "a@b@c.com", "http://supplier.com"]) {
      expect(parseNeverLogPattern(bad), bad).toBeNull();
    }
  });

  it("the cap is 200 (spec; mutation: 100 → FAILS)", () => {
    expect(NEVER_LOG_MAX).toBe(200);
  });
});

describe("neverLogMatches", () => {
  const LIST: NeverLogPattern[] = [{ pattern: "billing@vendor.com", kind: "address" }, { pattern: "supplier.com", kind: "domain" }];

  it("an address entry matches the sender's email key exactly (mutation: compare the raw address → the +tag sender escapes, FAILS)", () => {
    expect(neverLogMatches(LIST, "billing@vendor.com")).toBe(true);
    expect(neverLogMatches(LIST, "billing+x@vendor.com")).toBe(true);
    expect(neverLogMatches(LIST, "sales@vendor.com")).toBe(false);
  });

  it("a domain entry matches the domain and any subdomain, never a lookalike (mutation: endsWith(pattern) without the dot → notsupplier.com matches, FAILS)", () => {
    expect(neverLogMatches(LIST, "ana@supplier.com")).toBe(true);
    expect(neverLogMatches(LIST, "ana@mail.supplier.com")).toBe(true);
    expect(neverLogMatches(LIST, "ana@notsupplier.com")).toBe(false);
    expect(neverLogMatches(LIST, "ana@supplier.com.evil.io")).toBe(false);
  });

  it("an unparseable From (null) never matches, and an empty list matches nothing (mutation: treat null as '' and match a '' domain → FAILS)", () => {
    expect(neverLogMatches(LIST, null)).toBe(false);
    expect(neverLogMatches([], "ana@supplier.com")).toBe(false);
  });
});
