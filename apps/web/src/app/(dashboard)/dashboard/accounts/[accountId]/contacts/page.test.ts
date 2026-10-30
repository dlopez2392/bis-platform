import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";

// Staff and roles (Task 6): the page's own owner check for the Export link
// and ContactsTable's `canDelete` prop. Defaults to an Owner/agency caller
// so every pre-existing test below (written before this guard existed)
// keeps seeing the Export link and canDelete=true unless a test overrides
// the resolved value for itself.
const requireAccountAccessMock = vi.fn(async (_accountId: string) => (
  { userId: "u1", isAgency: true, role: null as "owner" | "staff" | "technician" | null, canManage: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (accountId: string) => requireAccountAccessMock(accountId),
}));
// F-085 follow-up (Task B): the page now resolves its own render locale
// (requestLocale), the same way tasks/page.tsx and conversations/page.tsx
// already do — same stub, same reason (person-prefs pulls in @/lib/auth and
// Clerk, neither available under a plain vitest render).
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
// Final review M3: the layout's cached billing verdict, so both delete dialogs know a paused account.
const verdictPaused = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/billing/standing-read", () => ({
  billingVerdictFor: async () => ({ paused: verdictPaused.on, voice: true, concierge: true, forward: true, cause: null, pausedAt: null }),
}));

// D-009's search-form describe block below renders the WHOLE page (the
// hidden sort/dir fields live in page.tsx's own JSX, not in a pure
// extracted helper) — these three stubs keep that render isolated to the
// search form's own markup, same reason tasks/page.test.ts stubs out
// anything below what one test actually pins. ContactsTable/AddContactDialog
// are "use client" and reach useRouter/useFormSubmit, neither available
// under renderToStaticMarkup.
//
// A spy, not a bare `() => null`: D-010's own test below needs to see what
// the page actually PASSED this component (its `timezone` prop), the same
// way calls/page.test.ts spies on listFailedOutboundSms rather than only
// reading the rendered HTML.
const contactsTableMock = vi.fn((_props: unknown) => null);
vi.mock("./contacts-table", () => ({ ContactsTable: (props: unknown) => contactsTableMock(props) }));
vi.mock("./add-contact-dialog", () => ({ AddContactDialog: () => null }));
vi.mock("./actions", () => ({ createContactAction: vi.fn() }));
// D-010: the page's own direct query — the account's timezone — projected
// the same way calls/page.test.ts and contacts/[contactId]/page.test.ts
// project theirs, so a column this page stops selecting would show up here
// too. A mutable mock (not a bare async literal), same reason as
// contacts/[contactId]/page.test.ts's own `accountRead`: the timezone-
// read-failure test below swaps in a failing read for ONE call.
const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago" }, error: null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => accountRead(),
          }),
        }),
      };
    },
  }),
}));
// Echoes the zone it was handed, same shape and reason as
// contacts/[contactId]/page.test.ts's own renderZone stub: the only way this
// test sees "America/Chicago" is if the account's row actually reached it.
// Wrapped in a spy (not a bare function) so the timezone-read-failure test
// below can assert it was actually CALLED WITH `undefined` — the fallback
// path's whole claim — not merely that "UTC" showed up somewhere.
const renderZoneMock = vi.fn(async (z: string | undefined) => (z
  ? { zone: z, guessed: false, label: z, source: "account" as const }
  : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }));
vi.mock("@/lib/zone", () => ({
  renderZone: (z: string | undefined) => renderZoneMock(z),
}));
const listContactsMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => [{
  id: "c1", first_name: "Ana", last_name: null, email: null, phone: null,
  company_name: null, source: null, sort_name: "ana", created_at: "2026-01-01T00:00:00Z",
}]);
const countContactsMock = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 1);
const listTagsMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);
// F-085 part 1: the caller's own users row (for Mine) and the team (for the
// assignee picker Task 7 renders).
const readPersonIdMock = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => "p-me");
const listAccountTeamMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => [
  { userId: "p-me", clerkUserId: "c1", email: "me@x.test", name: "Ana Me", role: "staff", language: null },
  { userId: "p-t", clerkUserId: "c2", email: "tech@x.test", name: null, role: "technician", language: null },
]);
// F-006 part 1 (plan Task 10): the Possible duplicates view's own two reads.
const listDuplicatePairsMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);
const countDuplicatePairsMock = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 0);
vi.mock("@bis/db", () => ({
  listContacts: (...a: unknown[]) => listContactsMock(...a),
  countContacts: (...a: unknown[]) => countContactsMock(...a),
  listTags: (...a: unknown[]) => listTagsMock(...a),
  readPersonId: (...a: unknown[]) => readPersonIdMock(...a),
  listAccountTeam: (...a: unknown[]) => listAccountTeamMock(...a),
  listDuplicatePairs: (...a: unknown[]) => listDuplicatePairsMock(...a),
  countDuplicatePairs: (...a: unknown[]) => countDuplicatePairsMock(...a),
  reasonLabel: (reason: string) => (reason === "same_phone" ? "samePhone" : "other"),
}));
// The duplicates view's own client list and the two "use server" actions it binds (a "use server"
// module cannot be imported into a vitest render — merge-actions.ts's own test covers its behavior).
const duplicatesListProps: Record<string, unknown>[] = [];
vi.mock("./duplicates-list", () => ({
  DuplicatesList: (p: Record<string, unknown>) => { duplicatesListProps.push(p); return null; },
}));
vi.mock("./merge-actions", () => ({
  mergeContactsAction: vi.fn(), undoMergeAction: vi.fn(), dismissPairAction: vi.fn(), undismissPairAction: vi.fn(),
}));

const { default: ContactsPage, buildExportHref, buildNewerHref, buildOlderHref } = await import("./page");

const page = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

describe("contacts list", () => {
  it("reads the cursor through the shared parser, never by hand", () => {
    expect(page).toContain("parseCursor");
    expect(page).not.toMatch(/before\?\.split\(/);
  });
  it("asks for one more row than it shows, to know whether an older page exists", () => {
    expect(page).toContain("PAGE_SIZE + 1");
  });
  it("counts with the same search and assignee filter the list uses", () => {
    expect(page).toMatch(/countContacts\(db, accountId, \{ search: q, assignee: assign\.assignee, archived \}\)/);
  });
  it("offers import and export, in the reader's language (F-085 follow-up, Task B: tr.text, never a bare m[...] lookup)", () => {
    expect(page).toContain('tr.text("contacts.import")');
    expect(page).toContain('tr.text("contacts.export")');
  });
});

// Review finding: the claim that Newer/Older hrefs carry the current
// sort/dir was previously verified only by reading page.tsx's source (the
// block above greps for literal substrings) — never by actually calling the
// code that builds those hrefs. `buildNewerHref`/`buildOlderHref` are
// extracted, exported, pure functions (same pattern as contacts-table.tsx's
// own `sortHref`) so that claim can be executed rather than just read.
describe("buildNewerHref", () => {
  it("carries the current sort and dir", () => {
    const href = buildNewerHref(true, undefined, "company", "asc");
    expect(href).not.toBeNull();
    expect(href).toContain("sort=company");
    expect(href).toContain("dir=asc");
  });

  it("returns null when there is no cursor to return from — nothing 'newer' than page one", () => {
    expect(buildNewerHref(false, undefined, "name", "asc")).toBeNull();
  });

  it("carries the current search term along", () => {
    const href = buildNewerHref(true, "trevino", "created", "desc");
    expect(href).toContain("q=trevino");
    expect(href).toContain("sort=created");
    expect(href).toContain("dir=desc");
  });

  it("drops an empty search term rather than writing a bare ?q=", () => {
    const href = buildNewerHref(true, "", "created", "desc");
    expect(href).not.toContain("q=");
  });
});

describe("buildOlderHref", () => {
  const lastRow = {
    sort_name: "ana lovelace", company_name: "Acme Inc",
    created_at: "2026-09-09T12:00:00.000000+00:00", id: "6b503e2f-3cd3-4531-a0af-5cfaf9bc158e",
  };

  it("carries the current sort and dir", () => {
    const href = buildOlderHref(true, lastRow, undefined, "name", "asc");
    expect(href).not.toBeNull();
    expect(href).toContain("sort=name");
    expect(href).toContain("dir=asc");
  });

  it("carries sort and dir for the company and created columns too", () => {
    expect(buildOlderHref(true, lastRow, undefined, "company", "desc"))
      .toContain("sort=company");
    expect(buildOlderHref(true, lastRow, undefined, "company", "desc"))
      .toContain("dir=desc");
    expect(buildOlderHref(true, lastRow, undefined, "created", "asc"))
      .toContain("sort=created");
  });

  it("returns null when there is no further page", () => {
    expect(buildOlderHref(false, lastRow, undefined, "name", "asc")).toBeNull();
  });

  it("returns null when there is no last row to cursor from", () => {
    expect(buildOlderHref(true, undefined, undefined, "name", "asc")).toBeNull();
  });

  it("carries the current search term along", () => {
    const href = buildOlderHref(true, lastRow, "trevino", "name", "asc");
    expect(href).toContain("q=trevino");
  });

  it("encodes a before cursor built from the CURRENT sort column's own value off the last row, not always the name", () => {
    const nameHref = buildOlderHref(true, lastRow, undefined, "name", "asc")!;
    const companyHref = buildOlderHref(true, lastRow, undefined, "company", "asc")!;
    const beforeName = JSON.parse(
      Buffer.from(new URLSearchParams(nameHref.slice(1)).get("before")!, "base64url").toString("utf8"));
    const beforeCompany = JSON.parse(
      Buffer.from(new URLSearchParams(companyHref.slice(1)).get("before")!, "base64url").toString("utf8"));
    expect(beforeName).toEqual(["ana lovelace", lastRow.id]);
    expect(beforeCompany).toEqual(["Acme Inc", lastRow.id]);
  });
});

// Defect: the Export link used to be a bare `${base}/export` with no query
// string at all, so clicking it always downloaded the unfiltered,
// default-order list even from a search or a re-sorted view — even though
// the route itself honours q/sort/dir correctly (export/route.get.test.ts).
// Same fix as buildNewerHref/buildOlderHref above: an exported pure
// function so "the Export link carries the current search and sort" is a
// claim a test can execute, not just read off the JSX.
describe("buildExportHref", () => {
  it("points at the export route under the current base", () => {
    const href = buildExportHref("/dashboard/accounts/a1/contacts", undefined, "created", "desc");
    expect(href.split("?")[0]).toBe("/dashboard/accounts/a1/contacts/export");
  });

  it("carries the current sort and dir", () => {
    const href = buildExportHref("/dashboard/accounts/a1/contacts", undefined, "company", "asc");
    expect(href).toContain("sort=company");
    expect(href).toContain("dir=asc");
  });

  it("carries sort and dir for the created column too", () => {
    const href = buildExportHref("/dashboard/accounts/a1/contacts", undefined, "created", "asc");
    expect(href).toContain("sort=created");
    expect(href).toContain("dir=asc");
  });

  it("carries the current search term along", () => {
    const href = buildExportHref("/dashboard/accounts/a1/contacts", "trevino", "created", "desc");
    expect(href).toContain("q=trevino");
  });

  it("drops an empty search term rather than writing a bare ?q=", () => {
    const href = buildExportHref("/dashboard/accounts/a1/contacts", "", "created", "desc");
    expect(href).not.toContain("q=");
  });

  // The export route pages the WHOLE matching set itself (route.ts's own
  // CHUNK_SIZE loop) — a `before` cursor on this link would silently
  // truncate the download to one page's worth, a data-loss bug rather than
  // a cosmetic one. buildExportHref takes no cursor parameter at all, so
  // there is nothing a caller could even pass one through as; this test
  // pins the resulting href as a second, executable line of defence.
  it("never carries a before cursor — export walks the whole list itself, not one page of it", () => {
    const href = buildExportHref("/dashboard/accounts/a1/contacts", "trevino", "name", "asc");
    expect(href).not.toContain("before=");
  });
});

// D-009: submitting the search box (a plain GET <form>) used to carry ONLY
// `q` — the browser drops any query param the form itself doesn't name, so
// pressing Enter while sorted by company/asc silently reset the list to the
// default order (created, desc). The fix lives in page.tsx's own JSX
// (hidden sort/dir fields), not in an extracted pure helper like
// buildNewerHref/buildOlderHref above, so this renders the real page.
describe("the search form (D-009)", () => {
  it("carries the current sort and dir as hidden fields, so Enter doesn't reset the order (mutation: drop the hidden inputs → FAILS)", async () => {
    const html = renderToStaticMarkup(
      await ContactsPage({
        params: Promise.resolve({ accountId: "a1" }),
        searchParams: Promise.resolve({ sort: "company", dir: "asc" }),
      }),
    );
    expect(html).toContain('<input type="hidden" name="sort" value="company"');
    expect(html).toContain('<input type="hidden" name="dir" value="asc"');
  });

  it("carries the default sort/dir too, when none was given in the URL", async () => {
    const html = renderToStaticMarkup(
      await ContactsPage({
        params: Promise.resolve({ accountId: "a1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain('<input type="hidden" name="sort" value="created"');
    expect(html).toContain('<input type="hidden" name="dir" value="desc"');
  });
});

// D-010: the "Created" column rendered in the RUNTIME's zone, never the
// account's — ContactsTable's own test pins the rendering half of this fix;
// this one pins that the PAGE actually reads the account's zone and hands
// it down, the same way contacts/[contactId]/page.tsx already does for the
// activity timeline (mutation: hand ContactsTable a hardcoded "UTC" instead
// of the resolved zone → FAILS, since this account's own row is
// "America/Chicago", not UTC).
describe("the account's zone reaches ContactsTable (D-010)", () => {
  it("passes renderZone's resolved zone down as the timezone prop", async () => {
    contactsTableMock.mockClear();
    renderToStaticMarkup(
      await ContactsPage({
        params: Promise.resolve({ accountId: "a1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(contactsTableMock).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: "America/Chicago" }),
    );
  });

  // Coordinator-requested gap closure: the account's own `timezone` read
  // (contacts/page.tsx's own `account.error` branch) must not take the
  // whole list down — one cosmetic date column's own read failing is the
  // contact detail page's own reasoning (and its own test,
  // contacts/[contactId]/page.test.ts's "a failed account read falls back
  // to the GUESSED zone, logged, never thrown"), now pinned here too.
  it("a failed account timezone read falls back to the GUESSED zone, logged, never thrown", async () => {
    accountRead.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    contactsTableMock.mockClear();
    renderZoneMock.mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Never thrown: a page render that rejects here fails this test on
      // its own, with no assertion needed to say so.
      renderToStaticMarkup(
        await ContactsPage({
          params: Promise.resolve({ accountId: "a1" }),
          searchParams: Promise.resolve({}),
        }),
      );
      expect(renderZoneMock).toHaveBeenCalledWith(undefined);
      expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ timezone: "UTC" }));
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("boom");
    } finally {
      errors.mockRestore();
    }
  });
});

// Staff and roles (Task 6): delete and export are Owner-only. The page
// reads `canManage` off requireAccountAccess (agency or a client Owner) and
// uses it for both the Export link's visibility and ContactsTable's own
// `canDelete` prop — Staff keeps the list, the search and the bulk tag
// actions, but loses Export and bulk Delete.
describe("Export link and canDelete are Owner-only (staff and roles)", () => {
  it("hides the Export link for a Staff caller (mutation: render Export unconditionally → FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(
      { userId: "u1", isAgency: false, role: "staff", canManage: false });
    const html = renderToStaticMarkup(
      await ContactsPage({
        params: Promise.resolve({ accountId: "a1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).not.toContain(m["contacts.export"]);
    // Import stays available — only Export and Delete are Owner-only.
    expect(html).toContain(m["contacts.import"]);
  });

  it("passes canDelete: false to ContactsTable for a Staff caller (mutation: hardcode canDelete true → FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(
      { userId: "u1", isAgency: false, role: "staff", canManage: false });
    contactsTableMock.mockClear();
    renderToStaticMarkup(
      await ContactsPage({
        params: Promise.resolve({ accountId: "a1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ canDelete: false }));
  });

  it("shows Export and passes canDelete: true for the agency / a client Owner", async () => {
    contactsTableMock.mockClear();
    const html = renderToStaticMarkup(
      await ContactsPage({
        params: Promise.resolve({ accountId: "a1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain(m["contacts.export"]);
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ canDelete: true }));
  });

  // F-118 part 1 (plan Task 7): a Link prefetches and its RSC fetch would run the export route's
  // handler, logging a download nobody asked for. The control is a plain anchor with `download`.
  it("Export is a plain <a download>, never a Next <Link> (mutation: put back <Link> without download -> FAILS on the attribute)", async () => {
    const html = renderToStaticMarkup(
      await ContactsPage({
        params: Promise.resolve({ accountId: "a1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    const match = html.match(/<a[^>]*data-export-link[^>]*>/);
    expect(match).toBeTruthy();
    const tag = match![0];
    expect(tag).toMatch(/\bdownload(=""|\b)/);
    const href = tag.match(/href="([^"]*)"/)?.[1]?.replaceAll("&amp;", "&");
    expect(href).toBe(buildExportHref("/dashboard/accounts/a1/contacts", undefined, "created", "desc"));
  });
});

// F-085 part 1 (spec §8-§9): Mine / Unassigned filter on the SERVER, so the
// pager and the header's real total both describe the filtered list.
describe("?who= (Mine / Unassigned)", () => {
  const STAFF = { userId: "u1", isAgency: false, role: "staff" as const, canManage: false };
  const TECH = { userId: "u1", isAgency: false, role: "technician" as const, canManage: false };
  async function render(searchParams: Record<string, string>) {
    return renderToStaticMarkup(
      await ContactsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }
  function resetMocks() {
    listContactsMock.mockClear();
    countContactsMock.mockClear();
    contactsTableMock.mockClear();
    readPersonIdMock.mockClear();
    listAccountTeamMock.mockClear();
  }

  it("who=mine filters the list AND the count by the caller's own users row (mutation: filter only the list -> the total lies -> FAILS)", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    await render({ who: "mine" });
    expect(readPersonIdMock).toHaveBeenCalledWith(expect.anything(), "a1", "u1");
    expect(listContactsMock.mock.calls[0]![2]).toMatchObject({ assignee: { who: "mine", userId: "p-me" } });
    expect(countContactsMock.mock.calls[0]![2]).toEqual({ search: undefined, assignee: { who: "mine", userId: "p-me" }, archived: "exclude" });
  });

  it("who=unassigned filters both too", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    await render({ who: "unassigned" });
    expect(listContactsMock.mock.calls[0]![2]).toMatchObject({ assignee: { who: "unassigned" } });
    expect(countContactsMock.mock.calls[0]![2]).toMatchObject({ assignee: { who: "unassigned" } });
  });

  it("no who is All: no filter on either", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    await render({});
    expect((listContactsMock.mock.calls[0]![2] as { assignee?: unknown }).assignee).toBeUndefined();
    expect((countContactsMock.mock.calls[0]![2] as { assignee?: unknown }).assignee).toBeUndefined();
  });

  it("the agency (no users row in a client's company) asking for Mine gets All, never an empty filter", async () => {
    resetMocks();
    readPersonIdMock.mockResolvedValueOnce(null);
    await render({ who: "mine" });
    expect((listContactsMock.mock.calls[0]![2] as { assignee?: unknown }).assignee).toBeUndefined();
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ who: "all", canAssign: true }));
  });

  it("a Technician: the filter is NOT passed (RLS already makes the list theirs), no team read, canAssign false (mutation: pass the filter for everyone -> FAILS)", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    await render({ who: "unassigned" });
    expect((listContactsMock.mock.calls[0]![2] as { assignee?: unknown }).assignee).toBeUndefined();
    expect((countContactsMock.mock.calls[0]![2] as { assignee?: unknown }).assignee).toBeUndefined();
    expect(listAccountTeamMock).not.toHaveBeenCalled();
    // Task 7 fix round 1 (I1): ONE account-scoped read of their own person,
    // so the drawer's read-only "Assigned to" can say "You" for their own
    // customers and nobody else's. It does not become a filter.
    expect(readPersonIdMock).toHaveBeenCalledTimes(1);
    expect(readPersonIdMock).toHaveBeenCalledWith(expect.anything(), "a1", "u1");
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ canAssign: false, members: [], who: "all" }));
  });

  it("the table gets the viewer's own person, for the drawer's You (fix round 1, I1; mutation: pass null -> FAILS)", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    readPersonIdMock.mockResolvedValueOnce("p-t");
    await render({});
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ viewerId: "p-t" }));
  });

  it("a client whose role could not be settled gets the Technician's view (fails closed)", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "u1", isAgency: false, role: null, canManage: false });
    await render({ who: "mine" });
    expect((listContactsMock.mock.calls[0]![2] as { assignee?: unknown }).assignee).toBeUndefined();
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ canAssign: false }));
  });

  it("Staff: the table gets the current who, canAssign, and the team as picker options (name, else email)", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    await render({ who: "mine" });
    expect(listAccountTeamMock).toHaveBeenCalledWith(expect.anything(), "a1");
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({
      who: "mine", canAssign: true,
      members: [
        { userId: "p-me", label: "Ana Me", role: "staff" },
        { userId: "p-t", label: "tech@x.test", role: "technician" },
      ],
    }));
  });

  it("the rendered Older link keeps who=mine (mutation: drop who from the pager -> FAILS)", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    listContactsMock.mockResolvedValueOnce(Array.from({ length: 51 }, (_, i) => ({
      id: `c${i}`, first_name: "A", last_name: null, email: null, phone: null,
      company_name: null, source: null, sort_name: `a${i}`, created_at: "2026-01-01T00:00:00Z",
    })));
    const html = await render({ who: "mine" });
    const older = html.match(/href="(\?[^"]*before=[^"]*)"/)?.[1];
    expect(older).toBeDefined();
    expect(new URLSearchParams(older!.slice(1).replace(/&amp;/g, "&")).get("who")).toBe("mine");
  });

  it("the search form keeps who as a hidden field, so a search stays inside Mine", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    const html = await render({ who: "mine" });
    expect(html).toContain('<input type="hidden" name="who" value="mine"');
  });

  it("…and All carries no hidden who at all", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    const html = await render({});
    expect(html).not.toContain('name="who"');
  });
});

describe("the pager builders carry who", () => {
  const lastRow = { sort_name: "a", company_name: null, created_at: "2026-09-09T12:00:00Z", id: "6b503e2f-3cd3-4531-a0af-5cfaf9bc158e" };
  it("Newer and Older carry who=mine (mutation: drop withWho from either -> FAILS)", () => {
    expect(buildNewerHref(true, "x", "name", "asc", "mine")).toContain("who=mine");
    expect(buildOlderHref(true, lastRow, "x", "name", "asc", "mine")).toContain("who=mine");
    expect(buildNewerHref(true, undefined, "name", "asc", "unassigned")).toContain("who=unassigned");
  });
  it("All adds nothing", () => {
    expect(buildNewerHref(true, "x", "name", "asc", "all")).not.toContain("who=");
    expect(buildOlderHref(true, lastRow, "x", "name", "asc")).not.toContain("who=");
  });
  it("Export never carries who (it exports the search, not the filter)", () => {
    expect(buildExportHref("/b", "x", "name", "asc")).not.toContain("who=");
  });
});

// F-085 part 1 (spec §9, Task 7): the filter row, the filtered empty states,
// and Import for those who see the whole account only.
describe("the All · Mine · Unassigned row and its empty states (F-085)", () => {
  const STAFF = { userId: "u1", isAgency: false, role: "staff" as const, canManage: false };
  const OWNER = { userId: "u1", isAgency: false, role: "owner" as const, canManage: true };
  const TECH = { userId: "u1", isAgency: false, role: "technician" as const, canManage: false };
  const UNSETTLED = { userId: "u1", isAgency: false, role: null, canManage: false };
  const NAV = `aria-label="${m["assign.filter.label"]}"`;
  async function render(searchParams: Record<string, string>) {
    return renderToStaticMarkup(
      await ContactsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }
  const navOf = (html: string) => html.match(/<nav[^>]*aria-label="Show"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
  const hrefs = (nav: string) => [...nav.matchAll(/href="([^"]*)"/g)].map((x) => x[1]!.replace(/&amp;/g, "&"));

  it("Owner, Staff and the agency get the filter row (mutation: render it for nobody -> FAILS)", async () => {
    for (const who of [OWNER, STAFF]) {
      requireAccountAccessMock.mockResolvedValueOnce(who);
      expect(await render({})).toContain(NAV);
    }
    expect(await render({})).toContain(NAV); // the default mock: the agency
  });

  it("a Technician, and a client whose role is unsettled, get no filter row (mutation: render it for everyone -> FAILS)", async () => {
    for (const who of [TECH, UNSETTLED]) {
      requireAccountAccessMock.mockResolvedValueOnce(who);
      expect(await render({ who: "mine" })).not.toContain(NAV);
    }
  });

  it("the agency (no person in this company) gets All and Unassigned, no Mine", async () => {
    readPersonIdMock.mockResolvedValueOnce(null);
    const nav = navOf(await render({}));
    expect(nav).toContain(m["assign.unassigned"]);
    expect(nav).not.toContain(`>${m["assign.filter.mine"]}<`);
  });

  it("its links keep the search and sort, mark the current filter, and drop the cursor (mutation: carry before -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    const html = await render({ who: "mine", q: "ana", sort: "name", dir: "asc", before: "eyJ2IjoiYSJ9" });
    const nav = navOf(html);
    expect(nav).toMatch(new RegExp(`aria-current="page"[^>]*>${m["assign.filter.mine"]}<`));
    const links = hrefs(nav);
    expect(links).toHaveLength(3);
    for (const h of links) {
      const qs = new URLSearchParams(h.split("?")[1] ?? "");
      expect(h.startsWith("/dashboard/accounts/a1/contacts")).toBe(true);
      expect(qs.get("q")).toBe("ana");
      expect(qs.get("sort")).toBe("name");
      expect(qs.get("before")).toBeNull();
    }
  });

  it("a zero-row page one inside Mine says so (mutation: show the plain 'no contacts yet' -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    listContactsMock.mockResolvedValueOnce([]);
    const html = await render({ who: "mine" });
    expect(html).toContain(m["assign.empty.mine"]);
    expect(html).not.toContain(m["contacts.empty.title"]);
    expect(html).toContain(NAV); // the way back to All is still there
  });

  it("a zero-row page one inside Unassigned says every customer has someone", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    listContactsMock.mockResolvedValueOnce([]);
    expect(await render({ who: "unassigned" })).toContain(m["assign.empty.unassigned"]);
  });

  it("a search inside a filter that finds nothing is still 'no matches' (the search is the narrower fact)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    listContactsMock.mockResolvedValueOnce([]);
    const html = await render({ who: "mine", q: "zzz" });
    expect(html).toContain(m["contacts.noMatches.title"]);
    expect(html).not.toContain(m["assign.empty.mine"]);
  });

  it("a Technician's zero-row page one gets their own sentence (mutation: show the Owner's 'no contacts yet' -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    listContactsMock.mockResolvedValueOnce([]);
    const html = await render({});
    expect(html).toContain(m["assign.empty.technician"]);
    expect(html).not.toContain(m["contacts.empty.title"]);
  });

  it("All with zero rows is the plain empty state, as before", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    listContactsMock.mockResolvedValueOnce([]);
    expect(await render({})).toContain(m["contacts.empty.title"]);
  });

  it("Import is hidden from a Technician and an unsettled role, like Export (mutation: render Import for everyone -> FAILS)", async () => {
    for (const who of [TECH, UNSETTLED]) {
      requireAccountAccessMock.mockResolvedValueOnce(who);
      const html = await render({});
      expect(html).not.toContain(m["contacts.import"]);
      expect(html).not.toContain("/contacts/import");
    }
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    expect(await render({})).toContain(m["contacts.import"]);
  });
});

// F-085 follow-up (Task B): the list now resolves its own render locale
// (requestLocale), the same role split the contact and group record pages
// already pin — a client's own account language, an agency operator's own
// English regardless of the account they're looking at.
describe("the reader's own language (requestLocale; F-085 follow-up, Task B)", () => {
  async function render(searchParams: Record<string, string> = {}) {
    return renderToStaticMarkup(
      await ContactsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }

  it("a client-role Owner on a Spanish account reads the list in Spanish, lang set (mutation: drop language from the accounts select -> English, FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "u1", isAgency: false, role: "owner", canManage: true });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    const html = await render();
    expect(html).toMatch(/<div lang="es"/);
    expect(html).toContain(">Contactos<");
    expect(html).toContain(m["contacts.export.es"]);
    // F-085 follow-ups (design m3): the longer Spanish placeholder truncated at 390px.
    expect(html).toContain('placeholder="Buscar contactos"');
  });

  it("an agency operator on that same Spanish account reads English (requestLocale's role split; mutation: pass isOperator false -> Spanish, FAILS)", async () => {
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    const html = await render();
    expect(html).toMatch(/<div lang="en"/);
    expect(html).toContain(">Contacts<");
    expect(html).not.toContain(m["contacts.export.es"]);
  });

  it("the Mine/Unassigned filter and an empty state read Spanish too, from the same tr (mutation: pass the filter a bare locale='en' -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "u1", isAgency: false, role: "staff", canManage: false });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    listContactsMock.mockResolvedValueOnce([]);
    const html = await render({ who: "mine" });
    expect(html).toContain(m["assign.empty.mine.es"]);
    expect(html).toContain(`aria-label="${m["assign.filter.label.es"]}"`);
  });
});

// Contact archive (plan Task 10, spec §4.1): `?view=archived` is the Archived view. Both reads take the
// view's filter, so the header's total and the pager describe the rows shown; every link the page builds
// keeps the view; the list leaves archived contacts out.
describe("the Archived view (?view=archived)", () => {
  const STAFF = { userId: "u1", isAgency: false, role: "staff" as const, canManage: false };
  const OWNER = { userId: "u1", isAgency: false, role: "owner" as const, canManage: true };
  const TECH = { userId: "u1", isAgency: false, role: "technician" as const, canManage: false };
  const lastRow = { sort_name: "a", company_name: null, created_at: "2026-09-09T12:00:00Z", id: "6b503e2f-3cd3-4531-a0af-5cfaf9bc158e" };
  async function render(searchParams: Record<string, string>) {
    return renderToStaticMarkup(
      await ContactsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }
  function resetMocks() {
    listContactsMock.mockClear();
    countContactsMock.mockClear();
    contactsTableMock.mockClear();
  }
  /** Every link's and button's accessible text, entities decoded. */
  const controls = (html: string) => [...html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((x) => x[2]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim());
  const hrefOf = (html: string, text: string) =>
    [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
      .find((x) => x[2]!.replace(/<[^>]+>/g, "").trim() === text)?.[1]?.replace(/&amp;/g, "&");

  it("?view=archived reads ONLY archived contacts in both the list and the count; the default leaves them out of both (mutation: pass archived to one read only -> FAILS)", async () => {
    resetMocks();
    await render({ view: "archived" });
    expect(listContactsMock.mock.calls[0]![2]).toMatchObject({ archived: "only" });
    expect(countContactsMock.mock.calls[0]![2]).toMatchObject({ archived: "only" });
    resetMocks();
    await render({});
    expect(listContactsMock.mock.calls[0]![2]).toMatchObject({ archived: "exclude" });
    expect(countContactsMock.mock.calls[0]![2]).toMatchObject({ archived: "exclude" });
    resetMocks();
    await render({ view: "something-else" });
    expect(listContactsMock.mock.calls[0]![2]).toMatchObject({ archived: "exclude" });
  });

  it("the pager keeps view=archived, and the list's pager adds nothing (mutation: drop withView -> FAILS)", () => {
    const older = buildOlderHref(true, lastRow, "x", "name", "asc", "all", "archived")!;
    expect(new URLSearchParams(older.slice(1)).get("view")).toBe("archived");
    expect(new URLSearchParams(older.slice(1)).get("before")).not.toBeNull();
    expect(new URLSearchParams(buildNewerHref(true, "x", "name", "asc", "all", "archived")!.slice(1)).get("view")).toBe("archived");
    expect(buildOlderHref(true, lastRow, "x", "name", "asc", "all")).not.toContain("view=");
    expect(buildNewerHref(true, "x", "name", "asc", "all", "active")).not.toContain("view=");
  });

  it("Export exports the view it was opened from (spec §4.1)", () => {
    expect(new URLSearchParams(buildExportHref("/b", "x", "name", "asc", "archived").split("?")[1]).get("view")).toBe("archived");
    expect(buildExportHref("/b", "x", "name", "asc")).not.toContain("view=");
  });

  it("the rendered Older link in the Archived view stays in it", async () => {
    resetMocks();
    listContactsMock.mockResolvedValueOnce(Array.from({ length: 51 }, (_, i) => ({
      id: `c${i}`, first_name: "A", last_name: null, email: null, phone: null,
      company_name: null, source: null, sort_name: `a${i}`, created_at: "2026-01-01T00:00:00Z",
    })));
    const html = await render({ view: "archived" });
    const older = html.match(/href="(\?[^"]*before=[^"]*)"/)?.[1];
    expect(older).toBeDefined();
    expect(new URLSearchParams(older!.slice(1).replace(/&amp;/g, "&")).get("view")).toBe("archived");
  });

  it("the search form keeps the view as a hidden field there, and adds none on the list", async () => {
    expect(await render({ view: "archived" })).toContain('<input type="hidden" name="view" value="archived"');
    expect(await render({})).not.toContain('name="view"');
  });

  it("its header: the Archived title and total, Export kept, Import and Add contact gone, no Mine/Unassigned row, and Back to contacts", async () => {
    resetMocks();
    countContactsMock.mockResolvedValueOnce(3);
    const html = await render({ view: "archived" });
    expect(html).toContain(`>${m["contacts.archived.title"]}<`);
    expect(html).toContain(">3 archived<");
    expect(html).toContain(m["contacts.export"]);
    expect(html).not.toContain(m["contacts.import"]);
    expect(html).not.toContain(`aria-label="${m["assign.filter.label"]}"`);
    expect(hrefOf(html, m["contacts.archived.back"])).toBe("/dashboard/accounts/a1/contacts");
    expect(html).not.toContain(`>${m["contacts.archived.link"]}<`);
    // A Mine filter carried in from the list does not narrow the Archived view: it has no such row.
    expect((listContactsMock.mock.calls[0]![2] as { assignee?: unknown }).assignee).toBeUndefined();
  });

  it("one archived is singular, and the header reads Spanish for a Spanish reader", async () => {
    countContactsMock.mockResolvedValueOnce(1);
    expect(await render({ view: "archived" })).toContain(">1 archived<");
    requireAccountAccessMock.mockResolvedValueOnce(OWNER);
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    const es = await render({ view: "archived" });
    expect(es).toContain(`>${(m as Record<string, string>)["contacts.archived.title.es"]}<`);
    expect(es).toContain(`>${(m as Record<string, string>)["contacts.archived.back.es"]}<`);
  });

  it("the list links to the Archived view for Owners, Staff and the agency, and not for a Technician", async () => {
    for (const who of [OWNER, STAFF]) {
      requireAccountAccessMock.mockResolvedValueOnce(who);
      expect(hrefOf(await render({}), m["contacts.archived.link"])).toBe("?view=archived");
    }
    expect(hrefOf(await render({}), m["contacts.archived.link"])).toBe("?view=archived"); // the agency
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    expect(hrefOf(await render({}), m["contacts.archived.link"])).toBeUndefined();
  });

  it("the Archived view's empty state says what appears there, with the way back (rule 5; mutation: the list's empty state -> FAILS)", async () => {
    listContactsMock.mockResolvedValueOnce([]);
    const html = await render({ view: "archived" });
    expect(html).toContain(m["contacts.archived.emptyTitle"]);
    expect(html).toContain(m["contacts.archived.emptyBody"]);
    expect(html).not.toContain(m["contacts.empty.title"]);
    expect(hrefOf(html, m["contacts.archived.back"])).toBe("/dashboard/accounts/a1/contacts");
    // A search that found nothing in it is still "no matches", the narrower fact.
    listContactsMock.mockResolvedValueOnce([]);
    expect(await render({ view: "archived", q: "zzz" })).toContain(m["contacts.noMatches.title"]);
  });

  it("exactly ONE Back to contacts link in every state of the Archived view, so the e2e's getByRole link locator is never ambiguous (mutation: keep the header's link beside the empty state's -> FAILS)", async () => {
    const backs = (html: string) => controls(html).filter((c) => c === m["contacts.archived.back"]).length;
    expect(backs(await render({ view: "archived" }))).toBe(1);
    listContactsMock.mockResolvedValueOnce([]);
    expect(backs(await render({ view: "archived" }))).toBe(1);
    listContactsMock.mockResolvedValueOnce([]);
    expect(backs(await render({ view: "archived", q: "zzz" }))).toBe(1);
  });

  it("no link or button on either view is named exactly 'Contacts' (the e2e's unscoped sidebar locator)", async () => {
    for (const view of [{}, { view: "archived" }] as Record<string, string>[]) {
      listContactsMock.mockResolvedValueOnce([]);
      expect(controls(await render(view))).not.toContain("Contacts");
      expect(controls(await render(view))).not.toContain("Contacts");
    }
  });

  it("the table gets the view and canArchive (seesWholeAccount), for the bulk bar (mutation: canArchive from canManage -> Staff FAILS)", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    await render({ view: "archived" });
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ view: "archived", canArchive: true }));
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    await render({});
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ view: "active", canArchive: false }));
  });
});

describe("a paused account (final review M3)", () => {
  it("the table learns the account is paused, so both delete dialogs keep Delete off (mutation: pass paused false -> FAILS)", async () => {
    contactsTableMock.mockClear();
    verdictPaused.on = true;
    try {
      // A client Owner: paused turns Delete off.
      requireAccountAccessMock.mockResolvedValueOnce({ userId: "u1", isAgency: false, role: "owner", canManage: true });
      renderToStaticMarkup(await ContactsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({}) }));
      expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ paused: true }));
      // The agency is never refused a delete on a paused account (final review minor; mutation: drop !access.isAgency -> FAILS).
      contactsTableMock.mockClear();
      renderToStaticMarkup(await ContactsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({}) }));
      expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ paused: false }));
    } finally { verdictPaused.on = false; }
    contactsTableMock.mockClear();
    renderToStaticMarkup(await ContactsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({}) }));
    expect(contactsTableMock).toHaveBeenCalledWith(expect.objectContaining({ paused: false }));
  });
});

// F-006 part 1 (plan Task 10): the Possible duplicates view.
describe("the Possible duplicates view (?view=duplicates)", () => {
  const STAFF = { userId: "u1", isAgency: false, role: "staff" as const, canManage: false };
  const TECH = { userId: "u1", isAgency: false, role: "technician" as const, canManage: false };
  // contact_duplicate_flags.id is a real uuid (0033) — parseCursor's own id check refuses anything
  // else, so a fixture using a bare string like "flag-1" would silently cold-start every pager test.
  const flagId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const PAIR = (n: number) => ({
    id: flagId(n), reason: "same_phone", strength: 1, createdAt: "2026-10-29T07:00:00.000000+00:00",
    a: { id: `a${n}`, firstName: `Maria${n}`, lastName: "Garcia" },
    b: { id: `b${n}`, firstName: `Maria${n}`, lastName: "G." },
  });
  async function render(searchParams: Record<string, string>) {
    return renderToStaticMarkup(
      await ContactsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }
  function resetMocks() {
    listContactsMock.mockClear();
    countContactsMock.mockClear();
    listDuplicatePairsMock.mockClear();
    countDuplicatePairsMock.mockClear();
    duplicatesListProps.length = 0;
  }
  const controls = (html: string) => [...html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((x) => x[2]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim());
  const hrefOf = (html: string, text: string) =>
    [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
      .find((x) => x[2]!.replace(/<[^>]+>/g, "").trim() === text)?.[1]?.replace(/&amp;/g, "&");

  it("reads listDuplicatePairs and countDuplicatePairs, never listContacts/countContacts (mutation: fall through to the active list's reads -> FAILS)", async () => {
    resetMocks();
    listDuplicatePairsMock.mockResolvedValue([PAIR(1)]);
    countDuplicatePairsMock.mockResolvedValue(7);
    await render({ view: "duplicates" });
    expect(listDuplicatePairsMock).toHaveBeenCalledTimes(1);
    expect(countDuplicatePairsMock).toHaveBeenCalledTimes(1);
    expect(listContactsMock).not.toHaveBeenCalled();
    expect(countContactsMock).not.toHaveBeenCalled();
  });

  it("the header states the REAL total from countDuplicatePairs, never the rows shown (mutation: render rows.length -> FAILS with count 7 and 3 rows)", async () => {
    resetMocks();
    listDuplicatePairsMock.mockResolvedValue([PAIR(1), PAIR(2), PAIR(3)]);
    countDuplicatePairsMock.mockResolvedValue(7);
    const html = await render({ view: "duplicates" });
    expect(html).toContain(">7 possible duplicates<");
    expect(html).not.toContain(">3 possible duplicates<");
  });

  it("a Technician asking for the view gets the active list instead (mutation: read duplicates for everyone -> FAILS)", async () => {
    resetMocks();
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    await render({ view: "duplicates" });
    expect(listDuplicatePairsMock).not.toHaveBeenCalled();
    expect(countDuplicatePairsMock).not.toHaveBeenCalled();
    expect(listContactsMock).toHaveBeenCalled();
  });

  it("the active view's toolbar offers 'Possible duplicates' beside 'Archived', for those who see the whole account only", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    expect(hrefOf(await render({}), m["contacts.duplicates.link"])).toBe("?view=duplicates");
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    expect(hrefOf(await render({}), m["contacts.duplicates.link"])).toBeUndefined();
  });

  it("the empty state sells the feature (rule 5; mutation: the active list's empty state -> FAILS)", async () => {
    resetMocks();
    listDuplicatePairsMock.mockResolvedValue([]);
    countDuplicatePairsMock.mockResolvedValue(0);
    const html = await render({ view: "duplicates" });
    expect(html).toContain(m["contacts.duplicates.emptyTitle"]);
    expect(html).toContain(m["contacts.duplicates.emptyBody"]);
  });

  it("a failed read renders contacts.duplicates.listFailed with Retry, never throwing the page", async () => {
    resetMocks();
    listDuplicatePairsMock.mockRejectedValueOnce(new Error("boom"));
    const html = await render({ view: "duplicates" });
    expect(html.replace(/&#x27;/g, "'")).toContain(m["contacts.duplicates.listFailed"]);
    expect(hrefOf(html, m["record.card.retry"])).toBeDefined();
  });

  it("the pager names 'Next' and 'Back to the start' (2026-10-17 amendment: not sorted by recency alone), the start link dropping the cursor", async () => {
    resetMocks();
    listDuplicatePairsMock.mockResolvedValue(Array.from({ length: 51 }, (_, i) => PAIR(i)));
    const html = await render({ view: "duplicates" });
    expect(html).toContain(`>${m["contacts.duplicates.next"]}<`);
    const olderHref = hrefOf(html, m["contacts.duplicates.next"]);
    expect(olderHref).toContain("view=duplicates");
    expect(olderHref).toContain("before=");
    const before = new URLSearchParams(olderHref!.slice(1)).get("before")!;
    const html2 = await render({ view: "duplicates", before });
    const startHref = hrefOf(html2, m["contacts.duplicates.first"]);
    expect(startHref).toContain("view=duplicates");
    expect(startHref).not.toContain("before=");
  });

  it("the list's rows bind dismiss/undismiss to this account, not a checkbox bar", async () => {
    resetMocks();
    listDuplicatePairsMock.mockResolvedValue([PAIR(1)]);
    await render({ view: "duplicates" });
    expect(duplicatesListProps.at(-1)!.rows).toHaveLength(1);
    expect(typeof duplicatesListProps.at(-1)!.dismissAction).toBe("function");
    expect(typeof duplicatesListProps.at(-1)!.undismissAction).toBe("function");
  });
});
