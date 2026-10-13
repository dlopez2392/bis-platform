import type { ContactLanguage, LanguageTriple } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { LANGUAGE_ENDONYM } from "@/lib/contacts/language";
// review M7: Task 10's fix round landed `{ ok: true; prior; written }` on `LanguageActionResult`
// (actions.ts:244-246), the same shape this file typed locally while that commit was still in
// flight — imported straight from there now, so the two cannot drift again.
import type { LanguageActionResult } from "./actions";

type Plain = { ok: true } | { ok: false; error: string };

/** One write on this field at a time, across Select, Switch, Keep and Undo (review I3): a second
 *  tap while one is still in flight is ignored — under Task 10's compare-and-set, a racing second
 *  `set` would make the first write's `written` stale, so its own Undo could never land. A plain
 *  mutable pair, not React state directly, so the check is synchronous and cannot miss a second call
 *  queued in the same tick; the component's `set` side also drives the controls' `disabled`. */
export type PendingGuard = { get(): boolean; set(v: boolean): void };

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
  pending: PendingGuard;
};

const saveFailed = (locale: Locale) => t(m, "contact.language.saveFailed", locale);

/** review I2: a rejected call (network, a deploy mismatch, `requireAccountAccess` throwing) is a
 *  plain failure toasted like any other, never an unhandled rejection. */
async function safeCall<T>(locale: Locale, run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await run();
  } catch {
    return { ok: false, error: saveFailed(locale) };
  }
}

/** review I3: shared by chooseLanguage, keepLanguage and the Undo it toasts — the same lock, so
 *  Select/Switch/Keep/Undo can never overlap a write on this field. */
async function guarded(d: LanguageFieldDeps, run: () => Promise<void>): Promise<void> {
  if (d.pending.get()) return;
  d.pending.set(true);
  try {
    await run();
  } finally {
    d.pending.set(false);
  }
}

/** Rule 6: the change runs at once, and its Undo puts back exactly what was there (C9). Switch is this too. */
export async function chooseLanguage(d: LanguageFieldDeps, language: ContactLanguage): Promise<void> {
  await guarded(d, async () => {
    const r = await safeCall(d.locale, () => d.set(language));
    if (!r.ok) { d.toast.error(r.error); return; }
    d.onChanged();
    d.toast.success(t(m, "contact.language.setToast", d.locale, { value: LANGUAGE_ENDONYM[language] }), {
      action: { label: t(m, "common.undo", d.locale), onClick: () => { void undoLanguage(d, r.prior, r.written); } },
    });
  });
}

/** The server's errors here (including a changed-since refusal) arrive already in the reader's
 *  language — toasted as given, never re-translated. */
export async function undoLanguage(d: LanguageFieldDeps, prior: LanguageTriple, written: LanguageTriple): Promise<void> {
  await guarded(d, async () => {
    const r = await safeCall(d.locale, () => d.restore(prior, written));
    if (!r.ok) { d.toast.error(r.error); return; }
    d.onChanged();
  });
}

/** Keep: no Undo, nothing about the customer changed (§8.3). */
export async function keepLanguage(d: LanguageFieldDeps): Promise<void> {
  await guarded(d, async () => {
    const r = await safeCall(d.locale, () => d.keep());
    if (!r.ok) { d.toast.error(r.error); return; }
    d.onChanged();
    d.toast.success(t(m, "contact.language.keptToast", d.locale));
  });
}
