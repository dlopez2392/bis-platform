import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContactRow } from "./contacts-table";

// 2026-10-28: Esc closed the contact drawer and focus fell to <body>. The
// drawer gives focus back to `returnFocusRowId` (contact-drawer.wiring.test.ts);
// this pins what the TABLE hands it: the row it remembered for the peek
// (state that outlives the close), never the live peek id, which is already
// null when Radix asks where focus goes.
const peek: { peekId: string | null } = { peekId: null };
vi.mock("@/lib/contacts/use-peek", () => ({
  usePeek: () => ({ peekId: peek.peekId, open: () => {}, close: () => {} }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
const drawerProps: Record<string, unknown>[] = [];
vi.mock("./contact-drawer", () => ({
  ContactDrawer: (p: Record<string, unknown>) => { drawerProps.push(p); return null; },
}));

const { ContactsTable } = await import("./contacts-table");

function row(i: number): ContactRow {
  return {
    id: `c${i}`, first_name: `First${i}`, last_name: "Last",
    email: null, phone: null, company_name: null,
    created_at: "2026-09-01T00:00:00.000000+00:00",
  };
}

function lastDrawer(peekId: string | null) {
  peek.peekId = peekId;
  drawerProps.length = 0;
  renderToStaticMarkup(createElement(ContactsTable, {
    rows: [row(0), row(1)], accountId: "acct1", existingTags: [],
    sort: "created", dir: "desc", timezone: "America/Chicago", canDelete: true,
  }));
  return drawerProps.at(-1)!;
}

beforeEach(() => { peek.peekId = null; });

describe("ContactsTable hands the drawer the row to give focus back to (2026-10-28)", () => {
  it("the row it found for the open peek", () => {
    expect(lastDrawer("c1").returnFocusRowId).toBe("c1");
  });

  it("not the raw peek id: a deep link to a contact not on this page has no row to return to (mutation: pass peekId -> FAILS)", () => {
    expect(lastDrawer("c9").returnFocusRowId).toBeNull();
  });

  it("nothing when no row was ever peeked", () => {
    expect(lastDrawer(null).returnFocusRowId).toBeNull();
  });
});
