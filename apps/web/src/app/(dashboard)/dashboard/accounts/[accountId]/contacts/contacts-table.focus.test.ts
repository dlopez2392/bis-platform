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

// Final review M5: when Archive, Restore or Delete take the bar (or the drawer) away, focus does not drop to
// <body>. The markers the helpers look for render; the wiring that calls them is read off the source (a
// static render cannot click, and the bar renders nothing until a box is ticked).
describe("focus after the bar or the drawer goes (final review M5)", () => {
  const html = () => renderToStaticMarkup(createElement(ContactsTable, {
    rows: [row(0), row(1)], accountId: "acct1", existingTags: [],
    sort: "created", dir: "desc", timezone: "America/Chicago", canDelete: true,
  }));
  it("the select-all checkbox and the table carry the markers focusAfterBar looks for, the table focusable by script only", () => {
    expect(html()).toMatch(/<button[^>]*\sdata-select-page="/);
    const table = html().match(/<table[^>]*>/)?.[0] ?? "";
    expect(table).toMatch(/\sdata-contacts-table="/);
    expect(table).toContain('tabindex="-1"');
  });
  it("the bar's onDone clears the selection and then moves focus; the drawer's onGone points focus at the next row (mutation: onDone that only clears -> FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./contacts-table.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/function clearSelection\(\) \{\s*setSelected\(new Set\(\)\);\s*requestAnimationFrame\(\(\) => focusAfterBar\(\)\);/);
    expect(src.match(/<BulkActionBar\b[\s\S]*?\/>/)?.[0]).toContain("onDone={clearSelection}");
    const drawer = src.match(/<ContactDrawer\b[\s\S]*?\/>/)?.[0] ?? "";
    expect(drawer).toContain("onGone={drawerGone}");
    expect(drawer).toContain("returnFocusRowId={afterGone ?? remembered?.id ?? null}");
    expect(src).toMatch(/function drawerGone\(\) \{[\s\S]{0,200}?setAfterGone\(nextRowId\(rowIds, peekId\)\)/);
  });
  it("the drawer's own Archive, Restore and Delete close it through onGone, else onClose", () => {
    lastDrawer("c0");
    expect(typeof drawerProps.at(-1)!.onGone).toBe("function");
  });
});
