import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

export type BriefOffState = "ask" | "off" | "bad_link" | "failed";

const KEY = { ask: "briefOff.ask", off: "briefOff.off", bad_link: "briefOff.badLink", failed: "briefOff.failed" } as const;

/**
 * The /brief/off page's words, English and Spanish STACKED: the token carries no language and nobody is signed in,
 * so there is no reader language to resolve (the /u page's own situation; ENGLISH_ONLY_READERS names this file for
 * that reason). Every read of the page is in this one file so that exception stays one line.
 */
export function briefOffLines(state: BriefOffState): { titleEn: string; titleEs: string; detailEn: string; detailEs: string } {
  const key = KEY[state];
  return {
    titleEn: t(m, `${key}.title`, "en"), titleEs: t(m, `${key}.title`, "es"),
    detailEn: t(m, `${key}.detail`, "en"), detailEs: t(m, `${key}.detail`, "es"),
  };
}

/** The page chrome that is not a state's own lines: the tab title, the one button, the link back to Preferences. */
export function briefOffChrome(): { pageTitle: string; button: string; preferencesLink: string } {
  return {
    pageTitle: `${t(m, "briefOff.pageTitle", "en")} / ${t(m, "briefOff.pageTitle", "es")}`,
    button: `${t(m, "briefOff.button", "en")} / ${t(m, "briefOff.button", "es")}`,
    preferencesLink: `${t(m, "briefOff.preferencesLink", "en")} / ${t(m, "briefOff.preferencesLink", "es")}`,
  };
}
