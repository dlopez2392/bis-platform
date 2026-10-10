"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import type { PersonLanguage, PersonPrefs, PersonTheme } from "@bis/db";
import { setMyLanguageAction, setMyThemeAction } from "@/app/(dashboard)/dashboard/preferences/actions";
import { ChoiceTiles } from "@/components/choice-tiles";
import { useLocale } from "@/components/locale-provider";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { THEME_COOKIE } from "@/lib/branding/theme-mode";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language-options";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { m } from "@/lib/messages";
import {
  languageChoicesFor, languageChoiceFrom, languageValueOf, localeOfLanguage, THEME_CHOICES, themeCookieFor,
  type LanguageChoice,
} from "@/lib/preferences/preference-options";
import type { PrefsResult } from "@/lib/preferences/save";
import {
  changeLanguage, changeTheme, debouncedChoice, flushOnPageHide, propsResync, PREFS_TOAST_MS,
  type DebouncedChoice, type PrefsCopyKey, type PrefsToast,
} from "./preference-handlers";

type Mode = "light" | "dark" | "system";

const copyIn = (locale: Locale) => (key: PrefsCopyKey, params?: Record<string, string>) => t(m, key, locale, params);

const prefsToast: PrefsToast = {
  success: (msg, undo) => { toast.success(msg, { duration: PREFS_TOAST_MS, action: undo }); },
  error: (msg) => { toast.error(msg); },
  done: (msg) => { toast.success(msg); },
};

const THEME_LABEL_KEY = {
  light: "prefs.theme.light",
  dark: "prefs.theme.dark",
  system: "prefs.theme.system",
} as const satisfies Record<PersonTheme, PrefsCopyKey>;

/**
 * Mis preferencias (F-096, spec §6): two independent cards, Language and
 * Theme, each a radio group that applies AT ONCE and saves behind it with an
 * Undo toast (DESIGN.md rule 6). No form and no Save anywhere (rule 8: each
 * card is its own view, and neither has a button to press).
 *
 * `apply` is LOCAL only: the radio, plus next-themes and the `bis-theme`
 * cookie for the theme. The route repaints when the save LANDS (the
 * action's revalidatePath, and the `router.refresh()` in `savedThen` below),
 * never before it: a refresh that ran ahead of the save would render the
 * OLD stored theme, and ThemeCookieSync's userThemeSyncPlan would then flip
 * the page straight back to it until the save arrived.
 *
 * `themeFallback` is what next-themes falls back to when an Undo returns to
 * "no choice" (NULL): the login's default with no cookie, which is exactly
 * what the server paints once `themeCookieFor(null)` has cleared the cookie.
 * `seenMode` is what a person with no choice is looking at right now (the
 * cookie included), for the empty-state hint.
 *
 * Each step applies AT ONCE (arrow keys move the radio, and the theme's
 * look follows), but the save and its toast wait for a pause
 * (debouncedChoice, fix round 1 M1): one decision, one save, one toast. The
 * commit runs through a ref holding this render's handler, so it sees the
 * current locale and router; a choice still pending on unmount or on
 * `pagehide` (a closed tab never unmounts) is flushed.
 */
export function PreferencesPanel({
  isAgency,
  prefs,
  accountLanguage,
  themeFallback,
  seenMode,
}: {
  isAgency: boolean;
  prefs: PersonPrefs;
  /** A client's account language; null for the agency, which has no account to follow. */
  accountLanguage: PersonLanguage | null;
  themeFallback: Mode;
  seenMode: Mode;
}) {
  const locale = useLocale();
  const router = useRouter();
  const { setTheme } = useTheme();
  const [language, setLanguage] = useState<PersonLanguage | null>(prefs.language);
  const [theme, setThemeChoice] = useState<PersonTheme | null>(prefs.theme);
  // Follow the server when its value CHANGES (the topbar toggle, another
  // tab), never while it stays the same: a pending local choice is kept.
  const [seenPrefs, setSeenPrefs] = useState<PersonPrefs>(prefs);
  const resync = propsResync(seenPrefs, prefs);
  if (resync) {
    setSeenPrefs(prefs);
    if ("language" in resync) setLanguage(resync.language ?? null);
    if ("theme" in resync) setThemeChoice(resync.theme ?? null);
  }
  const copy = copyIn(locale);

  const commitLanguage = useRef<(next: PersonLanguage | null, before: PersonLanguage | null) => void>(() => {});
  const commitTheme = useRef<(next: PersonTheme | null, before: PersonTheme | null) => void>(() => {});
  // Created on the first step, in the event handler (refs are not read during render).
  const steps = useRef<{ language?: DebouncedChoice<PersonLanguage | null>; theme?: DebouncedChoice<PersonTheme | null> }>({});

  function languageStep(next: PersonLanguage | null, current: PersonLanguage | null) {
    const s = steps.current;
    (s.language ??= debouncedChoice((n, b) => commitLanguage.current(n, b))).choose(next, current);
  }
  function themeStep(next: PersonTheme | null, current: PersonTheme | null) {
    const s = steps.current;
    (s.theme ??= debouncedChoice((n, b) => commitTheme.current(n, b))).choose(next, current);
  }

  function savedThen<T>(action: (v: T | null) => Promise<PrefsResult<T>>) {
    return async (v: T | null) => {
      const r = await action(v);
      if (r.ok) router.refresh();
      return r;
    };
  }

  function applyTheme(v: PersonTheme | null) {
    setThemeChoice(v);
    const cookie = themeCookieFor(v, window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.cookie = cookie
      ? `${THEME_COOKIE}=${cookie}; path=/; max-age=31536000; samesite=lax`
      : `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
    setTheme(v ?? themeFallback);
  }

  useEffect(() => {
    commitLanguage.current = (next, before) =>
      void changeLanguage({
        next,
        current: before,
        save: savedThen<PersonLanguage>(setMyLanguageAction),
        apply: setLanguage,
        copyFor: copyIn,
        accountLanguage,
        toast: prefsToast,
      });
    commitTheme.current = (next, before) =>
      void changeTheme({
        next,
        current: before,
        save: savedThen<PersonTheme>(setMyThemeAction),
        apply: applyTheme,
        copy,
        toast: prefsToast,
      });
  });
  useEffect(() => {
    const s = steps.current;
    const flushAll = () => { s.language?.flush(); s.theme?.flush(); };
    const detach = flushOnPageHide(window, flushAll);
    return () => { detach(); flushAll(); };
  }, []);

  const languageOptions = languageChoicesFor(isAgency).map((choice) => ({
    value: choice,
    label: choice === "account"
      ? copy("prefs.language.account")
      : LANGUAGE_OPTIONS.find((o) => o.value === choice)!.label,
  }));
  const accountLocale = localeOfLanguage(null, accountLanguage);
  const languageHint = isAgency
    ? (language === null ? copy("prefs.language.agencyEmpty") : undefined)
    : copy("prefs.language.accountHint", {
        language: copy(accountLocale === "es" ? "prefs.languageName.spanish" : "prefs.languageName.english"),
      });

  const themeOptions = THEME_CHOICES.map((choice) => ({ value: choice, label: copy(THEME_LABEL_KEY[choice]) }));
  const themeHint = theme !== null
    ? undefined
    : seenMode === "system"
      ? copy("prefs.theme.emptyDevice")
      : copy("prefs.theme.empty", { mode: copy(seenMode === "dark" ? "prefs.mode.dark" : "prefs.mode.light") });

  return (
    <div lang={locale}>
      <PageHeader title={copy("prefs.title")} subtitle={copy("prefs.intro")} />
      <div className="grid max-w-3xl gap-4 p-6">
        <Card data-prefs-card="language">
          <CardContent>
            <ChoiceTiles<LanguageChoice>
              name="prefs-language"
              legend={copy("prefs.language.legend")}
              options={languageOptions}
              value={languageChoiceFrom(language, isAgency)}
              hint={languageHint}
              onChange={(choice) => {
                const next = languageValueOf(choice);
                setLanguage(next);
                languageStep(next, language);
              }}
            />
          </CardContent>
        </Card>
        <Card data-prefs-card="theme">
          <CardContent>
            <ChoiceTiles<PersonTheme>
              name="prefs-theme"
              legend={copy("prefs.theme.legend")}
              options={themeOptions}
              value={theme}
              hint={themeHint}
              onChange={(choice) => {
                applyTheme(choice);
                themeStep(choice, theme);
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Shaped like the loaded page (rule 7, no spinners): the header, then two cards of three tiles each. */
export function PreferencesSkeleton() {
  const locale = useLocale();
  return (
    <div aria-busy="true" aria-label={t(m, "prefs.title", locale)}>
      <div className="space-y-2 px-6 pt-[22px]">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid max-w-3xl gap-4 p-6">
        {[0, 1].map((card) => (
          <Card key={card}>
            <CardContent className="space-y-3">
              <Skeleton className="h-3 w-20" />
              <div className="grid gap-2 sm:grid-cols-3">
                {[0, 1, 2].map((tile) => (
                  <Skeleton key={tile} className="h-11 rounded-[var(--radius-ctl)]" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
