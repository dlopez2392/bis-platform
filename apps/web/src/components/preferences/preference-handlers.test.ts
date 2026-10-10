import { afterEach, describe, it, expect, vi } from "vitest";
import type { PersonTheme } from "@bis/db";
import { changeLanguage, changeTheme, debouncedChoice, PREFS_SAVE_DEBOUNCE_MS, PREFS_TOAST_MS, propsResync, flushOnPageHide } from "./preference-handlers";

describe("changeTheme", () => {
  it("applies at once, saves, and Undo sends the PREVIOUS value the server returned (mutation: undo with next -> FAILS)", async () => {
    const save = vi.fn(async (v: PersonTheme | null) => ({ ok: true as const, previous: v === "dark" ? "light" as const : null }));
    const apply = vi.fn(); let undo: (() => void) | undefined;
    const toast = { success: vi.fn((_m: string, u: { onClick: () => void }) => { undo = u.onClick; }), error: vi.fn() };
    await changeTheme({ next: "dark", current: "light", save, apply, copy: (k) => k, toast });
    expect(apply).toHaveBeenNthCalledWith(1, "dark");
    undo!();
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith("light"));
    expect(apply).toHaveBeenLastCalledWith("light");
  });

  it("applies BEFORE the save resolves — the click never waits on the network (mutation: apply after await save -> FAILS)", async () => {
    let resolve!: (r: { ok: true; previous: null }) => void;
    const save = vi.fn(() => new Promise<{ ok: true; previous: null }>((r) => { resolve = r; }));
    const apply = vi.fn(); const toast = { success: vi.fn(), error: vi.fn() };
    const done = changeTheme({ next: "dark", current: null, save, apply, copy: (k) => k, toast });
    expect(apply).toHaveBeenCalledWith("dark");
    resolve({ ok: true, previous: null });
    await done;
  });

  it("a failed save puts the radio back and says so (mutation: skip the revert -> FAILS)", async () => {
    const apply = vi.fn(); const toast = { success: vi.fn(), error: vi.fn() };
    await changeTheme({ next: "dark", current: null, save: async () => ({ ok: false as const, error: "prefs.failed" as const }), apply, copy: (k) => k, toast });
    expect(apply.mock.calls).toEqual([["dark"], [null]]);
    expect(toast.error).toHaveBeenCalledWith("prefs.error.failed");
  });

  it("a thrown action (stale page) is the house reload sentence (mutation: let it throw -> FAILS)", async () => {
    const toast = { success: vi.fn(), error: vi.fn() };
    await changeTheme({ next: "dark", current: null, save: async () => { throw new Error("x"); }, apply: vi.fn(), copy: (k) => k, toast });
    expect(toast.error).toHaveBeenCalledWith("common.actionCrashed");
  });

  it("names the chosen theme and offers Undo for the house ten seconds (mutation: reuse one message for every theme -> FAILS)", async () => {
    const toast = { success: vi.fn(), error: vi.fn() };
    await changeTheme({ next: "system", current: "dark", save: async () => ({ ok: true as const, previous: "dark" as const }), apply: vi.fn(), copy: (k) => k, toast });
    expect(toast.success).toHaveBeenCalledWith("prefs.saved.theme.system", expect.objectContaining({ label: "prefs.undo" }));
    expect(PREFS_TOAST_MS).toBe(10_000);
  });

  it("choosing the theme already chosen does nothing (mutation: drop the no-op guard -> FAILS)", async () => {
    const save = vi.fn(); const apply = vi.fn(); const toast = { success: vi.fn(), error: vi.fn() };
    await changeTheme({ next: "dark", current: "dark", save, apply, copy: (k) => k, toast });
    expect(save).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a failed Undo puts the new choice back and says so (mutation: leave the undone value on screen -> FAILS)", async () => {
    let calls = 0;
    const save = vi.fn(async () => (++calls === 1 ? { ok: true as const, previous: "light" as const } : { ok: false as const, error: "prefs.failed" as const }));
    const apply = vi.fn(); let undo: (() => void) | undefined;
    const toast = { success: vi.fn((_m: string, u: { onClick: () => void }) => { undo = u.onClick; }), error: vi.fn() };
    await changeTheme({ next: "dark", current: "light", save, apply, copy: (k) => k, toast });
    undo!();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("prefs.error.failed"));
    expect(apply.mock.calls).toEqual([["dark"], ["light"], ["dark"]]);
  });
});

describe("changeLanguage", () => {
  it("a language toast speaks the language just chosen (mutation: use the current locale -> FAILS)", async () => {
    const copyFor = vi.fn(() => (k: string) => k); const toast = { success: vi.fn(), error: vi.fn() };
    await changeLanguage({ next: "es", current: null, save: async () => ({ ok: true as const, previous: null }), apply: vi.fn(),
      copyFor, accountLanguage: null, toast });
    expect(copyFor).toHaveBeenCalledWith("es");
  });

  it("'Follow the account' speaks the ACCOUNT's language and names it (mutation: speak English for NULL -> FAILS)", async () => {
    const copyFor = vi.fn((loc: string) => (k: string, p?: Record<string, string>) => `${loc}:${k}:${p?.language ?? ""}`);
    const toast = { success: vi.fn(), error: vi.fn() };
    await changeLanguage({ next: null, current: "en", save: async () => ({ ok: true as const, previous: "en" as const }), apply: vi.fn(),
      copyFor, accountLanguage: "es", toast });
    expect(toast.success).toHaveBeenCalledWith("es:prefs.saved.languageAccount:es:prefs.languageName.spanish:", expect.anything());
  });

  it("a failed save puts the radio back and speaks the language still in use (mutation: speak the failed choice -> FAILS)", async () => {
    const copyFor = vi.fn((loc: string) => (k: string) => `${loc}:${k}`);
    const apply = vi.fn(); const toast = { success: vi.fn(), error: vi.fn() };
    await changeLanguage({ next: "es", current: "en", save: async () => ({ ok: false as const, error: "prefs.failed" as const }), apply,
      copyFor, accountLanguage: null, toast });
    expect(apply.mock.calls).toEqual([["es"], ["en"]]);
    expect(toast.error).toHaveBeenCalledWith("en:prefs.error.failed");
  });

  it("Undo restores the server's previous value (mutation: undo to the client's current -> FAILS)", async () => {
    const save = vi.fn(async (v: "en" | "es" | null) => ({ ok: true as const, previous: v === "es" ? null : "es" as const }));
    const apply = vi.fn(); let undo: (() => void) | undefined;
    const toast = { success: vi.fn((_m: string, u: { onClick: () => void }) => { undo = u.onClick; }), error: vi.fn() };
    await changeLanguage({ next: "es", current: "en", save, apply, copyFor: () => (k) => k, accountLanguage: null, toast });
    undo!();
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith(null));
    expect(apply).toHaveBeenLastCalledWith(null);
  });
});

// Fix round 1 (Task 6 review, M1): arrow keys inside a native radio group
// move AND select, so stepping light -> dark -> system was three saves and
// three toasts. The radio still moves at once; the commit (save + toast)
// waits for PREFS_SAVE_DEBOUNCE_MS of quiet.
describe("debouncedChoice", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("three quick steps are ONE commit, of the last value, against the value before the first step (mutation: commit on every choose -> FAILS)", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const d = debouncedChoice<string | null>(commit);
    d.choose("dark", "light");
    vi.advanceTimersByTime(200);
    d.choose("system", "dark");
    vi.advanceTimersByTime(200);
    d.choose("light", "system");
    vi.advanceTimersByTime(PREFS_SAVE_DEBOUNCE_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit.mock.calls).toEqual([["light", "light"]]);
    expect(PREFS_SAVE_DEBOUNCE_MS).toBe(600);
  });

  it("a new burst after a commit starts from the committed value (mutation: never reset `before` after a commit -> FAILS)", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const d = debouncedChoice<string>(commit);
    d.choose("dark", "light");
    vi.advanceTimersByTime(PREFS_SAVE_DEBOUNCE_MS);
    d.choose("system", "dark");
    vi.advanceTimersByTime(PREFS_SAVE_DEBOUNCE_MS);
    expect(commit.mock.calls).toEqual([["dark", "light"], ["system", "dark"]]);
  });

  it("flush commits a pending choice at once and only once — leaving the page never drops it (mutation: flush clears without committing -> FAILS)", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const d = debouncedChoice<string>(commit);
    d.choose("dark", "light");
    d.flush();
    expect(commit.mock.calls).toEqual([["dark", "light"]]);
    vi.advanceTimersByTime(PREFS_SAVE_DEBOUNCE_MS * 2);
    d.flush();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

// Final fix wave (cheap extras): the radios are local state seeded from the
// server's props. When those props CHANGE (the topbar toggle's save lands,
// or another tab's save reaches this one on a refresh) the radio must follow,
// or it shows a stale choice as checked. A local choice still waiting on its
// save is NOT overwritten while the props stay the same.
describe("propsResync", () => {
  it("unchanged props leave the local radios alone, so a pending choice is kept (mutation: always copy the props -> FAILS)", () => {
    expect(propsResync({ language: "en", theme: "dark" }, { language: "en", theme: "dark" })).toBeNull();
  });
  it("a changed theme prop resets only the theme radio (mutation: drop the resync -> FAILS)", () => {
    expect(propsResync({ language: "en", theme: "dark" }, { language: "en", theme: "light" })).toEqual({ theme: "light" });
  });
  it("a changed language prop resets only the language radio, NULL included (mutation: compare theme only -> FAILS)", () => {
    expect(propsResync({ language: "es", theme: null }, { language: null, theme: null })).toEqual({ language: null });
  });
});

// The 600 ms debounce flushes on unmount; a tab closed or navigated away
// within that window never unmounts React, so it also flushes on pagehide.
describe("flushOnPageHide", () => {
  it("pagehide flushes, and the cleanup detaches (mutation: listen for beforeunload instead -> FAILS)", () => {
    const target = new EventTarget();
    const flush = vi.fn();
    const detach = flushOnPageHide(target, flush);
    target.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(1);
    detach();
    target.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
