import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import {
  createContact, getContact, recordLanguageSignal, setContactLanguage, restoreContactLanguage, keepContactLanguageHint,
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

  it("restoreContactLanguage puts back the prior triple EXACTLY, its source and time included (mutation: restore through setContactLanguage -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await recordLanguageSignal(db, accountId, id, { language: "es", source: "booking", at: T1 }, "public", "system");
      await setContactLanguage(db, accountId, id, "en", ACTOR);
      expect(await restoreContactLanguage(db, accountId, id, { language: "es", source: "booking", setAt: T1 }, ACTOR)).toBe(true);
      const c = (await getContact(db, accountId, id))!;
      expect([c.language, c.language_source, iso(c.language_set_at)]).toEqual(["es", "booking", T1]);
      expect(await restoreContactLanguage(db, accountId, id, { language: null, source: null, setAt: null }, ACTOR)).toBe(true);
      const cleared = (await getContact(db, accountId, id))!;
      expect([cleared.language, cleared.language_source, cleared.language_set_at]).toEqual([null, null, null]);
    }));

  it("an incoherent prior is refused before anything is written (mutation: drop isLanguageTriple -> the db check raises instead, a different message -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await expect(restoreContactLanguage(db, accountId, id, { language: "es", source: null, setAt: null }, ACTOR))
        .rejects.toThrow(/not a language triple/);
      await expect(restoreContactLanguage(db, accountId, id, { language: "es", source: "import" as never, setAt: T1 }, ACTOR))
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

  it("each writer answers false for a contact not in this account and writes nothing (mutation: drop .eq('account_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db, otherAccountId) => {
        const theirs = await ana(db, otherAccountId);
        expect(await setContactLanguage(db, accountId, theirs, "es", ACTOR)).toBe(false);
        expect(await keepContactLanguageHint(db, accountId, theirs, ACTOR)).toBe(false);
        expect(await restoreContactLanguage(db, accountId, theirs, { language: "es", source: "staff", setAt: T1 }, ACTOR)).toBe(false);
        expect((await getContact(db, otherAccountId, theirs))!.language).toBeNull();
      });
    }));
});
