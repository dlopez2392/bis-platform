import { describe, it, expect, vi, beforeEach } from "vitest";

// The page is called, not rendered (accounts/page.test.ts's idiom). The REAL requireAgency runs: only Clerk's
// auth() and Next's redirect are replaced, so a client is refused by the guard the page really uses.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
const tradeOptions = vi.hoisted(() => vi.fn(() => []));
vi.mock("@/lib/vetting/copy", async (importOriginal) => ({
  ...(await importOriginal<object>()), tradeOptionGroups: tradeOptions,
}));
vi.mock("./actions", () => ({ startProspectDemoAction: vi.fn() }));

const { default: ProspectDemoPage } = await import("./page");

beforeEach(() => {
  authMock.mockReset();
  tradeOptions.mockClear();
});

describe("the prospect demo page — agency only", () => {
  for (const role of ["owner", "staff", "technician"]) {
    it(`redirects a client ${role} before anything is built (mutation: drop requireAgency -> FAILS)`, async () => {
      authMock.mockResolvedValue({ userId: `user_${role}`, sessionClaims: { org_id: "org_client" } });
      await expect(ProspectDemoPage()).rejects.toThrow("REDIRECT:/");
      expect(tradeOptions).not.toHaveBeenCalled();
    });
  }

  it("sends a signed-out visitor to sign in", async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null });
    await expect(ProspectDemoPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("renders for the agency", async () => {
    authMock.mockResolvedValue({ userId: "user_agency", sessionClaims: { app_role: "agency_admin" } });
    await expect(ProspectDemoPage()).resolves.toBeTruthy();
    expect(tradeOptions).toHaveBeenCalledWith("en");
  });
});
