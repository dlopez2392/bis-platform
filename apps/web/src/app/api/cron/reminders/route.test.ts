import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `route.ts` reuses `safeZone`/`formatWhen` from the shared
// `@/lib/booking/time` module (moved out of the sibling public-booking
// actions file — a "use server" file can only export async functions, and
// these two are sync). `next/headers` is mocked here the same way
// `cancel/[token]/actions.test.ts` mocks it, even though this route itself
// never calls `headers()`.
vi.mock("next/headers", () => ({ headers: vi.fn() }));

const listDueRemindersMock = vi.fn();
const stampReminderSentMock = vi.fn();
const listDueFollowupsMock = vi.fn();
const stampFollowupSentMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  listDueReminders: (...a: unknown[]) => listDueRemindersMock(...a),
  stampReminderSent: (...a: unknown[]) => stampReminderSentMock(...a),
  listDueFollowups: (...a: unknown[]) => listDueFollowupsMock(...a),
  stampFollowupSent: (...a: unknown[]) => stampFollowupSentMock(...a),
}));

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
}));

import { GET } from "./route";
import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";

/** Attempts, not retries: the first try is not a retry. */
const STAMP_ATTEMPTS = STAMP_RETRY_DELAYS_MS.length + 1;

const SECRET = "test_cron_secret";
const ORIGIN = "https://app.example.com";

/**
 * Distinctive, complete fixture — same reasoning as the sibling actions
 * tests: every field the route reads gets a value a passing test could not
 * fake by coincidence (e.g. booker/account zones that render differently for
 * the same instant, in `bookerZoneWhen` below).
 */
function reminder(overrides: Record<string, unknown> = {}) {
  return {
    bookingId: "bk_1",
    accountId: "acct_1",
    startsAt: "2026-08-20T20:00:00.000Z",
    bookerTimezone: "America/Los_Angeles",
    cancelToken: "tok_abc123",
    calendarPublicId: "cal_pub_1",
    contactEmail: "booker@example.com",
    contactName: "Jamie Booker",
    accountName: "Acme Co",
    accountTimezone: "America/New_York",
    branding: {
      brandName: "Acme Brand", brandLogoPath: null, brandColor: null,
      brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
      replyToEmail: "owner@acme.com",
    },
    fromEmail: null,
    meetingUrl: null,
    ...overrides,
  };
}

function req(bearer?: string) {
  return new Request(`${ORIGIN}/api/cron/reminders`, {
    headers: bearer ? { authorization: bearer } : {},
  });
}

/**
 * Same distinctive-fixture discipline as `reminder()` above, sized to
 * `DueFollowup`'s shape (Task 1, `packages/db/src/booking.ts`): `replyToEmail`
 * lives top-level here, NOT nested in `branding` the way the reminder fixture
 * carries it — that's the whole point of the top-level field (see
 * `listDueFollowups`'s doc comment), and a fixture that only set
 * `branding.replyToEmail` could not catch a route that read the wrong one.
 *
 * `endsAt` and `accountTimezone` together decide whether the send-time gate
 * lets this follow-up through at all. The default pair is "ended yesterday
 * evening, and it is now mid-morning in the account's zone" — see TICK_AT
 * below — so every pre-existing test in this file still exercises the send
 * path rather than the gate.
 */
function followup(overrides: Record<string, unknown> = {}) {
  return {
    bookingId: "bk_f1",
    accountId: "acct_1",
    startsAt: "2026-09-08T21:00:00.000Z",
    endsAt: "2026-09-08T22:00:00.000Z",     // America/New_York: Tue 18:00, the previous local day
    contactEmail: "booker@example.com",
    contactName: "Jamie Booker",
    accountName: "Acme Co",
    accountTimezone: "America/New_York",
    branding: {
      brandName: "Acme Brand", brandLogoPath: null, brandColor: null,
      brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
      replyToEmail: "wrong-should-not-be-used@acme.com",
    },
    fromEmail: "hello@acme.com",
    replyToEmail: "owner@acme.com",
    followupBody: "Great seeing you!",
    ...overrides,
  };
}

function bookerZoneWhen(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(startsAt));
}

const EMPTY_FOLLOWUPS = {
  sent: 0, failed: 0, unstamped: 0,
  skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0,
};

/**
 * The route reads `new Date()` to decide whether a follow-up's morning has
 * arrived, so the clock has to be pinned or every follow-up test below would
 * pass or fail depending on the hour the suite happened to run at.
 *
 * 2026-09-09T14:00:00Z is 10:00 in America/New_York (EDT) — mid-morning, and
 * the `followup()` fixture's meeting ended the previous local evening, so the
 * gate opens. Only `Date` is faked: the route awaits real promises and faking
 * timers wholesale would stall them.
 */
const TICK_AT = new Date("2026-09-09T14:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TICK_AT);
  listDueRemindersMock.mockReset().mockResolvedValue([]);
  stampReminderSentMock.mockReset().mockResolvedValue(undefined);
  listDueFollowupsMock.mockReset().mockResolvedValue([]);
  stampFollowupSentMock.mockReset().mockResolvedValue(undefined);
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "prov_1" });
  process.env.CRON_SECRET = SECRET;
  delete process.env.APP_ORIGIN;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/cron/reminders", () => {
  it("503s with no detail and makes zero queries when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
    expect(listDueRemindersMock).not.toHaveBeenCalled();
  });

  it("401s and makes zero queries on a wrong bearer", async () => {
    const res = await GET(req("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(listDueRemindersMock).not.toHaveBeenCalled();
  });

  it("401s and makes zero queries when the authorization header is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(listDueRemindersMock).not.toHaveBeenCalled();
  });

  it("sends both, stamps only the success, and reports {sent:1,failed:1} when the first send throws", async () => {
    // The send-then-stamp pin: a mutant that stamps before sending would
    // make `stampReminderSentMock` see BOTH booking ids, since the stamp for
    // "bk_fail" would fire before its send ever threw.
    const failing = reminder({ bookingId: "bk_fail", contactEmail: "fail@example.com" });
    const succeeding = reminder({ bookingId: "bk_ok", contactEmail: "ok@example.com" });
    listDueRemindersMock.mockResolvedValue([failing, succeeding]);
    sendMock
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce({ providerMessageId: "p1" });

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: 1, failed: 1, unstamped: 0, followups: EMPTY_FOLLOWUPS });
    expect(stampReminderSentMock).toHaveBeenCalledTimes(1);
    expect(stampReminderSentMock).toHaveBeenCalledWith(expect.anything(), "bk_ok");
    expect(stampReminderSentMock).not.toHaveBeenCalledWith(expect.anything(), "bk_fail");
  });

  it("retries a transient reminder stamp failure instead of leaving the row to re-mail the booker", async () => {
    // THE COST OF ONE FAILED STAMP AT THIS CADENCE. `listDueReminders`' window
    // is 75 minutes wide, so an unstamped row comes back on 5-6 consecutive
    // ticks and this booker gets 5-6 identical reminders 15 minutes apart. A
    // stamp failure is transient (a connection blip on a write that a
    // just-succeeded send proves the connection can carry), so it is retried.
    //
    // The send must NOT be repeated by the retry — only the stamp.
    const one = reminder({ bookingId: "bk_flaky_stamp" });
    listDueRemindersMock.mockResolvedValue([one]);
    stampReminderSentMock
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(undefined);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body).toEqual({ sent: 1, failed: 0, unstamped: 0, followups: EMPTY_FOLLOWUPS });
    expect(stampReminderSentMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a reminder stamp after a bounded number of attempts, still counting the send as sent", async () => {
    // The residual exposure, stated as a test: the retry SHRINKS the duplicate
    // window, it does not close it. When every attempt fails the row is left
    // unstamped on purpose (send-then-stamp is the deliberate trade — see
    // `stampReminderSent`'s doc comment) and reported so triage can see it.
    //
    // Bounded is the load-bearing word: an unbounded retry inside a cron tick
    // would strand every row queued behind this one.
    const one = reminder({ bookingId: "bk_unstamped" });
    listDueRemindersMock.mockResolvedValue([one]);
    sendMock.mockResolvedValueOnce({ providerMessageId: "p1" });
    stampReminderSentMock.mockRejectedValue(new Error("db unavailable"));

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    // Counted as sent, never as failed: folding the stamp into the outer catch
    // would misreport a stamp failure as a send failure in triage.
    expect(body).toEqual({ sent: 1, failed: 0, unstamped: 1, followups: EMPTY_FOLLOWUPS });
    expect(stampReminderSentMock).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("retries only the survivor on the next invocation, once the mock reflects the earlier stamp", async () => {
    // Simulates the second cron tick: `listDueReminders` now returns only the
    // reminder that was never stamped, exactly what a real dedupe-by-column
    // query would do once the successful one carries `reminder_sent_at`.
    const survivor = reminder({ bookingId: "bk_fail", contactEmail: "fail@example.com" });
    listDueRemindersMock.mockResolvedValue([survivor]);
    sendMock.mockResolvedValue({ providerMessageId: "p2" });

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body).toEqual({ sent: 1, failed: 0, unstamped: 0, followups: EMPTY_FOLLOWUPS });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(stampReminderSentMock).toHaveBeenCalledWith(expect.anything(), "bk_fail");
  });

  it("builds the cancel url from the request's own origin, the calendar public id, and the cancel token", async () => {
    const one = reminder({ calendarPublicId: "cal_pub_xyz", cancelToken: "tok_zzz999" });
    listDueRemindersMock.mockResolvedValue([one]);

    await GET(req(`Bearer ${SECRET}`));

    const sendArgs = sendMock.mock.calls[0]![0] as { body: string };
    expect(sendArgs.body).toContain(`${ORIGIN}/b/cal_pub_xyz/cancel/tok_zzz999`);
  });

  // The deliverability-saga fix (2026-08-27): a cron tick has no browser
  // behind it, so req.url's origin is the deployment's own vercel.app URL —
  // exactly the link/sender mismatch Gmail silently discarded mail over. When
  // APP_ORIGIN is set it must win over that request-derived origin, same as
  // the prior test proves the request-derived fallback still works when unset.
  it("builds the cancel url from APP_ORIGIN instead of the request's origin when it's set", async () => {
    process.env.APP_ORIGIN = "https://app.bis-rgv.com";
    const one = reminder({ calendarPublicId: "cal_pub_xyz", cancelToken: "tok_zzz999" });
    listDueRemindersMock.mockResolvedValue([one]);

    await GET(req(`Bearer ${SECRET}`));

    const sendArgs = sendMock.mock.calls[0]![0] as { body: string };
    expect(sendArgs.body).toContain("https://app.bis-rgv.com/b/cal_pub_xyz/cancel/tok_zzz999");
    expect(sendArgs.body).not.toContain(ORIGIN);
  });

  it("formats the when-string in the BOOKER's stored zone, distinct from the account's zone", async () => {
    const startsAt = "2026-08-20T20:00:00.000Z";
    const one = reminder({
      startsAt, bookerTimezone: "America/Los_Angeles", accountTimezone: "America/New_York",
    });
    listDueRemindersMock.mockResolvedValue([one]);

    await GET(req(`Bearer ${SECRET}`));

    const bookerWhen = bookerZoneWhen(startsAt, "America/Los_Angeles");
    const accountWhen = bookerZoneWhen(startsAt, "America/New_York");
    expect(bookerWhen).not.toBe(accountWhen); // guards the fixture itself

    const sendArgs = sendMock.mock.calls[0]![0] as { body: string };
    expect(sendArgs.body).toContain(bookerWhen);
    expect(sendArgs.body).not.toContain(accountWhen);
  });

  it("carries the account's from_email as fromAddress on the send (M4d: reminders are customer-facing outbound)", async () => {
    const withFrom = reminder({ fromEmail: "hello@acme.com" });
    listDueRemindersMock.mockResolvedValue([withFrom]);

    await GET(req(`Bearer ${SECRET}`));

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ fromAddress: "hello@acme.com" }),
    );
  });

  it("sends with fromAddress undefined when the account has no from_email set", async () => {
    const noFrom = reminder({ fromEmail: null });
    listDueRemindersMock.mockResolvedValue([noFrom]);

    await GET(req(`Bearer ${SECRET}`));

    // objectContaining alone can't distinguish "key absent" from "key present
    // with value undefined" — a mutant that stops passing fromAddress at all
    // would still satisfy it. Assert directly on the captured arg.
    const call = sendMock.mock.calls[0]![0] as { fromAddress?: string };
    expect(call.fromAddress).toBeUndefined();
  });

  it("carries meetingUrl into the sent reminder's join link when present, omits it when null", async () => {
    const withUrl = reminder({ bookingId: "bk_video", meetingUrl: "https://meet.example.com/room-1" });
    const withoutUrl = reminder({ bookingId: "bk_plain", contactEmail: "plain@example.com" });
    listDueRemindersMock.mockResolvedValue([withUrl, withoutUrl]);

    await GET(req(`Bearer ${SECRET}`));

    const [firstCall, secondCall] = sendMock.mock.calls as { body: string }[][];
    expect(firstCall![0]!.body).toContain("https://meet.example.com/room-1");
    expect(secondCall![0]!.body).not.toContain("Join your video meeting");
  });

  it("counts a reminder with no contact email as a failure, without stamping it", async () => {
    const noEmail = reminder({ bookingId: "bk_noemail", contactEmail: null });
    listDueRemindersMock.mockResolvedValue([noEmail]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body).toEqual({ sent: 0, failed: 1, unstamped: 0, followups: EMPTY_FOLLOWUPS });
    expect(sendMock).not.toHaveBeenCalled();
    expect(stampReminderSentMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/reminders — follow-up pass", () => {
  it("sends the follow-up with the company's from/reply-to, then stamps it", async () => {
    const one = followup();
    listDueFollowupsMock.mockResolvedValue([one]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      sent: 0, failed: 0, unstamped: 0,
      followups: {
        sent: 1, failed: 0, unstamped: 0,
        skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0,
      },
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "booker@example.com",
        fromAddress: "hello@acme.com",
        // The top-level `replyToEmail` DueFollowup carries, NOT the one
        // nested in `branding` — see the `followup()` fixture's comment.
        replyTo: "owner@acme.com",
      }),
    );
    expect(stampFollowupSentMock).toHaveBeenCalledTimes(1);
    expect(stampFollowupSentMock).toHaveBeenCalledWith(expect.anything(), "bk_f1");
  });

  it("never runs the follow-up pass ahead of the reminder pass's own result (reminders pass stays unchanged)", async () => {
    const dueReminder = reminder({ bookingId: "bk_r1" });
    const dueFollowup = followup({ bookingId: "bk_f1" });
    listDueRemindersMock.mockResolvedValue([dueReminder]);
    listDueFollowupsMock.mockResolvedValue([dueFollowup]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body).toEqual({
      sent: 1, failed: 0, unstamped: 0,
      followups: {
        sent: 1, failed: 0, unstamped: 0,
        skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0,
      },
    });
    expect(stampReminderSentMock).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(stampFollowupSentMock).toHaveBeenCalledWith(expect.anything(), "bk_f1");
  });

  // Send-then-stamp pin, mirroring the reminder pass's own pinned test: a
  // mutant that stamps before sending would make stampFollowupSentMock see
  // the failing booking id too, since its stamp would fire before the send
  // that's supposed to guard it ever threw.
  it("counts a failing follow-up send as failed and does NOT stamp it (send-then-stamp pin)", async () => {
    const failing = followup({ bookingId: "bk_f_fail" });
    listDueFollowupsMock.mockResolvedValue([failing]);
    sendMock.mockRejectedValueOnce(new Error("provider down"));

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups).toEqual({
      sent: 0, failed: 1, unstamped: 0,
      skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0,
    });
    expect(stampFollowupSentMock).not.toHaveBeenCalled();
  });

  it("counts a follow-up with no contact email as skippedNoEmail, sends nothing, stamps nothing", async () => {
    const noEmail = followup({ bookingId: "bk_f_noemail", contactEmail: null });
    listDueFollowupsMock.mockResolvedValue([noEmail]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    // Distinct from the reminder pass's null-email handling: that counts
    // toward `failed`, this counts toward its own `skippedNoEmail` bucket —
    // a follow-up with no email retries harmlessly until `listDueFollowups`'
    // 37h backward window ages it out, so it is never a "failure" to report.
    // (It was 25h under the daily cron; the Pro cadence re-derived it.)
    expect(body.followups).toEqual({
      sent: 0, failed: 0, unstamped: 0,
      skippedNoEmail: 1, waitingForMorning: 0, unresolvableTimezone: 0,
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(stampFollowupSentMock).not.toHaveBeenCalled();
  });

  it("retries a transient follow-up stamp failure — the worse of the two paths by more than double", async () => {
    // The morning band is THREE HOURS wide, so an unstamped follow-up comes
    // back on ~12 consecutive ticks: up to twelve identical "great seeing
    // you" emails, 15 minutes apart, before the band closes. The reminder
    // window is 75 minutes and costs 5-6. Same fix, bigger stake.
    const one = followup({ bookingId: "bk_f_flaky_stamp" });
    listDueFollowupsMock.mockResolvedValue([one]);
    stampFollowupSentMock
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(undefined);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups).toEqual({
      sent: 1, failed: 0, unstamped: 0,
      skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0,
    });
    expect(stampFollowupSentMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a follow-up stamp after a bounded number of attempts and counts it unstamped, not failed", async () => {
    const one = followup({ bookingId: "bk_f_unstamped" });
    listDueFollowupsMock.mockResolvedValue([one]);
    stampFollowupSentMock.mockRejectedValue(new Error("db unavailable"));

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups).toEqual({
      sent: 1, failed: 0, unstamped: 1,
      skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0,
    });
    expect(stampFollowupSentMock).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the two passes' retry budgets separate — one path exhausting its own does not spend the other's", async () => {
    // Separate loops, separate counters, separate retries. A shared or
    // short-circuiting budget would let a bad follow-up stamp suppress the
    // reminder pass's retry (or vice versa) and quietly reintroduce the
    // duplicate this whole change exists to bound.
    listDueRemindersMock.mockResolvedValue([reminder({ bookingId: "bk_r_stampfail" })]);
    listDueFollowupsMock.mockResolvedValue([followup({ bookingId: "bk_f_stampfail" })]);
    stampReminderSentMock.mockRejectedValue(new Error("db unavailable"));
    stampFollowupSentMock.mockRejectedValue(new Error("db unavailable"));

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.unstamped).toBe(1);
    expect(body.followups.unstamped).toBe(1);
    expect(stampReminderSentMock).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
    expect(stampFollowupSentMock).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
  });

  it("falls back to the default follow-up copy when followupBody is empty", async () => {
    const one = followup({ followupBody: "" });
    listDueFollowupsMock.mockResolvedValue([one]);

    await GET(req(`Bearer ${SECRET}`));

    const sendArgs = sendMock.mock.calls[0]![0] as { body: string };
    expect(sendArgs.body).toContain(
      "Thanks for coming in! If you have any questions or want to book again, "
      + "just reply to this email.",
    );
  });
});

/**
 * The send-time gate, at the route level. `shouldSendFollowupNow` is unit
 * tested exhaustively in `lib/booking/followup-timing.test.ts`; what is worth
 * proving HERE is that the route actually consults it, feeds it the meeting's
 * END (not its start) and the ACCOUNT's zone (not the server's), and runs it
 * ahead of the no-email check.
 *
 * Every test below runs at the one pinned instant TICK_AT
 * (2026-09-09T14:00:00Z) and varies only what the gate reads.
 */
describe("GET /api/cron/reminders — follow-ups wait for the next morning", () => {
  it("holds a meeting that ended earlier the SAME morning instead of chasing it an hour later", async () => {
    // 09:00 in America/New_York, one hour before the pinned tick. The
    // candidate query returns it — it ended well inside 37h — and the gate is
    // the only thing standing between this customer and an email sent while
    // they are still in the parking lot.
    const sameMorning = followup({ bookingId: "bk_f_parking_lot", endsAt: "2026-09-09T13:00:00.000Z" });
    listDueFollowupsMock.mockResolvedValue([sameMorning]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups).toEqual({
      sent: 0, failed: 0, unstamped: 0,
      skippedNoEmail: 0, waitingForMorning: 1, unresolvableTimezone: 0,
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(stampFollowupSentMock).not.toHaveBeenCalled();
  });

  it("reads the morning in each ACCOUNT's own zone, not one zone for the whole tick", async () => {
    // ONE tick, ONE meeting-end instant, two accounts. 14:00Z is 10:00 in
    // New_York (mid-morning, send) and 07:00 in Los_Angeles (still dawn,
    // wait). A route that used the server's zone, or UTC, or the first
    // account's zone for everyone would have to treat these two identically —
    // which is exactly the bug this asserts against.
    const ended = "2026-09-08T22:00:00.000Z";   // the previous local day in BOTH zones
    const eastern = followup({
      bookingId: "bk_f_east", endsAt: ended, accountTimezone: "America/New_York",
    });
    const pacific = followup({
      bookingId: "bk_f_west", endsAt: ended, accountTimezone: "America/Los_Angeles",
      contactEmail: "west@example.com",
    });
    listDueFollowupsMock.mockResolvedValue([eastern, pacific]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups).toEqual({
      sent: 1, failed: 0, unstamped: 0,
      skippedNoEmail: 0, waitingForMorning: 1, unresolvableTimezone: 0,
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "booker@example.com" }));
    expect(stampFollowupSentMock).toHaveBeenCalledTimes(1);
    expect(stampFollowupSentMock).toHaveBeenCalledWith(expect.anything(), "bk_f_east");
  });

  it("gates on the meeting's END, not its start", async () => {
    // A long meeting: it STARTED the previous local evening — which is what
    // the default fixture uses to qualify — but did not END until 09:00 this
    // morning. A route that passed `startsAt` to the gate would send.
    const ranLate = followup({
      bookingId: "bk_f_long",
      startsAt: "2026-09-08T22:00:00.000Z",
      endsAt: "2026-09-09T13:00:00.000Z",
    });
    listDueFollowupsMock.mockResolvedValue([ranLate]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups.waitingForMorning).toBe(1);
    expect(body.followups.sent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("never resurrects a stale booking, even though the query still hands it over", async () => {
    // Mid-morning, previous local day, every other rule satisfied — but the
    // meeting was a week ago. This is the multi-day-outage case: the cron
    // comes back up and must not mail people about meetings they have
    // forgotten. (The 37h query window makes this unreachable in production;
    // the gate refuses independently so a future widening cannot reintroduce
    // it silently.)
    const ancient = followup({ bookingId: "bk_f_ancient", endsAt: "2026-09-02T22:00:00.000Z" });
    listDueFollowupsMock.mockResolvedValue([ancient]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups.sent).toBe(0);
    expect(body.followups.waitingForMorning).toBe(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("counts a not-yet-morning follow-up with no email as waiting, not as skippedNoEmail", async () => {
    // Ordering pin: the gate runs BEFORE the no-email check. Otherwise every
    // emailless contact would log a skip 96 times a day for a tick that was
    // never going to send anyway.
    const noEmailNotYet = followup({
      bookingId: "bk_f_noemail_early", contactEmail: null, endsAt: "2026-09-09T13:00:00.000Z",
    });
    listDueFollowupsMock.mockResolvedValue([noEmailNotYet]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups).toEqual({
      sent: 0, failed: 0, unstamped: 0,
      skippedNoEmail: 0, waitingForMorning: 1, unresolvableTimezone: 0,
    });
  });

  it("a garbage account timezone is never thrown, and the reminder pass still completes", async () => {
    // `accounts.timezone` is free text at creation. A RangeError out of the
    // gate would abort the whole tick — including the reminder pass that has
    // already mailed people by the time the follow-up loop runs.
    const junkZone = followup({ bookingId: "bk_f_junk", accountTimezone: "Mars/Olympus" });
    listDueRemindersMock.mockResolvedValue([reminder({ bookingId: "bk_r_ok" })]);
    listDueFollowupsMock.mockResolvedValue([junkZone]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);   // the reminder only
    expect(stampReminderSentMock).toHaveBeenCalledWith(expect.anything(), "bk_r_ok");
  });

  it("refuses to send at an unknown hour: an unresolvable zone is held and counted separately", async () => {
    // ONE tick, TWO accounts, OPPOSITE verdicts — and the two are chosen so
    // the OLD behaviour had to treat them differently in exactly the wrong
    // direction. `safeZone(tz, "UTC")` silently substituted UTC for the junk,
    // and the follow-up then went out inside the 08:00-11:00 UTC band, which
    // in the Rio Grande Valley is 03:00-06:00 — a customer's phone at 3 a.m.
    //
    // At the pinned tick (14:00Z) Chicago reads 09:00, so the good account
    // sends. The broken one must be HELD, and held under its own name rather
    // than folded into `waitingForMorning`: an operator can fix a timezone,
    // but only if the difference between "not yet" and "we cannot tell you
    // when" is visible.
    const broken = followup({
      bookingId: "bk_f_badzone", accountTimezone: "Mars/Olympus",
    });
    const good = followup({
      bookingId: "bk_f_goodzone", accountTimezone: "America/Chicago",
      contactEmail: "chicago@example.com",
    });
    listDueFollowupsMock.mockResolvedValue([broken, good]);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups).toEqual({
      sent: 1, failed: 0, unstamped: 0, skippedNoEmail: 0,
      waitingForMorning: 0, unresolvableTimezone: 1,
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "chicago@example.com" }));
    expect(stampFollowupSentMock).toHaveBeenCalledTimes(1);
    expect(stampFollowupSentMock).toHaveBeenCalledWith(expect.anything(), "bk_f_goodzone");

    // Logged the way the route logs its other swallowed failures, and it must
    // name the booking AND the offending value — a log that only says "bad
    // timezone" cannot be acted on.
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("bk_f_badzone");
    expect(logged).toContain("Mars/Olympus");
    errSpy.mockRestore();
  });

  it("still sends for an account whose timezone genuinely IS UTC — fail-closed, not fail-on-everything", async () => {
    // The guard against detecting brokenness by the FALLBACK'S VALUE. "UTC" is
    // a real zone and a legitimate setting; at 09:30Z it is inside the band.
    // A check written as `zone === "UTC" means broken` would hold this, and
    // this account would simply never get a follow-up again.
    vi.setSystemTime(new Date("2026-09-09T09:30:00Z"));
    const utcAccount = followup({ bookingId: "bk_f_utc", accountTimezone: "UTC" });
    listDueFollowupsMock.mockResolvedValue([utcAccount]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.followups.sent).toBe(1);
    expect(body.followups.unresolvableTimezone).toBe(0);
    expect(stampFollowupSentMock).toHaveBeenCalledWith(expect.anything(), "bk_f_utc");
  });
});
