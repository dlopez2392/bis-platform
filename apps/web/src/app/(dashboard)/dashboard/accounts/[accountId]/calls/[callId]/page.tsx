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
import {
  getCall, listFailedOutboundSms, listProposalsForCall, listPeopleNames, getContact, getCallCard, getVoiceProfile,
  type FailedOutboundSms, type CallCard, type TradeModuleSetting, type BusinessStatusCode,
} from "@bis/db";
import { SuggestionSection, type SuggestionSectionData } from "@/components/proposals/suggestion-section";
import {
  acceptSuggestionAction, editAcceptSuggestionAction, discardSuggestionAction, undoSuggestionAction,
} from "@/lib/proposals/actions";
import { buildSuggestionView } from "@/lib/proposals/view";
import { readSuggestionStages } from "@/lib/proposals/view-reads";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { makeTr } from "@/lib/record/copy";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { composerStateLine } from "@/lib/consent/composer-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { ZoneNote } from "@/components/zone-note";
import { cn } from "@/lib/utils";
import { loggableError } from "@/lib/loggable-error";
import { m, type MessageKey } from "@/lib/messages";
import { callerLabel, formatCallTime, formatDuration } from "../format";
import { OutcomePill } from "../outcome-pill";
import { TextbackFailedBadge } from "../textback-failed-badge";
import { textbackWindow } from "../textback-window";
import { sendSmsAction } from "../../conversations/actions";
import { splitSummaryBlocks, type SummaryBlock } from "@/lib/voice/summary-blocks";
import { aiSummaryStamp } from "@/lib/record/ai-summary-view";
import { TranscriptView } from "./transcript-view";
import { TextbackResend } from "./textback-resend";
import { CallCardPanel, hasCard } from "./call-card-panel";
// The detail page is six of these stacked and not one of them was glass, so
// the whole route read as flat rectangles on a lit ground. `bg-card` BEFORE
// `glass`, the order `ui/card.tsx` uses: a tenant's `--card` still wins the
// fill and the utility adds only the sheen, the highlight and `--shadow-card`.
// Shared via `./card` rather than duplicated — see that module's own doc
// comment for why a third module, not a mirrored constant, is the right
// shape here.
import { CARD, CARD_HEAD } from "./card";

/** S-47b section 5.7: the call-page line's module names, typed so a typo'd key is a type error. */
const TRADE_MODULE_NAME_KEY: Record<TradeModuleSetting, MessageKey> = {
  insurance_pc: "calls.detail.tradeModule.insurance_pc", events: "calls.detail.tradeModule.events",
};

/** S-47d (plan Task 14): the catalogue key per code the call started under, typed so a typo'd key is a
 *  type error, the same discipline TRADE_MODULE_NAME_KEY above uses. */
const BUSINESS_STATUS_KEY: Record<BusinessStatusCode, MessageKey> = {
  open: "calls.detail.businessStatus.open",
  closed_today: "calls.detail.businessStatus.closed_today",
  running_late_15: "calls.detail.businessStatus.running_late_15",
  running_late_30: "calls.detail.businessStatus.running_late_30",
  running_late_60: "calls.detail.businessStatus.running_late_60",
  running_late_120: "calls.detail.businessStatus.running_late_120",
  storm: "calls.detail.businessStatus.storm",
  closed_day: "calls.detail.businessStatus.closed_day",
};

export const dynamic = "force-dynamic";

export default async function CallDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string; callId: string }>;
  searchParams?: Promise<{ locale?: string }>;
}) {
  const { accountId, callId } = await params;
  const { locale: localeParam } = (await searchParams) ?? {};
  // BOTH audiences, exactly as the list is: this is the client's own business
  // data — what their receptionist said to their caller — not agency work
  // about the client.
  const { isAgency, userId } = await requireAccountAccess(accountId);
  const db = await dbForRequest();

  const [call, account, prefs] = await Promise.all([
    getCall(db, accountId, callId),
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`call detail: account lookup failed: ${error.message}`);
        if (!data) throw new Error("call detail: account not found");
        return data as { timezone: string; language?: Locale | null };
      }),
    // getPersonPrefs() never rejects: a failed read means defaults (its own doc comment).
    getPersonPrefs(),
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

  // Review R3-M8: "Send it now" is closed ON RENDER when this contact cannot
  // be texted — stopped, on hold, a number whose country is unknown, or a
  // state that cannot be read — in the composer's own words (the same two
  // reads, recipient-state.ts and composer-state.ts), so the call page and
  // the contact page can never disagree. Fails closed like the composer.
  let resendClosedLine: string | null = null;
  if (textbackFailure && !textbackFailure.supersededAt && call.contact_id) {
    try {
      const contact = await getContact(db, accountId, call.contact_id);
      // A successful read that finds no contact fails closed the same as a
      // thrown one (review fix round 1, item 2) — the button offers to text
      // an address this page cannot vouch for either way.
      // F-085 (spec §7.3): the ledger is read through the ledger client — the
      // request client of a Technician sees only part of it — and only once
      // the contact read above, on the request client, proved the contact.
      resendClosedLine = contact
        ? composerStateLine(await smsRecipientState(ledgerDb(), accountId, contact), timezone)
        : m["compose.smsStateUnknown"];
    } catch (e) {
      console.error(`call detail ${callId}: recipient read failed, closing the resend: ${String(e)}`);
      resendClosedLine = m["compose.smsStateUnknown"];
    }
  }

  // The call card: who called, why, the number to call back and their own
  // words (lib/voice/call-card.ts writes it after the call). Its own read,
  // swallowed like the two above and for their reason: one panel on a page
  // whose job is the call, so a failed read (or a database the card's
  // migration has not reached) costs the panel, never the call record. A
  // card of three nulls is a call from before cards, or a spam call, and
  // renders nothing (`hasCard`).
  //
  // The persona name is ONLY the author mark's, so its read failing must not
  // cost the card: it falls back to "Sofía" on its own (the presence
  // indicator's rule, D-063: the account's own name, else the default).
  let card: CallCard | null = null;
  let personaName = "Sofía";
  try {
    const [cardRow, profile] = await Promise.all([
      getCallCard(db, accountId, callId),
      getVoiceProfile(db, accountId).catch((e: unknown) => {
        console.error(`call detail ${callId}: persona read failed, marking the card as Sofía: ${String(e)}`);
        return null;
      }),
    ]);
    card = cardRow;
    personaName = profile?.persona_name?.trim() || "Sofía";
  } catch (e) {
    console.error(`call detail ${callId}: call card read failed, rendering no card: ${String(e)}`);
    card = null;
  }

  // The Suggestions section (item 8b-1, spec 4.5): this call's suggestions as cards with their actions.
  // It is the ONE part of this page in the reader's language (requestLocale: the person, then the
  // account, then the operator default); the rest stays English until its own bilingual pass. Every
  // read it needs runs on the request client: the rows, the deals and stage lists behind a stage
  // suggestion (account-scoped, bounded: readSuggestionStages) and the deciders' names. A failure in
  // any of them is the section's error state with Retry (rule 5), never a silently absent section and
  // never the call record. The persona name above is the one read whose failure costs nothing but the
  // name ("Sofía"), so it never puts the section into its error state.
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: account.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));
  let suggestions: SuggestionSectionData;
  try {
    const rows = await listProposalsForCall(db, accountId, callId);
    const deciders = [...new Set(rows.flatMap((r) => (r.decidedBy ? [r.decidedBy] : [])))];
    const [stageCtx, names] = await Promise.all([
      readSuggestionStages(db, accountId, rows),
      listPeopleNames(db, deciders),
    ]);
    const callerName = [call.contact?.first_name, call.contact?.last_name]
      .map((part) => part?.trim() ?? "").filter(Boolean).join(" ") || null;
    const now = new Date();
    const views = rows.map((row) => buildSuggestionView(row, {
      tr, zone: timezone, now, ...stageCtx, callerName, callStartedAt: call.started_at, personaName, names, viewerId: userId,
      // "See it in the transcript" points at the turn below on this very page (item 8b-2, spec 5.5).
      onCallPage: true,
    }));
    // Pending first: the section exists to obtain a decision, and `listProposalsForCall` orders by
    // created_at DESC. `sort` is stable, so the order is otherwise kept.
    views.sort((a, b) => Number(!a.canAct) - Number(!b.canAct));
    suggestions = { ok: true, views, capped: false };
  } catch (e) {
    console.error(`call detail ${callId}: suggestions read failed, rendering the section's error state: ${loggableError(e)}`);
    suggestions = { ok: false };
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
    // trustworthy. S-47e (plan P20): a call that opened a shared number's
    // HOLDING thread names no contact (0098's hold fires before any contact
    // is ever matched) — that thread is never "someone's conversation" in
    // the list sense, so the link opens it directly instead.
    call.conversation_id
      ? call.contact_id
        ? {
            key: "conversation",
            href: `${base}/conversations`,
            label: m["calls.detail.viewConversation"],
            Icon: MessagesSquare,
          }
        : {
            key: "conversation",
            href: `${base}/conversations?c=${call.conversation_id}`,
            label: m["call.holding.openTexts"],
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

            {/* S-47d (plan Task 14): the status the call started under, to EVERYONE who can see the call
                (S19) — unlike the trade-rules and Knowledge items that follow, this is NOT isAgency-gated:
                a client is entitled to know their own business was closed, late or storm-shut when
                {persona} answered. Fix round C7 (design review I8): the visible-label shape the
                trade-rules item below uses — "Status at the start: Closed for a storm" — never a hidden label
                over an uppercase badge, which read as a present-tense fact on a page about a past call. */}
            {call.business_status !== null ? (
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5" lang={tr.locale}>
                <dt className="whitespace-nowrap">{tr.text("calls.detail.businessStatus")}</dt>
                <dd className="font-medium text-foreground" data-business-status="">
                  {tr.text(BUSINESS_STATUS_KEY[call.business_status])}
                </dd>
              </div>
            ) : null}

            {/* S-47b section 5.7: which trade rules this call ran under. AGENCY ONLY (spec section 3; SD3):
                this page is shared with clients, and the module is not theirs to see. Absent when the call
                carries none. In the reader's language, like the Suggestions section. */}
            {isAgency && call.trade_module !== null && call.trade_module_version !== null
              && TRADE_MODULE_NAME_KEY[call.trade_module] ? (
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5" lang={tr.locale}>
                {/* Plan review I4: the <dt> is the visible label ("Trade rules"), the <dd> only the value
                    ("Insurance · v1"), so a screen reader hears the words once and data-trade-rules marks the
                    value alone. Design D-M1: on a narrow screen the value wraps under the label, which never
                    breaks inside itself. */}
                <dt className="whitespace-nowrap">{tr.text("voice.tradeRules.legend")}</dt>
                <dd className="font-medium text-foreground" data-trade-rules="">{tr.text("calls.detail.tradeRules", {
                  module: tr.text(TRADE_MODULE_NAME_KEY[call.trade_module]), version: call.trade_module_version,
                })}</dd>
              </div>
            ) : null}

            {/* S-47c section 5.8: "What Sofía knew" — AGENCY ONLY (this page is shared with clients) and
                only when the call is stamped (knowledgeVersion). Same rule and markup as the trade-rules
                item above, beside it in this <dl>. S-47c follow-up (spec 5.4, C13): `?call=` names THIS
                call, so the knowledge page can read ITS OWN trade module and hide a price sentence she
                was never given on an insurance call. */}
            {isAgency && call.knowledge_version !== null ? (
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5" lang={tr.locale}>
                <dt className="whitespace-nowrap">{tr.text("calls.detail.knowledge")}</dt>
                <dd className="font-medium text-foreground" data-knowledge="">
                  {/* Underlined at rest (design review): in a row of plain values, a link that only shows
                      itself on hover reads as one more value. */}
                  <Link
                    href={`${base}/voice/knowledge/${call.knowledge_version}?${new URLSearchParams({ call: callId })}`}
                    className="underline decoration-[var(--line-strong)] underline-offset-2"
                  >
                    {tr.text("calls.detail.knowledgeLink", { persona: personaName, version: call.knowledge_version })}
                  </Link>
                </dd>
              </div>
            ) : null}
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
          <ZoneNote zone={zone} isAgency={isAgency} />
          {/* First, above everything that follows: the three-second read of
              the call. The failed text-back panel below still sits above the
              summary, as before. */}
          {hasCard(card) ? (
            <CallCardPanel
              who={callerLabel(call)}
              card={card}
              personaName={personaName}
              language={call.language}
            />
          ) : null}
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
                ) : resendClosedLine ? (
                  <p className="text-sm leading-6 text-muted-foreground">{resendClosedLine}</p>
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
                {/* DESIGN.md, Record page: "anything generated carries 'Generated by AI' ... never
                    presented as a fact on its own" — the record page's own rule for its AI summary,
                    applied here to the same shape. The fact line above is `composeSummary`'s own
                    bookkeeping, never the model's, so it earns no mark; a MISMATCH block is the
                    system's own warning about the prose, not the prose itself. Only a PROSE block is
                    the model's writing, so the mark is conditional on one actually being present — a
                    fact-only summary (the model's completion came back empty) has nothing of its to
                    label. Same key and helper the record page's own AI summary uses
                    (lib/record/ai-summary-view.ts): `ended_at` is the instant `finishCall` wrote this
                    very string (the same UPDATE that sets `summary`), never a fabricated time. No
                    Regenerate action: unlike the record page's, which calls its own API route, there is
                    no code path that re-runs a call's summary (owner decision 2026-10-29). */}
                {blocks.some((b) => b.kind === "prose") ? (
                  <span
                    data-ai-summary-label
                    lang={tr.locale}
                    className="block font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase tabular-nums"
                  >
                    {aiSummaryStamp(call.ended_at ?? call.started_at, { zone: timezone, now: new Date(), tr })}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* The heading keeps the #call-proposals id the agency Work page's links land on. Each action
              is bound to this account here (plan fix I-3): a server component cannot hand a client
              component an inline closure. */}
          <SuggestionSection
            tr={tr}
            personaName={personaName}
            data={suggestions}
            headingId="call-proposals"
            accept={acceptSuggestionAction.bind(null, accountId)}
            editAccept={editAcceptSuggestionAction.bind(null, accountId)}
            discard={discardSuggestionAction.bind(null, accountId)}
            undo={undoSuggestionAction.bind(null, accountId)}
          />

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
      <p className="rounded-[var(--radius-ctl)] border border-[var(--input-line)] bg-[var(--surface-2)] px-4 py-3 font-mono text-[13px] leading-6 break-words whitespace-pre-wrap text-foreground">
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
