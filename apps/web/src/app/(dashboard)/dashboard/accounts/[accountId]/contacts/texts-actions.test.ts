import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAccountAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireAccountAccess }));
const textsContextFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/texts-context", () => ({ textsContextFor }));
const stopTexts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/staff-actions", () => ({
  stopTexts, undoStopTexts: vi.fn(), resumeTexts: vi.fn(), confirmStop: vi.fn(), notAStop: vi.fn(), undoHoldDecision: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  stopTextsAction, undoStopTextsAction, resumeTextsAction, confirmStopAction, notAStopAction, undoHoldDecisionAction,
} from "./texts-actions";

beforeEach(() => {
  requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_1" });
  textsContextFor.mockReset().mockResolvedValue({ ok: false, reason: "no_number", error: "x" });
  stopTexts.mockReset();
  revalidatePath.mockReset();
});

describe("texts-actions — the access gate runs BEFORE anything reads the ledger (review fix round 1, item 2)", () => {
  it("never calls textsContextFor (or a staff action) when requireAccountAccess redirects — Next's redirect() THROWS, so a caller who reordered these would leak a read past a client the access check just rejected (mutation: call textsContextFor first → FAILS)", async () => {
    requireAccountAccess.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(stopTextsAction("a1", "c1", null)).rejects.toThrow("NEXT_REDIRECT");
    expect(textsContextFor).not.toHaveBeenCalled();
    expect(stopTexts).not.toHaveBeenCalled();
  });
});

// S-10 leftovers (#317 follow-up, item 7): the row's own error toasts read m[...] directly —
// English always — because none of these six actions ever threaded the reader's own locale
// into textsContextFor, so ctx.locale (staff-actions.ts's own source for every error line)
// was always the "en" default regardless of who clicked.
describe("every Texts row action threads its own locale param into textsContextFor (S-10 leftovers item 7)", () => {
  const cases: [string, (locale?: "en" | "es") => Promise<unknown>][] = [
    ["stopTextsAction", (l) => stopTextsAction("a1", "c1", null, l)],
    ["undoStopTextsAction", (l) => undoStopTextsAction("a1", "c1", "ev1", l)],
    ["resumeTextsAction", (l) => resumeTextsAction("a1", "c1", "ev1", "note", l)],
    ["confirmStopAction", (l) => confirmStopAction("a1", "c1", "ev1", l)],
    ["notAStopAction", (l) => notAStopAction("a1", "c1", "ev1", l)],
    ["undoHoldDecisionAction", (l) => undoHoldDecisionAction("a1", "c1", "ev1", [], l)],
  ];

  for (const [name, call] of cases) {
    it(`${name} passes "es" through to textsContextFor (mutation: drop the locale arg -> FAILS)`, async () => {
      await call("es");
      expect(textsContextFor).toHaveBeenCalledWith("a1", "c1", "user_1", "es");
    });

    it(`${name} defaults to "en" when no locale is given, so a predating caller is unchanged`, async () => {
      await call();
      expect(textsContextFor).toHaveBeenCalledWith("a1", "c1", "user_1", "en");
    });
  }
});
