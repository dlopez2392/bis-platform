import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { ContactsTable, sortHref, type ContactRow } from "./contacts-table";

// `useRouter()` is called at render time for the header buttons' onClick —
// outside a mounted Next app router (as here, a plain `renderToStaticMarkup`)
// that hook throws "invariant expected app router to be mounted". Same
// stand-in, same reason, as calls-table.test.ts's.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

function row(i: number): ContactRow {
  return {
    id: `c${i}`, first_name: `First${i}`, last_name: "Last",
    email: null, phone: null, company_name: null,
    created_at: "2026-09-01T00:00:00.000000+00:00",
  };
}

function render(
  rows: ContactRow[],
  opts: { sort?: "name" | "company" | "created"; dir?: "asc" | "desc" } = {},
) {
  return renderToStaticMarkup(createElement(ContactsTable, {
    rows,
    accountId: "acct1",
    existingTags: [],
    sort: opts.sort ?? "created",
    dir: opts.dir ?? "desc",
  }));
}

/** Each header `<th>`'s own `aria-sort` and visible text, keyed for lookup
 *  by a substring of the label — order-independent of which column is
 *  where, so a reordering of the header row cannot silently break this. */
function headerCells(html: string): { aria: string | null; text: string }[] {
  const thead = /<thead[^>]*>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? "";
  return [...thead.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)].map((cell) => ({
    aria: /aria-sort="([^"]+)"/.exec(cell[1] ?? "")?.[1] ?? null,
    text: (cell[2] ?? "").replace(/<[^>]+>/g, ""),
  }));
}

describe("ContactsTable", () => {
  it("renders every row it is given — no second, client-side page cut on top of the server's own pager", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(i));
    const html = render(rows);
    // The old client pager (PAGE_SIZE = 20) would have cut this to 20.
    expect(html.match(/data-contact-row="c\d+"/g) ?? []).toHaveLength(25);
    expect(html).toContain("First24"); // the 25th row, past the old cutoff
  });

  it("renders no Page-X-of-Y control and no Prev/Next buttons — the server's Newer/Older is the only pager now", () => {
    const html = render([row(0)]);
    expect(html).not.toMatch(/Page \d+ of \d+/);
    expect(html).not.toContain(">Prev<");
    expect(html).not.toContain(">Next<");
  });

  it("marks exactly the active column's header with aria-sort, ascending", () => {
    const cells = headerCells(render([row(0)], { sort: "company", dir: "asc" }));
    const byText = (t: string) => cells.find((c) => c.text.includes(t));
    expect(byText(m["contacts.col.company"])?.aria).toBe("ascending");
    expect(byText(m["contacts.col.name"])?.aria).toBe("none");
    expect(byText(m["contacts.col.created"])?.aria).toBe("none");
  });

  it("marks exactly the active column's header with aria-sort, descending", () => {
    const cells = headerCells(render([row(0)], { sort: "name", dir: "desc" }));
    const byText = (t: string) => cells.find((c) => c.text.includes(t));
    expect(byText(m["contacts.col.name"])?.aria).toBe("descending");
    expect(byText(m["contacts.col.company"])?.aria).toBe("none");
    expect(byText(m["contacts.col.created"])?.aria).toBe("none");
  });

  it("defaults to created, descending, with no explicit sort/dir props given by a caller that hasn't sorted", () => {
    const cells = headerCells(render([row(0)]));
    expect(cells.find((c) => c.text.includes(m["contacts.col.created"]))?.aria).toBe("descending");
  });
});

describe("sortHref", () => {
  it("starts a newly-clicked column ascending", () => {
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "name"))
      .toBe("/dashboard/accounts/acct1/contacts?sort=name&dir=asc");
  });

  it("toggles direction when the column is already the active sort", () => {
    expect(sortHref("acct1", { key: "name", dir: "asc" }, "name"))
      .toBe("/dashboard/accounts/acct1/contacts?sort=name&dir=desc");
    expect(sortHref("acct1", { key: "name", dir: "desc" }, "name"))
      .toBe("/dashboard/accounts/acct1/contacts?sort=name&dir=asc");
  });

  it("carries the current search term along", () => {
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "company", "trevino"))
      .toBe("/dashboard/accounts/acct1/contacts?q=trevino&sort=company&dir=asc");
  });

  it("drops an empty search term rather than writing a bare ?q=", () => {
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "company", ""))
      .toBe("/dashboard/accounts/acct1/contacts?sort=company&dir=asc");
  });

  // THE risk this task calls out by name: a cursor from a name-sorted page is
  // meaningless on a date-sorted one, so clicking a column must return to the
  // head of the newly-ordered list. `sortHref` has no `before`/cursor
  // parameter to plumb one through even by accident — proven here by every
  // other assertion in this block, each an exact, complete expected string
  // with no "before=" in it anywhere.
  it("never carries a cursor, whatever the current sort or search state", () => {
    const href = sortHref("acct1", { key: "name", dir: "asc" }, "created", "smith");
    expect(href).not.toContain("before");
    expect(href).toBe("/dashboard/accounts/acct1/contacts?q=smith&sort=created&dir=asc");
  });
});
