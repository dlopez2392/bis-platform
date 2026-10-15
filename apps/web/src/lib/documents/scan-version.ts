import { recordDocumentScan, signedScannerUrl, DOCUMENT_BUCKET, type SupabaseClient } from "@bis/db";
import { requestScan, scannerConfig, type ScanVerdict } from "./scan-client";

/**
 * Scans ONE ready version and records what happened (spec 3.2-3.4). Called by the finish action at
 * once and by the retry pass for whatever is still pending; 2b's customer finish will call it too.
 * `db` is the caller's service client, after its own proof. Owner decision P4, nothing infected is
 * kept: on a virus, on content clamd could not read (a limit or encryption, plan review C2), or on the
 * third counted error, the OBJECT is removed FIRST and only then is the verdict recorded, so a crash in
 * between leaves the version pending and the next pass finds it again (attempts already at three:
 * removed without another scan; attempts below three: minting the scanner's URL now fails, because
 * Supabase's own createSignedUrl refuses a non-existent object, and that failure is routed through
 * the same "missing" confirmation as the worker's own cause below). This function THROWS on any
 * storage or database error (a failed removal, a failed RPC, a failed event), not only a removal.
 * Owner ruling 2026-10-15: an unscannable verdict keeps clamd's named cause (Heuristics.Encrypted.* =
 * a password), so the note can say why.
 * Counting (plan review C1; final check R2, orchestrator ruling): only two causes may count against a
 * file. "clamd": clamd failed on this stream. "missing": the worker says storage reported the object
 * not found, AND this module confirms it with the service-role client (a list of the exact path); if
 * the object is there after all, or the check itself fails, nothing counts. Every other failure answers
 * "unreached" and writes nothing. A countable error is HELD (`holdErrors`); the retry pass spends it
 * only after the worker's self-test passes again in the same run, and the finish never spends. With no
 * scanner configured the file stays Checking (plan deviation 14).
 * Accepted residual (plan review 8): the finish and the pass can scan the same fresh version at
 * once. The first verdict recorded wins and the other answers "stale"; the finish never spends, so the
 * two can never disagree into a removal under a clean verdict.
 */
export const MAX_SCAN_ATTEMPTS = 3;
export type ScanTarget = { accountId: string; versionId: string; storagePath: string; attempts: number };
export type ScanResult = "clean" | "infected" | "unscannable" | "pending" | "stale" | "unreached" | "held";
export type ScanDeps = { configured: () => boolean; scan: (objectUrl: string) => Promise<ScanVerdict> };
export type ScanOptions = { holdErrors?: boolean };

const REAL: ScanDeps = { configured: () => scannerConfig() !== null, scan: (u) => requestScan(u) };

async function removeThenRecord(
  db: SupabaseClient, v: ScanTarget, verdict: "infected" | "unscannable", signature: string | null,
): Promise<ScanResult> {
  const { error } = await db.storage.from(DOCUMENT_BUCKET).remove([v.storagePath]);
  if (error) throw new Error(`scan: version ${v.versionId}'s object was not removed, so it stays pending for the next pass: ${error.message}`);
  const r = await recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict, signature });
  return r.status === "ok" ? verdict : "stale";
}

/** Final check R2: the object is CONFIRMED gone only when a list of its own folder answers without error and without it. */
async function confirmedMissing(db: SupabaseClient, storagePath: string): Promise<boolean> {
  const cut = storagePath.lastIndexOf("/");
  const name = storagePath.slice(cut + 1);
  const { data, error } = await db.storage.from(DOCUMENT_BUCKET).list(storagePath.slice(0, cut), { search: name, limit: 10 });
  if (error) return false;
  return !(data ?? []).some((o: { name: string }) => o.name === name);
}

/** Spends ONE attempt for a countable error; the third removes the object and records unscannable. */
export async function spendScanError(db: SupabaseClient, v: ScanTarget): Promise<ScanResult> {
  const r = await recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict: "error" });
  if (r.status === "stale") return "stale";
  return r.attempts >= MAX_SCAN_ATTEMPTS ? removeThenRecord(db, v, "unscannable", null) : "pending";
}

export async function scanVersion(db: SupabaseClient, v: ScanTarget, deps: ScanDeps = REAL, opts: ScanOptions = {}): Promise<ScanResult> {
  if (!deps.configured()) return "pending";
  if (v.attempts >= MAX_SCAN_ATTEMPTS) return removeThenRecord(db, v, "unscannable", null);
  let objectUrl: string;
  try {
    objectUrl = await signedScannerUrl(db, v.storagePath);
  } catch {
    // Review fix 2: Supabase's own createSignedUrl refuses a non-existent object (an infected
    // version already removed, or a crash between its removal and its verdict, attempts < 3). The
    // app re-checks with its OWN storage list, exactly like a "missing" cause from the worker: held
    // under holdErrors, spent by the pass only after its self-test; never counted when the object is
    // still there or the check itself fails.
    if (!(await confirmedMissing(db, v.storagePath))) return "unreached";
    if (opts.holdErrors) return "held";
    return spendScanError(db, v);
  }
  const verdict = await deps.scan(objectUrl);
  if (verdict.verdict === "clean") {
    const r = await recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict: "clean" });
    return r.status === "ok" ? "clean" : "stale";
  }
  if (verdict.verdict === "infected") return removeThenRecord(db, v, "infected", verdict.signature);
  // Owner ruling 2026-10-15: keep clamd's named cause (Heuristics.Encrypted.* = a password) so the note can say why.
  if (verdict.verdict === "unscannable") return removeThenRecord(db, v, "unscannable", verdict.signature);
  if (verdict.cause === "transport") return "unreached";
  if (verdict.cause === "missing" && !(await confirmedMissing(db, v.storagePath))) return "unreached";
  if (opts.holdErrors) return "held";
  return spendScanError(db, v);
}
