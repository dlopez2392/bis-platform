import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * The card's space-used line (spec 4.2 item 4): "4.1 of 5 GB used", only ABOVE 80% of the quota. The
 * used figure is the account's (0078), counted as the quota counts it. Tenths round DOWN, so an account
 * one byte short of full never reads "5.0 of 5 GB". GB here is the quota's own unit, 2^30 bytes (5 GB =
 * DOCUMENT_QUOTA_BYTES). No number, no line: a failed read is omitted, never shown as zero (DESIGN.md:
 * a metric not measured is omitted, never zeroed). Pure; the browser renders it.
 */
export type DocumentsSpace = { used: number; quota: number };
export const SPACE_SHOW_ABOVE = 0.8;
const GIB = 1_073_741_824;

export function spaceUsedText(space: DocumentsSpace | null, locale: Locale): string | null {
  if (!space || !(space.quota > 0) || !(space.used > space.quota * SPACE_SHOW_ABOVE)) return null;
  const tag = locale === "es" ? "es-US" : "en-US";
  const used = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.floor((space.used * 10) / GIB) / 10);
  const quota = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(space.quota / GIB);
  return t(m, "documents.spaceUsed", locale, { used, quota });
}
