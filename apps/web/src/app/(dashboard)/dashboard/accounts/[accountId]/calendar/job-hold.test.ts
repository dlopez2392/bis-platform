import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobHoldClaim } from "@bis/db";

/**
 * F-046 part 1 (spec 6.5, 6.6): the settle of a staff job's Undo hold. `claimJobHold` and `stampJobNoticeSent`
 * are the REAL query functions, run on a recording fake client, so "the hold is settled" is read off the
 * write itself (`hold_settled_at`), never off a spy that says it was asked for. Every read the settle makes
 * besides those two is a named @bis/db spy. The email gate is the real one where a test says so (a refusal
 * must come from the gate's own rule, not a stand-in); everything else sends through `deps.send`, the cron
 * tick's shape. No test reaches an email provider: `@/lib/email` throws if anything asks for one.
 */
const db = vi.hoisted(() => ({
  getContact: vi.fn(),
  getCalendarForAccount: vi.fn(),
  getPlace: vi.fn(),
  loadAccountBrandInfo: vi.fn(),
  emit: vi.fn(),
  isAccountOutboundSuppressed: vi.fn(),
  readEmailSuppression: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  getContact: db.getContact,
  getCalendarForAccount: db.getCalendarForAccount,
  getPlace: db.getPlace,
  loadAccountBrandInfo: db.loadAccountBrandInfo,
  emit: db.emit,
  isAccountOutboundSuppressed: db.isAccountOutboundSuppressed,
  readEmailSuppression: db.readEmailSuppression,
  serviceDb: () => { throw new Error("tests pass their own db"); },
}));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => { throw new Error("no email provider in this test"); },
}));
vi.mock("@/lib/consent/email-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/consent/email-gate")>();
  return { ...actual, sendEmailOrThrow: vi.fn(actual.sendEmailOrThrow) };
});

import { sendEmailOrThrow, EmailNotSent, type EmailRequest } from "@/lib/consent/email-gate";
import {
  settleJobHold, settleAfterWindow, jobNoticeAvailability, JOB_NOTICE_MAX_AGE_MS,
} from "./job-hold";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";
import { formatWhen } from "@/lib/booking/time";

const NOW = new Date("2026-11-02T15:00:00.000Z");
const now = () => NOW;
const ORIGIN = "https://app.bis-rgv.com";
const ADDRESS = "maria@example.com";

type Write = { table: string; patch: Record<string, unknown>; filters: [string, string, unknown][] };

/** The bookings writes the two real query functions make, in order. `claim` is what the claim's
 *  conditional update answers (a row = this caller won; [] = someone else did, or nothing is due). */
const store = {
  writes: [] as Write[],
  claim: [] as unknown[],
  claimError: null as { message: string } | null,
  stampError: null as { message: string } | null,
  order: [] as string[],
};

const fakeDb = {
  from(table: string) {
    const w: Write = { table, patch: {}, filters: [] };
    const b = {
      update(patch: Record<string, unknown>) { w.patch = patch; store.writes.push(w); return b; },
      eq(c: string, v: unknown) { w.filters.push(["eq", c, v]); return b; },
      lte(c: string, v: unknown) { w.filters.push(["lte", c, v]); return b; },
      is(c: string, v: unknown) { w.filters.push(["is", c, v]); return b; },
      select() { return b; },
      then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
        let r: { data: unknown; error: { message: string } | null };
        if ("hold_settled_at" in w.patch) {
          store.order.push("claim");
          r = { data: store.claimError ? null : store.claim, error: store.claimError };
        } else if ("notice_sent_at" in w.patch) {
          store.order.push("stamp notice");
          r = { data: null, error: store.stampError };
        } else {
          r = { data: null, error: { message: `unexpected write to ${table}` } };
        }
        return Promise.resolve(r).then(resolve, reject);
      },
    };
    return b;
  },
};

const claims = () => store.writes.filter((w) => "hold_settled_at" in w.patch);
const noticeStamps = () => store.writes.filter((w) => "notice_sent_at" in w.patch);

const CLAIM: JobHoldClaim = {
  id: "bk_new", status: "booked", notice_wanted: "confirmation",
  starts_at: "2026-11-03T15:00:00.000Z", ends_at: "2026-11-03T16:00:00.000Z",
  contact_id: "contact_1", calendar_id: "cal_1", place_id: "00000000-0000-4000-8000-0000000000aa",
  meeting_url: null, cancel_token: "tok_new", rescheduled_from_id: null, author_id: "user_1",
  hold_until: "2026-11-02T14:59:45.000Z", created_at: "2026-11-02T14:59:30.000Z", booker_timezone: null,
};

const BRAND_INFO = {
  accountTimezone: "America/Chicago",
  branding: {
    brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: "owner@rio.test",
  },
  fromEmail: "hello@rio.test", replyToEmail: "owner@rio.test", outboundSuppressed: false,
  mailingAddress: null, accountLanguage: null as "en" | "es" | null,
};

const send = vi.fn(async (req: EmailRequest) => {
  store.order.push(`send ${req.kind}`);
  return { providerMessageId: "re_1" };
});
const sent = () => send.mock.calls.map((c) => c[0]);
const errorLog = () => vi.mocked(console.error).mock.calls.map((c) => c.map(String).join(" "));
const settle = (deps: Partial<Parameters<typeof settleJobHold>[2]> = {}) =>
  settleJobHold("acct_1", "bk_new", { db: fakeDb as never, origin: ORIGIN, now, send, ...deps });

beforeEach(() => {
  store.writes = [];
  store.claim = [{ ...CLAIM }];
  store.claimError = null;
  store.stampError = null;
  store.order = [];
  send.mockClear();
  db.getContact.mockReset().mockResolvedValue({ id: "contact_1", email: ` ${ADDRESS} `, first_name: "Maria", language: null });
  db.getCalendarForAccount.mockReset().mockResolvedValue({ id: "cal_1", public_id: "pub_1", enabled: true });
  db.getPlace.mockReset().mockResolvedValue({ id: CLAIM.place_id, label: "Home", address: "1 Main St" });
  db.loadAccountBrandInfo.mockReset().mockImplementation(async () => new Map([["acct_1", { ...BRAND_INFO }]]));
  db.emit.mockReset().mockImplementation(async (_d, _a, type: string) => { store.order.push(`emit ${type}`); });
  db.isAccountOutboundSuppressed.mockReset().mockResolvedValue(false);
  db.readEmailSuppression.mockReset().mockResolvedValue(null);
  vi.mocked(sendEmailOrThrow).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("settleJobHold — the claim decides who settles (spec 6.5 step 1)", () => {
  it("claims the hold first, scoped to this account and booking, booked and due and unclaimed, stamping hold_settled_at at the tick's now (mutation: skip the claim → FAILS)", async () => {
    expect(await settle()).toBe("sent");
    expect(claims()).toHaveLength(1);
    const c = claims()[0]!;
    expect(c.table).toBe("bookings");
    expect(c.patch).toEqual({ hold_settled_at: NOW.toISOString() });
    expect(c.filters).toEqual(expect.arrayContaining([
      ["eq", "account_id", "acct_1"], ["eq", "id", "bk_new"], ["eq", "status", "booked"],
      ["lte", "hold_until", NOW.toISOString()], ["is", "hold_settled_at", null],
    ]));
    expect(store.order[0]).toBe("claim");
  });

  it("a lost claim (the Undo or the other settler won) sends nothing, emits nothing and reads nothing: lost (mutation: skip the claim → FAILS)", async () => {
    store.claim = [];
    expect(await settle()).toBe("lost");
    expect(send).not.toHaveBeenCalled();
    expect(db.emit).not.toHaveBeenCalled();
    expect(db.getContact).not.toHaveBeenCalled();
    expect(noticeStamps()).toEqual([]);
  });

  it("a row moved or cancelled inside its hold is never claimed (claimJobHold takes booked rows only): lost, no send, no event", async () => {
    store.claim = [];   // the conditional update's status = 'booked' filter matched nothing
    expect(await settle()).toBe("lost");
    expect(claims()[0]!.filters).toContainEqual(["eq", "status", "booked"]);
    expect(send).not.toHaveBeenCalled();
    expect(db.emit).not.toHaveBeenCalled();
  });
});

describe("settleJobHold — the hold's events (D8, extended to moves)", () => {
  it("an add writes booking.created as the person who added it, once the hold is claimed and before any email", async () => {
    expect(await settle()).toBe("sent");
    expect(db.emit.mock.calls).toEqual([
      [fakeDb, "acct_1", "booking.created", "user_1", { bookingId: "bk_new", calendarId: "cal_1", contactId: "contact_1" }, "user"],
    ]);
    expect(store.order.indexOf("emit booking.created")).toBeLessThan(store.order.indexOf("send staff.booking_confirmation"));
  });

  it("a staff move's new row writes booking.created AND the old row's booking.status_changed cancelled, the two events moveBooking no longer writes (mutation: skip the second → FAILS)", async () => {
    store.claim = [{ ...CLAIM, rescheduled_from_id: "bk_old", notice_wanted: "moved" }];
    expect(await settle()).toBe("sent");
    expect(db.emit.mock.calls).toEqual([
      [fakeDb, "acct_1", "booking.created", "user_1", { bookingId: "bk_new", calendarId: "cal_1", contactId: "contact_1" }, "user"],
      [fakeDb, "acct_1", "booking.status_changed", "user_1", { bookingId: "bk_old", status: "cancelled" }, "user"],
    ]);
  });

  it("an event that fails to write is logged and the email still goes: the hold is already settled", async () => {
    db.emit.mockRejectedValue(new Error("events down"));
    expect(await settle()).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(errorLog().some((l) => l.includes("bk_new") && l.includes("events"))).toBe(true);
  });
});

describe("settleJobHold — when nothing is sent", () => {
  it("no email wanted: quiet, after the event, and no notice stamp", async () => {
    store.claim = [{ ...CLAIM, notice_wanted: null }];
    expect(await settle()).toBe("quiet");
    expect(db.emit).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(noticeStamps()).toEqual([]);
  });

  it("a job that has already started: too_late, never sent (mutation: drop the start check → FAILS)", async () => {
    store.claim = [{ ...CLAIM, starts_at: NOW.toISOString() }];
    expect(await settle()).toBe("too_late");
    expect(send).not.toHaveBeenCalled();
    expect(db.emit).toHaveBeenCalledTimes(1);
  });

  it(`a hold more than JOB_NOTICE_MAX_AGE_MS (24 h) past due: too_late, never sent; just under it still sends (mutation: drop the age check → FAILS)`, async () => {
    expect(JOB_NOTICE_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    const far = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
    store.claim = [{ ...CLAIM, starts_at: far, hold_until: new Date(NOW.getTime() - JOB_NOTICE_MAX_AGE_MS).toISOString() }];
    expect(await settle()).toBe("too_late");
    expect(send).not.toHaveBeenCalled();
    store.claim = [{ ...CLAIM, starts_at: far, hold_until: new Date(NOW.getTime() - JOB_NOTICE_MAX_AGE_MS + 1000).toISOString() }];
    expect(await settle()).toBe("sent");
  });
});

describe("settleJobHold — the confirmation and the moved email (spec 6.5 step 4, 6.6)", () => {
  it("confirmation: one send as staff.booking_confirmation to the contact, in English, with the brand's sender, the address line and the three links; then the notice is stamped once: sent", async () => {
    expect(await settle()).toBe("sent");
    expect(sent()).toHaveLength(1);
    const req = sent()[0]!;
    expect(req).toMatchObject({
      accountId: "acct_1", kind: "staff.booking_confirmation", contactId: "contact_1", language: "en",
      origin: ORIGIN, to: ADDRESS, fromName: "Rio Roofing", fromAddress: "hello@rio.test", replyTo: "owner@rio.test",
      subject: "You're booked in",
    });
    expect(req.body).toContain("You're booked in.");
    expect(req.body).toContain("Where: Home · 1 Main St");
    expect(req.body).toContain(`Cancel this booking: ${ORIGIN}/b/pub_1/cancel/tok_new`);
    expect(req.body).toContain(`Add to your calendar: ${ORIGIN}/b/pub_1/ics/tok_new`);
    expect(req.body).toContain(`Change the time: ${ORIGIN}/b/pub_1/move/tok_new`);
    expect(req.html).toContain("Home · 1 Main St");
    expect(noticeStamps()).toHaveLength(1);
    expect(noticeStamps()[0]!.filters).toEqual([["eq", "account_id", "acct_1"], ["eq", "id", "bk_new"]]);
    expect(store.order).toEqual(["claim", "emit booking.created", "send staff.booking_confirmation", "stamp notice"]);
  });

  it("a Spanish customer gets Spanish subject, body, links and language end to end (S-09: the contact's language over the account's)", async () => {
    db.getContact.mockResolvedValue({ id: "contact_1", email: ADDRESS, language: "es" });
    db.loadAccountBrandInfo.mockImplementation(async () => new Map([["acct_1", { ...BRAND_INFO, accountLanguage: "en" }]]));
    expect(await settle()).toBe("sent");
    const req = sent()[0]!;
    expect(req.language).toBe("es");
    expect(req.subject).toBe("Tu cita quedó agendada");
    expect(req.body).toContain("Tu cita quedó agendada.");
    expect(req.body).toContain("Dónde: Home · 1 Main St");
    expect(req.body).toContain(`${ORIGIN}/b/pub_1/cancel/tok_new?locale=es`);
    expect(req.body).not.toContain("You're booked in");
    expect(req.body).not.toMatch(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
  });

  it("no language on the contact: the account's (recipientLanguage, L3)", async () => {
    db.loadAccountBrandInfo.mockImplementation(async () => new Map([["acct_1", { ...BRAND_INFO, accountLanguage: "es" }]]));
    await settle();
    expect(sent()[0]!.language).toBe("es");
  });

  it("the address line is label and address, either alone when the other is missing, and no line without a place", async () => {
    db.getPlace.mockResolvedValue({ id: CLAIM.place_id, label: null, address: "1 Main St" });
    await settle();
    expect(sent()[0]!.body).toContain("Where: 1 Main St\n");

    store.claim = [{ ...CLAIM }];
    db.getPlace.mockResolvedValue({ id: CLAIM.place_id, label: "Shop", address: "  " });
    await settle();
    expect(sent()[1]!.body).toContain("Where: Shop\n");

    store.claim = [{ ...CLAIM, place_id: null }];
    db.getPlace.mockClear();
    await settle();
    expect(db.getPlace).not.toHaveBeenCalled();
    expect(sent()[2]!.body).not.toContain("Where");
  });

  it("the job's own \"what\" line never reaches the customer (owner decision 4), even if a row carries it", async () => {
    store.claim = [{ ...CLAIM, note: "Replace the water heater, gate code 4471" } as JobHoldClaim];
    await settle();
    const req = sent()[0]!;
    expect(req.body).not.toContain("water heater");
    expect(req.html).not.toContain("water heater");
  });

  it("a disabled calendar gets no move link (its move page answers offline), but keeps cancel and the calendar file (mutation: always add the move link → FAILS)", async () => {
    db.getCalendarForAccount.mockResolvedValue({ id: "cal_1", public_id: "pub_1", enabled: false });
    expect(await settle()).toBe("sent");
    const req = sent()[0]!;
    expect(req.body).not.toContain("/move/");
    expect(req.html).not.toContain("/move/");
    expect(req.body).toContain(`${ORIGIN}/b/pub_1/cancel/tok_new`);
    expect(req.body).toContain(`${ORIGIN}/b/pub_1/ics/tok_new`);
  });

  it("moved: staff.booking_moved, the moved email's words", async () => {
    store.claim = [{ ...CLAIM, rescheduled_from_id: "bk_old", notice_wanted: "moved" }];
    expect(await settle()).toBe("sent");
    const req = sent()[0]!;
    expect(req.kind).toBe("staff.booking_moved");
    expect(req.subject).toBe("Your booking has been moved");
    expect(req.body).toContain("Your booking has been moved.");
    expect(req.body).toContain("Where: Home · 1 Main St");
  });

  // F-046 follow-up: a staff move of a booking the customer made keeps the zone they booked in (moveBooking
  // carries booker_timezone over), and the moved email reads it as the customer's own move does
  // (b/[publicId]/move/[token]/actions.ts): their zone first, the company's line under it.
  it("moved: the time reads in the BOOKING's zone, the company's zone under it (mutation: account zone for both → FAILS)", async () => {
    store.claim = [{ ...CLAIM, rescheduled_from_id: "bk_old", notice_wanted: "moved", booker_timezone: "America/New_York" } as JobHoldClaim];
    expect(await settle()).toBe("sent");
    const req = sent()[0]!;
    const starts = new Date(CLAIM.starts_at);
    const booker = formatWhen(starts, "America/New_York", "en");
    const company = formatWhen(starts, "America/Chicago", "en");
    expect(booker).not.toBe(company);
    expect(req.body).toContain(`Your booking has been moved.

${booker}
`);
    expect(req.body).toContain(company);
    expect(req.html).toContain(booker);
  });

  it("a staff-made job (no booking zone) reads in the account's zone, once", async () => {
    store.claim = [{ ...CLAIM, booker_timezone: null } as JobHoldClaim];
    await settle();
    const when = formatWhen(new Date(CLAIM.starts_at), "America/Chicago", "en");
    expect(sent()[0]!.body.split(when).length - 1).toBe(1);
  });

  it("a booking zone that is not a real zone falls back to the account's (safeZone), never a failed send", async () => {
    store.claim = [{ ...CLAIM, notice_wanted: "moved", booker_timezone: "Mars/Olympus" } as JobHoldClaim];
    expect(await settle()).toBe("sent");
    expect(sent()[0]!.body).toContain(formatWhen(new Date(CLAIM.starts_at), "America/Chicago", "en"));
  });

  it("a video job's room link goes in the email", async () => {
    store.claim = [{ ...CLAIM, meeting_url: "https://rio.daily.co/bis-1" }];
    await settle();
    expect(sent()[0]!.body).toContain("Join your video meeting: https://rio.daily.co/bis-1");
  });

  it("without deps.send it sends through the email gate on the settle's own client", async () => {
    db.isAccountOutboundSuppressed.mockResolvedValue(true);   // stop the real gate before any provider
    await settle({ send: undefined });
    expect(vi.mocked(sendEmailOrThrow)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmailOrThrow).mock.calls[0]![1]).toEqual({ db: fakeDb });
  });
});

describe("settleJobHold — a hold settles exactly once whatever the send does", () => {
  it("THE GATE REFUSES (a suppressed account, email-gate step 2b): the hold is still settled (hold_settled_at written by the claim), quiet, no notice stamp, never retried (mutation: return before the claim on a gate refusal → FAILS)", async () => {
    db.isAccountOutboundSuppressed.mockResolvedValue(true);
    expect(await settle({ send: undefined })).toBe("quiet");
    expect(claims()).toHaveLength(1);
    expect(claims()[0]!.patch).toEqual({ hold_settled_at: NOW.toISOString() });
    expect(db.isAccountOutboundSuppressed).toHaveBeenCalledWith(fakeDb, "acct_1");
    expect(vi.mocked(sendEmailOrThrow)).toHaveBeenCalledTimes(1);
    expect(noticeStamps()).toEqual([]);
  });

  it.each([
    ["stopped"], ["suppressed"], ["no_address"], ["ledger_unavailable"], ["unsubscribe_unavailable"],
  ] as const)("any other gate refusal (%s): settled by the claim, quiet, sent once, no notice stamp", async (reason) => {
    send.mockRejectedValueOnce(new EmailNotSent({ kind: "blocked", reason }));
    expect(await settle()).toBe("quiet");
    expect(claims()).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(noticeStamps()).toEqual([]);
  });

  it("a send that throws: failed, logged by booking id and never the address (even when the provider quotes it), no notice stamp, and NOT retried (mutation: retry once → FAILS; mutation: log String(e) → FAILS)", async () => {
    // A provider's own words can quote the recipient ("550 <maria@example.com>: recipient rejected").
    send.mockRejectedValueOnce(new EmailNotSent({ kind: "failed", stage: "provider", error: `550 <${ADDRESS}>: recipient rejected` }));
    expect(await settle()).toBe("failed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(claims()).toHaveLength(1);
    expect(noticeStamps()).toEqual([]);
    expect(errorLog().some((l) => l.includes("bk_new"))).toBe(true);
    expect(errorLog().some((l) => l.toLowerCase().includes(ADDRESS))).toBe(false);
  });

  it("a plain error from the send is failed too, once", async () => {
    send.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await settle()).toBe("failed");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sent, but the notice stamp keeps failing: still sent (the email went), logged, the hold settled", async () => {
    store.stampError = { message: "db down" };
    expect(await settle()).toBe("sent");
    expect(noticeStamps().length).toBeGreaterThan(1);   // stampWithRetry's attempts
    expect(send).toHaveBeenCalledTimes(1);
    expect(errorLog().some((l) => l.includes("bk_new") && l.includes("notice_sent_at"))).toBe(true);
  });

  it("no address on the contact: failed, logged, nothing sent, the hold settled", async () => {
    db.getContact.mockResolvedValue({ id: "contact_1", email: null, language: null });
    expect(await settle()).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(claims()).toHaveLength(1);
  });
});

describe("settleJobHold never throws", () => {
  it("a read that throws after the claim: failed", async () => {
    db.getContact.mockRejectedValue(new Error("contacts down"));
    await expect(settle()).resolves.toBe("failed");
  });

  it("a claim that errors: failed, nothing sent", async () => {
    store.claimError = { message: "db down" };
    await expect(settle()).resolves.toBe("failed");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("settleAfterWindow — the after() job", () => {
  it("sleeps exactly UNDO_WINDOW_MS + NOTICE_GRACE_MS, THEN claims, on the client it is given", async () => {
    const sleep = vi.fn(async (ms: number) => { store.order.push(`sleep ${ms}`); });
    db.isAccountOutboundSuppressed.mockResolvedValue(true);   // the real gate refuses: no provider
    expect(await settleAfterWindow("acct_1", "bk_new", ORIGIN, { db: fakeDb as never, sleep })).toBe("quiet");
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(store.order.slice(0, 2)).toEqual([`sleep ${UNDO_WINDOW_MS + NOTICE_GRACE_MS}`, "claim"]);
  });

  it("waits waitMs instead when given (the Undo of a move re-arms its restored row)", async () => {
    const sleep = vi.fn(async (ms: number) => { store.order.push(`sleep ${ms}`); });
    store.claim = [];
    expect(await settleAfterWindow("acct_1", "bk_new", ORIGIN, { db: fakeDb as never, sleep, waitMs: 7_000 })).toBe("lost");
    expect(store.order).toEqual(["sleep 7000", "claim"]);
  });
});

describe("jobNoticeAvailability — can a confirmation go to this customer at all (spec 5.4)", () => {
  const readDb = { tag: "read" };
  const writer = { tag: "writer" };
  const ask = () => jobNoticeAvailability(readDb as never, writer as never, "acct_1", "contact_1");

  it("available: an address, an account that sends, an address that has not bounced; the contact read on readDb, the two facts on writer", async () => {
    db.getContact.mockResolvedValue({ id: "contact_1", email: " Maria@Example.com " });
    expect(await ask()).toBe("available");
    expect(db.getContact).toHaveBeenCalledWith(readDb, "acct_1", "contact_1");
    expect(db.isAccountOutboundSuppressed).toHaveBeenCalledWith(writer, "acct_1");
    expect(db.readEmailSuppression).toHaveBeenCalledWith(writer, "acct_1", ADDRESS);
  });

  it("no address: no_email, and nothing else is read", async () => {
    db.getContact.mockResolvedValue({ id: "contact_1", email: null });
    expect(await ask()).toBe("no_email");
    expect(db.isAccountOutboundSuppressed).not.toHaveBeenCalled();
  });

  it("a suppressed account: suppressed_account", async () => {
    db.isAccountOutboundSuppressed.mockResolvedValue(true);
    expect(await ask()).toBe("suppressed_account");
  });

  it("a hard bounce or complaint on the address: address_blocked", async () => {
    db.readEmailSuppression.mockResolvedValue({ method: "hard_bounce", since: "2026-10-01T00:00:00Z", eventId: 7 });
    expect(await ask()).toBe("address_blocked");
  });

  it("a read that fails THROWS (the caller fails open to no email)", async () => {
    db.readEmailSuppression.mockRejectedValue(new Error("db down"));
    await expect(ask()).rejects.toThrow("db down");
  });
});
