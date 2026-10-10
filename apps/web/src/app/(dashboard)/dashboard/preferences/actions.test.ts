import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Final fix wave, M-c: a signed-out caller of either Preferences action is
 * sent to sign-in and nothing is saved. `redirect` is mocked to THROW, as the
 * real one does (NEXT_REDIRECT), so a missing guard would fall through to the
 * save with a null `userId` and the assertions below would see it.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  save: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, currentUser: vi.fn() }));
vi.mock("@bis/db", () => ({ serviceDb: () => ({}) }));
vi.mock("@/lib/preferences/save", () => ({ saveMyPreferenceWith: mocks.save }));

import { setMyLanguageAction, setMyThemeAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ ok: true, previous: null });
});

describe("Preferences actions, signed out", () => {
  it("setMyThemeAction redirects to sign-in and saves nothing (mutation: drop the !userId redirect -> FAILS)", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(setMyThemeAction("dark")).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("setMyLanguageAction redirects to sign-in and saves nothing (mutation: drop the !userId redirect -> FAILS)", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(setMyLanguageAction("es")).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("a signed-in caller saves keyed on auth()'s userId (positive control)", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_me" });
    await setMyThemeAction("dark");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_me" }), "theme", "dark");
  });
});
