import { headers } from "next/headers";
import { serviceDb, getAutomation, getBranding, getOrCreateCalendar } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { originFrom } from "@/lib/email/origin";
import { resolveSmsSender } from "@/lib/sms/sender";
import { m } from "@/lib/messages";
import { AutomationsSettings } from "./automations-settings";
import { NoShowNudgeCard } from "./no-show-nudge-card";
import { SmsReminderCard } from "./sms-reminder-card";
import { saveReviewRequestAction, saveNoShowNudgeAction, saveSmsReminderAction } from "./actions";

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
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);

  const db = serviceDb();
  const [review, noShow, smsReminder, account, smsGate, calendar, origin] = await Promise.all([
    getAutomation(db, accountId, "review_request"),
    getAutomation(db, accountId, "no_show_nudge"),
    getAutomation(db, accountId, "sms_reminder"),
    // The default bodies name the company. Resolved through brandDisplayName
    // exactly as the passes' due-rows are (packages/db), never off
    // `accounts.name` alone — a preview that does not match what sends is
    // worse than no preview. The zone feeds the text reminder's sample time.
    // Cosmetic, so a failed read degrades to ""/UTC.
    (async () => {
      try {
        const [branding, { data, error }] = await Promise.all([
          getBranding(db, accountId),
          db.from("accounts").select("name, timezone").eq("id", accountId).maybeSingle(),
        ]);
        if (error) throw new Error(error.message);
        const acct = data as { name: string; timezone: string } | null;
        return { brandName: brandDisplayName(branding, acct?.name ?? ""), timezone: acct?.timezone ?? "UTC" };
      } catch (e) {
        console.error(`automations: account lookup failed for ${accountId}: ${String(e)}`);
        return { brandName: "", timezone: "UTC" };
      }
    })(),
    // The same gate the passes consult, so the page can say up front why a
    // text would be skipped.
    resolveSmsSender(db, accountId),
    // Lazy, as the Calendar settings page does: the row exists the first
    // time anything asks. The nudge's preview needs its public id.
    getOrCreateCalendar(db, accountId, userId),
    // APP_ORIGIN first, then the request's host — the same origin every
    // customer link carries (origin.ts). The pass builds the sent link from
    // ctx.origin the same way, so the preview shows the link that goes out.
    headers().then((h) => originFrom(h)),
  ]);

  const bookingUrl = origin ? `${origin}/b/${calendar.public_id}` : "";

  return (
    <>
      <PageHeader title={m["automations.title"]} />
      <div className="max-w-2xl space-y-6 p-6">
        <AutomationsSettings
          automation={review}
          brandName={account.brandName}
          smsGate={smsGate}
          saveAction={saveReviewRequestAction.bind(null, accountId)}
        />
        <NoShowNudgeCard
          automation={noShow}
          brandName={account.brandName}
          smsGate={smsGate}
          bookingUrl={bookingUrl}
          calendarEnabled={calendar.enabled}
          saveAction={saveNoShowNudgeAction.bind(null, accountId)}
        />
        <SmsReminderCard
          automation={smsReminder}
          brandName={account.brandName}
          accountTimezone={account.timezone}
          smsGate={smsGate}
          saveAction={saveSmsReminderAction.bind(null, accountId)}
        />
      </div>
    </>
  );
}
