import type { AutomationLogStatus } from "@bis/db";
import { DotPill } from "@/components/dot-pill";
import type { Locale } from "@/lib/i18n/locale";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { STATUS_TREATMENTS, statusWord } from "@/lib/automations/log-titles";

/** Dot + word, the Calls page's OutcomePill shape, for the four log statuses:
 *  the shared `DotPill` wearing `STATUS_TREATMENTS`'s dot/chip, at its
 *  roomier padding. `locale` defaults to English: styleguide's own demo
 *  (the other caller) stays as it is. */
export function LogStatusPill({ status, locale = "en", pseudo = false }: { status: AutomationLogStatus; locale?: Locale; pseudo?: boolean }) {
  const treatment = STATUS_TREATMENTS[status];
  return <DotPill label={pseudo ? pseudoLocale(statusWord(status, locale)) : statusWord(status, locale)} chip={treatment.chip} dot={treatment.dot} data-status={status} />;
}
