import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { removedReason } from "@bis/db/document-rules";
import type { DocumentView, DocumentsLoad } from "./documents-load";
import { rowScan, scanLabel, nextPollMs, viewerNotice, SCAN_SLOW_MS, POLL_FAST_MS, POLL_SLOW_MS } from "./scan-state";

const NOW = "2026-10-15T15:00:00.000Z";
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const doc = (scan: DocumentView["version"]["scan"], createdAt = ago(60_000), versions: Partial<DocumentView["versions"][number]>[] = []): DocumentView => ({
  id: "d1", title: "Lease", category: "contract", expiresOn: null, ownersOnly: false, source: "upload",
  addedBy: { you: true, name: null }, createdAt, addedOn: "2026-10-15", deletedAt: null, purging: false,
  version: { id: "v1", contentType: "application/pdf", bytes: 10, scan, createdAt },
  versions: [{ id: "v1", contentType: "application/pdf", bytes: 10, createdAt, addedOn: "2026-10-15", scan }, ...versions.map((v, i) => ({
    id: `v${i + 2}`, contentType: "application/pdf" as const, bytes: 10, createdAt, addedOn: "2026-10-15", scan: "clean" as const, ...v }))],
});
const load = (live: DocumentView[]): DocumentsLoad => ({ status: "ready", data: { today: "2026-10-15", now: NOW, record: { kind: "contact", id: "c1" }, live, trashed: [], capped: false, space: null } });

describe("a row's scan state (spec 3.5)", () => {
  it("clean is an ordinary row; pending is Checking, slow past 15 minutes; infected and unscannable are their own (mutation: SCAN_SLOW_MS 10 minutes -> FAILS)", () => {
    expect(rowScan(doc("clean"), NOW)).toEqual({ kind: "ok" });
    expect(rowScan(doc("pending", ago(SCAN_SLOW_MS - 1000)), NOW)).toEqual({ kind: "pending", slow: false });
    expect(rowScan(doc("pending", ago(SCAN_SLOW_MS + 1000)), NOW)).toEqual({ kind: "pending", slow: true });
    expect(rowScan(doc("infected"), NOW)).toEqual({ kind: "infected" });
    expect(rowScan(doc("unscannable"), NOW)).toEqual({ kind: "unscannable" });
    expect(SCAN_SLOW_MS).toBe(15 * 60_000);
  });

  it("its words and tone in both languages, rule 3 (mutations: one tone for every state -> FAILS; drop the slow words -> FAILS)", () => {
    expect(scanLabel({ kind: "ok" }, "en")).toBeNull();
    expect(scanLabel({ kind: "pending", slow: false }, "es")).toEqual({ tone: "warn", text: m["documents.status.scanning.es"] });
    expect(scanLabel({ kind: "pending", slow: true }, "es")).toEqual({ tone: "warn", text: `${m["documents.status.scanning.es"]} · ${m["documents.status.scanSlow.es"]}` });
    expect(scanLabel({ kind: "infected" }, "es")).toEqual({ tone: "crit", text: m["documents.status.virusRemoved.es"] });
    expect(scanLabel("unscannable", "en")).toEqual({ tone: "crit", text: m["documents.status.unscannable"] });
    expect(scanLabel("clean", "es")).toBeNull();
  });

  it("the viewer's notice: none for a clean file, one per other state (mutation: a notice for clean -> FAILS)", () => {
    expect([viewerNotice(doc("clean")), viewerNotice(doc("pending")), viewerNotice(doc("infected")), viewerNotice(doc("unscannable"))])
      .toEqual([null, "documents.viewer.scanning", "documents.viewer.virusRemoved", "documents.viewer.unscannable"]);
  });
});

describe("the card's re-read while a file is Checking (spec 3.4: 'Revisando' -> the ordinary row)", () => {
  it("every 5 s while the youngest Checking version is under two minutes old, then every 30 s, and never when nothing is Checking, a NEWER pending version included (mutations: look only at doc.version -> the pending newer version FAILS; poll forever -> FAILS)", () => {
    expect(nextPollMs(load([doc("clean")]))).toBeNull();
    expect(nextPollMs(load([doc("pending", ago(30_000))]))).toBe(POLL_FAST_MS);
    expect(nextPollMs(load([doc("pending", ago(10 * 60_000))]))).toBe(POLL_SLOW_MS);
    expect(nextPollMs(load([doc("clean", ago(60_000), [{ scan: "pending", createdAt: ago(20_000) }])]))).toBe(POLL_FAST_MS);
    expect(nextPollMs({ status: "loading" })).toBeNull();
  });
});

describe("a password-protected file says why (owner ruling 2026-10-15)", () => {
  it("removedReason: a password only from Heuristics.Encrypted.*, the generic cause otherwise (mutation: every unscannable is 'password' -> FAILS; none is -> FAILS)", () => {
    expect([removedReason("infected", "Eicar-Test-Signature"), removedReason("unscannable", "Heuristics.Encrypted.PDF"), removedReason("unscannable", "Heuristics.Encrypted.Zip"),
      removedReason("unscannable", "Heuristics.Limits.Exceeded.MaxFileSize"), removedReason("unscannable", null), removedReason("clean", null), removedReason("pending", null)])
      .toEqual(["virus", "password", "password", "unscannable", "unscannable", null, null]);
  });
  it("the row and the viewer name the password in both languages, never the generic words (mutation: WORD.locked = the unscannable key -> FAILS)", () => {
    for (const [locale, sfx] of [["en", ""], ["es", ".es"]] as const) {
      expect(scanLabel({ kind: "locked" }, locale)).toEqual({ tone: "crit", text: m[`documents.status.passwordRemoved${sfx}` as keyof typeof m] });
      expect(scanLabel({ kind: "locked" }, locale)!.text).not.toBe(m[`documents.status.unscannable${sfx}` as keyof typeof m]);
    }
    expect(viewerNotice(doc("locked"))).toBe("documents.viewer.passwordRemoved");
    expect(viewerNotice(doc("unscannable"))).toBe("documents.viewer.unscannable");
  });
});
