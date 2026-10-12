import { describe, it, expect } from "vitest";
import { withRollback } from "./db";
import { messageAuthor, bookingAuthor, AUTHOR_KINDS } from "../provenance";
import type { ActorType } from "../events";

/**
 * The backfill's CASE (app.message_author / app.booking_author, 0073) and the TypeScript the app
 * writes with (provenance.ts) give the same kind for every actor the app passes (spec §12.2; the
 * dedupe-keys parity pattern, 0033/0034). A NULL actor (no event) exists only in SQL and is pinned
 * by the backfill test in record-provenance-schema.test.ts.
 */
const ACTORS: ActorType[] = ["user", "system", "ai"];

describe("provenance parity: SQL and TypeScript agree (spec §5.2, §12.2)", () => {
  it("messages: every actor type x direction (mutation: map system->customer in messageAuthor -> FAILS; map inbound ai->customer in app.message_author -> FAILS)", () =>
    withRollback(async (c) => {
      for (const actor of ACTORS) {
        for (const direction of ["inbound", "outbound"] as const) {
          const { rows: [r] } = await c.query<{ k: string }>("select app.message_author($1, $2) as k", [actor, direction]);
          expect(r!.k, `${actor} ${direction}`).toBe(messageAuthor(actor, "x", direction).authorKind);
        }
      }
    }));
  it("bookings: every actor type, with and without an ip hash (an event always outranks the ip) (mutation: map system->automation in app.booking_author -> FAILS)", () =>
    withRollback(async (c) => {
      for (const actor of ACTORS) {
        for (const hasIp of [true, false]) {
          const { rows: [r] } = await c.query<{ k: string }>("select app.booking_author($1, $2) as k", [actor, hasIp]);
          expect(r!.k, `${actor} ip=${hasIp}`).toBe(bookingAuthor(actor, "x").authorKind);
        }
      }
    }));
  it("every kind either side produces is one of the five (mutation: return 'system' from messageAuthor -> FAILS by type and here)", () => {
    for (const actor of ACTORS) {
      for (const d of ["inbound", "outbound"] as const) expect(AUTHOR_KINDS).toContain(messageAuthor(actor, "x", d).authorKind);
      expect(AUTHOR_KINDS).toContain(bookingAuthor(actor, "x").authorKind);
    }
  });
  it("a person's id is trimmed of spaces, as btrim does, and an empty one is null (mutation: keep the padding -> FAILS)", () => {
    expect(messageAuthor("user", "  user_1  ", "outbound")).toEqual({ authorKind: "person", authorId: "user_1" });
    expect(bookingAuthor("user", "   ")).toEqual({ authorKind: "person", authorId: null });
    expect(messageAuthor("system", "automation", "outbound")).toEqual({ authorKind: "automation", authorId: null });
  });
});
