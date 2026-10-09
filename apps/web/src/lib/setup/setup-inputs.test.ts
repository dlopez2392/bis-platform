import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@bis/db";

/**
 * `gatherSetupInputs` itself, against a fake `db` — not just through its
 * three callers (`shell-actions.test.ts`, `setup/actions.test.ts`), which
 * all mock this module at the import boundary and therefore cannot see
 * anything this function actually DOES. Review round, Important 3: that
 * left a real gap — mutating `setup-inputs.ts`'s own
 * `permissions: account?.permissions ?? null` line to a hardcoded
 * `permissions: null` left every caller-level test green, because none of
 * them ever runs the real function body. This file is the one place that
 * does.
 *
 * Every OTHER leg this function reads (`getCalendarForAccount`,
 * `getVoiceProfile`, etc.) is mocked to a neutral, happy-path value — this
 * suite is about the `accounts` row read and its `permissions` column
 * specifically, not a re-proof of the seven-leg fault isolation already
 * covered by the per-leg `failed` tests inside `actions.test.ts` and
 * `shell-actions.test.ts`.
 */

const dbMocks = vi.hoisted(() => ({
  getCalendarForAccount: vi.fn(),
  getVoiceProfile: vi.fn(),
  listPhoneNumbersForAccount: vi.fn(),
  countCallsSince: vi.fn(),
  countAnsweredCallsSince: vi.fn(),
  listChecklistState: vi.fn(),
  listForms: vi.fn(),
  hasConciergeSiteConversation: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...dbMocks,
  serviceDb: () => ({ __service: true }),
}));

import { gatherSetupInputs } from "./setup-inputs";

type AccountRow = { brand_name: string | null; from_email: string | null; permissions: unknown };

/** A fake `db` whose ONLY implemented call is the exact chain
 *  `gatherSetupInputs` makes against `accounts` —
 *  `.from("accounts").select(...).eq(...).maybeSingle()`. Every other
 *  `@bis/db` read this function makes goes through the named-export mocks
 *  above, never through this object, so it needs no other table. */
function dbWithAccountRow(row: AccountRow | null): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected table in test fake: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

function dbWhoseAccountReadFails(): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("gatherSetupInputs — accounts.permissions reaches SetupInputs (review round, Important 3)", () => {
  beforeEach(() => {
    Object.values(dbMocks).forEach((mock) => mock.mockReset());
    dbMocks.getCalendarForAccount.mockResolvedValue(null);
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([]);
    dbMocks.countCallsSince.mockResolvedValue(0);
    dbMocks.countAnsweredCallsSince.mockResolvedValue(0);
    dbMocks.listChecklistState.mockResolvedValue([]);
    dbMocks.listForms.mockResolvedValue([]);
    dbMocks.hasConciergeSiteConversation.mockResolvedValue(false);
  });

  // MUTATION: hardcode `permissions: null` at setup-inputs.ts's own
  // `inputs` literal (dropping `account?.permissions ?? null`) — this
  // FAILS, since the row below carries a REAL, non-null, non-`{}` value
  // that a hardcoded `null` could never produce.
  it("a billed CRM-only account's permissions pass straight through to SetupInputs", async () => {
    const db = dbWithAccountRow({
      brand_name: "Acme", from_email: null, permissions: { voice_receptionist: false },
    });
    const { inputs, failed } = await gatherSetupInputs(db, "a1");
    expect(inputs.permissions).toEqual({ voice_receptionist: false });
    expect(failed.account).toBe(false);
  });

  it("an unbilled account's own {} passes through unchanged", async () => {
    const db = dbWithAccountRow({ brand_name: "Acme", from_email: null, permissions: {} });
    const { inputs } = await gatherSetupInputs(db, "a1");
    expect(inputs.permissions).toEqual({});
  });

  // The "never silently hide a step" half of docs/crm-features.md:883 — a
  // failed accounts read must degrade `permissions` to `null` (which
  // deriveSetupStatus treats as the full plan, same as `{}`) AND report
  // `failed.account: true`, not swallow the failure into a false "this is
  // an unbilled account" reading.
  it("a failed accounts read degrades permissions to null AND reports failed.account", async () => {
    const db = dbWhoseAccountReadFails();
    const { inputs, failed } = await gatherSetupInputs(db, "a1");
    expect(inputs.permissions).toBeNull();
    expect(failed.account).toBe(true);
  });

  it("a missing account row (maybeSingle returns null) also degrades permissions to null", async () => {
    const db = dbWithAccountRow(null);
    const { inputs, failed } = await gatherSetupInputs(db, "a1");
    expect(inputs.permissions).toBeNull();
    expect(failed.account).toBe(false);
  });
});

// D-091: "Test call" read done after ANY call — a robocall, a hang-up, a
// silent ring. It now counts only calls that were answered (the four
// ANSWERED_CALL_OUTCOMES the weekly report and the press-1 screen use).
describe("gatherSetupInputs — the test-call step counts answered calls only (D-091)", () => {
  beforeEach(() => {
    Object.values(dbMocks).forEach((mock) => mock.mockReset());
    dbMocks.getCalendarForAccount.mockResolvedValue(null);
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([]);
    dbMocks.listChecklistState.mockResolvedValue([]);
    dbMocks.listForms.mockResolvedValue([]);
    dbMocks.hasConciergeSiteConversation.mockResolvedValue(false);
  });

  it("five calls that were all robocalls or hang-ups leave callCount at 0 (mutation: count every call → 5, FAILS)", async () => {
    dbMocks.countCallsSince.mockResolvedValue(5);
    dbMocks.countAnsweredCallsSince.mockResolvedValue(0);
    const db = dbWithAccountRow({ brand_name: "Acme", from_email: null, permissions: {} });
    const { inputs, failed } = await gatherSetupInputs(db, "a1");
    expect(inputs.callCount).toBe(0);
    expect(failed.calls).toBe(false);
  });

  it("an answered call counts, read from the epoch floor", async () => {
    dbMocks.countCallsSince.mockResolvedValue(5);
    dbMocks.countAnsweredCallsSince.mockResolvedValue(1);
    const db = dbWithAccountRow({ brand_name: "Acme", from_email: null, permissions: {} });
    const { inputs } = await gatherSetupInputs(db, "a1");
    expect(inputs.callCount).toBe(1);
    expect(dbMocks.countAnsweredCallsSince).toHaveBeenCalledWith(db, "a1", "1970-01-01T00:00:00.000Z");
  });

  it("a failed answered-calls read reports failed.calls, never a silent 0", async () => {
    dbMocks.countCallsSince.mockResolvedValue(5);
    dbMocks.countAnsweredCallsSince.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = dbWithAccountRow({ brand_name: "Acme", from_email: null, permissions: {} });
    const { failed } = await gatherSetupInputs(db, "a1");
    errSpy.mockRestore();
    expect(failed.calls).toBe(true);
  });
});
