import { describe, it, expect } from "vitest";
import type { ChangeGroup, ChangeRow } from "@bis/db";
import { makeTr } from "./copy";
import { changeRowView, formatChangeValue, causeLabel, type ChangeViewCtx } from "./change-rows";

const AT = "2026-11-02T16:12:00Z";
const baseRow = (over: Partial<ChangeRow>): ChangeRow => ({
  id: 1, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
  op: "update", field: "phone", before: "a", after: "b", xact: "1",
  authorKind: "person", authorId: "user_1", via: null, createdAt: AT,
  ...over,
});
const group = (rows: ChangeRow[], over: Partial<ChangeGroup> = {}): ChangeGroup => ({
  key: "contact:c1:1", recordType: "contact", recordId: "c1", authorKind: "person", authorId: "user_1",
  via: null, at: AT, firstAt: AT, steps: [rows], rows,
  ...over,
});

const ctx = (over: Partial<ChangeViewCtx> = {}, locale: "en" | "es" = "en"): ChangeViewCtx => ({
  tr: makeTr(locale), zone: "America/Chicago", names: {}, customFieldLabels: {},
  ...over,
});

describe("changeRowView: the verb (plan Task 5 Step 1)", () => {
  it("one changed field (mutation: drop the field label lookup -> raw column name, FAILS)", () => {
    const g = group([baseRow({ field: "phone" })]);
    expect(changeRowView(g, ctx()).verb).toBe("changed phone");
  });

  it("two changed fields joined with a conjunction, deduped by field name (mutation: list.join(',') instead of Intl.ListFormat -> FAILS)", () => {
    const rows = [
      baseRow({ id: 1, field: "phone", xact: "1" }),
      baseRow({ id: 2, field: "email", xact: "1" }),
    ];
    expect(changeRowView(group(rows), ctx()).verb).toBe("changed phone and email");
  });

  it("in Spanish (mutation: read the English key -> FAILS)", () => {
    const g = group([baseRow({ field: "phone" })]);
    expect(changeRowView(g, ctx({}, "es")).verb).toBe("cambió el teléfono");
  });

  it("a custom field reads its own account label, falling back to the raw key (mutation: always use the raw key -> FAILS)", () => {
    const g = group([baseRow({ field: "custom.gate" })]);
    expect(changeRowView(g, ctx({ customFieldLabels: { gate: "Gate code" } })).verb).toBe("changed Gate code");
    expect(changeRowView(g, ctx()).verb).toBe("changed gate");
  });

  it("an insert reads 'added this record' for a contact (mutation: read the first row's field instead -> FAILS)", () => {
    const row = baseRow({ op: "insert", field: null, before: null, after: { first_name: "Ana" } });
    expect(changeRowView(group([row]), ctx()).verb).toBe("added this record");
  });

  // F-115 PR E fix (review I7): a per-type "added" verb, naming the new thing — never the generic
  // "added this record" for a type that has its own name to give.
  it("a per-type added verb for equipment, place, a tag, a relationship and a household/business member (mutation: always use history.verb.added -> FAILS)", () => {
    const equipmentRow = baseRow({ recordType: "equipment", op: "insert", field: null, before: null, after: { name: "Carrier AC" } });
    expect(changeRowView(group([equipmentRow], { recordType: "equipment" }), ctx()).verb).toBe("added the unit Carrier AC");

    const placeRow = baseRow({ recordType: "place", op: "insert", field: null, before: null, after: { label: "Back yard" } });
    expect(changeRowView(group([placeRow], { recordType: "place" }), ctx()).verb).toBe("added the place Back yard");

    const tagRow = baseRow({ recordType: "contact_tag", recordId: "tag-7", op: "insert", field: null, before: null, after: { contact_id: "c1", tag_id: "tag-7" } });
    expect(changeRowView(group([tagRow], { recordType: "contact_tag" }), ctx({ names: { "tag-7": "VIP" } })).verb).toBe("added the tag VIP");

    const relRow = baseRow({ recordType: "contact_relationship", op: "insert", field: null, before: null, after: { related_contact_id: "c9" } });
    expect(changeRowView(group([relRow], { recordType: "contact_relationship" }), ctx({ names: { c9: "Luis García" } })).verb)
      .toBe("added the link to Luis García");

    const memberRow = baseRow({
      recordType: "client_group_member", contactId: "c2", clientGroupId: "g1",
      op: "insert", field: null, before: null, after: { contact_id: "c2", client_group_id: "g1" },
    });
    expect(changeRowView(group([memberRow], { recordType: "client_group_member" }), ctx({ names: { c2: "Ana García" } })).verb)
      .toBe("added Ana García to the household");
    expect(changeRowView(group([memberRow], { recordType: "client_group_member" }), ctx({ names: { c2: "Ana García" }, groupKinds: { g1: "business" } })).verb)
      .toBe("added Ana García to the business");
  });

  // F-115 PR E fix (review I7): the "deals" source already shows a fresh deal's own creation, by
  // name — a pure-insert "changes" entry for the SAME event would say it twice.
  it("isDuplicateOpportunityInsert: true for a pure insert, false once an update folds in (mutation: always return false -> the dedupe in timeline-rows.ts never fires, FAILS there)", async () => {
    const { isDuplicateOpportunityInsert } = await import("./change-rows");
    const insertOnly = group(
      [baseRow({ recordType: "opportunity", op: "insert", field: null, before: null, after: { name: "Deck build" } })],
      { recordType: "opportunity" },
    );
    expect(isDuplicateOpportunityInsert(insertOnly)).toBe(true);
    const insertThenEdit = group(
      [
        baseRow({ id: 1, recordType: "opportunity", op: "insert", field: null, before: null, after: { name: "Deck build" }, xact: "1" }),
        baseRow({ id: 2, recordType: "opportunity", op: "update", field: "stage_id", before: "a", after: "b", xact: "2" }),
      ],
      { recordType: "opportunity" },
    );
    expect(isDuplicateOpportunityInsert(insertThenEdit)).toBe(false);
    const otherType = group([baseRow({ recordType: "equipment", op: "insert", field: null, before: null, after: {} })], { recordType: "equipment" });
    expect(isDuplicateOpportunityInsert(otherType)).toBe(false);
  });

  it("a whole-contact delete reads 'deleted this customer', using 'borró' not 'eliminó' (G6 glossary: never 'elimin*' opposite English 'delet*') (mutation: use 'eliminó' -> FAILS the glossary gate)", () => {
    const row = baseRow({ op: "delete", field: null, before: null, after: null });
    expect(changeRowView(group([row]), ctx()).verb).toBe("deleted this customer");
    expect(changeRowView(group([row]), ctx({}, "es")).verb).toBe("borró a este cliente");
  });

  it("a removed unit names itself from its own snapshot, no extra read needed (mutation: drop the name lookup -> 'a detail', FAILS)", () => {
    const row = baseRow({
      recordType: "equipment", op: "delete", field: null, before: { name: "Carrier AC" }, after: null,
    });
    const g = group([row], { recordType: "equipment" });
    expect(changeRowView(g, ctx()).verb).toBe("removed the unit Carrier AC");
  });

  it("a removed place names itself by its own label (mutation: read 'name' instead of 'label' -> FAILS)", () => {
    const row = baseRow({ recordType: "place", op: "delete", field: null, before: { label: "Back yard" }, after: null });
    expect(changeRowView(group([row], { recordType: "place" }), ctx()).verb).toBe("removed the place Back yard");
  });

  it("a removed tag resolves its name from the supplied map, or falls back to the raw id (mutation: always use the raw id -> FAILS)", () => {
    const row = baseRow({ recordType: "contact_tag", recordId: "tag-9", op: "delete", field: null, before: { contact_id: "c1", tag_id: "tag-9" }, after: null });
    const g = group([row], { recordType: "contact_tag" });
    expect(changeRowView(g, ctx({ names: { "tag-9": "VIP" } })).verb).toBe("removed the tag VIP");
    expect(changeRowView(g, ctx()).verb).toBe("removed the tag tag-9");
  });

  it("a removed relationship names the other side, or 'another record' when unresolved — never 'Someone on the team' (a customer is not staff) (mutation: drop the fallback -> undefined in the sentence, FAILS)", () => {
    const row = baseRow({
      recordType: "contact_relationship", op: "delete", field: null,
      before: { related_contact_id: "c9" }, after: null,
    });
    const g = group([row], { recordType: "contact_relationship" });
    expect(changeRowView(g, ctx({ names: { c9: "Luis García" } })).verb).toBe("removed the link to Luis García");
    expect(changeRowView(g, ctx()).verb).toBe("removed the link to another record");
  });

  it("a removed member reads household or business by the supplied group-kind map, defaulting to household (mutation: default to business -> FAILS)", () => {
    const row = baseRow({
      recordType: "client_group_member", contactId: "c2", clientGroupId: "g1",
      op: "delete", field: null, before: { contact_id: "c2", client_group_id: "g1" }, after: null,
    });
    const g = group([row], { recordType: "client_group_member" });
    expect(changeRowView(g, ctx({ names: { c2: "Ana García" } })).verb).toBe("removed Ana García from the household");
    expect(changeRowView(g, ctx({ names: { c2: "Ana García" }, groupKinds: { g1: "business" } })).verb)
      .toBe("removed Ana García from the business");
  });
});

describe("changeRowView: the disclosure's field lines and step count", () => {
  it("one line per field, with the row attached for Put back (mutation: drop row from the line -> FAILS)", () => {
    const row = baseRow({ field: "phone", before: "+19565550111", after: "+19565550112" });
    const view = changeRowView(group([row]), ctx());
    expect(view.fields).toHaveLength(1);
    expect(view.fields[0]!.row).toBe(row);
    expect(view.fields[0]!.label).toBe("Phone");
  });

  // Load-bearing for Put back's own correctness: a folded group that changed the SAME field twice
  // (two writes, same author, within the collapse window) must show BOTH occurrences, each bound to
  // its OWN row — deduping to one line would let "Put back" compare-and-swap against the WRONG
  // before/after pair (the earlier write's), silently refusing or restoring the wrong value.
  it("the same field changed twice in one folded group shows TWO lines, each its own row (mutation: dedupe fields by name -> FAILS, length 1)", () => {
    const first = baseRow({ id: 1, field: "phone", before: "+19565550111", after: "+19565550112", xact: "1" });
    const second = baseRow({ id: 2, field: "phone", before: "+19565550112", after: "+19565550113", xact: "2" });
    const g = group([first, second], { steps: [[first], [second]] });
    const view = changeRowView(g, ctx());
    expect(view.fields).toHaveLength(2);
    expect(view.fields[0]!.row).toBe(first);
    expect(view.fields[1]!.row).toBe(second);
    expect(view.fields[0]!.now).toBe("(956) 555-0112");
    expect(view.fields[1]!.now).toBe("(956) 555-0113");
    // The verb still names "phone" once (deduped there, since one field-label suffices for the sentence).
    expect(view.verb).toBe("changed phone");
  });

  it("no step count for a single write; a real count once the group folds more than one (mutation: show the count at steps.length > 0 -> FAILS)", () => {
    const one = group([baseRow({ field: "phone" })]);
    expect(changeRowView(one, ctx()).stepsText).toBeNull();
    const folded: ChangeGroup = {
      ...one,
      steps: [[baseRow({ id: 1, field: "phone", xact: "1" })], [baseRow({ id: 2, field: "email", xact: "2" })]],
      rows: [baseRow({ id: 1, field: "phone", xact: "1" }), baseRow({ id: 2, field: "email", xact: "2" })],
    };
    expect(changeRowView(folded, ctx()).stepsText).toBe("2 changes");
  });

  it("plural() at 1 and at 3 (mutation: use count === 0 for the One form -> FAILS at count 1)", () => {
    const threeSteps = (n: number): ChangeGroup => ({
      key: "k", recordType: "contact", recordId: "c1", authorKind: "person", authorId: "u1", via: null,
      at: AT, firstAt: AT,
      steps: Array.from({ length: n }, (_, i) => [baseRow({ id: i + 1, field: "phone", xact: String(i + 1) })]),
      rows: Array.from({ length: n }, (_, i) => baseRow({ id: i + 1, field: "phone", xact: String(i + 1) })),
    });
    expect(changeRowView(threeSteps(2), ctx()).stepsText).toBe("2 changes");
    expect(changeRowView(threeSteps(3), ctx()).stepsText).toBe("3 changes");
    // The One form itself, direct from the shared Tr (steps.length > 1 never reaches it through
    // changeRowView, so it is proven here, against the exact catalogue key this file calls).
    expect(makeTr("en").count("history.steps", 1)).toBe("1 change");
    expect(makeTr("es").count("history.steps", 1)).toBe("1 cambio");
  });
});

describe("formatChangeValue (plan Task 5 Values)", () => {
  const c = ctx();
  it("blank for null, undefined and empty string (mutation: only check null -> FAILS on '')", () => {
    expect(formatChangeValue("source", null, c)).toBe("(blank)");
    expect(formatChangeValue("source", "", c)).toBe("(blank)");
  });
  it("booleans read Yes/No, Sí/No (mutation: read truthy strings as true -> FAILS on false)", () => {
    expect(formatChangeValue("is_primary", true, c)).toBe("Yes");
    expect(formatChangeValue("is_primary", false, c)).toBe("No");
    expect(formatChangeValue("is_primary", false, ctx({}, "es"))).toBe("No");
    expect(formatChangeValue("is_primary", true, ctx({}, "es"))).toBe("Sí");
  });
  it("a phone is formatted the app's own way (mutation: return the raw string -> FAILS)", () => {
    expect(formatChangeValue("phone", "+19565550111", c)).toBe("(956) 555-0111");
  });
  it("assigned_to resolves a name, or falls back to Someone on the team (mutation: String(value) raw -> FAILS)", () => {
    expect(formatChangeValue("assigned_to", "user_9", ctx({ names: { user_9: "Rio" } }))).toBe("Rio");
    expect(formatChangeValue("assigned_to", "user_9", c)).toBe("Someone on the team");
  });
  it("a plain value is its own string (mutation: JSON.stringify every value -> FAILS, quoted)", () => {
    expect(formatChangeValue("name", "Deck build", c)).toBe("Deck build");
  });

  // F-115 PR E fix (review I6): a customer-facing id (never Someone on the team, which is for staff).
  it("customer-id fields (related_contact_id, place's contact_id/client_group_id, replaces_id, stage_id, pipeline_id) resolve a name, or fall back to 'another record' (mutation: fall back to assign.someone -> FAILS)", () => {
    const withNames = ctx({ names: { "c-9": "Luis García", "unit-1": "Carrier AC", "stage-a": "Quoted", "pipe-a": "Install jobs" } });
    expect(formatChangeValue("related_contact_id", "c-9", withNames)).toBe("Luis García");
    expect(formatChangeValue("contact_id", "c-9", withNames)).toBe("Luis García");
    expect(formatChangeValue("client_group_id", "c-9", withNames)).toBe("Luis García");
    expect(formatChangeValue("replaces_id", "unit-1", withNames)).toBe("Carrier AC");
    expect(formatChangeValue("stage_id", "stage-a", withNames)).toBe("Quoted");
    expect(formatChangeValue("pipeline_id", "pipe-a", withNames)).toBe("Install jobs");
    expect(formatChangeValue("related_contact_id", "unknown-id", c)).toBe("another record");
  });

  it("a language value reads as a word, never the raw code (mutation: return the raw code -> FAILS)", () => {
    expect(formatChangeValue("language", "en", c)).toBe("English");
    expect(formatChangeValue("language", "es", c)).toBe("Spanish");
    expect(formatChangeValue("language", "en", ctx({}, "es"))).toBe("Inglés");
    expect(formatChangeValue("language", "es", ctx({}, "es"))).toBe("Español");
  });
});

describe("causeLabel (CSV reuse; plan Task 8's own deferred copy)", () => {
  it("names each via shape (mutation: swap merge/restore -> FAILS)", () => {
    const tr = makeTr("en");
    expect(causeLabel("merge:7", tr)).toBe("merged with another record");
    expect(causeLabel("ai_act:00000000-0000-0000-0000-000000000001", tr)).toBe("Sofía did it");
    expect(causeLabel("proposal:00000000-0000-0000-0000-000000000002", tr)).toBe("accepted suggestion");
    expect(causeLabel("restore:12", tr)).toBe("put back");
    expect(causeLabel("sql", tr)).toBe("BIS system");
    expect(causeLabel(null, tr)).toBeNull();
  });
});
