import { CheckCircle2, CircleSlash } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";

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
  return (
    <AuthShell>
      <div className="flex flex-col items-start gap-3">
        <Icon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          {success ? m["billing.done.success.title"] : m["billing.done.cancelled.title"]}
        </p>
        <p className="text-sm text-muted-foreground">
          {success ? m["billing.done.success.body"] : m["billing.done.cancelled.body"]}
        </p>
      </div>
    </AuthShell>
  );
}
