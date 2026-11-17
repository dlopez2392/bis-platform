import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DueReviewRequest, AutomationLogRow } from "@bis/db";

/**
 * The check-in branch of the review-request pass (F-072 PR 3; plan D4, D6). Dormant behind `config.checkin`: the
 * existing review-request.test.ts is the proof that an account without the flag behaves as before and is not
 * touched. Here the database reads are mocked and `ctx.email` is a spy; the REAL consent gate is exercised in
 * review-request-checkin-gate.test.ts.
 */
const dbMocks = vi.hoisted(() => ({
  listDueReviewRequests: vi.fn(), stampReviewRequested: vi.fn(), countReviewRequestsSince: vi.fn(),
  recentReviewAsks: vi.fn(), stampReviewRequestSmsFailed: vi.fn(), getDueReviewRequestById: vi.fn(),
  recordAutomationLog: vi.fn(), getAutomationLogEntry: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { AUTOMATION_TICK_CAP } from "../caps";
import { fakeSmsGate } from "@/lib/consent/fake-gate";
import { EmailNotSent } from "@/lib/consent/email-gate";
import type { PassContext } from "../context";
import { NO_CLOSURES } from "../closures";
import { CHECKIN_MAX_AGE_MS } from "../review-checkin-gate";
import { reviewRequestPass, releaseReviewRequest } from "./review-request";

const STAMP_ATTEMPTS = STAMP_RETRY_DELAYS_MS.length + 1;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const URL = "https://g.page/r/x/review";
const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const BK1 = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const BK2 = "7e3f8a2b-5d4c-4a6b-8c77-2b9c3e4f5a61";
const SECRET = "s".repeat(40);

const COMPLETED = new Date("2026-09-09T19:00:00Z");              // Wed 14:00 CDT, the anchor
const TICK = new Date(COMPLETED.getTime() + 2 * HOUR);           // 16:00 CDT: due, inside the sending hours
const at = (anchor: Date, ms: number) => new Date(anchor.getTime() + ms);

function row(overrides: Partial<DueReviewRequest> = {}): DueReviewRequest {
  return {
    bookingId: BK1, accountId: ACCT,
    startsAt: "2026-09-09T17:00:00.000Z", closureKeptAt: null, endsAt: "2026-09-09T18:00:00.000Z",
    followupSentAt: null, completedAt: COMPLETED.toISOString(), smsFailedAt: null,
    contactId: "ct_1", contactEmail: "ana@example.com", contactPhone: "(956) 555-0101",
    brandName: "Rio Roofing",
    branding: {
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null, replyToEmail: "wrong-should-not-be-used@rioroofing.com",
    },
    accountTimezone: "America/Chicago",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    body: "if you loved us, leave a review", config: { channel: "email", reviewUrl: URL, checkin: true },
    language: "en", bodyEs: null, mailingAddress: "12 Main St, McAllen TX 78501",
    ...overrides,
  };
}
const second = (over: Partial<DueReviewRequest> = {}) =>
  row({ bookingId: BK2, contactId: "ct_2", contactEmail: "other@example.com", ...over });

const emailSend = vi.fn();
const smsSend = vi.fn();
function ctx(now: Date = TICK, origin = "https://app.example.com"): PassContext {
  return {
    db: {} as never, now, origin,
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: fakeSmsGate({ send: (m) => smsSend(m) }),
    closures: NO_CLOSURES,
  };
}
const EMPTY = {
  sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 0, skippedInvalidConfig: 0, skippedNoAddress: 0,
  skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0,
};

/** A due-list that forgets a row once it is stamped, as the real one does (review_requested_at is null). */
function liveList(rows: DueReviewRequest[]) {
  const stamped = new Set<string>();
  dbMocks.listDueReviewRequests.mockImplementation(async () => rows.filter((r) => !stamped.has(r.bookingId)));
  dbMocks.stampReviewRequested.mockImplementation(async (_db: unknown, id: string) => { stamped.add(id); });
  dbMocks.getDueReviewRequestById.mockImplementation(async (_db: unknown, id: string) => {
    const r = rows.find((x) => x.bookingId === id);
    return r && !stamped.has(id) ? { due: r } : { due: null, why: "gone" };
  });
  return stamped;
}
const logged = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1] as { status: string; heldUntil?: string; reason?: string });
const sentMail = () => emailSend.mock.calls[0]![0] as Record<string, string | undefined>;

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueReviewRequests.mockResolvedValue([]);
  dbMocks.stampReviewRequested.mockResolvedValue(undefined);
  dbMocks.countReviewRequestsSince.mockResolvedValue(0);
  dbMocks.recentReviewAsks.mockResolvedValue(false);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);
  dbMocks.stampReviewRequestSmsFailed.mockResolvedValue(undefined);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("the check-in sends two hours after the anchor, once", () => {
  it("sends at anchor + 2 h: the question, in the brand's name, one link, kind review_request, THEN stamps (mutation: stamp before send -> FAILS)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    const mail = sentMail();
    expect(mail.kind).toBe("automation.review_request");
    expect(mail.to).toBe("ana@example.com");
    expect(mail.contactId).toBe("ct_1");
    expect(mail.fromName).toBe("Rio Roofing");
    expect(mail.fromAddress).toBe("hello@rioroofing.com");
    expect(mail.replyTo).toBe("owner@rioroofing.com");
    expect(mail.subject).toBe("How did we do, Rio Roofing?");
    expect(mail.language).toBe("en");
    expect(mail.body).toMatch(/^Thanks for choosing Rio Roofing\. One quick question: how did we do\?\n\nhttps:\/\/app\.example\.com\/r\/1\./);
    expect(mail.html).toContain('href="https://app.example.com/r/1.');
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledWith(expect.anything(), BK1);
    expect(emailSend.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.stampReviewRequested.mock.invocationCallOrder[0]!);
  });

  it("ignores the operator-typed body entirely: no review wording, the words are ours (plan D5)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ body: "if you loved us, leave a review" })]);
    await reviewRequestPass.run(ctx());
    expect(`${sentMail().subject}${sentMail().body}${sentMail().html}`).not.toMatch(/loved us|review/i);
  });

  it("speaks the customer's language end to end", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ language: "es" })]);
    await reviewRequestPass.run(ctx());
    expect(sentMail().subject).toBe("¿Cómo le fue con Rio Roofing?");
    expect(sentMail().language).toBe("es");
    expect(sentMail().html).toContain("Cuéntenos cómo nos fue");
  });

  it("1 h 59 m after the anchor sends nothing and asks nothing (mutation: 2 h -> 0 -> FAILS)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    expect(await reviewRequestPass.run(ctx(at(COMPLETED, 2 * HOUR - 60_000)))).toEqual({ ...EMPTY, waitingForCheckin: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.recentReviewAsks).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("past 36 h it is never sent: an outage of days cannot come back up and mail a forgotten job", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    expect(await reviewRequestPass.run(ctx(at(COMPLETED, CHECKIN_MAX_AGE_MS + 60_000)))).toEqual({ ...EMPTY, waitingForCheckin: 1 });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("the same booking on the next tick sends nothing (the stamp is the one idempotency)", async () => {
    liveList([row()]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(await reviewRequestPass.run(ctx(at(TICK, 15 * 60_000)))).toEqual(EMPTY);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("an unresolvable zone is counted under its own name and sends nothing (the gate fails closed)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
    expect(emailSend).not.toHaveBeenCalled();
  });
});

describe("the sending hours are the consent chain's: a job completed at 20:30 Chicago", () => {
  const DONE = new Date("2026-09-10T01:30:00Z");        // Wed 20:30 CDT
  const HELD_ROW = (): AutomationLogRow => ({
    id: "log_1", account_id: ACCT, source: "review_request", channel: "email", contact_id: "ct_1",
    subject_key: `booking:${BK1}`, status: "held", reason: "Held until 8:00 AM — quiet hours",
    held_until: "2026-09-10T13:00:00.000Z", payload: {}, occurred_at: "2026-09-10T03:30:00.000Z",
  } as AutomationLogRow);
  const due = () => row({ completedAt: DONE.toISOString(), endsAt: "2026-09-10T00:30:00.000Z", startsAt: "2026-09-09T23:30:00.000Z" });

  it("is not sent at 21:00 (1 h 30 m), is HELD at 22:30 to 08:00 the next morning, and is sent once when released", async () => {
    const stamped = liveList([due()]);
    // 21:00 CDT: not yet two hours.
    expect(await reviewRequestPass.run(ctx(new Date("2026-09-10T02:00:00Z")))).toEqual({ ...EMPTY, waitingForCheckin: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    // 22:30 CDT: due, but the hours are closed: held, not stamped, not sent.
    expect(await reviewRequestPass.run(ctx(new Date("2026-09-10T03:30:00Z")))).toEqual({ ...EMPTY, held: 1 });
    expect(logged()).toEqual([expect.objectContaining({ status: "held", heldUntil: "2026-09-10T13:00:00.000Z" })]);
    expect(emailSend).not.toHaveBeenCalled();
    expect(stamped.size).toBe(0);
    // 08:00 CDT: the release pass brings it back and it goes, once.
    const release = ctx(new Date("2026-09-10T13:00:00Z"));
    expect(await releaseReviewRequest(release, HELD_ROW())).toBe("sent");
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(stamped.has(BK1)).toBe(true);
    // ...and the cron's own pass finds nothing to do afterwards.
    expect(await reviewRequestPass.run(release)).toEqual(EMPTY);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("a held check-in is RE-GATED on release, not re-banded: released past 36 h it is skipped, never sent, and leaves the queue", async () => {
    liveList([due()]);
    const late = ctx(at(DONE, CHECKIN_MAX_AGE_MS + 60_000));
    expect(await releaseReviewRequest(late, HELD_ROW())).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: "No longer due" })]);
  });

  it("a held check-in is re-checked against the 90 days on release: someone else's request went out meanwhile, so it is skipped and leaves the queue", async () => {
    liveList([due()]);
    dbMocks.recentReviewAsks.mockResolvedValue(true);
    expect(await releaseReviewRequest(ctx(new Date("2026-09-10T13:00:00Z")), HELD_ROW())).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: "No longer due" })]);
  });

  it("a billing pause holds a check-in only until anchor + 36 h, the CHECK-IN's cap and not the review request's 61 h (mutation: keep REVIEW_REQUEST_MAX_AGE_MS -> FAILS)", async () => {
    liveList([due()]);
    emailSend.mockRejectedValue(new EmailNotSent({ kind: "blocked", reason: "billing_paused" }));
    const nearTheEnd = at(DONE, CHECKIN_MAX_AGE_MS - 10 * 60_000);
    expect(await reviewRequestPass.run(ctx(nearTheEnd))).toEqual({ ...EMPTY, held: 1 });
    expect(logged()).toEqual([expect.objectContaining({ status: "held", heldUntil: at(DONE, CHECKIN_MAX_AGE_MS).toISOString() })]);
  });
});

describe("at most one request per customer per 90 days", () => {
  /** recentReviewAsks as the database answers it: true when the last ask is after the floor the pass passed. */
  const lastAsked = (when: Date) => dbMocks.recentReviewAsks.mockImplementation(
    async (_db: unknown, _acct: string, _who: unknown, sinceIso: string) => when.getTime() > new Date(sinceIso).getTime());

  it("a customer asked 40 days ago is not asked again: counted skippedRecentlyAsked, not sent, not stamped (mutation: remove the check -> FAILS)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    lastAsked(new Date(TICK.getTime() - 40 * DAY));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedRecentlyAsked: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("a customer asked 91 days ago is asked", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    lastAsked(new Date(TICK.getTime() - 91 * DAY));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("asks the data layer about the same account, the contact AND the address, with the floor at now - 90 days exactly", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    await reviewRequestPass.run(ctx());
    expect(dbMocks.recentReviewAsks).toHaveBeenCalledWith(
      expect.anything(), ACCT, { contactId: "ct_1", email: "ana@example.com" }, new Date(TICK.getTime() - 90 * DAY).toISOString());
  });

  it("two bookings for ONE address in one tick send ONE email, though the database cannot see the first stamp yet (mutation: drop the same-tick memory -> FAILS)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row(), second({ contactEmail: "Ana@Example.com" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedRecentlyAsked: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(1);
  });

  it("the memory reads the address the way the ledger does: case and a +tag are the same inbox", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row(), second({ contactEmail: "ANA+roof@example.com" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedRecentlyAsked: 1 });
  });

  it("the memory holds for one CONTACT with two bookings and two addresses", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row(), second({ contactId: "ct_1", contactEmail: "work@example.com" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedRecentlyAsked: 1 });
  });

  it("a row HELD for the hours counts as that address's ask: its twin is not held too", async () => {
    const done = new Date("2026-09-10T01:30:00Z");
    const mk = (over: Partial<DueReviewRequest>) => row({ completedAt: done.toISOString(), endsAt: "2026-09-10T00:30:00.000Z", ...over });
    dbMocks.listDueReviewRequests.mockResolvedValue([mk({}), mk({ bookingId: BK2, contactId: "ct_2", contactEmail: "ana@example.com" })]);
    expect(await reviewRequestPass.run(ctx(new Date("2026-09-10T03:30:00Z")))).toEqual({ ...EMPTY, held: 1, skippedRecentlyAsked: 1 });
  });

  it("different customers are all asked", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row(), second()]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 2 });
  });

  it("a read that fails sends NOTHING for that row (a failed 'not asked' would send): counted failed", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    dbMocks.recentReviewAsks.mockRejectedValue(new Error("db down"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("applies to the text channel too, by contact (a text has no address to key on)", async () => {
    // The text channel keeps today's flow (the morning band on a later day), so this is a morning in New York.
    const smsRow = row({
      config: { channel: "sms", reviewUrl: URL, checkin: true }, accountTimezone: "America/New_York",
      endsAt: "2026-09-08T22:00:00.000Z", startsAt: "2026-09-08T21:00:00.000Z", completedAt: null,
    });
    dbMocks.listDueReviewRequests.mockResolvedValue([smsRow]);
    dbMocks.recentReviewAsks.mockResolvedValue(true);
    expect(await reviewRequestPass.run(ctx(new Date("2026-09-09T14:00:00Z")))).toEqual({ ...EMPTY, skippedRecentlyAsked: 1 });
    expect(dbMocks.recentReviewAsks).toHaveBeenCalledWith(expect.anything(), ACCT, { contactId: "ct_1", email: null }, expect.any(String));
    expect(smsSend).not.toHaveBeenCalled();
  });
});

describe("every refusal is counted under its own name, sends nothing and stamps nothing", () => {
  const refused = async (r: DueReviewRequest, c: PassContext = ctx()) => {
    dbMocks.listDueReviewRequests.mockResolvedValue([r]);
    const result = await reviewRequestPass.run(c);
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    return result;
  };

  it("no email address on file: skippedNoAddress", async () => {
    expect(await refused(row({ contactEmail: null }))).toEqual({ ...EMPTY, skippedNoAddress: 1 });
  });

  it("no mailing address (null, absent, or blank): skippedNoMailingAddress, and it says so on the Activity page", async () => {
    for (const mailingAddress of [null, undefined, "", "   "]) {
      dbMocks.recordAutomationLog.mockClear();
      expect(await refused(row({ mailingAddress })), String(mailingAddress)).toEqual({ ...EMPTY, skippedNoMailingAddress: 1 });
      expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: "The company's mailing address isn't set" })]);
    }
  });

  it("no review link (a config that does not parse): skippedInvalidConfig", async () => {
    expect(await refused(row({ config: null }))).toEqual({ ...EMPTY, skippedInvalidConfig: 1 });
  });

  it("no usable origin, never a link that cannot work: skippedNoLink (the cron's own vercel.app origin is not a substitute)", async () => {
    expect(await refused(row(), ctx(TICK, ""))).toEqual({ ...EMPTY, skippedNoLink: 1 });
    expect(await refused(row(), ctx(TICK, "not a url"))).toEqual({ ...EMPTY, skippedNoLink: 1 });
  });

  it("a link that cannot be sealed (no secret): skippedNoLink", async () => {
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    expect(await refused(row())).toEqual({ ...EMPTY, skippedNoLink: 1 });
  });

  it("a booking id that is not a uuid cannot be sealed either: skippedNoLink, not a thrown error", async () => {
    expect(await refused(row({ bookingId: "bk_r1" }))).toEqual({ ...EMPTY, skippedNoLink: 1 });
  });

  it("a released row that is refused leaves the queue as a real skip, never parked", async () => {
    dbMocks.getDueReviewRequestById.mockResolvedValue({ due: row({ mailingAddress: null }) });
    const held = { id: "l", account_id: ACCT, source: "review_request", channel: "email", contact_id: "ct_1", subject_key: `booking:${BK1}`, status: "held", reason: "x", held_until: TICK.toISOString(), payload: {}, occurred_at: TICK.toISOString() } as AutomationLogRow;
    expect(await releaseReviewRequest(ctx(), held)).toBe("skipped");
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped" })]);
  });
});

describe("failures never cost a stamp or a second email", () => {
  it("a send that fails leaves it unstamped, counted failed, and the NEXT tick retries it", async () => {
    const stamped = liveList([row()]);
    emailSend.mockRejectedValueOnce(new Error("provider down"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(stamped.size).toBe(0);
    expect(await reviewRequestPass.run(ctx(at(TICK, 15 * 60_000)))).toEqual({ ...EMPTY, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(stamped.has(BK1)).toBe(true);
  });

  it("a stamp that keeps failing counts unstamped, after the send, with the retries it is owed (mutation: swallow it -> FAILS)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    dbMocks.stampReviewRequested.mockRejectedValue(new Error("db unavailable"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, unstamped: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });
});

describe("the recipe caps still bound the burst", () => {
  it("the tick cap holds for check-ins: ten go, the eleventh is counted skippedCap", async () => {
    const many = Array.from({ length: AUTOMATION_TICK_CAP + 1 }, (_, i) =>
      row({ bookingId: `9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f${String(i).padStart(2, "0")}`, contactId: `ct_${i}`, contactEmail: `c${i}@example.com` }));
    dbMocks.listDueReviewRequests.mockResolvedValue(many);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: AUTOMATION_TICK_CAP, skippedCap: 1 });
    // The capped row costs no 90-day read: the in-memory cap comes first.
    expect(dbMocks.recentReviewAsks).toHaveBeenCalledTimes(AUTOMATION_TICK_CAP);
  });
});

describe("dormant: an account without `checkin` is the review request it always was", () => {
  const MORNING = new Date("2026-09-09T14:00:00Z");   // NY 10:00, inside the morning band
  const old = () => row({
    config: { channel: "email", reviewUrl: URL }, accountTimezone: "America/New_York",
    endsAt: "2026-09-08T22:00:00.000Z", completedAt: null, startsAt: "2026-09-08T21:00:00.000Z", body: "",
  });

  it("sends the review request in the morning band, asks nothing of the 90 days, and returns the counters it always did, with no new key", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([old()]);
    expect(await reviewRequestPass.run(ctx(MORNING))).toEqual({ ...EMPTY, sent: 1 });
    expect(sentMail().subject).toBe("Would you leave Rio Roofing a review?");
    expect(dbMocks.recentReviewAsks).not.toHaveBeenCalled();
  });

  it("two hours after the job is NOT a time the old flow sends (it waits for the morning band)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([old()]);
    expect(await reviewRequestPass.run(ctx(new Date("2026-09-09T01:00:00Z")))).toEqual({ ...EMPTY, waitingForMorning: 1 });
  });

  it("a check-in flag on a config that is not on the email channel does not turn the check-in email on", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([old()].map((r) => ({ ...r, config: { channel: "sms" as const, reviewUrl: URL, checkin: true as const } })));
    const result = await reviewRequestPass.run(ctx(MORNING));
    expect(emailSend).not.toHaveBeenCalled();
    expect(result.sent).toBe(1);   // the text went, as the SMS channel always does
    expect(smsSend).toHaveBeenCalledTimes(1);
  });
});
