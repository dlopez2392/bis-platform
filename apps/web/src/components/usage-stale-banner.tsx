import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";

/**
 * "Usage for 2 clients hasn't reached Stripe in over a day."
 *
 * LineDownBanner's design, deliberately: DERIVED, NEVER STORED. The count is
 * the billed accounts `listAccountsWithStaleUsage` (packages/db/src/usage.ts)
 * finds with a reportable usage row still unreported a day after it was
 * recorded. When the cause is fixed the next cron tick sends the rows and
 * this disappears on the next render: nothing to stamp, dismiss or forget,
 * so nothing that can go stale and lie. Rows too old for Stripe (34 days)
 * are not counted: they can never be sent, so they could never clear it;
 * the cron logs them instead.
 *
 * Renders NOTHING at zero. The link goes to the Plans page, which already
 * explains a missing or refused Stripe key, the usual cause.
 *
 * `text-foreground` and `role="note"`: LineDownBanner's own reasons (a full
 * sentence keeps the foreground colour; a standing fact is not an alert).
 */
export function UsageStaleBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  const sentence =
    count === 1
      ? m["work.usageStale.one"]
      : m["work.usageStale.many"].replace("{n}", String(count));

  return (
    <Notice tone="warn" role="note" className="text-foreground">
      {sentence}{" "}
      <Link href="/dashboard/plans" className="underline underline-offset-2">
        {m["work.usageStale.action"]}
      </Link>
    </Notice>
  );
}
