import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m, type MessageKey } from "@/lib/messages";
import type { BillingAlert } from "@bis/db";

/** Up to this many account names per line; the rest fold into "and N more". */
const MAX_NAMES = 5;

/** Fixed rendering order (plan G13), independent of the array's own order. */
const KIND_ORDER: BillingAlert["kind"][] = ["paused", "paused_no_forward", "payment_failed", "usage_mismatch"];
const KIND_LABEL: Record<BillingAlert["kind"], MessageKey> = {
  paused: "work.agency.billing.paused",
  paused_no_forward: "work.agency.billing.pausedNoForward",
  payment_failed: "work.agency.billing.paymentFailed",
  usage_mismatch: "work.agency.billing.mismatch",
};
/** The three kinds with a real client-facing consequence right now (service
 *  stopped, or a figure that may need a manual credit) — these make the
 *  whole banner `tone="crit"`; `payment_failed` alone (nothing has stopped
 *  yet) keeps it `"warn"`. */
const CRITICAL_KINDS: ReadonlySet<BillingAlert["kind"]> = new Set(["paused", "paused_no_forward", "usage_mismatch"]);

/**
 * The agency's work-queue billing banner (plan G13). DERIVED, NEVER STORED,
 * the way LineDownBanner and UsageStaleBanner are: `listBillingAlerts`
 * (packages/db/src/account-billing.ts) reads the standing rows fresh on
 * every render, so paying or lifting a pause clears an account's line on the
 * very next render with nothing to dismiss, stamp or forget.
 *
 * Renders NOTHING at zero. One line per KIND present, in a fixed order
 * (paused, paused 30+ days, payment failed, usage mismatch) regardless of
 * the array's own order, each naming up to `MAX_NAMES` accounts by link
 * (`/dashboard/accounts/<id>/settings#billing`, `data-account-id` for a
 * test or a future script to find the row), with "and N more" past the cap.
 * `role="note"`: a standing fact already true when the page loaded, not
 * something that just happened (LineDownBanner's own reasoning for
 * overriding Notice's default `role="alert"`).
 *
 * `reconciliationUnchecked` (design review I3): listBillingAlerts could not
 * read the nightly's results, so a last line says usage couldn't be checked
 * rather than letting "no mismatch line" read as "nothing is wrong". Alone it
 * still renders, in `warn`.
 */
export function BillingAlertBanner(
  { alerts, reconciliationUnchecked = false }: { alerts: BillingAlert[]; reconciliationUnchecked?: boolean },
) {
  if (alerts.length === 0 && !reconciliationUnchecked) return null;
  const byKind = new Map<BillingAlert["kind"], BillingAlert[]>();
  for (const a of alerts) {
    const list = byKind.get(a.kind);
    if (list) list.push(a);
    else byKind.set(a.kind, [a]);
  }
  const kinds = KIND_ORDER.filter((k) => byKind.has(k));
  const tone = kinds.some((k) => CRITICAL_KINDS.has(k)) ? "crit" : "warn";
  return (
    <Notice tone={tone} role="note" className="text-foreground">
      <div className="flex flex-col gap-1">
        {kinds.map((kind) => {
          const rows = byKind.get(kind)!;
          const shown = rows.slice(0, MAX_NAMES);
          const rest = rows.length - shown.length;
          return (
            <p key={kind} className="break-words">
              {m[KIND_LABEL[kind]]}{" "}
              {shown.map((a, i) => (
                <span key={a.accountId}>
                  {i > 0 ? ", " : ""}
                  <Link
                    href={`/dashboard/accounts/${a.accountId}/settings#billing`}
                    className="underline underline-offset-2"
                    data-account-id={a.accountId}
                  >
                    {a.accountName}
                  </Link>
                </span>
              ))}
              {rest > 0 ? ` ${m["work.agency.billing.more"].replace("{n}", String(rest))}` : null}
            </p>
          );
        })}
        {reconciliationUnchecked ? <p>{m["work.agency.billing.unchecked"]}</p> : null}
      </div>
    </Notice>
  );
}
