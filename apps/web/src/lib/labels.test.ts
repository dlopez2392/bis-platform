import { describe, it, expect } from "vitest";
import {
  messageChannelLabel, MESSAGE_CHANNEL_LABEL, labelIn, OPPORTUNITY_STATUS_KEY, FORM_STATUS_KEY, ACCOUNT_STATUS_KEY, MESSAGE_STATUS_KEY,
  STATUS_LABEL, FORM_STATUS_LABEL, ACCOUNT_STATUS_LABEL, MESSAGE_STATUS_LABEL,
} from "./labels";

describe("messageChannelLabel (spec G8; S-06 part 3)", () => {
  it("names all five channels in English, the default, exactly as before plus Web chat (mutation: drop webchat from the map → the raw 'webchat' prints, FAILS)", () => {
    expect(["email", "sms", "form", "voice", "webchat"].map((c) => messageChannelLabel(c))).toEqual(["Email", "Text", "Form submission", "Call", "Web chat"]);
    expect(MESSAGE_CHANNEL_LABEL.webchat).toBe("Web chat");
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
  it("keeps the English constants word for word, each equal to its key table read in English (mutation: drift a constant from its table → FAILS)", () => {
    const en = (tbl: Record<string, string>) => Object.fromEntries(Object.keys(tbl).map((v) => [v, labelIn(tbl as never, v, "en")]));
    expect(STATUS_LABEL).toEqual(en(OPPORTUNITY_STATUS_KEY));
    expect(ACCOUNT_STATUS_LABEL).toEqual(en(ACCOUNT_STATUS_KEY));
    expect(MESSAGE_STATUS_LABEL).toEqual(en(MESSAGE_STATUS_KEY));
    expect(FORM_STATUS_LABEL).toEqual(en(FORM_STATUS_KEY));
    expect(STATUS_LABEL.won).toBe("Won");
  });
});
