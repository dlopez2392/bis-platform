import { describe, it, expect } from "vitest";
import { classifyEmailStop } from "./email-stop";

describe("classifyEmailStop (spec 'The stop rule'; plan G4)", () => {
  it("a stop keyword is a clear stop, English and Spanish (mutation: answer unclear for keywords → FAILS)", () => {
    expect(classifyEmailStop("STOP")).toEqual({ kind: "clear", phrase: "STOP" });
    expect(classifyEmailStop("unsubscribe")).toEqual({ kind: "clear", phrase: "UNSUBSCRIBE" });
    expect(classifyEmailStop("Baja")).toEqual({ kind: "clear", phrase: "BAJA" });
  });

  it("a keyword on the first line above a phone signature is still clear (mutation: classify the whole text only → none, FAILS)", () => {
    expect(classifyEmailStop("Stop\n\nSent from my iPhone")).toEqual({ kind: "clear", phrase: "STOP" });
    expect(classifyEmailStop("Baja\n\nEnviado desde mi iPhone")).toEqual({ kind: "clear", phrase: "BAJA" });
  });

  it("CANCEL / CANCELAR are unclear: on a reply to a reminder they mean the appointment (mutation: treat them as clear → FAILS)", () => {
    expect(classifyEmailStop("Cancel")).toEqual({ kind: "unclear", phrase: "CANCEL" });
    expect(classifyEmailStop("cancelar")).toEqual({ kind: "unclear", phrase: "CANCELAR" });
  });

  it("a stop sentence is unclear (mutation: answer clear for phrases → FAILS)", () => {
    expect(classifyEmailStop("Please remove me from your list")).toEqual({ kind: "unclear", phrase: "remove me" });
    expect(classifyEmailStop("No quiero más mensajes, gracias")).toEqual({ kind: "unclear", phrase: "no quiero mas mensajes" });
  });

  it("ordinary replies, an empty one, and 'stop by Thursday' are none (mutation: match 'stop' anywhere → FAILS)", () => {
    for (const t of ["Sounds good, see you Tuesday", "", "Can you stop by Thursday?", "Gracias, ahí estaré"]) expect(classifyEmailStop(t), t).toEqual({ kind: "none" });
  });
});
