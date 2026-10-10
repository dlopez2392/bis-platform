import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { isPersonLanguageValue, type PersonLanguage } from "@bis/db";
import type { AppClaims } from "@/lib/auth";
import { THEME_COOKIE } from "@/lib/branding/theme-mode";
import { getTenantAccessState, getTenantThemeInputs, pickRequestThemeMode } from "@/lib/branding/tenant-theme-reader";
import { loadMyPreferences } from "@/lib/preferences/person-prefs";
import { PreferencesPanel } from "@/components/preferences/preferences-panel";

export const dynamic = "force-dynamic";

/**
 * Mis preferencias (F-096, spec §6): a person's own language and theme,
 * reached from the user menu and ⌘K. Under /dashboard because proxy.ts
 * protects /dashboard(.*) and dashboard/layout.tsx supplies the chrome and
 * the LocaleProvider (plan departure 1).
 *
 * `loadMyPreferences` THROWS on a failed read, so error.tsx shows "we
 * couldn't load" instead of radios that pretend nothing was chosen. The
 * other reads are the request-cached ones the layouts already made, so this
 * page adds one users read at most.
 *
 * The two theme answers for "no choice" come from the SAME resolver the root
 * layout uses (pickRequestThemeMode with userTheme null): `seenMode` with
 * the cookie as it stands (what the person sees now), `themeFallback` with
 * no cookie (what an Undo back to NULL lands on, since that clears it).
 */
export default async function PreferencesPage() {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const isAgency = (sessionClaims as AppClaims | null)?.app_role === "agency_admin";

  const [prefs, state, inputs, cookieStore] = await Promise.all([
    loadMyPreferences(),
    getTenantAccessState(),
    getTenantThemeInputs(),
    cookies(),
  ]);

  let accountLanguage: PersonLanguage | null = null;
  if (!isAgency && state.status === "ok") {
    accountLanguage = isPersonLanguageValue(state.language) ? state.language : "en";
  }
  const seenMode = pickRequestThemeMode(cookieStore.get(THEME_COOKIE)?.value, inputs, isAgency, null).providerDefault;
  const themeFallback = pickRequestThemeMode(undefined, inputs, isAgency, null).providerDefault;

  return (
    <div data-prefs-page>
      <PreferencesPanel
        isAgency={isAgency}
        prefs={prefs}
        accountLanguage={accountLanguage}
        themeFallback={themeFallback}
        seenMode={seenMode}
      />
    </div>
  );
}
