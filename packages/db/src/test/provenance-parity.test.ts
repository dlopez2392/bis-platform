import { describe, it, expect } from "vitest";
import { withRollback } from "./db";
import { messageAuthor, bookingAuthor, contactAuthor, SEED_ACTORS, AUTHOR_KINDS } from "../provenance";
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
  // Item 8c (0091, plan Task 1): every (actor_type, actor_id) pair the two projects' contact.created events hold
  // (Task 0, read 2026-10-20: production's five, bis-ci's sixth), the blank id, and the shapes the app passes.
  const CONTACT_PAIRS: [ActorType, string][] = [
    ["user", "system_demo_seed"], ["system", "form"], ["ai", "voice"],
    ["user", "user_3H2QKPdnekiD0smDzYRIdDlf7am"], ["user", "user_3JK9XfDlTs2qgMVXtGf5UPRQNJb"],
    ["system", "system_ci_seed"], ["user", "   "],
    ["system", "public"], ["system", "sms-inbound"], ["ai", "concierge"], ["user", " system_demo_seed "],
  ];
  it("contacts: every actor pair the projects hold, and the blank id (mutation: map system_demo_seed to person in contactAuthor -> FAILS; in app.contact_author -> FAILS)", () =>
    withRollback(async (c) => {
      for (const [type, id] of CONTACT_PAIRS) {
        const { rows: [r] } = await c.query<{ k: string }>("select app.contact_author($1, $2) as k", [type, id]);
        expect(r!.k, `${type}:${JSON.stringify(id)}`).toBe(contactAuthor(type, id).authorKind);
      }
    }));
  it("contacts: the mapping itself (Q1: the two seeds are imports; ai is ai; a person carries their trimmed id; any other system actor is the customer) (mutation: drop a seed from SEED_ACTORS -> FAILS)", () => {
    expect(SEED_ACTORS).toEqual(["system_demo_seed", "system_ci_seed"]);
    expect(CONTACT_PAIRS.map(([t, id]) => `${t}:${id} ${JSON.stringify(contactAuthor(t, id))}`)).toEqual([
      `user:system_demo_seed {"authorKind":"import","authorId":null}`,
      `system:form {"authorKind":"customer","authorId":null}`,
      `ai:voice {"authorKind":"ai","authorId":null}`,
      `user:user_3H2QKPdnekiD0smDzYRIdDlf7am {"authorKind":"person","authorId":"user_3H2QKPdnekiD0smDzYRIdDlf7am"}`,
      `user:user_3JK9XfDlTs2qgMVXtGf5UPRQNJb {"authorKind":"person","authorId":"user_3JK9XfDlTs2qgMVXtGf5UPRQNJb"}`,
      `system:system_ci_seed {"authorKind":"import","authorId":null}`,
      `user:    {"authorKind":"person","authorId":null}`,
      `system:public {"authorKind":"customer","authorId":null}`,
      `system:sms-inbound {"authorKind":"customer","authorId":null}`,
      `ai:concierge {"authorKind":"ai","authorId":null}`,
      `user: system_demo_seed  {"authorKind":"import","authorId":null}`,
    ]);
    // A tab is not a space to btrim, so a tab-padded seed id is a person's id here and in SQL alike.
    expect(contactAuthor("user", "\tsystem_demo_seed")).toEqual({ authorKind: "person", authorId: "\tsystem_demo_seed" });
  });
  it("contacts: a tab-padded seed id gets the same kind on both sides (btrim strips spaces only) (mutation: .trim() in contactAuthor -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ k: string }>("select app.contact_author('user', $1) as k", ["\tsystem_demo_seed"]);
      expect(r!.k).toBe(contactAuthor("user", "\tsystem_demo_seed").authorKind);
      expect(r!.k).toBe("person");
    }));

  it("a person's id is trimmed of spaces, as btrim does, and an empty one is null (mutation: keep the padding -> FAILS)", () => {
    expect(messageAuthor("user", "  user_1  ", "outbound")).toEqual({ authorKind: "person", authorId: "user_1" });
    expect(bookingAuthor("user", "   ")).toEqual({ authorKind: "person", authorId: null });
    expect(messageAuthor("system", "automation", "outbound")).toEqual({ authorKind: "automation", authorId: null });
  });
});
