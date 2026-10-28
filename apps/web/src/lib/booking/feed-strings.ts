import type { Locale } from "@/lib/i18n/locale";

/** F-048 part 2: every word inside the owner's subscribed feed. One feed is in one language, end to end. */
const EN = {
  calendarName: "{business} bookings",
  calendarNameNoBrand: "Bookings",
  kind_in_person: "Appointment",
  kind_phone: "Phone call",
  kind_video: "Video call",
  summary: "{kind}: {name}",
  noShow: "No-show",
  customer: "Customer",
  openIn: "Open in BIS: {url}",
};
export type FeedStrings = typeof EN;
const ES: FeedStrings = {
  calendarName: "Citas de {business}",
  calendarNameNoBrand: "Citas",
  kind_in_person: "Cita",
  kind_phone: "Llamada",
  kind_video: "Videollamada",
  summary: "{kind}: {name}",
  noShow: "No se presentó",
  customer: "Cliente",
  openIn: "Ver en BIS: {url}",
};
export function feedStrings(locale: Locale): FeedStrings {
  return locale === "es" ? ES : EN;
}
