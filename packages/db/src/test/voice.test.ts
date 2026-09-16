import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation } from "../messaging";
import { getOrCreateCalendar, createBooking, setBookingStatus, getCalendarForAccount } from "../booking";
import {
  assignPhoneNumber, getPhoneNumberByE164, setPhoneNumberStatus,
  getVoiceProfile, upsertVoiceProfile,
  startCallRow, finishCallRow, countCallsSince, countCallsByCallerSince,
  countCallerHistorySince,
  hasActiveCallSince,
  findUpcomingBookingForPhone, getBookingById, deleteCallRow,
  listPhoneNumbersForAccount, listAllPhoneNumbers, reassignPhoneNumber,
  listCalls, getCall, listCallStartsBetween, listCallOutcomesBetween,
  listContactCalls, searchCalls,
  type CallOutcome,
} from "../voice";

/**
 * Every `e164` in this file comes from `testPhoneNumber()`, never from a
 * literal. `phone_numbers.e164` is unique across EVERY account in the project
 * (0019), so fixed numbers here are green only while this is the only run
 * touching the project: two `voice.test.ts` runs at once failed 15 tests
 * between them on `phone_numbers_e164_key`.
 *
 * Contact phones and `caller_e164` stay as written literals on purpose —
 * those columns are per-account, two tenants may hold the same value all day,
 * and `searchCalls` below matches on the digits of one of them.
 */
describe("voice accessors", () => {
  it("phone number assign → lookup → status walk", async () => {
    await withTestAccount(async (db, accountId) => {
      const e164 = testPhoneNumber();
      const row = await assignPhoneNumber(db, accountId, { e164 }, "user_test");
      expect(row.status).toBe("provisioned");
      expect(await getPhoneNumberByE164(db, e164)).toMatchObject({ account_id: accountId });
      // A number drawn and never inserted — a literal "nothing is here" could
      // be something another run had just assigned.
      expect(await getPhoneNumberByE164(db, testPhoneNumber())).toBeNull();
      await setPhoneNumberStatus(db, accountId, row.id, "live", "user_test");
      expect((await getPhoneNumberByE164(db, e164))!.status).toBe("live");
      // wrong account must throw, not silently no-op
      await expect(setPhoneNumberStatus(db, "00000000-0000-0000-0000-000000000000", row.id, "released", "user_test"))
        .rejects.toThrow();
    });
  });

  it("voice profile upsert is insert-then-update on one row", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getVoiceProfile(db, accountId)).toBeNull();
      const created = await upsertVoiceProfile(db, accountId, { greeting_en: "Hi!", enabled: true }, "user_test");
      expect(created.greeting_en).toBe("Hi!");
      const updated = await upsertVoiceProfile(db, accountId, { persona_name: "Ana" }, "user_test");
      expect(updated.persona_name).toBe("Ana");
      expect(updated.greeting_en).toBe("Hi!");      // patch semantics, not replace
      expect(updated.id).toBe(created.id);          // same row
    });
  });

  it("call rows: start → finish; finish on a wrong id throws", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const { id } = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19562921696" });
      await finishCallRow(db, accountId, id, {
        outcome: "message", endedAt: new Date(), durationSecs: 45, turnCount: 6,
        transcript: [{ role: "caller", text: "hola", at: new Date().toISOString() }],
        summary: "RECORDED — Messages: 1.", language: "es",
      });
      await expect(finishCallRow(db, accountId, "00000000-0000-0000-0000-000000000000", {
        outcome: "spam", endedAt: new Date(), durationSecs: 0, turnCount: 0,
        transcript: [], summary: "", language: "en",
      })).rejects.toThrow();
    });
  });

  it("deleteCallRow: removes the row; deleting an already-gone id is not an error", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const { id } = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19562921696" });

      await deleteCallRow(db, accountId, id);
      const { count } = await db.from("calls").select("id", { count: "exact", head: true }).eq("id", id);
      expect(count).toBe(0);

      // The accept-failure cleanup path in the route calls this from inside
      // its own try/catch, but a delete that matches zero rows must not
      // throw in the first place — cleanup for a call row that never got
      // written (startCallRow itself failed, fail-open) or was already
      // cleaned up by a previous attempt is "nothing to do", not an error.
      // Unlike `setPhoneNumberStatus`/`finishCallRow` (which throw on a
      // zero-row match because a wrong id there is a real bug), deletion is
      // idempotent by design: deleting nothing IS the desired end state.
      await expect(deleteCallRow(db, accountId, id)).resolves.toBeUndefined();
      await expect(
        deleteCallRow(db, accountId, "00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeUndefined();
    });
  });

  it("deleteCallRow: cross-tenant delete resolves but does not touch another account's row", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const { id } = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19562921696" });

      // A different (fabricated, non-existent) account attempting to delete
      // this row — the `.eq("account_id", accountId)` guard is the security
      // property: a cross-tenant call must match zero rows and resolve
      // (deletion is idempotent by design, per the test above) rather than
      // deleting across tenants because it also matched on `id` alone.
      await expect(
        deleteCallRow(db, "00000000-0000-0000-0000-000000000099", id),
      ).resolves.toBeUndefined();

      const { count } = await db.from("calls").select("id", { count: "exact", head: true }).eq("id", id);
      expect(count).toBe(1);
    });
  });

  it("cap counters count in-flight (unfinished) calls too", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 60_000).toISOString();
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550001" });
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550001" });
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550002" });
      expect(await countCallsSince(db, accountId, since)).toBe(3);
      expect(await countCallsByCallerSince(db, accountId, "+19565550001", since)).toBe(2);
    });
  });

  it("hasActiveCallSince: true only for an unfinished call started after the floor", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const floor = new Date(Date.now() - 60 * 60_000).toISOString(); // one hour ago
      // Nothing yet.
      expect(await hasActiveCallSince(db, accountId, floor)).toBe(false);

      // In-flight call, started_at defaults to now() (> floor), ended_at null.
      const { id } = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550001" });
      expect(await hasActiveCallSince(db, accountId, floor)).toBe(true);

      // Finished — ended_at now set, so no longer "active" even though it
      // started after the floor.
      await finishCallRow(db, accountId, id, {
        outcome: "message", endedAt: new Date(), durationSecs: 30, turnCount: 2,
        transcript: [], summary: "done", language: "en",
      });
      expect(await hasActiveCallSince(db, accountId, floor)).toBe(false);

      // A second in-flight call, but backdated to BEFORE the floor — an
      // unfinished row that has been open far longer than "on a call" means
      // (a crashed dyno, an accept failure that skipped cleanup — see
      // deleteCallRow's own doc comment) must not read as active forever.
      const stale = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550002" });
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      const { error } = await db.from("calls").update({ started_at: twoHoursAgo }).eq("id", stale.id);
      expect(error).toBeNull();
      expect(await hasActiveCallSince(db, accountId, floor)).toBe(false);

      // Cross-tenant scoping: a fabricated account id never sees this
      // account's in-flight call, matching every other accessor's own
      // account_id guard.
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550003" });
      expect(await hasActiveCallSince(db, "00000000-0000-0000-0000-000000000099", floor)).toBe(false);
    });
  });

  it("setPhoneNumberStatus and upsertVoiceProfile thread actorType through to events", async () => {
    await withTestAccount(async (db, accountId) => {
      const row = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "voice", "ai");
      await setPhoneNumberStatus(db, accountId, row.id, "testing", "voice", "ai");
      await upsertVoiceProfile(db, accountId, { greeting_en: "Hi" }, "voice", "ai");
      const { data: ev } = await db.from("events").select("type, actor_type")
        .eq("account_id", accountId);
      // Should have three events: phone_number.assigned, phone_number.status_changed, voice_profile.updated
      expect(ev).toBeDefined();
      const events = ev ?? [];
      const assigned = events.filter((e: any) => e.type === "phone_number.assigned");
      const statusChanged = events.filter((e: any) => e.type === "phone_number.status_changed");
      const profileUpdated = events.filter((e: any) => e.type === "voice_profile.updated");
      expect(assigned).toHaveLength(1);
      expect(assigned[0]!.actor_type).toBe("ai");
      expect(statusChanged).toHaveLength(1);
      expect(statusChanged[0]!.actor_type).toBe("ai");
      expect(profileUpdated).toHaveLength(1);
      expect(profileUpdated[0]!.actor_type).toBe("ai");
    });
  });

  it("findUpcomingBookingForPhone: matches contact phone, skips past and cancelled", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Maria", phone: "+19565550130" }, "user_test");
      const now = new Date("2027-05-01T12:00:00Z");
      await createBooking(db, accountId, { calendarId: cal.id, contactId,
        startsAt: new Date("2027-04-30T15:00:00Z"), endsAt: new Date("2027-04-30T16:00:00Z") }, "user_test"); // past
      const future = await createBooking(db, accountId, { calendarId: cal.id, contactId,
        startsAt: new Date("2027-05-03T15:00:00Z"), endsAt: new Date("2027-05-03T16:00:00Z") }, "user_test");
      // Add a cancelled booking earlier than future, but still in the future
      const cancelled = await createBooking(db, accountId, { calendarId: cal.id, contactId,
        startsAt: new Date("2027-05-02T15:00:00Z"), endsAt: new Date("2027-05-02T16:00:00Z") }, "user_test");
      await setBookingStatus(db, accountId, cancelled.id, "cancelled", "user_test");
      const hit = await findUpcomingBookingForPhone(db, accountId, "+19565550130", now.toISOString());
      expect(hit).toMatchObject({ bookingId: future.id });
      expect(await findUpcomingBookingForPhone(db, accountId, "+19999999998", now.toISOString())).toBeNull();
      const row = await getBookingById(db, accountId, future.id);
      expect(row).toMatchObject({ contact_id: contactId, status: "booked" });
    });
  });

  it("countCallerHistorySince: splits one caller's window into spam and everything else", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const robot = "+19565550301";
      const human = "+19565550302";

      const finish = async (id: string, outcome: CallOutcome, turnCount: number) =>
        finishCallRow(db, accountId, id, {
          outcome, endedAt: new Date(), durationSecs: 20, turnCount,
          transcript: [], summary: "", language: "en",
        });

      const a = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: robot });
      const b = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: robot });
      const c = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: human });
      await finish(a.id, "spam", 1);
      await finish(b.id, "spam", 1);
      await finish(c.id, "booked", 12);

      expect(await countCallerHistorySince(db, accountId, robot, since))
        .toEqual({ spamCalls: 2, otherCalls: 0 });
      // Scoped to ONE caller: the human's booking must not appear in the
      // robot's history, or the block would never fire.
      expect(await countCallerHistorySince(db, accountId, human, since))
        .toEqual({ spamCalls: 0, otherCalls: 1 });
    });
  });

  it("countCallerHistorySince: a zero-turn spam row is EXCLUDED — that is our connect timeout, not a robot", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const caller = "+19565550303";

      // `incoming/route.ts:185-193`: a connect-timeout records outcome "spam"
      // with turn_count 0, because the socket never opened and nothing was
      // ever mirrored into the state. That is OUR infrastructure failing.
      // Counting it toward a block would refuse an innocent caller for our
      // own outage — the worst false positive this feature can produce.
      const t = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      await finishCallRow(db, accountId, t.id, {
        outcome: "spam", endedAt: new Date(), durationSecs: 0, turnCount: 0,
        transcript: [], summary: "", language: "en",
      });
      // A genuine silent call still carries the greeting, so it has >= 1 turn.
      const g = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      await finishCallRow(db, accountId, g.id, {
        outcome: "spam", endedAt: new Date(), durationSecs: 30, turnCount: 1,
        transcript: [], summary: "", language: "en",
      });

      expect(await countCallerHistorySince(db, accountId, caller, since))
        .toEqual({ spamCalls: 1, otherCalls: 0 });
    });
  });

  it("countCallerHistorySince: honours the window floor and the account boundary", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const caller = "+19565550304";
      const r = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      await finishCallRow(db, accountId, r.id, {
        outcome: "spam", endedAt: new Date(), durationSecs: 30, turnCount: 1,
        transcript: [], summary: "", language: "en",
      });
      // A second row, close but NOT a spam member (`abandoned`, the value an
      // unfinished row carries) so the fabricated-account check below
      // exercises BOTH queries' `.eq("account_id", ...)` guard — a fixture
      // that was only ever `spam` could never catch the `otherCalls` query
      // losing its own tenancy guard.
      const o = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      await finishCallRow(db, accountId, o.id, {
        outcome: "abandoned", endedAt: new Date(), durationSecs: 15, turnCount: 1,
        transcript: [], summary: "", language: "en",
      });

      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect(await countCallerHistorySince(db, accountId, caller, future))
        .toEqual({ spamCalls: 0, otherCalls: 0 });

      // A fabricated other account must see nothing — the tenancy guard is a
      // security property, not an optimisation. Both counts are exercised:
      // the spam row above AND the abandoned row above must both stay
      // invisible to a fabricated account.
      expect(await countCallerHistorySince(
        db, "00000000-0000-0000-0000-000000000099", caller,
        new Date(Date.now() - 86_400_000).toISOString(),
      )).toEqual({ spamCalls: 0, otherCalls: 0 });
    });
  });

  it("countCallerHistorySince: an UNFINISHED row counts as other, never as spam", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const caller = "+19565550305";
      // startCallRow leaves outcome at its column default, 'abandoned'. A call
      // still in flight, or one whose process died before finishCallRow, reads
      // as "other" and therefore CLEARS the caller. That is the safe direction
      // — toward letting a call through — and it is intended, not incidental.
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      expect(await countCallerHistorySince(db, accountId, caller, since))
        .toEqual({ spamCalls: 0, otherCalls: 1 });
    });
  });
});

describe("listPhoneNumbersForAccount / listAllPhoneNumbers / reassignPhoneNumber", () => {
  it("lists only the account's numbers, oldest first", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const a = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber() }, "user_test");
        await assignPhoneNumber(db, accountB, { e164: testPhoneNumber() }, "user_test");
        const rows = await listPhoneNumbersForAccount(db, accountA);
        expect(rows.map((r) => r.id)).toEqual([a.id]);
      });
    });
  });

  it("listAllPhoneNumbers returns every account's numbers with the account name embedded", async () => {
    await withTestAccount(async (db, accountA) => {
      const e164 = testPhoneNumber();
      await assignPhoneNumber(db, accountA, { e164 }, "user_test");
      const all = await listAllPhoneNumbers(db);
      // This read crosses every account, so the row it finds has to be THIS
      // run's: with a fixed literal, a concurrent run's row answers to it.
      const mine = all.find((r) => r.e164 === e164);
      expect(mine?.account?.name).toBeTruthy();
    });
  });

  it("reassignPhoneNumber moves the row to the target account and resets status to provisioned", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const n = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber(), status: "live" }, "user_test");
        const moved = await reassignPhoneNumber(db, n.id, accountB, "user_test");
        expect(moved.account_id).toBe(accountB);
        expect(moved.status).toBe("provisioned");
        expect((await listPhoneNumbersForAccount(db, accountA)).find((r) => r.id === n.id)).toBeUndefined();
      });
    });
  });

  it("reassignPhoneNumber throws on an unknown id", async () => {
    await withTestAccount(async (db, accountB) => {
      await expect(reassignPhoneNumber(db, "00000000-0000-0000-0000-000000000000", accountB, "user_test"))
        .rejects.toThrow(/matched no row|not found/);
    });
  });

  it("getCalendarForAccount returns null when no calendar exists, the row after getOrCreateCalendar", async () => {
    await withTestAccount(async (db, accountFresh) => {
      expect(await getCalendarForAccount(db, accountFresh)).toBeNull();
      await getOrCreateCalendar(db, accountFresh, "user_test");
      expect((await getCalendarForAccount(db, accountFresh))?.account_id).toBe(accountFresh);
    });
  });
});

describe("listCalls / getCall", () => {
  it("lists newest-first, embeds the contact name, respects limit and before-cursor", async () => {
    await withTestAccount(async (db, accountA) => {
      const n = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber() }, "user_test");
      const c = await createContact(db, accountA, { firstName: "Maria", lastName: "Garcia", phone: "+15550000011" }, "user_test");
      const convo = await ensureConversation(db, accountA, c.id, "user_test");
      const r1 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: "+15550000011" });
      await finishCallRow(db, accountA, r1.id, {
        outcome: "booked", endedAt: new Date(), durationSecs: 62, turnCount: 9,
        transcript: [{ role: "caller", text: "hola", at: new Date().toISOString() }],
        // Was "s"; widened to a distinctive phrase so the P6 searchCalls
        // assertions below can cover the summary branch of its .or() filter.
        // Nothing in this test asserts on the summary itself.
        summary: "Roof inspection booked for Tuesday", language: "es", contactId: c.id,
        conversationId: convo.id,
      });
      const r2 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });

      const rows = await listCalls(db, accountA);
      expect(rows[0]!.id).toBe(r2.id);                       // newest first
      const booked = rows.find((r) => r.id === r1.id)!;
      expect(booked.contact?.first_name).toBe("Maria");
      expect(booked.language).toBe("es");
      // `conversation_id` is on the LIST projection, not just the detail one:
      // it is what the calls list joins a failed text-back on, in one read for
      // the whole page. A column dropped from CALL_LIST_COLS would arrive
      // `undefined` here rather than as the id, and the badge would silently
      // never render for anyone.
      expect(booked.conversation_id).toBe(convo.id);
      // …and it is genuinely nullable, not merely absent: an unfinished call
      // has no conversation, and that must read as null rather than undefined.
      expect(rows.find((r) => r.id === r2.id)!.conversation_id).toBeNull();
      // `ended_at` joined it on the LIST projection for the same reason and is
      // load-bearing in the same way: the conversation says which THREAD the
      // text lives in, `started_at`/`ended_at` say which CALL wrote it. Dropped
      // from CALL_LIST_COLS it would arrive undefined, `textbackWindow` would
      // build no window, and no call would ever badge again.
      expect(typeof booked.ended_at).toBe("string");
      // Set by the same single finishCallRow UPDATE that stamps the
      // conversation, so the two are null together on an unfinished row — which
      // is why "no ended_at" is a shape the badge refuses to answer for.
      expect(rows.find((r) => r.id === r2.id)!.ended_at).toBeNull();

      const paged = await listCalls(db, accountA, { before: rows[0]!.started_at, limit: 1 });
      expect(paged.map((r) => r.id)).toEqual([r1.id]);

      // P6 searchCalls, folded into THIS cycle rather than a new
      // withTestAccount — blueprints.test.ts is contention-marginal and extra
      // fixture cycles tip it into a 20s timeout. Both branches of the
      // interpolated .or() are covered, since that construct is the risky one.
      const bySummary = await searchCalls(db, accountA, { search: "roof inspection" });
      expect(bySummary.map((r) => r.id)).toEqual([r1.id]);
      const byNumber = await searchCalls(db, accountA, { search: "5550000011" });
      expect(byNumber.map((r) => r.id)).toEqual([r1.id]);

      expect(await searchCalls(db, accountA, { search: "zzz nothing matches" })).toEqual([]);
      // An all-punctuation query must return NOTHING, not the whole call log.
      expect(await searchCalls(db, accountA, { search: "%%%" })).toEqual([]);
      // And the grammar-breaking character must not blow up the .or() string.
      expect(await searchCalls(db, accountA, { search: `roof"` })).toHaveLength(1);
    });
  });

  it("getCall returns the full row for the account and null cross-account or unknown", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const n = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber() }, "user_test");
        const r = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });
        const detail = await getCall(db, accountA, r.id);
        expect(detail?.transcript).toEqual([]);
        expect(await getCall(db, accountB, r.id)).toBeNull();  // tenant boundary
        expect(await getCall(db, accountA, "00000000-0000-0000-0000-000000000000")).toBeNull();
      });
    });
  });
});

describe("listCallStartsBetween", () => {
  it("[from, to) — pins both boundary edges, ascending order, cross-tenant rows excluded", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (db2, accountB) => {
        const numA = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber() }, "user_test");
        const numB = await assignPhoneNumber(db2, accountB, { e164: testPhoneNumber() }, "user_test");

        const from = "2027-06-01T00:00:00.000Z";
        const to = "2027-06-15T00:00:00.000Z";

        async function callAt(dbc: SupabaseClient, acct: string, numId: string, iso: string) {
          const { id } = await startCallRow(dbc, acct, { phoneNumberId: numId, callerE164: null });
          const { error } = await dbc.from("calls").update({ started_at: iso }).eq("id", id);
          if (error) throw new Error(error.message);
        }

        // Outside the window on both sides — excluded.
        await callAt(db, accountA, numA.id, "2027-05-31T23:59:59.999Z");
        await callAt(db, accountA, numA.id, to); // exclusive edge — excluded

        // Inside, including the inclusive `from` edge.
        await callAt(db, accountA, numA.id, from);
        await callAt(db, accountA, numA.id, "2027-06-10T12:00:00.000Z");
        await callAt(db, accountA, numA.id, "2027-06-14T23:59:59.999Z");

        // Same window, other tenant — must not leak into accountA's result.
        await callAt(db2, accountB, numB.id, "2027-06-05T00:00:00.000Z");

        const result = await listCallStartsBetween(db, accountA, from, to);
        expect(result).toHaveLength(3);
        const times = result.map((s) => new Date(s).getTime());
        expect(times).toEqual([...times].sort((a, b) => a - b)); // ascending
        expect(times).toEqual([
          new Date(from).getTime(),
          new Date("2027-06-10T12:00:00.000Z").getTime(),
          new Date("2027-06-14T23:59:59.999Z").getTime(),
        ]);
      });
    });
  });
});

// The contact drawer's recent-calls source — belongs here (not
// contacts.test.ts) because it reads the `calls` table, per this file's
// existing convention (listCalls/getCall above).
describe("listContactCalls", () => {
  it("newest-first, scoped to one contact, respects limit", async () => {
    await withTestAccount(async (db, accountA) => {
      const n = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber() }, "user_test");
      const mine = await createContact(db, accountA, { firstName: "Ana", phone: "+15550000041" }, "user_test");
      const other = await createContact(db, accountA, { firstName: "Zed", phone: "+15550000042" }, "user_test");

      const r1 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: "+15550000041" });
      await finishCallRow(db, accountA, r1.id, {
        outcome: "booked", endedAt: new Date(), durationSecs: 30, turnCount: 3,
        transcript: [], summary: "s1", language: "en", contactId: mine.id,
      });
      const r2 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: "+15550000041" });
      await finishCallRow(db, accountA, r2.id, {
        outcome: "message", endedAt: new Date(), durationSecs: 15, turnCount: 2,
        transcript: [], summary: "s2", language: "en", contactId: mine.id,
      });
      // A call belonging to a different contact — must not leak in.
      const r3 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: "+15550000042" });
      await finishCallRow(db, accountA, r3.id, {
        outcome: "spam", endedAt: new Date(), durationSecs: 5, turnCount: 1,
        transcript: [], summary: "s3", language: "en", contactId: other.id,
      });

      const rows = await listContactCalls(db, accountA, mine.id);
      expect(rows.map((r) => r.id)).toEqual([r2.id, r1.id]); // newest first
      expect(rows.every((r) => typeof r.outcome === "string" && typeof r.started_at === "string")).toBe(true);

      const limited = await listContactCalls(db, accountA, mine.id, 1);
      expect(limited.map((r) => r.id)).toEqual([r2.id]);
    });
  });
});

/**
 * The twin of listCallStartsBetween, which returns started_at values only and
 * so cannot answer "how many calls were answered". Seeded by direct insert
 * rather than startCallRow: that helper sets neither started_at nor outcome,
 * and both are the point here. calls.phone_number_id is NOT NULL, so a real
 * phone number has to exist first.
 */
describe("listCallOutcomesBetween", () => {
  it("returns every outcome inside the window and excludes the upper bound", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const seed = async (startedAt: string, outcome: string) => {
        const { error } = await db.from("calls").insert({
          account_id: accountId, phone_number_id: num.id,
          started_at: startedAt, outcome, caller_e164: null,
        });
        if (error) throw new Error(`seed call failed: ${error.message}`);
      };
      await seed("2026-03-02T10:00:00Z", "booked");
      await seed("2026-03-03T10:00:00Z", "spam");
      await seed("2026-03-04T10:00:00Z", "lead");
      // On the exclusive upper bound to the minute — the row that proves the
      // window is half-open, and that this agrees with listCallStartsBetween
      // about which calls belong to a week.
      await seed("2026-03-09T00:00:00Z", "message");

      const got = await listCallOutcomesBetween(
        db, accountId, "2026-03-02T00:00:00Z", "2026-03-09T00:00:00Z");
      expect(got.slice().sort()).toEqual(["booked", "lead", "spam"]);
    });
  });
});
