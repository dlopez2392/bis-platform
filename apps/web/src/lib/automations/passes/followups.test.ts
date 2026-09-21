import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueFollowup, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueFollowups: vi.fn(), stampFollowupSent: vi.fn(), getDueFollowupById: vi.fn(), recordAutomationLog: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { PassContext } from "../context";
import { followupsPass, releaseFollowup } from "./followups";

// 09:00 CDT on Sept 22 — inside the 08:00–11:00 band, the day after a meeting that ended Sept 21.
const MORNING = new Date("2026-09-22T14:00:00Z");
// 03:00 CDT on Sept 22 — NOT in the band, and inside the default quiet window.
const SMALL_HOURS = new Date("2026-09-22T08:00:00Z");
const ON = { enabled: true, start: "21:00", end: "08:00" };
const OFF = { ...ON, enabled: false };
// A window ending at NOON: the band (08–11) is entirely inside it, so a follow-up due at 09:00 is held until 12:00.
const UNTIL_NOON = { enabled: true, start: "21:00", end: "12:00" };
const NOON = new Date("2026-09-22T17:00:00Z");

function row(overrides: Partial<DueFollowup> = {}): DueFollowup {
  return {
    bookingId: "bk_f1", accountId: "acct_1", contactId: "ct_1",
    startsAt: "2026-09-21T19:00:00.000Z", endsAt: "2026-09-21T20:00:00.000Z",   // ended 15:00 CDT Sept 21
    contactEmail: "maria@example.com", contactName: "Maria Garcia", accountTimezone: "America/Chicago",
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    fromEmail: null, replyToEmail: null, followupBody: "How did it go?",
    ...overrides,
  };
}
const heldRow = (): AutomationLogRow => ({
  id: "log_f", account_id: "acct_1", source: "followups", channel: "email", contact_id: "ct_1",
  subject_key: "booking:bk_f1", status: "held", reason: "Held until 12:00 PM — quiet hours", held_until: NOON.toISOString(), payload: {}, occurred_at: MORNING.toISOString(),
});
const emailSend = vi.fn();
function ctx(now: Date, quiet = OFF): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => { throw new Error("follow-ups never text"); }, quiet: async () => quiet,
  };
}
const EMPTY = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0 };
const logCalls = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1]);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueFollowups.mockResolvedValue([]);
  dbMocks.stampFollowupSent.mockResolvedValue(undefined);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("follow-ups: the band decides WHEN IT IS DUE, the window decides WHEN IT GOES", () => {
  it("in the band, quiet off: sent and stamped, one sent row", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampFollowupSent).toHaveBeenCalledWith(expect.anything(), "bk_f1");
    expect(logCalls()).toEqual([expect.objectContaining({ source: "followups", channel: "email", status: "sent", contactId: "ct_1" })]);
  });

  it("outside the band the gate still waits — no row, no send, whatever the window says (mutation: skip the gate on the normal tick → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run(ctx(SMALL_HOURS, OFF))).toEqual({ ...EMPTY, waitingForMorning: 1 });
    expect(logCalls()).toEqual([]);
  });

  it("in the band but inside a window that ends at noon: HELD until 12:00 (the band and the window compose; mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run(ctx(MORNING, UNTIL_NOON))).toEqual({ ...EMPTY, held: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ status: "held", heldUntil: NOON.toISOString(), reason: "Held until 12:00 PM — quiet hours" })]);
  });

  it("release at noon: the band is CLOSED, and the release sends anyway because the band was satisfied at hold time (mutation: apply the gate on release → FAILS)", async () => {
    dbMocks.getDueFollowupById.mockResolvedValue({ due: row() });
    expect(await releaseFollowup(ctx(NOON, UNTIL_NOON), heldRow())).toBe("sent");
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampFollowupSent).toHaveBeenCalledWith(expect.anything(), "bk_f1");
  });

  it("no email: a skipped row with the plain reason, counted as before", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ contactEmail: null })]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, skippedNoEmail: 1 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "No email address on file" })]);
  });

  it("an unresolvable account zone: a skipped row that says so", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "The company's time zone isn't set" })]);
  });

  it("release: gone / calendar follow-ups switched off", async () => {
    dbMocks.getDueFollowupById.mockResolvedValueOnce({ due: null, why: "gone" }).mockResolvedValueOnce({ due: null, why: "off" });
    expect(await releaseFollowup(ctx(NOON), heldRow())).toBe("skipped");
    expect(await releaseFollowup(ctx(NOON), heldRow())).toBe("skipped");
    expect(logCalls().map((w) => w.reason)).toEqual(["No longer due", "This automation was turned off"]);
  });
});
