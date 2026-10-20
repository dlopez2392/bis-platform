import type { ActorType } from "./events";

/**
 * DESIGN.md, Provenance: every timeline row names who made it, from ONE closed set. The same five
 * values as the CHECKs in 0073_record_provenance.sql; a sixth is a compile error here and a 23514 there.
 */
export const AUTHOR_KINDS = ["person", "ai", "automation", "customer", "import"] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];
export type RowAuthor = { authorKind: AuthorKind; authorId: string | null };

/** SQL's btrim(x): spaces only, both ends (never `.trim()`, which strips a superset). */
const btrim = (s: string) => s.replace(/^ +| +$/g, "");

/**
 * Who wrote a message (spec §5.2), from the actor its writer already passes to createMessage. The
 * ONLY place this mapping lives in TypeScript; app.message_author (0073) is its SQL twin, pinned by
 * provenance-parity.test.ts. An inbound message is the customer's unless the receptionist filed it.
 */
export function messageAuthor(actorType: ActorType, actorId: string, direction: "inbound" | "outbound"): RowAuthor {
  if (actorType === "ai") return { authorKind: "ai", authorId: null };
  if (direction === "inbound") return { authorKind: "customer", authorId: null };
  if (actorType === "user") return { authorKind: "person", authorId: btrim(actorId) || null };
  return { authorKind: "automation", authorId: null };
}

/**
 * Who made a booking (spec §5.2). `system` is the public booking page and its move page (the
 * customer); `ai` is the receptionist; `user` a person (no staff path books today). SQL twin:
 * app.booking_author.
 */
export function bookingAuthor(actorType: ActorType, actorId: string): RowAuthor {
  if (actorType === "ai") return { authorKind: "ai", authorId: null };
  if (actorType === "system") return { authorKind: "customer", authorId: null };
  return { authorKind: "person", authorId: btrim(actorId) || null };
}

/** The demo tenant's daily seed and the CI seed write contacts under these actor ids; their contacts are
 *  imports, whatever the actor type (owner decision Q1, item 8c). */
export const SEED_ACTORS = ["system_demo_seed", "system_ci_seed"] as const;

/**
 * Who created a contact (item 8c, spec §5.3), from the actor its writer passes to createContact. SQL twin:
 * app.contact_author (0091), pinned by provenance-parity.test.ts. `ai` is the receptionist or the web chat;
 * a seed actor id is an import; `user` is a person (with their id); any other `system` actor (the public
 * form, the booking page, an inbound text) is the customer.
 */
export function contactAuthor(actorType: ActorType, actorId: string): RowAuthor {
  if (actorType === "ai") return { authorKind: "ai", authorId: null };
  if ((SEED_ACTORS as readonly string[]).includes(btrim(actorId))) return { authorKind: "import", authorId: null };
  if (actorType === "user") return { authorKind: "person", authorId: btrim(actorId) || null };
  return { authorKind: "customer", authorId: null };
}
