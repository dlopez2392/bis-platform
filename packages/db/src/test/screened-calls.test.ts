import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import {
  recordScreenedCall, listScreenedCalls, countScreenedCalls,
  countLinesTurningCallersAway, countMisconfiguredScreenedCalls,
  screenedClass, SCREENED_REASONS,
} from "../screened-calls";
import { countCallsSince, countCallerHistorySince } from "../voice";
import { withTestAccount, testScreenedCalledE164 } from "./fixtures";

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

describe("countLinesTurningCallersAway", () => {
  it("counts DISTINCT numbers, not refusals (mutation: count(*) instead of count(distinct) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const before = await countLinesTurningCallersAway(db, new Date(Date.now() - 3600_000).toISOString());
      // Three refusals, ONE line. A dialer hammering one dead number is one
      // problem to fix, not three.
      for (let i = 0; i < 3; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: "+19565550300",
          callerE164: null, reason: "not-live",
        });
      }
      const after = await countLinesTurningCallersAway(db, new Date(Date.now() - 3600_000).toISOString());
      expect(after - before).toBe(1);
    });
  });

  it("ignores `screened` and `unattributed` reasons (mutation: drop the reason filter -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const before = await countLinesTurningCallersAway(db, since);
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
        expect(await countLinesTurningCallersAway(db, since)).toBe(before);
      } finally {
        if (rowId) await db.from("screened_calls").delete().eq("id", rowId);
      }
    });
  });
});

describe("countMisconfiguredScreenedCalls", () => {
  it("counts only the misconfigured reasons, never `screened` or `unattributed` (mutation: widen the reason filter to include `over-cap` -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const before = await countMisconfiguredScreenedCalls(db);
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
        const after = await countMisconfiguredScreenedCalls(db);
        // Three rows written, ONE of them `misconfigured`.
        expect(after - before).toBe(1);
      } finally {
        if (rowId) await db.from("screened_calls").delete().eq("id", rowId);
      }
    });
  });

  it("is not limited to one page of results (mutation: swap the head-count for `.select(\"id\").limit(50)` + `(data ?? []).length` -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const before = await countMisconfiguredScreenedCalls(db);
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
      const after = await countMisconfiguredScreenedCalls(db);
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
      const since = new Date(Date.now() - 3600_000).toISOString();
      const before = await countCallsSince(db, accountId, since);
      for (let i = 0; i < 5; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: "+19565550500",
          callerE164: "+19565550511", reason: "repeat-spam",
        });
      }
      expect(await countCallsSince(db, accountId, since)).toBe(before);
    });
  });

  it("leaves the repeat-spam verdict's inputs byte-identical (mutation: as above -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const caller = "+19565550611";
      const before = await countCallerHistorySince(db, accountId, caller, since);
      for (let i = 0; i < 5; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: "+19565550600",
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
