"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

/**
 * A form, not an onClick: the action REDIRECTS to Stripe on success, and a
 * form action lets Next perform that navigation (a try/catch around a direct
 * call could swallow it). A failure comes back as state and is said inline.
 * The page's one primary (DESIGN rule 8). `help` is the line under it,
 * chosen by the page: a canceled subscription has no card to update.
 *
 * `locale` (S-10 T6) defaults to "en": the page already resolves it and
 * passes it down as a prop, never through `useLocale()` (T5's own
 * convention for a leaf client component whose page already knows).
 * `pseudo` (S-10 T9a) is the same QA prop every sibling card on a
 * pseudo-wired page takes; `help` arrives already pseudo-wrapped by the
 * page, since it is the one string this component does not build itself.
 */
export function ManageBillingButton({
  open, help, locale = "en", pseudo = false,
}: {
  open: () => Promise<{ ok: false; error: string }>; help: string; locale?: Locale; pseudo?: boolean;
}) {
  const [state, action, pending] = useActionState<{ ok: false; error: string } | null>(async () => open(), null);
  const tr = makeTr(locale, pseudo);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>{tr.text("billing.page.manage")}</Button>
      <p className="text-xs text-muted-foreground">{help}</p>
      {state ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
