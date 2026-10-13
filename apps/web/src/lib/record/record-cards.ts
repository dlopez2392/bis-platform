import type { RecordColumn } from "@/components/record/record-layout";
import type { MessageKey } from "@/lib/messages";

export type RecordCardId =
  | "summary" | "next-up" | "timeline" | "groups" | "properties" | "deals" | "details" | "tags" | "related-people";
/** The household and business page's cards (S-03 part 2, spec §7). 2b adds the three middle cards. */
export type GroupRecordCardId = "properties" | "deals" | "people" | "details";

/** One core card of a record page (spec §8). The page binds each id to its body: a card with no body is a compile error. */
export type RecordCardDef<Id extends string = RecordCardId> = {
  id: Id; column: RecordColumn; deskOrder: number; phoneOrder: number;
  collapsibleOnPhone: boolean; titleKey: MessageKey; skeletonRows: number;
};

/** The spec's §8 table, verbatim. Packs (later modules) add rows here, never pages. */
export const RECORD_CARDS: readonly RecordCardDef<RecordCardId>[] = [
  { id: "summary", column: "happening", deskOrder: 1, phoneOrder: 1, collapsibleOnPhone: false, titleKey: "record.card.summary", skeletonRows: 1 },
  { id: "next-up", column: "happening", deskOrder: 2, phoneOrder: 2, collapsibleOnPhone: false, titleKey: "record.card.nextUp", skeletonRows: 3 },
  { id: "timeline", column: "happening", deskOrder: 3, phoneOrder: 3, collapsibleOnPhone: false, titleKey: "record.card.activity", skeletonRows: 5 },
  { id: "groups", column: "have", deskOrder: 1, phoneOrder: 4, collapsibleOnPhone: true, titleKey: "groups.title", skeletonRows: 2 },
  { id: "properties", column: "have", deskOrder: 2, phoneOrder: 5, collapsibleOnPhone: true, titleKey: "places.title", skeletonRows: 2 },
  { id: "deals", column: "have", deskOrder: 3, phoneOrder: 6, collapsibleOnPhone: true, titleKey: "record.card.deals", skeletonRows: 2 },
  { id: "details", column: "who", deskOrder: 1, phoneOrder: 7, collapsibleOnPhone: false, titleKey: "contact.details", skeletonRows: 4 },
  { id: "tags", column: "who", deskOrder: 2, phoneOrder: 8, collapsibleOnPhone: false, titleKey: "contact.tags", skeletonRows: 1 },
  { id: "related-people", column: "who", deskOrder: 3, phoneOrder: 9, collapsibleOnPhone: false, titleKey: "relationships.title", skeletonRows: 2 },
];

/** S-03 part 2 §7: what they have (closed on a phone), then who they are. The phone numbers leave 1-3 to 2b's middle column. */
export const GROUP_RECORD_CARDS: readonly RecordCardDef<GroupRecordCardId>[] = [
  { id: "properties", column: "have", deskOrder: 1, phoneOrder: 4, collapsibleOnPhone: true, titleKey: "places.title", skeletonRows: 2 },
  { id: "deals", column: "have", deskOrder: 2, phoneOrder: 5, collapsibleOnPhone: true, titleKey: "record.card.deals", skeletonRows: 2 },
  { id: "people", column: "who", deskOrder: 1, phoneOrder: 6, collapsibleOnPhone: false, titleKey: "groupPage.card.people", skeletonRows: 3 },
  { id: "details", column: "who", deskOrder: 2, phoneOrder: 7, collapsibleOnPhone: false, titleKey: "groupPage.card.details", skeletonRows: 3 },
];

export function cardsInPhoneOrder<Id extends string>(cards: readonly RecordCardDef<Id>[]): RecordCardDef<Id>[] {
  return [...cards].sort((a, b) => a.phoneOrder - b.phoneOrder);
}

/** Consecutive same-column runs in phone order: the DOM order RecordLayout renders (C6). */
export function columnRuns<Id extends string>(cards: readonly RecordCardDef<Id>[]): { column: RecordColumn; cards: RecordCardDef<Id>[] }[] {
  const runs: { column: RecordColumn; cards: RecordCardDef<Id>[] }[] = [];
  for (const card of cardsInPhoneOrder(cards)) {
    const last = runs.at(-1);
    if (last && last.column === card.column) last.cards.push(card);
    else runs.push({ column: card.column, cards: [card] });
  }
  return runs;
}
