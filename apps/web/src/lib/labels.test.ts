import { describe, it, expect } from "vitest";
import { messageChannelLabel, MESSAGE_CHANNEL_LABEL, labelIn, OPPORTUNITY_STATUS_KEY, FORM_STATUS_KEY, STATUS_LABEL, FORM_STATUS_LABEL } from "./labels";
import { m } from "./messages";

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
  it("falls back to the English while a key has no twin yet, and to the raw value for an unknown one (mutation: return '' → FAILS)", () => {
    expect(labelIn(FORM_STATUS_KEY, "draft", "es")).toBe(m["forms.status.draft.es" as keyof typeof m] ?? "Draft");
    expect(labelIn(FORM_STATUS_KEY, "mystery", "es")).toBe("mystery");
  });
  it("keeps the English constants exactly as they were, for the callers that have not moved (mutation: build them in Spanish → FAILS)", () => {
    expect(STATUS_LABEL).toEqual({ open: "Open", won: "Won", lost: m["pipeline.status.lost"] });
    expect(FORM_STATUS_LABEL.draft).toBe("Draft");
  });
});
