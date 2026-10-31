import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import {
  createContact, listContacts, countContacts, searchContacts, archiveContacts, phoneDigits, type ArchivedFilter,
} from "../contacts";
import { sanitizeSearchTerm } from "../search-term";
import { setContactsBusiness } from "../client-groups";
import { ensureHoldingContact } from "../voice";

/**
 * F-092 part 1 (plan Task 4, spec 4.4): the contact list's search against the real PostgREST and 0108's
 * search_name. CI only (withTestAccount; `db` is serviceDb()). One withTestAccount per `it` (contention:
 * search.test.ts, contacts.test.ts). Every search is read through BOTH listContacts and countContacts, and the
 * rows must equal the count (spec 4.4: the list, its real total and the export share one filter). The pure half,
 * where the mutation probes run, is src/contact-search-filter.test.ts.
 */

/** af5976fa's withSearch, frozen: the oracle for "nobody found today stops being found" (spec D4). */
const TODAY_PHONE_SHAPE = /^[+()\-. \d]+$/;
function todayFilter(search: string): string | null {
  const s = sanitizeSearchTerm(search);
  if (!s) return null;
  const clauses = [`first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`, `email.ilike.%${s}%`, `phone.ilike.%${s}%`];
  if (TODAY_PHONE_SHAPE.test(search)) {
    const d = phoneDigits(search);
    if (d.length >= 4) clauses.push(`phone_key.ilike.%${d.slice(0, 20)}%`);
  }
  return clauses.join(",");
}

async function todayIds(db: SupabaseClient, accountId: string, term: string): Promise<string[]> {
  const f = todayFilter(term);
  if (!f) throw new Error(`no filter for ${term}`);
  const { data, error } = await db.from("contacts").select("id").eq("account_id", accountId)
    .eq("holds_shared_number", false).is("archived_at", null).is("merged_into", null).or(f);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string).sort();
}

/** The ids listContacts returns for `term`, after checking countContacts agrees with them. */
async function found(db: SupabaseClient, accountId: string, term: string, archived?: ArchivedFilter): Promise<string[]> {
  const rows = await listContacts(db, accountId, { search: term, limit: 200, archived });
  const total = await countContacts(db, accountId, { search: term, archived });
  expect(rows.length, `"${term}": rows equal the real total`).toBe(total);
  return rows.map((r) => r.id as string).sort();
}

async function make(db: SupabaseClient, accountId: string, first: string, last?: string, phone?: string): Promise<string> {
  const { id, existing } = await createContact(db, accountId, { firstName: first, lastName: last, phone }, "user_test");
  expect(existing, `${first} ${last ?? ""} is a new contact`).toBe(false);
  return id;
}

const sorted = (...ids: string[]) => [...ids].sort();

describe("contact search: accents, full names and phone shapes (F-092)", () => {
  it("finds every accent, word order and +52 shape, keeps the archived, merged-away and holding records out, and rows equal the count for every term", () =>
    withTestAccount(async (db, a) => {
      const holding = await ensureHoldingContact(db, a, "+19565550199", "voice");
      const mariaGL = await make(db, a, "María", "García López", "+528991234567");
      const mariaG = await make(db, a, "Maria", "Garcia", "+19565550199");
      const ines = await make(db, a, "Inés", "Peña");
      const ines2 = await make(db, a, "Ines", "Pena");
      const jose = await make(db, a, "José", "O'Brien");
      const li = await make(db, a, "李", "王");
      const juan = await make(db, a, "Juan", "Pérez");
      const [business] = await setContactsBusiness(db, a, [{ contactId: juan, name: "Taller Núñez" }], "user_test");
      expect(business?.status).toBe("ok");
      const gloria = await make(db, a, "Gloria", "García");
      expect((await archiveContacts(db, a, [gloria])).changedIds).toEqual([gloria]);
      const merged = await make(db, a, "Garcia", "Merged");
      const { error: mErr } = await db.from("contacts")
        .update({ merged_into: mariaG, merged_at: new Date().toISOString() }).eq("account_id", a).eq("id", merged);
      expect(mErr).toBeNull();

      // Accents and case: one query. Never Gloria (archived), Garcia Merged (merged away) or the holding record.
      for (const t of ["garcia", "GARCÍA", "garcía"]) expect(await found(db, a, t), t).toEqual(sorted(mariaGL, mariaG));
      // Full names, any order (and PostgREST took the nested and(...) inside or(): rows, no error; ASSUMPTION A3).
      for (const t of ["maria garcia", "garcia maria"]) expect(await found(db, a, t), t).toEqual(sorted(mariaGL, mariaG));
      expect(await found(db, a, "maria lopez")).toEqual([mariaGL]);
      // Q1: ñ and n both ways; the apostrophe is a word break; a name the fold empties is found by the raw arms.
      for (const t of ["pena", "peña"]) expect(await found(db, a, t), t).toEqual(sorted(ines, ines2));
      for (const t of ["o'brien", "brien"]) expect(await found(db, a, t), t).toEqual([jose]);
      expect(await found(db, a, "李")).toEqual([li]);
      // Phones: every Mexican shape, the "+" country code, the last four.
      for (const t of ["+52 1 899 123 4567", "044 899 123 4567", "899 123 4567", "+521 899 12"]) {
        expect(await found(db, a, t), t).toEqual([mariaGL]);
      }
      for (const t of ["+1 956 55", "0199", "(956) 555-0199"]) expect(await found(db, a, t), t).toEqual([mariaG]);
      // D3: the business name finds its people.
      expect(await found(db, a, "nunez")).toEqual([juan]);
      // The Archived view searches the archived only; a merged-away record is in neither view.
      expect(await found(db, a, "garcia", "only")).toEqual([gloria]);
      expect(await found(db, a, "caller")).toEqual([]);
      const { data: everyone } = await db.from("contacts").select("id").eq("account_id", a);
      expect(everyone?.map((r) => r.id)).toEqual(expect.arrayContaining([holding.id, merged, gloria]));
      expect(await found(db, a, "merged")).toEqual([]);

      // The superset: whatever today's filter finds, the new one finds.
      for (const t of ["garcia", "GARCÍA", "maria garcia", "maria lopez", "pena", "peña", "o'brien", "李",
        "+52 1 899 123 4567", "044 899 123 4567", "899 123 4567", "+521 899 12", "+1 956 55", "0199",
        "(956) 555-0199", "nunez", "Maria", "López"]) {
        const now = await found(db, a, t);
        for (const id of await todayIds(db, a, t)) expect(now, `"${t}" still finds ${id}`).toContain(id);
      }
    }));

  it("keeps today's own phone_key clause where the new key would not reach: a pre-F-009 +521 number and a key that merely holds 1956 are still found (mutation: emit only the new key -> FAILS)", () =>
    withTestAccount(async (db, a) => {
      // Stored before F-009 dropped Mexico's retired mobile 1: a direct insert, as createContact would normalise it.
      const { data, error } = await db.from("contacts")
        .insert({ account_id: a, first_name: "Legacy", phone: "+5218991234567", author_kind: "person" }).select("id").single();
      expect(error).toBeNull();
      const legacy = data!.id as string;
      const coincidence = await make(db, a, "Coincidence", undefined, "+19562195612");
      const other = await make(db, a, "Other", undefined, "+19565550123");

      expect(await todayIds(db, a, "+521 899 12")).toEqual([legacy]);
      expect(await found(db, a, "+521 899 12")).toEqual([legacy]);
      expect(await todayIds(db, a, "+1 956")).toEqual([coincidence]);
      expect(await found(db, a, "+1 956")).toEqual([coincidence]);
      // And the national ten reaches the legacy shape, which today's digits could not.
      expect(await todayIds(db, a, "+52 1 899 123 4567")).toEqual([legacy]);
      expect(await found(db, a, "+52 1 899 123 4567")).toEqual([legacy]);
      expect(await todayIds(db, a, "044 899 123 4567")).toEqual([]);
      expect(await found(db, a, "044 899 123 4567")).toEqual([legacy]);
      expect(await found(db, a, "0123")).toEqual([other]);
    }));
});

describe("searchContacts: the small boxes show the best match first (F-092, plan Task 5)", () => {
  it("exact, then every word starts a word, then contains, each by sort_name; never an archived record; PostgREST took every tier's string", () =>
    withTestAccount(async (db, a) => {
      const anaG = await make(db, a, "Ana", "García");
      const juana = await make(db, a, "Juana", "Ana Pérez");
      const mariana = await make(db, a, "Mariana", "Ruiz");
      const susana = await make(db, a, "Susana", "Díaz");
      // Sorts BEFORE Ana García ("adriana garcía" < "ana garcía") but only contains "ana": a box that ranked by
      // sort_name alone would put her first.
      const adriana = await make(db, a, "Adriana", "García");
      // Sorts first of all and has a business word "Ana": every word of "ana garcia" starts a word, but the
      // whole name is not "ana garcia", so the exact tier puts Ana García ahead of him.
      const aaron = await make(db, a, "Aaron", "García");
      const [biz] = await setContactsBusiness(db, a, [{ contactId: aaron, name: "Ana Taller" }], "user_test");
      expect(biz?.status).toBe("ok");
      // An archived "Ana" would be the one exact match for "ana": the box must never show her.
      const archivedAna = await make(db, a, "Ana");
      expect((await archiveContacts(db, a, [archivedAna])).changedIds).toEqual([archivedAna]);

      const ids = async (term: string, limit: number) =>
        (await searchContacts(db, a, { term, limit })).map((r) => r.id as string);

      // Tier 2 (Aaron, Ana García, Juana Ana Pérez by sort_name), then tier 3's rest (Adriana, Mariana, Susana).
      expect(await ids("ana", 10)).toEqual([aaron, anaG, juana, adriana, mariana, susana]);
      expect(await ids("ana", 4)).toEqual([aaron, anaG, juana, adriana]);
      // Exact first, though Aaron sorts ahead of her; then tier 2's Aaron; then Adriana, who only contains "ana".
      expect(await ids("ana garcia", 5)).toEqual([anaG, aaron, adriana]);
      expect(await ids("ANA GARCÍA", 5)).toEqual([anaG, aaron, adriana]);
      // Whoever the box finds, the list's own filter finds (the same filter, so never a stranger).
      for (const t of ["ana", "ana garcia"]) {
        const list = (await listContacts(db, a, { search: t, limit: 200 })).map((r) => r.id as string);
        expect(list, t).toEqual(expect.arrayContaining(await ids(t, 50)));
        expect(list, t).not.toContain(archivedAna);
      }
    }));
});
