import type { TimelineEntry } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import type { AssignMember } from "@/lib/assign/view";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr } from "@/lib/record/copy";
import { timelineRows } from "@/lib/record/timeline-rows";
import type { ActivityTimelineProps } from "./activity-timeline";

/**
 * TESTS ONLY. The nine activity-timeline.*.test.ts files were written against 1a's props (one array
 * per source). This turns those props into 1b's (merged entries → rows), so each file keeps pinning
 * the same behaviour (hold hint, due date zone, failure reason, status words…) with a one-call change.
 */
type Row = Record<string, unknown> & { id: string; created_at: string };
const list = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);

export function entriesOf(p: Record<string, unknown>): TimelineEntry[] {
  const out = [
    ...list(p.notes).map((n) => ({ kind: "note", id: n.id, at: n.created_at, note: { author_id: null, ...n } })),
    ...list(p.tasks).map((t) => ({ kind: "task", id: t.id, at: t.created_at, task: {
      due_at: null, completed_at: null, consent_event_id: null, call_id: null, assigned_to: null, created_by: null, ...t } })),
    ...list(p.opportunities).map((o) => ({ kind: "deal", id: o.id, at: o.created_at, deal: { created_by: null, ...o } })),
    ...list(p.submissions).map((s) => ({ kind: "submission", id: s.id, at: s.created_at, submission: {
      formName: "", answers: [], author_kind: "customer", ...s } })),
    // author_kind defaults to "customer", a real kind — messages.author_kind has been NOT NULL
    // since 0074, so null is a shape no real row can carry any more (minors-1b item 4 review fix).
    ...list(p.messages).map((m) => ({ kind: "message", id: m.id, at: m.created_at, message: {
      channel: "email", subject: null, error: null, author_kind: "customer", author_id: null, ...m } })),
  ] as unknown as TimelineEntry[];
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function legacyTimeline(p: Record<string, unknown>): ActivityTimelineProps {
  const timezone = (p.timezone as string | undefined) ?? "UTC";
  const tr = makeTr((p.locale as Locale | undefined) ?? "en");
  const rows = timelineRows(entriesOf(p), { zone: timezone, tr, author: { viewerId: null, names: {}, personaName: null, tr } });
  return {
    accountId: p.accountId as string, contactId: p.contactId as string,
    contactHasEmail: Boolean(p.contactHasEmail), contactHasPhone: Boolean(p.contactHasPhone),
    smsGate: (p.smsGate ?? null) as SmsGate | null,
    smsBlockedLine: (p.smsBlockedLine ?? null) as string | null, emailNoticeLine: (p.emailNoticeLine ?? null) as string | null,
    emailAction: p.emailAction as ActivityTimelineProps["emailAction"], smsAction: p.smsAction as ActivityTimelineProps["smsAction"],
    timezone, canAssign: Boolean(p.canAssign), members: (p.members ?? []) as AssignMember[],
    rows, holdOpenTaskIds: (p.holdOpenTaskIds ?? []) as string[],
    failedText: null, emptyText: rows.length === 0 ? tr.text("timeline.empty") : null,
    pager: { olderHref: null, newerHref: null }, tr, customerLang: "",
    // F-006 part 1 (plan Task 11): defaults to true so the nine pre-existing *.test.ts files (which
    // never pass it) keep seeing whatever a merge row already shows; the merge test file is the one
    // that exercises false.
    canMerge: p.canMerge === undefined ? true : Boolean(p.canMerge),
    // Fix round, carry-in 9 + finding #1: the page's own contact name, for the merge row's "Undo
    // merge" toast. Defaulted so the nine pre-existing *.test.ts files (which never pass it) keep
    // working; the merge test file is the one that exercises a real value.
    contactName: (p.contactName as string | undefined) ?? "Kept Person",
    nowMs: typeof p.nowMs === "number" ? p.nowMs : Date.now(),
  };
}
