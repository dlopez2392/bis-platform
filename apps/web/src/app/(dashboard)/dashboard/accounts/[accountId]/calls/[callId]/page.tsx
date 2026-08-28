import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarCheck,
  ChevronRight,
  Clock,
  MessagesSquare,
  Timer,
  UserRound,
} from "lucide-react";
import { getCall, type CallOutcome } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { safeZone } from "@/lib/booking/time";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { callerLabel, formatCallTime, formatDuration } from "../format";
import { splitSummaryBlocks, type SummaryBlock } from "./summary-blocks";
import { TranscriptView } from "./transcript-view";

export const dynamic = "force-dynamic";

/**
 * The same treatment the list uses, reduced to what a single badge needs. Kept
 * in step with `calls-table.tsx` deliberately: a client arrives here by
 * clicking a row, and an outcome that changed colour on the way in would read
 * as a different outcome.
 *
 * The hue lives in the dot and the chip, never in the label text — `--success`
 * on a light surface measures ~3.4:1, below AA for text this size.
 */
const OUTCOMES: Record<CallOutcome, { label: string; dot: string; chip: string }> = {
  booked: {
    label: m["calls.outcome.booked"],
    dot: "bg-success",
    chip: "border-success/30 bg-success/10 text-foreground",
  },
  lead: {
    label: m["calls.outcome.lead"],
    dot: "bg-primary",
    chip: "border-primary/30 bg-primary/5 text-foreground",
  },
  message: {
    label: m["calls.outcome.message"],
    dot: "bg-accent",
    chip: "border-accent/30 bg-accent/5 text-foreground",
  },
  abandoned: {
    label: m["calls.outcome.abandoned"],
    dot: "bg-muted-foreground/60",
    chip: "border-border bg-transparent text-muted-foreground",
  },
  spam: {
    label: m["calls.outcome.spam"],
    dot: "bg-destructive",
    chip: "border-destructive/25 bg-transparent text-muted-foreground",
  },
};

const CARD = "overflow-hidden rounded-lg border border-border bg-card";
const CARD_HEAD =
  "border-b border-border px-5 py-3 text-xs font-medium tracking-wider text-muted-foreground uppercase";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ accountId: string; callId: string }>;
}) {
  const { accountId, callId } = await params;
  // BOTH audiences, exactly as the list is: this is the client's own business
  // data — what their receptionist said to their caller — not agency work
  // about the client.
  await requireAccountAccess(accountId);
  const db = await dbForRequest();

  const [call, account] = await Promise.all([
    getCall(db, accountId, callId),
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`call detail: account lookup failed: ${error.message}`);
        if (!data) throw new Error("call detail: account not found");
        return data as { timezone: string };
      }),
  ]);

  // `getCall` filters on account_id as well as id, so a call belonging to
  // another tenant comes back null and lands here — a 404, not a 403, which
  // is the same answer an id that never existed gets.
  if (!call) notFound();

  const timezone = safeZone(account.timezone, "UTC");
  const base = `/dashboard/accounts/${accountId}`;
  const outcome = OUTCOMES[call.outcome];
  const blocks = splitSummaryBlocks(call.summary ?? "");

  // Every link is conditional on its own id. A call that matched no contact,
  // opened no conversation and booked nothing renders no rail at all rather
  // than a panel of disabled-looking dead ends — and the main column takes
  // the full width back.
  const links = [
    call.contact_id
      ? {
          key: "contact",
          href: `${base}/contacts/${call.contact_id}`,
          label: m["calls.detail.viewContact"],
          Icon: UserRound,
        }
      : null,
    // The conversations LIST, not a per-thread route — there is none. Linking
    // to `/conversations/<id>` would 404 on a page whose job is to be
    // trustworthy.
    call.conversation_id
      ? {
          key: "conversation",
          href: `${base}/conversations`,
          label: m["calls.detail.viewConversation"],
          Icon: MessagesSquare,
        }
      : null,
    // Likewise the calendar rather than a booking route.
    call.booking_id
      ? {
          key: "booking",
          href: `${base}/calendar`,
          label: m["calls.detail.viewBooking"],
          Icon: CalendarCheck,
        }
      : null,
  ].filter((link) => link !== null);

  return (
    <>
      <PageHeader
        title={m["calls.detail.title"]}
        tabs={
          <Badge variant="outline" className={cn("gap-1.5 py-1 pr-2.5 pl-2", outcome.chip)}>
            <span className={cn("size-1.5 rounded-full", outcome.dot)} aria-hidden />
            {outcome.label}
          </Badge>
        }
        selector={
          // A description list, not a row of spans: each value here answers a
          // question the list page answers with a column header, and the
          // headers are the only thing telling a screen-reader user that
          // "3:42" is a duration and not a second clock time. They are
          // visually redundant next to their icons, so they are `sr-only`
          // rather than absent.
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
            <div className="flex min-w-0 items-center gap-1.5">
              <dt className="sr-only">{m["calls.col.caller"]}</dt>
              <dd className="truncate font-medium text-foreground">{callerLabel(call)}</dd>
            </div>

            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{m["calls.col.when"]}</dt>
              <Clock className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
              <dd className="tabular-nums">{formatCallTime(call.started_at, timezone)}</dd>
            </div>

            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{m["calls.col.duration"]}</dt>
              <Timer className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
              <dd className="tabular-nums">{formatDuration(call.duration_secs)}</dd>
            </div>

            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{m["calls.col.language"]}</dt>
              <dd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-widest uppercase">
                {call.language}
              </dd>
            </div>
          </dl>
        }
        actions={
          <Link
            href={`${base}/calls`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {m["calls.title"]}
          </Link>
        }
      />

      <div
        className={cn(
          "grid items-start gap-4 p-6",
          links.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_260px]" : null,
        )}
      >
        <div className="min-w-0 space-y-4">
          {/* No summary at all renders no section. There is no honest copy for
              an empty one, and a "Summary" heading over nothing reads as a
              summary that said nothing — which is a claim. */}
          {blocks.length > 0 ? (
            <section aria-labelledby="call-summary" className={CARD}>
              <h2 id="call-summary" className={CARD_HEAD}>
                {m["calls.detail.summary"]}
              </h2>
              <div className="space-y-4 p-5">
                {blocks.map((block, i) => (
                  <SummaryBlockView key={i} block={block} />
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="call-transcript" className={CARD}>
            <h2 id="call-transcript" className={CARD_HEAD}>
              {m["calls.detail.transcript"]}
            </h2>
            <div className="p-5">
              <TranscriptView transcript={call.transcript} timezone={timezone} />
            </div>
          </section>
        </div>

        {links.length > 0 ? (
          <aside className={cn(CARD, "p-1.5 lg:sticky lg:top-6")}>
            <ul>
              {links.map(({ key, href, label, Icon }) => (
                <li key={key}>
                  <Link
                    href={href}
                    className="group flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <Icon
                      className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <ChevronRight
                      className="size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </>
  );
}

/**
 * One block of the stored summary, weighted by what it is.
 *
 * The three treatments are the honesty layer made visible. The fact line is
 * set as machine output — mono, inset, boxed — because it is the only part of
 * this page the system can vouch for: it is written from stored state, not
 * from the model. The prose is set as ordinary reading text, because that is
 * what it is: an account, not a record.
 *
 * The MISMATCH block is the one that has to stop a reader. It breaks the
 * card's own padding to run edge to edge, carries a 4px amber rule and an
 * amber wash, and is the only element on the page with a fill that is not a
 * neutral. That treatment is doing the work an icon would normally do, and it
 * gets it INSTEAD of an icon on purpose: the stored text already opens with
 * "⚠ MISMATCH —", and a lucide warning triangle in front of it would render a
 * visible "⚠ ⚠". The text is never rewritten to make room for one — it is the
 * closest thing on file to what the caller was actually told.
 *
 * The amber lives in the rule, the border and the wash, never in the text:
 * `--warning` (#d97706) on its own 10% tint measures well under AA, and this
 * is the one paragraph on the page that must be readable.
 */
function SummaryBlockView({ block }: { block: SummaryBlock }) {
  if (block.kind === "mismatch") {
    return (
      <div className="-mx-5 border-y border-y-warning/25 border-l-4 border-l-warning bg-warning/10 px-5 py-4">
        <p className="text-sm leading-6 font-medium break-words whitespace-pre-wrap text-foreground">
          {block.text}
        </p>
      </div>
    );
  }

  if (block.kind === "facts") {
    return (
      <p className="rounded-md border border-border bg-muted/50 px-4 py-3 font-mono text-[13px] leading-6 break-words whitespace-pre-wrap text-foreground">
        {block.text}
      </p>
    );
  }

  return (
    <p className="text-sm leading-7 break-words whitespace-pre-wrap text-foreground">
      {block.text}
    </p>
  );
}
