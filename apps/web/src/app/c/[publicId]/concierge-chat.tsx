"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HONEYPOT_FIELD, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import { CONCIERGE_MAX_MESSAGE_CHARS } from "@/lib/concierge/guards";
import type { ConciergeStrings } from "@/lib/concierge/strings";

type Msg = { role: "visitor" | "assistant"; text: string };

/** The shape `POST /api/concierge/<publicId>/turn` answers with — `closing`
 *  always present, empty when the turn did not end (route.ts's `quiet()`). */
export type TurnResult = { conversationId: string; reply: string; ended: boolean; closing: string };

type ConciergeStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * `conversationId` persistence (Item 1, Branch 2 hardening): a bare `useRef`
 * started a new conversation on every iframe load, and the bubble re-renders
 * on every host-page navigation — a visitor who asks a question on three
 * pages of a client's site got the fourth refused, reading "Something went
 * wrong," forever (`CONCIERGE_MAX_CONVERSATIONS_PER_IP` is 3 per 10
 * minutes). Keyed by `publicId` in `sessionStorage`: a page reload mid-
 * conversation continues it, a new tab after the close starts fresh.
 *
 * `getStorage` is a THUNK, never `window.sessionStorage` read eagerly — a
 * private window throws on the PROPERTY ACCESS itself, not only on a method
 * called against it — so every operation below wraps the accessor CALL in
 * its own try/catch, not just `getItem`/`setItem`/`removeItem`. That is also
 * what makes this pure and testable without a DOM (this repo has no
 * jsdom/`.tsx` infra): a fake or a throwing thunk stands in for
 * `window.sessionStorage` with no browser involved at all.
 */
export function conversationStore(
  publicId: string,
  getStorage: () => ConciergeStorageLike = () => window.sessionStorage,
) {
  const key = `bis-concierge:${publicId}`;
  return {
    read(): string | null {
      try { return getStorage().getItem(key); } catch { return null; }
    },
    write(id: string): void {
      try { getStorage().setItem(key, id); }
      catch { /* private window, cleared site data, or blocked storage */ }
    },
    clear(): void {
      try { getStorage().removeItem(key); }
      catch { /* as above */ }
    },
  };
}

/**
 * The ONE place that decides what a turn response renders (Important B,
 * second-round review of 108b822): a chat bubble from `reply`, or the fixed
 * closing paragraph from `closing` — never both for the same turn. `ended`
 * gates the bubble off entirely rather than trusting `reply` to be empty on
 * every ended path — the route's contract guarantees that today, but the
 * render decision does not lean on the server keeping the promise.
 *
 * `notice` (5a/5b seam, Step 2b, reviewer-specified fix): the too-fast first
 * message answers `{ reply: "", ended: false, closing: strings.tooFast }` at
 * 200 — a real sentence with `ended: false`. `closing` stays gated on
 * `ended` on purpose (it is the ONE fixed paragraph an ended conversation
 * gets, and a non-ended sentence is a different, transient thing — the same
 * distinction the 429 path already draws with `strings.rateLimited`), so
 * without a third field that sentence had nowhere to render: not a bubble
 * (`reply` is empty), not the closing paragraph (`ended` is false) — the
 * visitor's own message just sat there, unexplained. `notice` is the
 * un-ended-gated carrier for exactly this shape; `send()` renders it on the
 * same `.bis-concierge-error` element the 429 sentence already uses.
 */
export function pickTurnUpdate(
  data: TurnResult,
): { bubble: string | null; closing: string | null; notice: string | null } {
  return {
    bubble: data.ended ? null : (data.reply || null),
    closing: data.ended ? (data.closing || null) : null,
    notice: !data.ended && data.closing ? data.closing : null,
  };
}

/**
 * The pure decision behind `send()`'s `!res.ok` branch (Item 1, Branch 2
 * hardening). A 429 from the turn route is a real cap
 * (`CONCIERGE_MAX_CONVERSATIONS_PER_IP`/`_ACCOUNT_PER_DAY`), not a
 * permanent refusal, so it gets `strings.rateLimited` rather than the
 * generic `strings.unavailable`, and `ended` stays false — the composer
 * stays open and the conversation id already in `sessionStorage` is left
 * alone, so the visitor can try again on the same conversation. This is the
 * spec's own stated reason for choosing 429 over the anti-oracle body: "a
 * real visitor who hits one needs to know to come back later." Every other
 * non-OK status keeps the existing `unavailable` sentence.
 */
export function pickErrorUpdate(
  data: { status: number },
  strings: Pick<ConciergeStrings, "rateLimited" | "unavailable">,
): { closing: string; ended: boolean } {
  return data.status === 429
    ? { closing: strings.rateLimited, ended: false }
    : { closing: strings.unavailable, ended: false };
}

/**
 * The close producer (Task 5 review, "Esc and the close producer"): the
 * loader's own `bis-concierge-close` handling in embed-script.ts was already
 * correct and tested — what had NO producer anywhere was this side sending
 * it. Once focus moves into the iframe (which it does on open — see the
 * loader), a keydown fired inside a cross-origin iframe never reaches the
 * HOST window's own Esc listener at all, so that listener alone is dead the
 * moment a visitor starts typing. This page posts the close itself, from
 * Esc and from a header close button, to `window.parent` — same
 * `postMessage(..., "*")` shape `bis-form-redirect`/`bis-form-submitted`
 * already use on `/f`: the payload carries nothing, and the host's own
 * listener is the side that stays strict about source and origin.
 *
 * The literal is a wire contract shared with embed-script.ts, which
 * hardcodes the same string independently — a typo on either side breaks
 * the close silently, which is exactly what `concierge-chat.test.ts` pins.
 */
export const CLOSE_MESSAGE = { type: "bis-concierge-close" } as const;

/** Pure so `window.addEventListener("keydown", …)`'s handler is one line and
 *  the actual decision is testable without a DOM. */
export function shouldCloseOnKey(event: Pick<KeyboardEvent, "key">): boolean {
  return event.key === "Escape";
}

/**
 * Brand colour by message (Adopted Minor, Task 5 review): posted ONCE at
 * load, built from the exact `--form-accent`/`--form-accent-foreground`
 * values `publicFormTheme` already paints this page with (`page.tsx`'s
 * `formAccent`) — the loader's launcher matches without the colour ever
 * baking into the cached, shared snippet, where it would rot on a rebrand.
 * `data-color` on the `<script>` tag stays an operator override and always
 * wins — decided entirely on the loader side, this page just informs it.
 */
export function brandMessage(accent: string, accentForeground: string) {
  return { type: "bis-concierge-brand" as const, accent, accentForeground };
}

// `useSyncExternalStore`, not `useEffect` + `useState` (IMPORTANT 1, fix
// round 2): `window.parent !== window` has no server-side answer and nothing
// ever changes it within a session — the same "resolve on mount, without a
// mismatch" shape `booking-page.tsx`'s device-timezone read uses (I6).
// `getServerSnapshot` returning `false` keeps SSR and the first client paint
// identical (no × either way, on both the direct-link page and inside a
// frame); React re-renders with the real value right after mount, with no
// manual effect to trip `react-hooks/set-state-in-effect`.
function subscribeToNothing(): () => void {
  return () => {};
}
function getFramed(): boolean {
  return window.parent !== window;
}
function getServerFramed(): false {
  return false;
}

/**
 * The four DESIGN.md states all live here: the greeting IS the empty state
 * (rule 5 — one sentence of what appears here, and here it is the tenant's
 * own copy, so there is nothing to invent), a message-shaped skeleton is the
 * loading state (rule 7 — no spinners), a one-sentence error leaves the
 * composer usable (rule 6's spirit — no dead end), and reaching the turn cap
 * is its own copy rather than an error, because a conversation that reached
 * its cap still wants to become a lead.
 *
 * Task 4 owns `POST /api/concierge/<publicId>/turn`; this component only
 * consumes the contract the brief pins.
 */
export function ConciergeChat({
  publicId, greeting, locale, strings, renderToken, attribution,
  brandAccent, brandAccentForeground,
}: {
  publicId: string; greeting: string; locale: "en" | "es";
  strings: ConciergeStrings; renderToken: string;
  attribution: Record<string, string>;
  /** `publicFormTheme`'s own CTA pair (`formAccent`) — the same colours this
   *  page is already painting the composer's send button with, forwarded to
   *  the host page's launcher via `bis-concierge-brand`. */
  brandAccent: string; brandAccentForeground: string;
}) {
  // The greeting IS the empty state. It is the tenant's own copy, from their
  // own profile row — there is nothing to invent here.
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", text: greeting }]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  // The ONE closing sentence the server chose for this conversation (Important
  // B, second-round review of 108b822) — read from `closing`, never a fixed
  // client-side string, so an expired-page close and a turn-cap close never
  // collide into a hardcoded paragraph that contradicts whichever bubble (or
  // absence of one) the visitor already read.
  const [endedMessage, setEndedMessage] = useState<string | null>(null);
  // Read once, on mount, from `sessionStorage` — a page reload mid-
  // conversation continues it (Item 1, Branch 2 hardening). `useRef`'s
  // initializer argument runs every render but React only keeps the FIRST
  // result, so this is the standard React shape for a cheap one-time read;
  // `conversationStore(publicId).read()` is already wrapped in its own
  // try/catch and costs nothing when storage is blocked.
  const conversationId = useRef<string | null>(conversationStore(publicId).read());
  const honeypot = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // IMPORTANT 1 (fix round 2): this route is ALSO reached by a direct link —
  // the snippet card hands that link out — and there a × that posts to
  // `window.parent` does nothing. The header row renders only once React
  // knows this page is actually framed; `closeChat` and the two effects
  // below keep their own `window.parent === window` guards untouched.
  const framed = useSyncExternalStore(subscribeToNothing, getFramed, getServerFramed);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);

  // Posted once, at load: the loader's launcher paints from these exact
  // values (`window.parent === window` is the standalone-page case — this
  // route is also reachable by a direct link, not only embedded, and there
  // is no host chrome to inform then).
  useEffect(() => {
    if (window.parent === window) return;
    window.parent.postMessage(brandMessage(brandAccent, brandAccentForeground), "*");
  }, [brandAccent, brandAccentForeground]);

  // The close producer: Esc, for as long as it still reaches this window
  // (before focus moves into any nested element the iframe's own future
  // content might add) and — the case that actually matters once a visitor
  // is typing — the header close button below, which needs no keyboard
  // bubbling at all because it is a click inside this same document.
  useEffect(() => {
    if (window.parent === window) return;
    function onKeyDown(e: KeyboardEvent) {
      if (shouldCloseOnKey(e)) window.parent.postMessage(CLOSE_MESSAGE, "*");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function closeChat() {
    if (window.parent === window) return;
    window.parent.postMessage(CLOSE_MESSAGE, "*");
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending || ended) return;
    setDraft("");
    setError(null);
    setMessages((m) => [...m, { role: "visitor", text }]);
    setPending(true);
    try {
      const res = await fetch(`/api/concierge/${encodeURIComponent(publicId)}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId.current,
          text: text.slice(0, CONCIERGE_MAX_MESSAGE_CHARS),
          locale,
          attribution,
          [RENDER_TOKEN_FIELD]: renderToken,
          [HONEYPOT_FIELD]: honeypot.current?.value ?? "",
        }),
      });
      if (!res.ok) {
        // `pickErrorUpdate` is the pure decision: 429 is a real cap, not a
        // permanent refusal, and gets its own sentence without touching
        // `ended` (Item 1, Branch 2 hardening) — everything else keeps the
        // existing `unavailable` path, same visual treatment either way.
        const outcome = pickErrorUpdate({ status: res.status }, strings);
        setError(outcome.closing);
        if (outcome.ended) setEnded(true);
        return;
      }
      const data = await res.json() as TurnResult;
      conversationId.current = data.conversationId;
      // Persisted whenever the route hands back a real id, and cleared the
      // moment the conversation ends — a new tab after the close starts
      // fresh (Item 1, Branch 2 hardening).
      const store = conversationStore(publicId);
      if (data.ended) store.clear();
      else if (data.conversationId) store.write(data.conversationId);
      // ONE decision, ONE sentence: `pickTurnUpdate` never returns both a
      // bubble and a closing line for the same turn (see its own doc).
      const update = pickTurnUpdate(data);
      if (update.bubble) setMessages((m) => [...m, { role: "assistant", text: update.bubble as string }]);
      if (update.closing) setEndedMessage(update.closing);
      // A transient notice (the too-fast sentence), not a close — same
      // element the 429 path already renders through (`.bis-concierge-error`,
      // `role="status"`). The composer stays enabled and `ended`/the store
      // are untouched: this is not `.bis-concierge-ended`, which Playwright
      // reads as carrying the actual close.
      if (update.notice) setError(update.notice);
      if (data.ended) setEnded(true);
    } catch {
      // One sentence, and the composer stays usable — a visitor mid-question
      // must not be dead-ended by one failed turn.
      setError(strings.unavailable);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bis-concierge-panel">
      {/* A small header close button (ghost, tokens only) — the panel's own
          producer for bis-concierge-close. Not in concierge.css: inline
          `var(--token, fallback)` values, the same technique `page.tsx`
          already uses for the whole token set on <main>. No outline is set
          here on purpose — the browser's own default :focus-visible ring
          stays, which is what DESIGN.md's "visible focus ring" asks for.

          Rendered only when `framed` — the whole row, not just the button,
          so a direct visit to this route never shows an empty flex row
          where a control that does nothing used to sit. */}
      {framed && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={closeChat}
            aria-label={strings.close}
            style={{
              background: "transparent",
              border: 0,
              cursor: "pointer",
              color: "var(--muted-foreground, #71717a)",
              padding: 4,
              borderRadius: "var(--radius-ctl, 8px)",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
      <ol className="bis-concierge-log" aria-live="polite">
        {messages.map((msg, i) => (
          <li key={i} className={`bis-msg bis-msg-${msg.role}`}>{msg.text}</li>
        ))}
        {/* Skeleton shaped like the content, not a spinner (DESIGN.md rule 7). */}
        {pending && (
          <li className="bis-msg bis-msg-assistant bis-msg-skeleton" aria-label={strings.thinking}>
            <span /><span /><span />
          </li>
        )}
        <div ref={bottom} />
      </ol>

      {error && <p className="bis-concierge-error" role="status">{error}</p>}
      {/* Not an error state: a conversation that reached its cap still wants
          to become a lead, so the copy asks for one. The sentence itself is
          the server's `closing` value (Important B) — the `?? strings.ended`
          fallback is DROPPED (Item 5, Branch 2 hardening): a wiring
          regression that leaves `endedMessage` unset now renders NOTHING
          rather than a fixed sentence that might contradict whichever
          bubble (or absence of one) the visitor already read. */}
      {ended && endedMessage && <p className="bis-concierge-ended" role="status">{endedMessage}</p>}

      <form className="bis-concierge-composer" onSubmit={send}>
        {/* Off-screen, not display:none — some bots skip hidden inputs but
            fill anything else they find. */}
        <input
          ref={honeypot} type="text" name={HONEYPOT_FIELD}
          tabIndex={-1} autoComplete="off" aria-hidden="true"
          className="bis-hp"
        />
        <label className="bis-sr-only" htmlFor="bis-concierge-input">{strings.placeholder}</label>
        <input
          id="bis-concierge-input" value={draft} disabled={ended}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={strings.placeholder} maxLength={CONCIERGE_MAX_MESSAGE_CHARS}
          autoComplete="off"
        />
        <button type="submit" disabled={pending || ended || !draft.trim()}>
          {pending ? strings.sending : strings.send}
        </button>
      </form>
    </div>
  );
}
