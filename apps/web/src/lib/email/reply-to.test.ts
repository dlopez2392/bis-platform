import { describe, expect, it } from "vitest";
import { normalizeReplyTo } from "./reply-to";

describe("normalizeReplyTo", () => {
  it("returns the address when there is one", () => {
    expect(normalizeReplyTo("hello@rioroofing.com")).toBe("hello@rioroofing.com");
    expect(normalizeReplyTo("  hello@rioroofing.com  ")).toBe("hello@rioroofing.com");
  });

  // The whole reason this function exists. `replyTo: ""` is a header with an
  // empty value, which is NOT the same as omitting the header — and every one
  // of these spellings of "absent" reaches the send path: an unset column is
  // null, a cleared form field is "", and a form with no email question yields
  // "" from enrich's byKind map.
  it("returns undefined for every flavour of absent", () => {
    expect(normalizeReplyTo(null)).toBeUndefined();
    expect(normalizeReplyTo(undefined)).toBeUndefined();
    expect(normalizeReplyTo("")).toBeUndefined();
    expect(normalizeReplyTo("   ")).toBeUndefined();
  });
});
