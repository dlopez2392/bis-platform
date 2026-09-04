"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { CalendarRow } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { DEFAULT_FOLLOWUP_BODY } from "@/lib/email/templates/followup";
import {
  DEFAULT_CLOSE_TIME, DEFAULT_OPEN_TIME, openHoursToRows, seedTimeOnPickerOpen,
  type WeekdayKey,
} from "./hours-form";
import type { ActionResult } from "./actions";

const DAY_LABEL: Record<WeekdayKey, string> = {
  mon: m["calendar.settings.day.mon"],
  tue: m["calendar.settings.day.tue"],
  wed: m["calendar.settings.day.wed"],
  thu: m["calendar.settings.day.thu"],
  fri: m["calendar.settings.day.fri"],
  sat: m["calendar.settings.day.sat"],
  sun: m["calendar.settings.day.sun"],
};

const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90];
const BUFFER_OPTIONS = [0, 5, 10, 15, 30];
const NOTICE_OPTIONS = [1, 2, 4, 8, 12, 24, 48, 72];
const ADVANCE_OPTIONS = [7, 14, 30, 45, 60, 90];

const MEETING_TYPE_OPTIONS: { value: CalendarRow["meeting_type"]; label: string }[] = [
  { value: "in_person", label: m["calendar.settings.meetingType.inPerson"] },
  { value: "phone", label: m["calendar.settings.meetingType.phone"] },
  { value: "video", label: m["calendar.settings.meetingType.video"] },
];

export function CalendarSettings({
  isAgency, calendar, action,
}: {
  /** Selects the ownership voice (panel-copy.ts's mechanism, inlined here —
   *  only two strings differ, not the five branding carries). */
  isAgency: boolean;
  calendar: CalendarRow;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [enabled, setEnabled] = useState(calendar.enabled);
  const [notifyEmailsText, setNotifyEmailsText] = useState(calendar.notify_emails.join("\n"));
  const [followupEnabled, setFollowupEnabled] = useState(calendar.followup_enabled);
  // Seeded with the STORED value ONLY — never the default. This form
  // submits `followupBodyText` on every save, including saves of unrelated
  // fields, so seeding it with `DEFAULT_FOLLOWUP_BODY` would silently pin
  // the frozen default into the column on the operator's next unrelated
  // save, breaking the contract that an empty column keeps using the LIVE
  // default at send time (`bookingFollowupEmail` in followup.ts). The
  // operator still sees exactly what will go out: the empty textarea shows
  // `DEFAULT_FOLLOWUP_BODY` as its `placeholder` below — greyed, not a real
  // value, so typing replaces it instead of appending to it.
  // `DEFAULT_FOLLOWUP_BODY` is imported, not copy-pasted, so the preview can
  // never drift from what `bookingFollowupEmail` actually falls back to.
  const [followupBodyText, setFollowupBodyText] = useState(calendar.followup_body);
  const rows = useMemo(() => openHoursToRows(calendar.open_hours), [calendar.open_hours]);

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData), toast, {
      success: m["calendar.settings.saved"],
      crashed: m["calendar.settings.saveCrashed"],
    });
  });

  const notifyEmailsEmpty = notifyEmailsText
    .split("\n").map((s) => s.trim()).filter(Boolean).length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isAgency ? m["calendar.settings.title"] : m["calendar.settings.clientTitle"]}</CardTitle>
        <CardDescription>{isAgency ? m["calendar.settings.body"] : m["calendar.settings.clientBody"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          // onSubmit via useFormSubmit, NOT the `action` prop: React resets an
          // action-prop form even when the action resolves to {ok:false}, and
          // the five Selects below listen for that reset and revert to their
          // first-render values — so a refused save silently discarded the
          // operator's choices and the retry wrote the stale ones. See
          // lib/forms/use-form-submit.ts.
          //
          // notifyActionResult stays, for its own reason: a Save clicked in a
          // tab that predates the current deployment REJECTS (stale
          // server-action id) rather than returning {ok:false}, and that
          // failure must reach the operator as a toast, never vanish
          // (2026-08-29, live).
          onSubmit={onSubmit}
          className="space-y-6"
        >
          <div className="flex items-center gap-2">
            <Checkbox
              id="calendar-enabled" name="enabled"
              checked={enabled} onCheckedChange={(v) => setEnabled(v === true)}
            />
            <Label htmlFor="calendar-enabled">{m["calendar.settings.enabled"]}</Label>
          </div>

          {enabled && notifyEmailsEmpty ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {m["calendar.settings.notifyEmailsWarning"]}
            </p>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-card-foreground">{m["calendar.settings.hours"]}</p>
            <p className="text-xs text-muted-foreground">{m["calendar.settings.hoursHint"]}</p>
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.day} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 shrink-0 text-sm text-card-foreground">{DAY_LABEL[row.day]}</span>
                  <Label htmlFor={`hours-${row.day}-from`} className="sr-only">
                    {m["calendar.settings.from"]}
                  </Label>
                  <Input
                    id={`hours-${row.day}-from`} name={`hours_${row.day}_from`}
                    type="time" defaultValue={row.from} className="w-32"
                    // `onPointerDown`, never `onFocus` — see the long note on
                    // `seedTimeOnPickerOpen`. Pointerdown runs before the
                    // browser's own default action for the press, so the
                    // picker is already looking at 08:00 when it opens, while
                    // a focus ring arriving by Tab changes nothing. Guarded
                    // to the primary button: a right- or middle-click never
                    // opens the picker, so a write here would have no
                    // purpose and would just be one more way to seed a field
                    // the operator never meant to touch.
                    onPointerDown={(e) => { if (e.button !== 0) return; seedTimeOnPickerOpen(e.currentTarget, DEFAULT_OPEN_TIME); }}
                  />
                  <span className="text-xs text-muted-foreground">{m["calendar.settings.to"]}</span>
                  <Label htmlFor={`hours-${row.day}-to`} className="sr-only">
                    {m["calendar.settings.to"]}
                  </Label>
                  <Input
                    id={`hours-${row.day}-to`} name={`hours_${row.day}_to`}
                    type="time" defaultValue={row.to} className="w-32"
                    onPointerDown={(e) => { if (e.button !== 0) return; seedTimeOnPickerOpen(e.currentTarget, DEFAULT_CLOSE_TIME); }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="slotDurationMinutes">{m["calendar.settings.duration"]}</Label>
              <Select name="slotDurationMinutes" defaultValue={String(calendar.slot_duration_minutes)}>
                <SelectTrigger id="slotDurationMinutes" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bufferMinutes">{m["calendar.settings.buffer"]}</Label>
              <Select name="bufferMinutes" defaultValue={String(calendar.buffer_minutes)}>
                <SelectTrigger id="bufferMinutes" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUFFER_OPTIONS.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minNoticeHours">{m["calendar.settings.minNotice"]}</Label>
              <Select name="minNoticeHours" defaultValue={String(calendar.min_notice_hours)}>
                <SelectTrigger id="minNoticeHours" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NOTICE_OPTIONS.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} hr</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxAdvanceDays">{m["calendar.settings.maxAdvance"]}</Label>
              <Select name="maxAdvanceDays" defaultValue={String(calendar.max_advance_days)}>
                <SelectTrigger id="maxAdvanceDays" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADVANCE_OPTIONS.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} days</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meetingType">{m["calendar.settings.meetingType"]}</Label>
              <Select name="meetingType" defaultValue={calendar.meeting_type}>
                <SelectTrigger id="meetingType" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEETING_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notifyEmails">{m["calendar.settings.notifyEmails"]}</Label>
            <textarea
              id="notifyEmails" name="notifyEmails" rows={3}
              value={notifyEmailsText}
              onChange={(e) => setNotifyEmailsText(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">{m["calendar.settings.notifyEmailsHint"]}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-card-foreground">{m["calendar.settings.followup"]}</p>
            <p className="text-xs text-muted-foreground">{m["calendar.settings.followupHint"]}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="followup-enabled" name="followupEnabled"
                checked={followupEnabled} onCheckedChange={(v) => setFollowupEnabled(v === true)}
              />
              <Label htmlFor="followup-enabled">{m["calendar.settings.followupEnabled"]}</Label>
            </div>
            <Label htmlFor="followupBody" className="sr-only">{m["calendar.settings.followupBody"]}</Label>
            <textarea
              id="followupBody" name="followupBody" rows={3}
              value={followupBodyText}
              onChange={(e) => setFollowupBodyText(e.target.value)}
              placeholder={DEFAULT_FOLLOWUP_BODY}
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
