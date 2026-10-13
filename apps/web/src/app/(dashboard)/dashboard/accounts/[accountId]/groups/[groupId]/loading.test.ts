import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The group page's loading state (S-03 part 2, C17; DESIGN.md rule 7). The page awaits every
 * loader, so this route-level skeleton is the only place the cards' "loading" state shows. A desk:
 * the two "have" cards render open, so every card's skeleton can be read.
 */
vi.mock("@/components/record/use-phone", () => ({ usePhone: () => false, PHONE_QUERY: "(max-width: 767px)" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { default: Loading } = await import("./loading");
const { LocaleProvider } = await import("@/components/locale-provider");
const { GROUP_RECORD_CARDS, cardsInPhoneOrder } = await import("@/lib/record/record-cards");
const { m } = await import("@/lib/messages");

const cards = (html: string) => [...html.matchAll(/<section[^>]*data-record-card="([\w-]+)"[^>]*data-state="(\w+)"[\s\S]*?<\/section>/g)]
  .map((x) => ({ id: x[1], state: x[2], skeleton: x[0].includes("data-record-skeleton") }));

describe("group record page loading.tsx", () => {
  it("renders one loading card per GROUP_RECORD_CARDS entry, in the phone order that is the DOM order, each a skeleton (rule 7; mutation: draw the contact page's RECORD_CARDS -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(Loading));
    expect(html).toContain("data-record-layout");
    expect(cards(html)).toEqual(cardsInPhoneOrder(GROUP_RECORD_CARDS).map((d) => ({ id: d.id, state: "loading", skeleton: true })));
    expect(cards(html).map((c) => c.id)).toEqual(["properties", "deals", "people", "details"]);
    // A skeleton header, never a spinner.
    expect(html).toMatch(/<header[^>]*data-record-skeleton-header/);
    expect(html).not.toMatch(/animate-spin|spinner/i);
  });

  it("each card draws as many skeleton lines as its registry entry says (mutation: a fixed row count -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(Loading));
    for (const def of GROUP_RECORD_CARDS) {
      const card = html.match(new RegExp(`<section[^>]*data-record-card="${def.id}"[\\s\\S]*?</section>`))![0];
      expect(card.match(/data-slot="skeleton"/g), def.id).toHaveLength(def.skeletonRows);
    }
  });

  it("the titles and the page's lang follow the locale the account layout provided (mutation: hard-code English titles -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" } as never, createElement(Loading)));
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
    expect(html).toContain(`>${m["groupPage.card.people.es"]}<`);
    expect(html).toContain(`>${m["groupPage.card.details.es"]}<`);
    expect(html).not.toContain(`>${m["groupPage.card.people"]}<`);
  });
});
