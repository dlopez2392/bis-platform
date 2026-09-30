import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ appendConsentEventGuarded: vi.fn(), readConsentState: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { readUnsubscribeToken, recordUnsubscribe, recordResubscribe, emailStateOf, pageStateOf } from "./unsubscribe";
import { sealConsentToken, type ConsentTokenPayload } from "./token";

const SECRET = "unsub-test-secret-0123456789abcdef-01";
const ENV = { CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
const P: ConsentTokenPayload = {
  v: 1, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email", t: "ana@example.com",
  i: Date.parse("2026-10-01T15:00:00Z"), n: "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d", k: "automation.reminder",
};
const CLIENT = { tag: "service" } as never;

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "e1", prior: null });
});

describe("readUnsubscribeToken", () => {
  it("opens a good token, refuses a bad one, and says when no secret is configured — never guessing (mutation: treat no secret as a bad token → the endpoint answers 400 to a real unsubscribe during an outage, FAILS)", () => {
    expect(readUnsubscribeToken(sealConsentToken(P, SECRET), ENV)).toEqual({ ok: true, payload: P });
    expect(readUnsubscribeToken("1.x.y", ENV)).toEqual({ ok: false, why: "bad_token" });
    expect(readUnsubscribeToken(sealConsentToken(P, SECRET), {} as NodeJS.ProcessEnv)).toEqual({ ok: false, why: "not_configured" });
  });

  it("the previous secret still opens (a rotation never breaks a sent link; mutation: open with current only → FAILS)", () => {
    const env = { CONSENT_TOKEN_SECRET: "new-secret-0123456789abcdef-0123456", CONSENT_TOKEN_SECRET_PREVIOUS: SECRET } as unknown as NodeJS.ProcessEnv;
    expect(readUnsubscribeToken(sealConsentToken(P, SECRET), env)).toEqual({ ok: true, payload: P });
  });
});

describe("recordUnsubscribe", () => {
  it("appends the customer's own stop on the token's account and address, with NO contact_id and NO source_ref, and the token's facts as evidence (G3, S10; mutation: pass the token as source_ref → a second real unsubscribe after a resubscribe reads as a duplicate forever, FAILS)", async () => {
    expect(await recordUnsubscribe(CLIENT, P, "one_click")).toBe("stopped");
    expect(db.appendConsentEventGuarded).toHaveBeenCalledWith(CLIENT, {
      accountId: P.a, channel: "email", address: "ana@example.com", action: "revoked", method: "one_click",
      contactId: null, evidence: { issuedAt: "2026-10-01T15:00:00.000Z", kind: "automation.reminder", contactId: P.n },
    }, "unless_customer_stopped");
  });

  it("(decision Q5) guard unless_customer_stopped: refused over the customer's own stop (idempotent: 'already_stopped', no second row), recorded over a staff stop (mutation: guard 'if_allowed' → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValueOnce({ outcome: "refused", prior: { id: "e0", action: "revoked", method: "unsubscribe_link", evidence: {} } });
    expect(await recordUnsubscribe(CLIENT, P, "unsubscribe_link")).toBe("already_stopped");
    expect(db.appendConsentEventGuarded.mock.calls[0]![2]).toBe("unless_customer_stopped");
  });

  it("THROWS on a write error, so the endpoint can answer 503 and the mail client retry (mutation: swallow it → 200 for a stop that was never recorded, FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValueOnce(new Error("append_consent_event failed: timeout"));
    await expect(recordUnsubscribe(CLIENT, P, "one_click")).rejects.toThrow(/timeout/);
  });
});

describe("recordResubscribe", () => {
  it("appends resubscribed / unsubscribe_page with guard if_stopped_or_held, and answers was_allowed when nothing was stopped (G5; choice 27; mutation: method 'staff' → 0055 would demand a note, FAILS here on the method)", async () => {
    expect(await recordResubscribe(CLIENT, P)).toBe("resubscribed");
    expect(db.appendConsentEventGuarded).toHaveBeenCalledWith(CLIENT, expect.objectContaining({
      accountId: P.a, channel: "email", address: "ana@example.com", action: "resubscribed", method: "unsubscribe_page", contactId: null,
    }), "if_stopped_or_held");
    db.appendConsentEventGuarded.mockResolvedValueOnce({ outcome: "refused", prior: null });
    expect(await recordResubscribe(CLIENT, P)).toBe("was_allowed");
  });
});

describe("emailStateOf and pageStateOf — what the page opens on (review R1-I1, decision Q5)", () => {
  it("reads the token's account and address, and carries the stop's METHOD; a hold reads as stopped with its own method (mutation: read the SMS channel → FAILS; mutation: drop the method → FAILS)", async () => {
    db.readConsentState.mockResolvedValueOnce({ state: "allowed" });
    expect(await emailStateOf(CLIENT, P)).toEqual({ state: "allowed" });
    expect(db.readConsentState).toHaveBeenCalledWith(CLIENT, P.a, "email", "ana@example.com");
    db.readConsentState.mockResolvedValueOnce({ state: "stopped", since: "x", method: "backfill_0049", eventId: "s" });
    expect(await emailStateOf(CLIENT, P)).toEqual({ state: "stopped", method: "backfill_0049" });
    db.readConsentState.mockResolvedValueOnce({ state: "held", since: "x", method: "free_text", eventId: "h" });
    expect(await emailStateOf(CLIENT, P)).toEqual({ state: "stopped", method: "free_text" });
  });

  it("only the customer's OWN stop opens on 'You're unsubscribed'; allowed, staff, the 0049 fold and a hold open on the question (mutation: treat every stop as stopped → staff's and the fold's read 'stopped', FAILS)", () => {
    expect(pageStateOf({ state: "stopped", method: "unsubscribe_link" })).toBe("stopped");
    expect(pageStateOf({ state: "stopped", method: "one_click" })).toBe("stopped");
    for (const method of ["staff", "backfill_0049", "free_text", "staff_undo"] as const) {
      expect(pageStateOf({ state: "stopped", method }), method).toBe("ask");
    }
    expect(pageStateOf({ state: "allowed" })).toBe("ask");
  });
});
