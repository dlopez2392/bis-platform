import Link from "next/link";
import { readAccessLogPage, ACCESS_LOG_PAGE_SIZE } from "@bis/db";
import { buttonVariants } from "@/components/ui/button";
import { dbForRequest } from "@/lib/db";
import { loggableError } from "@/lib/loggable-error";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr, type Tr } from "@/lib/record/copy";
import { renderZone } from "@/lib/zone";
import { resolveAccessLogNames } from "@/lib/access-log/names";
import { buildVisitRows, encodeAccessCursor, parseAccessCursor, type VisitRowView } from "@/lib/access-log/view";
import { BisAccessError } from "./bis-access-error";
import { BisAccessList } from "./bis-access-list";

type Result =
  | { kind: "empty"; tr: Tr }
  | { kind: "loaded"; tr: Tr; total: number; rows: VisitRowView[]; olderHref: string | null; newerHref: string | null };

/**
 * F-118 part 1 (plan Task 10; spec 6.1-6.3): the "BIS access" section's own data, read on the READER's
 * request client only — `access_log_page` and the name lookups are RLS-bounded (the agency or this
 * account's Owner), the same seam `readAccessLogPage` itself documents. Runs inside the Team page's
 * `BisAccessFrame`/`Suspense` pair, below `TeamSection`.
 *
 * One `try`, around every READ only — never around the JSX it returns (`react-hooks/error-boundaries`:
 * a component's own try/catch cannot catch a rendering error, only a thrown read). Any failed read
 * anywhere in the pipeline — the account row, the person's own prefs, the visits page, or the name
 * lookup — renders `BisAccessError` instead of throwing, so a broken log never costs the Team card
 * above it (rule 5 extended to the card). A page with no visits at all (`page.total === 0`, the real
 * total, never the current page's row count) renders the empty sentence instead of the list and pager.
 *
 * `accessBefore` is this card's OWN cursor (never another card's `?before=`): `null`/garbage reads as
 * page one (`parseAccessCursor`'s contract). "Newer" only renders when a cursor was actually given, and
 * it drops the cursor entirely rather than walking back one page at a time — the same "return to the
 * head" idiom `ACCT/conversations/page.tsx` uses for its own pager.
 */
export async function BisAccessSection(
  { accountId, isAgency, before }: { accountId: string; isAgency: boolean; before?: string },
) {
  const base = `/dashboard/accounts/${accountId}`;
  let result: Result;
  try {
    const db = await dbForRequest();
    const [account, prefs] = await Promise.all([
      db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
      getPersonPrefs(),
    ]);
    if (account.error) throw new Error(`account read failed: ${account.error.message}`);
    const accountRow = account.data as { timezone: string | null; language: Locale | null } | null;
    // A named variable, not an inline literal (house style; request-locale-callers.test.ts's shape,
    // though this file is under components/ and outside that scanner's app/ scope).
    const accountLanguage = { language: accountRow?.language ?? null };
    const locale = requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language });
    const tr = makeTr(locale);
    const zone = await renderZone(accountRow?.timezone ?? undefined);
    const cursor = parseAccessCursor(before);
    const page = await readAccessLogPage(db, accountId, cursor, ACCESS_LOG_PAGE_SIZE);

    if (page.total === 0) {
      result = { kind: "empty", tr };
    } else {
      const names = await resolveAccessLogNames(db, accountId, page);
      const rows = buildVisitRows(page, names, { tr, zone: zone.zone, base });
      const last = page.visits[page.visits.length - 1];
      const olderHref = page.hasOlder && last
        ? `${base}/team?${new URLSearchParams({ accessBefore: encodeAccessCursor(last) })}#bis-access`
        : null;
      // Newer returns to the head of the SAME list, dropping the cursor — it never appears on page one.
      const newerHref = cursor ? `${base}/team#bis-access` : null;
      result = { kind: "loaded", tr, total: page.total, rows, olderHref, newerHref };
    }
  } catch (e) {
    console.error(`bis access: account ${accountId}: ${loggableError(e)}`);
    return <BisAccessError />;
  }

  if (result.kind === "empty") {
    return <p className="text-sm text-[var(--text-2)]">{result.tr.text("accessLog.empty")}</p>;
  }
  return (
    <div className="space-y-3">
      <p className="tabular-nums text-sm font-medium text-[var(--text-1)]">{result.tr.count("accessLog.total", result.total)}</p>
      <BisAccessList rows={result.rows} />
      {result.olderHref || result.newerHref ? (
        <nav aria-label={result.tr.text("accessLog.pager.label")} className="flex justify-end gap-2">
          {result.newerHref ? (
            <Link href={result.newerHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {result.tr.text("accessLog.pager.newer")}
            </Link>
          ) : null}
          {result.olderHref ? (
            <Link href={result.olderHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {result.tr.text("accessLog.pager.older")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
