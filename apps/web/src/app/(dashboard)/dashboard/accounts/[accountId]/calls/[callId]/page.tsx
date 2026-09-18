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
import { getCall, listFailedOutboundSms, type FailedOutboundSms } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { ZoneNote } from "@/components/zone-note";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { callerLabel, formatCallTime, formatDuration } from "../format";
import { OutcomePill } from "../outcome-pill";
import { TextbackFailedBadge } from "../textback-failed-badge";
import { textbackWindow } from "../textback-window";
import { sendSmsAction } from "../../conversations/actions";
import { splitSummaryBlocks, type SummaryBlock } from "./summary-blocks";
import { TranscriptView } from "./transcript-view";
import { TextbackResend } from "./textback-resend";

export const dynamic = "force-dynamic";

// The detail page is six of these stacked and not one of them was glass, so
// the whole route read as flat rectangles on a lit ground. `bg-card` BEFORE
// `glass`, the order `ui/card.tsx` uses: a tenant's `--card` still wins the
// fill and the utility adds only the sheen, the highlight and `--shadow-card`.
const CARD = "overflow-hidden rounded-xl border border-border bg-card glass";
// DESIGN.md's Label role — Geist Mono 500, 10px, +0.14em — the same role
// `TableHead` now carries. This is a card header on a `<div>`, not a
// `TableHead`, so wave 1's shared fix did not reach it. The rule under it is
// `--row-line` (.06), not `--line` (.08), like every other row rule.
const CARD_HEAD =
  "border-b border-[var(--row-line)] px-5 py-3 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ accountId: string; callId: string }>;
}) {
  const { accountId, callId } = await params;
  // BOTH audiences, exactly as the list is: this is the client's own business
  // data — what their receptionist said to their caller — not agency work
  // about the client.
  const { isAgency } = await requireAccountAccess(accountId);
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

  // Same resolver as the list this page is reached from (lib/zone.ts). It
  // has to be: a client clicks a row showing one date and must not land on a
  // detail page showing another. The clamp this replaces could not make that
  // promise — it was a second, independent copy of the same guess.
  const zone = await renderZone(account.timezone);
  const timezone = zone.zone;
  const base = `/dashboard/accounts/${accountId}`;
  const blocks = splitSummaryBlocks(call.summary ?? "");

  // The missed-call text-back that never went out — THIS call's, bounded by
  // this call's own window rather than looked up across the contact's whole
  // thread (conversations are one-per-contact, so the thread spans every call
  // they ever made). `textbackWindow` returns null for every shape that cannot
  // own a text-back, and those skip the read entirely. Same single read the
  // list page uses, given a list of one.
  //
  // Swallowed like the list page's, and for the same reason: this block is one
  // advisory panel on a page whose job is the transcript. A momentary
  // `messages` failure must not take the call record down with it.
  const window = textbackWindow(call);
  let textbackFailure: FailedOutboundSms | undefined;
  if (window) {
    try {
      [textbackFailure] = await listFailedOutboundSms(db, accountId, [window]);
    } catch (e) {
      console.error(
        `call detail ${callId}: failed-text-back read failed, rendering no badge: ${String(e)}`,
      );
    }
  }

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
        tabs={<OutcomePill outcome={call.outcome} />}
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
          {/* Names the zone the timestamp in the header above is printed in.
              `formatCallTime` already renders its short name ("CDT") beside
              the time; this says which zone that abbreviation belongs to,
              and whether it is this account's own. */}
          <ZoneNote zone={zone} isAgency={isAgency} accountId={accountId} />
          {/* Above the summary, because it is the only thing on this page that
              asks the operator to DO something. Not a `section` with a
              heading: the badge already says what this is, and an <h2>
              carrying the same sentence would have a screen reader read it
              twice in a row. */}
          {textbackFailure ? (
            // Two elements, not one. The destructive tint is a WASH LAYERED
            // OVER the card surface — the same shape the MISMATCH block below
            // uses, and for the same reason: every other card on this page sits
            // on `--surface-1`, and `cn()` merges `bg-destructive/5` on top of
            // `bg-card` by DROPPING it, which tinted `--surface-0` instead and
            // sank this block a step below its own siblings. The border still
            // belongs on the outer element, where the card's own `border` width
            // and `rounded-lg` are.
            <div className={cn(CARD, "border-destructive/30")}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3 bg-destructive/5 p-5">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <TextbackFailedBadge />
                  <p className="text-sm leading-6 text-muted-foreground">
                    {m["calls.textbackFailedBody"]}
                  </p>
                </div>
                {/* The control needs a contact to text — `sendSmsAction` reads
                    the number off the contact record, never off the call. A
                    conversation always has one (ensureConversation is keyed on
                    it), but this page renders what it can prove: no contact id,
                    no button.

                    `supersededAt` is the other half of that. It means something
                    else has since reached this contact — the operator's own
                    earlier resend, most often — and offering the button again
                    would text a real phone the same words twice. The badge and
                    the line above stay either way: this call's text-back failed,
                    and that does not stop being true because a later one
                    worked. That is the whole defect the first wave fixed.

                    But a withdrawn button that says nothing is its own defect.
                    The operator is still reading "nothing will try again on its
                    own", the one affordance has quietly gone, and the obvious
                    next move is to text this person by hand — the exact
                    duplicate the withdrawal exists to prevent. So the slot the
                    button occupied carries the reason instead of going blank. */}
                {textbackFailure.supersededAt ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {m["calls.textbackSuperseded"]}
                  </p>
                ) : call.contact_id ? (
                  <TextbackResend
                    contactId={call.contact_id}
                    body={textbackFailure.body}
                    action={sendSmsAction.bind(null, accountId)}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

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
      // Ladder step 2 (`--surface-2`), the nested-panel step, not an alpha of
      // `--muted`. NO `glass` — this sits inside `CARD`, and a second
      // `--shadow-card` inside the first doubles the ambient.
      <p className="rounded-[8px] border border-[var(--input-line)] bg-[var(--surface-2)] px-4 py-3 font-mono text-[13px] leading-6 break-words whitespace-pre-wrap text-foreground">
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
