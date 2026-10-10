import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NO_PREFS } from "@bis/db";
import { STORED_READ_FAILED, type StoredPerson } from "@/lib/team/ensure-role";
import { resolvePersonPrefsWith, readPersonPrefsOrThrowWith } from "./person-prefs";

const es = { language: "es", theme: "dark" } as const;
const deps = (over: Partial<Parameters<typeof resolvePersonPrefsWith>[0]> = {}) => ({
  userId: "user_1",
  state: async () => ({ status: "ok", id: "acct", name: "x", timezone: "UTC", language: null }) as const,
  readStored: vi.fn(async () => ({ role: "staff" as const, prefs: es })),
  readUser: vi.fn(async () => null),
  ...over,
});

describe("resolvePersonPrefsWith (spec 5.1)", () => {
  it("signed out reads nothing (mutation: read users with a null id -> FAILS)", async () => {
    const d = deps({ userId: null });
    expect(await resolvePersonPrefsWith(d)).toEqual(NO_PREFS);
    expect(d.readStored).not.toHaveBeenCalled(); expect(d.readUser).not.toHaveBeenCalled();
  });
  it("a client reads the stored-person entry for its own account and nothing else (mutation: call readUser too -> FAILS)", async () => {
    const d = deps();
    expect(await resolvePersonPrefsWith(d)).toEqual(es);
    expect(d.readStored).toHaveBeenCalledWith("acct", "user_1"); expect(d.readUser).not.toHaveBeenCalled();
  });
  it("a client with no membership yet falls back to its users row (mutation: return NO_PREFS on null -> FAILS)", async () => {
    const d = deps({ readStored: vi.fn(async () => null), readUser: vi.fn(async () => es) });
    expect(await resolvePersonPrefsWith(d)).toEqual(es);
  });
  it("the agency reads its users row (mutation: treat agency like signed out -> FAILS)", async () => {
    const d = deps({ state: async () => ({ status: "agency" }) as const, readUser: vi.fn(async () => es) });
    expect(await resolvePersonPrefsWith(d)).toEqual(es);
    expect(d.readStored).not.toHaveBeenCalled();
  });
  it("a failed read is defaults, never a throw (mutation: let readUser's rejection escape -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolvePersonPrefsWith(deps({ readStored: vi.fn(async (): Promise<StoredPerson> => STORED_READ_FAILED) }))).toEqual(NO_PREFS);
    expect(await resolvePersonPrefsWith(deps({ state: async () => ({ status: "agency" }) as const,
      readUser: vi.fn(async () => { throw new Error("down"); }) }))).toEqual(NO_PREFS);
  });
});

// loadMyPreferences (the preferences page only) shares this core but must
// THROW, so the page shows its error state instead of presenting defaults as
// the person's saved choice.
describe("readPersonPrefsOrThrowWith (loadMyPreferences' core)", () => {
  it("a failed stored-person read rejects instead of defaulting (mutation: return NO_PREFS on the sentinel -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readPersonPrefsOrThrowWith(deps({ readStored: vi.fn(async (): Promise<StoredPerson> => STORED_READ_FAILED) }))).rejects.toThrow();
  });
  it("a failed users read rejects too (mutation: catch readUser's rejection -> FAILS)", async () => {
    await expect(readPersonPrefsOrThrowWith(deps({ state: async () => ({ status: "agency" }) as const,
      readUser: vi.fn(async () => { throw new Error("down"); }) }))).rejects.toThrow("down");
  });
  it("a successful read is the same answer the lenient path gives", async () => {
    expect(await readPersonPrefsOrThrowWith(deps())).toEqual(es);
  });
});

// React cache() keys on argument COUNT and identity (staff and roles review
// I1: a 3-arg vs 4-arg call ran ensureAccountRoleWith twice). The stored-
// person read is shared by requireAccountAccess (through readStoredRole) and
// getPersonPrefs; it is one database read per request only while BOTH reach
// readStoredPerson with the identical two-argument shape. cache() cannot be
// exercised outside a React server render, so this is a source-shape pin.
describe("one stored-person read per request (cache key shape)", () => {
  it("getPersonPrefs hands readStoredPerson itself, and both callers use (accountId, clerkUserId) (mutation: wrap it as (a, u) => readStoredPerson(a, u, x) -> FAILS)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const prefsSrc = readFileSync(path.join(here, "person-prefs.ts"), "utf8");
    const roleSrc = readFileSync(path.join(here, "../team/ensure-role.ts"), "utf8");
    expect(prefsSrc).toMatch(/readStored: readStoredPerson,/);
    expect(prefsSrc).toMatch(/deps\.readStored\(state\.id, deps\.userId\)/);
    expect(roleSrc).toMatch(/readStoredRole = cache\(\(accountId: string, clerkUserId: string\): Promise<StoredRole> =>\s*readStoredPerson\(accountId, clerkUserId\)\.then\(toStoredRole\)\)/);
    // Every readStoredPerson call in the web app has exactly two arguments.
    const calls = [...prefsSrc.matchAll(/readStoredPerson\(([^)]*)\)/g), ...roleSrc.matchAll(/readStoredPerson\(([^)]*)\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) expect(c[1]!.split(",").length, c[0]).toBe(2);
  });
});
