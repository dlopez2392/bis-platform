import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Spec §7.2's guard: every file in the in-account route trees and lib/ that
 * imports serviceDb is listed here WITH its reason. A new importer fails by
 * name until someone decides which reason it has, so a service-key read of
 * customer data cannot slip past the Technician's RLS unnoticed.
 */
type Reason = "agency-only" | "owner-only" | "configuration" | "proven-target" | "technician-filtered" | "before-trust" | "public-or-cron";
const SRC = join(__dirname, "../../../../..");   // apps/web/src
const ROOTS = ["app/(dashboard)/dashboard/accounts/[accountId]", "app/api/accounts", "lib"];
// No `s` flag: the pattern has no `.`, and `[^}]` and `\s` already cross line
// breaks, so a multi-line import list matches without it (and the web
// tsconfig's target rejects the flag, TS1501).
const IMPORT = /import\s*\{[^}]*\bserviceDb\b[^}]*\}\s*from\s*"(?:@bis\/db|@\/lib\/db)"/;

const ALLOWED: Record<string, Reason> = {
  "app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/automations/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/billing/page.tsx": "owner-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/branding/page.tsx": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/cancel-notice.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/page.tsx": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-section.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/shell-actions.ts": "technician-filtered",
  "app/(dashboard)/dashboard/accounts/[accountId]/team/actions.ts": "owner-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/voice/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/website/actions.ts": "agency-only",
  "lib/auth.ts": "before-trust",
  "lib/booking/availability.ts": "public-or-cron",
  "lib/branding/tenant-theme-reader.ts": "configuration",
  "lib/consent/email-context.ts": "proven-target",
  "lib/consent/email-gate.ts": "proven-target",
  "lib/consent/ledger-db.ts": "proven-target",
  "lib/consent/texts-context.ts": "proven-target",
  "lib/preferences/person-prefs.ts": "before-trust",
  "lib/proposals/generate.ts": "public-or-cron",
  "lib/setup/setup-inputs.ts": "agency-only",
  "lib/team/ensure-role.ts": "before-trust",
  "lib/voice/presence.ts": "technician-filtered",
  "lib/voice/tools/registry.ts": "public-or-cron",
  "lib/zone.ts": "configuration",
};

function importers(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && IMPORT.test(readFileSync(p, "utf8"))) {
        out.push(relative(SRC, p).split(sep).join("/"));
      }
    }
  };
  for (const r of ROOTS) walk(join(SRC, r));
  return out.sort();
}

describe("every serviceDb importer on the in-account surface has a stated reason (spec §7.2)", () => {
  it("no unlisted importer (mutation: import serviceDb into contacts/page.tsx -> FAILS naming it)", () => {
    expect(importers().filter((f) => !(f in ALLOWED))).toEqual([]);
  });
  it("no stale entry (a file that stopped importing it leaves the list)", () => {
    const now = new Set(importers());
    expect(Object.keys(ALLOWED).filter((f) => !now.has(f))).toEqual([]);
  });
});
