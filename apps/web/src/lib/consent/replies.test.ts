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
      .toBe("956 Woodworks: Ya no le enviaremos mas mensajes. Responda START para volver a recibirlos.");
    expect(consentReplyBody("consent.help", "en", "956 Woodworks"))
      .toBe("956 Woodworks: For help, email hello@bis-rgv.com or visit bis-rgv.com. Msg & data rates may apply. Reply STOP to opt out.");
  });

  it("the help reply uses the account's own reply-to email over BIS's fallback, in both languages (TCR reason 611: a real contact, not 'this number'; mutation: ignore supportEmail → FAILS)", () => {
    expect(consentReplyBody("consent.help", "en", "956 Woodworks", "support@956woodworks.com"))
      .toBe("956 Woodworks: For help, email support@956woodworks.com. Msg & data rates may apply. Reply STOP to opt out.");
    expect(consentReplyBody("consent.help", "es", "956 Woodworks", "support@956woodworks.com"))
      .toBe("956 Woodworks: Para ayuda, escriba a support@956woodworks.com. Pueden aplicar tarifas de mensajes y datos. Responda PARAR para cancelar.");
  });

  it("with no reply-to email set, the help reply falls back to BIS's own contact, never bis-rgv.com once the account has its own (mutation: always the fallback → FAILS)", () => {
    expect(consentReplyBody("consent.help", "en", "956 Woodworks", null)).toContain("hello@bis-rgv.com");
    expect(consentReplyBody("consent.help", "en", "956 Woodworks", "support@956woodworks.com")).not.toContain("bis-rgv.com");
  });

  it("a blank name drops the prefix rather than inventing one (mutation: sign as \"\" → ': You're opted in…', FAILS)", () => {
    expect(consentReplyBody("consent.start_confirmation", "en", "  "))
      .toBe("You're opted in to receive texts about your appointments and service. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.");
  });

  it("a name holding $& or $1 is printed as written (mutation: .replace with a string replacement → FAILS)", () => {
    expect(consentReplyBody("consent.help", "en", "A$&B"))
      .toBe("A$&B: For help, email hello@bis-rgv.com or visit bis-rgv.com. Msg & data rates may apply. Reply STOP to opt out.");
  });

  it("the opt-in confirmation names the brand, HELP, STOP, frequency and rates (TCR reason 611; mutation: drop any one → FAILS)", () => {
    const en = consentReplyBody("consent.start_confirmation", "en", "956 Woodworks");
    expect(en).toContain("956 Woodworks");
    expect(en).toMatch(/\bHELP\b/);
    expect(en).toMatch(/\bSTOP\b/);
    expect(en).toMatch(/frequency varies/i);
    expect(en).toMatch(/rates may apply/i);
    const es = consentReplyBody("consent.start_confirmation", "es", "956 Woodworks");
    expect(es).toContain("956 Woodworks");
    expect(es).toMatch(/\bAYUDA\b/);
    expect(es).toMatch(/\bPARAR\b/);
    expect(es).toMatch(/frecuencia/i);
    expect(es).toMatch(/tarifas/i);
  });

  it("the opt-out reply names the brand and says explicitly that no further messages follow, plus how to resubscribe (TCR reason 611; mutation: drop 'no further messages' → FAILS)", () => {
    const en = consentReplyBody("consent.stop_confirmation", "en", "956 Woodworks");
    expect(en).toContain("956 Woodworks");
    expect(en).toMatch(/no further messages/i);
    expect(en).toMatch(/\bSTART\b/);
    const es = consentReplyBody("consent.stop_confirmation", "es", "956 Woodworks");
    expect(es).toContain("956 Woodworks");
    expect(es).toMatch(/no le enviaremos mas mensajes/i);
    expect(es).toMatch(/\bSTART\b/);
  });

  it("the help reply names the brand, a real contact, rates and STOP (TCR reason 611; mutation: drop the rates sentence → FAILS)", () => {
    const en = consentReplyBody("consent.help", "en", "956 Woodworks", "support@956woodworks.com");
    expect(en).toContain("956 Woodworks");
    expect(en).toContain("support@956woodworks.com");
    expect(en).toMatch(/rates may apply/i);
    expect(en).toMatch(/\bSTOP\b/);
    const es = consentReplyBody("consent.help", "es", "956 Woodworks", "support@956woodworks.com");
    expect(es).toContain("956 Woodworks");
    expect(es).toContain("support@956woodworks.com");
    expect(es).toMatch(/tarifas/i);
    expect(es).toMatch(/\bPARAR\b/);
  });

  it("a support email over 60 characters falls back to BIS's own contact rather than push the reply past its segment cap (mutation: raise or drop the length check → FAILS)", () => {
    const longEmail = `${"a".repeat(55)}@x.com`;
    expect(longEmail.length).toBeGreaterThan(60);
    const en = consentReplyBody("consent.help", "en", "956 Woodworks", longEmail);
    expect(en).toContain("hello@bis-rgv.com");
    expect(en).not.toContain(longEmail);
  });

  it("a support email outside GSM-7 falls back to BIS's own contact rather than drop the whole reply to UCS-2 (mutation: skip the GSM-7 check → FAILS)", () => {
    const accented = "sopórte@x.com";
    const en = consentReplyBody("consent.help", "en", "956 Woodworks", accented);
    expect(en).toContain("hello@bis-rgv.com");
    expect(en).not.toContain(accented);
    expect(segmentsFor(en).encoding).toBe("gsm7");
  });

  it.each(KINDS.flatMap((k) => (["en", "es"] as const).map((l) => [k, l] as const)))(
    "%s in %s is GSM-7 and at most TWO segments for a 20-character GSM-7 name — compliance costs more than the one segment this used to fit (spec: no á, í, ó or ú; mutation: put an accent in the line → UCS-2, FAILS)",
    (kind, lang) => {
      const s = segmentsFor(consentReplyBody(kind, lang, "Rio Grande Plumbing!", "support@riogrande.com"));
      expect(s.encoding).toBe("gsm7");
      expect(s.segments).toBeLessThanOrEqual(2);
    });
});

describe("telnyxReplyText — what each business's Telnyx profile answers (Task 16 step 10; danlo's decision 1)", () => {
  it("is the English line then the Spanish line without its prefix, one bilingual reply (mutation: prefix the Spanish half too → FAILS)", () => {
    expect(telnyxReplyText("stop", "956 Woodworks")).toBe(
      "956 Woodworks: You will receive no further messages. Reply START to resubscribe. Ya no le enviaremos mas mensajes. Responda START para volver a recibirlos.");
  });

  it("is at least Telnyx's 20 characters and GSM-7 for every op, even nameless (plan F2; mutation: an empty reply → FAILS)", () => {
    for (const op of ["stop", "start", "help"] as const) {
      const t = telnyxReplyText(op, "");
      expect(t.length).toBeGreaterThanOrEqual(20);
      expect(segmentsFor(t).encoding).toBe("gsm7");
    }
  });

  it("with a 20-character GSM-7 name every Telnyx reply stays GSM-7 and at most three segments — the bilingual reply doubles the compliance text, which is why this cap is one higher than the single-language cap (mutation: an accent in the Spanish half → UCS-2, FAILS)", () => {
    for (const op of ["stop", "start", "help"] as const) {
      const s = segmentsFor(telnyxReplyText(op, "Rio Grande Plumbing!", "support@riogrande.com"));
      expect(s.encoding, op).toBe("gsm7");
      expect(s.segments, op).toBeLessThanOrEqual(3);
    }
  });

  it("the help reply's bilingual Telnyx text carries the client's own support email in BOTH halves, not just the English one (mutation: drop supportEmail from the English half → FAILS)", () => {
    const t = telnyxReplyText("help", "956 Woodworks", "support@956woodworks.com");
    expect(t.match(/support@956woodworks\.com/g)?.length).toBe(2);
    expect(t).not.toContain("bis-rgv.com");
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

  it("the HELP reply uses the account's own reply-to email, not BIS's fallback (mutation: pass null instead of branding.replyToEmail → FAILS)", async () => {
    db.getBranding.mockResolvedValue({ brandName: " 956 Woodworks ", replyToEmail: "support@956woodworks.com" });
    await sendConsentReply({} as never, {
      accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1",
      reply: { kind: "consent.help", language: "en" },
    });
    expect(gate.sendSms.mock.calls[0]![1].body).toBe(
      "956 Woodworks: For help, email support@956woodworks.com. Msg & data rates may apply. Reply STOP to opt out.");
  });

  it("asks the gate for the kind, the carrier's number, the stop it answers and the business-named line (mutation: numberFromCarrier false → FAILS)", async () => {
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    expect(gate.sendSms.mock.calls[0]![1]).toEqual({
      accountId: "a1", kind: "consent.stop_confirmation", to: "+19562921696", contactId: "ct_1", language: "es",
      numberFromCarrier: true, answersEventId: "ev_1",
      body: "956 Woodworks: Ya no le enviaremos mas mensajes. Responda START para volver a recibirlos.",
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

  it("a 'failed' status write that itself throws does not swallow the carrier-block reason it was about to log, or throw past its own caller (review — the 'sent' write already guards itself; mutation: no try around the failed write → the 40300 line is lost, replaced by the generic status-write error, FAILS)", async () => {
    gate.sendSms.mockImplementation(async (_d: unknown, req: { body: string }, opts: { prepare?: (c: object) => Promise<void> }) => {
      await opts.prepare?.({ body: req.body, to: "+1", from: "+2" });
      return { kind: "failed", stage: "provider", error: "telnyx send failed (403): …", carrierBlocked: true };
    });
    db.updateMessageStatus.mockRejectedValue(new Error("status write failed"));
    await expect(sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: { kind: "consent.start_confirmation", language: "en" } }))
      .resolves.toBeUndefined();
    const lines = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /the carrier refused it \(40300\)/.test(l))).toBe(true);
    expect(lines.some((l) => /not marked failed/.test(l))).toBe(true);
  });
});
