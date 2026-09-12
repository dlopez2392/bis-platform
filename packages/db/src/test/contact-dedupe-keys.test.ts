import { describe, expect, it } from "vitest";
import { phoneDigits, emailKey } from "../contacts";
import { withTestAccount } from "./fixtures";

// Real shapes this database actually holds. "(956) 292-1696" is the majority
// operator-entered shape; "+19562921696" is what toE164 and inbound SMS
// produce. They are the same ten digits and MUST produce the same key — that
// equivalence is the entire reason phoneDigits exists.
const PHONES = [
  "(956) 292-1696",
  "+19562921696",
  "956-292-1696",
  "19562921696",
  "9562921696",
  "956.292.1696 x12",
  "",
];

const EMAILS = [
  "Dan@Example.com",
  "  dan@example.com  ",
  "dan+bis@example.com",
  "dan+a+b@example.com",
  "dan@example.com",
  "",
];

describe("dedupe keys: the database and TypeScript must agree (spec §4.1)", () => {
  it("phone_key matches phoneDigits for every shape", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const phone of PHONES) {
        const { data, error } = await db.from("contacts")
          .insert({ account_id: accountId, first_name: "Key", phone: phone || null })
          .select("phone_key").single();
        expect(error, `insert failed for ${JSON.stringify(phone)}`).toBeNull();
        const expected = phone ? (phoneDigits(phone) || null) : null;
        expect(data!.phone_key, `phone_key for ${JSON.stringify(phone)}`).toBe(expected);
      }
    });
  });

  it("email_key matches emailKey for every shape", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const email of EMAILS) {
        const { data, error } = await db.from("contacts")
          .insert({ account_id: accountId, first_name: "Key", email: email || null })
          .select("email_key").single();
        expect(error, `insert failed for ${JSON.stringify(email)}`).toBeNull();
        const expected = email ? (emailKey(email) || null) : null;
        expect(data!.email_key, `email_key for ${JSON.stringify(email)}`).toBe(expected);
      }
    });
  });

  it("the flags table refuses an unordered or duplicate pair", async () => {
    await withTestAccount(async (db, accountId) => {
      const mk = async (name: string) => {
        const { data } = await db.from("contacts")
          .insert({ account_id: accountId, first_name: name }).select("id").single();
        return data!.id as string;
      };
      const [x, y] = [await mk("A"), await mk("B")].sort();
      const row = { account_id: accountId, contact_a: x, contact_b: y,
                    reason: "email_phone_conflict" };

      const first = await db.from("contact_duplicate_flags").insert(row);
      expect(first.error, "the first flag should insert").toBeNull();

      // Idempotence is a CONSTRAINT, not a convention — the same pair seen
      // twice must not accumulate rows (spec §5).
      const again = await db.from("contact_duplicate_flags").insert(row);
      expect(again.error?.code, "a repeat pair must violate the unique index").toBe("23505");

      // Ordering is a CHECK, so a caller cannot write the mirror image and
      // defeat the unique index.
      const mirror = await db.from("contact_duplicate_flags")
        .insert({ ...row, contact_a: y, contact_b: x });
      expect(mirror.error?.code, "an unordered pair must violate the check").toBe("23514");
    });
  });
});
