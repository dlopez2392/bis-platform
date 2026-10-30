import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-118 part 1 (plan Task 5, spec 3.2): `startVisitAction`. The bound arguments (`accountId`, `to`) come
 * back from the browser unencrypted, so every one of them is re-checked here, not trusted from the form
 * that posted it. `@/lib/access-log/paths` (`safeReturnPath`, `enterHref`) is the REAL module throughout —
 * mocking it would let this file pass on a `to` the real guard refuses, which is exactly the thing under
 * test. `accountHome` is the real `@/lib/auth` export too (importOriginal), kept alongside the mocked
 * `requireAgency`.
 */
const authFixture = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireAgency: async () => {
    if (authFixture.fail) throw new Error("NEXT_REDIRECT:/sign-in");
    return { userId: "user_agency" };
  },
}));

const visitMocks = vi.hoisted(() => ({ startVisitForCaller: vi.fn() }));
vi.mock("@/lib/access-log/visit", () => ({
  startVisitForCaller: (...a: unknown[]) => visitMocks.startVisitForCaller(...a),
}));

// The second loop path (2026-10-30): with no valid reason but a visit ALREADY live, the chooser would just
// redirect straight back. Default: no live visit (agencyVisitMissing true), so every older case is unchanged.
const gateMocks = vi.hoisted(() => ({ agencyVisitMissing: vi.fn() }));
vi.mock("@/lib/access-log/gate", () => ({
  agencyVisitMissing: (...a: unknown[]) => gateMocks.agencyVisitMissing(...a),
}));

// The router-cache loop (2026-10-30, production logs): an in-account route prefetched BEFORE the visit
// existed is cached by the browser as a redirect to the chooser for 300 s. Every redirect INTO the account
// must therefore be preceded by revalidatePath(<account>, "layout"), which purges the client cache from a
// Server Function. One ordered log records both calls so the order itself is asserted.
const callLog = vi.hoisted(() => [] as string[]);
vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => { callLog.push(`revalidate:${path}:${type}`); },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { callLog.push(`redirect:${url}`); throw new Error(`REDIRECT:${url}`); },
}));

const { startVisitAction } = await import("./actions");

/** Two real UUIDs (isUuid's own RE only cares about shape), never Test Client One or a live account. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const form = (reason?: string) => {
  const f = new FormData();
  if (reason !== undefined) f.set("reason", reason);
  return f;
};

const redirectUrl = async (p: Promise<void>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("REDIRECT:")) return msg.slice("REDIRECT:".length);
    throw e;
  }
  throw new Error("startVisitAction resolved without redirecting");
};

beforeEach(() => {
  callLog.length = 0;
  authFixture.fail = false;
  visitMocks.startVisitForCaller.mockReset().mockResolvedValue("visit_1");
  gateMocks.agencyVisitMissing.mockReset().mockResolvedValue(true);
});

describe("startVisitAction — the reason, checked against the closed list", () => {
  it("with reason support and a valid `to`, starts the visit with that reason and redirects to `to` (mutation: pass the raw formData value through -> an unchecked reason would still redirect, FAILS on the next case instead)", async () => {
    const to = `/dashboard/accounts/${A}/contacts/c1?x=1`;
    const url = await redirectUrl(startVisitAction(A, to, form("support")));
    expect(visitMocks.startVisitForCaller).toHaveBeenCalledWith(A, "support");
    expect(url).toBe(to);
  });

  it.each(["curious", "", undefined])(
    "an unknown or missing reason (%j) redirects to the chooser with the safe `to` preserved, and NEVER starts a visit (mutation: call startVisitForCaller first -> the spy FAILS)",
    async (reason) => {
      const to = `/dashboard/accounts/${A}/contacts/c1`;
      const url = await redirectUrl(startVisitAction(A, to, form(reason)));
      expect(visitMocks.startVisitForCaller).not.toHaveBeenCalled();
      expect(url).toBe(`/dashboard/enter/${A}?to=${encodeURIComponent(to)}`);
    },
  );
});

describe("startVisitAction — `to` is re-validated, never trusted from the browser (safeReturnPath, not mocked)", () => {
  it.each([
    ["a bare double-slash", "//evil.example"],
    ["another account's path", `/dashboard/accounts/${B}/x`],
    ["a backslash after this account's id", `/dashboard/accounts/${A}\\evil`],
    ["an absolute URL", "https://evil.example"],
    ["no `to` at all", null],
  ])(
    "%s sends the caller to THIS account's home, never to `to` itself (mutation: redirect(to ?? home) unvalidated -> this and the // case FAIL)",
    async (_label, to) => {
      const url = await redirectUrl(startVisitAction(A, to, form("support")));
      expect(url).toBe(`/dashboard/accounts/${A}/dashboard`);
    },
  );

  // Coordinator heads-up (T3 review): safeReturnPath is being fixed to refuse a dot segment. Until that
  // lands, `/dashboard/accounts/<A>/../<B>/...` starts with A's own prefix and is wrongly treated as safe —
  // this is RED against the unfixed guard and turns green the moment paths.ts's fix is committed; this
  // file does not edit paths.ts itself.
  it("a `to` crossing into another account through a dot segment lands on THIS account's home, never account B (mutation: trust `to` whenever it merely STARTS WITH this account's prefix -> FAILS, landing in B)", async () => {
    const to = `/dashboard/accounts/${A}/../${B}/contacts`;
    const url = await redirectUrl(startVisitAction(A, to, form("support")));
    expect(url).toBe(`/dashboard/accounts/${A}/dashboard`);
    expect(url).not.toContain(B);
  });
});

describe("startVisitAction — the account id and the visit write", () => {
  it("a non-UUID accountId redirects to the accounts list without starting anything (mutation: skip the uuid check -> FAILS)", async () => {
    const url = await redirectUrl(startVisitAction("not-a-uuid", null, form("support")));
    expect(url).toBe("/dashboard/accounts");
    expect(visitMocks.startVisitForCaller).not.toHaveBeenCalled();
  });

  it("startVisitForCaller returning null (no such account) redirects to the accounts list (mutation: redirect into the account anyway -> FAILS)", async () => {
    visitMocks.startVisitForCaller.mockResolvedValue(null);
    const url = await redirectUrl(startVisitAction(A, null, form("support")));
    expect(url).toBe("/dashboard/accounts");
  });

  it("requireAgency throwing stops everything before it: no visit, no other redirect (mutation: read before the gate -> FAILS)", async () => {
    authFixture.fail = true;
    await expect(startVisitAction(A, null, form("support"))).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(visitMocks.startVisitForCaller).not.toHaveBeenCalled();
  });
});

describe("startVisitAction — no valid reason while a visit is ALREADY live (the agency refresh loop, 2026-10-30)", () => {
  it.each(["curious", "", undefined])(
    "reason %j with a live visit goes to the safe `to`, never back to the chooser, and starts nothing (mutation: drop the live-visit check -> FAILS)",
    async (reason) => {
      gateMocks.agencyVisitMissing.mockResolvedValue(false);
      const to = `/dashboard/accounts/${A}/setup`;
      const url = await redirectUrl(startVisitAction(A, to, form(reason)));
      expect(url).toBe(to);
      expect(gateMocks.agencyVisitMissing).toHaveBeenCalledWith(A);
      expect(visitMocks.startVisitForCaller).not.toHaveBeenCalled();
    },
  );

  it("with a live visit and no safe `to`, goes to this account's home", async () => {
    gateMocks.agencyVisitMissing.mockResolvedValue(false);
    const url = await redirectUrl(startVisitAction(A, `/dashboard/accounts/${B}/x`, form("curious")));
    expect(url).toBe(`/dashboard/accounts/${A}/dashboard`);
  });

  it("a failed visit read falls back to the chooser, never into the account (fail closed)", async () => {
    gateMocks.agencyVisitMissing.mockRejectedValue(new Error("down"));
    const url = await redirectUrl(startVisitAction(A, null, form("curious")));
    expect(url).toBe(`/dashboard/enter/${A}`);
  });

  it("a VALID reason never asks whether a visit is live: it starts one, as before", async () => {
    gateMocks.agencyVisitMissing.mockResolvedValue(false);
    await redirectUrl(startVisitAction(A, null, form("support")));
    expect(visitMocks.startVisitForCaller).toHaveBeenCalledWith(A, "support");
  });
});

describe("startVisitAction — clears the browser's cached chooser redirects before entering (the router-cache loop, 2026-10-30)", () => {
  it("a new visit revalidates the account's layout, then redirects into the account (mutation: drop revalidatePath -> FAILS)", async () => {
    const to = `/dashboard/accounts/${A}/tasks`;
    await redirectUrl(startVisitAction(A, to, form("support")));
    expect(callLog).toEqual([`revalidate:/dashboard/accounts/${A}:layout`, `redirect:${to}`]);
  });

  it("an already-live visit with no reason revalidates the account's layout, then redirects into the account (mutation: drop revalidatePath on this path -> FAILS)", async () => {
    gateMocks.agencyVisitMissing.mockResolvedValue(false);
    await redirectUrl(startVisitAction(A, null, form("curious")));
    expect(callLog).toEqual([`revalidate:/dashboard/accounts/${A}:layout`, `redirect:/dashboard/accounts/${A}/dashboard`]);
  });

  it("a redirect that does NOT enter the account (back to the chooser) revalidates nothing", async () => {
    await redirectUrl(startVisitAction(A, null, form("curious")));
    expect(callLog).toEqual([`redirect:/dashboard/enter/${A}`]);
  });
});
