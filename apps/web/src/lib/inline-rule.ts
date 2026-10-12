import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The fourth InlineField arm's rule, as DATA (serializable across the RSC boundary, like `field`
 * and `required`), checked here so the server action behind the field runs the identical check
 * (lib/enum-value.ts's reasoning). The edge class strips a SUPERSET of PG's [:space:] as 0070
 * measured it, plus the zero-width space and BOM, so a value cleaned here never 23514s on
 * app.tidy_text (0071).
 *
 * `notAfter` is a "YYYY-MM-DD" string, the account's own today: dates compare as strings, so the
 * caller must hand it in that exact shape.
 */
export type InlineRule =
  | { kind: "text"; max: number; required: boolean }
  | { kind: "date"; required: boolean; notAfter?: string };

// The class as code points (U+001C-001F, U+0085, U+200B, U+FEFF beside \s), built with
// String.fromCodePoint so no invisible character sits in the source. JS's \s already covers
// U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000 and
// U+FEFF; EXTRA adds what it misses.
const EXTRA = String.fromCodePoint(0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0x200b, 0xfeff);
const EDGE = new RegExp(`^[\\s${EXTRA}]+|[\\s${EXTRA}]+$`, "g");

export const cleanEdgeSpace = (v: string): string => v.replace(EDGE, "");

/** Counts code points, as PG's char_length does (an emoji is one, not two UTF-16 units). */
export const codePoints = (v: string): number => [...v].length;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function realDate(v: string): boolean {
  const p = DATE.exec(v);
  if (!p) return false;
  const [y, mo, d] = [Number(p[1]), Number(p[2]), Number(p[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

export function validateInlineRule(
  rule: InlineRule,
  raw: string,
  locale: Locale = "en",
): { ok: true; value: string } | { ok: false; error: string } {
  const value = cleanEdgeSpace(raw);
  if (value === "") {
    return rule.required ? { ok: false, error: t(m, "inline.rule.required", locale) } : { ok: true, value: "" };
  }
  if (rule.kind === "text") {
    return codePoints(value) <= rule.max
      ? { ok: true, value }
      : { ok: false, error: t(m, "inline.rule.tooLong", locale, { max: rule.max }) };
  }
  if (!realDate(value)) return { ok: false, error: t(m, "inline.rule.badDate", locale) };
  if (rule.notAfter && value > rule.notAfter) return { ok: false, error: t(m, "inline.rule.future", locale) };
  return { ok: true, value };
}
