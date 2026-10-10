import type { PersonLanguage, PersonPrefs, PersonTheme } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/messages";
import type { PrefsResult } from "@/lib/preferences/save";
import { localeOfLanguage } from "@/lib/preferences/preference-options";

/**
 * What the Preferences page does when a radio is chosen (F-096, spec §6;
 * DESIGN.md rule 6): the choice applies AT ONCE, the save runs behind it,
 * and a toast says what happened with an Undo. No confirm, no Save button.
 * Plain async functions, not hooks (team-handlers.ts's pattern), so
 * preference-handlers.test.ts reaches every toast and every Undo without a
 * DOM.
 *
 * Undo sends the value the SERVER says it replaced (`previous`), not the
 * one this page last showed: another tab or device may have saved in
 * between, and the server's answer is the only one that is true.
 */

/** Sonner's own 4 s is short for a decision; the house undo window (team-handlers.ts's TEAM_TOAST_MS). */
export const PREFS_TOAST_MS = 10_000;

export type PrefsCopyKey = Extract<MessageKey, `prefs.${string}`> | "common.actionCrashed";
type Copy = (key: PrefsCopyKey, params?: Record<string, string>) => string;

export type PrefsToast = {
  success: (msg: string, undo: { label: string; onClick: () => void }) => void;
  error: (msg: string) => void;
  /** The "Changed back." after an Undo lands. Optional, so a caller with no
   *  plain toast (the tests) need not supply one. */
  done?: (msg: string) => void;
};

type Outcome<T> = { ok: true; previous: T | null } | { ok: false; key: "prefs.error.failed" | "common.actionCrashed" };

/** One save; a refusal is "didn't save", a throw (a stale page, a server fault) the house reload sentence. */
async function attempt<T>(save: () => Promise<PrefsResult<T>>): Promise<Outcome<T>> {
  try {
    const r = await save();
    return r.ok ? r : { ok: false, key: "prefs.error.failed" };
  } catch {
    return { ok: false, key: "common.actionCrashed" };
  }
}

/**
 * The shared shape of both changes: apply, save, revert on failure, and an
 * Undo that applies the server's `previous` at once and saves it in turn
 * (reverting to `next` if THAT save fails). `copyAt(v)` is the copy to speak
 * once `v` is the value in force — the language card's toasts change
 * language with the value; the theme card's never do.
 */
async function change<T extends string>(input: {
  next: T | null; current: T | null;
  save: (v: T | null) => Promise<PrefsResult<T>>;
  apply: (v: T | null) => void;
  copyAt: (v: T | null) => Copy;
  savedMessage: (v: T | null, copy: Copy) => string;
  toast: PrefsToast;
}): Promise<void> {
  const { next, current, save, apply, copyAt, savedMessage, toast } = input;
  if (next === current) return;
  apply(next);
  const r = await attempt(() => save(next));
  if (!r.ok) {
    apply(current);
    toast.error(copyAt(current)(r.key));
    return;
  }
  const previous = r.previous;
  const copy = copyAt(next);
  toast.success(savedMessage(next, copy), {
    label: copy("prefs.undo"),
    onClick: () => {
      apply(previous);
      void attempt(() => save(previous)).then((u) => {
        if (!u.ok) {
          apply(next);
          toast.error(copyAt(next)(u.key));
          return;
        }
        toast.done?.(copyAt(previous)("prefs.undone"));
      });
    },
  });
}

const LANGUAGE_NAME_KEY = {
  en: "prefs.languageName.english",
  es: "prefs.languageName.spanish",
} as const satisfies Record<PersonLanguage, PrefsCopyKey>;

const THEME_SAVED_KEY = {
  light: "prefs.saved.theme.light",
  dark: "prefs.saved.theme.dark",
  system: "prefs.saved.theme.system",
} as const satisfies Record<PersonTheme, PrefsCopyKey>;

export function changeLanguage(input: {
  next: PersonLanguage | null; current: PersonLanguage | null;
  save: (v: PersonLanguage | null) => Promise<PrefsResult<PersonLanguage>>;
  /** Sets the radio. The route repaints in the new language when the save lands. */
  apply: (v: PersonLanguage | null) => void;
  copyFor: (locale: Locale) => Copy;
  accountLanguage: PersonLanguage | null; toast: PrefsToast;
}): Promise<void> {
  const { copyFor, accountLanguage } = input;
  return change({
    ...input,
    // A language toast speaks the language it is about: the one just chosen,
    // the one put back, or (on a failure) the one still in force.
    copyAt: (v) => copyFor(localeOfLanguage(v, accountLanguage)),
    savedMessage: (v, copy) => {
      const language = copy(LANGUAGE_NAME_KEY[localeOfLanguage(v, accountLanguage)]);
      return v === null ? copy("prefs.saved.languageAccount", { language }) : copy("prefs.saved.language", { language });
    },
  });
}

export function changeTheme(input: {
  next: PersonTheme | null; current: PersonTheme | null;
  save: (v: PersonTheme | null) => Promise<PrefsResult<PersonTheme>>;
  /** Sets the radio, next-themes and the `bis-theme` cookie. */
  apply: (v: PersonTheme | null) => void;
  copy: Copy; toast: PrefsToast;
}): Promise<void> {
  const { copy } = input;
  return change({
    ...input,
    copyAt: () => copy,
    savedMessage: (v, c) => c(v === null ? "prefs.saved.theme.none" : THEME_SAVED_KEY[v]),
  });
}

/** Quiet time after the last radio step before the save runs (fix round 1, M1). */
export const PREFS_SAVE_DEBOUNCE_MS = 600;

/**
 * One decision, one save, one toast (Task 6 fix round 1, M1). Arrow keys in
 * a native radio group move AND select, so each step fires a change; the
 * caller applies every step at once (the radio, and the theme's look) and
 * hands it here, which commits only after `delayMs` of quiet: the LAST
 * value, against the value in force before the FIRST step, so an Undo goes
 * back past the whole burst and a burst that returns to its start is
 * changeTheme/changeLanguage's own no-op. `flush` commits a pending choice
 * now (the panel calls it on unmount, so leaving the page never drops one).
 */
export type DebouncedChoice<T> = { choose: (next: T, current: T) => void; flush: () => void };

export function debouncedChoice<T>(commit: (next: T, before: T) => void, delayMs = PREFS_SAVE_DEBOUNCE_MS): DebouncedChoice<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { next: T; before: T } | null = null;

  function fire() {
    if (timer) clearTimeout(timer);
    timer = null;
    const p = pending;
    pending = null;
    if (p) commit(p.next, p.before);
  }

  return {
    choose(next: T, current: T) {
      pending = { next, before: pending ? pending.before : current };
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    },
    flush: fire,
  };
}

/**
 * The radios are local state seeded from the server's props (final fix wave).
 * When a prop CHANGES (the topbar toggle's save lands, or another tab's save
 * arrives on a refresh), the matching radio follows it; while the props stay
 * the same, a local choice still waiting on its save is left alone. Returns
 * only the fields to reset, or null for none. The panel calls this during
 * render against the props it last saw (React's "adjust state when a prop
 * changes" pattern, no effect).
 */
export function propsResync(
  seen: PersonPrefs,
  incoming: PersonPrefs,
): { language?: PersonLanguage | null; theme?: PersonTheme | null } | null {
  const out: { language?: PersonLanguage | null; theme?: PersonTheme | null } = {};
  if (seen.language !== incoming.language) out.language = incoming.language;
  if (seen.theme !== incoming.theme) out.theme = incoming.theme;
  return "language" in out || "theme" in out ? out : null;
}

/**
 * A tab closed, or navigated away by a full page load, within the debounce
 * window never unmounts React, so the panel also flushes on `pagehide` (the
 * event that fires for both, including a page entering the back/forward
 * cache). Returns the cleanup.
 */
export function flushOnPageHide(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, flush: () => void): () => void {
  const onHide = () => flush();
  target.addEventListener("pagehide", onHide);
  return () => target.removeEventListener("pagehide", onHide);
}
