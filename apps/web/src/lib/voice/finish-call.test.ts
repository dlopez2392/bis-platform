import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  finishCallRow: vi.fn(), createContact: vi.fn(), ensureConversation: vi.fn(),
  createMessage: vi.fn(), incrementUnreadCount: vi.fn(), emit: vi.fn(),
  fillContactBlanks: vi.fn(), updateMessageStatus: vi.fn(), hasRecentOutboundSms: vi.fn(),
  getAlertPhone: vi.fn(), getContact: vi.fn(), recordAutomationLog: vi.fn(), recordUsage: vi.fn(),
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
// `refusesAlertLoop` stays REAL (importOriginal) — only `resolveSmsSender`'s
// gate is faked. The staff-alert-SMS suite below relies on the genuine loop
// guard running against these mocked from/alert numbers.
vi.mock("@/lib/sms/sender", async (importOriginal) => ({
  ...(await importOriginal<object>()), resolveSmsSender: senderMocks.resolveSmsSender,
}));
const summaryMocks = vi.hoisted(() => ({ generateSummary: vi.fn() }));
vi.mock("./summary-service", () => ({ generateSummary: summaryMocks.generateSummary }));
// A STATIC import in finish-call.ts itself (`import { generateProposals } from
// "@/lib/proposals/generate"` at module scope) — vi.mock intercepts it the
// same way it intercepts every other module mocked in this file. Its own
// 59-test suite (apps/web/src/lib/proposals/generate.test.ts) owns the real
// generator's behaviour; this file owns only the lifecycle question of WHEN
// and WHETHER finishCall calls it, and WHAT it hands over.
const proposalsMocks = vi.hoisted(() => ({ generateProposals: vi.fn() }));
vi.mock("@/lib/proposals/generate", () => ({ generateProposals: proposalsMocks.generateProposals }));

import type { serviceDb } from "@bis/db";
import { segmentsFor } from "@/lib/sms/segments";
import { finishCall, isMeaningful, computeBlankFields, type FinishContext } from "./finish-call";
import {
  emptyCallState, withLead, withMessage, withTranscript, withBooking, withBookingCancelled, withServed,
  withTransferred, withRecordedCaller,
} from "./call-state";
import { defaultTextbackBody } from "./textback-body";
import { withOptOut } from "@/lib/sms/opt-out";

/**
 * The two raw-table reads `resolveOpenOpportunity` (finish-call.ts) makes —
 * no `@bis/db` wrapper exists for "this contact's one open opportunity plus
 * its pipeline's own stages", and this task is scoped to leave
 * `packages/db` untouched, so finish-call.ts reads the tables directly, the
 * same way `actions.ts` and `page.tsx` (this app's own opportunity-review
 * code) already do. Defaults to "no open opportunity" for every table this
 * function does not recognize as belonging to that read, so every OTHER
 * test in this file — which knows nothing about this shape — resolves
 * `openOpportunity: null` silently instead of throwing on `ctx.db.from` and
 * logging noise nobody asked for.
 */
function fakeOppDb(opts: {
  opportunities?: { id: string; stage_id: string; pipeline_id: string }[];
  oppErrorMessage?: string;
  stages?: { id: string; name: string; position: number }[];
  stagesErrorMessage?: string;
} = {}) {
  const oppFilters: unknown[] = [];
  const stageFilters: unknown[] = [];
  return {
    oppFilters, stageFilters,
    from: (table: string) => {
      if (table === "opportunities") {
        return {
          select: () => ({
            eq: (...a1: unknown[]) => { oppFilters.push(a1); return {
              eq: (...a2: unknown[]) => { oppFilters.push(a2); return {
                eq: (...a3: unknown[]) => {
                  oppFilters.push(a3);
                  // `.limit(2)` — the real read's own idiom (fix-wave
                  // Minor) — chains off this third `.eq()`, so it must be
                  // recorded rather than sending the resolved value straight
                  // out from here.
                  return {
                    limit: (...a4: unknown[]) => {
                      oppFilters.push(a4);
                      if (opts.oppErrorMessage) {
                        return Promise.resolve({ data: null, error: { message: opts.oppErrorMessage } });
                      }
                      return Promise.resolve({ data: opts.opportunities ?? [], error: null });
                    },
                  };
                },
              }; },
            }; },
          }),
        };
      }
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: (...a1: unknown[]) => { stageFilters.push(a1); return {
              eq: (...a2: unknown[]) => { stageFilters.push(a2); return {
                order: (...a3: unknown[]) => {
                  stageFilters.push(a3);
                  if (opts.stagesErrorMessage) {
                    return Promise.resolve({ data: null, error: { message: opts.stagesErrorMessage } });
                  }
                  return Promise.resolve({ data: opts.stages ?? [], error: null });
                },
              }; },
            }; },
          }),
        };
      }
      throw new Error(`fakeOppDb: unexpected table "${table}"`);
    },
  };
}

const ctx: FinishContext = {
  // Deliberately the bare `{}` this file has always used — many existing
  // assertions below (`toHaveBeenCalledWith({}, "a1", ...)`) hardcode that
  // literal rather than referencing `ctx.db` itself, so replacing it with a
  // working `fakeOppDb()` here would break them on a value-equality
  // mismatch having nothing to do with what they test. Every test in the
  // `openOpportunity` describe block below overrides `db` with its own
  // `fakeOppDb(...)`; every OTHER test reaches `resolveOpenOpportunity` (in
  // finish-call.ts) with this same empty object, which fails its own
  // `db.from(...)` call, is caught by that function's own try/catch (its
  // FAIL-CLOSED contract), and resolves `openOpportunity: null` — the exact
  // outcome those tests already expect of a call with no known opportunity,
  // just reached by the read failing rather than finding zero rows. Logs an
  // extra (unasserted) `finishCall: open-opportunity read failed` line in
  // those tests; no assertion in this file checks console.error call
  // counts (grep confirms), so this is inert noise, not a false pass.
  db: {} as unknown as ReturnType<typeof serviceDb>, accountId: "a1",
  // The customer-facing name, and the ONLY name this context carries — there
  // is no `accountName` on `FinishContext` any more.
  branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
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
  senderMocks.resolveSmsSender.mockReset().mockResolvedValue({
    ok: true, from: "+19565550100", ownedNumbers: ["+19565550100"],
  });
  dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: false });
  dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: true });
  dbMocks.createMessage.mockResolvedValue({ id: "m1" });
  dbMocks.finishCallRow.mockResolvedValue(undefined);
  dbMocks.fillContactBlanks.mockResolvedValue([]);
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  // "This caller has not been texted recently" is the ordinary case, so it is
  // the default here; the cooldown block below flips it.
  dbMocks.hasRecentOutboundSms.mockResolvedValue(false);
  // Off by default, same as a real account (0035_alert_phone.sql: the field
  // IS the switch) — the "the field is the switch" test below is the
  // regression guard for this default.
  dbMocks.getAlertPhone.mockResolvedValue(null);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.recordUsage.mockResolvedValue("recorded");
  // The ordinary case: a contact with all four allow-listed columns already
  // filled, so `blankFields` computes to `[]` unless a test deliberately
  // leaves one of these blank to exercise the propagation.
  dbMocks.getContact.mockReset().mockResolvedValue({
    id: "ct1", first_name: "Ana", last_name: "Ruiz",
    email: "ana@example.com", phone: "+19562921696",
  });
  // The ordinary case is "nothing to propose" — resolving 0 rather than
  // rejecting, matching generateProposals's real never-throws contract.
  proposalsMocks.generateProposals.mockReset().mockResolvedValue(0);
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
    // The stored body and the sent body are the same string, disclosure and
    // all — an operator reading the thread must not see a shorter message
    // than the customer received.
    const expectedBody = withOptOut(defaultTextbackBody("Rio Roofing", "en"), "en");
    expect(dbMocks.createMessage).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ conversationId: "cv1", channel: "sms", direction: "outbound",
        body: expectedBody }), "voice", "ai");
    expect(smsRefs.send).toHaveBeenCalledOnce();
    expect(smsRefs.send).toHaveBeenCalledWith({
      to: "+19562921696", from: "+19565550100", body: expectedBody,
    });
    // Not vacuous: assert the disclosure is literally on the wire, so
    // wrapping every expectation in withOptOut cannot pass by matching a
    // helper that has quietly become a no-op. CTIA requires this sentence on
    // a programme message, and the A2P campaign's samples are checked
    // against what actually goes out.
    expect(expectedBody).toContain("Reply STOP to opt out.");
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

  /**
   * `accounts.name` is the agency's internal label for the company — the
   * repo's own record of this defect on the email side is at
   * conversations/actions.ts's send: "Rio Roofing — trial" was reaching the
   * customer's From line. It was reaching the text-back's signature too, so a
   * stranger received "Hi, this is Rio Roofing — trial." AND, because that em
   * dash is outside GSM-7, paid for two segments to say it.
   *
   * The context no longer has a field for that label at all, which is what
   * the `@ts-expect-error` below pins: a re-added `accountName` makes the
   * directive unused and `tsc` refuses it.
   */
  it("signs with the BRAND name — the context has no agency label left to sign with", async () => {
    // Mutation: put `accountName: string` back on FinishContext.
    const leaky: FinishContext = {
      ...textbackCtx,
      // @ts-expect-error — FinishContext has no accountName
      accountName: "Rio Roofing — trial",
    };
    void leaky;

    await finishCall(abandonedState(), textbackCtx, meta);
    const body = (smsRefs.send.mock.calls[0]![0] as { body: string }).body;
    expect(body).toContain("Rio Roofing");
    expect(body).not.toContain("trial");
    expect(body).toBe(withOptOut(defaultTextbackBody("Rio Roofing", "en"), "en"));
    // The message the operator is billed for, not just the one they read.
    expect(segmentsFor(body)).toMatchObject({ encoding: "gsm7", segments: 1 });
    // And the row carries the same string that went out.
    expect(dbMocks.createMessage).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ body }), "voice", "ai");
  });

  // Was "falls back to the account name only when the company has no brand
  // name" — there is no fallback any longer. A company with no brand name
  // gets the nameless default, never the agency's internal label.
  it("sends the NAMELESS default when the company has no brand name", async () => {
    const unbranded: FinishContext = {
      ...textbackCtx,
      branding: { ...textbackCtx.branding, brandName: null },
    };
    await finishCall(abandonedState(), unbranded, meta);
    expect(smsRefs.send).toHaveBeenCalledWith(expect.objectContaining({
      body: withOptOut(defaultTextbackBody("", "en"), "en"),
    }));
  });

  it("an operator's own body is sent verbatim; the default is only the empty-body fallback", async () => {
    await finishCall(abandonedState(), { ...textbackCtx, textbackBody: "  Call us back at 956-555-0100.  " }, meta);
    expect(smsRefs.send).toHaveBeenCalledWith(expect.objectContaining({
      body: withOptOut("Call us back at 956-555-0100.", "en"),
    }));
  });

  /** A caller who spoke Spanish to Sofía was being answered in English. */
  it("answers a Spanish-speaking caller in Spanish", async () => {
    const s = withTranscript(emptyCallState(),
      { role: "caller", text: "hola, necesito ayuda con el techo por favor", at: "t" });
    await finishCall(s, textbackCtx, meta);
    expect(smsRefs.send).toHaveBeenCalledWith(expect.objectContaining({
      body: withOptOut(defaultTextbackBody("Rio Roofing", "es"), "es"),
    }));
    // The same value the row records, from the same computation — a call the
    // Calls page labels Spanish must not have been texted in English.
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ language: "es" }));
  });

  it("answers an English-speaking caller on the same bilingual line in English", async () => {
    const s = withTranscript(emptyCallState(),
      { role: "caller", text: "hi, I need help with the roof please", at: "t" });
    await finishCall(s, textbackCtx, meta);
    expect(smsRefs.send).toHaveBeenCalledWith(expect.objectContaining({
      body: withOptOut(defaultTextbackBody("Rio Roofing", "en"), "en"),
    }));
  });

  it("an es-only profile texts Spanish without the caller having to prove it", async () => {
    // detectSpokenLanguage short-circuits on a single-language profile, so a
    // caller who said almost nothing still gets their own language.
    await finishCall(abandonedState(), { ...textbackCtx, profileLanguage: "es" }, meta);
    expect(smsRefs.send).toHaveBeenCalledWith(expect.objectContaining({
      body: withOptOut(defaultTextbackBody("Rio Roofing", "es"), "es"),
    }));
  });

  it("never translates the operator's OWN body — they wrote it for their customers", async () => {
    const s = withTranscript(emptyCallState(),
      { role: "caller", text: "hola, necesito ayuda con el techo por favor", at: "t" });
    await finishCall(s, { ...textbackCtx, textbackBody: "Call us back at 956-555-0100." }, meta);
    expect(smsRefs.send).toHaveBeenCalledWith(expect.objectContaining({
      // Their words, untranslated — and the disclosure in the language the
      // CALLER spoke, which is the one thing about their message we do change.
      body: withOptOut("Call us back at 956-555-0100.", "es"),
    }));
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

  it("does NOT text a caller we put THROUGH TO A PERSON", async () => {
    // The sharpest form of the failure this gate exists to prevent, and the
    // one the design spec calls the finding that most shapes it: a caller who
    // ASKED for a human, got one, and was then texted "Sorry we missed you
    // just now" by the system that connected them.
    //
    // This is the behaviour test for the `transferred` marker. Its sibling in
    // call-state.test.ts asserts `served` contains "transferred", which only
    // restates `withTransferred`'s one line; nothing there fails if the
    // marker stops SUPPRESSING anything. Mutating `wasServed` to ignore
    // "transferred" compiles and left the whole suite green — this is the
    // test that goes red for it.
    const s = withTransferred(abandonedState());
    const r = await finishCall(s, textbackCtx, meta);
    expect(r.outcome).toBe("abandoned");   // the row is unchanged at socket close, on purpose
    expect(smsRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
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

  /**
   * The call record is worth more than the text. Everything the row needs —
   * contact, conversation, the outbound message row — is written before it;
   * the carrier round trip, which is the slow part and the part that can hang
   * for ten seconds inside an invocation that can be near its maxDuration,
   * comes after. Not the default case since Pro lifted the voice route's
   * ceiling to 800s against a 240s call cap, but exactly the case whenever
   * `PHONE_MAX_CALL_SECONDS` is raised toward the route's 750s clamp. Pinned
   * so a future reorder cannot quietly put the network call back in front of
   * the durable record.
   */
  it("writes the durable call row BEFORE handing anything to the carrier", async () => {
    await finishCall(abandonedState(), textbackCtx, meta);
    const messageWritten = dbMocks.createMessage.mock.invocationCallOrder[0]!;
    const rowWritten = dbMocks.finishCallRow.mock.invocationCallOrder[0]!;
    const sent = smsRefs.send.mock.invocationCallOrder[0]!;
    // Write then send, unchanged: the message row exists before anything
    // leaves the building.
    expect(messageWritten).toBeLessThan(sent);
    // ...and the call row is durable before the carrier is ever dialled.
    expect(messageWritten).toBeLessThan(rowWritten);
    expect(rowWritten).toBeLessThan(sent);
  });

  it("a carrier that never answers cannot cost the call its row", async () => {
    // The failure this ordering exists for, played out: the send is still in
    // flight when the invocation would be killed at maxDuration. The row —
    // what the dashboard, the KPIs and any later investigation read — is
    // already written by then.
    let releaseSend: (v: { providerMessageId: string }) => void = () => {};
    smsRefs.send.mockImplementation(() => new Promise((resolve) => { releaseSend = resolve; }));

    const finishing = finishCall(abandonedState(), textbackCtx, meta);
    await vi.waitFor(() => expect(smsRefs.send).toHaveBeenCalled());
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "abandoned", contactId: "ct1", conversationId: "cv1" }));

    releaseSend({ providerMessageId: "sm1" });
    await expect(finishing).resolves.toMatchObject({ stored: true });
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

/**
 * The staff ALERT text (danlo, 2026-09-15) — the SMS twin of the staff alert
 * EMAIL above, sent ALONGSIDE it, never instead. Distinct from the
 * "missed-call text-back" suite above in every way that matters: that one
 * texts the CUSTOMER on `abandoned` outcomes; this one texts the BUSINESS on
 * `isMeaningful` outcomes (booked/lead/message) — the same gate the email
 * alert already uses, matched exactly per the brief. `getAlertPhone` is
 * mocked via `@bis/db` (imported-original spread), same as every other
 * `@bis/db` read in this file; `resolveSmsSender`/`getSmsProvider` reuse the
 * SAME `senderMocks`/`smsRefs` the text-back suite above already mocks —
 * `lib/sms/alerts.ts` itself is NOT mocked, so this exercises the real
 * compose + gate + loop-guard logic, only the provider boundary is faked.
 */
describe("finishCall — the staff alert SMS", () => {
  const leadState = () => withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
    { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });

  it("fires alongside the email alert when the account has an alert_phone (mutation: drop the SMS leg entirely → FAILS)", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    const r = await finishCall(leadState(), ctx, meta);
    expect(r).toMatchObject({ outcome: "lead", notified: true });
    expect(emailRefs.send).toHaveBeenCalledTimes(1);
    expect(smsRefs.send).toHaveBeenCalledTimes(1);
    expect(smsRefs.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+19565559000", from: "+19565550100" }),
    );
  });

  it("the field is the switch — no alert_phone, no attempt at all (mutation: attempt regardless of alert_phone → FAILS)", async () => {
    // dbMocks.getAlertPhone resolves null by default (set in beforeEach).
    await finishCall(leadState(), ctx, meta);
    expect(senderMocks.resolveSmsSender).not.toHaveBeenCalled();
    expect(smsRefs.send).not.toHaveBeenCalled();
  });

  it("matches isMeaningful EXACTLY — an abandoned call never attempts the alert SMS even with alert_phone set (mutation: drop the isMeaningful gate on this leg → FAILS)", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    // ctx (not textbackCtx): text-back stays OFF, so any send here can only
    // be the alert leg misfiring on a non-meaningful outcome.
    const r = await finishCall(abandonedState(), ctx, meta);
    expect(r.outcome).toBe("abandoned");
    expect(smsRefs.send).not.toHaveBeenCalled();
  });

  it("a spam call (no meaningful transcript) never attempts the alert SMS either", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    const r = await finishCall(emptyCallState(), ctx, meta);
    expect(r.outcome).toBe("spam");
    expect(smsRefs.send).not.toHaveBeenCalled();
  });

  it("names the outcome and carries no phone number — booked/lead/message read distinctly", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    const bookedState = withBooking(emptyCallState(), { id: "bk1", contactName: "Ana", startsAt: "x", endsAt: "y" });
    await finishCall(bookedState, ctx, meta);
    const body = smsRefs.send.mock.calls[0]![0].body as string;
    expect(body.toLowerCase()).toContain("booked");
    expect(body).not.toMatch(/\+?\d{7,}/);
    expect(segmentsFor(body).segments).toBe(1);
  });

  // THE loop guard (0035_alert_phone.sql's decision 3): the migration
  // deliberately leaves this to the send path. alert_phone can equal the
  // account's own resolved sending number with nothing in the schema
  // stopping it.
  it("refuses and logs when alert_phone equals the account's own resolved sending number (mutation: drop the loop guard → FAILS)", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565550100"); // == senderMocks' default `from`
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await finishCall(leadState(), ctx, meta);
    expect(r.notified).toBe(true); // the EMAIL alert still succeeded
    expect(smsRefs.send).not.toHaveBeenCalled();
    const logged = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("+19565550100");
    errSpy.mockRestore();
  });

  // Finding 2 (alert-send-report follow-up review): the old loop guard only
  // ever compared against `gate.from`, the single resolved sending number.
  // api/sms/inbound/route.ts treats `testing` OR `live` as owned, so a
  // SECOND owned row (e.g. one still mid-provisioning) was an unguarded loop
  // even though it is not the number resolveSmsSender picked to send from.
  it("refuses when alert_phone matches a SECOND owned number, not only the resolved `from` (mutation: compare against gate.from alone → FAILS)", async () => {
    senderMocks.resolveSmsSender.mockResolvedValue({
      ok: true, from: "+19565550100", ownedNumbers: ["+19565550100", "+19565559000"],
    });
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000"); // owned, but NOT `from`
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await finishCall(leadState(), ctx, meta);
    expect(r.notified).toBe(true);
    expect(smsRefs.send).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // Finding 3 (alert-send-report follow-up review): live data showed two of
  // four calendars have no notify emails at all. For those accounts the
  // staff alert text was the only notification they get, and it used to
  // claim "Check your email for details" regardless.
  it("omits the email mention when ctx.notifyEmails is empty (mutation: ignore notifyEmails.length → FAILS)", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    const noEmailCtx: FinishContext = { ...ctx, notifyEmails: [] };
    await finishCall(leadState(), noEmailCtx, meta);
    const body = smsRefs.send.mock.calls[0]![0].body as string;
    expect(body.toLowerCase()).not.toContain("email");
  });

  it("still mentions email when ctx.notifyEmails is non-empty", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    await finishCall(leadState(), ctx, meta); // ctx.notifyEmails = ["staff@example.com"]
    const body = smsRefs.send.mock.calls[0]![0].body as string;
    expect(body.toLowerCase()).toContain("email");
  });

  // Finding 4 (alert-send-report follow-up review): finishCall spends a
  // dozen lines establishing that a 10-second provider call ahead of the
  // durable call row is how a slow carrier loses that row on an invocation
  // running out of budget, and splits the missed-call text-back around
  // `finishCallRow` for exactly that reason. The staff alert SMS leg used to
  // run its own carrier POST entirely BEFORE the row write; it must now
  // mirror the text-back's split — resolve/compose above, send below.
  it("hands the alert SMS to the carrier AFTER the durable call row is written, not before (mutation: put the send back before finishCallRow → FAILS)", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    await finishCall(leadState(), ctx, meta);
    const rowWritten = dbMocks.finishCallRow.mock.invocationCallOrder[0]!;
    const sent = smsRefs.send.mock.invocationCallOrder[0]!;
    expect(rowWritten).toBeLessThan(sent);
  });

  it("a carrier that never answers the alert SMS cannot cost the call its row", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    let releaseSend: (v: { providerMessageId: string }) => void = () => {};
    smsRefs.send.mockImplementation(() => new Promise((resolve) => { releaseSend = resolve; }));

    const finishing = finishCall(leadState(), ctx, meta);
    await vi.waitFor(() => expect(smsRefs.send).toHaveBeenCalled());
    expect(dbMocks.finishCallRow).toHaveBeenCalled();

    releaseSend({ providerMessageId: "sm1" });
    await expect(finishing).resolves.toMatchObject({ stored: true });
  });

  // Finding 5 (alert-send-report follow-up review): a failed (or successful)
  // alert had no symptom anywhere — no message row exists for this send
  // (0035 decision 3), so a success was never logged at all. The cheap fix:
  // log the provider message id and destination on success too.
  it("logs the providerMessageId and destination on a successful alert send (mutation: drop the success log → FAILS)", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await finishCall(leadState(), ctx, meta);
    const logged = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("sm1");
    expect(logged).toContain("+19565559000");
    errSpy.mockRestore();
  });

  it("a provider send failure never throws and never flips `notified` off (mutation: let the SMS leg's rejection escape → FAILS)", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559000");
    smsRefs.send.mockRejectedValue(new Error("telnyx down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await finishCall(leadState(), ctx, meta);
    expect(r).toMatchObject({ notified: true, stored: true });
    errSpy.mockRestore();
  });
});

/**
 * The proposal generator's placement in the lifecycle. The spec said
 * generation runs "alongside the summary" — that would ground every proposal
 * in `state.transcript` before it is durable anywhere. `generateProposals`
 * itself (61 tests, apps/web/src/lib/proposals) owns what a proposal SAYS;
 * this suite owns only WHEN and WHETHER `finishCall` calls it.
 */
describe("finishCall — proposal generation", () => {
  const leadState = () => withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
    { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });

  it("generates proposals only AFTER the call row is stored AND after the call.recorded emit — never upstream of the alert/text-back/CALL-LOST/emit tail (mutation: put the block back right after finishCallRow -> FAILS)", async () => {
    const order: string[] = [];
    dbMocks.finishCallRow.mockImplementation(async () => { order.push("finishCallRow"); });
    dbMocks.emit.mockImplementation(async () => { order.push("emit"); });
    proposalsMocks.generateProposals.mockImplementation(async () => { order.push("generateProposals"); return 0; });
    await finishCall(leadState(), ctx, meta);
    expect(order).toEqual(["finishCallRow", "emit", "generateProposals"]);
  });

  it("writes no proposals when the call row was never stored (callRowId null)", async () => {
    // startCallRow fail-opened at pickup, so meta.callRowId is null and no
    // row was ever written — a proposal keyed on a persisted transcript must
    // produce nothing rather than throw.
    await finishCall(leadState(), ctx, { ...meta, callRowId: null });
    expect(proposalsMocks.generateProposals).not.toHaveBeenCalled();
  });

  it("does not call generateProposals when finishCallRow itself fails (stored stays false)", async () => {
    // `meta.callRowId` is non-null here, but the write failed, so `stored`
    // never becomes true — the guard is `stored`, not merely "a row id was
    // handed in".
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await finishCall(leadState(), ctx, meta);
    expect(proposalsMocks.generateProposals).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("passes the real call id, the resolved contactId, the outcome, the transcript and handoffRequested", async () => {
    const s = withTransferred(leadState());
    await finishCall(s, ctx, meta);
    expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "a1", callId: "call1", contactId: "ct1", outcome: "lead",
      transcript: s.transcript, handoffRequested: true,
    }));
  });

  // Fix-wave Important 1: the model's only clock. `meta.endedAt` (this
  // call's own instant) and `ctx.timezone` (this account's own IANA zone) —
  // read from what finishCall already has, never a fresh `new Date()` built
  // here (mutation: pass `new Date()` instead of `meta.endedAt` -> this
  // assertion, pinned to the fixture's own `meta.endedAt` object identity,
  // would fail; `toHaveBeenCalledWith` fails a `new Date()` against any other
  // Date instance, even one for the same instant, only when they are not
  // `.toEqual`-equal in value — here they would still be UNEQUAL in value
  // too, since the fixture module runs well after 2027-06-01).
  it("passes this call's own instant and the account's own zone, never a freshly-read clock (mutation: pass new Date() instead of meta.endedAt -> FAILS)", async () => {
    await finishCall(leadState(), ctx, meta);
    expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
      now: meta.endedAt, timezone: "America/Chicago",
    }));
  });

  // Task 8: `generateProposals` cannot see the contact row, so finishCall
  // reads it and hands over exactly which of the four allow-listed columns
  // are currently empty. This is the propose-time half of the containment
  // rule — a field this array omits can never become a `contact_field`
  // proposal, no matter what the model asks for.
  // Fix-wave Important 1: `first_name: "Ana"` is a REAL, non-placeholder
  // name here, so `lastName` must NOT be reported blank even though
  // `last_name` is null — `fillContactBlanks` refuses to fill `last_name`
  // alone unless the first name is blank or this app's own "Caller"
  // placeholder, and a one-field `contact_field` proposal never carries a
  // `firstName` alongside it to make that compatible. Before this fix,
  // `blankFields` here was `["lastName", "email"]`, and a `lastName`
  // proposal built from it could reach the review screen and then NEVER be
  // accepted — the accept path reverts the stamp and the same proposal
  // returns pending, forever, on every subsequent click. One live contact
  // has exactly this shape.
  it("passes blankFields for exactly the resolved contact's own empty columns, honoring fillContactBlanks's own first-name rule (mutation: pass [] regardless of the contact -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({
      id: "ct1", first_name: "Ana", last_name: null, email: "", phone: "+19562921696",
    });
    await finishCall(leadState(), ctx, meta);
    expect(dbMocks.getContact).toHaveBeenCalledWith(ctx.db, "a1", "ct1");
    expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
      blankFields: ["email"],
    }));
  });

  // The mirror bug fixed alongside it: the "Caller" placeholder this file's
  // own `resolveContactId` writes is exactly the ONE shape
  // `fillContactBlanks` explicitly supports filling `firstName` for, and
  // before this fix it was never reported blank at all.
  it("reports firstName blank for this app's own \"Caller\" placeholder (mutation: require first_name to be nullish, not the placeholder too -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({
      id: "ct1", first_name: "Caller", last_name: null, email: null, phone: "+19562921696",
    });
    await finishCall(leadState(), ctx, meta);
    expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
      blankFields: ["firstName", "lastName", "email"],
    }));
  });

  // THE DURABLE FORM (fix-wave Important 1's own fix note): these two rules
  // — what THIS FILE calls blank, and what `fillContactBlanks`
  // (`@bis/db`'s `contacts.ts`) will actually fill — live in separate files
  // and were expressed separately, which is exactly what let them drift
  // apart and produce the defect above. Asserting one side's arithmetic in
  // isolation cannot catch a future re-drift; asserting AGREEMENT between
  // the real functions can. `vi.importActual` reaches past this file's own
  // `vi.mock("@bis/db", ...)` (line 9), which replaces `fillContactBlanks`
  // with a bare `vi.fn()`, to run the GENUINE implementation against a
  // hand-built client — not `dbMocks.fillContactBlanks`.
  describe("computeBlankFields parity with the real fillContactBlanks", () => {
    type ContactRow = { first_name: string | null; last_name: string | null; email: string | null; phone: string | null };
    type Field = "firstName" | "lastName" | "email" | "phone";

    // A minimal stand-in for the two calls `fillContactBlanks` makes: a
    // `getContact`-shaped read (`select().eq().eq().maybeSingle()`) and its
    // own unconditional `update().eq().eq()`, plus the `events` insert its
    // `emit()` call makes whenever it actually writes something. Table names
    // are checked so a stray call elsewhere in the real function surfaces as
    // a thrown error instead of a silently-wrong result.
    function fakeContactDb(row: ContactRow) {
      return {
        from: (table: string) => {
          if (table === "contacts") {
            return {
              select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
              update: () => ({
                eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
              }),
            };
          }
          if (table === "events") return { insert: async () => ({ error: null }) };
          throw new Error(`fakeContactDb: unexpected table "${table}"`);
        },
      };
    }

    const VALUES: Record<Field, string> = {
      firstName: "Maria", lastName: "Ruiz", email: "sam@example.com", phone: "+19565551234",
    };

    async function realFillsField(
      realFillContactBlanks: typeof import("@bis/db").fillContactBlanks,
      row: ContactRow, field: Field,
    ): Promise<boolean> {
      const db = fakeContactDb(row);
      const patch = { [field]: VALUES[field] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fakeContactDb is a hand-built stand-in, not a real SupabaseClient
      const filled = await realFillContactBlanks(db as any, "a1", "c1", patch, "voice", "ai");
      return filled.length > 0;
    }

    // The two PROVED shapes from the fix-wave report, plus three more that
    // exercise the same first-name rule from other angles — a wide-open
    // contact, a fully-filled one, and a "Caller" placeholder whose
    // last_name is ALREADY real (so the placeholder rule must NOT apply).
    const ROWS: { name: string; row: ContactRow }[] = [
      { name: "real first name, blank last name (the proved defect)",
        row: { first_name: "Ana", last_name: null, email: null, phone: null } },
      { name: "\"Caller\" placeholder, blank last name (the proved mirror case)",
        row: { first_name: "Caller", last_name: null, email: null, phone: null } },
      { name: "wide open",
        row: { first_name: null, last_name: null, email: null, phone: null } },
      { name: "everything already filled",
        row: { first_name: "Ana", last_name: "Ruiz", email: "a@example.com", phone: "+19560000000" } },
      { name: "\"Caller\" placeholder but a real last name already on file",
        row: { first_name: "Caller", last_name: "Smith", email: null, phone: null } },
    ];

    it.each(ROWS)("agrees with fillContactBlanks on every field for: $name", async ({ row }) => {
      const { fillContactBlanks: realFillContactBlanks } =
        await vi.importActual<typeof import("@bis/db")>("@bis/db");
      const blank = computeBlankFields(row);
      for (const field of ["firstName", "lastName", "email", "phone"] as const) {
        const wouldFill = await realFillsField(realFillContactBlanks, row, field);
        expect(blank.includes(field)).toBe(wouldFill);
      }
    });
  });

  it("passes blankFields: [] when the call resolved no contact, and never reads one", async () => {
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const noCallerCtx: FinishContext = { ...ctx, callerNumber: null };
    await finishCall(s, noCallerCtx, meta);
    expect(dbMocks.getContact).not.toHaveBeenCalled();
    expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
      contactId: null, blankFields: [],
    }));
  });

  // Fix-wave Minor: on this account's dominant traffic — several robocalls a
  // day, every one ineligible — this read used to run regardless, even
  // though `generateProposals` was always going to refuse the call anyway
  // (its own "ELIGIBILITY FIRST" doc). A transferred lead call is still
  // MEANINGFUL (it gets its contact, its alert) but INELIGIBLE for a
  // proposal purely because the caller asked for a person — exactly the case
  // that used to pay a wasted `getContact` round trip. `generateProposals`
  // itself must still be called with the real `handoffRequested: true` so
  // IT applies the refusal — only the now-pointless READ is skipped.
  it("skips the getContact read for blankFields when the call is ineligible, even though a contact was resolved (mutation: drop the callIsEligible gate on the read -> FAILS)", async () => {
    const s = withTransferred(leadState());
    await finishCall(s, ctx, meta);
    expect(dbMocks.getContact).not.toHaveBeenCalled();
    expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
      contactId: "ct1", handoffRequested: true, blankFields: [],
    }));
  });

  // FAIL-CLOSED ON THE FIELD, NEVER ON THE CALL: a DB blip reading the
  // contact must cost this feature its blank-field list, not the call its
  // proposals (still generated, just with no `contact_field` candidate) or
  // finishCall its never-throws contract.
  it("passes blankFields: [] and does not throw when reading the contact fails (mutation: remove the read's own try/catch -> FAILS)", async () => {
    dbMocks.getContact.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await finishCall(leadState(), ctx, meta);
    expect(result.stored).toBe(true);
    expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
      blankFields: [],
    }));
    errSpy.mockRestore();
  });

  // Task 9: `generateProposals`'s `opportunity_stage` branch cannot see the
  // pipeline either — it is handed exactly this contact's one open
  // opportunity and its pipeline's own real stage names, ordered by
  // position, or `null`. This is the propose-time source of that data;
  // `generateProposals`'s own 53-test suite (generate.test.ts) owns what it
  // does with it once handed over.
  describe("openOpportunity", () => {
    // Fix-wave Important 1: the opportunity's own `stage_id` is "s2" here,
    // NOT `rows[0]`'s id ("s1") — the earlier two-stage fixture put the
    // opportunity at the pipeline's FIRST stage, so `stageName: current.name`
    // and a wrong-index `rows[0]!.name` read produced the identical string.
    // A third stage is present so "the opportunity's own stage" and "the
    // pipeline's first stage" name two different, checkable things.
    it("passes an openOpportunity built from the contact's single open opportunity and its pipeline's own stages, reading the OPPORTUNITY'S OWN current stage — not the pipeline's first row (mutation: report rows[0] instead of the row matching opp.stage_id -> FAILS)", async () => {
      const oppDb = fakeOppDb({
        opportunities: [{ id: "o1", stage_id: "s2", pipeline_id: "p1" }],
        stages: [
          { id: "s1", name: "New Lead", position: 0 },
          { id: "s2", name: "Contacted", position: 1 },
          { id: "s3", name: "Appointment", position: 2 },
        ],
      });
      await finishCall(leadState(), { ...ctx, db: oppDb as unknown as ReturnType<typeof serviceDb> }, meta);
      expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
        openOpportunity: {
          id: "o1", stageId: "s2", stageName: "Contacted",
          stages: [
            { id: "s1", name: "New Lead", position: 0 },
            { id: "s2", name: "Contacted", position: 1 },
            { id: "s3", name: "Appointment", position: 2 },
          ],
        },
      }));
      // Filtered by THIS contact, `status = 'open'`, AND this account
      // (fix-wave Important 2) — never every opportunity the account has
      // ever had, and never keyed on the wrong tenant. `fakeOppDb` returns
      // the same fixture rows regardless of what it was filtered by, so
      // only asserting the RECORDED filter arguments (not the returned
      // data) catches a read keyed on the wrong column.
      expect(oppDb.oppFilters.flat()).toContain("ct1");
      expect(oppDb.oppFilters.flat()).toContain("open");
      expect(oppDb.oppFilters.flat()).toContain("a1");
      // The stages read must be keyed on the OPPORTUNITY'S OWN pipeline id
      // ("p1"), never its own row id ("o1") — fix-wave Important 2's other
      // half: a stages read keyed on the wrong pipeline hands the generator
      // a DIFFERENT pipeline's stage names, and the generator's own
      // membership check then validates against that wrong list.
      expect(oppDb.stageFilters.flat()).toContain("a1");
      expect(oppDb.stageFilters.flat()).toContain("p1");
    });

    it("passes openOpportunity: null when the contact has no open opportunity, refusing cleanly rather than crashing on an empty result (mutation: narrow the guard to `if (!opps)` alone -> FAILS)", async () => {
      const oppDb = fakeOppDb({ opportunities: [] });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await finishCall(leadState(), { ...ctx, db: oppDb as unknown as ReturnType<typeof serviceDb> }, meta);
      expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
        openOpportunity: null,
      }));
      // fix-wave Important 3: a zero-row result and a crash-then-swallow
      // both resolve to the identical `null` return, so that return value
      // alone cannot tell them apart. `opps[0].stage_id` on an empty
      // array's `undefined` element throws, is caught by
      // `resolveOpenOpportunity`'s own catch, and LOGS — a real zero-row
      // refusal never does. This is the one observable a broken guard
      // cannot fake.
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    // THE GUESS THIS FEATURE MUST NEVER MAKE: a call gives no signal about
    // WHICH of several open deals it concerns.
    it("passes openOpportunity: null when the contact has more than one open opportunity, refusing cleanly rather than crashing (mutation: drop the length !== 1 check -> FAILS)", async () => {
      // `stages` is populated (not left empty) so a dropped length check
      // would actually resolve a NON-null `openOpportunity` from `opps[0]`
      // — an empty `stages` array would ALSO resolve to `null` via the
      // separate `!current` guard just below, masking this exact mutation
      // the same way a fixture that trips an earlier gate would (Task 8's
      // own lesson: check the fixture reaches the guard under test).
      const oppDb = fakeOppDb({
        opportunities: [
          { id: "o1", stage_id: "s1", pipeline_id: "p1" },
          { id: "o2", stage_id: "s1", pipeline_id: "p1" },
        ],
        stages: [{ id: "s1", name: "New Lead", position: 0 }],
      });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await finishCall(leadState(), { ...ctx, db: oppDb as unknown as ReturnType<typeof serviceDb> }, meta);
      expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
        openOpportunity: null,
      }));
      // Same substitute as the zero-row test above: a genuine "more than
      // one" refusal never logs; only a guard that fell through to a crash
      // would.
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    // FAIL CLOSED, unlike the fail-open call-cap/startCallRow reads
    // elsewhere in this lifecycle — a missed stage-move proposal costs
    // nothing a caller depends on, so there is no fail-open argument here.
    it("passes openOpportunity: null and does not throw when the opportunities read fails (mutation: remove resolveOpenOpportunity's own try/catch -> throws instead of returning null)", async () => {
      const oppDb = fakeOppDb({ oppErrorMessage: "connection reset" });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await finishCall(
        leadState(), { ...ctx, db: oppDb as unknown as ReturnType<typeof serviceDb> }, meta,
      );
      expect(result.stored).toBe(true);
      expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
        openOpportunity: null,
      }));
      // fix-wave Important 2: pins the `if (error) throw ...` check itself —
      // deleting it leaves `data: null` reaching the same `!opps` branch and
      // the same `null` return, so only the log line this catch produces
      // distinguishes "the read errored" from "the read found nothing".
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("open-opportunity read failed"));
      errSpy.mockRestore();
    });

    it("passes openOpportunity: null and does not throw when the pipeline_stages read fails", async () => {
      const oppDb = fakeOppDb({
        opportunities: [{ id: "o1", stage_id: "s1", pipeline_id: "p1" }],
        stagesErrorMessage: "connection reset",
      });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await finishCall(
        leadState(), { ...ctx, db: oppDb as unknown as ReturnType<typeof serviceDb> }, meta,
      );
      expect(result.stored).toBe(true);
      expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
        openOpportunity: null,
      }));
      // fix-wave Important 2: pins the `if (stagesError) throw ...` check —
      // deleting it leaves `stages: null` reaching `rows = []`, then the
      // `!current` guard, then the same `null` return with no log at all.
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("open-opportunity read failed"));
      errSpy.mockRestore();
    });

    it("passes openOpportunity: null when the call resolved no contact, and never reads one", async () => {
      const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
      const oppDb = fakeOppDb();
      const noCallerCtx: FinishContext = { ...ctx, callerNumber: null, db: oppDb as unknown as ReturnType<typeof serviceDb> };
      await finishCall(s, noCallerCtx, meta);
      expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
        contactId: null, openOpportunity: null,
      }));
      expect(oppDb.oppFilters).toEqual([]);
    });

    // Same precedent as the blankFields read just above: `callIsEligible`
    // already gates that one so an ineligible call costs no wasted round
    // trip, and this read follows it — a transferred lead call is still
    // MEANINGFUL (gets its contact, its alert) but ineligible for a
    // proposal purely because the caller asked for a person.
    it("skips the open-opportunity read when the call is ineligible, even though a contact was resolved (mutation: drop the callIsEligible gate on this read -> FAILS)", async () => {
      const oppDb = fakeOppDb({
        opportunities: [{ id: "o1", stage_id: "s1", pipeline_id: "p1" }],
        stages: [{ id: "s1", name: "New Lead", position: 0 }],
      });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const s = withTransferred(leadState());
      await finishCall(s, { ...ctx, db: oppDb as unknown as ReturnType<typeof serviceDb> }, meta);
      expect(oppDb.oppFilters).toEqual([]);
      expect(proposalsMocks.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
        openOpportunity: null,
      }));
      // Same substitute as the zero-row/more-than-one tests above: a
      // genuinely SKIPPED read never logs; only a guard that fell through
      // to the real (empty-`db`) read and crashed would.
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  it("a proposal failure changes nothing about the call (mutation: remove the catch -> FAILS)", async () => {
    proposalsMocks.generateProposals.mockRejectedValue(new Error("model down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await finishCall(leadState(), ctx, meta);
    expect(result.stored).toBe(true);
    expect(result.outcome).toBe("lead");
    errSpy.mockRestore();
  });

  it("logs only when a proposal was actually written — silence is the normal case", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    proposalsMocks.generateProposals.mockResolvedValue(0);
    await finishCall(leadState(), ctx, meta);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("proposals"))).toBe(false);
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("logs when a proposal was written (mutation: drop the >0 log -> FAILS)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    proposalsMocks.generateProposals.mockResolvedValue(1);
    await finishCall(leadState(), ctx, meta);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("proposals") && String(c[0]).includes("call1"))).toBe(true);
    logSpy.mockRestore();
  });
});

/**
 * `isMeaningful` is the ONE definition of "an outcome worth a human seeing",
 * shared by the staff alert email and the staff alert SMS — its type
 * predicate narrows to `composeCallAlertSms`'s own parameter union so the two
 * legs are provably gated on the same set rather than two hand-copies of it.
 *
 * It is exercised DIRECTLY here rather than through `finishCall`, and that is
 * forced rather than preferred: `finishCall` derives its outcome from
 * `classifyOutcome`, which deliberately never returns `transferred` (at socket
 * close a handed-off call still classifies `abandoned` — from the socket's
 * point of view the caller did leave — and the handoff route upgrades the row
 * afterwards). So there is no state that drives `finishCall` to this branch.
 * That is exactly why the predicate is exported: a NEGATIVE rule on a branch
 * nothing reaches is unfalsifiable through `finishCall` in precisely the way a
 * positive one would be, and the export is what makes it testable at all.
 */
describe("isMeaningful", () => {
  it("does NOT count a transferred call — a completed transfer fires no staff alert", () => {
    // Two reasons, both from the design spec
    // (docs/superpowers/specs/2026-09-15-call-handoff-design.md). Structural:
    // the alert decision happens inside `finishCall` at socket close, BEFORE
    // the result route knows whether anyone actually picked up — alerting on a
    // transfer would mean a second send path inside a TeXML route, duplicating
    // the email and SMS machinery this repo keeps to exactly one. And about
    // what an alert is for: a person at the business just spoke to this caller
    // live, so they already know. An alert exists for work that might be
    // MISSED; telling someone about the call they personally answered is noise.
    expect(isMeaningful("transferred")).toBe(false);
  });

  it("still counts booked, lead and message, and still refuses abandoned and spam", () => {
    for (const outcome of ["booked", "lead", "message"] as const) {
      expect(isMeaningful(outcome), outcome).toBe(true);
    }
    // Nobody picked those up, so there is no one to hand off to — the whole
    // reason the predicate exists.
    for (const outcome of ["abandoned", "spam"] as const) {
      expect(isMeaningful(outcome), outcome).toBe(false);
    }
  });
});

describe("finishCall — the automation log row", () => {
  it("a handled call writes a sent row keyed by the call id with the resolved contact", async () => {
    const bookedState = withBooking(emptyCallState(), { id: "bk1", contactName: "Ana", startsAt: "x", endsAt: "y" });
    await finishCall(bookedState, ctx, meta);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "voice", channel: "ai", subjectKey: `call:${meta.callRowId}`, status: "sent", reason: "",
      contactId: "ct1",
    }));
  });

  it("a spam call writes a skipped row that says 'Screened as a robocall' (mutation: log every outcome as sent → FAILS)", async () => {
    const r = await finishCall(emptyCallState(), ctx, meta);
    expect(r.outcome).toBe("spam");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "Screened as a robocall",
    }));
  });

  it("no call row id → no log row; a log write that throws changes nothing about the result", async () => {
    const bookedState = withBooking(emptyCallState(), { id: "bk1", contactName: "Ana", startsAt: "x", endsAt: "y" });
    await finishCall(bookedState, ctx, { ...meta, callRowId: null });
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();

    dbMocks.recordAutomationLog.mockRejectedValue(new Error("down"));
    const r = await finishCall(bookedState, ctx, meta);
    expect(r).toEqual(expect.objectContaining({ stored: true }));
  });
});

describe("finishCall — usage: the minutes of a call Sofía talked to (client billing)", () => {
  const callOf = (secs: number) => ({
    callRowId: "call1", startedAt: new Date("2027-06-01T12:00:00Z"),
    endedAt: new Date(new Date("2027-06-01T12:00:00Z").getTime() + secs * 1000),
  });

  it("records voice minutes AFTER the durable row: the stored duration rounded UP, the call as source, the call's end as occurred_at; an abandoned call bills through the callerSpoke half alone (mutation: Math.round(secs / 60) → 2 minutes, FAILS; move the leg above finishCallRow → call order FAILS; gate on isMeaningful(outcome) alone → this abandoned call records nothing, FAILS)", async () => {
    const m = callOf(125);
    await finishCall(abandonedState(), ctx, m);
    expect(dbMocks.finishCallRow.mock.calls[0]![3]).toEqual(expect.objectContaining({ durationSecs: 125 }));
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(ctx.db, {
      accountId: "a1", meter: "voice_minutes", quantity: 3, occurredAt: m.endedAt, sourceRef: "call:call1",
    });
    expect(dbMocks.finishCallRow.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.recordUsage.mock.invocationCallOrder[0]!);
  });

  it("a silent call (Sofía's greeting, no caller words, no booking/lead/message) records nothing, though its turn_count is 1; nor does a connect-timeout with no transcript at all (mutation: gate on turn_count / transcript.length → FAILS; gate on the call row id alone → FAILS)", async () => {
    const s = withTranscript(emptyCallState(), { role: "assistant", text: "Hi, this is Sofía with Rio Roofing.", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("spam");
    expect(dbMocks.finishCallRow.mock.calls[0]![3]).toEqual(expect.objectContaining({ turnCount: 1 }));
    await finishCall(emptyCallState(), ctx, meta);
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("a message Sofía took bills though no caller turn was transcribed: the outcome says the caller interacted (mutation: gate on callerSpoke(state) alone → FAILS)", async () => {
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("message");
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(ctx.db, {
      accountId: "a1", meter: "voice_minutes", quantity: 2, occurredAt: meta.endedAt, sourceRef: "call:call1",
    });
  });

  it("a robocall that reached Sofía is billed although it records as spam: its minutes were spent (mutation: skip usage when the outcome is 'spam' → FAILS)", async () => {
    const s = withRecordedCaller(withTranscript(emptyCallState(),
      { role: "caller", text: "This is an important message about your vehicle's extended warranty", at: "t" }));
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("spam");
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(ctx.db, expect.objectContaining({
      meter: "voice_minutes", quantity: 2, sourceRef: "call:call1",
    }));
  });

  it("records the minutes even when the call row could not be written: the call still happened (mutation: gate the leg on `stored` → FAILS)", async () => {
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    const r = await finishCall(abandonedState(), ctx, meta);
    expect(r.stored).toBe(false);
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(ctx.db, expect.objectContaining({ quantity: 2, sourceRef: "call:call1" }));
  });

  it("with no call row there is nothing to key the usage on, so nothing is recorded (mutation: drop the callRowId gate → recorded as 'call:null', FAILS)", async () => {
    await finishCall(abandonedState(), ctx, { ...meta, callRowId: null });
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("a failing usage write changes nothing: same result, the text-back still sent, the activity event still emitted (mutation: remove recordUsageSafely's catch → finishCall rejects, FAILS)", async () => {
    dbMocks.recordUsage.mockRejectedValue(new Error("usage_events is down"));
    const r = await finishCall(abandonedState(), textbackCtx, meta);
    expect(r).toEqual({ stored: true, notified: false, outcome: "abandoned" });
    expect(smsRefs.send).toHaveBeenCalledTimes(1);
    expect(dbMocks.emit).toHaveBeenCalledWith(
      expect.anything(), "a1", "call.recorded", "voice", { callId: "call1", outcome: "abandoned" }, "ai");
  });
});
