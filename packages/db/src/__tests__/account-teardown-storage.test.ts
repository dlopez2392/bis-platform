import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteAccountCascade } from "../account-teardown";

function fakeDb(paths: string[], removeError: string | null) {
  const log: string[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: table === "document_versions" ? paths.map((p) => ({ storage_path: p })) : [], error: null }) }) }) }),
      delete: () => ({ eq: async () => { log.push(`rows:${table}`); return { error: null }; } }),
    }),
    storage: { from: (b: string) => ({ remove: async (ps: string[]) => { log.push(`objects:${b}:${ps.join(",")}`); return { data: [], error: removeError ? { message: removeError } : null }; } }) },
  };
  return { db: db as unknown as SupabaseClient, log };
}

describe("deleteAccountCascade removes the document vault's objects before any row (plan review I5)", () => {
  it("objects first, then the rows (mutation: move the storage leg after the table loop -> FAILS)", async () => {
    const { db, log } = fakeDb(["a/d/v1", "a/d/v2"], null);
    await deleteAccountCascade(db, "a", "test", { keepBlueprints: true });
    expect(log[0]).toBe("objects:documents:a/d/v1,a/d/v2");
    expect(log.slice(1).every((l) => l.startsWith("rows:"))).toBe(true);
  });
  it("no paths, no storage call (mutation: always call remove -> FAILS)", async () => {
    const { db, log } = fakeDb([], null);
    await deleteAccountCascade(db, "a", "test", { keepBlueprints: true });
    expect(log.some((l) => l.startsWith("objects:"))).toBe(false);
  });
  it("a failed removal throws before any row is deleted (mutation: log and continue -> FAILS)", async () => {
    const { db, log } = fakeDb(["a/d/v1"], "storage down");
    await expect(deleteAccountCascade(db, "a", "test", { keepBlueprints: true })).rejects.toThrow(/document objects/);
    expect(log.some((l) => l.startsWith("rows:"))).toBe(false);
  });
});

describe("deleteAccountCascade reads every page of paths (the 1000-row page PostgREST caps a read at)", () => {
  it("2,345 versions: every path is removed, in calls of at most 100 (mutation: read one page only -> FAILS)", async () => {
    const all = Array.from({ length: 2345 }, (_, i) => `a/d/v${i}`);
    const removed: string[] = [];
    let biggest = 0;
    const db = {
      from: (table: string) => ({
        select: () => ({ eq: () => ({ order: () => ({ range: async (from: number, to: number) =>
          ({ data: table === "document_versions" ? all.slice(from, to + 1).map((p) => ({ storage_path: p })) : [], error: null }) }) }) }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
      storage: { from: () => ({ remove: async (ps: string[]) => {
        removed.push(...ps); biggest = Math.max(biggest, ps.length); return { data: [], error: null };
      } }) },
    } as unknown as SupabaseClient;
    await deleteAccountCascade(db, "a", "test", { keepBlueprints: true });
    expect(removed).toEqual(all);
    expect(biggest).toBeLessThanOrEqual(100);
  });
});
