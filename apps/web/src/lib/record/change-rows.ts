import type { ChangeGroup, ChangeRow } from "@bis/db";
import type { MessageKey } from "@/lib/messages";
import { formatPhone } from "@/lib/document-requests/customer-state";
import { formatDateInZone, formatDateTimeInZone } from "@/lib/format";
import type { Tr } from "./copy";

/**
 * F-115 part 1 (S-04), plan Task 5: the change row's own words — the verb ("changed phone and
 * email" / "removed the unit Carrier AC"), and the field/value lines a "changed" row's disclosure
 * shows ("Field: Was X, Now Y"). Pure: every name (a person, a tag, a household's kind) the caller
 * already knows is handed in; this file never reads a database.
 */

/** What this view needs to resolve a name the row's own columns do not carry. Every one is
 *  BEST-EFFORT from data the record page already loaded for something else (see the report's
 *  Deviations): a removed tag or member this page has no other reason to know by name falls back to
 *  a generic word or the raw id, never a thrown page. */
export type ChangeViewCtx = {
  tr: Tr;
  /** The account's own zone, for a timestamp-shaped value (DESIGN.md: the record page's own date
   *  formatter, never the server's). */
  zone: string;
  /** TWO id spaces, one map (a staff clerk id and a contact id never collide in practice — a clerk
   *  id's own "user_…" shape vs. a plain uuid): `assigned_to`'s value is a STAFF id (the SAME map the
   *  row's own author mark already uses, `author-mark.ts`'s `AuthorCtx.names`), missing "Someone on
   *  the team" (`assign.someone`); a removed member's own name and a removed relationship's other
   *  party are a CUSTOMER's contact id, missing "another record" (`timeline.mergeOtherHidden`) —
   *  never the staff fallback, which would call a customer a team member. */
  names: Readonly<Record<string, string>>;
  /** The account's custom field definitions, `field_key` -> its own label; missing: the raw key. */
  customFieldLabels: Readonly<Record<string, string>>;
  /** A removed tag's own name, by `tag_id` (`ChangeRow.recordId` on a `contact_tag` row); missing:
   *  the raw id — the account's tag VOCABULARY is not re-read here (see the report). */
  tagNames?: Readonly<Record<string, string>>;
  /** A `client_group`'s own kind, by id, for "removed from the household" vs "…business"; missing
   *  (most often: a membership removed from a group this page has no other reason to have read)
   *  defaults to "household" — flagged in the report, not guessed silently past this comment. */
  groupKinds?: Readonly<Record<string, "household" | "business">>;
};

/** One field a "changed" row's disclosure shows: its own row (so `canPutBack`/Put back act on THIS
 *  write, never a value merged across several), its sentence-case label, and the formatted Was/Now. */
export type ChangeFieldLine = { field: string; label: string; was: string; now: string; row: ChangeRow };

export type ChangeRowView = {
  verb: string;
  /** Empty for an insert or a removal: there is nothing to disclose Was/Now for either (plan Task 5:
   *  "Detail is a disclosure… one line per field" — only an update row has one). */
  fields: ChangeFieldLine[];
  /** "{count} changes", shown only when the group folded more than one write (`group.steps.length >
   *  1`); null otherwise — a single write has no COUNT of writes worth a line. */
  stepsText: string | null;
  /** The name substituted into a removal verb (a unit, a place, a tag, a member, a relationship's
   *  other party); null for "changed"/"added this record"/"deleted this customer", none of which
   *  names anything. Reused by the removal's own "is back" toast (change-item.tsx). */
  removalName: string | null;
};

const FIELD_KEYS: Readonly<Record<string, { verbKey: MessageKey; labelKey: MessageKey }>> = {
  first_name: { verbKey: "history.field.first_name", labelKey: "history.label.first_name" },
  last_name: { verbKey: "history.field.last_name", labelKey: "history.label.last_name" },
  email: { verbKey: "history.field.email", labelKey: "history.label.email" },
  phone: { verbKey: "history.field.phone", labelKey: "history.label.phone" },
  assigned_to: { verbKey: "history.field.assigned_to", labelKey: "history.label.assigned_to" },
  dnd: { verbKey: "history.field.dnd", labelKey: "history.label.dnd" },
  source: { verbKey: "history.field.source", labelKey: "history.label.source" },
  // F-115 PR E fix (consent scan 5, spec §4.3): 0049's retired opt-out column is deliberately NOT
  // mapped here (`record-restore.ts`'s own `PUT_BACK_FIELDS`/`TIMESTAMP_FIELDS` omit it for the same
  // reason) — a changed row for it falls through to `fieldKeys`'s own "other" default below, never
  // writing the column's identifier in source. `canPutBack` already answers false for it either way
  // (absent from `PUT_BACK_FIELDS.contact`), so no Put back button depends on this map having it.
  language: { verbKey: "history.field.language", labelKey: "history.label.language" },
  name: { verbKey: "history.field.name", labelKey: "history.label.name" },
  stage_id: { verbKey: "history.field.stage", labelKey: "history.label.stage" },
  monetary_value: { verbKey: "history.field.value", labelKey: "history.label.value" },
};
const OTHER_KEYS = { verbKey: "history.field.other", labelKey: "history.label.other" } as const;

function fieldKeys(field: string): { verbKey: MessageKey; labelKey: MessageKey } {
  if (field.startsWith("custom.")) return { verbKey: "history.field.custom", labelKey: "history.label.custom" };
  return FIELD_KEYS[field] ?? OTHER_KEYS;
}

/** `history.field.*`, the short form inside the verb's list — a custom key reads its OWN label via
 *  `history.field.custom`'s `{label}` template, never the raw dotted field name. */
function fieldVerbLabel(field: string, ctx: ChangeViewCtx): string {
  if (field.startsWith("custom.")) {
    const key = field.slice("custom.".length);
    return ctx.tr.text("history.field.custom", { label: ctx.customFieldLabels[key] ?? key });
  }
  return ctx.tr.text(fieldKeys(field).verbKey);
}

/** `history.label.*`, sentence case, the detail line's own label. */
function fieldDetailLabel(field: string, ctx: ChangeViewCtx): string {
  if (field.startsWith("custom.")) {
    const key = field.slice("custom.".length);
    return ctx.tr.text("history.label.custom", { label: ctx.customFieldLabels[key] ?? key });
  }
  return ctx.tr.text(fieldKeys(field).labelKey);
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One value, blank/boolean/phone/assigned-person/timestamp/plain, per plan Task 5's own Values list.
 * A DATE column (`installed_on`, `warranty_until`) has no zone of its own — Postgres's `to_jsonb`
 * renders it "YYYY-MM-DD" with no time — so it reads in UTC, never the account's zone, which would
 * roll it back a calendar day west of Greenwich for no reason the value itself carries.
 */
export function formatChangeValue(field: string, value: unknown, ctx: ChangeViewCtx): string {
  if (value === null || value === undefined || value === "") return ctx.tr.text("history.blank");
  if (typeof value === "boolean") return ctx.tr.text(value ? "history.yes" : "history.no");
  if (field === "phone" && typeof value === "string") return formatPhone(value);
  if (field === "assigned_to") {
    const id = String(value);
    return ctx.names[id] ?? ctx.tr.text("assign.someone");
  }
  if (typeof value === "string" && ISO_DATETIME.test(value)) {
    try { return formatDateTimeInZone(value, ctx.zone, ctx.tr.locale); } catch { /* fall through to the raw string */ }
  }
  if (typeof value === "string" && ISO_DATE_ONLY.test(value)) {
    try { return formatDateInZone(value, "UTC", ctx.tr.locale); } catch { /* fall through */ }
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fieldLine(row: ChangeRow, ctx: ChangeViewCtx): ChangeFieldLine {
  const field = row.field!;
  return {
    field, label: fieldDetailLabel(field, ctx),
    was: formatChangeValue(field, row.before, ctx), now: formatChangeValue(field, row.after, ctx),
    row,
  };
}

/** A string column of a raw jsonb snapshot (`ChangeRow.before`/`.after`); never throws on a shape
 *  this isn't. */
function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/** The removal verb and the name it names, per record type (plan Task 5's own "Row grammar"). A type
 *  this file has no removal verb for (deals, a plain `client_group` row) is unreachable today — Q1's
 *  own Restore list (`RESTORABLE_TYPES`, `record-restore.ts`) never offers Restore for either — and
 *  reads the generic "changed" verb rather than nothing, should a future type ever reach here first. */
function deleteVerb(group: ChangeGroup, row: ChangeRow, ctx: ChangeViewCtx): { verb: string; name: string | null } {
  const { tr } = ctx;
  switch (group.recordType) {
    case "contact":
      return { verb: tr.text("history.verb.deleted"), name: null };
    case "equipment": {
      const name = stringField(row.before, "name") ?? tr.text("history.field.other");
      return { verb: tr.text("history.verb.removedEquipment", { name }), name };
    }
    case "place": {
      const name = stringField(row.before, "label") ?? tr.text("history.field.other");
      return { verb: tr.text("history.verb.removedPlace", { name }), name };
    }
    case "contact_tag": {
      const name = ctx.tagNames?.[row.recordId] ?? row.recordId;
      return { verb: tr.text("history.verb.removedTag", { name }), name };
    }
    // `related_contact_id`/`contactId` here name a CUSTOMER, never a staff member — "Someone on the
    // team" (assign.someone) would be a plain wrong word for one. `timeline.mergeOtherHidden`
    // ("another record" / "otro registro") is the kit's own existing word for "a contact this reader
    // cannot currently name", already used for a merge's own hidden other side; reused rather than a
    // new key, per the brief's "add ONLY the Copy table's keys."
    case "contact_relationship": {
      const relatedId = stringField(row.before, "related_contact_id");
      const name = (relatedId && ctx.names[relatedId]) || tr.text("timeline.mergeOtherHidden");
      return { verb: tr.text("history.verb.removedRelationship", { name }), name };
    }
    case "client_group_member": {
      const name = (row.contactId && ctx.names[row.contactId]) || tr.text("timeline.mergeOtherHidden");
      const kind = (row.clientGroupId && ctx.groupKinds?.[row.clientGroupId]) ?? "household";
      const key = kind === "business" ? "history.verb.removedMemberBusiness" : "history.verb.removedMember";
      return { verb: tr.text(key, { name }), name };
    }
    default:
      return { verb: tr.text("history.verb.changed", { fields: "" }), name: null };
  }
}

/**
 * Plan Task 5 (spec §3's "Row grammar"): one `ChangeGroup` -> its verb, its disclosure's field
 * lines (an update only) and its "{count} changes" label (a fold of more than one write only). The
 * group's rows decide the CATEGORY: any `delete` row makes the whole group a removal (the most
 * recent, terminal state); failing that, any `update` row makes it a "changed" row (a record created
 * then edited within the fold window reads as what it became, not merely "added"); only when every
 * row is an `insert` does it read "added this record".
 */
export function changeRowView(group: ChangeGroup, ctx: ChangeViewCtx): ChangeRowView {
  const rows = group.rows;
  const deleteRow = rows.find((r) => r.op === "delete");
  if (deleteRow) {
    const { verb, name } = deleteVerb(group, deleteRow, ctx);
    return { verb, fields: [], stepsText: null, removalName: name };
  }
  const updateRows = rows.filter((r) => r.op === "update");
  if (updateRows.length === 0) {
    return { verb: ctx.tr.text("history.verb.added"), fields: [], stepsText: null, removalName: null };
  }
  const fields = updateRows.map((row) => fieldLine(row, ctx));
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of updateRows) {
    if (seen.has(row.field!)) continue;
    seen.add(row.field!);
    labels.push(fieldVerbLabel(row.field!, ctx));
  }
  const list = new Intl.ListFormat(ctx.tr.locale === "es" ? "es-US" : "en-US", { type: "conjunction" }).format(labels);
  const verb = ctx.tr.text("history.verb.changed", { fields: list });
  const stepsText = group.steps.length > 1 ? ctx.tr.count("history.steps", group.steps.length) : null;
  return { verb, fields, stepsText, removalName: null };
}

const VIA_CAUSE = /^(merge|ai_act|proposal|restore):/;

/** The CSV "Cause" column's own word, by `via`'s shape (0111 section 4's formats). Exported for
 *  reuse once a caller formats a `record_changes` row outside the live timeline too (the report:
 *  `history-csv.ts`'s own `toHistoryCsvRow` left Cause as the raw `via` on purpose, pending this). */
export function causeLabel(via: string | null, tr: Tr): string | null {
  if (!via) return null;
  if (via === "sql" || via === "seed") return tr.text("history.cause.sql");
  const m2 = VIA_CAUSE.exec(via);
  if (!m2) return null;
  const key = m2[1] === "merge" ? "history.cause.merge" : m2[1] === "ai_act" ? "history.cause.aiAct"
    : m2[1] === "proposal" ? "history.cause.proposal" : "history.cause.restore";
  return tr.text(key);
}
