import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";

/**
 * Consent chain spec §6 gives some of PR-1's words VERBATIM; they are
 * pinned here, once, so a later "tidy" of the copy fails in review instead
 * of quietly changing what the spec (and counsel, for the hours) approved.
 * The rest of PR-1's copy is this plan's (Spec gaps resolved here) and is
 * pinned where it renders.
 */
describe("the spec's own words (§6)", () => {
  it("the fixed sending hours, with the account's zone as {zone}, and the overnight rule that does not promise a late reminder (orchestrator 2026-09-26, choice 21; mutation: '8 a.m.' → '8am' FAILS; drop the 'unless' clause → FAILS)", () => {
    expect(m["automations.quiet.fixed"]).toBe(
      "Automated texts and emails go out between 8 a.m. and 9 p.m. in your time zone ({zone}). Marketing texts wait until 9 a.m., and on Sundays until noon. Anything due overnight goes out when the window opens, unless it's a reminder that would arrive after the appointment.");
  });

  it("a text-back held overnight does not say \"just now\" (danlo, 2026-09-26)", () => {
    expect(m["voice.textback.defaultBodyHeldEn"]).toBe("Hi, this is {name}. Sorry we missed your call, reply here and we'll help.");
    expect(m["voice.textback.defaultBodyHeldNoNameEn"]).toBe("Sorry we missed your call, reply here and we'll help.");
  });

  it("the Texts row's Check number state", () => {
    expect(m["contact.phoneCountry.line"]).toBe("This number could be Mexican or US.");
    expect(m["contact.phoneCountry.mx"]).toBe("Mexico (+52)");
    expect(m["contact.phoneCountry.us"]).toBe("US (+1)");
  });

  it("the composer's stopped line, with its date as {date}", () => {
    expect(m["compose.smsStopped"]).toBe("They stopped texts on {date}. You can't text this number until they text START.");
  });

  it("the alert phone's country choice and its stopped line", () => {
    expect(m["settings.alertPhoneCountryUs"]).toBe("US (+1)");
    // One spelling in both places (orchestrator, 2026-09-26): the drawer's.
    expect(m["settings.alertPhoneCountryMx"]).toBe("Mexico (+52)");
    expect(m["settings.alertPhoneCountryMx"]).toBe(m["contact.phoneCountry.mx"]);
    expect(m["settings.alertPhoneStopped"]).toBe(
      "This number has stopped texts from your business line. Text START to it from that phone to turn them back on.");
  });

  it("no PR-1 line exposes a code, a kind or template syntax other than its own placeholder (DESIGN.md voice)", () => {
    const keys = Object.keys(m).filter((k) => /^(contact\.phoneCountry|contact\.messages|compose\.sms(Stopped|StoppedUndated|Held|CheckNumber|StateUnknown)|settings\.alertPhone(Country|Stopped)|automations\.quiet\.fixed|activity\.source\.textback|voice\.textback\.defaultBodyHeld|automations\.reason\.)/.test(k));
    // 37, read off messages.ts: 11 contact.phoneCountry (the 11th,
    // `inlineChanged`, is the inline phone edit's own Undo — never sent by
    // a pick, only by an inline text edit), 3 contact.messages (PR-3 adds
    // `contact.messages.email`, the Email row's tab label), 5 compose,
    // 5 settings.alertPhone (Country, CountryUs, CountryMx, CountryMismatch,
    // Stopped), the hours sentence, the textback title, the 2 held
    // text-back bodies, and 9 automations.reason lines (PR-3 adds
    // `emailLedgerRetry` and `emailSetupRetry`; D-061 adds `accountSuppressed`).
    expect(keys.length).toBe(37);
    for (const k of keys) {
      const text = m[k as keyof typeof m];
      expect(text).not.toMatch(/\{\{|40300|unconfirmed_number|ledger|automation\./);
    }
  });
});

describe("the re-hold age cap's words (orchestrator, 2026-09-26)", () => {
  it("say why a text-back or an instant reply never went, in plain words (mutation: reword either → FAILS)", () => {
    expect(m["automations.reason.tooLongAfterCall"]).toBe("Not sent: too long after the call");
    expect(m["automations.reason.tooLongAfterWriteIn"]).toBe("Not sent: too long after they wrote in");
  });
});

describe("PR-2: the spec's own words (§4.2 and §6), verbatim", () => {
  it("the six customer replies, carrier-compliant since the 2026-10-05 rewrite (TCR rejection 611 superseded §4.2's original wording; mutation: reword any one → FAILS)", () => {
    expect(m["sms.consentReply.stop.en"]).toBe("{Business}: You will receive no further messages. Reply START to resubscribe.");
    expect(m["sms.consentReply.stop.es"]).toBe("{Business}: Ya no le enviaremos mas mensajes. Responda START para volver a recibirlos.");
    expect(m["sms.consentReply.start.en"]).toBe("{Business}: You're opted in to receive texts about your appointments and service. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.");
    expect(m["sms.consentReply.start.es"]).toBe("{Business}: Usted acepta recibir mensajes de citas y servicio. La frecuencia de mensajes puede variar. Pueden aplicar tarifas de mensajes y datos. Responda AYUDA para ayuda, PARAR para cancelar.");
    expect(m["sms.consentReply.help.en"]).toBe("{Business}: For help, {Contact}. Msg & data rates may apply. Reply STOP to opt out.");
    expect(m["sms.consentReply.help.es"]).toBe("{Business}: Para ayuda, {Contact}. Pueden aplicar tarifas de mensajes y datos. Responda PARAR para cancelar.");
  });

  it("each nameless variant is its named line without the \"{Business}: \" prefix (the text-back's rule; mutation: a nameless line that differs → FAILS)", () => {
    for (const k of ["stop", "start", "help"] as const) {
      for (const l of ["en", "es"] as const) {
        expect(`{Business}: ${m[`sms.consentReply.${k}.noName.${l}` as keyof typeof m]}`).toBe(m[`sms.consentReply.${k}.${l}` as keyof typeof m]);
      }
    }
  });

  it("the Texts row's own words from §6 (mutation: reword → FAILS)", () => {
    expect(m["contact.texts.loadFailed"]).toBe("Couldn't load their message settings. Try again.");
    expect(m["contact.texts.customerOnly"]).toBe("They can text START to get texts again.");
    expect(m["contact.texts.resumeNoteLabel"]).toBe("What did they ask for? (required)");
    expect(m["contact.texts.stopTexts"]).toBe("Stop texts");
    expect(m["contact.texts.stoppedToast"]).toBe("Texts stopped.");
    expect(m["contact.texts.confirmStop"]).toBe("Confirm stop");
    expect(m["contact.texts.notAStop"]).toBe("Not a stop");
    expect(m["contact.texts.how.keyword"]).toBe("they texted {word}");
    expect(m["contact.texts.how.staff"]).toBe("you recorded it");
    expect(m["contact.texts.how.carrier"]).toBe("the carrier blocked it");
    expect(m["contact.texts.how.unsubscribeLink"]).toBe("unsubscribe link");
  });

  it("the To-do rows of §6, English and Spanish, with their placeholders (mutation: reword → FAILS)", () => {
    expect(m["todo.consent.hold.en"]).toBe("{name} may have asked to stop texts: “{excerpt}”. Texts to them are on hold.");
    expect(m["todo.consent.hold.es"]).toBe("{name} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes están en pausa.");
    expect(m["todo.consent.hold.confirm.es"]).toBe("Confirmar");
    expect(m["todo.consent.hold.notStop.es"]).toBe("No era eso");
    expect(m["todo.consent.cancel.en"]).toBe("{name} texted {word}, so their texts are stopped. Check whether they also meant their appointment on {date}.");
    expect(m["todo.consent.cancel.es"]).toBe("{name} envió {word} y sus mensajes quedaron suspendidos. Revise si también quería cancelar su cita del {date}.");
  });

  it("no PR-2 line exposes a code, a kind, a method or template syntax beyond its own placeholders (DESIGN.md voice; 54 keys, read off messages.ts — the 2026-10-05 carrier-compliance rewrite added the help reply's 2 contact-fallback keys; mutation: add a line naming 'carrier_block' → FAILS)", () => {
    const keys = Object.keys(m).filter((k) => /^(sms\.consentReply|contact\.texts|todo\.consent)\./.test(k));
    expect(keys.length).toBe(54);
    for (const k of keys) {
      const text = m[k as keyof typeof m];
      // "{Contact}" is a single-brace placeholder, same shape as
      // "{Business}" always has been — only a DOUBLE-brace "{{...}}" is the
      // forbidden template-syntax leak.
      expect(text, k).not.toMatch(/\{\{|40300|carrier_block|free_text|backfill|ledger|consent\.|automation\./);
    }
  });
});

describe("PR-3: the spec's own words (§4.3 footer, §6 page, composer and Email row)", () => {
  it("the footer, in both languages (mutation: 'Unsubscribe.' → 'Unsubscribe here' FAILS)", () => {
    expect(m["email.unsubscribe.lead.en"]).toBe("Don't want these emails?");
    expect(m["email.unsubscribe.link.en"]).toBe("Unsubscribe");
    expect(m["email.unsubscribe.lead.es"]).toBe("¿No quiere recibir estos correos?");
    expect(m["email.unsubscribe.link.es"]).toBe("Cancelar suscripción");
  });

  it("the page's unsubscribed, resubscribed and bad-link lines, English and Spanish, and its two buttons", () => {
    expect(m["unsubscribe.done.en"]).toBe("You're unsubscribed. {Business} won't send you any more automated emails. You'll still get a confirmation when you book or ask for something.");
    expect(m["unsubscribe.done.es"]).toBe("Listo. {Business} ya no le enviará correos automáticos. Si reserva o pide algo, sí recibirá la confirmación.");
    expect(m["unsubscribe.resubscribe"]).toBe("Resubscribe / Volver a suscribirme");
    expect(m["unsubscribe.resubscribed.en"]).toBe("You'll get emails from {Business} again.");
    expect(m["unsubscribe.resubscribed.es"]).toBe("Volverá a recibir correos de {Business}.");
    // Spec §6 as corrected 2026-09-30 (review R1-M2): most of these emails
    // carry no reply-to, so the line no longer says "reply to any email".
    expect(m["unsubscribe.badLink.en"]).toBe("This unsubscribe link doesn't work. Contact {Business} directly and ask them to stop.");
    expect(m["unsubscribe.badLink.es"]).toBe("Este enlace no funciona. Comuníquese directamente con {Business} y pida que dejen de escribirle.");
  });

  it("the question and its one button, in both languages (decisions Q1 and P2: the button says what the title asks; mutation: 'Unsubscribe / Cancelar suscripción' → FAILS)", () => {
    expect(m["unsubscribe.confirm.en"]).toBe("Stop emails from {Business}?");
    expect(m["unsubscribe.confirm.es"]).toBe("¿Dejar de recibir correos de {Business}?");
    expect(m["unsubscribe.button"]).toBe("Stop emails / Dejar de recibir correos");
  });

  it("the composer's unsubscribed notice, with its date as {date}", () => {
    expect(m["compose.emailUnsubscribed"]).toBe("They unsubscribed from your emails on {date}. Write only about something they asked you for.");
  });

  it("the Email row's line for a stop only the customer can lift", () => {
    expect(m["contact.email.customerOnly"]).toBe("They can resubscribe from the unsubscribe link in any email from you.");
  });
});
