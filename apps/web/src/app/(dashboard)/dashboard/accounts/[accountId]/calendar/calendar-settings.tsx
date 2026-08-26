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
import {
  DEFAULT_CLOSE_TIME, DEFAULT_OPEN_TIME, openHoursToRows, seededTime,
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
  const rows = useMemo(() => openHoursToRows(calendar.open_hours), [calendar.open_hours]);

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
          action={async (formData) => {
            const result = await action(formData);
            if (result.ok) toast.success(m["calendar.settings.saved"]);
            else toast.error(result.error);
          }}
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
                    onFocus={(e) => {
                      e.currentTarget.value = seededTime(e.currentTarget.value, DEFAULT_OPEN_TIME);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{m["calendar.settings.to"]}</span>
                  <Label htmlFor={`hours-${row.day}-to`} className="sr-only">
                    {m["calendar.settings.to"]}
                  </Label>
                  <Input
                    id={`hours-${row.day}-to`} name={`hours_${row.day}_to`}
                    type="time" defaultValue={row.to} className="w-32"
                    onFocus={(e) => {
                      e.currentTarget.value = seededTime(e.currentTarget.value, DEFAULT_CLOSE_TIME);
                    }}
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

          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
