import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  readConsentState: vi.fn(), readPhoneCountryFlag: vi.fn(), readAccountTimezone: vi.fn(), recordCarrierBlock: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const sender = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => sender);
const factory = vi.hoisted(() => ({ getSmsProvider: vi.fn() }));
vi.mock("@/lib/sms", () => factory);

import { decideSms, deliverSms, sendSms, answersStop, STOP_CONFIRMATION_WINDOW_MS, type SmsRequest, type ClearedSms } from "./gate";
import { SMS_KINDS, type SmsKind } from "./classes";
import { SmsProviderError } from "@/lib/sms/types";
import { m } from "@/lib/messages";

const DB = {} as never;
const FROM = "+19565550000";
// Tue 2026-10-06 15:00 in Chicago (CDT): inside every window.
const DAY = new Date("2026-10-06T20:00:00Z");
const base = (over: Partial<SmsRequest> = {}): SmsRequest => ({
  accountId: "acct_1", kind: "automation.sms_reminder", to: "(956) 292-1696", body: "See you at 3",
  contactId: "ct_1", accountZone: "America/Chicago", now: DAY, ...over,
});
const send = vi.fn();
const provider = (over: Record<string, unknown> = {}) => ({ isFake: true, send, ...over });

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(sender), ...Object.values(factory), send]) fn.mockReset();
  sender.resolveSmsSender.mockResolvedValue({ ok: true, from: FROM, ownedNumbers: [FROM] });
  db.readConsentState.mockResolvedValue({ state: "allowed" });
  db.readPhoneCountryFlag.mockResolvedValue(false);
  db.readAccountTimezone.mockResolvedValue("America/Chicago");
  db.recordCarrierBlock.mockResolvedValue("appended");
  factory.getSmsProvider.mockReturnValue(provider());
  send.mockResolvedValue({ providerMessageId: "p_1" });
  // m2: vi.spyOn on an already-spied console.error does NOT reset its
  // .mock.calls (vitest keeps the one spy and only re-applies the
  // implementation), so calls accumulate across tests in this file unless
  // cleared here. Without this, `mock.calls[0]` in a later test can be a
  // PREVIOUS test's log line.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(console.error).mockClear();
});

describe("decideSms: steps 1-3", () => {
  it("throws on a kind the registry does not hold (mutation: drop the isSmsKind check → resolves, FAILS)", async () => {
    await expect(decideSms(DB, base({ kind: "automation.nope" as SmsKind }))).rejects.toThrow(/unknown SMS kind "automation.nope"/);
  });

  it("normalises `to`: a Reynosa number is +52, and nothing textable is blocked no_number before any read (mutation: skip the normalisation → +1 8999221234, FAILS)", async () => {
    const d = await decideSms(DB, base({ to: "899 922 1234" }));
    expect(d.kind === "clear" && d.send.to).toBe("+528999221234");
    expect(await decideSms(DB, base({ to: "call me" }))).toEqual({ kind: "blocked", reason: "no_number" });
    expect(sender.resolveSmsSender).toHaveBeenCalledTimes(1);
  });

  it("the A2P sender check runs for every path and its refusal is the reason; the ledger is not read (mutation: drop step 3 → clear, FAILS)", async () => {
    sender.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    expect(await decideSms(DB, base({ kind: "staff.composer_sms" }))).toEqual({ kind: "blocked", reason: "a2p_not_approved" });
    expect(db.readConsentState).not.toHaveBeenCalled();
  });

  it("resolveSmsSender's OWN read error THROWS, as it always has, into decideSms's and sendSms's callers; send never runs (mutation M15: swallow it as a2p_not_approved → FAILS)", async () => {
    sender.resolveSmsSender.mockRejectedValue(new Error("resolveSmsSender failed: fetch failed"));
    await expect(decideSms(DB, base())).rejects.toThrow(/resolveSmsSender failed/);
    await expect(sendSms(DB, base())).rejects.toThrow(/resolveSmsSender failed/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("decideSms: steps 4-5, the ledger and the flag", () => {
  it.each(Object.keys(SMS_KINDS) as SmsKind[])(
    "%s is blocked by a stop: a stop covers everything (decision 2) (mutation: skip the ledger for staff or operator kinds → FAILS)",
    async (kind) => {
      db.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "carrier_block", eventId: "e1" });
      expect(await decideSms(DB, base({ kind }))).toEqual({ kind: "blocked", reason: "stopped" });
      expect(db.readConsentState).toHaveBeenCalledWith(DB, "acct_1", "sms", "+19562921696");
    });

  it("a hold blocks as held, not as stopped (mutation: map held to stopped → FAILS)", async () => {
    db.readConsentState.mockResolvedValue({ state: "held", since: "2026-10-01T00:00:00Z", method: "free_text", eventId: "e2" });
    expect(await decideSms(DB, base())).toEqual({ kind: "blocked", reason: "held" });
  });

  it("an unreadable ledger FAILS CLOSED as ledger_unavailable and logs no phone number (mutation: catch → allowed → clear, FAILS)", async () => {
    db.readConsentState.mockRejectedValue(new Error("readConsentState failed: timeout"));
    expect(await decideSms(DB, base())).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    const line = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(line).toMatch(/automation\.sms_reminder for account acct_1 blocked/);
    expect(line).not.toMatch(/956/);
  });

  it("a flag READ error FAILS CLOSED too: decideSms and sendSms both block ledger_unavailable, send never runs (mutation M7: readPhoneCountryFlag(...).catch(() => false) → FAILS)", async () => {
    db.readPhoneCountryFlag.mockRejectedValue(new Error("readPhoneCountryFlag failed: timeout"));
    expect(await decideSms(DB, base())).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(await sendSms(DB, base())).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a contact whose country is unconfirmed is blocked; with no contact the flag is never read (mutation: skip the flag → clear, FAILS)", async () => {
    db.readPhoneCountryFlag.mockResolvedValue(true);
    expect(await decideSms(DB, base())).toEqual({ kind: "blocked", reason: "unconfirmed_number" });
    expect(db.readPhoneCountryFlag).toHaveBeenCalledWith(DB, "acct_1", "ct_1");
    db.readPhoneCountryFlag.mockClear();
    expect((await decideSms(DB, base({ contactId: null }))).kind).toBe("clear");
    expect(db.readPhoneCountryFlag).not.toHaveBeenCalled();
  });

  it("a number from the CARRIER is not held on the contact's stored flag, at decide or at deliver (mutation: check the flag anyway → unconfirmed_number, FAILS)", async () => {
    db.readPhoneCountryFlag.mockResolvedValue(true);
    const d = await decideSms(DB, base({ kind: "voice.textback", to: "+19562921696", numberFromCarrier: true }));
    expect(d.kind).toBe("clear");
    expect(db.readPhoneCountryFlag).not.toHaveBeenCalled();
    if (d.kind !== "clear") throw new Error("expected clear");
    expect((await deliverSms(DB, d.send)).kind).toBe("sent");
    expect(db.readPhoneCountryFlag).not.toHaveBeenCalled();
    expect(await decideSms(DB, base({ kind: "voice.textback", to: "+19562921696" }))).toEqual({ kind: "blocked", reason: "unconfirmed_number" });
  });

  it("a stop or hold still blocks the carrier-number path at decide AND at deliver — the carrier bypass is the STORED FLAG only, never the ledger (mutation M8: numberFromCarrier skips readConsentState entirely → FAILS)", async () => {
    db.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "carrier_block", eventId: "e5" });
    expect(await decideSms(DB, base({ kind: "voice.textback", to: "+19562921696", numberFromCarrier: true })))
      .toEqual({ kind: "blocked", reason: "stopped" });
    expect(send).not.toHaveBeenCalled();

    db.readConsentState.mockResolvedValue({ state: "held", since: "2026-10-01T00:00:00Z", method: "free_text", eventId: "e6" });
    expect(await decideSms(DB, base({ kind: "voice.textback", to: "+19562921696", numberFromCarrier: true })))
      .toEqual({ kind: "blocked", reason: "held" });
    expect(send).not.toHaveBeenCalled();

    db.readConsentState.mockResolvedValue({ state: "allowed" });
    const cleared = await decideSms(DB, base({ kind: "voice.textback", to: "+19562921696", numberFromCarrier: true }));
    if (cleared.kind !== "clear") throw new Error("expected clear");
    db.readConsentState.mockResolvedValue({ state: "held", since: "2026-10-06T20:00:02Z", method: "staff", eventId: "e7" });
    expect(await deliverSms(DB, cleared.send)).toEqual({ kind: "blocked", reason: "held" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a bare ten-digit number valid as both +1 and +52 is blocked even with no flag stored (mutation: ignore normalisePhone's unconfirmed → clear, FAILS)", async () => {
    expect(await decideSms(DB, base({ to: "55 1234 5678", contactId: null }))).toEqual({ kind: "blocked", reason: "unconfirmed_number" });
  });

  it("the carrier flag skips only the STORED flag, never step 2's own reading of an ambiguous number (mutation M11: number.unconfirmed && !fromCarrier → FAILS)", async () => {
    expect(await decideSms(DB, base({ to: "55 1234 5678", numberFromCarrier: true })))
      .toEqual({ kind: "blocked", reason: "unconfirmed_number" });
  });
});

describe("decideSms: step 6, the kind's hours", () => {
  // Sun 2026-10-11 10:00 in Chicago: automated hours open, marketing hours not.
  const SUNDAY_10 = new Date("2026-10-11T15:00:00Z");

  it("marketing waits for Sunday noon while an automated kind goes (mutation: read hours off the wrong kind → FAILS)", async () => {
    expect(await decideSms(DB, base({ kind: "automation.review_request", now: SUNDAY_10 })))
      .toEqual({ kind: "deferred", until: new Date("2026-10-11T17:00:00Z"), zone: "America/Chicago" });
    expect((await decideSms(DB, base({ kind: "automation.sms_reminder", now: SUNDAY_10 }))).kind).toBe("clear");
  });

  it("staff, operator and code kinds go at 03:00 (mutation: give staff.composer_sms automated hours → FAILS)", async () => {
    const at3 = new Date("2026-10-06T08:00:00Z");
    for (const kind of ["staff.composer_sms", "operator.alert_sms", "operator.alert_phone_code"] as const) {
      expect((await decideSms(DB, base({ kind, now: at3, contactId: null }))).kind).toBe("clear");
    }
  });

  it("a zone READ error blocks as ledger_unavailable, never Chicago's hours: nothing is sent, and the log names the account without the phone number (mutation: fall back to the fallback zone → deferred or clear, FAILS; mutation M14: drop the zone-unreadable log line → FAILS)", async () => {
    db.readAccountTimezone.mockRejectedValue(new Error("fetch failed"));
    expect(await decideSms(DB, base({ accountZone: undefined }))).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(await sendSms(DB, base({ accountZone: undefined }))).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(send).not.toHaveBeenCalled();
    const line = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(line).toMatch(/zone unreadable/);
    expect(line).not.toMatch(/956/);
  });

  it("a zone that was read but cannot be resolved still takes the fallback, America/Chicago (mutation: block an unresolvable zone as ledger_unavailable → FAILS)", async () => {
    const t = new Date("2026-10-06T12:00:00Z"); // 07:00 Chicago
    expect(await decideSms(DB, base({ now: t, accountZone: "America/Nowhere" })))
      .toEqual({ kind: "deferred", until: new Date("2026-10-06T13:00:00Z"), zone: "America/Chicago" });
  });

  it("the zone passed wins, and with none passed the account's is read (mutation: ignore accountZone → the LA case clears, FAILS)", async () => {
    const t = new Date("2026-10-06T13:30:00Z"); // 08:30 Chicago, 06:30 Los Angeles
    expect(await decideSms(DB, base({ now: t, accountZone: "America/Los_Angeles" })))
      .toEqual({ kind: "deferred", until: new Date("2026-10-06T15:00:00Z"), zone: "America/Los_Angeles" });
    expect(db.readAccountTimezone).not.toHaveBeenCalled();
    db.readAccountTimezone.mockResolvedValue("America/Los_Angeles");
    expect((await decideSms(DB, base({ now: t, accountZone: undefined }))).kind).toBe("deferred");
    expect(db.readAccountTimezone).toHaveBeenCalledWith(DB, "acct_1");
  });

  it("choice 21: a deadline at or before the opening is blocked, one after it waits (mutation: drop the deadline rule → deferred, FAILS)", async () => {
    const at6 = new Date("2026-10-06T11:00:00Z"); // 06:00 Chicago
    expect(await decideSms(DB, base({ now: at6, deadline: new Date("2026-10-06T12:30:00Z") })))
      .toEqual({ kind: "blocked", reason: "window_after_deadline" });
    expect(await decideSms(DB, base({ now: at6, deadline: new Date("2026-10-06T13:30:00Z") })))
      .toEqual({ kind: "deferred", until: new Date("2026-10-06T13:00:00Z"), zone: "America/Chicago" });
  });

  it("choice 21: an Invalid Date deadline is treated as already passed too — blocked, never deferred (mutation M9: an Invalid Date deadline cleaned to null → deferred, FAILS)", async () => {
    const at6 = new Date("2026-10-06T11:00:00Z"); // 06:00 Chicago
    expect(await decideSms(DB, base({ now: at6, deadline: new Date("not a date") })))
      .toEqual({ kind: "blocked", reason: "window_after_deadline" });
  });
});

describe("decideSms: step 7, the footer", () => {
  it("automation kinds carry the STOP line in the body's language; staff kinds carry none (mutation: footer on every kind → FAILS)", async () => {
    const en = await decideSms(DB, base());
    expect(en.kind === "clear" && en.send.body).toBe(`See you at 3 ${m["sms.optOut.en"]}`);
    const es = await decideSms(DB, base({ language: "es" }));
    expect(es.kind === "clear" && es.send.body).toBe(`See you at 3 ${m["sms.optOut.es"]}`);
    const staff = await decideSms(DB, base({ kind: "staff.composer_sms" }));
    expect(staff.kind === "clear" && staff.send.body).toBe("See you at 3");
  });
});

describe("sendSms: steps 8-9", () => {
  it("the provider is taken BEFORE prepare, prepare runs with the final text, then the send (mutation: send before prepare → FAILS)", async () => {
    const order: string[] = [];
    factory.getSmsProvider.mockImplementation(() => { order.push("provider"); return provider(); });
    send.mockImplementation(async () => { order.push("send"); return { providerMessageId: "p_9" }; });
    const prepare = vi.fn(async () => { order.push("prepare"); });
    const r = await sendSms(DB, base(), { prepare });
    expect(order).toEqual(["provider", "prepare", "send"]);
    expect(prepare).toHaveBeenCalledWith({ body: `See you at 3 ${m["sms.optOut.en"]}`, to: "+19562921696", from: FROM });
    expect(r).toEqual({ kind: "sent", providerMessageId: "p_9", to: "+19562921696", from: FROM,
      body: `See you at 3 ${m["sms.optOut.en"]}`, billable: false, segments: 1 });
  });

  it("no provider → failed provider_unavailable and prepare never runs: no row for a misconfiguration (mutation: prepare first → FAILS)", async () => {
    factory.getSmsProvider.mockImplementation(() => { throw new Error("TELNYX_API_KEY is required in production"); });
    const prepare = vi.fn();
    expect(await sendSms(DB, base(), { prepare })).toMatchObject({ kind: "failed", stage: "provider_unavailable" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("a failing prepare stops the send (mutation: swallow prepare's throw → send runs, FAILS)", async () => {
    const r = await sendSms(DB, base(), { prepare: async () => { throw new Error("createMessage failed"); } });
    expect(r).toMatchObject({ kind: "failed", stage: "prepare", error: "createMessage failed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a Telnyx 40300 refusal appends carrier_block for the normalised number and contact (mutation: drop step 9 → FAILS)", async () => {
    send.mockRejectedValue(new SmsProviderError("telnyx send failed (403): …", 403, ["40300"]));
    const r = await sendSms(DB, base());
    expect(r).toMatchObject({ kind: "failed", stage: "provider", carrierBlocked: true });
    expect(db.recordCarrierBlock).toHaveBeenCalledWith(DB, {
      accountId: "acct_1", address: "+19562921696", contactId: "ct_1", kind: "automation.sms_reminder" });
  });

  it("another code, or a provider redirected to a developer's phone, appends nothing (mutation: drop the redirect guard → FAILS)", async () => {
    send.mockRejectedValue(new SmsProviderError("telnyx send failed (422): …", 422, ["40001"]));
    expect(await sendSms(DB, base())).toMatchObject({ carrierBlocked: false });
    factory.getSmsProvider.mockReturnValue(provider({ isFake: false, redirectTo: "+15550009999" }));
    send.mockRejectedValue(new SmsProviderError("telnyx send failed (403): …", 403, ["40300"]));
    expect(await sendSms(DB, base())).toMatchObject({ carrierBlocked: false });
    expect(db.recordCarrierBlock).not.toHaveBeenCalled();
  });

  it("a carrier block that cannot be recorded is logged (without the phone number) and the result is still the failure (mutation: let the write throw → rejects, FAILS; mutation M10: drop the not-recorded log line → FAILS)", async () => {
    send.mockRejectedValue(new SmsProviderError("x", 403, ["40300"]));
    db.recordCarrierBlock.mockRejectedValue(new Error("insert failed"));
    await expect(sendSms(DB, base())).resolves.toMatchObject({ kind: "failed", carrierBlocked: true });
    const line = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(line).toMatch(/not recorded/);
    expect(line).not.toMatch(/956/);
  });
});

describe("sendSms: usage", () => {
  it("a real, unredirected provider bills the segments of the text AS SENT, footer included (mutation: billable inverted → FAILS)", async () => {
    factory.getSmsProvider.mockReturnValue(provider({ isFake: false }));
    expect(await sendSms(DB, base())).toMatchObject({ kind: "sent", billable: true, segments: 1 });
  });

  it("a usage count that throws AFTER the send is still a sent text, never a failed one (mutation: work usage out inside the send's try → failed, FAILS)", async () => {
    const odd = { send, get isFake(): boolean { throw new Error("provider shape changed"); } };
    factory.getSmsProvider.mockReturnValue(odd);
    expect(await sendSms(DB, base())).toMatchObject({ kind: "sent", providerMessageId: "p_1", billable: false, segments: 0 });
  });
});

describe("deliverSms: the split callers", () => {
  it("re-reads the ledger, so a stop that lands between decide and deliver wins (mutation: no re-check → sent, FAILS)", async () => {
    const d = await decideSms(DB, base());
    if (d.kind !== "clear") throw new Error("expected clear");
    db.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-06T20:00:01Z", method: "keyword", eventId: "e3" });
    expect(await deliverSms(DB, d.send)).toEqual({ kind: "blocked", reason: "stopped" });
    expect(send).not.toHaveBeenCalled();
  });

  it("the re-check honours a hold too, not only a stop (mutation M4: if (blocked === \"stopped\") return → FAILS)", async () => {
    const d = await decideSms(DB, base());
    if (d.kind !== "clear") throw new Error("expected clear");
    db.readConsentState.mockResolvedValue({ state: "held", since: "2026-10-06T20:00:01Z", method: "staff", eventId: "e4" });
    expect(await deliverSms(DB, d.send)).toEqual({ kind: "blocked", reason: "held" });
    expect(send).not.toHaveBeenCalled();
  });

  it("the re-check re-reads the phone-country flag too, not only the ledger (mutation M5: the recheck forces numberFromCarrier true → FAILS)", async () => {
    const d = await decideSms(DB, base());
    if (d.kind !== "clear") throw new Error("expected clear");
    db.readPhoneCountryFlag.mockResolvedValue(true);
    expect(await deliverSms(DB, d.send)).toEqual({ kind: "blocked", reason: "unconfirmed_number" });
    expect(send).not.toHaveBeenCalled();
  });

  it("the re-check FAILS CLOSED too: a ledger read error at deliver blocks, never allowed (mutation M6: the recheck maps ledger_unavailable to null → FAILS)", async () => {
    const d = await decideSms(DB, base());
    if (d.kind !== "clear") throw new Error("expected clear");
    db.readConsentState.mockRejectedValue(new Error("readConsentState failed: timeout"));
    expect(await deliverSms(DB, d.send)).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a forged ClearedSms without the gate's own brand is refused before any read (mutation: drop the CLEARED brand check → FAILS)", async () => {
    const forged = {
      accountId: "acct_1", kind: "automation.sms_reminder", to: "+19562921696", from: FROM,
      body: "See you at 3", contactId: null, numberFromCarrier: false,
    } as unknown as ClearedSms;
    await expect(deliverSms(DB, forged)).rejects.toThrow(/not a decision the gate cleared/);
    expect(db.readConsentState).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the stop confirmation: the only send to a stopped address (spec §4.2, plan G5)", () => {
  const STOPPED_AT = new Date(DAY.getTime() - 2 * 60_000).toISOString();
  const stopped = (eventId = "rev_1", since = STOPPED_AT) => ({ state: "stopped" as const, since, method: "keyword" as const, eventId });
  const confirm = (over: Partial<SmsRequest> = {}) => base({ kind: "consent.stop_confirmation", body: "956 Woodworks: You won't…", answersEventId: "rev_1", numberFromCarrier: true, ...over });

  it("goes through when it answers the NEWEST revoked row, under five minutes old, and is sent as written, no footer (mutation: drop the exception → blocked stopped, FAILS)", async () => {
    db.readConsentState.mockResolvedValue(stopped());
    const r = await sendSms(DB, confirm());
    expect(r).toMatchObject({ kind: "sent", body: "956 Woodworks: You won't…" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is refused when the newest revoked row is ANOTHER one — a stop it does not answer (mutation: skip the id comparison → sent, FAILS)", async () => {
    db.readConsentState.mockResolvedValue(stopped("rev_2"));
    expect(await sendSms(DB, confirm())).toEqual({ kind: "blocked", reason: "stopped" });
    expect(send).not.toHaveBeenCalled();
  });

  it("is refused at five minutes and sent at four minutes 59 (mutation: drop the age check → the late one is sent, FAILS; mutation: <= → the boundary is sent, FAILS)", async () => {
    const at = (ms: number) => new Date(DAY.getTime() - ms).toISOString();
    db.readConsentState.mockResolvedValue(stopped("rev_1", at(STOP_CONFIRMATION_WINDOW_MS)));
    expect(await sendSms(DB, confirm())).toEqual({ kind: "blocked", reason: "stopped" });
    db.readConsentState.mockResolvedValue(stopped("rev_1", at(STOP_CONFIRMATION_WINDOW_MS - 1_000)));
    expect((await sendSms(DB, confirm())).kind).toBe("sent");
    expect(STOP_CONFIRMATION_WINDOW_MS).toBe(300_000);
  });

  it("is refused with no answersEventId at all (mutation: treat a missing id as a match → sent, FAILS)", async () => {
    db.readConsentState.mockResolvedValue(stopped());
    expect(await sendSms(DB, confirm({ answersEventId: undefined }))).toEqual({ kind: "blocked", reason: "stopped" });
  });

  it("an address that is no longer stopped is refused as stale, never told 'you won't get any more texts' (mutation: let an allowed address through → sent, FAILS)", async () => {
    db.readConsentState.mockResolvedValue({ state: "allowed" });
    expect(await sendSms(DB, confirm())).toEqual({ kind: "blocked", reason: "stop_confirmation_stale" });
    db.readConsentState.mockResolvedValue({ state: "held", since: STOPPED_AT, method: "free_text", eventId: "h1" });
    expect(await sendSms(DB, confirm())).toEqual({ kind: "blocked", reason: "held" });
  });

  it("no other kind gets the exception, whatever id it carries (mutation: apply it to every kind → the help reply is sent to a stopped address, FAILS)", async () => {
    db.readConsentState.mockResolvedValue(stopped());
    for (const kind of ["consent.help", "consent.start_confirmation", "staff.composer_sms"] as const) {
      expect(await sendSms(DB, confirm({ kind })), kind).toEqual({ kind: "blocked", reason: "stopped" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("the deliver re-check honours the same exception, with the id the decision carried (mutation: re-check with answersEventId null → blocked, FAILS)", async () => {
    // The re-check judges the five minutes at the REAL clock (a delay between
    // decide and deliver counts), so the clock is pinned to DAY here: without
    // it this case would turn red on its own after 2026-10-06.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DAY);
    try {
      db.readConsentState.mockResolvedValue(stopped());
      const d = await decideSms(DB, confirm());
      if (d.kind !== "clear") throw new Error(`expected clear, got ${d.kind}`);
      expect(d.send.answersEventId).toBe("rev_1");
      expect((await deliverSms(DB, d.send)).kind).toBe("sent");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the consent kinds go at 03:00 (choice 18) and carry no footer (mutation: give consent.help automated hours → deferred, FAILS)", async () => {
    const night = new Date("2026-10-07T08:00:00Z"); // 03:00 in Chicago
    const d = await decideSms(DB, base({ kind: "consent.help", body: "956 Woodworks: Reply STOP to stop texts from us.", now: night }));
    expect(d.kind === "clear" && d.send.body).toBe("956 Woodworks: Reply STOP to stop texts from us.");
  });

  it("answersStop, pure: an unparseable 'since' is never within the window (mutation: treat NaN as 0 → true, FAILS)", () => {
    expect(answersStop({ eventId: "e", since: "not a date" }, "e", DAY)).toBe(false);
    expect(answersStop({ eventId: "e", since: DAY.toISOString() }, "e", DAY)).toBe(true);
    expect(answersStop({ eventId: "e", since: DAY.toISOString() }, null, DAY)).toBe(false);
  });
});
