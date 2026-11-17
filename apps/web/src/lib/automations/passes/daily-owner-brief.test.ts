import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DueBriefSubscription } from "@bis/db";

// The orchestration the live file cannot reach without forty rows or a broken database: the tick cap, the tick
// budget, a claim another run won, a stamp that fails after the send, a block from the gate, an unusable zone and a
// missing signed link. The reads and the claim are mocked here; the live file runs them for real.
const db = vi.hoisted(() => ({
  listDueBriefSubscriptions: vi.fn(), claimBriefDay: vi.fn(), releaseBriefDay: vi.fn(), stampBriefOutcome: vi.fn(), listAccountWork: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const read = vi.hoisted(() => ({ appointments: vi.fn(), callsAndMessages: vi.fn(), needsAttention: vi.fn() }));
vi.mock("@/lib/owner-line/tools/read", () => read);
const leads = vi.hoisted(() => ({ listLeadInstantsBetween: vi.fn() }));
vi.mock("@/lib/reports/weekly-metrics", () => leads);

import { EmailNotSent } from "@/lib/consent/email-gate";
import { fakeSmsGate } from "@/lib/consent/fake-gate";
import { NO_CLOSURES } from "../closures";
import { DAILY_BRIEF_TICK_CAP, DAILY_BRIEF_BUDGET_MS } from "../caps";
import type { PassContext } from "../context";
import { dailyOwnerBriefPass } from "./daily-owner-brief";

const TICK = new Date("2027-03-10T13:00:00Z");   // 07:00 Wednesday in Chicago
const ORIGIN = "https://app.example.com";
const emailSend = vi.fn();
const ctx = (): PassContext => ({
  db: {} as never, now: TICK, origin: ORIGIN, email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) } as never,
  sms: fakeSmsGate({ send: async () => ({ providerMessageId: "x" }) }), closures: NO_CLOSURES,
});
const UUID = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const sub = (i: number, over: Partial<DueBriefSubscription> = {}): DueBriefSubscription => ({
  subscriptionId: UUID(i), userId: UUID(1000 + i), accountId: UUID(2000 + i), role: "owner", email: `owner${i}@example.com`,
  personLanguage: null, accountLanguage: null, accountTimezone: "America/Chicago", brandName: "Rio Roofing",
  branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
  replyToEmail: null, enabledAt: "2027-03-01T12:00:00Z", lastHandledDay: "2027-03-09", lastSentDay: "2027-03-09", lastOutcome: "sent", ...over,
});
const busy = () => {
  read.appointments.mockResolvedValue({ ok: true, range: { first: "2027-03-10", last: "2027-03-10" }, count: 1, truncated: false, more: 0, bookedCount: 1,
    appointments: [{ when: "10:00 AM", customer: "Ana Lopez", meetingType: null, status: "Booked", statusCode: "booked" }] });
  read.callsAndMessages.mockResolvedValue({ ok: true, range: { first: "2027-03-09", last: "2027-03-09" }, count: 0, spam: 0, more: 0, calls: [] });
  read.needsAttention.mockResolvedValue({ ok: true, count: 0, more: 0, items: [] });
  leads.listLeadInstantsBetween.mockResolvedValue([]);
  db.listAccountWork.mockResolvedValue([]);
};

beforeEach(() => {
  for (const f of [...Object.values(db), ...Object.values(read), ...Object.values(leads), emailSend]) f.mockReset();
  busy();
  db.claimBriefDay.mockResolvedValue(true);
  db.releaseBriefDay.mockResolvedValue(true);
  db.stampBriefOutcome.mockResolvedValue(true);
  emailSend.mockResolvedValue({ kind: "sent", providerMessageId: "m" });
  vi.stubEnv("APP_ORIGIN", ORIGIN);
  vi.stubEnv("CONSENT_TOKEN_SECRET", "unit-test-secret-0123456789abcdef-0123");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("dailyOwnerBriefPass (orchestration)", () => {
  it("an unresolvable account zone is counted and nothing is claimed or sent", async () => {
    db.listDueBriefSubscriptions.mockResolvedValue([sub(1, { accountTimezone: "Not/AZone" })]);
    expect(await dailyOwnerBriefPass.run(ctx())).toMatchObject({ unresolvableTimezone: 1, sent: 0 });
    expect(db.claimBriefDay).not.toHaveBeenCalled();
  });

  it("the tick cap: at most DAILY_BRIEF_TICK_CAP subscriptions are attempted, the rest counted (mutation: the cap check removed -> FAILS)", async () => {
    db.listDueBriefSubscriptions.mockResolvedValue(Array.from({ length: DAILY_BRIEF_TICK_CAP + 3 }, (_, i) => sub(i + 1)));
    const c = await dailyOwnerBriefPass.run(ctx());
    expect(c).toMatchObject({ sent: DAILY_BRIEF_TICK_CAP, skippedCap: 3 });
    expect(db.claimBriefDay).toHaveBeenCalledTimes(DAILY_BRIEF_TICK_CAP);   // the capped three are not claimed: next tick's
  });

  it("the tick budget: once the clock passes DAILY_BRIEF_BUDGET_MS no further subscription starts (mutation: the budget check removed -> FAILS)", async () => {
    db.listDueBriefSubscriptions.mockResolvedValue([sub(1), sub(2)]);
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(DAILY_BRIEF_BUDGET_MS);
    expect(await dailyOwnerBriefPass.run(ctx())).toMatchObject({ sent: 1, skippedBudget: 1 });
  });

  it("a claim another run won is never sent and never read", async () => {
    db.listDueBriefSubscriptions.mockResolvedValue([sub(1)]);
    db.claimBriefDay.mockResolvedValue(false);
    expect(await dailyOwnerBriefPass.run(ctx())).toMatchObject({ sent: 0, skippedAlreadyHandled: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(read.appointments).not.toHaveBeenCalled();
  });

  it("a stamp that fails after the send is counted unstamped, never released (the claim holds the day: no second mail)", async () => {
    db.listDueBriefSubscriptions.mockResolvedValue([sub(1)]);
    db.stampBriefOutcome.mockRejectedValue(new Error("db down"));
    expect(await dailyOwnerBriefPass.run(ctx())).toMatchObject({ sent: 1, unstamped: 1, released: 0 });
    expect(db.releaseBriefDay).not.toHaveBeenCalled();
  });

  it("a read that throws is a failure that releases the claim to its PREVIOUS day, and the next subscription still goes", async () => {
    db.listDueBriefSubscriptions.mockResolvedValue([sub(1, { lastHandledDay: "2027-03-08" }), sub(2)]);
    read.appointments.mockRejectedValueOnce(new Error("pg down"));
    const c = await dailyOwnerBriefPass.run(ctx());
    expect(c).toMatchObject({ failed: 1, released: 1, sent: 1 });
    expect(db.releaseBriefDay).toHaveBeenCalledWith({}, { id: UUID(1), day: "2027-03-10", previous: "2027-03-08" });
  });

  it("the gate's refusal (a suppressed address) is a definite failure: released, retried next tick, never counted sent", async () => {
    db.listDueBriefSubscriptions.mockResolvedValue([sub(1)]);
    emailSend.mockRejectedValue(new EmailNotSent({ kind: "blocked", reason: "suppressed" }));
    expect(await dailyOwnerBriefPass.run(ctx())).toMatchObject({ sent: 0, failed: 1, released: 1 });
  });

  it("no signed way off (no consent secret) refuses before claiming: a brief never goes without one", async () => {
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    db.listDueBriefSubscriptions.mockResolvedValue([sub(1)]);
    expect(await dailyOwnerBriefPass.run(ctx())).toMatchObject({ sent: 0, skippedNoWayOut: 1 });
    expect(db.claimBriefDay).not.toHaveBeenCalled();
  });

  it("what is handed to the gate: the operator kind, the brand as From, the signed one-click link, the person's language", async () => {
    db.listDueBriefSubscriptions.mockResolvedValue([sub(1, { personLanguage: "es" })]);
    await dailyOwnerBriefPass.run(ctx());
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({
      kind: "operator.daily_brief", accountId: UUID(2001), to: "owner1@example.com", fromName: "Rio Roofing", language: "es",
      oneClickUnsubscribe: expect.stringMatching(/^https:\/\/app\.example\.com\/api\/brief\/off\//),
    }));
  });
});
