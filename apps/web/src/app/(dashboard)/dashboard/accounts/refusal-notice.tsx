import { Notice } from "@/components/ui/notice";
import type { Locale } from "@/lib/i18n/locale";

/** A refusal Add company or Add as a company shows in the form, and the language it is written in. */
export type Refusal = { text: string; lang: Locale };

/**
 * The dialogs' inline refusal (S-53 spec 5.1: read in the form, not toasted away). It sits outside
 * TradeFields' `lang` wrapper and may be either language - a trade refusal follows the dialog's
 * language, every other refusal is English - so it sets its own `lang` (design check I2).
 */
export function RefusalNotice({ refusal }: { refusal: Refusal }) {
  return <Notice tone="crit" className="text-foreground" lang={refusal.lang}>{refusal.text}</Notice>;
}
