const STRINGS = {
  en: {
    placeholder: "Type your message…",
    send: "Send",
    sending: "Sending…",
    thinking: "Typing…",
    unavailable: "Something went wrong. Please try again.",
    ended: "Thanks for chatting. Leave your name and a number or email and the team will pick this up.",
    poweredBy: "Powered by BIS",
    title: "Chat",
  },
  es: {
    placeholder: "Escribe tu mensaje…",
    send: "Enviar",
    sending: "Enviando…",
    thinking: "Escribiendo…",
    unavailable: "Algo salió mal. Vuelve a intentarlo.",
    ended: "Gracias por escribir. Déjanos tu nombre y un teléfono o correo y el equipo te contactará.",
    poweredBy: "Con tecnología de BIS",
    title: "Chat",
  },
} as const;

// Widened to `string` per key, not the literal `(typeof STRINGS)["en"]` shape —
// same technique and same reason as lib/forms/public-strings.ts's
// `PublicStrings`: with `as const`, that type pins each value to the exact
// English literal, which `STRINGS.es` (same keys, different literal strings)
// cannot structurally satisfy.
export type ConciergeStrings = { [K in keyof (typeof STRINGS)["en"]]: string };

export function conciergeStrings(locale: string | undefined): ConciergeStrings {
  return locale === "es" ? STRINGS.es : STRINGS.en;
}
