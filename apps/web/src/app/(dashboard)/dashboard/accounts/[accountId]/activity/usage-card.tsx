import type { AutomationUsage } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/lib/messages";
import { AUTOMATION_DAILY_CAP } from "@/lib/automations/caps";
import { CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY } from "@/lib/concierge/guards";

export type UsageState = { ok: true; usage: AutomationUsage } | { ok: false };

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

/**
 * Four numbers, each with its period (the month label is the card's
 * description — DESIGN.md rule 1) and the fixed cap it lives under, as
 * context. No hero gradient: text-coloured numbers; the dashboard's KPI is
 * the screen's one gradient moment and this is not that screen.
 */
export function UsageCard({ state, monthLabel, callCap }: { state: UsageState; monthLabel: string; callCap: number }) {
  const tiles = state.ok ? [
    { key: "texts", label: m["activity.usage.texts"], value: state.usage.textsSent, context: m["activity.usage.capRecipe"].replace("{cap}", String(AUTOMATION_DAILY_CAP)) },
    { key: "emails", label: m["activity.usage.emails"], value: state.usage.emailsSent, context: m["activity.usage.capRecipe"].replace("{cap}", String(AUTOMATION_DAILY_CAP)) },
    { key: "conversations", label: m["activity.usage.conversations"], value: state.usage.conversations, context: m["activity.usage.capDay"].replace("{cap}", String(CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY)) },
    { key: "calls", label: m["activity.usage.calls"], value: state.usage.callsHandled, context: m["activity.usage.capDay"].replace("{cap}", String(callCap)) },
  ] : [];
  return (
    <Card data-testid="usage-card">
      <CardHeader>
        <CardTitle>{m["activity.usage.title"]}</CardTitle>
        <CardDescription>{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {!state.ok ? (
          <p className="text-sm text-muted-foreground" role="alert">{m["activity.usage.error"]}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {tiles.map((t) => (
                <div key={t.key} data-usage={t.key}>
                  <dt className={LABEL}>{t.label}</dt>
                  <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{t.value}</dd>
                  <dd className="text-xs text-muted-foreground">{t.context}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-muted-foreground" data-testid="usage-held">
              {m["activity.usage.held"].replace("{n}", String(state.usage.held))}
              {state.usage.topHeldReason ? ` · ${m["activity.usage.topReason"].replace("{reason}", state.usage.topHeldReason)}` : ""}
            </p>
            <p className="text-sm text-muted-foreground" data-testid="usage-skipped">
              {m["activity.usage.skipped"].replace("{n}", String(state.usage.skipped))}
              {state.usage.topSkippedReason ? ` · ${m["activity.usage.topReason"].replace("{reason}", state.usage.topSkippedReason)}` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
