import { describe, it, expect } from "vitest";
import {
  parseRequirements, requirementsLoadFrom, requirementsRouteFor, checklistView, shouldReloadRequirements, keepRequirements,
  type RequirementsLoad,
} from "./requirements-load";
import type { DocumentView, DocumentsLoad } from "./documents-load";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseRequirements: the checklist route's answer, strictly", () => {
  it("accepts a list of known categories and states, and the empty list (the list is off)", () => {
    expect(parseRequirements({ items: [{ category: "insurance", state: "met" }] })).toEqual({ items: [{ category: "insurance", state: "met" }] });
    expect(parseRequirements({ items: [] })).toEqual({ items: [] });
  });
  it("refuses the whole answer for a missing items, an Other item, an unknown state or a non-object item (mutation: skip the per-item check -> FAILS)", () => {
    expect(parseRequirements({})).toBeNull();
    expect(parseRequirements(null)).toBeNull();
    expect(parseRequirements({ items: "x" })).toBeNull();
    expect(parseRequirements({ items: [{ category: "insurance", state: "met" }, { category: "other", state: "met" }] })).toBeNull();
    expect(parseRequirements({ items: [{ category: "insurance", state: "done" }] })).toBeNull();
    expect(parseRequirements({ items: ["insurance"] })).toBeNull();
    expect(parseRequirements({ items: [null] })).toBeNull();
  });
  it("answers only the two fields it knows, never an extra one the server sent", () => {
    expect(parseRequirements({ items: [{ category: "id", state: "missing", fileId: "secret" }] })).toEqual({ items: [{ category: "id", state: "missing" }] });
  });
});

describe("requirementsLoadFrom", () => {
  it("is an error for a 500, a 200 with a bad body, and a body that is not JSON", async () => {
    expect(await requirementsLoadFrom(json({}, 500))).toEqual({ kind: "error" });
    expect(await requirementsLoadFrom(json({ items: [{ category: "other", state: "met" }] }))).toEqual({ kind: "error" });
    expect(await requirementsLoadFrom(new Response("<html>", { status: 200 }))).toEqual({ kind: "error" });
  });
  it("is ready with the parsed data otherwise", async () => {
    expect(await requirementsLoadFrom(json({ items: [{ category: "id", state: "expired" }] })))
      .toEqual({ kind: "ready", data: { items: [{ category: "id", state: "expired" }] } });
  });
  it("routes to the contact's own checklist read", () => {
    expect(requirementsRouteFor("acc", "c1")).toBe("/api/accounts/acc/contacts/c1/document-requirements");
  });
});

describe("checklistView (spec 5.3, D10, D11)", () => {
  it("is off when nothing is required", () => {
    expect(checklistView({ items: [] })).toEqual({ kind: "off" });
  });
  it("counts met over required without the skipped, and lists the gaps in the list's order", () => {
    expect(checklistView({ items: [
      { category: "insurance", state: "met" }, { category: "id", state: "missing" }, { category: "photo", state: "skipped" },
      { category: "warranty", state: "checking" }, { category: "permit", state: "expired" },
    ] })).toEqual({
      kind: "on", met: 1, required: 4, complete: false,
      gaps: [{ category: "id", state: "missing" }, { category: "warranty", state: "checking" }, { category: "permit", state: "expired" }],
      skipped: [{ category: "photo", state: "skipped" }],
    });
  });
  it("is complete when every counted item is met, the skipped still listed", () => {
    expect(checklistView({ items: [{ category: "id", state: "met" }, { category: "photo", state: "skipped" }] })).toEqual({
      kind: "on", met: 1, required: 1, complete: true, gaps: [], skipped: [{ category: "photo", state: "skipped" }],
    });
  });
  it("is complete when everything required was skipped: 0 of 0 is not a gap (D11; mutation: complete when required is 0 -> false -> FAILS)", () => {
    expect(checklistView({ items: [{ category: "photo", state: "skipped" }] })).toEqual({
      kind: "on", met: 0, required: 0, complete: true, gaps: [], skipped: [{ category: "photo", state: "skipped" }],
    });
  });
});

const view = (over: Partial<DocumentView> = {}): DocumentView => ({
  id: "d1", title: "Policy", category: "insurance", expiresOn: "2027-01-01", ownersOnly: false, source: "upload",
  addedBy: { you: true, name: null }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-10-01", deletedAt: null,
  version: { id: "v1", contentType: "application/pdf", bytes: 10, scan: "clean", createdAt: "2026-10-01T00:00:00Z" },
  versions: [{ id: "v1", contentType: "application/pdf", bytes: 10, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-10-01", scan: "clean" }],
  purging: false, ...over,
});
const ready = (live: DocumentView[], trashed: DocumentView[] = [], today = "2026-10-16"): DocumentsLoad => ({
  status: "ready",
  data: { today, now: "2026-10-16T15:00:00Z", record: { kind: "contact", id: "c1" }, live, trashed, capped: false, space: null },
});
const D2 = view({ id: "d2", category: "id", expiresOn: null });
const T1 = view({ id: "t1", deletedAt: "2026-10-10T00:00:00Z" });
const T2 = view({ id: "t2", deletedAt: "2026-10-11T00:00:00Z" });

describe("shouldReloadRequirements: the checklist re-reads once per change it depends on, never on a poll's same answer", () => {
  it("is false unless both reads are ready", () => {
    expect(shouldReloadRequirements(null, ready([view()]))).toBe(false);
    expect(shouldReloadRequirements({ status: "loading" }, ready([view()]))).toBe(false);
    expect(shouldReloadRequirements(ready([view()]), { status: "error" })).toBe(false);
  });
  it("is false for the same ready read twice, the poll's loop guard (mutation: always true -> FAILS)", () => {
    expect(shouldReloadRequirements(ready([view(), D2], [T1]), ready([view(), D2], [T1]))).toBe(false);
  });
  it("is true when a live file was added or removed", () => {
    expect(shouldReloadRequirements(ready([view()]), ready([view(), D2]))).toBe(true);
    expect(shouldReloadRequirements(ready([view(), D2]), ready([view()]))).toBe(true);
  });
  it("is true when a live file's category, expiry, shown version or scan state moved", () => {
    expect(shouldReloadRequirements(ready([view()]), ready([view({ category: "permit" })]))).toBe(true);
    expect(shouldReloadRequirements(ready([view()]), ready([view({ expiresOn: "2026-10-20" })]))).toBe(true);
    expect(shouldReloadRequirements(ready([view()]), ready([view({ expiresOn: null })]))).toBe(true);
    expect(shouldReloadRequirements(ready([view()]), ready([view({ version: { ...view().version, scan: "pending" } })]))).toBe(true);
    expect(shouldReloadRequirements(ready([view()]), ready([view({ version: { ...view().version, id: "v2" } })]))).toBe(true);
  });
  it("is true when only the account's day turned (M4; mutation: compare the files only -> FAILS)", () => {
    expect(shouldReloadRequirements(ready([view()], [], "2026-10-16"), ready([view()], [], "2026-10-17"))).toBe(true);
  });
  it("is false when only a title, Owners only, the author or the trash's order changed", () => {
    expect(shouldReloadRequirements(ready([view()], [T1, T2]), ready([view({ title: "Renamed" })], [T1, T2]))).toBe(false);
    expect(shouldReloadRequirements(ready([view()]), ready([view({ ownersOnly: true })]))).toBe(false);
    expect(shouldReloadRequirements(ready([view()]), ready([view({ addedBy: { you: false, name: "Ana" } })]))).toBe(false);
    expect(shouldReloadRequirements(ready([view()], [T1, T2]), ready([view()], [T2, T1]))).toBe(false);
  });
  it("is true when a file moved from live to the trash (it no longer counts)", () => {
    expect(shouldReloadRequirements(ready([view(), D2]), ready([D2], [view({ deletedAt: "2026-10-16T14:00:00Z" })]))).toBe(true);
  });
});

describe("keepRequirements: a failed re-read keeps the list already shown", () => {
  const R = "/api/accounts/a/contacts/c1/document-requirements";
  const shownReady: { route: string; load: RequirementsLoad } = { route: R, load: { kind: "ready", data: { items: [{ category: "id", state: "met" }] } } };
  it("keeps a ready list over a failed re-read of the same route", () => {
    expect(keepRequirements(shownReady, R, { kind: "error" })).toBe(shownReady);
  });
  it("shows a first read's failure", () => {
    expect(keepRequirements({ route: R, load: { kind: "loading" } }, R, { kind: "error" })).toEqual({ route: R, load: { kind: "error" } });
  });
  it("shows another route's failure, and any new ready answer", () => {
    expect(keepRequirements(shownReady, "/other", { kind: "error" })).toEqual({ route: "/other", load: { kind: "error" } });
    const next: RequirementsLoad = { kind: "ready", data: { items: [] } };
    expect(keepRequirements(shownReady, R, next)).toEqual({ route: R, load: next });
  });
});
