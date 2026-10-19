import {
  contactFacts, contactNextUp, holdOpenTaskIds, listContactOpportunities, listContactPlaces, listContactTags,
  listCustomFields, listContactTimelinePage, listPeopleNames, getVoiceProfile, listPendingProposalsForContact,
  type ContactFacts, type ContactNextUp, type ContactPlaces, type CustomFieldDef, type SupabaseClient,
  type TimelinePage, type TimelineCursor,
} from "@bis/db";
import type { Proposal } from "@bis/db/proposal-rules";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { loggableError } from "@/lib/loggable-error";
import type { DescribeCtx } from "@/lib/proposals/kinds/types";
import { readSuggestionStages, type StageContext } from "@/lib/proposals/view-reads";
import { personIdsOf } from "./author-mark";

/**
 * One loader per record card (S-03 part 1, spec C5): each returns a load and NEVER throws, so one
 * card's failed read is that card's error state and never the page's. Logs name the card and the
 * account, never the customer's data (spec §11).
 */
const log = (card: string, accountId: string, e: unknown) =>
  console.error(`record page: ${card} read failed for account ${accountId}: ${loggableError(e)}`);

export type SummaryLoad = { status: "ready"; facts: ContactFacts } | { status: "error" };
export async function loadSummary(db: SupabaseClient, accountId: string, contactId: string): Promise<SummaryLoad> {
  try {
    const facts = await contactFacts(db, accountId, contactId, { onError: (name, e) => log(`summary (${name})`, accountId, e) });
    const allFailed = !facts.bookingsMade.ok && !facts.lastTalked.ok && !facts.openDeals.ok;
    return allFailed ? { status: "error" } : { status: "ready", facts };
  } catch (e) {
    log("summary", accountId, e);
    return { status: "error" };
  }
}

export type NextUpLoad = { status: "ready"; data: ContactNextUp } | { status: "error" };
export async function loadNextUp(db: SupabaseClient, accountId: string, contactId: string, now: Date): Promise<NextUpLoad> {
  try {
    return { status: "ready", data: await contactNextUp(db, accountId, contactId, now.toISOString()) };
  } catch (e) {
    log("next up", accountId, e);
    return { status: "error" };
  }
}

export type TimelineLoad =
  | {
    status: "ready"; page: TimelinePage; holdOpen: string[]; names: Record<string, string>; personaName: string | null;
    /** The stage names the page's accepted stage suggestions need (item 8b-2); `{}` when none, or unreadable. */
    suggestionStages: DescribeCtx["stages"];
  }
  | { status: "error" };

/**
 * The timeline card's load (S-03 1b, spec §7, C3, C5): one merged server page; a source that failed
 * is named in `page.failed` and the rest still render; only when EVERY source READ failed is it the
 * card's error. Then four soft reads, none of which can cost the card: the hold check (fails CLOSED), the
 * names on person marks (fails to "Someone on the team"), the receptionist's persona (fails to "Sofía"),
 * and the stage names of the accepted stage suggestions (item 8b-2; fails to the registry's honest
 * sentence, which names no stage). The record page is the ONE timeline that reads the suggestions source
 * (owner decision 1, 2026-10-19): `loadRecent` below and the group loader never pass it.
 */
export async function loadTimeline(
  db: SupabaseClient, ledger: SupabaseClient, accountId: string, contactId: string, before?: TimelineCursor,
): Promise<TimelineLoad> {
  let page: TimelinePage;
  try {
    page = await listContactTimelinePage(db, accountId, contactId, before, {
      suggestions: true,
      onError: (source, e) => log(`activity (${source})`, accountId, e),
    });
  } catch (e) {
    log("activity", accountId, e);
    return { status: "error" };
  }
  // Every source READ failed (item 8b-2: `sources`, not every source there is). The `> 0` keeps an empty set,
  // which reads nothing, an empty timeline rather than the error state.
  if (page.failed.length > 0 && page.failed.length >= page.sources.length) return { status: "error" };
  const tasks = page.items.flatMap((i) => (i.kind === "task" ? [i.task] : []));
  const accepted: Proposal[] = page.items.flatMap((i) => (i.kind === "suggestion" ? [i.suggestion.proposal] : []));
  const [holdOpen, names, personaName, suggestionStages] = await Promise.all([
    // Review R3-N1 (G21): a failed hold read fails CLOSED onto every open linked To-do on the page.
    // The tasks are the request client's; only the hold's ledger read moves (F-085, spec §7.3).
    holdOpenTaskIds(db, accountId, tasks, ledger).catch((e: unknown) => {
      console.error(`contact page: hold To-dos unreadable for contact ${contactId}: ${loggableError(e)}`);
      return tasks.filter((t) => !t.completed_at && t.consent_event_id).map((t) => t.id);
    }),
    listPeopleNames(db, personIdsOf(page.items)).catch((e: unknown) => {
      log("activity names", accountId, e);
      return {} as Record<string, string>;
    }),
    getVoiceProfile(db, accountId).then((p) => p?.persona_name ?? null).catch((e: unknown) => {
      log("activity persona", accountId, e);
      return null;
    }),
    // Account-scoped and bounded (readSuggestionStages); with no stage suggestion on the page it reads nothing.
    readSuggestionStages(db, accountId, accepted).then((c) => c.stages).catch((e: unknown) => {
      log("activity stage names", accountId, e);
      return {} as DescribeCtx["stages"];
    }),
  ]);
  return { status: "ready", page, holdOpen, names, personaName, suggestionStages };
}

export type WaitingLoad = { status: "ready"; rows: Proposal[]; stages: StageContext } | { status: "error" };

/**
 * What's next's "Waiting for you" (item 8b-2, spec 5.3): this customer's pending suggestions, at most
 * five, newest first, on the page's REQUEST client (RLS decides, P14), then the stage names and choices a
 * stage suggestion needs, read only when one is present. Either read failing is the section's own error
 * state, never the card's and never a throw. The persona is not read here: the page reuses the timeline's
 * (one read for the page, spec 5.3).
 */
export async function loadWaitingSuggestions(
  db: SupabaseClient, accountId: string, contactId: string, now: Date,
): Promise<WaitingLoad> {
  try {
    const rows = await listPendingProposalsForContact(db, accountId, contactId, now);
    const stages: StageContext = rows.some((r) => r.kind === "opportunity_stage")
      ? await readSuggestionStages(db, accountId, rows)
      : { stages: {}, pipelineStages: [] };
    return { status: "ready", rows, stages };
  } catch (e) {
    log("waiting suggestions", accountId, e);
    return { status: "error" };
  }
}

/** The list drawer's Recent: the newest five rows (S-03 part 3 D5). */
export const DRAWER_RECENT = 5;

export type RecentLoad =
  | { status: "ready"; page: TimelinePage; names: Record<string, string>; personaName: string | null }
  | { status: "error" };

/**
 * The list drawer's Recent (S-03 part 3 §6): the head of the record page's merged timeline, five
 * rows. No hold read and no ledger: those stand in for Done (`loadTimeline`, above), and the drawer
 * has no Done. A failed source is named in `page.failed`; every source failed is the section's error.
 * The names on person marks and the persona are soft, exactly as on the page. Never throws.
 */
export async function loadRecent(db: SupabaseClient, accountId: string, contactId: string): Promise<RecentLoad> {
  let page: TimelinePage;
  try {
    page = await listContactTimelinePage(db, accountId, contactId, undefined, {
      limit: DRAWER_RECENT,
      onError: (source, e) => log(`recent (${source})`, accountId, e),
    });
  } catch (e) {
    log("recent", accountId, e);
    return { status: "error" };
  }
  // Every source READ failed (item 8b-2: `sources`, not every source there is). The `> 0` keeps an empty set,
  // which reads nothing, an empty timeline rather than the error state.
  if (page.failed.length > 0 && page.failed.length >= page.sources.length) return { status: "error" };
  const [names, personaName] = await Promise.all([
    listPeopleNames(db, personIdsOf(page.items)).catch((e: unknown) => {
      log("recent names", accountId, e);
      return {} as Record<string, string>;
    }),
    getVoiceProfile(db, accountId).then((p) => p?.persona_name ?? null).catch((e: unknown) => {
      log("recent persona", accountId, e);
      return null;
    }),
  ]);
  return { status: "ready", page, names, personaName };
}

type Opps = NonNullable<Awaited<ReturnType<typeof listContactOpportunities>>>;
// The read's own row type (DealsBody's `DealRow` is structurally the same); lib never imports from app/.
export type DealsLoad = { status: "ready"; deals: Opps } | { status: "error" };
export async function loadDeals(db: SupabaseClient, accountId: string, contactId: string): Promise<DealsLoad> {
  try {
    return { status: "ready", deals: (await listContactOpportunities(db, accountId, contactId)) ?? [] };
  } catch (e) {
    log("deals", accountId, e);
    return { status: "error" };
  }
}

type Tags = Awaited<ReturnType<typeof listContactTags>>;
export type TagsLoad = { status: "ready"; tags: Tags } | { status: "error" };
export async function loadTags(db: SupabaseClient, accountId: string, contactId: string): Promise<TagsLoad> {
  try {
    return { status: "ready", tags: await listContactTags(db, accountId, contactId) };
  } catch (e) {
    log("tags", accountId, e);
    return { status: "error" };
  }
}

export type FieldDefsLoad = { status: "ready"; fieldDefs: CustomFieldDef[] } | { status: "error" };
export async function loadFieldDefs(db: SupabaseClient, accountId: string): Promise<FieldDefsLoad> {
  try {
    return { status: "ready", fieldDefs: await listCustomFields(db, accountId, "contact") };
  } catch (e) {
    log("custom fields", accountId, e);
    return { status: "error" };
  }
}

/** The header's group line and Directions (spec §7): soft, so a failure drops them, never the header. */
export async function loadHeaderPlaces(db: SupabaseClient, accountId: string, contactId: string): Promise<ContactPlaces | null> {
  try {
    return await listContactPlaces(db, accountId, contactId);
  } catch (e) {
    log("header places", accountId, e);
    return null;
  }
}

/** THE send gate, read soft (spec §7): null on a failed read, which hides Text and makes the composer say "unknown". */
export async function softSmsGate(db: SupabaseClient, accountId: string): Promise<SmsGate | null> {
  try {
    return await resolveSmsSender(db, accountId);
  } catch (e) {
    log("text gate", accountId, e);
    return null;
  }
}
