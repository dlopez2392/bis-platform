import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// The menu and the Keep button reach the app router and the shell's pathname, which a static render has
// not mounted.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/dashboard/styleguide" }));
const { BusinessStatusDemo } = await import("./business-status-demo");

/**
 * S-47d fix round D12: the one switch's specimens are the REAL components with static props, so this
 * page cannot drift from the topbar and the dashboard card.
 */
describe("styleguide: the one switch", () => {
  const html = renderToStaticMarkup(createElement(BusinessStatusDemo));
  const text = renderedText(html).replace(/\s+/g, " ");

  it("the trigger, named by its status words then the phrase, in English and Spanish, and Open", () => {
    expect(html).toContain('<span class="sr-only">, Change today&#x27;s status</span>');
    expect(html).toContain('<span class="sr-only">, Cambiar el estado de hoy</span>');
    expect(text).toContain("Closed today · opens 8 AM");
    expect(text).toContain("Cerrado hoy · abre a las 8 AM");
    expect(text).toContain(m["business.topbar.open"]);
  });

  it("the card open (with its next closed day), closed with its rows, running late, a storm with none affected, and failed", () => {
    for (const id of ["open", "closed", "closed-es", "late", "storm"]) {
      expect(html).toContain(`id="sg-business-status-${id}"`);
    }
    expect(text).toContain("Next closed day: Thursday, June 10 (holiday)");
    expect(text).toContain("Jun 7, 2:00 PM · Ana Reyes");
    expect(text).toContain("7 de jun., 2:00 PM · Ana Reyes");
    expect(text).toContain("2 messages waiting");
    expect(text).toContain(m["business.card.kept"]);
    expect(text).toContain(m["contact.noName"]);
    expect(text).toContain(m["business.card.lateHidden"].replace("{minutes}", "30"));
    expect(text).toContain(m["business.card.noneAffected"]);
    expect(text).toContain(m["business.card.error"]);
  });

  it("never repeats the real card's anchor, and every specimen box stays inside the phone width rules", () => {
    expect(html).not.toContain('id="business-status"');
    expect(html.match(/class="w-full min-w-0 max-w-md"/g)?.length).toBe(6);
  });
});
