import Link from "next/link";
import { Globe } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { loadWebsiteState } from "@/lib/website/load";
import { parsePeriod, type Period } from "@/lib/website/view-model";
import { m } from "@/lib/messages";
import { WebsiteSection } from "./website-section";
import { WebsiteSkeleton } from "./loading";

export const dynamic = "force-dynamic";

const PERIODS: Period[] = [7, 14, 30];
const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

/** Three links, not a client component: the period is a search param, so the
 *  page stays a server component and the switch works without JavaScript. */
function PeriodSwitch({ base, period }: { base: string; period: Period }) {
  return (
    <nav aria-label="Period" className="flex gap-1 rounded-full border border-border bg-card p-0.5">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`${base}/website?period=${p}`}
          aria-current={p === period ? "true" : undefined}
          className={
            p === period
              ? "pill-on rounded-full px-3 py-1 font-mono text-[11px] font-medium tracking-[0.06em]"
              : "rounded-full px-3 py-1 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground hover:bg-[var(--surface-3)]"
          }
        >
          {m[`website.period.${p}`]}
        </Link>
      ))}
    </nav>
  );
}

export default async function WebsitePage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { accountId } = await params;
  const { period: rawPeriod } = await searchParams;
  // Authorization happened in [accountId]/layout.tsx; this call only learns
  // the role, which decides the unlinked state's single action.
  const { isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const period = parsePeriod(rawPeriod);
  const base = `/dashboard/accounts/${accountId}`;
  const result = await loadWebsiteState(db, accountId, period, new Date());

  if (result.state === "unlinked") {
    return (
      <>
        <PageHeader title={m["website.title"]} />
        <div className="p-6">
          <EmptyState
            icon={Globe}
            title={m["website.empty.title"]}
            body={m["website.empty.body"]}
            action={isAgency ? (
              <Button asChild><Link href={`${base}/settings#website`}>{m["website.empty.link"]}</Link></Button>
            ) : (
              <Button asChild>
                <a href={`mailto:${process.env.AGENCY_SUPPORT_EMAIL ?? "hello@bis-rgv.com"}?subject=${encodeURIComponent(m["website.empty.askSubject"])}`}>
                  {m["website.empty.askAgency"]}
                </a>
              </Button>
            )}
          />
        </div>
      </>
    );
  }

  if (result.state === "waiting") {
    return (
      <>
        <PageHeader title={m["website.title"]} actions={<PeriodSwitch base={base} period={period} />} />
        <div className="space-y-3 p-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <p className={LABEL}>{m[`website.periodLabel.${period}`]}</p>
            <p className="mt-2 font-display text-lg font-[650] text-card-foreground">{m["website.waiting.title"]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{m["website.waiting.body"].replace("{domain}", result.domain)}</p>
          </div>
          <WebsiteSkeleton />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={m["website.title"]} actions={<PeriodSwitch base={base} period={period} />} />
      <WebsiteSection view={result.view} />
    </>
  );
}
