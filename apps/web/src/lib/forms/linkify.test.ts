import { describe, it, expect } from "vitest";
import { labelParts } from "./linkify";

describe("labelParts", () => {
  it("returns a label with no URL unchanged, as a single text part", () => {
    // The regression guard for every consent field that existed before this:
    // they must render exactly as they did.
    expect(labelParts("I agree to be contacted."))
      .toEqual([{ kind: "text", value: "I agree to be contacted." }]);
    expect(labelParts("")).toEqual([{ kind: "text", value: "" }]);
  });

  it("splits out an https URL and keeps the surrounding text", () => {
    expect(labelParts("See https://bis-rgv.com/en/privacy for details")).toEqual([
      { kind: "text", value: "See " },
      { kind: "link", value: "https://bis-rgv.com/en/privacy" },
      { kind: "text", value: " for details" },
    ]);
  });

  it("leaves a sentence's final punctuation out of the link", () => {
    // The single most common way this kind of helper ships broken: a policy
    // link that 404s because it carries the full stop that ended the sentence.
    expect(labelParts("Privacy policy: https://bis-rgv.com/en/privacy.")).toEqual([
      { kind: "text", value: "Privacy policy: " },
      { kind: "link", value: "https://bis-rgv.com/en/privacy" },
      { kind: "text", value: "." },
    ]);
    expect(labelParts("(https://bis-rgv.com/en/terms)")).toEqual([
      { kind: "text", value: "(" },
      { kind: "link", value: "https://bis-rgv.com/en/terms" },
      { kind: "text", value: ")" },
    ]);
  });

  it("handles more than one URL in a disclosure", () => {
    // The real shape: an SMS opt-in names both the terms and the privacy
    // policy, which is exactly what campaign vetting asks for.
    expect(labelParts("Terms https://a.example/t and privacy https://a.example/p")).toEqual([
      { kind: "text", value: "Terms " },
      { kind: "link", value: "https://a.example/t" },
      { kind: "text", value: " and privacy " },
      { kind: "link", value: "https://a.example/p" },
    ]);
  });

  it("never produces a link from a scheme that is not https", () => {
    // By construction, not by filtering. A form's fields are editable by
    // anyone with access to the account, and the label is rendered on a page
    // embedded in the client's own site.
    for (const label of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://bis-rgv.com/en/privacy",
      "bis-rgv.com/en/privacy",
      "https://",
    ]) {
      expect(labelParts(label), label).toEqual([{ kind: "text", value: label }]);
    }
  });

  it("reassembles to exactly the original label", () => {
    // The property that matters: this decides what is a link ON SCREEN and
    // changes nothing about the string. The same label is stored verbatim as
    // the consent record, and a renderer that quietly dropped a character
    // would put the screen and the record out of step.
    for (const label of [
      "I agree to receive texts. See https://bis-rgv.com/en/privacy.",
      "no urls here",
      "https://a.example/x",
      "trailing space ",
      "https://a.example/x and https://b.example/y!",
    ]) {
      expect(labelParts(label).map((p) => p.value).join(""), label).toBe(label);
    }
  });
});
