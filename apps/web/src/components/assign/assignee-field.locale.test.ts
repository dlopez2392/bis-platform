import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./assign-handlers", () => ({ applyAssignee: vi.fn(), contactAssigneeSave: () => vi.fn(), taskAssigneeSave: () => vi.fn() }));
const { assigneeChoices, assigneeName, ContactAssigneeField } = await import("./assignee-field");
const { LocaleProvider } = await import("@/components/locale-provider");

describe("the Assigned to picker in the reader's language (S-03 part 3 §10.1)", () => {
  it("the choices and the names read Spanish (mutation: keep m[\"assign.unassigned\"] -> FAILS)", () => {
    expect(assigneeChoices([], "es")[0]).toEqual({ value: "__unassigned__", label: "Sin asignar" });
    expect(assigneeName(null, [], "es")).toBe("Sin asignar");
    expect(assigneeName("u9", [], "es")).toBe("Alguien del equipo");
  });
  it("English without a locale (mutation: default to es -> FAILS)", () => {
    expect(assigneeName(null, [])).toBe("Unassigned");
  });
  it("a read-only line inside a Spanish provider says Usted for the viewer's own customer (mutation: drop useLocale -> 'You', FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" } as Parameters<typeof LocaleProvider>[0],
      createElement(ContactAssigneeField, { accountId: "a1", contactId: "c1", value: "p1", options: [], readOnly: true, viewerId: "p1" })));
    expect(html).toContain(">Usted<");
  });
});
