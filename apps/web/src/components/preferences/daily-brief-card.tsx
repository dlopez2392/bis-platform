"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { briefDayLabel, type DailyBriefRowView } from "./daily-brief-view";

type Result = { ok: true } | { ok: false; error: string };

/**
 * "Your daily brief" on Mis preferencias (plan D3): one immediate switch per business the person may get it for.
 * A switch is not a Save (DESIGN rule 6: reversible, so it runs at once and the toast carries Undo), and the card
 * has no primary button (rule 8). Status is dot + word (rule 3): the dot is decoration, "On"/"Off" is the state, and
 * the switch's own accessible name says which business. The empty state is one sentence of what it is plus what
 * makes a row appear (rule 5); the error state is the sibling `DailyBriefCardError`; the loading state is
 * `DailyBriefCardSkeleton`.
 *
 * The answer to "was it saved" is the action's own: on a refusal or a failed write the switch goes back where it was
 * and a plain error toast says so. Undo is the same action with the other value, so it is idempotent on the server.
 */
export function DailyBriefCard(props: {
  rows: DailyBriefRowView[]; locale: Locale; pseudo: boolean;
  setBrief: (accountId: string, on: boolean, locale: Locale) => Promise<Result>;
}) {
  const tr = makeTr(props.locale, props.pseudo);
  const router = useRouter();
  const [, start] = useTransition();
  // An optimistic answer is remembered with the server value it was made against (`base`): once the refresh brings a
  // different server value the entry is stale and ignored, so a change made elsewhere (another tab, the email's
  // one-click link) shows after a refresh instead of being masked by an old click.
  const [mine, setMine] = useState<Record<string, { on: boolean; base: boolean }>>({});
  const isOn = (r: DailyBriefRowView) => {
    const e = mine[r.accountId];
    return e && e.base === r.on ? e.on : r.on;
  };

  function change(r: DailyBriefRowView, on: boolean, isUndo = false) {
    setMine((s) => ({ ...s, [r.accountId]: { on, base: r.on } }));
    start(async () => {
      const res = await props.setBrief(r.accountId, on, props.locale);
      if (!res.ok) {
        setMine((s) => ({ ...s, [r.accountId]: { on: !on, base: r.on } }));
        toast.error(res.error);
        return;
      }
      if (isUndo) toast(tr.text("dailyBrief.toast.undone"));
      else {
        toast(tr.text(on ? "dailyBrief.toast.on" : "dailyBrief.toast.off", { business: r.businessName }), {
          action: { label: tr.text("dailyBrief.toast.undo"), onClick: () => change(r, !on, true) },
        });
      }
      router.refresh();
    });
  }

  return (
    <Card lang={props.locale} data-daily-brief-card>
      <CardHeader>
        <CardTitle>{tr.text("dailyBrief.card.title")}</CardTitle>
        <p className="text-sm text-[var(--text-2)]">{tr.text("dailyBrief.card.body")}</p>
      </CardHeader>
      <CardContent>
        {props.rows.length === 0 ? (
          <p data-daily-brief-empty className="text-sm text-[var(--text-2)]">{tr.text("dailyBrief.empty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {props.rows.map((r) => {
              const on = isOn(r);
              return (
                <li key={r.accountId} data-daily-brief-row={r.accountId} data-on={on ? "true" : "false"}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="min-w-0 text-sm font-medium break-words [overflow-wrap:anywhere] text-[var(--text-1)]">{r.businessName}</p>
                    <p className="flex items-center gap-2 text-sm text-[var(--text-2)]">
                      <span aria-hidden="true"
                        className={`size-1.5 shrink-0 rounded-full ${on ? "bg-[var(--good)]" : "bg-[var(--text-3)]"}`} />
                      <span data-daily-brief-status>{tr.text(on ? "dailyBrief.status.on" : "dailyBrief.status.off")}</span>
                    </p>
                    {on ? (
                      <p data-daily-brief-detail className="text-sm text-[var(--text-3)]">
                        {tr.text("dailyBrief.row.arrives")}{" "}
                        {r.on && r.lastSentDay
                          ? tr.text("dailyBrief.row.last", { day: briefDayLabel(r.lastSentDay, props.locale) })
                          : tr.text("dailyBrief.row.first")}
                      </p>
                    ) : null}
                  </div>
                  <button type="button" role="switch" aria-checked={on}
                    aria-label={tr.text("dailyBrief.row.switch", { business: r.businessName })}
                    onClick={() => change(r, !on)}
                    className={`relative h-6 w-11 shrink-0 rounded-full border border-[var(--line-strong)] transition-colors duration-150 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${on ? "bg-[var(--accent)]" : "bg-[var(--surface-2)]"}`}>
                    <span aria-hidden="true"
                      className={`absolute top-0.5 left-0.5 size-4.5 rounded-full ${on ? "bg-[var(--primary-foreground)]" : "bg-[var(--text-1)]"} transition-transform duration-150 motion-reduce:transition-none ${on ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The error state (rule 5): the memberships or subscriptions could not be read. Reloading is the retry. */
export function DailyBriefCardError(props: { locale: Locale; pseudo: boolean }) {
  const tr = makeTr(props.locale, props.pseudo);
  return (
    <Card lang={props.locale} data-daily-brief-card-error>
      <CardHeader><CardTitle>{tr.text("dailyBrief.card.title")}</CardTitle></CardHeader>
      <CardContent>
        <p role="status" className="text-sm text-[var(--text-2)]">{tr.text("dailyBrief.card.loadError")}</p>
      </CardContent>
    </Card>
  );
}

/** The loading state (rule 7): shaped like the card, never a spinner. */
export function DailyBriefCardSkeleton() {
  return (
    <div data-daily-brief-skeleton className="max-w-3xl px-6 pb-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="space-y-2"><Skeleton className="h-4 w-44" /><Skeleton className="h-4 w-24" /></div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </CardContent>
      </Card>
    </div>
  );
}
