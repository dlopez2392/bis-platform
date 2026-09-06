import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  finishCallRow: vi.fn(), createContact: vi.fn(), ensureConversation: vi.fn(),
  createMessage: vi.fn(), incrementUnreadCount: vi.fn(), emit: vi.fn(),
  fillContactBlanks: vi.fn(), updateMessageStatus: vi.fn(), hasRecentOutboundSms: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const emailRefs = vi.hoisted(() => ({ providerShouldThrow: false, send: vi.fn() }));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => {
    if (emailRefs.providerShouldThrow) throw new Error("RESEND_API_KEY missing");
    return { send: (...a: unknown[]) => emailRefs.send(...a) };
  },
}));
// Same shape as the email mock above, for the same reason: getSmsProvider()
// throws SYNCHRONOUSLY when TELNYX_API_KEY is missing in production — which
// is production's state right now — so the throw has to be reachable from a
// test, not just the send rejection.
const smsRefs = vi.hoisted(() => ({ providerShouldThrow: false, send: vi.fn() }));
vi.mock("@/lib/sms", () => ({
  getSmsProvider: () => {
    if (smsRefs.providerShouldThrow) throw new Error("TELNYX_API_KEY is required in production");
    return { isFake: true, send: (...a: unknown[]) => smsRefs.send(...a) };
  },
}));
const senderMocks = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: senderMocks.resolveSmsSender }));
const summaryMocks = vi.hoisted(() => ({ generateSummary: vi.fn() }));
vi.mock("./summary-service", () => ({ generateSummary: summaryMocks.generateSummary }));

import type { serviceDb } from "@bis/db";
import { finishCall, type FinishContext } from "./finish-call";
import {
  emptyCallState, withLead, withMessage, withTranscript, withBooking, withBookingCancelled, withServed,
} from "./call-state";
import { defaultTextbackBody } from "./textback-body";

const ctx: FinishContext = {
  db: {} as unknown as ReturnType<typeof serviceDb>, accountId: "a1", accountName: "Rio Roofing",
  branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
  notifyEmails: ["staff@example.com"], callerNumber: "+19562921696",
  origin: "https://x.example", profileLanguage: "both", timezone: "America/Chicago",
  // Off in the shared context on purpose: the pre-existing "abandoned creates
  // nothing" case below is the regression guard for the default, and it only
  // means something while the default is the off state a real account ships in.
  textbackEnabled: false, textbackBody: "",
};
const textbackCtx: FinishContext = { ...ctx, textbackEnabled: true };
/** A caller who SPOKE and got nothing — classifyOutcome's "abandoned". */
const abandonedState = () => withTranscript(emptyCallState(), { role: "caller", text: "uh", at: "t" });

const meta = { callRowId: "call1", startedAt: new Date("2027-06-01T12:00:00Z"), endedAt: new Date("2027-06-01T12:02:00Z") };

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  summaryMocks.generateSummary.mockReset().mockResolvedValue("RECORDED — test.");
  emailRefs.providerShouldThrow = false;
  emailRefs.send.mockReset().mockResolvedValue({ providerMessageId: "x" });
  smsRefs.providerShouldThrow = false;
  smsRefs.send.mockReset().mockResolvedValue({ providerMessageId: "sm1" });
  senderMocks.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550100" });
  dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: false });
  dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: true });
  dbMocks.createMessage.mockResolvedValue({ id: "m1" });
  dbMocks.finishCallRow.mockResolvedValue(undefined);
  dbMocks.fillContactBlanks.mockResolvedValue([]);
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  // "This caller has not been texted recently" is the ordinary case, so it is
  // the default here; the cooldown block below flips it.
  dbMocks.hasRecentOutboundSms.mockResolvedValue(false);
});

describe("finishCall", () => {
  it("a lead call runs the full treatment: contact → conversation → message(voice) → unread → alert → row", async () => {
    const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: true, notified: true, outcome: "lead" });
    expect(dbMocks.createContact).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ firstName: "Ana", lastName: "Ruiz", phone: "+19562921696", source: "voice" }), "voice", "ai");
    expect(dbMocks.createMessage).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ channel: "voice", direction: "inbound" }), "voice", "ai");
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalled();
    expect(emailRefs.send).toHaveBeenCalledTimes(1);
    const sent = emailRefs.send.mock.calls[0]![0];
    expect(sent.fromAddress).toBeUndefined();              // staff mail: platform From
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "lead", contactId: "ct1", conversationId: "cv1", durationSecs: 120 }));
  });
  it("an abandoned call records the row but creates nothing and alerts nobody", async () => {
    const s = withTranscript(emptyCallState(), { role: "caller", text: "uh", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("abandoned");
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(emailRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.finishCallRow).toHaveBeenCalled();
  });
  it("DB down + email up → stored:false notified:true, and it never throws", async () => {
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    dbMocks.createContact.mockRejectedValue(new Error("db down"));
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: false, notified: true });
  });
  it("both legs down → CALL LOST logged, still no throw", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    dbMocks.createContact.mockRejectedValue(new Error("db down"));
    emailRefs.send.mockRejectedValue(new Error("mail down"));
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: false, notified: false });
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("CALL LOST"))).toBe(true);
    errSpy.mockRestore();
  });
  it("getEmailProvider() throwing (rotated key) returns ok without throwing, row still written", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    emailRefs.providerShouldThrow = true;
    const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: true, notified: false, outcome: "lead" });
    expect(dbMocks.finishCallRow).toHaveBeenCalled();
    errSpy.mockRestore();
  });
  it("lead path dedupe onto an existing contact backfills blanks (rejection still stores + alerts)", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: true });
    dbMocks.fillContactBlanks.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    const r = await finishCall(s, ctx, meta);
    errSpy.mockRestore();
    expect(dbMocks.fillContactBlanks).toHaveBeenCalledWith({}, "a1", "ct1",
      { firstName: "Ana", lastName: "Ruiz", email: undefined, phone: "+19562921696" }, "voice", "ai");
    expect(r).toMatchObject({ stored: true, notified: true, outcome: "lead" });
    // Pins the LOCAL try/catch around fillContactBlanks: without it, the
    // rejection propagates to the outer per-leg catch and silently skips
    // ensureConversation/createMessage/incrementUnreadCount too — but stored/
    // notified above come from independent blocks and would stay green either
    // way, so this is the only thing that actually pins the local catch.
    expect(dbMocks.ensureConversation).toHaveBeenCalled();
    expect(dbMocks.createMessage).toHaveBeenCalled();
  });
  it("caller-ID-only path (no lead) backfills the bare phone on dedupe, symmetric shape", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: true });
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    await finishCall(s, ctx, meta);
    expect(dbMocks.fillContactBlanks).toHaveBeenCalledWith({}, "a1", "ct1",
      { phone: "+19562921696" }, "voice", "ai");
  });
  it("a booked call reuses state.contactId instead of creating a duplicate", async () => {
    const s = { ...withBooking(emptyCallState(), { id: "bk1", contactName: "Ana", startsAt: "x", endsAt: "y" }), contactId: "ct-existing" };
    await finishCall(s, ctx, meta);
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "booked", contactId: "ct-existing", bookingId: "bk1" }));
  });
  it("passes ctx.timezone through to generateSummary so prose speaks the account's local zone", async () => {
    const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    await finishCall(s, ctx, meta);
    expect(summaryMocks.generateSummary).toHaveBeenCalledWith(s, expect.objectContaining({ timezone: "America/Chicago" }));
  });
  it("a bilingual-profile call whose caller turns are Spanish stores language: es on the row", async () => {
    const s = withLead(withTranscript(emptyCallState(),
      { role: "caller", text: "hola, necesito una cita para mañana por favor", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    await finishCall(s, ctx, meta);
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ language: "es" }));
  });
});

describe("finishCall — missed-call text-back", () => {
  it("texts back an ABANDONED caller when the toggle is on, and creates the contact", async () => {
    // abandoned = the caller SPOKE but produced no booking, lead or message
    // (call-state.ts:31). That is the follow-up target.
    const r = await finishCall(abandonedState(), textbackCtx, meta);
    expect(r.outcome).toBe("abandoned");
    expect(dbMocks.createContact).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ firstName: "Caller", phone: "+19562921696", source: "voice" }), "voice", "ai");
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith({}, "a1", "ct1", "voice", "ai");
    expect(dbMocks.createMessage).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ conversationId: "cv1", channel: "sms", direction: "outbound",
        body: defaultTextbackBody("Rio Roofing") }), "voice", "ai");
    expect(smsRefs.send).toHaveBeenCalledOnce();
    expect(smsRefs.send).toHaveBeenCalledWith({
      to: "+19562921696", from: "+19565550100", body: defaultTextbackBody("Rio Roofing"),
    });
    // "ai", not "user": actor_id "voice" with actor_type "user" is the exact
    // mis-attribution M1b fixed for the Resend webhook, and finish-call.ts's
    // ACTOR_TYPE comment forbids it for every write this function makes.
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith({}, "a1", "m1", "sent",
      { providerMessageId: "sm1" }, "voice", "ai");
  });

  it("does NOT bump the unread count — unread means INBOUND, and this text is ours", async () => {
    await finishCall(abandonedState(), textbackCtx, meta);
    expect(dbMocks.incrementUnreadCount).not.toHaveBeenCalled();
  });

  it("points the call row at the contact and conversation the text-back created", async () => {
    // Without this the row keeps the nulls an abandoned call has always
    // written, and there is no path from the call to the text it sent.
    await finishCall(abandonedState(), textbackCtx, meta);
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "abandoned", contactId: "ct1", conversationId: "cv1" }));
  });

  it("an operator's own body is sent verbatim; the default is only the empty-body fallback", async () => {
    await finishCall(abandonedState(), { ...textbackCtx, textbackBody: "  Call us back at 956-555-0100.  " }, meta);
    expect(smsRefs.send).toHaveBeenCalledWith(expect.objectContaining({ body: "Call us back at 956-555-0100." }));
  });

  it("does NOT text a SPAM call", async () => {
    // spam = the caller never spoke. Gating on `abandoned` excludes silent
    // robocalls by CLASSIFICATION rather than by rule, which is what makes
    // creating a contact acceptable.
    const r = await finishCall(emptyCallState(), textbackCtx, meta);
    expect(r.outcome).toBe("spam");
    expect(smsRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("does NOT text a call that already got the full treatment (lead)", async () => {
    const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    await finishCall(s, textbackCtx, meta);
    expect(smsRefs.send).not.toHaveBeenCalled();
  });

  it("does NOT text a caller whose booking we CANCELLED for them", async () => {
    // The live defect: the booking was made on an earlier call, so
    // `withBookingCancelled` maps over an empty array and the call ends
    // `abandoned` with nothing in state. Cancelling is one of the most
    // ordinary call types there is, and this branch turned every one of them
    // into an automatic, unretractable "Sorry we missed you just now".
    const s = withServed(withBookingCancelled(abandonedState(), "booking-from-last-week"), "cancelled");
    const r = await finishCall(s, textbackCtx, meta);
    expect(r.outcome).toBe("abandoned");                 // the row is unchanged, on purpose
    expect(smsRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(senderMocks.resolveSmsSender).not.toHaveBeenCalled();
  });

  it("does NOT text a caller who rang up to CHECK their appointment time", async () => {
    // find_my_booking that found something: a complete, successful call that
    // writes nothing to the database and so classifies `abandoned` too.
    const s = withServed(abandonedState(), "booking_found");
    const r = await finishCall(s, textbackCtx, meta);
    expect(r.outcome).toBe("abandoned");
    expect(smsRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("does NOT text a caller we RESCHEDULED, whichever way the state is read", async () => {
    // Belt and braces: a real reschedule also mirrors a new booking, so this
    // is `booked` today and never reaches the gate. Pinned against the state
    // shape changing underneath the gate.
    const s = withServed(abandonedState(), "rescheduled");
    await finishCall(s, textbackCtx, meta);
    expect(smsRefs.send).not.toHaveBeenCalled();
  });

  it("STILL texts the ordinary abandoned caller — the served gate is not a blanket off switch", async () => {
    // The regression guard for the two tests above: a caller who spoke and
    // got nothing is exactly who this feature is for.
    const r = await finishCall(abandonedState(), textbackCtx, meta);
    expect(r.outcome).toBe("abandoned");
    expect(smsRefs.send).toHaveBeenCalledOnce();
  });

  it("does NOT text when the toggle is off", async () => {
    await finishCall(abandonedState(), ctx, meta);
    expect(senderMocks.resolveSmsSender).not.toHaveBeenCalled();
    expect(smsRefs.send).not.toHaveBeenCalled();
  });

  it("does NOT text when there is no caller number to text", async () => {
    await finishCall(abandonedState(), { ...textbackCtx, callerNumber: null }, meta);
    expect(smsRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("does NOT text when the SMS gate refuses, and writes no rows for it either", async () => {
    // A2P not approved must stop the automation too, not just the composer.
    senderMocks.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    await finishCall(abandonedState(), textbackCtx, meta);
    expect(smsRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a text-back failure does not take down the rest of finishCall, and marks the row failed", async () => {
    // finishCall is contractually never-throws: the caller has already hung
    // up, and there is nobody to surface a rejection to.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    smsRefs.send.mockRejectedValue(new Error("telnyx down"));
    await expect(finishCall(abandonedState(), textbackCtx, meta)).resolves.toMatchObject({ outcome: "abandoned" });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith({}, "a1", "m1", "failed",
      { error: "telnyx down" }, "voice", "ai");
    expect(dbMocks.finishCallRow).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("a failing `failed`-status write does not swallow the real send error", async () => {
    // The status write is BOOKKEEPING; the carrier failure is the news. Awaited
    // bare, a rejection here replaced the throw entirely — the outer catch
    // logged the DATABASE error and "telnyx down" vanished with it.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    smsRefs.send.mockRejectedValue(new Error("telnyx down"));
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("db down"));

    const r = await finishCall(abandonedState(), textbackCtx, meta);

    const logged = errSpy.mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes("text-back failed") && l.includes("telnyx down"))).toBe(true);
    // The bookkeeping failure is still reported — just not INSTEAD of the send
    // failure, and not as the text-back's cause of death.
    expect(logged.some((l) => l.includes("could not mark message m1 failed") && l.includes("db down"))).toBe(true);
    expect(r).toMatchObject({ stored: true, outcome: "abandoned" });
    errSpy.mockRestore();
  });

  it("getSmsProvider() throwing (no TELNYX_API_KEY) never escapes, and the row still gets written", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    smsRefs.providerShouldThrow = true;
    const r = await finishCall(abandonedState(), textbackCtx, meta);
    expect(r).toMatchObject({ stored: true, outcome: "abandoned" });
    errSpy.mockRestore();
  });

  it("resolveSmsSender THROWING (phone_numbers read error) never escapes either", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    senderMocks.resolveSmsSender.mockRejectedValue(new Error("resolveSmsSender failed"));
    const r = await finishCall(abandonedState(), textbackCtx, meta);
    expect(r).toMatchObject({ stored: true, outcome: "abandoned" });
    expect(smsRefs.send).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("a status-write failure AFTER a successful send never relabels the text failed", async () => {
    // The text is gone and cannot be unsent. Re-labelling it `failed` because
    // the bookkeeping write blew up would tell the operator a delivered text
    // never went out — same hazard, same call, as sendSmsAction's own comment.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("db down"));
    const r = await finishCall(abandonedState(), textbackCtx, meta);
    expect(smsRefs.send).toHaveBeenCalledOnce();
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledTimes(1);
    expect(dbMocks.updateMessageStatus).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), "failed", expect.anything(), expect.anything());
    expect(r).toMatchObject({ stored: true, outcome: "abandoned" });
    errSpy.mockRestore();
  });
});

describe("finishCall — text-back cooldown", () => {
  it("does NOT text a caller who already got one inside the window, and writes no row for it", async () => {
    // The whole point: a repeat abandoned caller getting the byte-identical
    // body on every call is what carrier filtering hunts for under 10DLC, and
    // the A2P registration it burns is the CLIENT'S.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.hasRecentOutboundSms.mockResolvedValue(true);

    const r = await finishCall(abandonedState(), textbackCtx, meta);

    expect(smsRefs.send).not.toHaveBeenCalled();
    // Checked BEFORE the write, so a suppressed text-back leaves no outbound
    // row claiming a text that never went out.
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.updateMessageStatus).not.toHaveBeenCalled();
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("text-back suppressed"))).toBe(true);
    // Still a normal finished call: the row lands, pointed at the contact and
    // conversation, and nothing throws.
    expect(r).toMatchObject({ stored: true, outcome: "abandoned" });
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "abandoned", contactId: "ct1", conversationId: "cv1" }));
    errSpy.mockRestore();
  });

  it("DOES text when the window is clear — the suppression above is not the default", async () => {
    dbMocks.hasRecentOutboundSms.mockResolvedValue(false);
    await finishCall(abandonedState(), textbackCtx, meta);
    expect(smsRefs.send).toHaveBeenCalledOnce();
  });

  it("asks about THIS account and THIS conversation only, over a 24-hour window", async () => {
    // Tenant scope is the load-bearing half: a conversation id is a bare uuid,
    // and this read must never be satisfiable by another tenant's messages.
    const before = Date.now();
    await finishCall(abandonedState(), textbackCtx, meta);
    const after = Date.now();

    expect(dbMocks.hasRecentOutboundSms).toHaveBeenCalledOnce();
    const [db, accountId, conversationId, since] = dbMocks.hasRecentOutboundSms.mock.calls[0]!;
    expect(db).toEqual({});
    expect(accountId).toBe("a1");
    expect(conversationId).toBe("cv1");
    const windowMs = 24 * 60 * 60 * 1000;
    expect((since as Date).getTime()).toBeGreaterThanOrEqual(before - windowMs);
    expect((since as Date).getTime()).toBeLessThanOrEqual(after - windowMs);
  });

  it("is consulted only AFTER the gate — a refused account is never even asked", async () => {
    senderMocks.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    await finishCall(abandonedState(), textbackCtx, meta);
    expect(dbMocks.hasRecentOutboundSms).not.toHaveBeenCalled();
  });

  it("a cooldown read that THROWS costs the text, not the call row", async () => {
    // finishCall is contractually never-throws, and this is now the first DB
    // read the leg makes.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.hasRecentOutboundSms.mockRejectedValue(new Error("hasRecentOutboundSms failed: db down"));
    const r = await finishCall(abandonedState(), textbackCtx, meta);
    expect(smsRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(r).toMatchObject({ stored: true, outcome: "abandoned" });
    errSpy.mockRestore();
  });
});
