import type { AuthorKind, DuplicatePair } from "@bis/db";
import type { RecordHeaderAction } from "@/components/record/record-header";
import type { TimelineTone } from "@/components/record/timeline-item";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { FactsView } from "@/lib/record/record-facts";
import type { NextUpRow, NextUpView, NextUpWho } from "@/lib/record/next-up";
import type { RecentRowView } from "@/lib/record/recent-rows";
import { parseLanguageView, type LanguageView } from "@/lib/contacts/language";

/** The editable fields the drawer shows for a `?peek=` stub row (Q1). */
export type DrawerFields = { first_name: string | null; last_name: string | null; email: string | null; phone: string | null; company_name: string | null };

/**
 * The list drawer's one read (S-03 part 3 §7.2). Every string in it is already in `locale`, built on
 * the server by the record page's own view builders (C1); each section carries its own status (C2).
 */
export type DrawerSummary = {
  locale: Locale;
  /** F-006 part 1 (plan Task 11): the record this body is actually ABOUT — the KEPT record when a
   *  `?peek=` named a tombstone (0106), so "Open full record" and the duplicate line both point at
   *  it, never the id the drawer fetched for. Absent from an older server during a deploy. */
  contactId?: string;
  header: {
    name: string; subtitle: string | null; subtitleHref: string | null; actions: RecordHeaderAction[];
    /** When the contact was archived, or null. A `?peek=` stub has no list row to say so (final review M2). */
    archivedAt: string | null;
  };
  facts: { status: "ready"; view: FactsView } | { status: "error"; text: string };
  nextUp: { status: "ready"; view: NextUpView; emptyText: string } | { status: "error"; text: string };
  recent:
    | { status: "ready"; rows: RecentRowView[]; failedText: string | null; emptyText: string | null; seeAllHref: string }
    | { status: "error"; text: string };
  who: {
    source: string | null; sourceHint: string | null; assignedTo: string | null; fields: DrawerFields;
    tags: { status: "ready"; tags: { id: string; name: string }[] } | { status: "error" };
    /** Absent when the line could not be built (review M-2): the drawer leaves it out, never "Not set.". */
    language?: LanguageView;
  };
  /** F-006 part 1 (plan Task 11, spec §6.1): the "may be the same person" line's pairs, strongest
   *  first, naming `contactId` above. Absent from an older server; never fails the whole body. */
  duplicates?: DuplicatePair[];
};

type Failed = { status: "error"; text: string };
/** `assignedTo` undefined: the server did not say (an older one), so the drawer leaves the line out.
 *  `language` undefined the same way (S-09, plan deviation 11): an older server during a deploy. */
export type ParsedWho =
  | ({ status: "ready" } & Omit<DrawerSummary["who"], "assignedTo" | "language"> & { assignedTo: string | null | undefined; language: LanguageView | undefined })
  | Failed;
export type ParsedDrawerSummary = Omit<DrawerSummary, "who"> & { who: ParsedWho };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
// `Object.hasOwn`, not `in`: "constructor" is a property of any object literal and is not a kind.
const oneOf = <T extends string>(set: Readonly<Record<T, true>>, v: unknown): v is T => typeof v === "string" && Object.hasOwn(set, v);
const LOCALES: Readonly<Record<Locale, true>> = { en: true, es: true };
const TONES: Readonly<Record<TimelineTone, true>> = { accent: true, good: true, warn: true, crit: true, muted: true };
const AUTHORS: Readonly<Record<AuthorKind, true>> = { person: true, ai: true, automation: true, customer: true, import: true };
const ROW_KINDS: Readonly<Record<RecentRowView["kind"], true>> = {
  note: true, task: true, deal: true, submission: true, message: true, booking: true, call: true, document: true,
  documentVersion: true, documentRemoved: true, documentRequest: true, documentSkip: true, documentUnskip: true,
  documentShared: true, documentShareOpened: true, chat: true,
  // item 8b-2: the type's exhaustive case; the drawer's Recent never reads suggestions (owner decision 1).
  suggestion: true,
  // item 8c: the type's exhaustive case; the drawer's Recent never reads ai_acts either (plan Task 3).
  aiAct: true,
  // Contact archive (0103, spec §4.2, T7): the drawer's Recent reads archive/restore rows like any other source.
  archive: true,
  // F-006 part 1 (plan Task 9 review carry-in, Task 11): merge/mergeUndone are read UNCONDITIONALLY
  // (unlike suggestions and ai_acts), and loadRecent now reads through the tombstone id set too
  // (loaders.ts), so the drawer's Recent can carry either row and must not drop it as unknown.
  merge: true, mergeUndone: true,
};
/** Where a header action may point: a phone, this app, an anchor, or an https map. Never `javascript:`,
 *  and never a protocol-relative URL (`//evil.example`, which the browser reads as `https://evil.example`,
 *  or `/\evil.example`, which a browser also resolves to `https://evil.example` — `\/(?![\/\\])` requires
 *  the one leading slash NOT be followed by a second slash OR a backslash). */
const safeHref = (h: string) => /^(tel:|\/(?![\/\\])|#|https:\/\/)/.test(h);

function parseHeader(v: unknown): DrawerSummary["header"] | null {
  if (!isRecord(v) || !isStr(v.name) || !strOrNull(v.subtitle) || !strOrNull(v.subtitleHref) || !Array.isArray(v.actions)) return null;
  if (v.subtitleHref !== null && !safeHref(v.subtitleHref)) return null;
  // Absent (a body from before archive existed) reads not archived; anything but a string or null is malformed.
  const archivedAt = v.archivedAt === undefined ? null : v.archivedAt;
  if (!strOrNull(archivedAt)) return null;
  const actions: RecordHeaderAction[] = [];
  for (const a of v.actions) {
    if (!isRecord(a) || !isStr(a.id) || !isStr(a.label) || !isStr(a.href) || !safeHref(a.href)) return null;
    if (a.ariaLabel !== undefined && !isStr(a.ariaLabel)) return null;
    actions.push({ id: a.id, label: a.label, href: a.href, ariaLabel: a.ariaLabel, primary: a.primary === true, external: a.external === true });
  }
  return { name: v.name, subtitle: v.subtitle, subtitleHref: v.subtitleHref, actions, archivedAt };
}

/** A section: the server's own error passes through; a ready one the parser accepts; anything else is `fallback`. */
function section<T>(v: unknown, ready: (r: Record<string, unknown>) => T | null, fallback: string): T | Failed {
  if (isRecord(v) && v.status === "error" && isStr(v.text)) return { status: "error", text: v.text };
  if (isRecord(v) && v.status === "ready") {
    const r = ready(v);
    if (r !== null) return r;
  }
  return { status: "error", text: fallback };
}

function parseWho(v: unknown): NextUpWho | null | undefined {
  if (v === null) return null;
  return isRecord(v) && isStr(v.name) && isBool(v.typed) ? { name: v.name, typed: v.typed } : undefined;
}

function parseNextUpRow(r: unknown): NextUpRow | null {
  if (!isRecord(r) || !isStr(r.id)) return null;
  const who = parseWho(r.who);
  if (who === undefined) return null;
  if (r.kind === "booking" && isStr(r.label)) return { kind: "booking", id: r.id, label: r.label, who };
  if (r.kind === "task" && isStr(r.title) && isStr(r.detail) && isBool(r.overdue)) {
    return { kind: "task", id: r.id, title: r.title, detail: r.detail, overdue: r.overdue, who };
  }
  return null;
}

/** A row, or "unknown" for a kind this bundle does not know (dropped), or null when malformed. */
function parseRecentRow(r: unknown): RecentRowView | "unknown" | null {
  if (!isRecord(r)) return null;
  if (!oneOf(ROW_KINDS, r.kind)) return isStr(r.kind) ? "unknown" : null;
  const mark = r.mark;
  if (!isStr(r.key) || !isRecord(mark) || !oneOf(AUTHORS, mark.kind) || !isStr(mark.label) || !isStr(r.verb)
    || !strOrNull(r.detail) || !isStr(r.time) || !isStr(r.dateTime)) return null;
  const st = r.status;
  const status = st === null ? null : isRecord(st) && oneOf(TONES, st.tone) && isStr(st.word) ? { tone: st.tone, word: st.word } : undefined;
  const ex = r.excerpt;
  const excerpt = ex === null ? null
    : isRecord(ex) && isStr(ex.text) && (ex.lang === "" || ex.lang === "en" || ex.lang === "es") && isBool(ex.done)
      ? { text: ex.text, lang: ex.lang as "" | "en" | "es", done: ex.done } : undefined;
  if (status === undefined || excerpt === undefined) return null;
  return { key: r.key, kind: r.kind, mark: { kind: mark.kind, label: mark.label }, verb: r.verb, status, detail: r.detail, time: r.time, dateTime: r.dateTime, excerpt };
}

const FIELD_KEYS = ["first_name", "last_name", "email", "phone", "company_name"] as const;

/** One side of a pair (`@bis/db`'s `DuplicatePerson`): checked, not cast. */
function parseDuplicatePerson(v: unknown): DuplicatePair["a"] | null {
  return isRecord(v) && isStr(v.id) && strOrNull(v.firstName) && strOrNull(v.lastName)
    ? { id: v.id, firstName: v.firstName, lastName: v.lastName } : null;
}
/** F-006 part 1 (plan Task 11): one pair, or null when malformed — dropped rather than failing the
 *  whole `duplicates` list, as an unknown recent-row kind is dropped above. */
function parseDuplicatePair(v: unknown): DuplicatePair | null {
  if (!isRecord(v) || !isStr(v.id) || !isStr(v.reason) || typeof v.strength !== "number" || !isStr(v.createdAt)) return null;
  const a = parseDuplicatePerson(v.a);
  const b = parseDuplicatePerson(v.b);
  return a && b ? { id: v.id, a, b, reason: v.reason, strength: v.strength, createdAt: v.createdAt } : null;
}

/**
 * The drawer's summary body, checked rather than cast (S-03 part 3 §7.4): the body comes from
 * whatever server answered, possibly older or newer than this tab's bundle, and the drawer renders
 * inside the dashboard's only error boundary. Null (the whole drawer's error) only when `locale` or
 * `header` is missing or malformed: without them there is nothing to title the drawer with. Any other
 * section that fails to parse is that section's error, in `locale`, and the rest still render. A
 * recent row of an unknown kind is dropped. Keys it does not know are not carried through.
 */
export function parseDrawerSummary(json: unknown): ParsedDrawerSummary | null {
  if (!isRecord(json) || !oneOf(LOCALES, json.locale)) return null;
  const locale = json.locale;
  const header = parseHeader(json.header);
  if (!header) return null;
  const failed = (title: MessageKey) => t(m, "record.card.failed", locale, { title: t(m, title, locale) });

  const facts = section(json.facts, (r) => {
    const v = r.view;
    return isRecord(v) && Array.isArray(v.line) && v.line.every(isStr) && strOrNull(v.missing) && isBool(v.allFailed)
      ? { status: "ready" as const, view: { line: [...v.line], missing: v.missing, allFailed: v.allFailed } } : null;
  }, t(m, "record.summary.failed", locale));

  const nextUp = section(json.nextUp, (r) => {
    const v = r.view;
    if (!isRecord(v) || !Array.isArray(v.rows) || !strOrNull(v.undated) || !isStr(r.emptyText)) return null;
    const rows = v.rows.map(parseNextUpRow);
    return rows.every((x): x is NextUpRow => x !== null)
      ? { status: "ready" as const, view: { rows, undated: v.undated }, emptyText: r.emptyText } : null;
  }, failed("record.card.nextUp"));

  const recent = section(json.recent, (r) => {
    if (!Array.isArray(r.rows) || !strOrNull(r.failedText) || !strOrNull(r.emptyText) || !isStr(r.seeAllHref) || !safeHref(r.seeAllHref)) return null;
    const rows: RecentRowView[] = [];
    for (const raw of r.rows) {
      const row = parseRecentRow(raw);
      if (row === null) return null;
      if (row !== "unknown") rows.push(row);
    }
    return { status: "ready" as const, rows, failedText: r.failedText, emptyText: r.emptyText, seeAllHref: r.seeAllHref };
  }, failed("drawer.recent"));

  const w = json.who;
  let who: ParsedWho = { status: "error", text: failed("contact.details") };
  // S-09: absent (an older server) leaves the line out; present but malformed is the who section's error.
  const language = isRecord(w) && w.language !== undefined ? parseLanguageView(w.language) : undefined;
  if (isRecord(w) && language !== null && strOrNull(w.source) && strOrNull(w.sourceHint) && isRecord(w.fields) && FIELD_KEYS.every((k) => strOrNull((w.fields as Record<string, unknown>)[k]))) {
    const f = w.fields as Record<(typeof FIELD_KEYS)[number], string | null>;
    const tg = w.tags;
    const tags = isRecord(tg) && tg.status === "ready" && Array.isArray(tg.tags) && tg.tags.every((x) => isRecord(x) && isStr(x.id) && isStr(x.name))
      ? { status: "ready" as const, tags: (tg.tags as { id: string; name: string }[]).map((x) => ({ id: x.id, name: x.name })) }
      : { status: "error" as const };
    who = {
      status: "ready", source: w.source, sourceHint: w.sourceHint,
      // Null is a fact ("Unassigned"); anything else says nothing, and the drawer leaves the line out.
      assignedTo: isStr(w.assignedTo) ? w.assignedTo : w.assignedTo === null ? null : undefined,
      fields: { first_name: f.first_name, last_name: f.last_name, email: f.email, phone: f.phone, company_name: f.company_name },
      tags, language,
    };
  }
  // F-006 part 1 (plan Task 11): both additive and optional (an older server omits them). A
  // malformed contactId is dropped, never the whole drawer's error — the client already falls back
  // to the id it fetched for. `duplicates` drops a malformed pair rather than the whole list, or
  // reads as none when the value is not an array at all; it never fails the body either.
  const contactId = isStr(json.contactId) ? json.contactId : undefined;
  const duplicates = json.duplicates === undefined ? undefined
    : Array.isArray(json.duplicates) ? json.duplicates.map(parseDuplicatePair).filter((p): p is DuplicatePair => p !== null)
    : [];
  return { locale, ...(contactId !== undefined ? { contactId } : {}), header, facts, nextUp, recent, who, ...(duplicates !== undefined ? { duplicates } : {}) };
}

export type DrawerLoad = { status: "error" } | { status: "ready"; body: ParsedDrawerSummary };

/** The drawer's fetch `.then` body: a non-OK answer is the error and its body is never read. */
export async function drawerLoadFrom(res: { ok: boolean; json: () => Promise<unknown> }): Promise<DrawerLoad> {
  if (!res.ok) return { status: "error" };
  const body = parseDrawerSummary(await res.json());
  return body ? { status: "ready", body } : { status: "error" };
}

// The QA override (lib/i18n/request-locale.ts); anything else on the URL is dropped, never echoed.
const QA_LOCALES = new Set(["en", "es", "pseudo"]);

/**
 * The drawer's fetch URL (C9): the list URL's `?locale=` rides along only when present (the route
 * hands it to requestLocale, which ignores it outside BIS_I18N_QA); otherwise today's exact path, so
 * the e2e's route glob (`**\/contacts/<id>/summary`) still matches.
 */
export function drawerSummaryUrl(accountId: string, contactId: string, search: string): string {
  const path = `/api/accounts/${accountId}/contacts/${contactId}/summary`;
  const locale = new URLSearchParams(search).get("locale");
  return locale !== null && QA_LOCALES.has(locale) ? `${path}?locale=${locale}` : path;
}

/**
 * Q1 (owner, 2026-10-13): the fields the drawer edits. A list row is its own; a `?peek=` deep link to
 * a contact not on this page gets the blank stub (`created_at === ""`, contacts-table.tsx:41-46), whose
 * fields come from the route's contact instead. Null while a stub waits: skeletons, never blank fields.
 */
export function drawerFieldsRow<R extends DrawerFields & { created_at: string }>(row: R, load: DrawerLoad | { status: "loading" }): R | null {
  if (row.created_at !== "") return row;
  if (load.status === "ready" && load.body.who.status === "ready") return { ...row, ...load.body.who.fields };
  return null;
}
