import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0082 (S-06 part 1, spec "Data model"; plan G2, G3, G12, G13): the reply token and the account's mode,
 * the server-written inbound_emails table and who reads it, the inbound_email method, the staff Undo
 * over it, and unfile_inbound_email. Its own seed, in the vault RLS suite's shape.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_ie_${RUN}`;
const ORG_B = `org_ieb_${RUN}`;
const SUB = { owner: `u_ie_owner_${RUN}`, staff: `u_ie_staff_${RUN}`, tech: `u_ie_tech_${RUN}`, ownerB: `u_ie_ownerb_${RUN}` } as const;
const TOKEN_A = "0123456789abcdef01234567";
const TOKEN_B = "89abcdef0123456789abcdef";

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? "?"; } };
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'IE Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'IE B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values ($1,'account',$5,'owner'), ($2,'account',$5,'staff'), ($3,'account',$5,'technician'), ($4,'account',$6,'owner')`,
    [u.owner, u.staff, u.tech, u.ownerB, acct, acctB]);
  const mine = await one(c, "insert into contacts (account_id, first_name, email, assigned_to) values ($1,'Ana','ana@example.com',$2) returning id", [acct, u.tech]);
  const other = await one(c, "insert into contacts (account_id, first_name, email) values ($1,'Luis','luis@example.com') returning id", [acct]);
  const convMine = await one(c, "insert into conversations (account_id, contact_id, reply_token) values ($1,$2,$3) returning id", [acct, mine, TOKEN_A]);
  const convOther = await one(c, "insert into conversations (account_id, contact_id) values ($1,$2) returning id", [acct, other]);
  const row = (conv: string, status: string, reason: string | null, pid: string) => one(c,
    `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, text, status, hold_reason, received_at)
     values ($1,$2,$3,'x@example.com','r-${TOKEN_A}@reply.bis-rgv.com','hi',$4,$5, now()) returning id`, [acct, conv, pid, status, reason]);
  const heldMine = await row(convMine, "held", "not_on_record", `re_${RUN}_1`);
  const heldOther = await row(convOther, "held", "unverified", `re_${RUN}_2`);
  return { acct, acctB, mine, other, convMine, convOther, heldMine, heldOther };
}

describe("0082: the reply token on conversations", () => {
  it("takes 24 lowercase hex characters or null, once across every account; a revoked stamp needs a token (mutation: drop conversations_reply_token_check → 'ABC' is accepted, FAILS; drop the unique index → the second TOKEN_A insert is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect(await code(attempt(c, "update conversations set reply_token = 'ABCDEF0123456789ABCDEF01' where id = $1", [s.convOther]))).toBe("23514");
      expect(await code(attempt(c, "update conversations set reply_token = 'abc' where id = $1", [s.convOther]))).toBe("23514");
      expect(await code(attempt(c, "update conversations set reply_token = $2 where id = $1", [s.convOther, TOKEN_A]))).toBe("23505");
      expect(await code(attempt(c, "update conversations set reply_token_revoked_at = now() where id = $1", [s.convOther]))).toBe("23514");
      expect(await code(attempt(c, "update conversations set reply_token = $2, reply_token_revoked_at = now() where id = $1", [s.convOther, TOKEN_B]))).toBe("ok");
    });
  });
});

describe("0082: the account's reply mode", () => {
  it("defaults to off; own_domain needs a lowercase dotted domain that is not BIS's own, unique across accounts (mutation: drop accounts_inbound_domain_required → own_domain with no domain is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect((await c.query("select inbound_mode, inbound_domain from accounts where id = $1", [s.acct])).rows[0]).toEqual({ inbound_mode: "off", inbound_domain: null });
      expect(await code(attempt(c, "update accounts set inbound_mode = 'on' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_mode = 'own_domain' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_mode = 'own_domain', inbound_domain = 'Reply.Example.com' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_domain = 'reply.bis-rgv.com' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_domain = 'no-dot' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_mode = 'own_domain', inbound_domain = 'reply.example.com' where id = $1", [s.acct]))).toBe("ok");
      expect(await code(attempt(c, "update accounts set inbound_domain = 'reply.example.com' where id = $1", [s.acctB]))).toBe("23505");
      expect(await code(attempt(c, "update accounts set inbound_mode = 'bis' where id = $1", [s.acctB]))).toBe("ok");
    });
  });

  it("no client role can write either column (0015's rule; mutation: grant update (inbound_mode) to authenticated → the owner's update succeeds, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await code(attempt(c, "update accounts set inbound_mode = 'bis' where id = $1", [s.acct]))).toBe("42501");
      expect(await code(attempt(c, "update accounts set inbound_domain = 'reply.x.com' where id = $1", [s.acct]))).toBe("42501");
    });
  });
});

describe("0082: inbound_emails", () => {
  it("one row per Resend id; status, reason and decision are coherent; text is capped; attachment_count is never negative and defaults to 0 (mutation: drop inbound_emails_attachment_count_check → -1 is ok, FAILS; drop inbound_emails_held_has_reason → a reasonless held row is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const ins = (pid: string, status: string, reason: string | null, extra = "") => attempt(c,
        `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, text, status, hold_reason, received_at${extra ? ", decided_by" : ""})
         values ($1,$2,$3,'x@example.com','r@x.com','hi',$4,$5, now()${extra ? `, '${extra}'` : ""})`, [s.acct, s.convMine, pid, status, reason]);
      expect(await code(ins(`re_${RUN}_1`, "filed", null))).toBe("23505");
      expect(await code(ins(`re_${RUN}_3`, "held", null))).toBe("23514");
      expect(await code(ins(`re_${RUN}_4`, "lost", null))).toBe("23514");
      expect(await code(ins(`re_${RUN}_5`, "held", "spam"))).toBe("23514");
      expect(await code(ins(`re_${RUN}_6`, "filed", null, "user_x"))).toBe("23514");   // decided_by without decided_at
      expect(await code(attempt(c, "update inbound_emails set text = repeat('a', 100001) where id = $1", [s.heldMine]))).toBe("23514");
      expect(await code(attempt(c, "update inbound_emails set attachment_count = -1 where id = $1", [s.heldMine]))).toBe("23514");
      expect((await c.query("select attachment_count from inbound_emails where id = $1", [s.heldMine])).rows[0]).toEqual({ attachment_count: 0 });
    });
  });

  it("its conversation must be the same account's (mutation: a plain conversation_id FK → the cross-account insert is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect(await code(attempt(c,
        `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, status, received_at)
         values ($1,$2,'re_x_${RUN}','x@example.com','r@x.com','filed', now())`, [s.acctB, s.convMine]))).toBe("23503");
    });
  });

  it("members read their own account's rows, a Technician only their customers', the agency every account, another account nothing; no client writes (mutation: drop inbound_emails_technician_scope → the tech sees heldOther, FAILS; member_read using (true) → ownerB sees two, FAILS; drop the `app.is_agency() or` branch from member_read → the agency case sees none, FAILS [M2])", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const seen = async (who: keyof typeof SUB) => {
        await actAs(c, { org_id: who === "ownerB" ? ORG_B : ORG, sub: SUB[who] });
        const ids = (await c.query<{ id: string }>("select id from inbound_emails where account_id = any($1::uuid[]) order by id", [[s.acct, s.acctB]])).rows.map((r) => r.id);
        await c.query("reset role");
        return ids;
      };
      expect(await seen("owner")).toEqual([s.heldMine, s.heldOther].sort());
      expect(await seen("staff")).toEqual([s.heldMine, s.heldOther].sort());
      expect(await seen("tech")).toEqual([s.heldMine]);
      expect(await seen("ownerB")).toEqual([]);
      await actAs(c, { app_role: "agency_admin", sub: `u_ie_agency_${RUN}` });
      const agencyIds = (await c.query<{ id: string }>("select id from inbound_emails where account_id = any($1::uuid[]) order by id", [[s.acct, s.acctB]])).rows.map((r) => r.id);
      await c.query("reset role");
      expect(agencyIds).toEqual([s.heldMine, s.heldOther].sort());
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await code(attempt(c, "update inbound_emails set status = 'dismissed' where id = $1", [s.heldMine]))).toBe("42501");
      expect(await code(attempt(c, "delete from inbound_emails where id = $1", [s.heldMine]))).toBe("42501");
    });
  });

  it("a dismissed or held row may never carry a message; only a filed row can (M3; mutation: drop inbound_emails_message_requires_filed → a dismissed row with a message_id is accepted, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const msg = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','inbound','hi','customer') returning id", [s.acct, s.convMine]);
      expect(await code(attempt(c,
        `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, status, message_id, received_at)
         values ($1,$2,$3,'x@example.com','r@x.com','dismissed',$4, now())`, [s.acct, s.convMine, `re_${RUN}_7`, msg]))).toBe("23514");
      expect(await code(attempt(c, "update inbound_emails set message_id = $2 where id = $1", [s.heldMine, msg]))).toBe("23514");
    });
  });

  it("the account teardown order (messages, then conversations) leaves no row (mutation: message_id without on delete set null → deleting messages fails 23503, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const msg = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','inbound','hi','customer') returning id", [s.acct, s.convMine]);
      await c.query("update inbound_emails set status = 'filed', message_id = $2 where id = $1", [s.heldMine, msg]);
      await c.query("delete from messages where account_id = $1", [s.acct]);
      expect((await c.query("select message_id from inbound_emails where id = $1", [s.heldMine])).rows[0]).toEqual({ message_id: null });
      await c.query("delete from conversations where account_id = $1", [s.acct]);
      expect((await c.query("select count(*)::int as n from inbound_emails where account_id = $1", [s.acct])).rows[0]).toEqual({ n: 0 });
    });
  });
});

describe("0082: the inbound_email method and its Undo", () => {
  const append = (c: Client, acct: string, action: string, method: string, guard: string, expect: string | null) => c.query<{ outcome: string; event_id: string | null }>(
    `select outcome, event_id from public.append_consent_event($1,'email','ana@example.com',$2,$3,$4,$5,null,'user_x',null,null,'{}'::jsonb,null)`,
    [acct, action, method, guard, expect]);

  it("inbound_email is an email revoke only (mutation: leave inbound_email out of the method CHECK → the append raises 23514, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect((await append(c, s.acct, "revoked", "inbound_email", "if_allowed", null)).rows[0]!.outcome).toBe("appended");
      expect(await code(attempt(c, "select public.append_consent_event($1,'sms','+15555550100','revoked','inbound_email','none',null,null,null,null,null,'{}'::jsonb,null)", [s.acct]))).toBe("23514");
      // luis@example.com (not ana@example.com): the prior assertion already wrote ana@example.com a
      // 'revoked' row, so 0055's own unchanged 'held' guard (prior_action not null/hold_released/
      // resubscribed) would refuse this before the insert is ever attempted, regardless of 0082's
      // shape CHECK (returning a plain 'refused' row, not an exception) -- verified empirically against
      // the brief's literal address, which could never raise 23514 here no matter how 0082 is written.
      // A fresh address with no prior consent_events row lets the guard pass through to the INSERT,
      // where the shape CHECK is what actually fires.
      expect(await code(attempt(c, "select public.append_consent_event($1,'email','luis@example.com','held','inbound_email','none',null,null,null,null,null,'{}'::jsonb,null)", [s.acct]))).toBe("23514");
    });
  });

  it("a staff Undo lifts an inbound_email stop while it is newest, and still refuses over the customer's own unsubscribe (mutation: 0082 without the widened line → the Undo answers refused, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const stop = (await append(c, s.acct, "revoked", "inbound_email", "if_allowed", null)).rows[0]!;
      expect((await append(c, s.acct, "resubscribed", "staff_undo", "if_newest", stop.event_id)).rows[0]!.outcome).toBe("appended");
      const link = (await append(c, s.acct, "revoked", "unsubscribe_link", "none", null)).rows[0]!;
      expect((await append(c, s.acct, "resubscribed", "staff_undo", "if_newest", link.event_id)).rows[0]!.outcome).toBe("refused");
      // G3: over an existing stop, the emailed stop is refused, so its Undo can never lift the older one.
      expect((await append(c, s.acct, "revoked", "inbound_email", "if_allowed", null)).rows[0]!.outcome).toBe("refused");
    });
  });

  it("a staff Undo of an emailed stop works only within 7 days of that stop; a staff stop's Undo keeps no window (owner ruling 2026-10-16; mutation: remove the window → the 8-day case appends instead of refused, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      // A dedicated raw call per case, each its own address: `append`'s closure hardcodes
      // 'ana@example.com', which would make every one of these look up the WRONG address's prior row.
      const undo = (address: string, expectId: string) => c.query<{ outcome: string }>(
        `select outcome from public.append_consent_event($1,'email',$2,'resubscribed','staff_undo','if_newest',$3,null,'user_x',null,null,'{}'::jsonb,null)`,
        [s.acct, address, expectId]);
      const backdated = (address: string, method: string, days: number) => one(c,
        `insert into consent_events (account_id, channel, address, action, method, actor_id, occurred_at)
         values ($1,'email',$2,'revoked',$3,'user_x', now() - interval '${days} days') returning id`,
        [s.acct, address, method]);

      const recent = await backdated("recent6@example.com", "inbound_email", 6);
      expect((await undo("recent6@example.com", recent)).rows[0]!.outcome).toBe("appended");

      const old = await backdated("old8@example.com", "inbound_email", 8);
      expect((await undo("old8@example.com", old)).rows[0]!.outcome).toBe("refused");

      // Unchanged: a staff-made stop keeps no window at all.
      const staffOld = await backdated("staffold30@example.com", "staff", 30);
      expect((await undo("staffold30@example.com", staffOld)).rows[0]!.outcome).toBe("appended");
    });
  });

  it("an inbound_email revoke never lands over an existing stop, whatever guard the caller passes (Important 1, review round 1; mutation: delete the revoked/inbound_email branch beside staff/backfill_0049 → both cases append instead of refused, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const link = (await append(c, s.acct, "revoked", "unsubscribe_link", "none", null)).rows[0]!;
      expect(link.outcome).toBe("appended");
      // guard 'none' would ordinarily always succeed; the new branch must refuse it anyway.
      expect((await append(c, s.acct, "revoked", "inbound_email", "none", null)).rows[0]!.outcome).toBe("refused");
    });
  });

  it("an inbound_email revoke never lands over an existing complaint, even under guard unless_customer_stopped (Important 1, review round 1; mutation: delete the revoked/inbound_email branch → appends instead of refused, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const complaint = (await append(c, s.acct, "revoked", "email_complaint", "none", null)).rows[0]!;
      expect(complaint.outcome).toBe("appended");
      // unless_customer_stopped only names keyword/carrier_block/backfill_telnyx/unsubscribe_link/one_click,
      // so on its own it would let this through over an email_complaint prior row; the new branch must not.
      expect((await append(c, s.acct, "revoked", "inbound_email", "unless_customer_stopped", null)).rows[0]!.outcome).toBe("refused");
    });
  });

  it("the function's body differs from 0055 by exactly three things: the widened staff_undo guard, its 7-day window on an inbound_email stop only, and a new revoked/inbound_email guard branch beside staff/backfill_0049 (G2, Important 1, owner ruling 2026-10-16; mutation: delete any one edit → FAILS)", async () => {
    await withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ src: string }>("select prosrc as src from pg_proc where proname = 'append_consent_event'");
      expect(r!.src).toContain("v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'inbound_email')");
      expect(r!.src).toContain("(v_prior_method <> 'inbound_email' or v_prior_occurred_at > pg_catalog.clock_timestamp() - interval '7 days')");
      expect(r!.src).not.toContain("v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method = 'staff';");
      expect(r!.src).toContain("elsif p_action = 'revoked' and p_method = 'inbound_email' then");
      const { rows: [g] } = await c.query<{ a: boolean; s: boolean }>(
        `select has_function_privilege('authenticated', 'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)', 'EXECUTE') as a,
                has_function_privilege('service_role', 'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)', 'EXECUTE') as s`);
      expect(g).toEqual({ a: false, s: true });
    });
  });
});

describe("0082: unfile_inbound_email", () => {
  it("returns a manually filed row to held and deletes its message, once; never a webhook-filed row, and does nothing to a row that was never filed (mutation: drop 'and hold_reason is not null' → the UPDATE on the webhook row instead trips inbound_emails_held_has_reason [a held row with no reason], raising an error rather than silently unfiling it, FAILS; drop the message delete → the message survives, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const msg = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','inbound','hi','customer') returning id", [s.acct, s.convMine]);
      await c.query("update inbound_emails set status = 'filed', message_id = $2, decided_by = 'user_x', decided_at = now() where id = $1", [s.heldMine, msg]);
      const unfile = (id: string, m: string) => c.query<{ r: boolean }>("select public.unfile_inbound_email($1, $2, $3) as r", [s.acct, id, m]);
      expect((await unfile(s.heldMine, msg)).rows[0]!.r).toBe(true);
      expect((await c.query("select status, message_id, decided_by from inbound_emails where id = $1", [s.heldMine])).rows[0]).toEqual({ status: "held", message_id: null, decided_by: null });
      expect((await c.query("select count(*)::int as n from messages where id = $1", [msg])).rows[0]).toEqual({ n: 0 });
      expect((await unfile(s.heldMine, msg)).rows[0]!.r).toBe(false);
      const msg2 = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','inbound','hi','customer') returning id", [s.acct, s.convMine]);
      const filed = await one(c, `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, status, message_id, received_at)
        values ($1,$2,'re_w_${RUN}','x@example.com','r@x.com','filed',$3, now()) returning id`, [s.acct, s.convMine, msg2]);
      expect((await unfile(filed, msg2)).rows[0]!.r).toBe(false);
      // M3: a row that was never filed at all (held) does nothing, no error, and the message survives.
      const msg3 = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','inbound','hi','customer') returning id", [s.acct, s.convOther]);
      expect((await unfile(s.heldOther, msg3)).rows[0]!.r).toBe(false);
      expect((await c.query("select count(*)::int as n from messages where id = $1", [msg3])).rows[0]).toEqual({ n: 1 });
      expect(await code(attempt(c, "select public.unfile_inbound_email(null, $1, $2)", [filed, msg2]))).toBe("22004");
    });
  });

  it("only the service role may call it (mutation: grant execute to authenticated → FAILS)", async () => {
    await withRollback(async (c) => {
      const { rows: [g] } = await c.query<{ a: boolean; s: boolean }>(
        `select has_function_privilege('authenticated', 'public.unfile_inbound_email(uuid, uuid, uuid)', 'EXECUTE') as a,
                has_function_privilege('service_role', 'public.unfile_inbound_email(uuid, uuid, uuid)', 'EXECUTE') as s`);
      expect(g).toEqual({ a: false, s: true });
    });
  });
});
