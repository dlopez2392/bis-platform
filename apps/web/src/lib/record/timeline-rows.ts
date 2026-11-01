import type { TimelineEntry, TimelineSource, TimelineSuggestion } from "@bis/db";
import { removedReason } from "@bis/db/document-rules";
import type { Proposal } from "@bis/db/proposal-rules";
import { describeRow } from "@/lib/proposals/view";
import type { DescribeCtx, Description, Part } from "@/lib/proposals/kinds/types";
import type { TimelineTone } from "@/components/record/timeline-item";
import { contactDisplayName, formatCurrency, formatDateInZone, formatDateTimeInZone } from "@/lib/format";
import { mergeCountsList, mergeCountsTotal } from "@/lib/contacts/merge-copy";
import { m, type MessageKey } from "@/lib/messages";
import type { PluralKey } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { describeAct } from "@/lib/ai-acts/kinds";
import type { ActFacts } from "@/lib/ai-acts/kinds/types";
import { buildActView, type AiActView } from "@/lib/ai-acts/view";
import { authorMark, type AuthorCtx, type AuthorMarkView } from "./author-mark";
import type { Tr } from "./copy";

export type TimelineStatus = { tone: TimelineTone; word: string };
/** One row as the timeline draws it (spec §9.4): the grammar's parts, already in the page's language. */
export type TimelineRow = {
  key: string; entry: TimelineEntry; day: string; showDay: boolean; time: string;
  mark: AuthorMarkView; verb: string; status: TimelineStatus | null; detail: string | null;
  /** The member the row is about, on the group page (S-03 part 2b, C6); null on the contact page,
   *  and for a member the page holds no name for. Never replaces the author mark. */
  subject: { label: string; href: string } | null;
  /** S-06 part 3 (§5a, G18): a staff-language line under the row, on a chat matched to an existing customer only. */
  note?: { text: string; lang: Locale };
  /** item 8b-2 (final review M-5): an accepted suggestion row's verb, and an edited one's original, as the
   *  card draws them (SuggestionParts): the model's own words keep lang="en" (P18), the arrow is drawn
   *  aria-hidden beside its spoken word. `verb` and `detail` stay the drawn sentence, as text. */
  verbParts?: Part[];
  detailParts?: Part[];
  /** item 8c: an act's row only, its built view (the source line and the Undo state), from the act-kind
   *  registry and the page's one facts read (`view.ts`, pure, server-built). */
  act?: AiActView;
};
export type TimelineSubjects = Readonly<Record<string, { label: string; href: string }>>;

type StatusMap = Readonly<Record<string, readonly [MessageKey, TimelineTone]>>;
const MESSAGE_STATUS: StatusMap = {
  queued: ["conversations.status.queued", "muted"], sent: ["conversations.status.sent", "accent"],
  delivered: ["conversations.status.delivered", "good"], opened: ["conversations.status.opened", "good"],
  bounced: ["conversations.status.bounced", "crit"], failed: ["conversations.status.failed", "crit"],
};
const BOOKING_STATUS: StatusMap = {
  booked: ["calendar.bookings.status.booked", "accent"], completed: ["calendar.bookings.status.completed", "good"],
  cancelled: ["calendar.bookings.status.cancelled", "muted"], no_show: ["calendar.bookings.status.no_show", "warn"],
};
const CALL_OUTCOME: StatusMap = {
  booked: ["calls.outcome.booked", "good"], lead: ["calls.outcome.lead", "accent"], message: ["calls.outcome.message", "accent"],
  abandoned: ["calls.outcome.abandoned", "muted"], spam: ["calls.outcome.spam", "muted"], transferred: ["calls.outcome.transferred", "accent"],
};
const DEAL_STATUS: StatusMap = {
  open: ["pipeline.status.open", "accent"], won: ["pipeline.status.won", "good"], lost: ["pipeline.status.lost", "muted"],
};
const SOURCE_KEY: Record<TimelineSource, MessageKey> = {
  notes: "timeline.what.notes", todos: "timeline.what.todos", deals: "timeline.what.deals", forms: "timeline.what.forms",
  messages: "timeline.what.messages", bookings: "timeline.what.bookings", calls: "timeline.what.calls",
  documents: "timeline.what.documents", chats: "timeline.what.chats", archive: "timeline.what.archive",
  merge: "timeline.what.merge", suggestions: "timeline.what.suggestions", ai_acts: "timeline.what.aiActs",
};

/** Stands in for the change inside the translated template, so the template can be split around it. No
 *  vowels: the pseudo-locale rewrites vowels (kinds/task.ts's own SLOT). */
const SLOT = "␟";

/** The template's words around the change's own parts, so the row keeps each part's lang and spoken form. */
function around(template: string, d: Description): Part[] {
  const at = template.lastIndexOf(SLOT);
  const before = at < 0 ? template : template.slice(0, at);
  const after = at < 0 ? "" : template.slice(at + SLOT.length);
  return [...(before ? [{ text: before }] : []), ...d.parts, ...(after ? [{ text: after }] : [])];
}
const drawn = (parts: Part[]) => parts.map((p) => p.text).join("");

/**
 * item 8b-2 (spec 5.4, 7): "accepted Rosa's suggestion: <what was written>" through the registry's own
 * sentence (`describeRow`), described at the DECISION's instant, so a to-do due that week never reads
 * "Was due" later. What was written is the applied form; when the read could not parse it, what was
 * proposed. An edited one says so and carries the original as its detail.
 */
function suggestionPhrase(
  s: TimelineSuggestion, at: string, zone: string, tr: Tr, persona: string, stages: DescribeCtx["stages"],
): Pick<TimelineRow, "verb" | "status" | "detail" | "verbParts" | "detailParts"> {
  const ctx = { tr, zone, stages, now: new Date(at) };
  // `applied` is the proposal's own kind's payload (TimelineSuggestion pairs them arm by arm); the spread
  // loses that pairing in the type only.
  const written = describeRow({ ...s.proposal, payload: s.applied ?? s.proposal.payload } as Proposal, ctx);
  const edited = s.proposal.status === "edited";
  const verbParts = around(tr.text(edited ? "timeline.suggestionEdited" : "timeline.suggestion", { persona, change: SLOT }), written);
  const detailParts = edited ? around(tr.text("timeline.suggestion.original", { change: SLOT }), describeRow(s.proposal, ctx)) : undefined;
  return {
    verb: drawn(verbParts), verbParts, status: null,
    detail: detailParts ? drawn(detailParts) : written.detail,
    ...(detailParts ? { detailParts } : {}),
  };
}

/** A deal's amount, or null when it has none: 0 and null are not an amount anyone entered
 *  (DESIGN.md: omitted, never zeroed), and "$0" would read as a free job. */
function amountText(value: number | string | null | undefined, tr: Tr): string | null {
  const n = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) && n !== 0 ? formatCurrency(n, tr.locale) : null;
}

/** A known value is a dot and a word (rule 3); an unmapped future one still shows, as itself (D-014). */
function statusOf(map: StatusMap, value: string, tr: Tr): TimelineStatus {
  const hit = Object.hasOwn(map, value) ? map[value] : undefined;
  return hit ? { tone: hit[1], word: tr.text(hit[0]) } : { tone: "muted", word: value };
}

/** "Thu, Oct 16, 10:00 AM" in the account's zone and the page's language. */
function whenText(iso: string, zone: string, tr: Tr): string {
  return new Intl.DateTimeFormat(tr.locale === "es" ? "es-US" : "en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

function phrase(
  entry: TimelineEntry, mark: AuthorMarkView, zone: string, tr: Tr, persona: string, stages: DescribeCtx["stages"],
): Pick<TimelineRow, "verb" | "status" | "detail" | "verbParts" | "detailParts"> {
  switch (entry.kind) {
    case "suggestion": return suggestionPhrase(entry.suggestion, entry.at, zone, tr, persona, stages);
    case "note": return { verb: tr.text("timeline.note"), status: null, detail: null };
    case "task": return { verb: tr.text(entry.task.call_id ? "timeline.callbackTodo" : "timeline.todo"), status: null, detail: null };
    case "deal": return {
      verb: tr.text("timeline.deal", { name: entry.deal.name }),
      status: statusOf(DEAL_STATUS, entry.deal.status, tr),
      detail: amountText(entry.deal.monetary_value, tr),
    };
    case "submission": return {
      verb: mark.kind === "ai" ? tr.text("timeline.chat") : tr.text("timeline.form", { form: entry.submission.formName }),
      status: null, detail: null,
    };
    case "message": return {
      verb: tr.text(entry.message.channel === "sms" ? "timeline.texted" : "timeline.emailed"),
      // Only an outbound message has a delivery state worth a word: "sent" is what the provider took.
      status: entry.message.direction === "outbound" ? statusOf(MESSAGE_STATUS, entry.message.status, tr) : null,
      detail: null,
    };
    case "booking": return {
      verb: tr.text("timeline.booked", { when: whenText(entry.booking.starts_at, zone, tr) }),
      status: statusOf(BOOKING_STATUS, entry.booking.status, tr),
      detail: entry.booking.moved_from_starts_at
        ? tr.text("timeline.movedFrom", { when: whenText(entry.booking.moved_from_starts_at, zone, tr) }) : null,
    };
    case "call": return {
      verb: tr.text("timeline.answeredCall"),
      status: statusOf(CALL_OUTCOME, entry.call.outcome, tr),
      detail: entry.call.duration_secs ? tr.text("timeline.minutes", { count: Math.max(1, Math.round(entry.call.duration_secs / 60)) }) : null,
    };
    // S-06 part 3 (spec §7, G23): "chatted with Sofía on your website", the count as its detail; no status.
    case "chat": return {
      verb: tr.text("timeline.webchat", { name: persona }), status: null, detail: tr.count("timeline.webchatCount", entry.chat.count),
    };
    // S-07: a file the camera took reads as a photo; a trashed one is still listed, with "In the trash"
    // as a dot and a word (rule 3). The category is the detail, in the page's language.
    case "document": return {
      // S-07 2b: a file the customer sent through a request link reads "sent <title>".
      verb: tr.text(entry.document.source === "camera" ? "timeline.documentPhoto" : entry.document.source === "customer" ? "timeline.documentCustomer" : "timeline.document",
        { title: entry.document.title }),
      status: entry.document.deleted_at ? { tone: "muted", word: tr.text("documents.status.trashed") } : null,
      detail: tr.text(`documents.category.${entry.document.category}`),
    };
    // S-07 1b (owner ruling R2): a new version, the same trash status and category detail as its file.
    case "documentVersion": return {
      verb: tr.text("timeline.documentVersion", { title: entry.version.title }),
      status: entry.version.deleted_at ? { tone: "muted", word: tr.text("documents.status.trashed") } : null,
      detail: tr.text(`documents.category.${entry.version.category}`),
    };
    // S-07 2a (spec 3.5): a removed file, its own words per state, the state as a crit dot and word (rule 3).
    // Owner ruling 2026-10-15: a password-protected file says why; removedReason (@bis/db/document-rules) decides.
    case "documentRemoved": {
      const why = removedReason(entry.scan.scan_status, entry.scan.scan_signature);
      const verb = why === "virus" ? "timeline.documentRemoved" : why === "password" ? "timeline.documentPassword" : "timeline.documentUnscannable";
      const word = why === "virus" ? "documents.status.virusRemoved" : why === "password" ? "documents.status.passwordRemoved" : "documents.status.unscannable";
      return { verb: tr.text(verb, { title: entry.scan.title }), status: { tone: "crit", word: tr.text(word) }, detail: tr.text(`documents.category.${entry.scan.category}`) };
    }
    // S-07 2b (plan deviation 6): "{person} asked for N documents", the items in the reader's language;
    // an "other" item is the staff's own note, as typed.
    case "documentRequest": {
      const n = entry.request.items.length;
      return {
        verb: tr.text(n === 1 ? "timeline.documentRequestOne" : "timeline.documentRequest", { count: n }),
        status: null,
        detail: entry.request.items.map((i) => (i.category === "other" && i.note ? i.note : tr.text(`documents.category.${i.category}` as MessageKey))).join(", "),
      };
    }
    // S-07 2c (spec 5.4): "{person} marked Insurance as not needed" / "… as needed again"; no status, no detail.
    case "documentSkip":
      return { verb: tr.text("timeline.documentSkip", { category: tr.text(`documents.category.${entry.skip.category}` as MessageKey) }), status: null, detail: null };
    case "documentUnskip":
      return { verb: tr.text("timeline.documentUnskip", { category: tr.text(`documents.category.${entry.skip.category}` as MessageKey) }), status: null, detail: null };
    // S-07 3b: "{person} shared <title>" and "{the link's recipient} opened <title>"; a trashed file's status, the category as detail.
    case "documentShared":
    case "documentShareOpened": return {
      verb: tr.text(entry.kind === "documentShared" ? "timeline.documentShared" : "timeline.documentShareOpened", { title: entry.share.title }),
      status: entry.share.deleted_at ? { tone: "muted", word: tr.text("documents.status.trashed") } : null,
      detail: tr.text(`documents.category.${entry.share.category}`),
    };
    // item 8c: the act-kind registry's own sentence ("booked Thu, Oct 22, 10:00 AM CDT"), under the AI mark
    // (authorOf). No status word: whether it can still be undone is the row's view (`timelineRows`, `act`).
    case "aiAct": return { ...describeAct(entry.act, { tr, zone }), status: null };
    // Contact archive (spec §6.2): an archive is always the person's own act. A restore is either the
    // person's own undo ("moved back to the list") or the customer's own sign bringing them back
    // ("Came back: …", one phrase per sign — the migration's own check keeps `sign` non-null exactly
    // when `author_kind` is "customer"). No status, no detail.
    case "archive": {
      const a = entry.archive;
      const key = a.action === "archived" ? "timeline.archived"
        : a.author_kind === "customer" ? (`timeline.cameBack.${a.sign}` as MessageKey)
          : "timeline.restored";
      // The account's own AI persona (else Sofía), as every other AI-facing row on the timeline names it.
      return { verb: tr.text(key, { persona }), status: null, detail: null };
    }
    // F-006 part 1 (plan Task 9): the other record's name, else "another record" when RLS (0068's
    // Technician fence included) could not read it — the row still says what moved either way.
    case "merge": {
      const name = entry.merge.otherVisible
        ? contactDisplayName({ first_name: entry.merge.otherFirstName, last_name: entry.merge.otherLastName }, tr.locale)
        : tr.text("timeline.mergeOtherHidden");
      const list = mergeCountsList(entry.merge.counts, tr, tr.locale);
      // S-10 T9a: "{list} moved here" agrees with how MANY things moved in
      // total ("1 nota pasó aquí" vs "1 nota y 1 llamada pasaron aquí"),
      // never the plain "other" form regardless of count — the bug this
      // fixes always read the plural Spanish verb even for a single item.
      const verb = list
        ? tr.count("timeline.merged" as PluralKey<typeof m>, mergeCountsTotal(entry.merge.counts), { name, list })
        : tr.text("timeline.mergedEmpty", { name });
      return { verb, status: null, detail: null };
    }
    case "mergeUndone": {
      const name = entry.merge.otherVisible
        ? contactDisplayName({ first_name: entry.merge.otherFirstName, last_name: entry.merge.otherLastName }, tr.locale)
        : tr.text("timeline.mergeOtherHidden");
      return { verb: tr.text("timeline.mergeUndone", { name }), status: null, detail: null };
    }
  }
}

/**
 * The page's rows (spec §9.4), newest first as the merge returned them, each under a day separator
 * in the ACCOUNT's zone (D-010). Pure; THROWS on a malformed instant, so the page builds it inside
 * its view guard (C5): a bad row costs the timeline card, never the page.
 */
export function timelineRows(
  entries: readonly TimelineEntry[],
  ctx: {
    zone: string; tr: Tr; author: AuthorCtx; subjects?: TimelineSubjects;
    /** item 8b-2: stage names for a stage-move suggestion's row; an unresolved one reads the registry's honest sentence. */
    suggestionStages?: DescribeCtx["stages"];
    /** item 8c: the page's acts' facts (`loadTimeline`); null or absent, every act reads without an Undo. */
    actFacts?: ActFacts | null;
  },
): TimelineRow[] {
  let previousDay: string | null = null;
  // The AI mark's own rule (author-mark.ts's authorLabel): the account's persona, else Sofía.
  const persona = ctx.author.personaName?.trim() || "Sofía";
  const stages = ctx.suggestionStages ?? {};
  return entries.map((entry) => {
    const day = formatDateInZone(entry.at, ctx.zone, ctx.tr.locale);
    const mark = authorMark(entry, ctx.author);
    const row: TimelineRow = {
      key: `${entry.kind}-${entry.id}`, entry, day, showDay: day !== previousDay,
      time: formatDateTimeInZone(entry.at, ctx.zone, ctx.tr.locale), mark, ...phrase(entry, mark, ctx.zone, ctx.tr, persona, stages),
      subject: ctx.subjects && Object.hasOwn(ctx.subjects, entry.contactId) ? ctx.subjects[entry.contactId]! : null,
      ...(entry.kind === "chat" && entry.chat.matchedExisting
        ? { note: { text: ctx.tr.text("conversations.webchat.unconfirmed"), lang: ctx.tr.locale } } : {}),
      ...(entry.kind === "aiAct"
        ? { act: buildActView(entry.act, ctx.actFacts ?? null, {
          tr: ctx.tr, zone: ctx.zone, personaName: ctx.author.personaName, names: ctx.author.names,
          viewerId: ctx.author.viewerId, accountId: entry.act.accountId,
        }) } : {}),
    };
    previousDay = day;
    return row;
  });
}

/** "Couldn't load calls and bookings." for the sources that failed; null when none did. */
export function timelineFailedText(failed: readonly TimelineSource[], tr: Tr): string | null {
  if (failed.length === 0) return null;
  const what = new Intl.ListFormat(tr.locale === "es" ? "es-US" : "en-US", { type: "conjunction" })
    .format(failed.map((s) => tr.text(SOURCE_KEY[s])));
  return tr.text("timeline.someFailed", { what });
}
