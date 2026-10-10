import { describe, it, expect, vi, afterEach } from "vitest";
import type { serviceDb } from "@bis/db";

// Only `loadMoveContextSafe` reaches `serviceDb()`; every other test hands
// `readMoveContext` its own stub.
const safeDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  serviceDb: () => safeDb.current,
}));

import { readMoveContext, moveState, MOVE_CHAIN_MAX, loadMoveContextSafe } from "./data";

/**
 * Fix round 3: the REAL `readMoveContext`, on a stub database that answers
 * the four reads it makes (the booking by token, the account's calendar, the
 * account, and `rescheduleChain`'s walk, one row per hop). Every cap test
 * elsewhere hands the action a context with `depth` already set, so only
 * this proves the depth is actually READ — and that a walk that fails, or
 * runs past the chain's bound, fails SAFE (capped), never open.
 */
const TOKEN = "abcdefghijkmnpqrstuvwxyz";
type Row = { id: string; rescheduled_from_id: string | null };

function stubDb(chain: Record<string, Row>, opts: { walkFails?: boolean } = {}) {
  const booking = {
    id: "b3", account_id: "a1", calendar_id: "cal1", contact_id: "c1", status: "booked",
    starts_at: "2030-01-01T15:00:00Z", ends_at: "2030-01-01T16:00:00Z",
    note: null, cancel_token: TOKEN, booker_timezone: null, reminder_sent_at: null,
  };
  return {
    from: (table: string) => {
      const eqs: Record<string, unknown> = {};
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => { eqs[k] = v; return b; },
        maybeSingle: async () => {
          if (table === "accounts") return { data: { timezone: "UTC" }, error: null };
          if (table === "calendars") {
            return { data: { id: "cal1", account_id: "a1", public_id: "pub1", enabled: true }, error: null };
          }
          if (eqs.cancel_token === TOKEN) return { data: booking, error: null };
          if (opts.walkFails) return { data: null, error: { message: `boom on ${String(eqs.id)}` } };
          return { data: chain[String(eqs.id)] ?? null, error: null };
        },
      };
      return b;
    },
  } as unknown as ReturnType<typeof serviceDb>;
}

afterEach(() => vi.restoreAllMocks());

describe("readMoveContext — the chain depth is read, and a bad walk fails safe", () => {
  it("a booking moved twice reads depth 2, rescheduleChain's own answer (mutation: drop the depth computation → 0, FAILS)", async () => {
    const chain: Record<string, Row> = {
      b3: { id: "b3", rescheduled_from_id: "b2" },
      b2: { id: "b2", rescheduled_from_id: "b1" },
      b1: { id: "b1", rescheduled_from_id: null },
    };
    const ctx = await readMoveContext(stubDb(chain), TOKEN);
    expect(ctx?.depth).toBe(2);
  });

  it("a booking already moved MOVE_CHAIN_MAX times reads as capped", async () => {
    const chain: Record<string, Row> = { b3: { id: "b3", rescheduled_from_id: "h0" } };
    for (let i = 0; i < MOVE_CHAIN_MAX; i++) {
      chain[`h${i}`] = { id: `h${i}`, rescheduled_from_id: i + 1 < MOVE_CHAIN_MAX ? `h${i + 1}` : null };
    }
    const ctx = await readMoveContext(stubDb(chain), TOKEN);
    expect(ctx!.depth).toBe(MOVE_CHAIN_MAX + 0);
    expect(moveState(ctx!, new Date("2029-01-01T00:00:00Z"))).toBe("capped");
  });

  it("a walk that fails, or a chain past its bound, is CAPPED — contact the business — never an error page and never the picker; logged once, without the token (mutation: let the walk throw → FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await readMoveContext(stubDb({}, { walkFails: true }), TOKEN);
    expect(moveState(failed!, new Date("2029-01-01T00:00:00Z"))).toBe("capped");
    // A cycle: the walk never finds a root and runs past its bound.
    const cycle = await readMoveContext(stubDb({
      b3: { id: "b3", rescheduled_from_id: "x" }, x: { id: "x", rescheduled_from_id: "b3" },
    }), TOKEN);
    expect(moveState(cycle!, new Date("2029-01-01T00:00:00Z"))).toBe("capped");
    expect(errors).toHaveBeenCalledTimes(2);
    const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toMatch(/chain/);
    expect(logged).not.toContain(TOKEN);
  });
});

/**
 * Fix round 4: `loadMoveContextSafe` is what the cancel page (and the move
 * page's metadata and layout) read through. A failed read must answer null —
 * the cancel page then offers no move and keeps its cancel form — never
 * throw, and never log the token.
 */
describe("loadMoveContextSafe — a failed read is null, never an error, never the token in a log", () => {
  it("the token look-up fails quoting the token: null, one log line without it (mutation: rethrow → FAILS)", async () => {
    safeDb.current = {
      from: () => {
        const b = {
          select: () => b, eq: () => b,
          maybeSingle: async () => ({ data: null, error: { message: `no read for cancel_token=${TOKEN}` } }),
        };
        return b;
      },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadMoveContextSafe(TOKEN)).resolves.toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toMatch(/booking read failed/);
    expect(logged).not.toContain(TOKEN);
  });
});
