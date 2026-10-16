import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocumentRequests, documentRequestsLoadFrom, expiresInDays, documentRequestsRouteFor } from "./requests-load";

const valid = () => ({
  now: "2026-10-15T12:00:00.000Z",
  channels: { text: true, email: false },
  requests: [{
    id: "33333333-3333-4333-8333-333333333333", channel: "text", createdAt: "2026-10-14T12:00:00.000Z", expiresAt: "2026-10-21T12:00:00.000Z",
    items: [{ key: "id", category: "id", note: null, answered: true }, { key: "other", category: "other", note: "Roof photo", answered: false }],
  }],
});
type Body = ReturnType<typeof valid>;
const withRequest = (over: Record<string, unknown>): Body => { const b = valid(); b.requests[0] = { ...b.requests[0]!, ...over } as Body["requests"][number]; return b; };
const withItem = (over: Record<string, unknown>): Body => withRequest({ items: [{ ...valid().requests[0]!.items[0]!, ...over }] });

describe("parseDocumentRequests (strict, as documentsLoadFrom)", () => {
  it("a valid body parses to exactly its fields (mutation: drop answered -> FAILS)", () => {
    expect(parseDocumentRequests(valid())).toEqual(valid());
    expect(parseDocumentRequests({ ...valid(), requests: [] })).toEqual({ ...valid(), requests: [] });
  });
  it("an item whose answered is not a boolean makes the WHOLE parse null (mutation: accept it -> FAILS)", () => {
    expect(parseDocumentRequests(withItem({ answered: "yes" }))).toBeNull();
    expect(parseDocumentRequests(withItem({ answered: undefined }))).toBeNull();
  });
  it("a channel outside text/email/link makes the whole parse null (mutation: accept any string -> FAILS)", () => {
    expect(parseDocumentRequests(withRequest({ channel: "fax" }))).toBeNull();
    for (const channel of ["text", "email", "link"]) expect(parseDocumentRequests(withRequest({ channel }))?.requests[0]?.channel).toBe(channel);
  });
  it("an unknown category, a key that is not its category, a bad note, no items, a bad instant or bad channels are null (mutation: skip the key check -> FAILS)", () => {
    expect(parseDocumentRequests(withItem({ category: "passport", key: "passport" }))).toBeNull();
    expect(parseDocumentRequests(withItem({ key: "contract" }))).toBeNull();
    expect(parseDocumentRequests(withItem({ note: 4 }))).toBeNull();
    expect(parseDocumentRequests(withRequest({ items: [] }))).toBeNull();
    expect(parseDocumentRequests(withRequest({ expiresAt: "soon" }))).toBeNull();
    expect(parseDocumentRequests({ ...valid(), now: "later" })).toBeNull();
    expect(parseDocumentRequests({ ...valid(), channels: { text: true } })).toBeNull();
    expect(parseDocumentRequests({ ...valid(), requests: {} })).toBeNull();
    expect(parseDocumentRequests(null)).toBeNull();
  });
});

describe("documentRequestsLoadFrom", () => {
  it("ready for a 200 with a valid body; error for a non-200, unparseable JSON or a body that does not parse (mutation: ready on any 200 -> FAILS)", async () => {
    expect(await documentRequestsLoadFrom(new Response(JSON.stringify(valid()), { status: 200 }))).toEqual({ kind: "ready", data: valid() });
    expect(await documentRequestsLoadFrom(new Response("{}", { status: 404 }))).toEqual({ kind: "error" });
    expect(await documentRequestsLoadFrom(new Response("not json", { status: 200 }))).toEqual({ kind: "error" });
    expect(await documentRequestsLoadFrom(new Response(JSON.stringify(withRequest({ channel: "fax" })), { status: 200 }))).toEqual({ kind: "error" });
  });
});

describe("expiresInDays (whole days left, rounded UP, never below 0)", () => {
  it("6 days 23 hours is 7 (mutation: round down -> FAILS)", () => {
    expect(expiresInDays("2026-10-22T10:00:00Z", "2026-10-15T11:00:00Z")).toBe(7);
  });
  it("one hour left is 1, not 0 (mutation: round down -> FAILS)", () => {
    expect(expiresInDays("2026-10-15T10:00:00Z", "2026-10-15T09:00:00Z")).toBe(1);
  });
  it("an instant past is 0, never negative (mutation: drop the floor -> FAILS)", () => {
    expect(expiresInDays("2026-10-13T10:00:00Z", "2026-10-15T09:00:00Z")).toBe(0);
  });
});

describe("documentRequestsRouteFor", () => {
  it("a group reads the groups route, a contact the contacts route (mutation: one route for both -> FAILS)", () => {
    expect(documentRequestsRouteFor("a", { kind: "group", id: "g" })).toBe("/api/accounts/a/groups/g/document-requests");
    expect(documentRequestsRouteFor("a", { kind: "contact", id: "c" })).toBe("/api/accounts/a/contacts/c/document-requests");
  });
});

describe("browser-safe", () => {
  it("imports only from @bis/db/document-rules: never the barrel, never node: (mutation: import the barrel -> FAILS)", () => {
    const src = readFileSync(join(__dirname, "requests-load.ts"), "utf8");
    const froms = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((x) => x[1]);
    expect(froms).toEqual(["@bis/db/document-rules"]);
  });
});
