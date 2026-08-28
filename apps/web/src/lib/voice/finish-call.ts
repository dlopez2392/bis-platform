import type { serviceDb, Branding, CallOutcome } from "@bis/db";
import {
  createContact, fillContactBlanks, ensureConversation, createMessage, incrementUnreadCount,
  finishCallRow, emit,
} from "@bis/db";
import { emailBrand } from "@/lib/email/templates/shell";
import { getEmailProvider } from "@/lib/email";
import { voiceCallAlertEmail } from "@/lib/email/templates/voice";
import type { CallState } from "./call-state";
import { classifyOutcome } from "./call-state";
import { generateSummary } from "./summary-service";
import { summaryFactLine } from "./summarize";
import { toE164 } from "./phone-number";

export interface FinishContext {
  db: ReturnType<typeof serviceDb>;
  accountId: string;
  accountName: string;
  branding: Branding;
  notifyEmails: string[];
  callerNumber: string | null;
  /** Absolute origin ("https://x.example") of the request that ended the
   *  call. Always present — voice runs server-side off Telnyx's webhook, not
   *  off a browser request that might carry no host header. */
  origin: string;
  profileLanguage: "en" | "es" | "both";
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
 * staff alert. `abandoned`/`spam` get a row and nothing else — nobody picks
 * those up, so there is no one to hand off to.
 */
function isMeaningful(outcome: CallOutcome): boolean {
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
 * Three independent legs, each allowed to fail without taking the others
 * down: lead treatment (contact/conversation/message/unread), the staff
 * alert, and the row write. A DB outage that breaks the first and third still
 * leaves the alert as the one surviving signal a human sees; an email outage
 * still leaves the row for the dashboard.
 */
export async function finishCall(
  state: CallState, ctx: FinishContext, meta: FinishMeta,
): Promise<FinishResult> {
  const outcome = classifyOutcome(state);
  const meaningful = isMeaningful(outcome);

  let summary: string;
  try {
    summary = await generateSummary(state);
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
      const brand = emailBrand(ctx.branding, ctx.accountName);
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
        language: ctx.profileLanguage === "es" ? "es" : "en",
        contactId: contactId ?? undefined,
        conversationId: conversationId ?? undefined,
        bookingId,
      });
      stored = true;
    } catch (e) {
      console.error(`finishCall ${meta.callRowId}: finishCallRow failed: ${String(e)}`);
    }
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

  return { stored, notified, outcome };
}
