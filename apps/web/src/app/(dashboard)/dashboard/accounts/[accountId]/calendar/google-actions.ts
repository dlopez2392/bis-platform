"use server";

import { serviceDb, deleteGoogleConnection } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { isUuid } from "@/lib/assign/action-guards";
import { readAccountConnection, revokeGoogleToken, type AccountConnection } from "@/lib/google/calendar-client";
import { recordGoogleEvent } from "@/lib/google/oauth-routes";

/**
 * Disconnect Google Calendar (S-22 slice 1, PR 2; plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md,
 * D3, D4). The agency or the account's Owner (`canManage`), never Staff or a Technician. Revoke at Google first
 * (V9), then delete the row, EVEN WHEN the revoke fails: the person asked for BIS to stop reading their calendar,
 * and that is the row. No Undo: it would need the revoked token back (DESIGN.md rule 6, the "Change PIN" case).
 *
 * Usable during a billing pause, like turning a calendar link off: it only takes access away. So it does not
 * revalidate (lib/billing/read-only.test.ts); the card refreshes the page itself (PR 3).
 * Works whether or not the rest of the feature is configured: any token key in the environment opens the row.
 *
 * The delete names the (id, version) that was read and revoked: a reconnect that lands in between keeps its new,
 * unrevoked connection, and the answer is "changed" (the card says it was reconnected meanwhile). Nothing
 * connected, or someone else disconnecting first, answers ok with no event.
 */
export type GoogleDisconnectResult =
  | { ok: true }
  | { ok: false; error: "calendar.google.error.notAllowed" | "calendar.google.error.failed" | "calendar.google.error.changed" };

export async function disconnectGoogleCalendarAction(accountId: string): Promise<GoogleDisconnectResult> {
  if (!isUuid(accountId)) return { ok: false, error: "calendar.google.error.failed" };
  // Outside the try: its redirect (signed out, another account) must reach Next, never read as "didn't save".
  const access = await requireAccountAccess(accountId, { duringPause: "allow" });
  if (!access.canManage) return { ok: false, error: "calendar.google.error.notAllowed" };
  const db = serviceDb();
  let conn: AccountConnection | null;
  try {
    conn = await readAccountConnection(db, accountId);
  } catch (e) {
    console.error(`google calendar disconnect: account ${accountId}: reading the connection failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: "calendar.google.error.failed" };
  }
  if (!conn) return { ok: true };
  const token = conn.token;
  let revoked = false;
  if (token) {
    const r = await revokeGoogleToken(token, { fetch: globalThis.fetch });
    revoked = r.ok;
    if (!r.ok) console.error(`google calendar disconnect: account ${accountId}: revoke at Google failed (${r.error}); deleting the connection anyway`);
  }
  let gone: Awaited<ReturnType<typeof deleteGoogleConnection>>;
  try {
    gone = await deleteGoogleConnection(db, accountId, { id: conn.id, version: conn.version });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`google calendar disconnect: account ${accountId}: delete failed: ${token ? msg.split(token).join("[redacted]") : msg}`);
    return { ok: false, error: "calendar.google.error.failed" };
  }
  if (gone === "changed") {
    console.log(`google calendar disconnect: account ${accountId}: reconnected meanwhile; the new connection was kept`);
    return { ok: false, error: "calendar.google.error.changed" };
  }
  if (gone === "none") return { ok: true };
  await recordGoogleEvent(db, accountId, "google_calendar.disconnected", access, { revoked });
  return { ok: true };
}
