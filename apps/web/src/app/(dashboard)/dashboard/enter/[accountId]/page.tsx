import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AGENCY_VISIT_REASONS, type AgencyVisitReason } from "@bis/db";
import { requireAgency, accountHome } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { safeReturnPath } from "@/lib/access-log/paths";
import { agencyVisitOk } from "@/lib/access-log/gate";
import { lastVisitEndedRecently } from "@/lib/access-log/visit";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { makeTr } from "@/lib/record/copy";
import type { MessageKey } from "@/lib/messages";
import { PageHeader } from "@/components/page-header";
import { ReasonTiles } from "@/components/access-log/reason-tiles";
import { VisitBounce } from "@/components/access-log/visit-bounce";
import { buttonVariants } from "@/components/ui/button";
import { startVisitAction } from "./actions";

export const dynamic = "force-dynamic";

const REASON_LABEL_KEY = {
  setup: "accessLog.reason.setup",
  support: "accessLog.reason.support",
  fix: "accessLog.reason.fix",
  billing: "accessLog.reason.billing",
} as const satisfies Record<AgencyVisitReason, MessageKey>;

/**
 * The reason chooser (F-118 part 1, spec 3.2): the one thing standing between an agency sign-in and any
 * account's data. Outside `ACCT/` on purpose — under it, its own layout would call the gate and loop, and
 * `ACCOUNT_ROUTE_RE` would make the shell fetch the account's counts (spec 3.2). Guarded by
 * `requireAgency()` alone; the account's `name` read here is the agency's own label, shown only on this,
 * the agency's own surface (never on an Owner's).
 *
 * `to` is the in-account path the proxy recorded on the way in (`x-bis-path`, carried here as `?to=`), and
 * it is re-validated through `safeReturnPath` both on an already-live visit (the VisitBounce, below)
 * and inside `startVisitAction` after a tile is chosen — never trusted from the query string on its own.
 */
export default async function EnterPage({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams?: Promise<{ to?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const { to: toParam, locale: qaLocale } = (await searchParams) ?? {};
  const { userId } = await requireAgency();
  if (!isUuid(accountId)) notFound();
  const back = safeReturnPath(toParam, accountId);
  const { sessionId } = await auth();
  if (await agencyVisitOk(accountId, userId, sessionId)) {
    // Never redirect() here (the router-cache loop, 2026-10-30): a render-time redirect cannot purge this
    // tab's client router cache, which may still hold prefetched "go to the chooser" answers for the
    // account's routes from before the visit (started in another tab) existed. The bounce hard-navigates.
    const { language } = await getPersonPrefs();
    const tr = makeTr(requestLocale({ account: null, isOperator: true, userLanguage: language }, { locale: qaLocale }), requestPseudoMode({ locale: qaLocale }));
    return <VisitBounce target={back ?? accountHome(accountId, null)} label={tr.text("accessLog.enter.opening")} />;
  }

  const db = await dbForRequest();
  const [accountRead, prefs, endedRecently] = await Promise.all([
    db.from("accounts").select("name").eq("id", accountId).maybeSingle(),
    getPersonPrefs(),
    lastVisitEndedRecently(accountId),
  ]);
  // Fail closed, not 404: a read error is not "this account does not exist" (plan Task 5 step 2).
  if (accountRead.error) throw new Error(accountRead.error.message);
  const account = accountRead.data as { name: string } | null;
  if (!account) notFound();

  // The agency's own session, never the account's `language` (request-locale.ts owner decision 1):
  // isOperator true, account null. `?locale=` is the QA override (off in production), documents/page.tsx's shape.
  const locale = requestLocale({ account: null, isOperator: true, userLanguage: prefs.language }, { locale: qaLocale });
  const tr = makeTr(locale, requestPseudoMode({ locale: qaLocale }));

  return (
    <div lang={locale}>
      <PageHeader title={tr.text("accessLog.enter.heading", { name: account.name })} />
      <div className="max-w-xl space-y-6 p-6">
        {endedRecently ? (
          <p className="text-sm text-muted-foreground">{tr.text("accessLog.enter.ended")}</p>
        ) : null}

        <form action={startVisitAction.bind(null, accountId, back)}>
          <ReasonTiles
            legend={tr.text("accessLog.enter.legend")}
            options={AGENCY_VISIT_REASONS.map((value) => ({ value, label: tr.text(REASON_LABEL_KEY[value]) }))}
          />
        </form>

        <p className="text-xs text-[var(--text-3)]">{tr.text("accessLog.enter.notice")}</p>

        <Link href="/dashboard/accounts" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {tr.text("accessLog.enter.back")}
        </Link>
      </div>
    </div>
  );
}
