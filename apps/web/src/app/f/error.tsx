"use client";

import { useEffect } from "react";
import "./[publicId]/form.css";

/**
 * Error boundary for the `/f` segment — the public, unauthenticated form
 * route embedded on a client's own site. Uses the same plain CSS as the form
 * itself and nothing else: no dashboard components, no `m` message catalog,
 * no shadcn primitives. That mirrors why `app/f/layout.tsx` does not inherit
 * the dashboard's root layout.
 *
 * Without this file, a thrown error anywhere in this segment (a failed form
 * lookup, a guard's DB call escaping `actions.ts`) falls through to Next's
 * raw global error page — on the client's own website, inside their embed.
 */
export default function PublicFormError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged for developer diagnosis only — the raw message and stack are
    // never surfaced to the visitor.
    console.error(error);
  }, [error]);

  return (
    <div className="bis-form">
      <p role="alert" className="bis-form-error" style={{ fontSize: 15, marginBottom: 12 }}>
        Something went wrong. Please try again.
      </p>
      <button type="button" onClick={() => reset()} className="bis-form-submit">
        Try again
      </button>
    </div>
  );
}
