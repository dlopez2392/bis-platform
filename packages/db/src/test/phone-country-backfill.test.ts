import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import { withRollback } from "./db";
import { parseCandidates, rowsToFlag, flagSql, byWriter } from "../backfill/phone-country";

/**
 * The 0054 phone-country backfill end to end, in a rolled-back transaction
 * (so it runs on the local replica and on the CI project alike): the read
 * file, the deciding module, the emitted UPDATE, and a second run. Spec §8
 * "backfill idempotency"; spec §4.1 item 1 for who is flagged.
 */
const READ = readFileSync(fileURLToPath(new URL("../../supabase/backfills/0054-phone-country-candidates.sql", import.meta.url)), "utf8");
const RUN = Math.random().toString(36).slice(2, 10);

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [acct] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Backfill Co') returning id", [agency!.id, `org_BF_${RUN}`]);
  const account = acct!.id;
  const contact = async (name: string, phone: string) => (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name, phone) values ($1, $2, $3) returning id", [account, name, phone])).rows[0]!.id;
  const ids = {
    plusOne: await contact("plus one, could be Mexican", "+15512345678"),
    legacy: await contact("bare ten digits, both", "55 1234 5679"),
    mcallen: await contact("McAllen", "+19562921696"),
    caller: await contact("called in", "+15512349999"),
    texter: await contact("texted in", "(551) 234-8888"),
    mexican: await contact("already +52", "+528999221234"),
  };
  const { rows: [num] } = await c.query<{ id: string }>(
    "insert into phone_numbers (account_id, e164) values ($1, $2) returning id", [account, `+1${Math.floor(2_000_000_000 + Math.random() * 7_000_000_000)}`]);
  await c.query("insert into calls (account_id, phone_number_id, caller_e164) values ($1, $2, '+15512349999')", [account, num!.id]);
  const { rows: [conv] } = await c.query<{ id: string }>(
    "insert into conversations (account_id, contact_id) values ($1, $2) returning id", [account, ids.texter]);
  await c.query("insert into messages (account_id, conversation_id, channel, direction, body) values ($1, $2, 'sms', 'inbound', 'hola')", [account, conv!.id]);
  return { account, ids };
}

async function candidates(c: Client, account: string) {
  const { rows } = await c.query(READ);
  return parseCandidates(JSON.stringify(rows.filter((r: { account_id: string }) => r.account_id === account)));
}

describe("the 0054 phone-country backfill (read file + deciding module + emitted UPDATE)", () => {
  it("each row reports its creation and last write as UTC ISO text the parser accepts; a renamed old row is still flagged, and only an E.164 row created after the cut-off is the new build's (mutation: read created_at from updated_at → the renamed old row is not flagged, FAILS)", () =>
    withRollback(async (c) => {
      const { account, ids } = await seed(c);
      // Renamed after the cut-off: updated_at moves, created_at does not.
      await c.query("update contacts set first_name = 'renamed', updated_at = '2030-01-01T00:00:00Z' where id = $1", [ids.plusOne]);
      // Created after the cut-off: one bare (never the new build's shape), and a
      // new E.164 one that could be Mexican (the new build's own reading).
      await c.query("update contacts set created_at = '2030-01-01T00:00:00Z' where id = $1", [ids.legacy]);
      const fresh = (await c.query<{ id: string }>(
        "insert into contacts (account_id, first_name, phone, created_at) values ($1, 'created later', '+15512341111', '2030-01-01T00:00:00Z') returning id", [account])).rows[0]!.id;
      const rows = await candidates(c, account);
      expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.last_written_at)
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.created_at))).toBe(true);
      const { flag, writtenAfter, newBuild } = byWriter(rowsToFlag(rows), new Date("2029-01-01T00:00:00Z"));
      expect(flag.map((r) => r.id).sort()).toEqual([ids.plusOne, ids.legacy].sort());
      expect(writtenAfter.map((r) => r.id)).toEqual([ids.plusOne]);
      expect(newBuild.map((r) => r.id)).toEqual([fresh]);
    }));

  it("lists only unflagged ten-digit numbers the account has not seen inbound (mutation: drop the calls NOT EXISTS → 'called in' listed, FAILS)", () =>
    withRollback(async (c) => {
      const { account, ids } = await seed(c);
      const listed = (await candidates(c, account)).map((r) => r.id).sort();
      expect(listed).toEqual([ids.plusOne, ids.legacy, ids.mcallen].sort());
    }));

  it("flags exactly the ones that could be Mexican, and a second run flags nothing (idempotent; mutation: drop `phone_country_unconfirmed = false` from the UPDATE → 2 rows again, FAILS)", () =>
    withRollback(async (c) => {
      const { account, ids } = await seed(c);
      const flag = rowsToFlag(await candidates(c, account));
      expect(flag.map((r) => r.id).sort()).toEqual([ids.plusOne, ids.legacy].sort());
      const first = await c.query(flagSql(flag));
      expect(first.rows.map((r: { id: string }) => r.id).sort()).toEqual([ids.plusOne, ids.legacy].sort());
      const again = await c.query(flagSql(flag));
      expect(again.rowCount).toBe(0);
      expect(rowsToFlag(await candidates(c, account))).toEqual([]);
    }));

  it("a number edited between the read and the write is left alone (mutation: match on id only → flagged, FAILS)", () =>
    withRollback(async (c) => {
      const { account, ids } = await seed(c);
      const flag = rowsToFlag(await candidates(c, account));
      await c.query("update contacts set phone = '+19562921697' where id = $1", [ids.plusOne]);
      const res = await c.query(flagSql(flag));
      expect(res.rows.map((r: { id: string }) => r.id)).toEqual([ids.legacy]);
    }));

  it("lists a contact whose only message was OUTBOUND sms, one whose only inbound message was a FORM submission (not sms), and one whose number only called a DIFFERENT account (review I1: mutation P1, drop 'and m.channel = sms' → the form-only contact is wrongly excluded, FAILS; mutation P2, widen direction to inbound-or-outbound → the outbound-only contact is wrongly excluded, FAILS; mutation P3, drop 'k.account_id = c.account_id' from the calls check → the cross-account-caller contact is wrongly excluded, FAILS)", () =>
    withRollback(async (c) => {
      const { account, ids: seedIds } = await seed(c);
      const contact = async (name: string, phone: string, acctId = account) => (await c.query<{ id: string }>(
        "insert into contacts (account_id, first_name, phone) values ($1, $2, $3) returning id", [acctId, name, phone])).rows[0]!.id;

      // (a) an OUTBOUND sms only: proves nothing about the number being reachable.
      const outboundOnly = await contact("outbound sms only, could be Mexican", "+15512345690");
      const { rows: [convOut] } = await c.query<{ id: string }>(
        "insert into conversations (account_id, contact_id) values ($1, $2) returning id", [account, outboundOnly]);
      await c.query("insert into messages (account_id, conversation_id, channel, direction, body) values ($1, $2, 'sms', 'outbound', 'reminder')", [account, convOut!.id]);

      // (b) an inbound FORM submission only: not an sms reply, so not carrier proof.
      const formOnly = await contact("inbound form only, could be Mexican", "+15512345691");
      const { rows: [convForm] } = await c.query<{ id: string }>(
        "insert into conversations (account_id, contact_id) values ($1, $2) returning id", [account, formOnly]);
      await c.query("insert into messages (account_id, conversation_id, channel, direction, body) values ($1, $2, 'form', 'inbound', 'submitted')", [account, convForm!.id]);

      // (c) a number that called a DIFFERENT account: must not leak across tenants.
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const { rows: [acct2] } = await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Backfill Co (sibling)') returning id", [agency!.id, `org_BF2_${RUN}`]);
      const crossAccountCaller = await contact("called a DIFFERENT account only, could be Mexican", "+15512345692");
      const { rows: [num2] } = await c.query<{ id: string }>(
        "insert into phone_numbers (account_id, e164) values ($1, $2) returning id",
        [acct2!.id, `+1${Math.floor(2_000_000_000 + Math.random() * 7_000_000_000)}`]);
      await c.query("insert into calls (account_id, phone_number_id, caller_e164) values ($1, $2, '+15512345692')", [acct2!.id, num2!.id]);

      const listed = (await candidates(c, account)).map((r) => r.id);
      expect(listed).toContain(outboundOnly);
      expect(listed).toContain(formOnly);
      expect(listed).toContain(crossAccountCaller);
      // the original scenarios are untouched by these additions
      expect(listed).toEqual(expect.arrayContaining([seedIds.plusOne, seedIds.legacy, seedIds.mcallen]));
    }));

  it("a contact rewritten (phone changed) after its newest inbound sms is listed again, because that old proof no longer covers the CURRENT number (review I4; mutation: drop 'm.created_at >= c.updated_at' → wrongly excluded forever, FAILS)", () =>
    withRollback(async (c) => {
      const { account } = await seed(c);
      const contactId = (await c.query<{ id: string }>(
        "insert into contacts (account_id, first_name, phone) values ($1, 'renamed texter', '+15512345693') returning id", [account])).rows[0]!.id;
      const { rows: [conv] } = await c.query<{ id: string }>(
        "insert into conversations (account_id, contact_id) values ($1, $2) returning id", [account, contactId]);
      await c.query("insert into messages (account_id, conversation_id, channel, direction, body) values ($1, $2, 'sms', 'inbound', 'hola')", [account, conv!.id]);
      // Phone changed AFTER the inbound text: updated_at moves past the message's created_at.
      await c.query("update contacts set phone = '+15512345694', updated_at = now() + interval '1 minute' where id = $1", [contactId]);
      const listed = (await candidates(c, account)).map((r) => r.id);
      expect(listed).toContain(contactId);
    }));
});
