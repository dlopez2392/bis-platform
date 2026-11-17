"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { briefOffChrome, briefOffLines, type BriefOffState } from "./copy";
import { turnOffAction } from "./actions";

/**
 * The page's one decision (DESIGN.md rule 8): ask, with one PRIMARY "Turn it off"; after it, or for a link that
 * does not work, no primary at all. English and Spanish stacked, each half with its own `lang`. The answer is
 * announced (aria-live) and focus moves to the section after a press, so the keyboard never falls back to <body>.
 */
export function BriefOffForm({ token, initial }: { token: string; initial: BriefOffState }) {
  const [state, setState] = useState<BriefOffState>(initial);
  const [pending, startTransition] = useTransition();
  const section = useRef<HTMLElement>(null);
  const pressed = useRef(false);
  useEffect(() => {
    if (!pressed.current || pending) return;
    pressed.current = false;
    section.current?.focus();
  }, [state, pending]);
  const press = () => startTransition(async () => {
    pressed.current = true;
    try {
      setState((await turnOffAction(token)).state);
    } catch {
      setState("failed");
    }
  });
  const lines = briefOffLines(state);
  const chrome = briefOffChrome();
  return (
    <section ref={section} tabIndex={-1} aria-live="polite" data-testid="brief-off" data-state={state} className="bis-brief-off-section">
      <div className="bis-brief-off-lang" lang="en">
        <p className="bis-brief-off-title">{lines.titleEn}</p>
        <p className="bis-brief-off-detail">{lines.detailEn}</p>
      </div>
      <div className="bis-brief-off-lang" lang="es">
        <p className="bis-brief-off-title">{lines.titleEs}</p>
        <p className="bis-brief-off-detail">{lines.detailEs}</p>
      </div>
      {state === "ask" || state === "failed" ? (
        <p className="bis-brief-off-actions">
          <button type="button" className="bis-brief-off-primary" disabled={pending} onClick={press}>
            {chrome.button}
          </button>
        </p>
      ) : null}
      {state === "off" || state === "bad_link" ? (
        <p className="bis-brief-off-actions">
          <a className="bis-brief-off-link" href="/dashboard/preferences">
            {chrome.preferencesLink}
          </a>
        </p>
      ) : null}
    </section>
  );
}
