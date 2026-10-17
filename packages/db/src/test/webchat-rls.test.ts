import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/** S-06 part 3 (spec §7, "Tests": a Technician sees only their own customers' chats). The chats source
 *  reads messages on the caller's client; 0068's messages_technician_scope decides, through the conversation. */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_wc_${RUN}`;
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'WC Co',true) returning id", [agency!.id, ORG]);
  const tech = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [`u_wc_tech_${RUN}`]);
  const owner = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [`u_wc_owner_${RUN}`]);
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$3,'technician'), ($2,'account',$3,'owner')", [tech, owner, acct]);
  const mine = await one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,'Mine',$2) returning id", [acct, tech]);
  const theirs = await one(c, "insert into contacts (account_id, first_name) values ($1,'Theirs') returning id", [acct]);
  const anchor = async (contact: string, chat: string) => {
    const conv = await one(c, "insert into conversations (account_id, contact_id) values ($1,$2) returning id", [acct, contact]);
    await c.query(
      `insert into messages (account_id, conversation_id, channel, direction, status, body, author_kind, provider_message_id, meta)
       values ($1,$2,'webchat','inbound','delivered','hola','customer',$3, jsonb_build_object('webchat', jsonb_build_object('chat_id', $4::text, 'index', 0)))`,
      [acct, conv, `webchat:${chat}:0`, chat]);
    return conv;
  };
  const mineConv = await anchor(mine, `00000000-0000-4000-8000-${RUN.padStart(12, "0").slice(-12)}`);
  const theirsConv = await anchor(theirs, `00000000-0000-4000-9000-${RUN.padStart(12, "0").slice(-12)}`);
  return { mineConv, theirsConv };
}

describe("a chat's rows under 0068 (S-06 part 3)", () => {
  it("a Technician reads the chat anchors of their own customer only; an Owner reads both (mutation: drop messages_technician_scope → the tech reads two, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const read = async (sub: string) => {
        await actAs(c, { org_id: ORG, sub });
        const ids = (await c.query<{ conversation_id: string }>(
          "select conversation_id from messages where channel = 'webchat' and meta->'webchat'->>'index' = '0' order by conversation_id")).rows.map((r) => r.conversation_id);
        await c.query("reset role");
        return ids;
      };
      expect(await read(`u_wc_tech_${RUN}`)).toEqual([s.mineConv]);
      expect(await read(`u_wc_owner_${RUN}`)).toEqual([s.mineConv, s.theirsConv].sort());
    });
  });

  it("the source's first read, the customer's conversations, is fenced too: a Technician asking for the other customer's thread reads none (mutation: drop conversations_technician_scope → the tech reads it, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: `u_wc_tech_${RUN}` });
      const ids = (await c.query<{ id: string }>("select id from conversations where id = any($1::uuid[]) order by id", [[s.mineConv, s.theirsConv]])).rows.map((r) => r.id);
      await c.query("reset role");
      expect(ids).toEqual([s.mineConv]);
    });
  });
});
