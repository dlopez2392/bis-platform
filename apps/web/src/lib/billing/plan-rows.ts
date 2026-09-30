import type { Plan } from "@bis/db";
import { m } from "@/lib/messages";
import { formatCents } from "./plan-form";

export type PlanStatus = "active" | "archived";

export type PlanRowView = {
  id: string;
  status: PlanStatus;
  price: string;
  allowances: string;
  overage: string;
  features: string;
  clients: string;
  /** The row as stored, for the edit dialog's defaults and its version. */
  plan: Plan;
};

/** Dot + word (DESIGN.md rule 3). The same token classes the automation
 *  history's sent/skipped pills use (lib/automations/log-titles.ts). */
export const PLAN_STATUS_TREATMENTS: Record<PlanStatus, { label: string; dot: string; chip: string }> = {
  active: { label: m["plans.status.active"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  archived: { label: m["plans.status.archived"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
};

const count = (n: number) => n.toLocaleString("en-US");

/** One plan as the list shows it. Every number carries its unit (DESIGN.md
 *  rule 1): "$49.00/month", "500 minutes", "3 clients". */
export function planRowView(plan: Plan, clientCount: number): PlanRowView {
  const features: (string | null)[] = [
    plan.features.voice_receptionist ? m["plans.feature.voice_receptionist"] : null,
    plan.features.web_concierge ? m["plans.feature.web_concierge"] : null,
  ];
  const featureList = features.filter((f): f is string => f !== null);
  return {
    id: plan.id,
    status: plan.archivedAt ? "archived" : "active",
    price: m["plans.perMonth"].replace("{price}", formatCents(plan.monthlyPriceCents)),
    allowances: m["plans.allowances"]
      .replace("{voice}", count(plan.allowances.voice_minutes))
      .replace("{sms}", count(plan.allowances.sms))
      .replace("{chats}", count(plan.allowances.ai_chats)),
    overage: m["plans.overage"]
      .replace("{voice}", formatCents(plan.overageCents.voice_minutes))
      .replace("{sms}", formatCents(plan.overageCents.sms))
      .replace("{chats}", formatCents(plan.overageCents.ai_chats)),
    features: featureList.length > 0 ? featureList.join(" · ") : m["plans.features.none"],
    clients: clientCount === 0 ? m["plans.clients.none"]
      : clientCount === 1 ? m["plans.clients.one"]
      : m["plans.clients.many"].replace("{count}", count(clientCount)),
    plan,
  };
}
