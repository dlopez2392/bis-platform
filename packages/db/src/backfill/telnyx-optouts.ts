import { consentAppendSql } from "../consent";

/**
 * Consent chain PR-2's Telnyx backfill (spec §4.2, plan Task 3): Telnyx's
 * own opt-out list (`GET /v2/messaging_optouts`, VERIFIED, plan F6) becomes
 * `revoked` / `backfill_telnyx` rows in the ledger, so BIS already blocks a
 * number Telnyx blocks before the first send finds out through a 40300.
 *
 * Pure: the orchestrator fetches the pages and reads the owners (the app
 * never calls Telnyx for this), and the SQL this emits is pasted by hand
 * after danlo has seen the count. This module never prints or throws a
 * customer number (a `to` address); every error names a row, if at all, by
 * its input position and the BUSINESS's own number (`from`) only.
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
  /** perAccount's rows whose owner's phone_numbers.status is 'released' (orchestrator decision I3:
   *  a released number's opt-outs are still written — the customer told THAT business to stop, and
   *  that fact does not un-happen when the business later releases the number). */
  releasedPerAccount: Record<string, number>;
  /** Business numbers with opt-outs but no row in phone_numbers: reported, never written. */
  unmatched: { from: string; rows: number }[];
  /** Opt-outs whose `to` is one of OUR numbers: expected 0; more means the orientation was misread. */
  toMatchesOwners: number;
  /** toAppend rows whose occurred_at is after `now` (the `now` planTelnyxBackfill was given).
   *  Computed here, in count-only mode too, not only when SQL is about to be emitted (review M2). */
  futureDated: PlannedRevoke[];
};

const E164 = /^[+][1-9][0-9]{7,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Telnyx's own export always carries one (`+00:00`); a bare local-looking timestamp is refused
 *  rather than silently parsed as this machine's zone (review M3). */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
/** review M1: execute_sql pastes one statement; past this many rows it is split into numbered
 *  part files instead, each its own complete, independently-idempotent statement. */
export const MAX_ROWS_PER_STATEMENT = 1000;

function asRow(v: unknown, i: number): OptoutRow {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== "object") throw new Error(`opt-out ${i}: not an object`);
  for (const k of ["from", "to"] as const) {
    const n = r[k];
    if (typeof n !== "string") throw new Error(`opt-out ${i}: ${k} is missing`);
    if (n.includes("*")) throw new Error(`opt-out ${i}: ${k} is redacted — fetch with redaction_enabled=false`);
    if (!E164.test(n)) throw new Error(`opt-out ${i}: ${k} is not E.164`);
  }
  const created = r.created_at;
  if (typeof created !== "string" || !Number.isFinite(Date.parse(created.replace(" ", "T")))) {
    throw new Error(`opt-out ${i}: created_at does not parse`);
  }
  if (!HAS_OFFSET.test(created.trim())) {
    throw new Error(`opt-out ${i}: created_at must carry an explicit UTC offset (Z or ±hh:mm) — Telnyx's own export always has one; a bare local-looking timestamp is refused rather than guessed`);
  }
  return {
    from: r.from as string, to: r.to as string,
    messaging_profile_id: typeof r.messaging_profile_id === "string" ? r.messaging_profile_id : null,
    keyword: typeof r.keyword === "string" ? r.keyword : null,
    created_at: created,
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

/** Never a full number in an error or a log line (review I2): only the last four digits survive. */
export function maskLast4(e164: string): string {
  return e164.length <= 4 ? e164 : "*".repeat(e164.length - 4) + e164.slice(-4);
}

function assertValidOwners(owners: readonly Owner[]): void {
  owners.forEach((o, i) => {
    if (typeof o.account_id !== "string" || !UUID.test(o.account_id)) {
      throw new Error(`owners: entry ${i} has an invalid account_id (expected a uuid)`);
    }
    if (typeof o.e164 !== "string" || !E164.test(o.e164)) {
      throw new Error(`owners: entry ${i} has an invalid e164 (expected E.164)`);
    }
  });
}

/**
 * `now` is a parameter, not `Date.now()` read inside this pure module (review M6): a caller (a
 * test, or the CLI once per run) supplies the instant everything is judged against, so this
 * function's own output depends only on its arguments.
 */
export function planTelnyxBackfill(
  rows: readonly OptoutRow[], owners: readonly Owner[], now: Date = new Date(),
): TelnyxBackfillPlan {
  assertValidOwners(owners);
  const byNumber = new Map(owners.map((o) => [o.e164, o]));
  const indexByKey = new Map<string, number>();
  const toAppend: PlannedRevoke[] = [];
  const perAccount: Record<string, number> = {};
  const releasedPerAccount: Record<string, number> = {};
  const unmatched = new Map<string, number>();
  let toMatchesOwners = 0;
  const nowMs = now.getTime();
  for (const r of rows) {
    if (byNumber.has(r.to)) toMatchesOwners++;
    const owner = byNumber.get(r.from);
    if (!owner) { unmatched.set(r.from, (unmatched.get(r.from) ?? 0) + 1); continue; }
    const key = `${owner.account_id}|${r.to}`;
    const occurredAt = isoOf(r.created_at);
    const existingIdx = indexByKey.get(key);
    if (existingIdx !== undefined) {
      // review M4: keep the EARLIEST created_at deterministically, never "whichever the input
      // happened to list first" — Telnyx's paging order is not guaranteed (plan F6/F10).
      if (Date.parse(occurredAt) < Date.parse(toAppend[existingIdx]!.occurredAt)) {
        toAppend[existingIdx] = { accountId: owner.account_id, address: r.to, from: r.from, keyword: r.keyword, profileId: r.messaging_profile_id, occurredAt };
      }
      continue;
    }
    indexByKey.set(key, toAppend.length);
    toAppend.push({ accountId: owner.account_id, address: r.to, from: r.from, keyword: r.keyword, profileId: r.messaging_profile_id, occurredAt });
    perAccount[owner.account_id] = (perAccount[owner.account_id] ?? 0) + 1;
    if (owner.status === "released") releasedPerAccount[owner.account_id] = (releasedPerAccount[owner.account_id] ?? 0) + 1;
  }
  // review M2: computed here, in count-only mode too — not only at the moment SQL is emitted.
  const futureDated = toAppend.filter((r) => Date.parse(r.occurredAt) > nowMs);
  return {
    toAppend, perAccount, releasedPerAccount,
    unmatched: [...unmatched].map(([from, n]) => ({ from, rows: n })),
    toMatchesOwners, futureDated,
  };
}

function buildOneStatement(rows: readonly PlannedRevoke[]): string {
  const calls = rows.map((r) => consentAppendSql({
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

/**
 * Refuses to emit when the plan cannot be safely pasted: an empty plan, any opt-out whose
 * customer number matches one of OUR OWN numbers (review I2 — a reversed from/to reading, so no
 * number is printed, only the count), or any row with a future occurred_at (review I1/M2).
 *
 * `append_consent_event` (0055) does NOT fail silently on a future occurred_at — it RAISES
 * (errcode 22023), loudly and atomically, aborting every row inside the same one-statement write,
 * not just the bad one (review M6: the earlier doc comment here said "silently"; that was wrong —
 * the raise itself is loud). This guard's value is catching that BEFORE the statement is ever
 * pasted into production's execute_sql, not after: refuse here, on this machine, rather than lose
 * a whole account's backfill to one bad row live.
 */
function assertEmittable(plan: TelnyxBackfillPlan): void {
  if (plan.toAppend.length === 0) throw new Error("telnyxBackfillSql: nothing to write");
  if (plan.toMatchesOwners > 0) {
    throw new Error(
      `telnyxBackfillSql: refusing to emit — ${plan.toMatchesOwners} opt-out(s) have a customer number ` +
      "that matches one of our OWN numbers, which reads as a reversed from/to; fix the input before emitting SQL",
    );
  }
  if (plan.futureDated.length > 0) {
    const first = plan.futureDated[0]!;
    const pos = plan.toAppend.indexOf(first) + 1;
    throw new Error(
      `telnyxBackfillSql: refusing the whole run — ${plan.futureDated.length} row(s) have an occurred_at in ` +
      `the future (e.g. row #${pos}, business number ${first.from}, occurred_at ${first.occurredAt}); ` +
      "append_consent_event RAISES loudly and atomically on a future occurred_at, aborting every row in the " +
      "same statement. Fix or drop the row(s) first — never clamp to \"now\", which would invent an ordering " +
      "the ledger never observed.",
    );
  }
}

/**
 * One guarded call per row: `revoked`, `backfill_telnyx`, `unless_customer_stopped` (a staff stop
 * does not refuse it; the customer's own does), at the opt-out's own time, with a source naming
 * that ONE opt-out event — `telnyx_optout:<from>:<to>:<its time>` — so a re-run appends nothing
 * (0055's one row per source) while a later, second opt-out of the same number would still be its
 * own row (review R1-I3: a source is an event, never a reusable channel).
 *
 * ONE statement, answering `outcome, n` per outcome (review R1-M3): execute_sql shows only the
 * last statement's result, so a file of one statement per row would report only its last row.
 * Refuses above `MAX_ROWS_PER_STATEMENT` rows (review M1) — use `telnyxBackfillSqlParts` instead.
 * The statement carries customer numbers: the file is never committed and is deleted after use.
 */
export function telnyxBackfillSql(plan: TelnyxBackfillPlan): string {
  assertEmittable(plan);
  if (plan.toAppend.length > MAX_ROWS_PER_STATEMENT) {
    throw new Error(
      `telnyxBackfillSql: ${plan.toAppend.length} rows exceeds the ${MAX_ROWS_PER_STATEMENT.toLocaleString()}-row ` +
      "limit for one statement — use telnyxBackfillSqlParts to split into numbered part files",
    );
  }
  return buildOneStatement(plan.toAppend);
}

/**
 * The split `telnyxBackfillSql` refuses above `MAX_ROWS_PER_STATEMENT` rows (review M1): numbered
 * parts of at most `maxRows` rows each, every part its OWN complete, independently-idempotent
 * statement (each row's source_ref is deterministic regardless of which part or which run wrote
 * it, so running any subset of parts, in any order, more than once, converges to one row per
 * opt-out — 0055's own one-row-per-source guarantee, not something this function adds).
 */
export function telnyxBackfillSqlParts(plan: TelnyxBackfillPlan, maxRows: number = MAX_ROWS_PER_STATEMENT): string[] {
  assertEmittable(plan);
  const parts: string[] = [];
  for (let i = 0; i < plan.toAppend.length; i += maxRows) parts.push(buildOneStatement(plan.toAppend.slice(i, i + maxRows)));
  return parts;
}
