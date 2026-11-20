"use client";

import { AiAppsCard, AiAppsCardError } from "@/components/ai-apps/ai-apps-card";
import { AiAppsUseCard } from "@/components/ai-apps/ai-apps-use-card";

/**
 * MCP PR C: the business's AI apps card (Team page) on, off, read-only for the agency, with an empty and a failed log,
 * and its own error state; then "Use BIS from your AI app" (Mis preferencias) with every row state and with no
 * address. Demo switches answer "not saved" and write nothing.
 */
const ON = { enabledAt: "2026-11-19T20:00:00.000Z", changedAt: "2026-11-19T20:00:00.000Z", changedBy: "demo" };
const OFF = { enabledAt: null, changedAt: "2026-11-19T21:10:00.000Z", changedBy: "demo" };
const LOG = [
  { who: "Ana Ruiz", kind: "ai_app_appointments" as const, at: "2026-11-19T20:30:00.000Z" },
  { who: null, kind: "ai_app_lookup_customer" as const, at: "2026-11-19T19:05:00.000Z" },
];
const set = async () => ({ ok: false as const, error: "Demo only." });
const base = { changedByName: "Maria Lopez", locale: "en" as const, zone: "America/Chicago", pseudo: false, setSwitch: set };
const ROWS = [
  { accountId: "d1", businessName: "Rio Roofing", role: "owner", state: "off" as const },
  { accountId: "d2", businessName: "956 Woodworks", role: "staff", state: "off" as const },
  { accountId: "d3", businessName: "Cedar Landscaping", role: "owner", state: "on" as const },
  { accountId: "d4", businessName: "Dune Tile", role: "owner", state: "unknown" as const },
];

export function AiAppsStates() {
  return (
    <div className="flex w-full min-w-0 max-w-xl flex-col gap-2">
      <AiAppsCard {...base} state={ON} log={LOG} viewer="owner" />
      <AiAppsCard {...base} state={OFF} log={[]} viewer="owner" />
      <AiAppsCard {...base} state={ON} log={LOG} viewer="agency" />
      <AiAppsCard {...base} state={ON} log={null} viewer="owner" />
      <AiAppsCardError locale="en" pseudo={false} />
      <div className="mt-6 flex flex-col gap-6">
        <AiAppsUseCard url="https://app.bis-rgv.com/api/mcp" rows={ROWS} locale="en" pseudo={false} />
        <AiAppsUseCard url={null} rows={ROWS.slice(0, 1)} locale="en" pseudo={false} />
      </div>
    </div>
  );
}
