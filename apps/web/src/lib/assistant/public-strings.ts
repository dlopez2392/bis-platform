import type { PublicLocale } from "@/lib/forms/public-strings";

/**
 * Every string a stranger reads on `/a/<publicId>` — the website assistant's
 * own twin of `lib/forms/public-strings.ts` and `lib/booking/public-strings.ts`.
 *
 * The assistant's OWN copy (its name, its greeting, its suggestion chips) is
 * account data (`AssistantRow.name`/`greeting`/`suggestions`) and never lives
 * here — this catalogue is only the chrome around that content: the platform
 * default a missing `name`/`greeting` falls back to, and everything the
 * widget itself says (placeholder, buttons, states).
 *
 * Same audience rule `messages.test.ts` and `booking/public-strings.test.ts`
 * both pin: no internal roadmap label, ever — a stranger on a client's
 * website must never read one.
 */
const STRINGS = {
  en: {
    open: "Open chat",
    close: "Close chat",
    titleFallback: "Assistant",
    greetingFallback: "Hi! How can I help?",
    placeholder: "Type your message…",
    send: "Send",
    thinking: "Thinking…",
    suggestionsLabel: "Suggested questions",
    errorHeading: "Something went wrong",
    errorBody: "We couldn't send that. Please try again in a moment.",
    // `{phone}` is filled in only when the caller has a number to offer —
    // see `assistantErrorBody` below. Kept as its own key, on the same
    // template-placeholder pattern `bookingStrings.timezoneLabel` uses,
    // rather than one string that goes ungrammatical with nothing to fill.
    errorBodyWithPhone: "We couldn't send that. Please try again in a moment, or call {phone}.",
    retry: "Try again",
    // "BIS" is the proper noun; "Powered by" is an ordinary phrase and
    // translates like any other — the same note `bookingStrings.poweredBy`
    // carries for its own copy of this line.
    poweredBy: "Powered by BIS",
  },
  es: {
    open: "Abrir chat",
    close: "Cerrar chat",
    titleFallback: "Asistente",
    greetingFallback: "¡Hola! ¿En qué puedo ayudarte?",
    placeholder: "Escribe tu mensaje…",
    send: "Enviar",
    thinking: "Pensando…",
    suggestionsLabel: "Preguntas sugeridas",
    errorHeading: "Algo salió mal",
    errorBody: "No pudimos enviar eso. Vuelve a intentarlo en un momento.",
    errorBodyWithPhone: "No pudimos enviar eso. Vuelve a intentarlo en un momento, o llama al {phone}.",
    retry: "Volver a intentar",
    poweredBy: "Con tecnología de BIS",
  },
} as const;

// Widened to `string` per key, same reason `PublicStrings` and
// `BookingStrings` both are: `as const` pins each value to its exact English
// literal, which the Spanish table (same keys, different literal strings)
// cannot structurally satisfy.
export type AssistantStrings = { [K in keyof (typeof STRINGS)["en"]]: string };

export function assistantStrings(locale: PublicLocale): AssistantStrings {
  return locale === "es" ? STRINGS.es : STRINGS.en;
}

/**
 * `errorBody`, with the phone folded in when the caller has one to offer.
 * Not yet reachable from `/a/<publicId>` in phase 1: no phone number lives on
 * `AssistantRow` or `Branding`, so `page.tsx` has none to pass down. The
 * parameter exists now so a later phase (the account's live phone, read the
 * way `lib/assistant/prompt.ts` reads it for the model) only has to pass a
 * value in, not add a second copy of this sentence.
 */
export function assistantErrorBody(strings: AssistantStrings, phone: string | null): string {
  return phone ? strings.errorBodyWithPhone.replace("{phone}", phone) : strings.errorBody;
}
