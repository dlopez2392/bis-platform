import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { TeamSkeleton } from "@/components/team/team-card";
import { TeamSection } from "@/components/team/team-section";
import { BisAccessFrame } from "@/components/access-log/bis-access-frame";
import { BisAccessSection } from "@/components/access-log/bis-access-section";
import { BisAccessSkeleton } from "@/components/access-log/bis-access-skeleton";
import { requireAccountOwner } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { t } from "@/lib/i18n/t";
import { requestLocale } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { loggableError } from "@/lib/loggable-error";
import { m } from "@/lib/messages";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";

export const dynamic = "force-dynamic";

/**
 * The Team page (staff and roles, spec §8): the client Owner's own place to
 * run their team, reached from the sidebar's pinned footer and the ⌘K
 * palette (Task 8). It becomes the client's Ajustes page when F-096's part
 * lands. The agency reaches it too, from the palette, and sees the same card
 * it has under Settings' Client access switch, gated the same way: with
 * client access off, the access-off note instead of an Invite (TeamSection).
 *
 * requireAccountOwner is the FIRST call: it admits the agency and a client
 * Owner and sends a Staff to their dashboard (never a 403). Every Team action
 * repeats the same guard; hiding the footer link is convenience. The same
 * guard is what gates BIS access below: Staff and a Technician never even
 * reach this page, and the agency only reaches it on a live visit
 * (`requireAgencyVisit`, inside `requireAccountAccess`).
 *
 * S-10 T6: the page itself reads ONE column (`language`) off the account
 * row, for its own chrome locale — TeamSection separately reads the whole
 * row (organisation, access, language) for the team data, and streams in
 * its own boundary, because it waits on Clerk. A failed read of the
 * page's own column is logged and falls back to no account language
 * (English, absent the person's own choice) — never thrown — so a broken
 * read never costs the header or the card below it (same shape as
 * branding/page.tsx's own account-language read).
 *
 * F-118 part 1 (plan Task 10; spec 6.1): below TeamSection, the "BIS access"
 * section — every visit BIS has made to this account, its reason and what it
 * opened — lives in its OWN frame (`BisAccessFrame`) and its OWN Suspense,
 * reading its OWN data (`BisAccessSection`). A failed log read never costs
 * the Team card above it (rule 5 extended to the card). `accessBefore` is
 * this section's OWN cursor, named apart from any other card's `?before=`.
 */
export default async function TeamPage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams?: Promise<{ accessBefore?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const { isAgency } = await requireAccountOwner(accountId);
  const { accessBefore, locale: localeParam } = (await searchParams) ?? {};
  // S-10 T6: the page itself read no locale at all; its title/subtitle and
  // everything TeamSection renders (the card, or either of its non-card
  // states) stayed English regardless of the reader's own stored choice.
  // Same pattern as billing/page.tsx and branding/page.tsx: one more read
  // off the account row this navigation already needs, beside the person's
  // own preference.
  const [account, prefs] = await Promise.all([
    dbForRequest().then((db) => db.from("accounts").select("language").eq("id", accountId).maybeSingle())
      .then(({ data, error }: { data: { language?: Locale | null } | null; error: unknown }) => {
        // Fail SOFT, like branding/page.tsx's own account-language read: a
        // broken read here must not cost the header or the Team card below
        // it, so it logs and falls back rather than throwing into the
        // Promise.all (which would replace the whole page with the error
        // boundary for a column this page does not even need to function).
        if (error) console.error(`team page: account ${accountId} language read failed: ${loggableError(error)}`);
        return { language: (data?.language ?? null) as Locale | null };
      }),
    getPersonPrefs(),
  ]);
  const locale = requestLocale({ account, isOperator: isAgency, userLanguage: prefs.language }, { locale: localeParam });
  return (
    <>
      <PageHeader title={t(m, "team.title", locale)} subtitle={t(m, "team.page.subtitle", locale)} />
      <div className="p-6">
        <Suspense fallback={<TeamSkeleton locale={locale} />}>
          <TeamSection accountId={accountId} viewer={isAgency ? "agency" : "owner"} locale={locale} />
        </Suspense>
        <BisAccessFrame>
          <Suspense fallback={<BisAccessSkeleton />}>
            <BisAccessSection accountId={accountId} isAgency={isAgency} before={accessBefore} qaLocale={localeParam} />
          </Suspense>
        </BisAccessFrame>
      </div>
    </>
  );
}
