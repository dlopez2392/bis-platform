"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { QuietSettings } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { formatClock } from "@/lib/automations/quiet-hours";
import { m } from "@/lib/messages";
import type { ActionResult } from "./actions";

/**
 * One window per account, agency-edited (spec §2, decision 4). A form with
 * a Save button, like every recipe card on this page (A11) — a time field
 * that saved on every keystroke would write "21:0" on its way to "21:00".
 * The live preview under the fields restates the window the way a business
 * owner reads it, in the account's own zone, so what is about to be saved is
 * never ambiguous between 24h fields and a 12h reading.
 */
export function QuietHoursCard({
  settings, zoneLabel, saveAction,
}: {
  settings: QuietSettings;
  /** The account's zone as the operator knows it ("America/Chicago"). */
  zoneLabel: string;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [start, setStart] = useState(settings.start);
  const [end, setEnd] = useState(settings.end);
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.quiet.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card id="quiet-hours" data-testid="quiet-hours-card" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["automations.quiet.title"]}</CardTitle>
        <CardDescription>{m["automations.quiet.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="quiet-enabled" name="quiet_enabled" defaultChecked={settings.enabled} />
            <Label htmlFor="quiet-enabled">{m["automations.quiet.enabled"]}</Label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="quiet-start" className="w-12 text-sm">{m["automations.quiet.from"]}</Label>
            <Input id="quiet-start" name="quiet_start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" required />
            <Label htmlFor="quiet-end" className="w-12 text-sm">{m["automations.quiet.to"]}</Label>
            <Input id="quiet-end" name="quiet_end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" required />
          </div>
          <p className="text-xs text-muted-foreground" data-testid="quiet-hours-preview">
            {formatClock(start)} – {formatClock(end)} · {m["automations.quiet.zone"].replace("{zone}", zoneLabel)}
          </p>

          <SubmitButton pending={pending}>{m["automations.quiet.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
