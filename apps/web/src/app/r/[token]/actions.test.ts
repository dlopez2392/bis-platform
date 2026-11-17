import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, writesOf } from "@/lib/checkin/fake-db";

const dbm = vi.hoisted(() => ({
  getCheckinForBooking: vi.fn(), recordCheckinAnswer: vi.fn(), ensureCheckinTask: vi.fn(), markReviewLinkOpened: vi.fn(),
  getAutomation: vi.fn(), serviceDb: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm }));
// next/navigation's redirect throws to unwind the action; here it throws a value the test can read.
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
const flowOverride = vi.hoisted(() => ({ reviewLinkTarget: null as null | (() => Promise<string | null>) }));
vi.mock("@/lib/checkin/flow", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/checkin/flow")>();
  return { ...real, reviewLinkTarget: (...a: Parameters<typeof real.reviewLinkTarget>) => (flowOverride.reviewLinkTarget ? flowOverride.reviewLinkTarget() : real.reviewLinkTarget(...a)) };
});

import { answerCheckinAction, reviewLinkAction } from "./actions";
import { sealCheckinToken } from "@/lib/checkin/token";
import type { JobCheckin } from "@bis/db";

const SECRET = "page-test-secret-0123456789abcdef-0123";
const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const OTHER_ACCT = "9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f50";
const BOOKING = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const OTHER_BOOKING = "7e3f8a2b-5d4c-4a6b-8c77-2b9c3e4f5a61";
const CONTACT = "11111111-2222-4333-8444-555555555555";
const REVIEW = "https://g.page/r/rio-roofing/review";
const EVIL = "https://evil.example/phish";
const TOKEN = sealCheckinToken({ v: 1, a: ACCT, b: BOOKING, l: "en", i: Date.now() - 3_600_000 }, SECRET);
const OLD_TOKEN = sealCheckinToken({ v: 1, a: ACCT, b: BOOKING, l: "en", i: Date.now() - 40 * 86_400_000 }, SECRET);

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirected = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return /^REDIRECT (.*)$/.exec((e as Error).message)?.[1] ?? Promise.reject(e); } };
const row = (answer: JobCheckin["answer"]): JobCheckin => ({ id: "c1", accountId: ACCT, bookingId: BOOKING, contactId: CONTACT, answer, answeredAt: new Date().toISOString(), reviewLinkOpenedAt: null });

let world: ReturnType<typeof fakeDb>;
/** recordCheckinAnswer as the database behaves: of any number of answers for one booking, the first is recorded. */
function firstWins() {
  let first: JobCheckin | null = null;
  dbm.recordCheckinAnswer.mockImplementation(async (_db, _a, _b, answer) => {
    if (first) return { status: "already", checkin: first };
    first = row(answer);
    return { status: "recorded", checkin: first };
  });
}

beforeEach(() => {
  for (const f of Object.values(dbm)) f.mockReset();
  flowOverride.reviewLinkTarget = null;
  world = fakeDb({
    bookings: [{ id: BOOKING, account_id: ACCT, status: "completed", contact_id: CONTACT }],
    contacts: [{ id: CONTACT, account_id: ACCT, first_name: "Ana", last_name: "García" }],
    accounts: [{ id: ACCT, language: "en" }],
  });
  dbm.serviceDb.mockImplementation(() => world.db);
  dbm.getAutomation.mockResolvedValue({ enabled: true, config: { channel: "email", reviewUrl: REVIEW, checkin: true } });
  dbm.ensureCheckinTask.mockResolvedValue({ id: "t1", created: true });
  dbm.markReviewLinkOpened.mockResolvedValue(true);
  firstWins();
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("answerCheckinAction", () => {
  it("records the answer for the TOKEN's booking and account, then shows the page again", async () => {
    const to = await redirected(answerCheckinAction(TOKEN, form({ answer: "great" })));
    expect(to).toBe(`/r/${TOKEN}`);
    expect(dbm.recordCheckinAnswer).toHaveBeenCalledTimes(1);
    expect(dbm.recordCheckinAnswer).toHaveBeenCalledWith(world.db, ACCT, BOOKING, "great");
  });

  it("takes the booking and account ONLY from the verified token: ids smuggled in the form body are ignored (mutation: read the booking id from the form -> FAILS)", async () => {
    await redirected(answerCheckinAction(TOKEN, form({ answer: "great", bookingId: OTHER_BOOKING, booking_id: OTHER_BOOKING, accountId: OTHER_ACCT, account_id: OTHER_ACCT, contactId: "x", contact_id: "x" })));
    expect(dbm.recordCheckinAnswer).toHaveBeenCalledWith(world.db, ACCT, BOOKING, "great");
    for (const call of dbm.recordCheckinAnswer.mock.calls) expect(call.slice(1, 3)).toEqual([ACCT, BOOKING]);
  });

  it("great and okay open no To-do; not great opens exactly ONE, on the check-in it recorded", async () => {
    await redirected(answerCheckinAction(TOKEN, form({ answer: "great" })));
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
    firstWins();
    await redirected(answerCheckinAction(TOKEN, form({ answer: "okay" })));
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
    firstWins();
    await redirected(answerCheckinAction(TOKEN, form({ answer: "not_great" })));
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(1);
    expect(dbm.ensureCheckinTask.mock.calls[0]![2]).toMatchObject({ answer: "not_great", bookingId: BOOKING, contactId: CONTACT });
  });

  it("a replay and a double submit (even at the same instant) record once and make ONE To-do (mutation: create the task on every answer -> FAILS)", async () => {
    await Promise.all([1, 2, 3].map(() => redirected(answerCheckinAction(TOKEN, form({ answer: "not_great" })))));
    await redirected(answerCheckinAction(TOKEN, form({ answer: "not_great" })));
    await redirected(answerCheckinAction(TOKEN, form({ answer: "great" })));
    expect(dbm.recordCheckinAnswer).toHaveBeenCalledTimes(5);
    const outcomes = await Promise.all(dbm.recordCheckinAnswer.mock.results.map((r) => r.value as Promise<{ status: string }>));
    expect(outcomes.map((o) => o.status).sort()).toEqual(["already", "already", "already", "already", "recorded"]);
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(1);
  });

  it("a different answer after the first one changes nothing and makes no To-do (the first answer wins)", async () => {
    await redirected(answerCheckinAction(TOKEN, form({ answer: "great" })));
    await redirected(answerCheckinAction(TOKEN, form({ answer: "not_great" })));
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("a conflict at the database (a contact merge moved the booking: the 23503 throw) is the designed 'tap again', nothing recorded or alerted, never a raw error", async () => {
    dbm.recordCheckinAnswer.mockReset().mockRejectedValue(new Error("recordCheckinAnswer failed: 23503"));
    const to = await redirected(answerCheckinAction(TOKEN, form({ answer: "not_great" })));
    expect(to).toBe(`/r/${TOKEN}?retry=1`);
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("a token that fails its MAC, or an unset secret, writes and reads nothing", async () => {
    expect(await redirected(answerCheckinAction(`${TOKEN}x`, form({ answer: "great" })))).toBeNull();
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    expect(await redirected(answerCheckinAction(TOKEN, form({ answer: "great" })))).toBeNull();
    expect(dbm.serviceDb).not.toHaveBeenCalled();
    expect(dbm.recordCheckinAnswer).not.toHaveBeenCalled();
  });

  it("an answer that is not one of the three, and a token past 30 days, record nothing and alert nobody", async () => {
    await redirected(answerCheckinAction(TOKEN, form({ answer: "terrible" })));
    await redirected(answerCheckinAction(TOKEN, form({})));
    await redirected(answerCheckinAction(OLD_TOKEN, form({ answer: "not_great" })));
    expect(dbm.recordCheckinAnswer).not.toHaveBeenCalled();
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("writes only through the answer path: the stub db sees no write of its own", async () => {
    await redirected(answerCheckinAction(TOKEN, form({ answer: "not_great" })));
    expect(writesOf(world.log)).toEqual([]);
  });
});

describe("reviewLinkAction", () => {
  it("counts the press once and sends the customer to the account's STORED link (303 via redirect)", async () => {
    expect(await redirected(reviewLinkAction(TOKEN, form({})))).toBe(REVIEW);
    expect(dbm.markReviewLinkOpened).toHaveBeenCalledTimes(1);
    expect(dbm.markReviewLinkOpened).toHaveBeenCalledWith(world.db, ACCT, BOOKING);
  });

  it("never redirects anywhere the request names: a url, a redirect, a next or a returnTo in the form body is ignored (mutation: read the URL from the request -> FAILS)", async () => {
    const to = await redirected(reviewLinkAction(TOKEN, form({ url: EVIL, redirect: EVIL, next: EVIL, returnTo: EVIL, reviewUrl: EVIL, review_url: EVIL, href: EVIL })));
    expect(to).toBe(REVIEW);
    expect(to).not.toContain("evil");
  });

  it("only an http(s) link redirects: anything else shows the page again, and the press is already counted by then, not before", async () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "ftp://x.example/a", "not a url", ""]) {
      flowOverride.reviewLinkTarget = async () => bad;
      expect(await redirected(reviewLinkAction(TOKEN, form({}))), JSON.stringify(bad)).toBe(`/r/${TOKEN}`);
    }
    flowOverride.reviewLinkTarget = async () => "http://example.com/review";
    expect(await redirected(reviewLinkAction(TOKEN, form({})))).toBe("http://example.com/review");
  });

  it("no stored link: the page again, nothing counted", async () => {
    dbm.getAutomation.mockResolvedValue(null);
    expect(await redirected(reviewLinkAction(TOKEN, form({})))).toBe(`/r/${TOKEN}`);
    expect(dbm.markReviewLinkOpened).not.toHaveBeenCalled();
  });

  it("a token past 30 days still reaches the review", async () => {
    expect(await redirected(reviewLinkAction(OLD_TOKEN, form({})))).toBe(REVIEW);
  });

  it("a token that fails its MAC, or an unset secret, reads and counts nothing", async () => {
    expect(await redirected(reviewLinkAction(`${TOKEN}x`, form({})))).toBeNull();
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    expect(await redirected(reviewLinkAction(TOKEN, form({})))).toBeNull();
    expect(dbm.serviceDb).not.toHaveBeenCalled();
    expect(dbm.markReviewLinkOpened).not.toHaveBeenCalled();
  });
});
