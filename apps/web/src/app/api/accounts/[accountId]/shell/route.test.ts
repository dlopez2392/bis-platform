import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The shell's badges (unread, setup meter, presence, business status) read through this plain GET, not a
 * server action (the agency refresh loop after the reason chooser, 2026-10-30): Next posts a server action
 * to the router's CURRENT url, and an action's redirect, or a response that modifies a cookie, navigates or
 * refreshes the whole page. A route handler can do neither. So: no access (including the agency with no live
 * visit) is a bodiless 204, never a redirect; nothing here is ever cached.
 */
const access = vi.hoisted(() => ({ value: null as null | { userId: string; isAgency: boolean; role: string | null } }));
const apiAccountAccessWithRole = vi.hoisted(() => vi.fn(async () => access.value));
vi.mock("@/lib/auth", () => ({ apiAccountAccessWithRole: (...a: unknown[]) => apiAccountAccessWithRole(...(a as [])) }));

const SNAPSHOT = { unreadTotal: 3, setup: { done: 2, total: 7 }, presence: null, businessStatus: null };
const readShellSnapshot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/shell/snapshot", () => ({ readShellSnapshot: (...a: unknown[]) => readShellSnapshot(...a) }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

const { GET } = await import("./route");

const A = "11111111-1111-4111-8111-111111111111";
const call = () => GET(new Request(`https://app.example/api/accounts/${A}/shell`), { params: Promise.resolve({ accountId: A }) });

beforeEach(() => {
  access.value = null;
  apiAccountAccessWithRole.mockClear();
  readShellSnapshot.mockReset().mockResolvedValue(SNAPSHOT);
});

describe("GET /api/accounts/[accountId]/shell", () => {
  it("no access (the agency with no live visit included) is a bodiless 204, not a redirect, and reads nothing (mutation: answer the snapshot anyway -> FAILS)", async () => {
    const res = await call();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(apiAccountAccessWithRole).toHaveBeenCalledWith(A);
    expect(readShellSnapshot).not.toHaveBeenCalled();
  });

  it("with access, answers the snapshot as JSON for this account and this caller's role, never cached (mutation: drop the role -> FAILS)", async () => {
    access.value = { userId: "user_t", isAgency: false, role: "technician" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(SNAPSHOT);
    expect(readShellSnapshot).toHaveBeenCalledWith(A, { isAgency: false, role: "technician" });
  });

  it("the agency's snapshot is read as the agency", async () => {
    access.value = { userId: "user_agency", isAgency: true, role: null };
    await call();
    expect(readShellSnapshot).toHaveBeenCalledWith(A, { isAgency: true, role: null });
  });

  it("the route imports no redirecting guard and no server-action module (mutation: import requireAccountAccess -> FAILS)", () => {
    const src = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/\brequireAccountAccess\b|\brequireAgencyVisit\b|from "next\/navigation"|"use server"/);
  });
});
