import { findReplyThread, matchSender, recordInboundEmail, type InboundEmailRow, type SenderMatch, type SupabaseClient } from "@bis/db";
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
    // Fix round 1 item 6g: the account id goes in when a thread WAS found and then rejected
    // (revoked / wrong domain) — never for "unknown"/"no reply address", where there is none to name.
    deps.log(`inbound email: dropped (${reason})${rejectedAccountId ? ` account=${rejectedAccountId}` : ""}`);
    return { status: 200, result: "dropped" };
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
    const text = newText(email.text ?? (email.html ? htmlToText(email.html) : ""));

    const recorded = await recordInboundEmail(deps.db, {
      accountId: thread.accountId, conversationId: thread.conversationId, providerEmailId: email.id,
      fromEmail: fromEmail ?? (email.from ?? "").slice(0, 320), fromName: displayName(email.from), toEmail,
      subject: email.subject, text, auth: authRecord(verdict), attachmentCount: email.attachmentCount,
      status: filed ? "filed" : "held", holdReason: filed ? null : (authenticated ? "not_on_record" : "unverified"),
      decidedBy: filed ? ACTOR.id : null, receivedAt: receivedAtOf(email.receivedAt, deps.now),
    });
    row = recorded.row;
    rowCreated = recorded.created;
    // Carried past this try/catch for step 5/7 below, which needs `match` only when this call is
    // the one that just inserted the row (the retry path re-reads it itself).
    firstRunMatch = match;
  } catch {
    deps.log("inbound email: recording the inbound row failed; 503 so Resend retries");
    return { status: 503, result: "write_failed" };
  }

  if (row.status !== "filed") {
    return { status: 200, result: rowCreated ? "held" : "duplicate" };
  }

  try {
    // Step 5 and 7 (and the retry of a 503'd one): idempotent.
    const sender = rowCreated ? firstRunMatch : await matchSender(deps.db, row.accountId, thread.contactId, row.fromEmail);
    const result = await fileInboundEmail({ db: deps.db, now: deps.now }, {
      row, contactId: thread.contactId, sender, attachmentCount: row.attachmentCount, raiseUnread: true, actor: ACTOR,
    });
    // Step 8: only a message this delivery completed (fix round 1 item 3's `created`, not the row's
    // own) is forwarded.
    if (result.created) {
      try {
        await deps.forward({ row, contactId: thread.contactId, senderName: row.fromName, attachmentCount: row.attachmentCount });
      } catch {
        deps.log(`inbound email: the forward to the owner of account ${row.accountId} failed; the filed message stands`);
      }
    }
    // Fix round 1 item 6h: "filed" vs "duplicate" is decided by whether FILING just completed
    // (fileInboundEmail's own `created`), not by whether the ROW insert was new — a retry that
    // files for the first time (the row already existed, held unfiled by an earlier crash) is
    // "filed", never "duplicate".
    return { status: 200, result: result.created ? "filed" : "duplicate" };
  } catch {
    deps.log("inbound email: filing the message failed; 503 so Resend retries");
    return { status: 503, result: "write_failed" };
  }
}
