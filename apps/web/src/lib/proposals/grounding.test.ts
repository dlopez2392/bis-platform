import { describe, it, expect } from "vitest";
import { isGrounded } from "./grounding";
import type { TranscriptEvent } from "@bis/db";

const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2026-09-18T12:00:00.000Z" });

describe("isGrounded", () => {
  const transcript = [
    t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
    t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
  ];

  it("accepts a span the caller actually said", () => {
    expect(isGrounded("Call me Tuesday morning", transcript)).toBe(true);
  });

  it("is insensitive to case and surrounding whitespace", () => {
    expect(isGrounded("  call me TUESDAY morning  ", transcript)).toBe(true);
  });

  it("REJECTS a plausible sentence nobody said (mutation: return true unconditionally -> FAILS)", () => {
    expect(isGrounded("Call me Thursday morning", transcript)).toBe(false);
  });

  it("rejects a span assembled across two different turns", () => {
    expect(isGrounded("How can I help? I need a quote", transcript)).toBe(false);
  });

  it("rejects empty or whitespace evidence (mutation: drop the length floor -> FAILS)", () => {
    expect(isGrounded("", transcript)).toBe(false);
    expect(isGrounded("   ", transcript)).toBe(false);
  });

  // The floor is what stops a one-word "yes" — present in almost every
  // transcript — from grounding an arbitrary proposal.
  it("rejects a span too short to be evidence of anything", () => {
    expect(isGrounded("a", transcript)).toBe(false);
    expect(isGrounded("quote", transcript)).toBe(false);
  });

  it("rejects everything against an empty transcript", () => {
    expect(isGrounded("Call me Tuesday morning", [])).toBe(false);
  });

  // Only the CALLER's words are evidence. Sofía's own sentences are the
  // model quoting itself, which grounds nothing.
  it("does not accept the assistant's own words as evidence (mutation: drop the role filter -> FAILS)", () => {
    expect(isGrounded("Thanks for calling 956 Woodworks", transcript)).toBe(false);
  });
});
