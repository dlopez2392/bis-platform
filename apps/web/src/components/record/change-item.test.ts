import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeGroup, ChangeRow } from "@bis/db";
import { RESTORE_DAYS } from "@bis/db";
import { m } from "@/lib/messages";
import { changeRowView, type ChangeViewCtx } from "@/lib/record/change-rows";
import { makeTr } from "@/lib/record/copy";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";

/**
 * F-115 part 1 (S-04), plan Task 5: no DOM renderer in apps/web (archive-controls.test.ts's own
 * precedent) — `putBackOne`/`restoreOne` are plain exported functions tested directly, and what each
 * role SEES (the mark, the disclosure, Put back, Restore) is read off a real `renderToStaticMarkup`.
 * F-115 PR E fix (review I9): every caller passes `tr` (`makeTr(locale)`), never a bare `locale`, so
 * the pseudo-locale wrapping this file's own `change-item.tsx` now relies on is exercised the same way
 * production builds it.
 */
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ChangeItem, putBackOne, restoreOne, putBackTargets, stepsSummaryLabel } = await import("./change-item");

const AT = "2026-11-02T16:12:00Z";
const EN = makeTr("en");
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
  tr: EN, zone: "America/Chicago", names: { user_1: "Ana García" }, customFieldLabels: {}, ...over,
});

beforeEach(() => {
  toasts.success.mockClear(); toasts.error.mockClear(); router.refresh.mockClear(); router.push.mockClear();
});

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
type ToastOpts = { duration?: number; action?: { label: string; onClick: () => void } } | undefined;
const optsOf = (call: unknown[] | undefined) => call?.[1] as ToastOpts;

describe("putBackOne (rule 6: runs at once, an Undo that is itself a Put back)", () => {
  it("success toasts the field's own name, with a 10s duration, and the Undo calls putBack again with the NEW row's id, toasting the NEUTRAL 'Undone.' (not the field sentence again) (mutation: Undo reuses the same changeId -> FAILS)", async () => {
    const putBack = vi.fn()
      .mockResolvedValueOnce({ ok: true, undo: { changeId: 42 } })
      .mockResolvedValueOnce({ ok: true, undo: { changeId: null } });
    const onDone = vi.fn();
    await putBackOne(putBack, 1, "Phone", { tr: EN, onDone });
    expect(putBack).toHaveBeenCalledWith(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("Phone is back to what it was.");
    const opts = optsOf(toasts.success.mock.calls[0]);
    expect(opts?.action?.label).toBe("Undo");
    expect(opts?.duration).toBe(10_000); // review m14: matches the app's other Undo toasts
    opts!.action!.onClick();
    await flush();
    expect(putBack).toHaveBeenCalledWith(42);
    expect(toasts.success.mock.calls[1]![0]).toBe("Undone."); // review m3: never "Phone is back…" again
  });

  it("a double click on the toast's own Undo button fires putBack(42) only once (mutation: drop the `fired` guard -> FAILS, putBack(42) called twice)", async () => {
    const putBack = vi.fn().mockResolvedValue({ ok: true, undo: { changeId: 42 } });
    await putBackOne(putBack, 1, "Phone", { tr: EN, onDone: () => {} });
    const opts = optsOf(toasts.success.mock.calls[0]);
    opts!.action!.onClick();
    opts!.action!.onClick();
    await flush();
    expect(putBack.mock.calls.filter((c) => c[0] === 42)).toHaveLength(1);
  });

  it("no Undo offered when the server names no new row (mutation: offer Undo anyway -> FAILS)", async () => {
    const putBack = vi.fn().mockResolvedValue({ ok: true, undo: { changeId: null } });
    await putBackOne(putBack, 1, "Phone", { tr: EN, onDone: () => {} });
    expect(optsOf(toasts.success.mock.calls.at(-1))?.action).toBeUndefined();
  });

  it("a stale value toasts the server's own message and never calls onDone (mutation: call onDone anyway -> FAILS)", async () => {
    const onDone = vi.fn();
    const putBack = vi.fn().mockResolvedValue({ ok: false, message: "It changed since, so it wasn't put back." });
    await putBackOne(putBack, 1, "Phone", { tr: EN, onDone });
    expect(toasts.error).toHaveBeenCalledWith("It changed since, so it wasn't put back.");
    expect(onDone).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  // Review m10: a thrown/network failure is a DIFFERENT claim from "this specific row cannot be
  // found" (history.notFound, used elsewhere for a stale id) — its own generic, honest wording.
  it("a thrown call (network/stale tab) toasts history.putBack.failed, never history.notFound, never a crash (mutation: use history.notFound here -> FAILS)", async () => {
    const putBack = vi.fn().mockRejectedValue(new Error("network"));
    await putBackOne(putBack, 1, "Phone", { tr: EN, onDone: () => {} });
    expect(toasts.error).toHaveBeenCalledWith(m["history.putBack.failed"]);
    expect(toasts.error).not.toHaveBeenCalledWith(m["history.notFound"]);
  });
});

describe("restoreOne (rule 6: runs at once; NO Undo — record-restore.ts has none, owner ruling 2026-11-05)", () => {
  it("success toasts the restored thing's own name, with no action at all (mutation: add an Undo action -> FAILS)", async () => {
    const restore = vi.fn().mockResolvedValue({ ok: true, undo: { changeId: 9 } });
    const onDone = vi.fn();
    await restoreOne(restore, 5, "Carrier AC", { tr: EN, onDone });
    expect(restore).toHaveBeenCalledWith(5);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith("Carrier AC is back.");
    expect(optsOf(toasts.success.mock.calls[0])).toBeUndefined();
  });

  it("expired/parentGone/alreadyBack toast the server's own worded refusal (mutation: use a generic error -> FAILS)", async () => {
    const restore = vi.fn().mockResolvedValue({ ok: false, message: "This could be restored for 30 days. That time has passed." });
    await restoreOne(restore, 5, "Carrier AC", { tr: EN, onDone: () => {} });
    expect(toasts.error).toHaveBeenCalledWith("This could be restored for 30 days. That time has passed.");
  });

  it("a thrown call toasts history.restore.failed (mutation: use history.notFound here -> FAILS)", async () => {
    const restore = vi.fn().mockRejectedValue(new Error("network"));
    await restoreOne(restore, 5, "Carrier AC", { tr: EN, onDone: () => {} });
    expect(toasts.error).toHaveBeenCalledWith(m["history.restore.failed"]);
  });
});

describe("ChangeItem: every row has a mark, Put back per field, Restore on a removal (plan Task 5 Step 3)", () => {
  const head = (view: ReturnType<typeof changeRowView>) => ({
    kind: "change" as const, mark: { kind: "person" as const, label: "Ana García" },
    verb: view.verb, status: null, detail: view.stepsText, time: "Nov 2, 2026, 10:12 AM", dateTime: AT,
  });
  const render = (props: Partial<Parameters<typeof ChangeItem>[0]> & { group: ChangeGroup; view: ReturnType<typeof changeRowView> }) =>
    renderToStaticMarkup(createElement(ChangeItem, {
      head: head(props.view), locale: "en", pseudo: false, canWrite: true, nowMs: Date.parse(AT),
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

  // Review m12: the PREVIOUS version of this test compared day 29 against day 31, which a mutation
  // changing the threshold from 30 days to 31 would pass UNCHANGED (29 < 31 and 31 >= 31 either way) —
  // an assertion that could not fail on the named mutation. The real boundary is `RESTORE_DAYS` itself:
  // one millisecond short of it still offers Restore; AT or past it never does.
  it("a removal offers Restore one millisecond before RESTORE_DAYS elapses, and never once that many days have passed (mutation: compare against RESTORE_DAYS + 1 days -> FAILS at the real boundary)", () => {
    const removed = group(
      [baseRow({ recordType: "equipment", op: "delete", field: null, before: { name: "Carrier AC" }, after: null })],
      { recordType: "equipment" },
    );
    const view = changeRowView(removed, ctx());
    const restoreMs = RESTORE_DAYS * 24 * 60 * 60 * 1000;
    const justBefore = render({ group: removed, view, nowMs: Date.parse(AT) + restoreMs - 1 });
    expect(justBefore).toContain(m["history.restore"]);
    const atBoundary = render({ group: removed, view, nowMs: Date.parse(AT) + restoreMs });
    expect(atBoundary).not.toContain(m["history.restore"]);
    const after = render({ group: removed, view, nowMs: Date.parse(AT) + restoreMs + 1 });
    expect(after).not.toContain(m["history.restore"]);
  });

  it("an insert row (added this record) offers neither a disclosure nor Restore (mutation: show Restore for every removal-typed group regardless of op -> FAILS)", () => {
    const g = group([baseRow({ op: "insert", field: null, before: null, after: { first_name: "Ana" } })]);
    const view = changeRowView(g, ctx());
    const html = render({ group: g, view });
    expect(html).not.toContain(m["history.restore"]);
    expect(html).not.toContain(m["history.putBack"]);
    expect(html).toContain(m["history.verb.added"]);
  });

  it("the disclosure defaults closed, showing history.showSteps (mutation: default open -> FAILS)", () => {
    const g = group([baseRow({ field: "phone" })]);
    const view = changeRowView(g, ctx());
    const closed = render({ group: g, view });
    expect(closed).toContain(m["history.showSteps"]);
    expect(closed).not.toContain(m["history.hideSteps"]);
  });

  // F-115 PR E fix (review I8): two DIFFERENT fields in one group, each its own row — only a fixture
  // with more than one row can tell `f.row.id` apart from `group.rows[0]!.id`; a fixture with one
  // field alone (every OTHER test above) cannot, because the two values coincide there by accident.
  it("two different fields each carry their OWN row's id in the markup (mutation: bind every button to group.rows[0]!.id -> FAILS, both buttons would read id=5)", () => {
    const first = baseRow({ id: 5, field: "phone" });
    const second = baseRow({ id: 9, field: "email", before: "a@x.com", after: "b@x.com" });
    const g = group([first, second], { steps: [[first], [second]] });
    const view = changeRowView(g, ctx());
    const html = render({ group: g, view });
    expect(html).toContain('data-change-put-back-id="5"');
    expect(html).toContain('data-change-put-back-id="9"');
  });

  // Design round 2 (D2): several "Put back" buttons on one row need per-field accessible names, or a
  // screen reader announces "Put back" twice with no way to tell them apart.
  it("each Put back button's accessible name names its OWN field (mutation: a bare aria-label=\"Put back\" with no field -> FAILS, both buttons would share one name)", () => {
    const first = baseRow({ id: 5, field: "phone" });
    const second = baseRow({ id: 9, field: "email", before: "a@x.com", after: "b@x.com" });
    const g = group([first, second], { steps: [[first], [second]] });
    const view = changeRowView(g, ctx());
    const html = render({ group: g, view });
    expect(html).toContain(`aria-label="${m["history.putBack.aria"].replace("{field}", "Phone")}"`);
    expect(html).toContain(`aria-label="${m["history.putBack.aria"].replace("{field}", "Email")}"`);
  });

  // Review m4: a folded group that changed the SAME field twice shows two lines (change-rows.test.ts
  // already proves that), but only the NEWER line's compare-and-swap can ever succeed — the earlier
  // line's own `after` is already stale the instant the later write landed.
  it("the same field changed twice: only the NEWER line offers Put back (mutation: offer it on every occurrence -> FAILS, two buttons appear)", () => {
    const first = baseRow({ id: 1, field: "phone", before: "+19565550111", after: "+19565550112", xact: "1" });
    const second = baseRow({ id: 2, field: "phone", before: "+19565550112", after: "+19565550113", xact: "2" });
    const g = group([first, second], { steps: [[first], [second]] });
    const view = changeRowView(g, ctx());
    const html = render({ group: g, view });
    expect(html.match(/data-change-put-back=""/g)).toHaveLength(1);
    expect(html).toContain('data-change-put-back-id="2"');
  });
});

// Review round 2 (C1): ChangeItem rebuilds its own `tr` from `locale`+`pseudo` (never receives one),
// the same split `act-row.tsx`/`act-undo.tsx` use for `locale` alone — this proves the rebuild itself
// actually threads `pseudo` through (makeTr(locale, pseudo)), not just `locale`.
describe("ChangeItem rebuilds its OWN tr from locale+pseudo (review C1): pseudo still wraps every string", () => {
  const head = (view: ReturnType<typeof changeRowView>) => ({
    kind: "change" as const, mark: { kind: "person" as const, label: "Ana García" },
    verb: view.verb, status: null, detail: view.stepsText, time: "Nov 2, 2026, 10:12 AM", dateTime: AT,
  });
  it("pseudo=true wraps Put back/Show every step exactly as a page-built tr would (mutation: makeTr(locale) with pseudo dropped -> FAILS, no brackets)", () => {
    const g = group([baseRow({ field: "phone" })]);
    const view = changeRowView(g, ctx());
    const html = renderToStaticMarkup(createElement(ChangeItem, {
      head: head(view), group: g, view, locale: "en", pseudo: true, canWrite: true, nowMs: Date.parse(AT),
      putBack: vi.fn(), restore: vi.fn(),
    }));
    expect(html).toContain(pseudoLocale(m["history.putBack"]));
    expect(html).toContain(pseudoLocale(m["history.showSteps"]));
  });
});

describe("putBackTargets (review I8/m4, pure): which line gets a button, and the exact id it sends", () => {
  it("one row per field: each sends ITS OWN id, not the group's first row (mutation: return fields.map(() => fields[0].row.id) -> FAILS)", () => {
    const first = baseRow({ id: 1, field: "phone" });
    const second = baseRow({ id: 2, field: "email", before: "a@x.com", after: "b@x.com" });
    const view = changeRowView(group([first, second], { steps: [[first], [second]] }), ctx());
    expect(putBackTargets(view.fields)).toEqual([1, 2]);
  });

  it("the same field twice: the earlier occurrence is null, the newer one sends its own id (mutation: keep both -> FAILS, first slot is non-null)", () => {
    const first = baseRow({ id: 1, field: "phone", before: "+19565550111", after: "+19565550112", xact: "1" });
    const second = baseRow({ id: 2, field: "phone", before: "+19565550112", after: "+19565550113", xact: "2" });
    const view = changeRowView(group([first, second], { steps: [[first], [second]] }), ctx());
    expect(putBackTargets(view.fields)).toEqual([null, 2]);
  });

  it("a field canPutBack already excludes (dnd's jsonb CAS) is never offered, even alone (mutation: drop the canPutBack check -> FAILS, slot 0 becomes non-null)", () => {
    const view = changeRowView(group([baseRow({ field: "dnd", before: { sms: true }, after: { sms: false } })]), ctx());
    expect(putBackTargets(view.fields)).toEqual([null]);
  });
});

// Review m12: the predecessor test here never actually rendered the "opened" state (native <details>
// has no prop to force it open from a static render), so its own "FAILS once opened" mutation claim
// was never exercised — this tests the SAME swap through the pure function the component now calls,
// which a real click toggles in the browser (the e2e spec covers that last mile).
describe("stepsSummaryLabel (review m12, pure): the disclosure's own Show/Hide swap", () => {
  it("closed reads Show every step; open reads Hide the steps (mutation: always return history.showSteps -> FAILS once open=true)", () => {
    expect(stepsSummaryLabel(false, EN)).toBe(m["history.showSteps"]);
    expect(stepsSummaryLabel(true, EN)).toBe(m["history.hideSteps"]);
  });

  it("in Spanish (mutation: read the English key regardless of locale -> FAILS)", () => {
    const es = makeTr("es");
    expect(stepsSummaryLabel(false, es)).toBe(m["history.showSteps.es"]);
    expect(stepsSummaryLabel(true, es)).toBe(m["history.hideSteps.es"]);
  });

  // Review I9: the pseudo-locale wraps in brackets and pads length — proving these strings are routed
  // through `tr.text()` (which applies the wrap) rather than a bare `t(m, key, locale)` that bypasses it.
  it("the pseudo-locale wraps both forms in brackets (mutation: call t(m, key, locale) directly, bypassing tr -> FAILS, no brackets)", () => {
    const pseudo = makeTr("en", true);
    expect(stepsSummaryLabel(false, pseudo)).toMatch(/^\[.*\]$/);
    expect(stepsSummaryLabel(true, pseudo)).toMatch(/^\[.*\]$/);
  });
});
