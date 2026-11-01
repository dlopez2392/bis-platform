import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import type { DuplicatePair } from "@bis/db";

/**
 * F-006 part 1 (plan Task 11, spec §6.1): "May be the same person as {name} · {reason} · Compare"
 * under the record header (and the drawer's header section, same component). Shows the STRONGEST
 * open pair — `duplicatePairsOf` answers strongest first — and "and N more" when there is more than
 * one. Hidden entirely with no pairs, or when `canMerge` is false (a Technician).
 */
const { DuplicateLine } = await import("./duplicate-line");
const { compareHref } = await import("@/lib/contacts/duplicates");

const SELF = "ct-self";
const PHONE: DuplicatePair = {
  id: "p1", a: { id: SELF, firstName: "Ana", lastName: "Reyes" }, b: { id: "c-maria", firstName: "María", lastName: "García" },
  reason: "same_phone", strength: 1, createdAt: "2026-10-01T00:00:00Z",
};
const NAME: DuplicatePair = {
  id: "p2", a: { id: SELF, firstName: "Ana", lastName: "Reyes" }, b: { id: "c-jose", firstName: "José", lastName: "Ruiz" },
  reason: "same_name", strength: 9, createdAt: "2026-10-02T00:00:00Z",
};

function render(pairs: DuplicatePair[], canMerge = true, locale: "en" | "es" = "en"): string {
  return renderToStaticMarkup(createElement(DuplicateLine, { accountId: "a1", contactId: SELF, pairs, canMerge, locale }));
}

describe("DuplicateLine (F-006 part 1, plan Task 11, spec §6.1)", () => {
  it("names the STRONGEST pair's other person and reason, 'and 1 more', and a Compare link to the strongest pair (mutation: render the last pair -> FAILS)", () => {
    const html = render([PHONE, NAME]);
    const text = renderedText(html);
    expect(text).toContain("May be the same person as María García");
    expect(text).toContain("same phone number");
    expect(text).toContain("and 1 more");
    // React escapes `&` to `&amp;` in static markup (the same entity trap `renderedText` exists for).
    expect(html).toContain(`href="${compareHref("a1", PHONE).replace(/&/g, "&amp;")}"`);
  });

  it("a single pair names no 'more' line (mutation: always show bannerMoreOne -> FAILS)", () => {
    const text = renderedText(render([PHONE]));
    expect(text).toContain("María García");
    expect(text).not.toContain("more");
  });

  it("with no open pairs, renders nothing (mutation: render an empty line -> FAILS)", () => {
    expect(render([])).toBe("");
  });

  it("with canMerge false, renders nothing even with open pairs (mutation: ignore canMerge -> FAILS)", () => {
    expect(render([PHONE], false)).toBe("");
  });

  it("is not role=\"status\": nothing changed just now, there is nothing to announce (mutation: add role=status -> FAILS)", () => {
    expect(render([PHONE])).not.toContain('role="status"');
  });

  // S-10 leftovers (#317 follow-up): the OTHER contact's name is built with contactDisplayName
  // with no locale — a nameless other contact read English even on a Spanish screen.
  it("a nameless other contact's stand-in reads the Spanish placeholder (mutation: call contactDisplayName with no locale -> FAILS)", () => {
    const unnamed: DuplicatePair = {
      id: "p3", a: { id: SELF, firstName: "Ana", lastName: "Reyes" }, b: { id: "c-blank", firstName: null, lastName: null },
      reason: "same_phone", strength: 1, createdAt: "2026-10-01T00:00:00Z",
    };
    const text = renderedText(render([unnamed], true, "es"));
    expect(text).toContain(m["contact.noName.es"]);
    expect(text).not.toContain(m["contact.noName"]);
  });

  it("the Compare link is next/link, never a plain <a> (fix round, minor 10; mutation: revert to a bare <a> -> FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./duplicate-line.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/import Link from "next\/link"/);
    expect(src).not.toMatch(/<a\s/);
  });
});
