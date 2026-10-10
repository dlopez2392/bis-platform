"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { intlLocale, type BookingStrings } from "@/lib/booking/public-strings";

/**
 * The week strip and the times under it, pulled out of `booking-page.tsx`
 * (F-048) so the move page offers new times with the SAME control a booker
 * picked the first time from. Markup and classes are unchanged: the e2e
 * journeys address `.bis-booking-day`, `.bis-booking-slot` and the
 * `.bis-booking-skeletons` loading state, and `booking-css.ts` styles them.
 *
 * It owns the week and the day; the page that renders it owns the chosen
 * slot (`selectedSlot`/`onPick`) and what replaces the times once one is
 * chosen (`children`: the details form, or the move's confirm card).
 */

/** Pure calendar-day arithmetic on a `YYYY-MM-DD` key — no timezone lookup,
 *  same technique `@/lib/booking/slots`'s internal `addCalendarDays` uses.
 *  `todayKey` already IS the account-zone calendar day (computed server-side
 *  by the page via `partsInZone`), so paging the week strip forward or back
 *  needs no further zone conversion — it's calendar-day math on a fixed
 *  (y, m, d) triple, done via `Date.UTC` purely for month/year rollover. */
function addDays(dayKey: string, delta: number): string {
  const [y, mo, d] = dayKey.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, mo - 1, d + delta, 12, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** A day KEY, not an instant, so this formats it with `timeZone: "UTC"`
 *  explicitly — the recorded lesson: `Intl.DateTimeFormat` formats in the
 *  SYSTEM zone by default, and every zone behind UTC would otherwise render
 *  the day before the one this key actually names. */
function dayLabel(dayKey: string, intl: "en-US" | "es-US"): string {
  // An explicit tag, never `undefined` (the house pattern — see
  // `lib/format.ts` and `intlLocale`): this renders unconditionally on the
  // FIRST paint, server and client alike, so an `undefined` locale resolves
  // to the SERVER's locale during SSR and the BROWSER's during hydration — a
  // mismatch for every visitor whose device isn't set to the server's. The
  // page's own locale is the one value both sides agree on.
  return new Intl.DateTimeFormat(intl, {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${dayKey}T12:00:00Z`));
}

// `useSyncExternalStore`, not `useEffect` + `useState` (I6): the visitor's
// device zone has no server-side answer, and nothing ever changes it within a
// session, which is exactly the shape this hook exists for — a value read
// from outside React, with no live updates to subscribe to. `subscribe`
// legitimately never fires; `getServerSnapshot` returning `null` is what
// keeps the server render and the client's FIRST (pre-hydration) render
// identical, and React itself re-renders with the real `getSnapshot` value
// right after mount — no manual effect, and no react-hooks/set-state-in-effect
// finding to justify away.
function subscribeToNothing(): () => void {
  return () => {};
}
function getBookerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function getServerBookerTimezone(): null {
  return null;
}

/** The visitor's OWN device zone, `null` on the server and on the client's
 *  first render (I6). Every page that formats a picked time calls this, so
 *  the picker and the card that restates the pick read the same zone. */
export function useBookerTimezone(): string | null {
  return useSyncExternalStore(subscribeToNothing, getBookerTimezone, getServerBookerTimezone);
}

/** "September 2026" for the strip's header — or both months when a week
 *  straddles two. */
function weekHeading(days: string[], intl: "en-US" | "es-US"): string {
  const first = days[0];
  const last = days[days.length - 1];
  // `weekDays` is always seven entries, but the checker cannot know that and
  // an empty heading is a better failure than a thrown one.
  if (!first || !last) return "";
  const fmt = (key: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intl, { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  const firstMonth = fmt(first, { month: "long" });
  const lastMonth = fmt(last, { month: "long" });
  const year = fmt(last, { year: "numeric" });
  return firstMonth === lastMonth ? `${firstMonth} ${year}` : `${firstMonth} – ${lastMonth} ${year}`;
}

/** The two halves of a day chip: "Mon" over "8". Same `timeZone: "UTC"` rule
 *  `dayLabel` documents — these are day KEYS, not instants. */
function dayParts(dayKey: string, intl: "en-US" | "es-US"): { weekday: string; date: string } {
  const at = new Date(`${dayKey}T12:00:00Z`);
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intl, { ...opts, timeZone: "UTC" }).format(at);
  return { weekday: part({ weekday: "short" }), date: part({ day: "numeric" }) };
}

export type PartOfDay = "morning" | "afternoon" | "evening";

/** Read in the BOOKER's zone — the same zone the time beside it is printed
 *  in, so a slot can never sit under a heading that contradicts its own hour. */
export function partOfDay(iso: string, timeZone: string): PartOfDay {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(new Date(iso)),
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** Reading order, empty groups dropped: a heading with nothing under it is
 *  worse than no heading at all. */
export function groupSlots(slots: string[], timeZone: string): { part: PartOfDay; slots: string[] }[] {
  const buckets: Record<PartOfDay, string[]> = { morning: [], afternoon: [], evening: [] };
  for (const iso of slots) buckets[partOfDay(iso, timeZone)].push(iso);
  return (["morning", "afternoon", "evening"] as const)
    .map((part) => ({ part, slots: buckets[part] }))
    .filter((g) => g.slots.length > 0);
}

type Fetched = { key: string; slots: string[] | null; error: string | null };

type Props = {
  locale: PublicLocale;
  strings: BookingStrings;
  /** The account-zone calendar day the page was rendered on. */
  todayKey: string;
  maxAdvanceDays: number;
  /** `bookerTimezone` from `useBookerTimezone()`, owned by the page so the
   *  card that restates the pick formats in the same zone. */
  bookerTimezone: string | null;
  getSlots: (dayIso: string) => Promise<{ slots: string[] } | { error: string }>;
  selectedSlot: string | null;
  /** A slot tapped; `null` when a day change drops the pick. */
  onPick: (iso: string | null) => void;
  /** Called on every day tap, so the page can clear a stale result. */
  onDayChange?: () => void;
  /** Bump to re-fetch the day showing (the page's slot-taken path). */
  refreshKey: number;
  /** Shown above the times, e.g. "That time was just booked." */
  notice?: ReactNode;
  /** What replaces the times once a slot is chosen. */
  children?: ReactNode;
};

export function SlotPicker({
  locale, strings, todayKey, maxAdvanceDays, bookerTimezone, getSlots,
  selectedSlot, onPick, onDayChange, refreshKey, notice, children,
}: Props) {
  const intl = intlLocale(locale);
  const [weekStart, setWeekStart] = useState(todayKey);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  // Bumped by every day tap. Before this, re-picking the day already shown
  // changed nothing the fetch depended on, so no request was sent and the
  // grid became a permanent "…" (the bug the booking page fixed); keying the
  // fetch on an always-changing value makes the error state's "Please try
  // again." honest too: tapping the same day really does re-fetch it.
  const [reloadNonce, setReloadNonce] = useState(0);
  // LOADING IS DERIVED, never armed by hand: the times on screen are the
  // answer for `fetchKey`, or the skeleton shows. Nothing can set "loading"
  // and then fail to clear it, because nothing sets it at all.
  const fetchKey = `${selectedDay}|${reloadNonce}|${refreshKey}`;
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const loadingSlots = fetched?.key !== fetchKey;

  const lastBookableKey = useMemo(() => addDays(todayKey, maxAdvanceDays), [todayKey, maxAdvanceDays]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {
    let cancelled = false;
    getSlots(selectedDay).then((r) => {
      if (cancelled) return;
      setFetched("error" in r
        ? { key: fetchKey, slots: null, error: r.error }
        : { key: fetchKey, slots: r.slots, error: null });
    }).catch((e) => {
      // A rejected server action must never leave the skeleton up forever.
      if (cancelled) return;
      console.error(`getSlots(${selectedDay}) failed client-side: ${String(e)}`);
      setFetched({ key: fetchKey, slots: null, error: strings.genericError });
    });
    return () => {
      cancelled = true;
    };
  }, [fetchKey, selectedDay, getSlots, strings.genericError]);

  function selectDay(day: string) {
    setSelectedDay(day);
    setReloadNonce((n) => n + 1);
    onPick(null);
    onDayChange?.();
  }

  function goToWeek(delta: number) {
    const next = addDays(weekStart, delta * 7);
    if (delta < 0 && next < todayKey) return; // clamp: never page before today
    setWeekStart(next);
  }

  const canGoNext = addDays(weekStart, 7) <= lastBookableKey;
  const canGoPrev = weekStart > todayKey;
  const slots = loadingSlots ? null : fetched?.slots ?? null;
  const slotsError = loadingSlots ? null : fetched?.error ?? null;

  return (
    <>
      <div className="bis-booking-monthrow">
        <p className="bis-booking-month">{weekHeading(weekDays, intl)}</p>
        <div className="bis-booking-navs">
          <button type="button" className="bis-booking-nav" onClick={() => goToWeek(-1)}
                  disabled={!canGoPrev} aria-label={strings.previousWeek}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button type="button" className="bis-booking-nav" onClick={() => goToWeek(1)}
                  disabled={!canGoNext} aria-label={strings.nextWeek}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="bis-booking-days" role="group" aria-label={weekHeading(weekDays, intl)}>
        {weekDays.map((day) => {
          const { weekday, date } = dayParts(day, intl);
          const isToday = day === todayKey;
          return (
            <button
              key={day} type="button"
              className={`bis-booking-day${day === selectedDay ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
              disabled={day < todayKey || day > lastBookableKey}
              aria-pressed={day === selectedDay}
              // The chip shows two fragments; the accessible name stays the
              // whole date, so this announces "Mon, Sep 8" rather than "Mon 8".
              aria-label={`${dayLabel(day, intl)}${isToday ? ` (${strings.today})` : ""}`}
              onClick={() => selectDay(day)}
            >
              <span className="bis-booking-day-weekday" aria-hidden="true">{weekday}</span>
              <span className="bis-booking-day-date" aria-hidden="true">{date}</span>
              {isToday ? <span className="bis-booking-day-dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      {/* Both this label and the slot times below stay a placeholder until
          `bookerTimezone` resolves client-side (I6); a non-breaking space
          keeps the label's line height stable for that one frame. */}
      <p className="bis-booking-tzlabel">
        {bookerTimezone ? strings.timezoneLabel.replace("{zone}", bookerTimezone) : " "}
      </p>

      {!selectedSlot ? (
        <div className="bis-booking-slotarea">
          {notice}
          {loadingSlots || !bookerTimezone ? (
            /* Skeletons shaped like the slots they stand in for. The bars are
               decorative; the sentence is the announcement, so the wrapper
               itself must NOT be aria-hidden. */
            <div className="bis-booking-skeletons" role="status">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="bis-booking-skeleton" aria-hidden="true" />
              ))}
              <span className="bis-booking-sr">{strings.loadingTimes}</span>
            </div>
          ) : slotsError ? (
            <p role="alert" className="bis-booking-error">{slotsError}</p>
          ) : slots && slots.length > 0 ? (
            groupSlots(slots, bookerTimezone).map(({ part, slots: group }) => (
              <section key={part} className="bis-booking-group">
                {/* Morning / afternoon / evening: the part of the day is the
                    first thing anyone actually decides. */}
                <h3 className="bis-booking-grouplabel">{strings[part]}</h3>
                <div className="bis-booking-slots">
                  {group.map((iso) => (
                    <button key={iso} type="button" className="bis-booking-slot" onClick={() => onPick(iso)}>
                      {new Intl.DateTimeFormat(intl, {
                        hour: "numeric", minute: "2-digit", timeZone: bookerTimezone,
                      }).format(new Date(iso))}
                    </button>
                  ))}
                </div>
              </section>
            ))
          ) : (
            /* An empty day says what to do next, which is the only useful
               thing an empty state can do here. */
            <div className="bis-booking-empty">
              <p className="bis-booking-empty-title">{strings.noSlots}</p>
              <p className="bis-booking-empty-hint">{strings.noSlotsHint}</p>
            </div>
          )}
        </div>
      ) : children}
    </>
  );
}
