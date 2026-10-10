"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { HONEYPOT_FIELD, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { intlLocale, type BookingStrings } from "@/lib/booking/public-strings";
import { bookingStep } from "@/lib/booking/steps";
import type { BookingResult } from "./actions";
import { SlotPicker, useBookerTimezone } from "./slot-picker";
import { BOOKING_CSS } from "./booking-css";

// The week strip, the day chips and the grouped times moved to
// `slot-picker.tsx` (F-048), which the move page renders too; the
// stylesheet moved to `booking-css.ts`.

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

/**
 * What the success screen may SAY (D-033). It used to promise "We've sent a
 * confirmation to your email" and point the cancel hint at that email
 * whatever happened to the send. Now the claim follows the action's
 * `confirmationSent`: with no email, the body says so and the link on this
 * screen — the only copy left — is what the hint asks the booker to keep.
 * Pure, so the decision is tested without driving the whole form.
 */
export function successCopy(
  strings: BookingStrings, result: { cancelUrl: string; confirmationSent: boolean },
): { body: string; cancelHint: string; cancelHref: string | null } {
  const cancelHref = result.cancelUrl || null;
  if (result.confirmationSent) {
    return { body: strings.successBody, cancelHint: strings.cancelHint, cancelHref };
  }
  return {
    body: strings.successBodyNoEmail,
    cancelHint: cancelHref ? strings.cancelHintNoEmail : strings.cancelHintNoEmailNoLink,
    cancelHref,
  };
}

/**
 * F-048: the add-to-calendar link on the success screen, beside the cancel
 * hint. Null without a url (no origin), the same never-a-link-to-nowhere rule
 * the cancel hint keeps. Pure, like `successCopy`.
 */
export function calendarLink(
  strings: BookingStrings, result: { calendarUrl: string },
): { href: string; label: string } | null {
  return result.calendarUrl ? { href: result.calendarUrl, label: strings.addToCalendar } : null;
}

export function BookingPage({
  locale, strings, todayKey, maxAdvanceDays, renderToken, attribution, getSlots, submit,
}: Props) {
  const intl = intlLocale(locale);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  // Bumped to make the picker re-fetch the day showing: the slot-taken path.
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [pending, startTransition] = useTransition();

  // The visitor's OWN device zone (I6) — see `useBookerTimezone` in
  // ./slot-picker.tsx. `null` on the server and the first client render, so
  // the two render IDENTICALLY; every other Intl call on this route pins an
  // explicit `timeZone` for the same reason.
  const bookerTimezone = useBookerTimezone();

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
          setRefreshKey((k) => k + 1);
        }
      } catch (e2) {
        console.error(`booking submit failed client-side: ${String(e2)}`);
        setResult({ ok: false, error: strings.genericError });
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
    const copy = successCopy(strings, result);
    const calendar = calendarLink(strings, result);
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
          <p className="bis-booking-success-body">{copy.body}</p>
          {calendar ? (
            <p className="bis-booking-calendar"><a href={calendar.href}>{calendar.label}</a></p>
          ) : null}
          {copy.cancelHref ? (
            <p className="bis-booking-cancel-hint"><a href={copy.cancelHref}>{copy.cancelHint}</a></p>
          ) : (
            <p className="bis-booking-cancel-hint">{copy.cancelHint}</p>
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

      <SlotPicker
        locale={locale} strings={strings} todayKey={todayKey} maxAdvanceDays={maxAdvanceDays}
        bookerTimezone={bookerTimezone} getSlots={getSlots}
        selectedSlot={selectedSlot} onPick={setSelectedSlot} onDayChange={() => setResult(null)}
        refreshKey={refreshKey}
        notice={result && !result.ok && result.slotTaken ? (
          <p role="alert" className="bis-booking-error">{result.error}</p>
        ) : null}
      >
        {/* Only once a slot is chosen: the picker shows the times until then. */}
        {selectedSlot ? (
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
        ) : null}
      </SlotPicker>
      {poweredBy}
    </div>
  );
}
