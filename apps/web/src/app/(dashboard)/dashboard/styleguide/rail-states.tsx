"use client";

import {
  STATE_LABEL, STATE_TONE,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/setup/setup-rail";
import type { RailKind } from "@/lib/setup/setup-rail";
import { cn } from "@/lib/utils";

/**
 * WHY THIS IS ITS OWN CLIENT COMPONENT.
 *
 * `STATE_LABEL` and `STATE_TONE` live in setup-rail.tsx, which is a
 * `"use client"` module. Every export of a client module reaching a SERVER
 * component becomes a client REFERENCE, not the value — so `STATE_TONE[kind]`
 * read from the server page was `undefined` and `.chip` threw, 500'ing the
 * whole styleguide. tsc cannot model that boundary, so it typechecked and
 * built cleanly; only a real browser saw it (the e2e in this phase did).
 *
 * A client component importing from another client module is ordinary, so the
 * maps resolve to real values here. Reading them from the rail's own exports —
 * rather than copying the six kinds into this page — is the point: the style
 * guide cannot drift from the wizard it documents.
 */
const RAIL_KINDS: RailKind[] = ["done", "open", "next", "skipped", "unknown", "locked"];

export function RailStates() {
  return (
    <>
      {RAIL_KINDS.map((kind) => (
        <span
          key={kind}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
            STATE_TONE[kind].chip,
          )}
        >
          <span className={cn("size-1.5 rounded-full", STATE_TONE[kind].dot)} aria-hidden />
          {STATE_LABEL[kind]}
        </span>
      ))}
    </>
  );
}
