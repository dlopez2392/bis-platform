import { describe, it, expect } from "vitest";
import { documentsLoadFrom, type DocumentsResponse } from "./documents-load";

const view = {
  id: "d1", title: "Lease", category: "contract", expiresOn: "2026-11-01", ownersOnly: false, source: "upload",
  addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", deletedAt: null,
  version: { id: "v1", contentType: "application/pdf", bytes: 1200 },
};
const body: DocumentsResponse = {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "c1" },
  live: [view as DocumentsResponse["live"][number]], trashed: [], capped: false,
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
  ])("refuses %s (mutation: skip the version check -> FAILS on the SVG case)", async (_l, r) => {
    expect(await documentsLoadFrom(r)).toEqual({ status: "error" });
  });
});
