import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { readGroup, type GroupKind, type GroupMember } from "@bis/db";
import { dbForRequest } from "@/lib/db";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid } from "@/lib/assign/action-guards";
import type { MessageKey } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordHeader } from "@/components/record/record-header";
import { RecordCard, type RecordCardState } from "@/components/record/record-card";
import { GROUP_RECORD_CARDS, columnRuns, type GroupRecordCardId } from "@/lib/record/record-cards";
import { makeTr } from "@/lib/record/copy";
import { softSmsGate, loadHeaderPlaces } from "@/lib/record/loaders";
import { groupHeaderActions, firstGroupMapUrl, memberName, memberFirstName, peoplePagerHrefs } from "@/lib/record/group-header";
import {
  loadGroupPeople, loadGroupDeals, loadGroupHeaderPlaces, loadPrimaryText,
  loadGroupActivity, loadGroupSummary, loadGroupNextUp, loadGroupTimeline,
} from "@/lib/record/group-loaders";
import { groupFactsView, groupCapLine } from "@/lib/record/group-facts";
import { nextUpView } from "@/lib/record/next-up";
import { timelineRows, timelineFailedText } from "@/lib/record/timeline-rows";
import { timelinePagerHrefs } from "@/lib/record/timeline-pager";
import { parseTimelineCursor } from "@/lib/cursor";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import type { Locale } from "@/lib/i18n/locale";
import { loggableError } from "@/lib/loggable-error";
import { renderZone } from "@/lib/zone";
import { PlacesCard } from "../../contacts/places-card";
import { DealsBody } from "../../contacts/[contactId]/deals-card";
import { SummaryBody } from "../../contacts/[contactId]/summary-card";
import { NextUpBody } from "../../contacts/[contactId]/next-up-card";
import { PeopleCard, type PeopleRow } from "./people-card";
import { DetailsCard } from "./details-card";
import { GroupTimeline } from "./group-timeline";

export const dynamic = "force-dynamic";

type Slot = { node: ReactNode; state?: RecordCardState; errorText?: string };
const KIND_KEY = { household: "groups.kind.household", business: "groups.kind.business" } as const satisfies Record<GroupKind, MessageKey>;
const PLACES_EMPTY_KEY = {
  household: "groupPage.places.emptyHousehold", business: "groupPage.places.emptyBusiness",
} as const satisfies Record<GroupKind, MessageKey>;

/**
 * A household's or business's record page (S-03 part 2; spec §8). A record reached from its
 * members' pages (the contact header's group words and the Groups card's Open, R2), never a nav
 * surface. The group read on the REQUEST client is the authorisation: a malformed id, or a group the
 * caller cannot see (another account's; for a Technician, one with none of their customers, 0069's
 * my_client_group_ids), is a 404 before any other read (C16), identical to one that does not exist.
 * Every card has its own loader, which never throws, and its own boundary, so one card's fault never
 * blanks the page (part 1 C5). The middle column (2b) reads ONE set, groupActivityMembers' ≤50
 * people, and Deals reads the same set (C13).
 */
export default async function GroupRecordPage({ params, searchParams }: {
  params: Promise<{ accountId: string; groupId: string }>;
  // Optional, as the contact page's: the QA locale override, People's own cursor (C10) and the
  // timeline's (2b). Each pager keeps only ?locale= (plan deviation 14).
  searchParams?: Promise<{ locale?: string; people?: string; before?: string }>;
}) {
  const { accountId, groupId } = await params;
  const { locale: localeParam, people: peopleParam, before: beforeParam } = (await searchParams) ?? {};
  const access = await requireAccountAccess(accountId);
  // C16: a malformed id would be a 500 from the uuid cast; it is a 404, before any read.
  if (!isUuid(groupId)) notFound();
  const db = await dbForRequest();
  const group = await readGroup(db, accountId, groupId);
  if (!group) notFound();

  // A ?people= or ?before= that does not parse is a cold start, never an error.
  const after = parseTimelineCursor(peopleParam);
  const before = parseTimelineCursor(beforeParam);
  // C2, C3: who chooses the call-first member and removes is the whole-account reader, never a
  // Technician (and a client whose role could not be settled fails closed, lib/auth-role.ts). C4:
  // every other reader is NARROW, and is told "people you can see" whether or not anything is hidden.
  const manager = seesWholeAccount(access);
  const narrow = !manager;
  // C5: the middle column's ONE set, read before the cards that take it. A failed scan leaves no set:
  // the summary, Next up, the timeline and Deals are then their own cards' errors, never read with a
  // guessed set (People's page is a different list, by joined order).
  const activity = await loadGroupActivity(db, accountId, group.id);
  const set = activity.status === "ready" ? activity.activity : null;
  const ids = set ? set.people.map((p) => p.contactId) : null;
  const now = new Date();
  const noSet = { status: "error" } as const;
  const [prefs, account, smsGate, people, places, deals, summary, nextUp, timeline] = await Promise.all([
    getPersonPrefs(),
    // The account's zone (dates; the composer's consent line) and language (a client's default locale).
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    softSmsGate(db, accountId),
    loadGroupPeople(db, accountId, group.id, after),
    loadGroupHeaderPlaces(db, accountId, group.id),
    // C13: the open deals of the same ≤50 people the middle column reads (plan deviation 5).
    loadGroupDeals(db, accountId, async () => {
      if (!set) throw new Error("no activity set");
      return set.people;
    }),
    ids ? loadGroupSummary(db, accountId, ids) : noSet,
    ids ? loadGroupNextUp(db, accountId, ids, now) : noSet,
    ids ? loadGroupTimeline(db, accountId, ids, before) : noSet,
  ]);
  // Not a throw: a cosmetic zone and a default language must not 500 the page.
  if (account.error) console.error(`group page: account ${accountId} timezone and language read failed: ${account.error.message}`);
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  // The header (spec §8.1): Call, Text and Email go to the call-first member; with none visible
  // (none chosen, someone else's customer for a Technician, or People's read failed) they hide (D4).
  const primary = people.status === "ready" ? people.page.primary : null;
  const groupUrl = firstGroupMapUrl(places?.places ?? [], []);
  const [ownUrl, canText] = await Promise.all([
    // D4: the call-first member's OWN first place, only when the group's places were READ and none
    // has an address. A failed group read (places null) cannot know that, so it drops Directions
    // (spec §6) rather than guessing. Soft (loadHeaderPlaces never throws); the filter keeps out the
    // places of the member's other groups.
    !groupUrl && places && primary
      ? loadHeaderPlaces(db, accountId, primary.contactId).then((own) =>
        firstGroupMapUrl([], (own?.places ?? []).filter((p) => p.contact_id === primary.contactId)))
      : Promise.resolve(null),
    // C14: Text exactly when the member's composer would open; soft, failing closed.
    loadPrimaryText({ db, accountId, primary, smsGate, zone: zone.zone, locale }),
  ]);
  const actions = groupHeaderActions({ accountId, primary, canText, directionsUrl: groupUrl ?? ownUrl, tr });

  // A name on this page is built in the page's language (memberName), never contactDisplayName's English.
  const row = (p: GroupMember): PeopleRow => ({
    memberId: p.memberId, contactId: p.contactId, name: memberName(p, tr), role: p.role,
    isBilling: p.isBilling, isPrimaryContact: p.isPrimaryContact,
  });
  const basePath = `/dashboard/accounts/${accountId}/groups/${group.id}`;
  const failed = (titleKey: MessageKey): Slot => ({ node: null, state: "error", errorText: tr.text("record.card.failed", { title: tr.text(titleKey) }) });
  const failedWith = (key: MessageKey): Slot => ({ node: null, state: "error", errorText: tr.text(key) });
  // Every name on this page comes from the activity set, built in the page's language: the whole
  // name on a deal and a timeline row, the first name in the facts and Next up (spec §8.6, §8.7).
  const setPeople = set?.people ?? [];
  const names = new Map(setPeople.map((p) => [p.contactId, memberName(p, tr)]));
  const firstNames: Record<string, string> = Object.fromEntries(setPeople.map((p) => [p.contactId, memberFirstName(p, tr)]));
  const subjects = Object.fromEntries(setPeople.map((p) => [p.contactId, {
    label: memberName(p, tr), href: `/dashboard/accounts/${accountId}/contacts/${p.contactId}`,
  }]));

  /**
   * A view model is built HERE, outside every card's boundary, so a throw while building one (a
   * malformed instant from a read) would reject the whole page. Each is built in its own try: a
   * failure costs only its own card (part 1 C5), logged by card and account, as the contact page's.
   */
  const viewOf = <T,>(card: string, build: () => T): T | null => {
    try {
      return build();
    } catch (e) {
      console.error(`record page: ${card} view failed for account ${accountId}: ${loggableError(e)}`);
      return null;
    }
  };
  const facts = set && summary.status === "ready"
    ? viewOf("summary", () => groupFactsView({ total: set.total, narrow, facts: summary.facts, names: firstNames }, { zone: zone.zone, now, tr }))
    : null;
  const upNext = nextUp.status === "ready"
    ? viewOf("next up", () => nextUpView(nextUp.data, { zone: zone.zone, now, tr, names: firstNames }))
    : null;
  const timelineView = timeline.status === "ready"
    ? viewOf("timeline", () => timelineRows(timeline.page.items, {
      zone: zone.zone, tr, subjects,
      author: { viewerId: access.userId, names: timeline.names, personaName: timeline.personaName, tr },
    }))
    : null;
  // D7, plan deviation 12: ONE line, only past the cap, at the top of the middle column, outside
  // every card, so a failed summary never hides what governs Next up and the timeline too. `more`:
  // with the count failed, the scan alone still knows the list was cut, and says so without a total.
  const capLine = set ? groupCapLine({ total: set.total, shown: set.people.length, narrow, more: set.more }, tr) : null;

  const slots = {
    summary: facts && !facts.allFailed
      ? { node: <SummaryBody view={facts} retryLabel={tr.text("record.card.retry")} /> }
      : failedWith("record.summary.failed"),
    // Read-only, and no "Add a To-do": there is no composer on this page (D5).
    "next-up": upNext
      ? { node: <NextUpBody view={upNext} emptyText={tr.text("groupPage.nextUp.empty")} addTodoLabel={null} /> }
      : failedWith("record.nextUp.failed"),
    timeline: timeline.status === "ready" && timelineView
      ? {
        node: (
          <GroupTimeline accountId={accountId} timezone={zone.zone} rows={timelineView} tr={tr}
            failedText={timelineFailedText(timeline.page.failed, tr)}
            // Rule 5's empty state only on the head, and only when nothing failed: a failed source is not "nothing".
            emptyText={!before && timelineView.length === 0 && timeline.page.failed.length === 0 ? tr.text("groupPage.timeline.empty") : null}
            // A page where a source failed offers no Older (its cursor would skip that source's rows).
            pager={timelinePagerHrefs({
              basePath: `/dashboard/accounts/${accountId}/groups/${group.id}`,
              older: timeline.page.older, paged: Boolean(before), failed: timeline.page.failed, locale: localeParam,
            })} />
        ),
      }
      : failedWith("record.activity.failed"),
    properties: {
      node: <PlacesCard accountId={accountId} group={{ id: group.id, kind: group.kind, name: group.name }} canMovePlace={false} headingHidden
        emptyText={tr.text(PLACES_EMPTY_KEY[group.kind])} />,
    },
    deals: deals.status === "ready"
      ? {
        node: <DealsBody tr={tr} emptyText={tr.text("groupPage.deals.empty")}
          deals={deals.deals.map((d) => ({ ...d, who: names.get(d.contact_id) }))}
          moreText={deals.count > deals.deals.length ? tr.text("groupPage.deals.more", { shown: deals.deals.length, count: deals.count }) : null} />,
      }
      : failed("record.card.deals"),
    people: people.status === "ready"
      ? {
        node: <PeopleCard accountId={accountId} groupId={group.id} kind={group.kind} manager={manager}
          primary={people.page.primary ? row(people.page.primary) : null} rows={people.page.members.map(row)} paged={Boolean(after)}
          pager={peoplePagerHrefs({ basePath, next: people.page.next, paged: Boolean(after), locale: localeParam })} />,
      }
      : failed("groupPage.card.people"),
    // The group row is the page's authorisation: had it failed, the page would already have 404'd or errored (§8.3).
    details: {
      node: <DetailsCard accountId={accountId} groupId={group.id} name={group.name} kind={group.kind}
        billingAddress={group.billingAddress} manager={manager} />,
    },
  } satisfies Record<GroupRecordCardId, Slot>;

  const columns = columnRuns(GROUP_RECORD_CARDS).map(({ column, cards }) => ({
    column,
    content: [
      column === "happening" && capLine ? <p key="capped" data-group-capped className="text-sm text-muted-foreground">{capLine}</p> : null,
      ...cards.map((def) => {
        const slot: Slot = slots[def.id];
        return (
          <RecordCard key={def.id} id={def.id} title={tr.text(def.titleKey)} collapsibleOnPhone={def.collapsibleOnPhone}
            skeletonRows={def.skeletonRows} state={slot.state ?? "ready"} errorText={slot.errorText}>
            {slot.node}
          </RecordCard>
        );
      }),
    ],
  }));

  return (
    // The page's own locale reaches the client cards too (a `?locale=` QA override the layout never sees).
    <LocaleProvider locale={locale}>
      <RecordLayout lang={locale} skipLabel={tr.text("record.skipToDetails")} columns={columns}
        header={<RecordHeader name={group.name} subtitle={tr.text(KIND_KEY[group.kind])} actions={actions}
          back={{ href: `/dashboard/accounts/${accountId}/contacts`, label: tr.text("record.back") }} />} />
    </LocaleProvider>
  );
}
