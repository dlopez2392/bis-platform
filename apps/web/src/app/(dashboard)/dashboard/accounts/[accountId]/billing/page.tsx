import { CreditCard } from "lucide-react";
import { brandDisplayName, getPlan, serviceDb, sumUsageSince } from "@bis/db";
import { DotPill } from "@/components/dot-pill";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SurfaceStateNote, capabilityLink, capabilityPill, capabilitySentenceKey, type SurfaceReader } from "@/components/surface-state-note";
import { requireAccountOwner } from "@/lib/auth";
import { getTenantBranding } from "@/lib/branding/tenant-theme-reader";
import { CAPABILITIES, capabilityState, readCapabilityFacts, type Capability, type CapabilityGrade } from "@/lib/surfaces/capabilities";
import { readAccountBilling } from "@/lib/billing/account-billing-read";
import { billingCardView, billingStatusTreatment, safeZone, usagePeriodStart } from "@/lib/billing/billing-view";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { dbForRequest } from "@/lib/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { t as tFn } from "@/lib/i18n/t";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";
import { m } from "@/lib/messages";
import { makeTr } from "@/lib/record/copy";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { openBillingPortalAction } from "./actions";
import { paymentProcessingTreatment } from "./client-status";
import { ManageBillingButton } from "./manage-billing-button";

export const dynamic = "force-dynamic";

/**
 * The client's Billing page (spec section 5; G20): plan, usage this period
 * ("312 of 500 minutes", read from usage_events, never the Activity page's
 * counts), the next invoice, and Manage billing. The billing row and the
 * usage are read on the RLS client (0051: a client reads its own rows); the
 * row through `readAccountBilling`, the cached seam the account layout's
 * banner shares, so this navigation reads it once. The PLAN goes through
 * serviceDb() keyed by that row's plan_id (PR-1 binding: plans stays
 * agency-read). Reads are not swallowed: a failure reaches the dashboard
 * error boundary (the Plans page's precedent).
 *
 * The route works for the agency too (hiding the nav item from it is
 * convenience, G20); requireAccountOwner is the boundary — Staff and roles
 * (spec §4): a client Staff is sent to their own dashboard, same as any
 * other owner-only surface, never 403'd (requireAccountAccess's own
 * reasoning).
 */
export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  /** S-10 T9a: the QA override only (`?locale=pseudo`) — off unless
   *  BIS_I18N_QA, never on Vercel (requestPseudoMode's own gate). This page
   *  had no `searchParams` param at all before, so `?locale=pseudo` was
   *  silently inert here even though every string below already resolves
   *  through `locale`. Optional, like team/page.tsx's own `searchParams?`:
   *  every existing caller that renders this page with no query string
   *  (every test in page.test.ts) keeps working unchanged. */
  searchParams?: Promise<{ locale?: string }>;
}) {
  const { accountId } = await params;
  const { locale: localeParam } = (await searchParams) ?? {};
  const { isAgency } = await requireAccountOwner(accountId);
  const db = await dbForRequest();
  // The paused line (M7a PR-4 Task 10, plan G12) and its locale, read the
  // account layout's own way — billingVerdictFor is cached per request, so
  // this is the SAME read the layout already made on this navigation.
  const [billing, account, verdict, prefs, capFacts] = await Promise.all([
    readAccountBilling(accountId),
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle().then(({ data, error }) => {
      if (error) throw new Error(`billing page: account read failed: ${error.message}`);
      return data as { timezone: string | null; language: "en" | "es" | null } | null;
    }),
    billingVerdictFor(accountId),
    getPersonPrefs(),
    readCapabilityFacts(accountId),
  ]);
  const locale = requestLocale({ account, isOperator: isAgency, userLanguage: prefs.language }, { locale: localeParam });
  // S-10 T9a: `p()` wraps an already-resolved string from the `tFn()` calls
  // below, the same precedent dashboard/page.tsx's own `p()` sets — never a
  // prop threaded through child components, since every string on this page
  // is built right here in the server component.
  const pseudo = requestPseudoMode({ locale: localeParam });
  const p = (resolved: string) => (pseudo ? pseudoLocale(resolved) : resolved);
  // F-088 PR 3: each capability graded from the ONE facts read; a failed read grades every row "needs setup",
  // never "live" (capabilities.ts). The reader decides the words: a client is told BIS is on it, the agency is
  // pointed at the page that fixes it. The Owner's link to THIS page is never offered here.
  const reader: SurfaceReader = { isAgency, role: isAgency ? null : "owner" };
  const grades = CAPABILITIES.map((cap) => ({ cap, grade: capabilityState(cap, capFacts) }));
  const support = normalizeReplyTo(process.env.AGENCY_SUPPORT_EMAIL) ?? null;
  const includes = includesCard({ grades, reader, accountId, locale, pseudo });
  const header = <PageHeader title={p(tFn(m, "billing.page.title", locale))} subtitle={p(tFn(m, "billing.page.subtitle", locale))} />;
  if (!billing) {
    // DECISION 4: the item is in the client's nav before billing starts, and
    // this says what will appear here and what makes it appear.
    return (
      <>
        {header}
        <div className="space-y-4 p-6">
          <EmptyState icon={CreditCard} title={p(tFn(m, "billing.page.empty.title", locale))} body={p(tFn(m, "billing.page.empty.body", locale))} />
          {includes}
        </div>
      </>
    );
  }

  const plan = await getPlan(serviceDb(), billing.planId);
  if (!plan) throw new Error(`billing page: plan ${billing.planId} of account ${accountId} not found`);
  const zone = safeZone(account?.timezone);
  const now = new Date();
  const used = await sumUsageSince(db, accountId, usagePeriodStart(billing, zone, now).start.toISOString());
  const view = billingCardView({ billing, link: null, plan, activePlans: [], used, zone, now, defaultEmail: "",
    // Inert here: no plans are passed, so no action is offered on this page.
    stripeReady: true, webhookReady: true, locale });
  // A first payment still going through: the client's word, shown to whoever
  // opens this page, the agency included (it sees the client's page as the
  // client does). The agency's own card on Settings keeps "Payment failed".
  // client-status.ts says why.
  const processing = billing.subscriptionStatus === "incomplete";
  const t = processing ? paymentProcessingTreatment(locale) : billingStatusTreatment(view.status, locale);
  // An ended plan (design review I4): the help never asks for a card, whether the plan reads canceled
  // or its pause says so; and "contact us" has a target — the agency's support address, read here on
  // the server, else the line names who to ask.
  const ended = view.status === "canceled" || (verdict.paused && verdict.cause === "ended");
  const pausedLine = verdict.paused
    ? pausedSentence(verdict.cause === "ended" ? "ended" : "payment", support, locale, pseudo)
    : null;

  return (
    <>
      {header}
      <div className="space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>{plan.name}</CardTitle>
            <CardAction><DotPill label={p(t.label)} chip={t.chip} dot={t.dot} data-status={processing ? "payment_processing" : view.status} /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-foreground tabular-nums">
              {billing.complimentary ? p(tFn(m, "billing.page.complimentary", locale)) : view.plan?.price}
            </p>
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-foreground">{p(tFn(m, "billing.page.usage", locale))}</h2>
              <ul className="space-y-1 text-sm tabular-nums text-foreground">
                {view.usage.map((u) => <li key={u.meter} className={u.over ? "font-medium" : undefined}>{p(u.text)}</li>)}
              </ul>
              {view.since ? (
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{p(view.since)}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{p(tFn(m, "billing.usage.chatsNote", locale))}</p>
            </div>
            {view.nextInvoice ? <p className="text-sm text-muted-foreground tabular-nums">{p(view.nextInvoice)}</p> : null}
            {view.status === "canceled" ? <p className="text-sm text-muted-foreground">{p(tFn(m, "billing.page.canceled", locale))}</p> : null}
            {pausedLine ? <p className="text-sm text-foreground" lang={locale}>{pausedLine}</p> : null}
            {!billing.complimentary && billing.stripeCustomerId ? (
              <ManageBillingButton
                open={openBillingPortalAction.bind(null, accountId, locale)}
                help={p(ended ? tFn(m, "billing.page.manageHelp.canceled", locale) : tFn(m, "billing.page.manageHelp", locale))}
                locale={locale}
                pseudo={pseudo}
              />
            ) : null}
          </CardContent>
        </Card>
        {includes}
        {await biggerPlanCard({ grades, support, accountId, locale, pseudo })}
      </div>
    </>
  );
}

type Graded = { cap: Capability; grade: CapabilityGrade }[];

/** "What your plan includes" (F-088 PR 3): one row per capability, dot + word + one sentence (rule 3). No
 *  button, no padlock: the card says what is so, the next card (when it applies) says how to ask. */
function includesCard({ grades, reader, accountId, locale, pseudo }: {
  grades: Graded; reader: SurfaceReader; accountId: string; locale: Locale; pseudo: boolean;
}) {
  const tr = makeTr(locale, pseudo);
  return (
    <Card data-surface-card="includes">
      <CardHeader><CardTitle>{tr.text("billing.includes.title")}</CardTitle></CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-[var(--line)]">
          {grades.map(({ cap, grade }) => (
            <li key={cap} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6">
              <h4 className="text-sm font-medium text-foreground sm:w-40 sm:shrink-0 sm:pt-0.5">{tr.text(`surface.cap.${cap}`)}</h4>
              <SurfaceStateNote
                align="start"
                state={grade.state}
                sentence={tr.text(capabilitySentenceKey(cap, grade, reader))}
                word={capabilityPill(cap, grade, locale, pseudo)}
                link={capabilityLink(cap, grade, reader, accountId, locale, pseudo)}
                locale={locale}
                pseudo={pseudo}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** "What a bigger plan adds" (F-088 PR 3): only when a capability grades "in a bigger plan" (a paused, CRM-only
 *  or not-yet-set-up one is not a plan matter). One plain sentence per missing capability, no price (owner
 *  ruling 2026-11-20), and the one way to ask: a mail to the agency's support address, its subject naming the
 *  BRAND (never accounts.name), else the line names who to ask. The mail is a quiet link, so the card carries no
 *  primary (rule 8) and no hero (rule 11). Nothing here sends anything. */
async function biggerPlanCard({ grades, support, accountId, locale, pseudo }: {
  grades: Graded; support: string | null; accountId: string; locale: Locale; pseudo: boolean;
}) {
  const missing = grades.filter(({ grade }) => grade.state === "bigger_plan");
  if (missing.length === 0) return null;
  const tr = makeTr(locale, pseudo);
  let ask: React.ReactNode = tr.text("billing.bigger.askNoContact");
  if (support) {
    const business = brandDisplayName(await getTenantBranding(accountId));
    const subject = business
      ? tFn(m, "billing.bigger.subject", locale, { business })
      : tFn(m, "billing.bigger.subjectNoName", locale);
    const [before, after] = tr.text("billing.bigger.ask").split("{email}");
    ask = (
      <>
        {before}
        <a href={`mailto:${support}?subject=${encodeURIComponent(subject)}`} className="underline underline-offset-2">{support}</a>
        {after}
      </>
    );
  }
  return (
    <Card data-surface-card="bigger">
      <CardHeader><CardTitle>{tr.text("billing.bigger.title")}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {missing.map(({ cap }) => (
            <li key={cap} className="text-sm text-foreground" lang={locale}>{tr.text(cap === "sofia" ? "billing.bigger.sofia" : "billing.bigger.webChat")}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground" lang={locale}>{ask}</p>
      </CardContent>
    </Card>
  );
}

/** The paused line (plan G12; design review I4): an ended plan's "contact us" is a mailto link to the
 *  agency's support address when one is set, else names the team that set up the account.
 *
 *  S-10 T9a: `pseudo` wraps the WHOLE resolved string before any split —
 *  `pseudoLocale` leaves a `{placeholder}` byte-for-byte untouched wherever
 *  it falls, so `.split("{email}")` still finds it inside the padded,
 *  bracketed text and the link lands in the middle of one bracket pair. */
function pausedSentence(cause: "payment" | "ended", support: string | null, locale: Locale, pseudo = false): React.ReactNode {
  const p = (resolved: string) => (pseudo ? pseudoLocale(resolved) : resolved);
  if (cause === "payment") return p(tFn(m, "billing.page.paused.payment", locale));
  if (!support) return p(tFn(m, "billing.page.paused.endedNoContact", locale));
  const [before, after] = p(tFn(m, "billing.page.paused.ended", locale)).split("{email}");
  return (
    <>
      {before}
      <a href={`mailto:${support}`} className="underline underline-offset-2">{support}</a>
      {after}
    </>
  );
}
