import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";

const { PeopleCardView } = await import("./people-card");
const { renderedText } = await import("@/lib/rendered-text");

type ViewProps = Parameters<typeof PeopleCardView>[0];
type Row = ViewProps["rows"][number];

const row = (over: Partial<Row> = {}): Row => (
  { memberId: "m1", contactId: "c1", name: "Ana García", role: null, isBilling: false, isPrimaryContact: false, ...over }
);
const noopHandlers = (): ViewProps["handlers"] => ({
  makePrimaryContact: () => Promise.resolve(true),
  remove: () => Promise.resolve(true),
  toggleBilling: () => Promise.resolve(true),
  roleSave: () => async () => ({ ok: true as const }),
  roleUndo: () => async () => ({ ok: true as const }),
});
const render = (locale: "en" | "es", over: Partial<ViewProps> = {}) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>,
    createElement(PeopleCardView, {
      accountId: "a1", groupId: "g1", kind: "household", manager: true, primary: null, rows: [], paged: false,
      pager: { moreHref: null, firstHref: null }, handlers: noopHandlers(), ...over,
    })));

describe("PeopleCardView: rows and the pinned call-first member", () => {
  it("the pinned primary is first, marked with a dot-and-word 'Primary contact', then the rest in order (mutation: render the primary after the rest -> FAILS)", () => {
    const html = render("en", {
      primary: row({ memberId: "m0", name: "Luis García", isPrimaryContact: true }),
      rows: [row({ memberId: "m1", name: "Ana García" })],
    });
    const order = [...html.matchAll(/data-people-row="(\w+)"/g)].map((x) => x[1]);
    expect(order).toEqual(["m0", "m1"]);
    expect(html).toMatch(/data-people-mark="primary-contact"[^>]*><span aria-hidden="true" class="[^"]*bg-\[var\(--accent\)\][^"]*">/);
    expect(renderedText(html)).toContain("Primary contact");
  });

  it("each name is a link to that contact's page, and the row itself carries no href (mutation: wrap the whole row in an <a> -> FAILS)", () => {
    const html = render("en", { rows: [row({ contactId: "c9", name: "Ana García" })] });
    expect(html).toMatch(/<a data-people-name="true"[^>]*href="\/dashboard\/accounts\/a1\/contacts\/c9"[^>]*>Ana García<\/a>/);
    const rowMarkup = html.match(/<li data-people-row="m1"[^]*?<\/li>/)![0];
    expect(rowMarkup).not.toMatch(/^<li data-people-row="m1"[^>]*><a /);
  });

  it("a row with no primary mark shows none (mutation: always render the mark -> FAILS)", () => {
    const html = render("en", { rows: [row({ isPrimaryContact: false })] });
    expect(html).not.toContain('data-people-mark="primary-contact"');
  });

  it("Pays the bills ON uses the SAME dot token as the contact Groups card's Mark component — --accent, not a status green (review round 1, minor 2; mutation: use bg-[var(--good)] -> FAILS)", () => {
    const html = render("en", { rows: [row({ isBilling: true })] });
    expect(html).toMatch(/aria-pressed="true"[^>]*><span class="[^"]*"><span aria-hidden="true" class="[^"]*bg-\[var\(--accent\)\][^"]*">/);
    expect(html).not.toContain("--good");
  });
});

describe("PeopleCardView: manager controls (rule 8 — no second primary button)", () => {
  it("a manager sees 'Make primary contact' on every non-primary row and 'Remove from this group' on every row, with the person's name in the remove button's accessible name (mutation: omit it from rows without aria-label -> FAILS)", () => {
    const html = render("en", {
      primary: row({ memberId: "m0", name: "Luis García", isPrimaryContact: true }),
      rows: [row({ memberId: "m1", name: "Ana García" })],
    });
    // Visible button TEXT only (">Remove from this group<"), not the aria-label attribute that also
    // carries the phrase: one text node per row, never on the pinned primary's row for Make primary.
    expect(html.match(/>Make primary contact</g)).toHaveLength(1);
    expect(html.match(/>Remove from this group</g)).toHaveLength(2);
    expect(html).toContain('aria-label="Remove from this group: Ana García"');
    expect(html).toContain('aria-label="Remove from this group: Luis García"');
  });

  it("none of the row's buttons is the page's one primary (rule 8; mutation: give Remove the default variant -> FAILS)", () => {
    const html = render("en", { rows: [row()] });
    expect(html).not.toContain('data-variant="default"');
  });

  it("a narrow reader gets neither action, nor the prompt, but still sees role and Pays the bills (mutation: render the actions regardless of manager -> FAILS)", () => {
    const html = render("en", { manager: false, rows: [row()] });
    expect(html).not.toContain("Make primary contact");
    expect(html).not.toContain("Remove from this group");
    expect(renderedText(html)).not.toContain("Choose who we call first.");
    expect(renderedText(html)).toContain("Role");
    expect(renderedText(html)).toContain("Pays the bills");
  });
});

describe("PeopleCardView: the choose-primary prompt", () => {
  it("shows for a manager with rows and no primary, never for a narrow reader with the same rows, never when paged (mutation: show it to everyone -> the narrow case FAILS)", () => {
    const managerHtml = render("en", { manager: true, primary: null, rows: [row()], paged: false });
    expect(renderedText(managerHtml)).toContain("Choose who we call first.");

    const narrowHtml = render("en", { manager: false, primary: null, rows: [row()], paged: false });
    expect(renderedText(narrowHtml)).not.toContain("Choose who we call first.");

    const pagedHtml = render("en", { manager: true, primary: null, rows: [row()], paged: true });
    expect(renderedText(pagedHtml)).not.toContain("Choose who we call first.");
  });

  it("never shows once someone already holds it (mutation: ignore p.primary in the prompt condition -> FAILS)", () => {
    const html = render("en", { manager: true, primary: row({ isPrimaryContact: true }), rows: [row({ memberId: "m2" })], paged: false });
    expect(renderedText(html)).not.toContain("Choose who we call first.");
  });
});

describe("PeopleCardView: the pager", () => {
  it("'More people' and 'Back to the start' render inside one nav at the card's foot, only when their href is given (mutation: render both hrefs always, even null -> FAILS)", () => {
    const html = render("en", { rows: [row()], pager: { moreHref: "/x?people=c1", firstHref: null } });
    expect(html.match(/<nav aria-label="People pages" data-people-pager/g)).toHaveLength(1);
    expect(html).toMatch(/<a class="[^"]*" href="\/x\?people=c1">More people<\/a>/);
    expect(html).not.toContain("Back to the start");
  });

  it("renders neither link, nor the nav, when both hrefs are null (mutation: always render the nav -> FAILS)", () => {
    const html = render("en", { rows: [row()], pager: { moreHref: null, firstHref: null } });
    expect(html).not.toContain("data-people-pager");
  });
});

describe("PeopleCardView: the empty state (rule 5 — sells the feature)", () => {
  it("a household and a business see DIFFERENT sentences when there is no one yet (mutation: use one shared sentence for both kinds -> the business case FAILS)", () => {
    const household = renderedText(render("en", { kind: "household", primary: null, rows: [], paged: false }));
    const business = renderedText(render("en", { kind: "business", primary: null, rows: [], paged: false }));
    expect(household).toContain("No one in this household yet. Add someone from their own page.");
    expect(business).toContain("No one at this business yet. Add someone from their own page.");
    expect(household).not.toBe(business);
  });

  it("the empty state never shows while a later page could still hold rows (mutation: ignore paged in the empty check -> FAILS)", () => {
    const html = render("en", { primary: null, rows: [], paged: true });
    expect(renderedText(html)).not.toContain("No one in this household yet");
  });
});

describe("PeopleCardView: Spanish", () => {
  it("renders the catalogue's Spanish strings and sets lang on the root (mutation: hard-code English regardless of locale -> FAILS)", () => {
    const html = render("es", {
      primary: row({ memberId: "m0", name: "Ana García", isPrimaryContact: true }),
      rows: [row({ memberId: "m1", name: "Luis García" })],
    });
    const text = renderedText(html);
    expect(text).toContain("Contacto principal");
    expect(text).toContain("Hacer contacto principal");
    expect(text).toContain("Quitar de este grupo");
    expect(text).toContain("Paga las cuentas");
    expect(html).toMatch(/^<div id="group-people"[^>]*lang="es"/);
  });
});
