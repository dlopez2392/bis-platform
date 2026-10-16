import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0081 (S-07 2c, spec 5.1, 5.3; plan deviations 1, 3-5): the account's required list and its CHECK,
 * the skips table (one ACTIVE skip per contact and category, the un-skip kept on the row), who reads
 * the skips, and the definer read's states and its two fences. Its own seed, in the vault RLS suite's
 * shape (document-vault-rls.test.ts:22-58).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_drq2_${RUN}`;
const ORG_B = `org_drq2b_${RUN}`;
/** I2: an account whose client access is OFF (app.current_account_id() is NULL for its members, 0008:13-18). */
const ORG_OFF = `org_drq2off_${RUN}`;
const SUB = {
  owner: `u_rq_owner_${RUN}`, staff: `u_rq_staff_${RUN}`, tech: `u_rq_tech_${RUN}`, ownerB: `u_rq_ownerb_${RUN}`, ownerOff: `u_rq_owneroff_${RUN}`,
} as const;
const AGENCY_SUB = `u_rq_agency_${RUN}`;
const TODAY = "2026-10-16";
const YESTERDAY = "2026-10-15";

async function attempt<T extends object = Record<string, unknown>>(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query<T>(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
async function one(c: Client, sql: string, args: unknown[]): Promise<string> {
  return (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
}

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'RQ Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'RQ B',true) returning id", [agency!.id, ORG_B]);
  const acctOff = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'RQ Off',false) returning id", [agency!.id, ORG_OFF]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    "insert into memberships (user_id, scope, account_id, role) values ($1,'account',$5,'owner'), ($2,'account',$5,'staff'), ($3,'account',$5,'technician'), ($4,'account',$6,'owner'), ($7,'account',$8,'owner')",
    [u.owner, u.staff, u.tech, u.ownerB, acct, acctB, u.ownerOff, acctOff]);
  const ana = await one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,'Ana',$2) returning id", [acct, u.tech]);
  const bo = await one(c, "insert into contacts (account_id, first_name) values ($1,'Bo') returning id", [acct]);
  const bea = await one(c, "insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [acctB]);
  const cy = await one(c, "insert into contacts (account_id, first_name) values ($1,'Cy') returning id", [acctOff]);
  const casa = await one(c, "insert into client_groups (account_id, kind, name) values ($1,'household','Casa Ana') returning id", [acct]);
  await c.query("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,true)", [acct, casa, ana]);
  return { acct, acctB, acctOff, ana, bo, bea, cy, casa };
}

const setList = (c: Client, acct: string, list: string) =>
  attempt(c, "update accounts set required_document_categories = $2::text[] where id = $1", [acct, list]);

type FileOpts = {
  contact_id?: string | null; client_group_id?: string | null; category: string; expires_on?: string | null;
  verdict?: "clean" | "pending" | "infected" | "unscannable" | "uploading"; trashed?: boolean; owners_only?: boolean;
};
/** A document with ONE version, taken as far as `verdict` says, through 0077/0079's own functions. */
async function file(c: Client, acct: string, o: FileOpts): Promise<string> {
  const doc = await one(c,
    `insert into documents (account_id, contact_id, client_group_id, title, category, expires_on, owners_only, source, created_by)
     values ($1,$2,$3,'F',$4,$5::date,$6,'upload','user_seed') returning id`,
    [acct, o.contact_id ?? null, o.client_group_id ?? null, o.category, o.expires_on ?? null, o.owners_only ?? false]);
  const { rows: [r] } = await c.query<{ r: { version_id: string } }>(
    "select public.reserve_document_version($1, $2, 10, 'application/pdf', 'a.pdf', 'user_seed') as r", [acct, doc]);
  const v = r!.r.version_id;
  const verdict = o.verdict ?? "clean";
  if (verdict !== "uploading") {
    await c.query("select public.mark_document_version_ready($1, $2, $3, 10, $4)", [acct, doc, v, "a".repeat(64)]);
    if (verdict !== "pending") {
      await c.query("select public.record_document_scan($1, $2, $3, $4)", [acct, v, verdict, verdict === "infected" ? "Eicar-Test-Signature" : null]);
    }
  }
  if (o.trashed) await c.query("update documents set deleted_at = now(), deleted_by = 'user_seed' where id = $1", [doc]);
  return doc;
}
const skip = (c: Client, acct: string, contact: string, category: string, by = "user_seed") =>
  attempt<{ id: string }>(c, "insert into document_requirement_skips (account_id, contact_id, category, skipped_by) values ($1,$2,$3,$4) returning id",
    [acct, contact, category, by]);
const states = async (c: Client, acct: string, contact: string, today = TODAY) =>
  (await attempt<{ category: string; state: string }>(c, "select category, state from public.document_requirements($1, $2, $3::date)", [acct, contact, today]))
    .rows.map((r) => [r.category, r.state]);

describe("0081: the account's required list (spec 5.1; D8)", () => {
  it("is empty by default, and an empty list answers no rows (mutation: a non-empty default -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [a] } = await c.query<{ l: string[] }>("select required_document_categories as l from accounts where id = $1", [s.acct]);
      expect(a!.l).toEqual([]);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await states(c, s.acct, s.ana)).toEqual([]);
    }));

  it("accepts the eight requirable keys in any order; refuses Other, an unknown key, a duplicate, a NULL element and a 2-D array (mutations: add 'other' to app.required_document_categories_ok, drop its count(distinct) clause, or drop its array_ndims clause -> FAILS; its NULL-element clause is a belt behind <@, which already refuses a NULL element, so dropping it alone cannot fail here)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{insurance,id,contract,estimate,invoice,photo,permit,warranty}");
      for (const bad of ["{other}", "{receipt}", "{id,id}", "{insurance,NULL}", "{{id},{photo}}"]) {
        await expect(setList(c, s.acct, bad), bad).rejects.toMatchObject({ code: "23514", constraint: "accounts_required_document_categories_check" });
      }
    }));
});

describe("0081: document_requirement_skips (spec 5.1; deviation 1)", () => {
  it("one ACTIVE skip per contact and category; after an un-skip the same category can be skipped again (mutation: a full unique on (contact_id, category), or drop the partial index -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const first = (await skip(c, s.acct, s.ana, "insurance")).rows[0]!.id;
      await expect(skip(c, s.acct, s.ana, "insurance")).rejects.toMatchObject({ code: "23505", constraint: "document_requirement_skips_active" });
      await c.query("update document_requirement_skips set unskipped_at = created_at + interval '1 second', unskipped_by = 'user_seed' where id = $1", [first]);
      await skip(c, s.acct, s.ana, "insurance");
      await skip(c, s.acct, s.bo, "insurance");
    }));

  it("an un-skip names who and comes after the skip; Other and unknown keys are refused; a blank skipped_by is refused; another account's contact is refused (mutations: drop unskip_coherent, unskip_after, the category check, skipped_by_check, unskipped_by_check, or the composite FK -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = (await skip(c, s.acct, s.ana, "permit")).rows[0]!.id;
      await expect(attempt(c, "update document_requirement_skips set unskipped_at = created_at + interval '1 second' where id = $1", [id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requirement_skips_unskip_coherent" });
      await expect(attempt(c, "update document_requirement_skips set unskipped_at = created_at, unskipped_by = 'x' where id = $1", [id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requirement_skips_unskip_after" });
      // N5: a blank un-skipper is refused like a blank skipper.
      await expect(attempt(c, "update document_requirement_skips set unskipped_at = created_at + interval '1 second', unskipped_by = '  ' where id = $1", [id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requirement_skips_unskipped_by_check" });
      await expect(skip(c, s.acct, s.ana, "other")).rejects.toMatchObject({ code: "23514", constraint: "document_requirement_skips_category_check" });
      // M1: a VALID category with a blank author, so only skipped_by_check can refuse it.
      await expect(skip(c, s.acct, s.ana, "id", "  ")).rejects.toMatchObject({ code: "23514", constraint: "document_requirement_skips_skipped_by_check" });
      await expect(skip(c, s.acct, s.bea, "permit")).rejects.toMatchObject({ code: "23503", constraint: "document_requirement_skips_contact_fkey" });
    }));

  it("deleting the contact deletes its skips (mutation: on delete no action -> the delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await skip(c, s.acct, s.bo, "permit");
      await c.query("delete from contacts where id = $1", [s.bo]);
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from document_requirement_skips where contact_id = $1", [s.bo]);
      expect(n!.n).toBe("0");
    }));

  // I1: the skips table ALONE. A join to contacts would let contacts' own RLS do the fencing, and the case
  // stayed green in review with technician_scope dropped AND member_read set to true.
  it.each([
    ["owner", ["ana", "bo"]], ["staff", ["ana", "bo"]], ["tech", ["ana"]], ["ownerB", []], ["agency", ["ana", "bo"]],
  ] as const)("%s reads the skips of %j (mutations: drop the technician_scope policy -> tech reads Bo's -> FAILS; member_read using (true) -> ownerB reads both -> FAILS; drop app.is_agency() from member_read, or drop the agency branch of technician_scope -> the agency reads none -> FAILS)", (who, want) =>
    withRollback(async (c) => {
      const s = await seed(c);
      await skip(c, s.acct, s.ana, "permit");
      await skip(c, s.acct, s.bo, "permit");
      // M10's agency path, as the fences case acts it: no org in the token.
      await actAs(c, who === "agency" ? { app_role: "agency_admin", sub: AGENCY_SUB } : { org_id: who === "ownerB" ? ORG_B : ORG, sub: SUB[who] });
      const { rows } = await c.query<{ contact_id: string }>("select k.contact_id from document_requirement_skips k");
      const ids: Record<string, string> = { ana: s.ana, bo: s.bo };
      expect(rows.map((r) => r.contact_id).sort()).toEqual(want.map((k) => ids[k]!).sort());
    }));

  it("unskip_document_requirement stamps the DATABASE's now() once, answers it, and answers NULL for another account's row or an inactive one; only service_role may run it (M6; mutations: drop 'unskipped_at is null', drop the account filter, or grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      // A transaction's now() is constant, so the skip is back-dated: unskip_after needs unskipped_at > created_at.
      const k = await one(c, "insert into document_requirement_skips (account_id, contact_id, category, skipped_by, created_at) values ($1,$2,'permit','user_seed', now() - interval '1 minute') returning id", [s.acct, s.ana]);
      const run = (acct: string) => attempt<{ at: string | null }>(c, "select public.unskip_document_requirement($1, $2, 'user_bo') as at", [acct, k]);
      expect((await run(s.acctB)).rows[0]!.at).toBeNull();
      const { rows: [now] } = await c.query<{ t: string }>("select now()::text as t");
      const { rows: [first] } = await attempt<{ at: string }>(c, "select public.unskip_document_requirement($1, $2, 'user_bo')::text as at", [s.acct, k]);
      expect(first!.at).toBe(now!.t);
      expect((await run(s.acct)).rows[0]!.at).toBeNull();
      const { rows: [row] } = await c.query<{ by: string }>("select unskipped_by as by from document_requirement_skips where id = $1", [k]);
      expect(row!.by).toBe("user_bo");
      await expect(attempt(c, "select public.unskip_document_requirement($1, null, 'x')", [s.acct])).rejects.toMatchObject({ code: "22004" });
      const { rows: [g] } = await c.query<{ auth: boolean; svc: boolean }>(
        "select has_function_privilege('authenticated', 'public.unskip_document_requirement(uuid, uuid, text)', 'EXECUTE') as auth, has_function_privilege('service_role', 'public.unskip_document_requirement(uuid, uuid, text)', 'EXECUTE') as svc");
      expect(g).toEqual({ auth: false, svc: true });
    }));

  it("the client role writes nothing (mutation: grant insert, update or delete to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = (await skip(c, s.acct, s.ana, "permit")).rows[0]!.id;
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      await expect(attempt(c, "insert into document_requirement_skips (account_id, contact_id, category, skipped_by) values ($1,$2,'insurance','x')", [s.acct, s.ana]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "update document_requirement_skips set unskipped_at = now(), unskipped_by = 'x' where id = $1", [id])).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "delete from document_requirement_skips where id = $1", [id])).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "update accounts set required_document_categories = '{insurance}' where id = $1", [s.acct])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0081: document_requirements, what counts (spec 5.3; D4, D7, D10; deviations 3-5)", () => {
  it("every state: a group's file meets its member's requirement; a trashed, an infected, an unscannable and an uploading file meet nothing; expiry on TODAY still counts (mutations: '>' for '>=', drop the group branch, drop deleted_at, drop scan_status = 'clean', accept 'unscannable' as clean, drop the skip check -> FAILS; the rows are compared in the stored order, but dropping order by req.ord does not fail it: the plan keeps req's order without it)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{id,contract,photo,permit,insurance,warranty}");
      await file(c, s.acct, { contact_id: s.ana, category: "id", expires_on: YESTERDAY });
      await file(c, s.acct, { contact_id: s.ana, category: "contract", trashed: true });
      await file(c, s.acct, { contact_id: s.ana, category: "contract", verdict: "infected" });
      await file(c, s.acct, { contact_id: s.ana, category: "contract", verdict: "unscannable" });
      await file(c, s.acct, { contact_id: s.ana, category: "contract", verdict: "uploading" });
      await file(c, s.acct, { contact_id: s.ana, category: "photo" });
      await skip(c, s.acct, s.ana, "photo");
      await file(c, s.acct, { client_group_id: s.casa, category: "permit" });
      await file(c, s.acct, { contact_id: s.ana, category: "insurance", expires_on: TODAY });
      await file(c, s.acct, { contact_id: s.ana, category: "warranty", verdict: "pending" });
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await states(c, s.acct, s.ana)).toEqual([
        ["id", "expired"], ["contract", "missing"], ["photo", "skipped"], ["permit", "met"], ["insurance", "met"], ["warranty", "checking"],
      ]);
      // Bo shares nothing with Ana: Casa's permit is not his.
      expect(await states(c, s.acct, s.bo)).toEqual([
        ["id", "missing"], ["contract", "missing"], ["photo", "missing"], ["permit", "missing"], ["insurance", "missing"], ["warranty", "missing"],
      ]);
    }));

  it("D4: an unexpired copy beside an expired one is met; an expired one beside a pending upload reads checking; an un-skipped category counts again (mutations: newest-file-decides, 'expired' before 'checking', ignore unskipped_at -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{id,insurance,permit}");
      await file(c, s.acct, { contact_id: s.ana, category: "id", expires_on: YESTERDAY });
      await file(c, s.acct, { contact_id: s.ana, category: "id", expires_on: null });
      await file(c, s.acct, { contact_id: s.ana, category: "insurance", expires_on: YESTERDAY });
      await file(c, s.acct, { contact_id: s.ana, category: "insurance", verdict: "pending" });
      const k = (await skip(c, s.acct, s.ana, "permit")).rows[0]!.id;
      await c.query("update document_requirement_skips set unskipped_at = created_at + interval '1 second', unskipped_by = 'user_seed' where id = $1", [k]);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await states(c, s.acct, s.ana)).toEqual([["id", "met"], ["insurance", "checking"], ["permit", "missing"]]);
    }));

  it("D7: an Owners-only file meets the requirement for Staff, who cannot read the file itself (mutation: security invoker -> Staff reads missing -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{insurance}");
      await file(c, s.acct, { contact_id: s.ana, category: "insurance", owners_only: true });
      await actAs(c, { org_id: ORG, sub: SUB.staff });
      const { rows: [seen] } = await c.query<{ n: string }>("select count(*)::text as n from documents where contact_id = $1", [s.ana]);
      expect(seen!.n).toBe("0");
      expect(await states(c, s.acct, s.ana)).toEqual([["insurance", "met"]]);
    }));

  // Which mutation each refusal catches (I2): dropping the ACCOUNT guard is caught ONLY by the Owner of an
  // account whose client access is OFF (app.current_account_id() is NULL for them, but app.account_role still
  // answers 'owner', so sees_all_customers would let them through). ownerB is refused by BOTH guards, so it
  // catches neither alone. Dropping the CONTACT guard is caught by the Technician reading Bo.
  it("its fences: an Owner of an account with client access OFF, another account's member, and a Technician for a customer not theirs get 42501; the agency reads every customer; a null argument 22004; only authenticated may run it (mutations: drop the account guard -> ownerOff reads -> FAILS; drop the contact guard -> tech reads Bo -> FAILS; grant execute to anon -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{insurance}");
      const { rows: [g] } = await c.query<{ anon: boolean; auth: boolean }>(
        "select has_function_privilege('anon', 'public.document_requirements(uuid, uuid, date)', 'EXECUTE') as anon, has_function_privilege('authenticated', 'public.document_requirements(uuid, uuid, date)', 'EXECUTE') as auth");
      expect(g).toEqual({ anon: false, auth: true });
      await c.query("update accounts set required_document_categories = '{insurance}' where id = $1", [s.acctOff]);
      await actAs(c, { org_id: ORG_OFF, sub: SUB.ownerOff });
      await expect(states(c, s.acctOff, s.cy)).rejects.toMatchObject({ code: "42501" });
      await actAs(c, { org_id: ORG_B, sub: SUB.ownerB });
      await expect(states(c, s.acct, s.ana)).rejects.toMatchObject({ code: "42501" });
      // M10: the agency path (app.is_agency(); no org in the token) reads any customer of any account.
      await actAs(c, { app_role: "agency_admin", sub: AGENCY_SUB });
      expect(await states(c, s.acct, s.bo)).toEqual([["insurance", "missing"]]);
      expect(await states(c, s.acctOff, s.cy)).toEqual([["insurance", "missing"]]);
      await actAs(c, { org_id: ORG, sub: SUB.tech });
      expect(await states(c, s.acct, s.ana)).toEqual([["insurance", "missing"]]);
      await expect(states(c, s.acct, s.bo)).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "select * from public.document_requirements($1, null, $2::date)", [s.acct, TODAY])).rejects.toMatchObject({ code: "22004" });
      await actAs(c, { org_id: ORG, sub: SUB.staff });
      expect(await states(c, s.acct, s.bo)).toEqual([["insurance", "missing"]]);
    }));
});
