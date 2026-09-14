import { describe, it, expect } from "vitest";
import { bucketWork } from "./buckets";
import type { WorkRow } from "@bis/db";

const task = (id: string, dueAt: string | null, occurredAt = "2026-09-01T00:00:00Z"): WorkRow => ({
  id: `task:${id}`, source: "task", accountId: "a", contactId: null,
  title: id, dueAt, occurredAt,
});
// NOTE: there is no "call" source. It was specified, found unsatisfiable in
// review, and WITHDRAWN before implementation — see the spec §1.2. The three
// sources are task | conversation | booking. Do not reintroduce `call:` ids.
const derived = (id: string, occurredAt: string): WorkRow => ({
  id: `conversation:${id}`, source: "conversation", accountId: "a", contactId: "c",
  title: id, dueAt: null, occurredAt,
});

describe("bucketWork", () => {
  // 14:00 UTC on 2026-09-14 is 09:00 in Chicago and 23:00 in Tokyo.
  const now = new Date("2026-09-14T14:00:00Z");

  it("puts a task due earlier today in Today, not Overdue", () => {
    // 11:00 UTC = 06:00 Chicago, three hours before `now`, same local day.
    const b = bucketWork([task("t", "2026-09-14T11:00:00Z")], now, "America/Chicago");
    expect(b.today.map((r) => r.id)).toEqual(["task:t"]);
    expect(b.overdue).toHaveLength(0);
  });

  it("the SAME instant lands in different buckets in two zones", () => {
    // 2026-09-14T23:30Z is still the 14th in Chicago (18:30) but the 15th in Tokyo (08:30).
    const due = "2026-09-14T23:30:00Z";
    const chicago = bucketWork([task("t", due)], now, "America/Chicago");
    const tokyo = bucketWork([task("t", due)], now, "Asia/Tokyo");
    expect(chicago.today).toHaveLength(1);
    expect(tokyo.today).toHaveLength(0);   // tomorrow there, so it waits
    expect(tokyo.waiting).toHaveLength(1);
  });

  it("puts a task due yesterday in Overdue", () => {
    const b = bucketWork([task("t", "2026-09-13T15:00:00Z")], now, "America/Chicago");
    expect(b.overdue.map((r) => r.id)).toEqual(["task:t"]);
  });

  it("undated tasks and ALL derived rows go to Waiting, oldest first", () => {
    const rows = [
      derived("new", "2026-09-14T13:00:00Z"),
      task("undated", null, "2026-09-10T00:00:00Z"),
      derived("old", "2026-09-08T09:00:00Z"),
    ];
    const b = bucketWork(rows, now, "America/Chicago");
    expect(b.waiting.map((r) => r.id)).toEqual(["conversation:old", "task:undated", "conversation:new"]);
    expect(b.overdue).toHaveLength(0);
  });

  it("NEVER promotes a stale derived row into Overdue", () => {
    // A booking that ended three weeks ago reads as late but carries no
    // promised date. Spec §2: Overdue means someone set a date and it passed.
    const b = bucketWork([derived("ancient", "2026-08-20T00:00:00Z")], now, "America/Chicago");
    expect(b.overdue).toHaveLength(0);
    expect(b.waiting).toHaveLength(1);
  });

  it("degrades to Waiting (not a throw) when the zone is invalid", () => {
    // "Not/AZone" is not a real IANA zone. Reachable today: the free-text
    // timezone input at create-account-dialog.tsx:80 has no validation, and
    // actions.ts:13 passes it straight through to the stored account. If we
    // cannot resolve the account's day boundary at all, we genuinely do not
    // know what is late — so nothing may be classified Overdue or Today —
    // but the work must still be visible, so every row waits, oldest first.
    const rows = [
      task("t1", "2026-09-13T15:00:00Z", "2026-09-10T00:00:00Z"), // would be Overdue
      task("t2", "2026-09-14T11:00:00Z", "2026-09-11T00:00:00Z"), // would be Today
      derived("d1", "2026-09-08T09:00:00Z"),
    ];
    let b!: ReturnType<typeof bucketWork>;
    expect(() => { b = bucketWork(rows, now, "Not/AZone"); }).not.toThrow();
    expect(b.overdue).toHaveLength(0);
    expect(b.today).toHaveLength(0);
    expect(b.waiting.map((r) => r.id)).toEqual(["conversation:d1", "task:t1", "task:t2"]);
  });

  it("an unparseable dueAt takes down only its own row, not the batch", () => {
    const rows = [
      task("bad", "not-a-date"),
      task("good", "2026-09-13T15:00:00Z"), // due yesterday in Chicago -> Overdue
    ];
    let b!: ReturnType<typeof bucketWork>;
    expect(() => { b = bucketWork(rows, now, "America/Chicago"); }).not.toThrow();
    expect(b.waiting.map((r) => r.id)).toEqual(["task:bad"]);
    expect(b.overdue.map((r) => r.id)).toEqual(["task:good"]);
  });
});
