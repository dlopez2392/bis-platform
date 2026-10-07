import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact, readPhoneCountryFlag, setContactPhoneCountry } from "../contacts";

/**
 * F-009's write path against the live table, on the CI project only
 * (withTestAccount + serviceDb). The pure halves are src/contacts-phone.test.ts.
 */
describe("F-009 on the contacts table (CI only: withTestAccount + serviceDb)", () => {
  it("createContact stores an ambiguous number as +1 AND flagged, and dedupes the same number typed another way (mutation: store the raw input → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId, { firstName: "Amb", phone: "55 1234 5678" }, "user_test");
      const { data } = await db.from("contacts").select("phone, phone_country_unconfirmed").eq("id", a.id).single();
      expect(data).toEqual({ phone: "+15512345678", phone_country_unconfirmed: true });
      expect(await readPhoneCountryFlag(db, accountId, a.id)).toBe(true);
      const again = await createContact(db, accountId, { firstName: "Amb2", phone: "(551) 234-5678" }, "user_test");
      expect(again.id).toBe(a.id);
    });
  });

  it("a Reynosa number is stored +52 and does NOT dedupe onto the same ten digits under +1 (mutation: key the raw digits → one contact, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const us = await createContact(db, accountId, { firstName: "Us", phone: "+18999221234" }, "user_test");
      const mx = await createContact(db, accountId, { firstName: "Mx", phone: "899 922 1234" }, "user_test");
      expect(mx.id).not.toBe(us.id);
      expect(mx.flagged).toBe(true);
      const { data } = await db.from("contacts").select("phone").eq("id", mx.id).single();
      expect(data).toEqual({ phone: "+528999221234" });
      const [a, b] = [us.id, mx.id].sort();
      const pairFlags = (await db.from("contact_duplicate_flags").select("reason")
        .eq("account_id", accountId).eq("contact_a", a).eq("contact_b", b)).data;
      expect(pairFlags).toEqual([{ reason: "phone_country_twin" }]);
    });
  });

  // Follow-up from PR #151 (893f0bc4's note: "+52 after +1 flags; +1 after
  // +52 doesn't") — the reverse save order of the test directly above. Before
  // this fix, saving the +52 contact FIRST and the +1 one SECOND found
  // nothing at all, not even a flag.
  it("the reverse order flags the pair too: a +52 contact saved FIRST, then a +1 contact on the same ten digits (follow-up, PR #151)", async () => {
    await withTestAccount(async (db, accountId) => {
      const mx = await createContact(db, accountId, { firstName: "Mx", phone: "+528999221234" }, "user_test");
      const us = await createContact(db, accountId, { firstName: "Us", phone: "+18999221234" }, "user_test");
      expect(us.id).not.toBe(mx.id);
      expect(us.flagged).toBe(true);
      const [a, b] = [mx.id, us.id].sort();
      const pairFlags = (await db.from("contact_duplicate_flags").select("reason")
        .eq("account_id", accountId).eq("contact_a", a).eq("contact_b", b)).data;
      expect(pairFlags).toEqual([{ reason: "phone_country_twin" }]);
    });
  });

  it("setContactPhoneCountry writes phone and flag together only while the phone is unchanged, and flags a twin (mutation: drop the expectedPhone guard → 'updated', FAILS; mutation: drop the pick's flagDuplicatePair → no flag, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const flagged = await createContact(db, accountId, { firstName: "Flag", phone: "55 1234 5678" }, "user_test");
      // The twin goes in DIRECTLY, not through createContact: createContact's
      // own twin rule (findDuplicate's +52 fallback) finds "+15512345678" under
      // the bare ten digits, reads it as +1, and flags the pair
      // 'phone_country_twin' at creation — and the pair index is unique on
      // (account_id, contact_a, contact_b), so the pick's flag would then be
      // the designed 23505 no-op and this test could never see the pick write
      // anything (the first CI run on #151 received 'phone_country_twin').
      const { data: twinRow, error: twinErr } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Twin", phone: "+525512345678" }).select("id").single();
      if (twinErr || !twinRow) throw new Error(`twin fixture insert failed: ${twinErr?.message}`);
      const twin = { id: twinRow.id as string };
      const [a, b] = [flagged.id, twin.id].sort();
      const pairFlags = async () => (await db.from("contact_duplicate_flags").select("reason")
        .eq("account_id", accountId).eq("contact_a", a).eq("contact_b", b)).data;
      // Nothing flags the pair before the pick, so whatever is there after it,
      // the pick wrote.
      expect(await pairFlags()).toEqual([]);

      expect(await setContactPhoneCountry(db, accountId, flagged.id,
        { expectedPhone: "+19999999999", phone: "+525512345678", unconfirmed: false }, "user_test")).toBe("changed");
      expect(await readPhoneCountryFlag(db, accountId, flagged.id)).toBe(true);

      expect(await setContactPhoneCountry(db, accountId, flagged.id,
        { expectedPhone: "+15512345678", phone: "+525512345678", unconfirmed: false }, "user_test")).toBe("updated");
      const { data } = await db.from("contacts").select("phone, phone_country_unconfirmed").eq("id", flagged.id).single();
      expect(data).toEqual({ phone: "+525512345678", phone_country_unconfirmed: false });

      expect(await pairFlags()).toEqual([{ reason: "phone_country_pick" }]);
    });
  });
});
