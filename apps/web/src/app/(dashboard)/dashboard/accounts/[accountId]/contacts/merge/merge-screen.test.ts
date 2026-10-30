import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * F-006 part 1 (plan Task 10, Step 4): the compare screen. No DOM renderer in apps/web
 * (archive-controls.test.ts's own note), so the handlers are plain exported functions tested directly,
 * in that file's own style, and what renders is read off a real `renderToStaticMarkup`.
 */
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { MergeScreen, choicesFromConflicts, runMerge } = await import("./merge-screen");

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});

const CONFLICTS = [
  { field: "email", keepValue: "k@x.com", otherValue: "o@x.com", preselect: "keep" as const },
  { field: "phone", keepValue: "+1956", otherValue: "+1800", preselect: "other" as const },
];

describe("choicesFromConflicts: the Merge button sends exactly what's on screen", () => {
  it("one entry per conflict, the preselect when nothing was changed (mutation: send every MERGE_CHOICE_FIELDS field -> FAILS)", () => {
    expect(choicesFromConflicts(CONFLICTS, {})).toEqual({ email: "keep", phone: "other" });
  });
  it("an explicit pick overrides the preselect, and nothing else is added", () => {
    const choices = choicesFromConflicts(CONFLICTS, { email: "other" });
    expect(Object.keys(choices).sort()).toEqual(["email", "phone"]);
    expect(choices.email).toBe("other");
  });
});

describe("runMerge", () => {
  const seen = { keep: "a".repeat(32), other: "b".repeat(32) };
  const input = { keepId: "k1", otherId: "o1", choices: { email: "keep" as const }, seen };

  it("on success, toasts Merged and the Undo action calls undoAction with the RETURNED merge id (mutation: pass the pair instead -> FAILS)", async () => {
    const mergeAction = vi.fn(async () => ({ ok: true as const, mergeId: 77, keptId: "k1" }));
    const undoAction = vi.fn(async () => ({ ok: true as const, otherId: "o1", keptNew: 0, keptEdits: [] }));
    const onMerged = vi.fn();
    await runMerge(mergeAction, undoAction, input, "en", { keepName: "Maria Garcia", onMerged, onStale: vi.fn() });
    expect(mergeAction).toHaveBeenCalledWith(input);
    expect(onMerged).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    const opts = toasts.success.mock.calls[0]![1] as { action: { onClick: () => void } };
    opts.action.onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(undoAction).toHaveBeenCalledWith(77);
    expect(undoAction).not.toHaveBeenCalledWith("k1");
    expect(undoAction).not.toHaveBeenCalledWith("o1");
  });

  it("stale toasts its own key and refreshes, never navigating", async () => {
    const mergeAction = vi.fn(async () => ({ ok: false as const, errorKey: "contacts.merge.stale" as const }));
    const onStale = vi.fn();
    const onMerged = vi.fn();
    await runMerge(mergeAction, vi.fn(), input, "en", { keepName: "x", onMerged, onStale });
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onMerged).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });

  it("every other failure toasts and changes nothing", async () => {
    const mergeAction = vi.fn(async () => ({ ok: false as const, errorKey: "contacts.merge.failed" as const }));
    const onMerged = vi.fn();
    const onStale = vi.fn();
    await runMerge(mergeAction, vi.fn(), input, "en", { keepName: "x", onMerged, onStale });
    expect(onMerged).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });
});

describe("MergeScreen markup (DESIGN.md rule 8: one primary per view)", () => {
  const html = () => renderToStaticMarkup(createElement(MergeScreen, {
    accountId: "a1",
    keep: { id: "k1", name: "Maria Garcia" },
    other: { id: "o1", name: "Maria G." },
    conflicts: CONFLICTS,
    alsoKeeps: [],
    otherReach: {},
    movesText: "",
    seen: { keep: "a".repeat(32), other: "b".repeat(32) },
    swapHref: "/dashboard/accounts/a1/contacts/merge?a=k1&b=o1&keep=o1",
    locale: "en" as const,
    mergeAction: vi.fn(),
    undoAction: vi.fn(),
  }));

  it("exactly one data-variant=\"default\" button: Merge (mutation: make Cancel default too -> FAILS)", () => {
    expect(html().match(/data-variant="default"/g)?.length).toBe(1);
    expect(html()).toContain(">Merge<");
  });

  it("names both records and the swap link", () => {
    const out = html();
    expect(out).toContain("Maria Garcia");
    expect(out).toContain("Maria G.");
    expect(out).toContain("Keep this one instead");
  });
});
