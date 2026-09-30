import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

/**
 * `PlanDialog` hands its save logic to `useFormSubmit`, which drives it
 * through `useTransition` — machinery this DOM-less suite cannot click
 * through. Mocking the hook to just HAND BACK the callback it was given lets
 * a test invoke that closure directly and inspect what it does, the
 * technique the review named: no DOM, no click, just the real closure.
 */
const submit = vi.hoisted(() => ({ run: null as ((fd: FormData) => Promise<void>) | null }));
vi.mock("@/lib/forms/use-form-submit", () => ({
  useFormSubmit: (run: (formData: FormData, form?: HTMLFormElement) => Promise<void>) => {
    submit.run = run as (fd: FormData) => Promise<void>;
    return { pending: false, onSubmit: () => {} };
  },
}));

import { m } from "@/lib/messages";
import { NewPlanButton } from "./plan-dialog";
import type { PlanActionResult } from "./actions";

beforeEach(() => {
  submit.run = null;
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe("NewPlanButton — one draft id survives retries, cleared only on success", () => {
  it("keeps the SAME draft id across every failing retry and mints a fresh one only after success (mutation: draftId.current = crypto.randomUUID() → FAILS)", async () => {
    const ids: string[] = [];
    let call = 0;
    const create = vi.fn(async (draftId: string): Promise<PlanActionResult> => {
      ids.push(draftId);
      call += 1;
      // Fails the first two retries (a lost response, a Stripe hiccup),
      // succeeds the third, then a wholly separate plan is saved after.
      return call < 3 ? { ok: false, error: "Stripe didn't accept this plan, so nothing was saved. Try again in a minute." } : { ok: true };
    });
    renderToStaticMarkup(createElement(NewPlanButton, { create, disabled: false }));
    const run = submit.run;
    expect(run, "PlanDialog must have registered its save callback with useFormSubmit").not.toBeNull();

    await run!(new FormData());
    await run!(new FormData());
    await run!(new FormData()); // the third call is the one that succeeds
    await run!(new FormData()); // a new plan, after the previous one saved

    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[3]).not.toBe(ids[0]);
  });

  it("toasts the action's OWN error string verbatim, never a generic one (mutation: toast.error(m['common.actionCrashed']) → FAILS)", async () => {
    const ERROR = "This plan was already saved. Reload the page to see it, then make your change from there.";
    const create = vi.fn(async (): Promise<PlanActionResult> => ({ ok: false, error: ERROR }));
    renderToStaticMarkup(createElement(NewPlanButton, { create, disabled: false }));
    const run = submit.run;
    expect(run).not.toBeNull();

    await run!(new FormData());

    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith(ERROR);
    expect(toastMock.error).not.toHaveBeenCalledWith(m["common.actionCrashed"]);
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
