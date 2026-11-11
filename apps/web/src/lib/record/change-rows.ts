import type { ChangeGroup, ChangeRow, ChangeRecordType } from "@bis/db";
import { RELATIONSHIP_KEYS, type RelationshipKey } from "@bis/db/relationship-keys";
import type { MessageKey } from "@/lib/messages";
import { formatPhone } from "@/lib/document-requests/customer-state";
import { formatDateInZone, formatDateTimeInZone } from "@/lib/format";
import { machineSourceCaption } from "@/lib/contacts/lead-source";
import { RELATIONSHIP_LABELS } from "@/lib/contacts/relationship-labels";
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
  /** F-115 PR E fix (review I4): ONE shared id -> name map, built by `@bis/db`'s `readChangeNames`
   *  (a bounded, account-scoped read for every id this page's own change rows reference) MERGED with
   *  the SAME staff-name map the row's own author mark already uses (`author-mark.ts`'s
   *  `AuthorCtx.names`) — a staff clerk id, a contact id, a tag id, an equipment id, a stage id and a
   *  pipeline id never collide in practice (real ids, vanishingly unlikely to coincide). `assigned_to`
   *  falls back to "Someone on the team" (`assign.someone`) when missing; every CUSTOMER-facing id
   *  (a removed member, a related contact, a removed tag, a replaced unit, a deal's stage/pipeline)
   *  falls back to "another record" (`timeline.mergeOtherHidden`) — never the staff fallback, which
   *  would call a customer, a tag or a unit a team member. */
  names: Readonly<Record<string, string>>;
  /** The account's custom field definitions, `field_key` -> its own label; missing: the raw key. */
  customFieldLabels: Readonly<Record<string, string>>;
  /** A `client_group`'s own kind, by id, for "removed from the household" vs "…business" (also read
   *  by `readChangeNames`); missing defaults to "household", flagged in the report. */
  groupKinds?: Readonly<Record<string, "household" | "business">>;
};

/** A customer-facing id (never a staff one): `ctx.names[id]`, else the kit's own "a contact this
 *  reader can't currently name" word (never `assign.someone`, which is for STAFF). */
function customerName(id: string | null | undefined, ctx: ChangeViewCtx): string {
  return (id && ctx.names[id]) || ctx.tr.text("timeline.mergeOtherHidden");
}

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
  // Owner ruling R2 (2026-11-05): a label for EVERY remaining audited Q1 column.
  kind: { verbKey: "history.field.kind", labelKey: "history.label.kind" },
  billing_address: { verbKey: "history.field.billing_address", labelKey: "history.label.billing_address" },
  role: { verbKey: "history.field.role", labelKey: "history.label.role" },
  is_primary: { verbKey: "history.field.is_primary", labelKey: "history.label.is_primary" },
  is_billing: { verbKey: "history.field.is_billing", labelKey: "history.label.is_billing" },
  is_primary_contact: { verbKey: "history.field.is_primary_contact", labelKey: "history.label.is_primary_contact" },
  address: { verbKey: "history.field.address", labelKey: "history.label.address" },
  landmark: { verbKey: "history.field.landmark", labelKey: "history.label.landmark" },
  directions: { verbKey: "history.field.directions", labelKey: "history.label.directions" },
  city: { verbKey: "history.field.city", labelKey: "history.label.city" },
  region: { verbKey: "history.field.region", labelKey: "history.label.region" },
  postal_code: { verbKey: "history.field.postal_code", labelKey: "history.label.postal_code" },
  country: { verbKey: "history.field.country", labelKey: "history.label.country" },
  archived_at: { verbKey: "history.field.archived", labelKey: "history.label.archived" },
  // place's own owner columns: ONE shared concept, "who has it" (a contact's id or a group's id).
  contact_id: { verbKey: "history.field.whoHasIt", labelKey: "history.label.whoHasIt" },
  client_group_id: { verbKey: "history.field.whoHasIt", labelKey: "history.label.whoHasIt" },
  make: { verbKey: "history.field.make", labelKey: "history.label.make" },
  model: { verbKey: "history.field.model", labelKey: "history.label.model" },
  serial: { verbKey: "history.field.serial", labelKey: "history.label.serial" },
  notes: { verbKey: "history.field.notes", labelKey: "history.label.notes" },
  installed_on: { verbKey: "history.field.installed_on", labelKey: "history.label.installed_on" },
  warranty_until: { verbKey: "history.field.warranty_until", labelKey: "history.label.warranty_until" },
  replaces_id: { verbKey: "history.field.replacesUnit", labelKey: "history.label.replacesUnit" },
  pipeline_id: { verbKey: "history.field.pipeline", labelKey: "history.label.pipeline" },
  status: { verbKey: "history.field.status", labelKey: "history.label.status" },
  label_key: { verbKey: "history.field.relationship", labelKey: "history.label.relationship" },
  custom_label: { verbKey: "history.field.relationshipLabel", labelKey: "history.label.relationshipLabel" },
  contact_form: { verbKey: "history.field.wording", labelKey: "history.label.wording" },
  related_form: { verbKey: "history.field.wording", labelKey: "history.label.wording" },
  contact_can_pick_up: { verbKey: "history.field.canPickUp", labelKey: "history.label.canPickUp" },
  related_can_pick_up: { verbKey: "history.field.canPickUp", labelKey: "history.label.canPickUp" },
  contact_is_emergency: { verbKey: "history.field.isEmergency", labelKey: "history.label.isEmergency" },
  related_is_emergency: { verbKey: "history.field.isEmergency", labelKey: "history.label.isEmergency" },
  // `place.label` IS the place's own name — shares the generic "name" key (same concept as
  // client_group.name/opportunity.name), not a new one.
  label: { verbKey: "history.field.name", labelKey: "history.label.name" },
  // `related_contact_id` reads via `fieldKeys`'s own default below when it needs ONE: an update to
  // WHO a relationship points at is still "the relationship", so it shares `label_key`'s own key —
  // see `fieldKeys`'s special-case just below, which routes it there explicitly.
};
const OTHER_KEYS = { verbKey: "history.field.other", labelKey: "history.label.other" } as const;

function fieldKeys(field: string): { verbKey: MessageKey; labelKey: MessageKey } {
  if (field.startsWith("custom.")) return { verbKey: "history.field.custom", labelKey: "history.label.custom" };
  // Who a relationship points at is still "the relationship" changing, the same concept as its own
  // label_key — shares that key rather than a fourth one.
  if (field === "related_contact_id") return FIELD_KEYS.label_key!;
  return FIELD_KEYS[field] ?? OTHER_KEYS;
}

/** F-115 PR E fix round 2 (review n5): `ctx.customFieldLabels` is read from the account's
 *  CONTACT-model field defs only (`loaders.ts`'s own `loadFieldDefs`; `group-loaders.ts`'s twin reads
 *  the SAME model for a member's own custom fields) — there is no `client_group`-model field-defs
 *  source in the product yet (`custom_fields.model` only allows `contact`/`opportunity`). A
 *  `client_group` row's own `custom.<key>` must therefore NEVER consult that map, even when the key
 *  NAME happens to collide with a real contact field's own key: that label describes a DIFFERENT
 *  field on a DIFFERENT entity, and showing it would be a wrong fact, not a missing one. The honest
 *  fallback (the raw key) is what both already use for "we have no definition for this". */
function customLabelOf(recordType: ChangeRecordType, key: string, ctx: ChangeViewCtx): string {
  return recordType === "contact" ? (ctx.customFieldLabels[key] ?? key) : key;
}

/** `history.field.*`, the short form inside the verb's list — a custom key reads its OWN label via
 *  `history.field.custom`'s `{label}` template, never the raw dotted field name. */
function fieldVerbLabel(recordType: ChangeRecordType, field: string, ctx: ChangeViewCtx): string {
  if (field.startsWith("custom.")) {
    const key = field.slice("custom.".length);
    return ctx.tr.text("history.field.custom", { label: customLabelOf(recordType, key, ctx) });
  }
  return ctx.tr.text(fieldKeys(field).verbKey);
}

/** `history.label.*`, sentence case, the detail line's own label. */
function fieldDetailLabel(recordType: ChangeRecordType, field: string, ctx: ChangeViewCtx): string {
  if (field.startsWith("custom.")) {
    const key = field.slice("custom.".length);
    return ctx.tr.text("history.label.custom", { label: customLabelOf(recordType, key, ctx) });
  }
  return ctx.tr.text(fieldKeys(field).labelKey);
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** F-115 PR E fix (review I6): fields whose VALUE is a customer-facing id — resolved via the SAME
 *  `readChangeNames` map `ctx.names` already carries, falling back to "another record"
 *  (`timeline.mergeOtherHidden`), never the staff fallback. */
const CUSTOMER_ID_FIELDS: ReadonlySet<string> = new Set([
  "related_contact_id", "contact_id", "client_group_id", "replaces_id", "stage_id", "pipeline_id",
]);

/** F-115 PR E fix (review I6/R2), dedicated keys in round 2 (review n4): a language VALUE reads as a
 *  word, never the raw "en"/"es" code. `history.value.language.*`, this feature's OWN copy — never
 *  `calendar.cancelDialog.language*` (the original choice): that key is the calendar's own, and could
 *  drift for the calendar's own reasons, unrelated to history's. */
const LANGUAGE_WORDS: Readonly<Record<string, MessageKey>> = {
  en: "history.value.language.en", es: "history.value.language.es",
};

/** F-115 PR E fix round 2 (review n3): a deal's own status, and a household/business's own kind —
 *  reusing the SAME words the deal card and the group page already show them with, never a new key
 *  for an identical concept. */
const DEAL_STATUS_WORDS: Readonly<Record<string, MessageKey>> = {
  open: "pipeline.status.open", won: "pipeline.status.won", lost: "pipeline.status.lost",
};
const GROUP_KIND_WORDS: Readonly<Record<string, MessageKey>> = {
  household: "groups.kind.household", business: "groups.kind.business",
};
/** F-115 PR E fix round 2 (review n3): the grammatical word-form a relationship's own wording takes
 *  ('f'/'m', `contact_relationships_forms`'s own CHECK) — a fact about the SENTENCE, not the person's
 *  own gender question. */
const WORD_FORM_WORDS: Readonly<Record<string, MessageKey>> = {
  f: "history.value.wordForm.f", m: "history.value.wordForm.m",
};
function isRelationshipKey(v: string): v is RelationshipKey {
  return (RELATIONSHIP_KEYS as readonly string[]).includes(v);
}

/**
 * One value, blank/boolean/phone/assigned-person/customer-id/language/timestamp/plain, per plan
 * Task 5's own Values list (extended by review I6). A DATE column (`installed_on`, `warranty_until`)
 * has no zone of its own — Postgres's `to_jsonb` renders it "YYYY-MM-DD" with no time — so it reads
 * in UTC, never the account's zone, which would roll it back a calendar day west of Greenwich for no
 * reason the value itself carries.
 */
export function formatChangeValue(field: string, value: unknown, ctx: ChangeViewCtx): string {
  if (value === null || value === undefined || value === "") return ctx.tr.text("history.blank");
  if (typeof value === "boolean") return ctx.tr.text(value ? "history.yes" : "history.no");
  if (field === "phone" && typeof value === "string") return formatPhone(value);
  if (field === "assigned_to") {
    const id = String(value);
    return ctx.names[id] ?? ctx.tr.text("assign.someone");
  }
  if (field === "language" && typeof value === "string" && LANGUAGE_WORDS[value]) return ctx.tr.text(LANGUAGE_WORDS[value]);
  // F-115 PR E fix round 2 (review n3): every other enum VALUE this feature's own audited fields
  // carry — reused label sources throughout, never a raw code.
  if (field === "status" && typeof value === "string" && DEAL_STATUS_WORDS[value]) return ctx.tr.text(DEAL_STATUS_WORDS[value]);
  if (field === "kind" && typeof value === "string" && GROUP_KIND_WORDS[value]) return ctx.tr.text(GROUP_KIND_WORDS[value]);
  if ((field === "contact_form" || field === "related_form") && typeof value === "string" && WORD_FORM_WORDS[value]) {
    return ctx.tr.text(WORD_FORM_WORDS[value]);
  }
  if (field === "label_key" && typeof value === "string" && isRelationshipKey(value)) {
    return RELATIONSHIP_LABELS[value].a.pick?.[ctx.tr.locale] ?? value;
  }
  // A machine-made source ("voice", "booking", "form: {name}") reads its own caption (the SAME words
  // the contact drawer's own Source hint uses); an operator's own typed note (anything else) is
  // honest free text, shown exactly as typed — there is nothing machine-made to translate.
  if (field === "source" && typeof value === "string") return machineSourceCaption(value, ctx.tr.locale) ?? value;
  // Final review m4: a deleted stage or sales process is not "another record" — it says what it was.
  if (field === "stage_id" && typeof value === "string") return ctx.names[value] ?? ctx.tr.text("history.value.stageGone");
  if (field === "pipeline_id" && typeof value === "string") return ctx.names[value] ?? ctx.tr.text("history.value.pipelineGone");
  if (CUSTOMER_ID_FIELDS.has(field) && typeof value === "string") return customerName(value, ctx);
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
    field, label: fieldDetailLabel(row.recordType, field, ctx),
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
      // F-115 PR E fix round 2 (review I7/D1): a tag deleted outright has no row of its own left to
      // read a name from — a WORD, never the raw id; Restore's own toast shares this `name`.
      // Final review m2: the unnamed form is its own sentence ("removed a tag"), never "the tag a tag",
      // and names nothing for Restore's toast (which then reads its own unnamed "It's back.").
      const name = ctx.names[row.recordId];
      if (!name) return { verb: tr.text("history.verb.removedTagUnknown"), name: null };
      return { verb: tr.text("history.verb.removedTag", { name }), name };
    }
    // `related_contact_id`/`contactId` here name a CUSTOMER, never a staff member — "Someone on the
    // team" (assign.someone) would be a plain wrong word for one. `timeline.mergeOtherHidden`
    // ("another record" / "otro registro") is the kit's own existing word for "a contact this reader
    // cannot currently name", already used for a merge's own hidden other side; reused rather than a
    // new key, per the brief's "add ONLY the Copy table's keys."
    case "contact_relationship": {
      const name = customerName(stringField(row.before, "related_contact_id"), ctx);
      return { verb: tr.text("history.verb.removedRelationship", { name }), name };
    }
    case "client_group_member": {
      const name = customerName(row.contactId, ctx);
      const kind = (row.clientGroupId && ctx.groupKinds?.[row.clientGroupId]) ?? "household";
      const key = kind === "business" ? "history.verb.removedMemberBusiness" : "history.verb.removedMember";
      return { verb: tr.text(key, { name }), name };
    }
    default:
      return { verb: tr.text("history.verb.changed", { fields: "" }), name: null };
  }
}

/**
 * F-115 PR E fix (review I7): a per-type "added" verb, naming the new thing exactly as its own
 * removal verb does — never the generic "added this record" except for `contact`/`client_group`
 * (there is nothing else to call "this record" on its own page) and `opportunity` (dropped from the
 * timeline entirely before this is ever reached — see `isDuplicateOpportunityInsert` below).
 */
function insertVerb(group: ChangeGroup, row: ChangeRow, ctx: ChangeViewCtx): string {
  const { tr } = ctx;
  switch (group.recordType) {
    case "equipment": {
      const name = stringField(row.after, "name") ?? tr.text("history.field.other");
      return tr.text("history.verb.addedEquipment", { name });
    }
    case "place": {
      const name = stringField(row.after, "label") ?? tr.text("history.field.other");
      return tr.text("history.verb.addedPlace", { name });
    }
    case "contact_tag": {
      // F-115 PR E fix round 2 (review I7/D1): same fallback word as the removal verb — never the raw id.
      const name = ctx.names[row.recordId];
      return name ? tr.text("history.verb.addedTag", { name }) : tr.text("history.verb.addedTagUnknown");
    }
    case "contact_relationship": {
      const name = customerName(stringField(row.after, "related_contact_id"), ctx);
      return tr.text("history.verb.addedRelationship", { name });
    }
    case "client_group_member": {
      const name = customerName(row.contactId, ctx);
      const kind = (row.clientGroupId && ctx.groupKinds?.[row.clientGroupId]) ?? "household";
      return tr.text(kind === "business" ? "history.verb.addedMemberBusiness" : "history.verb.addedMember", { name });
    }
    default:
      return tr.text("history.verb.added");
  }
}

/**
 * F-115 PR E fix (review I7): the "deals" timeline source (`record.ts`'s own unconditional,
 * always-read listing) already shows EVERY opportunity, by name, at its own `created_at` — a fresh
 * deal's own "changes" entry (a pure insert, nothing folded into it) would say the SAME creation a
 * second time. An opportunity later EDITED within the fold window (insert + update together) is kept:
 * the edit itself is not shown anywhere else. Exported so `timeline-rows.ts` can drop the entry
 * before it is ever built into a row.
 */
export function isDuplicateOpportunityInsert(group: ChangeGroup): boolean {
  return group.recordType === "opportunity" && group.rows.every((r) => r.op === "insert");
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
    const insertRow = rows.find((r) => r.op === "insert") ?? rows[0]!;
    return { verb: insertVerb(group, insertRow, ctx), fields: [], stepsText: null, removalName: null };
  }
  const fields = updateRows.map((row) => fieldLine(row, ctx));
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of updateRows) {
    if (seen.has(row.field!)) continue;
    seen.add(row.field!);
    labels.push(fieldVerbLabel(row.recordType, row.field!, ctx));
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
