import { describe, it, expect } from "vitest";
import { recordChangesAuditPass } from "./record-changes-audit";

const NOW = new Date("2026-11-02T14:00:00Z");

/** `ctx.db.from("record_changes").select("id", {count:"exact", head:true}).is("author_kind", null)
 *  .gte("created_at", since)`, resolving to `{ count, error }` — the same shape documents-sweep.test.ts's
 *  `ctx()` fixture builds, scoped to this one pass's own query. `calls`, when given, records every
 *  argument `is`/`gte` are called with (review finding: the original stub ignored its arguments
 *  entirely, so a mutated window or a mutated null filter still passed). */
function ctx(
  answer: { count: number | null; error: { message: string } | null },
  calls: { method: "is" | "gte"; args: unknown[] }[] = [],
) {
  const chain = {
    is: (...args: unknown[]) => { calls.push({ method: "is", args }); return chain; },
    gte: (...args: unknown[]) => { calls.push({ method: "gte", args }); return Promise.resolve(answer); },
  };
  const db = { from: (table: string) => ({ select: () => { if (table !== "record_changes") throw new Error(`unexpected table ${table}`); return chain; } }) };
  return { db, now: NOW, origin: "x", email: {}, sms: {} } as never;
}

describe("recordChangesAudit (F-115): the daily proof that every server write names its author", () => {
  it("zero unattributed rows returns { unattributed: 0 } (mutation: always throw -> FAILS)", async () => {
    expect(await recordChangesAuditPass.run(ctx({ count: 0, error: null }))).toEqual({ unattributed: 0 });
  });

  it("a positive count throws naming the exact number (mutation: return instead of throw -> FAILS)", async () => {
    await expect(recordChangesAuditPass.run(ctx({ count: 3, error: null })))
      .rejects.toThrow("record_changes: 3 unattributed changes in the last 24 hours");
  });

  it("a null count (head-count-null rule: {count:null,error:null} is a FAILED read, not zero) throws, never reads as zero (mutation: `count ?? 0` -> FAILS)", async () => {
    await expect(recordChangesAuditPass.run(ctx({ count: null, error: null })))
      .rejects.toThrow("record_changes: the unattributed count could not be read");
  });

  it("a real PostgREST error also throws the read-failed message, never the count (mutation: read error.message instead -> FAILS)", async () => {
    await expect(recordChangesAuditPass.run(ctx({ count: null, error: { message: "57014 statement timeout" } })))
      .rejects.toThrow("record_changes: the unattributed count could not be read");
  });

  it("filters on author_kind IS NULL and a window of exactly the last 24 hours before ctx.now (mutation: a 7-day window -> FAILS; mutation: is(\"author_kind\",\"person\") -> FAILS)", async () => {
    const calls: { method: "is" | "gte"; args: unknown[] }[] = [];
    await recordChangesAuditPass.run(ctx({ count: 0, error: null }, calls));
    expect(calls).toEqual([
      { method: "is", args: ["author_kind", null] },
      { method: "gte", args: ["created_at", "2026-11-01T14:00:00.000Z"] },
    ]);
  });
});
