"use client";

/**
 * S-47c (plan Task 8; spec 5.7): the Business hours card. Writes ONLY through
 * `saveBusinessHoursAction` (Task 7), which saves through the knowledge
 * snapshot RPC — so the hours and the record of what {persona} knew change in
 * one transaction. Localized like the record page's own client pieces
 * (`makeTr`, `components/ai-acts/act-undo.tsx`'s precedent for building it
 * inside a client component), never through the barrel's db client.
 */
import { useId, useMemo, useState, useTransition } from "react";
import { Clock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { makeTr } from "@/lib/record/copy";
import type { MessageKey } from "@/lib/messages";
import type { OpenHours } from "@/lib/booking/slots";
import { DEFAULT_CLOSE_TIME, DEFAULT_OPEN_TIME } from "../calendar/hours-form";
import { HOURS_DAYS_MONDAY_FIRST } from "@/lib/voice/knowledge/hours";
import { usableHours } from "@/lib/voice/knowledge/payload";
import { formFromHours, hoursErrorKey, hoursFromForm, type HoursFormDay, type WeekdayKey } from "@/lib/voice/knowledge/validate";
import { useFocusAfterRender } from "./focus-after-render";
import type { ActionResult } from "./actions";

const DAY_LABEL_KEY: Record<WeekdayKey, MessageKey> = {
  mon: "voice.hours.day.mon", tue: "voice.hours.day.tue", wed: "voice.hours.day.wed",
  thu: "voice.hours.day.thu", fri: "voice.hours.day.fri", sat: "voice.hours.day.sat", sun: "voice.hours.day.sun",
};

const WEEKDAY_SET: readonly WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri"];

/** The calendar's read, as page.tsx hands it over: a failed read is its own state, so the card never tells
 *  the operator "the calendar has no hours" when it simply could not look. */
export type CalendarRead = { ok: true; hours: unknown } | { ok: false };

/** "Set hours"' starting point (spec 5.7): Monday to Friday open, the calendar panel's own default
 *  open/close pair (`../calendar/hours-form.ts`), so the two forms suggest the same business day. */
export function defaultHoursWeek(): HoursFormDay[] {
  return HOURS_DAYS_MONDAY_FIRST.map((day) => ({
    day,
    open: WEEKDAY_SET.includes(day),
    spans: WEEKDAY_SET.includes(day) ? [{ from: DEFAULT_OPEN_TIME, to: DEFAULT_CLOSE_TIME }] : [],
  }));
}

/**
 * "Copy from calendar" (spec 5.7): the calendar's raw stored hours, normalized the same way the
 * snapshot would (`usableHours`), then shaped for the grid. Null when the calendar has no open day —
 * the ONLY thing the button's `disabled` reads. Takes no action and no db client: copying can never
 * reach the network, so a caller cannot accidentally wire it to a save.
 */
export function hoursFromCalendarCopy(calendarHours: unknown): HoursFormDay[] | null {
  const usable = usableHours(calendarHours);
  return usable ? formFromHours(usable) : null;
}

/**
 * What a primary-button press on a BLANK time field writes, so the browser's picker opens on the business
 * default instead of the wall clock (`../calendar/hours-form.ts`'s `seedTimeOnPickerOpen` explains why, and
 * why pointerdown and never focus). These fields are CONTROLLED, so the seed goes into state: writing the
 * DOM value, as the calendar's uncontrolled fields can, left React's state blank and the next render wiped
 * it (final review I2). A side that already holds a time is never touched, and then the same week is
 * returned, so React skips the render.
 */
export function seedSpanTime(days: HoursFormDay[], day: WeekdayKey, index: number, field: "from" | "to"): HoursFormDay[] {
  const d = days.find((x) => x.day === day);
  const span = d?.spans[index];
  if (!span || span[field] !== "") return days;
  const value = field === "from" ? DEFAULT_OPEN_TIME : DEFAULT_CLOSE_TIME;
  return days.map((x) => (x.day === day ? { ...x, spans: x.spans.map((s, i) => (i === index ? { ...s, [field]: value } : s)) } : x));
}

/**
 * What "Clear hours" does (SD15; design review I4), decided from the STORED hours at the moment of the click,
 * never from the grid on screen: with hours stored it saves "no hours" and its Undo re-saves exactly those
 * stored hours (an edit the operator never saved is not something an Undo should write). With nothing stored
 * there is nothing to clear on the server: the card just goes back to its empty state, no post, no toast.
 */
export function clearPlan(storedHours: OpenHours | null): { post: false } | { post: true; undoDays: HoursFormDay[] } {
  return storedHours === null ? { post: false } : { post: true, undoDays: formFromHours(storedHours) };
}

/** The validation sentence waits until the operator has typed a time or pressed Save: a day just ticked
 *  open is blank by design, and telling them so before they have had the chance to type is noise. */
export function hoursErrorVisible(
  validation: ReturnType<typeof hoursFromForm>, o: { typed: boolean; attempted: boolean },
): boolean {
  return !validation.ok && (o.typed || o.attempted);
}

export function BusinessHoursCard({
  locale, pseudo, persona, timezone, storedHours, calendar, action,
}: {
  locale: "en" | "es";
  pseudo: boolean;
  persona: string;
  /** `readAccountTimezone`'s own return (page.tsx) — null only for an account whose zone was never set. */
  timezone: string | null;
  /** `profile.business_hours`. */
  storedHours: OpenHours | null;
  /** The calendar's raw `open_hours` (null when there is no calendar), or a failed read — this card
   *  normalizes the hours itself with `usableHours`, exactly as `hoursFromCalendarCopy` does. */
  calendar: CalendarRead;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const tr = useMemo(() => makeTr(locale, pseudo), [locale, pseudo]);
  const [open, setOpen] = useState(storedHours !== null);
  const [days, setDays] = useState<HoursFormDay[]>(() => formFromHours(storedHours));
  const [typed, setTyped] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const calendarRows = useMemo(() => (calendar.ok ? hoursFromCalendarCopy(calendar.hours) : null), [calendar]);
  const baseId = useId();
  const copyHintId = `${baseId}-copy-hint`;
  const setHoursId = `${baseId}-set`;
  const addId = (day: WeekdayKey) => `${baseId}-${day}-add`;
  const focusAfterRender = useFocusAfterRender();
  const [clearing, startClear] = useTransition();

  const validation = useMemo(() => hoursFromForm(days), [days]);

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData), toast, {
      success: tr.text("voice.hours.saved"),
      crashed: tr.text("common.actionCrashed"),
    });
  });

  /** Save is never disabled for validity: an invalid week is explained on the attempt instead, so the
   *  operator always learns WHY rather than facing a dead button. */
  const submit: React.FormEventHandler<HTMLFormElement> = (e) => {
    if (!validation.ok) {
      e.preventDefault();
      setAttempted(true);
      return;
    }
    onSubmit(e);
  };

  function reset(next: HoursFormDay[], isOpen: boolean) {
    setDays(next);
    setOpen(isOpen);
    setTyped(false);
    setAttempted(false);
  }

  function copyFromCalendar() {
    if (!calendarRows) return;
    reset(calendarRows, true);
  }

  function toggleDayOpen(day: WeekdayKey, isOpen: boolean) {
    setDays((current) => current.map((d) => {
      if (d.day !== day) return d;
      if (isOpen && d.spans.length === 0) return { ...d, open: true, spans: [{ from: "", to: "" }] };
      return { ...d, open: isOpen };
    }));
  }

  function updateSpan(day: WeekdayKey, index: number, field: "from" | "to", value: string) {
    setTyped(true);
    setDays((current) => current.map((d) => (
      d.day === day ? { ...d, spans: d.spans.map((s, i) => (i === index ? { ...s, [field]: value } : s)) } : d
    )));
  }

  function addSpan(day: WeekdayKey) {
    setDays((current) => current.map((d) => (d.day === day ? { ...d, spans: [...d.spans, { from: "", to: "" }] } : d)));
  }

  /** The pressed X leaves with its span, so focus goes to the day's own "Add another time" (design review I5). */
  function removeSpan(day: WeekdayKey, index: number) {
    setDays((current) => current.map((d) => (
      d.day === day ? { ...d, spans: d.spans.filter((_, i) => i !== index) } : d
    )));
    focusAfterRender(addId(day));
  }

  /** "Clear hours" (SD15, design review I4): see `clearPlan`. The Undo's week is captured at click time,
   *  in this closure, never re-read from state afterward (the `ForwardCallsCard`/`ConciergeCard`
   *  precedent, voice-settings.tsx). */
  function clear() {
    const plan = clearPlan(storedHours);
    if (!plan.post) {
      reset(formFromHours(null), false);
      focusAfterRender(setHoursId);
      return;
    }
    startClear(async () => {
      const fd = new FormData();
      fd.set("locale", locale);
      fd.set("intent", "clear");
      const result = await action(fd);
      if (!result.ok) { toast.error(result.error); return; }
      reset(formFromHours(null), false);
      focusAfterRender(setHoursId);
      toast.success(tr.text("voice.hours.cleared"), {
        action: {
          label: tr.text("common.undo"),
          onClick: () => startClear(async () => {
            const undoFd = new FormData();
            undoFd.set("locale", locale);
            undoFd.set("intent", "save");
            undoFd.set("days", JSON.stringify(plan.undoDays));
            const r = await action(undoFd);
            if (!r.ok) { toast.error(r.error); return; }
            reset(plan.undoDays, true);
          }),
        },
      });
    });
  }

  const copyButton = (
    <Button
      type="button" variant="ghost" size="sm" disabled={!calendarRows}
      aria-describedby={!calendarRows ? copyHintId : undefined}
      onClick={copyFromCalendar}
    >
      {tr.text("voice.hours.copyFromCalendar")}
    </Button>
  );
  const copyHint = !calendarRows ? (
    <p id={copyHintId} className="text-xs text-muted-foreground">
      {tr.text(calendar.ok ? "voice.hours.copyFromCalendarNone" : "voice.hours.copyFromCalendarFailed")}
    </p>
  ) : null;

  if (!open) {
    return (
      <Card id="business-hours" lang={locale}>
        <CardHeader>
          <CardTitle>{tr.text("voice.hours.title")}</CardTitle>
          <CardDescription>{tr.text("voice.hours.body", { persona })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <EmptyState
            icon={Clock}
            title={tr.text("voice.hours.empty", { persona })}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {copyButton}
                <Button id={setHoursId} type="button" variant="ghost" size="sm" onClick={() => reset(defaultHoursWeek(), true)}>
                  {tr.text("voice.hours.setHours")}
                </Button>
              </div>
            }
          />
          {copyHint}
        </CardContent>
      </Card>
    );
  }

  const showError = hoursErrorVisible(validation, { typed, attempted });

  return (
    <Card id="business-hours" lang={locale}>
      <CardHeader>
        <CardTitle>{tr.text("voice.hours.title")}</CardTitle>
        <CardDescription>{tr.text("voice.hours.body", { persona })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="days" value={JSON.stringify(days)} />
          {timezone ? <p className="text-xs text-muted-foreground">{tr.text("voice.hours.zone", { zone: timezone })}</p> : null}
          <div className="space-y-3">
            {days.map((d) => {
              const dayName = tr.text(DAY_LABEL_KEY[d.day]);
              return (
                <div key={d.day} className="space-y-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-24 shrink-0 text-sm font-medium text-card-foreground">{dayName}</span>
                    <Checkbox
                      id={`hours-${d.day}-open`} checked={d.open} aria-label={tr.text("voice.hours.openOn", { day: dayName })}
                      onCheckedChange={(v) => toggleDayOpen(d.day, v === true)}
                    />
                    <Label htmlFor={`hours-${d.day}-open`}>{tr.text("voice.hours.open")}</Label>
                  </div>
                  {d.open ? (
                    <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[6.5rem]">
                      {d.spans.map((s, i) => (
                        // Wraps on a phone (design review I1): two 8rem time fields, the "to" and the X do not
                        // fit beside each other in a 360px card, and a span that cannot wrap pushes the page
                        // sideways. The calendar panel's rows wrap the same way (calendar-settings.tsx).
                        <div key={i} data-hours-span="" className="flex flex-wrap items-center gap-1.5">
                          <Label htmlFor={`hours-${d.day}-${i}-from`} className="sr-only">{tr.text("voice.hours.from", { day: dayName })}</Label>
                          <Input
                            id={`hours-${d.day}-${i}-from`} type="time" value={s.from} className="w-32"
                            onChange={(e) => updateSpan(d.day, i, "from", e.target.value)}
                            onPointerDown={(e) => { if (e.button !== 0) return; setDays((c) => seedSpanTime(c, d.day, i, "from")); }}
                          />
                          <span aria-hidden="true" className="text-xs text-muted-foreground">{tr.text("voice.hours.toWord")}</span>
                          <Label htmlFor={`hours-${d.day}-${i}-to`} className="sr-only">{tr.text("voice.hours.to", { day: dayName })}</Label>
                          <Input
                            id={`hours-${d.day}-${i}-to`} type="time" value={s.to} className="w-32"
                            onChange={(e) => updateSpan(d.day, i, "to", e.target.value)}
                            onPointerDown={(e) => { if (e.button !== 0) return; setDays((c) => seedSpanTime(c, d.day, i, "to")); }}
                          />
                          <Button
                            type="button" variant="ghost" size="xs" aria-label={tr.text("voice.hours.removeSpan", { day: dayName })}
                            onClick={() => removeSpan(d.day, i)}
                          >
                            <X className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                      ))}
                      <Button
                        id={addId(d.day)} type="button" variant="ghost" size="xs"
                        aria-label={tr.text("voice.hours.addSpanOn", { day: dayName })} onClick={() => addSpan(d.day)}
                      >
                        {tr.text("voice.hours.addSpan")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{tr.text("voice.hours.midnightHint")}</p>
          {/* A status, not an alert (design review D): it re-renders as the operator types, and an assertive
              region would interrupt them on every keystroke. */}
          <p role="status" className="text-xs text-[var(--crit)]">
            {showError && !validation.ok
              ? tr.text(
                hoursErrorKey(validation.error),
                validation.error.code === "noDay" ? undefined : { day: tr.text(DAY_LABEL_KEY[validation.error.day]) },
              )
              : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton pending={pending}>{tr.text("voice.hours.save")}</SubmitButton>
            {copyButton}
            <Button type="button" variant="ghost" size="sm" disabled={clearing} onClick={clear}>
              {tr.text("voice.hours.clear")}
            </Button>
          </div>
          {copyHint}
        </form>
      </CardContent>
    </Card>
  );
}
