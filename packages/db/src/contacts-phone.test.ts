import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneFields, phoneKeyOf, createContact, phoneDigits } from "./contacts";

/**
 * F-009 on write (consent chain spec §4.1 item 1): every contact write
 * stores the normalised number and the flag together, and dedupes on the
 * key of what it WILL store. Pure; the live writes are CI-only
 * (src/test/contacts-phone-live.test.ts).
 */
describe("phoneFields", () => {
  it("a US number is stored as E.164, unflagged", () => {
    expect(phoneFields("(956) 292-1696")).toEqual({ phone: "+19562921696", phone_country_unconfirmed: false });
  });

  it("a plainly Mexican ten digits is stored as +52, unflagged (mutation: always +1 → FAILS)", () => {
    expect(phoneFields("899 922 1234")).toEqual({ phone: "+528999221234", phone_country_unconfirmed: false });
  });

  it("an ambiguous ten digits is stored as +1 AND flagged (mutation: drop the flag → FAILS)", () => {
    expect(phoneFields("55 1234 5678")).toEqual({ phone: "+15512345678", phone_country_unconfirmed: true });
  });

  it("what the normaliser cannot read is kept as typed, trimmed, unflagged — never dropped", () => {
    expect(phoneFields("  ext. 12  ")).toEqual({ phone: "ext. 12", phone_country_unconfirmed: false });
  });

  it("blank is null, unflagged", () => {
    expect(phoneFields("   ")).toEqual({ phone: null, phone_country_unconfirmed: false });
    expect(phoneFields(null)).toEqual({ phone: null, phone_country_unconfirmed: false });
  });
});

describe("phoneKeyOf — the dedupe key of the number as it will be stored", () => {
  it("a Mexican number keys on its +52 digits, so it does NOT collide with the same ten digits under +1 (mutation: key the raw digits → FAILS)", () => {
    expect(phoneKeyOf("899 922 1234")).toBe("528999221234");
    expect(phoneKeyOf("+1 899 922 1234")).not.toBe(phoneKeyOf("899 922 1234"));
  });

  it("the same US number spelled two ways keys the same", () => {
    expect(phoneKeyOf("(956) 292-1696")).toBe(phoneKeyOf("+19562921696"));
  });

  it("blank is the empty key", () => {
    expect(phoneKeyOf("")).toBe("");
    expect(phoneKeyOf(undefined)).toBe("");
  });
});

/**
 * Review R1-I3: 0033's phone_key is the stored DIGITS, so a contact saved
 * before F-009 as "899 922 1234" keys 8999221234 while its +52 reading keys
 * 528999221234. An in-memory PostgREST stand-in (select/eq/limit, insert)
 * is enough to drive createContact's dedupe; the live path is
 * test/contacts-phone-live.test.ts (CI).
 */
type Row = Record<string, unknown>;
function memoryDb(contacts: Row[]) {
  const tables: { contacts: Row[]; contact_duplicate_flags: Row[]; events: Row[] } & Record<string, Row[]> = { contacts, contact_duplicate_flags: [], events: [] };
  let nextId = 1;
  /** Every read, as the filters it was asked for: what a lookup must NOT ask is testable. */
  const reads: [string, unknown][][] = [];
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        limit: (n: number) => {
          reads.push([...filters]);
          return Promise.resolve({ data: tables[table]!.filter((r) => filters.every(([k, v]) => r[k] === v)).slice(0, n), error: null });
        },
        insert: (row: Row) => {
          const stored: Row = { ...row, id: `new-${nextId++}` };
          if (table === "contacts") stored.phone_key = stored.phone ? phoneDigits(String(stored.phone)) : null;
          tables[table]!.push(stored);
          const done = Promise.resolve({ data: null, error: null });
          return Object.assign(done, { select: () => ({ single: () => Promise.resolve({ data: { id: stored.id }, error: null }) }) });
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, tables, reads };
}

describe("createContact: a +52 number meets the contact stored before F-009 (review R1-I3)", () => {
  it("a contact stored as bare \"899 922 1234\" IS the new +52 write: no second contact (mutation: drop the bare-ten fallback → a duplicate is inserted, FAILS)", async () => {
    const m = memoryDb([{ id: "c-old", account_id: "a1", phone: "899 922 1234", phone_key: "8999221234" }]);
    expect(await createContact(m.db, "a1", { phone: "899-922-1234" }, "user_test")).toEqual({ id: "c-old", existing: true, flagged: false });
    expect(m.tables.contacts).toHaveLength(1);
  });

  it("the same ten digits stored as +1 are a country TWIN: a new contact, and the pair queued for the merge tool (mutation: treat the twin as the same contact → FAILS)", async () => {
    const m = memoryDb([{ id: "c-us", account_id: "a1", phone: "+18999221234", phone_key: "8999221234" }]);
    const created = await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test");
    expect(created).toMatchObject({ existing: false, flagged: true });
    expect(m.tables.contacts.find((r) => r.id === created.id)).toMatchObject({ phone: "+528999221234", phone_country_unconfirmed: false });
    expect(m.tables.contact_duplicate_flags).toEqual([expect.objectContaining({
      account_id: "a1", contact_a: [created.id, "c-us"].sort()[0], contact_b: [created.id, "c-us"].sort()[1], reason: "phone_country_twin",
    })]);
  });

  it("a +52 contact already stored as +52 is found by its own key, with no fallback read (mutation: run the fallback even after a hit → a second read, FAILS)", async () => {
    const m = memoryDb([{ id: "c-mx", account_id: "a1", phone: "+528999221234", phone_key: "528999221234" }]);
    expect(await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test")).toMatchObject({ id: "c-mx", existing: true });
    expect(m.reads.map((r) => r.find(([k]) => k === "phone_key")?.[1])).toEqual(["528999221234"]);
  });

  it("a +1 number never takes the +52 fallback (mutation: drop the /^52\\d{10}$/ guard → a second phone_key read, FAILS)", async () => {
    const n = memoryDb([]);
    expect(await createContact(n.db, "a1", { phone: "(956) 292-1696" }, "user_test")).toMatchObject({ existing: false, flagged: false });
    expect(n.reads.map((r) => r.find(([k]) => k === "phone_key")?.[1])).toEqual(["9562921696"]);
  });

  it("an EMAIL match still queues the country twin its +52 number found (re-review minor 12; mutation: return the email match without the flag → FAILS)", async () => {
    const m = memoryDb([
      { id: "c-email", account_id: "a1", email_key: "ana@example.com", phone: null, phone_key: null },
      { id: "c-us", account_id: "a1", phone: "+18999221234", phone_key: "8999221234" },
    ]);
    expect(await createContact(m.db, "a1", { email: "ana@example.com", phone: "899 922 1234" }, "user_test"))
      .toEqual({ id: "c-email", existing: true, flagged: true });
    expect(m.tables.contact_duplicate_flags).toEqual([expect.objectContaining({
      contact_a: "c-email", contact_b: "c-us", reason: "phone_country_twin",
    })]);
  });
});
