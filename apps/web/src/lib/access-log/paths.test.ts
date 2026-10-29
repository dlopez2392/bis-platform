import { describe, it, expect } from "vitest";
import { BIS_PATH_HEADER, accountPathOf, safeReturnPath, enterHref } from "./paths";

/** F-118 part 1 (spec 3.2): the path the reason gate sends a BIS person back to, and the chooser's address. */
describe("BIS_PATH_HEADER", () => {
  it("is x-bis-path", () => {
    expect(BIS_PATH_HEADER).toBe("x-bis-path");
  });
});

describe("accountPathOf: the in-account path a request asked for", () => {
  it("keeps the query but drops Next's internal _rsc (mutation: keep _rsc -> FAILS)", () => {
    expect(accountPathOf({ pathname: "/dashboard/accounts/A/contacts/c1", search: "?x=1&_rsc=abc" }))
      .toBe("/dashboard/accounts/A/contacts/c1?x=1");
  });
  it("a path with no query has no trailing ?", () => {
    expect(accountPathOf({ pathname: "/dashboard/accounts/A/contacts", search: "" })).toBe("/dashboard/accounts/A/contacts");
    expect(accountPathOf({ pathname: "/dashboard/accounts/A/contacts", search: "?_rsc=1" })).toBe("/dashboard/accounts/A/contacts");
  });
  it("the bare account path keeps its form", () => {
    expect(accountPathOf({ pathname: "/dashboard/accounts/A", search: "" })).toBe("/dashboard/accounts/A");
    expect(accountPathOf({ pathname: "/dashboard/accounts/A", search: "?c=1" })).toBe("/dashboard/accounts/A?c=1");
  });
  it.each(["/dashboard/accounts", "/dashboard/accounts/", "/dashboard/work", "/dashboard/enter/A", "/b/x", "/"])(
    "%s is not inside an account: null", (pathname) => {
      expect(accountPathOf({ pathname, search: "?x=1" })).toBeNull();
    });
});

describe("safeReturnPath: a path inside THIS account, and nothing else", () => {
  it.each([
    "/dashboard/accounts/A",
    "/dashboard/accounts/A/contacts/c1?x=1",
    "/dashboard/accounts/A?c=1",
    "/dashboard/accounts/a/contacts",
  ])("accepts %s", (raw) => {
    expect(safeReturnPath(raw, "A")).toBe(raw);
  });
  it("matches the account id in either case, in the path or in the argument", () => {
    const id = "aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb";
    expect(safeReturnPath(`/dashboard/accounts/${id.toUpperCase()}/contacts`, id)).toBe(`/dashboard/accounts/${id.toUpperCase()}/contacts`);
    expect(safeReturnPath(`/dashboard/accounts/${id}/contacts`, id.toUpperCase())).toBe(`/dashboard/accounts/${id}/contacts`);
  });

  it("refuses another account (mutation: drop the same-account check -> FAILS)", () => {
    expect(safeReturnPath("/dashboard/accounts/B/contacts", "A")).toBeNull();
  });
  it("refuses a near miss whose id merely starts with this one (mutation: startsWith(prefix) with no segment check -> FAILS)", () => {
    expect(safeReturnPath("/dashboard/accounts/AB", "A")).toBeNull();
    expect(safeReturnPath("/dashboard/accounts/AB/contacts", "A")).toBeNull();
  });
  it("refuses a backslash, also after a segment boundary, where a browser reads `/\\` as `//` (mutation: drop the \\ check -> FAILS)", () => {
    expect(safeReturnPath("/dashboard/accounts/A\\evil", "A")).toBeNull();
    // The plan's own case above is also refused by the segment check, so it cannot catch the mutation alone.
    expect(safeReturnPath("/dashboard/accounts/A/\\evil.example", "A")).toBeNull();
    expect(safeReturnPath("/dashboard/accounts/A?x=\\y", "A")).toBeNull();
  });
  it.each([
    ["a .. segment climbing into another account", "/dashboard/accounts/A/../B/contacts"],
    ["encoded .. segments climbing out of the account (review minor 2)", "/dashboard/accounts/A/%2e%2e/%2e%2e/%2e%2e/sign-out"],
    ["an upper-case encoded .. segment", "/dashboard/accounts/A/%2E%2E/B"],
    ["a half-encoded .. segment", "/dashboard/accounts/A/.%2e/B"],
    ["a trailing .. segment", "/dashboard/accounts/A/x/.."],
    ["a . segment", "/dashboard/accounts/A/./contacts"],
    ["an encoded . segment", "/dashboard/accounts/A/%2e/contacts"],
    ["an encoded slash inside a segment", "/dashboard/accounts/A/..%2fB/contacts"],
    ["a malformed escape", "/dashboard/accounts/A/%E0%A4%A"],
  ])("refuses a dot segment: %s (mutation: drop the segment check -> FAILS)", (_label, raw) => {
    expect(safeReturnPath(raw, "A")).toBeNull();
  });
  it("dots in a name or in the query are not segments, and stay accepted (mutation: check the query too -> FAILS)", () => {
    for (const raw of ["/dashboard/accounts/A/contacts?q=..", "/dashboard/accounts/A/contacts?q=%2e%2e/x", "/dashboard/accounts/A/contacts?back=/..", "/dashboard/accounts/A/files/v1.2..3"]) {
      expect(safeReturnPath(raw, "A")).toBe(raw);
    }
  });
  it.each([
    ["a protocol-relative URL", "//evil.example"],
    ["an absolute URL", "https://evil.example/dashboard/accounts/A"],
    ["a doubled slash inside the account", "/dashboard/accounts/A//x"],
    ["a control character", "/dashboard/accounts/A/x\u0000y"],
    ["a newline", "/dashboard/accounts/A/x\ny"],
    ["DEL", "/dashboard/accounts/A/x\u007fy"],
    ["a 2,049-character path", "/dashboard/accounts/A/" + "x".repeat(2049 - "/dashboard/accounts/A/".length)],
    ["the empty string", ""],
  ])("refuses %s", (_label, raw) => {
    expect(safeReturnPath(raw, "A")).toBeNull();
  });
  it("a 2,048-character path is still accepted (the bound is exact)", () => {
    const raw = "/dashboard/accounts/A/" + "x".repeat(2048 - "/dashboard/accounts/A/".length);
    expect(raw).toHaveLength(2048);
    expect(safeReturnPath(raw, "A")).toBe(raw);
  });
  it.each([[null], [undefined], [42], [{}]])("refuses a non-string (%s)", (raw) => {
    expect(safeReturnPath(raw, "A")).toBeNull();
  });
});

describe("enterHref: the chooser's address", () => {
  it("with no path is the bare chooser", () => {
    expect(enterHref("A", null)).toBe("/dashboard/enter/A");
  });
  it("carries the path, encoded, as ?to=", () => {
    expect(enterHref("A", "/dashboard/accounts/A/x?y=1")).toBe("/dashboard/enter/A?to=%2Fdashboard%2Faccounts%2FA%2Fx%3Fy%3D1");
  });
});
