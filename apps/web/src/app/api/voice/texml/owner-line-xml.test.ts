// apps/web/src/app/api/voice/texml/owner-line-xml.test.ts
// F-032 plan Task 7: the owner line's TeXML words, byte for byte.
import { describe, it, expect } from "vitest";
import { ownerPinAskXml, ownerVerifyAskXml, ownerLimitXml, ownerVerifiedXml, ownerPinUrl } from "./owner-line-xml";
import { firstName } from "@/lib/owner-line/names";

const DIAL = `<Dial answerOnBridge="true" action="https://x/h" method="POST"><Sip>sip:p@sip.api.openai.com</Sip></Dial>`;

describe("the owner line's TeXML words (spec §4.1, §4.2)", () => {
  it("asks for the PIN by first name, in one Gather of exactly six digits, then falls through to today's bridge", () => {
    const xml = ownerPinAskXml({ locale: "en", name: "Dan", persona: "Sofía", action: ownerPinUrl("https://x"), retry: false, fallthrough: DIAL });
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Gather action="https://x/api/voice/texml/owner-pin" numDigits="6" timeout="8" finishOnKey="#"><Say>Hi Dan. Enter your PIN, or press pound to talk to Sofía.</Say></Gather>${DIAL}</Response>`);
  });
  it("Spanish speaks es-MX, in usted", () => {
    const xml = ownerPinAskXml({ locale: "es", name: "Dan", persona: "Sofía", action: "a", retry: false, fallthrough: DIAL });
    expect(xml).toContain(`<Say language="es-MX">Hola, Dan. Marque su PIN, o oprima la tecla de gato (#) para hablar con Sofía.</Say>`);
  });
  it("a retry says the PIN did not match before asking again, inside the same Gather", () => {
    const xml = ownerPinAskXml({ locale: "en", name: null, persona: "Sofía", action: "a", retry: true, fallthrough: DIAL });
    // xmlText escapes the apostrophe (./xml.ts: five entities), so the document carries &apos;.
    expect(xml).toContain(`<Gather action="a" numDigits="6" timeout="8" finishOnKey="#"><Say>That PIN didn&apos;t match. Try again.</Say><Say>Hi. Enter your PIN, or press pound to talk to Sofía.</Say></Gather>`);
  });
  it("the call-in code ask, the limit line and the verified goodbye", () => {
    expect(ownerVerifyAskXml({ locale: "en", action: "a", retry: false, fallthrough: DIAL })).toContain("<Say>Enter the 6-digit code shown on your screen.</Say>");
    expect(ownerLimitXml({ locale: "en", persona: "Sofía", fallthrough: DIAL })).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>You&apos;ve reached today&apos;s limit for calling in. Here is Sofía.</Say>${DIAL}</Response>`);
    expect(ownerVerifiedXml("en")).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Thank you. This phone is verified. You can hang up now.</Say><Hangup/></Response>`);
  });
  it("the call-in code ask falls through to today's bridge, never a hang-up (plan I-3: a code that is spent, expired or unknown is today's path)", () => {
    const xml = ownerVerifyAskXml({ locale: "es", action: "a", retry: true, fallthrough: DIAL });
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Gather action="a" numDigits="6" timeout="8" finishOnKey="#"><Say language="es-MX">Ese código no coincide. Intente de nuevo.</Say><Say language="es-MX">Marque el código de 6 dígitos que aparece en su pantalla.</Say></Gather>${DIAL}</Response>`);
    expect(xml).not.toContain("<Hangup");
  });
  it("escapes a name: a stored name can never break the document", () => {
    expect(ownerPinAskXml({ locale: "en", name: "A&B <x>", persona: "Sofía", action: "a", retry: false, fallthrough: DIAL }))
      .toContain("Hi A&amp;B. Enter");
    expect(firstName("  Dan   Lopez ")).toBe("Dan");
    expect(firstName(null)).toBeNull();
  });
});
