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
type Tile = { key: string; label: string; value: number; context: string; extra?: string };

export function UsageCard({ state, monthLabel, callCap }: { state: UsageState; monthLabel: string; callCap: number }) {
  const tiles: Tile[] = state.ok ? [
    { key: "texts", label: m["activity.usage.texts"], value: state.usage.textsSent, context: m["activity.usage.capRecipe"].replace("{cap}", String(AUTOMATION_DAILY_CAP)) },
    {
      key: "emails", label: m["activity.usage.emails"], value: state.usage.emailsSent,
      context: m["activity.usage.capRecipe"].replace("{cap}", String(AUTOMATION_DAILY_CAP)),
      // D-066: counts only customer emails (never the agency's own weekly
      // report, which carries no recipe cap) and names its own failed
      // count — "0 failed to send" is a real month, not a blank one.
      extra: m["activity.usage.emailsFailed"].replace("{n}", String(state.usage.emailsFailed)),
    },
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
                  {t.extra ? <dd className="text-xs text-muted-foreground">{t.extra}</dd> : null}
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
