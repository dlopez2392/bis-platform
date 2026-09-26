"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DotPill } from "@/components/dot-pill";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BILLING_STATUS_TREATMENTS, type BillingCardView, type PlanOption } from "@/lib/billing/billing-view";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { SubmitButton } from "../../submit-button";
import type { BillingActionResult } from "./billing-actions";

type Action = (formData: FormData) => Promise<BillingActionResult>;

/** What one submit came back as. `crashed`: the action THREW (the network,
 *  or a database failure after Stripe already took a change), so the server
 *  may have acted; `refused`: the action answered, and nothing it was asked
 *  for is known to have happened. */
export type Outcome = { kind: "ok" } | { kind: "refused"; error: string } | { kind: "crashed" };

/** The one billing refusal that belongs to a FIELD (billing-actions.ts's
 *  address check); every other one is about the whole request. */
const EMAIL_ERROR = m["billing.error.email"];

/** One plan dialog's state across one opening. */
export type DialogState = { open: boolean; requestId: string; emailError: string | null };

/** Every opening mints its own request id (G15): a double click inside one
 *  opening replays at Stripe, and a second, deliberate change does not. */
export function dialogOpened(mint: () => string): DialogState {
  return { open: true, requestId: mint(), emailError: null };
}

/**
 * What an answer does to the dialog.
 *  - ok: it closes.
 *  - refused: it stays as it was, with a NEW request id. Stripe saves the
 *    answer to a keyed request, a 5xx included, and replays it for 24 hours
 *    (an assumption, from Stripe's docs), so a retry under the old key could
 *    never succeed. A refusal before Stripe was reached never used the key,
 *    so a new one costs nothing there. The address refusal goes on the field.
 *  - crashed: it keeps its id. The change may have landed at Stripe before
 *    the throw, and the same key then replays that success instead of
 *    making a second change.
 */
export function dialogAfter(state: DialogState, outcome: Outcome, mint: () => string): DialogState {
  switch (outcome.kind) {
    case "ok":
      return { ...state, open: false, emailError: null };
    case "refused":
      return { ...state, requestId: mint(), emailError: outcome.error === EMAIL_ERROR ? outcome.error : null };
    case "crashed":
      return { ...state, emailError: null };
  }
}

const mintRequestId = () => crypto.randomUUID();

/**
 * The agency's Billing card (spec section 5). Agency-only by construction:
 * rendered from Settings (requireAgencyOnlyAccountAccess), and every action
 * re-checks requireAgency. Everything it shows and offers comes from the
 * view model (billingCardView); nothing is re-derived here. ONE primary per
 * card (DESIGN rule 8): Send billing link, when it applies; everything else
 * is ghost. Complimentary changes are reversible, so they run at once with
 * an Undo toast (rule 6); a paid plan change is a dialog decision with no
 * undo (G15), because undoing it would be a second prorated change.
 *
 * Holds no React state of its own (the dialogs do), so a test can call it
 * and reach its handlers without a DOM.
 */
export function BillingCard({ view, send, markComplimentary, stopComplimentary, changePlan }: {
  view: BillingCardView;
  send: Action;
  markComplimentary: Action;
  stopComplimentary: () => Promise<BillingActionResult>;
  changePlan: Action;
}) {
  const router = useRouter();
  const t = BILLING_STATUS_TREATMENTS[view.status];

  type Undo = { go: () => Promise<BillingActionResult>; success: string };
  const run = async (go: () => Promise<BillingActionResult>, success: string, undo?: Undo): Promise<Outcome> => {
    let r: BillingActionResult;
    try {
      r = await go();
    } catch {
      toast.error(m["common.actionCrashed"]);
      return { kind: "crashed" };
    }
    router.refresh();
    if (!r.ok) {
      // The address refusal is shown on the email field instead.
      if (r.error !== EMAIL_ERROR) toast.error(r.error);
      return { kind: "refused", error: r.error };
    }
    toast.success(success, undo
      ? { action: { label: m["common.undo"], onClick: () => void run(undo.go, undo.success) } }
      : undefined);
    return { kind: "ok" };
  };

  const planForm = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  // The account's own plan is the Send default only while it can still be
  // picked (an archived plan is not in the list, and the action refuses it).
  const sendDefault = view.planOptions.some((p) => p.id === view.plan?.id) ? view.plan!.id : view.planOptions[0]?.id;

  return (
    <Card id="billing" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["billing.card.title"]}</CardTitle>
        <CardAction>
          <DotPill label={t.label} chip={t.chip} dot={t.dot} data-status={view.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.plan ? (
          <p className="text-sm font-medium text-foreground">
            {view.plan.name} <span className="font-normal text-muted-foreground">· {view.plan.price}</span>
          </p>
        ) : view.planOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m["billing.card.noPlans"]}</p>
        ) : view.status === "unbilled" && view.stripeReady ? (
          <p className="text-sm text-muted-foreground">{m["billing.card.empty"]}</p>
        ) : null}

        {view.stripeReady ? null : (
          <Notice tone="warn" className="text-foreground">{m["billing.card.noStripe"]}</Notice>
        )}

        {view.usage.length > 0 ? (
          <div className="flex flex-col gap-2">
            <ul className="space-y-1 text-sm tabular-nums text-foreground">
              {view.usage.map((u) => (
                <li key={u.meter} data-over={u.over ? "true" : undefined} className={u.over ? "font-medium" : undefined}>
                  {u.text}
                </li>
              ))}
            </ul>
            {view.since ? (
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{view.since}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">{m["billing.usage.chatsNote"]}</p>
          </div>
        ) : null}

        {view.nextInvoice ? <p className="text-sm text-muted-foreground">{view.nextInvoice}</p> : null}
        {view.link ? (
          <p className="text-sm text-muted-foreground">
            {m["billing.link.sentTo"].replace("{email}", view.link.sentTo).replace("{date}", view.link.expires)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {view.can.send ? (
            <PlanDialog
              trigger={m["billing.send"]} primary title={m["billing.send.title"]} body={m["billing.send.body"]}
              submit={m["billing.send"]} plans={view.planOptions} defaultPlanId={sendDefault}
              email={view.defaultEmail}
              onSubmit={(f) => run(() => send(f), m["billing.send.done"])}
            />
          ) : null}
          {view.can.copyLink && view.link ? (
            <Button
              variant="ghost" type="button"
              onClick={() => void navigator.clipboard.writeText(view.link!.url).then(
                () => toast.success(m["billing.link.copied"]), () => toast.error(m["common.actionCrashed"]),
              )}
            >
              {m["billing.link.copy"]}
            </Button>
          ) : null}
          {view.can.changePlan && view.plan ? (
            <PlanDialog
              trigger={m["billing.changePlan"]} title={m["billing.changePlan"]}
              body={view.status === "complimentary" ? m["billing.changePlan.bodyComplimentary"] : m["billing.changePlan.bodyPaid"]}
              submit={m["billing.changePlan"]} plans={view.planOptions.filter((p) => p.id !== view.plan!.id)}
              withRequestId expectedPlanId={view.plan.id}
              onSubmit={(f) => {
                const from = view.plan!.id;
                const to = String(f.get("planId"));
                const undo = view.status === "complimentary"
                  ? {
                    go: () => changePlan(planForm({ planId: from, expectedPlanId: to, requestId: mintRequestId() })),
                    success: m["billing.changePlan.done"],
                  }
                  : undefined;
                return run(() => changePlan(f), m["billing.changePlan.done"], undo);
              }}
            />
          ) : null}
          {view.can.markComplimentary ? (
            <PlanDialog
              trigger={m["billing.comp.mark"]} title={m["billing.comp.mark"]} body={m["billing.comp.markBody"]}
              submit={m["billing.comp.mark"]} plans={view.planOptions} defaultPlanId={view.planOptions[0]?.id}
              onSubmit={(f) => run(() => markComplimentary(f), m["billing.comp.done"],
                { go: () => stopComplimentary(), success: m["billing.comp.stopped"] })}
            />
          ) : null}
          {view.can.stopComplimentary && view.plan ? (
            <Button
              variant="ghost" type="button"
              onClick={() => {
                const planId = view.plan!.id;
                void run(() => stopComplimentary(), m["billing.comp.stopped"],
                  { go: () => markComplimentary(planForm({ planId })), success: m["billing.comp.done"] });
              }}
            >
              {m["billing.comp.stop"]}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** One dialog shape for Send, Change plan and Mark complimentary. The
 *  dialog is the decision, not an "Are you sure?" (rule 6): its one primary
 *  is the submit. */
function PlanDialog({
  trigger, primary = false, title, body, submit, plans, defaultPlanId, email, withRequestId = false, expectedPlanId, onSubmit,
}: {
  trigger: string;
  primary?: boolean;
  title: string;
  body: string;
  submit: string;
  plans: PlanOption[];
  defaultPlanId?: string;
  email?: string;
  withRequestId?: boolean;
  expectedPlanId?: string;
  onSubmit: (formData: FormData) => Promise<Outcome>;
}) {
  const [state, setState] = useState<DialogState>({ open: false, requestId: "", emailError: null });
  const { pending, onSubmit: submitForm } = useFormSubmit(async (formData) => {
    const outcome = await onSubmit(formData);
    setState((s) => dialogAfter(s, outcome, mintRequestId));
  });
  return (
    <Dialog
      open={state.open}
      onOpenChange={(next) => setState((s) => (next ? dialogOpened(mintRequestId) : { ...s, open: false }))}
    >
      <DialogTrigger asChild>
        <Button variant={primary ? "default" : "ghost"} type="button">{trigger}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitForm} className="flex flex-col gap-4">
          <PlanFields
            plans={plans} defaultPlanId={defaultPlanId} email={email} emailError={state.emailError}
            requestId={withRequestId ? state.requestId : null} expectedPlanId={expectedPlanId}
          />
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost" type="button">{m["common.cancel"]}</Button></DialogClose>
            <SubmitButton pending={pending}>{submit}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's fields: a plan picker, the recipient for Send (with its own
 *  error on the field), and the hidden request id and expected plan for
 *  Change plan. */
export function PlanFields({ plans, defaultPlanId, email, emailError, requestId, expectedPlanId }: {
  plans: PlanOption[];
  defaultPlanId?: string;
  /** Present only for Send. */
  email?: string;
  emailError: string | null;
  /** Present only for Change plan. */
  requestId: string | null;
  expectedPlanId?: string;
}) {
  const id = useId();
  const planId = `${id}-plan`;
  const emailId = `${id}-email`;
  const errorId = `${id}-email-error`;
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={planId}>{m["billing.send.plan"]}</Label>
        <Select name="planId" defaultValue={defaultPlanId ?? plans[0]?.id}>
          <SelectTrigger id={planId} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.price}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {email !== undefined ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={emailId}>{m["billing.send.email"]}</Label>
          <Input
            id={emailId} name="email" type="email" required defaultValue={email}
            aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? errorId : undefined}
          />
          {emailError ? <p id={errorId} role="alert" className="text-sm text-destructive">{emailError}</p> : null}
        </div>
      ) : null}
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
      {expectedPlanId ? <input type="hidden" name="expectedPlanId" value={expectedPlanId} /> : null}
    </>
  );
}

/** The error state (DESIGN rule 5): the card, its title, and one sentence,
 *  on the same #billing anchor the banner and ⌘K link to. */
export function BillingCardError() {
  return (
    <Card id="billing" className="scroll-mt-24">
      <CardHeader><CardTitle>{m["billing.card.title"]}</CardTitle></CardHeader>
      <CardContent><Notice tone="warn" className="text-foreground">{m["billing.card.error"]}</Notice></CardContent>
    </Card>
  );
}

/** The loading state (rule 7), on the same #billing anchor: shaped like the
 *  card — a title and the status pill, a plan line, three usage lines, the
 *  period label, the action row. */
export function BillingCardSkeleton() {
  return (
    <Card id="billing" className="scroll-mt-24" aria-busy="true" aria-label={m["billing.card.title"]}>
      <CardHeader>
        <Skeleton className="h-5 w-24" />
        <CardAction><Skeleton className="h-6 w-20 rounded-full" /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-4 w-48" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-40" />)}
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-9 w-36" />
      </CardContent>
    </Card>
  );
}
