import { notFound } from "next/navigation";
import { BillingBanner } from "@/components/billing-banner";
import { BillingPausedBanner } from "@/components/billing-paused-banner";
import { requireAccountAccess } from "@/lib/auth";
import { readAccountBilling } from "@/lib/billing/account-billing-read";
import { showsPaymentFailedBanner } from "@/lib/billing/billing-view";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { dbForRequest } from "@/lib/db";
import { requestLocale } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { LocaleProvider } from "@/components/locale-provider";

export default async function AccountWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  // getPersonPrefs beside the access check: for a client it awaits the same
  // cached stored-person read requireAccountAccess starts, so no extra query.
  const [{ isAgency, role }, prefs] = await Promise.all([requireAccountAccess(accountId), getPersonPrefs()]);
  const db = await dbForRequest();
  const { data: account, error } = await db
    .from("accounts")
    .select("id, name, language")
    .eq("id", accountId)
    .maybeSingle();
  if (error) {
    // 22P02 = Postgres invalid_text_representation, which PostgREST surfaces
    // when accountId isn't valid uuid syntax (e.g. a malformed or guessed
    // URL segment like ".../accounts/foo/dashboard"). That is a routing
    // miss, not a query fault, so it belongs behind the same notFound() a
    // well-formed-but-nonexistent id already gets below — not the error
    // boundary. Every other query error still throws and fails loud.
    if (error.code === "22P02") notFound();
    throw new Error(`account lookup failed: ${error.message}`);
  }
  if (!account) notFound();

  // The payment-failed banner (M7a step 3, plan G21) and the paused banner
  // (PR-4 Task 10, plan G12), on every page of this account. One primary-key
  // read on the RLS client (0051: the agency and the account's own client
  // may read it) plus the one cached service-role verdict read
  // (standing-read.ts) — both fail SOFT, so a billing read must never take
  // the account's pages down with it. past_due/unpaid only, never incomplete
  // (showsPaymentFailedBanner says why).
  // Through the cached seam: the Billing page reads the same row and the
  // same verdict on the same navigation, so each stays one query.
  // Staff and roles: under account_billing_owner_read (0066), a client
  // Staff session reads NO row here — RLS filtering, not a fault.
  // readAccountBilling's own .maybeSingle() already turns that into `null`
  // rather than throwing, and showsPaymentFailedBanner(null) is already
  // `false`, so a Staff session takes the exact same "no banner" path an
  // unbilled account's Owner does: no throw, this catch never runs, and a
  // client Staff never sees this banner. billingVerdictFor's own switch/fail
  // handling means the two banners are never BOTH shown: a paused row's
  // showsPaymentFailedBanner is already false (billingPausedAt is set), and
  // with the switch off verdict.paused is always false.
  const [billingRow, verdict] = await Promise.all([
    readAccountBilling(accountId).catch((e: unknown) => {
      console.error(`account layout: billing read failed for ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
    billingVerdictFor(accountId),
  ]);
  const paymentFailed = showsPaymentFailedBanner(billingRow);

  // Owner decision 1 (2026-10-10, plan-review C2): account.language governs
  // CLIENT-role sessions only — `isOperator: isAgency` is this layout's own
  // existing `isAgency` (above), passed straight through, no new auth call.
  // A person's own language (mis preferencias) wins over both defaults.
  const locale = requestLocale({ account, isOperator: isAgency, userLanguage: prefs.language });
  // The paused banner's three audiences (plan G12): the agency, a client
  // Owner (Billing is theirs), and every other client role (Staff and
  // Technicians get a line instead, since Billing is Owner-only).
  const audience = isAgency ? "agency" : role === "owner" ? "owner" : "member";

  return (
    // No `lang` wrapper here (decision D, 2026-10-10): most of every page
    // is still English, so `lang={locale}` sits only on the converted parts
    // (the dashboard KPI row; the sidebar nav and topbar presence above
    // this segment; the paused and payment-failed banners' own sentences)
    // and the rest inherits the root <html lang="en">.
    <LocaleProvider locale={locale}>
      {verdict.paused ? (
        <div className="px-6 pt-6">
          <BillingPausedBanner audience={audience} accountId={accountId} cause={verdict.cause ?? "payment"} locale={locale} />
        </div>
      ) : paymentFailed ? (
        <div className="px-6 pt-6">
          <BillingBanner audience={isAgency ? "agency" : "client"} accountId={accountId} locale={locale} />
        </div>
      ) : null}
      {children}
    </LocaleProvider>
  );
}
