import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ getBranding: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const gate = vi.hoisted(() => ({ sendSms: vi.fn() }));
vi.mock("./gate", () => gate);

import { consentReplyBody, telnyxReplyText, sendConsentReply, TELNYX_KEYWORDS } from "./replies";
import { segmentsFor } from "@/lib/sms/segments";

const KINDS = ["consent.stop_confirmation", "consent.start_confirmation", "consent.help"] as const;

describe("consentReplyBody — what BIS itself sends", () => {
  it("signs with the business name in the language asked (mutation: always English → FAILS)", () => {
    expect(consentReplyBody("consent.stop_confirmation", "es", "956 Woodworks"))
      .toBe("956 Woodworks: Ya no le enviaremos mensajes. Responda START para volver a recibirlos.");
    expect(consentReplyBody("consent.help", "en", "956 Woodworks")).toBe("956 Woodworks: Reply STOP to stop texts from us. Call or text this number for help.");
  });

  it("the help reply names a way to reach the business, in both languages — the A2P campaign's promise (a2p-registration.md:197-199; danlo 2026-09-28; mutation: drop the contact sentence → FAILS)", () => {
    expect(consentReplyBody("consent.help", "en", "956 Woodworks")).toContain("Call or text this number for help.");
    expect(consentReplyBody("consent.help", "es", "956 Woodworks")).toContain("Llame o escriba a este numero para recibir ayuda.");
  });

  it("a blank name drops the prefix rather than inventing one (mutation: sign as \"\" → ': You won't…', FAILS)", () => {
    expect(consentReplyBody("consent.start_confirmation", "en", "  ")).toBe("You'll get our texts again. Reply STOP to stop them.");
  });

  it("a name holding $& or $1 is printed as written (mutation: .replace with a string replacement → FAILS)", () => {
    expect(consentReplyBody("consent.help", "en", "A$&B")).toBe("A$&B: Reply STOP to stop texts from us. Call or text this number for help.");
  });

  it.each(KINDS.flatMap((k) => (["en", "es"] as const).map((l) => [k, l] as const)))(
    "%s in %s is GSM-7 and ONE segment for a 20-character GSM-7 name (spec: no á, í, ó or ú; mutation: put an accent in the line → UCS-2, FAILS)",
    (kind, lang) => {
      const s = segmentsFor(consentReplyBody(kind, lang, "Rio Grande Plumbing!"));
      expect(s.encoding).toBe("gsm7");
      expect(s.segments).toBe(1);
    });
});

describe("telnyxReplyText — what each business's Telnyx profile answers (Task 16 step 10; danlo's decision 1)", () => {
  it("is the English line then the Spanish line without its prefix, one bilingual reply (mutation: prefix the Spanish half too → FAILS)", () => {
    expect(telnyxReplyText("stop", "956 Woodworks")).toBe(
      "956 Woodworks: You won't get any more texts from us. Reply START to get them again. Ya no le enviaremos mensajes. Responda START para volver a recibirlos.");
  });

  it("is at least Telnyx's 20 characters and GSM-7 for every op, even nameless (plan F2; mutation: an empty reply → FAILS)", () => {
    for (const op of ["stop", "start", "help"] as const) {
      const t = telnyxReplyText(op, "");
      expect(t.length).toBeGreaterThanOrEqual(20);
      expect(segmentsFor(t).encoding).toBe("gsm7");
    }
  });

  it("with a 20-character GSM-7 name every Telnyx reply stays GSM-7 and at most two segments (measured: stop 161 → 2, start 144 → 1, help 187 → 2; mutation: \"número\" in the Spanish help → UCS-2, three segments, FAILS)", () => {
    for (const op of ["stop", "start", "help"] as const) {
      const s = segmentsFor(telnyxReplyText(op, "Rio Grande Plumbing!"));
      expect(s.encoding, op).toBe("gsm7");
      expect(s.segments, op).toBeLessThanOrEqual(2);
    }
  });

  it("the stop config lists every stop word of decision 10, each at most once, within Telnyx's 20 (plan F2; mutation: drop NO MÁS → FAILS)", () => {
    expect(TELNYX_KEYWORDS.stop).toEqual([
      "STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPT OUT", "OPTOUT",
      "PARAR", "DETENER", "ALTO", "CANCELAR", "BAJA", "NO MAS", "NO MÁS",
    ]);
    expect(new Set(TELNYX_KEYWORDS.stop).size).toBe(TELNYX_KEYWORDS.stop.length);
    expect(TELNYX_KEYWORDS.stop.length).toBeLessThanOrEqual(20);
    expect(TELNYX_KEYWORDS.start).toEqual(["START", "UNSTOP"]);
    expect(TELNYX_KEYWORDS.help).toEqual(["HELP", "AYUDA"]);
  });
});

describe("sendConsentReply — the one BIS reply, through the gate", () => {
  const plan = { kind: "consent.stop_confirmation" as const, language: "es" as const, answersEventId: "ev_1" };
  beforeEach(() => {
    for (const fn of [...Object.values(db), gate.sendSms]) fn.mockReset();
    db.getBranding.mockResolvedValue({ brandName: " 956 Woodworks " });
    db.createMessage.mockResolvedValue({ id: "msg_out" });
    gate.sendSms.mockImplementation(async (_d: unknown, req: { body: string }, opts: { prepare?: (c: object) => Promise<void> }) => {
      await opts.prepare?.({ body: req.body, to: "+19562921696", from: "+19565550000" });
      return { kind: "sent", providerMessageId: "p_1", to: "+19562921696", from: "+19565550000", body: req.body, billable: true, segments: 1 };
    });
    // .mockClear() before re-implementing: vi.spyOn on an already-spied
    // method returns the SAME mock instance, so without this its .mock.calls
    // from an earlier test in this file leak into the next one's assertions
    // (found running this file whole: "a 'sent' status write ..." failed only
    // in the full-file run, never alone — the earlier "a refusal or a
    // failure is logged ..." test's two "not sent:" lines were still in
    // console.error's history).
    vi.spyOn(console, "error").mockClear().mockImplementation(() => {});
    vi.spyOn(console, "info").mockClear().mockImplementation(() => {});
  });

  it("asks the gate for the kind, the carrier's number, the stop it answers and the business-named line (mutation: numberFromCarrier false → FAILS)", async () => {
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    expect(gate.sendSms.mock.calls[0]![1]).toEqual({
      accountId: "a1", kind: "consent.stop_confirmation", to: "+19562921696", contactId: "ct_1", language: "es",
      numberFromCarrier: true, answersEventId: "ev_1",
      body: "956 Woodworks: Ya no le enviaremos mensajes. Responda START para volver a recibirlos.",
    });
  });

  it("files the reply in the thread before it leaves, then marks it sent with the provider's id (mutation: skip the sent write → FAILS)", async () => {
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    expect(db.createMessage).toHaveBeenCalledWith({}, "a1", expect.objectContaining({ conversationId: "conv_1", channel: "sms", direction: "outbound" }), "sms-inbound", "system");
    expect(db.updateMessageStatus).toHaveBeenCalledWith({}, "a1", "msg_out", "sent", { providerMessageId: "p_1" }, "sms-inbound", "system");
  });

  it("the alert phone has no thread: the reply still goes, and nothing is filed (mutation: require a conversation → no send, FAILS)", async () => {
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: null, conversationId: null, reply: plan });
    expect(gate.sendSms).toHaveBeenCalledTimes(1);
    expect(db.createMessage).not.toHaveBeenCalled();
    // Prepare skipping the filing must not abort the send itself: the text
    // still reports sent, and nothing is logged as a failure (found running
    // the brief's own probe 19: a throw here is silently swallowed by
    // sendConsentReply's outer catch, so the two calls above hold either
    // way — this line is what actually distinguishes "skip the filing" from
    // "abort the send").
    expect(vi.mocked(console.error)).not.toHaveBeenCalled();
    expect(vi.mocked(console.info).mock.calls.at(-1)?.[0]).toMatch(/ sent$/);
  });

  it("a refusal or a failure is logged and never thrown — it runs after the response, where a throw has no one to reach (mutation: rethrow → FAILS)", async () => {
    gate.sendSms.mockResolvedValue({ kind: "blocked", reason: "a2p_not_approved" });
    await expect(sendConsentReply({} as never, { accountId: "a1", to: "+1", contactId: null, conversationId: null, reply: plan })).resolves.toBeUndefined();
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toMatch(/not sent: blocked a2p_not_approved/);
    db.getBranding.mockRejectedValue(new Error("getBranding failed: timeout"));
    await expect(sendConsentReply({} as never, { accountId: "a1", to: "+1", contactId: null, conversationId: null, reply: plan })).resolves.toBeUndefined();
  });

  it("a filing that fails does not stop the reply: the thread line is optional, the confirmation is not (review R2-I1b; mutation: let prepare's createMessage throw → the gate sends nothing, FAILS)", async () => {
    db.createMessage.mockRejectedValue(new Error("createMessage failed"));
    let prepared: Promise<void> | undefined;
    gate.sendSms.mockImplementation(async (_d: unknown, req: { body: string }, opts: { prepare?: (c: object) => Promise<void> }) => {
      prepared = opts.prepare?.({ body: req.body, to: "+19562921696", from: "+19565550000" });
      await prepared;   // a throw here is the gate's "nothing leaves" (gate.ts:191-195)
      return { kind: "sent", providerMessageId: "p_1", to: "+19562921696", from: "+19565550000", body: req.body, billable: true, segments: 1 };
    });
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    await expect(prepared).resolves.toBeUndefined();
    expect(vi.mocked(console.info).mock.calls.map((c) => String(c[0]))).toContain("consent reply consent.stop_confirmation for account a1 sent");
    expect(db.updateMessageStatus).not.toHaveBeenCalled();
  });

  it("a 'sent' status write that fails AFTER the send is logged as that, never as 'not sent' (review R2-m5; mutation: one try around both → 'not sent', FAILS)", async () => {
    db.updateMessageStatus.mockRejectedValue(new Error("status write failed"));
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    const lines = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /sent, but its thread row was not marked sent/.test(l))).toBe(true);
    expect(lines.some((l) => /not sent:/.test(l))).toBe(false);
  });

  it("a 40300 on a START confirmation is logged naming the carrier block the gate recorded — the START-then-blocked trace (review R2-I1c; mutation: fall through to the generic 'failed provider' line → FAILS)", async () => {
    gate.sendSms.mockResolvedValue({ kind: "failed", stage: "provider", error: "telnyx send failed (403): …", carrierBlocked: true });
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: null, conversationId: null, reply: { kind: "consent.start_confirmation", language: "en" } });
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toMatch(/consent\.start_confirmation .* the carrier refused it \(40300\): Telnyx still blocks this number/);
  });

  it("a provider failure after filing marks the filed row failed (mutation: leave it queued → FAILS)", async () => {
    gate.sendSms.mockImplementation(async (_d: unknown, req: { body: string }, opts: { prepare?: (c: object) => Promise<void> }) => {
      await opts.prepare?.({ body: req.body, to: "+1", from: "+2" });
      return { kind: "failed", stage: "provider", error: "telnyx send failed (403): …", carrierBlocked: true };
    });
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    expect(db.updateMessageStatus).toHaveBeenCalledWith({}, "a1", "msg_out", "failed", { error: "telnyx send failed (403): …" }, "sms-inbound", "system");
  });
});
