import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import {
  recordScreenedCall, listScreenedCalls, countScreenedCalls,
  countLinesTurningCallersAway, countMisconfiguredScreenedCalls,
  screenedClass, SCREENED_REASONS,
} from "../screened-calls";
import { countCallsSince, countCallerHistorySince, assignPhoneNumber } from "../voice";
import { withTestAccount, testScreenedCalledE164, testPhoneNumber } from "./fixtures";

describe("screenedClass", () => {
  it("routes OUR misconfiguration to `misconfigured` (mutation: move not-live into `screened` -> FAILS)", () => {
    expect(screenedClass("not-live")).toBe("misconfigured");
    expect(screenedClass("no-profile")).toBe("misconfigured");
    expect(screenedClass("profile-disabled")).toBe("misconfigured");
  });

  it("routes working-as-designed refusals to `screened` (mutation: move repeat-spam into `misconfigured` -> FAILS)", () => {
    expect(screenedClass("over-cap")).toBe("screened");
    expect(screenedClass("repeat-spam")).toBe("screened");
  });

  it("routes the ownerless call to `unattributed` (mutation: fold unknown-number into `misconfigured` -> FAILS)", () => {
    // A wrong number is nobody's outage. Folding it into `misconfigured`
    // would raise the work-queue banner for every stray dial on the trunk.
    expect(screenedClass("unknown-number")).toBe("unattributed");
  });

  it("classifies every reason in the vocabulary — no reason falls through (mutation: add a seventh reason to SCREENED_REASONS without a class -> FAILS)", () => {
    for (const reason of SCREENED_REASONS) {
      expect(["misconfigured", "screened", "unattributed"]).toContain(screenedClass(reason));
    }
  });
});

describe("recordScreenedCall / listScreenedCalls", () => {
  it("records a refusal with no account at all (mutation: make accountId required -> FAILS)", async () => {
    const db = serviceDb();
    // `accountId: null` is the ownerless-call case `withTestAccount` cannot
    // scope to, so this row has no cascade to clean it up — it is deleted by
    // id below instead. The called number is randomized (`testScreenedCalledE164`)
    // so this test can find its OWN row directly rather than hoping it lands
    // in the top N of a global, unfiltered scan (see the sibling test's
    // history: a hard-coded number here only worked while this happened to be
    // the first DB-writing test in the file).
    const calledE164 = testScreenedCalledE164();
    let rowId: string | null = null;
    try {
      await recordScreenedCall(db, {
        accountId: null, phoneNumberId: null,
        calledE164, callerE164: "+19565550111",
        reason: "unknown-number",
      });
      const { data: mine, error } = await db.from("screened_calls")
        .select("id, account_id, reason").eq("called_e164", calledE164).single();
      if (error) throw new Error(`readback failed: ${error.message}`);
      rowId = mine.id as string;
      expect(mine.account_id).toBeNull();
      expect(mine.reason).toBe("unknown-number");
    } finally {
      if (rowId) await db.from("screened_calls").delete().eq("id", rowId);
    }
  });

  it("pages by cursor, newest first, never by offset (mutation: swap .lt for .gt -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const called of ["+19565550201", "+19565550202", "+19565550203"]) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: called,
          callerE164: null, reason: "repeat-spam",
        });
      }
      const first = await listScreenedCalls(db, { limit: 2 });
      expect(first).toHaveLength(2);
      const older = await listScreenedCalls(db, { limit: 2, before: first[1]!.createdAt });
      // Strictly older than the cursor — no row may appear on both pages.
      const firstIds = new Set(first.map((r) => r.id));
      for (const row of older) expect(firstIds.has(row.id)).toBe(false);
    });
  });
});

describe("listScreenedCalls class filter", () => {
  it("filters to the given class, deriving reasons from screenedClass (mutation: drop the class .in() filter -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // Randomized called numbers so this test can tell ITS rows apart from
      // whatever else the shared project's table holds — same discipline
      // `testScreenedCalledE164` already documents for the null-accountId
      // tests above.
      const misconfiguredCalled = testScreenedCalledE164();
      const screenedCalled = testScreenedCalledE164();
      await recordScreenedCall(db, {
        accountId, phoneNumberId: null, calledE164: misconfiguredCalled,
        callerE164: null, reason: "not-live",
      });
      await recordScreenedCall(db, {
        accountId, phoneNumberId: null, calledE164: screenedCalled,
        callerE164: null, reason: "over-cap",
      });
      // A generous limit — observed volume is ~8 refusals/day platform-wide
      // (DESIGN doc, "Known properties, accepted") — so both freshly-written
      // rows are certain to land inside it regardless of what else the
      // shared project's table holds.
      const rows = await listScreenedCalls(db, { limit: 500, class: "misconfigured" });
      const called = new Set(rows.map((r) => r.calledE164));
      expect(called.has(misconfiguredCalled)).toBe(true);
      expect(called.has(screenedCalled)).toBe(false);
    });
  });
});

describe("countScreenedCalls class filter", () => {
  it("counts only rows in the given class (mutation: drop the class .in() filter -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // Scoped to THIS account: `countScreenedCalls` counts across every
      // account by design (the page never passes `accountId`), so an
      // unscoped before/after delta here moves under a concurrent writer
      // elsewhere in the shared project — proven by running this file twice
      // at once, which turned this exact assertion into "expected 98 to be
      // 55" on an unrelated test in the same suite.
      const before = await countScreenedCalls(db, { class: "misconfigured", accountId });
      await recordScreenedCall(db, {
        accountId, phoneNumberId: null, calledE164: testScreenedCalledE164(),
        callerE164: null, reason: "not-live",
      });
      await recordScreenedCall(db, {
        accountId, phoneNumberId: null, calledE164: testScreenedCalledE164(),
        callerE164: null, reason: "over-cap",
      });
      const after = await countScreenedCalls(db, { class: "misconfigured", accountId });
      // Two rows written, ONE of them `misconfigured`.
      expect(after - before).toBe(1);
    });
  });
});

describe("countLinesTurningCallersAway", () => {
  it("counts DISTINCT numbers, not refusals (mutation: count(*) instead of count(distinct) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // Scoped to THIS account (see `countScreenedCalls class filter`'s own
      // comment above for why an unscoped delta is unsafe under concurrent
      // load) — the work-queue banner itself never passes this scope.
      const since = new Date(Date.now() - 3600_000).toISOString();
      const before = await countLinesTurningCallersAway(db, since, accountId);
      // Three refusals, ONE line. A dialer hammering one dead number is one
      // problem to fix, not three.
      for (let i = 0; i < 3; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: "+19565550300",
          callerE164: null, reason: "not-live",
        });
      }
      const after = await countLinesTurningCallersAway(db, since, accountId);
      expect(after - before).toBe(1);
    });
  });

  it("ignores `screened` and `unattributed` reasons (mutation: drop the reason filter -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const before = await countLinesTurningCallersAway(db, since, accountId);
      await recordScreenedCall(db, {
        accountId, phoneNumberId: null, calledE164: "+19565550400",
        callerE164: null, reason: "repeat-spam",
      });
      // `accountId: null` again — no cascade reaches this row, so it is
      // deleted by id in the finally below (see `testScreenedCalledE164`).
      const calledE164 = testScreenedCalledE164();
      let rowId: string | null = null;
      try {
        await recordScreenedCall(db, {
          accountId: null, phoneNumberId: null, calledE164,
          callerE164: null, reason: "unknown-number",
        });
        const { data, error } = await db.from("screened_calls")
          .select("id").eq("called_e164", calledE164).single();
        if (error) throw new Error(`readback failed: ${error.message}`);
        rowId = data.id as string;
        // A blocked robocall is the system working. It is not an outage and
        // must never raise the banner.
        expect(await countLinesTurningCallersAway(db, since, accountId)).toBe(before);
      } finally {
        if (rowId) await db.from("screened_calls").delete().eq("id", rowId);
      }
    });
  });
});

describe("countMisconfiguredScreenedCalls", () => {
  it("counts only the misconfigured reasons, never `screened` or `unattributed` (mutation: widen the reason filter to include `over-cap` -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // Scoped to THIS account — see `countScreenedCalls class filter`'s own
      // comment above; the list header this feeds is agency-wide and never
      // passes this scope itself.
      const before = await countMisconfiguredScreenedCalls(db, accountId);
      // One of each class. Only the first is `misconfigured`
      // (`screenedClass`'s own switch): `not-live` yes, `over-cap` no.
      await recordScreenedCall(db, {
        accountId, phoneNumberId: null, calledE164: "+19565550701",
        callerE164: null, reason: "not-live",
      });
      await recordScreenedCall(db, {
        accountId, phoneNumberId: null, calledE164: "+19565550702",
        callerE164: null, reason: "over-cap",
      });
      // `accountId: null` — no cascade reaches this row, so it is deleted by
      // id in the finally below (see `testScreenedCalledE164`'s own doc).
      const calledE164 = testScreenedCalledE164();
      let rowId: string | null = null;
      try {
        await recordScreenedCall(db, {
          accountId: null, phoneNumberId: null, calledE164,
          callerE164: null, reason: "unknown-number",
        });
        const { data, error } = await db.from("screened_calls")
          .select("id").eq("called_e164", calledE164).single();
        if (error) throw new Error(`readback failed: ${error.message}`);
        rowId = data.id as string;
        const after = await countMisconfiguredScreenedCalls(db, accountId);
        // Three rows written, ONE of them `misconfigured`.
        expect(after - before).toBe(1);
      } finally {
        if (rowId) await db.from("screened_calls").delete().eq("id", rowId);
      }
    });
  });

  it("is not limited to one page of results (mutation: swap the head-count for `.select(\"id\").limit(50)` + `(data ?? []).length` -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // Scoped to THIS account — see the sibling test's own comment above.
      // Proven load-bearing, not decorative: run this file twice
      // concurrently WITHOUT this scope and the second run's `before` reads
      // the first run's still-in-flight 55 rows, turning this exact
      // assertion into "expected 98 to be 55".
      const before = await countMisconfiguredScreenedCalls(db, accountId);
      // More than the list page's PAGE_SIZE (50) — a head-count query has no
      // page to be limited to, and this is the row count that would expose
      // a stray `.limit()` copied in from `listScreenedCalls`.
      //
      // A literal `.limit(50)` appended to the real `count: "exact",
      // head: true` request below is NOT the mutation that reproduces here —
      // verified by applying it directly, which left this test green. This
      // Supabase/PostgREST shape computes the exact count from a
      // `Content-Range` header derived from the full filtered match set,
      // independent of any `.limit()`/`.range()` on the same request, so an
      // actual `.limit(50)` on the head-count query is a silent no-op. What
      // DOES reproduce is replacing the head-count with the row-returning
      // shape `.select("id").limit(50)` and counting `(data ?? []).length`
      // instead — the mutation this test's name now names.
      for (let i = 0; i < 55; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null,
          calledE164: `+19565559${String(i).padStart(3, "0")}`,
          callerE164: null, reason: "no-profile",
        });
      }
      const after = await countMisconfiguredScreenedCalls(db, accountId);
      expect(after - before).toBe(55);
    });
  });
});

/**
 * THE PROOF THE WHOLE DESIGN EXISTS FOR.
 *
 * If a screened row ever reached `calls`, two things break silently: the
 * daily cap starts counting robocalls against the client's limit, and
 * `decideReputation` sees `otherCalls > 0` and un-blocks the caller it just
 * blocked. Both failures point toward letting spam through, and neither
 * would produce an error anywhere.
 */
describe("screened rows cannot contaminate the calls table", () => {
  it("leaves countCallsSince byte-identical (mutation: insert into `calls` from recordScreenedCall -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // A REAL phone number, not `phoneNumberId: null`. `calls.phone_number_id`
      // is `NOT NULL` (0019), so a null-shaped fixture can never produce a
      // `calls` row at all — the mutation this test is named for cannot even
      // attempt the write, and the guard proves nothing. Five of the six
      // reasons carry a real `phone_number_id` in production; this is that
      // shape.
      const pn = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 3600_000).toISOString();
      const before = await countCallsSince(db, accountId, since);
      for (let i = 0; i < 5; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: pn.id, calledE164: pn.e164,
          callerE164: "+19565550511", reason: "repeat-spam",
        });
      }
      // The null-number shape (`unknown-number`, nobody's account) alongside
      // the real-number writes above — kept so this file still exercises
      // BOTH representable shapes at this guard, even though (as proven by
      // injecting the mutation below) only the real-number shape can catch
      // an insert into `calls`: a null `account_id` on that table fails its
      // own `NOT NULL` constraint before the guard's assertion is ever
      // reached, real-number or not.
      const calledE164 = testScreenedCalledE164();
      let rowId: string | null = null;
      try {
        await recordScreenedCall(db, {
          accountId: null, phoneNumberId: null, calledE164,
          callerE164: null, reason: "unknown-number",
        });
        const { data, error } = await db.from("screened_calls")
          .select("id").eq("called_e164", calledE164).single();
        if (error) throw new Error(`readback failed: ${error.message}`);
        rowId = data.id as string;
        expect(await countCallsSince(db, accountId, since)).toBe(before);
      } finally {
        if (rowId) await db.from("screened_calls").delete().eq("id", rowId);
      }
    });
  });

  it("leaves the repeat-spam verdict's inputs byte-identical (mutation: as above -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // Same reasoning as the sibling test above: a real phone number is
      // required for the write this test guards against to even be
      // attemptable.
      const pn = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 3600_000).toISOString();
      const caller = "+19565550611";
      const before = await countCallerHistorySince(db, accountId, caller, since);
      for (let i = 0; i < 5; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: pn.id, calledE164: pn.e164,
          callerE164: caller, reason: "repeat-spam",
        });
      }
      const after = await countCallerHistorySince(db, accountId, caller, since);
      // `otherCalls` is the dangerous one: a single increment here would make
      // decideReputation return {blocked:false} for the rest of the window.
      expect(after).toEqual(before);
    });
  });
});
