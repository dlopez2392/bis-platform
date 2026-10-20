import type { ActKindDef } from "./types";

/**
 * Sofía (or the web chat) added this customer. Undo removes them, an Owner only (deletion is, 0066), and only
 * while they hold nothing but her own call or chat (0091's `ai_contact_held_by`). A booking, even a cancelled
 * one, keeps them, with its own reason (owner Q4).
 */
export const contactCreatedKind: ActKindDef<"contact_created"> = {
  kind: "contact_created",
  control: "contact",
  describe(_act, { tr }) {
    return { verb: tr.text("aiActs.verb.contactCreated"), detail: null };
  },
  stillSafe(act, facts) {
    if (!facts.canDelete) return { ok: false, reason: "ownerOnly" };
    const held = facts.heldBy[act.id];
    // Not read for this act: never shown as safe on a guess.
    if (!held) return { ok: false, reason: "hasActivity" };
    if (held.includes("bookings")) return { ok: false, reason: "hasBooking" };
    if (held.length > 0) return { ok: false, reason: "hasActivity" };
    return { ok: true };
  },
};
