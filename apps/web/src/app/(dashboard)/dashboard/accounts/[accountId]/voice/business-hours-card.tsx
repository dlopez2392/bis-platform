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
import { DEFAULT_CLOSE_TIME, DEFAULT_OPEN_TIME, seedTimeOnPickerOpen } from "../calendar/hours-form";
import { HOURS_DAYS_MONDAY_FIRST } from "@/lib/voice/knowledge/hours";
import { usableHours } from "@/lib/voice/knowledge/payload";
import { formFromHours, hoursErrorKey, hoursFromForm, type HoursFormDay, type WeekdayKey } from "@/lib/voice/knowledge/validate";
import type { ActionResult } from "./actions";

const DAY_LABEL_KEY: Record<WeekdayKey, MessageKey> = {
  mon: "voice.hours.day.mon", tue: "voice.hours.day.tue", wed: "voice.hours.day.wed",
  thu: "voice.hours.day.thu", fri: "voice.hours.day.fri", sat: "voice.hours.day.sat", sun: "voice.hours.day.sun",
};

const WEEKDAY_SET: readonly WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri"];

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

export function BusinessHoursCard({
  locale, pseudo, persona, timezone, storedHours, calendarHours, action,
}: {
  locale: "en" | "es";
  pseudo: boolean;
  persona: string;
  /** `readAccountTimezone`'s own return (page.tsx) — null only for an account whose zone was never set. */
  timezone: string | null;
  /** `profile.business_hours`. */
  storedHours: OpenHours | null;
  /** The calendar's raw `open_hours` (or null when the calendar read failed or there is none) — this
   *  card normalizes it itself with `usableHours`, exactly as `hoursFromCalendarCopy` does. */
  calendarHours: unknown;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const tr = useMemo(() => makeTr(locale, pseudo), [locale, pseudo]);
  const [open, setOpen] = useState(storedHours !== null);
  const [days, setDays] = useState<HoursFormDay[]>(() => formFromHours(storedHours));
  const calendarRows = useMemo(() => hoursFromCalendarCopy(calendarHours), [calendarHours]);
  const copyHintId = useId();
  const [clearing, startClear] = useTransition();

  const validation = useMemo(() => hoursFromForm(days), [days]);

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData), toast, {
      success: tr.text("voice.hours.saved"),
      crashed: tr.text("common.actionCrashed"),
    });
  });

  function copyFromCalendar() {
    if (!calendarRows) return;
    setDays(calendarRows);
    setOpen(true);
  }

  function toggleDayOpen(day: WeekdayKey, isOpen: boolean) {
    setDays((current) => current.map((d) => {
      if (d.day !== day) return d;
      if (isOpen && d.spans.length === 0) return { ...d, open: true, spans: [{ from: "", to: "" }] };
      return { ...d, open: isOpen };
    }));
  }

  function updateSpan(day: WeekdayKey, index: number, field: "from" | "to", value: string) {
    setDays((current) => current.map((d) => (
      d.day === day ? { ...d, spans: d.spans.map((s, i) => (i === index ? { ...s, [field]: value } : s)) } : d
    )));
  }

  function addSpan(day: WeekdayKey) {
    setDays((current) => current.map((d) => (d.day === day ? { ...d, spans: [...d.spans, { from: "", to: "" }] } : d)));
  }

  function removeSpan(day: WeekdayKey, index: number) {
    setDays((current) => current.map((d) => (
      d.day === day ? { ...d, spans: d.spans.filter((_, i) => i !== index) } : d
    )));
  }

  /** "Clear hours" (SD15): posts at once, with an Undo that re-posts the week this card held right
   *  before the clear — captured in this closure at click time, never re-read from state afterward
   *  (the `ForwardCallsCard`/`ConciergeCard` precedent, voice-settings.tsx). */
  function clear() {
    const previous = days;
    startClear(async () => {
      const fd = new FormData();
      fd.set("locale", locale);
      fd.set("intent", "clear");
      const result = await action(fd);
      if (!result.ok) { toast.error(result.error); return; }
      setDays(formFromHours(null));
      setOpen(false);
      toast.success(tr.text("voice.hours.cleared"), {
        action: {
          label: tr.text("common.undo"),
          onClick: () => startClear(async () => {
            const undoFd = new FormData();
            undoFd.set("locale", locale);
            undoFd.set("intent", "save");
            undoFd.set("days", JSON.stringify(previous));
            const r = await action(undoFd);
            if (!r.ok) { toast.error(r.error); return; }
            setDays(previous);
            setOpen(true);
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
    <p id={copyHintId} className="text-xs text-muted-foreground">{tr.text("voice.hours.copyFromCalendarNone")}</p>
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
                <Button type="button" variant="ghost" size="sm" onClick={() => { setDays(defaultHoursWeek()); setOpen(true); }}>
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

  return (
    <Card id="business-hours" lang={locale}>
      <CardHeader>
        <CardTitle>{tr.text("voice.hours.title")}</CardTitle>
        <CardDescription>{tr.text("voice.hours.body", { persona })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="days" value={JSON.stringify(days)} />
          <p className="text-xs text-muted-foreground">{tr.text("voice.hours.zone", { zone: timezone ?? "" })}</p>
          <div className="space-y-3">
            {days.map((d) => (
              <div key={d.day} className="space-y-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24 shrink-0 text-sm font-medium text-card-foreground">{tr.text(DAY_LABEL_KEY[d.day])}</span>
                  <Checkbox id={`hours-${d.day}-open`} checked={d.open} onCheckedChange={(v) => toggleDayOpen(d.day, v === true)} />
                  <Label htmlFor={`hours-${d.day}-open`}>{tr.text("voice.hours.open")}</Label>
                </div>
                {d.open ? (
                  <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[6.5rem]">
                    {d.spans.map((s, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Label htmlFor={`hours-${d.day}-${i}-from`} className="sr-only">{tr.text("voice.hours.from")}</Label>
                        <Input
                          id={`hours-${d.day}-${i}-from`} type="time" value={s.from} className="w-32"
                          onChange={(e) => updateSpan(d.day, i, "from", e.target.value)}
                          onPointerDown={(e) => { if (e.button !== 0) return; seedTimeOnPickerOpen(e.currentTarget, DEFAULT_OPEN_TIME); }}
                        />
                        <span className="text-xs text-muted-foreground">{tr.text("voice.hours.to")}</span>
                        <Label htmlFor={`hours-${d.day}-${i}-to`} className="sr-only">{tr.text("voice.hours.to")}</Label>
                        <Input
                          id={`hours-${d.day}-${i}-to`} type="time" value={s.to} className="w-32"
                          onChange={(e) => updateSpan(d.day, i, "to", e.target.value)}
                          onPointerDown={(e) => { if (e.button !== 0) return; seedTimeOnPickerOpen(e.currentTarget, DEFAULT_CLOSE_TIME); }}
                        />
                        <Button type="button" variant="ghost" size="xs" aria-label={tr.text("voice.hours.removeSpan")} onClick={() => removeSpan(d.day, i)}>
                          <X className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="xs" onClick={() => addSpan(d.day)}>
                      {tr.text("voice.hours.addSpan")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{tr.text("voice.hours.midnightHint")}</p>
          {!validation.ok ? (
            <p role="alert" className="text-xs text-[var(--crit)]">
              {tr.text(
                hoursErrorKey(validation.error),
                validation.error.code === "noDay" ? undefined : { day: tr.text(DAY_LABEL_KEY[validation.error.day]) },
              )}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton pending={pending} disabled={!validation.ok}>{tr.text("voice.hours.save")}</SubmitButton>
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
