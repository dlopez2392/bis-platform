import { describe, it, expect } from "vitest";
import { consentReplyBody, telnyxReplyText, TELNYX_KEYWORDS } from "./replies";
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
