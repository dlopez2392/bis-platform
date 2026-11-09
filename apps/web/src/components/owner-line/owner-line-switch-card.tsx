"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { OwnerLineSwitchState } from "@bis/db";

type Result = { ok: true; value: OwnerLineSwitchState } | { ok: false; error: string };

/**
 * F-032 §3.3, owner ruling Q-A: off by default. The client's Owner turns it on or off; the agency may turn it OFF,
 * never ON (Task 6 brief's must #3: the ON control is never offered to the agency at all, not merely disabled).
 * The card names what KIND of person last changed it and when ("Turned off by BIS, Nov 9, 2:14 PM"; "Turned on
 * by the Owner, ..."), never a name (owner ruling 2026-11-09, "Say BIS, keep names private") — must #2.
 * Status is dot + word (rule 3). A change runs at once; Undo is offered only when THIS viewer may make the
 * reverse change (rule 6): an Owner always, the agency never, because undoing its OFF would be an ON.
 *
 * Renders the STATE THIS ACTION RETURNS, never a server re-fetch: `setOwnerLineSwitchAction` does not
 * revalidate (the billing-pause scanner forbids it while the account is paused), so the only honest state this
 * card can show after a write is the write's own answer.
 */
export function OwnerLineSwitchCard(props: {
  state: OwnerLineSwitchState; viewer: "owner" | "agency"; locale: Locale; zone: string; pseudo: boolean;
  setSwitch: (on: boolean) => Promise<Result>;
}) {
  const tr = makeTr(props.locale, props.pseudo);
  const [state, setState] = useState(props.state);
  const [pending, start] = useTransition();
  const on = state.enabledAt !== null;
  const mayTurn = (next: boolean) => props.viewer === "owner" || next === false;
  const flip = (next: boolean, offerUndo = true) => start(async () => {
    const r = await props.setSwitch(next);
    if (!r.ok) { toast.error(r.error); return; }
    setState(r.value);
    const undo = offerUndo && mayTurn(!next)
      ? { action: { label: tr.text("common.undo"), onClick: () => flip(!next, false) } } : {};
    toast.success(tr.text(next ? "ownerLine.switch.turnedOn" : "ownerLine.switch.turnedOff"), undo);
  });
  const when = state.changedAt ? new Intl.DateTimeFormat(props.locale === "es" ? "es-US" : "en-US",
    { timeZone: props.zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(state.changedAt)).replace(/ /g, " ") : null;
  const who = tr.text(state.changedByKind === "agency" ? "ownerLine.switch.byBis" : "ownerLine.switch.byOwner");
  return (
    <Card data-owner-line-switch className="mt-6">
      <CardHeader>
        <CardTitle>{tr.text("ownerLine.switch.title")}</CardTitle>
        <p className="text-sm text-[var(--text-2)]">{tr.text("ownerLine.switch.body")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm">
            <span aria-hidden className={`size-2 rounded-full ${on ? "bg-[var(--good)]" : "bg-[var(--text-3)]"}`} />
            {tr.text(on ? "ownerLine.switch.on" : "ownerLine.switch.off")}
          </span>
          {mayTurn(!on) ? (
            <Button type="button" variant={on ? "ghost" : "default"} disabled={pending} onClick={() => flip(!on)}>
              {tr.text(on ? "ownerLine.switch.turnOff" : "ownerLine.switch.turnOn")}
            </Button>
          ) : (
            <p className="text-sm text-[var(--text-2)]">{tr.text("ownerLine.switch.agencyCannot")}</p>
          )}
        </div>
        {when ? (
          <p data-owner-line-switch-record className="text-sm text-[var(--text-2)]">
            {tr.text(on ? "ownerLine.switch.turnedOnBy" : "ownerLine.switch.turnedOffBy", { who, when })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
