"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { OwnerLineCardView } from "./owner-line-view";
import { OwnerLineCode } from "./owner-line-code";
import { deferredRemoval, STOP_CALLING_IN_UNDO_MS } from "./stop-calling-in";

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };

/**
 * "Call in to your business" (F-032 §3.1, §3.2), one per membership on Mis preferencias. One primary per step
 * (DESIGN rule 8): Verify this cell, or Save PIN; everything else is ghost — the ready/off/locked/stopOnly steps
 * carry no primary at all (two ghost affordances, with no single obvious decision between them). The code is
 * shown only from the action's own answer: it is stored hashed, so a reload shows "Make a new code" rather than
 * a code nobody can read back.
 *
 * `stopOnly` (Task 6 brief's must #1, Task 5 review m-3): a role the owner line no longer offers (Staff demoted
 * to Technician) but which still holds an enrolment gets ONLY "Stop calling in" — no cell form, no PIN form, no
 * Change PIN. The caller (preferences/page.tsx) renders this card at all only once `ownerLineCardApplies` said so.
 *
 * Undo (DESIGN rule 6): "Change PIN" has none, on purpose — it drops the card back to the PIN step so the person
 * sets a new one in the same card, and an Undo would need the old hash kept, which defeats changing a PIN that
 * may have leaked. "Stop calling in" IS reversible in practice, so it gets the deferred-commit shape: the
 * controls hide at once and a 10-second toast offers Undo; the removal runs only when that toast closes WITHOUT
 * Undo (sonner's own `onAutoClose`/`onDismiss` — a swipe or the close button reads the same as letting it time
 * out: both mean "did not undo"). A tab closed inside those 10 seconds never closes the toast, so the removal is also
 * forced through on `pagehide` (design review Important 3; `deferredRemoval`, stop-calling-in.ts), at most once.
 *
 * `lang` on the card root (design minors), as sibling sections do (bis-access-frame.tsx).
 */
export function OwnerLineCard(props: {
  accountId: string; businessName: string; number: string; view: OwnerLineCardView; locale: Locale; pseudo: boolean;
  /** How long a call-in code works (OWNER_LINE_VERIFY_MINUTES, from the server page), for the copy. */
  verifyMinutes: number;
  startVerification: (cell: string) => Promise<Result<{ code: string; expiresAt: string }>>;
  setPin: (pin: string) => Promise<Result>; removePin: () => Promise<Result>; removeCell: () => Promise<Result>;
}) {
  const tr = makeTr(props.locale, props.pseudo);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const run = <T,>(fn: () => Promise<Result<T>>, done?: (v: T) => void) => start(async () => {
    const r = await fn();
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    done?.(r.value);
    router.refresh();
  });
  function stopCallingIn() {
    setLeaving(true);
    const removal = deferredRemoval(() => run(props.removeCell, () => toast.success(tr.text("ownerLine.card.removed"))), window);
    toast(tr.text("ownerLine.card.removing"), {
      duration: STOP_CALLING_IN_UNDO_MS,
      // An Undo after a pagehide already sent the removal changes nothing: the controls stay hidden and the refresh
      // that follows the removal shows the cell gone.
      action: { label: tr.text("common.undo"), onClick: () => { if (removal.undo()) setLeaving(false); } },
      onAutoClose: removal.settle,
      onDismiss: removal.settle,
    });
  }
  const v = props.view;
  return (
    <Card lang={props.locale} data-owner-line-card={props.accountId}>
      <CardHeader>
        <CardTitle>{tr.text("ownerLine.card.title")}</CardTitle>
        <p className="text-sm text-[var(--text-2)]">{tr.text("ownerLine.card.body", { business: props.businessName })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {v.status.key ? <p data-owner-line-status className="text-sm">{tr.text(v.status.key, v.status.params)}</p> : null}
        {v.step === "cell" ? (
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            const cell = String(new FormData(e.currentTarget).get("cell") ?? "");
            run(() => props.startVerification(cell), (val) => setCode(val.code));
          }}>
            <Label htmlFor={`ol-cell-${props.accountId}`}>{tr.text("ownerLine.card.cell.label")}</Label>
            <Input id={`ol-cell-${props.accountId}`} name="cell" inputMode="tel" autoComplete="tel" defaultValue={v.cell ?? ""} />
            <Button type="submit" disabled={pending}>{tr.text(code ? "ownerLine.card.cell.again" : "ownerLine.card.cell.save")}</Button>
          </form>
        ) : null}
        {v.step === "cell" && code ? (
          <div data-owner-line-code className="space-y-2">
            <OwnerLineCode accountId={props.accountId} code={code} number={props.number} minutes={props.verifyMinutes}
              locale={props.locale} pseudo={props.pseudo} />
            <Button type="button" variant="ghost" onClick={() => router.refresh()}>{tr.text("ownerLine.card.verify.check")}</Button>
          </div>
        ) : null}
        {v.step === "pin" ? (
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            const pin = String(new FormData(e.currentTarget).get("pin") ?? "");
            run(() => props.setPin(pin), () => toast.success(tr.text("ownerLine.card.pin.saved")));
          }}>
            <Label htmlFor={`ol-pin-${props.accountId}`}>{tr.text("ownerLine.card.pin.label")}</Label>
            <Input id={`ol-pin-${props.accountId}`} name="pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} />
            <Button type="submit" disabled={pending}>{tr.text("ownerLine.card.pin.save")}</Button>
          </form>
        ) : null}
        {(v.step === "ready" || v.step === "off" || v.step === "locked") && !leaving ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(props.removePin, () => toast.success(tr.text("ownerLine.card.pin.removed")))}>
              {tr.text("ownerLine.card.pin.change")}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={stopCallingIn}>
              {tr.text("ownerLine.card.remove")}
            </Button>
          </div>
        ) : null}
        {v.step === "stopOnly" && !leaving ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={stopCallingIn}>
              {tr.text("ownerLine.card.remove")}
            </Button>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-[var(--crit)]">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
