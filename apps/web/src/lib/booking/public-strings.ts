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
    noSlotsHint: "Try another day above.",
    // S-47d (spec §5.3): the closed-business notices this page shows instead
    // of the picker, when the business is closed today, closed for a storm,
    // or closed on the day a visitor opened a direct link for.
    closedTodayNotice: "Closed today. Please pick another day.",
    stormNotice: "We're closed for now. Please check back soon.",
    stormUntilNotice: "Closed until {date}. Please pick a day from then on.",
    closedDay: "Closed this day.",
    today: "Today",
    morning: "Morning",
    afternoon: "Afternoon",
    evening: "Evening",
    chosenLabel: "Your time",
    loadingTimes: "Loading available times",
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
    // D-033: the confirmation email did NOT go (the provider refused it, or
    // none is set up). The booking is real; say only what is true, and make
    // the link on this screen — now the only copy — the thing to keep.
    successBodyNoEmail: "We couldn't email you a confirmation, so please note the time above.",
    cancelHintNoEmail: "Save this link to cancel or reschedule later.",
    cancelHintNoEmailNoLink: "To cancel or reschedule, please contact us directly.",
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
    // F-102: the error boundary's button (`app/b/error.tsx`), in both
    // languages — it used to be an English literal baked into the JSX.
    tryAgain: "Try again",
    // F-102's not-found page (`app/b/not-found.tsx`) — shown for a
    // disabled calendar, a stale cancel link, or an unknown public id alike.
    notFoundTitle: "We can't find this page.",
    notFoundBody: "The link may be out of date. Check with the business that shared it.",
    // The browser tab titles (`generateMetadata`). `{business}` is the
    // customer-facing name (`brandDisplayName`), substituted by the caller —
    // never `accounts.name`, the agency's internal label.
    tabTitleWithBrand: "Book with {business}",
    tabTitleNoBrand: "Book an appointment",
    cancelTabTitleWithBrand: "Cancel your visit with {business}",
    cancelTabTitleNoBrand: "Cancel your appointment",
    // F-048: the add-to-calendar file (`lib/booking/calendar-file.ts`) and
    // the success screen link that downloads it. `{business}` is the brand
    // name (`brandDisplayName`), `{when}` the time in the business zone.
    addToCalendar: "Add to my calendar",
    calendarTitleWithBrand: "Appointment with {business}",
    calendarTitleNoBrand: "Appointment",
    calendarForUs: "{when} for us",
    calendarJoin: "Join your video meeting",
    calendarCancel: "Cancel this booking",
    // F-048: the message the Calendar page's Cancel dialog prefills into the
    // customer's notice, in the language the owner picks. The owner can
    // rewrite it; the email adds the time and a link to book again.
    cancelNoticeDefault: "We're sorry, but we have to cancel this appointment.",
    // F-048: the customer moves their own booking —
    // `/b/<publicId>/move/<token>`, reached from the confirmation email and
    // from the cancel page. The picker itself reuses the booking page's words.
    moveLink: "Change the time instead",
    cancelInsteadLink: "Cancel this booking instead",
    moveCurrentLabel: "Your booking now",
    moveChosenLabel: "Your new time",
    moveSubmit: "Move my booking",
    moveSubmitting: "Moving…",
    moveSuccessTitle: "Your booking has been moved.",
    moveSuccessBody: "We've sent the new time to your email.",
    moveSuccessBodyNoEmail: "We couldn't email you, so please note the new time above.",
    moveManageHint: "Need to change or cancel it again? Use the link in your email.",
    moveManageHintNoEmail: "Save this link to change or cancel it later.",
    moveGenericError: "Something went wrong — your booking was not moved. Please try again.",
    // The link's booking stopped being live while the page was open (another
    // tab, or the business, changed it). Nothing was moved.
    moveAlreadyChanged: "This booking was already changed or cancelled, so nothing was moved. If you are not sure of your time, please contact us.",
    // An OLD link, after a move: the booking it names was replaced. Said on
    // the cancel page and the move page alike, instead of "cancelled". Neither
    // line promises an email: none may have gone (D-033; fix round 1, m2).
    // A short title (the cancel page sets it in its title style), and the
    // rest as a line under it (fix round 2, m-d).
    movedTitle: "This booking was moved.",
    movedBody: "This link no longer changes it. If you need the new time, please contact us.",
    // The business has switched online booking off: a move is a new booking,
    // so it stops too (a cancel never does).
    moveOffline: "To change the time, please contact us directly.",
    moveTabTitleWithBrand: "Change your visit with {business}",
    moveTabTitleNoBrand: "Change your appointment",
    // S-10 T9b (G2's own raw-JSX ratchet): the honeypot field's label, off-
    // screen and aria-hidden — only a bot scanning the raw DOM ever reads
    // it, but it moves into the catalogue all the same, same treatment as
    // the review-link and weekly-report placeholders.
    honeypot: "Do not fill this in",
  },
  // S-10 T9b (owner decision 2026-11-01, overriding fix round C6's "the
  // booking page speaks tú" note below): usted everywhere, customer-facing
  // included.
  es: {
    noSlots: "No hay horarios disponibles este día.",
    noSlotsHint: "Pruebe con otro día de arriba.",
    closedTodayNotice: "Cerrado hoy. Elija otro día.",
    stormNotice: "Por ahora estamos cerrados. Vuelva a consultar pronto.",
    stormUntilNotice: "Cerrado hasta el {date}. Elija un día a partir de esa fecha.",
    closedDay: "Cerrado este día.",
    today: "Hoy",
    morning: "Mañana",
    afternoon: "Tarde",
    evening: "Noche",
    chosenLabel: "Su horario",
    loadingTimes: "Cargando horarios disponibles",
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
    invalidEmail: "Escriba un correo electrónico válido.",
    invalidPhone: "Escriba un número de teléfono válido.",
    tokenExpired: "Esta página lleva un rato abierta — actualícela y vuelva a elegir su horario.",
    submit: "Confirmar cita",
    submitting: "Agendando…",
    changeTime: "Elegir otro horario",
    slotTaken: "Ese horario se acaba de ocupar. Elija otro abajo.",
    genericError: "Algo salió mal. Inténtelo de nuevo.",
    successTitle: "Su cita quedó agendada.",
    successBody: "Le enviamos una confirmación a su correo.",
    cancelHint: "¿Necesita cancelar o cambiar el horario? Use el enlace de su correo de confirmación.",
    successBodyNoEmail: "No pudimos enviarle la confirmación por correo, así que anote el horario de arriba.",
    cancelHintNoEmail: "Guarde este enlace para cancelar o cambiar el horario más tarde.",
    cancelHintNoEmailNoLink: "Para cancelar o cambiar el horario, comuníquese directamente con nosotros.",
    cancelConfirmTitle: "¿Cancelar esta cita?",
    cancelConfirmButton: "Cancelar cita",
    cancelAlreadyCancelledTitle: "Esta cita ya fue cancelada.",
    cancelPastTitle: "Esta cita ya pasó.",
    cancelGenericError: "Algo salió mal — la cita no se canceló. Inténtelo de nuevo.",
    poweredBy: "Con tecnología de BIS",
    stepsLabel: "Progreso de su cita",
    step1: "Elija un horario",
    step2: "Sus datos",
    step3: "Confirmado",
    tryAgain: "Intentar de nuevo",
    notFoundTitle: "No encontramos esta página.",
    notFoundBody: "El enlace podría estar desactualizado. Consulte con el negocio que lo compartió.",
    tabTitleWithBrand: "Agende con {business}",
    tabTitleNoBrand: "Agendar una cita",
    cancelTabTitleWithBrand: "Cancele su cita con {business}",
    cancelTabTitleNoBrand: "Cancelar una cita",
    addToCalendar: "Agregar a mi calendario",
    calendarTitleWithBrand: "Cita con {business}",
    calendarTitleNoBrand: "Cita",
    calendarForUs: "{when} para nosotros",
    calendarJoin: "Unirse a la videollamada",
    calendarCancel: "Cancelar esta cita",
    cancelNoticeDefault: "Lo sentimos, pero tenemos que cancelar su cita.",
    moveLink: "Mejor cambiar el horario",
    cancelInsteadLink: "Mejor cancelar esta cita",
    moveCurrentLabel: "Su cita ahora",
    moveChosenLabel: "Su nuevo horario",
    moveSubmit: "Cambiar mi cita",
    moveSubmitting: "Cambiando…",
    moveSuccessTitle: "Su cita fue reprogramada.",
    moveSuccessBody: "Le enviamos el nuevo horario a su correo.",
    moveSuccessBodyNoEmail: "No pudimos enviarle un correo, así que anote el nuevo horario de arriba.",
    moveManageHint: "¿Necesita cambiarla o cancelarla otra vez? Use el enlace de su correo.",
    moveManageHintNoEmail: "Guarde este enlace para cambiarla o cancelarla más tarde.",
    moveGenericError: "Algo salió mal — su cita no se cambió. Inténtelo de nuevo.",
    moveAlreadyChanged: "Esta cita ya se cambió o se canceló, así que no se movió nada. Si tiene dudas sobre su horario, comuníquese con nosotros.",
    movedTitle: "Esta cita se cambió de horario.",
    movedBody: "Este enlace ya no la modifica. Si necesita el nuevo horario, comuníquese con nosotros.",
    moveOffline: "Para cambiar el horario, comuníquese directamente con nosotros.",
    moveTabTitleWithBrand: "Cambie su cita con {business}",
    moveTabTitleNoBrand: "Cambiar una cita",
    honeypot: "No complete esto",
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
