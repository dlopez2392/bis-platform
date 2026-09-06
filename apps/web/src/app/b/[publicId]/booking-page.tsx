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

/** "September 2026" for the strip's header — or both months when a week
 *  straddles two. The month was nowhere on this page before: seven chips
 *  reading "Mon, Sep 8" gave the date but never which month you had paged
 *  into. */
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
   * Keyed on `step` for an IMMEDIATE post when the flow moves between the two
   * return branches, rather than waiting on the observer's own callback. React
   * reconciles both branches to the same `.bis-booking` node, so the ref does
   * not change and the re-attach is belt-and-braces, not a requirement.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = rootRef.current;
    if (!node || window.parent === window) return;

    const post = () => {
      // Measured to this column's BOTTOM EDGE IN THE DOCUMENT, not to its own
      // height. The brand header is a SIBLING rendered by page.tsx, not a
      // child of this component, so an element-height measurement omits it —
      // and embed.js assigns the posted number outright (no Math.max with its
      // 560px default), so under-reporting makes the host size the iframe
      // SHORTER than its content and clip the footer. That is worse than the
      // fixed frame this replaced.
      //
      // Deliberately NOT measuring <main>: it carries min-height:100vh, which
      // inside an iframe IS the iframe's own height, so posting it back would
      // feed the frame's height into itself and grow without bound.
      const bottom = node.getBoundingClientRect().bottom + window.scrollY;
      // A zero-height measurement is never a real answer — it means layout has
      // not happened yet. Posting it would collapse the host's frame to 8px,
      // which is far worse than the frame simply staying at its default for
      // one more tick until the observer fires with a real number.
      if (bottom <= 0) return;
      window.parent.postMessage({ type: "bis-form-height", height: bottom + 8 }, "*");
    };
    post();

    const observer = new ResizeObserver(post);
    observer.observe(node);
    // The brand row too: its logo has no intrinsic dimensions, so it resizes
    // when the image finally loads — after this effect first ran — and that
    // changes where this column's bottom edge sits.
    // Scoped to this column's own parent rather than the whole document: the
    // brand row is its immediate sibling, and a document-wide lookup would
    // happily bind to some other subtree's copy.
    const brand = node.parentElement?.querySelector(".bis-brand");
    if (brand) observer.observe(brand);
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
        <div className="bis-booking-success" role="status">
          {/* A mark AND the words — status is never colour alone. */}
          <span className="bis-booking-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <p className="bis-booking-success-title">{strings.successTitle}</p>
          {/* The time they booked, said back to them. Confirming without
              restating it asks a visitor to trust that the click landed on the
              row they meant. */}
          {selectedSlot ? (
            <p className="bis-booking-success-when">
              {new Intl.DateTimeFormat(intl, {
                weekday: "long", month: "long", day: "numeric",
                hour: "numeric", minute: "2-digit", timeZone: bookerTimezone ?? "UTC",
              }).format(new Date(selectedSlot))}
            </p>
          ) : null}
          <p className="bis-booking-success-body">{strings.successBody}</p>
          {result.cancelUrl ? (
            <p className="bis-booking-cancel-hint"><a href={result.cancelUrl}>{strings.cancelHint}</a></p>
          ) : (
            <p className="bis-booking-cancel-hint">{strings.cancelHint}</p>
          )}
        </div>
        {poweredBy}
      </div>
    );
  }

  return (
    <div className="bis-booking" ref={rootRef}>
      <style>{BOOKING_CSS}</style>
      {steps}

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
          `bookerTimezone` resolves client-side (I6) — rendering either against
          `null` before then is exactly the SSR/client mismatch this whole
          state (rather than `useMemo`) exists to avoid; a non-breaking space
          keeps the label's line height stable rather than collapsing to
          nothing for that one frame. */}
      <p className="bis-booking-tzlabel">
        {bookerTimezone ? strings.timezoneLabel.replace("{zone}", bookerTimezone) : " "}
      </p>

      {!selectedSlot ? (
        <div className="bis-booking-slotarea">
          {result && !result.ok && result.slotTaken ? (
            <p role="alert" className="bis-booking-error">{result.error}</p>
          ) : null}
          {loadingSlots || !bookerTimezone ? (
            /* Skeletons shaped like the slots they stand in for, rather than
               the single "…" that was here: a visitor could not tell a slow
               day from an empty one, and the layout jumped when the real
               chips arrived. */
            <div className="bis-booking-skeletons" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="bis-booking-skeleton" />
              ))}
              <span className="bis-booking-sr">{strings.loadingTimes}</span>
            </div>
          ) : slotsError ? (
            <p role="alert" className="bis-booking-error">{slotsError}</p>
          ) : slots && slots.length > 0 ? (
            groupSlots(slots, bookerTimezone).map(({ part, slots: group }) => (
              <section key={part} className="bis-booking-group">
                {/* Morning / afternoon / evening: forty identical chips in one
                    grid is a wall, and the part of the day is the first thing
                    anyone actually decides. */}
                <h3 className="bis-booking-grouplabel">{strings[part]}</h3>
                <div className="bis-booking-slots">
                  {group.map((iso) => (
                    <button key={iso} type="button" className="bis-booking-slot" onClick={() => setSelectedSlot(iso)}>
                      {/* Gated behind `bookerTimezone` resolving (never SSR-rendered — see
                          the `useSyncExternalStore` note above), but pinned to the page's
                          own tag anyway for the same house-pattern reason `dayLabel` is:
                          no Intl call on this route should depend on the visitor's device. */}
                      {new Intl.DateTimeFormat(intl, {
                        hour: "numeric", minute: "2-digit", timeZone: bookerTimezone,
                      }).format(new Date(iso))}
                    </button>
                  ))}
                </div>
              </section>
            ))
          ) : (
            /* An empty day used to be one grey sentence and a dead end. It now
               says what to do next, which is the only useful thing an empty
               state can do here. */
            <div className="bis-booking-empty">
              <p className="bis-booking-empty-title">{strings.noSlots}</p>
              <p className="bis-booking-empty-hint">{strings.noSlotsHint}</p>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bis-booking-form" noValidate>
          {/* The chosen time was a sentence with an underlined link in it. It
              is the one thing a visitor must be sure of before typing their
              details, so it is now a card that states it plainly, with the way
              back beside it rather than buried in the middle of the line. */}
          <div className="bis-booking-chosen">
            <div>
              <p className="bis-booking-chosen-label">{strings.chosenLabel}</p>
              <p className="bis-booking-chosen-when">
                {/* Same reasoning as the slot buttons above: never SSR-rendered
                    (only reachable once `selectedSlot` is set), pinned anyway. */}
                {new Intl.DateTimeFormat(intl, {
                  weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
                  // `bookerTimezone` cannot actually be null here: this branch only
                  // renders once `selectedSlot` is set, which only happens via a
                  // slot button's onClick, and those buttons themselves only
                  // render once `bookerTimezone` has resolved (the `!bookerTimezone`
                  // guard above). The `?? "UTC"` is belt-and-suspenders for the
                  // type checker, not a reachable fallback.
                  timeZone: bookerTimezone ?? "UTC",
                }).format(new Date(selectedSlot))}
              </p>
            </div>
            <button type="button" className="bis-booking-change" onClick={() => setSelectedSlot(null)}>
              {strings.changeTime}
            </button>
          </div>

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
   sheet along with the form's copies of them.

   Everything themeable still rides the same var(--token, <fallback>)
   convention that f/[publicId]/form.css established. Tints are derived from
   those same tokens with color-mix rather than introduced as new literals, so
   a client's accent colours the selected day, the today dot and the focus
   ring without anyone adding a token per shade. */
.bis-booking-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 520px; }
.bis-booking {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 16px; max-width: 520px; margin: 0 auto;
  --bis-accent: var(--form-accent, #6d28d9);
  --bis-tint: color-mix(in oklab, var(--bis-accent) 10%, transparent);
  --bis-ring: color-mix(in oklab, var(--bis-accent) 35%, transparent);
}

/* --- The month, and the week arrows ------------------------------------- */
.bis-booking-monthrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.bis-booking-month { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.bis-booking-navs { display: flex; gap: 4px; }
.bis-booking-nav {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0;
  font: inherit; color: inherit; cursor: pointer;
  border: 1px solid var(--border, #d4d4d8); border-radius: 8px;
  background: var(--card, #ffffff);
  transition: background-color 150ms ease, border-color 150ms ease;
}
.bis-booking-nav:hover:not(:disabled) { background: var(--bis-tint); border-color: var(--bis-accent); }

/* --- The week strip ------------------------------------------------------ */
.bis-booking-days {
  display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-bottom: 12px;
}
.bis-booking-day {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  font: inherit; color: inherit; cursor: pointer;
  padding: 8px 4px 10px;
  border: 1px solid var(--border, #d4d4d8); border-radius: 8px;
  background: var(--card, #ffffff);
  transition: background-color 150ms ease, border-color 150ms ease;
}
.bis-booking-day:hover:not(:disabled):not(.is-selected) { background: var(--bis-tint); border-color: var(--bis-accent); }
/* Weekday small and quiet, the date the thing you actually read. Both were
   the same size on one line before, which made seven chips a wall of text. */
.bis-booking-day-weekday {
  font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground, #71717a);
}
.bis-booking-day-date { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.1; }
.bis-booking-day.is-selected {
  border-color: var(--bis-accent); background: var(--bis-accent);
  color: var(--form-accent-foreground, #ffffff);
}
.bis-booking-day.is-selected .bis-booking-day-weekday { color: inherit; opacity: 0.8; }
/* Today is marked, not merely selectable. Nothing on the strip said which day
   was today unless it happened to be the selected one. */
.bis-booking-day-dot {
  position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 999px;
  background: var(--bis-accent);
}
.bis-booking-day.is-selected .bis-booking-day-dot { background: currentColor; }
.bis-booking-day:disabled, .bis-booking-nav:disabled { opacity: 0.35; cursor: not-allowed; }

.bis-booking-tzlabel {
  font-size: 12px; color: var(--muted-foreground, #71717a); margin: 0 0 12px;
}

/* --- Times, grouped by part of the day ----------------------------------- */
.bis-booking-slotarea { display: flex; flex-direction: column; gap: 16px; }
.bis-booking-group { display: flex; flex-direction: column; gap: 8px; }
.bis-booking-grouplabel {
  margin: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted-foreground, #71717a);
}
.bis-booking-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
.bis-booking-slot {
  font: inherit; font-variant-numeric: tabular-nums;
  border: 1px solid var(--border, #d4d4d8); border-radius: 8px;
  background: var(--card, #ffffff); color: inherit; padding: 10px 6px; cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}
/* Hover shifts the surface; the outline is reserved for focus, so a keyboard
   user can still tell where they are. Before this both did the same thing. */
.bis-booking-slot:hover { background: var(--bis-tint); border-color: var(--bis-accent); }

/* --- Loading, shaped like what is coming --------------------------------- */
.bis-booking-skeletons { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
.bis-booking-skeleton {
  height: 40px; border-radius: 8px;
  background: color-mix(in oklab, var(--foreground, #18181b) 8%, transparent);
  animation: bis-booking-pulse 1.4s ease-in-out infinite;
}
.bis-booking-skeleton:nth-child(2n) { animation-delay: 0.15s; }
.bis-booking-skeleton:nth-child(3n) { animation-delay: 0.3s; }
@keyframes bis-booking-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.bis-booking-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* --- Empty and error ------------------------------------------------------ */
.bis-booking-empty {
  border: 1px dashed var(--border, #d4d4d8); border-radius: 11px;
  padding: 20px 16px; text-align: center;
}
.bis-booking-empty-title { margin: 0; font-weight: 600; }
.bis-booking-empty-hint { margin: 4px 0 0; font-size: 13px; color: var(--muted-foreground, #71717a); }
.bis-booking-error { color: #b91c1c; margin: 0 0 8px; }

/* --- The time you picked -------------------------------------------------- */
.bis-booking-chosen {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  border: 1px solid var(--border, #d4d4d8); border-radius: 11px;
  background: var(--bis-tint);
  padding: 12px 14px; margin: 0 0 16px;
}
.bis-booking-chosen-label {
  margin: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted-foreground, #71717a);
}
.bis-booking-chosen-when { margin: 2px 0 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.bis-booking-change {
  font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--border, #d4d4d8); border-radius: 999px;
  background: var(--card, #ffffff); color: inherit; padding: 6px 12px;
  transition: border-color 150ms ease;
}
.bis-booking-change:hover { border-color: var(--bis-accent); }

/* --- The form ------------------------------------------------------------- */
.bis-booking-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.bis-booking-row label { font-size: 13px; font-weight: 500; }
.bis-booking-optional { font-weight: 400; color: var(--muted-foreground, #71717a); }
.bis-booking input[type="text"], .bis-booking input[type="email"], .bis-booking input[type="tel"], .bis-booking textarea {
  width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit;
  border: 1px solid var(--border, #d4d4d8); border-radius: 8px;
  background: var(--card, #ffffff); color: inherit;
  transition: border-color 150ms ease;
}
.bis-booking-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.bis-booking-submit {
  font: inherit; font-weight: 600; border: none; border-radius: 8px;
  background: var(--bis-accent); color: var(--form-accent-foreground, #ffffff);
  padding: 12px 18px; cursor: pointer; width: 100%;
  transition: filter 150ms ease;
}
.bis-booking-submit:hover:not(:disabled) { filter: brightness(0.94); }
.bis-booking-submit:disabled { opacity: 0.6; cursor: not-allowed; }

/* One focus treatment for every control on the page, so nothing is ever
   focused without being obviously focused. */
.bis-booking button:focus-visible,
.bis-booking input:focus-visible,
.bis-booking textarea:focus-visible,
.bis-booking a:focus-visible {
  outline: 2px solid var(--bis-accent); outline-offset: 2px;
}
.bis-booking input:focus, .bis-booking textarea:focus { border-color: var(--bis-accent); }

/* --- Booked --------------------------------------------------------------- */
.bis-booking-success {
  border: 1px solid var(--border, #d4d4d8); border-radius: 11px;
  background: var(--card, #ffffff);
  padding: 24px 20px; text-align: center;
}
.bis-booking-check {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 999px; margin-bottom: 12px;
  background: var(--bis-tint); color: var(--bis-accent);
}
.bis-booking-success-title { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 4px; }
.bis-booking-success-when { margin: 0 0 12px; font-weight: 600; }
.bis-booking-success-body { color: var(--muted-foreground, #71717a); margin: 0 0 16px; }
.bis-booking-cancel-hint { font-size: 13px; color: var(--muted-foreground, #71717a); margin: 0; }

@media (prefers-reduced-motion: reduce) {
  .bis-booking *, .bis-booking-skeleton { transition: none !important; animation: none !important; }
}
`;
