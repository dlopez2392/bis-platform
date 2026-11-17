import type { SupabaseClient } from "@bis/db";

/**
 * TESTS ONLY (imported by the check-in tests, never by the app): a database that APPLIES the eq filters it is
 * given to real rows, so a query that forgot its account or status filter finds the wrong row and a test fails,
 * and that records every operation it is asked for, so "a GET writes nothing" is read off the log, not assumed.
 */
export type FakeRow = Record<string, unknown>;

export function fakeDb(tables: Record<string, FakeRow[]>) {
  const log: { table: string; op: string }[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const q: Record<string, unknown> = {};
    for (const op of ["select", "insert", "update", "upsert", "delete"]) q[op] = () => { log.push({ table, op }); return q; };
    q.eq = (c: string, v: unknown) => { filters.push([c, v]); return q; };
    q.maybeSingle = async () => ({ data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null });
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, log };
}

export const writesOf = (log: { op: string }[]) => log.filter((l) => l.op !== "select");
