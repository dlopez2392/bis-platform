import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionStatus } from "@bis/db";

/**
 * S-22 slice 1, PR 3: the Google Calendar card's view builder, one case per state. The builder is pure (the
 * loader around it only reads); what it must never do is carry a token-shaped field to the browser.
 */

const reads = vi.hoisted(() => ({ status: vi.fn(), paused: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ fake: "service" }),
  getGoogleConnectionStatus: (...a: unknown[]) => reads.status(...a),
}));
vi.mock("@/lib/billing/standing-read", () => ({ billingVerdictFor: (id: string) => reads.paused(id) }));

const { buildGoogleCardView, loadGoogleCardView, parseGoogleOutcome, disconnectFeedback } = await import("./google-card-data");

const ACC = "6f1c2c1e-3b7a-4c51-9a55-0c7d7f3b2a10";
const ORIGIN = "https://app.bis-rgv.com";
const row = (over: Partial<GoogleConnectionStatus> = {}): GoogleConnectionStatus => ({
  id: "c1", account_id: ACC, version: 3, google_email: "dan@example.com", scope: "https://www.googleapis.com/auth/calendar.freebusy",
  status: "connected", refresh_expires_at: "2026-11-22T00:00:00Z", connected_by: "u1", connected_at: "2026-11-15T10:00:00Z",
  last_checked_at: "2026-11-15T11:00:00Z", needs_reconnect_since: null, reconnect_task_id: null, ...over,
});
const base = {
  accountId: ACC, redirectOrigin: ORIGIN as string | null, canManage: true, isAgency: false, paused: false, origin: ORIGIN,
  status: null as GoogleConnectionStatus | null | "error", outcome: null,
};
const HREF = `/api/google-calendar/connect?account=${ACC}`;

describe("buildGoogleCardView", () => {
  it("dormant: no redirect configured, no card at all", () => {
    expect(buildGoogleCardView({ ...base, redirectOrigin: null })).toBeNull();
  });
  it("Staff and Technician (cannot manage) get no card", () => {
    expect(buildGoogleCardView({ ...base, canManage: false })).toBeNull();
  });
  it("empty: sells it, Connect is a plain link to the connect route", () => {
    expect(buildGoogleCardView(base)).toEqual({ outcome: null, body: { kind: "empty", connect: { kind: "link", href: HREF } } });
  });
  it("connected: the email and when it was last checked", () => {
    expect(buildGoogleCardView({ ...base, status: row() })).toEqual({
      outcome: null, body: { kind: "connected", email: "dan@example.com", lastCheckedAt: "2026-11-15T11:00:00Z" },
    });
  });
  it("needs reconnecting: keeps the email and offers Reconnect", () => {
    const v = buildGoogleCardView({ ...base, status: row({ status: "needs_reconnect", needs_reconnect_since: "2026-11-20T00:00:00Z" }) });
    expect(v?.body).toEqual({ kind: "needsReconnect", email: "dan@example.com", connect: { kind: "link", href: HREF } });
  });
  it("error: the status read failed", () => {
    expect(buildGoogleCardView({ ...base, status: "error" })?.body).toEqual({ kind: "error" });
  });
  it("a paused CLIENT is not offered Connect or Reconnect; the agency still is", () => {
    expect(buildGoogleCardView({ ...base, paused: true })?.body).toEqual({ kind: "empty", connect: { kind: "paused" } });
    expect(buildGoogleCardView({ ...base, paused: true, status: row({ status: "needs_reconnect" }) })?.body)
      .toMatchObject({ kind: "needsReconnect", connect: { kind: "paused" } });
    expect(buildGoogleCardView({ ...base, paused: true, isAgency: true })?.body)
      .toEqual({ kind: "empty", connect: { kind: "link", href: HREF } });
  });
  it("a paused client's connected card still lets them Disconnect (it only takes access away)", () => {
    expect(buildGoogleCardView({ ...base, paused: true, status: row() })?.body).toMatchObject({ kind: "connected" });
  });
  it("on another origin Connect is replaced by the address to open (the cookie is host-bound)", () => {
    expect(buildGoogleCardView({ ...base, origin: "https://preview-abc.vercel.app" })?.body)
      .toEqual({ kind: "empty", connect: { kind: "wrongOrigin", origin: ORIGIN } });
  });
  it("carries the outcome of the trip to Google", () => {
    for (const o of ["connected", "denied", "failed", "paused"] as const) {
      expect(buildGoogleCardView({ ...base, outcome: o })?.outcome).toBe(o);
    }
  });
  it.each(["empty", "connected", "needsReconnect", "error", "paused", "wrongOrigin"])(
    "no token-shaped field reaches the browser (%s), even if the row carried one",
    (which) => {
      const sneaky = { ...row({ status: which === "needsReconnect" ? "needs_reconnect" : "connected" }),
        refresh_token_sealed: "g1.AAAA", access_token: "ya29.x", client_secret: "s", code: "4/0A" } as GoogleConnectionStatus;
      const v = buildGoogleCardView({
        ...base, status: which === "empty" || which === "paused" || which === "wrongOrigin" ? null : which === "error" ? "error" : sneaky,
        paused: which === "paused", origin: which === "wrongOrigin" ? "https://x.test" : ORIGIN,
      });
      const json = JSON.stringify(v);
      expect(json).not.toMatch(/token|secret|sealed|cipher|refresh|g1\.|ya29|"code"/i);
      expect(json).not.toContain("scope");
    },
  );
});

describe("parseGoogleOutcome", () => {
  it("accepts the four outcomes and nothing else", () => {
    for (const o of ["connected", "denied", "failed", "paused"]) expect(parseGoogleOutcome(o)).toBe(o);
    for (const o of [undefined, "", "CONNECTED", "x", "connected,denied"]) expect(parseGoogleOutcome(o)).toBeNull();
  });
});

describe("disconnectFeedback", () => {
  it("success is the toast; each action error is its own sentence", () => {
    expect(disconnectFeedback({ ok: true })).toEqual({ tone: "success", key: "calendar.google.toast.disconnected" });
    for (const e of ["notAllowed", "failed", "changed"] as const) {
      expect(disconnectFeedback({ ok: false, error: `calendar.google.error.${e}` })).toEqual({ tone: "error", key: `calendar.google.error.${e}` });
    }
  });
});

describe("loadGoogleCardView", () => {
  const env = {
    GOOGLE_CALENDAR_CLIENT_ID: "id", GOOGLE_CALENDAR_CLIENT_SECRET: "sec", GOOGLE_CALENDAR_REDIRECT_URI: `${ORIGIN}/api/google-calendar/callback`,
    GOOGLE_CALENDAR_TOKEN_KEY: "k".repeat(43),
  };
  const args = { accountId: ACC, isAgency: false, canManage: true, origin: ORIGIN, outcome: null };
  beforeEach(() => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    reads.status.mockReset().mockResolvedValue(null);
    reads.paused.mockReset().mockResolvedValue({ paused: false });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("dormant: nothing is read", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "");
    expect(await loadGoogleCardView(args)).toBeNull();
    expect(reads.status).not.toHaveBeenCalled();
  });
  it("Staff: nothing is read", async () => {
    expect(await loadGoogleCardView({ ...args, canManage: false })).toBeNull();
    expect(reads.status).not.toHaveBeenCalled();
  });
  it("reads this account's status and the pause for a client", async () => {
    reads.paused.mockResolvedValue({ paused: true });
    const v = await loadGoogleCardView(args);
    expect(reads.status).toHaveBeenCalledWith({ fake: "service" }, ACC);
    expect(v?.body).toEqual({ kind: "empty", connect: { kind: "paused" } });
  });
  it("the agency's visit never asks about the pause", async () => {
    await loadGoogleCardView({ ...args, isAgency: true });
    expect(reads.paused).not.toHaveBeenCalled();
  });
  it("a failed read is the card's own error state and logs no value", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    reads.status.mockRejectedValue(new Error("boom"));
    expect((await loadGoogleCardView(args))?.body).toEqual({ kind: "error" });
    expect(err).toHaveBeenCalled();
  });
});
