import { effectiveStatus, type ExpiredReason, type Proposal, type ProposalStatus } from "@bis/db/proposal-rules";
import { tag } from "@/lib/format";
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";
import { KINDS } from "./kinds";
import type { DescribeCtx, Description, Part } from "./kinds/types";
import { localDateKey } from "./local-day";

/**
 * The suggestion card's plain data (item 8b-1, spec 4.5), built on the server from one row, so the card
 * and its client actions read words and never the registry. Pure given its inputs: the clock, the zone,
 * the reader's language and the names are all passed in.
 */

export type SuggestionEdit =
  | { kind: "task"; title: string; dueDate: string }
  | { kind: "contact_field"; label: string; value: string }
  | { kind: "opportunity_stage"; options: { id: string; name: string }[]; toStageId: string };

export type SuggestionLabels = {
  accept: string; editAccept: string; discard: string; saveAccept: string; cancel: string;
  undo: string; title: string; due: string; stage: string;
  /** A client-side rejection (the request never reached us, or a tab older than the deployment): "Reload
   *  the page, then check" (8b-1 follow-up 1). The action's own "may not have gone through" is unchanged. */
  crashed: string;
  /** The rejection toast's Reload action. */
  reload: string;
  /** "Because the caller said", the words before the caller's quote. */
  because: string;
  /** The words' language, which every toast carries (design review I3). */
  lang: "en" | "es";
};

export type SuggestionView = {
  id: string; lang: "en" | "es";
  /** "From the call on Wed, Oct 14 · Ana López" */
  sourceLabel: string;
  parts: Part[]; detail: string | null;
  evidence: string; evidenceLang: "en" | "es";
  /** "Sofía · AI" / "Sofía · IA", the account's own persona. */
  personaMark: string;
  status: ProposalStatus; statusWord: string; reasonLine: string | null; decidedLine: string | null;
  /** effectiveStatus === "pending": an aged row shows no buttons. */
  canAct: boolean;
  edit: SuggestionEdit;
  /** "See it in the transcript · 2:14" (item 8b-2, spec 5.5): the cited turn on the call page, or the call
   *  page itself for a copied row; null when there is nowhere to go. */
  transcript: { href: string; label: string } | null;
  labels: SuggestionLabels;
};

export type SuggestionViewCtx = {
  tr: Tr; zone: string; now: Date; stages: DescribeCtx["stages"];
  pipelineStages: ReadonlyArray<{ id: string; name: string; position: number; pipelineId: string }>;
  callerName: string | null; callStartedAt: string | null; personaName: string;
  names: Readonly<Record<string, string>>;
  viewerId: string | null;
  /** On the call page itself the link is the turn's own anchor, and a copied row has no link. */
  onCallPage?: boolean;
};

const FIELD_LABEL: Record<"firstName" | "lastName" | "email" | "phone", MessageKey> = {
  firstName: "suggestions.field.firstName", lastName: "suggestions.field.lastName",
  email: "suggestions.field.email", phone: "suggestions.field.phone",
};
const STATUS_WORD: Record<ProposalStatus, MessageKey> = {
  pending: "suggestions.status.pending", accepted: "suggestions.status.accepted", edited: "suggestions.status.edited",
  dismissed: "suggestions.status.dismissed", expired: "suggestions.status.expired",
};
const REASON: Record<ExpiredReason, MessageKey> = {
  field_filled: "suggestions.reason.field_filled", name_mismatch: "suggestions.reason.name_mismatch",
  deal_moved: "suggestions.reason.deal_moved", deal_closed: "suggestions.reason.deal_closed",
  deal_gone: "suggestions.reason.deal_gone", aged: "suggestions.reason.aged", superseded: "suggestions.reason.superseded",
};
const DECIDED: Record<"accepted" | "edited" | "dismissed" | "expired", MessageKey> = {
  accepted: "suggestions.decided.accepted", edited: "suggestions.decided.edited",
  dismissed: "suggestions.decided.dismissed", expired: "suggestions.decided.expired",
};

/** The reader's own decision reads as its own sentence ("Accepted by you"), never "by You" mid-sentence. */
const DECIDED_BY_YOU: Record<"accepted" | "edited" | "dismissed", MessageKey> = {
  accepted: "suggestions.decided.acceptedByYou", edited: "suggestions.decided.editedByYou",
  dismissed: "suggestions.decided.dismissedByYou",
};

/**
 * "9:42 AM" for a decision made today in the account's zone; "Oct 14, 9:42 AM" before today; with the year
 * when it is not this year (the orchestrator's ruling on spec 4.5; the 8a label's rule, aiSummaryStamp).
 */
function decidedStamp(at: Date, zone: string, now: Date, locale: "en" | "es"): string {
  // The account's own calendar day ("2026-10-14"), never UTC's: local-day.ts's one formatter.
  const day = localDateKey(at, zone);
  const today = localDateKey(now, zone);
  const opts: Intl.DateTimeFormatOptions = day === today
    ? { timeZone: zone, hour: "numeric", minute: "2-digit" }
    : { timeZone: zone, ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" as const }),
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(tag(locale), opts).format(at);
}

/** The registry's sentence for one row: the card's, and the agency Work page's read-only row's (8b-1). */
export function describeRow(row: Proposal, ctx: DescribeCtx): Description {
  switch (row.kind) {
    case "task": return KINDS.task.describe(row.payload, ctx);
    case "contact_field": return KINDS.contact_field.describe(row.payload, ctx);
    case "opportunity_stage": return KINDS.opportunity_stage.describe(row.payload, ctx);
  }
}

function editOf(row: Proposal, ctx: SuggestionViewCtx): SuggestionEdit {
  switch (row.kind) {
    case "task":
      return { kind: "task", title: row.payload.title,
        dueDate: row.payload.dueAt ? localDateKey(new Date(row.payload.dueAt), ctx.zone) : "" };
    case "contact_field":
      return { kind: "contact_field", label: ctx.tr.text(FIELD_LABEL[row.payload.field]), value: row.payload.value };
    case "opportunity_stage": {
      // validateEdit's rule (P7), as choices: the deal's own pipeline, forward only, never the last stage.
      const from = ctx.pipelineStages.find((s) => s.id === row.payload.fromStageId);
      const own = from ? ctx.pipelineStages.filter((s) => s.pipelineId === from.pipelineId) : [];
      const last = Math.max(...own.map((s) => s.position));
      const options = own
        .filter((s) => from && s.position > from.position && s.position < last)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ id: s.id, name: s.name }));
      return { kind: "opportunity_stage", options, toStageId: row.payload.toStageId };
    }
  }
}

/** "Wed, Oct 14": a call's day in the account's zone; the card's source label's and a tray group's (group.ts). */
export function callDay(locale: "en" | "es", zone: string, at: string): string {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: zone, weekday: "short", month: "short", day: "numeric" })
    .format(new Date(at));
}

/** "2:14", minutes and seconds since the call began; null when either instant is missing or the turn is before it. */
function sinceStart(at: string | null, startedAt: string | null): string | null {
  if (!at || !startedAt) return null;
  const ms = Date.parse(at) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.floor(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/**
 * The transcript link (spec 5.5; plan ambiguities 3 and 4). `evidenceRef.turn` is the RAW index into the
 * call's stored transcript (`groundedTurn`'s `findLastIndex`, stored unchanged by `finishCallRow`), so the
 * transcript's anchor carries the raw index too, never a filtered position. A copied row (`{}`: no turn)
 * links to the call page, and on the call page has no link at all.
 */
function transcriptLink(row: Proposal, ctx: SuggestionViewCtx): SuggestionView["transcript"] {
  if (!row.callId) return null;
  const ref = row.evidenceRef as { turn?: unknown; at?: unknown };
  const turn = typeof ref.turn === "number" && Number.isInteger(ref.turn) && ref.turn >= 0 ? ref.turn : null;
  const page = `/dashboard/accounts/${row.accountId}/calls/${row.callId}`;
  if (turn === null) return ctx.onCallPage ? null : { href: page, label: ctx.tr.text("suggestions.transcript.noTime") };
  const time = sinceStart(typeof ref.at === "string" ? ref.at : null, ctx.callStartedAt);
  return {
    href: ctx.onCallPage ? `#turn-${turn}` : `${page}#turn-${turn}`,
    label: time ? ctx.tr.text("suggestions.transcript", { time }) : ctx.tr.text("suggestions.transcript.noTime"),
  };
}

export function buildSuggestionView(row: Proposal, ctx: SuggestionViewCtx): SuggestionView {
  const { tr, zone, now } = ctx;
  const locale = tr.locale;

  const day = callDay(locale, zone, ctx.callStartedAt ?? row.createdAt);
  const caller = ctx.callerName?.trim();
  const sourceLabel = caller
    ? tr.text("suggestions.source.call", { date: day, caller })
    : tr.text("suggestions.source.callNoName", { date: day });

  const { parts, detail } = describeRow(row, { tr, zone, stages: ctx.stages, now });

  const eff = effectiveStatus(row, now);
  const status = eff.status;
  const reason = status === "expired" ? (eff.reason ?? row.expiredReason) : null;
  const field = row.kind === "contact_field" ? tr.text(FIELD_LABEL[row.payload.field]).toLocaleLowerCase(locale) : "";
  const reasonLine = reason ? tr.text(REASON[reason], { field }) : null;

  let decidedLine: string | null = null;
  if (status !== "pending" && row.decidedAt && row.decidedBy) {
    const time = decidedStamp(new Date(row.decidedAt), zone, now, locale);
    const by = row.decidedBy;
    if (status === "expired") {
      decidedLine = tr.text(DECIDED.expired, { time });
    } else if (ctx.viewerId && by === ctx.viewerId) {
      decidedLine = tr.text(DECIDED_BY_YOU[status], { time });
    } else {
      // Mid-sentence, so lowercase ("Discarded by someone on the team"), never assign.someone's capital.
      const name = (Object.hasOwn(ctx.names, by) ? ctx.names[by] : undefined) || tr.text("suggestions.decided.someone");
      decidedLine = tr.text(DECIDED[status], { name, time });
    }
  }

  return {
    id: row.id,
    lang: locale,
    sourceLabel,
    parts,
    detail,
    evidence: row.evidence,
    evidenceLang: row.evidenceLang ?? "en",
    personaMark: tr.text("provenance.ai", { name: ctx.personaName.trim() || "Sofía" }),
    status,
    statusWord: tr.text(STATUS_WORD[status]),
    reasonLine,
    decidedLine,
    canAct: status === "pending",
    edit: editOf(row, ctx),
    transcript: transcriptLink(row, ctx),
    labels: {
      accept: tr.text("suggestions.accept"),
      editAccept: tr.text("suggestions.editAccept"),
      discard: tr.text("suggestions.discard"),
      saveAccept: tr.text("suggestions.saveAccept"),
      cancel: tr.text("suggestions.cancel"),
      undo: tr.text("common.undo"),
      title: tr.text("suggestions.edit.title"),
      due: tr.text("suggestions.edit.due"),
      stage: tr.text("suggestions.edit.stage"),
      crashed: tr.text("suggestions.answer.unreachable"),
      reload: tr.text("suggestions.reload"),
      because: tr.text("suggestions.evidence"),
      lang: locale,
    },
  };
}
