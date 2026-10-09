import { describe, it, expect } from "vitest";
import { contactSourceHint } from "./lead-source";

/**
 * F-157's drawer line. `contactSourceHint` is the READ-ONLY half shown next
 * to the editable `source` field — the system's own fact, never something
 * the owner types over. Priority, each strictly more specific than the
 * next: a word-of-mouth referral the source question captured
 * (`custom.referred_by`), then the attribution channel (AI assistant named
 * specifically, else the Website section's own bucket, "Direct" excluded as
 * uninformative), then — only once `source` itself is also empty — "Source
 * unknown" in plain words. A `source` that is already something (a form
 * name, "voice", "booking", an owner's own note) and no richer fact beyond
 * it needs no caption at all: null.
 */
describe("contactSourceHint", () => {
  it("names the specific AI assistant from the first-touch referrer (mutation: use channelOf's generic bucket here too → 'AI assistants' !== 'ChatGPT', FAILS)", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: null,
      attribution: { first: { ref: "https://chat.openai.com/c/abc" } },
    });
    expect(hint).toBe("Found through ChatGPT");
  });

  it("gemini.google.com reads as Gemini, never Google (the exact miscount the plan names)", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: null,
      attribution: { first: { ref: "https://gemini.google.com/app" } },
    });
    expect(hint).toBe("Found through Gemini");
  });

  it("falls back to the generic channel for a non-assistant referrer", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: null,
      attribution: { first: { ref: "https://www.google.com/search?q=roofing" } },
    });
    expect(hint).toBe("Found through Google");
  });

  it("a Direct referrer (no ref at all, or an empty one) is uninformative and caps nothing (mutation: treat Direct as a real channel → FAILS, this would say 'Found through Direct')", () => {
    expect(contactSourceHint({ source: "booking", custom: null, attribution: { first: { ref: "" } } })).toBeNull();
    expect(contactSourceHint({ source: "booking", custom: null, attribution: {} })).toBeNull();
    expect(contactSourceHint({ source: "booking", custom: null, attribution: null })).toBeNull();
  });

  it("a referred-by answer outranks the attribution channel (mutation: swap the priority → FAILS)", () => {
    const hint = contactSourceHint({
      source: "form: Contact us",
      custom: { referred_by: "Jane Smith" },
      attribution: { first: { ref: "https://chat.openai.com/" } },
    });
    expect(hint).toBe("Referred by Jane Smith");
  });

  it("nothing captured at all says so in plain words, never guessed (mutation: return null here → the drawer shows a blank indistinguishable from 'not built yet', FAILS)", () => {
    expect(contactSourceHint({ source: null, custom: null, attribution: null })).toBe("Source unknown");
  });

  it("a known literal source with no richer fact needs no caption (mutation: always return a string → FAILS, the line would double up with the editable value)", () => {
    expect(contactSourceHint({ source: "voice", custom: null, attribution: null })).toBeNull();
  });

  it("malformed custom/attribution (never trusted jsonb) are read as absent, not thrown (mutation: cast instead of check → throws on a string custom, FAILS)", () => {
    expect(() => contactSourceHint({ source: null, custom: "not an object", attribution: "also not an object" }))
      .not.toThrow();
    expect(contactSourceHint({ source: null, custom: "not an object", attribution: "also not an object" }))
      .toBe("Source unknown");
  });

  it("a blank referred_by (whitespace only) is treated as not answered", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: { referred_by: "   " }, attribution: null,
    });
    expect(hint).toBeNull();
  });
});
