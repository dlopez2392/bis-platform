import { describe, it, expect } from "vitest";
import {
  messageChannelLabel, labelIn, OPPORTUNITY_STATUS_KEY, FORM_STATUS_KEY, ACCOUNT_STATUS_KEY, MESSAGE_STATUS_KEY,
} from "./labels";

describe("messageChannelLabel (spec G8; S-06 part 3)", () => {
  it("names all five channels in English, the default, exactly as before plus Web chat (mutation: drop webchat from the map → the raw 'webchat' prints, FAILS)", () => {
    expect(["email", "sms", "form", "voice", "webchat"].map((c) => messageChannelLabel(c))).toEqual(["Email", "Text", "Form submission", "Call", "Web chat"]);
    expect(messageChannelLabel("webchat")).toBe("Web chat");
  });
  it("and in Spanish (mutation: ignore the locale → English, FAILS)", () => {
    expect(["email", "sms", "form", "voice", "webchat"].map((c) => messageChannelLabel(c, "es"))).toEqual(["Correo", "Texto", "Formulario", "Llamada", "Chat web"]);
  });
  it("a value outside the union prints as itself, never blank (mutation: return '' → FAILS)", () => {
    expect(messageChannelLabel("note", "es")).toBe("note");
  });
});

describe("labelIn and the key tables (S-10 T1)", () => {
  it("reads a status in Spanish through its key (mutation: ignore the locale → 'Won', FAILS)", () => {
    expect(labelIn(OPPORTUNITY_STATUS_KEY, "won", "es")).toBe("Ganada");
    expect(labelIn(OPPORTUNITY_STATUS_KEY, "won")).toBe("Won");
  });
  // A synthetic catalogue (review M-5): a live key used here would gain its
  // twin in a lane PR and quietly stop testing the fallback.
  const cat = { "k.draft": "Draft", "k.won": "Won", "k.won.es": "Ganada" } as const;
  const table = { draft: "k.draft", won: "k.won" } as const;
  it("falls back to the English while a key has no twin yet (mutation: return the key itself → FAILS)", () => {
    expect(labelIn(table, "draft", "es", cat)).toBe("Draft");
    expect(labelIn(table, "won", "es", cat)).toBe("Ganada");
  });
  it("prints a value the table does not know as itself, never blank (mutation: return '' → FAILS)", () => {
    expect(labelIn(table, "mystery", "es", cat)).toBe("mystery");
  });
  // S-10 T9b: the English-only `*_LABEL` constants this test used to pin
  // against their key tables (STATUS_LABEL, ACCOUNT_STATUS_LABEL,
  // MESSAGE_STATUS_LABEL, FORM_STATUS_LABEL) are gone — every real caller
  // had already moved to `labelIn` itself, so there was nothing left for
  // them to serve but a direct `m[...]` read nobody used. labelIn's own
  // English-default behaviour, over each real key table, is what their
  // drift-guard actually protected; it survives here instead.
  it("reads every real key table in English by default, the same words the deleted *_LABEL constants held (mutation: drop the locale default → FAILS)", () => {
    expect(labelIn(OPPORTUNITY_STATUS_KEY, "won")).toBe("Won");
    expect(labelIn(ACCOUNT_STATUS_KEY, "active")).toBe("Active");
    expect(labelIn(MESSAGE_STATUS_KEY, "sent")).toBe("Sent");
    expect(labelIn(FORM_STATUS_KEY, "draft")).toBe("Draft");
  });
});
