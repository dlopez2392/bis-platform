import { describe, it, expect } from "vitest";
import { messageChannelLabel, MESSAGE_CHANNEL_LABEL } from "./labels";

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
