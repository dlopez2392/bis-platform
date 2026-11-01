import { Activity } from "lucide-react";
import Link from "next/link";
import { listAutomationLog, countAutomationUsage, type AutomationLogListRow } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/ui/notice";
import { buttonVariants } from "@/components/ui/button";
import { ZoneNote } from "@/components/zone-note";
import { requireNotTechnician } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { parseCursor, parseTimeCursor, encodeCursor } from "@/lib/cursor";
import { monthWindow } from "@/lib/reports/month-window";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { readLimitConfig } from "@/lib/voice/call-limits";
import { UsageCard, type UsageState } from "./usage-card";
import { ActivityTable, PAGE_SIZE } from "./activity-table";

export const dynamic = "force-dynamic";

/**
 * BOTH audiences, the Calls page's gate: this is the record of what the
 * system did on the client's behalf — the first place to look when an
 * automation misfires — not agency work about the client. Reads go through
 * the caller's client under RLS (0046 grants authenticated SELECT).
 *
 * Two independent reads, each with its own error state: a usage failure
 * must not cost the client the history, and vice versa.
 */
export default async function ActivityPage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ before?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const { before, locale: localeParam } = await searchParams;
  const { isAgency } = await requireNotTechnician(accountId);
  const db = await dbForRequest();
  const prefs = await getPersonPrefs();
  const pseudo = requestPseudoMode({ locale: localeParam });

  const account = await db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`activity: account lookup failed: ${error.message}`);
      if (!data) throw new Error("activity: account not found");
      return data as { timezone: string; language?: Locale | null };
    });
  const zone = await renderZone(account.timezone);
  const accountLanguage = { language: account.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, pseudo);

  // The cursor is TWO validated halves (the contacts list's rule): a
  // timestamp for occurred_at and a uuid for the tiebreaker. Anything else
  // reads as page one, never as an exception on a hand-editable URL.
  const raw = parseCursor(before);
  const cursor = raw && raw.v !== null && parseTimeCursor(raw.v) ? { occurredAt: raw.v, id: raw.id } : undefined;

  const month = monthWindow(new Date(), zone.zone, locale);
  const [usage, history] = await Promise.all([
    countAutomationUsage(db, accountId, month.fromIso, month.toIso)
      .then((u): UsageState => ({ ok: true, usage: u }))
      .catch((e): UsageState => { console.error(`activity ${accountId}: usage read failed: ${String(e)}`); return { ok: false }; }),
    listAutomationLog(db, accountId, { limit: PAGE_SIZE, before: cursor })
      .then((rows) => ({ ok: true as const, rows }))
      .catch((e) => { console.error(`activity ${accountId}: history read failed: ${String(e)}`); return { ok: false as const, rows: [] as AutomationLogListRow[] }; }),
  ]);

  const base = `/dashboard/accounts/${accountId}/activity`;
  const last = history.rows[history.rows.length - 1];
  const olderHref = history.ok && history.rows.length === PAGE_SIZE && last
    ? `${base}?${new URLSearchParams({ before: encodeCursor({ v: last.occurred_at, id: last.id }) })}`
    : undefined;
  const newerHref = cursor ? base : undefined;

  return (
    <>
      <PageHeader title={tr.text("activity.title")} />
      <div className="space-y-6 p-6">
        <UsageCard
          state={usage} monthLabel={month.label} callCap={readLimitConfig().perAccountPerDay}
          locale={locale} pseudo={pseudo}
        />
        <div className="space-y-3">
          <ZoneNote zone={zone} isAgency={isAgency} locale={locale} />
          {!history.ok ? (
            // A cursored page's error must not take the pager down with it —
            // without this, a client two pages deep who hits a transient
            // read failure has no way back to page one but editing the URL.
            <div className="space-y-3">
              <Notice tone="crit" role="alert">{tr.text("activity.error")}</Notice>
              {newerHref ? (
                <nav className="flex justify-end" aria-label={tr.text("activity.pagesLabel")}>
                  <Link href={newerHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{tr.text("activity.newer")}</Link>
                </nav>
              ) : null}
            </div>
          ) : history.rows.length === 0 && !cursor ? (
            // Cold start: page one and nothing behind it. A cursored zero
            // (older than everything) renders the headers and a Newer link.
            // DESIGN.md rule 5: an empty state sells the feature with the
            // ACTION that causes it — only the agency can act on this one,
            // since Automations is agency-only (nav-groups.ts); this page
            // itself is BOTH audiences, so the body sentence still needs
            // its own second-person version for the client's reading.
            <EmptyState
              icon={Activity}
              title={tr.text("activity.empty.title")}
              body={tr.text(isAgency ? "activity.empty.body" : "activity.empty.clientBody")}
              action={isAgency
                ? <Link href={`/dashboard/accounts/${accountId}/automations`} className={buttonVariants({ size: "sm" })}>{tr.text("activity.empty.action")}</Link>
                : undefined}
            />
          ) : (
            <ActivityTable
              rows={history.rows} timezone={zone.zone} olderHref={olderHref} newerHref={newerHref}
              locale={locale} pseudo={pseudo}
            />
          )}
        </div>
      </div>
    </>
  );
}
