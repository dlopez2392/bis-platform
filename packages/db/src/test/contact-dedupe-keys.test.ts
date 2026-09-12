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
  // 0034's regression fixture: a tab, newline, or NBSP pad — exactly what a
  // CSV import produces — used to survive JS's `.trim()` but not the
  // database's old `trim(both ' ' from ...)`, so the two sides silently
  // computed different keys for the same input. See emailKey()'s doc
  // comment and migrations/0034_email_key_whitespace.sql.
  "\tdan@example.com",
  "dan@example.com\n",
  "\u00A0dan@example.com\u00A0",
  // \u3000 (IDEOGRAPHIC SPACE, Unicode category Space_Separator) is
  // deliberately OUTSIDE the shared class above -- it is not a space, tab,
  // newline, CR, form feed, vertical tab, or NBSP. Under correct code
  // NEITHER side strips it: the SQL column's explicit character class
  // doesn't list it, and neither does emailKey()'s regex. So this row
  // passes today, the same as any other character both sides leave alone,
  // and that passing result IS the assertion that the two sides still
  // agree on the class's edge. What it's really here for is the failure
  // mode every other row in this array is structurally unable to produce:
  // every other pad character (space/tab/newline/NBSP) is a member of the
  // shared class AND of JS's `.trim()` set, and `.trim()` strips a strict
  // superset of the shared class -- so if emailKey() ever regresses back to
  // `.trim()` (reading its own doc comment as "basically `.trim()` with
  // extra steps"), or gets swapped for some Unicode-aware whitespace
  // helper, every existing row keeps passing because trimming MORE than
  // the shared class is invisible to a fixture built only from characters
  // already IN that class. \u3000 is whitespace `.trim()` removes but the
  // shared class does not, so the moment JS starts stripping it and SQL
  // still doesn't, this row's two sides diverge and it fails by name --
  // exactly the widening regression this migration exists to prevent.
  "\u3000dan@example.com\u3000",
];

describe("dedupe keys: the database and TypeScript must agree (spec §4.1)", () => {
  // it.each over a plain expect()-in-a-for-loop: the loop form is fail-fast —
  // a divergence at an early index throws and aborts the test, so every
  // shape AFTER it never runs in that pass and a single red run is not a
  // full audit. it.each gives each shape its own test result, all reported
  // independently in the same run.
  it.each(PHONES)("phone_key matches phoneDigits for %j", async (phone) => {
    await withTestAccount(async (db, accountId) => {
      const { data, error } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Key", phone: phone || null })
        .select("phone_key").single();
      expect(error, `insert failed for ${JSON.stringify(phone)}`).toBeNull();
      const expected = phone ? (phoneDigits(phone) || null) : null;
      expect(data!.phone_key, `phone_key for ${JSON.stringify(phone)}`).toBe(expected);
    });
  });

  it.each(EMAILS)("email_key matches emailKey for %j", async (email) => {
    await withTestAccount(async (db, accountId) => {
      const { data, error } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Key", email: email || null })
        .select("email_key").single();
      expect(error, `insert failed for ${JSON.stringify(email)}`).toBeNull();
      const expected = email ? (emailKey(email) || null) : null;
      expect(data!.email_key, `email_key for ${JSON.stringify(email)}`).toBe(expected);
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
