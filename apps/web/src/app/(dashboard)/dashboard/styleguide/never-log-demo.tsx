"use client";

import { NeverLogList } from "@/components/never-log-list";
import type { NeverLogView } from "../accounts/[accountId]/never-log-actions";

/**
 * S-06 part 2: the Never record list (Settings' Sending address card and the Owner's Branding page) —
 * two entries in English and in Spanish, the empty state and the failed read. A client component of its
 * own, same reasoning as `held-emails-demo.tsx`: the real server actions are never reached from here;
 * Add and Remove answer "failed", so a click only shows the list's own failure toast.
 */
const ENTRIES: NeverLogView[] = [
  { id: "sg-never-1", pattern: "billing@supplier.com", kind: "address" },
  { id: "sg-never-2", pattern: "supplier.com", kind: "domain" },
];
const inertAdd = async () => ({ ok: false as const, error: "failed" as const });
const inertRemove = async () => ({ ok: false as const, error: "failed" as const });

export function NeverLogDemo() {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2" data-testid="styleguide-never-log">
      <div className="min-w-0">
        <NeverLogList entries={ENTRIES} add={inertAdd} remove={inertRemove} locale="en" idPrefix="sg-en" />
      </div>
      <div className="min-w-0" lang="es">
        <NeverLogList entries={ENTRIES} add={inertAdd} remove={inertRemove} locale="es" idPrefix="sg-es" />
      </div>
      <div className="min-w-0">
        <NeverLogList entries={[]} add={inertAdd} remove={inertRemove} locale="en" idPrefix="sg-empty" />
      </div>
      <div className="min-w-0">
        <NeverLogList entries={null} add={inertAdd} remove={inertRemove} locale="en" idPrefix="sg-error" />
      </div>
    </div>
  );
}
