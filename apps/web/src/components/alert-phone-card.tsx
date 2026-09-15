"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { NumberChip } from "@/app/(dashboard)/dashboard/accounts/[accountId]/setup/steps/step-shared";
import { m } from "@/lib/messages";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { toE164 } from "@/lib/voice/phone-number";

export type AlertPhoneActionResult = { ok: true } | { ok: false; error: string };

/**
 * Where a text goes when work arrives — `accounts.alert_phone`
 * (0035_alert_phone.sql). Agency-write, client-read: the migration grants
 * `authenticated` SELECT on the column but deliberately no UPDATE, and its
 * own comment says the intent plainly — "the client should SEE where their
 * alerts go even though they cannot change it." The honest way to render an
 * asymmetric permission is to keep the fact and drop the form, not to hide
 * the fact along with it — so this card always shows what the number IS,
 * and only the agency's copy of it is also a form.
 *
 * Rendered from TWO routes for that reason: the agency's Settings page
 * (`isAgency` true, the three actions supplied) and the client's own
 * Branding page (`isAgency` false, all three omitted). The client branch is
 * untouched by 0036: `verifyAlertPhoneCode` (packages/db) writes
 * `accounts.alert_phone` only on a MATCHING code, so a claim in progress
 * never appears on this column at all — a client reading it mid-verification
 * sees exactly what they saw before anyone typed a new number, which is
 * correct, not a gap.
 *
 * 0036_alert_phone_verifications.sql closed the direct-write path for any
 * NEW number: `setAlertPhoneAction` now hard-refuses a non-blank value, so
 * the agency's editable side of this card is two phases, not one form.
 *
 * - **idle** — one phone field, one button. A BLANK submission still writes
 *   NULL immediately, no proof required (nobody has to demonstrate
 *   possession to turn alerts off, and requiring it would strand an account
 *   whose stored number is already wrong). A NON-BLANK submission — even
 *   the number already on the account, unchanged — always asks for a code:
 *   `setAlertPhoneAction` refuses every non-blank value unconditionally, so
 *   the button's label follows what is TYPED (`common.save` only when the
 *   field is empty; `settings.alertPhoneSendCode` otherwise), never the
 *   value the page was rendered with.
 * - **pending** — reached only after `startVerificationAction` returns
 *   `{ok:true}`. Shows the number the code was actually sent to (echoed from
 *   the SEND call, not re-read from the live phone field — the field is
 *   gone in this phase) and a code input. Confirming, resending, and
 *   changing the number are the only three affordances; resending reuses
 *   the send action, changing the number drops back to idle with nothing
 *   server-side to undo (0036 Decision 5: an older live row for the same
 *   number is simply left to age out on its own ten minutes, never
 *   cancelled).
 *
 * Phase is client-only React state, never derived from a server field or
 * URL param — 0036 Decision 3 keeps a pending claim off `accounts` on
 * purpose, so there is nothing to derive it from, and a reload correctly
 * lands back on idle (the operator never saw the code either, so there is
 * nothing lost by asking again).
 *
 * The code the server drew is NEVER read back by this component. Every
 * action below returns only `{ok:true}` or `{ok:false,error}` — neither
 * shape has anywhere to carry a code — and the only "code" this file ever
 * touches is the six characters the operator themselves types into the
 * confirm field. That is the whole point of the gate: the requester and the
 * verifier are the same person here, so the one thing this screen must never
 * do is make the code legible to them by any other means.
 *
 * Write side shaped after SendingAddressCard/WeeklyReportCard beside it on
 * Settings: `onSubmit` via `useFormSubmit`, never the `action` prop — React
 * resets an action-prop form even when the action resolves to `{ok:false}`,
 * which would silently revert a field to its last SAVED value while it
 * still looks like what the operator just typed.
 */
export function AlertPhoneCard({
  isAgency, accountId, alertPhone, smsNotReady,
  clearAction, startVerificationAction, confirmVerificationAction,
}: {
  isAgency: boolean;
  /** For the agency-only Notice's link to this account's own Checklist —
   *  the one place `smsNotReady` names a problem WITH a button beside it. */
  accountId: string;
  alertPhone: string | null;
  /** A number IS set, but nothing would actually send yet — A2P not
   *  approved, or no live number (`resolveSmsSender`'s own gate, read by
   *  both callers: Settings for the agency, Branding for the client via the
   *  same predicate). The agency's idle phase turns this into a Notice
   *  naming the problem beside the Checklist link that can act on it,
   *  regardless of whether a number is already saved or one is only just
   *  being typed — sending a code needs the same gate a live alert does. The
   *  CLIENT branch never gets that Notice or its vocabulary, but still reads
   *  this to decide whether "Alert texts go to {value}" is true right now. */
  smsNotReady?: boolean;
  /** Writes NULL directly for a blank field. No proof required — see the
   *  card's own doc comment. Present only on the agency's editable card. */
  clearAction?: (formData: FormData) => Promise<AlertPhoneActionResult>;
  /** Opens a claim on a NEW number: draws a code, texts it, returns
   *  `{ok:true}` with no code attached. Also used to RESEND, with the same
   *  claimed number, from the pending phase. */
  startVerificationAction?: (formData: FormData) => Promise<AlertPhoneActionResult>;
  /** Consumes a code against the claimed number and, only on a match, writes
   *  `accounts.alert_phone`. */
  confirmVerificationAction?: (formData: FormData) => Promise<AlertPhoneActionResult>;
}) {
  // Controlled, unlike the pre-0036 card's `defaultValue`: the button's own
  // label needs to react to what is typed, not to the value the page was
  // rendered with. Initialized from the server prop so an untouched field
  // still shows the account's own number.
  const [phone, setPhone] = useState(alertPhone ?? "");
  const [phase, setPhase] = useState<"idle" | "pending">("idle");
  const [pendingPhone, setPendingPhone] = useState("");
  const [code, setCode] = useState("");
  const [resending, setResending] = useState(false);

  const { pending: sendPending, onSubmit: onSendSubmit } = useFormSubmit(async (formData) => {
    const raw = String(formData.get("alertPhone") ?? "").trim();
    if (!raw) {
      if (!clearAction) return;
      let result: AlertPhoneActionResult;
      try {
        result = await clearAction(formData);
      } catch {
        toast.error(m["common.actionCrashed"]);
        return;
      }
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(m["settings.alertPhoneSaved"]);
      return;
    }

    if (!startVerificationAction) return;
    let result: AlertPhoneActionResult;
    try {
      result = await startVerificationAction(formData);
    } catch {
      toast.error(m["common.actionCrashed"]);
      return;
    }
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(m["settings.alertPhoneCodeSent"]);
    // Displayed via NumberChip in the pending phase below — normalized the
    // same way the server just normalized it, for the same reason the
    // client branch never shows a raw, unformatted number.
    setPendingPhone(toE164(raw) ?? raw);
    setCode("");
    setPhase("pending");
  });

  const { pending: confirmPending, onSubmit: onConfirmSubmit } = useFormSubmit(async (formData) => {
    if (!confirmVerificationAction) return;
    let result: AlertPhoneActionResult;
    try {
      result = await confirmVerificationAction(formData);
    } catch {
      toast.error(m["common.actionCrashed"]);
      return;
    }
    if (!result.ok) {
      // Wrong vs. expired is already two distinct strings
      // (verifyAlertPhoneCode's own contract); this just shows whichever one
      // came back and leaves the operator on this same screen to retry.
      toast.error(result.error);
      return;
    }
    toast.success(m["settings.alertPhoneSaved"]);
    setPhase("idle");
    setCode("");
  });

  async function handleResend() {
    if (!startVerificationAction || resending) return;
    setResending(true);
    try {
      const formData = new FormData();
      formData.set("alertPhone", pendingPhone);
      const result = await startVerificationAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(m["settings.alertPhoneCodeSent"]);
    } catch {
      toast.error(m["common.actionCrashed"]);
    } finally {
      setResending(false);
    }
  }

  function handleChangeNumber() {
    setPhase("idle");
    setCode("");
  }

  const trimmedPhone = phone.trim();

  // Both templates carry the same slot name for the same reason
  // setup-shell.tsx's own {steps} split does: the slot is where a live
  // element (a Link, a NumberChip) goes instead of a joined string.
  const [notReadyLead = "", notReadyTail = ""] =
    m["settings.alertPhoneNotReady"].split("{checklistLink}");
  const [pendingHintLead = "", pendingHintTail = ""] =
    m["settings.alertPhonePendingHint"].split("{value}");
  const [clientOnLead = "", clientOnTail = ""] =
    m["settings.alertPhoneClientOn"].split("{value}");
  const [clientNotReadyLead = "", clientNotReadyTail = ""] =
    m["settings.alertPhoneClientNotReady"].split("{value}");

  return (
    <Card id="alert-phone" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["settings.alertPhone"]}</CardTitle>
      </CardHeader>
      <CardContent>
        {isAgency && phase === "idle" ? (
          <form onSubmit={onSendSubmit} className="flex flex-col gap-3">
            <Label htmlFor="alertPhone" className="sr-only">{m["settings.alertPhone"]}</Label>
            <Input
              id="alertPhone"
              name="alertPhone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={m["settings.alertPhonePlaceholder"]}
            />
            <p className="text-xs text-muted-foreground">{m["settings.alertPhoneHint"]}</p>
            <p className="text-xs text-muted-foreground">{m["settings.alertPhoneNeedsVerification"]}</p>
            {!alertPhone && (
              <p className="text-xs text-muted-foreground">{m["settings.alertPhoneOff"]}</p>
            )}
            {smsNotReady && (
              <Notice tone="warn" className="text-foreground">
                {notReadyLead}
                <Link
                  href={`/dashboard/accounts/${accountId}/checklist`}
                  className="underline underline-offset-2"
                >
                  {m["nav.checklist"]}
                </Link>
                {notReadyTail}
              </Notice>
            )}
            <Button type="submit" disabled={sendPending} className="self-start">
              {sendPending
                ? m["common.saving"]
                : trimmedPhone
                  ? m["settings.alertPhoneSendCode"]
                  : m["common.save"]}
            </Button>
          </form>
        ) : isAgency ? (
          <form onSubmit={onConfirmSubmit} className="flex flex-col gap-3">
            <input type="hidden" name="alertPhone" value={pendingPhone} />
            <p className="text-sm text-card-foreground">
              {pendingHintLead}<NumberChip e164={pendingPhone} />{pendingHintTail}
            </p>
            <Label htmlFor="alertPhoneCode" className="sr-only">
              {m["settings.alertPhoneCodeLabel"]}
            </Label>
            <Input
              id="alertPhoneCode"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={m["settings.alertPhoneCodePlaceholder"]}
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={confirmPending}>
                {confirmPending ? m["common.saving"] : m["settings.alertPhoneConfirmCode"]}
              </Button>
              <Button type="button" variant="ghost" disabled={resending} onClick={handleResend}>
                {m["settings.alertPhoneResendCode"]}
              </Button>
              <Button type="button" variant="ghost" onClick={handleChangeNumber}>
                {m["settings.alertPhoneChangeNumber"]}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-card-foreground">
              {!alertPhone ? (
                m["settings.alertPhoneClientOff"]
              ) : smsNotReady ? (
                <>{clientNotReadyLead}<NumberChip e164={alertPhone} />{clientNotReadyTail}</>
              ) : (
                <>{clientOnLead}<NumberChip e164={alertPhone} />{clientOnTail}</>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{m["settings.alertPhoneClientBody"]}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
