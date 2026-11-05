import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeGroup, ChangeRow } from "@bis/db";
import { m } from "@/lib/messages";
import { changeRowView, type ChangeViewCtx } from "@/lib/record/change-rows";
import { makeTr } from "@/lib/record/copy";

/**
 * F-115 part 1 (S-04), plan Task 5: no DOM renderer in apps/web (archive-controls.test.ts's own
 * precedent) — `putBackOne`/`restoreOne` are plain exported functions tested directly, and what each
 * role SEES (the mark, the disclosure, Put back, Restore) is read off a real `renderToStaticMarkup`.
 */
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ChangeItem, putBackOne, restoreOne } = await import("./change-item");

const AT = "2026-11-02T16:12:00Z";
const baseRow = (over: Partial<ChangeRow>): ChangeRow => ({
  id: 1, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
  op: "update", field: "phone", before: "+19565550111", after: "+19565550112", xact: "1",
  authorKind: "person", authorId: "user_1", via: null, createdAt: AT,
  ...over,
});
const group = (rows: ChangeRow[], over: Partial<ChangeGroup> = {}): ChangeGroup => ({
  key: "contact:c1:1", recordType: "contact", recordId: "c1", authorKind: "person", authorId: "user_1",
  via: null, at: AT, firstAt: AT, steps: [rows], rows,
  ...over,
});
const ctx = (over: Partial<ChangeViewCtx> = {}): ChangeViewCtx => ({
  tr: makeTr("en"), zone: "America/Chicago", names: { user_1: "Ana García" }, customFieldLabels: {}, ...over,
});

beforeEach(() => {
  toasts.success.mockClear(); toasts.error.mockClear(); router.refresh.mockClear(); router.push.mockClear();
});

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
type ToastOpts = { action?: { label: string; onClick: () => void } } | undefined;
const optsOf = (call: unknown[] | undefined) => call?.[1] as ToastOpts;

describe("putBackOne (rule 6: runs at once, an Undo that is itself a Put back)", () => {
  it("success toasts the field's own name, and the Undo calls putBack again with the NEW row's id (mutation: Undo reuses the same changeId -> FAILS)", async () => {
    const putBack = vi.fn()
      .mockResolvedValueOnce({ ok: true, undo: { changeId: 42 } })
      .mockResolvedValueOnce({ ok: true, undo: { changeId: null } });
    const onDone = vi.fn();
    await putBackOne(putBack, 1, "Phone", { locale: "en", onDone });
    expect(putBack).toHaveBeenCalledWith(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("Phone is back to what it was.");
    const opts = optsOf(toasts.success.mock.calls[0]);
    expect(opts?.action?.label).toBe("Undo");
    opts!.action!.onClick();
    await flush();
    expect(putBack).toHaveBeenCalledWith(42);
  });

  it("no Undo offered when the server names no new row (mutation: offer Undo anyway -> FAILS)", async () => {
    const putBack = vi.fn().mockResolvedValue({ ok: true, undo: { changeId: null } });
    await putBackOne(putBack, 1, "Phone", { locale: "en", onDone: () => {} });
    expect(optsOf(toasts.success.mock.calls.at(-1))?.action).toBeUndefined();
  });

  it("a stale value toasts the server's own message and never calls onDone (mutation: call onDone anyway -> FAILS)", async () => {
    const onDone = vi.fn();
    const putBack = vi.fn().mockResolvedValue({ ok: false, message: "It changed since, so it wasn't put back." });
    await putBackOne(putBack, 1, "Phone", { locale: "en", onDone });
    expect(toasts.error).toHaveBeenCalledWith("It changed since, so it wasn't put back.");
    expect(onDone).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("a thrown call (a stale tab) toasts history.notFound, never a crash (mutation: let it throw -> FAILS)", async () => {
    const putBack = vi.fn().mockRejectedValue(new Error("network"));
    await putBackOne(putBack, 1, "Phone", { locale: "en", onDone: () => {} });
    expect(toasts.error).toHaveBeenCalledWith(m["history.notFound"]);
  });
});

describe("restoreOne (rule 6: runs at once; NO Undo — record-restore.ts has none)", () => {
  it("success toasts the restored thing's own name, with no action at all (mutation: add an Undo action -> FAILS)", async () => {
    const restore = vi.fn().mockResolvedValue({ ok: true, undo: { changeId: 9 } });
    const onDone = vi.fn();
    await restoreOne(restore, 5, "Carrier AC", { locale: "en", onDone });
    expect(restore).toHaveBeenCalledWith(5);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith("Carrier AC is back.");
    expect(optsOf(toasts.success.mock.calls[0])).toBeUndefined();
  });

  it("expired/parentGone/alreadyBack toast the server's own worded refusal (mutation: use a generic error -> FAILS)", async () => {
    const restore = vi.fn().mockResolvedValue({ ok: false, message: "This could be restored for 30 days. That time has passed." });
    await restoreOne(restore, 5, "Carrier AC", { locale: "en", onDone: () => {} });
    expect(toasts.error).toHaveBeenCalledWith("This could be restored for 30 days. That time has passed.");
  });
});

describe("ChangeItem: every row has a mark, Put back per field, Restore on a removal (plan Task 5 Step 3)", () => {
  const head = (view: ReturnType<typeof changeRowView>) => ({
    kind: "change" as const, mark: { kind: "person" as const, label: "Ana García" },
    verb: view.verb, status: null, detail: view.stepsText, time: "Nov 2, 2026, 10:12 AM", dateTime: AT,
  });
  const render = (props: Partial<Parameters<typeof ChangeItem>[0]> & { group: ChangeGroup; view: ReturnType<typeof changeRowView> }) =>
    renderToStaticMarkup(createElement(ChangeItem, {
      head: head(props.view), locale: "en", canWrite: true, nowMs: Date.parse(AT),
      putBack: vi.fn(), restore: vi.fn(),
      ...props,
    }));

  // The provenance rule (DESIGN.md): every rendered row carries its author mark, by both the kind
  // attribute and the visible label — never silently blank. `mark` is a REQUIRED field of `head`
  // (TypeScript), so the mutation that would drop it (making `AuthorMark` conditional, or passing it
  // through blank) is applied BY HAND against the real component in the report, not baked in here: it
  // throws (reads `.kind` off `undefined`) rather than quietly rendering an unmarked row, which is
  // itself the guarantee holding, not a gap in this test.
  it("a changed-field row shows the author mark (kind and label) and, for Owner/Staff/agency, a Put back button (mutation: drop the mark's label -> FAILS)", () => {
    const g = group([baseRow({ field: "phone" })]);
    const view = changeRowView(g, ctx());
    const html = render({ group: g, view });
    expect(html).toContain('data-author-mark="person"');
    expect(html).toContain("Ana Garc"); // the mark's own label (entity-escaped accent, matched by prefix)
    expect(html).toContain(m["history.putBack"]);
    expect(html).toContain("(956) 555-0111"); // Was
    expect(html).toContain("(956) 555-0112"); // Now
  });

  it("Put back is hidden for a Technician (canWrite false), even though the field itself is eligible (mutation: ignore canWrite -> FAILS)", () => {
    const g = group([baseRow({ field: "phone" })]);
    const view = changeRowView(g, ctx());
    const html = render({ group: g, view, canWrite: false });
    expect(html).not.toContain(m["history.putBack"]);
  });

  it("a field Put back does not offer for (dnd: a jsonb CAS the generic writer cannot guard) shows no button even for an Owner (mutation: drop the canPutBack check -> FAILS)", () => {
    const g = group([baseRow({ field: "dnd", before: { sms: true }, after: { sms: false } })]);
    const view = changeRowView(g, ctx());
    const html = render({ group: g, view });
    expect(html).not.toContain(m["history.putBack"]);
  });

  it("a removal within 30 days offers Restore; past the window it does not (mutation: compare against 31 days -> FAILS)", () => {
    const removed = group(
      [baseRow({ recordType: "equipment", op: "delete", field: null, before: { name: "Carrier AC" }, after: null })],
      { recordType: "equipment" },
    );
    const view = changeRowView(removed, ctx());
    const within = render({ group: removed, view, nowMs: Date.parse(AT) + 29 * 24 * 60 * 60 * 1000 });
    expect(within).toContain(m["history.restore"]);
    const past = render({ group: removed, view, nowMs: Date.parse(AT) + 31 * 24 * 60 * 60 * 1000 });
    expect(past).not.toContain(m["history.restore"]);
  });

  it("an insert row (added this record) offers neither a disclosure nor Restore (mutation: show Restore for every removal-typed group regardless of op -> FAILS)", () => {
    const g = group([baseRow({ op: "insert", field: null, before: null, after: { first_name: "Ana" } })]);
    const view = changeRowView(g, ctx());
    const html = render({ group: g, view });
    expect(html).not.toContain(m["history.restore"]);
    expect(html).not.toContain(m["history.putBack"]);
    expect(html).toContain(m["history.verb.added"]);
  });

  it("the disclosure's summary swaps Show/Hide by its own open state (mutation: always show history.showSteps -> FAILS once opened)", () => {
    const g = group([baseRow({ field: "phone" })]);
    const view = changeRowView(g, ctx());
    const closed = render({ group: g, view });
    expect(closed).toContain(m["history.showSteps"]);
    expect(closed).not.toContain(m["history.hideSteps"]);
  });
});
