import { describe, it, expect, vi } from "vitest";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import {
  ALERT_CODE_MAX_ATTEMPTS, ALERT_CODE_MAX_SENDS_PER_HOUR,
  startAlertPhoneVerification, verifyAlertPhoneCode, countRecentAlertPhoneVerifications,
  discardAlertPhoneVerification,
} from "../alert-phone-verification";
import { getAlertPhone, setAlertPhone } from "../accounts";

// Wraps the REAL setAlertPhone by default (every existing test below still
// exercises the genuine write), overridable per-test via
// `vi.mocked(setAlertPhone).mockRejectedValueOnce(...)` to inject a failure
// on the accounts write without touching verifyAlertPhoneCode's own code —
// the only way to prove the CONSUME-THEN-WRITE order without editing the
// function under test.
vi.mock("../accounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../accounts")>();
  return { ...actual, setAlertPhone: vi.fn(actual.setAlertPhone) };
});

/**
 * The APPLICATION side of 0036: the two functions that actually run the
 * flow the migration's storage exists for. `alert-phone-verification-grants
 * .test.ts` pins the table's shape; this file pins the behaviour built on
 * top of it — the part a schema test cannot reach.
 */
describe("startAlertPhoneVerification", () => {
  it("stores only the hash, never the code, and returns the code exactly once", async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      const { id, code } = await startAlertPhoneVerification(db, accountId, phone);
      expect(code).toMatch(/^[0-9]{6}$/);

      const { data } = await db.from("alert_phone_verifications")
        .select("code_hash").eq("id", id).single();
      // Mutation check: storing the code itself (not its hash) would leave
      // `code_hash` equal to the six-digit code, which is exactly what this
      // asserts is NOT the case.
      expect(data!.code_hash).not.toBe(code);
      expect(data!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("never touches accounts.alert_phone", async () => {
    await withTestAccount(async (db, accountId) => {
      await startAlertPhoneVerification(db, accountId, testPhoneNumber());
      expect(await getAlertPhone(db, accountId)).toBeNull();
    });
  });
});

describe("verifyAlertPhoneCode — the right code", () => {
  it("consumes the row and writes accounts.alert_phone, in that order", async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      const { id, code } = await startAlertPhoneVerification(db, accountId, phone);

      const outcome = await verifyAlertPhoneCode(db, accountId, phone, code, "user_test");
      expect(outcome).toBe("verified");
      expect(await getAlertPhone(db, accountId)).toBe(phone);

      const { data } = await db.from("alert_phone_verifications")
        .select("consumed_at").eq("id", id).single();
      expect(data!.consumed_at).not.toBeNull();
    });
  });

  // The test above asserts both writes happened, never which came first —
  // it stayed green when a reviewer moved the accounts write above the
  // consume. This one proves the ORDER itself: inject a failure on the
  // accounts write (mocked, not a real outage) and check what the row and
  // the column show afterward. Under the real CONSUME-THEN-WRITE order, the
  // consume has already landed by the time the (mocked) write throws, so the
  // row reads consumed with accounts.alert_phone still null — "a crash
  // between the two leaves a burnt code, never an unproven number" (0036
  // Decision 3). Reverse the order and the mocked write throws before the
  // consume statement ever runs, so `consumed_at` stays null and this test's
  // first assertion fails.
  it("consumes the row BEFORE the accounts write runs, so a failed write still leaves a burnt code, never an unproven number (mutation: swap the two statements → consumed_at stays null → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      const { id, code } = await startAlertPhoneVerification(db, accountId, phone);

      vi.mocked(setAlertPhone).mockRejectedValueOnce(new Error("simulated accounts write failure"));
      await expect(verifyAlertPhoneCode(db, accountId, phone, code, "user_test")).rejects.toThrow(
        "simulated accounts write failure",
      );

      const { data } = await db.from("alert_phone_verifications")
        .select("consumed_at").eq("id", id).single();
      expect(data!.consumed_at).not.toBeNull();
      expect(await getAlertPhone(db, accountId)).toBeNull();
    });
  });

  // Two independent guards protect this: the lookup's own `is("consumed_at",
  // null)` (never returns an already-spent row as "live" in the first
  // place) and the consume UPDATE's matching guard (refuses to re-stamp a
  // row that is already consumed). Either one alone is already sufficient —
  // deliberate defense in depth — so the mutation that actually turns this
  // test red has to drop BOTH at once; dropping only one leaves the other
  // standing and the test stays green, which was checked and is not a gap.
  it("cannot be replayed once consumed (mutation: drop BOTH consumed_at guards → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      const { code } = await startAlertPhoneVerification(db, accountId, phone);
      expect(await verifyAlertPhoneCode(db, accountId, phone, code, "user_test")).toBe("verified");

      // Clear the number, then replay the SAME already-spent code.
      await db.from("accounts").update({ alert_phone: null }).eq("id", accountId);
      expect(await verifyAlertPhoneCode(db, accountId, phone, code, "user_test")).toBe("expired");
      expect(await getAlertPhone(db, accountId)).toBeNull();
    });
  });
});

describe("verifyAlertPhoneCode — a wrong code", () => {
  it("reports wrong_code, counts an attempt, and writes nothing (mutation: return 'expired' instead → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      const { id } = await startAlertPhoneVerification(db, accountId, phone);

      const outcome = await verifyAlertPhoneCode(db, accountId, phone, "000000", "user_test");
      expect(outcome).toBe("wrong_code");
      expect(await getAlertPhone(db, accountId)).toBeNull();

      const { data } = await db.from("alert_phone_verifications")
        .select("attempts, consumed_at").eq("id", id).single();
      expect(data!.attempts).toBe(1);
      expect(data!.consumed_at).toBeNull();
    });
  });

  it("never reveals a wrong guess against a code that never existed (mutation: skip the live-row check → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // No verification ever started for this phone.
      const outcome = await verifyAlertPhoneCode(db, accountId, testPhoneNumber(), "123456", "user_test");
      expect(outcome).toBe("expired");
    });
  });

  // The property that makes this possession proof rather than a formality:
  // a code texted to ONE number must not verify a DIFFERENT number, even
  // when that different number's own claim (the parameter this call passes)
  // is what would get WRITTEN on a match. The near-miss test above uses an
  // account with no rows at all; this one has a live row for phoneA, so the
  // lookup's own `.eq("phone", phone)` scope is the only thing standing
  // between "no match" and "wrong number verified".
  it("refuses a code texted to one number when checked against a different number, and never writes it (mutation: drop the .eq('phone', phone) scope in the lookup → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const phoneA = testPhoneNumber();
      const phoneB = testPhoneNumber();
      const { code } = await startAlertPhoneVerification(db, accountId, phoneA);

      const outcome = await verifyAlertPhoneCode(db, accountId, phoneB, code, "user_test");
      expect(outcome).toBe("expired");
      expect(await getAlertPhone(db, accountId)).toBeNull();
    });
  });

  it(`stops counting once ${ALERT_CODE_MAX_ATTEMPTS} guesses are spent, and reports the row as expired from then on (mutation: use <= instead of < in the attempts filter → FAILS)`, async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      const { id, code } = await startAlertPhoneVerification(db, accountId, phone);

      for (let i = 0; i < ALERT_CODE_MAX_ATTEMPTS; i++) {
        expect(await verifyAlertPhoneCode(db, accountId, phone, "999999", "user_test")).toBe("wrong_code");
      }

      const { data } = await db.from("alert_phone_verifications")
        .select("attempts").eq("id", id).single();
      expect(data!.attempts).toBe(ALERT_CODE_MAX_ATTEMPTS);

      // The 6th call must not attempt to write attempts=6 (the CHECK would
      // refuse it) and must not accept the right code either — the row is
      // spent.
      expect(await verifyAlertPhoneCode(db, accountId, phone, code, "user_test")).toBe("expired");
      expect(await getAlertPhone(db, accountId)).toBeNull();
    });
  });
});

describe("verifyAlertPhoneCode — an expired code", () => {
  it("reports expired once the row's own expires_at has passed (mutation: drop the expires_at filter → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      const { id, code } = await startAlertPhoneVerification(db, accountId, phone);

      // `alert_phone_verifications_lifetime_check` requires `expires_at >
      // created_at`, so the only value guaranteed both to satisfy the CHECK
      // and to be in the past by the time verifyAlertPhoneCode runs (real
      // network round trips follow this update) is one measured off the
      // row's OWN created_at, not off Date.now() at this line.
      const { data: before, error: readError } = await db.from("alert_phone_verifications")
        .select("created_at").eq("id", id).single();
      expect(readError, `read failed: ${readError?.message}`).toBeNull();
      const { error: updateError } = await db.from("alert_phone_verifications")
        .update({ expires_at: new Date(Date.parse(before!.created_at) + 1).toISOString() })
        .eq("id", id);
      expect(updateError, `update failed: ${updateError?.message}`).toBeNull();

      expect(await verifyAlertPhoneCode(db, accountId, phone, code, "user_test")).toBe("expired");
      expect(await getAlertPhone(db, accountId)).toBeNull();
    });
  });
});

describe("verifyAlertPhoneCode — an earlier pending attempt survives a new one", () => {
  it("lets the NEWEST live attempt for the same number succeed even with an older one still pending", async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      await startAlertPhoneVerification(db, accountId, phone); // the mistyped-then-resent first code
      const second = await startAlertPhoneVerification(db, accountId, phone);

      expect(await verifyAlertPhoneCode(db, accountId, phone, second.code, "user_test")).toBe("verified");
      expect(await getAlertPhone(db, accountId)).toBe(phone);
    });
  });
});

describe("countRecentAlertPhoneVerifications", () => {
  it(`counts every row opened for (account, phone) in the window, up to what ${ALERT_CODE_MAX_SENDS_PER_HOUR} limits (mutation: filter by consumed rows only → FAILS)`, async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      expect(await countRecentAlertPhoneVerifications(db, accountId, phone)).toBe(0);
      await startAlertPhoneVerification(db, accountId, phone);
      await startAlertPhoneVerification(db, accountId, phone);
      expect(await countRecentAlertPhoneVerifications(db, accountId, phone)).toBe(2);
    });
  });

  it("does not count a different phone number on the same account", async () => {
    await withTestAccount(async (db, accountId) => {
      await startAlertPhoneVerification(db, accountId, testPhoneNumber());
      expect(await countRecentAlertPhoneVerifications(db, accountId, testPhoneNumber())).toBe(0);
    });
  });
});

describe("discardAlertPhoneVerification", () => {
  it("removes the row so a failed send never spends a rate-limit slot (mutation: no-op the function body → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const phone = testPhoneNumber();
      const { id } = await startAlertPhoneVerification(db, accountId, phone);
      expect(await countRecentAlertPhoneVerifications(db, accountId, phone)).toBe(1);

      await discardAlertPhoneVerification(db, id);

      expect(await countRecentAlertPhoneVerifications(db, accountId, phone)).toBe(0);
      const { data } = await db.from("alert_phone_verifications").select("id").eq("id", id).maybeSingle();
      expect(data).toBeNull();
    });
  });
});
