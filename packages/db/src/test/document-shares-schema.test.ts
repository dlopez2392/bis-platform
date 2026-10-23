import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { withRollback, actAs } from "./db";
import { TEST_ORG_ID_PREFIX } from "../org-id";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0085 (S-07 3b, spec 4.4; plan deviations 1, 4, 5, 11, 12): the share, its same-account keys, its
 * checks, who reads it (exactly who reads its document), that the client role writes nothing, the
 * claim (open, closed, the link's total cap answered as closed, the forms limiter's numbers per link and
 * address, the first open once), the
 * lock that makes "first" exactly once, and the timeline view. Its own seed, in
 * document-vault-rls.test.ts's shape.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_dsh_${RUN}`;
const ORG_B = `org_dshb_${RUN}`;
const SUB = { owner: `u_dsh_owner_${RUN}`, staff: `u_dsh_staff_${RUN}`, tech: `u_dsh_tech_${RUN}`, tech2: `u_dsh_tech2_${RUN}`, ownerB: `u_dsh_ownerb_${RUN}` } as const;
type Who = keyof typeof SUB | "agency";
const claims = (p: Who) =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_dsh_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const IP = "a".repeat(32);
const CLAIM = "public.claim_document_share_download(uuid, uuid, text, integer, integer, integer)";

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
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

/** A ready, clean version of `doc`, made current (the app's path is reserve, then the finish, then the scan). */
async function cleanVersion(c: Client, acct: string, doc: string): Promise<string> {
  const { rows: [r] } = await c.query<{ r: { version_id: string } }>(
    "select public.reserve_document_version($1, $2, 10, 'application/pdf', 'x.pdf', 'user_seed') as r", [acct, doc]);
  const v = r!.r.version_id;
  // 0079's document_versions_scan_coherent: a non-pending scan has its scanned_at (review F2).
  await c.query("update document_versions set status = 'ready', sha256 = repeat('a', 64), scan_status = 'clean', scanned_at = now() where id = $1", [v]);
  await c.query("update documents set current_version_id = $2 where id = $1", [doc, v]);
  return v;
}
const share = (c: Client, acct: string, doc: string, ver: string, o: { hash?: string; createdAt?: string; hours?: number } = {}) =>
  attempt<{ id: string }>(c,
    `insert into document_shares (account_id, document_id, version_id, token_hash, created_by, created_at, expires_at)
     values ($1, $2, $3, $4, 'user_seed', $5::timestamptz, $5::timestamptz + make_interval(hours => $6)) returning id`,
    [acct, doc, ver, o.hash ?? hex(32), o.createdAt ?? new Date().toISOString(), o.hours ?? 24]);
const claim = async (c: Client, acct: string, id: string, ip = IP, max = 5, windowSeconds = 600, linkMax = 100) =>
  (await c.query<{ r: { status: string; first?: boolean } }>(
    "select public.claim_document_share_download($1, $2, $3, $4, $5, $6) as r", [acct, id, ip, max, windowSeconds, linkMax])).rows[0]!.r;

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DSH Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DSH B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (who: string, name: string) => one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [acct, name, who]);
  const mine = await ct(u.tech, "Mine");
  const theirs = await ct(u.tech2, "Theirs");
  const d = (contact: string, ownersOnly: boolean, title: string) =>
    one(c, `insert into documents (account_id, contact_id, title, category, owners_only, source, created_by)
            values ($1,$2,$3,'insurance',$4,'upload','user_seed') returning id`, [acct, contact, title, ownersOnly]);
  const docs = { mine: await d(mine, false, "mine"), mineOwners: await d(mine, true, "mineOwners"), theirs: await d(theirs, false, "theirs") };
  const vers = { mine: await cleanVersion(c, acct, docs.mine), mineOwners: await cleanVersion(c, acct, docs.mineOwners), theirs: await cleanVersion(c, acct, docs.theirs) };
  const shares = {
    mine: (await share(c, acct, docs.mine, vers.mine)).rows[0]!.id,
    mineOwners: (await share(c, acct, docs.mineOwners, vers.mineOwners)).rows[0]!.id,
    theirs: (await share(c, acct, docs.theirs, vers.theirs)).rows[0]!.id,
  };
  return { acct, acctB, mine, docs, vers, shares };
}

describe("0085: the share's own rules (spec 4.4)", () => {
  it("lives exactly 24 hours (mutation: drop document_shares_expiry -> the 23-hour insert succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(share(c, s.acct, s.docs.mine, s.vers.mine, { hours: 23 })).rejects.toMatchObject({ code: "23514", constraint: "document_shares_expiry" });
    }));

  it("a revoke has both its time and its author, an open both its time and its count (mutations: drop document_shares_revoke_coherent; drop document_shares_opened_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, "update document_shares set revoked_at = now() where id = $1", [s.shares.mine]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_shares_revoke_coherent" });
      await expect(attempt(c, "update document_shares set first_opened_at = now() where id = $1", [s.shares.mine]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_shares_opened_coherent" });
    }));

  it("one row per token hash, and the hash is 64 lower-case hex (mutations: drop the unique key; drop the shape check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const h = hex(32);
      await share(c, s.acct, s.docs.mine, s.vers.mine, { hash: h });
      await expect(share(c, s.acct, s.docs.mine, s.vers.mine, { hash: h })).rejects.toMatchObject({ code: "23505", constraint: "document_shares_token_hash_key" });
      await expect(share(c, s.acct, s.docs.mine, s.vers.mine, { hash: h.toUpperCase().slice(0, 63) + "A" }))
        .rejects.toMatchObject({ code: "23514", constraint: "document_shares_token_hash_check" });
    }));

  it("a share names a document of ITS account and a version of THAT document (mutations: the document FK without account_id; the version FK on version_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(share(c, s.acctB, s.docs.mine, s.vers.mine)).rejects.toMatchObject({ code: "23503", constraint: "document_shares_document_fkey" });
      await expect(share(c, s.acct, s.docs.mine, s.vers.theirs)).rejects.toMatchObject({ code: "23503", constraint: "document_shares_version_fkey" });
    }));

  it("deleting the document deletes its shares and their downloads (mutations: no cascade on BOTH share FKs, document_fkey and version_fkey (one alone still cascades through the other path) -> the delete FAILS 23503; no cascade on document_share_downloads_share_fkey -> FAILS 23503)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await claim(c, s.acct, s.shares.mine)).status).toBe("ok");
      await c.query("delete from documents where id = $1", [s.docs.mine]);
      const { rows: [n] } = await c.query<{ s: string; d: string }>(
        "select (select count(*) from document_shares where id = $1)::text as s, (select count(*) from document_share_downloads where share_id = $1)::text as d", [s.shares.mine]);
      expect(n).toEqual({ s: "0", d: "0" });
    }));

  it("the teardown list deletes both tables before documents (spec 4.4; mutation: drop either name -> FAILS)", () => {
    const at = (t: string) => ACCOUNT_OWNED_TABLES.indexOf(t as (typeof ACCOUNT_OWNED_TABLES)[number]);
    expect(at("document_share_downloads")).toBeGreaterThan(-1);
    expect(at("document_share_downloads")).toBeLessThan(at("document_shares"));
    expect(at("document_shares")).toBeLessThan(at("documents"));
  });
});

describe("0085: who reads a share (spec 4.4, 6: exactly who reads its document)", () => {
  // The share table ALONE (no join to documents): a join would let the documents policies hide a row even
  // with document_shares_through_document dropped, and the case could not fail. Ids map to names here.
  const read = async (c: Client, who: Who, scope: string[], names: Record<string, string>) => {
    await actAs(c, claims(who));
    const { rows } = await c.query<{ document_id: string }>(
      "select document_id from document_shares where account_id = any($1::uuid[])", [scope]);
    await c.query("reset role");
    return rows.map((r) => names[r.document_id] ?? "unknown").sort();
  };
  // [who, the titles whose share they read, the mutation that fails the case]
  const cases: [Who, string[], string][] = [
    ["owner", ["mine", "mineOwners", "theirs"], "drop policy document_shares_member_read"],
    ["agency", ["mine", "mineOwners", "theirs"], "document_shares_member_read without app.is_agency()"],
    ["staff", ["mine", "theirs"], "drop policy document_shares_through_document"],
    ["tech", ["mine"], "drop policy document_shares_through_document"],
    ["tech2", ["theirs"], "drop policy document_shares_through_document"],
    // Two layers deep for another account (the share's tenant check AND its document's), so no single policy
    // mutation can fail this row; its mutation is the pair, said so (document-vault-rls.test.ts's precedent).
    ["ownerB", [], "member_read as using (true) AND through_document dropped, together"],
  ];
  it.each(cases)("%s reads %j (mutation: %s -> FAILS)", (who, want) =>
    withRollback(async (c) => {
      const s = await seed(c);
      const names = Object.fromEntries(Object.entries(s.docs).map(([k, id]) => [id, k]));
      expect(await read(c, who, [s.acct, s.acctB], names)).toEqual(want);
    }));

  it("the timeline view follows the same rules: Staff never see an Owners-only file's share (mutation: create the view without security_invoker -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("staff"));
      const { rows } = await c.query<{ title: string }>("select title from document_share_timeline where account_id = $1 order by 1", [s.acct]);
      expect(rows.map((r) => r.title)).toEqual(["mine", "theirs"]);
    }));
});

describe("0085: the client role writes nothing (spec 4.4)", () => {
  it("no INSERT, UPDATE or DELETE on either table for anon or authenticated, no SELECT on downloads, no EXECUTE on the claim; service_role holds them; the claim is SECURITY DEFINER with search_path pg_catalog, pg_temp (0096) (mutations: grant insert on document_shares to authenticated; grant execute to authenticated; grant execute to anon; security invoker; drop the set search_path -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ x: string }>(`
        select r || ' ' || t || ' ' || p || ' ' || has_table_privilege(r, 'public.' || t, p)::text as x
          from (values ('anon'), ('authenticated'), ('service_role')) a(r)
         cross join (values ('document_shares'), ('document_share_downloads')) b(t)
         cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) d(p) order by 1`);
      const has = (r: string, t: string, p: string) => rows.some((x) => x.x === `${r} ${t} ${p} true`);
      for (const r of ["anon", "authenticated"]) for (const t of ["document_shares", "document_share_downloads"]) for (const p of ["INSERT", "UPDATE", "DELETE"]) expect(has(r, t, p)).toBe(false);
      expect([has("authenticated", "document_shares", "SELECT"), has("authenticated", "document_share_downloads", "SELECT"), has("anon", "document_shares", "SELECT")]).toEqual([true, false, false]);
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(has("service_role", "document_shares", p) && has("service_role", "document_share_downloads", p)).toBe(true);
      const { rows: fx } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${CLAIM}', 'execute') as ok
           from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(fx).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: false }, { r: "service_role", ok: true }]);
      // Definer (it reads and writes past the caller's RLS for the service role) with search_path pinned to
      // pg_catalog, pg_temp (0085 set '', 0096 put pg_temp last), as document-space-used.test.ts pins 0078's function.
      const { rows: [f] } = await c.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select prosecdef, proconfig from pg_proc where oid = '${CLAIM}'::regprocedure`);
      expect(f).toEqual({ prosecdef: true, proconfig: ['search_path=pg_catalog, pg_temp'] });
    }));

  // Two layers deep: no INSERT grant AND no insert policy, both answering 42501. A grant alone leaves RLS
  // refusing with the same code (probe f, run on the replica), so the mutation is the pair, said so.
  it("a signed-in Owner's insert is refused (mutation: grant insert AND an insert policy with check (true), together -> the insert succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("owner"));
      await expect(attempt(c,
        "insert into document_shares (account_id, document_id, version_id, token_hash, created_by, created_at, expires_at) values ($1,$2,$3,$4,'x',now(),now() + interval '24 hours')",
        [s.acct, s.docs.mine, s.vers.mine, hex(32)])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0085: claim_document_share_download (spec 4.2, 4.3; plan deviations 1, 5)", () => {
  it("the first claim is the first open; the next is not, and both count (mutation: return first = true always -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, s.acct, s.shares.mine)).toEqual({ status: "ok", first: true });
      const { rows: [a] } = await c.query<{ f: string; n: number }>("select first_opened_at::text as f, open_count as n from document_shares where id = $1", [s.shares.mine]);
      expect(await claim(c, s.acct, s.shares.mine)).toEqual({ status: "ok", first: false });
      const { rows: [b] } = await c.query<{ f: string; n: number }>("select first_opened_at::text as f, open_count as n from document_shares where id = $1", [s.shares.mine]);
      expect([a!.n, b!.n, b!.f === a!.f, a!.f === null]).toEqual([1, 2, true, false]);
    }));

  it("refuses a revoked, an expired, a trashed and a not-clean link as closed, writing nothing (mutations: drop any one of the four checks -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const fresh = async (doc: string, ver: string, o = {}) => (await share(c, s.acct, doc, ver, o)).rows[0]!.id;
      const revoked = await fresh(s.docs.mine, s.vers.mine);
      await c.query("update document_shares set revoked_at = now(), revoked_by = 'u' where id = $1", [revoked]);
      const expired = await fresh(s.docs.mine, s.vers.mine, { createdAt: new Date(Date.now() - 25 * 3_600_000).toISOString() });
      await c.query("update documents set deleted_at = now(), deleted_by = 'u' where id = $1", [s.docs.theirs]);
      await c.query("update document_versions set scan_status = 'infected' where id = $1", [s.vers.mineOwners]);
      const answers = [await claim(c, s.acct, revoked), await claim(c, s.acct, expired), await claim(c, s.acct, s.shares.theirs), await claim(c, s.acct, s.shares.mineOwners)];
      expect(answers).toEqual([{ status: "closed" }, { status: "closed" }, { status: "closed" }, { status: "closed" }]);
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from document_share_downloads where account_id = $1", [s.acct]);
      expect(n!.n).toBe("0");
    }));

  it("another account's id never finds the share (mutation: lock the share by id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, s.acctB, s.shares.mine)).toEqual({ status: "not_found" });
    }));

  it("counts this link and this address in the window: at the limit it refuses and records nothing; another address still downloads (mutations: count by share alone; count by address alone; >= replaced by > -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const other = await (await share(c, s.acct, s.docs.mine, s.vers.mine)).rows[0]!.id;
      expect((await claim(c, s.acct, s.shares.mine, IP, 2)).status).toBe("ok");
      expect((await claim(c, s.acct, other, IP, 2)).status).toBe("ok");
      expect((await claim(c, s.acct, s.shares.mine, IP, 2)).status).toBe("ok");
      expect(await claim(c, s.acct, s.shares.mine, IP, 2)).toEqual({ status: "rate_limited" });
      expect((await claim(c, s.acct, s.shares.mine, "b".repeat(32), 2)).status).toBe("ok");
      const { rows: [n] } = await c.query<{ n: number }>("select open_count as n from document_shares where id = $1", [s.shares.mine]);
      expect(n!.n).toBe(3);
    }));

  // Ruling O3, with the orchestrator's addition: the cap applies to every visitor and waiting never helps,
  // so a link past it is CLOSED (the route's uniform 410), not rate_limited (a 429 that invites a retry).
  it("a link is downloaded at most p_link_max times in all, from any address; past it the claim answers closed and records nothing (ruling O3; mutations: drop the open_count cap line; answer rate_limited at the cap -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await claim(c, s.acct, s.shares.mine, "1".repeat(32), 5, 600, 2)).status).toBe("ok");
      expect((await claim(c, s.acct, s.shares.mine, "2".repeat(32), 5, 600, 2)).status).toBe("ok");
      expect(await claim(c, s.acct, s.shares.mine, "3".repeat(32), 5, 600, 2)).toEqual({ status: "closed" });
      const { rows: [n] } = await c.query<{ n: number; d: string }>(
        "select open_count as n, (select count(*) from document_share_downloads where share_id = $1)::text as d from document_shares where id = $1", [s.shares.mine]);
      expect(n).toEqual({ n: 2, d: "2" });
    }));

  it("a download older than the window no longer counts (mutation: ignore created_at -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await claim(c, s.acct, s.shares.mine, IP, 1)).status).toBe("ok");
      await c.query("update document_share_downloads set created_at = now() - interval '11 minutes' where share_id = $1", [s.shares.mine]);
      expect((await claim(c, s.acct, s.shares.mine, IP, 1, 600)).status).toBe("ok");
    }));

  // A limit below 1 would switch a limit off (a window of 0 seconds counts nothing), so the claim refuses it.
  // [the argument, p_max, p_window_seconds, p_link_max]
  const badLimits: [string, number, number, number][] = [
    ["p_max", 0, 600, 100],
    ["p_window_seconds", 5, 0, 100],
    ["p_link_max", 5, 600, 0],
  ];
  it.each(badLimits)("%s below 1 raises 22023 (mutation: drop that argument's < 1 check -> FAILS)", (_arg, max, windowSeconds, linkMax) =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, "select public.claim_document_share_download($1, $2, $3, $4, $5, $6)",
        [s.acct, s.shares.mine, IP, max, windowSeconds, linkMax])).rejects.toMatchObject({ code: "22023" });
    }));

  it("an address hash is 32 lower-case hex (mutation: drop document_share_downloads_ip_hash_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, "select public.claim_document_share_download($1, $2, 'not-a-hash', 5, 600, 100)", [s.acct, s.shares.mine]))
        .rejects.toMatchObject({ code: "23514" });
    }));
});

describe("0085: the first open is decided under the share's lock (spec 6; review F1)", () => {
  // An OUTCOME test, not a lock-timeout test: without `for update`, session B would still block (on the
  // row update and the downloads FK's key-share lock) but would have read the share and the window count
  // BEFORE A committed, so it answers { ok, first: true } where the lock makes it see A's open.
  const conn = () => new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
  /** Polls until `pid` is waiting on a lock; throws after ~5 s so a run that never blocks fails loudly. */
  async function waitUntilBlocked(watch: Client, pid: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const { rows } = await watch.query<{ w: string | null }>("select wait_event_type as w from pg_stat_activity where pid = $1", [pid]);
      if (rows[0]?.w === "Lock") return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`session ${pid} never waited on a lock`);
  }
  const SHARE_SQL = `insert into document_shares (account_id, document_id, version_id, token_hash, created_by, created_at, expires_at)
                     values ($1, $2, $3, $4, 'user_lock', now(), now() + interval '24 hours') returning id`;

  // [address limit, what the waiting claim must answer, the mutation that fails it]
  const cases: [number, Record<string, unknown>, string][] = [
    [1, { status: "rate_limited" }, "drop `for update` -> B counted 0 downloads -> { ok, first: true } -> FAILS"],
    [5, { status: "ok", first: false }, "drop `for update` -> B read first_opened_at unset -> first: true -> FAILS"],
  ];
  it.each(cases)("with an address limit of %i, a claim that waited for another answers %j (mutation: %s)", async (max, want) => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = await one(seedC, "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'DSH Lock') returning id", [agency!.id, `${TEST_ORG_ID_PREFIX}dshlock${max}_${RUN}`]);
      const contact = await one(seedC, "insert into contacts (account_id, first_name) values ($1,'Lock') returning id", [acct]);
      const doc = await one(seedC, "insert into documents (account_id, contact_id, title, category, source, created_by) values ($1,$2,'Lock','other','upload','user_lock') returning id", [acct, contact]);
      const ver = await cleanVersion(seedC, acct, doc);
      const id = await one(seedC, SHARE_SQL, [acct, doc, ver, hex(32)]);
      const { rows: [pb] } = await b.query<{ pid: number }>("select pg_backend_pid() as pid");

      await a.query("begin");
      expect(await claim(a, acct, id, IP, max)).toEqual({ status: "ok", first: true });
      const waiting = claim(b, acct, id, IP, max); // no lock_timeout: B waits as long as A holds the row
      await waitUntilBlocked(seedC, pb!.pid);
      await a.query("commit");
      expect(await waiting).toEqual(want);
    } finally {
      await a.query("rollback").catch(() => {});
      if (acct) {
        await seedC.query("delete from documents where account_id = $1", [acct]); // shares and downloads cascade
        await seedC.query("delete from contacts where account_id = $1", [acct]);
        await seedC.query("delete from accounts where id = $1", [acct]);
      }
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});
