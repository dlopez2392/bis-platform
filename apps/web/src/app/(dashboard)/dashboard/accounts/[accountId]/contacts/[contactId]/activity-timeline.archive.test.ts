import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

/**
 * Contact archive (0103, spec §4.2, §6.2; plan Task 7): the archive/restore row on the record page's
 * timeline. Render approach copied from activity-timeline.rows.test.ts.
 */
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-10-09T16:12:00Z";
const render = (entries: TimelineEntry[], locale: "en" | "es" = "en") => {
  const tr = makeTr(locale);
  const rows = timelineRows(entries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: { user_dan: "Dan López" }, personaName: null, tr } });
  const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale, emailAction: async () => {}, smsAction: async () => {} });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
};
const row = (html: string) => html.match(/<div data-timeline-item="archive"[\s\S]*?<\/li>/)?.[0] ?? "";

describe("an archive/restore row renders as one: its verb, its mark and the Archive/ArchiveRestore icon (contact archive, DESIGN.md Provenance; mutation: return null for the archive case -> FAILS)", () => {
  it("a person's archive carries the person mark, 'archived this contact', and the Archive icon", () => {
    const entries: TimelineEntry[] = [{ kind: "archive", id: "g1", at: AT, contactId: "c1",
      archive: { action: "archived", author_kind: "person", author_id: "user_dan", sign: null } }];
    const r = row(render(entries));
    expect(r).toContain(">archived this contact<");
    expect(r).toMatch(/data-author-mark="person"/);
    expect(r).toContain(">Dan López<");
    expect(r).toContain("lucide-archive ");
    expect(r).not.toContain("lucide-archive-restore");
  });

  it("a customer's own sign restore reads 'came back: sent you a text' under the customer mark, with the ArchiveRestore icon (mutation: wear the Archive icon on a restore -> FAILS)", () => {
    const entries: TimelineEntry[] = [{ kind: "archive", id: "g2", at: AT, contactId: "c1",
      archive: { action: "restored", author_kind: "customer", author_id: null, sign: "text" } }];
    const r = row(render(entries));
    expect(r).toContain(">came back: sent you a text<");
    expect(r).toMatch(/data-author-mark="customer"/);
    expect(r).toContain("lucide-archive-restore ");
  });

  it("a person's own restore reads 'moved this contact back to the list', in Spanish too", () => {
    const entries: TimelineEntry[] = [{ kind: "archive", id: "g3", at: AT, contactId: "c1",
      archive: { action: "restored", author_kind: "person", author_id: "user_dan", sign: null } }];
    expect(row(render(entries, "es"))).toContain(">devolvió este contacto a la lista<");
  });
});
