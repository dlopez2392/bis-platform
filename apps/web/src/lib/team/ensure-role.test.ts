import { describe, it, expect, vi, beforeEach } from "vitest";
const readRole = vi.fn(); const reconcile = vi.fn();
vi.mock("@bis/db", () => ({ readAccountRole: (...a: unknown[]) => readRole(...a), reconcileMembership: (...a: unknown[]) => reconcile(...a) }));
import { ensureAccountRoleWith } from "./ensure-role";
const db = {} as never; const port = {} as never;
beforeEach(() => { readRole.mockReset(); reconcile.mockReset(); vi.restoreAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("the per-request fallback (spec §6, §9)", () => {
  it("returns the stored role without calling Clerk (mutation: always reconcile -> FAILS)", async () => {
    readRole.mockResolvedValue("staff");
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBe("staff");
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("reads the stored role for exactly this account and Clerk user (mutation: swap the arguments -> FAILS)", async () => {
    readRole.mockResolvedValue("owner");
    await ensureAccountRoleWith(db, port, "acct-1", "org", "user_1");
    expect(readRole).toHaveBeenCalledWith(db, "acct-1", "user_1");
  });
  it.each([["owner"], ["staff"]] as const)("creates the missing row and returns its role (%s)", async (role) => {
    readRole.mockResolvedValue(null); reconcile.mockResolvedValue({ outcome: "created", role });
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBe(role);
    expect(reconcile).toHaveBeenCalledWith(db, port, { clerkUserId: "u", clerkOrgId: "org", mode: "fallback" });
  });
  it("a row another request created first is still this person's role (exists)", async () => {
    readRole.mockResolvedValue(null); reconcile.mockResolvedValue({ outcome: "exists", role: "owner" });
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBe("owner");
  });
  it("Clerk down: no role, no throw, logged without the error's raw text (mutation: rethrow -> FAILS; return 'owner' -> FAILS)", async () => {
    readRole.mockResolvedValue(null); reconcile.mockRejectedValue(new Error("clerk 503 for pat@example.com"));
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBeNull();
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain("pat@example.com");
  });
  it("the stored-role read failing is not a 500: no role, no Clerk call, logged without raw text (mutation: read outside the try -> FAILS)", async () => {
    readRole.mockRejectedValue(new Error("readAccountRole failed: timeout for pat@example.com"));
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBeNull();
    expect(reconcile).not.toHaveBeenCalled();
    expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain("pat@example.com");
  });
  it("agency_user / absent / no_email / no_account yield no role", async () => {
    readRole.mockResolvedValue(null);
    for (const outcome of ["agency_user", "absent", "no_email", "no_account"]) {
      reconcile.mockResolvedValueOnce({ outcome });
      expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBeNull();
    }
  });
});
