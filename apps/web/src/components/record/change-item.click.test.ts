import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeGroup, ChangeRow } from "@bis/db";
import { changeRowView, type ChangeViewCtx } from "@/lib/record/change-rows";
import { makeTr } from "@/lib/record/copy";

/**
 * F-115 PR E fix round 2 (review n1): `change-item.test.ts`'s own "two different fields each carry
 * their OWN row's id in the markup" proves the `data-change-put-back-id` ATTRIBUTE, a completely
 * separate piece of JSX from the `onClick` handler bound to the SAME button — a mutation that
 * hardcodes `onClick={() => void runPutBack(group.rows[0]!.id, f.label)}` (I8's original bug) would
 * still pass that test, since the data attribute is untouched. This file mocks `@/components/ui/button`
 * (a plain function capturing every prop it is called with, `onClick` included) so the REAL closure
 * change-item.tsx builds can be CALLED DIRECTLY — a plain JS function call, never a simulated DOM
 * click, which this repo's own tests never do (no DOM renderer in apps/web) — and the id it actually
 * sends to `putBack` can be asserted against the id a DIFFERENT button's own data attribute names.
 */
const buttonCalls: Record<string, unknown>[] = [];
vi.mock("@/components/ui/button", () => ({
  Button: (p: Record<string, unknown>) => { buttonCalls.push(p); return null; },
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ChangeItem } = await import("./change-item");

const AT = "2026-11-02T16:12:00Z";
const baseRow = (over: Partial<ChangeRow>): ChangeRow => ({
  id: 1, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
  op: "update", field: "phone", before: "+19565550111", after: "+19565550112", xact: "1",
  authorKind: "person", authorId: "user_1", via: null, createdAt: AT,
  ...over,
});
const group = (rows: ChangeRow[]): ChangeGroup => ({
  key: "contact:c1:1", recordType: "contact", recordId: "c1", authorKind: "person", authorId: "user_1",
  via: null, at: AT, firstAt: AT, steps: rows.map((r) => [r]), rows,
});
const ctx = (): ChangeViewCtx => ({ tr: makeTr("en"), zone: "America/Chicago", names: {}, customFieldLabels: {} });
const head = (verb: string) => ({
  kind: "change" as const, mark: { kind: "person" as const, label: "Ana García" },
  verb, status: null, detail: null, time: "Nov 2, 2026, 10:12 AM", dateTime: AT,
});

describe("ChangeItem's own Put back buttons: the onClick each one actually fires (review n1)", () => {
  it("the SECOND field's button sends ITS OWN id (9), never group.rows[0]!.id (5) — proven by actually CALLING the captured onClick, not just reading the data attribute (mutation: onClick={() => void runPutBack(group.rows[0]!.id, f.label)} -> FAILS, putBack would be called with 5)", async () => {
    buttonCalls.length = 0;
    const first = baseRow({ id: 5, field: "phone" });
    const second = baseRow({ id: 9, field: "email", before: "a@x.com", after: "b@x.com" });
    const g = group([first, second]);
    const view = changeRowView(g, ctx());
    const putBack = vi.fn().mockResolvedValue({ ok: true, undo: { changeId: null } });
    renderToStaticMarkup(createElement(ChangeItem, {
      head: head(view.verb), group: g, view, locale: "en", pseudo: false, canWrite: true, nowMs: Date.parse(AT),
      putBack, restore: vi.fn(),
    }) as ReactNode);

    const putBackButtons = buttonCalls.filter((p) => Object.hasOwn(p, "data-change-put-back"));
    expect(putBackButtons).toHaveLength(2);
    const secondButton = putBackButtons.find((p) => p["data-change-put-back-id"] === 9);
    expect(secondButton).toBeDefined();
    (secondButton!.onClick as () => void)();
    await new Promise((r) => setTimeout(r, 0));
    expect(putBack).toHaveBeenCalledWith(9);
    expect(putBack).not.toHaveBeenCalledWith(5);
  });
});
