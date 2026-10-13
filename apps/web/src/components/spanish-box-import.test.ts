import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * S-09 PR 2 final review: the staleness rule (C14, spec §12.3) lives ONCE, in
 * `packages/db/src/spanish-box.ts`, reached by client components through the
 * `@bis/db/spanish-box` subpath (no database client in the browser bundle). Every card that
 * renders the Spanish box imports it rather than carrying its own copy, so the rule cannot drift
 * between the nine cards and the server.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const acct = path.join(here, "../app/(dashboard)/dashboard/accounts/[accountId]");
const CARDS = [
  "automations/appointment-confirm-card.tsx",
  "automations/automations-settings.tsx",
  "automations/no-show-nudge-card.tsx",
  "automations/quote-followup-card.tsx",
  "automations/reactivation-card.tsx",
  "automations/referral-ask-card.tsx",
  "automations/sms-reminder-card.tsx",
  "calendar/calendar-settings.tsx",
  "voice/voice-settings.tsx",
];

describe("every Spanish-box card uses the one spanishIsStale", () => {
  it.each(CARDS)("%s imports it from @bis/db/spanish-box and carries no copy (mutation: re-inline the rule -> FAILS)", (rel) => {
    const src = readFileSync(path.join(acct, rel), "utf8");
    expect(src).toMatch(/import \{[^}]*\bspanishIsStale\b[^}]*\} from "@bis\/db\/spanish-box";/);
    expect(src).toMatch(/spanishIsStale\(\{/);
    expect(src).not.toMatch(/basis !== /);
  });
});
