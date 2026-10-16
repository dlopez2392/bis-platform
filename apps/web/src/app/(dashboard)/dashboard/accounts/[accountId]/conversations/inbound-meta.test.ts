import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readInboundMeta } from "./inbound-meta";

/**
 * Fix round 1 (UI review, critical): `message-thread.tsx` is a SERVER
 * component. `inbound-notice.tsx` is `"use client"`, so an export from it
 * that is not itself a component becomes a client reference once bundled —
 * calling `readInboundMeta()` from a server file throws
 * "Attempted to call readInboundMeta() from the server" at runtime (same bug
 * class as `styleguide/rail-states.tsx:10-17`), even though every vitest run
 * here passes, because vitest never applies Next's RSC transform. `
 * readInboundMeta`/`InboundMeta` live in THIS plain module (no directive) so
 * both the server component and the client component can import them
 * safely; only the component itself stays in `inbound-notice.tsx`.
 */
describe("the inbound-email meta reader lives in a plain module, not the \"use client\" one", () => {
  it("inbound-meta.ts carries no \"use client\" directive (mutation: add the directive back → FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "./inbound-meta.ts"), "utf8");
    expect(src).not.toMatch(/^"use client";?/m);
  });

  it("message-thread.tsx (a server component) imports readInboundMeta from ./inbound-meta, never from the \"use client\" ./inbound-notice (mutation: import it from ./inbound-notice instead → FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "./message-thread.tsx"), "utf8");
    expect(src).toMatch(/import\s*\{[^}]*readInboundMeta[^}]*\}\s*from\s*"\.\/inbound-meta"/);
    expect(src).not.toMatch(/import\s*\{[^}]*readInboundMeta[^}]*\}\s*from\s*"\.\/inbound-notice"/);
  });

  it("inbound-notice.tsx (the \"use client\" component) does not re-declare readInboundMeta itself (mutation: define a local readInboundMeta again → FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "./inbound-notice.tsx"), "utf8");
    expect(src).not.toMatch(/export function readInboundMeta/);
  });
});

describe("readInboundMeta", () => {
  it("reads an inbound email's meta, and null for anything else (mutation: answer {} for a plain message → a notice renders on SMS, FAILS)", () => {
    expect(readInboundMeta({
      inbound_email_id: "re_1", attachment_count: 2,
      sender: { contact_id: "l", first_name: "Luis", last_name: "Ruiz" },
      consent: { kind: "stopped", eventId: "ev_1" },
    })).toEqual({ attachmentCount: 2, sender: { name: "Luis Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } });
    expect(readInboundMeta({})).toBeNull();
    expect(readInboundMeta(null)).toBeNull();
    expect(readInboundMeta(undefined)).toBeNull();
    expect(readInboundMeta({
      inbound_email_id: "re_1", attachment_count: 0, consent: { kind: "maybe", phrase: "remove me" },
    })).toEqual({ attachmentCount: 0, sender: null, consent: { kind: "maybe" } });
  });

  it("a sender with no stored name reads as an empty name string, not a crash (the component supplies the localized noName fallback)", () => {
    expect(readInboundMeta({
      inbound_email_id: "re_1", attachment_count: 0,
      sender: { contact_id: "l", first_name: null, last_name: null },
      consent: { kind: "none" },
    })).toEqual({ attachmentCount: 0, sender: { name: "" }, consent: { kind: "none" } });
  });
});
