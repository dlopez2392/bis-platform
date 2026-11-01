"use client";

import { spanishIsStale } from "@bis/db/spanish-box";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { CalendarRow } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, nativeFieldClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { Notice } from "@/components/ui/notice";
import { SpanishBodyField } from "@/components/spanish-body-field";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { DEFAULT_FOLLOWUP_BODY, defaultFollowupBody } from "@/lib/email/templates/followup";
import {
  DEFAULT_CLOSE_TIME, DEFAULT_OPEN_TIME, openHoursToRows, seedTimeOnPickerOpen,
  type WeekdayKey,
} from "./hours-form";
import type { ActionResult } from "./actions";
import { parseNotifyEmails } from "./notify-emails";
import type { Locale } from "@/lib/i18n/locale";

const dayLabel = (locale: Locale): Record<WeekdayKey, string> => ({
  mon: t(m, "calendar.settings.day.mon", locale),
  tue: t(m, "calendar.settings.day.tue", locale),
  wed: t(m, "calendar.settings.day.wed", locale),
  thu: t(m, "calendar.settings.day.thu", locale),
  fri: t(m, "calendar.settings.day.fri", locale),
  sat: t(m, "calendar.settings.day.sat", locale),
  sun: t(m, "calendar.settings.day.sun", locale),
});

const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90];
const BUFFER_OPTIONS = [0, 5, 10, 15, 30];
const NOTICE_OPTIONS = [1, 2, 4, 8, 12, 24, 48, 72];
const ADVANCE_OPTIONS = [7, 14, 30, 45, 60, 90];

const meetingTypeOptions = (locale: Locale): { value: CalendarRow["meeting_type"]; label: string }[] => [
  { value: "in_person", label: t(m, "calendar.settings.meetingType.inPerson", locale) },
  { value: "phone", label: t(m, "calendar.settings.meetingType.phone", locale) },
  { value: "video", label: t(m, "calendar.settings.meetingType.video", locale) },
];

export function CalendarSettings({
  isAgency, calendar, action,
}: {
  /** Selects the ownership voice (panel-copy.ts's mechanism, inlined here —
   *  only two strings differ, not the five branding carries). */
  isAgency: boolean;
  calendar: CalendarRow;
  action: (formData: FormData, locale: Locale) => Promise<ActionResult>;
}) {
  const locale = useLocale();
  const DAY_LABEL = dayLabel(locale);
  const MEETING_TYPE_OPTIONS = meetingTypeOptions(locale);
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

  // Task 17: C14/spec §12.3's staleness rule (`spanishIsStale`, packages/db/src/spanish-box.ts, through
  // the import-free subpath so the barrel's database client stays out of the browser bundle).
  // Reads the STORED row (plan deviation 5), not live state: a warning that flickered while
  // typing would describe an edit not yet saved.
  const followupEsStale = spanishIsStale({
    body: calendar.followup_body, bodyEs: calendar.followup_body_es, bodyEsBasis: calendar.followup_body_es_basis,
  });

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData, locale), toast, {
      success: t(m, "calendar.settings.saved", locale),
      crashed: t(m, "calendar.settings.saveCrashed", locale),
    });
  });

  // The same split the save uses (D-034), so a field of only commas warns too.
  const notifyEmailsEmpty = parseNotifyEmails(notifyEmailsText).length === 0;

  return (
    <Card id="booking-settings">
      <CardHeader>
        <CardTitle>{t(m, isAgency ? "calendar.settings.title" : "calendar.settings.clientTitle", locale)}</CardTitle>
        <CardDescription>{t(m, isAgency ? "calendar.settings.body" : "calendar.settings.clientBody", locale)}</CardDescription>
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
            <Label htmlFor="calendar-enabled">{t(m, "calendar.settings.enabled", locale)}</Label>
          </div>

          {enabled && notifyEmailsEmpty ? (
            <Notice tone="crit">{t(m, "calendar.settings.notifyEmailsWarning", locale)}</Notice>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-card-foreground">{t(m, "calendar.settings.hours", locale)}</p>
            <p className="text-xs text-muted-foreground">{t(m, "calendar.settings.hoursHint", locale)}</p>
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.day} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 shrink-0 text-sm text-card-foreground">{DAY_LABEL[row.day]}</span>
                  <Label htmlFor={`hours-${row.day}-from`} className="sr-only">
                    {t(m, "calendar.settings.from", locale)}
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
                  <span className="text-xs text-muted-foreground">{t(m, "calendar.settings.to", locale)}</span>
                  <Label htmlFor={`hours-${row.day}-to`} className="sr-only">
                    {t(m, "calendar.settings.to", locale)}
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
              <Label htmlFor="slotDurationMinutes">{t(m, "calendar.settings.duration", locale)}</Label>
              <Select name="slotDurationMinutes" defaultValue={String(calendar.slot_duration_minutes)}>
                <SelectTrigger id="slotDurationMinutes" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} {t(m, "calendar.settings.unitMinutes", locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bufferMinutes">{t(m, "calendar.settings.buffer", locale)}</Label>
              <Select name="bufferMinutes" defaultValue={String(calendar.buffer_minutes)}>
                <SelectTrigger id="bufferMinutes" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUFFER_OPTIONS.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} {t(m, "calendar.settings.unitMinutes", locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minNoticeHours">{t(m, "calendar.settings.minNotice", locale)}</Label>
              <Select name="minNoticeHours" defaultValue={String(calendar.min_notice_hours)}>
                <SelectTrigger id="minNoticeHours" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NOTICE_OPTIONS.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} {t(m, "calendar.settings.unitHours", locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxAdvanceDays">{t(m, "calendar.settings.maxAdvance", locale)}</Label>
              <Select name="maxAdvanceDays" defaultValue={String(calendar.max_advance_days)}>
                <SelectTrigger id="maxAdvanceDays" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADVANCE_OPTIONS.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} {t(m, "calendar.settings.unitDays", locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meetingType">{t(m, "calendar.settings.meetingType", locale)}</Label>
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
            <Label htmlFor="notifyEmails">{t(m, "calendar.settings.notifyEmails", locale)}</Label>
            <textarea
              id="notifyEmails" name="notifyEmails" rows={3}
              value={notifyEmailsText}
              onChange={(e) => setNotifyEmailsText(e.target.value)}
              className={nativeFieldClass}
            />
            <p className="text-xs text-muted-foreground">{t(m, "calendar.settings.notifyEmailsHint", locale)}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-card-foreground">{t(m, "calendar.settings.followup", locale)}</p>
            <p className="text-xs text-muted-foreground">{t(m, "calendar.settings.followupHint", locale)}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="followup-enabled" name="followupEnabled"
                checked={followupEnabled} onCheckedChange={(v) => setFollowupEnabled(v === true)}
              />
              <Label htmlFor="followup-enabled">{t(m, "calendar.settings.followupEnabled", locale)}</Label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="followupBody" className="sr-only">{t(m, "calendar.settings.followupBody", locale)}</Label>
                <textarea
                  id="followupBody" name="followupBody" rows={3}
                  value={followupBodyText}
                  onChange={(e) => setFollowupBodyText(e.target.value)}
                  placeholder={DEFAULT_FOLLOWUP_BODY}
                  className={nativeFieldClass}
                />
              </div>
              {/* Task 17: the Spanish box, inside this card's ONE form
                  (rule 8) — nothing here saves on its own; Save commits
                  both boxes together. */}
              <SpanishBodyField
                idPrefix="followup"
                stored={{ bodyEs: calendar.followup_body_es, stale: followupEsStale }}
                defaultEs={defaultFollowupBody("es")}
                composeEs={(x) => x}
                sms={false}
              />
            </div>
          </div>

          <SubmitButton pending={pending}>{t(m, "common.save", locale)}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
