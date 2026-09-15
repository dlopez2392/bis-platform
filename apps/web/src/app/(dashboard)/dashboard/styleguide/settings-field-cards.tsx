"use client";

import { SendingAddressCard } from "@/app/(dashboard)/dashboard/accounts/[accountId]/settings/sending-address-card";
import { WeeklyReportCard } from "@/app/(dashboard)/dashboard/accounts/[accountId]/settings/weekly-report-card";
import { AlertPhoneCard } from "@/components/alert-phone-card";

/**
 * WHY THIS IS ITS OWN CLIENT COMPONENT — same reason rail-states.tsx gives:
 * a SERVER component cannot hand a plain function prop across into a
 * `"use client"` card (only a real Server Action, marked `"use server"` and
 * bound to a real account, crosses that boundary), and these three cards'
 * `action` props are ordinary async functions. A local no-op stands in for
 * the real server action; nothing this page submits is persisted anywhere.
 *
 * The three settings-field cards (sending address, weekly report, alert
 * texts) share one submit shape — `useFormSubmit`, never the `action` prop,
 * each card's own doc comment says why — and sit beside each other on
 * Settings, so one Section documents all three together rather than three
 * near-duplicate entries.
 *
 * AlertPhoneCard also gets its CLIENT (`isAgency={false}`) branch shown
 * across all three states it can be in — no number, ready, and a number
 * saved but not yet ready to send — because that branch is the first
 * settings-field card in the app to drop the form entirely for a read-only
 * audience rather than rendering it disabled, which is exactly the kind of
 * new pattern this page exists to document (DESIGN.md's definition of done).
 */
const demoOk = async () => ({ ok: true as const });

function Demo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export function SettingsFieldCards() {
  return (
    <>
      <Demo label="Agency — sending address">
        <SendingAddressCard fromEmail="hello@rioroofing.test" action={demoOk} />
      </Demo>
      <Demo label="Agency — weekly report">
        <WeeklyReportCard reportEmails={["owner@rioroofing.test"]} action={demoOk} />
      </Demo>
      <Demo label="Agency — alert texts, not ready to send">
        {/* This branch's own Notice links to a real
            `/dashboard/accounts/${accountId}/checklist` route, and this page
            has no real account to hand it (page.tsx's own comment: "this
            route has no accountId") — accountId="demo" below is a display
            value only. Swallow the click here rather than let it navigate to
            a route that does not exist. */}
        <div onClickCapture={(e) => e.preventDefault()}>
          <AlertPhoneCard
            isAgency accountId="demo" alertPhone="+19562921696" smsNotReady action={demoOk}
          />
        </div>
      </Demo>
      <Demo label="Client — no alert number">
        <AlertPhoneCard isAgency={false} accountId="demo" alertPhone={null} />
      </Demo>
      <Demo label="Client — ready">
        <AlertPhoneCard
          isAgency={false} accountId="demo" alertPhone="+19562921696" smsNotReady={false}
        />
      </Demo>
      <Demo label="Client — number saved, not ready yet">
        <AlertPhoneCard
          isAgency={false} accountId="demo" alertPhone="+19562921696" smsNotReady
        />
      </Demo>
    </>
  );
}
