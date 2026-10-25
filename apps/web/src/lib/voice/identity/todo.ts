import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

// S-47e (spec 5.6, S10): the title of the To-do a locked identity check leaves, in the given (the account's)
// language. Kept out of finish-call.ts on purpose: that file imports the email gate, and scans.test.ts reads any
// "voice." string literal in a gate caller as a send kind (T17 review I1). Do not inline it back.
export function identityTodoTitle(locale: Locale): string {
  return t(m, "voice.todo.identity", locale);
}
