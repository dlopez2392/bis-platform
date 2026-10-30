import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * F-006 part 1 (plan Task 10, Step 5): the Possible duplicates view's rows. No DOM renderer in apps/web
 * (archive-controls.test.ts's own note), so the dismiss handler is a plain exported function tested
 * directly, and what renders is read off a real `renderToStaticMarkup`.
 */
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { DuplicatesList, dismissOne, stopRowNav } = await import("./duplicates-list");

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  router.push.mockReset();
});

const ROW = { id: "flag-1", href: "/dashboard/accounts/a1/contacts/merge?a=x&b=y", aName: "Maria Garcia", bName: "Maria G.", reasonText: "same phone number", foundOnText: "Found Oct 29, 2026" };

describe("stopRowNav (the mutation that would make dismiss also navigate)", () => {
  it("stops propagation before running the callback (mutation: drop stopPropagation -> FAILS)", () => {
    const stop = vi.fn();
    let ran = false;
    stopRowNav({ stopPropagation: stop }, () => { ran = true; });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(ran).toBe(true);
  });
});

describe("dismissOne: runs at once, with an Undo (rule 6)", () => {
  it("hides the row and offers Undo on success", async () => {
    const dismiss = vi.fn(async () => ({ ok: true as const }));
    const undismiss = vi.fn(async () => ({ ok: true as const }));
    const onDone = vi.fn();
    const onUndone = vi.fn();
    await dismissOne(dismiss, undismiss, "flag-1", "en", onDone, onUndone);
    expect(dismiss).toHaveBeenCalledWith("flag-1");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    const opts = toasts.success.mock.calls[0]![1] as { action: { onClick: () => void } };
    opts.action.onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(undismiss).toHaveBeenCalledWith("flag-1");
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it("a refusal toasts the error key and never hides the row (mutation: hide on refusal -> FAILS)", async () => {
    const dismiss = vi.fn(async () => ({ ok: false as const, errorKey: "contacts.duplicates.dismissFailed" as const }));
    const onDone = vi.fn();
    await dismissOne(dismiss, vi.fn(), "flag-1", "en", onDone, vi.fn());
    expect(onDone).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith("Couldn't save that. Nothing changed. Try again.");
  });

  it("a throw toasts the same failure, never leaves the row silently hidden", async () => {
    const dismiss = vi.fn(async () => { throw new Error("boom"); });
    const onDone = vi.fn();
    await dismissOne(dismiss, vi.fn(), "flag-1", "en", onDone, vi.fn());
    expect(onDone).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith("Couldn't save that. Nothing changed. Try again.");
  });
});

describe("DuplicatesList markup", () => {
  const html = () => renderToStaticMarkup(createElement(DuplicatesList, {
    rows: [ROW], locale: "en", dismissAction: vi.fn(), undismissAction: vi.fn(),
  }));

  it("one row carrying data-duplicate-row, both names and the reason (mutation: drop the attribute -> FAILS)", () => {
    const out = html();
    expect(out).toContain('data-duplicate-row="flag-1"');
    expect(out).toContain("Maria Garcia");
    expect(out).toContain("Maria G.");
    expect(out).toContain("same phone number");
    expect(out).toContain("Found Oct 29, 2026");
  });

  it("no checkbox: this list has no bulk bar (DESIGN.md rule 4)", () => {
    expect(html()).not.toContain('type="checkbox"');
  });

  it("the dismiss control reads 'Not the same person'", () => {
    expect(html()).toContain("Not the same person");
  });
});
