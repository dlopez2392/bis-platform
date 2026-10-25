import { describe, it, expect } from "vitest";
import {
  ASK_NAME, ASK_NAME_AND_EMAIL, ASK_NAME_AGAIN, ASK_EMAIL, CONFIRMED, MISS, LOCKED, CANNOT, NOT_CONFIRMED_YET,
  MESSAGE_ASK_NAME, BOOK_ASK_NAME, BOOK_AMBIGUOUS, BOOK_ASK_WHOSE, LEAD_ASK_WHOSE, FOUND_BY_NAME_NEXT,
  lockedResult, readFailed, notTheirs, noCallerId,
} from "./results";

// Every literal below is typed out AGAIN, independently of results.ts (spec
// 5.4.4 word for word) — the test file imports no string from results.ts to
// build its own expectation, so a changed sentence cannot drag its pin along
// with it.

describe("fixed ToolResult constants (spec 5.4.4)", () => {
  it("ASK_NAME", () => {
    expect(ASK_NAME).toEqual({
      found: false, confirmIdentity: "name",
      next: `Before you look anything up, ask whose name the appointment is under: the first and last name. For example: "Whose name is the appointment under? I'll need the first and last name." In Spanish: "¿A nombre de quién está la cita? Necesito el nombre y el apellido." Then call confirm_identity with fullName. Do not suggest or guess a name, and do not say how many people use this number.`,
    });
  });

  it("ASK_NAME_AND_EMAIL", () => {
    expect(ASK_NAME_AND_EMAIL).toEqual({
      found: false, confirmIdentity: "name_and_email",
      next: `Before you look anything up, ask for the full name the appointment is under and the email address on file. For example: "To look that up, I need the full name and the email address we have on file." In Spanish: "Para buscarla, necesito el nombre completo y el correo electrónico que tenemos registrado." Spell the email back character by character, saying 'at' for @ and 'dot' for the period, and wait for them to confirm. Then call confirm_identity with fullName and email. Do not suggest or guess a name or an email.`,
    });
  });

  it("ASK_NAME_AGAIN", () => {
    expect(ASK_NAME_AGAIN).toEqual({
      ok: false, confirmed: false, next: "Ask for their first AND last name, then call confirm_identity again.",
    });
  });

  it("ASK_EMAIL", () => {
    expect(ASK_EMAIL).toEqual({
      ok: false, confirmed: false, confirmIdentity: "email",
      next: `Ask for the email address on file: "Could I also have the email address we have on file?" In Spanish: "¿Me da también el correo electrónico que tenemos registrado?" Spell it back character by character and wait for them to confirm, then call confirm_identity again with fullName and email.`,
    });
  });

  it("CONFIRMED", () => {
    expect(CONFIRMED).toEqual({ ok: true, confirmed: true, next: "Confirmed. Call find_my_booking now." });
  });

  it("MISS", () => {
    expect(MISS).toEqual({
      ok: false, confirmed: false,
      next: `Say: "I couldn't find it under those details." In Spanish: "No la encontré con esos datos." You may ask them once more and call confirm_identity again. You have not been told which detail did not match, so do not say or guess.`,
    });
  });

  it("LOCKED", () => {
    expect(LOCKED).toEqual({
      ok: false, confirmed: false, locked: true,
      next: `Say: "I'm sorry, I couldn't find it under those details, so I can't look it up on this call. I can take a message and someone from the team will call you back." In Spanish: "Lo siento, no la encontré con esos datos, así que no puedo consultarla en esta llamada. Puedo tomarle un mensaje y alguien del equipo le devolverá la llamada." If they want, take the message with take_message. Do not ask for these details again on this call.`,
    });
  });

  it("CANNOT", () => {
    expect(CANNOT).toEqual({
      found: false, locked: true,
      next: `Say: "I'm sorry, I can't look that up on this call. I can take a message and someone from the team will call you back." In Spanish: "Lo siento, no puedo consultarla en esta llamada. Puedo tomarle un mensaje y alguien del equipo le devolverá la llamada." If they want, take the message with take_message.`,
    });
  });

  it("NOT_CONFIRMED_YET", () => {
    expect(NOT_CONFIRMED_YET).toEqual({
      ok: false,
      error: "This appointment can't be changed until find_my_booking has found it for them on this call. Call find_my_booking first. Do not share any of its details.",
    });
  });

  it("MESSAGE_ASK_NAME", () => {
    expect(MESSAGE_ASK_NAME).toEqual({
      ok: false,
      error: "Before you take the message, ask for their first and last name, then call take_message again with name. If they would rather not say, call it again with nameDeclined: true.",
    });
  });

  it("BOOK_ASK_NAME", () => {
    expect(BOOK_ASK_NAME).toEqual({
      ok: false, error: "Before you book, ask for their first AND last name, then call book_appointment again with it.",
    });
  });

  it("BOOK_AMBIGUOUS", () => {
    expect(BOOK_AMBIGUOUS).toEqual({
      ok: false,
      error: "This appointment can't be booked under that name on this call. First call capture_lead with their name and what they needed, then take_message, so the team can book it.",
    });
  });

  it("BOOK_ASK_WHOSE", () => {
    expect(BOOK_ASK_WHOSE).toEqual({
      ok: false,
      error: `Not booked yet. Ask: "Is this appointment for you or for someone else?" In Spanish: "¿La cita es para usted o para otra persona?" Then call book_appointment again with forSomeoneElse: false if it is for them, or true if it is for someone else.`,
    });
  });

  it("LEAD_ASK_WHOSE", () => {
    expect(LEAD_ASK_WHOSE).toEqual({
      ok: false,
      error: `Not recorded yet. Ask: "Is this for you or for someone else?" In Spanish: "¿Es para usted o para otra persona?" Then call capture_lead again with forSomeoneElse: false if it is for them, or true if it is for someone else.`,
    });
  });

  it("FOUND_BY_NAME_NEXT", () => {
    expect(FOUND_BY_NAME_NEXT).toBe(
      "This is the appointment of the person they confirmed. If the caller asks about a different person's appointment than the one already confirmed, call confirm_identity with that person's first and last name before you call find_my_booking again.",
    );
  });
});

describe("lockedResult", () => {
  it("'cannot' answers CANNOT, every other reason answers LOCKED", () => {
    expect(lockedResult("cannot")).toBe(CANNOT);
    expect(lockedResult("misses")).toBe(LOCKED);
  });
});

describe("the three builders that take `next` (registry.ts's nextStep(ctx))", () => {
  const next = "offer to take a message with take_message";

  it("readFailed", () => {
    expect(readFailed(next)).toEqual({
      ok: false, confirmed: false,
      error: `The details couldn't be checked right now, so nothing was looked up. Apologize, then ${next} so the team can help.`,
    });
  });

  it("notTheirs", () => {
    expect(notTheirs(next)).toEqual({
      ok: false,
      error: `This appointment isn't one they have confirmed is theirs, so it can't be changed on this call. Do not share any of its details. Apologize, then ${next} so the team can confirm who they are and help.`,
    });
  });

  it("noCallerId", () => {
    expect(noCallerId(next)).toEqual({
      ok: false, confirmed: false,
      error: `This call has no visible caller number, so appointments can't be looked up on it — not by a number the caller says, either. Apologize, then ${next} so the team can help them.`,
    });
  });
});

describe("no result ever carries a template marker or the persona's name (spec E2)", () => {
  const TEMPLATE_MARKER = /\{[A-Za-z]+\}/;
  const next = "offer to take a message with take_message";
  const ALL: Record<string, unknown> = {
    ASK_NAME, ASK_NAME_AND_EMAIL, ASK_NAME_AGAIN, ASK_EMAIL, CONFIRMED, MISS, LOCKED, CANNOT, NOT_CONFIRMED_YET,
    MESSAGE_ASK_NAME, BOOK_ASK_NAME, BOOK_AMBIGUOUS, BOOK_ASK_WHOSE, LEAD_ASK_WHOSE,
    readFailed: readFailed(next), notTheirs: notTheirs(next), noCallerId: noCallerId(next),
  };

  it("never a {word} marker, never 'Sofía'", () => {
    for (const [name, result] of Object.entries(ALL)) {
      for (const value of Object.values(result as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        expect(value, `${name} holds a template marker`).not.toMatch(TEMPLATE_MARKER);
        expect(value, `${name} names the persona by name`).not.toContain("Sofía");
      }
    }
    expect(FOUND_BY_NAME_NEXT).not.toMatch(TEMPLATE_MARKER);
    expect(FOUND_BY_NAME_NEXT).not.toContain("Sofía");
  });
});
