import { describe, it, expect } from "vitest";
import { withOptOut } from "./opt-out";
import { segmentsFor } from "./segments";
import { defaultTextbackBody } from "@/lib/voice/textback-body";
import { m } from "@/lib/messages";

describe("withOptOut", () => {
  it("appends the disclosure in the message's own language", () => {
    expect(withOptOut("Your appointment is tomorrow at 9."))
      .toBe("Your appointment is tomorrow at 9. Reply STOP to opt out.");
    expect(withOptOut("Su cita es manana a las 9.", "es"))
      .toBe("Su cita es manana a las 9. Responde STOP para cancelar.");
    // English is the default, and that default is load-bearing:
    // sendAutomationSms calls this with no language because no pass carries
    // one. If the default ever flips, every automated text changes language.
    expect(withOptOut("x")).toBe(withOptOut("x", "en"));
  });

  it("is idempotent, and leaves an operator's own wording alone", () => {
    // Applied over a body that already says it, the result must not say it
    // twice — a message ending "Reply STOP to opt out. Reply STOP to opt out."
    // is what gets a campaign looked at a second time.
    const once = withOptOut("Sorry we missed you.");
    expect(withOptOut(once)).toBe(once);
    // Matched on the keyword, not on our exact sentence, so an operator who
    // wrote their own phrasing keeps it verbatim rather than having ours
    // stapled on after it.
    const theirs = "Sorry we missed you. Text STOP to unsubscribe anytime.";
    expect(withOptOut(theirs)).toBe(theirs);
    // Spanish disclosure recognised by the same guard — the keyword is the
    // English STOP in both languages precisely so this works.
    const spanish = withOptOut("Perdon, no alcanzamos a contestar.", "es");
    expect(withOptOut(spanish, "es")).toBe(spanish);
  });

  it("does not fire on 'stop' inside another word", () => {
    // \b, not a substring test: "stopped", "stopping" and "bus stop" are not
    // opt-out instructions, and treating them as one would silently ship a
    // programme message with no way out of it.
    const body = "We stopped by but nobody was home.";
    expect(withOptOut(body)).toBe(`${body} ${m["sms.optOut.en"]}`);
    // A bare standalone "stop" IS treated as the disclosure. Accepted: the
    // failure mode is a message missing a sentence it could have had, not a
    // customer with no way to opt out, and Telnyx honours STOP either way.
  });

  it("trims, so the disclosure is never double-spaced or trailing-glued", () => {
    expect(withOptOut("  Hello.  ")).toBe("Hello. Reply STOP to opt out.");
  });

  it("keeps the English text-back inside one GSM-7 segment", () => {
    // The cost check, measured rather than assumed — the discipline
    // textback-body.ts sets. The text-back is the longest default this
    // platform sends, so if the disclosure fits here it fits everywhere the
    // body is not carrying a URL.
    const body = withOptOut(defaultTextbackBody("956 Woodworks", "en"), "en");
    expect(segmentsFor(body)).toEqual({ encoding: "gsm7", chars: body.length, segments: 1 });
  });

  it("keeps both disclosures inside GSM-7 themselves", () => {
    // The Spanish line carries no á/í/ó/ú on purpose: one of them drops the
    // WHOLE message to UCS-2 at 70 characters a segment, which would make
    // this disclosure cost a second segment on every Spanish text rather
    // than 29 characters of the first.
    for (const key of ["sms.optOut.en", "sms.optOut.es"] as const) {
      expect(segmentsFor(m[key]).encoding, key).toBe("gsm7");
    }
  });

  it("keeps the Spanish text-back no worse off than it already was", () => {
    // defaultTextbackBody's own tests pin the Spanish default at one GSM-7
    // segment for a GSM-7 company name. Adding a disclosure must not be what
    // pushes it over — if this ever fails, shorten the disclosure rather than
    // dropping it.
    const body = withOptOut(defaultTextbackBody("956 Woodworks", "es"), "es");
    expect(segmentsFor(body).segments).toBe(1);
  });
});
