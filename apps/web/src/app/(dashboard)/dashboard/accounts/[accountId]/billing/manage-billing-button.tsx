"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

/**
 * A form, not an onClick: the action REDIRECTS to Stripe on success, and a
 * form action lets Next perform that navigation (a try/catch around a direct
 * call could swallow it). A failure comes back as state and is said inline.
 * The page's one primary (DESIGN rule 8). `help` is the line under it,
 * chosen by the page: a canceled subscription has no card to update.
 */
export function ManageBillingButton({ open, help }: { open: () => Promise<{ ok: false; error: string }>; help: string }) {
  const [state, action, pending] = useActionState<{ ok: false; error: string } | null>(async () => open(), null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>{m["billing.page.manage"]}</Button>
      <p className="text-xs text-muted-foreground">{help}</p>
      {state ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
