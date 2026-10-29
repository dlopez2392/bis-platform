import type {
  AccessLogCounts, AccessLogCursor, AccessLogItem, AccessLogPage, AccessLogVisit, AgencyVisitReason,
} from "@bis/db";
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { formatDateInZone, formatDateTimeInZone, tag } from "@/lib/format";
import { encodeCursor, parseCursor } from "@/lib/cursor";

/**
 * F-118 part 1 (plan Task 4): the Owner's BIS access section, built from T1's typed page
 * (`readAccessLogPage`) and this file's own name lookup (`names.ts`) into plain, already-localised
 * strings. Pure — no React, no I/O — so every case here is a value-in, value-out test; the components
 * (T4's other half) only lay this out.
 */

export type AccessLogNames = {
  contacts: Map<string, { first: string | null; last: string | null; archived: boolean }>;
  groups: Map<string, { name: string; kind: "household" | "business" }>;
  calls: Map<string, { contactId: string | null; startedAt: string }>;
  conversations: Map<string, { contactId: string | null }>;
  documents: Map<string, { title: string; trashed: boolean; record: { kind: "contact" | "group"; id: string } | null }>;
  forms: Map<string, { name: string }>;
};

export type VisitItemView = { key: string; text: string; href: string | null };
export type VisitRowView = { id: string; label: string; when: string; summary: string; items: VisitItemView[]; more: string | null };

type CountKey = Parameters<Tr["count"]>[0];

/** Spec 6.2's fixed order: customers, households or businesses, calls, conversations, files, form
 *  answers. A FIXED array, never `Object.keys(counts)` — the counts object's own property order is
 *  whatever the caller happened to write, not this order. */
const COUNT_ORDER: { key: keyof AccessLogCounts; count: CountKey }[] = [
  { key: "contact", count: "accessLog.count.customers" },
  { key: "group", count: "accessLog.count.groups" },
  { key: "call", count: "accessLog.count.calls" },
  { key: "conversation", count: "accessLog.count.conversations" },
  { key: "file", count: "accessLog.count.files" },
  { key: "form_answers", count: "accessLog.count.forms" },
];

/** One visit's summary sentence(s) (spec 6.2). A download is its own sentence, never folded into the
 *  "Opened …" list; "nothing opened" shows only when every count, the download included, is zero. */
export function visitSummary(counts: AccessLogCounts, tr: Tr): string {
  const parts = COUNT_ORDER.filter(({ key }) => counts[key] > 0).map(({ key, count }) => tr.count(count, counts[key]));
  const sentences: string[] = [];
  if (parts.length > 0) {
    const list = parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} ${tr.text("accessLog.summary.and")} ${parts[parts.length - 1]!}`;
    sentences.push(tr.text("accessLog.summary.opened", { list }));
  }
  if (counts.customer_list_export > 0) sentences.push(tr.count("accessLog.summary.downloads", counts.customer_list_export));
  if (sentences.length === 0) sentences.push(tr.text("accessLog.summary.nothing"));
  return sentences.join(" ");
}

/** The UTC offset Intl resolves for this instant in this zone ("GMT-5", "GMT-6", …), used only to decide
 *  whether the fall-back hour's two clocks need their zone names (review m8). */
function offsetOf(iso: string, zone: string): string | undefined {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value;
}

function clockOf(iso: string, zone: string, locale: Locale, withZoneName: boolean): string {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone: zone, hour: "numeric", minute: "2-digit",
    ...(withZoneName ? { timeZoneName: "short" as const } : {}),
  }).format(new Date(iso));
}

/**
 * Spec 6.2/§3.3: the date once, the span as start–end; no end shows the start alone. The repeated
 * autumn hour (review m8) compares the two instants' UTC offsets and, when they differ, names both
 * clocks' zones — the only way "1:30 AM–1:20 AM" reads as real rather than backwards.
 */
export function visitSpan(startIso: string, endIso: string | null, zone: string, locale: Locale): string {
  const startDay = formatDateInZone(startIso, zone, locale);
  if (!endIso) return `${startDay}, ${clockOf(startIso, zone, locale, false)}`;
  const endDay = formatDateInZone(endIso, zone, locale);
  const sameOffset = offsetOf(startIso, zone) === offsetOf(endIso, zone);
  const startClock = clockOf(startIso, zone, locale, !sameOffset);
  const endClock = clockOf(endIso, zone, locale, !sameOffset);
  return startDay === endDay ? `${startDay}, ${startClock}–${endClock}` : `${startDay}, ${startClock}–${endDay}, ${endClock}`;
}

export function encodeAccessCursor(v: AccessLogVisit): string {
  return encodeCursor({ v: v.startedAt, id: v.id });
}

/** `null` for garbage, `undefined`, or a cursor whose `v` is itself null (a visit's `startedAt` is never
 *  null, so that shape can only be a hand-edited URL). */
export function parseAccessCursor(raw: string | undefined): AccessLogCursor | null {
  const c = parseCursor(raw);
  if (!c || c.v === null) return null;
  return { startedAt: c.v, id: c.id };
}

const REASON_KEY: Record<AgencyVisitReason, MessageKey> = {
  setup: "accessLog.reason.setup", support: "accessLog.reason.support",
  fix: "accessLog.reason.fix", billing: "accessLog.reason.billing",
};
const GROUP_KEY: Record<"household" | "business", MessageKey> = {
  household: "accessLog.item.household", business: "accessLog.item.business",
};
const FILE_KEY: Record<"document_view" | "document_download" | "document_share", MessageKey> = {
  document_view: "accessLog.item.fileViewed", document_download: "accessLog.item.fileDownloaded",
  document_share: "accessLog.item.fileShared",
};

/** The contact's own display name (never `contactDisplayName`'s English-only fallback), with the
 *  archived suffix when it applies; `null` only when the contact itself no longer resolves. */
function contactLabel(id: string | null, names: AccessLogNames, tr: Tr): string | null {
  if (!id) return null;
  const c = names.contacts.get(id);
  if (!c) return null;
  const name = [c.first, c.last].filter(Boolean).join(" ") || tr.text("contact.noName");
  return c.archived ? tr.text("accessLog.name.archived", { name }) : name;
}

function buildItem(it: AccessLogItem, names: AccessLogNames, tr: Tr, zone: string, base: string): VisitItemView {
  const key = `${it.kind}-${it.recordId ?? it.firstOpenedAt}`;
  switch (it.kind) {
    case "contact": {
      const id = it.recordId!;
      const label = contactLabel(id, names, tr);
      return label === null
        ? { key, text: tr.text("accessLog.gone.customer"), href: null }
        : { key, text: tr.text("accessLog.item.customer", { name: label }), href: `${base}/contacts/${id}` };
    }
    case "group": {
      const id = it.recordId!;
      const g = names.groups.get(id);
      return !g
        ? { key, text: tr.text("accessLog.gone.group"), href: null }
        : { key, text: tr.text(GROUP_KEY[g.kind], { name: g.name }), href: `${base}/groups/${id}` };
    }
    case "call": {
      const id = it.recordId!;
      const call = names.calls.get(id);
      if (!call) return { key, text: tr.text("accessLog.gone.other"), href: null };
      const when = formatDateTimeInZone(call.startedAt, zone, tr.locale);
      const label = contactLabel(call.contactId, names, tr);
      const text = label ? tr.text("accessLog.item.call", { name: label, when }) : tr.text("accessLog.item.callNoName", { when });
      return { key, text, href: `${base}/calls/${id}` };
    }
    case "conversation": {
      const id = it.recordId!;
      const conv = names.conversations.get(id);
      if (!conv) return { key, text: tr.text("accessLog.gone.other"), href: null };
      const label = contactLabel(conv.contactId, names, tr);
      const text = label ? tr.text("accessLog.item.conversation", { name: label }) : tr.text("accessLog.item.conversationNoName");
      return { key, text, href: `${base}/conversations?c=${id}` };
    }
    case "document_view":
    case "document_download":
    case "document_share": {
      const id = it.recordId!;
      const doc = names.documents.get(id);
      if (!doc) return { key, text: tr.text("accessLog.gone.file"), href: null };
      const title = doc.trashed ? tr.text("accessLog.name.trashed", { title: doc.title }) : doc.title;
      const text = tr.text(FILE_KEY[it.kind], { title });
      const href = doc.record
        ? (doc.record.kind === "contact" ? `${base}/contacts/${doc.record.id}?document=${id}` : `${base}/groups/${doc.record.id}?document=${id}`)
        : null;
      return { key, text, href };
    }
    case "form_answers": {
      const id = it.recordId!;
      const form = names.forms.get(id);
      return !form
        ? { key, text: tr.text("accessLog.gone.other"), href: null }
        : { key, text: tr.text("accessLog.item.form", { name: form.name }), href: `${base}/forms/${id}` };
    }
    case "customer_list_export": {
      const count = it.itemCount ?? 0;
      return { key, text: tr.count("accessLog.item.export", count), href: null };
    }
    default: {
      const neverKind: never = it.kind;
      throw new Error(`buildVisitRows: unknown item kind ${String(neverKind)}`);
    }
  }
}

function buildRow(visit: AccessLogVisit, names: AccessLogNames, tr: Tr, zone: string, base: string): VisitRowView {
  const actor = visit.actorName ?? tr.text("accessLog.someone");
  const label = `${actor} · ${tr.text(REASON_KEY[visit.reason])}`;
  const when = visitSpan(visit.startedAt, visit.endedAt, zone, tr.locale);
  const summary = visitSummary(visit.counts, tr);
  const items = visit.items.map((it) => buildItem(it, names, tr, zone, base));
  const more = visit.itemTotal > items.length ? tr.text("accessLog.more", { count: visit.itemTotal - items.length }) : null;
  return { id: visit.id, label, when, summary, items, more };
}

/** One page of visits, laid out for `BisAccessList`. */
export function buildVisitRows(page: AccessLogPage, names: AccessLogNames, ctx: { tr: Tr; zone: string; base: string }): VisitRowView[] {
  return page.visits.map((visit) => buildRow(visit, names, ctx.tr, ctx.zone, ctx.base));
}
