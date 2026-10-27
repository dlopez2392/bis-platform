"use client";

import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TradeFields, type TradeSetup } from "@/components/vetting/trade-fields";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { SubmitButton } from "../../submit-button";
import type { ActionResult } from "./trade-actions";

export type TradeCardCopy = TradeSetup["copy"] & {
  title: string; description: string; status: string | null; save: string; saved: string; crashed: string;
};

/**
 * The company's trade (S-53, spec 5.2). Agency only (Settings is requireAgencyOnlyAccountAccess). Its own
 * card, its own action, its own toast: its Save is this card's one primary (DESIGN rule 8, the settings
 * card amendment). `status` is the empty state (no trade yet) or the CRM-only line; null when allowed.
 * useFormSubmit, not `action`: the form holds a Radix Select.
 */
export function TradeCard({
  setup, copy, current, action,
}: {
  setup: TradeSetup;
  copy: TradeCardCopy;
  current: { trade: string | null; tradeOther: string | null };
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const { pending, onSubmit } = useFormSubmit((formData) =>
    notifyActionResult(() => action(formData), { success: (s) => toast.success(s), error: (s) => toast.error(s) },
      { success: copy.saved, crashed: copy.crashed }));
  return (
    <Card id="trade" className="scroll-mt-24" lang={setup.locale}>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="locale" value={setup.locale} />
          {copy.status ? <p className="text-sm text-muted-foreground" data-testid="trade-status">{copy.status}</p> : null}
          <TradeFields
            idPrefix="settings" {...setup}
            defaultTrade={current.trade ?? ""} defaultOther={current.tradeOther ?? ""}
          />
          <SubmitButton pending={pending}>{copy.save}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
