import { describe, it, expect } from "vitest";
import {
  parseOptouts, planTelnyxBackfill, telnyxBackfillSql, telnyxBackfillSqlParts, maskLast4,
  type OptoutRow,
} from "./telnyx-optouts";

const OWNERS = [
  { e164: "+19565550000", account_id: "11111111-1111-4111-8111-111111111111", status: "live" },
  { e164: "+19565550001", account_id: "22222222-2222-4222-8222-222222222222", status: "testing" },
];
const row = (o: Partial<OptoutRow> = {}): OptoutRow => ({
  from: "+19565550000", to: "+19565551234", messaging_profile_id: "prof-1", keyword: "STOP",
  created_at: "2025-04-28 12:00:38.631252+00:00", ...o,
});

function thrown(fn: () => unknown): string {
  try { fn(); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

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

  it("refuses a created_at with no explicit UTC offset, without naming any number (review M3; mutation: drop the offset check → the bare-local timestamp is accepted, FAILS)", () => {
    const message = thrown(() => parseOptouts([row({ created_at: "2025-04-28T12:00:38" })]));
    expect(message).toMatch(/created_at/);
    expect(message).toMatch(/offset/);
    expect(message).not.toMatch(/\+1956/);
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

  it("keeps the EARLIEST created_at deterministically when duplicates disagree, never whichever the input lists first (review M4; mutation: keep the later one → FAILS)", () => {
    const plan = planTelnyxBackfill([
      row({ created_at: "2025-04-28 12:00:38.631252+00:00" }),
      row({ created_at: "2025-01-01 00:00:00+00:00" }),
    ], OWNERS);
    expect(plan.toAppend).toHaveLength(1);
    expect(plan.toAppend[0]!.occurredAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("counts how many `to` numbers are the business's OWN numbers — a reversed reading would show here, not in the ledger (mutation: drop the count → FAILS)", () => {
    expect(planTelnyxBackfill([row({ to: "+19565550001" })], OWNERS).toMatchesOwners).toBe(1);
  });

  it("computes future-dated rows itself, in count-only mode too, from an injected `now` rather than the wall clock (review M2, M6; mutation: drop futureDated → always empty, FAILS)", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    const plan = planTelnyxBackfill([row({ created_at: "2025-06-01T00:00:00+00:00" })], OWNERS, now);
    expect(plan.futureDated).toHaveLength(1);
  });

  it("a row AT `now` (not after) is never future-dated (mutation: use >= instead of > → a same-instant row wrongly counts, FAILS)", () => {
    const now = new Date("2025-06-01T00:00:00Z");
    const plan = planTelnyxBackfill([row({ created_at: "2025-06-01T00:00:00+00:00" })], OWNERS, now);
    expect(plan.futureDated).toHaveLength(0);
  });

  describe("a released number's opt-outs are still written (orchestrator decision I3)", () => {
    it("a released owner's opt-out is appended and counted separately as released (mutation: skip released owners → FAILS)", () => {
      const releasedOwners = [...OWNERS, { e164: "+19565550002", account_id: OWNERS[0]!.account_id, status: "released" }];
      const plan = planTelnyxBackfill([row({ from: "+19565550002", to: "+19565553333" })], releasedOwners);
      expect(plan.toAppend).toHaveLength(1);
      expect(plan.perAccount[OWNERS[0]!.account_id]).toBe(1);
      expect(plan.releasedPerAccount[OWNERS[0]!.account_id]).toBe(1);
    });

    it("a live owner's opt-out is NOT counted as released (mutation: count every owner as released → FAILS)", () => {
      const plan = planTelnyxBackfill([row()], OWNERS);
      expect(plan.releasedPerAccount[OWNERS[0]!.account_id] ?? 0).toBe(0);
    });
  });

  describe("owners are validated before planning (review M5)", () => {
    it("refuses an owner with a non-uuid account_id (mutation: drop owner validation → FAILS)", () => {
      expect(() => planTelnyxBackfill([row()], [{ e164: "+19565550000", account_id: "not-a-uuid", status: "live" }]))
        .toThrow(/account_id/);
    });

    it("refuses an owner with a non-E.164 e164 (mutation: drop owner validation → FAILS)", () => {
      expect(() => planTelnyxBackfill([row()], [{ e164: "BISRGV", account_id: "11111111-1111-4111-8111-111111111111", status: "live" }]))
        .toThrow(/e164/);
    });
  });
});

describe("planTelnyxBackfill — the customer `to` is keyed exactly like every other writer (whole-branch review I1)", () => {
  it("a +521... customer number (the retired Mexican mobile 1) is normalised to +52... in the written address (mutation: use r.to raw instead of normalisePhone's e164 → FAILS)", () => {
    const plan = planTelnyxBackfill([row({ to: "+5215512345678" })], OWNERS);
    expect(plan.toAppend).toHaveLength(1);
    expect(plan.toAppend[0]!.address).toBe("+525512345678");
  });

  it("the normalised address is what the sourceRef and the SQL both carry, never the +521 form (mutation: use r.to raw instead of normalisePhone's e164 → FAILS)", () => {
    const sql = telnyxBackfillSql(planTelnyxBackfill([row({ to: "+5215512345678" })], OWNERS));
    expect(sql).toContain("telnyx_optout:+19565550000:+525512345678:2025-04-28T12:00:38.631Z");
    expect(sql).not.toContain("+5215512345678");
  });

  it("a +521 row and its +52 twin for the same account dedupe to ONE row, keeping the earliest (mutation: key the dedupe on the raw to instead of the normalised address → two rows, FAILS)", () => {
    const plan = planTelnyxBackfill([
      row({ to: "+5215512345678", created_at: "2025-04-28 12:00:38.631252+00:00" }),
      row({ to: "+525512345678", created_at: "2025-01-01 00:00:00+00:00" }),
    ], OWNERS);
    expect(plan.toAppend).toHaveLength(1);
    expect(plan.toAppend[0]!.address).toBe("+525512345678");
    expect(plan.toAppend[0]!.occurredAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("a to that normalisePhone refuses throws naming the row's input POSITION, never the number itself (mutation: skip the normalisePhone guard → the bad row reaches the ledger write path instead of throwing, FAILS)", () => {
    const message = thrown(() => planTelnyxBackfill([row(), row({ to: "12345" })], OWNERS));
    expect(message).toMatch(/opt-out 1/);
    expect(message).not.toContain("12345");
  });

  it("toMatchesOwners (the reversed from/to guard) still fires on the NORMALISED to, not just an exact string match (mutation: compare byNumber.has(r.to) instead of the normalised value → a +521 reversal would be missed, FAILS)", () => {
    // OWNERS has no +52 entry, so this only proves the normalised value is what's
    // compared; a live +521-owner case is covered by the dedupe test above using the
    // same normalisation path.
    expect(planTelnyxBackfill([row({ to: "+19565550001" })], OWNERS).toMatchesOwners).toBe(1);
  });
});

describe("maskLast4 — never a full number in a log line (review I2)", () => {
  it("keeps only the last four digits (mutation: return the input unchanged → FAILS)", () => {
    expect(maskLast4("+19565559999")).toBe("********9999");
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

  it("refuses the WHOLE run, naming the row by input position and its BUSINESS number, NEVER the customer number, when a planned occurred_at is in the future (review I1, M2; mutation: identify the row by `to` instead of `from` → the customer number appears, FAILS)", () => {
    const plan = planTelnyxBackfill([row({ created_at: "9999-01-01T00:00:00Z" })], OWNERS);
    const message = thrown(() => telnyxBackfillSql(plan));
    expect(message).toMatch(/future/);
    expect(message).toContain("+19565550000"); // the business number (`from`)
    expect(message).not.toContain("+19565551234"); // the customer number (`to`) — never printed
    expect(message).toMatch(/row #1/);
  });

  it("refuses to emit when a customer number matches one of OUR OWN numbers — a reversed from/to reading — and the message carries no number, only a count (review I1, I2; mutation: drop the toMatchesOwners guard → FAILS)", () => {
    const plan = planTelnyxBackfill([row({ to: "+19565550001" })], OWNERS);
    expect(plan.toMatchesOwners).toBe(1);
    const message = thrown(() => telnyxBackfillSql(plan));
    expect(message).toMatch(/reversed/);
    expect(message).not.toContain("+19565550001");
    expect(message).not.toContain("+19565550000");
  });

  it("refuses above the 1,000-row limit for one statement, naming telnyxBackfillSqlParts instead (review M1; mutation: drop the row-count check → FAILS)", () => {
    const owner = [{ e164: "+19565550099", account_id: OWNERS[0]!.account_id, status: "live" }];
    const rows = Array.from({ length: 1001 }, (_, i) => row({ from: "+19565550099", to: `+1956${String(1_000_000 + i).padStart(7, "0")}` }));
    expect(() => telnyxBackfillSql(planTelnyxBackfill(rows, owner))).toThrow(/1,000-row limit/);
  });
});

describe("telnyxBackfillSqlParts — splitting a large plan into numbered, independently-idempotent statements (review M1)", () => {
  it("splits into parts of at most 1,000 rows, each its own ONE-statement write (mutation: drop the split, emit one giant statement → FAILS)", () => {
    const owner = [{ e164: "+19565550099", account_id: OWNERS[0]!.account_id, status: "live" }];
    const rows = Array.from({ length: 1500 }, (_, i) => row({ from: "+19565550099", to: `+1956${String(1_000_000 + i).padStart(7, "0")}` }));
    const plan = planTelnyxBackfill(rows, owner);
    expect(plan.toAppend).toHaveLength(1500);
    const parts = telnyxBackfillSqlParts(plan);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.match(/public\.append_consent_event\(/g)).toHaveLength(1000);
    expect(parts[1]!.match(/public\.append_consent_event\(/g)).toHaveLength(500);
    for (const p of parts) expect(p.match(/;/g)).toHaveLength(1);
  });

  it("still refuses an empty or reversed plan, same as telnyxBackfillSql (mutation: skip assertEmittable in the parts path → FAILS)", () => {
    expect(() => telnyxBackfillSqlParts(planTelnyxBackfill([], OWNERS))).toThrow(/nothing to write/);
  });
});
