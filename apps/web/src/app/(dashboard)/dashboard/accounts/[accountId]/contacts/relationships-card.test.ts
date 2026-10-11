import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";
import type { RelationshipView } from "@/lib/contacts/relationship-view";

vi.mock("./relationship-actions", () => ({
  setRelationshipAction: vi.fn(), undoSetRelationshipAction: vi.fn(), removeRelationshipAction: vi.fn(),
  undoRemoveRelationshipAction: vi.fn(), addRelationshipAction: vi.fn(), searchRelatableContactsAction: vi.fn(),
}));
const { RelationshipsCardView } = await import("./relationships-card");
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
const render = (locale: "en" | "es", load: Parameters<typeof RelationshipsCardView>[0]["load"]) =>
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
});

describe("chips", () => {
  const ready = (views: RelationshipView[]) => ({ status: "ready" as const, subject: { firstName: "Sofía", lastName: "Ramírez" }, views });
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
