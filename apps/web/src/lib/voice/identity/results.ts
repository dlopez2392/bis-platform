// S-47e (spec 5.4.4, S14): what Sofía is told. Model input, not catalogue copy: English instructions with the
// sentences she says quoted in English and Spanish (usted). Pinned word for word by results.test.ts. No result
// carries a candidate's name, email or number (spec E2).
export type ToolResult = Readonly<Record<string, unknown>>;

export const ASK_NAME: ToolResult = {
  found: false, confirmIdentity: "name",
  next: `Before you look anything up, ask whose name the appointment is under: the first and last name. For example: "Whose name is the appointment under? I'll need the first and last name." In Spanish: "¿A nombre de quién está la cita? Necesito el nombre y el apellido." Then call confirm_identity with fullName. Do not suggest or guess a name, and do not say how many people use this number.`,
};
export const ASK_NAME_AND_EMAIL: ToolResult = {
  found: false, confirmIdentity: "name_and_email",
  next: `Before you look anything up, ask for the full name the appointment is under and the email address on file. For example: "To look that up, I need the full name and the email address we have on file." In Spanish: "Para buscarla, necesito el nombre completo y el correo electrónico que tenemos registrado." Spell the email back character by character, saying 'at' for @ and 'dot' for the period, and wait for them to confirm. Then call confirm_identity with fullName and email. Do not suggest or guess a name or an email.`,
};
export const ASK_NAME_AGAIN: ToolResult = {
  ok: false, confirmed: false, next: "Ask for their first AND last name, then call confirm_identity again.",
};
export const ASK_EMAIL: ToolResult = {
  ok: false, confirmed: false, confirmIdentity: "email",
  next: `Ask for the email address on file: "Could I also have the email address we have on file?" In Spanish: "¿Me da también el correo electrónico que tenemos registrado?" Spell it back character by character and wait for them to confirm, then call confirm_identity again with fullName and email.`,
};
export const CONFIRMED: ToolResult = { ok: true, confirmed: true, next: "Confirmed. Call find_my_booking now." };
export const MISS: ToolResult = {
  ok: false, confirmed: false,
  next: `Say: "I couldn't find it under those details." In Spanish: "No la encontré con esos datos." You may ask them once more and call confirm_identity again. You have not been told which detail did not match, so do not say or guess.`,
};
export const LOCKED: ToolResult = {
  ok: false, confirmed: false, locked: true,
  next: `Say: "I'm sorry, I couldn't find it under those details, so I can't look it up on this call. I can take a message and someone from the team will call you back." In Spanish: "Lo siento, no la encontré con esos datos, así que no puedo consultarla en esta llamada. Puedo tomarle un mensaje y alguien del equipo le devolverá la llamada." If they want, take the message with take_message. Do not ask for these details again on this call.`,
};
export const CANNOT: ToolResult = {
  found: false, locked: true,
  next: `Say: "I'm sorry, I can't look that up on this call. I can take a message and someone from the team will call you back." In Spanish: "Lo siento, no puedo consultarla en esta llamada. Puedo tomarle un mensaje y alguien del equipo le devolverá la llamada." If they want, take the message with take_message.`,
};
export const NOT_CONFIRMED_YET: ToolResult = {
  ok: false,
  error: "This appointment can't be changed until find_my_booking has found it for them on this call. Call find_my_booking first. Do not share any of its details.",
};
/** take_message on a shared number with no name (spec 5.10.5). */
export const MESSAGE_ASK_NAME: ToolResult = {
  ok: false,
  error: "Before you take the message, ask for their first and last name, then call take_message again with name. If they would rather not say, call it again with nameDeclined: true.",
};
/** book_appointment's two refusals (spec 5.10.1). */
export const BOOK_ASK_NAME: ToolResult = {
  ok: false, error: "Before you book, ask for their first AND last name, then call book_appointment again with it.",
};
export const BOOK_AMBIGUOUS: ToolResult = {
  ok: false,
  error: "This appointment can't be booked under that name on this call. First call capture_lead with their name and what they needed, then take_message, so the team can book it.",
};
/** book_appointment on a number with ONE contact whose name the caller's does not match (plan P27). */
export const BOOK_ASK_WHOSE: ToolResult = {
  ok: false,
  error: `Not booked yet. Ask: "Is this appointment for you or for someone else?" In Spanish: "¿La cita es para usted o para otra persona?" Then call book_appointment again with forSomeoneElse: false if it is for them, or true if it is for someone else.`,
};
/** capture_lead, the same question, asked once (plan P27). */
export const LEAD_ASK_WHOSE: ToolResult = {
  ok: false,
  error: `Not recorded yet. Ask: "Is this for you or for someone else?" In Spanish: "¿Es para usted o para otra persona?" Then call capture_lead again with forSomeoneElse: false if it is for them, or true if it is for someone else.`,
};
/** Added to find_my_booking's found result when the confirmation came from a name (plan P25). */
export const FOUND_BY_NAME_NEXT =
  "This is the appointment of the person they confirmed. If the caller asks about a different person's appointment than the one already confirmed, call confirm_identity with that person's first and last name before you call find_my_booking again.";

/** After a "cannot" lock every later refusal says CANNOT, so she never says "those details" to someone who gave none. */
export function lockedResult(why: "misses" | "cannot"): ToolResult {
  return why === "cannot" ? CANNOT : LOCKED;
}
/** `next` is registry.ts's nextStep(ctx): a transfer where one is set up, else a message. */
export function readFailed(next: string): ToolResult {
  return { ok: false, confirmed: false, error: `The details couldn't be checked right now, so nothing was looked up. Apologize, then ${next} so the team can help.` };
}
export function notTheirs(next: string): ToolResult {
  return { ok: false, error: `This appointment isn't one they have confirmed is theirs, so it can't be changed on this call. Do not share any of its details. Apologize, then ${next} so the team can confirm who they are and help.` };
}
/** confirm_identity with no caller ID: find_my_booking's own refusal sentence (a name never raises rung 0). */
export function noCallerId(next: string): ToolResult {
  return { ok: false, confirmed: false, error: `This call has no visible caller number, so appointments can't be looked up on it — not by a number the caller says, either. Apologize, then ${next} so the team can help them.` };
}
