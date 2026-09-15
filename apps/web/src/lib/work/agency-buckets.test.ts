import { describe, it, expect } from "vitest";
import type { AgencyWorkRow } from "@bis/db";
import { bucketAgencyWork } from "./agency-buckets";

// Same fact `buckets.test.ts` pins its own zone tests to: 14:00 UTC on
// 2026-09-14 is 09:00 in Chicago (still "today", 2026-09-14) and 23:00 in
// Tokyo (also "today" there) — so a due date of 2026-09-14 read the door
// crosses neither in isolation. To get two DIFFERENT verdicts per zone (the
// discriminating case — a fixture zone that can't tell "used this row's own
// zone" from "used some other zone" proves nothing), the fixture below dates
// a task for 2026-09-15T02:00:00Z: that instant is still 2026-09-14 ("today")
// in Chicago (21:00 the day before midnight) but already 2026-09-15
// ("tomorrow" — Waiting, not Today) in Tokyo (11:00 the next morning).
const NOW = new Date("2026-09-14T14:00:00Z");
const DUE = "2026-09-15T02:00:00Z";

function row(overrides: Partial<AgencyWorkRow> = {}): AgencyWorkRow {
  return {
    id: "task:1", source: "task", accountId: "acct-a", contactId: null,
    title: "Call back", dueAt: DUE, occurredAt: "2026-09-01T00:00:00Z",
    brandName: "Rio Roofing", timezone: "America/Chicago", suppressed: false,
    ...overrides,
  };
}

describe("bucketAgencyWork", () => {
  it("buckets each account's rows in THAT account's own zone, not a shared one", () => {
    const chicagoRow = row({ id: "task:chi", accountId: "acct-chi", timezone: "America/Chicago" });
    const tokyoRow = row({ id: "task:tok", accountId: "acct-tok", timezone: "Asia/Tokyo" });
    const b = bucketAgencyWork([chicagoRow, tokyoRow], NOW);
    // Same due instant, opposite verdicts — proof each row was bucketed
    // against ITS OWN account's zone, not the other's and not one shared one.
    expect(b.today.map((r) => r.id)).toEqual(["task:chi"]);
    expect(b.waiting.map((r) => r.id)).toEqual(["task:tok"]);
  });

  it("carries brandName and timezone through onto every returned row", () => {
    const b = bucketAgencyWork([row({ brandName: "Rio Roofing — trial" })], NOW);
    expect(b.today[0]!.brandName).toBe("Rio Roofing — trial");
    expect(b.today[0]!.timezone).toBe("America/Chicago");
  });

  it("an invalid zone degrades only that ONE account's rows to Waiting, never the whole queue", () => {
    // acct-bad's zone cannot resolve a day boundary at all (bucketWork's own
    // per-batch degrade) — but that must not reach across accounts and pull
    // acct-good's own, validly-overdue task down into Waiting alongside it.
    const badZoneRow = row({ id: "task:bad", accountId: "acct-bad", timezone: "Not/AZone", dueAt: "2026-09-14T11:00:00Z" });
    const overdueRow = row({ id: "task:overdue", accountId: "acct-good", timezone: "America/Chicago", dueAt: "2026-09-01T00:00:00Z" });
    const b = bucketAgencyWork([badZoneRow, overdueRow], NOW);
    expect(b.waiting.map((r) => r.id)).toContain("task:bad");
    expect(b.overdue.map((r) => r.id)).toEqual(["task:overdue"]);
  });

  it("groups a bucket's rows by account rather than interleaving accounts", () => {
    const a1 = row({ id: "task:a1", accountId: "acct-a", source: "task", dueAt: null, occurredAt: "2026-09-01T00:00:00Z" });
    const b1 = row({ id: "task:b1", accountId: "acct-b", source: "task", dueAt: null, occurredAt: "2026-09-02T00:00:00Z" });
    const a2 = row({ id: "task:a2", accountId: "acct-a", source: "task", dueAt: null, occurredAt: "2026-09-03T00:00:00Z" });
    // Fed interleaved (a, b, a) — a naive flat concat/sort by age alone would
    // interleave them back as [a1, b1, a2]; grouped-by-account output keeps
    // acct-a's two rows adjacent instead.
    const b = bucketAgencyWork([a1, b1, a2], NOW);
    expect(b.waiting.map((r) => r.id)).toEqual(["task:a1", "task:a2", "task:b1"]);
  });

  // The accounts read has no ordering, so the sequence the reviewer saw was
  // heap order — any edit to an account moves that company to the end, and
  // the top of a bucket was not the genuinely most urgent row. Blocks are
  // now ranked by each account's OWN most urgent row within that bucket —
  // earliest due date for Overdue, oldest occurrence for Waiting — never by
  // the order accounts happened to arrive in.
  it("orders overdue's company blocks by each account's own most overdue row, not insertion order", () => {
    const lessOverdue = row({ id: "task:less", accountId: "acct-less", dueAt: "2026-09-10T12:00:00Z" });
    const moreOverdue = row({ id: "task:more", accountId: "acct-more", dueAt: "2026-09-01T12:00:00Z" });
    // Fed with the LESS urgent account first — first-seen order (the old
    // behaviour) would put acct-less's block first regardless of urgency.
    const b = bucketAgencyWork([lessOverdue, moreOverdue], NOW);
    expect(b.overdue.map((r) => r.accountId)).toEqual(["acct-more", "acct-less"]);
  });

  it("orders waiting's company blocks by each account's own oldest row, not insertion order", () => {
    const newer = row({ id: "task:newer", accountId: "acct-newer", dueAt: null, occurredAt: "2026-09-10T00:00:00Z" });
    const older = row({ id: "task:older", accountId: "acct-older", dueAt: null, occurredAt: "2026-09-01T00:00:00Z" });
    const b = bucketAgencyWork([newer, older], NOW);
    expect(b.waiting.map((r) => r.accountId)).toEqual(["acct-older", "acct-newer"]);
  });

  it("breaks a tie between equally urgent blocks deterministically, the same way regardless of input order", () => {
    const a = row({ id: "task:a", accountId: "acct-a", dueAt: null, occurredAt: "2026-09-01T00:00:00Z" });
    const b = row({ id: "task:b", accountId: "acct-b", dueAt: null, occurredAt: "2026-09-01T00:00:00Z" });
    const orderAB = bucketAgencyWork([a, b], NOW).waiting.map((r) => r.accountId);
    const orderBA = bucketAgencyWork([b, a], NOW).waiting.map((r) => r.accountId);
    expect(orderAB).toEqual(orderBA);
    expect(orderAB).toEqual(["acct-a", "acct-b"]);
  });

  // The old aggregation spread a whole per-account bucket array into a
  // single `.push(...rows)` call. On this Node/V8, spreading an array into a
  // call throws (RangeError: call stack size exceeded) somewhere between
  // 100,000 and 131,072 elements — verified empirically (`node -e`) rather
  // than assumed from an older, lower, commonly-quoted V8 argument limit.
  // 200,000 is comfortably past that line. One account with more rows than
  // that in one bucket reproduces it without any DB.
  it("does not throw once a single account's own bucket holds hundreds of thousands of rows", () => {
    const huge: AgencyWorkRow[] = Array.from({ length: 200_000 }, (_, i) =>
      row({ id: `task:${i}`, accountId: "acct-huge", dueAt: null, occurredAt: "2026-09-01T00:00:00Z" }));
    let result: ReturnType<typeof bucketAgencyWork> | undefined;
    expect(() => { result = bucketAgencyWork(huge, NOW); }).not.toThrow();
    expect(result!.waiting.length).toBe(200_000);
  });
});
