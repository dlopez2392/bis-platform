"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { m } from "@/lib/messages";
import { pageLines, type UnsubscribeState } from "@/lib/consent/unsubscribe-copy";
import { unsubscribeAction, resubscribeAction } from "./actions";

/**
 * The page's one decision (spec §6; DESIGN.md rule 8, one primary per view):
 * ask → one PRIMARY "Stop emails" (decisions Q1, P2); stopped → one GHOST
 * Resubscribe (choice 27), no primary; after Resubscribe → the primary again.
 * English and Spanish stacked. The answer is announced (aria-live). After a
 * press, focus moves to the button that replaced the pressed one — or to the
 * section when the answer has none (failed, bad link) — so the keyboard never
 * falls back to <body> (review R2-m6).
 */
export function UnsubscribeForm({ token, initial, brandName }: {
  token: string; initial: UnsubscribeState; brandName: string | null;
}) {
  const [state, setState] = useState<UnsubscribeState>(initial);
  const [pending, startTransition] = useTransition();
  const section = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pressed = useRef(false);
  // After the press settles: `pending` must be false first, or the new
  // button is still disabled and cannot take focus.
  useEffect(() => {
    if (!pressed.current || pending) return;
    pressed.current = false;
    (button.current ?? section.current)?.focus();
  }, [state, pending]);
  const run = (act: (t: string) => Promise<{ state: UnsubscribeState }>) => startTransition(async () => {
    pressed.current = true;
    try {
      setState((await act(token)).state);
    } catch {
      setState("failed");
    }
  });
  const lines = pageLines(state, brandName);
  return (
    <section ref={section} tabIndex={-1} aria-live="polite" data-testid="unsubscribe" data-state={state} className="bis-unsub-section">
      <div className="bis-unsub-lang" lang="en">
        <p className="bis-unsub-title">{lines.en}</p>
        {lines.detailEn ? <p className="bis-unsub-detail">{lines.detailEn}</p> : null}
      </div>
      <div className="bis-unsub-lang" lang="es">
        <p className="bis-unsub-title">{lines.es}</p>
        {lines.detailEs ? <p className="bis-unsub-detail">{lines.detailEs}</p> : null}
      </div>
      {state === "ask" || state === "resubscribed" ? (
        <p className="bis-unsub-actions">
          <button ref={button} type="button" className="bis-unsub-primary" disabled={pending} onClick={() => run(unsubscribeAction)}>
            {m["unsubscribe.button"]}
          </button>
        </p>
      ) : null}
      {state === "stopped" ? (
        <p className="bis-unsub-actions">
          <button ref={button} type="button" className="bis-unsub-ghost" disabled={pending} onClick={() => run(resubscribeAction)}>
            {m["unsubscribe.resubscribe"]}
          </button>
        </p>
      ) : null}
    </section>
  );
}
