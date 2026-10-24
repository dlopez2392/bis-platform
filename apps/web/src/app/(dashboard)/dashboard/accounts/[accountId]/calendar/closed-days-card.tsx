"use client";

// S-47d Task 12 (spec 5.6.3): the Calendar page's Closed days card. Beside the hours the booking page
// uses: in the main column after CalendarSettings for Owners and the agency, on its own for Staff and
// Technicians (`page.tsx`'s `canManage`). Every read it needs (`listClosedDaysFrom`, per-range
// `listClosureAppointments`, `countHeldByBooking`) runs in `page.tsx`, with its own `db` — this file never
// touches `@bis/db`.
//
// Controlled inputs (Global Constraints, the S-47c lesson): the From/To/Reason fields are `useState`,
// never `defaultValue`, and a Radix Select inside this form is CONTROLLED too (`team-card.tsx`'s
// InviteDialog is the precedent) rather than relying on `useFormSubmit` alone to dodge the reset bug —
// after a successful add the three fields are cleared by setting state directly, never `form.reset()`.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import type { MessageKey } from "@/lib/messages";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { runGuarded } from "@/lib/ui/guarded-run";
import type { ClosedDayReason } from "@bis/db";
import { formatClosedDayRange } from "@/lib/business-status/range-format";
import { AffectedAppointmentRow } from "../dashboard/affected-appointment-row";
import type { AddClosedDayInput, AddClosedDayResult, RemoveClosedDayResult } from "./closed-days-actions";
import type { ActionResult } from "./actions";
import { UNDO_WINDOW_MS } from "./undo-window";

export type ClosedDaysAppointmentView = {
  id: string;
  contactId: string;
  contactName: string;
  startsAt: string;
  kept: boolean;
  /** Held reminder messages for this booking (`countHeldByBooking`, fix round C8). */
  held: number;
};
export type ClosedDaysRangeView = {
  id: string;
  startsOn: string;
  endsOn: string;
  reason: ClosedDayReason | null;
  appointments: ClosedDaysAppointmentView[];
  /** Fix round (sonnet review): the page's read of EVERY listed range hit @bis/db's own row cap —
   *  there may be more affected appointments than this range's own list shows (the shared cap orders by
   *  starts_at across every range, so there is no single range to blame; every range therefore carries
   *  the SAME value). */
  capped: boolean;
};

/** `success`/`error` only — the minimal shape `sonner`'s `toast` already satisfies, same contract as
 *  `lib/ui/guarded-run.ts`'s `ToastLike`, plus `duration` so Undo lives exactly `UNDO_WINDOW_MS` (the
 *  calendar page's own convention, `cancel-booking.ts`). */
type Toaster = {
  success: (message: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => unknown;
  error: (message: string) => unknown;
};

/**
 * Fix round C5 / D6: what every run* helper below takes beside its locale. `pseudo` wraps every toast in
 * the QA pseudo-locale, the same way `makeTr` wraps the card's own words. `onUndone` runs after an Undo's
 * write SUCCEEDS (never after a refused or thrown one): the card re-reads the page and drops its local
 * overrides there, or a removed-then-restored range would stay hidden and an un-kept appointment would
 * keep reading "Kept".
 */
export type RunOptions = { pseudo?: boolean; onUndone?: () => void };

const REASON_KEY: Record<ClosedDayReason, MessageKey> = {
  holiday: "business.reason.holiday", vacation: "business.reason.vacation", other: "business.reason.other",
};

/** The no-reason form drops the " · …" suffix entirely (spec 5.6.3) — `null` only on a `null` reason. */
function reasonLabel(reason: ClosedDayReason | null, tr: Tr): string | null {
  return reason ? tr.text(REASON_KEY[reason]) : null;
}

function isReasonSelectValue(v: string): v is "none" | ClosedDayReason {
  return v === "none" || v === "holiday" || v === "vacation" || v === "other";
}

/** The Undo half every helper shares: run `write`, toast its refusal or crash, `onUndone` on success. */
function undoWith<R extends { ok: boolean }>(
  write: () => Promise<R>, toastApi: Toaster, tr: Tr, onUndone: (() => void) | undefined,
): () => void {
  return () => {
    void (async () => {
      let u: R;
      try {
        u = await write();
      } catch {
        toastApi.error(tr.text("common.actionCrashed"));
        return;
      }
      if (!u.ok) {
        toastApi.error((u as unknown as { error: string }).error);
        return;
      }
      onUndone?.();
    })();
  };
}

/**
 * `addClosedDayAction`, minus React (DESIGN.md rule 6; mirrors `lib/branding/remove-logo.ts`'s
 * `runRemoveLogo`): a toast on success, `closedDays.added` plus `closedDays.addedTodo` (singular at one,
 * fix round D2) when the range covers appointments, with Undo calling `removeClosedDayAction` on the
 * stored id.
 */
export async function runAddClosedDay(
  add: () => Promise<AddClosedDayResult>,
  undoRemove: (id: string) => Promise<RemoveClosedDayResult>,
  toastApi: Toaster,
  locale: Locale,
  { pseudo = false, onUndone }: RunOptions = {},
): Promise<AddClosedDayResult> {
  const tr = makeTr(locale, pseudo);
  let r: AddClosedDayResult;
  try {
    r = await add();
  } catch {
    const error = tr.text("closedDays.saveFailed");
    toastApi.error(error);
    return { ok: false, error };
  }
  if (!r.ok) {
    toastApi.error(r.error);
    return r;
  }
  const id = r.id;
  const message = r.appointments > 0
    ? `${tr.text("closedDays.added")} ${tr.count("closedDays.addedTodo", r.appointments, { n: r.appointments })}`
    : tr.text("closedDays.added");
  toastApi.success(message, {
    action: { label: tr.text("common.undo"), onClick: undoWith(() => undoRemove(id), toastApi, tr, onUndone) },
    duration: UNDO_WINDOW_MS,
  });
  return r;
}

/**
 * `removeClosedDayAction`, minus React: immediate, `closedDays.removed`, Undo calling
 * `addClosedDayAction` with `restore: true` and the exact removed range (S-47d spec 5.6.3; a range already
 * under way is re-added from yesterday by the action itself, fix round B4).
 */
export async function runRemoveClosedDay(
  remove: () => Promise<RemoveClosedDayResult>,
  undoAdd: (input: AddClosedDayInput) => Promise<AddClosedDayResult>,
  toastApi: Toaster,
  locale: Locale,
  { pseudo = false, onUndone }: RunOptions = {},
): Promise<boolean> {
  const tr = makeTr(locale, pseudo);
  let r: RemoveClosedDayResult;
  try {
    r = await remove();
  } catch {
    toastApi.error(tr.text("closedDays.saveFailed"));
    return false;
  }
  if (!r.ok) {
    toastApi.error(r.error);
    return false;
  }
  const removed = r.removed;
  toastApi.success(tr.text("closedDays.removed"), {
    action: {
      label: tr.text("common.undo"),
      onClick: undoWith(
        () => undoAdd({ from: removed.from, to: removed.to, reason: removed.reason, restore: true }), toastApi, tr, onUndone,
      ),
    },
    duration: UNDO_WINDOW_MS,
  });
  return true;
}

/**
 * `keepAppointmentAction`, minus React: `business.card.keptToast`, Undo calling the same action with
 * `kept: false` (5.6.2's shape, reused here per Task 12's brief). A Keep that throws says Keep failed
 * (`business.card.keepFailed`, fix round D5), never the status switch's own failure sentence.
 */
export async function runKeepAppointment(
  setKept: (kept: boolean) => Promise<ActionResult>,
  toastApi: Toaster,
  locale: Locale,
  { pseudo = false, onUndone }: RunOptions = {},
): Promise<boolean> {
  const tr = makeTr(locale, pseudo);
  let r: ActionResult;
  try {
    r = await setKept(true);
  } catch {
    toastApi.error(tr.text("business.card.keepFailed"));
    return false;
  }
  if (!r.ok) {
    toastApi.error(r.error);
    return false;
  }
  toastApi.success(tr.text("business.card.keptToast"), {
    action: { label: tr.text("common.undo"), onClick: undoWith(() => setKept(false), toastApi, tr, onUndone) },
    duration: UNDO_WINDOW_MS,
  });
  return true;
}

export function ClosedDaysCard({
  accountId, locale, pseudo = false, canManage, canAct, persona, today, timezone, ranges, initialOpenClosedDay,
  addAction, removeAction, keepAction,
}: {
  accountId: string;
  locale: Locale;
  /** The QA pseudo-locale (`requestPseudoMode`, fix round D6). */
  pseudo?: boolean;
  /** Owners and the agency (D1, unchanged by D8) — Staff and Technicians get the list, read-only. */
  canManage: boolean;
  /** `seesWholeAccount` (fix round C5): Keep and "Cancel on the calendar" are offered only to whoever may
   *  use them — the agency, Owners and Staff, never a Technician. */
  canAct: boolean;
  /** The voice profile's persona, or `null` when the account has none (or it could not be read): the
   *  empty sentence then names no one (SD19, fix round D3), never an assumed "Sofía". */
  persona: string | null;
  /** The account's own today (zone key), the Add form's floor. */
  today: string;
  /** The account's zone: each affected appointment's time is rendered in it (fix round C4). */
  timezone: string;
  /** `null` = the read failed; `[]` = genuinely none. */
  ranges: ClosedDaysRangeView[] | null;
  /** From a To-do's `?closedDay=`: the range whose list starts open. */
  initialOpenClosedDay: string | null;
  addAction: (input: AddClosedDayInput, locale: Locale) => Promise<AddClosedDayResult>;
  removeAction: (id: string, locale: Locale) => Promise<RemoveClosedDayResult>;
  keepAction: (bookingId: string, kept: boolean, locale: Locale) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const tr = makeTr(locale, pseudo);
  const initialOpenId = ranges?.find((r) => r.startsOn === initialOpenClosedDay)?.id ?? null;
  const [openRangeId, setOpenRangeId] = useState<string | null>(initialOpenId);
  const [hiddenIds, setHiddenIds] = useState<Record<string, true>>({});
  const [keptOverride, setKeptOverride] = useState<Record<string, boolean>>({});
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState<"none" | ClosedDayReason>("none");

  // Fix round C5: after any Undo, the page's own fresh read is the truth again — the local overrides
  // that hid a removed range or showed a kept row are dropped, and the page is re-read.
  const onUndone = () => {
    setHiddenIds({});
    setKeptOverride({});
    router.refresh();
  };

  // One busy ref shared by every ghost action on this card (Remove, Keep): simplest guard against a
  // double click firing the same write twice (lib/ui/guarded-run.ts's `runGuarded`); the Add form below
  // carries its own guard through `useFormSubmit`.
  const busy = useRef(false);
  const [, startTransition] = useTransition();
  const { pending: addPending, onSubmit } = useFormSubmit(async () => {
    const result = await runAddClosedDay(
      () => addAction({ from, to: to === "" ? null : to, reason: reason === "none" ? null : reason }, locale),
      (id) => removeAction(id, locale),
      toast,
      locale,
      { pseudo, onUndone },
    );
    if (result.ok) {
      setFrom(today);
      setTo("");
      setReason("none");
      router.refresh();
    }
  });

  const handleRemove = (range: ClosedDaysRangeView) => {
    runGuarded(busy, startTransition, async () => {
      const ok = await runRemoveClosedDay(
        () => removeAction(range.id, locale),
        (input) => addAction(input, locale),
        toast,
        locale,
        { pseudo, onUndone },
      );
      if (ok) {
        setHiddenIds((cur) => ({ ...cur, [range.id]: true }));
        router.refresh();
      }
    });
  };

  const handleKeep = (apptId: string) => {
    runGuarded(busy, startTransition, async () => {
      const ok = await runKeepAppointment(
        (kept) => keepAction(apptId, kept, locale),
        toast,
        locale,
        { pseudo, onUndone },
      );
      if (ok) {
        setKeptOverride((cur) => ({ ...cur, [apptId]: true }));
        router.refresh();
      }
    });
  };

  if (ranges === null) {
    return (
      <Card id="closed-days" lang={locale} className="scroll-mt-24">
        <CardHeader><CardTitle>{tr.text("closedDays.title")}</CardTitle></CardHeader>
        <CardContent>
          <Notice tone="warn" className="text-foreground">{tr.text("closedDays.error")}</Notice>
        </CardContent>
      </Card>
    );
  }

  const visible = ranges.filter((r) => !hiddenIds[r.id]);
  const addForm = canManage ? (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="closed-day-from">{tr.text("closedDays.from")}</Label>
          <Input id="closed-day-from" type="date" value={from} min={today}
            onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="closed-day-to">{tr.text("closedDays.to")}</Label>
          <Input id="closed-day-to" type="date" value={to} min={from}
            onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="closed-day-reason">{tr.text("closedDays.reason")}</Label>
          <Select value={reason} onValueChange={(v) => { if (isReasonSelectValue(v)) setReason(v); }}>
            <SelectTrigger id="closed-day-reason" className="w-full"><SelectValue /></SelectTrigger>
            {/* Fix round C3: a portal leaves the card's own `lang`, so the list sets its own. */}
            <SelectContent lang={locale}>
              <SelectItem value="none">{tr.text("business.reason.none")}</SelectItem>
              <SelectItem value="holiday">{tr.text("business.reason.holiday")}</SelectItem>
              <SelectItem value="vacation">{tr.text("business.reason.vacation")}</SelectItem>
              <SelectItem value="other">{tr.text("business.reason.other")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <SubmitButton pending={addPending}>{tr.text("closedDays.add")}</SubmitButton>
    </form>
  ) : null;

  return (
    <Card id="closed-days" lang={locale} className="scroll-mt-24">
      <CardHeader><CardTitle>{tr.text("closedDays.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {visible.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              {persona ? tr.text("closedDays.empty", { persona }) : tr.text("closedDays.emptyNoPersona")}
            </p>
            {addForm}
          </>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {visible.map((range) => {
                const label = formatClosedDayRange(range.startsOn, range.endsOn, locale);
                const reasonText = reasonLabel(range.reason, tr);
                const count = range.appointments.length;
                const isOpen = openRangeId === range.id && count > 0;
                const listId = `closed-day-${range.id}-appointments`;
                return (
                  <li key={range.id} className="space-y-1.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-card-foreground">
                          {label}{reasonText ? ` · ${reasonText}` : ""}
                        </span>
                        {count > 0 ? (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={listId}
                            className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-2 hover:underline md:min-h-8"
                            onClick={() => setOpenRangeId((cur) => (cur === range.id ? null : range.id))}
                          >
                            {tr.count("closedDays.count", count, { n: count })}
                          </button>
                        ) : null}
                      </div>
                      {canManage ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleRemove(range)}>
                          {tr.text("closedDays.remove")}
                        </Button>
                      ) : null}
                    </div>
                    {/* Fix round (sonnet review): the shared read hit @bis/db's own row cap — the SAME
                        caveat the dashboard status card shows (business-status-card-view.tsx's
                        AffectedList), worded for a list of ranges rather than one window with a known
                        end date. Shown on every listed range, not just the open one: the cap is on the
                        whole read, not this one range's own count. */}
                    {range.capped ? (
                      <p className="text-xs text-muted-foreground">{tr.text("closedDays.moreAppointments")}</p>
                    ) : null}
                    {isOpen ? (
                      <ul id={listId} className="border-t border-[var(--line)] pt-1">
                        {range.appointments.map((appt) => (
                          <AffectedAppointmentRow
                            key={appt.id}
                            accountId={accountId}
                            appointment={{
                              id: appt.id, contactId: appt.contactId, name: appt.contactName, startsAt: appt.startsAt,
                              held: appt.held, kept: keptOverride[appt.id] ?? appt.kept,
                            }}
                            timezone={timezone}
                            locale={locale}
                            pseudo={pseudo}
                            canAct={canAct}
                            keep={(
                              <Button
                                type="button" variant="ghost" size="sm" onClick={() => handleKeep(appt.id)}
                                className="min-h-11 rounded-[var(--radius-ctl)] focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8"
                              >
                                {tr.text("business.card.keep")}
                              </Button>
                            )}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {addForm}
          </>
        )}
      </CardContent>
    </Card>
  );
}
