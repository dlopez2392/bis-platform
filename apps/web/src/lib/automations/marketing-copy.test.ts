import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { marketingFooterReason } from "./marketing-copy";

/**
 * The footer line both MARKETING emails print — the check-in (decision A,
 * 2026-09-22) and the referral ask (B21, 2026-09-23). Moved here from
 * `reactivation-copy.test.ts` with the function, when it stopped being the
 * check-in's alone; the cases are the ones that file carried.
 */
describe("marketingFooterReason", () => {
  it("the footer says WHY they are getting it and HOW TO STOP it, naming the brand — and a reply, never a link", () => {
    // The opt-out is "reply and let us know", because neither template
    // carries a link of any kind and both recipes' call to action is already
    // "reply to this email". Mutation: drop "reply" from
    // `automations.reactivation.footerReason` → this reds BY NAME.
    expect(marketingFooterReason("Rio Roofing")).toBe(
      "You're getting this because you've been a customer of Rio Roofing. "
      + "If you'd rather not hear from us, reply and let us know.");
    for (const name of ["Rio Roofing", ""]) {
      const s = marketingFooterReason(name);
      expect(s.toLowerCase(), name).toContain("reply and let us know");
      expect(s, name).not.toContain("http");
      expect(s.toLowerCase(), name).not.toContain("unsubscribe");
    }
  });

  it("the footer drops the brand clause when there is no brand name — never 'a customer of .'", () => {
    // THE EXACT STRING. Mutation: delete the `if (!brandName.trim())` branch
    // in `marketingFooterReason` → this reds BY NAME with "a customer of    .".
    expect(marketingFooterReason("   ")).toBe(m["automations.reactivation.footerReasonNoName"]);
    expect(marketingFooterReason("")).toBe(m["automations.reactivation.footerReasonNoName"]);
    expect(marketingFooterReason("A $& B")).toContain("a customer of A $& B.");
  });

  it("carries no internal milestone code and no template syntax", () => {
    for (const s of [marketingFooterReason("Rio Roofing"), marketingFooterReason("")]) {
      expect(s).not.toMatch(/\bM\d[a-z]?\b/);
      expect(s).not.toContain("{{");
      expect(s).not.toContain("{name}");
    }
  });
});
