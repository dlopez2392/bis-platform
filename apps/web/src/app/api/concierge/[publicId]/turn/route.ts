// One turn of a website conversation.
//
// This endpoint holds what the browser must not: the transcript and the turn
// counter. A design where the client posts both hands the cap to whoever
// wants to ignore it.
//
// ORDER IS THE POINT. Every cost check runs before the fetch to
// api.openai.com, and a throwing counter REFUSES rather than continuing —
// the same asymmetry `api/voice/web/session` documents: a guard failing open
// here costs an unbounded number of model calls, not one.
//
// This bounds how many turns and how many conversations. It claims nothing
// about duration, because text has none to claim.
//
// THREE PROPERTIES THIS ROUTE DOES NOT HAVE, stated so the next reader does
// not assume them:
//
//   1. The transcript is atomic but NOT ORDERED. `concierge_append_turns`
//      guarantees no exchange is lost, not that exchanges land in the order
//      they were sent: a caller reads the transcript, spends seconds in
//      `fetch`, then appends, so two turns in flight store their pairs in
//      completion order — [v2,a2,v1,a1] is reachable, and the model answers
//      turn 2 from a transcript that does not contain turn 1. One visitor
//      typing in one panel cannot do this to themselves (the composer is
//      disabled while a turn is pending); two tabs on one conversation id
//      can.
//   2. `turn_count` is NOT the transcript's length. A claimed turn whose
//      model call throws increments the counter and appends nothing, so the
//      counter legitimately runs ahead. It is a spend counter, not an index.
//   3. A retried POST after a successful append files the same exchange
//      TWICE — there is no idempotency stamp, and the claim is already
//      consumed. v1 accepts that: the failure mode is a duplicated pair in a
//      transcript, not a duplicated lead (the submission slot is claimed
//      once, in the database).
import { NextResponse } from "next/server";
// Type-only: erased at compile time, so it does not put `@bis/db` back at
// module scope (see the lazy imports in the handler below).
import type { serviceDb as serviceDbType, Branding, ConciergeConversationRow } from "@bis/db";
import { buildSystemPrompt } from "@/lib/voice/system-prompt";
import {
  clientIp, hashIp, verifyRenderToken, parseAttribution, MIN_FILL_MS,
  HONEYPOT_FIELD, RENDER_TOKEN_FIELD, isValidEmail, isValidPhone,
} from "@/lib/forms/guards";
import {
  CONCIERGE_MAX_TURNS, CONCIERGE_MAX_CONVERSATIONS_PER_IP,
  CONCIERGE_IP_WINDOW_MS, CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY,
  CONCIERGE_ACCOUNT_WINDOW_MS, CONCIERGE_MAX_MESSAGE_CHARS,
} from "@/lib/concierge/guards";
import {
  CAPTURE_LEAD_TOOL, parseCaptureLead, budgetNotice, splitName, WEB_TOOL_NOTICE,
} from "@/lib/concierge/prompt";
import { conciergeStrings } from "@/lib/concierge/strings";

export const runtime = "nodejs";
/** One model call with a 20s ceiling, plus the reads around it. Nothing here
 *  waits on a person, unlike the phone path's whole-call socket. */
export const maxDuration = 30;

/** Same model the rest of this repo's text work uses (`summary-service.ts`,
 *  `proposals/generate.ts`) — a receptionist answering questions from a
 *  facts block is not a reasoning workload. */
const MODEL = "gpt-4o-mini";
const MODEL_TIMEOUT_MS = 20_000;

type Db = ReturnType<typeof serviceDbType>;
type Lead = { fullName: string; email: string; phone: string; need: string };

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: "concierge/turn", msg, ...extra }));
}

/** Every refusal that is not a hard error answers with the SAME shape a good
 *  turn does, so the widget is never an oracle telling a spammer which guard
 *  they tripped. */
function quiet(conversationId: string, reply: string, ended = false) {
  return NextResponse.json({ conversationId, reply, ended });
}

export async function POST(
  req: Request, { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  const { publicId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Truncated, never rejected: a visitor who pasted a long question should
  // get an answer, not an error (`concierge/guards.ts`).
  const text = typeof body.text === "string"
    ? body.text.trim().slice(0, CONCIERGE_MAX_MESSAGE_CHARS) : "";
  const locale = body.locale === "es" ? "es" as const : "en" as const;
  const strings = conciergeStrings(locale);
  if (!text) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  // Lazy, and BOTH of them: a module-scope `@bis/db` import breaks
  // `next build` during page-data collection, and `lib/forms/enrich` pulls
  // the same package in at ITS module scope, so importing it up here would
  // undo the first import's whole point. The refusals above this line — and
  // every cap refusal below — therefore load neither.
  const {
    serviceDb, getVoiceProfileByPublicId, createConciergeConversation,
    getConciergeConversation, claimConciergeTurn, appendConciergeTurns,
    countConciergeConversationsByIp, countConciergeConversationsForAccount,
    brandDisplayName,
  } = await import("@bis/db");

  const ipHash = hashIp(clientIp(req.headers));
  const origin = req.headers.get("origin");
  const priorId = typeof body.conversationId === "string" && body.conversationId
    ? body.conversationId : null;

  try {
    const db = serviceDb() as Db;
    const profile = await getVoiceProfileByPublicId(db, publicId);
    // Unknown id, concierge off, or no destination form — all one answer. The
    // accessor makes those three indistinguishable on purpose.
    if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let conversationId: string;
    let conversation: ConciergeConversationRow;

    if (!priorId) {
      // ── TURN 1 ──────────────────────────────────────────────────────────
      // The render token, the honeypot and the fill-time floor gate the START
      // of a conversation and nothing after it. MAX_TOKEN_AGE_MS is 30
      // minutes; re-checking on every turn would kill a panel left open past
      // that, mid-sentence, for a reason no visitor could understand.
      const token = typeof body[RENDER_TOKEN_FIELD] === "string"
        ? body[RENDER_TOKEN_FIELD] as string : "";
      // The token is bound to THIS widget's public id, so one tenant's page
      // cannot mint a token that starts a conversation on another's.
      const verdict = verifyRenderToken(token, Date.now(), publicId);
      const honeypot = typeof body[HONEYPOT_FIELD] === "string"
        ? body[HONEYPOT_FIELD] as string : "";
      if (honeypot || !verdict.ok || verdict.elapsedMs < MIN_FILL_MS) {
        log("refused: start guard", {
          publicId, honeypot: !!honeypot,
          token: verdict.ok ? "ok" : verdict.reason,
        });
        // `ended`, not an error: the composer closes and the copy is a close.
        return quiet("", strings.ended, true);
      }

      // EVERY COST CHECK HAPPENS HERE, BEFORE THE MODEL CALL. A refused
      // request must cost nothing.
      //
      // FAIL CLOSED, unlike the phone path's silence guard, which disarms
      // itself when its own predicate throws. The asymmetry is the point:
      // that guard failing open costs one extra call, this one failing open
      // costs an unbounded number of them.
      try {
        const [byIp, byAccount] = await Promise.all([
          countConciergeConversationsByIp(
            db, ipHash, new Date(Date.now() - CONCIERGE_IP_WINDOW_MS).toISOString()),
          countConciergeConversationsForAccount(
            db, profile.account_id,
            new Date(Date.now() - CONCIERGE_ACCOUNT_WINDOW_MS).toISOString()),
        ]);
        if (byIp >= CONCIERGE_MAX_CONVERSATIONS_PER_IP) {
          log("refused: ip cap", { byIp });
          return NextResponse.json({ error: "rate_limited" }, { status: 429 });
        }
        if (byAccount >= CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY) {
          log("refused: account cap", { accountId: profile.account_id, byAccount });
          return NextResponse.json({ error: "rate_limited" }, { status: 429 });
        }
      } catch (e) {
        log("refused: counter failed", { error: String(e) });
        return NextResponse.json({ error: "unavailable" }, { status: 503 });
      }

      // Re-parsed here rather than trusted: the page sends `parseAttribution`
      // output, but this is a public POST and anything can send anything.
      // `parseAttribution` drops unknown keys and caps each value.
      const attribution = parseAttribution(new URLSearchParams(
        Object.entries((body.attribution ?? {}) as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string") as [string, string][],
      ));

      const created = await createConciergeConversation(db, {
        accountId: profile.account_id, formId: profile.concierge_form_id,
        ipHash, locale, attribution, origin,
      });
      conversationId = created.id;
      // Built here rather than read back: the row was just inserted, so its
      // contents are known, and a second round trip would only add a way for
      // this to fail.
      conversation = {
        id: created.id, account_id: profile.account_id,
        form_id: profile.concierge_form_id, ip_hash: ipHash,
        turn_count: 0, transcript: [], submission_id: null,
        locale, attribution, origin,
      };
    } else {
      // ── TURN 2+ ─────────────────────────────────────────────────────────
      conversationId = priorId;
      const existing = await getConciergeConversation(db, conversationId);
      // The conversation row is the authorisation now, and it must belong to
      // the tenant this address resolves to — otherwise a leaked id could be
      // driven through another client's widget, spending their budget and
      // filing into their CRM.
      if (!existing || existing.account_id !== profile.account_id) {
        log("refused: conversation not this tenant's", { publicId, conversationId });
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      conversation = existing;
    }

    // The name the visitor is told, and the zone "are you open now" is
    // answered in. The BRAND columns, never `accounts.name`, which is the
    // agency's internal label for the company ("Rio Roofing — trial") and has
    // reached customers three times. Same resolver as the phone path and the
    // web demo, so one company cannot be two names depending on which door
    // someone came through.
    const { data: account, error: accountError } = await db
      .from("accounts").select("timezone, brand_name")
      .eq("id", profile.account_id).single();
    if (accountError || !account) {
      log("refused: account lookup failed", {
        accountId: profile.account_id, error: accountError?.message,
      });
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    const acct = account as unknown as { timezone: string; brand_name: string | null };
    // Only `brandName` is read (`brandDisplayName` reads nothing else), so
    // only the two columns above are selected — which is also what makes the
    // "never the internal label" assertion in the tests meaningful.
    const businessName = brandDisplayName({
      brandName: acct.brand_name, brandLogoPath: null, brandColor: null,
      brandNeutral: null, brandCorners: null, brandType: null,
      brandMode: null, replyToEmail: null,
    } as Branding);

    // The key is checked BEFORE the claim: a turn claimed against an
    // unconfigured deployment would spend a visitor's budget on nothing.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      log("refused: no OPENAI_API_KEY");
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }

    // THE TURN CAP. Atomic, so two turns posted together cannot both pass.
    // Null means EITHER the cap is reached OR no such conversation exists —
    // deliberately indistinguishable (`packages/db/src/concierge.ts`), which
    // is why the copy works for both.
    const claimed = await claimConciergeTurn(db, conversationId, CONCIERGE_MAX_TURNS);
    if (claimed === null) {
      log("ended: turn cap", { conversationId });
      return quiet(conversationId, strings.ended, true);
    }

    const system = buildSystemPrompt({
      personaName: profile.persona_name, businessName,
      greeting: locale === "es" ? profile.greeting_es : profile.greeting_en,
      facts: profile.facts, services: profile.services,
      languages: profile.languages,
      // FALSE regardless of the tenant's own setting, exactly as the web demo
      // forces it: no booking tool reaches this session, and a prompt that
      // promised booking would promise something that cannot happen here.
      bookingEnabled: false,
      timezone: acct.timezone, slotDurationMinutes: 30,
      afterHours: profile.after_hours, callerNumber: null,
      // Inert while `bookingEnabled` is false — `meetingType` and
      // `slotDurationMinutes` are read only inside that branch of
      // `buildSystemPrompt`. Named rather than resolved through
      // `getOrCreateCalendar`, which would INSERT a calendar row on an
      // anonymous request to answer a question the prompt never asks.
      meetingType: "in_person",
      medium: "web",
    }, new Date())
      // The one tool this surface actually has. `buildSystemPrompt` names two
      // more (take_message, log_transcript) that only the phone session is
      // given, and a model that believes it has them will say it used them.
      + WEB_TOOL_NOTICE
      // The ask for a name and a number has to happen while the visitor can
      // still type: the composer disables itself the moment this route
      // answers `ended: true`.
      + budgetNotice(CONCIERGE_MAX_TURNS - claimed);

    const messages = [
      { role: "system", content: system },
      ...conversation.transcript.map((t) => ({
        role: t.role === "visitor" ? "user" : "assistant", content: t.text,
      })),
      { role: "user", content: text },
    ];

    let reply = "";
    let toolArgs: string | null = null;
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages, tools: [CAPTURE_LEAD_TOOL] }),
        // A hung connection never rejects and never resolves; without this the
        // invocation stalls until Vercel kills it and the visitor sees
        // nothing. Same defence `summary-service.ts` already runs in
        // production.
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`openai ${r.status}`);
      const data = await r.json() as {
        choices?: { message?: {
          content?: string | null;
          tool_calls?: { function?: { name?: string; arguments?: string } }[];
        } }[];
      };
      const message = data?.choices?.[0]?.message;
      reply = message?.content ?? "";
      const call = message?.tool_calls?.find((c) => c.function?.name === "capture_lead");
      toolArgs = call?.function?.arguments ?? null;
    } catch (e) {
      log("model call failed", { error: String(e) });
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }

    // A turn that calls a tool routinely comes back with `content: null`, so
    // the fallback depends on WHICH kind of empty this is — "something went
    // wrong" is the last thing to show someone who just handed over their
    // details.
    const spoken = reply || (toolArgs ? strings.captured : strings.unavailable);

    const now = new Date().toISOString();
    try {
      // What the visitor read is what the transcript stores.
      await appendConciergeTurns(db, conversationId, [
        { role: "visitor", text, at: now },
        { role: "assistant", text: spoken, at: now },
      ]);
    } catch (e) {
      // The answer is already paid for and already useful. Losing it because
      // the record of it could not be written would be the worse trade.
      log("transcript append failed", { conversationId, error: String(e) });
    }

    // Lead capture, at most once per conversation. The row's own
    // `submission_id` settles the sequential case cheaply; the boolean from
    // `setConciergeSubmission` settles the concurrent one.
    if (toolArgs && !conversation.submission_id) {
      const lead = parseCaptureLead(toolArgs);
      if (lead) {
        await fileLead({
          db, accountId: profile.account_id, formId: profile.concierge_form_id,
          conversationId, attribution: conversation.attribution, locale, ipHash,
          origin, lead,
        });
      } else {
        log("capture_lead ignored: unusable arguments", { conversationId });
      }
    }

    return quiet(conversationId, spoken, false);
  } catch (e) {
    // Anything the reads above threw. A refusal, so it costs nothing — and
    // never an unhandled 500 with a stack in it.
    log("refused: turn failed", { publicId, error: String(e) });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

/**
 * The lead, onto the tenant's own destination form, through the same
 * `enrich` the public form and the machine intake both run.
 *
 * ORDER, and why it is this way: `setConciergeSubmission` takes a submission
 * id, so the row has to exist before the slot can be claimed — which means
 * the LOSER of a race has already written a `form_submissions` row when it
 * learns it lost. That row is deleted here rather than left behind: a
 * lead-shaped row with no contact, no thread and no alert is a row nobody
 * will ever act on, and it would inflate the form's submission count on the
 * Forms screen. `enrich` runs only on the winner, so one visitor can never
 * become two contacts, two threads and two alerts.
 */
async function fileLead(ctx: {
  db: Db; accountId: string; formId: string; conversationId: string;
  attribution: Record<string, string>; locale: "en" | "es"; ipHash: string;
  origin: string | null; lead: Lead;
}): Promise<void> {
  const { db, lead } = ctx;
  try {
    // Lazy for the same reason as the handler's own import, and cached — the
    // module is already resolved by the time a lead is filed.
    const { getForm, createSubmission, setConciergeSubmission } = await import("@bis/db");
    const { enrich } = await import("@/lib/forms/enrich");

    // getForm(db, accountId, formId) — the account id IS a tenant boundary
    // (packages/db/src/forms.ts:97), so a form id that has drifted onto
    // another account's profile reads as "no such form" rather than as a
    // lead filed into somebody else's CRM.
    const form = await getForm(db, ctx.accountId, ctx.formId);
    if (!form || form.status !== "published") {
      log("lead not filed: form unavailable", { formId: ctx.formId, status: form?.status });
      return;
    }

    // Mapped by KIND, not by position: kinds this form does not carry are
    // dropped, exactly as `enrich`'s own byKind map expects. Required flags
    // are NOT enforced — a conversation that produced a name and a way to
    // reach someone is a lead, and refusing it because a fifth field is blank
    // throws away the thing this widget exists to catch.
    const { first, last } = splitName(lead.fullName);
    const hasSurnameField = form.fields.some((f) => f.kind === "core.last_name");
    const value = (kind: string) =>
      kind === "core.first_name" ? (hasSurnameField ? first : lead.fullName)
      : kind === "core.last_name" ? last
      // Validated before it is stored: the model was told not to invent
      // values, but "was told" is not a guarantee, and this value reaches the
      // contact dedupe lookup.
      : kind === "core.email" ? (isValidEmail(lead.email) ? lead.email : "")
      : kind === "core.phone" ? (isValidPhone(lead.phone) ? lead.phone : "")
      : kind === "message" ? lead.need : "";
    const answers = form.fields
      .map((f) => ({ key: f.key, label: f.label, value: value(f.kind) }))
      .filter((a) => a.value !== "");
    if (!answers.length) {
      log("lead not filed: nothing the form can carry", { formId: form.id });
      return;
    }

    // SubmissionInput's optional fields are `?: string`, NOT `| null`
    // (packages/db/src/forms.ts:147-155) — omit what you do not have rather
    // than passing null, which does not typecheck.
    const submission = await createSubmission(db, form.account_id, form.id, {
      answers, attribution: ctx.attribution, consent: [],
      locale: ctx.locale, ipHash: ctx.ipHash,
    });

    const claimedSlot = await setConciergeSubmission(db, ctx.conversationId, submission.id);
    if (!claimedSlot) {
      // A concurrent turn filed this conversation's lead first. See the
      // ORDER note above: clean up rather than leave an orphan.
      const { error } = await db.from("form_submissions")
        .delete().eq("id", submission.id).eq("account_id", form.account_id);
      log("lead not filed: already claimed", {
        conversationId: ctx.conversationId, cleanup: error?.message ?? "ok",
      });
      return;
    }

    await enrich(
      db, form, submission.id, answers, ctx.attribution, ctx.origin, ctx.locale,
      // TRUE, ALWAYS, and NOT derived from whether this form happens to carry
      // a consent field. A conversation cannot tick a box under its exact
      // wording — the machine intake records every consent field as
      // `given: false` for exactly this reason — and a form WITHOUT one would
      // otherwise let a widget lead trigger an automatic text nobody agreed
      // to. The operator replies by hand from Conversations; that is the
      // design, not a gap.
      true,
    );
    log("lead filed", { conversationId: ctx.conversationId, submissionId: submission.id });
  } catch (e) {
    // A failed lead must not cost the visitor their answer — they are
    // mid-conversation and the transcript is already stored.
    log("lead capture failed", { conversationId: ctx.conversationId, error: String(e) });
  }
}
