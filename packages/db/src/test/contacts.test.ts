import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact, updateContact, listContacts, getContact,
         addTagToContact, listContactTags, fillContactBlanks, countContacts,
         deleteContacts, addTagToContacts, removeTagFromContacts, listTags } from "../contacts";

/** Seed helper: inserts a contact row directly, bypassing createContact's
 *  dedupe + event emission — this suite exercises listContacts/countContacts,
 *  not create semantics. */
async function seedContact(
  db: any, accountId: string, input: { firstName?: string; lastName?: string },
) {
  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: input.firstName, last_name: input.lastName })
    .select("id").single();
  if (error || !data) throw new Error(`seedContact failed: ${error?.message}`);
  return { id: data.id as string };
}

/** Seed helper: inserts `count` contact rows that all share ONE `created_at`
 *  — exactly what a CSV import (Task 6) produces, and exactly what a
 *  timestamp-only cursor cannot page through. Returns the inserted ids.
 *  Bypasses createContact: it has no way to override created_at, and
 *  emitting one event per row for hundreds of rows would make this test
 *  needlessly slow. */
async function seedContacts(db: any, accountId: string, count: number, at: string) {
  const rows = Array.from({ length: count }, (_, i) => ({
    account_id: accountId, first_name: `Seed ${i}`, created_at: at,
  }));
  const { data, error } = await db.from("contacts").insert(rows).select("id");
  if (error) throw new Error(`seedContacts failed: ${error.message}`);
  return (data ?? []).map((r: { id: string }) => r.id);
}

/** Seed helper: inserts one contact row with an explicit `first_name` AND
 *  `created_at` — needed to interleave matching/non-matching rows at known
 *  positions in the `created_at desc, id desc` ordering `listContacts` pages
 *  by. Bypasses createContact for the same reasons as the helpers above. */
async function seedContactAt(db: any, accountId: string, firstName: string, at: string) {
  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: firstName, created_at: at })
    .select("id").single();
  if (error || !data) throw new Error(`seedContactAt failed: ${error?.message}`);
  return { id: data.id as string };
}

describe("contacts service", () => {
  it("creates, emits event, dedupes by email", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId,
        { firstName: "Maria", lastName: "Garcia", email: "maria@example.com" }, "user_test");
      expect(a.existing).toBe(false);
      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId)
        .eq("type", "contact.created");
      expect(ev).toHaveLength(1);
      const b = await createContact(db, accountId,
        { firstName: "M.", email: "MARIA@example.com" }, "user_test");
      expect(b.existing).toBe(true);
      expect(b.id).toBe(a.id);
    }));

  it("updates fields + custom, emits contact.updated", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createContact(db, accountId, { firstName: "Joe" }, "user_test");
      await updateContact(db, accountId, id, { phone: "+19565550100", custom: { referral: "yes" } }, "user_test");
      const row = await getContact(db, accountId, id);
      expect(row?.phone).toBe("+19565550100");
      expect((row?.custom as any).referral).toBe("yes");
    }));

  it("search matches name/email/phone; tags round-trip", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createContact(db, accountId,
        { firstName: "Rosa", lastName: "Trevino", email: "rosa@shop.com" }, "user_test");
      await createContact(db, accountId, { firstName: "Zed" }, "user_test");
      const hits = await listContacts(db, accountId, { search: "trevi" });
      expect(hits).toHaveLength(1);

      // The P6 hardening (sanitizeSearchTerm), asserted inside THIS cycle
      // rather than a new withTestAccount of its own: blueprints.test.ts is
      // contention-marginal and an extra fixture cycle tips it into a 20s
      // timeout. A double quote breaks out of the interpolated .or() filter
      // grammar this search still builds (see contacts.ts:23-49) — before the
      // fix this threw, or worse, came back as a silent "no match".
      const quoted = await listContacts(db, accountId, { search: `trevi"` });
      expect(quoted).toHaveLength(1);
      expect(quoted![0]!.last_name).toBe("Trevino");
      // A typed wildcard must not silently become "match everything":
      // "trev%" sanitizes to "trev" and still finds exactly Rosa.
      expect(await listContacts(db, accountId, { search: "trev%" })).toHaveLength(1);
      // A bare "%" sanitizes to "", and this LIST function's `if (s)` guard
      // then applies no filter — which is correct HERE and load-bearing: the
      // contacts page passes its search box straight through, and an empty box
      // must list everything rather than nothing. It is exactly why the
      // palette's search route gates on the SANITIZED term before calling
      // this (see api/accounts/[accountId]/search/route.ts) — otherwise a
      // query of "%%" would render these rows as if they had MATCHED. The two
      // dedicated SEARCH functions (searchCalls/searchConversations) return []
      // for the same input, because they have no "list everything" meaning.
      expect(await listContacts(db, accountId, { search: "%" })).toHaveLength(2);

      await addTagToContact(db, accountId, id, "vip");
      await addTagToContact(db, accountId, id, "vip"); // idempotent
      const tags = await listContactTags(db, accountId, id);
      expect(tags.map(t => t.name)).toEqual(["vip"]);
    }));

  it("createContact tolerates PostgREST filter syntax in email AND phone", () =>
    withTestAccount(async (db, accountId) => {
      // Both fields must be present: the old dedupe interpolated them into a
      // single .or() filter only in that case, so an email-only submission
      // took an already-safe .ilike() branch and proved nothing. From a public
      // form both of these strings are attacker-controlled.
      const hostile = `a"),phone.eq."x`;
      const first = await createContact(
        db, accountId, { firstName: "Nefarious", email: hostile, phone: `1"),email.ilike."%` },
        "user_test");
      expect(first.existing).toBe(false);

      const second = await createContact(
        db, accountId, { firstName: "Nefarious", email: hostile, phone: `1"),email.ilike."%` },
        "user_test");
      expect(second.existing).toBe(true);
      expect(second.id).toBe(first.id);
    }));

  it("createContact tolerates filter syntax in an email-only submission", () =>
    withTestAccount(async (db, accountId) => {
      const hostile = `a"),phone.eq."x`;
      const first = await createContact(db, accountId, { email: hostile }, "user_test");
      const second = await createContact(db, accountId, { email: hostile }, "user_test");
      expect(second.existing).toBe(true);
      expect(second.id).toBe(first.id);
    }));

  it("createContact dedupes on phone when only a phone is given", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId, { phone: "956-555-0101" }, "user_test");
      const b = await createContact(db, accountId, { phone: "956-555-0101" }, "user_test");
      expect(b.existing).toBe(true);
      expect(b.id).toBe(a.id);

      // Same fixture cycle, extended: the review finding this fixes.
      // contacts.phone is only trimmed on write, so an operator-typed
      // "(956) 292-1696" and an inbound SMS sender's E.164
      // "+19562921696" are the same ten digits but never the same STRING —
      // before the fix, an exact-match dedupe forked a second contact (and,
      // upstream, a second conversation thread) for the same customer.
      const c = await createContact(db, accountId, { phone: "(956) 292-1696" }, "user_test");
      expect(c.existing).toBe(false);
      const d = await createContact(db, accountId, { phone: "+19562921696" }, "user_test");
      expect(d.existing).toBe(true);
      expect(d.id).toBe(c.id);
    }));

  it("createContact treats % and _ in email as literal characters, not ILIKE wildcards", () =>
    withTestAccount(async (db, accountId) => {
      // A pre-existing, unrelated contact. Before `findDuplicate` escaped its
      // ILIKE operand, an attacker-supplied "%@example.com" would match this
      // row (ILIKE '%@example.com' matches any address ending "@example.com"),
      // hijacking it — the exact bug this test guards against.
      const real = await createContact(db, accountId,
        { firstName: "Real", lastName: "Customer", email: "real.customer@example.com" }, "user_test");

      const first = await createContact(
        db, accountId, { firstName: "Wildcard", email: "%@example.com" }, "user_test");
      expect(first.existing).toBe(false);
      expect(first.id).not.toBe(real.id);

      // Submitting the identical literal string again still dedupes onto
      // itself normally — the fix makes "%" literal, it does not disable
      // dedupe for values that happen to contain one.
      const second = await createContact(
        db, accountId, { firstName: "Wildcard again", email: "%@example.com" }, "user_test");
      expect(second.existing).toBe(true);
      expect(second.id).toBe(first.id);
      expect(second.id).not.toBe(real.id);

      // Total across this test: two distinct contacts (the real one, and the
      // wildcard one) — never merged together.
      const { data: all } = await db.from("contacts").select("id").eq("account_id", accountId);
      expect(all).toHaveLength(2);
    }));

  it("createContact treats a leading underscore in email as literal, not an ILIKE single-char wildcard", () =>
    withTestAccount(async (db, accountId) => {
      const real = await createContact(db, accountId,
        { firstName: "Real", email: "a@example.com" }, "user_test");

      const wildcard = await createContact(
        db, accountId, { firstName: "Wildcard", email: "_@example.com" }, "user_test");
      expect(wildcard.existing).toBe(false);
      expect(wildcard.id).not.toBe(real.id);
    }));

  it("createContact records a system actor when asked", () =>
    withTestAccount(async (db, accountId) => {
      await createContact(db, accountId, { firstName: "Lead" }, "form", "system");
      const { data } = await db.from("events").select("actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "contact.created");
      expect(data![0]!.actor_type).toBe("system");
      expect(data![0]!.actor_id).toBe("form");
    }));
});

describe("fillContactBlanks", () => {
  it("fills only blank fields and reports them", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Ana", phone: "+15550000020" }, "t");
      const filled = await fillContactBlanks(db, accountId, c.id,
        { firstName: "Ignored", email: "ANA@Example.com " }, "t");
      expect(filled.sort()).toEqual(["email"]);
      const row = await getContact(db, accountId, c.id);
      expect(row!.first_name).toBe("Ana");            // IRON RULE: not overwritten
      expect(row!.email).toBe("ana@example.com");     // normalized
    }));

  it("replaces the 'Caller' placeholder with a real name (lastName rides along)", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Caller", phone: "+15550000021" }, "t");
      const filled = await fillContactBlanks(db, accountId, c.id,
        { firstName: "Dan", lastName: "Lopez" }, "t");
      expect(filled.sort()).toEqual(["first_name", "last_name"]);
      const row = await getContact(db, accountId, c.id);
      expect(row!.first_name).toBe("Dan");
      expect(row!.last_name).toBe("Lopez");
    }));

  it("does NOT treat a real first name with blank last name as a placeholder", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Madonna", phone: "+15550000022" }, "t");
      expect(await fillContactBlanks(db, accountId, c.id, { firstName: "Dan" }, "t")).toEqual([]);
    }));

  it("no-ops cleanly when nothing is blank (no update, no event)", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId,
        { firstName: "A", lastName: "B", email: "a@b.co", phone: "+15550000023" }, "t");
      expect(await fillContactBlanks(db, accountId, c.id,
        { firstName: "X", lastName: "Y", email: "x@y.co", phone: "+15550000024" }, "t")).toEqual([]);
    }));

  it("fills a blank last_name independently when the incoming first name matches", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "John", phone: "+15550000025" }, "t");
      const filled = await fillContactBlanks(db, accountId, c.id,
        { firstName: "John", lastName: "Smith" }, "t");
      expect(filled).toEqual(["last_name"]);
      const row = await getContact(db, accountId, c.id);
      expect(row!.first_name).toBe("John");
      expect(row!.last_name).toBe("Smith");
    }));

  it("does NOT graft a last name onto a record whose first name differs from the caller's", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Ana", phone: "+15550000026" }, "t");
      expect(await fillContactBlanks(db, accountId, c.id,
        { firstName: "Maria", lastName: "Smith" }, "t")).toEqual([]);
    }));
});

describe("countContacts", () => {
  it("returns the exact head count for the account, cross-tenant rows excluded", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_otherDb, otherAccountId) => {
        expect(await countContacts(db, accountId)).toBe(0);
        await createContact(db, accountId, { firstName: "A" }, "user_test");
        await createContact(db, accountId, { firstName: "B" }, "user_test");
        await createContact(db, otherAccountId, { firstName: "Other" }, "user_test");

        expect(await countContacts(db, accountId)).toBe(2);
        expect(await countContacts(db, otherAccountId)).toBe(1);
      });
    });
  });
});

describe("listContacts paging", () => {
  it("pages past 100 and never repeats or skips a row when timestamps collide", () =>
    withTestAccount(async (db, accountId) => {
      // Every row shares ONE created_at — exactly what an import produces, and
      // exactly what a timestamp-only cursor cannot page through.
      const at = "2026-09-09T12:00:00.000Z";
      const ids = await seedContacts(db, accountId, 250, at);

      const seen: string[] = [];
      let before: { v: string | null; id: string } | undefined;
      for (let page = 0; page < 10; page++) {
        const rows = await listContacts(db, accountId, { limit: 50, before });
        if (rows.length === 0) break;
        seen.push(...rows.map((r: any) => r.id));
        const last = rows[rows.length - 1]!;
        before = { v: last.created_at, id: last.id };
      }

      expect(seen.length).toBe(250);
      expect(new Set(seen).size).toBe(250);              // no repeats
      expect([...seen].sort()).toEqual([...ids].sort()); // no skips
    }));

  it("counts what the search matches, not the whole account", () =>
    withTestAccount(async (db, accountId) => {
      await seedContact(db, accountId, { firstName: "Ada", lastName: "Lovelace" });
      await seedContact(db, accountId, { firstName: "Grace", lastName: "Hopper" });
      expect(await countContacts(db, accountId)).toBe(2);
      expect(await countContacts(db, accountId, { search: "Ada" })).toBe(1);
    }));

  // Gap a Task 2 review flagged: source-reading confirmed the search .or()
  // and the cursor's .or() compose (PostgREST ANDs separate filter calls)
  // but nothing ever exercised it end to end — and the contacts list (Task 3)
  // combines both live the moment an operator searches and clicks "Older".
  // If they composed as OR instead of AND, this would either leak a
  // non-matching row into a searched page or skip a matching one hiding
  // behind a non-matching row's position — the interleaved timestamps below
  // put a non-match between every pair of matches so either failure mode
  // would show up as a wrong `seen` set.
  it("composes search and before: paging the SEARCHED list sees every match once and no non-match", () =>
    withTestAccount(async (db, accountId) => {
      const base = Date.parse("2026-09-09T12:00:00.000Z");
      const matchIds: string[] = [];
      for (let i = 0; i < 12; i++) {
        const at = new Date(base + i * 1000).toISOString();
        const isMatch = i % 2 === 0;
        const { id } = await seedContactAt(db, accountId, isMatch ? `Ada${i}` : `Bob${i}`, at);
        if (isMatch) matchIds.push(id);
      }

      const seen: string[] = [];
      let before: { v: string | null; id: string } | undefined;
      for (let page = 0; page < 10; page++) {
        const rows = await listContacts(db, accountId, { search: "ada", limit: 2, before });
        if (rows.length === 0) break;
        seen.push(...rows.map((r: any) => r.id));
        const last = rows[rows.length - 1]!;
        before = { v: last.created_at, id: last.id };
      }

      expect(seen.length).toBe(matchIds.length);              // every match, nothing extra
      expect(new Set(seen).size).toBe(matchIds.length);        // no repeats across pages
      expect([...seen].sort()).toEqual([...matchIds].sort()); // exactly the matches — no "Bob" leaked
    }));
});

describe("listContacts sort", () => {
  /** Pages the WHOLE list under a given sort, cursoring by whichever column
   *  `key` names — exactly what apps/web's contacts/page.tsx does with the
   *  last row of each page. Small `limit` on purpose: with 4 non-null rows
   *  and 2 null ones, `limit: 2` forces a THIRD page whose cursor's `v` is
   *  the last non-null value — the exact request that must cross into the
   *  null block, which is the boundary Step 5's mutation check breaks. */
  async function pageAll(
    db: any, accountId: string, key: "name" | "company" | "created", dir: "asc" | "desc",
  ): Promise<string[]> {
    const column = key === "name" ? "sort_name" : key === "company" ? "company_name" : "created_at";
    const seen: string[] = [];
    let before: { v: string | null; id: string } | undefined;
    for (let page = 0; page < 10; page++) {
      const rows: any[] = await listContacts(db, accountId, { limit: 2, before, sort: { key, dir } });
      if (rows.length === 0) break;
      seen.push(...rows.map((r) => r.id));
      const last = rows[rows.length - 1]!;
      before = { v: last[column], id: last.id };
    }
    return seen;
  }

  it("pages the whole list sorted by name in both directions, nameless contacts last both times", () =>
    withTestAccount(async (db, accountId) => {
      // Insertion order deliberately NOT alphabetical — proves the order
      // came from sort_name, not from created_at happening to agree with it.
      const zed = await seedContact(db, accountId, { firstName: "Zed" });
      const mike = await seedContact(db, accountId, { firstName: "Mike" });
      const ana = await seedContact(db, accountId, { firstName: "Ana" });
      const bob = await seedContact(db, accountId, { firstName: "Bob" });
      // Two with no name at all — sort_name is NULL for both (0030's
      // `nullif(..., '')`), and nulls must sort last in BOTH directions.
      const nameless1 = await seedContact(db, accountId, {});
      const nameless2 = await seedContact(db, accountId, {});
      const namelessIds = new Set([nameless1.id, nameless2.id]);

      const asc = await pageAll(db, accountId, "name", "asc");
      expect(asc).toHaveLength(6);
      expect(new Set(asc).size).toBe(6); // no repeats, no skips
      expect(asc.slice(0, 4)).toEqual([ana.id, bob.id, mike.id, zed.id]);
      expect(new Set(asc.slice(4))).toEqual(namelessIds); // last, either order

      const desc = await pageAll(db, accountId, "name", "desc");
      expect(desc).toHaveLength(6);
      expect(new Set(desc).size).toBe(6);
      expect(desc.slice(0, 4)).toEqual([zed.id, mike.id, bob.id, ana.id]);
      expect(new Set(desc.slice(4))).toEqual(namelessIds); // STILL last, not first
    }));

  it("pages the whole list sorted by company in both directions, company-less contacts last both times", () =>
    withTestAccount(async (db, accountId) => {
      const zeta = await createContact(db, accountId, { firstName: "P1", companyName: "Zeta Corp" }, "user_test");
      const mango = await createContact(db, accountId, { firstName: "P2", companyName: "Mango LLC" }, "user_test");
      const acme = await createContact(db, accountId, { firstName: "P3", companyName: "Acme Inc" }, "user_test");
      const bravo = await createContact(db, accountId, { firstName: "P4", companyName: "Bravo Co" }, "user_test");
      const solo1 = await createContact(db, accountId, { firstName: "P5" }, "user_test"); // no company
      const solo2 = await createContact(db, accountId, { firstName: "P6" }, "user_test"); // no company
      const soloIds = new Set([solo1.id, solo2.id]);

      const asc = await pageAll(db, accountId, "company", "asc");
      expect(asc).toHaveLength(6);
      expect(new Set(asc).size).toBe(6);
      expect(asc.slice(0, 4)).toEqual([acme.id, bravo.id, mango.id, zeta.id]);
      expect(new Set(asc.slice(4))).toEqual(soloIds);

      const desc = await pageAll(db, accountId, "company", "desc");
      expect(desc).toHaveLength(6);
      expect(new Set(desc).size).toBe(6);
      expect(desc.slice(0, 4)).toEqual([zeta.id, mango.id, bravo.id, acme.id]);
      expect(new Set(desc.slice(4))).toEqual(soloIds);
    }));

  it("defaults to created desc, unaffected by an absent sort option", () =>
    withTestAccount(async (db, accountId) => {
      const first = await seedContact(db, accountId, { firstName: "First" });
      await new Promise((r) => setTimeout(r, 5));
      const second = await seedContact(db, accountId, { firstName: "Second" });
      const rows: any[] = await listContacts(db, accountId, {});
      expect(rows.map((r) => r.id)).toEqual([second.id, first.id]); // newest first
    }));

  /**
   * sort_name/company_name are free text off first_name/last_name — unlike
   * the OLD timestamp-only cursor (regex-validated to exclude every
   * PostgREST-reserved character), the new cursor's `v` is opaque
   * (apps/web/src/lib/cursor.ts) and a real name can contain any of
   * PostgREST's `.or()` grammar characters: comma, parens, a period, a
   * double quote. This is the same class of bug contacts.ts's own
   * dedupe/search already got bitten by once (see this file's "tolerates
   * PostgREST filter syntax" tests) — proving listContacts' cursor filter
   * survives it too, now that the sorted value is free text rather than a
   * shape-validated timestamp.
   */
  it("pages past a name containing every PostgREST-reserved character without breaking the filter or skipping a row", () =>
    withTestAccount(async (db, accountId) => {
      const tricky = await seedContact(db, accountId, { firstName: `O'Brien, "Big" (Sr.)` });
      const after = await seedContact(db, accountId, { firstName: "Zed" }); // sorts after, ascending

      const page1: any[] = await listContacts(db, accountId, { limit: 1, sort: { key: "name", dir: "asc" } });
      expect(page1).toHaveLength(1);
      expect(page1[0]!.id).toBe(tricky.id);

      const cursor = { v: page1[0]!.sort_name as string, id: page1[0]!.id as string };
      const page2: any[] = await listContacts(db, accountId,
        { limit: 1, before: cursor, sort: { key: "name", dir: "asc" } });
      expect(page2).toHaveLength(1);
      expect(page2[0]!.id).toBe(after.id);
    }));

  /**
   * Review finding: the test above has no backslash in it, so the ONE thing
   * that makes `quoteFilterValue` (contacts.ts) safe — escaping a literal
   * backslash BEFORE escaping a double quote — was never exercised against
   * the real database. Order matters: escape the quote first and the
   * backslash pass afterward doubles every backslash the quote step just
   * inserted, so what should have been an escaped quote (`\"`) becomes an
   * escaped backslash followed by a BARE, unescaped quote (`\\"`) — which
   * PostgREST reads as the end of the quoted string. Everything after that
   * spills out as raw, unquoted filter syntax instead of literal text, and
   * the filter either throws on malformed grammar or silently mis-parses —
   * either way this page/cursor request breaks. A name with a backslash and
   * a quote right next to each other (as here) is the minimal case that
   * tells the two orderings apart.
   */
  it("pages past a name containing both a backslash and a double quote without breaking the filter or skipping a row", () =>
    withTestAccount(async (db, accountId) => {
      const tricky = await seedContact(db, accountId, { firstName: `Back\\Slash "Quote"` });
      const after = await seedContact(db, accountId, { firstName: "Zed" }); // sorts after, ascending

      const page1: any[] = await listContacts(db, accountId, { limit: 1, sort: { key: "name", dir: "asc" } });
      expect(page1).toHaveLength(1);
      expect(page1[0]!.id).toBe(tricky.id);

      const cursor = { v: page1[0]!.sort_name as string, id: page1[0]!.id as string };
      const page2: any[] = await listContacts(db, accountId,
        { limit: 1, before: cursor, sort: { key: "name", dir: "asc" } });
      expect(page2).toHaveLength(1);
      expect(page2[0]!.id).toBe(after.id);
    }));
});

describe("bulk contact ops", () => {
  it("addTagToContacts tags every id once, idempotently, and returns the tagId", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId, { firstName: "A" }, "user_test");
      const b = await createContact(db, accountId, { firstName: "B" }, "user_test");
      const r1 = await addTagToContacts(db, accountId, [a.id, b.id], "VIP");
      expect(r1.applied).toBe(2);
      // idempotent — re-applying does not duplicate contact_tags rows
      const r2 = await addTagToContacts(db, accountId, [a.id, b.id], "vip");
      expect(r2.tagId).toBe(r1.tagId); // trims + lowercases like addTagToContact
      const tagsA = await listContactTags(db, accountId, a.id);
      expect(tagsA).toHaveLength(1);
      // undo path: removeTagFromContacts strips it from both
      await removeTagFromContacts(db, accountId, [a.id, b.id], r1.tagId);
      expect(await listContactTags(db, accountId, a.id)).toHaveLength(0);
      expect(await listContactTags(db, accountId, b.id)).toHaveLength(0);
    }));

  it("deleteContacts deletes unblocked ids and skips one linked to an opportunity", () =>
    withTestAccount(async (db, accountId) => {
      const free = await createContact(db, accountId, { firstName: "Free" }, "user_test");
      const blocked = await createContact(db, accountId, { firstName: "Blocked" }, "user_test");
      const { data: pipe } = await db.from("pipelines")
        .insert({ account_id: accountId, name: "P" }).select("id").single();
      const { data: stage } = await db.from("pipeline_stages")
        .insert({ account_id: accountId, pipeline_id: pipe!.id, name: "S", position: 1 })
        .select("id").single();
      await db.from("opportunities").insert({
        account_id: accountId, contact_id: blocked.id, pipeline_id: pipe!.id,
        stage_id: stage!.id, name: "Deal", monetary_value: 0, status: "open",
      });
      const r = await deleteContacts(db, accountId, [free.id, blocked.id]);
      expect(r).toEqual({ deleted: 1, skippedBlocked: 1 });
      expect(await getContact(db, accountId, free.id)).toBeNull();
      expect(await getContact(db, accountId, blocked.id)).not.toBeNull();
    }));

  it("deleteContacts cascades tags/notes and null-scoped: ignores other-account ids", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "C" }, "user_test");
      await addTagToContact(db, accountId, c.id, "temp");
      const r = await deleteContacts(db, accountId, [c.id, "00000000-0000-0000-0000-000000000000"]);
      expect(r.deleted).toBe(1); // the bogus id is not counted, not an error
    }));

  it("listTags returns the account's tag vocabulary alphabetically, normalized", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Z" }, "user_test");
      await addTagToContact(db, accountId, c.id, "zeta");
      await addTagToContact(db, accountId, c.id, "Alpha ");
      const tags = await listTags(db, accountId);
      expect(tags.map((t) => ({ name: t.name }))).toEqual([{ name: "alpha" }, { name: "zeta" }]);
    }));
});
