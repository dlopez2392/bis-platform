import {
  listGroupMembers, listOpenDealsFor, listGroupPlaces, getContact,
  type GroupMembersPage, type GroupMember, type GroupPerson, type OpenDealRow, type ContactPlaces,
  type SupabaseClient, type TimelineCursor,
} from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import type { Locale } from "@/lib/i18n/locale";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { composerStateLine } from "@/lib/consent/composer-state";
import { loggableError } from "@/lib/loggable-error";
import { canTextFrom } from "./header-actions";

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
