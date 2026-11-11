// packages/db/src/test/owner-line-counting.test.ts
import { describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignPhoneNumber, startCallRow, finishCallRow, countCallsSince, countCallsByCallerSince, countAnsweredCallsSince,
  listCallStartsByOutcomeBetween, listCalls,
  readMyOwnerLineEnrollment, startOwnerLineVerification, attemptOwnerLineVerify, setOwnerLinePin, removeOwnerLinePin,
  removeOwnerLineEnrollment, ownerLineAnswerLookup, attemptOwnerLinePin, ownerLineSessionCheck, noteOwnerLineCall,
  readOwnerLineCallLog, readOwnerLineSwitch, setOwnerLineSwitch, OWNER_LINE_MAX_CALLS_PER_DAY,
} from "../index";
import { withTestAccount, testPhoneNumber } from "./fixtures";

/**
 * F-032 §6 / SC-9 / owner rulings Q-B, Q-C, Q-E: an owner-line call moves none of the counted customer numbers.
 * withTestAccount writes through serviceDb (PostgREST): CI verify runs it on its own stack, and a local run needs a
 * PostgREST in front of a replica holding 0115. NEVER run it against bis-ci before 0115 is there.
 */
const FROM = "2000-01-01T00:00:00.000Z";
const TO = "2999-01-01T00:00:00.000Z";
const CELL = "+19565550142";

/**
 * Two customer calls (a lead, an abandoned one) and two owner-line calls. One owner-line call is finished as
 * `message`, an ANSWERED outcome, ON PURPOSE: the real owner-line finish writes `abandoned`, which no answered reader
 * would count anyway, so only an answered outcome makes each exclusion below able to fail (review minor finding).
 */
async function seedCalls(db: SupabaseClient, accountId: string) {
  const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
  const done = { endedAt: new Date(), durationSecs: 60, turnCount: 2, transcript: [], summary: "", language: "en" as const };
  const row = async (callerE164: string, outcome: "lead" | "abandoned" | "message", owner: boolean) => {
    const r = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164, ...(owner ? { ownerLineUserId: randomUUID() } : {}) });
    await finishCallRow(db, accountId, r.id, { ...done, outcome });
    return r.id;
  };
  await row("+19565550177", "lead", false);
  await row("+19565550178", "abandoned", false);
  const owner = await row(CELL, "message", true);
  await row(CELL, "abandoned", true);
  return { owner };
}

describe("owner-line calls are not customer calls (F-032 §6, SC-9, owner ruling Q-C)", () => {
  it("both caps count only the two customer calls (mutation: drop .is('owner_line_user_id', null) from countCallsSince -> 4; from countCallsByCallerSince -> 2; FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await seedCalls(db, accountId);
      expect([await countCallsSince(db, accountId, FROM), await countCallsByCallerSince(db, accountId, CELL, FROM)]).toEqual([2, 0]);
    }));

  it("answered and abandoned starts ignore it: dashboard tiles, conversion, weekly report, presence (mutation: drop it from listCallStartsByOutcomeBetween -> 2 and 2, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await seedCalls(db, accountId);
      expect([
        (await listCallStartsByOutcomeBetween(db, accountId, ["booked", "lead", "message", "transferred"], FROM, TO)).length,
        (await listCallStartsByOutcomeBetween(db, accountId, ["abandoned"], FROM, TO)).length,
      ]).toEqual([1, 1]);
    }));

  it("the setup wizard's answered count ignores it (mutation: drop it from countAnsweredCallsSince -> 2, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await seedCalls(db, accountId);
      expect(await countAnsweredCallsSince(db, accountId, FROM)).toBe(1);
    }));

  it("the Calls list keeps it, marked; the dashboard's recent calls drop it (mutation: ignore excludeOwnerLine -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { owner } = await seedCalls(db, accountId);
      const all = await listCalls(db, accountId, { limit: 10 });
      expect(all.map((r) => r.id)).toContain(owner);
      expect(all.find((r) => r.id === owner)?.owner_line_user_id).toEqual(expect.any(String));
      expect(all.filter((r) => r.owner_line_user_id === null)).toHaveLength(2);
      expect((await listCalls(db, accountId, { limit: 10, excludeOwnerLine: true })).map((r) => r.id)).not.toContain(owner);
    }));
});

/**
 * Every wrapper once, against the real functions through PostgREST. PostgREST matches an RPC by its NAMED arguments,
 * so a misspelt p_ name is a PGRST202 that no type check can see; the SQL's own cases (owner-line-schema.test.ts) call
 * the functions directly and cannot see it either. A person on the account is seeded through the service client;
 * their users row is not account-owned, so the finally deletes it.
 */
describe("the owner-line wrappers reach their functions (F-032 Task 2)", () => {
  it("verify a cell, set a PIN, the switch, the lookup, a wrong and a right PIN, the session check, the access-log entry, and removal", () =>
    withTestAccount(async (db, accountId) => {
      const clerk = `user_ol_wrap_${randomBytes(4).toString("hex")}`;
      const { data: u, error: uErr } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com`, name: "Dan Lopez" })
        .select("id").single();
      if (uErr || !u) throw new Error(`seed user: ${uErr?.message}`);
      const userId = (u as { id: string }).id;
      try {
        const { error: mErr } = await db.from("memberships").insert({ user_id: userId, scope: "account", account_id: accountId, role: "staff" });
        if (mErr) throw new Error(`seed membership: ${mErr.message}`);
        const { error: aErr } = await db.from("accounts").update({ client_access_enabled: true }).eq("id", accountId);
        if (aErr) throw new Error(`seed client access: ${aErr.message}`);
        const code = randomBytes(32).toString("hex");
        const pin = `scrypt:17:8:1:${"A".repeat(22)}:${"B".repeat(43)}`;

        expect(await startOwnerLineVerification(db, accountId, userId, CELL, code)).toBe("ok");
        expect(await ownerLineAnswerLookup(db, accountId, CELL, OWNER_LINE_MAX_CALLS_PER_DAY)).toMatchObject(
          { status: "verify", userId, role: "staff", name: "Dan Lopez", pinParams: null });
        expect(await attemptOwnerLineVerify(db, accountId, CELL, code)).toBe("verified");
        expect(await setOwnerLinePin(db, accountId, userId, pin)).toBe(true);
        expect(await readMyOwnerLineEnrollment(db, accountId, userId)).toMatchObject({ e164: CELL, verifiedAt: expect.any(String), pinSetAt: expect.any(String), lockedUntil: null });
        expect(await ownerLineAnswerLookup(db, accountId, CELL, OWNER_LINE_MAX_CALLS_PER_DAY)).toEqual({ status: "off" });

        expect(await readOwnerLineSwitch(db, accountId)).toEqual({ enabledAt: null, changedAt: null, changedByKind: null });
        // The wrapper refuses before writing, with its own words; the database CHECK is a second guard, never the first.
        await expect(setOwnerLineSwitch(db, accountId, true, "agency")).rejects.toThrow("setOwnerLineSwitch: the agency cannot turn the owner line on");
        expect(await setOwnerLineSwitch(db, accountId, true, "owner")).toMatchObject({ changed: true, state: { enabledAt: expect.any(String), changedByKind: "owner" } });

        const hit = await ownerLineAnswerLookup(db, accountId, CELL, OWNER_LINE_MAX_CALLS_PER_DAY);
        expect(hit).toMatchObject({ status: "pin", userId, role: "staff", pinParams: pin.slice(0, 36) });
        const enrollmentId = (hit as { enrollmentId: string }).enrollmentId;
        expect(await attemptOwnerLinePin(db, enrollmentId, "wrong")).toEqual({ status: "wrong" });
        expect(await attemptOwnerLinePin(db, enrollmentId, pin)).toEqual({ status: "ok" });
        expect(await ownerLineSessionCheck(db, { accountId, userId, role: "staff", maxCalls: OWNER_LINE_MAX_CALLS_PER_DAY }))
          .toMatchObject({ ok: true, name: "Dan Lopez", clerkUserId: clerk, timezone: expect.any(String) });
        expect(await ownerLineSessionCheck(db, { accountId, userId, role: "owner", maxCalls: null })).toEqual({ ok: false, reason: "role_changed" });

        const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
        const call = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: CELL, ownerLineUserId: userId });
        // The ten-a-day limit is the ONLY bound on owner-line calls (Q-C), and Tasks 7 and 12 mock both wrappers, so it
        // is pinned HERE, through them (review I-1): with one owner-line call today and a limit of one, the lookup says
        // over_limit with the person's facts, and the session check refuses (mutations: drop over_limit from the
        // lookup's mapping; send p_max null from the session check; send a huge p_max from the lookup -> FAILS).
        expect(await ownerLineAnswerLookup(db, accountId, CELL, 1)).toMatchObject({ status: "over_limit", enrollmentId, userId });
        expect(await ownerLineSessionCheck(db, { accountId, userId, role: "staff", maxCalls: 1 })).toEqual({ ok: false, reason: "over_limit" });
        await noteOwnerLineCall(db, { accountId, callId: call.id, actorClerkUserId: clerk, actorName: "Dan Lopez",
          kinds: ["owner_line_appointments", "owner_line_calls_and_messages"] });
        expect((await readOwnerLineCallLog(db, accountId, call.id)).sort()).toEqual(["owner_line_appointments", "owner_line_calls_and_messages"]);

        expect(await setOwnerLineSwitch(db, accountId, false, "agency")).toMatchObject({ changed: true, state: { enabledAt: null, changedByKind: "agency" } });
        await removeOwnerLinePin(db, accountId, userId);
        expect(await readMyOwnerLineEnrollment(db, accountId, userId)).toMatchObject({ pinSetAt: null });
        await removeOwnerLineEnrollment(db, accountId, userId);
        expect(await readMyOwnerLineEnrollment(db, accountId, userId)).toBeNull();
      } finally {
        const { error } = await db.from("users").delete().eq("id", userId);
        if (error) throw new Error(`owner-line wrapper test cleanup (users) failed: ${error.message}`);
      }
    }));

  it("a lock always carries its end, and three wrong PINs lock (attemptOwnerLinePin's locked_now)", () =>
    withTestAccount(async (db, accountId) => {
      const clerk = `user_ol_lock_${randomBytes(4).toString("hex")}`;
      const { data: u, error: uErr } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com` }).select("id").single();
      if (uErr || !u) throw new Error(`seed user: ${uErr?.message}`);
      const userId = (u as { id: string }).id;
      try {
        const { error: mErr } = await db.from("memberships").insert({ user_id: userId, scope: "account", account_id: accountId, role: "owner" });
        if (mErr) throw new Error(`seed membership: ${mErr.message}`);
        const code = randomBytes(32).toString("hex");
        await startOwnerLineVerification(db, accountId, userId, CELL, code);
        await attemptOwnerLineVerify(db, accountId, CELL, code);
        await setOwnerLinePin(db, accountId, userId, `scrypt:17:8:1:${"A".repeat(22)}:${"B".repeat(43)}`);
        const id = (await readMyOwnerLineEnrollment(db, accountId, userId))!.id;
        await attemptOwnerLinePin(db, id, "x");
        await attemptOwnerLinePin(db, id, "y");
        const third = await attemptOwnerLinePin(db, id, "z");
        expect(third).toEqual({ status: "locked_now", lockedUntil: expect.any(String) });
        expect(await attemptOwnerLinePin(db, id, "w")).toEqual({ status: "locked", lockedUntil: (third as { lockedUntil: string }).lockedUntil });
      } finally {
        const { error } = await db.from("users").delete().eq("id", userId);
        if (error) throw new Error(`owner-line wrapper test cleanup (users) failed: ${error.message}`);
      }
    }));

  // Review m-E (2026-11-09): asking for the state the switch is already in writes nothing and says so, so an agency OFF on
  // a switch the Owner already turned off never relabels it "Turned off by BIS", and Task 5 emits BIS's switch_off
  // event only for a change that happened.
  it("a switch write that changes nothing writes nothing and reports changed: false (mutation: drop the conditional filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const on = await setOwnerLineSwitch(db, accountId, true, "owner");
      const again = await setOwnerLineSwitch(db, accountId, true, "owner");
      const off = await setOwnerLineSwitch(db, accountId, false, "owner");
      const bisOff = await setOwnerLineSwitch(db, accountId, false, "agency");
      expect([on.changed, again.changed, off.changed, bisOff.changed]).toEqual([true, false, true, false]);
      expect(again.state).toEqual(on.state);
      expect(bisOff.state).toEqual({ enabledAt: null, changedAt: off.state.changedAt, changedByKind: "owner" });
    }));

  it("a switch write on an account that does not exist throws (review m-3; mutation: answer changed: false with an all-null state -> FAILS)", () =>
    withTestAccount(async (db) => {
      const gone = randomUUID();
      await expect(setOwnerLineSwitch(db, gone, false, "agency")).rejects.toThrow(`setOwnerLineSwitch: no such account ${gone}`);
    }));
});

/** A person on the account, through the service client; the users row is not account-owned, so `done` deletes it. */
async function seedPerson(db: SupabaseClient, accountId: string, role: "owner" | "staff") {
  const clerk = `user_ol_p_${randomBytes(4).toString("hex")}`;
  const { data: u, error: uErr } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com` }).select("id").single();
  if (uErr || !u) throw new Error(`seed user: ${uErr?.message}`);
  const userId = (u as { id: string }).id;
  const { error: mErr } = await db.from("memberships").insert({ user_id: userId, scope: "account", account_id: accountId, role });
  if (mErr) throw new Error(`seed membership: ${mErr.message}`);
  return {
    userId,
    done: async () => {
      const { error } = await db.from("users").delete().eq("id", userId);
      if (error) throw new Error(`owner-line test cleanup (users) failed: ${error.message}`);
    },
  };
}

describe("the owner-line wrappers: an unverified cell and the restart cap (Task 5 review m-1, I-2)", () => {
  it("setting a PIN on a cell that is not verified answers false and stores nothing, never a database error (mutation: drop the verified-only filter -> the CHECK throws, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const p = await seedPerson(db, accountId, "staff");
      try {
        expect(await startOwnerLineVerification(db, accountId, p.userId, CELL, randomBytes(32).toString("hex"))).toBe("ok");
        expect(await setOwnerLinePin(db, accountId, p.userId, `scrypt:17:8:1:${"A".repeat(22)}:${"B".repeat(43)}`)).toBe(false);
        expect(await readMyOwnerLineEnrollment(db, accountId, p.userId)).toMatchObject({ e164: CELL, verifiedAt: null, pinSetAt: null });
      } finally { await p.done(); }
    }));

  it("five starts a day; removing the cell reads as no enrollment but does NOT reset the count (mutations: removal deletes the row -> 'ok'; the wrapper drops too_many -> throws; FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const p = await seedPerson(db, accountId, "staff");
      try {
        const code = () => randomBytes(32).toString("hex");
        for (let i = 1; i <= 5; i++) expect(await startOwnerLineVerification(db, accountId, p.userId, `+1956555040${i}`, code())).toBe("ok");
        await removeOwnerLineEnrollment(db, accountId, p.userId);
        expect(await readMyOwnerLineEnrollment(db, accountId, p.userId)).toBeNull();
        expect(await startOwnerLineVerification(db, accountId, p.userId, "+19565550499", code())).toBe("too_many");
      } finally { await p.done(); }
    }));
});
