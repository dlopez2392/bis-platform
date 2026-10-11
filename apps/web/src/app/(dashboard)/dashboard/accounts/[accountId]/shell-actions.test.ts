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

const dbMocks = vi.hoisted(() => ({ sumUnreadCount: vi.fn(), getVoiceProfile: vi.fn(), hasActiveCallSince: vi.fn() }));
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

const authFixture = vi.hoisted(() => ({ isAgency: true, role: null as "owner" | "staff" | "technician" | null }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: authFixture.isAgency, role: authFixture.role, canManage: authFixture.isAgency }),
}));

// F-085 part 1 (spec §7.2): a Technician's unread badge is read through the
// REQUEST client, so RLS counts only their own conversations. A sentinel, so
// a test can tell which client sumUnreadCount was handed.
const REQUEST_DB = vi.hoisted(() => ({ __requestDb: true }));
const dbForRequestMock = vi.hoisted(() => vi.fn(async () => REQUEST_DB));
vi.mock("@/lib/db", () => ({ dbForRequest: () => dbForRequestMock() }));

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

/**
 * F-085 part 1 (spec §7.2): the shell's service-key reads, per role. The
 * unread total counts every conversation in the account through serviceDb();
 * for a Technician it must count only their own, which only RLS knows, so it
 * goes through the request client. The presence count is the account's total
 * calls this week: a Technician keeps the on-a-call pulse but not the count.
 */
describe("getShellSnapshot per role (spec §7.2)", () => {
  beforeEach(() => {
    mockGathered();
    dbMocks.sumUnreadCount.mockReset().mockResolvedValue(4);
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue({ enabled: true, persona_name: "Sofía" });
    voicePresenceMock.mockReset().mockResolvedValue({ onCall: true, weekCount: 12 });
    dbMocks.hasActiveCallSince.mockReset().mockResolvedValue(true);
    dbForRequestMock.mockClear();
    dbFixture.accountRow = { timezone: "America/Chicago" };
    dbFixture.accountError = null;
  });

  it("a Technician's unread total is read through the REQUEST client, and presence carries no count (mutations: keep serviceDb for the Technician, or showCount true -> FAILS)", async () => {
    authFixture.isAgency = false; authFixture.role = "technician";
    const snapshot = await getShellSnapshot("a1");
    expect(dbMocks.sumUnreadCount).toHaveBeenCalledTimes(1);
    expect(dbMocks.sumUnreadCount.mock.calls[0]![0]).toBe(REQUEST_DB);
    expect(dbMocks.sumUnreadCount.mock.calls[0]![1]).toBe("a1");
    expect(snapshot.unreadTotal).toBe(4);
    expect(snapshot.presence).toMatchObject({ onCall: true, showCount: false });
  });

  // Fix round 1 (review I1): hiding the count in the topbar is not refusing
  // it. A Technician's reply carries no weekCount at all, and the account's
  // weekly answered-calls read (getVoicePresence) never runs for them: only
  // the on-a-call check does, over the same one-hour floor.
  it("a Technician's presence carries no weekCount field, and the weekly count is never read (mutation: return the count, or run getVoicePresence -> FAILS)", async () => {
    authFixture.isAgency = false; authFixture.role = "technician";
    const before = Date.now();
    const snapshot = await getShellSnapshot("a1");
    expect(snapshot.presence).toEqual({ onCall: true, personaName: "Sofía", showCount: false });
    expect(snapshot.presence && "weekCount" in snapshot.presence).toBe(false);
    expect(voicePresenceMock).not.toHaveBeenCalled();
    expect(dbMocks.hasActiveCallSince).toHaveBeenCalledTimes(1);
    const [, acct, since] = dbMocks.hasActiveCallSince.mock.calls[0]!;
    expect(acct).toBe("a1");
    const ageMs = before - Date.parse(since as string);
    expect(ageMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5_000);
    expect(ageMs).toBeLessThanOrEqual(60 * 60 * 1000 + 5_000);
  });

  it("a Technician idle (no call in progress) still gets presence with onCall false, no count", async () => {
    authFixture.isAgency = false; authFixture.role = "technician";
    dbMocks.hasActiveCallSince.mockResolvedValue(false);
    expect((await getShellSnapshot("a1")).presence).toEqual({ onCall: false, personaName: "Sofía", showCount: false });
  });

  it("Staff keep the service client and the count, exactly as before (mutation: use the request client for everyone -> FAILS)", async () => {
    authFixture.isAgency = false; authFixture.role = "staff";
    const snapshot = await getShellSnapshot("a1");
    expect(dbMocks.sumUnreadCount.mock.calls[0]![0]).not.toBe(REQUEST_DB);
    expect(dbForRequestMock).not.toHaveBeenCalled();
    expect(snapshot.presence).toMatchObject({ onCall: true, weekCount: 12, showCount: true });
  });

  it("the agency keeps the service client and the count", async () => {
    authFixture.isAgency = true; authFixture.role = null;
    const snapshot = await getShellSnapshot("a1");
    expect(dbForRequestMock).not.toHaveBeenCalled();
    expect(snapshot.presence).toMatchObject({ showCount: true });
  });

  it("a request client that cannot be built degrades only the badge, to 0, and is logged; presence still answers (mutation: build it outside the leg's try -> FAILS)", async () => {
    authFixture.isAgency = false; authFixture.role = "technician";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbForRequestMock.mockRejectedValueOnce(new Error("dbForRequest: no Clerk token on this request"));
    const snapshot = await getShellSnapshot("a1");
    expect(snapshot.unreadTotal).toBe(0);
    expect(snapshot.presence).toMatchObject({ onCall: true, showCount: false });
    expect(errSpy.mock.calls.flat().map(String).join(" ")).toContain("no Clerk token");
    errSpy.mockRestore();
  });

  it("no enabled voice profile is still null presence for a Technician, never an object with showCount", async () => {
    authFixture.isAgency = false; authFixture.role = "technician";
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    expect((await getShellSnapshot("a1")).presence).toBeNull();
  });
});
