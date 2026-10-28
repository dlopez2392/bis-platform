import { describe, it, expect } from "vitest";
import { looksAutomaticText } from "./automatic-text";

/** Contact archive, review I7: a phone's own auto-reply never brings an archived contact back. Each
 *  example below matches exactly ONE listed phrase, so dropping that phrase turns its own case red. */
describe("looksAutomaticText", () => {
  it.each([
    ["i'm driving", "I'm driving. I'll get back to you."],
    ["im driving", "Im driving, text later"],
    ["i am driving", "I am driving, will call you back"],
    ["driving right now", "Driving right now, will reply soon"],
    ["do not disturb while driving", "Do Not Disturb While Driving is on. I'll see your message later."],
    ["this number cannot receive", "This number cannot receive replies."],
    ["this number can't receive", "Sorry, this number can't receive calls or texts."],
    ["this number does not accept", "This number does not accept SMS."],
    ["cannot receive text messages", "The person you are trying to reach cannot receive text messages."],
    ["auto reply", "Auto reply: back Monday"],
    ["autoreply", "AUTOREPLY - we'll be in touch"],
    ["automatic reply", "Automatic reply: away until the 3rd"],
    ["this is an automated message", "This is an automated message, please do not reply."],
    ["out of office", "Out of office until Monday."],
    ["estoy manejando", "Estoy manejando, le contesto luego"],
    ["estoy conduciendo", "Estoy conduciendo ahora"],
    ["respuesta automatica", "Respuesta automática: volvemos el lunes"],
    ["mensaje automatico", "Este es un mensaje automático."],
    ["no puede recibir mensajes", "Este número no puede recibir mensajes"],
    ["este numero no recibe", "Este número no recibe textos."],
    ["fuera de la oficina", "Fuera de la oficina hasta el lunes"],
  ])("%s: %j is a phone's own reply (mutation: drop the phrase → FAILS)", (_phrase, body) => {
    expect(looksAutomaticText(body)).toBe(true);
  });

  it.each([
    "Yes please send the quote",
    "Test",
    "Can you come Tuesday?",
    "Gracias, ¿pueden venir el martes?",
    "Stop by anytime",
    "Send him driving directions",
    "Tim driving over now",
    "autoreplying is broken",
  ])("%j is the customer, not an auto-reply (mutation: match the single word 'driving' or 'auto' → FAILS; drop the word-boundary padding → 'Send him driving directions' FAILS)", (body) => {
    expect(looksAutomaticText(body)).toBe(false);
  });

  it.each([
    "I'm driving.",
    "I’m driving",
    "Auto-Reply: back Monday",
    "  DRIVING   right\nnow  ",
  ])("%j matches through punctuation, curly quotes, case and spacing (mutation: stop normalising punctuation → FAILS)", (body) => {
    expect(looksAutomaticText(body)).toBe(true);
  });
});
