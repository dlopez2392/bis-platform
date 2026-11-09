// apps/web/src/lib/owner-line/tools/read.ts
// The three reads (spec §5), each through the APP's own readers with the client the factory made, so the role filter
// is RLS's (token) or the account scope (F2), never re-implemented here (plan SC-2). Counts are computed here.
// calls_and_messages counts what the dashboard's "Calls answered" tile counts, with the tile's own reads (Q-E).
import {
  listCalls, listCallReasons, listAgendaBookings, listAccountWork, ANSWERED_CALL_OUTCOMES,
  type SupabaseClient, type CallListRow,
} from "@bis/db";
import { listAnsweredCallStartsBetween, listSpamCallStartsBetween } from "@/lib/reports/weekly-metrics";
import { agencyHandsets } from "@/lib/voice/caller-reputation";
import { workRowLabel } from "@/lib/work/row-label";
import { makeTr, type Tr } from "@/lib/record/copy";
// The agenda's own words for how a job meets and where it stands (review m-5): one source, never a second map.
import { meetingWord, statusWord } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/agenda-view";
import { resolveRange } from "../range";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

export type OwnerReadContext = { db: SupabaseClient; accountId: string; timezone: string; locale: Locale; now: Date };
export const CALLS_SPOKEN = 20;
export const APPOINTMENTS_SPOKEN = 25;
export const TODO_SPOKEN = 15;
const CALL_PAGE = 100;
const CALL_PAGES = 10;

function when(iso: string, c: OwnerReadContext, withDay: boolean): string {
  return new Intl.DateTimeFormat(c.locale === "es" ? "es-US" : "en-US", {
    timeZone: c.timezone, hour: "numeric", minute: "2-digit",
    ...(withDay ? { weekday: "long", month: "long", day: "numeric" } : {}),
  }).format(new Date(iso)).replace(/\u202f/g, " ");
}
const nameOf = (k: { first_name: string | null; last_name: string | null } | null) =>
  [k?.first_name, k?.last_name].filter((x): x is string => !!x && x.trim() !== "").join(" ") || null;

/** Keyed on the tile's own outcome list (review m-4): an outcome added to ANSWERED_CALL_OUTCOMES has no words here
 *  until someone writes them, and the typecheck says so. */
type AnsweredOutcome = (typeof ANSWERED_CALL_OUTCOMES)[number];
const OUTCOME_WORDS: Record<AnsweredOutcome, keyof typeof m> = {
  booked: "ownerLine.tool.outcome.booked", lead: "ownerLine.tool.outcome.lead",
  message: "ownerLine.tool.outcome.message", transferred: "ownerLine.tool.outcome.transferred",
};

/** The calls the "Calls answered" tile counts, decided by the tile's own two constants, never a copy of them. */
type TileCall = CallListRow & { outcome: AnsweredOutcome };
function tileCall(x: CallListRow, handsets: readonly string[]): x is TileCall {
  return x.owner_line_user_id === null && (ANSWERED_CALL_OUTCOMES as readonly string[]).includes(x.outcome)
    && !(x.caller_e164 !== null && handsets.includes(x.caller_e164));
}

export async function callsAndMessages(c: OwnerReadContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = resolveRange(args, c.timezone, c.now);
  if (!r.ok) return { ok: false, error: r.error };
  const [answered, spam] = await Promise.all([
    listAnsweredCallStartsBetween(c.db, c.accountId, r.fromIso, r.toIso),
    listSpamCallStartsBetween(c.db, c.accountId, r.fromIso, r.toIso),
  ]);
  const handsets = agencyHandsets();
  // The calls to DESCRIBE, newest first: read until CALLS_SPOKEN are held (review m-2), never more than CALL_PAGES
  // pages. Instants are compared, never strings (review m-6): PostgREST writes "…T06:00:00+00:00" and the range's
  // edge is "…T06:00:00.000Z", and as strings a call on the range's first instant sorted before it.
  // No "truncated" here (m-2): the count is the tile's, which pages to the end and is never capped; a flag that the
  // DESCRIBED list stopped early is already said by "more". listCalls' "before" is strict, so a page whose last row
  // is on or before the range's first instant is the last one that can hold a call in range.
  const fromMs = Date.parse(r.fromIso);
  const rows: TileCall[] = [];
  let before = r.toIso;
  for (let page = 0; page < CALL_PAGES && rows.length < CALLS_SPOKEN; page++) {
    const batch = await listCalls(c.db, c.accountId, { limit: CALL_PAGE, before });
    rows.push(...batch.filter((x): x is TileCall => Date.parse(x.started_at) >= fromMs && tileCall(x, handsets)));
    const last = batch[batch.length - 1];
    if (batch.length < CALL_PAGE || !last || Date.parse(last.started_at) <= fromMs) break;
    before = last.started_at;
  }
  const spoken = rows.slice(0, CALLS_SPOKEN);
  const [reasons, work] = await Promise.all([
    listCallReasons(c.db, c.accountId, spoken.map((x) => x.id)), listAccountWork(c.db, c.accountId),
  ]);
  const open = new Set(work.map((w) => w.callId).filter((x): x is string => typeof x === "string"));
  return {
    ok: true, range: { first: r.firstDay, last: r.lastDay },
    count: answered.length, spam: spam.length,
    more: Math.max(0, answered.length - spoken.length),
    calls: spoken.map((x) => ({
      when: when(x.started_at, c, r.multiDay),
      caller: nameOf(x.contact) ?? t(m, "ownerLine.tool.newCaller", c.locale),
      outcome: t(m, OUTCOME_WORDS[x.outcome], c.locale),
      reason: reasons.get(x.id) ?? null,
      needsCallback: open.has(x.id),
    })),
  };
}

export async function appointments(c: OwnerReadContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = resolveRange(args, c.timezone, c.now);
  if (!r.ok) return { ok: false, error: r.error };
  const { rows, truncated } = await listAgendaBookings(c.db, c.accountId, r.fromIso, r.toIso);
  const shown = rows.filter((x) => !(x.status === "cancelled" && x.replaced));
  const tr: Tr = makeTr(c.locale);
  return {
    ok: true, range: { first: r.firstDay, last: r.lastDay }, count: shown.length, truncated,
    more: Math.max(0, shown.length - APPOINTMENTS_SPOKEN),
    appointments: shown.slice(0, APPOINTMENTS_SPOKEN).map((x) => ({
      when: when(x.starts_at, c, r.multiDay), customer: nameOf(x.contact),
      meetingType: x.meeting_type ? meetingWord(tr, x.meeting_type) : null, status: statusWord(tr, x.status),
    })),
  };
}

export async function needsAttention(c: OwnerReadContext): Promise<Record<string, unknown>> {
  const rows = await listAccountWork(c.db, c.accountId);
  const shown = rows.slice(0, TODO_SPOKEN);
  // Names through the SAME client (so RLS, or the account scope, bounds them too): tasks/page.tsx:183-195's shape.
  const ids = [...new Set(shown.map((w) => w.contactId).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await c.db.from("contacts").select("id, first_name, last_name").eq("account_id", c.accountId).in("id", ids);
    if (error) throw new Error(`needs_attention names failed: ${error.message}`);
    for (const k of (data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
      const n = nameOf(k);
      if (n) names.set(k.id, n);
    }
  }
  const tr = makeTr(c.locale);
  return {
    ok: true, count: rows.length, more: Math.max(0, rows.length - TODO_SPOKEN),
    items: shown.map((w) => {
      const customer = w.contactId ? names.get(w.contactId) ?? null : null;
      return {
        what: workRowLabel(w, customer ?? t(m, "ownerLine.tool.aCustomer", c.locale), tr),
        customer, due: w.dueAt ? when(w.dueAt, c, true) : null,
      };
    }),
  };
}
