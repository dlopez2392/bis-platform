import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import {
  createContact, getContact, recordLanguageSignal, setContactLanguage, restoreContactLanguage, keepContactLanguageHint,
  type LanguageTriple,
} from "../contacts";

const ACTOR = "user_test";
const T1 = "2026-10-03T15:00:00.000Z";
const T2 = "2026-10-05T15:00:00.000Z";
const iso = (v: unknown) => (v === null ? null : new Date(v as string).toISOString());

async function eventsOf(db: SupabaseClient, accountId: string, type: string) {
  const { data, error } = await db.from("events").select("actor_type, actor_id, payload").eq("account_id", accountId).eq("type", type);
  if (error) throw new Error(error.message);
  return data;
}
async function ana(db: SupabaseClient, accountId: string) {
  return (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
}

describe("recordLanguageSignal (S-09 §7.1, C3)", () => {
  it("the first sign sets the language and emits once with the CALLER's actor; a later one only moves the last sign and emits nothing (mutation: emit when the rpc said false -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      expect(await recordLanguageSignal(db, accountId, id, { language: "es", source: "booking", at: T1 }, "public", "system")).toBe(true);
      expect(await recordLanguageSignal(db, accountId, id, { language: "en", source: "call", at: new Date(T2) }, "voice", "ai")).toBe(false);
      const c = (await getContact(db, accountId, id))!;
      expect({ ...c, language_set_at: iso(c.language_set_at), last_language_signal_at: iso(c.last_language_signal_at) }).toMatchObject({
        language: "es", language_source: "booking", language_set_at: T1,
        last_language_signal: "en", last_language_signal_source: "call", last_language_signal_at: T2, language_hint_kept_at: null,
      });
      expect(await eventsOf(db, accountId, "contact.language_set")).toEqual([
        { actor_type: "system", actor_id: "public", payload: { contactId: id, language: "es", source: "booking" } },
      ]);
    }));

  it("an rpc error throws, naming the writer (mutation: swallow it -> FAILS)", () => withTestAccount(async (db, accountId) => {
    await expect(recordLanguageSignal(db, accountId, "not-a-uuid", { language: "es", source: "form", at: T1 }, "form", "system"))
      .rejects.toThrow(/recordLanguageSignal failed/);
  }));
});

describe("the staff writers (S-09 §7.5, C9)", () => {
  it("setContactLanguage writes a staff choice now, over any sign, and emits as the user (mutation: source 'booking' -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await recordLanguageSignal(db, accountId, id, { language: "es", source: "booking", at: T1 }, "public", "system");
      const before = Date.now();
      expect(await setContactLanguage(db, accountId, id, "en", ACTOR)).toBe(true);
      const c = (await getContact(db, accountId, id))!;
      expect([c.language, c.language_source]).toEqual(["en", "staff"]);
      expect(Date.parse(c.language_set_at as string)).toBeGreaterThanOrEqual(before - 1000);
      expect((await eventsOf(db, accountId, "contact.language_set")).at(-1)).toEqual(
        { actor_type: "user", actor_id: ACTOR, payload: { contactId: id, language: "en", source: "staff" } });
    }));

  it("restoreContactLanguage puts back the prior triple EXACTLY, its source and time included, only while the row still holds `written` (fix round I3; mutation: restore through setContactLanguage -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await recordLanguageSignal(db, accountId, id, { language: "es", source: "booking", at: T1 }, "public", "system");
      await setContactLanguage(db, accountId, id, "en", ACTOR);
      const afterSet = (await getContact(db, accountId, id))!;
      const written1: LanguageTriple = { language: "en", source: "staff", setAt: iso(afterSet.language_set_at) };
      expect(await restoreContactLanguage(db, accountId, id, { language: "es", source: "booking", setAt: T1 }, written1, ACTOR)).toBe("updated");
      const c = (await getContact(db, accountId, id))!;
      expect([c.language, c.language_source, iso(c.language_set_at)]).toEqual(["es", "booking", T1]);
      const written2: LanguageTriple = { language: "es", source: "booking", setAt: T1 };
      expect(await restoreContactLanguage(db, accountId, id, { language: null, source: null, setAt: null }, written2, ACTOR)).toBe("updated");
      const cleared = (await getContact(db, accountId, id))!;
      expect([cleared.language, cleared.language_source, cleared.language_set_at]).toEqual([null, null, null]);
    }));

  it("restore refuses once the row no longer holds what it claims to undo — a stale Undo, or a forged `written` claiming a source the row never had (fix round I3; mutation: drop the compare-and-set guard -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await setContactLanguage(db, accountId, id, "en", ACTOR);
      const afterFirstSet = (await getContact(db, accountId, id))!;
      const realWritten: LanguageTriple = { language: "en", source: "staff", setAt: iso(afterFirstSet.language_set_at) };
      const prior: LanguageTriple = { language: null, source: null, setAt: null };

      // Stale: someone else changed the language since this Undo was issued — the row no longer holds realWritten.
      await setContactLanguage(db, accountId, id, "es", ACTOR);
      expect(await restoreContactLanguage(db, accountId, id, prior, realWritten, ACTOR)).toBe("changed");
      expect((await getContact(db, accountId, id))!.language).toBe("es");

      // Forged: written.source claims "booking", but the row's real language_source is "staff" —
      // the compare-and-set is against written.source directly, so this can never match.
      const afterSecondSet = (await getContact(db, accountId, id))!;
      const forged: LanguageTriple = { language: afterSecondSet.language as "es", source: "booking", setAt: iso(afterSecondSet.language_set_at) };
      expect(await restoreContactLanguage(db, accountId, id, prior, forged, ACTOR)).toBe("changed");
      expect((await getContact(db, accountId, id))!.language).toBe("es");
    }));

  it("an incoherent prior OR written is refused before anything is written (mutation: drop isLanguageTriple -> the db check raises instead, a different message -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      const validWritten: LanguageTriple = { language: "en", source: "staff", setAt: T1 };
      await expect(restoreContactLanguage(db, accountId, id, { language: "es", source: null, setAt: null }, validWritten, ACTOR))
        .rejects.toThrow(/not a language triple/);
      await expect(restoreContactLanguage(db, accountId, id, { language: "es", source: "import" as never, setAt: T1 }, validWritten, ACTOR))
        .rejects.toThrow(/not a language triple/);
      const validPrior: LanguageTriple = { language: "es", source: "booking", setAt: T1 };
      await expect(restoreContactLanguage(db, accountId, id, validPrior, { language: "es", source: null, setAt: null }, ACTOR))
        .rejects.toThrow(/not a language triple/);
    }));

  it("keepContactLanguageHint stamps only language_hint_kept_at (mutation: also clear the last sign -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await recordLanguageSignal(db, accountId, id, { language: "es", source: "form", at: T1 }, "form", "system");
      await recordLanguageSignal(db, accountId, id, { language: "en", source: "call", at: T2 }, "voice", "ai");
      expect(await keepContactLanguageHint(db, accountId, id, ACTOR)).toBe(true);
      const c = (await getContact(db, accountId, id))!;
      expect([c.language, c.last_language_signal]).toEqual(["es", "en"]);
      expect(c.language_hint_kept_at).not.toBeNull();
    }));

  it("each writer answers false/'changed' for a contact not in this account and writes nothing (mutation: drop .eq('account_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db, otherAccountId) => {
        const theirs = await ana(db, otherAccountId);
        expect(await setContactLanguage(db, accountId, theirs, "es", ACTOR)).toBe(false);
        expect(await keepContactLanguageHint(db, accountId, theirs, ACTOR)).toBe(false);
        const written: LanguageTriple = { language: null, source: null, setAt: null };
        expect(await restoreContactLanguage(db, accountId, theirs, { language: "es", source: "staff", setAt: T1 }, written, ACTOR)).toBe("changed");
        expect((await getContact(db, otherAccountId, theirs))!.language).toBeNull();
      });
    }));
});

/**
 * Fix round (M1, I3): a mocked `db` — no live Postgres from this sandbox, which the "no @bis/db
 * vitest against bis-ci" rule and the lack of a local replica in this environment both rule out for
 * THIS round; the `withTestAccount` suite above exercises the same contract against a real replica
 * once one is available. This block is pure and runs everywhere, proving the compare-and-set and the
 * swallowed-emit-failure directly against the SQL this file builds.
 */
describe("restoreContactLanguage's compare-and-set and M1 (mocked)", () => {
  type Row = { language: "en" | "es" | null; language_source: string | null; language_set_at: string | null };

  /** A fake `.from("contacts").update(...).eq(...).is(...).select()` chain, keyed off ONE row, plus
   *  `.from("events").insert(...)` for `emit`'s own write — matches it against `written`'s three
   *  fields exactly, the same compare the real UPDATE's WHERE clause runs. */
  function fakeDb(row: Row, opts: { emitError?: string } = {}) {
    let matched = true;
    const contacts = {
      update(patch: Record<string, unknown>) {
        const chain = {
          eq(col: string, val: unknown) {
            if (col in row && (row as Record<string, unknown>)[col] !== val) matched = false;
            return chain;
          },
          is(col: string, val: null) {
            if (col in row && (row as Record<string, unknown>)[col] !== val) matched = false;
            return chain;
          },
          async select() {
            if (!matched) return { data: [], error: null };
            Object.assign(row, patch);
            return { data: [{ id: "contact_1" }], error: null };
          },
        };
        return chain;
      },
    };
    const events = {
      async insert() {
        return opts.emitError ? { error: { message: opts.emitError } } : { error: null };
      },
    };
    const db = { from: (table: string) => (table === "contacts" ? contacts : table === "events" ? events : (() => { throw new Error(`fakeDb: unexpected table ${table}`); })()) };
    return db as unknown as SupabaseClient;
  }

  it("restores only while the row still holds `written` exactly (mutation: drop the written.language .eq guard -> FAILS)", async () => {
    const row: Row = { language: "en", language_source: "staff", language_set_at: T1 };
    const written: LanguageTriple = { language: "en", source: "staff", setAt: T1 };
    const prior: LanguageTriple = { language: "es", source: "booking", setAt: T2 };
    expect(await restoreContactLanguage(fakeDb(row), "a1", "c1", prior, written, ACTOR)).toBe("updated");
    expect(row).toMatchObject({ language: "es", language_source: "booking", language_set_at: T2 });
  });

  it("a stale Undo — the row changed since — is refused, writing nothing (mutation: drop the compare-and-set guard -> FAILS)", async () => {
    const row: Row = { language: "es", language_source: "staff", language_set_at: T2 };
    const written: LanguageTriple = { language: "en", source: "staff", setAt: T1 };
    const prior: LanguageTriple = { language: null, source: null, setAt: null };
    expect(await restoreContactLanguage(fakeDb(row), "a1", "c1", prior, written, ACTOR)).toBe("changed");
    expect(row).toMatchObject({ language: "es", language_source: "staff", language_set_at: T2 });
  });

  it("a forged `written` claiming a non-staff source never matches a real staff row (mutation: compare only language, drop the language_source .eq -> FAILS)", async () => {
    const row: Row = { language: "en", language_source: "staff", language_set_at: T1 };
    const forgedWritten: LanguageTriple = { language: "en", source: "booking", setAt: T1 };
    const prior: LanguageTriple = { language: null, source: null, setAt: null };
    expect(await restoreContactLanguage(fakeDb(row), "a1", "c1", prior, forgedWritten, ACTOR)).toBe("changed");
    expect(row.language).toBe("en");
  });

  // Isolates the LANGUAGE column of the compare-and-set: source and setAt both still match the row,
  // so only a dropped `written.language` guard specifically would let this one through.
  it("a `written` whose language alone is wrong never matches, even when source and setAt do (mutation: drop the written.language .eq/.is guard -> FAILS)", async () => {
    const row: Row = { language: "en", language_source: "staff", language_set_at: T1 };
    const wrongLanguage: LanguageTriple = { language: "es", source: "staff", setAt: T1 };
    const prior: LanguageTriple = { language: null, source: null, setAt: null };
    expect(await restoreContactLanguage(fakeDb(row), "a1", "c1", prior, wrongLanguage, ACTOR)).toBe("changed");
    expect(row.language).toBe("en");
  });

  it("M1: an emit failure after the compare-and-set committed is logged, never thrown — the Undo still answers 'updated' (mutation: let the emit error propagate -> FAILS)", async () => {
    const row: Row = { language: "en", language_source: "staff", language_set_at: T1 };
    const written: LanguageTriple = { language: "en", source: "staff", setAt: T1 };
    const prior: LanguageTriple = { language: "es", source: "booking", setAt: T2 };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await restoreContactLanguage(fakeDb(row, { emitError: "events insert failed" }), "a1", "c1", prior, written, ACTOR)).toBe("updated");
    expect(row).toMatchObject({ language: "es", language_source: "booking", language_set_at: T2 });
    expect(spy.mock.calls.flat().join(" ")).toContain("events insert failed");
    spy.mockRestore();
  });

  it("an incoherent `written` is refused before any read (mutation: drop the written isLanguageTriple check -> FAILS)", async () => {
    const row: Row = { language: "en", language_source: "staff", language_set_at: T1 };
    const prior: LanguageTriple = { language: null, source: null, setAt: null };
    await expect(restoreContactLanguage(fakeDb(row), "a1", "c1", prior, { language: "es", source: null, setAt: null } as never, ACTOR))
      .rejects.toThrow(/not a language triple/);
  });
});
