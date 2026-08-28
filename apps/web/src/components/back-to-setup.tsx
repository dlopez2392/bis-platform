import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { m } from "@/lib/messages";

/**
 * The way back out of a settings page the setup wizard sent you into.
 *
 * Rendered only when the arriving link carried `?from=setup`, so the same
 * page reached from the sidebar keeps its own identity and gains no phantom
 * breadcrumb to a flow nobody is in. Quiet by construction — it sits on the
 * page background above the PageHeader's card, at the same `px-6` gutter
 * every page uses, and reads as a breadcrumb rather than a second nav.
 *
 * Server component: it is a link and a word.
 */
export function BackToSetup({ accountId }: { accountId: string }) {
  return (
    <div className="px-6 pt-4">
      <Link
        href={`/dashboard/accounts/${accountId}/setup`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {m["setup.backToSetup"]}
      </Link>
    </div>
  );
}
