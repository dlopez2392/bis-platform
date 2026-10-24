// S-47d fix round D1 (design review M1): the ONE set of date words every S-47d surface draws from — the
// topbar and the dashboard card (labels.ts), the Closed days card's ranges (range-format.ts) and the
// affected-appointment rows. Fixed tables, never Intl, so the words never depend on the server's or the
// browser's locale data and a server render always matches its hydration. Pure, no imports: safe in a
// client component and in the voice-knowledge graph alike.
//
// The short Spanish months carry their period ("sept.", "dic."), the form the topbar spec pins; English
// short months carry none ("Sep", "Dec").
export type DateWordsLocale = "en" | "es";

export const WEEKDAY_SHORT: Record<DateWordsLocale, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  es: ["dom.", "lun.", "mar.", "mié.", "jue.", "vie.", "sáb."],
};

export const MONTH_SHORT: Record<DateWordsLocale, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."],
};

export const WEEKDAY_LONG: Record<DateWordsLocale, readonly string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
};

export const MONTH_LONG: Record<DateWordsLocale, readonly string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

/** English "{Mon} {d}", Spanish "{d} de {mes}" — the topbar's date form, and the ranges' (month index 0-11). */
export function shortDate(month: number, date: number, locale: DateWordsLocale): string {
  const mon = MONTH_SHORT[locale][month]!;
  return locale === "es" ? `${date} de ${mon}` : `${mon} ${date}`;
}
