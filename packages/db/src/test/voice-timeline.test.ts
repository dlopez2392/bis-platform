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

describe("S-03 part 2b: listContactCalls takes a set, each row naming its own contact_id (spec C6, C8, C13)", () => {
  it("a set returns both people's calls (started_at desc, id desc), spam left out, each with contact_id (probe: drop contact_id from the select -> undefined, FAILS); a single id still reads exactly that person's rows, not the other contact's (probe: route the string through forContacts' .in branch -> empty, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, "user_test");
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const insertCall = async (contactId: string, startedAt: string, outcome: string) => {
        const { data, error } = await db.from("calls").insert({
          account_id: accountId, phone_number_id: num.id, contact_id: contactId, started_at: startedAt,
          outcome, duration_secs: 60, reason: "Quote", summary: "x", language: "en",
        }).select("id").single();
        if (error) throw new Error(error.message);
        return (data as { id: string }).id;
      };
      const anaCall = await insertCall(ana, "2026-10-01T00:00:00+00:00", "booked");
      const anaSpam = await insertCall(ana, "2026-10-09T00:00:00+00:00", "spam");
      const benCall = await insertCall(ben, "2026-10-05T00:00:00+00:00", "lead");

      const both = await listContactCalls(db, accountId, [ana, ben], 31, { excludeSpam: true });
      expect(both.map((c) => ({ id: c.id, contact_id: c.contact_id }))).toEqual([
        { id: benCall, contact_id: ben },
        { id: anaCall, contact_id: ana },
      ]);
      expect(both.map((c) => c.id)).not.toContain(anaSpam);

      const anaOnly = await listContactCalls(db, accountId, ana, 31, { excludeSpam: true });
      expect(anaOnly.map((c) => c.id)).toEqual([anaCall]);
    }));
});
