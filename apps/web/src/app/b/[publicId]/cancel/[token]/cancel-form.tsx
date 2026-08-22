"use client";

import { useActionState } from "react";
import { m } from "@/lib/messages";
import { confirmCancelAction, type CancelResult } from "./actions";

type Props = { publicId: string; token: string };

/**
 * IMPORTANT fix: a failed cancel used to be silent. `page.tsx`'s old inline
 * server-action wrapper called `confirmCancelAction` and discarded its
 * `CancelResult` — on failure the page just re-rendered unchanged, with no
 * signal at all, and `m["booking.cancel.genericError"]` was dead code nothing
 * ever rendered. This client component is the thin layer that keeps the
 * result long enough to show it.
 *
 * `useActionState` rather than the sibling `BookingPage`'s manual
 * `useTransition` + `setState(result)`: same end state (hold the last
 * `CancelResult`, branch on `.ok`), but this form has no other client state
 * to coordinate around it (no day picker, no slot selection), so the
 * built-in pending/result pairing is the simpler fit here.
 *
 * `confirmCancelAction` itself takes `(publicId, token)`, not
 * `(prevState, formData)` — this wrapper closure is the same shape of
 * adapter the old inline `submitCancel` was, just satisfying
 * `useActionState`'s signature instead of `<form action>`'s
 * `void | Promise<void>` one.
 */
export function CancelForm({ publicId, token }: Props) {
  const [result, formAction, pending] = useActionState<CancelResult | null, FormData>(
    async () => confirmCancelAction(publicId, token),
    null,
  );

  // Success re-renders directly from the action's own result — no
  // `router.refresh()` round-trip — because a cancelled booking has exactly
  // one thing left to say, and `page.tsx`'s own `isCancelled` branch already
  // says it in identical words for a visitor who reloads this same link.
  // Reusing that message keeps the two paths from ever drifting apart.
  if (result?.ok) {
    return <p role="status" className="bis-cancel-title">{m["booking.cancel.alreadyCancelledTitle"]}</p>;
  }

  return (
    <>
      <p className="bis-cancel-title">{m["booking.cancel.confirmTitle"]}</p>
      <form action={formAction}>
        <button type="submit" disabled={pending} className="bis-cancel-submit">
          {m["booking.cancel.confirmButton"]}
        </button>
      </form>
      {result && !result.ok ? (
        <p role="alert" className="bis-cancel-error">{result.error}</p>
      ) : null}
    </>
  );
}
