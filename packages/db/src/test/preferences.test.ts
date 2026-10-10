import { describe, it, expect, afterAll } from "vitest";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { listAccountTeam } from "../team";
import {
  isPersonTheme, prefsFromRow, NO_PREFS, readPersonPrefs, readAccountRoleAndPrefs, savePersonPreference,
} from "../preferences";

const RUN = Math.random().toString(36).slice(2, 10);
const AGENCY = `user_prefs_agency_${RUN}`;
const OTHER = `user_prefs_other_${RUN}`;
const MEMBER = `user_prefs_member_${RUN}`;
const profile = (sub: string) => async () => ({ email: `${sub}@example.com`, name: "Pat" });

afterAll(async () => {
  await serviceDb().from("users").delete().in("clerk_user_id", [AGENCY, OTHER, MEMBER]);
});

describe("pure narrowing", () => {
  it("isPersonTheme takes exactly the three values (mutation: accept any string -> FAILS)", () => {
    for (const v of ["light", "dark", "system"]) expect(isPersonTheme(v)).toBe(true);
    for (const v of ["blue", "", null, undefined, 1, "Dark"]) expect(isPersonTheme(v)).toBe(false);
  });
  it("prefsFromRow reads an unknown value as no choice and never throws (mutation: cast instead of narrow -> FAILS)", () => {
    expect(prefsFromRow({ language: "fr", theme: "blue" })).toEqual(NO_PREFS);
    expect(prefsFromRow(null)).toEqual(NO_PREFS);
    expect(prefsFromRow({ language: "es", theme: "system" })).toEqual({ language: "es", theme: "system" });
  });
});

describe("savePersonPreference", () => {
  it("creates an agency person's row on first save with NO membership, and no team ever lists it (mutation: also addAccountMember -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const r = await savePersonPreference(db, AGENCY, { field: "theme", value: "dark" }, profile(AGENCY));
      expect(r).toEqual({ outcome: "saved", previous: null });
      const { data: u } = await db.from("users").select("id, theme, email").eq("clerk_user_id", AGENCY).single();
      expect(u).toMatchObject({ theme: "dark", email: `${AGENCY}@example.com` });
      const { count } = await db.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", u!.id);
      expect(count).toBe(0);
      expect((await listAccountTeam(db, accountId)).map((m) => m.clerkUserId)).not.toContain(AGENCY);
    });
  });

  it("returns the previous value, for Undo (mutation: read previous after the write -> FAILS)", async () => {
    const db = serviceDb();
    await savePersonPreference(db, AGENCY, { field: "language", value: "es" }, profile(AGENCY));
    expect(await savePersonPreference(db, AGENCY, { field: "language", value: "en" }, profile(AGENCY)))
      .toEqual({ outcome: "saved", previous: "es" });
    expect(await savePersonPreference(db, AGENCY, { field: "language", value: null }, profile(AGENCY)))
      .toEqual({ outcome: "saved", previous: "en" });
  });

  it("changes only the caller's row (mutation: drop the clerk_user_id filter on the update -> FAILS)", async () => {
    const db = serviceDb();
    await savePersonPreference(db, OTHER, { field: "theme", value: "light" }, profile(OTHER));
    await savePersonPreference(db, AGENCY, { field: "theme", value: "system" }, profile(AGENCY));
    expect(await readPersonPrefs(db, OTHER)).toEqual({ language: null, theme: "light" });
  });

  it("writes only the named field (mutation: send both columns on update -> FAILS)", async () => {
    const db = serviceDb();
    await savePersonPreference(db, OTHER, { field: "language", value: "es" }, profile(OTHER));
    expect(await readPersonPrefs(db, OTHER)).toEqual({ language: "es", theme: "light" });
  });

  it("no profile and no row means nothing is written (mutation: insert with an empty email -> FAILS)", async () => {
    const sub = `user_prefs_noprofile_${RUN}`;
    expect(await savePersonPreference(serviceDb(), sub, { field: "theme", value: "dark" }, async () => null))
      .toEqual({ outcome: "no_profile" });
    expect(await readPersonPrefs(serviceDb(), sub)).toBeNull();
  });

  it("refuses an unlisted value before any query (mutation: drop the guard -> FAILS: the DB check message differs)", async () => {
    await expect(savePersonPreference(serviceDb(), AGENCY, { field: "theme", value: "blue" as never }, profile(AGENCY)))
      .rejects.toThrow(/savePersonPreference: unlisted theme/);
  });
});

describe("readAccountRoleAndPrefs", () => {
  it("returns role and prefs from one read; null with no membership (mutation: default a missing membership to owner -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await readAccountRoleAndPrefs(db, accountId, MEMBER)).toBeNull();
      const { data: u } = await db.from("users")
        .insert({ clerk_user_id: MEMBER, email: `${MEMBER}@example.com`, language: "es", theme: "dark" }).select("id").single();
      await db.from("memberships").insert({ scope: "account", account_id: accountId, user_id: u!.id, role: "staff" });
      expect(await readAccountRoleAndPrefs(db, accountId, MEMBER))
        .toEqual({ role: "staff", prefs: { language: "es", theme: "dark" } });
    });
  });
});
