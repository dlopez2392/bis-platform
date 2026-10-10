import { describe, it, expect, vi, beforeEach } from "vitest";
const readRole = vi.fn(); const reconcile = vi.fn();
vi.mock("@bis/db", () => ({ readAccountRole: (...a: unknown[]) => readRole(...a), reconcileMembership: (...a: unknown[]) => reconcile(...a) }));
import { ensureAccountRoleWith, readStoredRoleWith, STORED_READ_FAILED, CLERK_FALLBACK_TIMEOUT_MS } from "./ensure-role";
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
  it("the stored-role read failing is not a 500: no role, no Clerk call, logged without raw text (mutation: drop the catch on the stored read -> FAILS)", async () => {
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
  it("Clerk hanging: gives up at 3 s with no role, logged (mutation: no race -> FAILS)", async () => {
    vi.useFakeTimers();
    try {
      readRole.mockResolvedValue(null); reconcile.mockReturnValue(new Promise(() => {}));
      const p = ensureAccountRoleWith(db, port, "a", "org", "u");
      await vi.advanceTimersByTimeAsync(CLERK_FALLBACK_TIMEOUT_MS);
      expect(await Promise.race([p, Promise.resolve("still waiting")])).toBeNull();
      expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("Clerk slow but inside 3 s: still waited for (mutation: a much shorter timeout -> FAILS)", async () => {
    vi.useFakeTimers();
    try {
      expect(CLERK_FALLBACK_TIMEOUT_MS).toBe(3000);
      readRole.mockResolvedValue(null);
      reconcile.mockReturnValue(new Promise((res) => setTimeout(() => res({ outcome: "created", role: "owner" }), CLERK_FALLBACK_TIMEOUT_MS - 100)));
      const p = ensureAccountRoleWith(db, port, "a", "org", "u");
      await vi.advanceTimersByTimeAsync(CLERK_FALLBACK_TIMEOUT_MS - 100);
      expect(await p).toBe("owner");
    } finally { vi.useRealTimers(); }
  });
});

describe("the stored-role read started early (review M4)", () => {
  it("never rejects: a failed read resolves to the sentinel, logged without raw text (mutation: drop the catch -> FAILS)", async () => {
    readRole.mockRejectedValue(new Error("timeout for pat@example.com"));
    await expect(readStoredRoleWith(() => db, "a", "u")).resolves.toBe(STORED_READ_FAILED);
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain("pat@example.com");
  });
  it("even when building the client throws (mutation: call db() outside the async wrapper -> FAILS)", async () => {
    await expect(readStoredRoleWith(() => { throw new Error("Supabase service env vars missing"); }, "a", "u")).resolves.toBe(STORED_READ_FAILED);
  });
  it("ensureAccountRoleWith awaits a read already in flight instead of reading again (mutation: ignore the passed read -> FAILS)", async () => {
    const stored = Promise.resolve("staff" as const);
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u", stored)).toBe("staff");
    expect(readRole).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("an in-flight read that failed means no role and no Clerk call (mutation: treat the sentinel as 'nothing stored' -> FAILS)", async () => {
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u", Promise.resolve(STORED_READ_FAILED))).toBeNull();
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("an in-flight read that found nothing goes to Clerk", async () => {
    reconcile.mockResolvedValue({ outcome: "created", role: "staff" });
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u", Promise.resolve(null))).toBe("staff");
  });
});
