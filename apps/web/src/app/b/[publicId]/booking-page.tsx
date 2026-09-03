"use client";

import {
  useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type FormEvent,
} from "react";
import { HONEYPOT_FIELD, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { intlLocale, type BookingStrings } from "@/lib/booking/public-strings";
import { bookingStep } from "@/lib/booking/steps";
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
  /** Resolved by page.tsx from `?locale=`; drives every string and every
   *  `Intl` call below, and corrects `<html lang>` after hydration. */
  locale: PublicLocale;
  strings: BookingStrings;
  /** The account-zone calendar day this page was rendered on. */
  todayKey: string;
  maxAdvanceDays: number;
  renderToken: string;
  /** utm_source (and the other utm_* keys), gclid, fbclid — lifted off the
   *  HOST page by `embed.js`, already run through `parseAttribution`
   *  server-side by `page.tsx` and re-encoded as a query string — the
   *  identical shape `f/[publicId]/public-form.tsx` carries in its own
   *  hidden `attribution` field. */
  attribution: string;
  getSlots: (dayIso: string) => Promise<{ slots: string[] } | { error: string }>;
  submit: (formData: FormData) => Promise<BookingResult>;
};

export function BookingPage({
  locale, strings, todayKey, maxAdvanceDays, renderToken, attribution, getSlots, submit,
}: Props) {
  const intl = intlLocale(locale);
  const [weekStart, setWeekStart] = useState(todayKey);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  // Bumped by every `selectDay` call and read as a dependency of the fetch
  // effect below, so that ARMING the loading state and CLEARING it can never
  // come apart. Before this they could: re-picking the day that was already
  // selected changes `selectedDay` by nothing, so the effect did not re-run,
  // no request was ever sent, and the `true` `selectDay` had just written to
  // `loadingSlots` was never cleared — the slot grid became a permanent "…"
  // that only a page reload escaped. Today's own chip is the first thing the
  // week strip offers and starts out selected, so the very first tap a
  // visitor is most likely to make was the one that hung. Keying the effect
  // on an always-changing value also makes the error state's "Please try
  // again." honest: tapping the same day really does re-fetch it.
  const [reloadNonce, setReloadNonce] = useState(0);
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

  // Same correction `f/[publicId]/public-form.tsx` makes and for the same
  // reason: the root layout cannot read `?locale=`, so the server always
  // emits `<html lang="en">`. One tick late is the accepted gap.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Tell the host page a booking just landed, the booking twin of the form's
  // `bis-form-submitted`: the iframe boundary otherwise hides the conversion
  // from a host site's own analytics. Nothing rides in the payload; the
  // host's listener is the side that must check source and origin.
  useEffect(() => {
    if (!result?.ok || window.parent === window) return;
    window.parent.postMessage({ type: "bis-booking-submitted" }, "*");
  }, [result]);

  const lastBookableKey = useMemo(() => addDays(todayKey, maxAdvanceDays), [todayKey, maxAdvanceDays]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // No synchronous setState in the effect body itself (react-hooks/
  // set-state-in-effect): the "start loading" reset happens in `selectDay`
  // below, the event handler that actually picks a day — this effect only
  // reacts to that and resolves the fetch. The very first run needs no reset
  // at all, since `loadingSlots`/`slotsError` already start at their
  // loading-appropriate initial values. `reloadNonce` is in the dependency
  // list rather than the body on purpose: it is what guarantees this effect
  // runs — and therefore that `setLoadingSlots(false)` runs — for EVERY
  // `selectDay`, including one that re-picks the day already showing.
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
      setSlotsError(strings.genericError);
      setSlots(null);
      setLoadingSlots(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, reloadNonce, getSlots, strings.genericError]);

  function selectDay(day: string) {
    setSelectedDay(day);
    setSelectedSlot(null);
    setResult(null);
    setLoadingSlots(true);
    setSlotsError(null);
    setReloadNonce((n) => n + 1);
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
        setResult({ ok: false, error: strings.genericError });
        setLoadingSlots(false);
      }
    });
  }

  const step = bookingStep({ selectedSlot, succeeded: result?.ok === true });

  /**
   * Tell an embedding host how tall this page actually is.
   *
   * embed.js has always LISTENED for `bis-form-height` (it handles the message
   * generically, whichever path it embedded) but only `/f` ever posted it — so
   * a booking embed stayed frozen at the 560px `minHeight` the script gives it,
   * whatever the content did. That was survivable until P7 added the step row
   * and the footer, which together push the Confirm button past the fold of
   * that fixed frame on a real embedded page.
   *
   * Keyed on `step` as well as observing: the two return branches below are
   * different DOM nodes, so the observer has to be re-attached when the flow
   * moves between them.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = rootRef.current;
    if (!node || window.parent === window) return;
    const post = () => window.parent.postMessage(
      { type: "bis-form-height", height: node.getBoundingClientRect().height + 8 }, "*");
    post();
    const observer = new ResizeObserver(post);
    observer.observe(node);
    return () => observer.disconnect();
  }, [step]);

  /**
   * DESIGN.md's booking-page pattern asks for step dots. Rendered from a
   * helper because BOTH return branches below need them — the success branch
   * early-returns, so an indicator placed only in the main branch would
   * vanish at exactly the moment it reaches step 3.
   *
   * The dots do not carry the meaning on their own (DESIGN.md rule 3 forbids
   * status by colour alone): the CURRENT step's name renders as visible text,
   * and the other two stay in the accessibility tree so the list still reads
   * as a three-step flow.
   */
  const steps = (
    <ol className="bis-booking-steps" aria-label={strings.stepsLabel}>
      {([1, 2, 3] as const).map((n) => (
        <li
          key={n}
          className={`bis-booking-step${n === step ? " is-current" : ""}`}
          {...(n === step ? { "aria-current": "step" as const } : {})}
        >
          <span className="bis-booking-step-dot" aria-hidden />
          <span className="bis-booking-step-name">
            {n === 1 ? strings.step1 : n === 2 ? strings.step2 : strings.step3}
          </span>
        </li>
      ))}
    </ol>
  );

  /* Opens in a new tab: this page is routinely embedded in an iframe on the
     client's own site, and a same-tab navigation would replace the booking
     the visitor is in the middle of making. */
  const poweredBy = (
    <p className="bis-booking-poweredby">
      <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">
        {strings.poweredBy}
      </a>
    </p>
  );

  if (result?.ok) {
    return (
      <div className="bis-booking" ref={rootRef}>
        <style>{BOOKING_CSS}</style>
        {steps}
        <p role="status" className="bis-booking-success-title">{strings.successTitle}</p>
        <p className="bis-booking-success-body">{strings.successBody}</p>
        {result.cancelUrl ? (
          <p className="bis-booking-cancel-hint"><a href={result.cancelUrl}>{strings.cancelHint}</a></p>
        ) : (
          <p className="bis-booking-cancel-hint">{strings.cancelHint}</p>
        )}
        {poweredBy}
      </div>
    );
  }

  return (
    <div className="bis-booking" ref={rootRef}>
      <style>{BOOKING_CSS}</style>
      {steps}

      <div className="bis-booking-weekstrip">
        <button type="button" className="bis-booking-nav" onClick={() => goToWeek(-1)}
                disabled={!canGoPrev} aria-label={strings.previousWeek}>‹</button>
        <div className="bis-booking-days">
          {weekDays.map((day) => (
            <button
              key={day} type="button"
              className={`bis-booking-day${day === selectedDay ? " is-selected" : ""}`}
              disabled={day < todayKey || day > lastBookableKey}
              onClick={() => selectDay(day)}
            >
              {dayLabel(day, intl)}
            </button>
          ))}
        </div>
        <button type="button" className="bis-booking-nav" onClick={() => goToWeek(1)}
                disabled={!canGoNext} aria-label={strings.nextWeek}>›</button>
      </div>

      {/* Both this label and the slot times below stay a placeholder until
          `bookerTimezone` resolves client-side (I6) — rendering either against
          `null` before then is exactly the SSR/client mismatch this whole
          state (rather than `useMemo`) exists to avoid; a non-breaking space
          keeps the label's line height stable rather than collapsing to
          nothing for that one frame. */}
      <p className="bis-booking-tzlabel">
        {bookerTimezone ? strings.timezoneLabel.replace("{zone}", bookerTimezone) : " "}
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
                {/* Gated behind `bookerTimezone` resolving (never SSR-rendered — see
                    the `useSyncExternalStore` note above), but pinned to the page's
                    own tag anyway for the same house-pattern reason `dayLabel` is:
                    no Intl call on this route should depend on the visitor's device. */}
                {new Intl.DateTimeFormat(intl, {
                  hour: "numeric", minute: "2-digit", timeZone: bookerTimezone,
                }).format(new Date(iso))}
              </button>
            ))
          ) : (
            <p className="bis-booking-empty">{strings.noSlots}</p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bis-booking-form" noValidate>
          <p className="bis-booking-chosen">
            {/* Same reasoning as the slot buttons above: never SSR-rendered
                (only reachable once `selectedSlot` is set), pinned anyway. */}
            {new Intl.DateTimeFormat(intl, {
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
              {strings.changeTime}
            </button>
          </p>

          {/* The action reads this back so its error strings match the page
              the visitor is looking at — the same hidden field the sibling
              form posts, for the same reason. */}
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slotStartsAt" value={selectedSlot} />
          <input type="hidden" name="bookerTimezone" value={bookerTimezone ?? "UTC"} />
          <input type="hidden" name="attribution" value={attribution} />
          <input type="hidden" name={RENDER_TOKEN_FIELD} value={renderToken} />
          {/* Off-screen rather than display:none, same as the sibling lead
              form's honeypot: some bots skip hidden inputs but fill anything
              they can find in the DOM. */}
          <div className="bis-booking-hp" aria-hidden>
            <label htmlFor={HONEYPOT_FIELD}>Do not fill this in</label>
            <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
          </div>

          <div className="bis-booking-row">
            <label htmlFor="firstName">{strings.firstName}</label>
            <input id="firstName" name="firstName" type="text" required />
          </div>
          <div className="bis-booking-row">
            <label htmlFor="lastName">
              {strings.lastName}{" "}
              <span className="bis-booking-optional">({strings.optional})</span>
            </label>
            <input id="lastName" name="lastName" type="text" />
          </div>
          <div className="bis-booking-row">
            <label htmlFor="email">{strings.email}</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="bis-booking-row">
            <label htmlFor="phone">
              {strings.phone}{" "}
              <span className="bis-booking-optional">({strings.optional})</span>
            </label>
            <input id="phone" name="phone" type="tel" />
          </div>
          <div className="bis-booking-row">
            <label htmlFor="note">
              {strings.note}{" "}
              <span className="bis-booking-optional">({strings.optional})</span>
            </label>
            <textarea id="note" name="note" rows={3} />
          </div>

          {result && !result.ok && !result.slotTaken ? (
            <p role="alert" className="bis-booking-error">{result.error}</p>
          ) : null}

          <button type="submit" disabled={pending} className="bis-booking-submit">
            {pending ? strings.submitting : strings.submit}
          </button>
        </form>
      )}
      {poweredBy}
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
/* --public-measure is this page's own column width, read by the shared brand
   header in styles/public-brand.css. The header is a SIBLING of .bis-booking,
   not a child, so without it the client's logo hung at the far left while the
   column it heads sat centred — the bug /f had already fixed for itself. The
   three .bis-booking-brand* rules that used to live here moved to that shared
   sheet along with the form's copies of them. */
.bis-booking-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 480px; }
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
/* The token, not the literal. #b91c1c measures 2.93:1 on all three dark ramps
   — under AA, on the sentence that tells a customer their email address is
   wrong. --form-error is already emitted to this page by publicFormTheme and
   is already lifted to 4.5:1 at source (public-form-theme.ts:176); /f has read
   it since M4b and this page simply never did. */
.bis-booking-error { color: var(--form-error, #b91c1c); margin: 0 0 8px; }
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
.bis-booking-steps { display: flex; align-items: center; gap: 8px; list-style: none; margin: 0 0 12px; padding: 0; }
.bis-booking-step { display: flex; align-items: center; gap: 6px; }
.bis-booking-step-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--muted-foreground, #71717a); opacity: 0.4; }
.bis-booking-step.is-current .bis-booking-step-dot { background: var(--form-accent, #6d28d9); opacity: 1; }
/* Visually hidden, still announced — the two steps the visitor is not on.
   Only the current step's name is painted, which is what keeps the dots from
   carrying the state on colour alone (DESIGN.md rule 3). */
.bis-booking-step-name {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.bis-booking-step.is-current .bis-booking-step-name {
  position: static; width: auto; height: auto; margin: 0; overflow: visible;
  clip: auto; white-space: normal;
  font-size: 13px; color: var(--muted-foreground, #71717a);
}
.bis-booking-poweredby { margin: 24px 0 0; font-size: 12px; text-align: center; }
.bis-booking-poweredby a { color: var(--muted-foreground, #71717a); text-decoration: none; }
.bis-booking-poweredby a:hover { text-decoration: underline; }
`;
