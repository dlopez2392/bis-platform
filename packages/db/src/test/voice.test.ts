import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact, updateContact } from "../contacts";
import { ensureConversation, createMessage } from "../messaging";
import { getOrCreateCalendar, createBooking, setBookingStatus, getCalendarForAccount } from "../booking";
import { addTask, listContactTasks } from "../activities";
import { listAccountWork } from "../work-queue";
import {
  assignPhoneNumber, getPhoneNumberByE164, setPhoneNumberStatus,
  getVoiceProfile, upsertVoiceProfile,
  startCallRow, finishCallRow, countCallsSince, countCallsByCallerSince,
  countCallerHistorySince, countAnsweredCallsSince,
  hasActiveCallSince,
  getBookingById, deleteCallRow,
  listPhoneNumbersForAccount, listAllPhoneNumbers, reassignPhoneNumber,
  listCalls, getCall, listCallStartsByOutcomeBetween,
  listContactCalls, searchCalls,
  markHandoffRequested, getCallByHandoffToken, setCallOutcome,
  callerInTouchSince,
  goLive, getPhoneNumberById,
  setCallCard, getCallCard, listCallReasons, ensureCallbackTask,
  listContactsOnNumber, findUpcomingBookingForContact, ensureHoldingContact, moveHoldingThread, phoneKeysOf,
  CONTACTS_ON_NUMBER_LIMIT,
  type CallOutcome,
} from "../voice";
import { emailKey as barrelEmailKey } from "../index";
import { ensureKnowledgeSnapshot } from "../voice-knowledge";
import { userDb } from "../user-client";
import { serviceDb } from "../service";

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

  // S-47e (plan P17): findUpcomingBookingForPhone left with its last caller (the voice registry reads
  // findUpcomingBookingForContact now, tested beside listContactsOnNumber). Its test held this file's only
  // read of getBookingById, kept here on its own.
  it("getBookingById: reads a booking with its contact and status", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Maria", phone: "+19565550130" }, "user_test");
      const future = await createBooking(db, accountId, { calendarId: cal.id, contactId,
        startsAt: new Date("2027-05-03T15:00:00Z"), endsAt: new Date("2027-05-03T16:00:00Z") }, "user_test");
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

  it("excludeSpam skips a call the receptionist marked spam; without it the call is still listed (S-03 part 1; mutation: ignore opts.excludeSpam -> the spam call comes back first, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const ana = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const seed = async (startedAt: string, outcome: string) => {
        const { data, error } = await db.from("calls").insert({
          account_id: accountId, phone_number_id: num.id, contact_id: ana.id, started_at: startedAt, outcome,
        }).select("id").single();
        if (error || !data) throw new Error(`seed call failed: ${error?.message}`);
        return (data as { id: string }).id;
      };
      const real = await seed("2026-10-01T15:00:00Z", "booked");
      const spam = await seed("2026-10-02T15:00:00Z", "spam");
      expect((await listContactCalls(db, accountId, ana.id, 1)).map((r) => r.id)).toEqual([spam]);
      expect((await listContactCalls(db, accountId, ana.id, 1, { excludeSpam: true })).map((r) => r.id)).toEqual([real]);
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

  it("startCallRow stamps disclosed and disclosure_setting together when given, and leaves both null when not (S-47a, D5; mutations: drop disclosure_setting from the insert → FAILS; write disclosed: false when not given → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const said = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, disclosure: { disclosed: true, setting: "trial" } });
      const didnt = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, disclosure: { disclosed: false, setting: "trial" } });
      const on = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, disclosure: { disclosed: true, setting: "on" } });
      const off = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null });
      const { data, error } = await db.from("calls").select("id, disclosed, disclosure_setting").in("id", [said.id, didnt.id, on.id, off.id]);
      expect(error, `calls select failed: ${error?.message}`).toBeNull();
      type R = { id: string; disclosed: boolean | null; disclosure_setting: string | null };
      const byId = Object.fromEntries((data ?? []).map((r: R) => [r.id, [r.disclosed, r.disclosure_setting]]));
      expect(byId).toEqual({
        [said.id]: [true, "trial"], [didnt.id]: [false, "trial"], [on.id]: [true, "on"], [off.id]: [null, null],
      });
    });
  });

  it("startCallRow stamps trade_module and trade_module_version together when given, leaves both null when not, and getCall reads them back (S-47b; mutations: drop trade_module_version from the insert -> the pair CHECK refuses, FAILS; drop the pair from CALL_DETAIL_COLS -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const ins = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, tradeModule: { module: "insurance_pc", version: 1 } });
      const ev = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, tradeModule: { module: "events", version: 3 } });
      const none = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null });
      const read = async (id: string) => {
        const c = await getCall(db, accountId, id);
        return [c?.trade_module, c?.trade_module_version];
      };
      expect(await read(ins.id)).toEqual(["insurance_pc", 1]);
      expect(await read(ev.id)).toEqual(["events", 3]);
      expect(await read(none.id)).toEqual([null, null]);
    });
  });

  it("startCallRow stamps knowledge_version when given and getCall reads it; omitted leaves it null; a version the account does not hold is refused by the key (S-47c; mutations: drop knowledge_version from CALL_DETAIL_COLS -> FAILS; name it as null always -> the omitted insert still works but the stamped read FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await upsertVoiceProfile(db, accountId, {}, "user_test");
      const v = await ensureKnowledgeSnapshot(db, accountId, { facts: "x" });
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const stamped = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, knowledgeVersion: v });
      const plain = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null });
      expect((await getCall(db, accountId, stamped.id))?.knowledge_version).toBe(v);
      expect((await getCall(db, accountId, plain.id))?.knowledge_version).toBeNull();
      await expect(startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, knowledgeVersion: v + 1 }))
        .rejects.toThrow(/startCallRow failed/);
    });
  });

  it("markHandoffRequested stamps the moment the caller asked, and refuses a call in another account", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const call = await startCallRow(db, accountId, {
        phoneNumberId: num.id, callerE164: "+19562921696", handoffToken: testHandoffToken(),
      });

      // "es", not the column's default "en": a write that dropped the language
      // could not pass on the row's own starting value.
      await markHandoffRequested(db, accountId, call.id, "es");
      const { data } = await db.from("calls")
        .select("handoff_requested_at, language").eq("id", call.id).single();
      expect(typeof data!.handoff_requested_at).toBe("string");
      // F-010: the caller's language rides in the same write, for the
      // failed-transfer line spoken after the socket (and its transcript) is gone.
      expect(data!.language).toBe("es");

      // Account-scoped like every other per-account writer here, and LOUD on a
      // zero-row match: PostgREST reports no error and no rows for an update
      // that hit nothing, which would otherwise read as a successful stamp.
      const ghost = "00000000-0000-0000-0000-000000000000";
      await expect(markHandoffRequested(db, ghost, call.id, "en")).rejects.toThrow(/matched no row/);
    });
  });

  it("getCallByHandoffToken finds the call from the token ALONE and hands back the account to scope by", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const token = testHandoffToken();
      const call = await startCallRow(db, accountId, {
        phoneNumberId: num.id, callerE164: "+19562921696", handoffToken: token,
      });
      await markHandoffRequested(db, accountId, call.id, "es");

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
      // F-010: the language stamped with the ask comes back with it, so the
      // result route answers in it without a second read.
      expect(found!.language).toBe("es");

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

/**
 * goLive (0063, D-043): the one call goLiveAction makes. The function's own
 * refusals and grants are pinned in go-live-grants.test.ts against Postgres
 * directly; these two go through serviceDb() and PostgREST, the way the app
 * calls it, and compare what it leaves behind with the two-call path it
 * replaced.
 */
describe("goLive", () => {
  const GOLIVE_ACTOR = "user_golive";
  const goLiveEvents = async (db: Parameters<typeof goLive>[0], accountId: string) => {
    const { data, error } = await db.from("events").select("type, actor_type, actor_id, payload")
      .eq("account_id", accountId).eq("actor_id", GOLIVE_ACTOR).order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  it("leaves exactly the rows the old two-call path did: profile on, number live, the same two events in the same order (mutation: emit { fields: ['enabled', 'updated_at'] } -> FAILS)", async () => {
    await withTestAccount(async (db, oldPath) => {
      await withTestAccount(async (_db2, newPath) => {
        const setUp = async (accountId: string) => {
          const n = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber(), status: "testing" }, "user_test");
          await upsertVoiceProfile(db, accountId, { greeting_en: "Thanks for calling." }, "user_test");
          return n.id;
        };
        const oldNum = await setUp(oldPath);
        const newNum = await setUp(newPath);

        // What goLiveAction did before 0063: two writes, two transactions.
        await upsertVoiceProfile(db, oldPath, { enabled: true }, GOLIVE_ACTOR);
        await setPhoneNumberStatus(db, oldPath, oldNum, "live", GOLIVE_ACTOR);
        await goLive(db, newPath, newNum, GOLIVE_ACTOR);

        const anonymise = (rows: unknown[], numberId: string) =>
          JSON.parse(JSON.stringify(rows).replaceAll(numberId, "<number>"));
        const before = anonymise(await goLiveEvents(db, oldPath), oldNum);
        const after = anonymise(await goLiveEvents(db, newPath), newNum);
        // Spelled out as well as compared, so two EMPTY lists cannot pass.
        expect(after).toEqual([
          { type: "voice_profile.updated", actor_type: "user", actor_id: GOLIVE_ACTOR, payload: { fields: ["enabled"] } },
          { type: "phone_number.status_changed", actor_type: "user", actor_id: GOLIVE_ACTOR,
            payload: { phoneNumberId: "<number>", status: "live" } },
        ]);
        expect(after).toEqual(before);
        expect((await getVoiceProfile(db, newPath))?.enabled).toBe(true);
        expect((await getPhoneNumberById(db, newNum))?.status).toBe("live");
      });
    });
  });

  it("is one transaction: a refused go-live throws and leaves the profile off, the number where it was and no event (D-043; mutation: goLive as the old upsertVoiceProfile + setPhoneNumberStatus pair -> profile left on, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db2, otherAccountId) => {
        // This account has a profile and no number; the number named belongs
        // to another tenant. The profile write succeeds inside go_live before
        // the number write is refused, so only a single transaction leaves
        // the profile off.
        await upsertVoiceProfile(db, accountId, { greeting_en: "Thanks for calling." }, "user_test");
        const other = await assignPhoneNumber(db, otherAccountId, { e164: testPhoneNumber(), status: "testing" }, "user_test");
        const err = await goLive(db, accountId, other.id, GOLIVE_ACTOR).then(() => null, (e: Error) => e);
        // State first: what D-043 is about is what a failure LEAVES, and the
        // two-call path fails this line (its first write already committed).
        expect((await getVoiceProfile(db, accountId))?.enabled).toBe(false);
        expect((await getPhoneNumberById(db, other.id))?.status).toBe("testing");
        expect(await goLiveEvents(db, accountId)).toEqual([]);
        expect(await goLiveEvents(db, otherAccountId)).toEqual([]);
        expect(err?.message).toBe("goLive failed: go_live: no such number on this account, or it was released");
      });
    });
  });
});

/**
 * The call card (0064): why they called, the number to call back and the
 * caller's own words, written by `finishCall` AFTER the call row is finished,
 * in its own update — and the callback To do that points back at its call.
 */
describe("call card accessors", () => {
  it("setCallCard writes the three fields; getCallCard reads them back, null cross-account or unknown (mutation: drop .eq(\"account_id\") on the read → account B sees A's card, FAILS)", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const n = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber() }, "user_test");
        const { id } = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: "+19562921696" });
        // A call nobody has written a card for reads as an EMPTY card, not
        // as no call: the page tells those two apart.
        expect(await getCallCard(db, accountA, id)).toEqual({ reason: null, callbackNumber: null, callerWords: null });
        await setCallCard(db, accountA, id, {
          reason: "Wants a quote for a roof leak", callbackNumber: "956 555 0142",
          callerWords: "My roof started leaking last night and I need someone out here.",
        });
        expect(await getCallCard(db, accountA, id)).toEqual({
          reason: "Wants a quote for a roof leak", callbackNumber: "956 555 0142",
          callerWords: "My roof started leaking last night and I need someone out here.",
        });
        expect(await getCallCard(db, accountB, id)).toBeNull();
        expect(await getCallCard(db, accountA, "00000000-0000-0000-0000-000000000000")).toBeNull();
      });
    });
  });

  it("setCallCard on another account's call throws and writes nothing (mutation: drop the matched-no-row check → resolves, FAILS)", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const n = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber() }, "user_test");
        const { id } = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });
        await expect(setCallCard(db, accountB, id, { reason: "x", callbackNumber: null, callerWords: null }))
          .rejects.toThrow("setCallCard matched no row");
        expect((await getCallCard(db, accountA, id))?.reason).toBeNull();
      });
    });
  });

  it("listCallReasons answers for exactly the asked calls of this account, skips a call with no reason, and asks nothing for none (mutation: drop .in(\"id\") → the unasked call's reason appears, FAILS)", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const n = await assignPhoneNumber(db, accountA, { e164: testPhoneNumber() }, "user_test");
        const asked = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });
        const blank = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });
        const unasked = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });
        await setCallCard(db, accountA, asked.id, { reason: "Roof leak", callbackNumber: null, callerWords: null });
        await setCallCard(db, accountA, unasked.id, { reason: "Gutter cleaning", callbackNumber: null, callerWords: null });
        const reasons = await listCallReasons(db, accountA, [asked.id, blank.id]);
        expect(Object.fromEntries(reasons)).toEqual({ [asked.id]: "Roof leak" });
        expect((await listCallReasons(db, accountB, [asked.id])).size).toBe(0);
        expect((await listCallReasons(db, accountA, [])).size).toBe(0);
      });
    });
  });

  it("ensureCallbackTask writes ONE To do linked to its call, due when given, emitted as the AI's; a second attempt finds the first and emits nothing (mutation: drop the 23505 branch → the second call throws, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const n = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const { id: callId } = await startCallRow(db, accountId, { phoneNumberId: n.id, callerE164: "+19562921696" });
      const contact = await createContact(db, accountId, { firstName: "Ana", phone: "+19562921696" }, "voice", "ai");
      const dueAt = "2027-06-01T17:02:00.000Z";
      const first = await ensureCallbackTask(db, accountId,
        { callId, contactId: contact.id, title: "Call back at +19562921696: Roof leak", dueAt }, "voice", "ai");
      expect(first.created).toBe(true);
      const again = await ensureCallbackTask(db, accountId,
        { callId, contactId: contact.id, title: "Call back at +19562921696: something else", dueAt }, "voice", "ai");
      expect(again).toEqual({ id: first.id, created: false });

      const { data: tasks } = await db.from("tasks")
        .select("id, title, due_at, contact_id, call_id, completed_at").eq("account_id", accountId);
      expect(tasks).toEqual([{
        id: first.id, title: "Call back at +19562921696: Roof leak", due_at: "2027-06-01T17:02:00+00:00",
        contact_id: contact.id, call_id: callId, completed_at: null,
      }]);
      const { data: events } = await db.from("events").select("type, actor_id, actor_type, payload")
        .eq("account_id", accountId).eq("type", "task.created");
      expect(events).toEqual([{
        type: "task.created", actor_id: "voice", actor_type: "ai",
        payload: { taskId: first.id, contactId: contact.id, callId },
      }]);
    });
  });

  it("ensureCallbackTask with no contact still writes the To do (a withheld name must not cost the callback)", async () => {
    await withTestAccount(async (db, accountId) => {
      const n = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const { id: callId } = await startCallRow(db, accountId, { phoneNumberId: n.id, callerE164: "+19562921696" });
      const r = await ensureCallbackTask(db, accountId,
        { callId, contactId: null, title: "Call back at +19562921696: Roof leak", dueAt: "2027-06-01T17:02:00.000Z" }, "voice", "ai");
      const { data } = await db.from("tasks").select("contact_id, call_id").eq("id", r.id).single();
      expect(data).toEqual({ contact_id: null, call_id: callId });
    });
  });
});

/**
 * Where a callback To do is SEEN: the To do queue and the contact's
 * timeline. Each must carry the To do's call, because that link is the only
 * thing that shows the row as the receptionist's (DESIGN.md, provenance).
 */
describe("the callback To do carries its call to the screens that show it", () => {
  it("listAccountWork: a callback To do's row names its call, a To do a person typed names none (mutation: drop call_id from openTasks' select → callId undefined, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const n = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const { id: callId } = await startCallRow(db, accountId, { phoneNumberId: n.id, callerE164: "+19562921696" });
      const callback = await ensureCallbackTask(db, accountId,
        { callId, contactId: null, title: "Call back at +19562921696: Roof leak", dueAt: new Date().toISOString() }, "voice", "ai");
      const typed = await addTask(db, accountId, { title: "Order shingles" }, "user_test");
      const rows = await listAccountWork(db, accountId);
      expect(rows.find((r) => r.id === `task:${callback.id}`)?.callId).toBe(callId);
      expect(rows.find((r) => r.id === `task:${typed.id}`)?.callId).toBeNull();
    });
  });

  it("listContactTasks: the contact's timeline gets each To do's call_id (mutation: drop call_id from the select → undefined, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const n = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const { id: callId } = await startCallRow(db, accountId, { phoneNumberId: n.id, callerE164: "+19562921696" });
      const contact = await createContact(db, accountId, { firstName: "Ana", phone: "+19562921696" }, "voice", "ai");
      await ensureCallbackTask(db, accountId,
        { callId, contactId: contact.id, title: "Call back at +19562921696: Roof leak", dueAt: new Date().toISOString() }, "voice", "ai");
      await addTask(db, accountId, { contactId: contact.id, title: "Order shingles" }, "user_test");
      const tasks = await listContactTasks(db, accountId, contact.id);
      expect(tasks.map((t) => [t.title, t.call_id]).sort()).toEqual([
        ["Call back at +19562921696: Roof leak", callId],
        ["Order shingles", null],
      ]);
    });
  });
});

describe("S-47e: who is on a number, one contact's next booking, the holding record (plan Task 3)", () => {
  /** A person on a number the way staff put a second one there today: a contact with no phone (createContact
   *  then has nothing to dedupe on), then an edit that gives it the number (updateContact keeps both and files
   *  the pair for the merge queue). createContact with a phone alone would dedupe onto the first by phone. */
  async function person(db: SupabaseClient, accountId: string, firstName: string, lastName: string, phone: string, email?: string) {
    const { id } = await createContact(db, accountId, { firstName, lastName, email, source: "voice" }, "user_test");
    await updateContact(db, accountId, id, { phone }, "user_test");
    return { id };
  }
  /** A pre-F-009 row (no writer stores this shape any more): the service client's own insert, said so here.
   *  `createdAt` back-dates it, as a row that old really is: the only way to make the OLDER row the one
   *  inserted SECOND, so "oldest first" is not just insertion order. */
  async function legacy(db: SupabaseClient, accountId: string, firstName: string, phone: string, createdAt?: string): Promise<string> {
    const { data, error } = await db.from("contacts").insert({ account_id: accountId, first_name: firstName, last_name: "Prueba", phone,
      ...(createdAt === undefined ? {} : { created_at: createdAt }) })
      .select("id").single();
    if (error || !data) throw new Error(error?.message);
    return (data as { id: string }).id;
  }

  it("phoneKeysOf: a US number's digits key; a Mexican number's own key, its ten digits and its 521 form, from either input form (plan P4; mutation: drop the 521 input branch -> FAILS)", () => {
    expect(phoneKeysOf("+19565550160")).toEqual(["9565550160"]);
    expect(phoneKeysOf("+528999221234")).toEqual(["528999221234", "8999221234", "5218999221234"]);
    expect(phoneKeysOf("+5218999221234")).toEqual(["5218999221234", "8999221234", "528999221234"]);
  });

  it("finds an E.164 phone and a legacy typed one, oldest first (a back-dated row inserted second leads), with email_key and never the raw email (mutation: drop the created_at order -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const ana = await person(db, accountId, "Ana", "Prueba", "+19565550160", "Ana+bis@Example.com");
      const beto = await legacy(db, accountId, "Beto", "(956) 555-0160", "2020-01-01T00:00:00Z");
      const { rows, truncated } = await listContactsOnNumber(db, accountId, "+19565550160");
      expect(truncated).toBe(false);
      expect(rows.map((r) => r.id)).toEqual([beto, ana.id]);
      expect(Object.keys(rows[1]!).sort()).toEqual(["email_key", "first_name", "holds_shared_number", "id", "last_name", "phone"]);
      expect(rows[1]).toMatchObject({ first_name: "Ana", last_name: "Prueba", email_key: "ana@example.com", holds_shared_number: false });
      expect(rows[0]).toMatchObject({ phone: "(956) 555-0160", email_key: null });
    });
  });

  it("finds a Mexican number stored with its code, without it, and in its 521 form (mutation: drop the 521 key from phoneKeysOf -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const withCode = await person(db, accountId, "Carla", "Prueba", "+528999221234");
      const bare = await legacy(db, accountId, "Dora", "899 922 1234");
      const old521 = await legacy(db, accountId, "Eva", "+52 1 899 922 1234");
      const { rows } = await listContactsOnNumber(db, accountId, "+528999221234");
      expect(rows.map((r) => r.id).sort()).toEqual([withCode.id, bare, old521].sort());
    });
  });

  it("never returns another account's contact with the same phone and name (mutation: drop .eq(\"account_id\", …) -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const a = await person(dbA, accountA, "Ana", "Prueba", "+19565550161");
        await person(dbB, accountB, "Ana", "Prueba", "+19565550161");
        const { rows } = await listContactsOnNumber(dbA, accountA, "+19565550161");
        expect(rows.map((r) => r.id)).toEqual([a.id]);
      });
    });
  });

  it(`${CONTACTS_ON_NUMBER_LIMIT + 1} contacts set truncated and return ${CONTACTS_ON_NUMBER_LIMIT}; ${CONTACTS_ON_NUMBER_LIMIT} do not`, async () => {
    await withTestAccount(async (db, accountId) => {
      expect(CONTACTS_ON_NUMBER_LIMIT).toBe(20);
      for (let i = 0; i < 20; i += 1) await person(db, accountId, `P${i}`, "Prueba", "+19565550162");
      expect(await listContactsOnNumber(db, accountId, "+19565550162")).toMatchObject({ truncated: false });
      await person(db, accountId, "P20", "Prueba", "+19565550162");
      const r = await listContactsOnNumber(db, accountId, "+19565550162");
      expect(r.truncated).toBe(true);
      expect(r.rows).toHaveLength(20);
    });
  });

  it("findUpcomingBookingForContact: that ONE contact's soonest booked future booking, ahead of a later one made first; past, cancelled and a housemate's are skipped (mutation: drop the starts_at order -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const ana = await person(db, accountId, "Ana", "Prueba", "+19565550163");
      const beto = await person(db, accountId, "Beto", "Prueba", "+19565550163");
      const now = new Date("2027-05-01T12:00:00Z");
      const at = (d: string) => ({ startsAt: new Date(`${d}T15:00:00Z`), endsAt: new Date(`${d}T16:00:00Z`) });
      await createBooking(db, accountId, { calendarId: cal.id, contactId: ana.id, ...at("2027-04-30") }, "user_test");
      const cancelled = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana.id, ...at("2027-05-02") }, "user_test");
      await setBookingStatus(db, accountId, cancelled.id, "cancelled", "user_test");
      await createBooking(db, accountId, { calendarId: cal.id, contactId: beto.id, ...at("2027-05-03") }, "user_test");
      // Ana's LATER booking goes in first, so a read without the starts_at order meets it before her soonest.
      await createBooking(db, accountId, { calendarId: cal.id, contactId: ana.id, ...at("2027-05-06") }, "user_test");
      const anas = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana.id, ...at("2027-05-04") }, "user_test");
      expect(await findUpcomingBookingForContact(db, accountId, ana.id, now.toISOString()))
        .toEqual({ bookingId: anas.id, startsAt: expect.stringMatching(/^2027-05-04T15:00:00/) });
    });
  });

  it("findUpcomingBookingForContact answers null for account A asked about account B's contact (mutation: drop .eq(\"account_id\", …) -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const cal = await getOrCreateCalendar(dbB, accountB, "user_test");
        const b = await person(dbB, accountB, "Ana", "Prueba", "+19565550164");
        await createBooking(dbB, accountB, { calendarId: cal.id, contactId: b.id,
          startsAt: new Date("2027-05-04T15:00:00Z"), endsAt: new Date("2027-05-04T16:00:00Z") }, "user_test");
        expect(await findUpcomingBookingForContact(dbA, accountA, b.id, "2027-05-01T12:00:00Z")).toBeNull();
      });
    });
  });

  it("ensureHoldingContact makes the exact shape once, by Sofía, then reuses it; one contact.created with holding true", async () => {
    await withTestAccount(async (db, accountId) => {
      await person(db, accountId, "Ana", "Prueba", "+19565550165");
      const first = await ensureHoldingContact(db, accountId, "+19565550165");
      const again = await ensureHoldingContact(db, accountId, "+19565550165");
      expect(first.created).toBe(true);
      expect(again).toEqual({ id: first.id, created: false });
      const { data: row } = await db.from("contacts")
        .select("first_name, last_name, email, phone, source, holds_shared_number, author_kind, author_id").eq("id", first.id).single();
      expect(row).toEqual({ first_name: "Caller", last_name: null, email: null, phone: "+19565550165", source: "voice",
        holds_shared_number: true, author_kind: "ai", author_id: null });
      const { data: events } = await db.from("events").select("payload").eq("account_id", accountId).eq("type", "contact.created");
      expect((events ?? []).filter((e: { payload: { holding?: boolean } }) => e.payload.holding === true)).toHaveLength(1);
    });
  });

  it("two ensureHoldingContact calls at once make ONE row (mutation: no re-read after the 23505 -> the loser throws, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const [x, y] = await Promise.all([
        ensureHoldingContact(db, accountId, "+19565550166"), ensureHoldingContact(db, accountId, "+19565550166"),
      ]);
      expect(x.id).toBe(y.id);
      const { data } = await db.from("contacts").select("id").eq("account_id", accountId).eq("holds_shared_number", true);
      expect(data).toHaveLength(1);
    });
  });

  it("two numbers that share a digits key get two holding records (P23: +1 322 123 4567 and +32 2 123 4567; mutation: read by phone_key -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const us = await ensureHoldingContact(db, accountId, "+13221234567");
      const be = await ensureHoldingContact(db, accountId, "+3221234567");
      expect(be.id).not.toBe(us.id);
      expect(be.created).toBe(true);
      expect(await ensureHoldingContact(db, accountId, "+3221234567")).toEqual({ id: be.id, created: false });
    });
  });

  it("a raw +521 caller's holding record is found again by the phone it is stored as (mutation: find() by the raw e164 -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const first = await ensureHoldingContact(db, accountId, "+5218999221234");
      expect(first.created).toBe(true);
      const { data: row } = await db.from("contacts").select("phone").eq("id", first.id).single();
      expect(row).toEqual({ phone: "+528999221234" });
      expect(await ensureHoldingContact(db, accountId, "+5218999221234")).toEqual({ id: first.id, created: false });
      expect(await ensureHoldingContact(db, accountId, "+528999221234")).toEqual({ id: first.id, created: false });
      const { data: all } = await db.from("contacts").select("id").eq("account_id", accountId).eq("holds_shared_number", true);
      expect(all).toEqual([{ id: first.id }]);
    });
  });

  it("ensureHoldingContact never returns account B's holding record for account A (mutation: drop .eq(\"account_id\", …) from its read -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const b = await ensureHoldingContact(dbB, accountB, "+19565550167");
        const a = await ensureHoldingContact(dbA, accountA, "+19565550167");
        expect(a.id).not.toBe(b.id);
        expect(a.created).toBe(true);
      });
    });
  });

  it("listContactsOnNumber returns the holding record flagged; an ordinary \"Caller\" contact is not one", async () => {
    await withTestAccount(async (db, accountId) => {
      const caller = await createContact(db, accountId, { firstName: "Caller", phone: "+19565550168", source: "voice" }, "voice", "ai");
      const holding = await ensureHoldingContact(db, accountId, "+19565550168");
      const { rows } = await listContactsOnNumber(db, accountId, "+19565550168");
      expect(rows.map((r) => [r.id, r.holds_shared_number])).toEqual([[caller.id, false], [holding.id, true]]);
    });
  });

  it("moveHoldingThread moves the texts and the call through PostgREST and its Undo names the move; another account's thread is not_found (mutation: callIds: [] in the mapping -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (dbB, accountB) => {
        await person(db, accountId, "Ana", "Prueba", "+19565550169");
        const beto = await person(db, accountId, "Beto", "Prueba", "+19565550169");
        const holding = await ensureHoldingContact(db, accountId, "+19565550169");
        const hc = await ensureConversation(db, accountId, holding.id, "voice", "ai");
        const bc = await ensureConversation(db, accountId, beto.id, "user_test");
        const msg = await createMessage(db, accountId, { conversationId: hc.id, channel: "sms", direction: "inbound", body: "test", status: "delivered" }, "sms-inbound", "system");
        // The missed call the text-back answered: filed on the holding record and its thread, as finishCall files one.
        const n = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
        const call = await startCallRow(db, accountId, { phoneNumberId: n.id, callerE164: "+19565550169" });
        await finishCallRow(db, accountId, call.id, { outcome: "abandoned", endedAt: new Date(), durationSecs: 5, turnCount: 0,
          transcript: [], summary: "", language: "en", contactId: holding.id, conversationId: hc.id });
        const callRow = async () => (await db.from("calls").select("conversation_id, contact_id").eq("id", call.id).single()).data;
        const moved = await moveHoldingThread(db, accountId, { from: hc.id, to: bc.id, actor: "user_test" });
        expect(moved).toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [msg.id], callIds: [call.id] });
        if (moved.status !== "ok") throw new Error("unreachable");
        const { data: m } = await db.from("messages").select("conversation_id").eq("id", msg.id).single();
        expect(m).toEqual({ conversation_id: bc.id });
        expect(await callRow()).toEqual({ conversation_id: bc.id, contact_id: beto.id });
        expect(await moveHoldingThread(db, accountId, { from: bc.id, to: hc.id, actor: "user_test", undoOf: moved.moveId }))
          .toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [msg.id], callIds: [call.id] });
        expect(await callRow()).toEqual({ conversation_id: hc.id, contact_id: null });
        // An Undo that names no move is refused by the function (P1), never a silent no-op.
        expect(await moveHoldingThread(db, accountId, { from: bc.id, to: hc.id, actor: "user_test" })).toEqual({ status: "invalid" });
        const holdingB = await ensureHoldingContact(dbB, accountB, "+19565550169");
        const hbc = await ensureConversation(dbB, accountB, holdingB.id, "voice", "ai");
        expect(await moveHoldingThread(db, accountId, { from: hbc.id, to: bc.id, actor: "user_test" })).toEqual({ status: "not_found" });
      });
    });
  });

  it("a second move of the same thread answers empty and writes no event; a second Undo of one move is ok with nothing moved (P32; mutation: drop \"empty\" from the mapping -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const beto = await person(db, accountId, "Beto", "Prueba", "+19565550170");
      const holding = await ensureHoldingContact(db, accountId, "+19565550170");
      const hc = await ensureConversation(db, accountId, holding.id, "voice", "ai");
      const bc = await ensureConversation(db, accountId, beto.id, "user_test");
      const msg = await createMessage(db, accountId, { conversationId: hc.id, channel: "sms", direction: "inbound", body: "test", status: "delivered" }, "sms-inbound", "system");
      const moved = await moveHoldingThread(db, accountId, { from: hc.id, to: bc.id, actor: "user_test" });
      if (moved.status !== "ok") throw new Error(`first move answered ${moved.status}`);
      const movedEvents = async (): Promise<number> => {
        const { data, error } = await db.from("events").select("id").eq("account_id", accountId).eq("type", "conversation.moved");
        if (error) throw new Error(error.message);
        return (data ?? []).length;
      };
      expect(await movedEvents()).toBe(1);
      expect(await moveHoldingThread(db, accountId, { from: hc.id, to: bc.id, actor: "user_test" })).toEqual({ status: "empty" });
      expect(await movedEvents()).toBe(1);
      expect(await moveHoldingThread(db, accountId, { from: bc.id, to: hc.id, actor: "user_test", undoOf: moved.moveId }))
        .toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [msg.id], callIds: [] });
      expect(await moveHoldingThread(db, accountId, { from: bc.id, to: hc.id, actor: "user_test", undoOf: moved.moveId }))
        .toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [], callIds: [] });
      const { data: m } = await db.from("messages").select("conversation_id").eq("id", msg.id).single();
      expect(m).toEqual({ conversation_id: hc.id });
    });
  });

  it("ensureHoldingContact throws, and records nothing, when the row it made came back without the holding mark (M6; the stub stands for the one way that happens, a signed-in insert, which 0098's trigger stores false; mutation: drop the mark check -> FAILS)", async () => {
    // A stub, said so: it answers the read with no row and the insert with the row a signed-in session gets
    // back. It records every table and function the code reaches, so "records nothing" is checked, not assumed.
    const reached: string[] = [];
    const answer = (result: unknown) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "insert"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.single = async () => result;
      return q;
    };
    const stub = {
      from: (table: string) => { reached.push(`from:${table}`); return answer({ data: { id: "c-stub", holds_shared_number: false }, error: null }); },
      rpc: async (fn: string) => { reached.push(`rpc:${fn}`); return { data: null, error: null }; },
    } as unknown as SupabaseClient;
    await expect(ensureHoldingContact(stub, "acct-stub", "+19565550172"))
      .rejects.toThrow("ensureHoldingContact: contact c-stub was stored without the holding mark (not the service client)");
    expect(reached).toEqual(["from:contacts", "from:contacts"]);
  });

  // The same guard through PostgREST with a signed Owner token. It needs the replica's JWT secret, which only a
  // local run has (the ai-acts-schema pattern): without it the case is SKIPPED, and a skip is not a pass. The
  // always-run stub case above holds the guard in CI.
  const REPLICA_SECRET = process.env.BIS_REPLICA_JWT_SECRET;
  const signJwt = (payload: Record<string, unknown>, secret: string): string => {
    const b64 = (b: Buffer) => b.toString("base64url");
    const head = b64(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const body = b64(Buffer.from(JSON.stringify(payload)));
    return `${head}.${body}.${b64(createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
  };
  it.skipIf(!REPLICA_SECRET)("a signed-in Owner's ensureHoldingContact throws: the trigger stored false, so the ordinary Caller row it made is never handed back as the number's holding record, and no contact.created is written (M6, through PostgREST; mutation: drop the mark check -> FAILS)", async () => {
    const sub = `u_t3_owner_${Math.random().toString(36).slice(2, 10)}`;
    const svc = serviceDb();
    const u = await svc.from("users").insert({ clerk_user_id: sub, email: `${sub}@example.com` }).select("id").single();
    if (u.error) throw new Error(u.error.message);
    try {
      await withTestAccount(async (db, accountId) => {
        const { data: acct, error } = await db.from("accounts").update({ client_access_enabled: true }).eq("id", accountId)
          .select("clerk_org_id").single();
        if (error) throw new Error(error.message);
        const mem = await db.from("memberships").insert({ user_id: (u.data as { id: string }).id, scope: "account", account_id: accountId, role: "owner" });
        if (mem.error) throw new Error(mem.error.message);
        const token = signJwt({ role: "authenticated", org_id: (acct as { clerk_org_id: string }).clerk_org_id, sub,
          exp: Math.floor(Date.now() / 1000) + 600 }, REPLICA_SECRET!);
        await expect(ensureHoldingContact(userDb(token), accountId, "+19565550171")).rejects.toThrow("was stored without the holding mark");
        const { data: rows } = await db.from("contacts").select("first_name, phone, holds_shared_number").eq("account_id", accountId);
        expect(rows).toEqual([{ first_name: "Caller", phone: "+19565550171", holds_shared_number: false }]);
        const { data: created } = await db.from("events").select("id").eq("account_id", accountId).eq("type", "contact.created");
        expect(created).toEqual([]);
      });
    } finally {
      const { error } = await svc.from("users").delete().eq("clerk_user_id", sub);
      if (error) throw new Error(`users cleanup failed: ${error.message}`);
    }
  });

  it("the barrel exports emailKey, the twin of 0034's email_key (spec O1; mutation: drop the index.ts line -> FAILS)", () => {
    expect(barrelEmailKey("  Dan+BIS@Example.com ")).toBe("dan@example.com");
  });
});
