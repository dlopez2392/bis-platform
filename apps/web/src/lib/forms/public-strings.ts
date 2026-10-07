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
    tokenExpired: "This form expired. Please refresh the page and submit again.",
    optional: "optional",
    // F-102: the error boundary's button (`app/f/error.tsx`), in both
    // languages — it used to be an English literal baked into the JSX.
    tryAgain: "Try again",
    // F-102's not-found page (`app/f/[publicId]/not-found.tsx`) — shown for
    // a draft, archived or unknown form alike (deliberately indistinguishable
    // from each other; see the page's own comment).
    notFoundTitle: "We can't find this page.",
    notFoundBody: "The link may be out of date. Check with the business that shared it.",
    // The browser tab title (`generateMetadata`). `{business}` is the
    // customer-facing name (`brandDisplayName`), substituted by the caller —
    // never `accounts.name`, the agency's internal label.
    tabTitleWithBrand: "{business} · Form",
    tabTitleNoBrand: "Form",
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
    tokenExpired: "Este formulario venció. Actualiza la página y envíalo de nuevo.",
    optional: "opcional",
    tryAgain: "Intentar de nuevo",
    notFoundTitle: "No encontramos esta página.",
    notFoundBody: "El enlace podría estar desactualizado. Consulta con el negocio que lo compartió.",
    tabTitleWithBrand: "{business} · Formulario",
    tabTitleNoBrand: "Formulario",
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

/**
 * The browser tab title for every public, customer-facing surface (/f, /b,
 * /b's cancel page, /c) — one shared shape, since all four catalogues
 * (`publicStrings`, `bookingStrings`, `bookingStrings`'s cancel pair,
 * `conciergeStrings`) carry the same `tabTitleWithBrand`/`tabTitleNoBrand`
 * keys. `businessName` is the CUSTOMER-FACING name (`brandDisplayName`),
 * never `accounts.name` — callers must resolve that before reaching here.
 */
export function publicTabTitle(
  strings: { tabTitleWithBrand: string; tabTitleNoBrand: string },
  businessName: string,
): string {
  const trimmed = businessName.trim();
  return trimmed
    ? strings.tabTitleWithBrand.replace("{business}", trimmed)
    : strings.tabTitleNoBrand;
}
