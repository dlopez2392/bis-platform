import { describe, it, expect } from "vitest";
import { encodeCursor } from "@/lib/cursor";
import { documentsQuery, documentsHref, documentsPagerHrefs, filedOnView } from "./account-list";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const BASE = "/dashboard/accounts/a1/documents";

describe("documentsQuery: the URL is hand-editable, so anything odd is the default (spec 3.1)", () => {
  it("Expiring soon by default; expired and all are kept; anything else is the default (mutation: default all -> FAILS)", () => {
    expect(documentsQuery({}).show).toBe("expiring");
    expect(documentsQuery({ show: "expired" }).show).toBe("expired");
    expect(documentsQuery({ show: "all" }).show).toBe("all");
    expect(documentsQuery({ show: "bogus" }).show).toBe("expiring");
    expect(documentsQuery({ show: ["all"] }).show).toBe("expiring");
  });
  it("a category is one of the nine or nothing", () => {
    expect(documentsQuery({ category: "insurance" }).category).toBe("insurance");
    expect(documentsQuery({ category: "other" }).category).toBe("other");
    expect(documentsQuery({ category: "receipt" }).category).toBeNull();
    expect(documentsQuery({ category: ["insurance"] }).category).toBeNull();
  });
  it("a cursor must fit its list: a day for the expiry lists, an instant for All (mutation: accept any cursor -> FAILS)", () => {
    const day = encodeCursor({ v: "2026-11-01", id: ID });
    const instant = encodeCursor({ v: "2026-10-17T10:00:00.000Z", id: ID });
    expect(documentsQuery({ before: day }).cursor).toEqual({ v: "2026-11-01", id: ID });
    expect(documentsQuery({ show: "all", before: day }).cursor).toBeUndefined();
    expect(documentsQuery({ show: "all", before: instant }).cursor).toEqual({ v: "2026-10-17T10:00:00.000Z", id: ID });
    expect(documentsQuery({ show: "expired", before: instant }).cursor).toBeUndefined();
    expect(documentsQuery({ before: encodeCursor({ v: null, id: ID }) }).cursor).toBeUndefined();
    expect(documentsQuery({ before: "not-base64" }).cursor).toBeUndefined();
  });
  // listAccountDocuments THROWS (TypeError) on an impossible day, and Postgres refuses an instant on one
  // (Date.parse rolls "2026-02-30T…" over to Mar 2), so either must read as page one here, never the
  // error state (orchestrator's Task 9 instruction). (mutation: drop the real-day check -> FAILS)
  it("an impossible calendar day is no cursor, on every list", () => {
    expect(documentsQuery({ before: encodeCursor({ v: "2026-02-31", id: ID }) }).cursor).toBeUndefined();
    expect(documentsQuery({ show: "expired", before: encodeCursor({ v: "2026-13-01", id: ID }) }).cursor).toBeUndefined();
    expect(documentsQuery({ show: "all", before: encodeCursor({ v: "2026-02-30T00:00:00Z", id: ID }) }).cursor).toBeUndefined();
    expect(documentsQuery({ show: "all", before: encodeCursor({ v: "2026-09-03T17:17:48.364157+00:00", id: ID }) }).cursor)
      .toEqual({ v: "2026-09-03T17:17:48.364157+00:00", id: ID });
    expect(documentsQuery({ show: "expired", before: encodeCursor({ v: "2028-02-29", id: ID }) }).cursor).toEqual({ v: "2028-02-29", id: ID });
  });
});

describe("documentsHref and the one pager", () => {
  it("writes the filter, the category and the cursor in the URL (spec 3.1)", () => {
    expect(documentsHref(BASE, { show: "expired", category: "insurance" }, "abc")).toBe(`${BASE}?show=expired&category=insurance&before=abc`);
    expect(documentsHref(BASE, { show: "expiring", category: null })).toBe(`${BASE}?show=expiring`);
  });
  it("Next carries the LAST row's sort key and id; the start link only once paged (mutation: build Next from created_at on an expiry list -> FAILS)", () => {
    const q = documentsQuery({ show: "expiring" });
    const last = { id: ID, created_at: "2026-10-01T00:00:00.000Z", expires_on: "2026-11-05" };
    expect(documentsPagerHrefs(BASE, q, true, last)).toEqual({ next: `${BASE}?show=expiring&before=${encodeCursor({ v: "2026-11-05", id: ID })}`, first: null });
    const all = documentsQuery({ show: "all" });
    expect(documentsPagerHrefs(BASE, all, true, last).next).toBe(`${BASE}?show=all&before=${encodeCursor({ v: "2026-10-01T00:00:00.000Z", id: ID })}`);
    expect(documentsPagerHrefs(BASE, q, false, last).next).toBeNull();
    const paged = documentsQuery({ show: "expiring", before: encodeCursor({ v: "2026-11-01", id: ID }) });
    expect(documentsPagerHrefs(BASE, paged, false, last).first).toBe(`${BASE}?show=expiring`);
  });
  it("both links keep the category; Back to the start drops only the cursor", () => {
    const q = documentsQuery({ show: "expired", category: "permit", before: encodeCursor({ v: "2026-10-01", id: ID }) });
    const last = { id: ID, created_at: "2026-09-01T00:00:00.000Z", expires_on: "2026-09-20" };
    expect(documentsPagerHrefs(BASE, q, true, last)).toEqual({
      next: `${BASE}?show=expired&category=permit&before=${encodeCursor({ v: "2026-09-20", id: ID })}`,
      first: `${BASE}?show=expired&category=permit`,
    });
  });
});

describe("filedOnView: the customer's or household's name, linking to its record", () => {
  it("a customer, a household, and a customer with no name (mutation: link a household's file to a contact -> FAILS)", () => {
    expect(filedOnView("a1", { contact: { id: "c1", first_name: "Ana", last_name: "García" }, group: null, contact_id: "c1", client_group_id: null }, "No name"))
      .toEqual({ name: "Ana García", href: "/dashboard/accounts/a1/contacts/c1" });
    expect(filedOnView("a1", { contact: null, group: { id: "g1", name: "Casa García", kind: "household" }, contact_id: null, client_group_id: "g1" }, "No name"))
      .toEqual({ name: "Casa García", href: "/dashboard/accounts/a1/groups/g1" });
    expect(filedOnView("a1", { contact: { id: "c1", first_name: null, last_name: " " }, group: null, contact_id: "c1", client_group_id: null }, "Sin nombre"))
      .toEqual({ name: "Sin nombre", href: "/dashboard/accounts/a1/contacts/c1" });
  });
});
