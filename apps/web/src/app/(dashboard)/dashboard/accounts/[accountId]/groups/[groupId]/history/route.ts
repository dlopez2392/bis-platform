import { readGroup, listPeopleNames, getVoiceProfile, type AuthorKind } from "@bis/db";
import { requireAccountOwner } from "@/lib/auth";
import { agencyVisitMissing } from "@/lib/access-log/gate";
import { noteOpenedApi } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { renderZone } from "@/lib/zone";
import { isUuid } from "@/lib/assign/action-guards";
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
 * F-115 part 1 (S-04), plan Task 8 Step 2: the group-page twin of the contact history route — read
 * that file's own doc comment for the shared reasoning (the guard sequence mirrors
 * `contacts/export/route.ts:91-114`; `requireAccountOwner` REDIRECTS a Staff/Technician, it never
 * answers 403). "Record" is this group's own name for every row (unlike a contact's download, a
 * group's own `record_changes` rows are already scoped to exactly one `client_group_id` — there is
 * no tombstone concept for a household or business to fold in).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string; groupId: string }> },
) {
  const { accountId, groupId } = await params;
  const prefetch = prefetchGuard(req);
  if (prefetch) return prefetch;
  if (await agencyVisitMissing(accountId)) return visitEndedResponse();

  const access = await requireAccountOwner(accountId);
  if (!isUuid(groupId)) return new Response(null, { status: 404 });

  const db = await dbForRequest();
  const group = await readGroup(db, accountId, groupId);
  if (!group) return new Response(null, { status: 404 });

  const prefs = await getPersonPrefs();
  const { data: accountRow, error: accountErr } = await db.from("accounts").select("language, timezone")
    .eq("id", accountId).maybeSingle();
  const accountLanguage = { language: (accountRow?.language as Locale | null | undefined) ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language });
  // F-115 PR C fix (review m4), mirrored from the contact history route: this file is an audit
  // record; an unread account row must not be silently treated as "no account language" — fail the
  // whole download loudly instead.
  if (accountErr) {
    console.error(`group history route (account ${accountId}, group ${groupId}): account read failed: ${loggableError(accountErr)}`);
    return readFailedResponse(locale);
  }

  const fetched = await fetchBoundedChangeRows(db, accountId, { groupId });
  if ("tooBig" in fetched) return tooBigResponse(locale);

  if (access.isAgency) {
    if (!(await noteOpenedApi(access, accountId, { kind: "record_history_export", recordId: groupId }))) {
      return visitEndedResponse();
    }
  }

  const zone = (await renderZone(accountRow?.timezone ?? undefined)).zone;

  const personIds = [...new Set(
    fetched.rows
      .filter((r): r is typeof r & { authorId: string } => r.authorKind === "person" && !!r.authorId)
      .map((r) => r.authorId))];
  const [names, voiceProfile] = await Promise.all([
    listPeopleNames(db, personIds),
    getVoiceProfile(db, accountId),
  ]);
  const authorCtx = { viewerId: null, names, personaName: voiceProfile?.persona_name ?? null, tr: makeTr(locale) };

  // Every row this route reads already belongs to this one group (fetchBoundedChangeRows's own
  // `{ groupId }` scope), so "Record" is this group's own name for every row — there is no second
  // record a group's history could be about the way a merge's tombstones give a contact's.
  const csvRows = fetched.rows.map((row) => toHistoryCsvRow(
    row, zone,
    () => group.name,
    (kind: AuthorKind, id: string | null) => authorLabel(kind, id, authorCtx),
  ));

  const date = dayKeyInZone(new Date(), zone);
  const filename = `history-${historyFilenameSlug(group.name)}-${date}.csv`;

  return new Response("﻿" + toHistoryCsv(locale, csvRows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
