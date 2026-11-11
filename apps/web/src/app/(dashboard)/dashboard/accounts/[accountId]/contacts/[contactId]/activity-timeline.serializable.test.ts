import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeGroup, ChangeRow, TimelineEntry } from "@bis/db";

/**
 * F-115 PR E fix round 2 (review C1): `ActivityTimeline` is a SERVER component; `ChangeItem`
 * ("use client", `components/record/change-item.tsx`) is not. Every prop that crosses that boundary
 * must be plain and JSON-shaped — a `Tr` object (`tr={tr}`, the bug this guards) carries FUNCTIONS
 * (`text`/`count`), which React's real RSC flight serializer refuses to send to the browser
 * ("Functions cannot be passed directly to Client Components…"); `renderToStaticMarkup` never raises
 * that error (it has no flight serializer), so this walks the props object by hand instead — the
 * only way a vitest-only check can catch what only a real browser otherwise would.
 */
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const captured: Record<string, unknown>[] = [];
vi.mock("@/components/record/change-item", () => ({
  ChangeItem: (p: Record<string, unknown>) => { captured.push(p); return null; },
}));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-11-02T16:12:00Z";
const changeRow = (over: Partial<ChangeRow> = {}): ChangeRow => ({
  id: 1, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
  op: "update", field: "phone", before: "+19565550111", after: "+19565550112", xact: "1",
  authorKind: "person", authorId: "user_1", via: null, createdAt: AT,
  ...over,
});
function changeEntry(): TimelineEntry {
  const row = changeRow();
  const group: ChangeGroup = {
    key: "contact:c1:1", recordType: "contact", recordId: "c1", authorKind: "person", authorId: "user_1",
    via: null, at: AT, firstAt: AT, steps: [[row]], rows: [row],
  };
  return { kind: "change", id: "00000000-0000-0000-0000-000000000001", at: AT, contactId: "c1", group };
}

/** Every key (except the two bound Server Actions, which are legitimately functions) must survive a
 *  JSON round trip unchanged — a function, Date, Map or Set anywhere inside would be silently DROPPED
 *  by `JSON.stringify` rather than thrown, so this checks structurally instead of by round-tripping. */
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
  const base = legacyTimeline({
    accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "en",
    emailAction: async () => {}, smsAction: async () => {},
    canWriteHistory: true, nowMs: Date.parse(AT),
    putBackHistory: async () => ({ ok: false as const, message: "" }),
    restoreHistory: async () => ({ ok: false as const, message: "" }),
  });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
}

describe("ActivityTimeline -> ChangeItem: every prop that crosses the Server-to-Client boundary is plain (review C1)", () => {
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
