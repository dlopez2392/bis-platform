import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * S-22 slice 1, PR 2 (plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, D3, D4): Disconnect.
 * Revoke at Google, then delete the row EVEN WHEN the revoke fails; no Undo. The agency or the Owner only.
 */
const A = "11111111-1111-4111-8111-111111111111";
const REFRESH = "1//0gREFRESH-token-value_abcdefghij";

type Role = "owner" | "staff" | "technician" | null;
const access = vi.hoisted(() => ({
  state: { userId: "user_A", isAgency: false, role: "owner" as Role, canManage: true },
  calls: [] as unknown[][],
}));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async (...a: unknown[]) => { access.calls.push(a); return { ...access.state }; },
}));
const db = vi.hoisted(() => ({ deleteGoogleConnection: vi.fn(), emit: vi.fn(), emitAgencyEvent: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ fake: "service" }),
  deleteGoogleConnection: (...a: unknown[]) => db.deleteGoogleConnection(...a),
  emit: (...a: unknown[]) => db.emit(...a),
  emitAgencyEvent: (...a: unknown[]) => db.emitAgencyEvent(...a),
}));
const token = vi.hoisted(() => ({ value: null as string | null, calls: [] as unknown[][] }));
vi.mock("@/lib/google/calendar-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openAccountRefreshToken: async (...a: unknown[]) => { token.calls.push(a); return token.value; },
}));

const { disconnectGoogleCalendarAction } = await import("./google-actions");

let revoke: { status: number } | "throw";
let fetched: { url: string; body: string }[];
let logs: string[];
beforeEach(() => {
  access.state = { userId: "user_A", isAgency: false, role: "owner", canManage: true };
  access.calls = [];
  token.value = REFRESH;
  token.calls = [];
  revoke = { status: 200 };
  fetched = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    fetched.push({ url: String(url), body: String(init?.body ?? "") });
    if (revoke === "throw") throw new Error(`socket closed ${REFRESH}`);
    return new Response(JSON.stringify(revoke.status === 200 ? {} : { error: "invalid_token", error_description: REFRESH }), { status: revoke.status });
  });
  db.deleteGoogleConnection.mockReset().mockResolvedValue("deleted");
  db.emit.mockReset().mockResolvedValue(undefined);
  db.emitAgencyEvent.mockReset().mockResolvedValue(undefined);
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("disconnectGoogleCalendarAction (D4)", () => {
  it("an Owner: revokes the refresh token at Google, deletes the row, records who did it", async () => {
    expect(await disconnectGoogleCalendarAction(A)).toEqual({ ok: true });
    expect(access.calls).toEqual([[A, { duringPause: "allow" }]]);
    expect(token.calls[0]![0]).toEqual({ fake: "service" });
    expect(token.calls[0]![1]).toBe(A);
    expect(fetched.map((f) => f.url)).toEqual(["https://oauth2.googleapis.com/revoke"]);
    expect(new URLSearchParams(fetched[0]!.body).get("token")).toBe(REFRESH);
    expect(db.deleteGoogleConnection).toHaveBeenCalledWith({ fake: "service" }, A);
    expect(db.emit).toHaveBeenCalledWith({ fake: "service" }, A, "google_calendar.disconnected", "user_A", { by: "user_A", revoked: true }, "user");
  });

  it.each([["Google refuses the revoke", { status: 400 }], ["the revoke cannot reach Google", "throw" as const]])(
    "%s: the row is STILL deleted, the failure is logged without the token", async (_n, r) => {
      revoke = r;
      expect(await disconnectGoogleCalendarAction(A)).toEqual({ ok: true });
      expect(db.deleteGoogleConnection).toHaveBeenCalledWith({ fake: "service" }, A);
      expect(db.emit.mock.calls[0]![4]).toEqual({ by: "user_A", revoked: false });
      expect(logs.some((l) => l.includes("revoke"))).toBe(true);
      expect(logs.join("\n")).not.toContain(REFRESH);
    });

  it("a row no key opens (or no row): nothing to revoke, the row is still deleted", async () => {
    token.value = null;
    expect(await disconnectGoogleCalendarAction(A)).toEqual({ ok: true });
    expect(fetched).toEqual([]);
    expect(db.deleteGoogleConnection).toHaveBeenCalledTimes(1);
  });

  it("the agency may disconnect (D3); which BIS person did it is BIS's own record, never the account's (F-032's rule)", async () => {
    access.state = { userId: "user_agency", isAgency: true, role: null, canManage: true };
    expect(await disconnectGoogleCalendarAction(A)).toEqual({ ok: true });
    expect(db.deleteGoogleConnection).toHaveBeenCalledTimes(1);
    expect(db.emit).not.toHaveBeenCalled();
    expect(db.emitAgencyEvent).toHaveBeenCalledWith({ fake: "service" }, "google_calendar.disconnected", "user_agency", { account_id: A, revoked: true });
  });

  it.each(["staff", "technician", null] as const)("%s is refused: nothing opened, revoked or deleted (D3)", async (role) => {
    access.state = { userId: "user_A", isAgency: false, role, canManage: false };
    expect(await disconnectGoogleCalendarAction(A)).toEqual({ ok: false, error: "calendar.google.error.notAllowed" });
    expect(token.calls).toEqual([]);
    expect(fetched).toEqual([]);
    expect(db.deleteGoogleConnection).not.toHaveBeenCalled();
  });

  it("a failed delete is 'failed', and its message is logged without the token", async () => {
    db.deleteGoogleConnection.mockRejectedValue(new Error(`delete failed near ${REFRESH}`));
    expect(await disconnectGoogleCalendarAction(A)).toEqual({ ok: false, error: "calendar.google.error.failed" });
    expect(logs.join("\n")).not.toContain(REFRESH);
  });

  it("an account id that is not a uuid asks nobody", async () => {
    expect(await disconnectGoogleCalendarAction("nope")).toEqual({ ok: false, error: "calendar.google.error.failed" });
    expect(access.calls).toEqual([]);
  });
});
