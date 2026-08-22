import { describe, it, expect, vi, beforeEach } from "vitest";

// `route.ts` reuses `safeZone`/`formatWhen` from the sibling public-booking
// actions module (per the task brief), which is a "use server" file that
// imports `next/headers` at its own top level — mocked here the same way
// `cancel/[token]/actions.test.ts` mocks it, even though this route itself
// never calls `headers()`.
vi.mock("next/headers", () => ({ headers: vi.fn() }));

const listDueRemindersMock = vi.fn();
const stampReminderSentMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  listDueReminders: (...a: unknown[]) => listDueRemindersMock(...a),
  stampReminderSent: (...a: unknown[]) => stampReminderSentMock(...a),
}));

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
}));

import { GET } from "./route";

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
    ...overrides,
  };
}

function req(bearer?: string) {
  return new Request(`${ORIGIN}/api/cron/reminders`, {
    headers: bearer ? { authorization: bearer } : {},
  });
}

function bookerZoneWhen(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(startsAt));
}

beforeEach(() => {
  listDueRemindersMock.mockReset().mockResolvedValue([]);
  stampReminderSentMock.mockReset().mockResolvedValue(undefined);
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "prov_1" });
  process.env.CRON_SECRET = SECRET;
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
    expect(body).toEqual({ sent: 1, failed: 1, unstamped: 0 });
    expect(stampReminderSentMock).toHaveBeenCalledTimes(1);
    expect(stampReminderSentMock).toHaveBeenCalledWith(expect.anything(), "bk_ok");
    expect(stampReminderSentMock).not.toHaveBeenCalledWith(expect.anything(), "bk_fail");
  });

  it("counts a stamp failure after a successful send as {sent:1,failed:0,unstamped:1}, not a send failure", async () => {
    // The stamp gets its OWN try/catch: a send that succeeds must count as
    // sent regardless of whether the follow-up stamp write lands. Folding
    // this into the outer catch would misreport a stamp failure as a send
    // failure in triage, and a mutant that removes the inner try/catch would
    // make this go red (send called once, but {sent:0,failed:1,unstamped:0}).
    const one = reminder({ bookingId: "bk_unstamped" });
    listDueRemindersMock.mockResolvedValue([one]);
    sendMock.mockResolvedValueOnce({ providerMessageId: "p1" });
    stampReminderSentMock.mockRejectedValueOnce(new Error("db unavailable"));

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body).toEqual({ sent: 1, failed: 0, unstamped: 1 });
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

    expect(body).toEqual({ sent: 1, failed: 0, unstamped: 0 });
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

  it("counts a reminder with no contact email as a failure, without stamping it", async () => {
    const noEmail = reminder({ bookingId: "bk_noemail", contactEmail: null });
    listDueRemindersMock.mockResolvedValue([noEmail]);

    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body).toEqual({ sent: 0, failed: 1, unstamped: 0 });
    expect(sendMock).not.toHaveBeenCalled();
    expect(stampReminderSentMock).not.toHaveBeenCalled();
  });
});
