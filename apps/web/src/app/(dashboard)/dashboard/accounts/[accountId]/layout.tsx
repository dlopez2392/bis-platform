import { notFound } from "next/navigation";
import { getAccountBilling } from "@bis/db";
import { BillingBanner } from "@/components/billing-banner";
import { requireAccountAccess } from "@/lib/auth";
import { showsPaymentFailedBanner } from "@/lib/billing/billing-view";
import { dbForRequest } from "@/lib/db";

export default async function AccountWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const { isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const { data: account, error } = await db
    .from("accounts")
    .select("id, name")
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

  // The payment-failed banner (M7a step 3, plan G21), on every page of this
  // account. One primary-key read on the RLS client (0051: the agency and
  // the account's own client may read it). Fails SOFT: a billing read must
  // never take the account's pages down with it. past_due/unpaid only, never
  // incomplete (showsPaymentFailedBanner says why).
  let paymentFailed = false;
  try {
    paymentFailed = showsPaymentFailedBanner(await getAccountBilling(db, accountId));
  } catch (e) {
    console.error(`account layout: billing read failed for ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
  }

  return (
    <>
      {paymentFailed ? (
        <div className="px-6 pt-6">
          <BillingBanner audience={isAgency ? "agency" : "client"} accountId={accountId} />
        </div>
      ) : null}
      {children}
    </>
  );
}
