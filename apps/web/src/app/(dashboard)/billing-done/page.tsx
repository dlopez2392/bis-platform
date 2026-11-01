import { headers } from "next/headers";
import { CheckCircle2, CircleSlash } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { localeFromAcceptLanguage } from "@/lib/i18n/accept-language";

/**
 * Where Stripe Checkout returns the payer (G17). PUBLIC (proxy.ts protects
 * /dashboard only) and signed out, so it wears the platform's mark in
 * AuthShell, like /sign-in and /no-access: no tenant can be identified
 * before authentication (DESIGN rule 9's exception, same reason). It claims
 * success only for ?result=success, which only Checkout's success_url sets;
 * the subscription itself becomes real through the webhook, not this page.
 */
export default async function BillingDone({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  const success = result === "success";
  const Icon = success ? CheckCircle2 : CircleSlash;
  // S-10 T7 (spec §7 Q5): signed out, part of the same family as /sign-in,
  // / and /no-access — the browser's own language.
  const locale = localeFromAcceptLanguage((await headers()).get("accept-language"));
  return (
    <AuthShell locale={locale}>
      <div className="flex flex-col items-start gap-3">
        <Icon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          {success ? t(m, "billing.done.success.title", locale) : t(m, "billing.done.cancelled.title", locale)}
        </p>
        <p className="text-sm text-muted-foreground">
          {success ? t(m, "billing.done.success.body", locale) : t(m, "billing.done.cancelled.body", locale)}
        </p>
      </div>
    </AuthShell>
  );
}
