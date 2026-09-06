import { Fragment } from "react";
import { PhoneIncoming } from "lucide-react";
import { listCalls, countCallsSince, listFailedOutboundSms, type TextbackWindow } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { safeZone } from "@/lib/booking/time";
import { readLimitConfig, utcDayStart } from "@/lib/voice/call-limits";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { CallsTable } from "./calls-table";
import { textbackWindow } from "./textback-window";

export const dynamic = "force-dynamic";

/** One page of history. A full page back is the only signal there may be more
 *  — `listCalls` returns rows, not a total — so it is also what decides
 *  whether the "Older calls" link renders. */
const PAGE_SIZE = 50;

/**
 * The `?before=` cursor is a hand-editable URL parameter that ends up inside
 * a PostgREST `lt("started_at", …)` filter. Anything that is not an ISO
 * timestamp is dropped rather than forwarded: an unparseable value makes
 * Postgres raise, which would turn a mistyped URL into a 500 error page.
 * Validated, not rewritten — `started_at` carries microseconds, and
 * round-tripping through `Date` would truncate the cursor to milliseconds and
 * could silently skip a row.
 */
function cursorFrom(raw: string | undefined): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(Date.parse(raw))) return undefined;
  return raw;
}

export default async function CallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { accountId } = await params;
  const { before } = await searchParams;
  // BOTH audiences. This is the client's own business data — who rang and
  // what the receptionist did about it — the same class of surface contacts
  // and the calendar are gated with, not agency work about the client.
  await requireAccountAccess(accountId);
  const db = await dbForRequest();

  // Validated once, reused twice: as the query's own cursor below, and as
  // the signal that decides which empty state a zero-row result means (see
  // the render below). An unparseable `?before=` is dropped by `cursorFrom`
  // and so, correctly, reads as "no cursor" here too — a mistyped URL falls
  // back to page one rather than to the false "no calls yet" reading a
  // client scrolled fifty-deep into their own history would otherwise get.
  const cursor = cursorFrom(before);

  const [rows, todayCount, account] = await Promise.all([
    listCalls(db, accountId, { limit: PAGE_SIZE, before: cursor }),
    // The SAME function the incoming-call webhook counts with, over the SAME
    // UTC day floor it enforces against. A second, "obvious" formula here
    // (local midnight, ended calls only, …) would let this meter disagree
    // with the cap that actually declines calls.
    countCallsSince(db, accountId, utcDayStart(new Date())),
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`calls: account lookup failed: ${error.message}`);
        if (!data) throw new Error("calls: account not found");
        return data as { timezone: string };
      }),
  ]);

  // …and the same config read, so the denominator on screen is the cap that
  // is actually enforced rather than a hard-coded 50.
  const cap = readLimitConfig().perAccountPerDay;
  const timezone = safeZone(account.timezone, "UTC");

  // ONE read for the whole page, not one per row — fifty rows would otherwise
  // be fifty round trips to answer a question that is empty for almost all of
  // them. `listFailedOutboundSms` returns early on an empty window list, so a
  // page of calls that never opened a conversation (every call before the
  // text-back shipped) costs nothing at all. Sequential rather than in the
  // Promise.all above because it takes what that read returns.
  //
  // One window PER CALL, never a bare list of conversation ids: conversations
  // are one-per-CONTACT, so a repeat caller's conversation spans every call
  // they ever made and a conversation-keyed answer lands on all of them.
  // `textbackWindow` is where the bounds — and the shapes it refuses to answer
  // for at all — are set out.
  const windows = rows
    .map((row) => textbackWindow(row))
    .filter((w): w is TextbackWindow => w !== null);

  // Swallowed, exactly like the four legs of `finishCall` are. This badge is
  // advisory; the log of calls is the page. A momentary `messages` failure must
  // cost the operator their badges, not their Calls page — and the log line is
  // the only trace that the badges on screen are incomplete.
  let textbackFailed: ReadonlySet<string> = new Set<string>();
  try {
    const failures = await listFailedOutboundSms(db, accountId, windows);
    // Keyed on the CALL id the window carried in, so the table joins on the row
    // it is rendering rather than on the contact's whole thread.
    textbackFailed = new Set(failures.map((f) => f.callId));
  } catch (e) {
    console.error(
      `calls ${accountId}: failed-text-back read failed, rendering no badges: ${String(e)}`,
    );
  }

  const last = rows[rows.length - 1];
  const olderHref =
    rows.length === PAGE_SIZE && last
      ? `/dashboard/accounts/${accountId}/calls?before=${encodeURIComponent(last.started_at)}`
      : undefined;

  return (
    <>
      <PageHeader title={m["calls.title"]} />
      <div className="space-y-6 p-6">
        <UsageMeter used={todayCount} cap={cap} />
        {rows.length === 0 && !cursor ? (
          // The COLD-START reading of zero rows: no `?before=` cursor, so
          // this is page one and there is nothing behind it either — a
          // client who has genuinely never had a call. A cursored zero
          // (below) means the opposite: real history, just none older than
          // the cursor, and `CallsTable` with zero rows renders its headers
          // and no pager rather than this.
          <EmptyState
            icon={PhoneIncoming}
            title={m["calls.empty.title"]}
            body={m["calls.empty.body"]}
          />
        ) : (
          <CallsTable
            rows={rows}
            accountId={accountId}
            timezone={timezone}
            olderHref={olderHref}
            textbackFailed={textbackFailed}
          />
        )}
      </div>
    </>
  );
}

/**
 * Today against the daily cap. Read as an instrument, not a warning label:
 * at rest it is one quiet line, and it only raises its voice as the account
 * approaches the point where real callers start being declined — which is
 * the one thing about this number a client would actually want to be told.
 */
function UsageMeter({ used, cap }: { used: number; cap: number }) {
  const denominator = Math.max(1, Math.floor(cap));
  const ratio = Math.min(1, Math.max(0, used / denominator));
  // Clamped integer, never interpolated from anything user-supplied — the
  // only thing that reaches the style attribute.
  const percent = used > 0 ? Math.max(2, Math.round(ratio * 100)) : 0;

  const tone =
    used >= denominator
      ? { fill: "bg-destructive", chip: "bg-destructive/10 text-destructive" }
      : ratio >= 0.8
        ? { fill: "bg-warning", chip: "bg-warning/10 text-warning" }
        : { fill: "bg-primary", chip: "bg-primary/10 text-primary" };

  // Split rather than a plain double `.replace()` so the two numbers can be
  // set apart typographically while the sentence — including the order of its
  // parts — stays entirely in the message catalogue.
  const parts = m["calls.usage"].split(/(\{n\}|\{cap\})/);
  // The progressbar's accessible VALUE below — as `aria-valuetext`, not as its
  // name. A name carrying this same sentence would duplicate the visible
  // paragraph beside it: a screen reader would announce it once for the
  // paragraph and again for the bar it describes. `aria-valuetext` replaces
  // the numeric "N of M" AT would otherwise synthesize from
  // `aria-valuenow`/`aria-valuemax`, so it reads once.
  //
  // The bar still needs a NAME as well as a value — a `progressbar` with none
  // is announced as an unlabelled progress bar — so it carries a short
  // `aria-label` that says what is being measured rather than restating the
  // count.
  const plain = m["calls.usage"].replace("{n}", String(used)).replace("{cap}", String(cap));

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-6">
      <span
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", tone.chip)}
      >
        <PhoneIncoming className="size-4" aria-hidden />
      </span>

      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {part === "{n}" ? (
              <span className="text-base font-semibold tabular-nums text-foreground">{used}</span>
            ) : part === "{cap}" ? (
              <span className="tabular-nums">{cap}</span>
            ) : (
              part
            )}
          </Fragment>
        ))}
      </p>

      <div
        role="progressbar"
        aria-label={m["calls.usageLabel"]}
        aria-valuemin={0}
        aria-valuemax={denominator}
        aria-valuenow={Math.min(used, denominator)}
        aria-valuetext={plain}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted sm:w-56"
      >
        <div className={cn("h-full rounded-full", tone.fill)} style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
