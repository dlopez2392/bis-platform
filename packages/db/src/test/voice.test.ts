import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, setBookingStatus, getCalendarForAccount } from "../booking";
import {
  assignPhoneNumber, getPhoneNumberByE164, setPhoneNumberStatus,
  getVoiceProfile, upsertVoiceProfile,
  startCallRow, finishCallRow, countCallsSince, countCallsByCallerSince,
  hasActiveCallSince,
  findUpcomingBookingForPhone, getBookingById, deleteCallRow,
  listPhoneNumbersForAccount, listAllPhoneNumbers, reassignPhoneNumber,
  listCalls, getCall,
} from "../voice";

describe("voice accessors", () => {
  it("phone number assign → lookup → status walk", async () => {
    await withTestAccount(async (db, accountId) => {
      const row = await assignPhoneNumber(db, accountId, { e164: "+19565550120" }, "user_test");
      expect(row.status).toBe("provisioned");
      expect(await getPhoneNumberByE164(db, "+19565550120")).toMatchObject({ account_id: accountId });
      expect(await getPhoneNumberByE164(db, "+19999999999")).toBeNull();
      await setPhoneNumberStatus(db, accountId, row.id, "live", "user_test");
      expect((await getPhoneNumberByE164(db, "+19565550120"))!.status).toBe("live");
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
      const num = await assignPhoneNumber(db, accountId, { e164: "+19565550121" }, "user_test");
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
      const num = await assignPhoneNumber(db, accountId, { e164: "+19565550135" }, "user_test");
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
      const num = await assignPhoneNumber(db, accountId, { e164: "+19565550136" }, "user_test");
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
      const num = await assignPhoneNumber(db, accountId, { e164: "+19565550122" }, "user_test");
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
      const num = await assignPhoneNumber(db, accountId, { e164: "+19565550142" }, "user_test");
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
      const row = await assignPhoneNumber(db, accountId, { e164: "+19565550140" }, "voice", "ai");
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
});

describe("listPhoneNumbersForAccount / listAllPhoneNumbers / reassignPhoneNumber", () => {
  it("lists only the account's numbers, oldest first", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const a = await assignPhoneNumber(db, accountA, { e164: "+15550000001" }, "user_test");
        await assignPhoneNumber(db, accountB, { e164: "+15550000002" }, "user_test");
        const rows = await listPhoneNumbersForAccount(db, accountA);
        expect(rows.map((r) => r.id)).toEqual([a.id]);
      });
    });
  });

  it("listAllPhoneNumbers returns every account's numbers with the account name embedded", async () => {
    await withTestAccount(async (db, accountA) => {
      await assignPhoneNumber(db, accountA, { e164: "+15550000003" }, "user_test");
      const all = await listAllPhoneNumbers(db);
      const mine = all.find((r) => r.e164 === "+15550000003");
      expect(mine?.account?.name).toBeTruthy();
    });
  });

  it("reassignPhoneNumber moves the row to the target account and resets status to provisioned", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const n = await assignPhoneNumber(db, accountA, { e164: "+15550000004", status: "live" }, "user_test");
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
      const n = await assignPhoneNumber(db, accountA, { e164: "+15550000010" }, "user_test");
      const c = await createContact(db, accountA, { firstName: "Maria", lastName: "Garcia", phone: "+15550000011" }, "user_test");
      const r1 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: "+15550000011" });
      await finishCallRow(db, accountA, r1.id, {
        outcome: "booked", endedAt: new Date(), durationSecs: 62, turnCount: 9,
        transcript: [{ role: "caller", text: "hola", at: new Date().toISOString() }],
        summary: "s", language: "es", contactId: c.id,
      });
      const r2 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });

      const rows = await listCalls(db, accountA);
      expect(rows[0]!.id).toBe(r2.id);                       // newest first
      const booked = rows.find((r) => r.id === r1.id)!;
      expect(booked.contact?.first_name).toBe("Maria");
      expect(booked.language).toBe("es");

      const paged = await listCalls(db, accountA, { before: rows[0]!.started_at, limit: 1 });
      expect(paged.map((r) => r.id)).toEqual([r1.id]);
    });
  });

  it("getCall returns the full row for the account and null cross-account or unknown", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db2, accountB) => {
        const n = await assignPhoneNumber(db, accountA, { e164: "+15550000012" }, "user_test");
        const r = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });
        const detail = await getCall(db, accountA, r.id);
        expect(detail?.transcript).toEqual([]);
        expect(await getCall(db, accountB, r.id)).toBeNull();  // tenant boundary
        expect(await getCall(db, accountA, "00000000-0000-0000-0000-000000000000")).toBeNull();
      });
    });
  });
});
