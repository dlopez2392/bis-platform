import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * V3 (spec section 3.4): a document is visible to whoever sees its record (a Technician only through
 * a customer assigned to them, or that customer's household or business), and an Owners-only
 * document only to an Owner or the agency. Versions follow their document. Its own seed: one
 * account with an Owner, Staff, two Technicians, a member with no membership, a second account.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_dvr_${RUN}`;
const ORG_B = `org_dvrb_${RUN}`;
const SUB = {
  owner: `u_dv_owner_${RUN}`, staff: `u_dv_staff_${RUN}`, tech: `u_dv_tech_${RUN}`, tech2: `u_dv_tech2_${RUN}`,
  none: `u_dv_none_${RUN}`, ownerB: `u_dv_ownerb_${RUN}`,
} as const;
type Who = keyof typeof SUB | "agency";
const claims = (p: Who) =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_dv_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DVR Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DVR B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (who: string | null, name: string) => one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [acct, name, who]);
  const mine = await ct(u.tech, "Mine");
  const theirs = await ct(u.tech2, "Theirs");
  const g = (name: string) => one("insert into client_groups (account_id, kind, name) values ($1,'household',$2) returning id", [acct, name]);
  const casaMine = await g("Casa Mine");
  const casaTheirs = await g("Casa Theirs");
  await c.query("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,true), ($1,$4,$5,true)",
    [acct, casaMine, mine, casaTheirs, theirs]);
  const d = (owner: { contact_id?: string; client_group_id?: string }, ownersOnly: boolean, title: string) =>
    one(`insert into documents (account_id, contact_id, client_group_id, title, category, owners_only, source, created_by)
         values ($1,$2,$3,$4,'other',$5,'upload','user_seed') returning id`,
      [acct, owner.contact_id ?? null, owner.client_group_id ?? null, title, ownersOnly]);
  const docs = {
    mine: await d({ contact_id: mine }, false, "mine"),
    mineOwners: await d({ contact_id: mine }, true, "mineOwners"),
    theirs: await d({ contact_id: theirs }, false, "theirs"),
    casaMine: await d({ client_group_id: casaMine }, false, "casaMine"),
    casaMineOwners: await d({ client_group_id: casaMine }, true, "casaMineOwners"),
    casaTheirs: await d({ client_group_id: casaTheirs }, false, "casaTheirs"),
  };
  // One uploading version per document (the reserve function as the owner; service_role bypasses RLS in the app).
  for (const id of Object.values(docs)) {
    await c.query("select public.reserve_document_version($1, $2, 10, 'application/pdf', 'x.pdf', 'user_seed')", [acct, id]);
  }
  return { acct, acctB, docs };
}

// The agency legitimately reads every account, so its reads are confined to this seed's two accounts: on a shared
// stack a concurrent suite's COMMITTED documents would otherwise land in the agency's list. Every other caller
// reads unfiltered, which is strictly stronger (a leak from any account at all shows).
type Scope = string[] | null;
const titles = async (c: Client, scope: Scope) =>
  (await c.query<{ title: string }>(
    "select title from documents where $1::uuid[] is null or account_id = any($1::uuid[]) order by title", [scope]))
    .rows.map((r) => r.title);
const versionDocs = async (c: Client, scope: Scope) =>
  (await c.query<{ title: string }>(
    `select d.title from document_versions v join documents d on d.id = v.document_id
      where $1::uuid[] is null or v.account_id = any($1::uuid[]) order by 1`, [scope])).rows.map((r) => r.title);
const versionCount = async (c: Client, scope: Scope) =>
  Number((await c.query<{ n: string }>(
    "select count(*)::text as n from document_versions where $1::uuid[] is null or account_id = any($1::uuid[])",
    [scope])).rows[0]!.n);

const ALL = ["casaMine", "casaMineOwners", "casaTheirs", "mine", "mineOwners", "theirs"];
const TEAM = ["casaMine", "casaTheirs", "mine", "theirs"];

describe("V3: who sees which document, on both tables", () => {
  // [who, what they see, the documents-policy mutation that fails the documents case, the one that fails the
  // versions case]. Each named mutation was run on the replica and fails exactly that case by name. The versions
  // layer is two policies deep (its own tenant check AND "through its document"), so for ownerB no single
  // version-policy mutation can fail the case; its mutation is the pair, said so.
  const cases: [Who, string[], string, string][] = [
    ["owner", ALL, "drop policy documents_member_read", "drop policy document_versions_member_read"],
    ["agency", ALL, "is_account_owner without the is_agency branch", "document_versions_member_read without the is_agency branch"],
    ["staff", TEAM, "drop policy documents_owners_only", "drop policy document_versions_through_document"],
    ["tech", ["casaMine", "mine"], "drop policy documents_technician_scope", "drop policy document_versions_through_document"],
    ["tech2", ["casaTheirs", "theirs"], "drop policy documents_technician_scope", "drop policy document_versions_through_document"],
    ["none", [], "drop policy documents_technician_scope (the tenant policy alone admits a member-less login of the account)",
      "drop policy document_versions_through_document"],
    ["ownerB", [], "documents_member_read using (true), no account check",
      "document_versions_member_read using (true) AND drop policy document_versions_through_document"],
  ];
  it.each(cases)("%s sees exactly %j (mutation: %s -> FAILS)", (who, expected) => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claims(who));
    expect(await titles(c, who === "agency" ? [s.acct, s.acctB] : null)).toEqual(expected);
  }));
  it.each(cases.map(([who, expected, , versionMutation]) => [who, expected, versionMutation] as const))(
    "%s reaches exactly the versions of %j (mutation: %s -> FAILS)", (who, expected) =>
      withRollback(async (c) => {
        const s = await seed(c);
        const scope = who === "agency" ? [s.acct, s.acctB] : null;
        await actAs(c, claims(who));
        // documents' own RLS also applies to the join, so read versions alone too: the version policy must hold by itself.
        expect(await versionDocs(c, scope)).toEqual(expected);
        expect(await versionCount(c, scope)).toBe(expected.length);
      }));
});
