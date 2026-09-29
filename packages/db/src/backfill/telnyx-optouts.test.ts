import { describe, it, expect } from "vitest";
import { parseOptouts, planTelnyxBackfill, telnyxBackfillSql, type OptoutRow } from "./telnyx-optouts";

const OWNERS = [
  { e164: "+19565550000", account_id: "11111111-1111-4111-8111-111111111111", status: "live" },
  { e164: "+19565550001", account_id: "22222222-2222-4222-8222-222222222222", status: "testing" },
];
const row = (o: Partial<OptoutRow> = {}): OptoutRow => ({
  from: "+19565550000", to: "+19565551234", messaging_profile_id: "prof-1", keyword: "STOP",
  created_at: "2025-04-28 12:00:38.631252+00:00", ...o,
});

describe("parseOptouts — what the orchestrator saved from Telnyx", () => {
  it("accepts an array of pages (each { data: [...] }) or a flat array of rows (mutation: accept only pages → the flat array throws, FAILS)", () => {
    const one = row();
    expect(parseOptouts([{ data: [one], meta: { total_pages: 1 } }])).toEqual([one]);
    expect(parseOptouts([one])).toEqual([one]);
  });

  it("refuses a redacted number, a non-E.164 number, an unparseable time, or a non-array, so a bad copy writes nothing (mutation: skip the redaction check → FAILS)", () => {
    expect(() => parseOptouts([row({ to: "+44776****" })])).toThrow(/redacted/);
    expect(() => parseOptouts([row({ from: "BISRGV" })])).toThrow(/E\.164/);
    expect(() => parseOptouts([row({ created_at: "yesterday" })])).toThrow(/created_at/);
    expect(() => parseOptouts({ data: [] })).toThrow(/array/);
  });
});

describe("planTelnyxBackfill — which account each opt-out belongs to", () => {
  it("maps by the BUSINESS's number (`from`, plan F10), counts per account, and reports unmatched numbers without a customer number (mutation: map by `to` → nothing matches, FAILS)", () => {
    const plan = planTelnyxBackfill([
      row(), row({ to: "+19565552222", from: "+19565550001" }), row({ from: "+19565559999" }),
    ], OWNERS);
    expect(plan.toAppend.map((r) => [r.accountId, r.address])).toEqual([
      ["11111111-1111-4111-8111-111111111111", "+19565551234"],
      ["22222222-2222-4222-8222-222222222222", "+19565552222"],
    ]);
    expect(plan.perAccount).toEqual({ "11111111-1111-4111-8111-111111111111": 1, "22222222-2222-4222-8222-222222222222": 1 });
    expect(plan.unmatched).toEqual([{ from: "+19565559999", rows: 1 }]);
    expect(plan.toMatchesOwners).toBe(0);
  });

  it("the same customer twice for one account is one row (mutation: drop the de-duplication → two, FAILS)", () => {
    expect(planTelnyxBackfill([row(), row({ keyword: "QUIT" })], OWNERS).toAppend).toHaveLength(1);
  });

  it("counts how many `to` numbers are the business's OWN numbers — a reversed reading would show here, not in the ledger (mutation: drop the count → FAILS)", () => {
    expect(planTelnyxBackfill([row({ to: "+19565550001" })], OWNERS).toMatchesOwners).toBe(1);
  });
});

describe("telnyxBackfillSql — the statement the orchestrator pastes", () => {
  it("one guarded call per row: revoked, backfill_telnyx, unless_customer_stopped, the opt-out's own time, a source naming that one opt-out event — its numbers AND its time (review R1-I3; mutation: guard 'none' → FAILS; drop the time from the source → FAILS)", () => {
    const sql = telnyxBackfillSql(planTelnyxBackfill([row()], OWNERS));
    expect(sql.match(/public\.append_consent_event\(/g)).toHaveLength(1);
    expect(sql).toContain("'backfill_telnyx'::text, 'unless_customer_stopped'::text");
    expect(sql).toContain("'telnyx_optout:+19565550000:+19565551234:2025-04-28T12:00:38.631Z'::text");
    expect(sql).toContain("'2025-04-28T12:00:38.631Z'::timestamptz");
    expect(sql).toContain("\"keyword\":\"STOP\"");
    expect(sql).not.toContain(String.fromCharCode(0x5c));
  });

  it("is ONE statement that answers each outcome and its count, so execute_sql (which shows only the last statement's result) reports the whole write (review R1-M3; mutation: one statement per row → several semicolons, FAILS)", () => {
    const sql = telnyxBackfillSql(planTelnyxBackfill([row(), row({ to: "+19565554321" })], OWNERS));
    expect(sql.match(/public\.append_consent_event\(/g)).toHaveLength(2);
    expect(sql.match(/;/g)).toHaveLength(1);
    expect(sql).toMatch(/group by outcome/);
  });

  it("an empty plan is refused, never an invalid statement with no call in it (mutation: drop the check → FAILS)", () => {
    expect(() => telnyxBackfillSql(planTelnyxBackfill([], OWNERS))).toThrow(/nothing to write/);
  });

  it("refuses the WHOLE run, naming the row, when a planned occurred_at is in the future — 0055's append_consent_event RAISES on that (errcode 22023) and would abort every row inside this one statement, not just the bad one (dispatch task-3 item 8; mutation: drop the future-time check → FAILS)", () => {
    const plan = planTelnyxBackfill([row({ created_at: "9999-01-01T00:00:00Z" })], OWNERS);
    expect(() => telnyxBackfillSql(plan)).toThrow(/\+19565550000.*\+19565551234.*future/s);
  });
});
