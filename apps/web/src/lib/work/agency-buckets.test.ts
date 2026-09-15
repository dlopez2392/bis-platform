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
    brandName: "Rio Roofing", timezone: "America/Chicago",
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
});
