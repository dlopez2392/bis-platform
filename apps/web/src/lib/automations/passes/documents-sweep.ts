import {
  listAbandonedUploads, deleteAbandonedVersion, listPurgeableDocuments, purgeDocumentRow, DOCUMENT_BUCKET, DOCUMENT_TRASH_DAYS,
} from "@bis/db";
import type { Pass } from "../context";

/**
 * The document vault's clean-up (spec 5.4). Not a recipe; it sends nothing. EVERY tick (with nothing
 * due it is two indexed reads and no write):
 *   1. versions still uploading ABANDONED_UPLOAD_MS after they were reserved (their signed upload URL
 *      expired an hour ago), with their objects if present, and any document left with no ready version;
 *   2. documents trashed more than 30 days ago: every version's object, then the row (its versions
 *      cascade), then document.purged as the system.
 * The OBJECT first and the ROW second: a failed object delete leaves the row, so the next tick finds it
 * again (and the quota keeps counting it, honestly). A run that counted any failure logs its counters
 * and THROWS: runPasses (harness.ts:34-45) marks the heartbeat failed, and two failing ticks in a row
 * are opsWatch's alert (lib/ops/watch.ts:52-56). Plan deviation 4: not automation_log, the client's own
 * history of what was sent. Every @bis/db export is dereferenced inside run(), never at module scope
 * (the cron route test's bare mock throws on a dereference).
 */
export const SIGNED_UPLOAD_URL_MS = 2 * 60 * 60 * 1000;
export const ABANDONED_UPLOAD_MS = 3 * 60 * 60 * 1000;
export const DOCUMENTS_SWEEP_BATCH = 200;
const DAY_MS = 86_400_000;

export const documentsSweepPass: Pass = {
  key: "documentsSweep",
  async run(ctx) {
    const c = { abandoned: 0, purged: 0, objectDeleteFailed: 0, rowDeleteFailed: 0 };
    const abandoned = await listAbandonedUploads(ctx.db, new Date(ctx.now.getTime() - ABANDONED_UPLOAD_MS).toISOString(), DOCUMENTS_SWEEP_BATCH);
    const due = await listPurgeableDocuments(ctx.db, new Date(ctx.now.getTime() - DOCUMENT_TRASH_DAYS * DAY_MS).toISOString(), DOCUMENTS_SWEEP_BATCH);
    if (abandoned.length === 0 && due.length === 0) return c;
    const bucket = ctx.db.storage.from(DOCUMENT_BUCKET);

    for (const v of abandoned) {
      const { error } = await bucket.remove([v.storage_path]);
      if (error) {
        c.objectDeleteFailed++;
        console.error(`documents sweep: object ${v.storage_path} (account ${v.account_id}) not deleted, row kept for the next tick: ${error.message}`);
        continue;
      }
      try {
        await deleteAbandonedVersion(ctx.db, v);
        c.abandoned++;
      } catch (e) {
        c.rowDeleteFailed++;
        console.error(`documents sweep: version ${v.id} (account ${v.account_id}) row not deleted after its object: ${String(e)}`);
      }
    }

    for (const d of due) {
      if (d.paths.length > 0) {
        const { error } = await bucket.remove(d.paths);
        if (error) {
          c.objectDeleteFailed++;
          console.error(`documents sweep: objects of document ${d.id} (account ${d.account_id}) not deleted, row kept for the next tick: ${error.message}`);
          continue;
        }
      }
      try {
        if (await purgeDocumentRow(ctx.db, d)) c.purged++;
      } catch (e) {
        c.rowDeleteFailed++;
        console.error(`documents sweep: document ${d.id} (account ${d.account_id}) row not deleted after its objects: ${String(e)}`);
      }
    }
    if (c.objectDeleteFailed + c.rowDeleteFailed > 0) {
      throw new Error(`documents sweep: ${JSON.stringify(c)}`);
    }
    return c;
  },
};
