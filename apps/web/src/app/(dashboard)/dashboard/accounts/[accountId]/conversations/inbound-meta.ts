/**
 * The thread bubble's inbound-email meta reader (S-06 part 1, Task 11).
 *
 * Fix round 1 (UI review, critical): this used to live in `inbound-notice.tsx`,
 * which is `"use client"`. `message-thread.tsx` — a SERVER component — called
 * `readInboundMeta` straight off that module; once bundled, a non-component
 * export of a `"use client"` file becomes a client REFERENCE, and calling it
 * from server code throws "Attempted to call readInboundMeta() from the
 * server" on every thread with a filed reply (same bug class as
 * `styleguide/rail-states.tsx:10-17`). Vitest never surfaces this, because it
 * does not apply Next's RSC transform — the guard test in
 * `inbound-meta.test.ts` instead pins the import SITE: `message-thread.tsx`
 * imports `readInboundMeta` from here, never from `./inbound-notice`.
 *
 * This module carries no directive at all, so either a server or a client
 * component may import it. Only the COMPONENT (`InboundNotice`) stays in
 * `inbound-notice.tsx`.
 */
export type InboundMeta = {
  attachmentCount: number;
  sender: { name: string } | null;
  consent: { kind: "stopped"; eventId: string } | { kind: "maybe" } | { kind: "none" };
};

type RawSender = { contact_id?: string; first_name?: string | null; last_name?: string | null } | null | undefined;
type RawConsent = { kind?: string; eventId?: string } | null | undefined;
type RawMeta = {
  inbound_email_id?: string;
  attachment_count?: number;
  sender?: RawSender;
  consent?: RawConsent;
};

/** `null` for any message that is not an inbound email (`file.ts` stamps `inbound_email_id` on
 *  every one it files; nothing else in `messages.meta` ever carries that key). A sender with no
 *  stored name reads as an empty string, not a crash — the component supplies the localized
 *  noName fallback (`contactDisplayName`'s own fallback key), since locale is not known here. */
export function readInboundMeta(meta: unknown): InboundMeta | null {
  if (!meta || typeof meta !== "object" || !("inbound_email_id" in meta)) return null;
  const raw = meta as RawMeta;
  const sender = raw.sender
    ? { name: [raw.sender.first_name, raw.sender.last_name].filter((part): part is string => Boolean(part)).join(" ") }
    : null;
  const consent: InboundMeta["consent"] =
    raw.consent?.kind === "stopped" && raw.consent.eventId
      ? { kind: "stopped", eventId: raw.consent.eventId }
      : raw.consent?.kind === "maybe"
        ? { kind: "maybe" }
        : { kind: "none" };
  return { attachmentCount: raw.attachment_count ?? 0, sender, consent };
}
