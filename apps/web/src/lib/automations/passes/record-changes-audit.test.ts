import { describe, it, expect } from "vitest";
import { recordChangesAuditPass } from "./record-changes-audit";

const NOW = new Date("2026-11-02T14:00:00Z");

/** `ctx.db.from("record_changes").select("id", {count:"exact", head:true}).is("author_kind", null)
 *  .gte("created_at", since)`, resolving to `{ count, error }` — the same shape documents-sweep.test.ts's
 *  `ctx()` fixture builds, scoped to this one pass's own query. */
function ctx(answer: { count: number | null; error: { message: string } | null }) {
  const chain = {
    is: () => chain,
    gte: () => Promise.resolve(answer),
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
});
