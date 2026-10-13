import { NextResponse } from "next/server";
import { getContact } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { contactDisplayName } from "@/lib/format";
import { loggableError } from "@/lib/loggable-error";
import { contactSourceHint } from "@/lib/contacts/lead-source";
import type { DrawerSummary } from "@/lib/contacts/drawer-summary";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr } from "@/lib/record/copy";
import { factsView } from "@/lib/record/record-facts";
import { nextUpView } from "@/lib/record/next-up";
import { timelineRows, timelineFailedText } from "@/lib/record/timeline-rows";
import { TIMELINE_ANCHOR } from "@/lib/record/timeline-pager";
import { recentRowsView } from "@/lib/record/recent-rows";
import { headerActions, headerActionLabels, canTextFrom, firstMapUrl } from "@/lib/record/header-actions";
import { loadSummary, loadNextUp, loadRecent, loadTags, loadHeaderPlaces, softSmsGate } from "@/lib/record/loaders";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { composerStateLine, type SmsRecipientState } from "@/lib/consent/composer-state";
import { languageView, type ContactLanguageFacts } from "@/lib/contacts/language";

export const dynamic = "force-dynamic";

/**
 * The contact list's drawer (S-03 part 3 §7): the record's quick look, built from the record page's
 * own loaders and view builders so the two never say different things. Authorisation first: the
 * contact read on the request client is a 404 before anything else starts, and the ledger client is
 * built only after it proved the contact (F-085 §7.3). Every string is in ONE locale, resolved here
 * (C1). Each section is its own status (C2): a failed read or a malformed row costs its section.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const contact = await getContact(db, accountId, contactId);
  if (!contact) return NextResponse.json({}, { status: 404 });

  // The QA override the drawer forwards from the list URL (C9); ignored outside BIS_I18N_QA.
  const localeParam = new URL(req.url).searchParams.get("locale") ?? undefined;
  const now = new Date();
  // The send gate's ledger fact, on the ledger client, built only now (after the proof). A missing
  // service key is "unknown", which closes Text, never a 500.
  const smsRead = async (): Promise<SmsRecipientState> => {
    try {
      return await smsRecipientState(ledgerDb(), accountId, contact);
    } catch (e) {
      console.error(`contact drawer: text consent unreadable for account ${accountId}: ${loggableError(e)}`);
      return { kind: "unknown" };
    }
  };
  const [prefs, account, summary, nextUp, recent, tags, places, smsGate, smsRecipient] = await Promise.all([
    getPersonPrefs(),
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    loadSummary(db, accountId, contactId),
    loadNextUp(db, accountId, contactId, now),
    loadRecent(db, accountId, contactId),
    loadTags(db, accountId, contactId),
    loadHeaderPlaces(db, accountId, contactId),
    softSmsGate(db, accountId),
    smsRead(),
  ]);
  if (account.error) {
    console.error(`contact drawer: account ${accountId} timezone and language read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  /** The page's `viewOf` ([contactId]/page.tsx:149-156): a throw while building a view costs its section. */
  const viewOf = <T,>(section: string, build: () => T): T | null => {
    try {
      return build();
    } catch (e) {
      console.error(`contact drawer: ${section} view failed for account ${accountId}: ${loggableError(e)}`);
      return null;
    }
  };

  const recordHref = `/dashboard/accounts/${accountId}/contacts/${contactId}`;
  const name = contactDisplayName(contact);
  const mainGroup = places?.groups.find((g) => g.isPrimary) ?? places?.groups[0] ?? null;
  const smsBlockedLine = composerStateLine(smsRecipient, zone.zone, locale);
  const header: DrawerSummary["header"] = {
    name,
    subtitle: mainGroup
      ? tr.text(mainGroup.kind === "household" ? "record.group.household" : "record.group.business", { group: mainGroup.name })
      : null,
    subtitleHref: mainGroup ? `/dashboard/accounts/${accountId}/groups/${mainGroup.id}` : null,
    // Text and Email open the record page's composer on that channel (D8, verified §8.2).
    actions: headerActionLabels(headerActions({
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      canText: canTextFrom({ phone: contact.phone ?? null, smsGate, smsBlockedLine }),
      directionsUrl: places ? firstMapUrl(places.places, contactId, places.groups) : null,
      composeHref: recordHref,
    }), tr, name),
  };

  const facts = summary.status === "ready"
    ? viewOf("summary", () => factsView({ createdAt: contact.created_at, facts: summary.facts }, { zone: zone.zone, now, tr }))
    : null;
  const upNext = nextUp.status === "ready" ? viewOf("next up", () => nextUpView(nextUp.data, { zone: zone.zone, now, tr })) : null;
  const rows = recent.status === "ready"
    ? viewOf("recent", () => recentRowsView(timelineRows(recent.page.items, {
      zone: zone.zone, tr, author: { viewerId: access.userId, names: recent.names, personaName: recent.personaName, tr },
    }), (contact.language as "en" | "es" | null) ?? ""))
    : null;
  // review M1/M-2: a bad stored date (etc.) costs this one line, never the whole response, and the
  // line is LEFT OUT (no who.language; the drawer reads absent as no line, plan deviation 11) rather
  // than a "Not set." that would be false for a set contact.
  const language = viewOf("language", () => languageView(contact as unknown as ContactLanguageFacts, {
    zone: zone.zone, tr, accountLanguage: accountRow ? (accountRow.language ?? null) : undefined,
  }));

  const body: DrawerSummary = {
    locale,
    header,
    facts: facts ? { status: "ready", view: facts } : { status: "error", text: tr.text("record.summary.failed") },
    nextUp: upNext
      ? { status: "ready", view: upNext, emptyText: tr.text("record.nextUp.empty") }
      : { status: "error", text: tr.text("record.nextUp.failed") },
    recent: recent.status === "ready" && rows
      ? {
        status: "ready", rows,
        failedText: timelineFailedText(recent.page.failed, tr),
        // Rule 5's empty state only when nothing failed: a failed source is not "nothing" (the page's rule).
        emptyText: rows.length === 0 && recent.page.failed.length === 0 ? tr.text("timeline.empty") : null,
        seeAllHref: `${recordHref}#${TIMELINE_ANCHOR}`,
      }
      : { status: "error", text: tr.text("record.activity.failed") },
    who: {
      source: contact.source ?? null,
      sourceHint: contactSourceHint({ source: contact.source ?? null, custom: contact.custom, attribution: contact.attribution }, locale),
      assignedTo: contact.assigned_to ?? null,
      fields: {
        first_name: contact.first_name ?? null, last_name: contact.last_name ?? null, email: contact.email ?? null,
        phone: contact.phone ?? null, company_name: contact.company_name ?? null,
      },
      tags: tags.status === "ready" ? { status: "ready", tags: tags.tags.map((t) => ({ id: t.id, name: t.name })) } : { status: "error" },
      ...(language ? { language } : {}),
    },
  };
  return NextResponse.json(body);
}
