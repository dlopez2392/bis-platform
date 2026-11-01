import type { AutomationUsage } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/lib/messages";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
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

export function UsageCard({
  state, monthLabel, callCap, locale = "en", pseudo = false,
}: { state: UsageState; monthLabel: string; callCap: number; locale?: Locale; pseudo?: boolean }) {
  const tr = makeTr(locale, pseudo);
  const tiles: Tile[] = state.ok ? [
    { key: "texts", label: tr.text("activity.usage.texts"), value: state.usage.textsSent, context: tr.text("activity.usage.capRecipe", { cap: AUTOMATION_DAILY_CAP }) },
    {
      key: "emails", label: tr.text("activity.usage.emails"), value: state.usage.emailsSent,
      context: tr.text("activity.usage.capRecipe", { cap: AUTOMATION_DAILY_CAP }),
      // D-066: counts only customer emails (never the agency's own weekly
      // report, which carries no recipe cap) and names its own failed
      // count — "0 failed to send" is a real month, not a blank one.
      // S-10 T5: "no se enviaron" conjugates with the count ("no se envió" at
      // 1) — plural(), never a bare {n} interpolation.
      extra: tr.count("activity.usage.emailsFailed", state.usage.emailsFailed, { n: state.usage.emailsFailed }),
    },
    { key: "conversations", label: tr.text("activity.usage.conversations"), value: state.usage.conversations, context: tr.text("activity.usage.capDay", { cap: CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY }) },
    { key: "calls", label: tr.text("activity.usage.calls"), value: state.usage.callsHandled, context: tr.text("activity.usage.capDay", { cap: callCap }) },
  ] : [];
  return (
    <Card data-testid="usage-card">
      <CardHeader>
        <CardTitle>{tr.text("activity.usage.title")}</CardTitle>
        <CardDescription>{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {!state.ok ? (
          <p className="text-sm text-muted-foreground" role="alert">{tr.text("activity.usage.error")}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {tiles.map((tile) => (
                <div key={tile.key} data-usage={tile.key}>
                  <dt className={LABEL}>{tile.label}</dt>
                  <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{tile.value}</dd>
                  <dd className="text-xs text-muted-foreground">{tile.context}</dd>
                  {tile.extra ? <dd className="text-xs text-muted-foreground">{tile.extra}</dd> : null}
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-muted-foreground" data-testid="usage-held">
              {tr.text("activity.usage.held", { n: state.usage.held })}
              {state.usage.topHeldReason ? ` · ${tr.text("activity.usage.topReason", { reason: state.usage.topHeldReason })}` : ""}
            </p>
            <p className="text-sm text-muted-foreground" data-testid="usage-skipped">
              {/* S-10 T5: "omitido/omitidos" agrees in number too. */}
              {tr.count("activity.usage.skipped", state.usage.skipped, { n: state.usage.skipped })}
              {state.usage.topSkippedReason ? ` · ${tr.text("activity.usage.topReason", { reason: state.usage.topSkippedReason })}` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
