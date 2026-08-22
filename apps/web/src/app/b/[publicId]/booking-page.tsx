"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { HONEYPOT_FIELD, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import { m } from "@/lib/messages";
import type { BookingResult } from "./actions";

/** Pure calendar-day arithmetic on a `YYYY-MM-DD` key — no timezone lookup,
 *  same technique `@/lib/booking/slots`'s internal `addCalendarDays` uses.
 *  `todayKey` already IS the account-zone calendar day (computed server-side
 *  by `page.tsx` via `partsInZone`), so paging the week strip forward or back
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
function dayLabel(dayKey: string): string {
  return new Intl.DateTimeFormat(undefined, {
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
// finding to justify away. `useEffect`+`setState` was tried here first and
// hit exactly that rule; this hook is the sanctioned replacement for the same
// "resolve on mount, without a mismatch" need, not a workaround for the lint.
function subscribeToNothing(): () => void {
  return () => {};
}
function getBookerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function getServerBookerTimezone(): null {
  return null;
}

type Props = {
  /** The account-zone calendar day this page was rendered on. */
  todayKey: string;
  maxAdvanceDays: number;
  renderToken: string;
  getSlots: (dayIso: string) => Promise<{ slots: string[] } | { error: string }>;
  submit: (formData: FormData) => Promise<BookingResult>;
};

export function BookingPage({ todayKey, maxAdvanceDays, renderToken, getSlots, submit }: Props) {
  const [weekStart, setWeekStart] = useState(todayKey);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [pending, startTransition] = useTransition();

  // The visitor's OWN device zone (I6) — see `useSyncExternalStore` above.
  // `useMemo` still runs during SSR, where there is no browser to ask, so the
  // server render used the SERVER's zone; the client's first render then
  // asked the browser and got a different answer, which React reports as a
  // hydration mismatch and the visitor sees as the day strip and slot times
  // visibly flipping zones a moment after paint. `null` until React re-renders
  // with the real snapshot means server and client render IDENTICALLY at
  // first (nothing zone-dependent shown yet); every other Intl call on this
  // route pins an explicit `timeZone` (the account's, or literal "UTC" for a
  // day key) for the same reason — this is the one value that has no
  // server-side answer at all, by design.
  const bookerTimezone = useSyncExternalStore(
    subscribeToNothing, getBookerTimezone, getServerBookerTimezone,
  );

  const lastBookableKey = useMemo(() => addDays(todayKey, maxAdvanceDays), [todayKey, maxAdvanceDays]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // No synchronous setState in the effect body itself (react-hooks/
  // set-state-in-effect): the "start loading" reset for a NEW day happens in
  // `selectDay` below, the event handler that actually changes `selectedDay`
  // — this effect only reacts to that change and resolves the fetch. The
  // very first run needs no reset at all, since `loadingSlots`/`slotsError`
  // already start at their loading-appropriate initial values.
  useEffect(() => {
    let cancelled = false;
    getSlots(selectedDay).then((r) => {
      if (cancelled) return;
      if ("error" in r) {
        setSlotsError(r.error);
        setSlots(null);
      } else {
        setSlots(r.slots);
      }
      setLoadingSlots(false);
    }).catch((e) => {
      // Floating promise, uncaught before this (Minors): a rejected server
      // action left `loadingSlots` true forever — a permanent "…" with no
      // error and no way out short of reloading the page.
      if (cancelled) return;
      console.error(`getSlots(${selectedDay}) failed client-side: ${String(e)}`);
      setSlotsError(m["booking.public.genericError"]);
      setSlots(null);
      setLoadingSlots(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, getSlots]);

  function selectDay(day: string) {
    setSelectedDay(day);
    setSelectedSlot(null);
    setResult(null);
    setLoadingSlots(true);
    setSlotsError(null);
  }

  function goToWeek(delta: number) {
    const next = addDays(weekStart, delta * 7);
    if (delta < 0 && next < todayKey) return; // clamp: never page before today
    setWeekStart(next);
  }

  const canGoNext = addDays(weekStart, 7) <= lastBookableKey;
  const canGoPrev = weekStart > todayKey;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      // The other floating server-action promise (Minors): `submit` and the
      // re-fetch below both run unguarded before this — a rejection either
      // one threw left `pending` never resolved into a usable state: no
      // result, no error, just a submit button stuck disabled.
      try {
        const r = await submit(formData);
        setResult(r);
        if (!r.ok && r.slotTaken) {
          // The friendly path: drop back to the grid with fresh slots rather
          // than leaving the visitor staring at a form for a time that is
          // already gone.
          setSelectedSlot(null);
          setLoadingSlots(true);
          const fresh = await getSlots(selectedDay);
          if ("slots" in fresh) setSlots(fresh.slots);
          else setSlotsError(fresh.error);
          setLoadingSlots(false);
        }
      } catch (e2) {
        console.error(`booking submit failed client-side: ${String(e2)}`);
        setResult({ ok: false, error: m["booking.public.genericError"] });
        setLoadingSlots(false);
      }
    });
  }

  if (result?.ok) {
    return (
      <div className="bis-booking">
        <style>{BOOKING_CSS}</style>
        <p role="status" className="bis-booking-success-title">{m["booking.public.successTitle"]}</p>
        <p className="bis-booking-success-body">{m["booking.public.successBody"]}</p>
        {result.cancelUrl ? (
          <p className="bis-booking-cancel-hint"><a href={result.cancelUrl}>{m["booking.public.cancelHint"]}</a></p>
        ) : (
          <p className="bis-booking-cancel-hint">{m["booking.public.cancelHint"]}</p>
        )}
      </div>
    );
  }

  return (
    <div className="bis-booking">
      <style>{BOOKING_CSS}</style>

      <div className="bis-booking-weekstrip">
        <button type="button" className="bis-booking-nav" onClick={() => goToWeek(-1)}
                disabled={!canGoPrev} aria-label={m["booking.public.previousWeek"]}>‹</button>
        <div className="bis-booking-days">
          {weekDays.map((day) => (
            <button
              key={day} type="button"
              className={`bis-booking-day${day === selectedDay ? " is-selected" : ""}`}
              disabled={day < todayKey || day > lastBookableKey}
              onClick={() => selectDay(day)}
            >
              {dayLabel(day)}
            </button>
          ))}
        </div>
        <button type="button" className="bis-booking-nav" onClick={() => goToWeek(1)}
                disabled={!canGoNext} aria-label={m["booking.public.nextWeek"]}>›</button>
      </div>

      {/* Both this label and the slot times below stay a placeholder until
          `bookerTimezone` resolves client-side (I6) — rendering either against
          `null` before then is exactly the SSR/client mismatch this whole
          state (rather than `useMemo`) exists to avoid; a non-breaking space
          keeps the label's line height stable rather than collapsing to
          nothing for that one frame. */}
      <p className="bis-booking-tzlabel">
        {bookerTimezone ? m["booking.public.timezoneLabel"].replace("{zone}", bookerTimezone) : " "}
      </p>

      {!selectedSlot ? (
        <div className="bis-booking-slots">
          {result && !result.ok && result.slotTaken ? (
            <p role="alert" className="bis-booking-error">{result.error}</p>
          ) : null}
          {loadingSlots || !bookerTimezone ? (
            <p className="bis-booking-empty">…</p>
          ) : slotsError ? (
            <p role="alert" className="bis-booking-error">{slotsError}</p>
          ) : slots && slots.length > 0 ? (
            slots.map((iso) => (
              <button key={iso} type="button" className="bis-booking-slot" onClick={() => setSelectedSlot(iso)}>
                {new Intl.DateTimeFormat(undefined, {
                  hour: "numeric", minute: "2-digit", timeZone: bookerTimezone,
                }).format(new Date(iso))}
              </button>
            ))
          ) : (
            <p className="bis-booking-empty">{m["booking.public.noSlots"]}</p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bis-booking-form" noValidate>
          <p className="bis-booking-chosen">
            {new Intl.DateTimeFormat(undefined, {
              weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              // `bookerTimezone` cannot actually be null here: this branch only
              // renders once `selectedSlot` is set, which only happens via a
              // slot button's onClick, and those buttons themselves only
              // render once `bookerTimezone` has resolved (the `!bookerTimezone`
              // guard above). The `?? "UTC"` is belt-and-suspenders for the
              // type checker, not a reachable fallback.
              timeZone: bookerTimezone ?? "UTC",
            }).format(new Date(selectedSlot))}
            {" — "}
            <button type="button" className="bis-booking-link" onClick={() => setSelectedSlot(null)}>
              {m["booking.public.changeTime"]}
            </button>
          </p>

          <input type="hidden" name="slotStartsAt" value={selectedSlot} />
          <input type="hidden" name="bookerTimezone" value={bookerTimezone ?? "UTC"} />
          <input type="hidden" name={RENDER_TOKEN_FIELD} value={renderToken} />
          {/* Off-screen rather than display:none, same as the sibling lead
              form's honeypot: some bots skip hidden inputs but fill anything
              they can find in the DOM. */}
          <div className="bis-booking-hp" aria-hidden>
            <label htmlFor={HONEYPOT_FIELD}>Do not fill this in</label>
            <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
          </div>

          <div className="bis-booking-row">
            <label htmlFor="firstName">{m["booking.public.firstName"]}</label>
            <input id="firstName" name="firstName" type="text" required />
          </div>
          <div className="bis-booking-row">
            <label htmlFor="lastName">
              {m["booking.public.lastName"]}{" "}
              <span className="bis-booking-optional">({m["booking.public.optional"]})</span>
            </label>
            <input id="lastName" name="lastName" type="text" />
          </div>
          <div className="bis-booking-row">
            <label htmlFor="email">{m["booking.public.email"]}</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="bis-booking-row">
            <label htmlFor="phone">
              {m["booking.public.phone"]}{" "}
              <span className="bis-booking-optional">({m["booking.public.optional"]})</span>
            </label>
            <input id="phone" name="phone" type="tel" />
          </div>
          <div className="bis-booking-row">
            <label htmlFor="note">
              {m["booking.public.note"]}{" "}
              <span className="bis-booking-optional">({m["booking.public.optional"]})</span>
            </label>
            <textarea id="note" name="note" rows={3} />
          </div>

          {result && !result.ok && !result.slotTaken ? (
            <p role="alert" className="bis-booking-error">{result.error}</p>
          ) : null}

          <button type="submit" disabled={pending} className="bis-booking-submit">
            {pending ? m["booking.public.submitting"] : m["booking.public.submit"]}
          </button>
        </form>
      )}
    </div>
  );
}

// Every themeable value rides the same `var(--token, <fallback>)` convention
// `f/[publicId]/form.css` established — an unthemed account renders exactly
// these fallbacks, a themed one inherits the tokens `publicFormTheme` already
// put on `<main>` in page.tsx. Embedded here rather than a new stylesheet:
// this route has no other CSS file, and this is the one client component on
// it, rendered (and therefore this tag emitted) on both the server-rendered
// first paint and after hydration alike — including the brand header markup
// `page.tsx` renders as this component's sibling.
const BOOKING_CSS = `
.bis-booking-page { background: var(--background, transparent); min-height: 100vh; }
.bis-booking-brand { display: flex; align-items: center; gap: 8px; padding: 16px 16px 0; }
.bis-booking-brand-logo { width: 28px; height: 28px; object-fit: contain; }
.bis-booking-brand-name { font: 600 15px var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif); color: var(--foreground, #18181b); }
.bis-booking {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 16px; max-width: 480px; margin: 0 auto;
}
.bis-booking-weekstrip { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.bis-booking-days { display: flex; flex: 1; gap: 4px; overflow-x: auto; }
.bis-booking-day, .bis-booking-nav {
  font: inherit; border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius, 0.5rem);
  background: var(--card, #ffffff); color: inherit; padding: 8px 6px; cursor: pointer; min-width: 56px;
}
.bis-booking-nav { min-width: 32px; padding: 8px; }
.bis-booking-day.is-selected {
  border-color: var(--form-accent, #6d28d9); background: var(--form-accent, #6d28d9);
  color: var(--form-accent-foreground, #ffffff);
}
.bis-booking-day:disabled, .bis-booking-nav:disabled { opacity: 0.35; cursor: not-allowed; }
.bis-booking-tzlabel { font-size: 12px; color: var(--muted-foreground, #71717a); margin: 0 0 12px; }
.bis-booking-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
.bis-booking-slot {
  font: inherit; border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius, 0.5rem);
  background: var(--card, #ffffff); color: inherit; padding: 8px 6px; cursor: pointer;
}
.bis-booking-slot:hover, .bis-booking-slot:focus-visible {
  outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 1px; border-color: var(--form-accent, #6d28d9);
}
.bis-booking-empty { color: var(--muted-foreground, #71717a); grid-column: 1 / -1; }
.bis-booking-error { color: #b91c1c; margin: 0 0 8px; }
.bis-booking-chosen { margin: 0 0 16px; }
.bis-booking-link { font: inherit; background: none; border: none; padding: 0; color: var(--form-accent, #6d28d9); text-decoration: underline; cursor: pointer; }
.bis-booking-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.bis-booking-row label { font-size: 13px; font-weight: 500; }
.bis-booking-optional { font-weight: 400; color: var(--muted-foreground, #71717a); }
.bis-booking input[type="text"], .bis-booking input[type="email"], .bis-booking input[type="tel"], .bis-booking textarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px; font: inherit;
  border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius, 0.5rem);
  background: var(--card, #ffffff); color: inherit;
}
.bis-booking input:focus, .bis-booking textarea:focus {
  outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 1px; border-color: var(--form-accent, #6d28d9);
}
.bis-booking-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.bis-booking-submit {
  font: 600 15px inherit; border: none; border-radius: var(--radius, 0.5rem);
  background: var(--form-accent, #6d28d9); color: var(--form-accent-foreground, #ffffff);
  padding: 10px 18px; cursor: pointer;
}
.bis-booking-submit:disabled { opacity: 0.6; cursor: not-allowed; }
.bis-booking-success-title { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
.bis-booking-success-body { color: var(--muted-foreground, #71717a); margin: 0 0 16px; }
.bis-booking-cancel-hint { font-size: 13px; color: var(--muted-foreground, #71717a); }
`;
