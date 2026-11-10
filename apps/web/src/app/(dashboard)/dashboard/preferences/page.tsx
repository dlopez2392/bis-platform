import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  isPersonLanguageValue, serviceDb, readMyOwnerLineEnrollment, readOwnerLineSwitch, readAccountTimezone,
  OWNER_LINE_VERIFY_MINUTES, type PersonLanguage,
} from "@bis/db";
import type { AppClaims } from "@/lib/auth";
import { THEME_COOKIE } from "@/lib/branding/theme-mode";
import { getTenantAccessState, getTenantThemeInputs, pickRequestThemeMode } from "@/lib/branding/tenant-theme-reader";
import { resolveLocale, type Locale } from "@/lib/i18n/locale";
import { requestPseudoMode } from "@/lib/i18n/request-locale";
import { loggableError } from "@/lib/loggable-error";
import { loadMyPreferences } from "@/lib/preferences/person-prefs";
import { listMyMemberships, type MyMembership } from "@/lib/owner-line/memberships";
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import { ownerLineCardApplies, ownerLineCardView, nationalNumber } from "@/components/owner-line/owner-line-view";
import { OwnerLineCard } from "@/components/owner-line/owner-line-card";
import { OwnerLineCardError } from "@/components/owner-line/owner-line-card-error";
import {
  startOwnerLineVerificationAction, setOwnerLinePinAction, removeOwnerLinePinAction, removeOwnerLineCellAction,
} from "./owner-line-actions";
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
 *
 * F-032 Task 6: one "Call in to your business" card per qualifying membership, below the two preference cards.
 * A membership qualifies (`ownerLineCardApplies`, Task 6 brief's must #1 / Task 5 review m-3) when its role is
 * one the owner line is offered to (`OWNER_LINE_ROLES`) OR it already holds an enrolment to remove — so a role
 * demoted out of `OWNER_LINE_ROLES` (Staff -> Technician) still gets to stop calling in from a cell it already
 * claimed, and a role that was never offered and never enrolled gets no card at all. That is why every
 * membership's enrolment is read BEFORE any role filter runs, not after (a pre-filter by role alone would hide
 * the demoted member's card along with it).
 *
 * Impersonation (owner ruling 2026-11-09, REFUSED): a session carrying Clerk's `actor` (BIS staff signed in as a
 * client) gets NO owner-line section and makes no owner-line read at all, not even the memberships, the same rule
 * every setup action's `member()` enforces. BIS enters a client account only through the logged agency path.
 *
 * Each card fails on its own (DESIGN rule 5 extended to the card; design review Critical 1): one business's failed
 * read is logged by account id and shows that card's error state, and a failed memberships read shows one error
 * state in the cards' place. The preference cards above never depend on any of it.
 *
 * `?locale=pseudo` (QA only, `requestPseudoMode`) reaches the cards, the way team/page.tsx wires it, so their copy
 * can be checked at +35% length.
 */
type OwnerLineSlot =
  | { kind: "card"; mb: MyMembership; view: ReturnType<typeof ownerLineCardView> }
  | { kind: "error"; mb: MyMembership | null };

async function ownerLineSlot(db: ReturnType<typeof serviceDb>, mb: MyMembership, locale: Locale): Promise<OwnerLineSlot | null> {
  try {
    const [enrollment, sw, zoneRead] = await Promise.all([
      readMyOwnerLineEnrollment(db, mb.accountId, mb.userId),
      readOwnerLineSwitch(db, mb.accountId),
      readAccountTimezone(db, mb.accountId),
    ]);
    const offered = OWNER_LINE_ROLES.includes(mb.role);
    if (!ownerLineCardApplies(offered, enrollment !== null)) return null;
    // readAccountTimezone answers string | null (DB/automation-settings.ts:13-17); null is the column default's zone.
    const zone = zoneRead ?? "America/Chicago";
    return {
      kind: "card", mb,
      view: ownerLineCardView({ enrollment, switchOn: sw.enabledAt !== null, number: mb.number, now: new Date(), zone, locale, offered }),
    };
  } catch (e) {
    console.error(`preferences: owner-line card read failed, accountId ${mb.accountId}: ${loggableError(e)}`);
    return { kind: "error", mb };
  }
}

export default async function PreferencesPage({
  searchParams,
}: { searchParams?: Promise<{ locale?: string }> } = {}) {
  const { userId, sessionClaims, actor } = await auth();
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
  const locale = resolveLocale(prefs.language, accountLanguage);
  const pseudo = requestPseudoMode((await searchParams) ?? {});

  // The agency has no account memberships at all, so it never gets a card (the feature is for a business's own
  // team). listMyMemberships already drops a business with client access off or archived (memberships.test.ts),
  // so neither path below can ever reach one of those — "Stop calling in" there would read the odd notMember
  // text, and this is why it never renders in the first place.
  // An impersonation session reads nothing of the owner line (owner ruling 2026-11-09), so it is decided first.
  let slots: OwnerLineSlot[] = [];
  if (!actor) {
    const db = serviceDb();
    let memberships: MyMembership[] | null;
    try {
      memberships = isAgency ? [] : await listMyMemberships(db, userId);
    } catch (e) {
      console.error(`preferences: owner-line memberships read failed: ${loggableError(e)}`);
      memberships = null;
    }
    slots = memberships === null
      ? [{ kind: "error", mb: null }]
      : (await Promise.all(memberships.map((mb) => ownerLineSlot(db, mb, locale)))).filter((c): c is OwnerLineSlot => c !== null);
  }

  return (
    <div data-prefs-page>
      <PreferencesPanel
        isAgency={isAgency}
        prefs={prefs}
        accountLanguage={accountLanguage}
        themeFallback={themeFallback}
        seenMode={seenMode}
      />
      {slots.length > 0 ? (
        <section id="owner-line" lang={locale} className="max-w-3xl space-y-4 px-6 pb-6">
          {slots.map((slot) => slot.kind === "error" ? (
            <OwnerLineCardError key={slot.mb?.accountId ?? "all"} accountId={slot.mb?.accountId}
              businessName={slot.mb?.businessName} locale={locale} pseudo={pseudo} />
          ) : (
            <OwnerLineCard key={slot.mb.accountId} accountId={slot.mb.accountId} businessName={slot.mb.businessName}
              number={nationalNumber(slot.mb.number)} view={slot.view} locale={locale} pseudo={pseudo}
              verifyMinutes={OWNER_LINE_VERIFY_MINUTES}
              startVerification={startOwnerLineVerificationAction.bind(null, slot.mb.accountId, locale)}
              setPin={setOwnerLinePinAction.bind(null, slot.mb.accountId, locale)}
              removePin={removeOwnerLinePinAction.bind(null, slot.mb.accountId, locale)}
              removeCell={removeOwnerLineCellAction.bind(null, slot.mb.accountId, locale)} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
