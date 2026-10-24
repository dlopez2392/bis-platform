"use client";

// S-47d Task 12 (spec 5.6.3): the Calendar page's Closed days card. Beside the hours the booking page
// uses: in the main column after CalendarSettings for Owners and the agency, on its own for Staff and
// Technicians (`page.tsx`'s `canManage`). Every read it needs (`listClosedDaysFrom`, per-range
// `listClosureAppointments`) runs in `page.tsx`, with its own `db` — this file never touches `@bis/db`.
//
// Controlled inputs (Global Constraints, the S-47c lesson): the From/To/Reason fields are `useState`,
// never `defaultValue`, and a Radix Select inside this form is CONTROLLED too (`team-card.tsx`'s
// InviteDialog is the precedent) rather than relying on `useFormSubmit` alone to dodge the reset bug —
// after a successful add the three fields are cleared by setting state directly, never `form.reset()`.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { m, type MessageKey } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { runGuarded } from "@/lib/ui/guarded-run";
import type { ClosedDayReason } from "@bis/db";
import { formatClosedDayRange } from "@/lib/business-status/range-format";
import type { AddClosedDayInput, AddClosedDayResult, RemoveClosedDayResult } from "./closed-days-actions";
import type { ActionResult } from "./actions";
import { UNDO_WINDOW_MS } from "./undo-window";

export type ClosedDaysAppointmentView = {
  id: string;
  contactId: string;
  contactName: string;
  startsAt: string;
  kept: boolean;
};
export type ClosedDaysRangeView = {
  id: string;
  startsOn: string;
  endsOn: string;
  reason: ClosedDayReason | null;
  appointments: ClosedDaysAppointmentView[];
};

/** `success`/`error` only — the minimal shape `sonner`'s `toast` already satisfies, same contract as
 *  `lib/ui/guarded-run.ts`'s `ToastLike`, plus `duration` so Undo lives exactly `UNDO_WINDOW_MS` (the
 *  calendar page's own convention, `cancel-booking.ts`). */
type Toaster = {
  success: (message: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => unknown;
  error: (message: string) => unknown;
};

const REASON_KEY: Record<ClosedDayReason, MessageKey> = {
  holiday: "business.reason.holiday", vacation: "business.reason.vacation", other: "business.reason.other",
};

/** The no-reason form drops the " · …" suffix entirely (spec 5.6.3) — `null` only on a `null` reason. */
function reasonLabel(reason: ClosedDayReason | null, locale: Locale): string | null {
  return reason ? t(m, REASON_KEY[reason], locale) : null;
}

function isReasonSelectValue(v: string): v is "none" | ClosedDayReason {
  return v === "none" || v === "holiday" || v === "vacation" || v === "other";
}

/** "Jun 11, 3:00 PM" — fixed `en-US`, independent of this card's own bilingual `locale`: the house
 *  pattern (`bookings-list.tsx`'s own `timeRange`) for a date rendered server-side first. */
function apptTime(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(startsAt));
}

/**
 * `addClosedDayAction`, minus React (DESIGN.md rule 6; mirrors `lib/branding/remove-logo.ts`'s
 * `runRemoveLogo`): a toast on success, `closedDays.added` plus `closedDays.addedTodo` when the range
 * covers appointments, with Undo calling `removeClosedDayAction` on the stored id.
 */
export async function runAddClosedDay(
  add: () => Promise<AddClosedDayResult>,
  undoRemove: (id: string) => Promise<RemoveClosedDayResult>,
  toastApi: Toaster,
  locale: Locale,
): Promise<AddClosedDayResult> {
  let r: AddClosedDayResult;
  try {
    r = await add();
  } catch {
    const error = t(m, "closedDays.saveFailed", locale);
    toastApi.error(error);
    return { ok: false, error };
  }
  if (!r.ok) {
    toastApi.error(r.error);
    return r;
  }
  const message = r.appointments > 0
    ? `${t(m, "closedDays.added", locale)} ${t(m, "closedDays.addedTodo", locale, { n: r.appointments })}`
    : t(m, "closedDays.added", locale);
  toastApi.success(message, {
    action: {
      label: t(m, "common.undo", locale),
      onClick: () => {
        void (async () => {
          let u: RemoveClosedDayResult;
          try {
            u = await undoRemove(r.id);
          } catch {
            toastApi.error(t(m, "common.actionCrashed", locale));
            return;
          }
          if (!u.ok) toastApi.error(u.error);
        })();
      },
    },
    duration: UNDO_WINDOW_MS,
  });
  return r;
}

/**
 * `removeClosedDayAction`, minus React: immediate, `closedDays.removed`, Undo calling
 * `addClosedDayAction` with `restore: true` and the exact removed range (S-47d spec 5.6.3).
 */
export async function runRemoveClosedDay(
  remove: () => Promise<RemoveClosedDayResult>,
  undoAdd: (input: AddClosedDayInput) => Promise<AddClosedDayResult>,
  toastApi: Toaster,
  locale: Locale,
): Promise<boolean> {
  let r: RemoveClosedDayResult;
  try {
    r = await remove();
  } catch {
    toastApi.error(t(m, "closedDays.saveFailed", locale));
    return false;
  }
  if (!r.ok) {
    toastApi.error(r.error);
    return false;
  }
  const removed = r.removed;
  toastApi.success(t(m, "closedDays.removed", locale), {
    action: {
      label: t(m, "common.undo", locale),
      onClick: () => {
        void (async () => {
          let u: AddClosedDayResult;
          try {
            u = await undoAdd({ from: removed.from, to: removed.to, reason: removed.reason, restore: true });
          } catch {
            toastApi.error(t(m, "common.actionCrashed", locale));
            return;
          }
          if (!u.ok) toastApi.error(u.error);
        })();
      },
    },
    duration: UNDO_WINDOW_MS,
  });
  return true;
}

/**
 * `keepAppointmentAction`, minus React: `business.card.keptToast`, Undo calling the same action with
 * `kept: false` (5.6.2's shape, reused here per Task 12's brief).
 */
export async function runKeepAppointment(
  setKept: (kept: boolean) => Promise<ActionResult>,
  toastApi: Toaster,
  locale: Locale,
): Promise<boolean> {
  let r: ActionResult;
  try {
    r = await setKept(true);
  } catch {
    toastApi.error(t(m, "business.toast.failed", locale));
    return false;
  }
  if (!r.ok) {
    toastApi.error(r.error);
    return false;
  }
  toastApi.success(t(m, "business.card.keptToast", locale), {
    action: {
      label: t(m, "common.undo", locale),
      onClick: () => {
        void (async () => {
          let u: ActionResult;
          try {
            u = await setKept(false);
          } catch {
            toastApi.error(t(m, "common.actionCrashed", locale));
            return;
          }
          if (!u.ok) toastApi.error(u.error);
        })();
      },
    },
    duration: UNDO_WINDOW_MS,
  });
  return true;
}

function AppointmentRow({
  accountId, appt, kept, locale, onKeep,
}: {
  accountId: string; appt: ClosedDaysAppointmentView; kept: boolean; locale: Locale; onKeep: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
      <span>
        <Link href={`/dashboard/accounts/${accountId}/contacts/${appt.contactId}`} className="underline-offset-2 hover:underline">
          {appt.contactName}
        </Link>
        {" — "}
        {apptTime(appt.startsAt)}
      </span>
      <span className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onKeep}>
          {kept ? t(m, "business.card.kept", locale) : t(m, "business.card.keep", locale)}
        </Button>
        <a href={`#booking-${appt.id}`} className="px-2 text-sm text-muted-foreground underline-offset-2 hover:underline">
          {t(m, "business.card.cancelOnCalendar", locale)}
        </a>
      </span>
    </li>
  );
}

export function ClosedDaysCard({
  accountId, locale, canManage, persona, today, ranges, initialOpenClosedDay,
  addAction, removeAction, keepAction,
}: {
  accountId: string;
  locale: Locale;
  /** Owners and the agency (D1, unchanged by D8) — Staff and Technicians get the list, read-only. */
  canManage: boolean;
  /** `getVoiceProfile`'s persona, already defaulted to "Sofía" — the topbar's own fallback — by the page. */
  persona: string;
  /** The account's own today (zone key), the Add form's floor. */
  today: string;
  /** `null` = the read failed; `[]` = genuinely none. */
  ranges: ClosedDaysRangeView[] | null;
  /** From a To-do's `?closedDay=`: the range whose list starts open. */
  initialOpenClosedDay: string | null;
  addAction: (input: AddClosedDayInput, locale: Locale) => Promise<AddClosedDayResult>;
  removeAction: (id: string, locale: Locale) => Promise<RemoveClosedDayResult>;
  keepAction: (bookingId: string, kept: boolean, locale: Locale) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const initialOpenId = ranges?.find((r) => r.startsOn === initialOpenClosedDay)?.id ?? null;
  const [openRangeId, setOpenRangeId] = useState<string | null>(initialOpenId);
  const [hiddenIds, setHiddenIds] = useState<Record<string, true>>({});
  const [keptOverride, setKeptOverride] = useState<Record<string, boolean>>({});
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState<"none" | ClosedDayReason>("none");

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
        <CardHeader><CardTitle>{t(m, "closedDays.title", locale)}</CardTitle></CardHeader>
        <CardContent>
          <Notice tone="warn" className="text-foreground">{t(m, "closedDays.error", locale)}</Notice>
        </CardContent>
      </Card>
    );
  }

  const visible = ranges.filter((r) => !hiddenIds[r.id]);
  const addForm = canManage ? (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="closed-day-from">{t(m, "closedDays.from", locale)}</Label>
          <Input id="closed-day-from" type="date" value={from} min={today}
            onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="closed-day-to">{t(m, "closedDays.to", locale)}</Label>
          <Input id="closed-day-to" type="date" value={to} min={from}
            onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="closed-day-reason">{t(m, "closedDays.reason", locale)}</Label>
          <Select value={reason} onValueChange={(v) => { if (isReasonSelectValue(v)) setReason(v); }}>
            <SelectTrigger id="closed-day-reason" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t(m, "business.reason.none", locale)}</SelectItem>
              <SelectItem value="holiday">{t(m, "business.reason.holiday", locale)}</SelectItem>
              <SelectItem value="vacation">{t(m, "business.reason.vacation", locale)}</SelectItem>
              <SelectItem value="other">{t(m, "business.reason.other", locale)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <SubmitButton pending={addPending}>{t(m, "closedDays.add", locale)}</SubmitButton>
    </form>
  ) : null;

  return (
    <Card id="closed-days" lang={locale} className="scroll-mt-24">
      <CardHeader><CardTitle>{t(m, "closedDays.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {visible.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">{t(m, "closedDays.empty", locale, { persona })}</p>
            {addForm}
          </>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {visible.map((range) => {
                const label = formatClosedDayRange(range.startsOn, range.endsOn, locale);
                const reasonText = reasonLabel(range.reason, locale);
                const count = range.appointments.length;
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
                            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                            onClick={() => setOpenRangeId((cur) => (cur === range.id ? null : range.id))}
                          >
                            {plural(m, "closedDays.count", count, locale, { n: count })}
                          </button>
                        ) : null}
                      </div>
                      {canManage ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleRemove(range)}>
                          {t(m, "closedDays.remove", locale)}
                        </Button>
                      ) : null}
                    </div>
                    {openRangeId === range.id && count > 0 ? (
                      <ul className="space-y-1 border-t border-[var(--line)] pt-1.5">
                        {range.appointments.map((appt) => (
                          <AppointmentRow
                            key={appt.id}
                            accountId={accountId}
                            appt={appt}
                            kept={keptOverride[appt.id] ?? appt.kept}
                            locale={locale}
                            onKeep={() => handleKeep(appt.id)}
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
