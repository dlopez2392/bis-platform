import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Plan } from "@bis/db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** The REAL dialog still renders (its trigger is what the row tests read);
 *  the wrapper only records the props each row handed it, so the edit
 *  dialog's `onSave` can be called directly. There is no DOM in this suite,
 *  and a closed Radix dialog renders nothing but its trigger. */
const dialogs = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("./plan-dialog", async (importOriginal) => {
  const real = await importOriginal<typeof import("./plan-dialog")>();
  return {
    ...real,
    PlanDialog: (props: Parameters<typeof real.PlanDialog>[0]) => {
      dialogs.props.push(props as unknown as Record<string, unknown>);
      return createElement(real.PlanDialog, props);
    },
  };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

/** `PlanRow`'s `run` schedules its body through `useTransition`'s
 *  `startTransition`. Overriding it to just COLLECT the callback (instead of
 *  letting React's real transition machinery run it, which needs a live
 *  root this DOM-less suite has none of) lets a test invoke the body
 *  directly, as a plain async function. */
const transitions = vi.hoisted(() => ({ calls: [] as Array<() => Promise<void>> }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => [false, (cb: () => Promise<void>) => { transitions.calls.push(cb); }],
  };
});

/** Wraps the real Button only to RECORD the props each row hands it — its
 *  onClick is a row action, otherwise unreachable without a DOM to click in
 *  this suite. It still renders through the real component. */
const buttons = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("@/components/ui/button", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/button")>();
  return {
    ...real,
    Button: (props: Record<string, unknown>) => {
      buttons.props.push(props);
      return createElement(real.Button, props as never);
    },
  };
});

import { m } from "@/lib/messages";
import { planRowView } from "@/lib/billing/plan-rows";
import { PlansList } from "./plans-list";
import type { PlanActionResult } from "./actions";

const plan = (id: string, name: string, archivedAt: string | null): Plan => ({
  id, agencyId: "agency_1", currency: "usd", name, monthlyPriceCents: 4900,
  features: { voice_receptionist: true, web_concierge: false },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt, createdAt: "2026-09-24T10:00:00Z", updatedAt: "2026-09-24T10:00:00Z",
});

const noop = async () => ({ ok: true as const });

function render(rows: Plan[], canEdit = true): string {
  return renderToStaticMarkup(createElement(PlansList, {
    rows: rows.map((p) => planRowView(p, 0)), canEdit, update: noop, archive: noop, restore: noop,
  }));
}

/** Renders one row with its own archive/restore, so a test can drive them. */
function renderRow(
  p: Plan,
  actions: { archive?: (id: string) => Promise<PlanActionResult>; restore?: (id: string) => Promise<PlanActionResult> } = {},
): void {
  renderToStaticMarkup(createElement(PlansList, {
    rows: [planRowView(p, 0)], canEdit: true, update: noop,
    archive: actions.archive ?? noop, restore: actions.restore ?? noop,
  }));
}

/** The markup of the <li> for one plan id. */
function rowHtml(html: string, id: string): string {
  const match = html.match(new RegExp(`<li[^>]*data-plan-row="${id}"[\\s\\S]*?</li>`));
  if (!match) throw new Error(`no row for ${id} in: ${html}`);
  return match[0];
}

/** The one opening <button ...> tag in `html` carrying this exact
 *  aria-label — row actions are never a click target of their own, so
 *  identifying by aria-label (rather than position) is the stable handle. */
function buttonTag(html: string, ariaLabel: string): string {
  const tags = html.match(/<button[^>]*>/g) ?? [];
  const tag = tags.find((t) => t.includes(`aria-label="${ariaLabel}"`));
  if (!tag) throw new Error(`no button aria-label="${ariaLabel}" in: ${html}`);
  return tag;
}

/** The onClick of the one captured Button whose aria-label is exactly this. */
function onClickFor(ariaLabel: string): () => void {
  const hits = buttons.props.filter((p) => p["aria-label"] === ariaLabel);
  if (hits.length !== 1) throw new Error(`expected exactly one Button aria-label="${ariaLabel}", got ${hits.length}`);
  return hits[0]!.onClick as () => void;
}

beforeEach(() => {
  dialogs.props = [];
  buttons.props = [];
  transitions.calls = [];
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe("PlansList", () => {
  it("an active row shows its name, dot + word Active, price, and Edit and Archive (mutation: drop the DotPill → FAILS)", () => {
    const row = rowHtml(render([plan("p1", "Growth", null)]), "p1");
    expect(row).toContain("Growth");
    expect(row).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>Active/);
    expect(row).toContain("$49.00/month");
    expect(row).toContain(`aria-label="${m["plans.editLabel"].replace("{name}", "Growth")}"`);
    expect(row).toContain(`aria-label="${m["plans.archiveLabel"].replace("{name}", "Growth")}"`);
  });

  it("row actions render the ghost variant, never the default (DESIGN.md rule 8; mutation: Archive with the default variant → FAILS)", () => {
    const row = rowHtml(render([plan("p1", "Growth", null)]), "p1");
    expect(buttonTag(row, m["plans.editLabel"].replace("{name}", "Growth"))).toContain('data-variant="ghost"');
    expect(buttonTag(row, m["plans.archiveLabel"].replace("{name}", "Growth"))).toContain('data-variant="ghost"');
  });

  it("an archived row shows Archived and Restore, and NO Edit (mutation: render Edit for archived rows → FAILS)", () => {
    const row = rowHtml(render([plan("p2", "Legacy", "2026-09-24T11:00:00Z")]), "p2");
    expect(row).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>Archived/);
    expect(row).toContain(`aria-label="${m["plans.restoreLabel"].replace("{name}", "Legacy")}"`);
    expect(row).not.toContain(`aria-label="${m["plans.editLabel"].replace("{name}", "Legacy")}"`);
    expect(buttonTag(row, m["plans.restoreLabel"].replace("{name}", "Legacy"))).toContain('data-variant="ghost"');
  });

  it("with Stripe not connected there is no Edit on any row, but Archive stays (mutation: ignore canEdit → FAILS)", () => {
    const row = rowHtml(render([plan("p3", "Starter", null)], false), "p3");
    expect(row).not.toContain(`aria-label="${m["plans.editLabel"].replace("{name}", "Starter")}"`);
    expect(row).toContain(`aria-label="${m["plans.archiveLabel"].replace("{name}", "Starter")}"`);
  });

  it("every row carries data-plan-row with its own id, the e2e's only handle (mutation: key rows by name → FAILS)", () => {
    const html = render([plan("p4", "A", null), plan("p5", "B", null)]);
    expect([...html.matchAll(/data-plan-row="([^"]+)"/g)].map((x) => x[1])).toEqual(["p4", "p5"]);
  });

  it("the edit dialog's Save sends the stored updatedAt UNTOUCHED, microseconds and offset intact (mutation: pass new Date(updatedAt).toISOString() → FAILS)", async () => {
    // PostgREST's shape: microseconds and a +00:00 offset. Through Date this
    // becomes "2026-09-24T10:00:00.123Z", which never matches the stored
    // value, so every never-edited plan would read as stale forever.
    const VERSION = "2026-09-24T10:00:00.123456+00:00";
    const calls: Array<[string, string, FormData]> = [];
    const update = async (planId: string, expectedUpdatedAt: string, formData: FormData): Promise<PlanActionResult> => {
      calls.push([planId, expectedUpdatedAt, formData]);
      return { ok: true };
    };
    const stored = { ...plan("p6", "Growth", null), updatedAt: VERSION };
    renderToStaticMarkup(createElement(PlansList, {
      rows: [planRowView(stored, 0)], canEdit: true, update, archive: noop, restore: noop,
    }));

    const edit = dialogs.props.find((p) => p.plan !== undefined);
    expect(edit, "the active row must render an edit dialog").toBeDefined();
    const fd = new FormData();
    fd.set("name", "Growth");
    await (edit!.onSave as (f: FormData) => Promise<PlanActionResult>)(fd);

    expect(calls).toHaveLength(1);
    const [planId, version, formData] = calls[0]!;
    expect(planId).toBe("p6");
    expect(version).toBe(VERSION);
    expect(formData).toBe(fd);
  });
});

describe("PlanRow — archive/restore/undo never escape to the error boundary", () => {
  it("a thrown archive call is caught and toasts common.actionCrashed, not left to escape the transition (mutation: remove the catch → FAILS)", async () => {
    const archive = vi.fn(async (): Promise<PlanActionResult> => { throw new Error("network drop"); });
    renderRow(plan("p7", "Growth", null), { archive });

    const onClick = onClickFor(m["plans.archiveLabel"].replace("{name}", "Growth"));
    onClick();
    expect(transitions.calls).toHaveLength(1);

    await expect(transitions.calls[0]!()).resolves.toBeUndefined();
    expect(toastMock.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe("PlanRow — undo runs the inverse action", () => {
  it("Undo after Archive calls RESTORE (the inverse) and surfaces a failed undo's error via toast.error (mutation: undo calls the same action, or the failed undo's error is swallowed → FAILS)", async () => {
    const archive = vi.fn(async (): Promise<PlanActionResult> => ({ ok: true }));
    const restore = vi.fn(async (): Promise<PlanActionResult> => ({ ok: false, error: "Could not restore Growth" }));
    renderRow(plan("p8", "Growth", null), { archive, restore });

    onClickFor(m["plans.archiveLabel"].replace("{name}", "Growth"))();
    expect(transitions.calls).toHaveLength(1);
    await transitions.calls[0]!();

    expect(archive).toHaveBeenCalledWith("p8");
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    const [, options] = toastMock.success.mock.calls[0]!;
    const undo = (options as { action: { onClick: () => void } }).action.onClick;

    undo();
    expect(transitions.calls).toHaveLength(2);
    await transitions.calls[1]!();

    // The inverse of Archive is Restore, never Archive again.
    expect(restore).toHaveBeenCalledWith("p8");
    expect(archive).toHaveBeenCalledTimes(1);
    // The failed undo's own error reaches the operator.
    expect(toastMock.error).toHaveBeenCalledWith("Could not restore Growth");
  });
});
