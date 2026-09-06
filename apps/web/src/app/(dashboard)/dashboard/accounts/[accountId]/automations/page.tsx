import { serviceDb, getAutomation, getBranding } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { resolveSmsSender } from "@/lib/sms/sender";
import { m } from "@/lib/messages";
import { AutomationsSettings } from "./automations-settings";
import { saveReviewRequestAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Agency-only throughout, the Voice page's shape: `requireAgencyOnlyAccountAccess`
 * gates the page, every write in ./actions.ts re-checks `isAgency`, and the
 * nav item is hidden from clients — hiding a link is not authorization.
 * Reads go through serviceDb() like the writes; the whole page is one
 * audience, so a second db client buys nothing.
 */
export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  await requireAgencyOnlyAccountAccess(accountId);

  const db = serviceDb();
  const [automation, brandName, smsGate] = await Promise.all([
    getAutomation(db, accountId, "review_request"),
    // The default body names the company. Resolved through brandDisplayName
    // exactly as the pass's due-row is (packages/db), never off
    // `accounts.name` alone — a preview that does not match what sends is
    // worse than no preview. Cosmetic, so a failed read degrades to "".
    (async () => {
      try {
        const [branding, { data, error }] = await Promise.all([
          getBranding(db, accountId),
          db.from("accounts").select("name").eq("id", accountId).maybeSingle(),
        ]);
        if (error) throw new Error(error.message);
        return brandDisplayName(branding, (data as { name: string } | null)?.name ?? "");
      } catch (e) {
        console.error(`automations: brand name lookup failed for account ${accountId}: ${String(e)}`);
        return "";
      }
    })(),
    // The same gate the pass consults, so the page can say up front why an
    // SMS review request would be skipped.
    resolveSmsSender(db, accountId),
  ]);

  const boundSave = saveReviewRequestAction.bind(null, accountId);

  return (
    <>
      <PageHeader title={m["automations.title"]} />
      <div className="max-w-2xl space-y-6 p-6">
        <AutomationsSettings
          automation={automation}
          brandName={brandName}
          smsGate={smsGate}
          saveAction={boundSave}
        />
      </div>
    </>
  );
}
