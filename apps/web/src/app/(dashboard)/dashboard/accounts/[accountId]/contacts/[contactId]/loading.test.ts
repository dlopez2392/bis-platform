import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The record page's loading state (final review I1, DESIGN.md rule 7). The page awaits every
 * loader, so without this route-level skeleton the cards' "loading" state could never show. A desk:
 * the three "have" cards render open, so every card's skeleton can be read.
 */
vi.mock("@/components/record/use-phone", () => ({ usePhone: () => false, PHONE_QUERY: "(max-width: 767px)" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { default: Loading } = await import("./loading");
const { LocaleProvider } = await import("@/components/locale-provider");
const { cardsInPhoneOrder } = await import("@/lib/record/record-cards");
const { m } = await import("@/lib/messages");

const cards = (html: string) => [...html.matchAll(/<section[^>]*data-record-card="([\w-]+)"[^>]*data-state="(\w+)"[\s\S]*?<\/section>/g)]
  .map((x) => ({ id: x[1], state: x[2], skeleton: x[0].includes("data-record-skeleton") }));

describe("contact record page loading.tsx", () => {
  it("renders one loading card per registry entry, in the phone order that is the DOM order, each a skeleton (rule 7; mutation: drop a card -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(Loading));
    expect(html).toContain("data-record-layout");
    expect(cards(html)).toEqual(cardsInPhoneOrder().map((d) => ({ id: d.id, state: "loading", skeleton: true })));
    // A skeleton header, never a spinner.
    expect(html).toMatch(/<header[^>]*data-record-skeleton-header/);
    expect(html).not.toMatch(/animate-spin|spinner/i);
  });

  it("the titles and the page's lang follow the locale the account layout provided (mutation: hard-code English titles -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es", children: createElement(Loading) }));
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
    expect(html).toContain(m["record.card.nextUp.es"]);
  });
});
