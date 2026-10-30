import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shellDataSrc = readFileSync(fileURLToPath(new URL("./shell-data.tsx", import.meta.url)), "utf8");

/**
 * The agency refresh loop after the reason chooser (production, 2026-10-30): the shell's one background
 * read was a server action, which Next posts to the router's CURRENT url (a stale `/dashboard/enter/<id>`
 * there); its redirect, or a cookie-modifying response, navigated or refreshed the whole app ~1/s. The read
 * is a plain GET now: a fetch cannot navigate the page, whatever the server answers.
 */
const { fetchShellSnapshot } = await import("./shell-data");

const A = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = { unreadTotal: 1, setup: null, presence: null, businessStatus: null };

describe("fetchShellSnapshot: the shell's read is a plain GET", () => {
  it("GETs this account's shell route, never cached, refusing to follow a redirect (mutation: drop cache no-store -> FAILS)", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(SNAPSHOT), { status: 200 }));
    expect(await fetchShellSnapshot(A, fetchImpl)).toEqual(SNAPSHOT);
    expect(fetchImpl).toHaveBeenCalledWith(`/api/accounts/${A}/shell`, { cache: "no-store", redirect: "error" });
  });

  it("a 204 (no access, or the agency with no live visit) is null: nothing to show, nothing navigated", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await fetchShellSnapshot(A, fetchImpl)).toBeNull();
  });

  it("any other failure rejects, for the provider to swallow (mutation: parse a 500's body as a snapshot -> FAILS)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    await expect(fetchShellSnapshot(A, fetchImpl)).rejects.toThrow("500");
  });

  it("the provider calls no server action: no import from shell-actions or any \"use server\" module (mutation: restore the getShellSnapshot import -> FAILS)", () => {
    const imports = shellDataSrc.split("\n").filter((l) => /^\s*(import|\}\s*from)\b/.test(l) || /from "/.test(l)).join("\n");
    expect(imports).not.toMatch(/shell-actions|getShellSnapshot/);
    expect(shellDataSrc).toMatch(/fetchShellSnapshot\(accountId\)/);
  });

  // ShellDataProvider has no render harness (no jsdom/testing-library in this app's vitest config, and
  // its effect depends on usePathname + a background fetch), so this pins the source of the one branch
  // that decides it: a 204 (fetchShellSnapshot resolving null) must leave whatever snapshot is already on
  // screen untouched, never clear it.
  it("a 204 (null snapshot) keeps whatever is on screen: the resolved fetch only writes state when a snapshot actually came back (mutation: drop the `snapshot &&` guard, keeping only `!cancelled` -> FAILS)", () => {
    expect(shellDataSrc).toMatch(/if \(snapshot && !cancelled\) \{/);
  });
});
