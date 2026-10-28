import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import {
  createContact, getContact, listContacts, countContacts,
  archiveContacts, restoreContacts, restoreContactOnSign,
} from "../contacts";
import { buildMatchIndex, applyImportBatch } from "../contact-import";

/**
 * Contact archive (0103), the contact queries against the real PostgREST. CI only (withTestAccount, which the
 * plan's Global Constraints keep off every local run in this lane); the pure half, which the mutation probes run
 * against, is src/contacts-archive.test.ts. Every account-scoped read here has a SECOND account holding a
 * matching row (the plan's second-account rule), so a missing `account_id` term turns it red.
 *
 * `db` is the service client: the stamp trigger (0103 step 4) runs only for `authenticated`, so `archived_by`
 * stays null here and is never asserted; the log trigger likewise writes nothing for these archives.
 */

async function mk(db: SupabaseClient, accountId: string, first: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: first, author_kind: "person", ...extra }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
async function archivedAt(db: SupabaseClient, accountId: string, id: string): Promise<string | null> {
  const row = await getContact(db, accountId, id);
  if (!row) throw new Error(`contact ${id} not found in ${accountId}`);
  return row.archived_at as string | null;
}
const ids = async (rows: Promise<{ id: string }[] | null>) => ((await rows) ?? []).map((r) => r.id).sort();

describe("listContacts and countContacts: the archived filter", () => {
  it("listContacts and countContacts agree for both views, and account B's archived and active rows never appear in A's (second account; mutation: drop withArchived from countContacts -> FAILS)", () =>
    withTestAccount((db, a) => withTestAccount(async (_db, b) => {
      const [a1, a2, aArchived] = [await mk(db, a, "Arch A1"), await mk(db, a, "Arch A2"), await mk(db, a, "Arch A3")];
      const [, bArchived] = [await mk(db, b, "Arch B1"), await mk(db, b, "Arch B2")];
      expect((await archiveContacts(db, a, [aArchived])).changedIds).toEqual([aArchived]);
      expect((await archiveContacts(db, b, [bArchived])).changedIds).toEqual([bArchived]);
      expect(await ids(listContacts(db, a))).toEqual([a1, a2].sort());
      expect(await countContacts(db, a)).toBe(2);
      expect(await ids(listContacts(db, a, { archived: "only" }))).toEqual([aArchived]);
      expect(await countContacts(db, a, { archived: "only" })).toBe(1);
      expect(await ids(listContacts(db, a, { search: "Arch" }))).toEqual([a1, a2].sort());
    })));

  it("search still leaves an archived match out, and the Archived view's search finds only it (second account holds both kinds of match; mutation: apply withArchived only when there is no search -> FAILS)", () =>
    withTestAccount((db, a) => withTestAccount(async (_db, b) => {
      const active = await mk(db, a, "Zebulon", { last_name: "Active" });
      const gone = await mk(db, a, "Zebulon", { last_name: "Gone" });
      const bActive = await mk(db, b, "Zebulon", { last_name: "Bee" });
      const bGone = await mk(db, b, "Zebulon", { last_name: "BeeGone" });
      await archiveContacts(db, a, [gone]);
      await archiveContacts(db, b, [bGone]);
      expect(await ids(listContacts(db, a, { search: "Zebulon" }))).toEqual([active]);
      expect(await countContacts(db, a, { search: "Zebulon" })).toBe(1);
      expect(await ids(listContacts(db, a, { search: "Zebulon", archived: "only" }))).toEqual([gone]);
      expect(await countContacts(db, a, { search: "Zebulon", archived: "only" })).toBe(1);
      // B's own view, the control: its rows are there under its own account.
      expect(await ids(listContacts(db, b, { search: "Zebulon" }))).toEqual([bActive]);
    })));

  it("the Archived view pages one row at a time with `before`, over A's archived rows only (second account; mutation: drop withArchived when `before` is set -> FAILS)", () =>
    withTestAccount((db, a) => withTestAccount(async (_db, b) => {
      // Created One, Active, Two, Three (fix round): the list reads created_at desc with an `lt` cursor, so Active
      // sits BETWEEN archived rows and a filter dropped under the cursor surfaces it on a later page. Inserted
      // last, it was newer than every archived row and could never be reached past page one.
      const one = await mk(db, a, "Page One");
      const active = await mk(db, a, "Page Active");
      const archived = [one, await mk(db, a, "Page Two"), await mk(db, a, "Page Three")];
      const bArchived = await mk(db, b, "Page B");
      await archiveContacts(db, a, archived);
      await archiveContacts(db, b, [bArchived]);
      const seen: string[] = [];
      let before: { v: string | null; id: string } | undefined;
      for (let page = 0; page < 5; page++) {
        const rows = (await listContacts(db, a, { archived: "only", limit: 1, before })) ?? [];
        if (rows.length === 0) break;
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        seen.push(row.id);
        before = { v: row.created_at, id: row.id };
      }
      expect(seen.sort()).toEqual([...archived].sort());
      expect(seen).not.toContain(active);
      expect(seen).not.toContain(bArchived);
    })));
});

describe("archiveContacts / restoreContacts", () => {
  it("an id from account B passed under account A changes nothing in B, either way (second account; mutation: drop `.eq(\"account_id\", accountId)` -> FAILS)", () =>
    withTestAccount((db, a) => withTestAccount(async (_db, b) => {
      const bActive = await mk(db, b, "B stays");
      const bArchived = await mk(db, b, "B stays archived");
      await archiveContacts(db, b, [bArchived]);
      const before = await archivedAt(db, b, bArchived);
      expect(before).not.toBeNull();
      expect((await archiveContacts(db, a, [bActive])).changedIds).toEqual([]);
      expect((await restoreContacts(db, a, [bArchived])).changedIds).toEqual([]);
      expect(await archivedAt(db, b, bActive)).toBeNull();
      expect(await archivedAt(db, b, bArchived)).toBe(before);
    })));

  it("only the rows that change come back: a second archive and a second restore answer nothing", () =>
    withTestAccount(async (db, a) => {
      const c = await mk(db, a, "Twice");
      expect((await archiveContacts(db, a, [c])).changedIds).toEqual([c]);
      expect((await archiveContacts(db, a, [c])).changedIds).toEqual([]);
      expect((await restoreContacts(db, a, [c])).changedIds).toEqual([c]);
      expect((await restoreContacts(db, a, [c])).changedIds).toEqual([]);
      expect(await archivedAt(db, a, c)).toBeNull();
    }));
});

describe("dedupe and import still meet an archived contact (spec §3.3, §4.2)", () => {
  it("createContact with an archived contact's phone, then its email, returns that archived contact and leaves it archived; B's same-phone contact is never the match (second account; mutation: add `.is(\"archived_at\", null)` in findDuplicate -> FAILS)", () =>
    withTestAccount((db, a) => withTestAccount(async (_db, b) => {
      const phone = "+19565550147";
      const email = "archived.customer@example.com";
      await createContact(db, b, { firstName: "B twin", phone, email }, "user_test");
      const archived = (await createContact(db, a, { firstName: "Old customer", phone, email }, "user_test")).id;
      await archiveContacts(db, a, [archived]);
      const byPhone = await createContact(db, a, { phone: "(956) 555-0147" }, "user_test");
      expect(byPhone).toMatchObject({ id: archived, existing: true });
      const byEmail = await createContact(db, a, { email: "Archived.Customer@example.com" }, "user_test");
      expect(byEmail).toMatchObject({ id: archived, existing: true });
      expect(await archivedAt(db, a, archived)).not.toBeNull();
      expect(await countContacts(db, a, { archived: "only" })).toBe(1);
      expect(await countContacts(db, a)).toBe(0);
    })));

  it("an import row matching an archived contact by email fills a blank and leaves it archived (an import never restores; mutation: clear archived_at in the import's update -> FAILS)", () =>
    withTestAccount(async (db, a) => {
      const email = "imported.archived@example.com";
      const archived = (await createContact(db, a, { email }, "user_test")).id;
      await archiveContacts(db, a, [archived]);
      const stamp = await archivedAt(db, a, archived);
      const index = await buildMatchIndex(db, a);
      const r = await applyImportBatch(db, a, [{ input: { email, firstName: "Filled" }, tags: [] }], index, "user_test", { createTags: false });
      expect(r).toEqual({ created: 0, updated: 1, flagged: 0 });
      const row = await getContact(db, a, archived);
      expect(row!.first_name).toBe("Filled");
      expect(row!.archived_at).toBe(stamp);
    }));
});

describe("restoreContactOnSign", () => {
  it("brings an archived contact back once, writes the customer's log row, and answers false the second time; B's archived id under A stays archived (second account; mutation: drop `account_id = p_account_id` in restore_contact_on_sign -> FAILS)", () =>
    withTestAccount((db, a) => withTestAccount(async (_db, b) => {
      const c = await mk(db, a, "Came back");
      const bArchived = await mk(db, b, "B still away");
      await archiveContacts(db, a, [c]);
      await archiveContacts(db, b, [bArchived]);
      expect(await restoreContactOnSign(db, a, c, "form")).toBe(true);
      expect(await restoreContactOnSign(db, a, c, "form")).toBe(false);
      expect(await archivedAt(db, a, c)).toBeNull();
      const { data: log, error } = await db.from("contact_archive_log")
        .select("action, author_kind, author_id, sign").eq("account_id", a).eq("contact_id", c);
      if (error) throw new Error(error.message);
      expect(log).toEqual([{ action: "restored", author_kind: "customer", author_id: null, sign: "form" }]);
      expect(await restoreContactOnSign(db, a, bArchived, "form")).toBe(false);
      expect(await archivedAt(db, b, bArchived)).not.toBeNull();
    })));
});
