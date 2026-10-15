import { documentSpaceUsed, DOCUMENT_PURGING_MARK, type ListedDocument, type ScanStatus, type SupabaseClient } from "@bis/db";
import { DOCUMENT_QUOTA_BYTES, removedReason } from "@bis/db/document-rules";
import { renderZone } from "@/lib/zone";
import { dayKeyInZone } from "@/lib/booking/availability";
import { loggableError } from "@/lib/loggable-error";
import type { DocumentView, ScanState } from "./documents-load";
import type { DocumentsSpace } from "./space";

/** Owner ruling 2026-10-15: unscannable BECAUSE of a password is its own view state; clamd's name never reaches the JSON. */
const viewScan = (v: { scan_status: ScanStatus; scan_signature: string | null }): ScanState =>
  removedReason(v.scan_status, v.scan_signature) === "password" ? "locked" : v.scan_status;

/**
 * The card's clock: the account's zone and its today, read on the caller's own client. The same read,
 * fallback and conversion as lib/contacts/account-today.ts's `accountToday` (a read: an unreadable zone
 * is logged and falls to renderZone's fallback), but answering the ZONE too, because each row's added
 * day ("yesterday", "3 days ago") must be the account's calendar day, not 24-hour arithmetic.
 */
export async function documentsClock(db: SupabaseClient, accountId: string, now: Date = new Date()): Promise<{ today: string; zone: string }> {
  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) console.error(`documents clock: account ${accountId} timezone unreadable: ${loggableError(error)}`);
  const stored = error ? undefined : (data as { timezone: string | null } | null)?.timezone ?? undefined;
  const { zone } = await renderZone(stored);
  return { today: dayKeyInZone(now, zone), zone };
}

/**
 * The author's Clerk id never leaves the server: the card gets "you", a name, or null ("Someone on the
 * team"). `addedOn` is the day the file was added, in the account's `zone`.
 */
export function documentView(d: ListedDocument, viewerId: string, names: Readonly<Record<string, string>>, zone: string): DocumentView {
  const you = d.created_by === viewerId;
  // S-07 2a (plan deviation 1): what opens is the newest CLEAN version (d.versions is newest first);
  // with none clean, the row describes the newest ready version and its state.
  const shown = d.versions.find((v) => v.scan_status === "clean") ?? d.version;
  return {
    id: d.id, title: d.title, category: d.category, expiresOn: d.expires_on, ownersOnly: d.owners_only, source: d.source,
    addedBy: { you, name: you ? null : (Object.hasOwn(names, d.created_by) ? names[d.created_by]! : null) },
    createdAt: d.created_at, addedOn: dayKeyInZone(new Date(d.created_at), zone), deletedAt: d.deleted_at,
    version: { id: shown.id, contentType: shown.content_type, bytes: shown.bytes, scan: viewScan(shown), createdAt: shown.created_at },
    purging: d.deleted_at !== null && d.deleted_by === DOCUMENT_PURGING_MARK,
    versions: d.versions.map((v) => ({
      id: v.id, contentType: v.content_type, bytes: v.bytes, createdAt: v.created_at, addedOn: dayKeyInZone(new Date(v.created_at), zone), scan: viewScan(v),
    })),
  };
}

/**
 * The space-used line's number (spec 4.2 item 4), on the caller's REQUEST client: 0078 answers the
 * account's usage by the quota's own rule. A failed read is logged and omitted (null), never a failed
 * card: the line is a convenience, the files are the card.
 */
export async function documentsSpace(db: SupabaseClient, accountId: string): Promise<DocumentsSpace | null> {
  try {
    return { used: await documentSpaceUsed(db, accountId), quota: DOCUMENT_QUOTA_BYTES };
  } catch (e) {
    console.error(`documents space (account ${accountId}): ${loggableError(e)}`);
    return null;
  }
}
