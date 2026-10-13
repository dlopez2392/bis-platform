import {
  listGroupMembers, listOpenDealsFor, listGroupPlaces, getContact,
  groupActivityMembers, groupFacts, groupNextUp, listTimelinePage, listPeopleNames, getVoiceProfile, TIMELINE_SOURCES,
  type GroupMembersPage, type GroupMember, type GroupPerson, type OpenDealRow, type ContactPlaces,
  type GroupActivity, type GroupFacts, type GroupNextUp, type TimelinePage,
  type SupabaseClient, type TimelineCursor,
} from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import type { Locale } from "@/lib/i18n/locale";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { composerStateLine } from "@/lib/consent/composer-state";
import { loggableError } from "@/lib/loggable-error";
import { canTextFrom } from "./header-actions";
import { personIdsOf } from "./author-mark";

/**
 * One loader per group card (S-03 part 2; part 1 C5): each returns a load and NEVER throws, so one
 * card's failed read is that card's error state and never the page's. Logs name the card and the
 * account only, never the group, the member or their data.
 */
const log = (card: string, accountId: string, e: unknown) =>
  console.error(`record page: ${card} read failed for account ${accountId}: ${loggableError(e)}`);

export type PeopleLoad = { status: "ready"; page: GroupMembersPage } | { status: "error" };
export async function loadGroupPeople(
  db: SupabaseClient, accountId: string, groupId: string, after?: TimelineCursor,
): Promise<PeopleLoad> {
  try {
    return { status: "ready", page: await listGroupMembers(db, accountId, groupId, { after }) };
  } catch (e) {
    log("people", accountId, e);
    return { status: "error" };
  }
}

export type GroupDealsLoad =
  | { status: "ready"; deals: OpenDealRow[]; count: number; people: GroupPerson[] }
  | { status: "error" };
/** C13: open deals of the page's set of people (2a: the first 50 joined; 2b: the activity set). */
export async function loadGroupDeals(
  db: SupabaseClient, accountId: string, people: () => Promise<GroupPerson[]>,
): Promise<GroupDealsLoad> {
  try {
    const set = await people();
    const { deals, count } = await listOpenDealsFor(db, accountId, set.map((p) => p.contactId));
    return { status: "ready", deals, count, people: set };
  } catch (e) {
    log("deals", accountId, e);
    return { status: "error" };
  }
}

/** The header's Directions (spec §8.1): soft, so a failure drops Directions, never the header. */
export async function loadGroupHeaderPlaces(db: SupabaseClient, accountId: string, groupId: string): Promise<ContactPlaces | null> {
  try {
    return await listGroupPlaces(db, accountId, groupId);
  } catch (e) {
    log("header places", accountId, e);
    return null;
  }
}

/**
 * C14: would the call-first member's text composer open? The ledger client (a service client,
 * F-085 §7.3) is built only after getContact on the REQUEST client proved the member, the contact
 * page's rule (`[contactId]/page.tsx`: getContact, then ledgerDb). Soft and failing closed: any
 * failure hides Text.
 */
export async function loadPrimaryText(input: {
  db: SupabaseClient; accountId: string; primary: GroupMember | null; smsGate: SmsGate | null; zone: string; locale: Locale;
}): Promise<boolean> {
  // A closed gate (no approved number yet) hides Text whatever the member's consent says: no read.
  if (!input.primary || !input.smsGate || !input.smsGate.ok) return false;
  try {
    const contact = await getContact(input.db, input.accountId, input.primary.contactId);
    if (!contact) return false;
    const state = await smsRecipientState(ledgerDb(), input.accountId, contact);
    const line = composerStateLine(state, input.zone, input.locale);
    return canTextFrom({ phone: contact.phone ?? null, smsGate: input.smsGate, smsBlockedLine: line });
  } catch (e) {
    // Not "text gate": loaders.ts's softSmsGate logs that for the account's gate read.
    log("primary text", input.accountId, e);
    return false;
  }
}

export type GroupActivityLoad = { status: "ready"; activity: GroupActivity } | { status: "error" };
/**
 * The middle column's set (S-03 part 2b, C5): at most 50 members, the call-first first. A failed
 * scan is the summary's, Next up's and the timeline's error (they have no set to read); a failed
 * head count is only the people fact's (`activity.total`, plan deviation 9), logged here as
 * "activity set (people)" so it is never swallowed.
 */
export async function loadGroupActivity(db: SupabaseClient, accountId: string, groupId: string): Promise<GroupActivityLoad> {
  try {
    const onError = (name: string, e: unknown) => log(`activity set (${name})`, accountId, e);
    return { status: "ready", activity: await groupActivityMembers(db, accountId, groupId, undefined, { onError }) };
  } catch (e) {
    log("activity set", accountId, e);
    return { status: "error" };
  }
}

export type GroupSummaryLoad = { status: "ready"; facts: GroupFacts } | { status: "error" };
/** The group summary's facts across the set. Each failed fact is named in the log; whether the
 *  card has anything left to say is `groupFactsView`'s `allFailed`, which also weighs the count. */
export async function loadGroupSummary(db: SupabaseClient, accountId: string, contactIds: readonly string[]): Promise<GroupSummaryLoad> {
  try {
    return { status: "ready", facts: await groupFacts(db, accountId, contactIds, { onError: (name, e) => log(`summary (${name})`, accountId, e) }) };
  } catch (e) {
    log("summary", accountId, e);
    return { status: "error" };
  }
}

export type GroupNextUpLoad = { status: "ready"; data: GroupNextUp } | { status: "error" };
export async function loadGroupNextUp(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], now: Date,
): Promise<GroupNextUpLoad> {
  try {
    return { status: "ready", data: await groupNextUp(db, accountId, contactIds, now.toISOString()) };
  } catch (e) {
    log("next up", accountId, e);
    return { status: "error" };
  }
}

export type GroupTimelineLoad =
  | { status: "ready"; page: TimelinePage; names: Record<string, string>; personaName: string | null }
  | { status: "error" };
/**
 * The group timeline (S-03 part 2b, C6, C7): loaders.ts's loadTimeline across the set, read-only, so
 * there is no hold read (no Done here). A source that failed is named in `page.failed`; only when all
 * seven failed is it the card's error. The names on person marks and the persona are soft.
 */
export async function loadGroupTimeline(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], before?: TimelineCursor,
): Promise<GroupTimelineLoad> {
  let page: TimelinePage;
  try {
    page = await listTimelinePage(db, accountId, contactIds, before, {
      onError: (source, e) => log(`activity (${source})`, accountId, e),
    });
  } catch (e) {
    log("activity", accountId, e);
    return { status: "error" };
  }
  if (page.failed.length >= TIMELINE_SOURCES.length) return { status: "error" };
  const [names, personaName] = await Promise.all([
    listPeopleNames(db, personIdsOf(page.items)).catch((e: unknown) => {
      log("activity names", accountId, e);
      return {} as Record<string, string>;
    }),
    getVoiceProfile(db, accountId).then((p) => p?.persona_name ?? null).catch((e: unknown) => {
      log("activity persona", accountId, e);
      return null;
    }),
  ]);
  return { status: "ready", page, names, personaName };
}
