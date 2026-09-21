"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_QUIET_SETTINGS, type QuietSettings } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
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
 *
 * `settings` is `null` when the page's own read failed (Part C fix wave item
 * 3): the card must still render (the agency may be here to FIX it), but it
 * must NOT show `DEFAULT_QUIET_SETTINGS` as if it were the client's saved
 * window — a Save from that state would silently overwrite a real 22:30–06:15
 * with the platform default. So a failed read shows a Notice, and disables
 * the form outright (the three inputs and Save) until the page is reloaded.
 * The visible fields still need SOME value to render — `DEFAULT_QUIET_SETTINGS`
 * fills them only while disabled, never submitted.
 */
export function QuietHoursCard({
  settings, zoneLabel, saveAction,
}: {
  settings: QuietSettings | null;
  /** The account's zone as the operator knows it ("America/Chicago"). */
  zoneLabel: string;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const readFailed = settings === null;
  const shown = settings ?? DEFAULT_QUIET_SETTINGS;
  const [start, setStart] = useState(shown.start);
  const [end, setEnd] = useState(shown.end);
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
      <CardContent className="space-y-4">
        {readFailed && <Notice tone="crit">{m["automations.quiet.readFailed"]}</Notice>}
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="quiet-enabled" name="quiet_enabled" defaultChecked={shown.enabled} disabled={readFailed} />
            <Label htmlFor="quiet-enabled">{m["automations.quiet.enabled"]}</Label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="quiet-start" className="w-12 text-sm">{m["automations.quiet.from"]}</Label>
            <Input id="quiet-start" name="quiet_start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" required disabled={readFailed} />
            <Label htmlFor="quiet-end" className="w-12 text-sm">{m["automations.quiet.to"]}</Label>
            <Input id="quiet-end" name="quiet_end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" required disabled={readFailed} />
          </div>
          <p className="text-xs text-muted-foreground" data-testid="quiet-hours-preview">
            {formatClock(start)} – {formatClock(end)} · {m["automations.quiet.zone"].replace("{zone}", zoneLabel)}
          </p>

          <SubmitButton pending={pending} disabled={readFailed}>{m["automations.quiet.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
