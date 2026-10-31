import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { withRollback } from "./db";
import {
  createContact, listContacts, countContacts, searchContacts, archiveContacts, phoneDigits, contactSearchFilter,
  type ArchivedFilter,
} from "../contacts";
import { serviceDb } from "../service";
import { userDb } from "../user-client";
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

describe("searchContacts never reaches into another account (F-092 final review T5-M1)", () => {
  // `db` is serviceDb(), which RLS does not narrow, so `.eq("account_id", …)` in searchContacts is the ONLY thing that
  // keeps account B's Ana García out of account A's box — the same filter the agency's own session leans on, since
  // the agency reads every account. Every tier is asked: exact name, every-word-starts, contains, and a phone.
  it("an Ana García in another account is never returned, by any tier (mutation: drop searchContacts' .eq(\"account_id\", accountId) -> FAILS)", () =>
    withTestAccount(async (db, a) => {
      const mine = await make(db, a, "Ana", "Ruiz", "+19565550111");
      await withTestAccount(async (_db, b) => {
        const theirs = await make(db, b, "Ana", "García", "+19565550142");
        const ids = async (account: string, term: string) =>
          (await searchContacts(db, account, { term, limit: 50 })).map((r) => r.id as string);
        // Account A's box never finds her; "ana" still finds A's own Ana Ruiz, so the call itself works.
        for (const t of ["ana garcia", "garc", "0142", "(956) 555-0142"]) expect(await ids(a, t), `A, "${t}"`).toEqual([]);
        expect(await ids(a, "ana")).toEqual([mine]);
        // Control: account B's own box finds her by every one of those terms, so each one could have leaked.
        for (const t of ["ana garcia", "ana", "garc", "0142", "(956) 555-0142"]) expect(await ids(b, t), `B, "${t}"`).toEqual([theirs]);
      });
    }));
});

/**
 * F-092 scale follow-up (spec 4.4, 4.6; plan T6): since 0110 every searched read in this file goes through
 * public.contacts_matching (listContacts and searchContacts as a GET, countContacts as a HEAD). The cases above
 * read it through serviceDb(), which is the matcher's service_role branch end to end. These hold it to the F-092
 * filter it replaced: contactSearchFilter's own `.or()` on the table, under the SAME client, rows and count.
 */

/** The F-092 filter's answer (contactSearchFilter, the oracle 0110's matcher is held to), on the table itself. */
async function filterIds(db: SupabaseClient, accountId: string, term: string, archived: ArchivedFilter = "exclude"): Promise<string[]> {
  const f = contactSearchFilter(term);
  if (!f) throw new Error(`no filter for ${term}`);
  const base = db.from("contacts").select("id").eq("account_id", accountId).eq("holds_shared_number", false)
    .is("merged_into", null).or(f);
  const { data, error } = await (archived === "only" ? base.not("archived_at", "is", null) : base.is("archived_at", null)).limit(1000);
  if (error) throw new Error(`filterIds("${term}"): ${error.message}`);
  return (data ?? []).map((r) => r.id as string).sort();
}

/** Every term this file reads above, plus the shapes 0110 handles on its own path: one and two characters (read
 *  byte-wise, owner ruling Q2), a bare underscore (sent escaped), "null" and braces (a GET carries the text in the
 *  URL, where postgrest-js writes a null as the string "null"), an uppercase Ñ (byte-wise misses it on the raw arms;
 *  the folded search_name still finds it, spec 3.8), a Cyrillic name typed three ways, and a term nobody matches. */
const TERMS = [
  "garcia", "GARCÍA", "garcía", "maria garcia", "garcia maria", "maria lopez", "pena", "peña", "o'brien", "brien",
  "李", "+52 1 899 123 4567", "044 899 123 4567", "899 123 4567", "+521 899 12", "+1 956 55", "+1 956", "0199",
  "(956) 555-0199", "nunez", "Taller Núñez", "Maria", "López", "caller", "merged", "ana", "ma", "a", "m", "Ñ", "_",
  "john_doe", "maria.garcia@example.com", "null", "{x}", "Иван", "ИВАНОВ", "иванов", "ива", "zzqx",
];

type Corpus = {
  all: string[]; legacy: string; cyrUpper: string; cyrMixed: string; cyrLower: string; mariaGL: string; ana: string;
  gloria: string;
};
async function seedCorpus(db: SupabaseClient, a: string, n: number): Promise<Corpus> {
  await ensureHoldingContact(db, a, "+19565550199", "voice");
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
  // Stored before F-009 dropped Mexico's retired mobile 1: only the kept phone key finds it by "+521 899 12".
  const { data: lg, error: lErr } = await db.from("contacts")
    .insert({ account_id: a, first_name: "Legacy", phone: "+5218991234567", author_kind: "person" }).select("id").single();
  expect(lErr).toBeNull();
  const legacy = lg!.id as string;
  const ana = await make(db, a, "Ana", "Ruiz", `+1956555${String(1100 + n)}`);
  const mariana = await make(db, a, "Mariana", "Santana");
  const john = await make(db, a, "john", "doe");
  const { error: jErr } = await db.from("contacts").update({ email: `john_doe${n}@example.com` }).eq("id", john);
  expect(jErr).toBeNull();
  const { error: eErr } = await db.from("contacts").update({ email: "maria.garcia@example.com" }).eq("id", mariaGL);
  expect(eErr).toBeNull();
  const nul = await make(db, a, "Nullington", "Reyes");
  const brace = await make(db, a, "Curly{x}", "Braces");
  const cyrUpper = await make(db, a, "Иван", "ИВАНОВ");
  const cyrMixed = await make(db, a, "Иван", "Иванов");
  const cyrLower = await make(db, a, "иван", "иванов");
  return {
    all: [mariaGL, mariaG, ines, ines2, jose, li, juan, gloria, merged, legacy, ana, mariana, john, nul, brace,
      cyrUpper, cyrMixed, cyrLower],
    legacy, cyrUpper, cyrMixed, cyrLower, mariaGL, ana, gloria,
  };
}

describe("through the matcher, the list answers exactly what the F-092 filter answered (plan T6)", () => {
  it("rows and real total equal contactSearchFilter's for every term, in two accounts and both views; a two-letter search in another alphabet reads byte-wise (owner ruling Q2) (mutations: drop the kept phone key from the args -> FAILS; send no p_tokens -> FAILS; skip withArchived on the searched path -> FAILS)", () =>
    withTestAccount(async (db, a) => {
      await withTestAccount(async (_db, b) => {
        const A = await seedCorpus(db, a, 1);
        const B = await seedCorpus(db, b, 2);
        for (const [label, acct, mine, theirs] of [["A", a, A, B], ["B", b, B, A]] as const) {
          for (const t of TERMS) {
            const want = await filterIds(db, acct, t);
            expect(await found(db, acct, t), `${label}, "${t}"`).toEqual(want);
            for (const id of want) expect(theirs.all, `${label}, "${t}": never the other account's row`).not.toContain(id);
          }
          // Not vacuous: these terms reach the words, the kept key, a "null" text and braces, and each finds someone.
          expect(await found(db, acct, "maria lopez"), label).toEqual([mine.mariaGL]);
          // Legacy only by the kept key (5218991...); María García López by the new one (5289912 in 528991234567).
          expect(await found(db, acct, "+521 899 12"), label).toEqual(sorted(mine.legacy, mine.mariaGL));
          expect((await found(db, acct, "null")).length, label).toBe(1);
          expect((await found(db, acct, "{x}")).length, label).toBe(1);
          for (const t of ["garcia", "ma", "g", "zzqx"]) {
            expect(await found(db, acct, t, "only"), `${label}, "${t}", archived`).toEqual(await filterIds(db, acct, t, "only"));
          }
          expect(await found(db, acct, "garcia", "only"), label).toEqual([mine.gloria]);
        }
        // Owner ruling Q2, the one designed difference: two characters in another alphabet, typed in the other case.
        expect(await filterIds(db, a, "ив")).toEqual(sorted(A.cyrUpper, A.cyrMixed, A.cyrLower));
        expect(await found(db, a, "ив")).toEqual([A.cyrLower]);
        // From three characters the index reads the term under the column's own (case-folding) collation.
        expect(await found(db, a, "ива")).toEqual(sorted(A.cyrUpper, A.cyrMixed, A.cyrLower));
      });
    }));
});

/**
 * The same comparison as a signed-in Owner, a Technician and the agency, through the replica's real PostgREST: the
 * matcher's own account and Technician gates, then RLS on what it returns, against the F-092 filter under the same
 * RLS. It needs the replica's JWT secret, which only a local run has (CI's stack never exposes its own): without it
 * the case is SKIPPED, and a skip is not a pass. contact-match-schema.test.ts holds the same property per role at the
 * SQL level on every run (spec 4.6 items 6 and 7).
 */
const SECRET = process.env.BIS_REPLICA_JWT_SECRET;
function signJwt(payload: Record<string, unknown>, secret: string): string {
  const b64 = (b: Buffer) => b.toString("base64url");
  const head = b64(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${head}.${body}.${b64(createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
}

describe("as an Owner, a Technician and the agency (signed tokens; local replica only)", () => {
  it.skipIf(!SECRET)("each one's rows and total through the matcher equal the F-092 filter's under the same RLS; an Owner or Technician of A asking about B gets nothing, though B has matches; a Technician gets only their own", () =>
    withTestAccount(async (db, a) => {
      await withTestAccount(async (_db, b) => {
        const A = await seedCorpus(db, a, 1);
        const B = await seedCorpus(db, b, 2);
        const exp = Math.floor(Date.now() / 1000) + 600;
        const svc = serviceDb();
        const { data: acct, error: aErr } = await db.from("accounts").update({ client_access_enabled: true })
          .eq("id", a).select("clerk_org_id").single();
        if (aErr) throw new Error(aErr.message);
        const org = (acct as { clerk_org_id: string }).clerk_org_id;
        const subs: string[] = [];
        const member = async (role: "owner" | "technician") => {
          const sub = `u_t6_${role}_${Math.random().toString(36).slice(2, 10)}`;
          subs.push(sub);
          const u = await svc.from("users").insert({ clerk_user_id: sub, email: `${sub}@example.com` }).select("id").single();
          if (u.error) throw new Error(u.error.message);
          const id = (u.data as { id: string }).id;
          const m = await svc.from("memberships").insert({ user_id: id, scope: "account", account_id: a, role }).select("id").single();
          if (m.error) throw new Error(m.error.message);
          return { id, db: userDb(signJwt({ role: "authenticated", org_id: org, sub, exp }, SECRET!)) };
        };
        try {
          const owner = await member("owner");
          const tech = await member("technician");
          const agency = userDb(signJwt(
            { role: "authenticated", org_id: "org_agency", app_role: "agency_admin", sub: `u_t6_agency_${Date.now()}`, exp }, SECRET!));
          const techIds = sorted(A.mariaGL, A.ana, A.cyrUpper, A.gloria);
          const { error: tErr } = await db.from("contacts").update({ assigned_to: tech.id }).in("id", techIds);
          if (tErr) throw new Error(tErr.message);

          for (const [label, user] of [["owner", owner.db], ["technician", tech.db], ["agency", agency]] as const) {
            for (const t of TERMS) {
              expect(await found(user, a, t), `${label}, "${t}"`).toEqual(await filterIds(user, a, t));
            }
            expect(await found(user, a, "garcia", "only"), `${label}, archived`).toEqual(await filterIds(user, a, "garcia", "only"));
          }
          // The Technician: a real answer, and only their own rows.
          expect(await found(tech.db, a, "maria")).toEqual([A.mariaGL]);
          expect(await found(tech.db, a, "garcia", "only")).toEqual([A.gloria]);
          for (const t of ["garcia", "ana", "ma", "ива", "0199"]) {
            for (const id of await found(tech.db, a, t)) expect(techIds, `technician, "${t}"`).toContain(id);
          }
          // The second account: A's Owner and Technician get nothing; the agency, the control, gets B's matches.
          for (const t of ["garcia", "ana", "ma", "0199", "+521 899 12"]) {
            expect(await found(owner.db, b, t), `owner of A on B, "${t}"`).toEqual([]);
            expect(await found(tech.db, b, t), `technician of A on B, "${t}"`).toEqual([]);
            expect(await searchContacts(owner.db, b, { term: t, limit: 5 }), `owner of A, box on B, "${t}"`).toEqual([]);
            const theirs = await found(agency, b, t);
            expect(theirs.length, `agency on B, "${t}"`).toBeGreaterThan(0);
            expect(theirs, `agency on B, "${t}"`).toEqual(await filterIds(agency, b, t));
            for (const id of theirs) expect(B.all, `agency on B, "${t}"`).toContain(id);
          }
          // The box, as the Owner: every hit is in the list's own match set.
          for (const t of ["ana", "garcia", "maria lopez"]) {
            const list = await found(owner.db, a, t);
            const box = (await searchContacts(owner.db, a, { term: t, limit: 50 })).map((r) => r.id as string);
            expect(box.length, t).toBeGreaterThan(0);
            expect(list, t).toEqual(expect.arrayContaining(box));
          }
        } finally {
          for (const sub of subs) {
            const { data: u } = await svc.from("users").select("id").eq("clerk_user_id", sub).maybeSingle();
            if (u) {
              const uid = (u as { id: string }).id;
              const { error: cErr } = await svc.from("contacts").update({ assigned_to: null }).eq("assigned_to", uid);
              if (cErr) throw new Error(`assignment cleanup failed: ${cErr.message}`);
              const { error: mErr } = await svc.from("memberships").delete().eq("user_id", uid);
              if (mErr) throw new Error(`memberships cleanup failed: ${mErr.message}`);
            }
            const { error } = await svc.from("users").delete().eq("clerk_user_id", sub);
            if (error) throw new Error(`users cleanup failed: ${error.message}`);
          }
        }
      });
    }));
});

/**
 * Spec 4.6: the matcher is reached as a GET (or a HEAD for the count), and the statement PostgREST builds for that
 * call is inlined, so the list's own filters, order and limit reach public.contacts. A POST sends the arguments in
 * a JSON body, which PostgreSQL does not inline (spec 3.6). Read twice: the HTTP method of every request to the
 * function, and, from pg_stat_statements, the statement PostgREST sent for each, explained as a generic plan.
 * ASSUMPTION (spec 4.6): pg_stat_statements is installed where the suite runs (hosted Supabase has it in the
 * extensions schema; the CLI's images are believed to). If it is not, this case FAILS saying so; it never skips.
 */
describe("the matcher is called as a GET or a HEAD, and PostgreSQL inlines the statement PostgREST sends", () => {
  type Stat = { k: string; calls: number; query: string };
  async function matcherStatements(): Promise<Stat[]> {
    let out: Stat[] = [];
    await withRollback(async (c) => {
      const { rows: [ext] } = await c.query<{ nspname: string }>(
        "select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_stat_statements'");
      if (!ext) throw new Error("pg_stat_statements is not installed here: spec 4.6's ASSUMPTION failed (use its log_min_duration_statement fallback)");
      const { rows } = await c.query<Stat>(
        `select s.userid::text || ':' || s.queryid::text as k, s.calls::int as calls, s.query
           from ${ext.nspname}.pg_stat_statements s where s.query like '%"public"."contacts_matching"(%'`);
      out = rows;
    });
    return out;
  }

  it("every request to contacts_matching is a GET or a HEAD, and every statement they produced plans with no Function Scan on contacts_matching (mutations: listContacts and searchContacts without get: true -> FAILS; a SET clause on contacts_matching, which stops the inlining -> FAILS)", () =>
    withTestAccount(async (db, a) => {
      await make(db, a, "María", "García López", "+528991234567");
      await make(db, a, "Ana", "García");
      const methods: string[] = [];
      const recorded = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
        global: {
          fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes("/rpc/contacts_matching")) methods.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
            return fetch(input, init);
          },
        },
      });
      const before = new Map((await matcherStatements()).map((s) => [s.k, s.calls]));
      expect(await found(recorded, a, "garcia")).toHaveLength(2);
      expect(await found(recorded, a, "+52 1 899 123 4567")).toHaveLength(1);
      await listContacts(recorded, a, { search: "ana garcia", sort: { key: "name", dir: "asc" }, limit: 51 });
      expect(await searchContacts(recorded, a, { term: "ana garcia", limit: 5 })).not.toEqual([]);
      expect(methods.length, "the reads above reached the matcher").toBe(2 + 2 + 1 + 3);
      expect(methods.filter((m) => m !== "GET" && m !== "HEAD"), "never a POST").toEqual([]);
      expect(methods.filter((m) => m === "HEAD"), "the two counts").toHaveLength(2);

      const mine = (await matcherStatements()).filter((s) => s.calls > (before.get(s.k) ?? 0));
      expect(mine.length, "pg_stat_statements recorded what PostgREST sent").toBeGreaterThan(0);
      await withRollback(async (c) => {
        for (const s of mine) {
          // A POST's statement reads its arguments out of a JSON body (json_to_record over the body parameter).
          expect(s.query, "the arguments are bound parameters, not a JSON body").not.toMatch(/json_to_record|pgrst_body/);
          expect(s.query, "the arguments are bound parameters").toMatch(/"public"\."contacts_matching"\("p_account_id" := \$1/);
          const { rows } = await c.query<{ "QUERY PLAN": string }>(`explain (generic_plan) ${s.query}`);
          const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
          expect(plan, s.query.slice(0, 300)).not.toMatch(/Function Scan on contacts_matching/);
          expect(plan, s.query.slice(0, 300)).toMatch(/ on contacts /);
        }
      });
    }));
});
