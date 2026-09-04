"use client";

import { useTransition } from "react";

/**
 * Submits a form WITHOUT React's `action` prop — and that omission is the
 * whole point of this hook.
 *
 * React resets a form once its `action` resolves, INCLUDING when it resolves
 * to a failure the handler caught and toasted. On the failure path nothing was
 * written, so nothing revalidated, so that reset restores the values the page
 * was RENDERED with — silently discarding whatever the operator had just
 * typed or chosen, while the fields still look filled. Their next Save then
 * submits the stale values.
 *
 * Radix's Select makes it worse than cosmetic: it registers its own listener
 * for the form's reset event (`@radix-ui/react-select` captures
 * `initialValueRef` on FIRST render and the listener calls `setValue` on it,
 * which fires `onValueChange`), so the reset drives React state BACKWARDS.
 * Holding the value in state does not win that race — it was tried.
 *
 * Found live on 2026-09-04: an A2P approval a human selected was refused for a
 * missing id, the Select silently reverted to "Not started", and the retry
 * wrote `not_started` with the ids attached. Every `<form action={...}>` in
 * this app containing a Radix Select had the same defect.
 *
 * Not using `action` means React never calls reset, so the listener never
 * fires. The cost is `useFormStatus`, which only reports for action-prop
 * forms — hence the `pending` this returns, which `SubmitButton` takes as a
 * prop.
 *
 * `run` receives the form element as well as the data, for the forms that
 * genuinely WANT to clear after a successful submit (adding a row, where the
 * next entry starts empty). Those call `form.reset()` themselves, on the
 * success path only. Guard it with `form.isConnected` — a dialog that closes
 * on success has already unmounted by then.
 */
export function useFormSubmit(
  run: (formData: FormData, form: HTMLFormElement) => Promise<void>,
): { pending: boolean; onSubmit: React.FormEventHandler<HTMLFormElement> } {
  const [pending, startTransition] = useTransition();

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    // Read the data BEFORE the transition: `e.currentTarget` is nulled once
    // the synthetic event is done, and the async callback runs after that.
    const formData = new FormData(form);
    startTransition(async () => {
      await run(formData, form);
    });
  };

  return { pending, onSubmit };
}
