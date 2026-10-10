import type { Locale } from "./locale";

/** The one list of languages an account can be set to — rendered by the
 *  Settings Language field and validated by `setAccountLanguageAction`, so
 *  the two cannot drift. Each label is written in its own language
 *  ("Español", not "Spanish"): it is the word a Spanish reader looks for. */
export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const satisfies readonly { value: Locale; label: string }[];
