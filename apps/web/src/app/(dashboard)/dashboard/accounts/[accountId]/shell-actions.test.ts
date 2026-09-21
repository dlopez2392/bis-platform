import { describe, it, expect, vi } from "vitest";

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
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({ __serviceDb: true }),
}));

const setupInputsMocks = vi.hoisted(() => ({ gatherSetupInputs: vi.fn() }));
vi.mock("@/lib/setup/setup-inputs", () => setupInputsMocks);

vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));

vi.mock("@/lib/voice/presence", () => ({ getVoicePresence: vi.fn() }));

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
