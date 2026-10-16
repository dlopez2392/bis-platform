import { findReplyThread, matchSender, recordInboundEmail, type InboundEmailRow, type SupabaseClient } from "@bis/db";
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

  try {
    // Step 3: the recipient. The envelope first (A4), then To. The first r- address that resolves wins.
    let thread = null;
    let toEmail: string | null = null;
    let reason = "no reply address";
    for (const raw of [...email.receivedFor, ...email.to]) {
      const addr = parseReplyAddress(raw);
      if (!addr) continue;
      const t = await findReplyThread(deps.db, addr.token);
      if (!t) { reason = "unknown reply address"; continue; }
      if (t.revoked) { reason = "revoked reply address"; continue; }
      if (addr.domain !== BIS_REPLY_DOMAIN && addr.domain !== t.inboundDomain) { reason = "reply domain not the account's"; continue; }
      thread = t; toEmail = bareAddress(raw); break;
    }
    if (!thread || !toEmail) {
      deps.log(`inbound email: dropped (${reason})`);
      return { status: 200, result: "dropped" };
    }

    // Step 4: the sender check, both halves.
    const fromEmail = bareAddress(email.from);
    const verdict = readSesVerdict(parseHeaderBlock(email.rawHeaders ?? ""));
    const authenticated = senderAuthenticated(verdict, fromEmail ? domainOf(fromEmail) : null);
    const match = fromEmail ? await matchSender(deps.db, thread.accountId, thread.contactId, fromEmail) : null;
    const filed = authenticated && match !== null;
    const text = newText(email.text ?? (email.html ? htmlToText(email.html) : ""));

    const { row, created } = await recordInboundEmail(deps.db, {
      accountId: thread.accountId, conversationId: thread.conversationId, providerEmailId: email.id,
      fromEmail: fromEmail ?? email.from.slice(0, 320), fromName: displayName(email.from), toEmail,
      subject: email.subject, text, auth: authRecord(verdict), attachmentCount: email.attachmentCount,
      status: filed ? "filed" : "held", holdReason: filed ? null : (authenticated ? "not_on_record" : "unverified"),
      decidedBy: filed ? ACTOR.id : null, receivedAt: new Date(email.receivedAt || deps.now()).toISOString(),
    });

    if (row.status !== "filed") {
      return { status: 200, result: created ? "held" : "duplicate" };
    }
    // Step 5 and 7 (and the retry of a 503'd one): idempotent.
    const sender = created ? match : await matchSender(deps.db, row.accountId, thread.contactId, row.fromEmail);
    const result = await fileInboundEmail({ db: deps.db, now: deps.now }, {
      row, contactId: thread.contactId, sender, attachmentCount: row.attachmentCount, raiseUnread: true, actor: ACTOR,
    });
    // Step 8: only a message this delivery created is forwarded.
    if (result.created) {
      try {
        await deps.forward({ row, contactId: thread.contactId, senderName: row.fromName, attachmentCount: row.attachmentCount });
      } catch {
        deps.log(`inbound email: the forward to the owner of account ${row.accountId} failed; the filed message stands`);
      }
    }
    return { status: 200, result: created ? "filed" : "duplicate" };
  } catch {
    deps.log("inbound email: a write failed; 503 so Resend retries");
    return { status: 503, result: "write_failed" };
  }
}
