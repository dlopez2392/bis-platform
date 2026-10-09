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
import { NextResponse, after } from "next/server";
// Type-only: erased at compile time, so it does not put `@bis/db` back at
// module scope (see the lazy imports in the handler below).
import type { serviceDb as serviceDbType, Branding, ConciergeConversationRow } from "@bis/db";
import { plainText } from "@/lib/concierge/plain-text";
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
  CAPTURE_LEAD_TOOL, parseCaptureLead, budgetNotice,
} from "@/lib/concierge/prompt";
import { conciergeStrings } from "@/lib/concierge/strings";
import { fileLead } from "@/lib/concierge/lead";

export const runtime = "nodejs";
/** One model call with a 20s ceiling, plus the reads around it. Nothing here
 *  waits on a person, unlike the phone path's whole-call socket. */
export const maxDuration = 30;

/** Same model the rest of this repo's text work uses (`summary-service.ts`,
 *  `proposals/generate.ts`) — a receptionist answering questions from a
 *  facts block is not a reasoning workload. */
const MODEL = "gpt-4o-mini";
const MODEL_TIMEOUT_MS = 20_000;
/** D-047's second call, the one that hears the capture's result. Shorter
 *  than the first: it writes one sentence from a known outcome. */
const FOLLOWUP_TIMEOUT_MS = 8_000;
/** Below this, the follow-up is skipped rather than started: a call that is
 *  certain to time out only delays the fixed fallback line. */
const FOLLOWUP_MIN_MS = 2_000;
/** Everything this handler does must finish inside `maxDuration` (30s);
 *  three seconds are left for the reads and writes after the model. */
const TURN_BUDGET_MS = 27_000;

type ModelMessage = {
  content?: string | null;
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
};

type Db = ReturnType<typeof serviceDbType>;

/** What happened to one capture_lead call. `already_on_file` covers both a
 *  conversation that filed its one lead on an earlier turn and a turn that
 *  lost the race to another tab: either way a lead is on file and THESE
 *  details were not added. */
type CaptureOutcome = "filed" | "filed_unreachable" | "already_on_file" | "unusable" | "failed";

/**
 * The tool result the model hears (D-047), worded to match exactly what the
 * code did. Model-facing, not customer copy: the visitor reads whatever the
 * model writes from it.
 *
 * `filed_unreachable` does NOT tell the model to ask for an email or phone:
 * the conversation's one submission slot is now claimed, so a second capture
 * carrying them would be `already_on_file` and the details the visitor typed
 * would go nowhere. Telling them plainly beats collecting something that is
 * then dropped.
 */
function captureResult(outcome: CaptureOutcome): { ok: boolean; result?: string; error?: string } {
  switch (outcome) {
    case "filed":
      return { ok: true, result: "Recorded. The team will follow up with them." };
    case "filed_unreachable":
      return { ok: true, result: "Recorded with their name, but with no email address or phone number, so the team has no way to reach them. This chat cannot add one now: tell them so, and suggest they contact the business directly." };
    case "already_on_file":
      return { ok: true, result: "A lead from this chat was already recorded earlier; these new details were not added." };
    case "unusable":
      return { ok: false, error: "Not recorded: their name is missing. Ask for it." };
    case "failed":
      return { ok: false, error: "Not recorded: their details could not be saved just now. Do not say they were passed on or that anyone will follow up." };
  }
}

/** The only assistant line stored for a turn that was NOT an answer (an
 *  empty completion, `spoken`'s fallback), in either language. */
const UNANSWERED_LINES: ReadonlySet<string> = new Set([
  conciergeStrings("en").unavailable, conciergeStrings("es").unavailable,
]);

/** Whether an earlier turn of this conversation was already answered, and so
 *  already billed (the usage leg below). */
function hadAnsweredTurn(transcript: { role: string; text: string }[]): boolean {
  return transcript.some((t) => t.role === "assistant" && !UNANSWERED_LINES.has(t.text));
}

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
  const startedAt = Date.now();
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
    brandDisplayName, recordAutomationLog,
  } = await import("@bis/db");

  const ipHash = hashIp(clientIp(req.headers));
  const origin = req.headers.get("origin");
  const priorId = typeof body.conversationId === "string" && body.conversationId
    ? body.conversationId : null;

  // D-050: the conversation THIS request opened, once its row exists. A turn
  // 1 that fails after that point (the model call, or any read after the
  // insert) used to answer a bare 503, so the page retried as a first turn:
  // a second row, a second count against the visitor's 3-per-10-minutes, for
  // one question. Every failure past the insert hands the id back, and the
  // page continues on it. Refusals before the insert have no id to give.
  let openedId: string | null = null;
  const unavailable = () => NextResponse.json(
    openedId ? { error: "unavailable", conversationId: openedId } : { error: "unavailable" },
    { status: 503 },
  );

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
        // Item 4 (Branch 2 hardening): a first message that arrived before
        // MIN_FILL_MS but carries a VALID, FRESH token is not a spam signal
        // on its own — a fast typist, not a bot. NOT `ended: true` — the
        // composer stays open and the visitor can just send again a moment
        // later. Distinct from the honeypot and bad/expired-signature
        // branches, which end the chat outright.
        //
        // The anti-oracle claim above does NOT hold for this branch, and it
        // would be dishonest to reuse it: a bot that GETs /c/<publicId>,
        // lifts `bis_rt` straight out of the HTML, and POSTs within two
        // seconds is the archetypal case this guard exists to catch, and
        // naming `tooFast` distinctly from `ended` now tells it exactly
        // which guard tripped. Accepted anyway — the fill floor is defeated
        // by simply waiting two seconds and resubmitting the same token, so
        // this leak buys a bot nothing it could not already get for free,
        // while a real fast typist told the vaguer `ended` sentence (and its
        // composer-closing consequence) is the worse cost of the two.
        if (!honeypot && verdict.ok && verdict.elapsedMs < MIN_FILL_MS) {
          return quiet("", "", false, strings.tooFast);
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
      openedId = created.id;
      // Part C: one `ai` row per conversation START — "website chats" on
      // the client's Activity page is the count of these. Isolated leg.
      try {
        await recordAutomationLog(db, {
          accountId: profile.account_id, source: "concierge", channel: "ai", contactId: null,
          subjectKey: `conversation:${created.id}`, status: "sent",
        });
      } catch (e) {
        log("automation log write failed", { conversationId: created.id, error: String(e) });
      }
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

    // One chat-completions call. Throws on a transport failure, a non-2xx,
    // or the timeout; the two callers below decide what a throw costs.
    async function complete(
      msgs: unknown[], timeoutMs: number, extra: Record<string, unknown> = {},
    ): Promise<ModelMessage | undefined> {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, messages: msgs, tools: [CAPTURE_LEAD_TOOL],
          // I2 (whole-branch review): with no bound here, gpt-4o-mini can
          // emit up to 16,384 output tokens, and every reply is replayed
          // into every LATER turn's transcript — unbounded, a single
          // runaway completion multiplies across the rest of the
          // conversation's calls. `concierge/guards.ts` states the
          // arithmetic; `proposals/generate.ts` already answered this same
          // question for its own OpenAI call.
          max_tokens: CONCIERGE_MAX_REPLY_TOKENS,
          ...extra,
        }),
        // A hung connection never rejects and never resolves; without this the
        // invocation stalls until Vercel kills it and the visitor sees
        // nothing. Same defence `summary-service.ts` already runs in
        // production.
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`openai ${r.status}`);
      const data = await r.json() as { choices?: { message?: ModelMessage }[] };
      return data?.choices?.[0]?.message;
    }

    let reply = "";
    let toolArgs: string | null = null;
    let toolCallId = "";
    try {
      const message = await complete(messages, MODEL_TIMEOUT_MS);
      // Plain text before it goes anywhere: the bubble shows markdown as
      // stray symbols, and the transcript is what the operator reads later.
      reply = plainText(message?.content ?? "");
      const call = message?.tool_calls?.find((c) => c.function?.name === "capture_lead");
      toolArgs = call?.function?.arguments ?? null;
      toolCallId = call?.id ?? "";
    } catch (e) {
      log("model call failed", { error: String(e) });
      return unavailable();
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
    // What the tool result tells the model when it did NOT file (D-047): a
    // capture with no usable name is a different thing to say to the visitor
    // than a save that failed.
    // ONE outcome per capture, and the tool result below says exactly that
    // (review of D-047): the result text must match what the code did.
    let outcome: CaptureOutcome = "already_on_file";
    if (toolArgs && !conversation.submission_id) {
      const lead = parseCaptureLead(toolArgs);
      outcome = "unusable";
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
          // reason, and the other `enrich` caller (f/[publicId]/actions.ts)
          // already uses this helper.
          origin: originFrom(req.headers), lead,
        });
        if (filed) {
          // The same validators `fileLead` writes the contact through: an
          // invalid email or phone is dropped there, so it is no way to
          // reach them here either.
          outcome = isValidEmail(lead.email) || isValidPhone(lead.phone) ? "filed" : "filed_unreachable";
        } else {
          // `fileLead` answers false for a failed save AND for a lost race
          // (two tabs on one conversation: the other turn claimed the one
          // submission slot first). One re-read tells them apart; a lead on
          // file is a lead on file, whichever turn wrote it.
          const after = await getConciergeConversation(db, conversationId).catch(() => null);
          if (after?.submission_id) { outcome = "already_on_file"; filed = true; }
          else outcome = "failed";
        }
      } else {
        log("capture_lead ignored: unusable arguments", { conversationId });
      }
    }

    // D-047: THE CAPTURE'S RESULT GOES BACK TO THE MODEL before the visitor
    // reads a word. Whatever the model wrote alongside its capture_lead call
    // was written BEFORE anything was filed, so it is discarded, never shown:
    // "I have passed your details on" beside a capture that failed is the
    // defect. A second completion carries the real result as the tool's
    // answer (`tool_choice: "none"`: it may not call the tool again) and its
    // words are the reply. The prompt's own rule ("never say you have ...
    // passed anything on unless capture_lead came back successful",
    // lib/voice/system-prompt.ts) is satisfiable now, because the result
    // finally comes back.
    //
    // Bounded by what is left of this invocation (`maxDuration` 30s, the first
    // call alone may take 20s). Too little left, or the call fails: no second
    // reply, and `spoken` below falls back to the fixed line for what really
    // happened, never to the pre-result words.
    if (toolArgs) {
      reply = "";
      const timeLeft = TURN_BUDGET_MS - (Date.now() - startedAt);
      const followupTimeout = Math.min(FOLLOWUP_TIMEOUT_MS, timeLeft);
      if (followupTimeout >= FOLLOWUP_MIN_MS) {
        const result = captureResult(outcome);
        try {
          const message = await complete([
            ...messages,
            {
              role: "assistant", content: null,
              tool_calls: [{
                id: toolCallId, type: "function",
                function: { name: "capture_lead", arguments: toolArgs },
              }],
            },
            { role: "tool", tool_call_id: toolCallId, content: JSON.stringify(result) },
          ], followupTimeout, { tool_choice: "none" });
          reply = plainText(message?.content ?? "");
        } catch (e) {
          log("capture follow-up failed", { conversationId, filed, error: String(e) });
        }
      } else {
        log("capture follow-up skipped: no time left", { conversationId, filed, timeLeft });
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
    // I2, second half: `max_tokens: CONCIERGE_MAX_REPLY_TOKENS` (500) above
    // already bounds a completion to roughly 2,000-2,500 characters of
    // English, so this slice does not CREATE the bound — it TIGHTENS it,
    // from that ~2,500 ceiling down to the exact CONCIERGE_MAX_MESSAGE_CHARS
    // (2,000) the visitor's own message is held to (line ~105). Belt and
    // braces: for the day `CONCIERGE_MAX_REPLY_TOKENS` is raised, or the API
    // simply ignores it and returns more, the stored side of the transcript
    // still cannot bloat every later turn's replayed payload past this
    // limit. `spoken` itself (and the response below) stays the full text —
    // only what gets WRITTEN DOWN is sliced.
    const storedSpoken = spoken.slice(0, CONCIERGE_MAX_MESSAGE_CHARS);

    const now = new Date().toISOString();
    try {
      // Recorded AFTER `spoken` is decided, so a lie about what was filed can
      // never be written down as Sofía's own words. But NOT what the visitor
      // read, in normal operation, not only adversarial: a legitimate
      // ~500-token reply can print past CONCIERGE_MAX_MESSAGE_CHARS, so the
      // visitor sees `spoken` in full while `storedSpoken` clips it, and the
      // operator's transcript can end mid-sentence. Accepted on purpose —
      // only the stored copy is ever replayed back into the model, so only
      // it drives cost, and clipping what a reader sees mid-sentence would be
      // a visible defect, not a cost saving.
      await appendConciergeTurns(db, conversationId, [
        { role: "visitor", text, at: now },
        { role: "assistant", text: storedSpoken, at: now },
      ]);
    } catch (e) {
      // The answer is already paid for and already useful. Losing it because
      // the record of it could not be written would be the worse trade.
      log("transcript append failed", { conversationId, error: String(e) });
    }

    // USAGE (client billing): ONE `ai_chats` row per conversation, recorded
    // when Sofía's FIRST reply has succeeded (danlo, 2026-09-25: a failed
    // start, e.g. the model call's 503 during an OpenAI outage, never
    // bills). Every refusal and the model call are above this line, so none
    // of them can reach it. "Succeeded" is `spoken`'s own condition: the
    // model wrote a reply, or a lead was filed this turn; an empty completion
    // that fell back to `strings.unavailable` is not an answer.
    //
    // The conversation's FIRST ANSWERED turn, whichever request that is. It
    // used to be turn 1 only (`!priorId`), which stopped being the same thing
    // once D-050 let a failed first reply's retry arrive WITH the id: that
    // chat was never billed. A failed turn appends nothing (every failure
    // returns above the append), but an EMPTY completion appends an
    // exchange whose assistant line is the 'unavailable' sentence, so the
    // question is "has any earlier assistant line been an answer", not "is
    // the transcript empty". The unique (meter, source_ref) on
    // `conversation:<id>` is the backstop, not the gate. In `after()`, once
    // the response is sent (the voice routes'
    // precedent): the visitor is waiting on this reply, and a stalled ledger
    // write could otherwise hold it up to recordUsageSafely's 5 s.
    // recordUsageSafely never throws, and the LAZY import (this handler's
    // rule, lines 113-123: lib/billing/usage imports @bis/db at its module
    // scope) sits inside the callback's own try, so neither a ledger failure
    // nor a failed import rejects the background work.
    const answered = Boolean(reply || (toolArgs && filed));
    if (answered && !hadAnsweredTurn(conversation.transcript)) {
      after(async () => {
        try {
          const { recordUsageSafely } = await import("@/lib/billing/usage");
          await recordUsageSafely(db, {
            accountId: profile.account_id, meter: "ai_chats", quantity: 1,
            occurredAt: new Date(), sourceRef: `conversation:${conversationId}`,
          }, `concierge ${conversationId}`);
        } catch (e) {
          log("usage leg failed", { conversationId, error: String(e) });
        }
      });
    }

    return quiet(conversationId, spoken, false);
  } catch (e) {
    // Anything the reads above threw. A refusal, so it costs nothing — and
    // never an unhandled 500 with a stack in it.
    log("refused: turn failed", { publicId, error: String(e) });
    return unavailable();
  }
}
