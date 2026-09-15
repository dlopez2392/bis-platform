"use client";

import { SendingAddressCard } from "@/app/(dashboard)/dashboard/accounts/[accountId]/settings/sending-address-card";
import { WeeklyReportCard } from "@/app/(dashboard)/dashboard/accounts/[accountId]/settings/weekly-report-card";
import { AlertPhoneCard } from "@/components/alert-phone-card";
import { m } from "@/lib/messages";

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
 *
 * 0036 added the agency's two-phase claim-a-number flow (send a code, then
 * confirm it) below the states above. Three more demos document it, all of
 * them REAL and clickable — this page's cards were never static pictures —
 * because the pending phase is internal React state with nothing server-side
 * to derive it from (the card's own doc comment says why), so there is no
 * prop that could freeze it into a snapshot the way `smsNotReady` freezes
 * the not-ready demo above. Typing a number into "verify a new number" and
 * clicking through is the only way to see the pending phase render at all.
 */
const demoOk = async () => ({ ok: true as const });
const demoSelfLoopRefusal = async () => ({ ok: false as const, error: m["settings.alertPhoneSelfWarning"] });
const demoWrongCode = async () => ({ ok: false as const, error: m["settings.alertPhoneWrongCode"] });

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
            isAgency accountId="demo" alertPhone="+19562921696" smsNotReady
            clearAction={demoOk} startVerificationAction={demoOk} confirmVerificationAction={demoOk}
          />
        </div>
      </Demo>
      <Demo label="Agency — verify a new number (type one, click Send code, then Confirm)">
        <AlertPhoneCard
          isAgency accountId="demo" alertPhone={null}
          clearAction={demoOk} startVerificationAction={demoOk} confirmVerificationAction={demoOk}
        />
      </Demo>
      <Demo label="Agency — sending a code is refused (the number is the account's own)">
        <AlertPhoneCard
          isAgency accountId="demo" alertPhone={null}
          clearAction={demoOk} startVerificationAction={demoSelfLoopRefusal} confirmVerificationAction={demoOk}
        />
      </Demo>
      <Demo label="Agency — wrong code (send a real code, then type any 6 digits)">
        <AlertPhoneCard
          isAgency accountId="demo" alertPhone={null}
          clearAction={demoOk} startVerificationAction={demoOk} confirmVerificationAction={demoWrongCode}
        />
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
