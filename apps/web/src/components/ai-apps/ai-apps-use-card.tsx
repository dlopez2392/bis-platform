"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { makeTr } from "@/lib/record/copy";
import type { AiAppsUseRow } from "@/lib/ai-apps/view";
import type { Locale } from "@/lib/i18n/locale";

/**
 * "Use BIS from your AI app" on Mis preferencias (plan 2026-11-19-mcp-server.md 3.6), for people who are an Owner or
 * Staff of a business (D1; a Technician gets no card, the page decides). The server address, a copy button, two short
 * how-tos and, per business, whether its Owner has switched AI apps on (dot + word, rule 3).
 *
 * ASSUMPTION, subject to danlo's acceptance check (plan section 6): the how-to words below (Claude: Settings,
 * Connectors, Add custom connector; ChatGPT: Settings, Connectors, developer mode) describe those apps' screens as
 * the plan recorded them and are fixed by that check, not before. ChatGPT's connector setup needs a paid plan.
 *
 * No primary button (rule 8): Copy is ghost. `url` is null when the app has no origin to build on: the card says so
 * and offers no Copy rather than a relative path.
 */
export function AiAppsUseCardError(props: { locale: Locale; pseudo: boolean }) {
  const tr = makeTr(props.locale, props.pseudo);
  return (
    <Card lang={props.locale} data-ai-apps-use-card-error>
      <CardHeader><CardTitle>{tr.text("aiAppsUse.title")}</CardTitle></CardHeader>
      <CardContent>
        <p role="status" className="text-sm text-[var(--text-2)]">{tr.text("aiAppsUse.loadError")}</p>
      </CardContent>
    </Card>
  );
}

export function AiAppsUseCard(props: { url: string | null; rows: AiAppsUseRow[]; locale: Locale; pseudo: boolean }) {
  const tr = makeTr(props.locale, props.pseudo);
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!props.url) return;
    try {
      await navigator.clipboard.writeText(props.url);
      setCopied(true);
      toast.success(tr.text("aiAppsUse.copied"));
    } catch {
      toast.error(tr.text("aiAppsUse.copyFailed"));
    }
  }
  return (
    <Card lang={props.locale} data-ai-apps-use-card>
      <CardHeader>
        <CardTitle>{tr.text("aiAppsUse.title")}</CardTitle>
        <p className="text-sm text-[var(--text-2)]">{tr.text("aiAppsUse.body")}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p id="ai-apps-url-label"
            className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">
            {tr.text("aiAppsUse.url.label")}
          </p>
          {props.url ? (
            <div className="flex items-center gap-2">
              <code data-ai-apps-url
                className="min-w-0 flex-1 rounded-[var(--radius-ctl)] border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 font-mono text-sm break-all text-[var(--text-1)] select-all">
                {props.url}
              </code>
              <Button type="button" variant="ghost" size="sm" onClick={copy} aria-label={tr.text("aiAppsUse.copyLabel")}>
                {tr.text("aiAppsUse.copy")}
              </Button>
              <span aria-live="polite" className="sr-only">{copied ? tr.text("aiAppsUse.copied") : ""}</span>
            </div>
          ) : (
            <p role="status" className="text-sm text-[var(--text-2)]">{tr.text("aiAppsUse.noAddress")}</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["claude", "chatgpt"] as const).map((app) => (
            <div key={app} data-ai-apps-howto={app}>
              <p className="text-sm font-medium text-[var(--text-1)]">{tr.text(`aiAppsUse.${app}.title`)}</p>
              <p className="text-sm text-[var(--text-2)]">{tr.text(`aiAppsUse.${app}.steps`)}</p>
            </div>
          ))}
        </div>
        <section aria-labelledby="ai-apps-businesses" className="border-t border-[var(--line)] pt-4">
          <h3 id="ai-apps-businesses"
            className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">
            {tr.text("aiAppsUse.businesses")}
          </h3>
          <ul className="divide-y divide-[var(--line)]">
            {props.rows.map((r) => (
              <li key={r.accountId} data-ai-apps-use-row={r.accountId} data-state={r.state}
                className="py-3 first:pt-0 last:pb-0">
                <p className="min-w-0 text-sm font-medium break-words [overflow-wrap:anywhere] text-[var(--text-1)]">{r.businessName}</p>
                {r.state === "unknown" ? (
                  <p className="text-sm text-[var(--text-2)]">{tr.text("aiAppsUse.business.readError")}</p>
                ) : (
                  <p className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--text-2)]">
                    <span aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${r.state === "on" ? "bg-[var(--good)]" : "bg-[var(--text-3)]"}`} />
                    <span>{tr.text(r.state === "on" ? "aiAppsUse.business.on" : "aiAppsUse.business.off")}</span>
                    {r.state === "off" ? (
                      r.role === "owner" ? (
                        <Link href={`/dashboard/accounts/${r.accountId}/team#ai-apps`}
                          className="rounded-[var(--radius-ctl)] text-[var(--text-1)] underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                          {tr.text("aiAppsUse.business.switchOn")}
                        </Link>
                      ) : (
                        <span>{tr.text("aiAppsUse.business.askOwner")}</span>
                      )
                    ) : null}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
