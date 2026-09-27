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
      const { data } = await db.from("contacts").select("phone").eq("id", mx.id).single();
      expect(data).toEqual({ phone: "+528999221234" });
    });
  });

  it("setContactPhoneCountry writes phone and flag together only while the phone is unchanged, and flags a twin (mutation: drop the expectedPhone guard → 'updated', FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const flagged = await createContact(db, accountId, { firstName: "Flag", phone: "55 1234 5678" }, "user_test");
      const twin = await createContact(db, accountId, { firstName: "Twin", phone: "+525512345678" }, "user_test");

      expect(await setContactPhoneCountry(db, accountId, flagged.id,
        { expectedPhone: "+19999999999", phone: "+525512345678", unconfirmed: false }, "user_test")).toBe("changed");
      expect(await readPhoneCountryFlag(db, accountId, flagged.id)).toBe(true);

      expect(await setContactPhoneCountry(db, accountId, flagged.id,
        { expectedPhone: "+15512345678", phone: "+525512345678", unconfirmed: false }, "user_test")).toBe("updated");
      const { data } = await db.from("contacts").select("phone, phone_country_unconfirmed").eq("id", flagged.id).single();
      expect(data).toEqual({ phone: "+525512345678", phone_country_unconfirmed: false });

      const [a, b] = [flagged.id, twin.id].sort();
      const { data: flags } = await db.from("contact_duplicate_flags").select("reason")
        .eq("account_id", accountId).eq("contact_a", a).eq("contact_b", b);
      expect(flags).toEqual([{ reason: "phone_country_pick" }]);
    });
  });
});
