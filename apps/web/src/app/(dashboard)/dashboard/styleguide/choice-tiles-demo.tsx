"use client";

import { useState } from "react";
import type { PersonTheme } from "@bis/db";
import { ChoiceTiles } from "@/components/choice-tiles";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { m } from "@/lib/messages";
import { THEME_CHOICES } from "@/lib/preferences/preference-options";

/**
 * ChoiceTiles (components/choice-tiles.tsx), the Preferences page's radio
 * group: a client component of its own because the tiles are controlled and
 * this styleguide page is a server component (rail-states.tsx's reasoning).
 * Two states side by side: nothing chosen yet, with the empty hint, in
 * English; and a choice made, in Spanish, the longer of the two languages.
 * Tab into a group and use the arrows to see the focus ring.
 */
const LABEL = { light: "prefs.theme.light", dark: "prefs.theme.dark", system: "prefs.theme.system" } as const;

function Demo({ locale, initial, name }: { locale: Locale; initial: PersonTheme | null; name: string }) {
  const [value, setValue] = useState<PersonTheme | null>(initial);
  return (
    <ChoiceTiles<PersonTheme>
      name={name}
      legend={t(m, "prefs.theme.legend", locale)}
      options={THEME_CHOICES.map((c) => ({ value: c, label: t(m, LABEL[c], locale) }))}
      value={value}
      onChange={setValue}
      hint={value === null ? t(m, "prefs.theme.empty", locale, { mode: t(m, "prefs.mode.dark", locale) }) : undefined}
    />
  );
}

export function ChoiceTilesDemo() {
  return (
    <div className="grid w-full gap-6 lg:grid-cols-2">
      <div lang="en"><Demo locale="en" initial={null} name="sg-choice-en" /></div>
      <div lang="es"><Demo locale="es" initial="system" name="sg-choice-es" /></div>
    </div>
  );
}
