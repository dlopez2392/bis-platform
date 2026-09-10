import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExportHref, buildNewerHref, buildOlderHref } from "./page";

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
  it("counts with the same search the list uses", () => {
    expect(page).toMatch(/countContacts\(db, accountId, \{ search: q \}\)/);
  });
  it("offers import and export", () => {
    expect(page).toContain('m["contacts.import"]');
    expect(page).toContain('m["contacts.export"]');
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
