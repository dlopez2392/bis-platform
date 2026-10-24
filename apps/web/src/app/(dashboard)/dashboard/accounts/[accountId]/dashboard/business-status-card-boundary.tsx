"use client";

// S-47d Task 15 finding: `RecordCardBoundary` is a "use client" component whose `fallback` prop is a
// FUNCTION. page.tsx (a Server Component) was passing that function directly —
// `fallback={(reset) => <BusinessStatusCardError locale={locale} onRetry={reset} />}` — and a function
// cannot cross the Server→Client boundary (React: "Functions cannot be passed directly to Client
// Components"). That crashed the real Next.js build the moment `router.refresh()` re-rendered the
// dashboard after a status change; neither `renderToStaticMarkup` nor page.test.ts's own
// `RecordCardBoundary` mock can see this, because both bypass the real serialization check entirely.
//
// This wrapper owns the fallback closure itself, entirely on the client, and takes only serialisable
// props from the server (`locale`, a string) plus `skeleton`/`children` (already-rendered element
// trees, which DO cross the boundary fine — React serializes a Server Component's rendered output as
// RSC payload, never a function) — the same shape `record-section.tsx` already uses for the identical
// reason.
//
// `BusinessStatusCardError` comes from its OWN module (`./business-status-card-error`), never from
// `./business-status-card` (Task 15, second finding): that file also holds the async SERVER component
// and its `@bis/db`/Clerk imports (transitively `server-only`), and Turbopack refuses to bundle a
// module that imports `server-only` into a Client Component's graph the instant ANYTHING is imported
// from it here, whether or not this file touches the server-only exports.
import type { ReactNode } from "react";
import { RecordCardBoundary } from "@/components/record/record-card-boundary";
import { BusinessStatusCardError } from "./business-status-card-error";
import type { Locale } from "@/lib/i18n/locale";

export function BusinessStatusCardBoundary({
  locale, skeleton, children,
}: {
  locale: Locale;
  skeleton: ReactNode;
  children?: ReactNode;
}) {
  return (
    <RecordCardBoundary
      skeleton={skeleton}
      fallback={(reset) => <BusinessStatusCardError locale={locale} onRetry={reset} />}
    >
      {children}
    </RecordCardBoundary>
  );
}
