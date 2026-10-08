import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `readSetupProgress` (shell-actions.ts) — the sidebar's footer meter, which
 * DESIGN.md pins as always visible.
 *
 * Fix-round review, IMPORTANT 1: the fold used to be
 * `Object.values(failed).some(Boolean)` — every leg `gatherSetupInputs`
 * reports, unconditionally. That was right when there were six legs, all of
 * which feed `deriveSetupStatus`'s `done` computations. It stopped being
 * right the moment the website-assistant step's `forms`/`conversations` legs
 * were added: `deriveSetupStatus` never reads `inputs.publishedFormCount` or
 * `inputs.conciergeSiteConversation` (grep confirms only the type
 * declarations reference them, setup-status.ts) — the step's own `done` is
 * `profile?.concierge_enabled && concierge_form_id` alone. So a hiccup on
 * `forms` or `conversations` blanked the WHOLE meter for a count that was
 * providably unchanged by either read.
 */

const dbMocks = vi.hoisted(() => ({ sumUnreadCount: vi.fn(), getVoiceProfile: vi.fn() }));
// D-075 review follow-up: `serviceDb()` used to return the fixed
// `{ __serviceDb: true }` placeholder, which has no `.from` — every test in
// this file reached `readPresence` through a `getVoiceProfile` that resolved
// falsy (the default below), so it returned null BEFORE ever calling
// `db.from("accounts")`, and the zone lookup that call feeds was never
// exercised at all: hard-coding "UTC" in `readPresence` would have passed
// every test here. `dbFixture` makes the "accounts" row (and its `.error`)
// a per-test knob instead, on the one table `readPresence` actually reads —
// `readUnreadTotal`/`readSetupProgress` call `sumUnreadCount`/
// `gatherSetupInputs` directly, mocked below, and never touch `db.from`.
const dbFixture = vi.hoisted(() => ({
  accountRow: null as { timezone: string | null } | null,
  accountError: null as { message: string } | null,
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
  serviceDb: () => ({
    from: (table: string) => {
      if (table !== "accounts") {
        throw new Error(`shell-actions.test.ts fake db: unexpected table "${table}"`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: dbFixture.accountRow, error: dbFixture.accountError }),
          }),
        }),
      };
    },
  }),
}));

const setupInputsMocks = vi.hoisted(() => ({ gatherSetupInputs: vi.fn() }));
vi.mock("@/lib/setup/setup-inputs", () => setupInputsMocks);

vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));

const voicePresenceMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/voice/presence", () => ({
  getVoicePresence: (...a: unknown[]) => voicePresenceMock(...a),
}));

import { getShellSnapshot } from "./shell-actions";

const NO_FAILURES = {
  account: false, calendar: false, profile: false,
  numbers: false, calls: false, ticks: false, forms: false, conversations: false,
};

const READY_INPUTS = {
  brandName: "Acme", fromEmail: "hello@acme.example",
  calendar: { enabled: true, open_hours: { mon: [["09:00", "17:00"]] } },
  profile: {
    greeting_en: "Hi!", greeting_es: "", facts: "We fix things.", enabled: true, languages: "en",
    concierge_enabled: false, concierge_form_id: null, public_id: null,
  },
  numbers: [{ status: "live" }],
  callCount: 1,
  ticks: { emailSkipped: false, forwardingDone: true },
  publishedFormCount: 0,
  conciergeSiteConversation: false,
};

function mockGathered(failed: Partial<typeof NO_FAILURES> = {}) {
  setupInputsMocks.gatherSetupInputs.mockResolvedValue({
    inputs: READY_INPUTS, numbers: [{ id: "pn1", account_id: "a1", e164: "+19565550111", telnyx_id: null, status: "live" }],
    failed: { ...NO_FAILURES, ...failed },
  });
}

describe("readSetupProgress (via getShellSnapshot)", () => {
  it("still returns a count when only the website-assistant step's OWN reads (forms, conversations) failed", async () => {
    mockGathered({ forms: true, conversations: true });
    const snapshot = await getShellSnapshot("a1");
    // MUTATION: revert the fold to `Object.values(failed).some(Boolean)` —
    // this FAILS, since forms/conversations both being true would blank it.
    expect(snapshot.setup).not.toBeNull();
  });

  it("still blanks the meter when a read `deriveSetupStatus` actually depends on fails", async () => {
    mockGathered({ profile: true });
    const snapshot = await getShellSnapshot("a1");
    expect(snapshot.setup).toBeNull();
  });
});

/**
 * D-075 review follow-up: this leg's own zone lookup had NO test reaching it
 * at all — every existing test above resolves `getVoiceProfile` to a falsy
 * default, so `readPresence` returns null before `db.from("accounts")` is
 * ever called, and hard-coding `getVoicePresence`'s fourth argument to "UTC"
 * would have passed the whole file.
 */
describe("readPresence (via getShellSnapshot) — the account's own zone reaches getVoicePresence", () => {
  beforeEach(() => {
    mockGathered();
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue({ enabled: true });
    voicePresenceMock.mockReset().mockResolvedValue({ onCall: false, weekCount: 0 });
    dbFixture.accountRow = null;
    dbFixture.accountError = null;
  });

  it("passes the account's OWN timezone through to getVoicePresence (mutation: hard-code 'UTC' instead of resolveAccountZone's result → FAILS)", async () => {
    dbFixture.accountRow = { timezone: "America/Chicago" };

    await getShellSnapshot("a1");

    expect(voicePresenceMock).toHaveBeenCalledWith(
      expect.anything(), "a1", expect.any(Date), "America/Chicago",
    );
  });

  it("an unusable/missing timezone falls back to UTC, not a thrown error", async () => {
    dbFixture.accountRow = { timezone: null };

    await getShellSnapshot("a1");

    expect(voicePresenceMock).toHaveBeenCalledWith(expect.anything(), "a1", expect.any(Date), "UTC");
  });

  it("an account-read ERROR still degrades to UTC (the topbar's own contract) but logs it loudly, rather than silently picking UTC (mutation: drop the error log → FAILS)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbFixture.accountRow = null;
    dbFixture.accountError = { message: "connection reset" };

    await getShellSnapshot("a1");

    expect(voicePresenceMock).toHaveBeenCalledWith(expect.anything(), "a1", expect.any(Date), "UTC");
    const written = errSpy.mock.calls.flat().map(String).join(" ");
    expect(written).toContain("a1");
    expect(written).toContain("connection reset");
    errSpy.mockRestore();
  });

  it("no enabled voice profile never reads the account's zone at all — the query a presence read never needed", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    dbFixture.accountRow = { timezone: "America/Chicago" };

    await getShellSnapshot("a1");

    expect(voicePresenceMock).not.toHaveBeenCalled();
  });

  // D-063 follow-up (topbar-presence.tsx's own "{name} · on a call"): the
  // snapshot carries this account's configured persona ALONGSIDE the call
  // counts, read off the SAME profile the enabled-gate above already
  // fetched — never a second query (mutation: drop personaName from the
  // returned snapshot → FAILS).
  it("carries the account's own configured persona name on the snapshot, read from the SAME profile already fetched for the enabled-gate", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: true, persona_name: "Max" });

    const snapshot = await getShellSnapshot("a1");

    expect(snapshot.presence).toMatchObject({ personaName: "Max" });
    expect(dbMocks.getVoiceProfile).toHaveBeenCalledTimes(1);
  });
});
