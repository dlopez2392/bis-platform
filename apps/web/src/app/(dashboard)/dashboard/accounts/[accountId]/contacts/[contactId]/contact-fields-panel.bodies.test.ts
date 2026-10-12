import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ updateContactAction: async () => {}, addTagAction: async () => {}, removeTagAction: async () => {} }));
vi.mock("../actions", () => ({ updateContactFieldAction: async () => ({ ok: true }), undoInlinePhoneEditAction: async () => ({ ok: true }) }));
vi.mock("../texts-row", () => ({ TextsRow: () => null }));
vi.mock("../email-row", () => ({ EmailRow: () => null }));
vi.mock("@/components/assign/assignee-field", () => ({ ContactAssigneeField: () => null }));
const { ContactDetailsBody, ContactTagsBody } = await import("./contact-fields-panel");

const CONTACT = { id: "ct1", first_name: "Ana", last_name: "Reyes", email: null, phone: null, company_name: null, custom: {}, source: null, attribution: null, assigned_to: null };

describe("the fields panel's two bodies, moved into record cards unchanged (spec §8)", () => {
  it("neither body carries a Card of its own (mutation: keep the Card wrapper -> FAILS)", () => {
    const details = renderToStaticMarkup(createElement(ContactDetailsBody, {
      accountId: "a1", contactId: "ct1", contact: CONTACT as never, fieldDefs: [], email: { status: "error" }, texts: { status: "error" },
    }));
    const tags = renderToStaticMarkup(createElement(ContactTagsBody, { accountId: "a1", contactId: "ct1", tags: [{ id: "t1", name: "VIP" }] as never }));
    expect(details).not.toContain('data-slot="card"');
    expect(tags).not.toContain('data-slot="card"');
    expect(details).toContain("data-assignee-row");
    expect(tags).toContain("VIP");
  });
});
