import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";
import type { RelationshipView } from "@/lib/contacts/relationship-view";

vi.mock("./relationship-actions", () => ({
  setRelationshipAction: vi.fn(), undoSetRelationshipAction: vi.fn(), removeRelationshipAction: vi.fn(),
  undoRemoveRelationshipAction: vi.fn(), addRelationshipAction: vi.fn(), searchRelatableContactsAction: vi.fn(),
}));
const { RelationshipsCardView, RelationshipsCard } = await import("./relationships-card");
const { m } = await import("@/lib/messages");
// Copy is asserted on what a reader receives: React escapes an apostrophe in markup, so a raw
// toContain on "Couldn't load" matches nothing (lib/rendered-text.ts).
const { renderedText } = await import("@/lib/rendered-text");

const ANA = "22222222-2222-4222-8222-222222222222";
const view = (over: Partial<RelationshipView>): RelationshipView => ({
  id: "r1", labelKey: "parent", customLabel: null, namedSide: "a", person: { id: ANA, firstName: "Ana", lastName: "Ramírez" },
  namedForm: "f", subjectForm: "f", canPickUp: true, isEmergency: false, lockedFlag: null, ...over,
});
const noop = () => {};
const one = (html: string, re: RegExp) => html.match(re)?.[0] ?? "";
const render =(locale: "en" | "es", load: Parameters<typeof RelationshipsCardView>[0]["load"]) =>
  // Children positionally (react/no-children-prop); the cast only tells createElement they arrive there.
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>,
    createElement(RelationshipsCardView, { accountId: "a1", load, onRetry: noop, onToggle: noop, onForm: noop, onRemove: noop, addSlot: null })));

describe("RelationshipsCardView: its own loaded, empty and error states (rule 5 per card)", () => {
  it("loading is two skeleton chips and no words (rule 7)", () => {
    const html = render("en", { status: "loading" });
    expect(html.match(/data-relationships-skeleton/g)).toHaveLength(2);
    expect(renderedText(html)).not.toContain(m["relationships.empty"]);
  });
  it("empty sells the feature, in the reader's language, with lang set (mutation: hard-code English -> FAILS)", () => {
    expect(renderedText(render("en", { status: "ready", subject: { firstName: "Sofía", lastName: null }, views: [] }))).toContain(m["relationships.empty"]);
    const es = render("es", { status: "ready", subject: { firstName: "Sofía", lastName: null }, views: [] });
    expect(renderedText(es)).toContain(m["relationships.empty.es"]);
    expect(es).toContain('lang="es"');
  });
  it("error offers Retry", () => {
    const html = render("en", { status: "error" });
    expect(renderedText(html)).toContain(m["relationships.loadFailed"]);
    expect(renderedText(html)).toContain(m["relationships.retry"]);
  });
  it("the error is announced (role=alert) and says the shared Try again (design check 1a, #2; mutation: drop role=alert, or say Retry -> FAILS)", () => {
    const html = render("en", { status: "error" });
    expect(html).toMatch(/<div role="alert"[^>]*><p[^>]*>[^<]*<\/p><button[^>]*data-variant="ghost"[^>]*>Try again<\/button><\/div>/);
    expect(m["relationships.retry"]).toBe(m["record.card.retry"]);
    expect(m["relationships.retry.es"]).toBe(m["record.card.retry.es"]);
    expect(render("es", { status: "error" })).toContain(`>${m["record.card.retry.es"]}<`);
  });
  it("headingHidden hides the heading but keeps it labelling the section (S-03 §8; mutation: ignore the prop -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
      createElement(RelationshipsCardView, { accountId: "a1", load: { status: "loading" }, onRetry: noop, onToggle: noop, onForm: noop, onRemove: noop, addSlot: null, headingHidden: true })));
    expect(html).toMatch(/<h3 id="[^"]+" class="sr-only">/);
    expect(render("en", { status: "loading" })).not.toMatch(/<h3[^>]*class="sr-only"/);
  });
  it("RelationshipsCard hands headingHidden to its view (review round 1, minor 2; mutation: drop the pass-through -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
      createElement(RelationshipsCard, { accountId: "a1", contactId: ANA, headingHidden: true })));
    expect(html).toMatch(/<h3 id="[^"]+" class="sr-only">/);
  });
  it("headingHidden: no empty row under RecordCard's title, and Add stays right; the drawer's row is unchanged (review round 1, minor 3; mutation: keep the justify-between row -> FAILS)", () => {
    const hidden = (load: Parameters<typeof RelationshipsCardView>[0]["load"], addSlot: ReturnType<typeof createElement> | null) =>
      renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
        createElement(RelationshipsCardView, { accountId: "a1", load, onRetry: noop, onToggle: noop, onForm: noop, onRemove: noop, addSlot, headingHidden: true })));
    const add = createElement("button", { type: "button" }, "Add");
    const ready = { status: "ready" as const, subject: { firstName: "Sofía", lastName: null }, views: [] };
    expect(hidden({ status: "loading" }, add)).toMatch(/^<section[^>]*><h3 id="[^"]+" class="sr-only">/);
    expect(hidden(ready, null)).toMatch(/^<section[^>]*><h3 id="[^"]+" class="sr-only">/);
    expect(hidden(ready, add)).toMatch(/^<section[^>]*><div class="flex items-center justify-end gap-2"><h3 id="[^"]+" class="sr-only">[^<]*<\/h3><button/);
    expect(render("en", { status: "loading" })).toMatch(/^<section[^>]*><div class="flex items-center justify-between gap-2"><h3 /);
  });
});

describe("chips", () => {
  const ready = (views: RelationshipView[]) => ({ status: "ready" as const, subject: { firstName: "Sofía", lastName: "Ramírez" }, views });
  it("on a narrow card the name takes the first line and wraps whole, the word picker and remove go under it; the name never truncates to a letter (design check 1a, #3; mutation: put back truncate or the nowrap row -> FAILS)", () => {
    const LONG = { id: ANA, firstName: "Maximiliana-Guadalupe", lastName: "Hernández-Villarreal de la Garza" };
    const html = render("en", ready([view({ person: LONG })]));
    const row = one(html, /<li data-relationship-chip[^>]*><div class="[^"]*"/);
    expect(row).toMatch(/class="flex flex-wrap items-center gap-x-2 gap-y-1"$/);
    const link = one(html, /<a [^>]*>/);
    expect(link).toContain("basis-32 grow");
    expect(link).toContain("[overflow-wrap:anywhere]");
    expect(link).not.toMatch(/\btruncate\b/);
    expect(renderedText(html)).toContain("Mother: Maximiliana-Guadalupe Hernández-Villarreal de la Garza");
    // The hidden-person line wraps too: it was truncated the same way.
    expect(one(render("en", ready([view({ person: null })])), /<li data-relationship-chip[^>]*><p [^>]*>/)).not.toMatch(/\btruncate\b/);
  });
  it("reads 'Mother: Ana Ramírez' / 'Madre: Ana Ramírez', links to her record, and shows her flags as dot plus word (rule 3)", () => {
    const en = render("en", ready([view({})]));
    expect(en).toContain("Mother: Ana Ramírez");
    expect(en).toContain(`href="/dashboard/accounts/a1/contacts/${ANA}"`);
    expect(en).toContain('aria-pressed="true"');
    expect(en).toContain(m["relationships.flag.canPickUp"]);
    expect(render("es", ready([view({})]))).toContain("Madre: Ana Ramírez");
  });
  it("a person not on the reader's list: no name, no link, no controls, and the 'Ask your team' line (C5; mutation: render controls for a hidden person -> FAILS)", () => {
    const html = render("en", ready([view({ person: null })]));
    expect(html).toContain("Mother: someone not on your list");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button"); // no Remove either
    expect(html).toContain(m["relationships.askTeam"]);
    const es = render("es", ready([view({ person: null })]));
    expect(es).toContain("Madre: alguien que no está en su lista");
    expect(es).toContain(m["relationships.askTeam.es"]);
  });
  it("a flag the label already is shows as a word, never a toggle", () => {
    const html = render("en", ready([view({ labelKey: "emergency_contact", isEmergency: true, canPickUp: false, lockedFlag: "isEmergency" })]));
    expect(html).toContain(m["relationships.flag.isEmergency"]);
    expect(html.match(/aria-pressed/g)).toHaveLength(1); // only "Can pick up"
  });
});
