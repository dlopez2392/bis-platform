import type { PublicLocale } from "@/lib/forms/public-strings";

/**
 * Every string a stranger reads on `/b/<publicId>`, in both languages the
 * platform speaks — the booking twin of `lib/forms/public-strings.ts`.
 *
 * These used to live in `lib/messages.ts` as `booking.public.*`, which is a
 * single-locale catalogue: the dashboard is English-only by design, but a
 * public booking page is not the dashboard. The first embed on a bilingual
 * host site (bis-rgv.com, `?locale=es`) rendered an English picker to a
 * Spanish visitor, which `embed.js` had been quietly promising not to do
 * since the day it started forwarding `data-locale` to `/b`.
 *
 * Same audience rule `messages.test.ts` enforces on the dashboard catalogue:
 * no internal roadmap label, ever.
 */
const STRINGS = {
  en: {
    noSlots: "No times available this day.",
    timezoneLabel: "Times shown in {zone}",
    previousWeek: "Previous week",
    nextWeek: "Next week",
    firstName: "First name",
    lastName: "Last name",
    email: "Email",
    phone: "Phone",
    note: "Note",
    optional: "optional",
    required: "This field is required.",
    invalidEmail: "Enter a valid email address.",
    invalidPhone: "Enter a valid phone number.",
    // Same deliberate carve-out `f/[publicId]/actions.ts`'s `tokenExpired`
    // draws: a real visitor who left the tab open, not a spam signal, so this
    // is the one render-token failure that gets its own honest message
    // instead of the shared fake success.
    tokenExpired: "This page has been open a while — please refresh and pick your time again.",
    submit: "Confirm booking",
    submitting: "Booking…",
    changeTime: "Choose a different time",
    slotTaken: "That time was just booked. Pick another below.",
    genericError: "Something went wrong. Please try again.",
    successTitle: "You're booked in.",
    successBody: "We've sent a confirmation to your email.",
    cancelHint: "Need to cancel or reschedule? Use the link in your confirmation email.",
    // The cancel-by-link page — `/b/<publicId>/cancel/<token>`, reached from
    // the confirmation and reminder emails.
    cancelConfirmTitle: "Cancel this booking?",
    cancelConfirmButton: "Cancel booking",
    // Deliberately the SAME copy for a booking this action just cancelled and
    // one a second click on the same link finds already cancelled — a replay
    // is a state, not an error, and the two are indistinguishable to a
    // visitor by design (see `cancelBookingByToken`'s own doc comment).
    cancelAlreadyCancelledTitle: "This booking has already been cancelled.",
    cancelPastTitle: "This booking has already happened.",
    cancelGenericError: "Something went wrong — the booking was not cancelled. Please try again.",
    // DESIGN.md's booking-page pattern. "BIS" is the proper noun; "Powered by"
    // is an ordinary phrase and translates like any other — a Spanish booker
    // was reading one English line at the foot of an otherwise Spanish page.
    poweredBy: "Powered by BIS",
    // The step indicator. The NAME carries the meaning, not the dot: DESIGN.md
    // rule 3 forbids status by colour alone.
    stepsLabel: "Booking progress",
    step1: "Pick a time",
    step2: "Your details",
    step3: "Confirmed",
  },
  es: {
    noSlots: "No hay horarios disponibles este día.",
    timezoneLabel: "Horarios mostrados en {zone}",
    previousWeek: "Semana anterior",
    nextWeek: "Semana siguiente",
    firstName: "Nombre",
    lastName: "Apellido",
    email: "Correo electrónico",
    phone: "Teléfono",
    note: "Nota",
    optional: "opcional",
    required: "Este campo es obligatorio.",
    invalidEmail: "Escribe un correo electrónico válido.",
    invalidPhone: "Escribe un número de teléfono válido.",
    tokenExpired: "Esta página lleva un rato abierta — actualízala y vuelve a elegir tu horario.",
    submit: "Confirmar cita",
    submitting: "Agendando…",
    changeTime: "Elegir otro horario",
    slotTaken: "Ese horario se acaba de ocupar. Elige otro abajo.",
    genericError: "Algo salió mal. Vuelve a intentarlo.",
    successTitle: "Tu cita quedó agendada.",
    successBody: "Te enviamos una confirmación a tu correo.",
    cancelHint: "¿Necesitas cancelar o reprogramar? Usa el enlace de tu correo de confirmación.",
    cancelConfirmTitle: "¿Cancelar esta cita?",
    cancelConfirmButton: "Cancelar cita",
    cancelAlreadyCancelledTitle: "Esta cita ya fue cancelada.",
    cancelPastTitle: "Esta cita ya pasó.",
    cancelGenericError: "Algo salió mal — la cita no se canceló. Vuelve a intentarlo.",
    poweredBy: "Con tecnología de BIS",
    stepsLabel: "Progreso de la reserva",
    step1: "Elige un horario",
    step2: "Tus datos",
    step3: "Confirmado",
  },
} as const;

// Widened to `string` per key for the same reason `PublicStrings` is: `as
// const` pins each English literal, which the Spanish table cannot satisfy.
export type BookingStrings = { [K in keyof (typeof STRINGS)["en"]]: string };

export function bookingStrings(locale: PublicLocale): BookingStrings {
  return locale === "es" ? STRINGS.es : STRINGS.en;
}

/**
 * The `Intl` locale for every date and time this page formats. Always an
 * explicit tag, never `undefined` (the house pattern — see `lib/format.ts`):
 * an `undefined` locale resolves to the SERVER's locale during SSR and the
 * BROWSER's during hydration, a mismatch for every visitor whose device is
 * not set to the server's. `es-US` rather than `es-MX`/`es-ES`: 12-hour
 * clock and US month/day order, which is what a Valley visitor reads.
 */
export function intlLocale(locale: PublicLocale): "en-US" | "es-US" {
  return locale === "es" ? "es-US" : "en-US";
}
