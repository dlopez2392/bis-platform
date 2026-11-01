import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAccountAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireAccountAccess }));
const emailContextFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/email-context", () => ({ emailContextFor }));
const stopEmails = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/email-staff-actions", () => ({
  stopEmails, undoStopEmails: vi.fn(), resumeEmails: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { stopEmailsAction, undoStopEmailsAction, resumeEmailsAction } from "./email-actions";

beforeEach(() => {
  requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_1" });
  emailContextFor.mockReset().mockResolvedValue({ ok: false, reason: "no_email", error: "x" });
  stopEmails.mockReset();
  revalidatePath.mockReset();
});

describe("email-actions — the access gate runs BEFORE anything reads the ledger (the Texts row's own rule, mirrored for email)", () => {
  it("never calls emailContextFor (or a staff action) when requireAccountAccess redirects (mutation: call emailContextFor first → FAILS)", async () => {
    requireAccountAccess.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(stopEmailsAction("a1", "c1", null)).rejects.toThrow("NEXT_REDIRECT");
    expect(emailContextFor).not.toHaveBeenCalled();
    expect(stopEmails).not.toHaveBeenCalled();
  });
});

// S-10 leftovers (#317 follow-up, item 7): the row's own error toasts read m[...] directly —
// English always — because none of these three actions ever threaded the reader's own locale
// into emailContextFor, so ctx.locale (email-staff-actions.ts's own source for every error
// line) was always the "en" default regardless of who clicked.
describe("every Email row action threads its own locale param into emailContextFor (S-10 leftovers item 7)", () => {
  const cases: [string, (locale?: "en" | "es") => Promise<unknown>][] = [
    ["stopEmailsAction", (l) => stopEmailsAction("a1", "c1", null, l)],
    ["undoStopEmailsAction", (l) => undoStopEmailsAction("a1", "c1", "ev1", l)],
    ["resumeEmailsAction", (l) => resumeEmailsAction("a1", "c1", "ev1", "note", l)],
  ];

  for (const [name, call] of cases) {
    it(`${name} passes "es" through to emailContextFor (mutation: drop the locale arg -> FAILS)`, async () => {
      await call("es");
      expect(emailContextFor).toHaveBeenCalledWith("a1", "c1", "user_1", "es");
    });

    it(`${name} defaults to "en" when no locale is given, so a predating caller is unchanged`, async () => {
      await call();
      expect(emailContextFor).toHaveBeenCalledWith("a1", "c1", "user_1", "en");
    });
  }
});
