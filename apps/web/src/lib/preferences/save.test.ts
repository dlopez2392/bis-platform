import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@bis/db";

const save = vi.fn();
vi.mock("@bis/db", async (orig) => ({ ...(await orig<typeof import("@bis/db")>()), savePersonPreference: (...a: unknown[]) => save(...a) }));
const { saveMyPreferenceWith, parseLanguage, parseTheme } = await import("./save");

const db = {} as SupabaseClient;
const deps = { userId: "user_me", db: () => db, profile: async () => ({ email: "me@example.com", name: null }) };

describe("parse (closed lists)", () => {
  it("language: en, es, null only (mutation: accept any 2-letter code -> FAILS on 'fr')", () => {
    expect(parseLanguage("es")).toEqual({ ok: true, value: "es" });
    expect(parseLanguage(null)).toEqual({ ok: true, value: null });
    for (const v of ["fr", "", "ES", undefined, 1]) expect(parseLanguage(v)).toEqual({ ok: false });
  });
  it("theme: light, dark, system, null only (mutation: drop 'system' -> FAILS)", () => {
    for (const v of ["light", "dark", "system", null]) expect(parseTheme(v)).toEqual({ ok: true, value: v });
    for (const v of ["blue", "", undefined]) expect(parseTheme(v)).toEqual({ ok: false });
  });
});

describe("saveMyPreferenceWith (spec §7)", () => {
  it("an unlisted value is refused with no query (mutation: validate after calling save -> FAILS)", async () => {
    expect(await saveMyPreferenceWith(deps, "theme", "blue")).toEqual({ ok: false, error: "prefs.invalid" });
    expect(save).not.toHaveBeenCalled();
  });
  it("writes the AUTHENTICATED user's row, whatever else is passed (mutation: key on a raw input field -> FAILS)", async () => {
    save.mockResolvedValue({ outcome: "saved", previous: "light" });
    expect(await saveMyPreferenceWith(deps, "theme", "dark")).toEqual({ ok: true, previous: "light" });
    expect(save).toHaveBeenCalledWith(db, "user_me", { field: "theme", value: "dark" }, deps.profile);
  });
  it("no Clerk profile on a first save is a clean failure (mutation: report no_profile as ok -> FAILS)", async () => {
    save.mockResolvedValue({ outcome: "no_profile" });
    expect(await saveMyPreferenceWith(deps, "language", "es")).toEqual({ ok: false, error: "prefs.failed" });
  });
  it("a database fault is prefs.failed and is logged without the value (mutation: let it throw -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    save.mockRejectedValue(new Error("savePersonPreference update failed: timeout"));
    expect(await saveMyPreferenceWith(deps, "language", "es")).toEqual({ ok: false, error: "prefs.failed" });
    expect(String(err.mock.calls[0])).toContain("timeout");
  });
});
