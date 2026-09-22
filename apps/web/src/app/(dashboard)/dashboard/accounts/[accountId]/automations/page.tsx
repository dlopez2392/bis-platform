import { headers } from "next/headers";
import Link from "next/link";
import {
  serviceDb, getAutomation, getBranding, getCalendarForAccount, readQuietSettings,
  type AutomationRow, type CalendarRow, type QuietSettings,
} from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { originFrom } from "@/lib/email/origin";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { m } from "@/lib/messages";
import { AutomationsSettings } from "./automations-settings";
import { NoShowNudgeCard } from "./no-show-nudge-card";
import { SmsReminderCard } from "./sms-reminder-card";
import { AppointmentConfirmCard } from "./appointment-confirm-card";
import { InstantReplyCard } from "./instant-reply-card";
import { QuietHoursCard } from "./quiet-hours-card";
import {
  saveReviewRequestAction, saveNoShowNudgeAction, saveSmsReminderAction, saveAppointmentConfirmAction,
  saveInstantReplyAction, saveQuietHoursAction,
} from "./actions";

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
  // Every read below degrades to the value its own card already renders as
  // "nothing configured" — a null AutomationRow, a refused SmsGate, a null
  // calendar, an empty origin — so one transient Supabase hiccup on ANY of
  // these can no longer 500 the whole agency page; only the one card that
  // lost its read shows the degraded state, and the log line carries the
  // account id so the hiccup is still visible.
  const [review, noShow, smsReminder, appointmentConfirm, instantReply, account, smsGate, calendar, origin, quiet] = await Promise.all([
    getAutomation(db, accountId, "review_request").catch((e): AutomationRow | null => {
      console.error(`automations: review_request read failed for ${accountId}: ${String(e)}`);
      return null;
    }),
    getAutomation(db, accountId, "no_show_nudge").catch((e): AutomationRow | null => {
      console.error(`automations: no_show_nudge read failed for ${accountId}: ${String(e)}`);
      return null;
    }),
    getAutomation(db, accountId, "sms_reminder").catch((e): AutomationRow | null => {
      console.error(`automations: sms_reminder read failed for ${accountId}: ${String(e)}`);
      return null;
    }),
    getAutomation(db, accountId, "appointment_confirm").catch((e): AutomationRow | null => {
      console.error(`automations: appointment_confirm read failed for ${accountId}: ${String(e)}`);
      return null;
    }),
    getAutomation(db, accountId, "instant_reply").catch((e): AutomationRow | null => {
      console.error(`automations: instant_reply read failed for ${accountId}: ${String(e)}`);
      return null;
    }),
    // The default bodies name the company. Resolved through brandDisplayName
    // exactly as the passes' due-rows are (packages/db) — the brand name and
    // nothing else, so the preview cannot show what the send cannot, and a
    // preview that does not match what sends is worse than no preview. The
    // `accounts` read is only for the zone now (the text reminder's sample
    // time); `name` is the agency's internal label and is not selected.
    // Cosmetic, so a failed read degrades to ""/UTC.
    (async () => {
      try {
        const [branding, { data, error }] = await Promise.all([
          getBranding(db, accountId),
          db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
        ]);
        if (error) throw new Error(error.message);
        const acct = data as { timezone: string } | null;
        return { brandName: brandDisplayName(branding), timezone: acct?.timezone ?? "UTC" };
      } catch (e) {
        console.error(`automations: account lookup failed for ${accountId}: ${String(e)}`);
        return { brandName: "", timezone: "UTC" };
      }
    })(),
    // The same gate the passes consult, so the page can say up front why a
    // text would be skipped. Degrades to the same refusal `resolveSmsSender`
    // itself returns for a missing/unreadable row (fail closed).
    resolveSmsSender(db, accountId).catch((e): SmsGate => {
      console.error(`automations: sms sender read failed for ${accountId}: ${String(e)}`);
      return { ok: false, reason: "a2p_not_approved" };
    }),
    // READ-ONLY: a settings page must not create the calendar row on a GET.
    // A company that has never opened Calendar has no row yet; the nudge
    // card then shows its "booking page is off" state and the other two
    // cards render regardless.
    getCalendarForAccount(db, accountId).catch((e): CalendarRow | null => {
      console.error(`automations: calendar read failed for ${accountId}: ${String(e)}`);
      return null;
    }),
    // APP_ORIGIN first, then the request's host — the same origin every
    // customer link carries (origin.ts). The pass builds the sent link from
    // ctx.origin the same way, so the preview shows the link that goes out.
    headers().then((h) => originFrom(h)).catch((e): string => {
      console.error(`automations: origin lookup failed for ${accountId}: ${String(e)}`);
      return "";
    }),
    // Part C. UNLIKE the account read beside it, this degrade must not show a
    // plausible-but-wrong window: rendering `DEFAULT_QUIET_SETTINGS` as if it
    // were the saved one and letting Save fire would silently overwrite the
    // client's real hours with the platform default. So a failed read
    // degrades to `null` — the card renders a Notice and a disabled form
    // (the agency reloads to fix it, rather than pressing Save on a guess) —
    // and one log line.
    readQuietSettings(db, accountId).catch((e): QuietSettings | null => {
      console.error(`automations: quiet-hours read failed for ${accountId}: ${String(e)}`);
      return null;
    }),
  ]);

  const bookingUrl = origin && calendar ? `${origin}/b/${calendar.public_id}` : "";

  return (
    <>
      <PageHeader
        title={m["automations.title"]}
        actions={<Link href={`/dashboard/accounts/${accountId}/activity`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{m["automations.activityLink"]}</Link>}
      />
      <div className="max-w-2xl space-y-6 p-6">
        <QuietHoursCard settings={quiet} zoneLabel={account.timezone} saveAction={saveQuietHoursAction.bind(null, accountId)} />
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
          calendarEnabled={calendar?.enabled ?? false}
          saveAction={saveNoShowNudgeAction.bind(null, accountId)}
        />
        <SmsReminderCard
          automation={smsReminder}
          brandName={account.brandName}
          accountTimezone={account.timezone}
          smsGate={smsGate}
          saveAction={saveSmsReminderAction.bind(null, accountId)}
        />
        <AppointmentConfirmCard
          automation={appointmentConfirm}
          brandName={account.brandName}
          accountTimezone={account.timezone}
          smsGate={smsGate}
          saveAction={saveAppointmentConfirmAction.bind(null, accountId)}
        />
        <InstantReplyCard
          automation={instantReply}
          brandName={account.brandName}
          smsGate={smsGate}
          saveAction={saveInstantReplyAction.bind(null, accountId)}
        />
      </div>
    </>
  );
}
