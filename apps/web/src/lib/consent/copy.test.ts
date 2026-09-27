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
    // 32, read off messages.ts: 10 contact.phoneCountry, 2 contact.messages,
    // 5 compose, 5 settings.alertPhone (Country, CountryUs, CountryMx,
    // CountryMismatch, Stopped), the hours sentence, the textback title, the
    // 2 held text-back bodies, and 6 automations.reason lines.
    expect(keys.length).toBe(32);
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
