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
import { originFrom } from "@/lib/email/origin";
import {
  clientIp, hashIp, verifyRenderToken, parseAttribution, MIN_FILL_MS,
  HONEYPOT_FIELD, RENDER_TOKEN_FIELD, isValidEmail, isValidPhone,
} from "@/lib/forms/guards";
import {
  CONCIERGE_MAX_TURNS, CONCIERGE_MAX_CONVERSATIONS_PER_IP,
  CONCIERGE_IP_WINDOW_MS, CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY,
  CONCIERGE_ACCOUNT_WINDOW_MS, CONCIERGE_MAX_MESSAGE_CHARS,
  CONCIERGE_MAX_REPLY_TOKENS,
} from "@/lib/concierge/guards";
import {
  CAPTURE_LEAD_TOOL, parseCaptureLead, budgetNotice, splitName,
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

/**
 * Every refusal that is not a hard error answers with the SAME shape a good
 * turn does, so the widget is never an oracle telling a spammer which guard
 * they tripped — `closing` rides on every response, defaulted to "", so the
 * key set never differs between a good turn and a refused one.
 *
 * `closing` carries the ONE sentence an ended conversation gets (Important B,
 * second-round review of 108b822). `reply` stays "" on every ended path —
 * turn cap, start-guard refusal, and expired token alike — so the page never
 * pushes a chat bubble on top of the fixed closing paragraph; before this,
 * two of those three paths sent the sentence back as `reply` too, and a
 * visitor read it twice (or, on the expired path, read two DIFFERENT and
 * contradictory sentences — a bubble promising review of a chat and a
 * paragraph promising a follow-up that was never captured).
 */
function quiet(conversationId: string, reply: string, ended = false, closing = "") {
  return NextResponse.json({ conversationId, reply, ended, closing });
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

    // The business name, timezone and OpenAI key, resolved together and
    // ALWAYS before anything that spends a visitor's budget or inflates a
    // counter. Minor (review of commit 129b43f): on turn 1 this used to run
    // AFTER `createConciergeConversation`, so a misconfigured deployment (a
    // flaky account read, or no OPENAI_API_KEY) burned a visitor's 3-per-10-
    // minute IP budget and inflated the per-account daily counter on a turn
    // that never reached the model. Called from both branches below, at the
    // position that is actually before their own row write — turn 2+ already
    // had this right (`claimConciergeTurn` is the thing that spends there,
    // and it already ran after this).
    // `accountId` is taken as a PARAMETER rather than closing over `profile`:
    // TypeScript's narrowing of `if (!profile) return 404` above does not
    // reach a nested function body, so a closure over `profile` re-widens to
    // `VoiceProfileRow | null` here.
    async function resolveAccountContext(accountId: string): Promise<
      | { ok: true; businessName: string; timezone: string; apiKey: string }
      | { ok: false; response: Response }
    > {
      // The name the visitor is told, and the zone "are you open now" is
      // answered in. The BRAND columns, never `accounts.name`, which is the
      // agency's internal label for the company ("Rio Roofing — trial") and
      // has reached customers three times. Same resolver as the phone path
      // and the web demo, so one company cannot be two names depending on
      // which door someone came through.
      const { data: account, error: accountError } = await db
        .from("accounts").select("timezone, brand_name")
        .eq("id", accountId).single();
      if (accountError || !account) {
        log("refused: account lookup failed", {
          accountId, error: accountError?.message,
        });
        return { ok: false, response: NextResponse.json({ error: "unavailable" }, { status: 503 }) };
      }
      const acct = account as unknown as { timezone: string; brand_name: string | null };
      // Only `brandName` is read (`brandDisplayName` reads nothing else), so
      // only the two columns above are selected — which is also what makes
      // the "never the internal label" assertion in the tests meaningful.
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
        return { ok: false, response: NextResponse.json({ error: "unavailable" }, { status: 503 }) };
      }
      return { ok: true, businessName, timezone: acct.timezone, apiKey };
    }

    let conversationId: string;
    let conversation: ConciergeConversationRow;
    let businessName: string;
    let timezone: string;
    let apiKey: string;

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
        // A token past MAX_TOKEN_AGE_MS is not a spammer — it is a visitor
        // who opened the page and came back later than the window allows.
        // `strings.ended` describes a chat that RAN and reached a limit;
        // this one never opened, and "refresh" is the only real recovery.
        // Naming this one case costs the anti-oracle nothing: a spammer can
        // only mint an EARLIER token, never trigger `expired` on purpose.
        if (!honeypot && !verdict.ok && verdict.reason === "expired") {
          return quiet("", "", true, strings.expired);
        }
        // `ended`, not an error: the composer closes and the copy is a close.
        return quiet("", "", true, strings.ended);
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

      // MOVED here, above `createConciergeConversation` — see the comment on
      // `resolveAccountContext` above.
      const ctx1 = await resolveAccountContext(profile.account_id);
      if (!ctx1.ok) return ctx1.response;
      businessName = ctx1.businessName; timezone = ctx1.timezone; apiKey = ctx1.apiKey;

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

      // Unchanged position: already ran before `claimConciergeTurn`, the
      // thing that spends on this branch.
      const ctx2 = await resolveAccountContext(profile.account_id);
      if (!ctx2.ok) return ctx2.response;
      businessName = ctx2.businessName; timezone = ctx2.timezone; apiKey = ctx2.apiKey;
    }

    // THE TURN CAP. Atomic, so two turns posted together cannot both pass.
    // Null means EITHER the cap is reached OR no such conversation exists —
    // deliberately indistinguishable (`packages/db/src/concierge.ts`), which
    // is why the copy works for both.
    const claimed = await claimConciergeTurn(db, conversationId, CONCIERGE_MAX_TURNS);
    if (claimed === null) {
      log("ended: turn cap", { conversationId });
      // `reply` stays EMPTY (Minor, review of commit 129b43f) and the close
      // now rides in `closing` (Important B, second-round review of
      // 108b822), the same contract every ended path uses — the page reads
      // it once, for exactly one rendered sentence.
      return quiet(conversationId, "", true, strings.ended);
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
      timezone, slotDurationMinutes: 30,
      afterHours: profile.after_hours, callerNumber: null,
      // Inert while `bookingEnabled` is false — `meetingType` and
      // `slotDurationMinutes` are read only inside that branch of
      // `buildSystemPrompt`. Named rather than resolved through
      // `getOrCreateCalendar`, which would INSERT a calendar row on an
      // anonymous request to answer a question the prompt never asks.
      meetingType: "in_person",
      medium: "web",
      // `buildSystemPrompt` itself resolves the one tool this surface has,
      // and never advertises take_message/log_transcript on the web — see
      // its `onWeb` branches. No append needed here (review of commit
      // 129b43f, Important 2: the old `WEB_TOOL_NOTICE` append recreated the
      // exact contradiction it existed to forbid, because it ran AFTER a
      // base prompt that still told the model to take a message).
    }, new Date())
      // `remaining` counts the reply being WRITTEN (Important 3): `claimed`
      // is the POST-increment count, 1…CONCIERGE_MAX_TURNS, so on the final
      // permitted turn `claimed === CONCIERGE_MAX_TURNS` and this reply IS
      // the last one — `+ 1` is what makes `remaining` include it rather
      // than only the replies after it. Without it, `budgetNotice` reads
      // "1 more reply" on the very reply that is the last one, telling the
      // model the close comes next turn on the turn it must close now.
      //
      // The ask for a name and a number has to happen while the visitor can
      // still type: the composer disables itself the moment this route
      // answers `ended: true`.
      + budgetNotice(CONCIERGE_MAX_TURNS - claimed + 1);

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
        body: JSON.stringify({
          model: MODEL, messages, tools: [CAPTURE_LEAD_TOOL],
          // I2 (whole-branch review): with no bound here, gpt-4o-mini can
          // emit up to 16,384 output tokens, and every reply is replayed
          // into every LATER turn's transcript — unbounded, a single
          // runaway completion multiplies across the rest of the
          // conversation's calls. `concierge/guards.ts` states the
          // arithmetic; `proposals/generate.ts` already answered this same
          // question for its own OpenAI call.
          max_tokens: CONCIERGE_MAX_REPLY_TOKENS,
        }),
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

    // Lead capture, at most once per conversation, and BEFORE `spoken` is
    // decided (Important 1, review of commit 129b43f). The old code decided
    // `spoken` from `toolArgs` alone, before this ran — so a model that
    // called capture_lead with no name, or whose lead reached an unpublished
    // form, a lost race, or a throw inside `fileLead`, still produced
    // "Thanks. I have passed your details to the team…", and THAT sentence
    // was stored as Sofía's own words in the transcript below. `filed`
    // starts from the row's own `submission_id`: a lead already on file from
    // an earlier turn is genuinely captured, even on a turn that does not
    // call the tool again.
    let filed = !!conversation.submission_id;
    if (toolArgs && !conversation.submission_id) {
      const lead = parseCaptureLead(toolArgs);
      if (lead) {
        filed = await fileLead({
          db, accountId: profile.account_id,
          // conversation.form_id, NOT profile.concierge_form_id (I1,
          // whole-branch review). The conversation's own column is captured
          // at conversation START — migration 0042's comment on it: "an
          // operator changing the destination form mid-conversation must not
          // strand a lead halfway." profile.concierge_form_id can also go
          // NULL (FK `set null`) without 404ing an in-flight chat; the
          // conversation's column is `restrict` and always resolves.
          formId: conversation.form_id,
          conversationId, attribution: conversation.attribution, locale, ipHash,
          // originFrom(req.headers), NOT the raw `origin` above (I3,
          // whole-branch review): the raw header is what
          // `concierge_conversations.origin` stores, but it is spoofable
          // and, from inside a sandboxed iframe, is the literal string
          // "null" — which flowed straight into `enrich`'s dashboard link
          // in the lead-alert email as "null/dashboard/accounts/…".
          // `lib/email/origin.ts` checks APP_ORIGIN FIRST for exactly this
          // reason, and the other two `enrich` callers
          // (api/intake/[publicId]/route.ts, f/[publicId]/actions.ts)
          // already use this helper.
          origin: originFrom(req.headers), lead,
        });
      } else {
        log("capture_lead ignored: unusable arguments", { conversationId });
      }
    }

    // A turn that calls a tool routinely comes back with `content: null`, so
    // the fallback depends on whether a lead was actually filed — `captured`
    // only when `fileLead` (or an earlier turn) really did; a line that
    // promises nothing otherwise, never a claim about the details this
    // visitor just handed over.
    //
    // `toolArgs` is required too (Minor 1, second-round review of 108b822):
    // `filed` alone can be true from a PRIOR turn's submission, so an empty
    // reply with NO tool call THIS turn (the model simply failed to answer)
    // must not read as a fresh "we've got your details" about a question it
    // never addressed.
    const spoken = reply || ((toolArgs && filed) ? strings.captured : strings.unavailable);
    // I2, second half: `max_tokens` above bounds the completion's TOKEN
    // count, not its character count — 500 tokens of English can still print
    // past CONCIERGE_MAX_MESSAGE_CHARS. The visitor's own message is already
    // bounded to that same limit (line ~105); the stored side of the
    // transcript gets the identical bound here, or a long completion still
    // bloats every later turn's replayed payload. `spoken` itself (and the
    // response below) stays the full text — only what gets WRITTEN DOWN is
    // sliced.
    const storedSpoken = spoken.slice(0, CONCIERGE_MAX_MESSAGE_CHARS);

    const now = new Date().toISOString();
    try {
      // What the visitor read is what the transcript stores — recorded
      // AFTER `spoken` is decided, so a lie about what was filed can never
      // be written down as Sofía's own words.
      await appendConciergeTurns(db, conversationId, [
        { role: "visitor", text, at: now },
        { role: "assistant", text: storedSpoken, at: now },
      ]);
    } catch (e) {
      // The answer is already paid for and already useful. Losing it because
      // the record of it could not be written would be the worse trade.
      log("transcript append failed", { conversationId, error: String(e) });
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
 *
 * Returns whether a submission was actually created and enriched — the
 * route's own `spoken` line depends on this (Important 1, review of commit
 * 129b43f): it must never thank a visitor for details that were not stored.
 */
async function fileLead(ctx: {
  db: Db; accountId: string; formId: string; conversationId: string;
  attribution: Record<string, string>; locale: "en" | "es"; ipHash: string;
  origin: string | null; lead: Lead;
}): Promise<boolean> {
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
      return false;
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
      return false;
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
      return false;
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
    return true;
  } catch (e) {
    // A failed lead must not cost the visitor their answer — they are
    // mid-conversation and the transcript is already stored.
    log("lead capture failed", { conversationId: ctx.conversationId, error: String(e) });
    return false;
  }
}
