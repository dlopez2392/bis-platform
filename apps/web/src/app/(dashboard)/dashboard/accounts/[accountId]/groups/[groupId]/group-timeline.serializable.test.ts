import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeGroup, ChangeRow, TimelineEntry } from "@bis/db";

/**
 * F-115 PR E fix round 2 (review C1): `GroupTimeline`'s twin of
 * `activity-timeline.serializable.test.ts` — see that file's own doc comment for why this walks the
 * props object by hand rather than round-tripping through `JSON.stringify` (which drops a function
 * silently instead of throwing) or relying on `renderToStaticMarkup` (which has no flight serializer
 * to raise React's real error).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const captured: Record<string, unknown>[] = [];
vi.mock("@/components/record/change-item", () => ({
  ChangeItem: (p: Record<string, unknown>) => { captured.push(p); return null; },
}));

const { GroupTimeline } = await import("./group-timeline");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-11-02T16:12:00Z";
function changeEntry(): TimelineEntry {
  const row: ChangeRow = {
    id: 1, recordType: "contact", recordId: "c-ana", contactId: "c-ana", clientGroupId: null,
    op: "update", field: "phone", before: "+19565550111", after: "+19565550112", xact: "1",
    authorKind: "person", authorId: "user_1", via: null, createdAt: AT,
  };
  const group: ChangeGroup = {
    key: "contact:c-ana:1", recordType: "contact", recordId: "c-ana", authorKind: "person", authorId: "user_1",
    via: null, at: AT, firstAt: AT, steps: [[row]], rows: [row],
  };
  return { kind: "change", id: "00000000-0000-0000-0000-000000000001", at: AT, contactId: "c-ana", group };
}

const ALLOWED_FUNCTION_KEYS = new Set(["putBack", "restore"]);
function findNonSerializable(value: unknown, path: string): string[] {
  if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean" || value === undefined) return [];
  if (typeof value === "function") return ALLOWED_FUNCTION_KEYS.has(path.split(".").pop() ?? "") ? [] : [path];
  if (value instanceof Date || value instanceof Map || value instanceof Set) return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => findNonSerializable(v, `${path}[${i}]`));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => findNonSerializable(v, path ? `${path}.${k}` : k));
  }
  return [path];
}

function render() {
  const tr = makeTr("en");
  const rows = timelineRows([changeEntry()], {
    zone: "America/Chicago", tr, author: { viewerId: null, names: { user_1: "Ana García" }, personaName: null, tr },
  });
  return renderToStaticMarkup(createElement(GroupTimeline, {
    accountId: "a1", timezone: "America/Chicago", rows, failedText: null, emptyText: null,
    pager: { olderHref: null, newerHref: null }, tr, pseudo: false, customerLangs: {},
    nowMs: Date.parse(AT), canWriteHistory: true,
    putBackHistory: async () => ({ ok: false as const, message: "" }),
    restoreHistory: async () => ({ ok: false as const, message: "" }),
  } as never));
}

describe("GroupTimeline -> ChangeItem: every prop that crosses the Server-to-Client boundary is plain (review C1)", () => {
  it("the real props object ChangeItem receives has no function/Date/Map/Set anywhere except putBack/restore (mutation: pass tr={tr} instead of locale/pseudo -> FAILS, tr.text and tr.count are functions)", () => {
    captured.length = 0;
    render();
    expect(captured).toHaveLength(1);
    const bad = findNonSerializable(captured[0], "");
    expect(bad).toEqual([]);
  });

  it("locale and pseudo are the plain values ChangeItem needs to rebuild its own tr (mutation: drop pseudo from the props -> FAILS)", () => {
    captured.length = 0;
    render();
    expect(captured[0]).toMatchObject({ locale: "en", pseudo: false });
    expect(captured[0]).not.toHaveProperty("tr");
  });
});
