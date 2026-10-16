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

  // Fix round 1 (coordinator review): a clear keyword on the first line must win even when the
  // WHOLE text (keyword plus the rest of the reply) only matches an unclear sentence phrase —
  // the old code tried the whole text FIRST and returned its "none" or "unclear" answer without
  // ever looking at the first line (mutation: return the whole-text result first → FAILS, since
  // the whole text here answers unclear, not clear).
  it("a clear keyword on the first line wins over an unclear result in the whole text (mutation: return the whole-text result first → FAILS)", () => {
    expect(classifyEmailStop("STOP\n\nPlease remove me from your list. Thanks")).toEqual({ kind: "clear", phrase: "STOP" });
    expect(classifyEmailStop("Baja\n\nNo quiero más mensajes")).toEqual({ kind: "clear", phrase: "BAJA" });
    expect(classifyEmailStop("Unsubscribe\n\nTake me off your list")).toEqual({ kind: "clear", phrase: "UNSUBSCRIBE" });
    expect(classifyEmailStop("STOP\nStop sending me these")).toEqual({ kind: "clear", phrase: "STOP" });
  });
});

/**
 * Owner ruling, fix round 1 (2026-10-16): an EMAIL-ONLY stop-sentence list — these never reach
 * the SMS phrase list in phrases.ts, which this module never edits. Every one of these is
 * UNCLEAR (the "May want to stop" chip; staff confirms via Stop emails) — only a bare keyword
 * (STOP, UNSUBSCRIBE, BAJA, …) stops automatically. Normalised the same way the texts' matcher
 * folds accents and case (`normalisePhraseText`, phrases.ts).
 */
describe("email-only stop sentences are unclear, never automatic (owner ruling 2026-10-16, fix round 1)", () => {
  it("English (mutation: empty EMAIL_ONLY_STOP_PHRASES list → FAILS)", () => {
    for (const t of [
      "Please stop emailing", "Can you stop sending emails", "No more emails please",
      "dont email me", "Do not email me", "Please remove me from your email list",
      "unsubscribe me", "take me off your email list",
    ]) expect(classifyEmailStop(t), t).toMatchObject({ kind: "unclear" });
  });

  it("Spanish (mutation: empty EMAIL_ONLY_STOP_PHRASES list → FAILS)", () => {
    for (const t of [
      "no mas correos", "no me manden correos", "No me envien correos", "Dejen de enviarme correos",
      "quiero darme de baja", "Darme de baja", "ya no quiero correos",
    ]) expect(classifyEmailStop(t), t).toMatchObject({ kind: "unclear" });
  });

  it("a clear keyword still wins over an email-only stop sentence elsewhere in the same reply", () => {
    expect(classifyEmailStop("STOP\n\nAlso please stop emailing me so much")).toEqual({ kind: "clear", phrase: "STOP" });
  });
});
