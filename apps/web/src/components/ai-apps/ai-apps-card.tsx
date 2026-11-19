"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { makeTr } from "@/lib/record/copy";
import { aiAppLogLine, whenLabel } from "@/lib/ai-apps/view";
import type { Locale } from "@/lib/i18n/locale";
import type { AiAppLogRow, AiAppsSwitchState } from "@bis/db";

type Result = { ok: true; value: AiAppsSwitchState } | { ok: false; error: string };

/**
 * The business's "AI apps" card on the Team page, beside the owner line's switch (plan 2026-11-19-mcp-server.md 3.6).
 * One switch, and only the business's Owner gets it (D2): the agency reads the state, who changed it and the log, and
 * is offered no control at all, not a disabled one. The change runs at once and the toast carries Undo (DESIGN rule 6);
 * Undo is the same action with the other value. The card has no primary button (rule 8): a switch is not a Save.
 * Status is dot + word (rule 3).
 *
 * Like the owner line's card it renders the state the action RETURNS, never a re-fetch: the action does not revalidate
 * (an OFF is allowed while the account is paused). What it cannot know client-side is the name of whoever just changed
 * it, and that is always the viewing Owner, so it says "you".
 *
 * `log` is null when the list of reads could not be read: that costs the list only (rule 5 on the card), the switch
 * still works. [] is the designed empty state.
 */
export function AiAppsCardError(props: { locale: Locale; pseudo: boolean }) {
  const tr = makeTr(props.locale, props.pseudo);
  return (
    <Card lang={props.locale} data-ai-apps-card-error id="ai-apps" className="mt-6 scroll-mt-20">
      <CardHeader><CardTitle>{tr.text("aiApps.title")}</CardTitle></CardHeader>
      <CardContent>
        <p role="status" className="text-sm text-[var(--text-2)]">{tr.text("aiApps.loadError")}</p>
      </CardContent>
    </Card>
  );
}

export function AiAppsCard(props: {
  state: AiAppsSwitchState; changedByName: string | null; log: AiAppLogRow[] | null;
  viewer: "owner" | "agency"; locale: Locale; zone: string; pseudo: boolean;
  setSwitch: (on: boolean) => Promise<Result>;
}) {
  const tr = makeTr(props.locale, props.pseudo);
  const [state, setState] = useState(props.state);
  const [byYou, setByYou] = useState(false);
  const [pending, start] = useTransition();
  const on = state.enabledAt !== null;

  const flip = (next: boolean, isUndo = false) => start(async () => {
    const r = await props.setSwitch(next);
    if (!r.ok) { toast.error(r.error); return; }
    setState(r.value);
    setByYou(true);
    if (isUndo) { toast(tr.text("aiApps.undone")); return; }
    toast.success(tr.text(next ? "aiApps.turnedOn" : "aiApps.turnedOff"),
      { action: { label: tr.text("common.undo"), onClick: () => flip(!next, true) } });
  });

  const who = byYou ? tr.text("aiApps.byYou") : (props.changedByName?.trim() || tr.text("aiApps.byOwner"));
  return (
    <Card lang={props.locale} data-ai-apps-card id="ai-apps" className="mt-6 scroll-mt-20">
      <CardHeader>
        <CardTitle>{tr.text("aiApps.title")}</CardTitle>
        <p className="text-sm text-[var(--text-2)]">{tr.text("aiApps.body")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm">
            <span aria-hidden className={`size-2 rounded-full ${on ? "bg-[var(--good)]" : "bg-[var(--text-3)]"}`} />
            <span data-ai-apps-status>{tr.text(on ? "aiApps.on" : "aiApps.off")}</span>
          </span>
          {props.viewer === "owner" ? (
            <Button type="button" variant={on ? "ghost" : "default"} disabled={pending} onClick={() => flip(!on)}>
              {tr.text(on ? "aiApps.turnOff" : "aiApps.turnOn")}
            </Button>
          ) : (
            <p className="text-sm text-[var(--text-2)]">{tr.text("aiApps.agencyCannot")}</p>
          )}
        </div>
        <p data-ai-apps-record className="text-sm text-[var(--text-2)]">
          {state.changedAt
            ? tr.text(on ? "aiApps.turnedOnBy" : "aiApps.turnedOffBy", { who, when: whenLabel(state.changedAt, props.locale, props.zone) })
            : tr.text("aiApps.never")}
        </p>
        <section aria-labelledby="ai-apps-log-title" className="border-t border-[var(--line)] pt-4">
          <h3 id="ai-apps-log-title"
            className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">
            {tr.text("aiApps.log.title")}
          </h3>
          {props.log === null ? (
            <p role="status" data-ai-apps-log-error className="text-sm text-[var(--text-2)]">{tr.text("aiApps.log.error")}</p>
          ) : props.log.length === 0 ? (
            <p data-ai-apps-log-empty className="text-sm text-[var(--text-2)]">{tr.text("aiApps.log.empty")}</p>
          ) : (
            <ul data-ai-apps-log className="divide-y divide-[var(--line)]">
              {props.log.map((row, i) => {
                const line = aiAppLogLine(row, props.locale, props.zone);
                return (
                  <li key={`${row.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <p className="min-w-0 text-sm break-words [overflow-wrap:anywhere]">
                      <span className="font-medium text-[var(--text-1)]">{line.who}</span>{" "}
                      <span className="text-[var(--text-2)]">{line.what}</span>
                    </p>
                    <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">{line.when}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
