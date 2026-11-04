import { getContact, mergedIdsOf, listPeopleNames, getVoiceProfile, type AuthorKind } from "@bis/db";
import { requireAccountOwner } from "@/lib/auth";
import { agencyVisitMissing } from "@/lib/access-log/gate";
import { noteOpenedApi } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { renderZone } from "@/lib/zone";
import { isUuid } from "@/lib/assign/action-guards";
import { contactDisplayName } from "@/lib/format";
import { dayKeyInZone } from "@/lib/booking/availability";
import { makeTr } from "@/lib/record/copy";
import { authorLabel } from "@/lib/record/author-mark";
import { loggableError } from "@/lib/loggable-error";
import { toHistoryCsv, toHistoryCsvRow, historyFilenameSlug } from "@/lib/record/history-csv";
import {
  fetchBoundedChangeRows, prefetchGuard, visitEndedResponse, tooBigResponse, readFailedResponse,
} from "@/lib/record/history-download";

export const dynamic = "force-dynamic";

/**
 * F-115 part 1 (S-04), plan Task 8 Step 2: Owners download one contact's history as CSV. Mirrors
 * `contacts/export/route.ts:91-114` for its opening guard sequence (a Link's prefetch or RSC fetch
 * never reads or logs; an agency whose visit ended is told so in plain text before any redirect can
 * fire) and `requireAccountOwner` for Staff/Technician refusal (that guard REDIRECTS, it never
 * answers 403 — `lib/auth.ts`'s own doc comment). Reads `record_changes` on the request's own RLS
 * client (0111 section 6: a Technician's token reads none of it even if it somehow reached here).
 * A contact's history includes its merged tombstones' own rows (`mergedIdsOf`, the way the timeline
 * already does), so a merge never hides what a contact used to carry under another id.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const prefetch = prefetchGuard(req);
  if (prefetch) return prefetch;
  if (await agencyVisitMissing(accountId)) return visitEndedResponse();

  const access = await requireAccountOwner(accountId);
  // A malformed id would otherwise reach getContact's `.eq("id", contactId)` and throw on the uuid
  // cast (a 500); this reads as the same "not here" 404 a real id in another account gets below.
  if (!isUuid(contactId)) return new Response(null, { status: 404 });

  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) return new Response(null, { status: 404 });

  // The record's language/zone are the SAME requestLocale/renderZone convention the export route and
  // every record page already use; computed before the row read so the 413 message, when it fires,
  // is in the reader's own language too.
  const prefs = await getPersonPrefs();
  const { data: accountRow, error: accountErr } = await db.from("accounts").select("language, timezone")
    .eq("id", accountId).maybeSingle();
  const accountLanguage = { language: (accountRow?.language as Locale | null | undefined) ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language });
  // F-115 PR C fix (review m4): this file is an audit record; an unread account row must not be
  // silently treated as "no account language" — fail the whole download loudly instead.
  if (accountErr) {
    console.error(`contact history route (account ${accountId}, contact ${contactId}): account read failed: ${loggableError(accountErr)}`);
    return readFailedResponse(locale);
  }

  // F-006 part 1's own id set (loaders.ts's loadTimeline): a merge's tombstones carry their own
  // change rows (their own writes before the merge moved them), which belong on the KEPT record's
  // download exactly as they belong on its timeline.
  // F-115 PR C fix (review m4): a failed read used to fall back to the contact alone, silently
  // dropping a tombstone's rows from an audit record — this fails the whole download loudly instead
  // (logged), rather than proceed and under-report.
  let tombstones: string[];
  try {
    tombstones = await mergedIdsOf(db, accountId, contactId);
  } catch (e) {
    console.error(`contact history route (account ${accountId}, contact ${contactId}): mergedIdsOf failed: ${loggableError(e)}`);
    return readFailedResponse(locale);
  }
  const ids = [contactId, ...tombstones];

  const fetched = await fetchBoundedChangeRows(db, accountId, { contactIds: ids });
  if ("tooBig" in fetched) return tooBigResponse(locale);

  // F-118 part 1 (spec Q5): an agency download is noted once nothing refuses it; a client Owner's
  // download is never logged (only the agency pays for the log, the export route's own split).
  if (access.isAgency) {
    if (!(await noteOpenedApi(access, accountId, { kind: "record_history_export", recordId: contactId }))) {
      return visitEndedResponse();
    }
  }

  const zone = (await renderZone(accountRow?.timezone ?? undefined)).zone;

  // "Record" (which of this contact's own ids a row belongs to — itself, or a tombstone merged into
  // it) needs these contacts' own names; ONE batched read, never one per row.
  const { data: nameData, error: nameErr } = await db.from("contacts")
    .select("id, first_name, last_name").in("id", ids);
  if (nameErr) throw new Error(`contact history route: contact names failed: ${nameErr.message}`);
  const recordNames = new Map<string, string>(
    (nameData as { id: string; first_name: string | null; last_name: string | null }[]).map(
      (r) => [r.id, contactDisplayName(r, locale)]));

  // "Who": the SAME author-mark system the timeline uses (author-mark.ts), fed `ChangeRow`'s own
  // authorKind/authorId directly rather than through a TimelineEntry — field labels and verb copy
  // stay PR E's (`change-rows.ts`), never built here.
  const personIds = [...new Set(
    fetched.rows
      .filter((r): r is typeof r & { authorId: string } => (r.authorKind ?? "automation") === "person" && !!r.authorId)
      .map((r) => r.authorId))];
  const [names, voiceProfile] = await Promise.all([
    listPeopleNames(db, personIds),
    getVoiceProfile(db, accountId),
  ]);
  const authorCtx = { viewerId: null, names, personaName: voiceProfile?.persona_name ?? null, tr: makeTr(locale) };

  const csvRows = fetched.rows.map((row) => toHistoryCsvRow(
    row, zone,
    (r) => recordNames.get(r.contactId ?? "") ?? r.contactId ?? "",
    (kind: AuthorKind, id: string | null) => authorLabel(kind, id, authorCtx),
  ));

  const date = dayKeyInZone(new Date(), zone);
  const filename = `history-${historyFilenameSlug(contactDisplayName(contact, locale))}-${date}.csv`;

  // The UTF-8 BOM, as the contacts export does: Excel mis-renders á/ñ/é on a double-clicked open
  // without it, and this file's own Spanish header and names carry exactly those characters.
  return new Response("﻿" + toHistoryCsv(locale, csvRows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
