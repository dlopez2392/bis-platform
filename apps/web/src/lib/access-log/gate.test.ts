import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const agencyVisitLive = vi.fn();
const authMock = vi.fn();
const requestHeaders = vi.hoisted(() => ({ value: {} as Record<string, string> }));
const SVC = { service: true };

vi.mock("@bis/db", () => ({
  serviceDb: () => SVC,
  agencyVisitLive: (...a: unknown[]) => agencyVisitLive(...a),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(requestHeaders.value) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import { requireAgencyVisit, agencyVisitOk, agencyVisitMissing } from "./gate";
import { enterHref } from "./paths";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  agencyVisitLive.mockReset();
  authMock.mockReset();
  requestHeaders.value = {};
});

/** F-118 part 1 (spec 3.1): an agency person with no live visit for this account meets the chooser. */
describe("requireAgencyVisit", () => {
  it("1. a live visit resolves with no redirect, read for this account, person and session", async () => {
    agencyVisitLive.mockResolvedValue("visit_1");
    await expect(requireAgencyVisit(A, "user_agency", "sess_1")).resolves.toBeUndefined();
    expect(agencyVisitLive).toHaveBeenCalledWith(SVC, A, { clerkUserId: "user_agency", sessionId: "sess_1" });
  });

  it("2. no visit, with a same-account x-bis-path, sends the person to the chooser carrying that path", async () => {
    agencyVisitLive.mockResolvedValue(null);
    const path = `/dashboard/accounts/${A}/contacts/c1?x=1`;
    requestHeaders.value = { "x-bis-path": path };
    await expect(requireAgencyVisit(A, "user_agency", "sess_1")).rejects.toThrow(`REDIRECT:${enterHref(A, path)}`);
  });

  it("3. no visit and no header: the bare chooser", async () => {
    agencyVisitLive.mockResolvedValue(null);
    await expect(requireAgencyVisit(A, "user_agency", "sess_1")).rejects.toThrow(`REDIRECT:/dashboard/enter/${A}`);
  });

  it("4. a header naming ANOTHER account is dropped: the bare chooser (mutation: pass the header raw -> FAILS)", async () => {
    agencyVisitLive.mockResolvedValue(null);
    requestHeaders.value = { "x-bis-path": `/dashboard/accounts/${B}/contacts` };
    const err = await requireAgencyVisit(A, "user_agency", "sess_1").catch((e: Error) => e);
    expect((err as Error).message).toBe(`REDIRECT:/dashboard/enter/${A}`);
  });

  it("5. a failed read rejects with THAT error, never a redirect and never a pass (mutations: catch as live, or catch and redirect -> FAILS)", async () => {
    const boom = new Error("agencyVisitLive failed: down");
    agencyVisitLive.mockRejectedValue(boom);
    const err = await requireAgencyVisit(A, "user_agency", "sess_1").then(() => "resolved", (e: unknown) => e);
    expect(err).toBe(boom);
  });

  it("6. a non-UUID account id is a 404, with no read", async () => {
    await expect(requireAgencyVisit("foo", "user_agency", "sess_1")).rejects.toThrow("NOT_FOUND");
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });

  it("7. no session id sends the person to sign in, with no read", async () => {
    await expect(requireAgencyVisit(A, "user_agency", null)).rejects.toThrow("REDIRECT:/sign-in");
    await expect(requireAgencyVisit(A, "user_agency", undefined)).rejects.toThrow("REDIRECT:/sign-in");
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
});

describe("agencyVisitOk (the route variant)", () => {
  it("8. true with a live visit, false with none", async () => {
    agencyVisitLive.mockResolvedValue("visit_1");
    expect(await agencyVisitOk(A, "user_agency", "sess_1")).toBe(true);
    expect(agencyVisitLive).toHaveBeenCalledWith(SVC, A, { clerkUserId: "user_agency", sessionId: "sess_1" });
    agencyVisitLive.mockResolvedValue(null);
    expect(await agencyVisitOk(A, "user_agency", "sess_1")).toBe(false);
  });
  it("8. a failed read throws (fail closed, never false)", async () => {
    agencyVisitLive.mockRejectedValue(new Error("down"));
    await expect(agencyVisitOk(A, "user_agency", "sess_1")).rejects.toThrow("down");
  });
  it("8. a non-UUID id or no session is false, with no read", async () => {
    expect(await agencyVisitOk("foo", "user_agency", "sess_1")).toBe(false);
    expect(await agencyVisitOk(A, "user_agency", null)).toBe(false);
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
});

describe("agencyVisitMissing (the customer-list download's 409, review m5)", () => {
  const agency = (sessionId: string | null = "sess_1") =>
    authMock.mockResolvedValue({ userId: "user_agency", sessionId, sessionClaims: { app_role: "agency_admin" } });

  it("10. a client session is never missing a visit, and nothing is read", async () => {
    authMock.mockResolvedValue({ userId: "user_client", sessionId: "sess_c", sessionClaims: { org_id: "org_1" } });
    expect(await agencyVisitMissing(A)).toBe(false);
    authMock.mockResolvedValue({ userId: null, sessionId: null, sessionClaims: null });
    expect(await agencyVisitMissing(A)).toBe(false);
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
  it("10. the agency with a live visit: false", async () => {
    agency();
    agencyVisitLive.mockResolvedValue("visit_1");
    expect(await agencyVisitMissing(A)).toBe(false);
    expect(agencyVisitLive).toHaveBeenCalledWith(SVC, A, { clerkUserId: "user_agency", sessionId: "sess_1" });
  });
  it("10. the agency with no visit: true (mutation: answer false for the agency on no visit -> FAILS)", async () => {
    agency();
    agencyVisitLive.mockResolvedValue(null);
    expect(await agencyVisitMissing(A)).toBe(true);
  });
  it("10. the agency with no session id: true, with no read", async () => {
    agency(null);
    expect(await agencyVisitMissing(A)).toBe(true);
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
  it("10. a non-UUID id: false with no read (the route's own guard answers it)", async () => {
    agency();
    expect(await agencyVisitMissing("foo")).toBe(false);
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
  it("10. a failed read rejects", async () => {
    agency();
    agencyVisitLive.mockRejectedValue(new Error("down"));
    await expect(agencyVisitMissing(A)).rejects.toThrow("down");
  });
});

/**
 * 9. The carve-out pin (review m4): the VALUE, not the property name. Every string-literal node whose text
 * is "not-required" (a literal TYPE's string included) in the app's non-test source. Comments are trivia
 * and never become nodes. A name check would miss `const skip = "not-required"` passed later, or a spread;
 * this catches literal uses (a template literal or forwarded options can still dodge it; Task 11's walk). lib/auth.ts holds the option's type and its one comparison; lib/proposals/actions.ts holds
 * the ONE use: run(), whose four actions /dashboard/work binds across every account (owner ruling 3, C11).
 */
const SRC = fileURLToPath(new URL("../../", import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
function notRequiredHits(): Record<string, number> {
  const hits: Record<string, number> = {};
  for (const path of sources(SRC)) {
    const rel = relative(SRC, path).split("\\").join("/");
    const sf = ts.createSourceFile(rel, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true,
      rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && node.text === "not-required") hits[rel] = (hits[rel] ?? 0) + 1;
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
}

describe("9. the visit carve-out has exactly one user (owner ruling 3, plan C11)", () => {
  it("\"not-required\" appears only in lib/auth.ts (type + one comparison) and ONCE in lib/proposals/actions.ts " +
    "(mutations: pass it from contacts/[contactId]/page.tsx, or from a const in lib/record/loaders.ts -> FAILS naming the file)", () => {
    expect(notRequiredHits()).toEqual({ "lib/auth.ts": 2, "lib/proposals/actions.ts": 1 });
  }, 30_000); // parses every app source file: ~2 s alone, slower beside the whole suite
});
