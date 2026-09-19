import type { serviceDb, Branding, CallOutcome } from "@bis/db";
import {
  createContact, fillContactBlanks, ensureConversation, createMessage, incrementUnreadCount,
  finishCallRow, emit, getAlertPhone, getContact,
} from "@bis/db";
import { emailBrand, brandDisplayName } from "@/lib/email/templates/shell";
import { getEmailProvider } from "@/lib/email";
import { voiceCallAlertEmail } from "@/lib/email/templates/voice";
import { composeCallAlertSms, prepareAlertSms, deliverAlertSms, type PendingAlertSms } from "@/lib/sms/alerts";
import { prepareTextback, deliverTextback, type PendingTextback } from "./textback";
import type { CallState } from "./call-state";
import { classifyOutcome, wasServed, wasTransferred } from "./call-state";
import { detectSpokenLanguage } from "./language";
import { generateSummary } from "./summary-service";
import { summaryFactLine } from "./summarize";
import { toE164 } from "./phone-number";
// STATIC, not the lazy `await import(...)` this repo otherwise reaches for
// near route handlers: the documented page-data trap (a module-scope DB
// import breaking `next build`'s page-data collection) doesn't apply to a
// plain lib-to-lib import, this file already imports `@bis/db` at module
// scope above, and `api/voice/incoming/route.ts` imports `finishCall` itself
// statically. Nothing here needed the indirection.
import { generateProposals } from "@/lib/proposals/generate";

/**
 * DELIBERATELY ABSENT: `accountName`. `accounts.name` is the agency's internal
 * label for the company ("Rio Roofing — trial") and it reached a stranger's
 * phone from exactly this context once already. The staff alert and the
 * text-back both resolve the customer-facing name from `branding` alone
 * (`brandDisplayName`), so there is nothing here left to get wrong.
 */
export interface FinishContext {
  db: ReturnType<typeof serviceDb>;
  accountId: string;
  branding: Branding;
  notifyEmails: string[];
  callerNumber: string | null;
  /** Absolute origin ("https://x.example") of the request that ended the
   *  call. Always present — voice runs server-side off Telnyx's webhook, not
   *  off a browser request that might carry no host header. */
  origin: string;
  profileLanguage: "en" | "es" | "both";
  /** IANA zone the account operates in (e.g. "America/Chicago"). Threaded
   *  into generateSummary so the prose states booking times in local form
   *  instead of the raw UTC the booking records carry. */
  timezone: string;
  /** `voice_profiles.textback_enabled` — the per-company missed-call
   *  text-back switch (migration 0024). Off is the shipped default and the
   *  honest one: this sends a text to a real phone with no human in the loop. */
  textbackEnabled: boolean;
  /** `voice_profiles.textback_body`. EMPTY means "use the live default at
   *  send time" — the default is deliberately never persisted, so an operator
   *  who never wrote their own keeps getting the current copy. */
  textbackBody: string;
}

export interface FinishMeta {
  /** The row `startCallRow` created at pickup. Null means the row was never
   *  opened (e.g. the start write itself failed) — there is nothing to
   *  finish, so the row update is skipped entirely rather than attempted
   *  against an id that doesn't exist. */
  callRowId: string | null;
  startedAt: Date;
  endedAt: Date;
}

export interface FinishResult {
  stored: boolean;
  notified: boolean;
  outcome: CallOutcome;
}

// Every write finishCall makes is attributed to the AI, not to whichever
// human happens to own the request context — a voice call has no signed-in
// user, and crediting one would be the same actor_type bug M1b fixed for the
// Resend webhook.
const ACTOR_ID = "voice";
const ACTOR_TYPE = "ai";

/**
 * Outcomes worth a human seeing: a durable contact/conversation trail and a
 * staff alert. `abandoned`/`spam` get neither — nobody picks those up, so
 * there is no one to hand off to. (`abandoned` may still get a contact and a
 * conversation from the text-back leg further down, when the account has
 * opted in; that trail exists to hold the text, not to summon a human.)
 *
 * `transferred` (0037) is deliberately NOT meaningful, and that is the
 * spec's binding decision rather than an omission
 * (docs/superpowers/specs/2026-09-15-call-handoff-design.md). Two reasons.
 * Structural: this decision is made inside `finishCall`, which runs at socket
 * close — BEFORE the result route knows whether anyone actually picked up. An
 * alert on a transfer would therefore have to be a SECOND send path living
 * inside a TeXML route, duplicating the email and SMS machinery this file is
 * the only copy of. And about what an alert is for: a person at the business
 * just spoke to this caller live, so they already know. An alert exists for
 * work that might be MISSED; telling someone about the call they personally
 * answered is noise. (A ring-out — nobody picked up — is the case that does
 * go unnoticed, and it records as `abandoned`, which is the truth, and takes
 * whatever path this product already gives an abandoned call.)
 *
 * A type predicate (not a plain boolean) so the staff alert SMS leg below
 * can call this directly and get `outcome` narrowed to
 * `composeCallAlertSms`'s own literal union — no cast, and the two alert
 * legs (email above, SMS below) are gated on the identical set of outcomes
 * rather than two hand-copies of the same strings.
 *
 * What the compiler does and does NOT do with that, because an earlier
 * comment here overclaimed it: TypeScript checks the CALL SITES against this
 * signature, so nothing can hand `composeCallAlertSms` an outcome outside
 * its union. It does not check this function's BODY against its own return
 * type — a type predicate is an assertion the author makes, not one the
 * compiler proves. Add `|| outcome === "transferred"` below and leave the
 * signature alone and `tsc --noEmit` still exits 0, while the SMS composer
 * looks up a key it has no copy for. That is why `composeCallAlertSms` has a
 * runtime floor of its own, and why the two unions widening together is a
 * rule for a human to follow rather than one the compiler enforces.
 *
 * EXPORTED, unlike its neighbours in this file, and only because of the
 * paragraph above: `classifyOutcome` never returns `transferred` (a
 * handed-off call still classifies `abandoned` at socket close), so no state
 * drives `finishCall` to that outcome — which makes the NEGATIVE rule
 * unfalsifiable through `finishCall` in exactly the way a positive one would
 * be. The export is what makes it testable at all; finish-call.test.ts calls
 * it directly.
 */
export function isMeaningful(
  outcome: CallOutcome,
): outcome is "booked" | "lead" | "message" {
  return outcome === "booked" || outcome === "lead" || outcome === "message";
}

/** Split on the LAST space, so "Ana Maria Ruiz" keeps "Ana Maria" together
 *  as the first name rather than splitting on the first space. A caller with
 *  no space in their name becomes a first-name-only contact. */
function splitFullName(fullName: string): { firstName: string; lastName?: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx === -1) return { firstName: trimmed };
  return { firstName: trimmed.slice(0, idx).trim(), lastName: trimmed.slice(idx + 1).trim() };
}

/**
 * The four contact columns `generateProposals`'s `contact_field` branch may
 * ever fill, reported in this same order. "Blank" mirrors
 * `fillContactBlanks`'s own definition (`@bis/db`'s `contacts.ts`): null, or
 * empty after trimming — never a value a human typed. This is the
 * propose-time half of the containment rule (Task 8): a column this
 * function omits can never become a proposal downstream, no matter what the
 * model asks for.
 */
function computeBlankFields(row: {
  first_name?: string | null; last_name?: string | null;
  email?: string | null; phone?: string | null;
}): ("firstName" | "lastName" | "email" | "phone")[] {
  const isBlank = (v: unknown) => v == null || String(v).trim() === "";
  const blank: ("firstName" | "lastName" | "email" | "phone")[] = [];
  if (isBlank(row.first_name)) blank.push("firstName");
  if (isBlank(row.last_name)) blank.push("lastName");
  if (isBlank(row.email)) blank.push("email");
  if (isBlank(row.phone)) blank.push("phone");
  return blank;
}

/**
 * Resolves who this call is about, creating a contact only when the state
 * genuinely has nobody yet.
 *
 * `state.contactId` wins outright — set by an in-call booking or an explicit
 * lookup, it is never second-guessed here. Absent that, a captured lead's
 * fields build a real contact (name split, phone normalized, source
 * "voice"). Absent even a lead, a caller ID still deserves a contact record
 * for the message that follows — that gets the minimal shape, `firstName:
 * "Caller"` plus the number, rather than leaving the conversation orphaned.
 */
async function resolveContactId(state: CallState, ctx: FinishContext): Promise<string | null> {
  if (state.contactId) return state.contactId;

  const lead = state.leads[0];
  if (lead) {
    const fields = lead.fields ?? {};
    const { firstName, lastName } = splitFullName(fields.fullName ?? "");
    const created = await createContact(ctx.db, ctx.accountId, {
      firstName: firstName || "Caller",
      lastName,
      phone: toE164(fields.callbackNumber) ?? ctx.callerNumber ?? undefined,
      email: fields.email,
      source: "voice",
    }, ACTOR_ID, ACTOR_TYPE);
    if (created.existing) {
      try {
        await fillContactBlanks(ctx.db, ctx.accountId, created.id,
          { firstName: firstName || undefined, lastName, email: fields.email,
            phone: toE164(fields.callbackNumber) ?? ctx.callerNumber ?? undefined },
          ACTOR_ID, ACTOR_TYPE);
      } catch (e) {
        console.error(`finishCall fillContactBlanks failed for ${created.id}: ${String(e)}`);
      }
    }
    return created.id;
  }

  if (ctx.callerNumber) {
    const created = await createContact(ctx.db, ctx.accountId, {
      firstName: "Caller",
      phone: ctx.callerNumber,
      source: "voice",
    }, ACTOR_ID, ACTOR_TYPE);
    if (created.existing) {
      try {
        await fillContactBlanks(ctx.db, ctx.accountId, created.id,
          { phone: ctx.callerNumber ?? undefined },
          ACTOR_ID, ACTOR_TYPE);
      } catch (e) {
        console.error(`finishCall fillContactBlanks failed for ${created.id}: ${String(e)}`);
      }
    }
    return created.id;
  }

  return null;
}

/**
 * Runs after hangup and NEVER throws — the caller has already hung up by the
 * time this executes, so there is no request left to fail; a log line is the
 * only alert a bug here can raise (the "CALL LOST" line below is exactly
 * that, for the one failure mode that would otherwise vanish silently: both
 * the durable record and the staff alert missing at once).
 *
 * Four independent legs, each allowed to fail without taking the others
 * down: lead treatment (contact/conversation/message/unread), the staff
 * alert, the missed-call text-back, and the row write. A DB outage that
 * breaks the first and last still leaves the alert as the one surviving
 * signal a human sees; an email outage still leaves the row for the
 * dashboard; a carrier outage costs the abandoned caller their text and
 * nothing else.
 *
 * The text-back leg is deliberately SPLIT around the row write: its database
 * work runs before (the row records the contact and conversation the text
 * lives in, so those ids have to exist first), its carrier send runs after.
 * Ordering by cost, not by leg — a 10-second provider call ahead of the
 * durable record is how a slow carrier loses the call row on an invocation
 * running out of maxDuration. That is not the default case today (the voice
 * route's ceiling is 800s against a 240s call cap), but it is exactly the
 * case whenever an operator raises `PHONE_MAX_CALL_SECONDS` toward the
 * route's 750s clamp, so the ordering is not something the upgrade retires.
 */
export async function finishCall(
  state: CallState, ctx: FinishContext, meta: FinishMeta,
): Promise<FinishResult> {
  const outcome = classifyOutcome(state);
  const meaningful = isMeaningful(outcome);
  // Computed once, read twice: the `calls.language` column below, and the
  // language the missed-call text-back answers in. Deliberately the SAME
  // value — a caller the Calls page labels "Spanish" who then receives an
  // English text is the platform contradicting itself in front of the
  // customer, and two separate derivations is how that starts.
  const spokenLanguage = detectSpokenLanguage(state.transcript, ctx.profileLanguage);

  let summary: string;
  try {
    summary = await generateSummary(state, { timezone: ctx.timezone });
  } catch (e) {
    console.error(`finishCall: generateSummary failed, falling back to fact line: ${String(e)}`);
    summary = summaryFactLine(state);
  }

  // One try around the whole lead-treatment block (contact → conversation →
  // message → unread count): a failure partway through — say the contact
  // gets created but the conversation lookup then throws — must not repeat
  // any step above it on a hypothetical retry (there is none) and must not
  // suppress the staff alert below. Losing the CRM trail is recoverable from
  // the transcript in the row; losing the ONLY notification a human gets is
  // not, so the two are never allowed to share a failure.
  let contactId: string | null = null;
  let conversationId: string | null = null;
  if (meaningful) {
    try {
      contactId = await resolveContactId(state, ctx);
      if (contactId) {
        const conversation = await ensureConversation(ctx.db, ctx.accountId, contactId, ACTOR_ID, ACTOR_TYPE);
        conversationId = conversation.id;
        await createMessage(ctx.db, ctx.accountId, {
          conversationId, channel: "voice", direction: "inbound",
          subject: "Phone call", body: summary,
        }, ACTOR_ID, ACTOR_TYPE);
        await incrementUnreadCount(ctx.db, ctx.accountId, conversationId);
      }
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: lead treatment failed: ${String(e)}`);
    }
  }

  // The staff alert, same outcomes only. Deliberately NOT inside the lead-
  // treatment try above (and not gated on it succeeding) — this is the one
  // channel a human is guaranteed to see, so a CRM-side failure must never
  // cost the call its notification.
  let notified = false;
  if (meaningful) {
    try {
      const callerDisplay = ctx.callerNumber ?? "Unknown caller";
      const brand = emailBrand(ctx.branding);
      const contactUrl = contactId
        ? `${ctx.origin}/dashboard/accounts/${ctx.accountId}/contacts/${contactId}`
        : null;
      const { html, text } = voiceCallAlertEmail({ brand, outcome, summary, callerDisplay, contactUrl });
      const provider = getEmailProvider();

      const failures: string[] = [];
      for (const to of ctx.notifyEmails) {
        try {
          // No fromAddress: same deliverability reasoning as the booking/lead
          // alerts — this goes to the CLIENT'S OWN staff, and a client-domain-
          // to-client-domain send through a third-party sender is the shape
          // corporate filters treat as spoofing. Platform From only.
          await provider.send({ to, fromName: brand.name, subject: `Call — ${outcome} — ${callerDisplay}`, body: text, html });
          notified = true;
        } catch (e) {
          failures.push(`${to} (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      if (failures.length > 0) {
        console.error(`finishCall ${meta.callRowId ?? "(no row)"}: alert send failed for ${failures.join(", ")}`);
      }
    } catch (e) {
      // getEmailProvider() throws synchronously when RESEND_API_KEY or
      // EMAIL_FROM is missing or rotated in production (see @/lib/email/preflight).
      // An outer catch keeps config failure from violating never-throws.
      // Same fix as apps/web/src/app/b/[publicId]/actions.ts.
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: staff alert setup failed: ${String(e)}`);
    }
  }

  // The staff alert's SMS twin — ALONGSIDE the email above, never instead
  // (danlo, 2026-09-15). Its own leg, own try/catch, independent of the
  // email alert's: an email outage above must not cost the account its
  // text, and a carrier outage here must not cost the call its email. Gated
  // on `isMeaningful(outcome)` called directly (not the pre-computed
  // `meaningful` local) so `outcome` narrows to `composeCallAlertSms`'s own
  // literal union with no cast — matching the email alert's gate exactly,
  // per the brief.
  //
  // `ctx.notifyEmails.length > 0` tells `composeCallAlertSms` whether it may
  // promise "check your email" — an account with no notify emails never got
  // one from the block above, and the text used to claim it regardless
  // (alert-send-report follow-up review, finding 3).
  //
  // Only the PREPARE half — `getAlertPhone` and `prepareAlertSms`'s gate/
  // loop-guard reads — runs here. The carrier POST is deliberately held
  // until after `finishCallRow` below, mirroring the missed-call text-back's
  // own split around the same row write and for the identical reason
  // (finding 4): a 10-second provider call ahead of the durable call row is
  // how a slow carrier loses that row on an invocation running out of
  // budget. `sendAlertSms` (used unchanged by `app/b/[publicId]/actions.ts`,
  // which has no such ordering constraint) is `prepareAlertSms` immediately
  // followed by `deliverAlertSms`; this leg calls the two halves separately.
  let pendingAlertSms: PendingAlertSms | null = null;
  if (isMeaningful(outcome)) {
    try {
      const alertPhone = await getAlertPhone(ctx.db, ctx.accountId);
      pendingAlertSms = await prepareAlertSms(
        ctx.db, ctx.accountId, alertPhone,
        composeCallAlertSms(outcome, ctx.notifyEmails.length > 0),
      );
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: alert SMS prepare failed: ${String(e)}`);
    }
  }

  // Fourth leg: the missed-call text-back. Its own try/catch for the same
  // reason as the three around it — finishCall is contractually never-throws,
  // because the caller has already hung up and there is nobody for a
  // rejection to reach. Both things in here that throw on CONFIGURATION alone
  // sit inside that catch on purpose: resolveSmsSender throws on a
  // phone_numbers read error, and getSmsProvider() throws synchronously when
  // TELNYX_API_KEY is missing in production — which is production's state as
  // this ships. Neither may cost the call its row.
  //
  // `abandoned` ONLY: classifyOutcome returns it when the caller actually
  // SPOKE, while a call with no caller speech is `spam`. That distinction is
  // what keeps silent robocalls out of the CRM by classification rather than
  // by rule, and it is why creating a contact here is acceptable at all.
  //
  // ...but `abandoned` is not the same question as "did we fail this caller".
  // A caller who rang in purely to CANCEL, or to check what time their
  // appointment is, leaves no booking, no lead and no message behind — and
  // for a booking made on an earlier call, not even a mirrored cancellation
  // (call-state.ts's `withBookingCancelled` maps over an array that is
  // empty). Those calls classify `abandoned` and were getting an automatic,
  // unretractable "Sorry we missed you just now" for a call that went
  // perfectly. `wasServed` is the second half of the gate, and it is
  // deliberately a separate flag rather than a new classifyOutcome value:
  // that value feeds the calls list, the outcome pill and the dashboard KPIs,
  // and re-labelling cancellation calls there is a product decision this
  // change is not entitled to make.
  //
  // SPLIT IN TWO around the row write below. Everything the call row itself
  // needs — the contact, the conversation, and the outbound message row —
  // happens here, because `finishCallRow` writes those ids and cannot write
  // ids that do not exist yet. The PROVIDER SEND does not belong to that set:
  // it is a network call to a carrier with a 10-second timeout, made inside
  // an invocation whose remaining `maxDuration` budget is whatever the call
  // cap left behind — comfortable at the default 240s cap under the route's
  // 800s ceiling, and nearly nothing once an operator raises
  // `PHONE_MAX_CALL_SECONDS` toward its 750s clamp — and running it ahead of
  // the durable record meant a long abandoned call plus a slow carrier could
  // lose the call row entirely — the row the entire dashboard reads. So this half prepares the send, and the half below `finishCallRow`
  // performs it. Write-then-send is preserved exactly as before: the message
  // row still exists before anything leaves the building.
  let pendingTextback: PendingTextback | null = null;
  if (outcome === "abandoned" && !wasServed(state) && ctx.textbackEnabled && ctx.callerNumber) {
    // THE GATE ABOVE IS THE OPTIMISTIC ONE. `wasServed` is true the moment a
    // caller ASKS for a person, not when they reach one — and at socket close
    // the dial has not even been attempted, so which happened is unknowable
    // here. Suppressing is the correct bet (texting someone who DID reach a
    // human is the sharper error), and /api/voice/texml/handoff-result is
    // where the bet gets settled: it sends this same text-back when the dial
    // rang out. Without that compensation, asking for a human left a caller
    // worse off than never asking.
    //
    // Everything below the gate now lives in ./textback, because that route
    // needs it too and the policy inside it — who may text, the disclosure,
    // the cooldown, write-then-send — must have exactly one home.
    try {
      const callerNumber = ctx.callerNumber;
      const result = await prepareTextback(ctx.db, ctx.accountId, {
        callerNumber,
        contactId: null,
        // finishCall's own resolver: a call with a captured lead deserves the
        // richer contact, and it runs behind the send gate.
        resolveContact: () => resolveContactId(state, ctx),
        language: spokenLanguage,
        brandName: brandDisplayName(ctx.branding),
        textbackBody: ctx.textbackBody,
        label: `finishCall ${meta.callRowId ?? "(no row)"}`,
      });
      // Assigned to the OUTER ids rather than shadowed: the call row below
      // points at the contact and conversation the text lives in, and a
      // cooldown-suppressed call keeps them too, so it is never orphaned from
      // its own thread.
      if (result.contactId) contactId = result.contactId;
      if (result.conversationId) conversationId = result.conversationId;
      pendingTextback = result.pending;
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: text-back failed: ${String(e)}`);
    }
  }

  // The durable row. Its own try/catch, independent of both legs above — a
  // DB outage here must not un-send an alert already on the wire, and must
  // not roll back a contact/message already written.
  let stored = false;
  if (meta.callRowId) {
    try {
      const bookingId = state.bookings.find((b) => b.status === "booked")?.id;
      await finishCallRow(ctx.db, ctx.accountId, meta.callRowId, {
        outcome,
        endedAt: meta.endedAt,
        durationSecs: Math.max(0, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000)),
        turnCount: state.transcript.length,
        transcript: state.transcript,
        summary,
        language: spokenLanguage,
        contactId: contactId ?? undefined,
        conversationId: conversationId ?? undefined,
        bookingId,
      });
      stored = true;
    } catch (e) {
      console.error(`finishCall ${meta.callRowId}: finishCallRow failed: ${String(e)}`);
    }
  }

  // The other half of the staff alert SMS leg: the actual carrier POST,
  // deliberately AFTER the durable row above — same ordering, same reason as
  // the text-back's own split just below (finding 4, alert-send-report
  // follow-up review). `deliverAlertSms` never throws by contract (its own
  // doc, @/lib/sms/alerts) but this try/catch stays anyway, the same
  // defense-in-depth every other leg in this function carries.
  if (pendingAlertSms) {
    try {
      await deliverAlertSms(ctx.accountId, pendingAlertSms);
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: alert SMS deliver failed: ${String(e)}`);
    }
  }

  // The other half of the text-back leg: the actual send, deliberately AFTER
  // the durable row above. Everything before this point is database work
  // measured in milliseconds; this is a carrier round trip with a 10-second
  // timeout, inside an invocation that may or may not have budget left — the
  // voice route's 800s `maxDuration` leaves plenty at the default 240s call
  // cap, and almost none if `PHONE_MAX_CALL_SECONDS` is ever raised toward
  // the route's 750s clamp, which is the case this ordering is written for.
  // Ahead of the row write it was a way to lose the call record itself, which
  // is the one artefact of the call the dashboard, the KPIs and any later
  // investigation all read. The text is worth less than the record of the
  // call, so it goes second.
  //
  // Same try/catch contract as every other leg — finishCall never throws —
  // and the same two things that throw on CONFIGURATION alone still sit
  // inside it: getSmsProvider() throws synchronously when TELNYX_API_KEY is
  // missing in production, and it is called here, inside the inner try, so a
  // config failure still marks the message `failed` exactly as a carrier
  // failure does.
  // The send, on the far side of the row write above — same ordering as
  // before, now in ./textback because the handoff-result route performs the
  // identical send when a transfer rings out. `deliverTextback` never
  // throws: by here the durable record is already settled, and a carrier
  // failure must not take the return value with it.
  if (pendingTextback) {
    await deliverTextback(ctx.db, ctx.accountId, pendingTextback,
      `finishCall ${meta.callRowId ?? "(no row)"}`);
  }

  // The one failure mode with no other trace anywhere: a real booked/lead/
  // message call that landed neither in the database nor in anyone's inbox.
  // This log line IS the alert for that case (see the function doc) — it
  // must fire even though nothing above threw.
  if (meaningful && !stored && !notified) {
    console.error(
      `CALL LOST — account ${ctx.accountId} call ${meta.callRowId ?? "(no row)"} outcome "${outcome}": ` +
      `neither the row nor the staff alert reached anyone. Summary: ${summary}`,
    );
  }

  // Best-effort, deliberately after everything above (including the CALL
  // LOST check): the activity feed is a convenience, not a channel anyone is
  // relying on to learn a call happened.
  try {
    await emit(ctx.db, ctx.accountId, "call.recorded", ACTOR_ID, { callId: meta.callRowId, outcome }, ACTOR_TYPE);
  } catch (e) {
    console.error(`finishCall ${meta.callRowId ?? "(no row)"}: emit failed: ${String(e)}`);
  }

  // PROPOSALS. `stored` — not merely `meta.callRowId` — is the gate: the
  // transcript this generator reads became durable in `finishCallRow` above,
  // and a finishCallRow failure must produce nothing here either, exactly
  // like a fail-open callRowId does. The spec said generation runs
  // "alongside the summary" — that would ground every proposal in
  // `state.transcript` while it was still in-memory only, a proposal citing
  // a call nobody can open yet.
  //
  // LAST STATEMENT IN THE FUNCTION, on purpose, not merely "after the row
  // write": this call reaches OpenAI, capped at `AbortSignal.timeout(10_000)`
  // for the model request alone (the up-to-three insert round trips beyond
  // it are unbounded), and a proposal is an opinion about a call that already
  // happened. The staff alert SMS deliver, the missed-call text-back deliver,
  // the CALL LOST alarm and the `call.recorded` emit above are how a business
  // owner finds out they have a lead, or this function's own last-resort
  // signal that neither the row nor the alert reached anyone — none of those
  // may sit downstream of a network call this file does not need for any of
  // them. (This used to delay the staff alert SMS by up to that same 10
  // seconds on every booked/lead/message call — an opinion gating a record.)
  //
  // Deliberately its OWN standalone leg, not nested inside `finishCallRow`'s
  // try/catch far above: nesting would let a proposal failure surface as
  // "finishCallRow failed" in the log, and — because that outer catch already
  // swallows and `stored` would already be true by then — a dropped inner
  // catch would be invisible to any test of this function's return value or
  // its never-throws guarantee. Standing alone, a bug here can only ever cost
  // a proposal: nothing here may change the call's outcome, its transcript,
  // its text-back, or this function's never-throws guarantee.
  //
  // `contactId` is the SAME local the lead-treatment leg and `finishCallRow`
  // itself both already used above (including any text-back-leg backfill) —
  // never re-resolved here. Logged under this file's own `finishCall <id>:`
  // prefix rather than a bare `proposals:` one, so an operator grepping one
  // call's lifecycle sees these lines too, and so they read distinctly from
  // the generator's own `generateProposals:` lines.
  if (meta.callRowId && stored) {
    try {
      // BLANK-FIELD CONTAINMENT (Task 8): `generateProposals` cannot see the
      // contact row, so it is handed exactly which of the four allow-listed
      // columns are currently empty on it. Read off the SAME `contactId`
      // this function already resolved above — never re-resolved — and
      // gated on it being non-null, per the spec's own rule ("When
      // contactId is null, pass []"). Its own try/catch, nested INSIDE this
      // leg's: a DB blip reading the contact must cost this feature its
      // blank-field list, never the call its (task) proposals or this leg
      // its usual best-effort behavior — the read failing must not also
      // skip calling `generateProposals` altogether.
      let blankFields: ("firstName" | "lastName" | "email" | "phone")[] = [];
      if (contactId) {
        try {
          const row = await getContact(ctx.db, ctx.accountId, contactId);
          if (row) blankFields = computeBlankFields(row);
        } catch (e) {
          console.error(`finishCall ${meta.callRowId}: contact read for blankFields failed: ${String(e)}`);
        }
      }
      const n = await generateProposals({
        db: ctx.db, accountId: ctx.accountId, callId: meta.callRowId,
        contactId, outcome, transcript: state.transcript,
        handoffRequested: wasTransferred(state), blankFields,
      });
      if (n > 0) console.log(`finishCall ${meta.callRowId}: proposals wrote ${n}`);
    } catch (e) {
      console.error(`finishCall ${meta.callRowId}: proposals generation failed: ${String(e)}`);
    }
  }

  return { stored, notified, outcome };
}
