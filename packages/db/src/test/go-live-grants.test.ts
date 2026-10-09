import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";

/**
 * 0063 go_live(p_account_id, p_phone_number_id, p_actor_id) and
 * phone_numbers_one_active_per_account (D-043). withRollback only; nothing
 * here commits.
 *
 * WHY IT EXISTS. goLiveAction used to make two separate writes through
 * PostgREST (enable the voice profile, then set the number live), each its own
 * transaction. A failure between them left the profile on and the number
 * still `testing`: the line answered real callers while text-back had no live
 * number and Setup still read "To do". go_live makes both writes and both
 * events one statement, so either all four land or none do.
 *
 * RED BEFORE APPLY: every test here. `::regprocedure` / has_function_privilege
 * on a function that does not exist raise 42883, every behaviour case calls
 * the function, and the index tests expect a refusal (or an indexdef) that
 * only the new index produces. The one legitimately green-before-apply
 * assertion would be "a released number does not hold the slot", which is
 * why that case also asserts the index exists.
 *
 * Seeds as the owner (inside the rollback), then calls the function as
 * service_role, the only role serviceDb() is and the only one with EXECUTE.
 */
const FN = "public.go_live(uuid, uuid, text)";
const INDEX = "phone_numbers_one_active_per_account";
const RUN = Math.random().toString(36).slice(2, 10);
const ACTOR = `user_GL_${RUN}`;

type Status = "provisioned" | "testing" | "live" | "released";

async function seed(
  c: Client, label: string, opts: { profile: boolean; numbers: Status[] },
): Promise<{ accountId: string; numberIds: string[] }> {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [account] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Fixture GL') returning id",
    [agency.id, `org_GL_${label}_${RUN}`]);
  if (opts.profile) {
    await c.query("insert into public.voice_profiles (account_id, enabled) values ($1, false)", [account.id]);
  }
  const numberIds: string[] = [];
  for (const status of opts.numbers) {
    const { rows: [n] } = await c.query(
      "insert into public.phone_numbers (account_id, e164, status) values ($1, $2, $3) returning id",
      [account.id, testPhoneNumber(), status]);
    numberIds.push(n.id as string);
  }
  return { accountId: account.id as string, numberIds };
}

/** One statement inside a savepoint: the error, or null if it succeeded. The
 *  rollback-to-savepoint is what lets a test look at the state a FAILED call
 *  left behind, which is the whole of D-043. */
async function attempt(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("rollback to savepoint probe");
    return e as { code?: string; message: string };
  }
  await c.query("release savepoint probe");
  return null;
}

/** Postgres orders uuids bytewise, which for their canonical lowercase hex
 *  text is the same order as JS string comparison. */
const byId = (rows: { id: string; status: string }[]) => [...rows].sort((x, y) => (x.id < y.id ? -1 : 1));

const goLive = (c: Client, accountId: string, numberId: string | null, actor: string | null = ACTOR) =>
  attempt(c, "select public.go_live($1, $2, $3)", [accountId, numberId, actor]);

async function stateOf(c: Client, accountId: string) {
  const { rows: [p] } = await c.query(
    "select enabled from public.voice_profiles where account_id = $1", [accountId]);
  const { rows: numbers } = await c.query(
    // Ordered by id: inside one transaction every created_at is the same now().
    "select id, status from public.phone_numbers where account_id = $1 order by id", [accountId]);
  const { rows: events } = await c.query(
    "select type, actor_type, actor_id, payload from public.events where account_id = $1 order by id", [accountId]);
  return { enabled: (p?.enabled ?? null) as boolean | null, numbers, events };
}

describe("0063 go_live: the shape and the grants", () => {
  it("EXECUTE is service_role's alone, not anon, not authenticated, not PUBLIC (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; x: boolean }>(
        `select r, has_function_privilege(r, '${FN}', 'EXECUTE') as x
           from unnest(array['anon', 'authenticated', 'public', 'service_role']) r order by r`);
      expect(rows).toEqual([
        { r: "anon", x: false }, { r: "authenticated", x: false },
        { r: "public", x: false }, { r: "service_role", x: true },
      ]);
    }));

  it("takes (uuid, uuid, text), returns void, plpgsql, runs as its CALLER with an empty search_path (mutation: security definer -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
                l.lanname as lang, p.prosecdef as secdef, p.proconfig as cfg
           from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = '${FN}'::regprocedure`);
      // INVOKER: service_role already holds UPDATE on both tables and INSERT on
      // events, so the function can do nothing serviceDb() could not, and there
      // is no definer-side guard standing in for RLS that a NULL could open.
      expect(rows).toEqual([{
        args: "p_account_id uuid, p_phone_number_id uuid, p_actor_id text",
        result: "void", lang: "plpgsql", secdef: false, cfg: ['search_path=""'],
      }]);
    }));

  it("the index is a partial UNIQUE on phone_numbers(account_id) where status <> 'released' (mutation: drop the where clause -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_indexdef(i.indexrelid) as def from pg_index i
          where i.indexrelid = to_regclass('public.${INDEX}')`);
      expect(rows).toEqual([{
        def: `CREATE UNIQUE INDEX ${INDEX} ON public.phone_numbers USING btree (account_id) WHERE (status <> 'released'::text)`,
      }]);
    }));
});

describe("0063 go_live: what it writes", () => {
  it("enables the profile, sets the number live, and records both events exactly as the app did, in the app's order (mutation: drop the voice_profile.updated insert -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, numberIds: [n] } = await seed(c, "ok", { profile: true, numbers: ["testing"] });
      await c.query("set local role service_role");
      expect(await goLive(c, accountId, n!)).toBeNull();
      await actAsOwner(c);
      // The payloads are what upsertVoiceProfile({ enabled: true }) and
      // setPhoneNumberStatus(..., "live") emit (packages/db/src/voice.ts):
      // { fields: Object.keys(patch) } and { phoneNumberId, status }, actor
      // type 'user'. voice.test.ts's goLive parity case compares the two
      // paths' stored rows directly.
      expect(await stateOf(c, accountId)).toEqual({
        enabled: true,
        numbers: [{ id: n, status: "live" }],
        events: [
          { type: "voice_profile.updated", actor_type: "user", actor_id: ACTOR, payload: { fields: ["enabled"] } },
          { type: "phone_number.status_changed", actor_type: "user", actor_id: ACTOR,
            payload: { phoneNumberId: n, status: "live" } },
        ],
      });
      const { rows: [t] } = await c.query(
        `select bool_and(p.updated_at = now()) and bool_and(n.updated_at = now()) as stamped
           from public.voice_profiles p, public.phone_numbers n where p.account_id = $1 and n.id = $2`,
        [accountId, n]);
      expect(t.stamped).toBe(true);
    }));

  it("takes a provisioned number straight to live, the wizard's other ordinary case", () =>
    withRollback(async (c) => {
      const { accountId, numberIds: [n] } = await seed(c, "prov", { profile: true, numbers: ["provisioned"] });
      await c.query("set local role service_role");
      expect(await goLive(c, accountId, n!)).toBeNull();
      await actAsOwner(c);
      expect((await stateOf(c, accountId)).numbers).toEqual([{ id: n, status: "live" }]);
    }));
});

describe("0063 go_live: a refusal leaves NOTHING behind (D-043)", () => {
  it("another account's number is refused as not found, and this account's profile stays off with no event (mutation: drop `and account_id = p_account_id` -> the other tenant's number goes live, FAILS)", () =>
    withRollback(async (c) => {
      // A has a profile and NO number of its own, so the only thing that can
      // refuse is the account scope on the number write. B's number is
      // ordinary (testing), so nothing about it is refusable on its own.
      const a = await seed(c, "scopeA", { profile: true, numbers: [] });
      const b = await seed(c, "scopeB", { profile: true, numbers: ["testing"] });
      await c.query("set local role service_role");
      const err = await goLive(c, a.accountId, b.numberIds[0]!);
      expect(err).toMatchObject({ code: "P0002", message: "go_live: no such number on this account, or it was released" });
      await actAsOwner(c);
      // The profile write ran BEFORE the number write raised. It is gone.
      expect(await stateOf(c, a.accountId)).toEqual({ enabled: false, numbers: [], events: [] });
      expect(await stateOf(c, b.accountId)).toEqual({
        enabled: false, numbers: [{ id: b.numberIds[0], status: "testing" }], events: [] });
    }));

  it("a released number is refused, and the profile stays off with no event (mutation: drop `and status <> 'released'` -> a former number answers again, FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, numberIds: [n] } = await seed(c, "rel", { profile: true, numbers: ["released"] });
      await c.query("set local role service_role");
      const err = await goLive(c, accountId, n!);
      expect(err).toMatchObject({ code: "P0002", message: "go_live: no such number on this account, or it was released" });
      await actAsOwner(c);
      expect(await stateOf(c, accountId)).toEqual({
        enabled: false, numbers: [{ id: n, status: "released" }], events: [] });
    }));

  it("an account with no voice profile is refused, and the number stays where it was (mutation: drop the `if not found` after the profile update -> the number goes live alone, FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, numberIds: [n] } = await seed(c, "noprof", { profile: false, numbers: ["testing"] });
      await c.query("set local role service_role");
      const err = await goLive(c, accountId, n!);
      expect(err).toMatchObject({ code: "P0002", message: "go_live: this account has no voice profile" });
      await actAsOwner(c);
      expect(await stateOf(c, accountId)).toEqual({
        enabled: null, numbers: [{ id: n, status: "testing" }], events: [] });
    }));

  it("refuses when the account holds ANOTHER non-released number, even with the index gone (mutation: drop the other-active-number check -> FAILS)", () =>
    withRollback(async (c) => {
      // The index makes this state impossible to create, so the test removes
      // it, inside this rollback, to prove the function's own check stands on
      // its own. While the index exists this branch cannot fire; it is there
      // so go_live never decides which number is THE number by itself.
      await c.query(`drop index public.${INDEX}`);
      const { accountId, numberIds: [n1, n2] } = await seed(c, "two", { profile: true, numbers: ["testing", "provisioned"] });
      await c.query("set local role service_role");
      const err = await goLive(c, accountId, n1!);
      expect(err).toMatchObject({ code: "P0001", message: "go_live: this account has another active number" });
      await actAsOwner(c);
      expect(await stateOf(c, accountId)).toEqual({
        enabled: false, numbers: byId([{ id: n1!, status: "testing" }, { id: n2!, status: "provisioned" }]), events: [] });
    }));

  it("refuses a missing actor: every event names who did it (mutation: drop the actor check -> two events with a null actor, FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, numberIds: [n] } = await seed(c, "noact", { profile: true, numbers: ["testing"] });
      await c.query("set local role service_role");
      const nul = await goLive(c, accountId, n!, null);
      const blank = await goLive(c, accountId, n!, "  ");
      expect([nul, blank]).toEqual([
        expect.objectContaining({ code: "22004", message: "go_live: an actor is required" }),
        expect.objectContaining({ code: "22004", message: "go_live: an actor is required" }),
      ]);
      await actAsOwner(c);
      expect(await stateOf(c, accountId)).toEqual({
        enabled: false, numbers: [{ id: n, status: "testing" }], events: [] });
    }));
});

describe("0063 phone_numbers_one_active_per_account: one account, one active number", () => {
  it("a second non-released number on one account is refused, 23505 naming the index (mutation: drop the index -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "dup", { profile: false, numbers: ["live"] });
      const err = await attempt(c,
        "insert into public.phone_numbers (account_id, e164) values ($1, $2)", [accountId, testPhoneNumber()]);
      expect(err).toMatchObject({ code: "23505", constraint: INDEX });
    }));

  it("bringing a released number back while another holds the slot is refused too (the Voice page's status write)", () =>
    withRollback(async (c) => {
      const { numberIds: [old] } = await seed(c, "unrel", { profile: false, numbers: ["released", "testing"] });
      const err = await attempt(c, "update public.phone_numbers set status = 'testing' where id = $1", [old]);
      expect(err).toMatchObject({ code: "23505", constraint: INDEX });
    }));

  it("a released number does not hold the slot: former numbers sit beside a new one (mutation: drop the where clause -> FAILS)", () =>
    withRollback(async (c) => {
      const { numbers } = await stateOf(c, (await seed(c, "free", {
        profile: false, numbers: ["released", "released", "provisioned"] })).accountId);
      expect(numbers.map((r: { status: string }) => r.status).sort()).toEqual(["provisioned", "released", "released"]);
      // Without this, the case above is green before apply too.
      const { rows } = await c.query("select to_regclass($1) is not null as present", [`public.${INDEX}`]);
      expect(rows).toEqual([{ present: true }]);
    }));
});

// ONE refused statement per withRollback: after the first, the transaction is
// aborted (25P02). Code AND message: if the function were executable, the
// invoker's UPDATE would be refused by 0020's TABLE grant instead, with a
// different message, so the message proves it is the FUNCTION grant.
describe("0063 go_live: refused, as each role would meet it", () => {
  it("a client session (no app_role claim, like a real client token) cannot call it: 42501 permission denied for function (mutation: grant execute to authenticated -> FAILS on the message)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_gl_test_client", sub: "user_gl_test" });
      await expect(c.query("select public.go_live(gen_random_uuid(), gen_random_uuid(), 'user_gl_test')"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for function go_live" });
    }));

  it("the agency's own session cannot call it either; go-live is serviceDb() behind goLiveAction's agency check: 42501", () =>
    withRollback(async (c) => {
      await actAs(c, { app_role: "agency_admin", sub: "user_gl_test" });
      await expect(c.query("select public.go_live(gen_random_uuid(), gen_random_uuid(), 'user_gl_test')"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for function go_live" });
    }));

  it("anon cannot call it: 42501 permission denied for function (mutation: drop anon from the revoke -> FAILS)", () =>
    withRollback(async (c) => {
      await c.query("set local role anon");
      await expect(c.query("select public.go_live(gen_random_uuid(), gen_random_uuid(), 'user_gl_test')"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for function go_live" });
    }));
});
