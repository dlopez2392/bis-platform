"use client";

import { useEffect } from "react";

/**
 * Error boundary for the `/b` segment — the public, unauthenticated booking
 * route reached directly by a stranger with the link. Same reasoning as
 * `app/f/error.tsx`, adapted: inline CSS, no `m` message catalog (this
 * boundary must render even if the failure is somehow in a message-catalog
 * import), no shadcn primitives, and nothing that names what actually broke.
 *
 * Without this file, a thrown error anywhere in this segment (a failed
 * calendar lookup, `loadTimezone`'s now-rethrown account-read failure — see
 * I3) falls through to Next's raw global error page, on a route a real
 * person is looking at expecting to book an appointment.
 */
export default function PublicBookingError({
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
    <div style={{
      font: "400 15px/1.5 system-ui, -apple-system, \"Segoe UI\", sans-serif",
      color: "#18181b", padding: 16, maxWidth: 480, margin: "0 auto",
    }}>
      <p role="alert" style={{ fontSize: 15, marginBottom: 12 }}>
        Something went wrong. Please try again.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          font: "600 15px inherit", border: "none", borderRadius: "0.5rem",
          background: "#6d28d9", color: "#ffffff", padding: "10px 18px", cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
