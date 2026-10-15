import { describe, it, expect } from "vitest";
import { documentsLoadFrom, type DocumentsResponse } from "./documents-load";

const view = {
  id: "d1", title: "Lease", category: "contract", expiresOn: "2026-11-01", ownersOnly: false, source: "upload",
  addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", deletedAt: null,
  version: { id: "v2", contentType: "application/pdf", bytes: 1200, scan: "clean", createdAt: "2026-10-02T00:00:00Z" },
  versions: [
    { id: "v2", contentType: "application/pdf", bytes: 1200, createdAt: "2026-10-02T00:00:00Z", addedOn: "2026-10-01", scan: "clean" },
    { id: "v1", contentType: "image/jpeg", bytes: 900, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", scan: "clean" },
  ],
  purging: false,
};
const body: DocumentsResponse = {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "c1" },
  live: [view as DocumentsResponse["live"][number]], trashed: [], capped: false, space: { used: 4_500_000_000, quota: 5_368_709_120 },
};
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("documentsLoadFrom: anything but a well-formed 200 is the card's error state (places-load's rule)", () => {
  it("parses a good body", async () => {
    expect(await documentsLoadFrom(res(body))).toEqual({ status: "ready", data: body });
  });
  it.each([
    ["a 500", res({}, 500)],
    ["a category outside the nine", res({ ...body, live: [{ ...view, category: "receipt" }] })],
    ["an SVG version", res({ ...body, live: [{ ...view, version: { ...view.version, contentType: "image/svg+xml" } }] })],
    ["a bad expiry day", res({ ...body, live: [{ ...view, expiresOn: "2026-13-01" }] })],
    ["no today", res({ ...body, today: undefined })],
    ["no added day", res({ ...body, live: [{ ...view, addedOn: undefined }] })],
    ["an impossible added day", res({ ...body, live: [{ ...view, addedOn: "2026-02-30" }] })],
    ["no versions list", res({ ...body, live: [{ ...view, versions: undefined }] })],
    ["an empty versions list", res({ ...body, live: [{ ...view, versions: [] }] })],
    ["a versions list without the current version", res({ ...body, live: [{ ...view, versions: [view.versions[1]] }] })],
    ["an SVG among the versions", res({ ...body, live: [{ ...view, versions: [view.versions[0], { ...view.versions[1], contentType: "image/svg+xml" }] }] })],
    ["a version with no added day", res({ ...body, live: [{ ...view, versions: [{ ...view.versions[0], addedOn: undefined }] }] })],
    ["no space field at all", res({ ...body, space: undefined })],
    ["a negative usage", res({ ...body, space: { used: -1, quota: 5_368_709_120 } })],
    ["a zero quota", res({ ...body, space: { used: 1, quota: 0 } })],
    ["no purging flag", res({ ...body, live: [{ ...view, purging: undefined }] })],
    ["a LIVE file marked purging", res({ ...body, live: [{ ...view, purging: true }] })],
    ["a version with an unknown scan state", res({ ...body, live: [{ ...view, versions: [{ ...view.versions[0], scan: "quarantined" }, view.versions[1]] }] })],
    ["a shown version with no scan state", res({ ...body, live: [{ ...view, version: { ...view.version, scan: undefined } }] })],
  ])("refuses %s (mutation: skip the version check -> FAILS on the SVG case)", async (_l, r) => {
    expect(await documentsLoadFrom(r)).toEqual({ status: "error" });
  });
  it("a null space is a good body: the line is simply not drawn (mutation: refuse a null space -> FAILS)", async () => {
    expect(await documentsLoadFrom(res({ ...body, space: null }))).toEqual({ status: "ready", data: { ...body, space: null } });
  });
  it("'locked' (a password-protected file) parses (owner ruling 2026-10-15)", async () => {
    const locked = { ...body, live: [{ ...view, version: { ...view.version, scan: "locked" }, versions: [{ ...view.versions[0], scan: "locked" }, view.versions[1]] }] };
    expect(await documentsLoadFrom(res(locked))).toEqual({ status: "ready", data: locked });
  });
});
