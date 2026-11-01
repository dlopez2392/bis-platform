import Link from "next/link";
import { Globe } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireNotTechnician } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { loadWebsiteState } from "@/lib/website/load";
import { parsePeriod, type Period } from "@/lib/website/view-model";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { WebsiteSection } from "./website-section";
import { WebsiteSkeleton } from "./loading";

export const dynamic = "force-dynamic";

const PERIODS: Period[] = [7, 14, 30];
const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

/** Three links, not a client component: the period is a search param, so the
 *  page stays a server component and the switch works without JavaScript. */
function PeriodSwitch({ base, period, locale, tr }: { base: string; period: Period; locale: Locale; tr: Tr }) {
  return (
    <nav lang={locale} aria-label={tr.text("website.periodNav")} className="flex gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-1)] p-[3px]">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`${base}/website?period=${p}`}
          aria-current={p === period ? "true" : undefined}
          className={
            p === period
              ? "pill-on rounded-full px-3 py-1 font-mono text-[11px] font-medium tracking-[0.06em]"
              : "rounded-full px-3 py-1 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground hover:bg-[var(--surface-3)]"
          }
        >
          {tr.text(`website.period.${p}` as const)}
        </Link>
      ))}
    </nav>
  );
}

export default async function WebsitePage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ period?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const sp = await searchParams;
  // [accountId]/layout.tsx admitted the caller to this account; THIS call is
  // the Technician boundary for Website (F-085 part 1, spec §7.1), sending a
  // Technician, or a client whose role could not be settled, to To do before
  // anything is read. Its isAgency decides the unlinked state's single action.
  const { isAgency } = await requireNotTechnician(accountId);
  const db = await dbForRequest();
  const period = parsePeriod(sp.period);
  const base = `/dashboard/accounts/${accountId}`;
  // S-10 T2 (spec §3.1 row 13: "no locale on the page" today). Same shape as
  // documents/page.tsx: a dedicated small account read, in parallel with
  // getPersonPrefs() (already cache()d per request, so this adds no second
  // call to IT).
  const [prefs, account] = await Promise.all([
    getPersonPrefs(),
    db.from("accounts").select("language").eq("id", accountId).maybeSingle(),
  ]);
  if (account.error) console.error(`website page: account ${accountId} language read failed: ${account.error.message}`);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: (account.data as { language: Locale | null } | null)?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language }, { locale: sp.locale });
  const tr = makeTr(locale, requestPseudoMode({ locale: sp.locale }));
  const result = await loadWebsiteState(db, accountId, period, new Date(), locale);

  if (result.state === "unlinked") {
    return (
      <div lang={locale}>
        <PageHeader title={tr.text("website.title")} />
        <div className="p-6">
          <EmptyState
            icon={Globe}
            title={tr.text("website.empty.title")}
            body={tr.text("website.empty.body")}
            action={isAgency ? (
              <Button asChild><Link href={`${base}/settings#website`}>{tr.text("website.empty.link")}</Link></Button>
            ) : (
              <Button asChild>
                <a href={`mailto:${process.env.AGENCY_SUPPORT_EMAIL ?? "hello@bis-rgv.com"}?subject=${encodeURIComponent(tr.text("website.empty.askSubject"))}`}>
                  {tr.text("website.empty.askAgency")}
                </a>
              </Button>
            )}
          />
        </div>
      </div>
    );
  }

  if (result.state === "waiting") {
    return (
      <div lang={locale}>
        <PageHeader title={tr.text("website.title")} actions={<PeriodSwitch base={base} period={period} locale={locale} tr={tr} />} />
        <div className="space-y-3 p-6">
          {/* The one card on this route the fidelity pass missed — and it is
              the first thing a newly linked site shows. It is the sentence
              panel's twin, so it takes the sentence panel's display role
              (24px at 600, not 18px at 650). */}
          <div className="rounded-xl border border-border bg-card glass px-[22px] py-[18px]">
            <p className={LABEL}>{tr.text(`website.periodLabel.${period}` as const)}</p>
            <p className="mt-2 font-display text-[24px] font-[600] leading-[1.15] tracking-[-0.02em] text-card-foreground">{tr.text("website.waiting.title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{tr.text("website.waiting.body", { domain: result.domain })}</p>
          </div>
          <WebsiteSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div lang={locale}>
      <PageHeader title={tr.text("website.title")} actions={<PeriodSwitch base={base} period={period} locale={locale} tr={tr} />} />
      <WebsiteSection view={result.view} locale={locale} pseudo={requestPseudoMode({ locale: sp.locale })} />
    </div>
  );
}
