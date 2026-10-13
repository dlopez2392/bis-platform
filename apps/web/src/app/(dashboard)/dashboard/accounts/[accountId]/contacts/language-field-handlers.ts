import type { ContactLanguage, LanguageTriple } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { LANGUAGE_ENDONYM } from "@/lib/contacts/language";

type Plain = { ok: true } | { ok: false; error: string };
/**
 * Orchestrator course-correction (Task 10 fix round, not yet in the tree when this was written):
 * `setContactLanguageAction` now answers both the PRIOR triple and what it actually WROTE, so the
 * Undo can prove nothing has changed since (passed back to `restoreContactLanguageAction`, which
 * refuses — `ok: false` — with an already-translated message when it has). Defined here, not
 * imported from "./actions" (Task 10's own file), so this type does not drift from Task 10's real
 * one if the two land out of order; the import goes back to "./actions" once that commit is in.
 */
export type LanguageActionResult =
  | { ok: true; prior: LanguageTriple; written: LanguageTriple }
  | { ok: false; error: string };

export type LanguageFieldDeps = {
  set: (language: ContactLanguage) => Promise<LanguageActionResult>;
  /** `written`: what `set` actually wrote, so the server can refuse the Undo if it no longer matches (changed-since). */
  restore: (prior: LanguageTriple, written: LanguageTriple) => Promise<Plain>;
  keep: () => Promise<Plain>;
  toast: {
    success: (message: string, opts?: { action?: { label: string; onClick: () => void } }) => void;
    error: (message: string) => void;
  };
  onChanged: () => void;
  locale: Locale;
};

/** Rule 6: the change runs at once, and its Undo puts back exactly what was there (C9). Switch is this too. */
export async function chooseLanguage(d: LanguageFieldDeps, language: ContactLanguage): Promise<void> {
  const r = await d.set(language);
  if (!r.ok) { d.toast.error(r.error); return; }
  d.onChanged();
  d.toast.success(t(m, "contact.language.setToast", d.locale, { value: LANGUAGE_ENDONYM[language] }), {
    action: { label: t(m, "common.undo", d.locale), onClick: () => { void undoLanguage(d, r.prior, r.written); } },
  });
}

/** The server's errors here (including a changed-since refusal) arrive already in the reader's
 *  language — toasted as given, never re-translated. */
export async function undoLanguage(d: LanguageFieldDeps, prior: LanguageTriple, written: LanguageTriple): Promise<void> {
  const r = await d.restore(prior, written);
  if (!r.ok) { d.toast.error(r.error); return; }
  d.onChanged();
}

/** Keep: no Undo, nothing about the customer changed (§8.3). */
export async function keepLanguage(d: LanguageFieldDeps): Promise<void> {
  const r = await d.keep();
  if (!r.ok) { d.toast.error(r.error); return; }
  d.onChanged();
  d.toast.success(t(m, "contact.language.keptToast", d.locale));
}
