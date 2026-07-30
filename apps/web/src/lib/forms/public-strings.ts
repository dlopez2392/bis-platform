export type PublicLocale = "en" | "es";

const STRINGS = {
  en: {
    submit: "Submit",
    submitting: "Sending…",
    success: "Thank you — we'll be in touch shortly.",
    required: "This field is required.",
    invalidEmail: "Enter a valid email address.",
    invalidPhone: "Enter a valid phone number.",
    consentRequired: "Please check this box to continue.",
    unavailable: "Something went wrong. Please try again.",
    optional: "optional",
  },
  es: {
    submit: "Enviar",
    submitting: "Enviando…",
    success: "Gracias — nos pondremos en contacto pronto.",
    required: "Este campo es obligatorio.",
    invalidEmail: "Escribe un correo electrónico válido.",
    invalidPhone: "Escribe un número de teléfono válido.",
    consentRequired: "Marca esta casilla para continuar.",
    unavailable: "Algo salió mal. Vuelve a intentarlo.",
    optional: "opcional",
  },
} as const;

// Widened to `string` per key, not the literal `(typeof STRINGS)["en"]` shape:
// with `as const`, that type pins each value to the exact English literal
// (e.g. `submit: "Submit"`), which `STRINGS.es` — same keys, different literal
// strings — cannot structurally satisfy.
export type PublicStrings = { [K in keyof (typeof STRINGS)["en"]]: string };

export function publicStrings(locale: string | undefined): PublicStrings {
  return locale === "es" ? STRINGS.es : STRINGS.en;
}

export function normalizeLocale(value: string | undefined, fallback: PublicLocale): PublicLocale {
  return value === "es" || value === "en" ? value : fallback;
}
