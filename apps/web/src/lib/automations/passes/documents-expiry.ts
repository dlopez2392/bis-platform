import {
  listExpiringDocuments, listDocumentExpiryTaskKeys, ensureDocumentExpiryTask, documentRequestTarget, expiryTaskKey,
  type ExpiringDocument, type SupabaseClient,
} from "@bis/db";
// The subpath, not the barrel (review I1): these two run before the candidate read, and the cron route
// test's bare @bis/db factory throws on any export it does not list.
import { DOCUMENT_EXPIRY_WINDOW_DAYS, shiftDay } from "@bis/db/document-rules";
import type { Pass } from "../context";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { dayKeyInZone } from "@/lib/booking/availability";
import { inExpiryWindow, expiryDueAt, expiryTaskTitle } from "@/lib/documents/expiry-task";
import { loggableError } from "@/lib/loggable-error";

/**
 * Expiry To-dos (S-07 3a, spec 3.2 as amended; plan deviations 1, 7, 10). Not a recipe; it sends nothing.
 * EVERY tick, idempotent: one candidate read over a coarse UTC range (today - 1 .. today + 31, wide enough
 * for every zone's own today), each candidate narrowed to its ACCOUNT's day, one read of the keys that
 * already have their To-do, then one insert per missing (document, date). 0084's unique index is the last
 * word (23505 = already there). Staff only (E1): nothing goes to a customer. The To-do lands on the
 * contact, or on a household's primary contact (documentRequestTarget, 2b), titled in the ACCOUNT's
 * language. Logs ids, never a title. A run with any failed document throws after the rest
 * (documents-sweep's pattern), so the heartbeat records it.
 * BUDGET (review M4): at most 200 To-dos a run, each up to four round trips on either path: the target's
 * one read (a contact) or two (a group and its primary contact), then the insert and its event, or, on a
 * 23505, the insert and the re-read of the To-do already there. No To-do STARTS once EXPIRY_BUDGET_MS has
 * gone (documents-scan.ts' cutoff shape); the rest count as `deferred` and open on a later tick. EXPIRY_BUDGET_MS is the fifth term
 * in cron-coupling.test.ts' sum. Every @bis/db BARREL export is dereferenced inside the function, never at
 * module scope or before the first read (the cron route test's bare mock throws on a dereference).
 */
export const EXPIRY_TASKS_PER_RUN = 200;
export const EXPIRY_CANDIDATES_PER_RUN = 1000;
export const EXPIRY_BUDGET_MS = 15_000;
const ACTOR = "documents-expiry";

export type ExpiryCounters = { opened: number; alreadyOpen: number; failed: number; unresolvableTimezone: number; capped: number; deferred: number };

const qualifies = (r: ExpiringDocument) =>
  !r.owners_only && r.deleted_at === null && r.version_scan === "clean" && (r.contact_id !== null || r.client_group_id !== null);

export async function openExpiryTasks(
  db: SupabaseClient, now: Date, scope: { accountId?: string; clock?: () => number } = {},
): Promise<ExpiryCounters> {
  const clock = scope.clock ?? Date.now;
  const startedAt = clock();
  const c: ExpiryCounters = { opened: 0, alreadyOpen: 0, failed: 0, unresolvableTimezone: 0, capped: 0, deferred: 0 };
  const utcToday = now.toISOString().slice(0, 10);
  const rows = await listExpiringDocuments(db, {
    fromDay: shiftDay(utcToday, -1), toDay: shiftDay(utcToday, DOCUMENT_EXPIRY_WINDOW_DAYS + 1),
    limit: EXPIRY_CANDIDATES_PER_RUN, accountId: scope.accountId,
  });
  if (rows.length === 0) return c;
  if (rows.length >= EXPIRY_CANDIDATES_PER_RUN) {
    c.capped = 1;
    console.error(`documents expiry: capped: the candidate read came back full (${EXPIRY_CANDIDATES_PER_RUN}); while 1000 or more files sit in the window, some files may not get a To-do until fewer than 1000 are in it`);
  }
  const badZone = new Set<string>();
  const due: { r: ExpiringDocument; zone: string }[] = [];
  for (const r of rows) {
    if (!qualifies(r)) continue;
    const zone = resolveAccountZone(r.account_timezone);
    if (zone === null) {
      if (!badZone.has(r.account_id)) {
        badZone.add(r.account_id);
        c.unresolvableTimezone++;
        console.error(`documents expiry: account ${r.account_id}'s timezone cannot be resolved; its files open no To-do until it is fixed`);
      }
      continue;
    }
    if (inExpiryWindow(r.expires_on, dayKeyInZone(now, zone))) due.push({ r, zone });
  }
  if (due.length === 0) return c;
  const have = await listDocumentExpiryTaskKeys(db, due.map((d) => d.r.id));
  const todo = due.filter(({ r }) => {
    if (!have.has(expiryTaskKey(r.id, r.expires_on))) return true;
    c.alreadyOpen++;
    return false;
  });
  for (const [i, { r, zone }] of todo.entries()) {
    if (i >= EXPIRY_TASKS_PER_RUN) {
      c.capped = 1;
      console.error(`documents expiry: capped at ${EXPIRY_TASKS_PER_RUN} To-dos this run; the rest open on the next tick`);
      break;
    }
    // `deferred` counts every To-do this run did not start, including any past the EXPIRY_TASKS_PER_RUN cap
    // (todo.length - i, not min(cap, todo.length) - i): all of them open on a later tick.
    if (clock() - startedAt > EXPIRY_BUDGET_MS) { c.deferred = todo.length - i; break; }
    try {
      const target = await documentRequestTarget(db, r.account_id, r);
      const title = expiryTaskTitle({ category: r.category, title: r.title, name: target?.name ?? "", expiresOn: r.expires_on },
        r.account_language === "es" ? "es" : "en");
      const t = await ensureDocumentExpiryTask(db, r.account_id, {
        documentId: r.id, expiresOn: r.expires_on, contactId: target?.contactId ?? null, title, dueAt: expiryDueAt(r.expires_on, zone),
      }, ACTOR, "system");
      if (t.created) c.opened++; else c.alreadyOpen++;
    } catch (e) {
      c.failed++;
      console.error(`documents expiry: document ${r.id} (account ${r.account_id}): the To-do was not opened: ${loggableError(e)}`);
    }
  }
  if (c.failed > 0) throw new Error(`documents expiry: ${JSON.stringify(c)}`);
  return c;
}

export const documentsExpiryPass: Pass = {
  key: "documentsExpiry",
  run: (ctx) => openExpiryTasks(ctx.db, ctx.now),
};
