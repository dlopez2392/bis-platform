import type { Pass } from "../context";

/**
 * F-115: the daily proof that every server write names its author (0111's observe mode still
 * writes an unattributed row rather than refusing it; this is what turns a missed conversion into
 * a red heartbeat instead of a silent gap). Reads `ctx.db` directly, as every other pass does
 * (documents-sweep.ts's own pattern) — `ctx.db` is already the service client the cron route hands
 * every pass (harness.ts's `buildPassContext`), so there is no separate service client to reach for.
 * `ctx.now` is the ONE "now" this tick uses, per PassContext's own rule.
 *
 * The head-count-null rule (bis-head-count-null): a HEAD request's `{ count: null, error: null }` is
 * a FAILED read, never "zero" — `count ?? 0` would show a read failure as a clean pass.
 */
export const recordChangesAuditPass: Pass = {
  key: "recordChangesAudit",
  async run(ctx) {
    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await ctx.db.from("record_changes").select("id", { count: "exact", head: true })
      .is("author_kind", null).gte("created_at", since);
    if (error || count === null) throw new Error("record_changes: the unattributed count could not be read");
    if (count > 0) throw new Error(`record_changes: ${count} unattributed changes in the last 24 hours`);
    return { unattributed: 0 };
  },
};
