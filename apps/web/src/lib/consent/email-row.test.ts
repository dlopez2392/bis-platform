import { describe, it, expect, vi } from "vitest";
import { emailLine, emailHowLine, noResumeLine, parseEmailResponse, runEmailAction, EMAIL_TREATMENT } from "./email-row";
import { m } from "@/lib/messages";

describe("emailLine — 'Since {date} · {how}' (G14)", () => {
  it("each how, and the date in the ACCOUNT's zone (mutation: format in UTC → a Chicago evening stop reads as the next day, FAILS)", () => {
    const at = "2026-10-04T02:30:00Z"; // Oct 3, 9:30 PM in Chicago
    expect(emailLine({ kind: "stopped", eventId: "e", since: at, how: { kind: "unsubscribe_link" }, canResume: false }, "America/Chicago"))
      .toMatch(/^Since .*Oct 3.* · unsubscribe link$/);
    expect(emailHowLine({ kind: "staff" })).toBe(m["contact.email.how.staff"]);
    expect(emailHowLine({ kind: "backfill_0049" })).toBe("you marked them “No marketing emails”");
    expect(emailLine({ kind: "allowed", newestId: null }, "America/Chicago")).toBeNull();
  });

  // D-016 item 4: a hard bounce or a complaint is its own SHORT how (never
  // the "staff stopped" fallback), composed the same "Since {date} · {how}"
  // way as every other how (mutation: fold either into "staff" → FAILS).
  it("a hard bounce and a complaint are their own short how (mutation: read either as staff → FAILS)", () => {
    expect(emailHowLine({ kind: "bounced" })).toBe(m["contact.email.how.bounced"]);
    expect(emailHowLine({ kind: "complained" })).toBe(m["contact.email.how.complained"]);
    expect(emailLine({ kind: "stopped", eventId: "e", since: "2026-10-04T02:30:00Z", how: { kind: "bounced" }, canResume: false }, "America/Chicago"))
      .toMatch(/^Since .*Oct 3.* · it bounced$/);
  });

  it("a date that will not format drops the date, never throws in a render (mutation: let formatDateInZone throw → FAILS)", () => {
    expect(emailLine({ kind: "stopped", eventId: "e", since: "not a date", how: { kind: "staff" }, canResume: true }, "America/Chicago"))
      .toBe(m["contact.email.how.staff"]);
  });
});

describe("noResumeLine — what the drawer says in place of a Resume button (D-016 item 4)", () => {
  it("a bounce and a complaint each get their OWN 7am explanation, never the generic unsubscribe-link line (mutation: always say customerOnly → FAILS)", () => {
    expect(noResumeLine({ kind: "bounced" })).toBe(m["contact.email.bouncedExplain"]);
    expect(noResumeLine({ kind: "complained" })).toBe(m["contact.email.complainedExplain"]);
  });

  it("a customer's own unsubscribe link still says the generic line (mutation: say bouncedExplain for every how → FAILS)", () => {
    expect(noResumeLine({ kind: "unsubscribe_link" })).toBe(m["contact.email.customerOnly"]);
  });
});

describe("parseEmailResponse — the drawer's read, parsed, never cast", () => {
  it("accepts the three views and refuses anything it cannot trust (mutation: accept a stopped view with no eventId → FAILS)", () => {
    expect(parseEmailResponse({ view: { kind: "allowed", newestId: null }, zone: "UTC" })).toEqual({ view: { kind: "allowed", newestId: null }, zone: "UTC" });
    expect(parseEmailResponse({ view: { kind: "no_email" }, zone: "UTC" })).not.toBeNull();
    expect(parseEmailResponse({ view: { kind: "stopped", since: "x", how: { kind: "staff" }, canResume: true }, zone: "UTC" })).toBeNull();
    expect(parseEmailResponse({ view: { kind: "held" }, zone: "UTC" })).toBeNull();
    expect(parseEmailResponse(null)).toBeNull();
  });
});

describe("runEmailAction — at once, the answer shown, Undo on the toast (rule 6)", () => {
  it("shows the new view and offers Undo; a refusal shows where things stand and says why (mutation: skip show on a refusal → a stale row stays, FAILS)", async () => {
    const show = vi.fn();
    const toast = { success: vi.fn(), error: vi.fn() };
    const undo = vi.fn();
    await runEmailAction(async () => ({ ok: true, view: { kind: "allowed", newestId: "n" }, undo: { kind: "stop", eventId: "e1" } }), show, toast, { success: "Emails stopped.", undo });
    expect(show).toHaveBeenCalledWith({ kind: "allowed", newestId: "n" });
    expect(toast.success).toHaveBeenCalledWith("Emails stopped.", expect.objectContaining({ action: expect.objectContaining({ label: m["common.undo"] }) }));
    await runEmailAction(async () => ({ ok: false, error: "changed", view: { kind: "allowed", newestId: null } }), show, toast, { success: "x" });
    expect(show).toHaveBeenLastCalledWith({ kind: "allowed", newestId: null });
    expect(toast.error).toHaveBeenCalledWith("changed");
  });

  it("the two treatments are dot + word with token classes only (rule 3; mutation: a hex colour → FAILS)", () => {
    for (const t of Object.values(EMAIL_TREATMENT)) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(`${t.dot} ${t.chip}`).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });
});
