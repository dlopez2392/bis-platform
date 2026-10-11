import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Task 7 fix round 1 (M1): the record page's "Assigned to" refreshes the page
 * after a change that landed (and after its Undo), because the customer's
 * open tasks moved with them (A4) and the timeline below shows them. The
 * field itself is captured here; what the panel hands it is what is pinned.
 * contactAssigneeSave's own onSaved timing is tested in
 * components/assign/assign.test.ts.
 */
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/accounts/acct1/contacts/ct1",
  useSearchParams: () => new URLSearchParams(),
}));
const fieldProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/components/assign/assignee-field", () => ({
  ContactAssigneeField: (p: Record<string, unknown>) => { fieldProps.push(p); return null; },
}));
// "use server" modules and the rows' own reads are not what this pins.
vi.mock("./actions", () => ({ updateContactAction: async () => {}, addTagAction: async () => {}, removeTagAction: async () => {} }));
vi.mock("../actions", () => ({ updateContactFieldAction: async () => ({ ok: true }), undoInlinePhoneEditAction: async () => ({ ok: true }) }));
vi.mock("../texts-row", () => ({ TextsRow: () => null }));
vi.mock("../email-row", () => ({ EmailRow: () => null }));

const { ContactFieldsPanel } = await import("./contact-fields-panel");

const CONTACT = {
  id: "ct1", first_name: "Ana", last_name: "Reyes", email: null, phone: null, company_name: null,
  custom: {}, source: null, attribution: null, assigned_to: "p-me",
};

function render() {
  fieldProps.length = 0;
  return renderToStaticMarkup(createElement(ContactFieldsPanel, {
    accountId: "acct1", contactId: "ct1", contact: CONTACT, tags: [], fieldDefs: [],
    email: { status: "error" }, texts: { status: "error" },
    canAssign: true, members: [{ userId: "p-me", label: "Ana Me", role: "staff" }], viewerId: "p-me",
  } as never));
}

beforeEach(() => refresh.mockClear());

describe("ContactFieldsPanel: Assigned to (F-085)", () => {
  it("hands the field this contact, its holder, the team, canAssign as !readOnly and the viewer", () => {
    render();
    expect(fieldProps).toHaveLength(1);
    expect(fieldProps[0]).toMatchObject({
      accountId: "acct1", contactId: "ct1", value: "p-me", readOnly: false, viewerId: "p-me",
      options: [{ userId: "p-me", label: "Ana Me", role: "staff" }],
    });
  });

  it("its onSaved refreshes the page (the customer's tasks moved too) (fix round 1, M1; mutation: drop onSaved -> FAILS)", () => {
    render();
    const onSaved = fieldProps[0]!.onSaved as (() => void) | undefined;
    expect(typeof onSaved).toBe("function");
    expect(refresh).not.toHaveBeenCalled();
    onSaved!();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
