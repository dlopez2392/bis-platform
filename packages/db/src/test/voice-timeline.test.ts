import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact } from "../contacts";
import { assignPhoneNumber, listContactCalls } from "../voice";

describe("listContactCalls for the record timeline (S-03 1b, spec §6, §7)", () => {
  it("carries outcome, duration, reason, summary and language, and pages past a cursor at a tied instant (mutation: drop the id tiebreak -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const at = "2026-10-09T16:12:00.123456+00:00";
      const ids: string[] = [];
      for (const reason of ["Roof leak", "Gutter quote"]) {
        const { data, error } = await db.from("calls").insert({
          account_id: accountId, phone_number_id: num.id, contact_id: ana, started_at: at, outcome: "booked",
          duration_secs: 181, reason, summary: "x", language: "es",
        }).select("id").single();
        if (error) throw new Error(error.message);
        ids.push((data as { id: string }).id);
      }
      const first = await listContactCalls(db, accountId, ana, 1);
      expect(first[0]).toMatchObject({ outcome: "booked", duration_secs: 181, language: "es", summary: "x" });
      const second = await listContactCalls(db, accountId, ana, 5, { before: { v: first[0]!.started_at, id: first[0]!.id } });
      expect([first[0]!.id, ...second.map((c) => c.id)]).toEqual([...ids].sort().reverse());
    }));
});
