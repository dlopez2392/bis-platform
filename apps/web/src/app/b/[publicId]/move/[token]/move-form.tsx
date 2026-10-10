"use client";

import { useState, useTransition } from "react";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { intlLocale, type BookingStrings } from "@/lib/booking/public-strings";
import { SlotPicker, useBookerTimezone } from "../../slot-picker";
import type { MoveResult } from "./actions";

type Props = {
  locale: PublicLocale;
  strings: BookingStrings;
  /** The booking's current time, already formatted server-side in the
   *  customer's own stored zone (the cancel page's rule). */
  currentWhen: string;
  todayKey: string;
  maxAdvanceDays: number;
  getSlots: (dayIso: string) => Promise<{ slots: string[] } | { error: string }>;
  submit: (slotStartsAt: string) => Promise<MoveResult>;
  /** This booking's cancel page, offered as the other way out. */
  cancelHref: string;
};

/**
 * What the move's success screen may SAY (D-033's rule, the booking page's
 * `successCopy`): an email is claimed only when the gate sent it, and the
 * link to change or cancel again is the NEW booking's. Pure.
 */
export function moveSuccessCopy(
  strings: BookingStrings, result: { manageUrl: string; emailSent: boolean },
): { body: string; hint: string; hintHref: string | null } {
  const hintHref = result.manageUrl || null;
  if (result.emailSent) return { body: strings.moveSuccessBody, hint: strings.moveManageHint, hintHref };
  return {
    body: strings.moveSuccessBodyNoEmail,
    hint: hintHref ? strings.moveManageHintNoEmail : strings.cancelHintNoEmailNoLink,
    hintHref,
  };
}

/**
 * F-048: the customer moves their own booking. The booking page's own picker
 * (`SlotPicker`), offering the day as it will be once the move commits; then
 * one card that states the new time beside the current one, and one primary
 * button. Rendered by `page.tsx` only for a live, upcoming booking; the page
 * emits the stylesheet (`booking-css.ts`) for every state, this one included.
 */
export function MoveForm({
  locale, strings, currentWhen, todayKey, maxAdvanceDays, getSlots, submit, cancelHref,
}: Props) {
  const intl = intlLocale(locale);
  const bookerTimezone = useBookerTimezone();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<MoveResult | null>(null);
  const [pending, startTransition] = useTransition();

  const fmt = (iso: string) => new Intl.DateTimeFormat(intl, {
    weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: bookerTimezone ?? "UTC",
  }).format(new Date(iso));

  function confirm() {
    if (!selectedSlot) return;
    const picked = selectedSlot;
    startTransition(async () => {
      try {
        const r = await submit(picked);
        setResult(r);
        if (!r.ok && r.slotTaken) {
          setSelectedSlot(null);
          setRefreshKey((k) => k + 1);
        }
      } catch (e) {
        console.error(`move submit failed client-side: ${String(e)}`);
        setResult({ ok: false, error: strings.moveGenericError });
      }
    });
  }

  const poweredBy = (
    <p className="bis-booking-poweredby">
      <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">{strings.poweredBy}</a>
    </p>
  );

  if (result?.ok) {
    const copy = moveSuccessCopy(strings, result);
    const calendarHref = result.calendarUrl || null;
    return (
      <div className="bis-booking">
        <div className="bis-booking-success" role="status">
          <span className="bis-booking-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <p className="bis-booking-success-title">{strings.moveSuccessTitle}</p>
          <p className="bis-booking-success-when">{fmt(result.startsAt)}</p>
          <p className="bis-booking-success-body">{copy.body}</p>
          {calendarHref ? (
            <p className="bis-booking-calendar"><a href={calendarHref}>{strings.addToCalendar}</a></p>
          ) : null}
          {copy.hintHref ? (
            <p className="bis-booking-cancel-hint"><a href={copy.hintHref}>{copy.hint}</a></p>
          ) : (
            <p className="bis-booking-cancel-hint">{copy.hint}</p>
          )}
        </div>
        {poweredBy}
      </div>
    );
  }

  return (
    <div className="bis-booking">
      <div className="bis-booking-current">
        <p className="bis-booking-chosen-label">{strings.moveCurrentLabel}</p>
        <p className="bis-booking-current-when">{currentWhen}</p>
      </div>

      {result && !result.ok && result.gone ? (
        // The booking stopped being movable while this page was open: say so,
        // and stop offering times that could never be taken.
        <p role="alert" className="bis-booking-error">{result.error}</p>
      ) : (
        <SlotPicker
          locale={locale} strings={strings} todayKey={todayKey} maxAdvanceDays={maxAdvanceDays}
          bookerTimezone={bookerTimezone} getSlots={getSlots}
          selectedSlot={selectedSlot} onPick={setSelectedSlot} onDayChange={() => setResult(null)}
          refreshKey={refreshKey}
          notice={result && !result.ok && result.slotTaken ? (
            <p role="alert" className="bis-booking-error">{result.error}</p>
          ) : null}
        >
          {selectedSlot ? (
            <div className="bis-booking-form">
              <div className="bis-booking-chosen">
                <div>
                  <p className="bis-booking-chosen-label">{strings.moveChosenLabel}</p>
                  <p className="bis-booking-chosen-when">{fmt(selectedSlot)}</p>
                </div>
                <button type="button" className="bis-booking-change" onClick={() => setSelectedSlot(null)}>
                  {strings.changeTime}
                </button>
              </div>
              {result && !result.ok && !result.slotTaken ? (
                <p role="alert" className="bis-booking-error">{result.error}</p>
              ) : null}
              <button type="button" disabled={pending} className="bis-booking-submit" onClick={confirm}>
                {pending ? strings.moveSubmitting : strings.moveSubmit}
              </button>
            </div>
          ) : null}
        </SlotPicker>
      )}

      <p className="bis-booking-alt"><a href={cancelHref}>{strings.cancelInsteadLink}</a></p>
      {poweredBy}
    </div>
  );
}
