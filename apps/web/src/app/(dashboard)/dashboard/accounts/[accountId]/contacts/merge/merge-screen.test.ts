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
    await runMerge(mergeAction, undoAction, input, "en", { keepName: "Maria Garcia", otherName: "Maria G.", onMerged, onStale: vi.fn() });
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

  it("the toast's own Undo names the OTHER (merged-away) record, never the kept one (fix round, finding #1; mutation: pass ctx.keepName instead of ctx.otherName -> FAILS)", async () => {
    const mergeAction = vi.fn(async () => ({ ok: true as const, mergeId: 5, keptId: "k1" }));
    const undoAction = vi.fn(async () => ({ ok: true as const, otherId: "o1", keptNew: 0, keptEdits: [] }));
    await runMerge(mergeAction, undoAction, input, "en", { keepName: "Maria Garcia", otherName: "Jose Garcia Jr.", onMerged: vi.fn(), onStale: vi.fn() });
    const opts = toasts.success.mock.calls[0]![1] as { action: { onClick: () => void } };
    opts.action.onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(toasts.success).toHaveBeenCalledWith("Merge undone. Jose Garcia Jr. is back as their own record.", undefined);
    expect(toasts.success).not.toHaveBeenCalledWith(expect.stringContaining("Maria Garcia is back"), expect.anything());
  });

  it("stale toasts its own key and refreshes, never navigating", async () => {
    const mergeAction = vi.fn(async () => ({ ok: false as const, errorKey: "contacts.merge.stale" as const }));
    const onStale = vi.fn();
    const onMerged = vi.fn();
    await runMerge(mergeAction, vi.fn(), input, "en", { keepName: "x", otherName: "y", onMerged, onStale });
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onMerged).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });

  it("every other failure toasts and changes nothing", async () => {
    const mergeAction = vi.fn(async () => ({ ok: false as const, errorKey: "contacts.merge.failed" as const }));
    const onMerged = vi.fn();
    const onStale = vi.fn();
    await runMerge(mergeAction, vi.fn(), input, "en", { keepName: "x", otherName: "y", onMerged, onStale });
    expect(onMerged).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });

  it("a rejected mergeAction resolves anyway, toasting the failure key (fix round, finding #3; mutation: drop runMerge's own try/catch -> this rejects instead of resolving, FAILS)", async () => {
    const mergeAction = vi.fn(async () => { throw new Error("network"); });
    const onMerged = vi.fn();
    const onStale = vi.fn();
    await expect(runMerge(mergeAction, vi.fn(), input, "en", { keepName: "x", otherName: "y", onMerged, onStale }))
      .resolves.toBeUndefined();
    expect(onMerged).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith("Couldn't merge. Nothing changed. Try again.");
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

  it("exactly one primary-styled control: Merge (mutation: make Cancel's own buttonVariants 'default' too -> FAILS)", () => {
    const out = html();
    // Merge is a real <Button>, which stamps data-variant; Cancel and "Keep this one instead" are
    // <Link>s that only borrow buttonVariants' CLASSES (no data-variant at all) — so the primary
    // look is pinned by the class btn-primary itself, not only by the attribute Button happens to add.
    expect(out.match(/data-variant="default"/g)?.length).toBe(1);
    expect(out.match(/class="[^"]*\bbtn-primary\b[^"]*"/g)?.length).toBe(1);
    expect(out).toContain(">Merge<");
  });

  it("names both records and the swap link", () => {
    const out = html();
    expect(out).toContain("Maria Garcia");
    expect(out).toContain("Maria G.");
    expect(out).toContain("Keep this one instead");
  });

  it("both record panels paint the card surface — DESIGN.md C1 (mutation: drop bg-card glass -> FAILS)", () => {
    const out = html();
    expect(out.match(/class="[^"]*\bbg-card\b[^"]*\bglass\b[^"]*"/g)?.length).toBe(2);
  });

  it("the swap link is ghost, never the underlined link variant (fix round, I1; mutation: keep variant: \"link\" -> FAILS)", () => {
    const out = html();
    const swap = out.match(/<a[^>]*href="\/dashboard\/accounts\/a1\/contacts\/merge\?a=k1&amp;b=o1&amp;keep=o1"[^>]*>/)?.[0] ?? "";
    expect(swap).toContain("hover:bg-[var(--surface-3)]");
    expect(swap).not.toContain("hover:underline");
  });
});

describe("MergeScreen markup: a custom field conflict shows the field's own DEFINED label, not its raw key (fix round, carry-in 10)", () => {
  it("passes customFieldNames through to both the legend and the Also-keeps line (mutation: ignore customFieldNames -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(MergeScreen, {
      accountId: "a1",
      keep: { id: "k1", name: "Maria Garcia" },
      other: { id: "o1", name: "Maria G." },
      conflicts: [{ field: "custom.favoriteColor", keepValue: "Red", otherValue: "Blue", preselect: "keep" as const }],
      alsoKeeps: ["custom.shirtSize"],
      otherReach: {},
      movesText: "",
      seen: { keep: "a".repeat(32), other: "b".repeat(32) },
      swapHref: "/x",
      locale: "en" as const,
      mergeAction: vi.fn(),
      undoAction: vi.fn(),
      customFieldNames: { favoriteColor: "Favorite Color", shirtSize: "Shirt Size" },
    }));
    expect(html).toContain("“Favorite Color” field");
    expect(html).toContain("“Shirt Size” field");
    expect(html).not.toContain("“favoriteColor” field");
    expect(html).not.toContain("“shirtSize” field");
  });
});

describe("MergeScreen markup: assigned_to shows a name and language shows a word, never a raw id or code (fix round, finding #4)", () => {
  const base = {
    accountId: "a1",
    keep: { id: "k1", name: "Maria Garcia" },
    other: { id: "o1", name: "Maria G." },
    alsoKeeps: [],
    otherReach: {},
    movesText: "",
    seen: { keep: "a".repeat(32), other: "b".repeat(32) },
    swapHref: "/x",
    mergeAction: vi.fn(),
    undoAction: vi.fn(),
  };
  const html = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(MergeScreen, {
    ...base,
    locale: "en" as const,
    conflicts: [{ field: "assigned_to", keepValue: "user_1", otherValue: null, preselect: "keep" as const }],
    assigneeNames: { user_1: "Ana López" },
    ...over,
  } as never));

  it("names the assignee from assigneeNames, never the raw id (mutation: render String(value) -> FAILS)", () => {
    const out = html();
    expect(out).toContain("Ana López");
    expect(out).not.toContain("user_1");
  });

  it("an id not in assigneeNames reads 'Someone on the team', never the raw id (mutation: fall back to the id -> FAILS)", () => {
    const out = html({
      conflicts: [{ field: "assigned_to", keepValue: "user_gone", otherValue: null, preselect: "keep" as const }],
      assigneeNames: {},
    });
    expect(out).toContain("Someone on the team");
    expect(out).not.toContain("user_gone");
  });

  it("a null assignee reads 'Unassigned', never '—' (mutation: treat null like any other blank -> FAILS)", () => {
    const out = html({
      conflicts: [{ field: "assigned_to", keepValue: null, otherValue: "user_1", preselect: "keep" as const }],
    });
    expect(out).toContain("Unassigned");
  });

  it("language shows the word, never the raw code (mutation: String(value) -> FAILS)", () => {
    const out = html({
      conflicts: [{ field: "language", keepValue: "en", otherValue: "es", preselect: "keep" as const }],
    });
    expect(out).toContain(">English<");
    expect(out).toContain(">Spanish<");
    expect(out).not.toContain(">en<");
    expect(out).not.toContain(">es<");
  });

  it("in Spanish, language shows the Spanish words (mutation: always show English words -> FAILS)", () => {
    const out = html({
      locale: "es" as const,
      conflicts: [{ field: "language", keepValue: "en", otherValue: "es", preselect: "keep" as const }],
    });
    expect(out).toContain(">inglés<");
    expect(out).toContain(">español<");
  });
});
