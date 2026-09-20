"use client";

import { useEffect, useRef, useState } from "react";
import { HONEYPOT_FIELD, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import { CONCIERGE_MAX_MESSAGE_CHARS } from "@/lib/concierge/guards";
import type { ConciergeStrings } from "@/lib/concierge/strings";

type Msg = { role: "visitor" | "assistant"; text: string };

/** The shape `POST /api/concierge/<publicId>/turn` answers with — `closing`
 *  always present, empty when the turn did not end (route.ts's `quiet()`). */
export type TurnResult = { conversationId: string; reply: string; ended: boolean; closing: string };

/**
 * The ONE place that decides what a turn response renders (Important B,
 * second-round review of 108b822): a chat bubble from `reply`, or the fixed
 * closing paragraph from `closing` — never both for the same turn. `ended`
 * gates the bubble off entirely rather than trusting `reply` to be empty on
 * every ended path — the route's contract guarantees that today, but the
 * render decision does not lean on the server keeping the promise.
 */
export function pickTurnUpdate(data: TurnResult): { bubble: string | null; closing: string | null } {
  return {
    bubble: data.ended ? null : (data.reply || null),
    closing: data.ended ? (data.closing || null) : null,
  };
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
}: {
  publicId: string; greeting: string; locale: "en" | "es";
  strings: ConciergeStrings; renderToken: string;
  attribution: Record<string, string>;
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
  const conversationId = useRef<string | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);

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
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as TurnResult;
      conversationId.current = data.conversationId;
      // ONE decision, ONE sentence: `pickTurnUpdate` never returns both a
      // bubble and a closing line for the same turn (see its own doc).
      const update = pickTurnUpdate(data);
      if (update.bubble) setMessages((m) => [...m, { role: "assistant", text: update.bubble as string }]);
      if (update.closing) setEndedMessage(update.closing);
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
          the server's `closing` value (Important B) — `strings.ended` is
          only a defensive fallback for a response that broke the contract,
          never the primary source now. */}
      {ended && <p className="bis-concierge-ended" role="status">{endedMessage ?? strings.ended}</p>}

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
