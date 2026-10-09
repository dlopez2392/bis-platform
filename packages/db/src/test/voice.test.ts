import { describe, it, expect } from "vitest";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation, createMessage } from "../messaging";
import { getOrCreateCalendar, createBooking, setBookingStatus, getCalendarForAccount } from "../booking";
import {
  assignPhoneNumber, getPhoneNumberByE164, setPhoneNumberStatus,
  getVoiceProfile, upsertVoiceProfile,
  startCallRow, finishCallRow, countCallsSince, countCallsByCallerSince,
  countCallerHistorySince, countAnsweredCallsSince,
  hasActiveCallSince,
  findUpcomingBookingForPhone, getBookingById, deleteCallRow,
  listPhoneNumbersForAccount, listAllPhoneNumbers, reassignPhoneNumber,
  listCalls, getCall, listCallStartsByOutcomeBetween,
  listContactCalls, searchCalls,
  markHandoffRequested, getCallByHandoffToken, setCallOutcome,
  callerInTouchSince,
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
        .toEqual({ spamCalls: 2, otherCalls: 0, answeredCalls: 0 });
      // Scoped to ONE caller: the human's booking must not appear in the
      // robot's history, or the block would never fire.
      expect(await countCallerHistorySince(db, accountId, human, since))
        .toEqual({ spamCalls: 0, otherCalls: 1, answeredCalls: 1 });
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
        .toEqual({ spamCalls: 1, otherCalls: 0, answeredCalls: 0 });
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
        .toEqual({ spamCalls: 0, otherCalls: 0, answeredCalls: 0 });

      // A fabricated other account must see nothing — the tenancy guard is a
      // security property, not an optimisation. Both counts are exercised:
      // the spam row above AND the abandoned row above must both stay
      // invisible to a fabricated account.
      expect(await countCallerHistorySince(
        db, "00000000-0000-0000-0000-000000000099", caller,
        new Date(Date.now() - 86_400_000).toISOString(),
      )).toEqual({ spamCalls: 0, otherCalls: 0, answeredCalls: 0 });
    });
  });

  // The window floor is a rolling instant, so the boundary edge is not an
  // incidental case: a caller's redeeming good call landing EXACTLY on
  // `sinceIso` (the instant the guard drew as "now minus the window") must
  // still count, or the caller could never earn their way back. `sinceIso`
  // here is read back from the row's OWN `started_at` rather than a
  // client-side `Date`, so the comparison is exact rather than approximate —
  // ".gte" (shipped) counts it; ".gte" mistyped to ".gt" would drop it to 0.
  it("countCallerHistorySince: a call started exactly at the window floor IS counted", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const caller = "+19565550306";
      const { id } = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      await finishCallRow(db, accountId, id, {
        outcome: "lead", endedAt: new Date(), durationSecs: 20, turnCount: 3,
        transcript: [], summary: "", language: "en",
      });
      const { data: row, error } = await db.from("calls")
        .select("started_at").eq("id", id).single();
      if (error || !row) throw new Error(`read back started_at failed: ${error?.message}`);
      const sinceIso = (row as { started_at: string }).started_at;

      expect(await countCallerHistorySince(db, accountId, caller, sinceIso))
        .toEqual({ spamCalls: 0, otherCalls: 1, answeredCalls: 1 });
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
      // …and NOT as answered: an unfinished row must never vouch for a caller
      // at the press-1 screen, which reads `answeredCalls` alone.
      expect(await countCallerHistorySince(db, accountId, caller, since))
        .toEqual({ spamCalls: 0, otherCalls: 1, answeredCalls: 0 });
    });
  });

  // The press-1 screen's question: has this caller EVER been answered here?
  // Not the same question as `otherCalls`: a talking robocall is stamped
  // `abandoned`, which `otherCalls` counts, so a robot's second call from one
  // number would read as a returning customer. `answeredCalls` counts only
  // ANSWERED_CALL_OUTCOMES.
  it("countCallerHistorySince: answeredCalls counts booked/lead/message/transferred and never abandoned or spam", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const customer = "+19565550307";
      const robot = "+19565550308";
      const finish = async (callerE164: string, outcome: CallOutcome, turnCount: number) => {
        const { id } = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164 });
        await finishCallRow(db, accountId, id, {
          outcome, endedAt: new Date(), durationSecs: 30, turnCount,
          transcript: [], summary: "", language: "en",
        });
      };
      for (const outcome of ["booked", "lead", "message", "transferred"] as const) {
        await finish(customer, outcome, 4);
      }
      // A talking robot: several turns, hung up, stamped abandoned — twice.
      await finish(robot, "abandoned", 5);
      await finish(robot, "abandoned", 5);
      await finish(robot, "spam", 1);

      expect(await countCallerHistorySince(db, accountId, customer, since))
        .toEqual({ spamCalls: 0, otherCalls: 4, answeredCalls: 4 });
      expect(await countCallerHistorySince(db, accountId, robot, since))
        .toEqual({ spamCalls: 1, otherCalls: 2, answeredCalls: 0 });
      // The third query carries the same tenancy guard and window floor as
      // the other two — the rows above are answered, so a dropped guard on
      // THIS query is what these two lines would catch.
      expect((await countCallerHistorySince(db, "00000000-0000-0000-0000-000000000099", customer, since)).answeredCalls)
        .toBe(0);
      expect((await countCallerHistorySince(db, accountId, customer, new Date(Date.now() + 86_400_000).toISOString())).answeredCalls)
        .toBe(0);
    });
  });

  // D-091: the setup wizard's "Test call" step read done after ANY call — a
  // robocall included. It asks this instead: answered calls only.
  it("countAnsweredCallsSince: counts booked/lead/message/transferred, never abandoned, spam or an unfinished row", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const finish = async (outcome: CallOutcome) => {
        const { id } = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550311" });
        await finishCallRow(db, accountId, id, {
          outcome, endedAt: new Date(), durationSecs: 30, turnCount: 3,
          transcript: [], summary: "", language: "en",
        });
      };
      // Only calls nobody was answered on: a talking robot, a silent ring,
      // and a call still in flight (the column default is `abandoned`).
      await finish("abandoned");
      await finish("spam");
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550312" });
      expect(await countCallsSince(db, accountId, since)).toBe(3);
      expect(await countAnsweredCallsSince(db, accountId, since)).toBe(0);

      for (const outcome of ["booked", "lead", "message", "transferred"] as const) await finish(outcome);
      expect(await countAnsweredCallsSince(db, accountId, since)).toBe(4);
      // Tenancy and the window floor.
      expect(await countAnsweredCallsSince(db, "00000000-0000-0000-0000-000000000099", since)).toBe(0);
      expect(await countAnsweredCallsSince(db, accountId, new Date(Date.now() + 86_400_000).toISOString())).toBe(0);
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
 * The metrics reads drop the agency's own test handsets (`excludeCallers`).
 * Live, because the point is how PostgREST reads the `or` filter: a bare
 * `NOT IN` would also drop every withheld-number call (SQL's NULL NOT IN is
 * NULL), and only a real database proves the `IS NULL` arm keeps them.
 */
describe("listCallStartsByOutcomeBetween excludeCallers", () => {
  it("drops calls from the listed numbers and keeps withheld and other callers", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const seed = async (startedAt: string, caller: string | null) => {
        const { error } = await db.from("calls").insert({
          account_id: accountId, phone_number_id: num.id,
          started_at: startedAt, outcome: "booked", caller_e164: caller,
        });
        if (error) throw new Error(`seed call failed: ${error.message}`);
      };
      await seed("2026-03-02T10:00:00Z", "+19565550101"); // the agency handset
      await seed("2026-03-03T10:00:00Z", "+19565550102"); // a second handset
      await seed("2026-03-04T10:00:00Z", null);           // withheld number
      await seed("2026-03-05T10:00:00Z", "+19565550199"); // a customer

      const from = "2026-03-02T00:00:00Z";
      const to = "2026-03-09T00:00:00Z";
      const times = (rows: string[]) => rows.map((s) => new Date(s).getTime()).sort((a, b) => a - b);

      const all = await listCallStartsByOutcomeBetween(db, accountId, ["booked"], from, to);
      expect(all).toHaveLength(4);

      const kept = await listCallStartsByOutcomeBetween(
        db, accountId, ["booked"], from, to, { excludeCallers: ["+19565550101", "+19565550102"] },
      );
      expect(times(kept)).toEqual([
        new Date("2026-03-04T10:00:00Z").getTime(),
        new Date("2026-03-05T10:00:00Z").getTime(),
      ]);
    });
  });
});

/**
 * 0037's call-handoff accessors. Four functions, one shared fixture shape: a
 * real `phone_numbers` row (calls.phone_number_id is NOT NULL) and a call row
 * started through `startCallRow` itself rather than a direct insert, so the
 * optional third field is exercised through the function the routes call.
 *
 * Tokens here are DRAWN, never a literal. `calls_handoff_token_unique` is
 * PROJECT-WIDE — a token carries no account, which is the whole point of it —
 * so a fixed string is green only while this is the only run touching the
 * project, the exact accident `testPhoneNumber()` exists to prevent for
 * `phone_numbers.e164`.
 */
const testHandoffToken = () => `test_handoff_${Math.random().toString(36).slice(2, 12)}`;

describe("call handoff accessors", () => {
  it("startCallRow stores a handoff token when given one, and leaves it null when not", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const token = testHandoffToken();

      const withToken = await startCallRow(db, accountId, {
        phoneNumberId: num.id, callerE164: "+19562921696", handoffToken: token,
      });
      // The field is OPTIONAL, and every caller in the tree today omits it.
      // Both shapes are asserted because the back-compatible one is the one a
      // regression would break silently.
      const without = await startCallRow(db, accountId, {
        phoneNumberId: num.id, callerE164: "+19562921696",
      });

      const { data, error } = await db.from("calls")
        .select("id, handoff_token, handoff_requested_at")
        .in("id", [withToken.id, without.id]);
      expect(error, `calls select failed: ${error?.message}`).toBeNull();
      const byId = Object.fromEntries((data ?? []).map((r: any) => [r.id, r]));
      expect(byId[withToken.id].handoff_token).toBe(token);
      expect(byId[without.id].handoff_token).toBeNull();
      // A token is minted at the START of a call; the caller has not asked for
      // a person yet, so the REQUESTED timestamp must still be empty. The two
      // facts are separate for exactly this reason.
      expect(byId[withToken.id].handoff_requested_at).toBeNull();
    });
  });

  it("markHandoffRequested stamps the moment the caller asked, and refuses a call in another account", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const call = await startCallRow(db, accountId, {
        phoneNumberId: num.id, callerE164: "+19562921696", handoffToken: testHandoffToken(),
      });

      await markHandoffRequested(db, accountId, call.id);
      const { data } = await db.from("calls")
        .select("handoff_requested_at").eq("id", call.id).single();
      expect(typeof data!.handoff_requested_at).toBe("string");

      // Account-scoped like every other per-account writer here, and LOUD on a
      // zero-row match: PostgREST reports no error and no rows for an update
      // that hit nothing, which would otherwise read as a successful stamp.
      const ghost = "00000000-0000-0000-0000-000000000000";
      await expect(markHandoffRequested(db, ghost, call.id)).rejects.toThrow(/matched no row/);
    });
  });

  it("getCallByHandoffToken finds the call from the token ALONE and hands back the account to scope by", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const token = testHandoffToken();
      const call = await startCallRow(db, accountId, {
        phoneNumberId: num.id, callerE164: "+19562921696", handoffToken: token,
      });
      await markHandoffRequested(db, accountId, call.id);

      // No account id is passed, and that is the assertion, not an oversight:
      // the route that calls this has none — the token IS its credential. The
      // account_id coming BACK is what every read after it is scoped by.
      const found = await getCallByHandoffToken(db, token);
      // `phone_number_id` is here for the handoff route's caller id: the
      // business's handset must show THE NUMBER THIS CALLER DIALLED, and on an
      // account owning two live numbers the number list cannot say which one
      // rang — only the call row can. Dropping it from the select would send
      // the route back to guessing.
      expect(found).toMatchObject({ id: call.id, account_id: accountId, phone_number_id: num.id });
      expect(typeof found!.handoff_requested_at).toBe("string");

      // `outcome` rides along for the result route's precedence check, and it
      // is here to stop that route reaching for `getCall` — which selects
      // CALL_DETAIL_COLS and drags a whole JSONB transcript plus the summary
      // across the wire to read ONE enum, on a call whose far end has already
      // hung up. Written non-default first so a select that dropped the
      // column could not pass on the row's own starting value.
      await setCallOutcome(db, accountId, call.id, "booked");
      const withOutcome = await getCallByHandoffToken(db, token);
      expect(withOutcome!.outcome).toBe("booked");

      // A token nobody minted resolves to nothing rather than to the newest
      // call, or to an error a route would have to distinguish from a real one.
      expect(await getCallByHandoffToken(db, testHandoffToken())).toBeNull();
    });
  });

  it("setCallOutcome upgrades a finished call to transferred, and is account-scoped", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const call = await startCallRow(db, accountId, {
        phoneNumberId: num.id, callerE164: "+19562921696",
      });
      // The row starts on the column default. A handed-off call reaches socket
      // close classified `abandoned` — from the socket's point of view the
      // caller did leave — and this is the upgrade that corrects it.
      const before = await db.from("calls").select("outcome").eq("id", call.id).single();
      expect(before.data!.outcome).toBe("abandoned");

      const outcome: CallOutcome = "transferred";
      await setCallOutcome(db, accountId, call.id, outcome);
      const after = await db.from("calls").select("outcome").eq("id", call.id).single();
      expect(after.data!.outcome).toBe("transferred");

      const ghost = "00000000-0000-0000-0000-000000000000";
      await expect(setCallOutcome(db, ghost, call.id, "booked")).rejects.toThrow(/matched no row/);
    });
  });
});

/**
 * Consent chain PR-1 (danlo, 2026-09-26): a text-back held overnight is
 * skipped at 08:00 when the caller has been back in touch since the missed
 * call. The instant is the database's own `started_at`, so no clock skew.
 */
describe("callerInTouchSince", () => {
  it("the missed call and an outbound text do not count; an inbound TEXT after it does (mutation: drop .eq(\"direction\", \"inbound\") → the text-back's own outbound counts, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const caller = "+19565550401";
      const contact = await createContact(db, accountId, { firstName: "Ana", phone: caller }, "user_test");
      const convo = await ensureConversation(db, accountId, contact.id, "user_test");
      const missed = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      const { data } = await db.from("calls").select("started_at").eq("id", missed.id).single();
      const since = (data as { started_at: string }).started_at;
      expect(await callerInTouchSince(db, accountId, caller, convo.id, since)).toBe(false);
      await createMessage(db, accountId, { conversationId: convo.id, channel: "sms", direction: "outbound", body: "Sorry we missed your call" }, "user_test");
      expect(await callerInTouchSince(db, accountId, caller, convo.id, since)).toBe(false);
      await createMessage(db, accountId, { conversationId: convo.id, channel: "sms", direction: "inbound", body: "still need a quote" }, "user_test");
      expect(await callerInTouchSince(db, accountId, caller, convo.id, since)).toBe(true);
    });
  });

  it("a later call from the SAME number counts; one from another number does not (mutation: drop .eq(\"caller_e164\", …) → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const caller = "+19565550402";
      const contact = await createContact(db, accountId, { firstName: "Luis", phone: caller }, "user_test");
      const convo = await ensureConversation(db, accountId, contact.id, "user_test");
      const missed = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      const { data } = await db.from("calls").select("started_at").eq("id", missed.id).single();
      const since = (data as { started_at: string }).started_at;
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550499" });
      expect(await callerInTouchSince(db, accountId, caller, convo.id, since)).toBe(false);
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      expect(await callerInTouchSince(db, accountId, caller, convo.id, since)).toBe(true);
    });
  });

  it("ignores a later call from the SAME number on ANOTHER account (M1; mutation: drop .eq(\"account_id\", …) → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const caller = "+19565550403";
      const contact = await createContact(db, accountId, { firstName: "Rosa", phone: caller }, "user_test");
      const convo = await ensureConversation(db, accountId, contact.id, "user_test");
      const missed = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      const { data } = await db.from("calls").select("started_at").eq("id", missed.id).single();
      const since = (data as { started_at: string }).started_at;
      await withTestAccount(async (otherDb, otherAccountId) => {
        const otherNum = await assignPhoneNumber(otherDb, otherAccountId, { e164: testPhoneNumber() }, "user_test");
        // Same caller number, a LATER call — but on a different account.
        await startCallRow(otherDb, otherAccountId, { phoneNumberId: otherNum.id, callerE164: caller });
        expect(await callerInTouchSince(db, accountId, caller, convo.id, since)).toBe(false);
      });
    });
  });

  it("ignores an inbound message that is not SMS (M7; mutation: drop .eq(\"channel\", \"sms\") → an inbound email counts, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const caller = "+19565550404";
      const contact = await createContact(db, accountId, { firstName: "Ivan", phone: caller }, "user_test");
      const convo = await ensureConversation(db, accountId, contact.id, "user_test");
      const missed = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      const { data } = await db.from("calls").select("started_at").eq("id", missed.id).single();
      const since = (data as { started_at: string }).started_at;
      await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "inbound", body: "a reply, by email" }, "user_test");
      expect(await callerInTouchSince(db, accountId, caller, convo.id, since)).toBe(false);
      await createMessage(db, accountId, { conversationId: convo.id, channel: "sms", direction: "inbound", body: "still need a quote" }, "user_test");
      expect(await callerInTouchSince(db, accountId, caller, convo.id, since)).toBe(true);
    });
  });
});
