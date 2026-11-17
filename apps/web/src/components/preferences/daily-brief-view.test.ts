import { describe, it, expect } from "vitest";
import type { BriefSubscription } from "@bis/db";
import type { MyMembership } from "@/lib/owner-line/memberships";
import { dailyBriefRows, briefDayLabel } from "./daily-brief-view";

const mb = (accountId: string, role: MyMembership["role"], businessName: string): MyMembership =>
  ({ accountId, userId: "u", role, businessName, number: null });
const sub = (accountId: string, lastSentDay: string | null): BriefSubscription => ({
  id: `s-${accountId}`, userId: "u", accountId, enabledAt: "2026-11-16T12:00:00Z",
  lastHandledDay: lastSentDay, lastSentDay, lastOutcome: lastSentDay ? "sent" : null,
});

describe("dailyBriefRows", () => {
  it("lists Owner and Staff, never a Technician (mutation: widen the filter -> FAILS)", () => {
    const rows = dailyBriefRows([mb("a", "owner", "Alpha"), mb("b", "staff", "Beta"), mb("c", "technician", "Gamma")], []);
    expect(rows.map((r) => r.accountId)).toEqual(["a", "b"]);
  });
  it("on means a subscription exists, and carries its last sent day", () => {
    const rows = dailyBriefRows([mb("a", "owner", "Alpha"), mb("b", "owner", "Beta")], [sub("b", "2026-11-17")]);
    expect(rows).toEqual([
      { accountId: "a", businessName: "Alpha", on: false, lastSentDay: null },
      { accountId: "b", businessName: "Beta", on: true, lastSentDay: "2026-11-17" },
    ]);
  });
  it("a subscription on a business the person is no longer eligible for makes no row", () => {
    expect(dailyBriefRows([mb("c", "technician", "Gamma")], [sub("c", null)])).toEqual([]);
  });
  it("is empty for no memberships", () => expect(dailyBriefRows([], [])).toEqual([]));
});

describe("briefDayLabel", () => {
  it("names the day in each language, and never moves it a day", () => {
    expect(briefDayLabel("2026-11-17", "en")).toBe("Tuesday, Nov 17");
    expect(briefDayLabel("2026-11-17", "es")).toMatch(/^martes, 17 de nov/);
    expect(briefDayLabel("2026-01-01", "en")).toBe("Thursday, Jan 1");
  });
});
