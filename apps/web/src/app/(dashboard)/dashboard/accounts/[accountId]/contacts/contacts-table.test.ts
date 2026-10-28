import { describe, expect, it, vi, afterEach } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { LocaleProvider } from "@/components/locale-provider";
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
  opts: {
    sort?: "name" | "company" | "created"; dir?: "asc" | "desc"; timezone?: string;
    canDelete?: boolean;
  } = {},
) {
  return renderToStaticMarkup(createElement(ContactsTable, {
    rows,
    accountId: "acct1",
    existingTags: [],
    sort: opts.sort ?? "created",
    dir: opts.dir ?? "desc",
    timezone: opts.timezone ?? "America/Chicago",
    // Staff and roles: unrelated to every pre-existing test in this file —
    // defaults to true (the agency/Owner case) so none of them have to name
    // it. The prop's own gating is pinned in bulk-action-bar.test.ts.
    canDelete: opts.canDelete ?? true,
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

  // D-010: the "Created" column rendered through `formatDate` — the
  // RUNTIME's zone (server or browser), never the account's. `process.env.TZ`
  // stands in for "whichever zone the runtime happens to be in", pinned to a
  // zone that disagrees with the account's own so the assertion means the
  // same thing on any machine.
  describe("the Created column renders in the ACCOUNT's zone, not the runtime's (D-010)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("mutation: render Created with the runtime's zone instead of the account's → FAILS", () => {
      vi.stubEnv("TZ", "America/Chicago");
      const r = row(0);
      // 23:30 UTC on the 8th is still Oct 8 in Chicago, but already Oct 9 in
      // Berlin — the account's own calendar day, which "Created" must name.
      r.created_at = "2026-10-08T23:30:00.000Z";
      const html = render([r], { timezone: "Europe/Berlin" });
      expect(html).toContain("Oct 9, 2026");
      expect(html).not.toContain("Oct 8, 2026");
    });
  });
});

// F-085 follow-up (Task B): the header, the bulk-select checkbox's label and
// the Created column read the reader's own language, from the LocaleProvider
// the page (contacts/page.tsx) seeds — the same context AssigneeField and
// BulkActionBar already consume.
describe("ContactsTable reads the LocaleProvider's locale (F-085 follow-up, Task B)", () => {
  it("renders the header and the Created date in Spanish when the page's locale is es (mutation: hard-code t(m, key, 'en') -> FAILS)", () => {
    const r = row(0);
    r.created_at = "2026-09-01T00:00:00.000000+00:00";
    const html = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "es" } as ComponentProps<typeof LocaleProvider>, createElement(ContactsTable, {
        rows: [r], accountId: "acct1", existingTags: [], sort: "created", dir: "desc", timezone: "America/Chicago", canDelete: true,
      })),
    );
    expect(html).toContain(t(m, "contacts.col.name", "es"));
    expect(html).toContain(t(m, "contacts.col.phone", "es"));
    expect(html).toContain(t(m, "contacts.col.company", "es"));
    expect(html).toContain(t(m, "contacts.col.created", "es"));
    expect(html).toContain('aria-label="' + t(m, "bulk.selectPage", "es") + '"');
    // "Created" cell: Aug 31, 2026 in America/Chicago (UTC midnight is the prior evening there).
    expect(html).toContain("31 ago 2026");
  });

  // F-085 follow-ups (design I5): "Nombre del contacto" / "Nombre del negocio" pushed the Spanish
  // table 9px past its panel at 1280. The two sortable headers are the short words; English is unchanged.
  it("the two sortable headers are \"Nombre\" and \"Negocio\" in Spanish, unchanged in English (mutation: restore \"Nombre del contacto\" -> FAILS)", () => {
    const html = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "es" } as ComponentProps<typeof LocaleProvider>, createElement(ContactsTable, {
        rows: [row(0)], accountId: "acct1", existingTags: [], sort: "created", dir: "desc", timezone: "America/Chicago", canDelete: true,
      })),
    );
    expect(html).toMatch(/>Nombre</);
    expect(html).toMatch(/>Negocio</);
    expect(html).not.toContain("Nombre del contacto");
    expect(html).not.toContain("Nombre del negocio");
    expect(m["contacts.col.name"]).toBe("Contact name");
    expect(m["contacts.col.company"]).toBe("Business name");
  });

  it("defaults to English with no LocaleProvider ancestor (same default useLocale() falls back to, pinned at the module level)", () => {
    const html = render([row(0)]);
    expect(html).toContain(m["contacts.col.name"]);
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

  // The header click is an onClick (router.push), which a static render
  // cannot fire, so the wiring is read off the source: the table hands its
  // own `who` prop to sortHref.
  it("the header click builds its href with the table's current who", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./contacts-table.tsx", import.meta.url)), "utf8");
    // Contact archive (plan Task 10): the view rides along after who.
    expect(src).toContain("sortHref(accountId, { key: sort, dir }, key, q, who, view)");
  });

  // F-085 part 1: re-sorting Mine must stay inside Mine.
  it("carries who=mine / who=unassigned, and nothing for All (mutation: drop withWho -> FAILS)", () => {
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "name", "x", "mine"))
      .toBe("/dashboard/accounts/acct1/contacts?q=x&sort=name&dir=asc&who=mine");
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "name", undefined, "unassigned"))
      .toBe("/dashboard/accounts/acct1/contacts?sort=name&dir=asc&who=unassigned");
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "name", undefined, "all"))
      .toBe("/dashboard/accounts/acct1/contacts?sort=name&dir=asc");
  });
});

/**
 * Task 7 fix round 1 (I2): assigning from the drawer inside ?who=mine or
 * ?who=unassigned moves the customer OUT of the filtered list, and the
 * server action's revalidation drops their row. The drawer must keep showing
 * the customer it was opened on (the toast and its Undo are still up), so the
 * table remembers the last row it saw for the open peek rather than falling
 * to the all-blank stub a deep link to an unknown id gets.
 */
describe("peekRow: the drawer's row survives the list losing it (fix round 1, I2)", () => {
  it("the row on this page wins, and is what gets remembered", async () => {
    const { peekRow } = await import("./contacts-table");
    const ana = row(1);
    expect(peekRow([ana, row(2)], "c1", null)).toBe(ana);
  });

  it("a peeked row that left the list (assigned away from Mine) is the REMEMBERED row, not the blank stub (mutation: drop the memory -> FAILS)", async () => {
    const { peekRow } = await import("./contacts-table");
    const ana = row(1);
    const shown = peekRow([row(2)], "c1", ana);
    expect(shown).toBe(ana);
    expect(shown?.first_name).toBe("First1");
  });

  it("a memory of a DIFFERENT contact is never shown for this peek: a deep link to an id not on the page still gets the stub", async () => {
    const { peekRow } = await import("./contacts-table");
    const shown = peekRow([row(2)], "c9", row(1));
    expect(shown?.id).toBe("c9");
    expect(shown?.first_name).toBeNull();
  });

  it("no peek, no drawer row", async () => {
    const { peekRow } = await import("./contacts-table");
    expect(peekRow([row(1)], null, row(1))).toBeNull();
  });

  it("the table remembers the row it found for the open peek and hands the drawer peekRow's answer (mutation: hand the drawer the old find-or-stub -> FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./contacts-table.tsx", import.meta.url)), "utf8");
    expect(src).toContain("row={peekRow(rows, peekId, remembered)}");
    expect(src).toMatch(/if \(found && found !== remembered\) setRemembered\(found\);/);
  });
});

// Contact archive (plan Task 10): re-sorting the Archived view stays in it, and the bulk bar learns which
// view it is on, whether this reader archives, and the account's zone (the Archive toast's date).
describe("the Archived view through the table (plan Task 10)", () => {
  it("sortHref carries view=archived, and nothing on the list (mutation: drop withView -> FAILS)", () => {
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "name", "x", "all", "archived"))
      .toBe("/dashboard/accounts/acct1/contacts?q=x&sort=name&dir=asc&view=archived");
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "name", "x", "mine", "archived"))
      .toBe("/dashboard/accounts/acct1/contacts?q=x&sort=name&dir=asc&who=mine&view=archived");
    expect(sortHref("acct1", { key: "created", dir: "desc" }, "name", undefined, "all", "active"))
      .toBe("/dashboard/accounts/acct1/contacts?sort=name&dir=asc");
  });

  // The header click and the bar are wired in JSX that a static render cannot reach (no click, and the
  // bar renders nothing until a box is ticked), so the wiring is read off the source.
  it("the header click builds its href with the table's view, and the bar gets view, canArchive and the zone", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./contacts-table.tsx", import.meta.url)), "utf8");
    expect(src).toContain("sortHref(accountId, { key: sort, dir }, key, q, who, view)");
    const bar = src.match(/<BulkActionBar\b[\s\S]*?\/>/)?.[0] ?? "";
    expect(bar).toContain("view={view}");
    expect(bar).toContain("canArchive={canArchive}");
    expect(bar).toContain("timezone={timezone}");
  });

  it("renders in the Archived view with Archive withheld (a Technician) without trouble", () => {
    const html = renderToStaticMarkup(createElement(ContactsTable, {
      rows: [row(0)], accountId: "acct1", existingTags: [], sort: "created", dir: "desc",
      timezone: "America/Chicago", canDelete: false, view: "archived", canArchive: false,
    }));
    expect(html).toContain('data-contact-row="c0"');
  });
});

// Final review M3: a paused account refuses every delete, so the flag reaches both delete dialogs. No DOM
// renderer for this wiring (the dialogs portal; the page renders client components), so it is read.
describe("the table hands both delete dialogs the paused flag (final review M3)", () => {
  it("BulkActionBar and ContactDrawer get paused={paused}", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./contacts-table.tsx", import.meta.url)), "utf8");
    expect(src.match(/<BulkActionBar\b[\s\S]*?\/>/)?.[0]).toContain("paused={paused}");
    expect(src.match(/<ContactDrawer\b[\s\S]*?\/>/)?.[0]).toContain("paused={paused}");
  });
});
