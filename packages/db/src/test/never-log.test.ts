import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { listNeverLog, addNeverLog, removeNeverLog } from "../never-log";
import { matchTeamSender } from "../inbound-email";
import { createMessage, ensureConversation } from "../messaging";
import { createContact } from "../contacts";

const ACTOR = "user_test";
const RUN = Math.random().toString(36).slice(2, 10);

describe("the Never record list (0083)", () => {
  it("adds, refuses a duplicate, lists newest first, removes once, scoped to its account (mutation: drop .eq('account_id') from removeNeverLog → account B's remove deletes A's row, FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      await withTestAccount(async (_db, b) => {
        const one = await addNeverLog(db, a, { pattern: `x${RUN}.com`, kind: "domain" }, ACTOR);
        const two = await addNeverLog(db, a, { pattern: `billing@y${RUN}.com`, kind: "address" }, ACTOR);
        expect(one.outcome).toBe("added");
        expect(await addNeverLog(db, a, { pattern: `x${RUN}.com`, kind: "domain" }, ACTOR)).toEqual({ outcome: "duplicate" });
        expect((await listNeverLog(db, a)).map((e) => e.pattern)).toEqual([`billing@y${RUN}.com`, `x${RUN}.com`]);
        const id = one.outcome === "added" ? one.entry.id : "";
        expect(await removeNeverLog(db, b, id, ACTOR)).toBeNull();
        expect((await listNeverLog(db, a))).toHaveLength(2);
        expect(await removeNeverLog(db, a, id, ACTOR)).toMatchObject({ id, pattern: `x${RUN}.com`, kind: "domain", addedBy: ACTOR });
        expect(await removeNeverLog(db, a, id, ACTOR)).toBeNull();
        expect(two.outcome).toBe("added");
      });
    });
  });

  it("answers full at 200 entries and adds nothing (mutation: >= → > → the 201st lands, FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      const rows = Array.from({ length: 200 }, (_, i) => ({ account_id: a, pattern: `d${i}.${RUN}.com`, kind: "domain", added_by: ACTOR }));
      const { error } = await db.from("inbound_never_log").insert(rows);
      expect(error).toBeNull();
      expect(await addNeverLog(db, a, { pattern: `last.${RUN}.com`, kind: "domain" }, ACTOR)).toEqual({ outcome: "full" });
      expect(await listNeverLog(db, a)).toHaveLength(200);
    });
  });
});

describe("matchTeamSender (spec §3)", () => {
  it("a member of this account by email key (any role), then the account's reply-to mailbox; never another account's member (mutation: drop .eq('account_id') → B's member matches on A, FAILS; drop the mailbox branch → FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      await withTestAccount(async (_db, b) => {
        const mk = async (sub: string, email: string, acct: string, role: string) => {
          const { data: u, error } = await db.from("users").insert({ clerk_user_id: sub, email }).select("id").single();
          expect(error).toBeNull();
          const { error: e2 } = await db.from("memberships").insert({ user_id: u!.id, scope: "account", account_id: acct, role });
          expect(e2).toBeNull();
          return u!.id as string;
        };
        const users: string[] = [];
        try {
          users.push(await mk(`u_tech_${RUN}`, `Maria.Tech+bis@Example.com`, a, "technician"));
          users.push(await mk(`u_other_${RUN}`, `luis.${RUN}@example.com`, b, "owner"));
          expect(await matchTeamSender(db, a, "maria.tech@example.com")).toEqual({ userId: `u_tech_${RUN}` });
          expect(await matchTeamSender(db, a, `luis.${RUN}@example.com`)).toBeNull();
          const { error } = await db.from("accounts").update({ reply_to_email: `Office+in@Shop${RUN}.com` }).eq("id", a);
          expect(error).toBeNull();
          expect(await matchTeamSender(db, a, `office@shop${RUN}.com`)).toEqual({ mailbox: true });
          expect(await matchTeamSender(db, a, "stranger@example.com")).toBeNull();
          expect(await matchTeamSender(db, a, "")).toBeNull();
        } finally {
          await db.from("memberships").delete().in("user_id", users);
          const { error } = await db.from("users").delete().in("id", users);
          expect(error).toBeNull();
        }
      });
    });
  });
});

describe("createMessage's explicit author (plan G3)", () => {
  it("an inbound message with author person stores the person mark and its id; without it, inbound stays the customer's (mutation: ignore input.author → author_kind customer, FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      const { id: contactId } = await createContact(db, a, { firstName: "Ana", email: `ana.${RUN}@example.com` }, ACTOR);
      const { id: conversationId } = await ensureConversation(db, a, contactId, ACTOR, "system");
      const fwd = await createMessage(db, a, { conversationId, channel: "email", direction: "inbound", body: "fw", author: { kind: "person", id: `u_m_${RUN}` } }, "email-inbound", "system");
      const box = await createMessage(db, a, { conversationId, channel: "email", direction: "inbound", body: "fw2", author: { kind: "person", id: null } }, "email-inbound", "system");
      const cust = await createMessage(db, a, { conversationId, channel: "email", direction: "inbound", body: "hi" }, "email-inbound", "system");
      const { data } = await db.from("messages").select("id, author_kind, author_id").in("id", [fwd.id, box.id, cust.id]);
      const by = new Map((data ?? []).map((r) => [r.id, { kind: r.author_kind, id: r.author_id }]));
      expect(by.get(fwd.id)).toEqual({ kind: "person", id: `u_m_${RUN}` });
      expect(by.get(box.id)).toEqual({ kind: "person", id: null });
      expect(by.get(cust.id)).toEqual({ kind: "customer", id: null });
    });
  });
});
