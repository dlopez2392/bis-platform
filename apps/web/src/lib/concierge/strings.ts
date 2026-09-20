const STRINGS = {
  en: {
    placeholder: "Type your message…",
    send: "Send",
    sending: "Sending…",
    thinking: "Typing…",
    unavailable: "Something went wrong. Please try again.",
    // A CLOSE, not a request. The composer disables itself the moment the
    // route answers `ended: true`, so copy that asks for a name and a number
    // asks for something the UI refuses to accept. The ask happens earlier
    // now, in the prompt's budget notice (`concierge/prompt.ts`), while the
    // visitor can still type. This line also answers a conversation id that
    // no longer resolves — `claimConciergeTurn` returns null for both — so it
    // promises nothing it cannot know.
    ended: "This chat is closed. If you shared your name and a way to reach you, someone from the team will follow up.",
    // A different situation from `ended`, and the wrong copy for it: this is
    // a visitor who opened the page and came back to type more than 30
    // minutes later, not a chat that ran and reached its limit. There is
    // nothing to follow up on yet, and no recovery but a reload.
    expired: "This page has been open a while — refresh to start a conversation.",
    // The turn that files a lead usually comes back with no words at all — a
    // chat-completions reply that calls a tool routinely has `content: null`
    // — and "Something went wrong" is the last thing a visitor who has just
    // handed over their details should read.
    captured: "Thanks. I have passed your details to the team and someone will get back to you.",
    // 429: a real cap, not a permanent refusal. Item 1, Branch 2 hardening —
    // the spec's own stated reason for choosing 429 over the anti-oracle
    // body was that a real visitor who hits one needs to know to come back
    // later; without this sentence that reason was never actually delivered.
    rateLimited: "You've started a few conversations recently — please try again in a little while.",
    // Distinct from `ended` on purpose: a message that arrived faster than a
    // person could have typed it, on a token this same widget minted
    // moments ago, is not a spam signal on its own — a fast typist, not a
    // bot. The composer stays open and the visitor can just send again
    // (item 4, Branch 2 hardening).
    tooFast: "That came through before the page finished loading — please send it again.",
    poweredBy: "Powered by BIS",
    title: "Chat",
  },
  es: {
    placeholder: "Escribe tu mensaje…",
    send: "Enviar",
    sending: "Enviando…",
    thinking: "Escribiendo…",
    unavailable: "Algo salió mal. Vuelve a intentarlo.",
    ended: "Esta conversación está cerrada. Si nos diste tu nombre y una forma de contactarte, alguien del equipo te responderá.",
    expired: "Esta página ha estado abierta un buen rato — actualiza la página para iniciar una conversación.",
    captured: "Gracias. Ya le pasé tus datos al equipo y alguien te contactará.",
    rateLimited: "Has iniciado varias conversaciones hace poco — inténtalo de nuevo más tarde.",
    tooFast: "Eso llegó antes de que la página terminara de cargar — vuelve a enviarlo.",
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
