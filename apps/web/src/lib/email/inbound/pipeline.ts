import {
  findReplyThread, matchSender, recordInboundEmail, findInboundEmailByProviderId, getConversationSummary,
  INBOUND_EMAIL_COLLISION, type InboundEmailRow, type SenderMatch, type SupabaseClient,
} from "@bis/db";
import type { ReceivedEmailFetcher } from "@/lib/email/receiving";
import { BIS_REPLY_DOMAIN, bareAddress, displayName, domainOf, parseReplyAddress } from "./address";
import { parseHeaderBlock, readSesVerdict, senderAuthenticated, authRecord } from "./auth-results";
import { newText, htmlToText } from "./new-text";
import { fileInboundEmail } from "./file";

/**
 * The email.received steps 2-9 (spec "Inbound", "Failure behaviour"). The route verifies svix and
 * stamps the heartbeat; this decides. Never logs a token, an address, a subject or a body.
 */
export type PipelineDeps = {
  db: SupabaseClient; fetchEmail: ReceivedEmailFetcher; now: () => Date;
  forward: (f: { row: InboundEmailRow; contactId: string; senderName: string | null; attachmentCount: number }) => Promise<void>;
  log: (line: string) => void;
};
export type PipelineOutcome =
  | { status: 200; result: "filed" | "held" | "duplicate" | "dropped" }
  | { status: 503; result: "fetch_failed" | "write_failed" };

const ACTOR = { id: "email-inbound", type: "system" as const };

/** Fix round 1 item 6d: a Resend-reported timestamp this platform cannot parse is never fatal — the
 *  received time falls back to now() rather than letting `new Date(garbage).toISOString()` throw. */
function receivedAtOf(raw: string, now: () => Date): string {
  return Number.isNaN(Date.parse(raw)) ? now().toISOString() : new Date(raw).toISOString();
}

/** Fix round 2: resumes a row this platform already recorded, idempotent via file.ts's item-3 logic
 *  (a linked row short-circuits there; an unlinked one finishes). Used both when the recipient
 *  resolves normally to the SAME account as the stored row, and for the orphan retry below, where the
 *  recipient no longer resolves at all but a `filed` row from an earlier, interrupted attempt proves
 *  this message was already accepted. */
async function resumeExisting(
  deps: PipelineDeps, row: InboundEmailRow, contactId: string,
  // A row THIS call just inserted already has its sender match in hand (firstRunMatch below) —
  // undefined means "work it out", which a found-earlier row (never inserted by this call) needs.
  precomputedSender?: SenderMatch | null,
): Promise<PipelineOutcome> {
  if (row.status !== "filed") return { status: 200, result: "duplicate" };
  try {
    const sender = precomputedSender !== undefined ? precomputedSender
      : row.messageId !== null ? null : await matchSender(deps.db, row.accountId, contactId, row.fromEmail);
    const result = await fileInboundEmail({ db: deps.db, now: deps.now }, {
      row, contactId, sender, attachmentCount: row.attachmentCount, raiseUnread: true, actor: ACTOR,
    });
    if (result.created) {
      try {
        await deps.forward({ row, contactId, senderName: row.fromName, attachmentCount: row.attachmentCount });
      } catch (e) {
        // Final review M5: forwardToOwner's own fixed reason (`forward: <reason>`, a closed vocabulary)
        // is named; any other message (a database error's free text) is never logged.
        const reason = e instanceof Error ? /^forward: ([a-z_]+)$/.exec(e.message)?.[1] : undefined;
        deps.log(`inbound email: the forward to the owner of account ${row.accountId} failed${reason ? ` (${reason})` : ""}; the filed message stands`);
      }
    }
    return { status: 200, result: result.created ? "filed" : "duplicate" };
  } catch {
    deps.log("inbound email: filing the message failed; 503 so Resend retries");
    return { status: 503, result: "write_failed" };
  }
}

/** Fix round 3 item 2: an existing row's own conversation decides its contact — NEVER the thread the
 *  recipient resolves to on THIS delivery, which (same account, different reply address — a
 *  household's own thread, say) can legitimately be a different conversation than the one this exact
 *  Resend id was already filed under. */
async function contactIdForRow(deps: PipelineDeps, row: InboundEmailRow): Promise<string> {
  const summary = await getConversationSummary(deps.db, row.accountId, row.conversationId);
  if (!summary) throw new Error("no conversation");
  return summary.contactId;
}

export async function handleReceivedEmail(deps: PipelineDeps, data: { email_id?: unknown }): Promise<PipelineOutcome> {
  const emailId = typeof data.email_id === "string" && data.email_id ? data.email_id : null;
  if (!emailId) { deps.log("inbound email: event with no email id, dropped"); return { status: 200, result: "dropped" }; }

  let email;
  try {
    email = await deps.fetchEmail(emailId);
  } catch {
    deps.log("inbound email: the received email could not be fetched; 503 so Resend retries");
    return { status: 503, result: "fetch_failed" };
  }

  // Fix round 2 item 1, spec step 2 order: look up any row already recorded under THIS Resend id,
  // account-agnostic, BEFORE resolving the recipient — the row (when one exists) is the ground truth
  // of which account already accepted this exact message, independent of whether the recipient still
  // resolves the same way on a retry.
  let existingRow: InboundEmailRow | null;
  try {
    existingRow = await findInboundEmailByProviderId(deps.db, email.id);
  } catch {
    deps.log("inbound email: checking for an already-recorded row failed; 503 so Resend retries");
    return { status: 503, result: "write_failed" };
  }

  // Step 3: the recipient. Fix round 1 item 5/6b: the envelope (A4) is authoritative whenever Resend
  // supplies one — `to` is consulted only when `received_for` is EMPTY, never merged with it, so a
  // message addressed (in `to`) to one thread but ENVELOPED (in `received_for`) to another always
  // files on the envelope's thread, never the header a sender fully controls.
  let thread = null;
  let toEmail: string | null = null;
  let reason = "no reply address";
  let rejectedAccountId: string | null = null;
  try {
    const candidates = email.receivedFor.length > 0 ? email.receivedFor : email.to;
    for (const raw of candidates) {
      const addr = parseReplyAddress(raw);
      if (!addr) continue;
      const t = await findReplyThread(deps.db, addr.token);
      if (!t) { reason = "unknown reply address"; continue; }
      if (t.revoked) { reason = "revoked reply address"; rejectedAccountId = t.accountId; continue; }
      if (addr.domain !== BIS_REPLY_DOMAIN && addr.domain !== t.inboundDomain) { reason = "reply domain not the account's"; rejectedAccountId = t.accountId; continue; }
      thread = t; toEmail = bareAddress(raw); break;
    }
  } catch {
    deps.log("inbound email: recipient resolution failed; 503 so Resend retries");
    return { status: 503, result: "write_failed" };
  }

  if (!thread || !toEmail) {
    // Fix round 2: an orphan from an earlier, interrupted attempt — this exact message was already
    // accepted and filed under SOME account, even though the recipient no longer resolves this time
    // (a token revoked between attempts, say) — resumes rather than being dropped as if never seen.
    if (existingRow && existingRow.status === "filed") {
      let contactId: string;
      try {
        contactId = await contactIdForRow(deps, existingRow);
      } catch {
        deps.log("inbound email: resuming an orphaned row failed; 503 so Resend retries");
        return { status: 503, result: "write_failed" };
      }
      return await resumeExisting(deps, existingRow, contactId);
    }
    // Fix round 1 item 6g: the account id goes in when a thread WAS found and then rejected
    // (revoked / wrong domain) — never for "unknown"/"no reply address", where there is none to name.
    deps.log(`inbound email: dropped (${reason})${rejectedAccountId ? ` account=${rejectedAccountId}` : ""}`);
    return { status: 200, result: "dropped" };
  }

  // Fix round 2 item 1: a row already recorded for this Resend id, found before the recipient was
  // even resolved. Under the SAME account as what just resolved, it is this exact delivery seen
  // again — resume it (never re-record). Under a DIFFERENT account, the one global Resend id is
  // claimed by another tenant already: dropped, with no account named either way (both are real
  // tenants, never logged).
  if (existingRow) {
    if (existingRow.accountId !== thread.accountId) {
      deps.log("inbound email: dropped (provider id already recorded under a different account)");
      return { status: 200, result: "dropped" };
    }
    // Fix round 3 item 2: the existing row's OWN conversation, never the thread this delivery's
    // recipient happens to resolve to — same account, but possibly a different household member's
    // thread than the one this exact Resend id was already filed under.
    let contactId: string;
    try {
      contactId = await contactIdForRow(deps, existingRow);
    } catch {
      deps.log("inbound email: resuming an already-recorded row failed; 503 so Resend retries");
      return { status: 503, result: "write_failed" };
    }
    return await resumeExisting(deps, existingRow, contactId);
  }

  let row: InboundEmailRow;
  let rowCreated: boolean;
  let firstRunMatch: SenderMatch | null = null;
  try {
    // Step 4: the sender check, both halves. Fix round 1 item 2: `email.from` can itself be null (a
    // malformed or stripped header) — `bareAddress` already tolerates that, but the RAW fallback
    // below must too, or a null From throws before this ever reaches the ledger.
    const fromEmail = bareAddress(email.from);
    const verdict = readSesVerdict(parseHeaderBlock(email.rawHeaders ?? ""));
    const authenticated = senderAuthenticated(verdict, fromEmail ? domainOf(fromEmail) : null);
    const match = fromEmail ? await matchSender(deps.db, thread.accountId, thread.contactId, fromEmail) : null;
    const filed = authenticated && match !== null;
    // Final review M2: an empty or whitespace-only text part is absent, not the reply — some clients
    // send `text: ""` beside the real HTML, which used to file a blank message no stop could be read in.
    const text = newText(email.text?.trim() ? email.text : (email.html ? htmlToText(email.html) : ""));
    // Carried past the narrower try/catch below for step 5/7, which needs `match` only when this
    // call is the one that just inserted the row (the retry path re-reads it itself).
    firstRunMatch = match;

    try {
      const recorded = await recordInboundEmail(deps.db, {
        accountId: thread.accountId, conversationId: thread.conversationId, providerEmailId: email.id,
        fromEmail: fromEmail ?? (email.from ?? "").slice(0, 320), fromName: displayName(email.from), toEmail,
        subject: email.subject, text, auth: authRecord(verdict), attachmentCount: email.attachmentCount,
        status: filed ? "filed" : "held", holdReason: filed ? null : (authenticated ? "not_on_record" : "unverified"),
        decidedBy: filed ? ACTOR.id : null, receivedAt: receivedAtOf(email.receivedAt, deps.now),
      });
      row = recorded.row;
      rowCreated = recorded.created;
    } catch (e) {
      // Fix round 3 item 3: narrowed to THIS call only (never a sender-check failure above, which
      // must still fall through to the generic 503 below), and matched on the stable marker
      // `@bis/db` itself exports for exactly this error — never the surrounding prose. Fix round 2
      // item 1: a race between this call's own lookup earlier (which found nothing) and this insert
      // (which collided with a row another process just wrote under a DIFFERENT account) is the same
      // "already claimed elsewhere" case the lookup catches up front — 200 dropped, never a 503
      // Resend would retry forever on a collision that can never resolve itself.
      if (e instanceof Error && e.message.includes(INBOUND_EMAIL_COLLISION)) {
        deps.log("inbound email: dropped (provider id recorded under a different account during a race)");
        return { status: 200, result: "dropped" };
      }
      throw e;
    }
  } catch {
    deps.log("inbound email: recording the inbound row failed; 503 so Resend retries");
    return { status: 503, result: "write_failed" };
  }

  if (row.status !== "filed") {
    return { status: 200, result: rowCreated ? "held" : "duplicate" };
  }
  // Step 5, 7, 8 (fix round 1 item 6h: "filed" vs "duplicate" decided by whether FILING just
  // completed, never by whether the row insert was new) — the same resume path the two existing-row
  // branches above use, so a retry's idempotency logic lives in exactly one place.
  return await resumeExisting(deps, row, thread.contactId, rowCreated ? firstRunMatch : undefined);
}
