import { consentAppendSql } from "../consent";

/**
 * Consent chain PR-2's Telnyx backfill (spec §4.2, plan Task 3): Telnyx's
 * own opt-out list (`GET /v2/messaging_optouts`, VERIFIED, plan F6) becomes
 * `revoked` / `backfill_telnyx` rows in the ledger, so BIS already blocks a
 * number Telnyx blocks before the first send finds out through a 40300.
 *
 * Pure: the orchestrator fetches the pages and reads the owners (the app
 * never calls Telnyx for this), and the SQL this emits is pasted by hand
 * after danlo has seen the count.
 */
export type OptoutRow = {
  from: string; to: string; messaging_profile_id: string | null; keyword: string | null; created_at: string;
};
export type Owner = { e164: string; account_id: string; status: string };
export type PlannedRevoke = {
  accountId: string; address: string; from: string; keyword: string | null; profileId: string | null; occurredAt: string;
};
export type TelnyxBackfillPlan = {
  toAppend: PlannedRevoke[];
  perAccount: Record<string, number>;
  /** Business numbers with opt-outs but no row in phone_numbers: reported, never written. */
  unmatched: { from: string; rows: number }[];
  /** Opt-outs whose `to` is one of OUR numbers: expected 0; more means the orientation was misread. */
  toMatchesOwners: number;
};

const E164 = /^[+][1-9][0-9]{7,14}$/;

function asRow(v: unknown, i: number): OptoutRow {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== "object") throw new Error(`opt-out ${i}: not an object`);
  for (const k of ["from", "to"] as const) {
    const n = r[k];
    if (typeof n !== "string") throw new Error(`opt-out ${i}: ${k} is missing`);
    if (n.includes("*")) throw new Error(`opt-out ${i}: ${k} is redacted — fetch with redaction_enabled=false`);
    if (!E164.test(n)) throw new Error(`opt-out ${i}: ${k} is not E.164`);
  }
  if (typeof r.created_at !== "string" || !Number.isFinite(Date.parse(String(r.created_at).replace(" ", "T")))) {
    throw new Error(`opt-out ${i}: created_at does not parse`);
  }
  return {
    from: r.from as string, to: r.to as string,
    messaging_profile_id: typeof r.messaging_profile_id === "string" ? r.messaging_profile_id : null,
    keyword: typeof r.keyword === "string" ? r.keyword : null,
    created_at: r.created_at as string,
  };
}

/** Pages as Telnyx returns them (`{ data: [...] }` each), or a flat array of rows. THROWS on anything else. */
export function parseOptouts(json: unknown): OptoutRow[] {
  if (!Array.isArray(json)) throw new Error("opt-outs: expected an array of pages or rows");
  const rows = json.flatMap((item: unknown) =>
    item && typeof item === "object" && Array.isArray((item as { data?: unknown }).data) ? (item as { data: unknown[] }).data : [item]);
  return rows.map(asRow);
}

/** Telnyx prints `2025-04-28 12:00:38.631252+00:00`; the ledger wants an ISO instant. */
function isoOf(created: string): string {
  return new Date(Date.parse(created.replace(" ", "T"))).toISOString();
}

export function planTelnyxBackfill(rows: readonly OptoutRow[], owners: readonly Owner[]): TelnyxBackfillPlan {
  const byNumber = new Map(owners.map((o) => [o.e164, o]));
  const seen = new Set<string>();
  const toAppend: PlannedRevoke[] = [];
  const perAccount: Record<string, number> = {};
  const unmatched = new Map<string, number>();
  let toMatchesOwners = 0;
  for (const r of rows) {
    if (byNumber.has(r.to)) toMatchesOwners++;
    const owner = byNumber.get(r.from);
    if (!owner) { unmatched.set(r.from, (unmatched.get(r.from) ?? 0) + 1); continue; }
    const key = `${owner.account_id}|${r.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    toAppend.push({ accountId: owner.account_id, address: r.to, from: r.from, keyword: r.keyword, profileId: r.messaging_profile_id, occurredAt: isoOf(r.created_at) });
    perAccount[owner.account_id] = (perAccount[owner.account_id] ?? 0) + 1;
  }
  return { toAppend, perAccount, unmatched: [...unmatched].map(([from, n]) => ({ from, rows: n })), toMatchesOwners };
}

/**
 * One guarded call per row: `revoked`, `backfill_telnyx`,
 * `unless_customer_stopped` (a staff stop does not refuse it; the customer's
 * own does), at the opt-out's own time, with a source naming that ONE
 * opt-out event — `telnyx_optout:<from>:<to>:<its time>` — so a re-run
 * appends nothing (0055's one row per source) while a later, second opt-out
 * of the same number would still be its own row (review R1-I3: a source is
 * an event, never a reusable channel).
 *
 * ONE statement, answering `outcome, n` per outcome (review R1-M3):
 * execute_sql shows only the last statement's result, so a file of one
 * statement per row would report only its last row. The statement carries
 * customer numbers: the file is never committed and is deleted after use.
 *
 * Refuses the WHOLE run, naming the row, if any planned occurred_at is in
 * the future relative to the machine building this string (dispatch task-3,
 * item 8 — read against 0055 as it stands after Task 1's review, not the
 * plan text): `append_consent_event` RAISES (errcode 22023) on a future
 * p_occurred_at rather than answering `refused`, and because this is
 * deliberately ONE statement, that RAISE aborts every row's write, not just
 * the bad one — a single clock-skewed opt-out would otherwise silently
 * cost the whole account's backfill. Telnyx's opt-outs are historical, so
 * this should never fire in practice; if it does, the row must be fixed or
 * dropped from the input before re-running, not clamped to "now" (a
 * clamped time is exactly the kind of invented ordering 0055's own comments
 * warn against — it could make a backfilled stop outrank a real START that
 * lands a moment later).
 */
export function telnyxBackfillSql(plan: TelnyxBackfillPlan): string {
  if (plan.toAppend.length === 0) throw new Error("telnyxBackfillSql: nothing to write");
  const now = Date.now();
  for (const r of plan.toAppend) {
    if (Date.parse(r.occurredAt) > now) {
      throw new Error(
        `telnyxBackfillSql: refusing the whole run — opt-out ${r.from} -> ${r.address} has occurred_at ${r.occurredAt}, ` +
        `which is in the future (now ${new Date(now).toISOString()}); append_consent_event RAISES on a future ` +
        "occurred_at and would abort every row in this one statement, not just this one. Fix or drop this row first.",
      );
    }
  }
  const calls = plan.toAppend.map((r) => consentAppendSql({
    accountId: r.accountId, channel: "sms", address: r.address, action: "revoked", method: "backfill_telnyx",
    sourceRef: `telnyx_optout:${r.from}:${r.address}:${r.occurredAt}`, occurredAt: r.occurredAt,
    evidence: { keyword: r.keyword, messaging_profile_id: r.profileId, from: r.from },
  }, "unless_customer_stopped").replace(/;$/, ""));
  return [
    "-- Telnyx opt-out backfill (plan Task 3). HOLDS CUSTOMER NUMBERS: never commit it, and delete it after running.",
    "select outcome, count(*)::int as n from (",
    calls.join("\nunion all\n"),
    ") t group by outcome order by outcome;",
  ].join("\n") + "\n";
}
