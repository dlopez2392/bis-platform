import { readConsentState, readAccountTimezone, getMailingAddress, type SupabaseClient } from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { getEmailProvider } from "@/lib/email";
import { isProductionEnv } from "@/lib/email/environment";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "@/lib/email/types";
import { configuredOrigin } from "@/lib/email/origin";
import { escapeHtml, UNSUBSCRIBE_MARKER } from "@/lib/email/templates/shell";
import { loggableError } from "@/lib/loggable-error";
import { m } from "@/lib/messages";
import { EMAIL_KINDS, isEmailKind, emailReadsLedger, FOOTER_ADDRESS_KINDS, type EmailKind, type OperatorEmailKind } from "./classes";
import { nextOpening, expiresBeforeOpening, hoursZone } from "./hours";
import { sealConsentToken, consentTokenSecrets, isUuid } from "./token";

/**
 * THE EMAIL GATE (consent chain spec §4.3 "Routing"; plan G1). The only
 * module outside lib/email's own provider files that may reach an email
 * provider (scan 1, scans.test.ts). Every one of the twenty-two email send
 * sites comes through `sendEmail` — directly, through `sendEmailOrThrow`,
 * through a cron tick's `ctx.email` (`emailSenderFor`), or through
 * `operatorMailer` for the two operator paths that take a provider.
 *
 * The steps, in order:
 *   1. a kind missing from the registry THROWS (a programming error), and so
 *      does a customer kind with no account;
 *   2. `to` is keyed as the ledger keys it (emailLedgerAddress); nothing to
 *      key → blocked `no_address`;
 *   3. an informational or marketing kind — automated mail, what an
 *      unsubscribe stops (decision 7) — reads the ledger: stopped → blocked
 *      `stopped`, held → blocked `held`. Customer-initiated, staff-typed and
 *      operator kinds pass without reading it (decision 7, choices 22, 23);
 *   4. an automated kind keeps the fixed automated hours (choice 31): outside
 *      them → `deferred`, unless the deadline falls first (choice 21) →
 *      blocked `window_after_deadline`;
 *   4b. decision P1's three follow-ups (FOOTER_ADDRESS_KINDS) read the
 *      account's mailing_address: set → printed under the unsubscribe line;
 *      blank → nothing, and they still send; unreadable → blocked;
 *   5. the provider;
 *   6. a customer email gets its way out: the footer row in place of the
 *      shell's marker, the footer line under the text part, and the RFC 8058
 *      List-Unsubscribe / List-Unsubscribe-Post headers, all carrying ONE
 *      sealed token. In production with no CONSENT_TOKEN_SECRET, a secret
 *      under 32 characters, no origin or an origin that is not https, it is
 *      blocked `unsubscribe_unavailable` — never sent without a working way
 *      out; outside production it goes without them (plan G8). Operator and
 *      staff-typed mail have the marker removed and carry no headers;
 *   7. the send, with the send fields ONLY.
 *
 * FAILS CLOSED: a ledger or zone read error is blocked `ledger_unavailable`,
 * logged through `loggableError`, never a send. Never logs a token or an
 * address.
 */
export type EmailRequest = Omit<SendEmailInput, "headers"> & {
  /** The business the email is from. Null only for operator mail with no
   *  account (the agency roll-up). */
  accountId: string | null;
  kind: EmailKind;
  /** The contact it goes to, when known: evidence in the token, nothing more. */
  contactId?: string | null;
  /** The email's language, which picks the footer's. English by default. */
  language?: "en" | "es";
  /** The request's own origin, for the unsubscribe links when APP_ORIGIN is
   *  unset (origin.ts: APP_ORIGIN wins whenever it is set). */
  origin?: string | null;
  /** The instant the hours are judged at. Passes hand in their tick's `now`. */
  now?: Date;
  /** The account's zone when the caller has it. `undefined` → read. */
  accountZone?: string | null;
  /** Choice 21: the latest instant this email is still useful. */
  deadline?: Date | null;
};

export type EmailBlockReason =
  | "no_address" | "stopped" | "held" | "window_after_deadline" | "ledger_unavailable" | "unsubscribe_unavailable";

export type EmailSendResult =
  | { kind: "sent"; providerMessageId: string }
  | { kind: "deferred"; until: Date; zone: string }
  | { kind: "blocked"; reason: EmailBlockReason }
  | { kind: "failed"; stage: "provider_unavailable" | "provider"; error: string };

export type EmailGateDeps = { db?: SupabaseClient | null; env?: NodeJS.ProcessEnv };

type Links = { page: string; oneClick: string };

/** The email dialect (inline, literal), the shell's own muted grey. */
const FOOTER_CELL = "padding-top:16px;font-size:13px;line-height:1.5;color:#71717a;";
const FOOTER_LINK = "color:#71717a;text-decoration:underline;";

function cleanOrigin(origin: string | null | undefined): string | null {
  const o = origin?.trim().replace(/\/+$/, "");
  return o && /^https?:\/\/[^/\s]+$/.test(o) ? o : null;
}

/** The shortest secret production seals with (plan G8, review R1-M3). */
const MIN_SECRET_LENGTH = 32;

/** The two links, null when this send goes without them, or "unavailable". */
function unsubscribeLinks(req: EmailRequest, address: string, now: Date, env: NodeJS.ProcessEnv): Links | null | "unavailable" {
  const secret = consentTokenSecrets(env).current;
  const origin = configuredOrigin(env) ?? cleanOrigin(req.origin);
  if (isProductionEnv(env) && secret && origin) {
    // RFC 8058: List-Unsubscribe "MUST contain one HTTPS URI"; and no token is
    // sealed in production with a short key (reviews R1-M3, R1-M4, R2-m7).
    const weak = !origin.startsWith("https://") ? "the link's origin is not https"
      : secret.length < MIN_SECRET_LENGTH ? `CONSENT_TOKEN_SECRET is shorter than ${MIN_SECRET_LENGTH} characters` : null;
    if (weak) {
      console.error(`email gate: ${req.kind} for account ${req.accountId} not sent, its unsubscribe link cannot be made: ${weak}`);
      return "unavailable";
    }
  }
  if (!secret || !origin) {
    const missing = !secret ? "CONSENT_TOKEN_SECRET is not set" : "no origin for the link (APP_ORIGIN)";
    if (isProductionEnv(env)) {
      console.error(`email gate: ${req.kind} for account ${req.accountId} not sent, its unsubscribe link cannot be made: ${missing}`);
      return "unavailable";
    }
    console.info(`email gate: ${req.kind} goes without an unsubscribe link outside production (${missing})`);
    return null;
  }
  const token = sealConsentToken({
    v: 1, a: req.accountId!, c: "email", t: address, i: now.getTime(),
    n: isUuid(req.contactId) ? req.contactId : null, k: req.kind,
  }, secret);
  return { page: `${origin}/u/${token}`, oneClick: `${origin}/api/unsubscribe/${token}` };
}

/**
 * D-016 item 1: the account id and, when it is a uuid, the contact id — on
 * EVERY gated send, so the Resend webhook can attribute a bounce or a
 * complaint back to its account from the tags alone, without falling back
 * to the messages row (older composer sends carry no tags at all). `null`
 * for operator mail with no account (the agency roll-up): nothing to tag.
 * Verified against Resend's docs: tags are an array of {name, value}, ASCII
 * letters/numbers/`_`/`-` only — a uuid satisfies that — and are echoed back
 * on the webhook event.
 */
function emailTags(req: EmailRequest): { name: string; value: string }[] | undefined {
  if (!req.accountId) return undefined;
  const tags = [{ name: "account_id", value: req.accountId }];
  if (isUuid(req.contactId)) tags.push({ name: "contact_id", value: req.contactId });
  return tags;
}

/** The send fields, and nothing of the gate's own. */
function sendFields(req: EmailRequest): SendEmailInput {
  const tags = emailTags(req);
  return {
    to: req.to, fromName: req.fromName,
    ...(req.fromAddress !== undefined ? { fromAddress: req.fromAddress } : {}),
    ...(req.replyTo !== undefined ? { replyTo: req.replyTo } : {}),
    subject: req.subject, body: req.body,
    ...(tags ? { tags } : {}),
  };
}

function withoutFooter(req: EmailRequest): SendEmailInput {
  return { ...sendFields(req), ...(req.html ? { html: req.html.split(UNSUBSCRIBE_MARKER).join("") } : {}) };
}

/** A stored postal address as lines: CRLF or LF, edges trimmed, blanks dropped (marketing-footer.ts's rule). */
function addressLines(raw: string | null): string[] {
  return (raw ?? "").split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
}

function withFooter(req: EmailRequest, links: Links | null, postal: readonly string[]): SendEmailInput {
  if (req.html !== undefined && !req.html.includes(UNSUBSCRIBE_MARKER)) {
    throw new Error(`email gate: ${req.kind}'s html has no unsubscribe marker (render it with shell())`);
  }
  const cells: string[] = [];
  const lines: string[] = [];
  if (links) {
    const lang = req.language === "es" ? "es" : "en";
    const lead = m[`email.unsubscribe.lead.${lang}`];
    const label = m[`email.unsubscribe.link.${lang}`];
    cells.push(`${escapeHtml(lead)} <a href="${escapeHtml(links.page)}" style="${FOOTER_LINK}">${escapeHtml(label)}</a>.`);
    lines.push(`${lead} ${label}: ${links.page}`);
  }
  // Decision P1 (G18): the postal address, under the way out, when it is set.
  if (postal.length > 0) {
    cells.push(postal.map(escapeHtml).join("<br>"));
    lines.push(postal.join("\n"));
  }
  if (cells.length === 0) return withoutFooter(req);
  const row = `<tr><td style="${FOOTER_CELL}">${cells.join("<br><br>")}</td></tr>`;
  return {
    ...sendFields(req),
    body: `${req.body}\n\n${lines.join("\n\n")}`,
    ...(req.html ? { html: req.html.replace(UNSUBSCRIBE_MARKER, () => row) } : {}),
    ...(links ? { headers: { "List-Unsubscribe": `<${links.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
  };
}

export async function sendEmail(req: EmailRequest, deps: EmailGateDeps = {}): Promise<EmailSendResult> {
  const env = deps.env ?? process.env;
  if (!isEmailKind(req.kind)) throw new Error(`email gate: unknown email kind "${String(req.kind)}"`);
  const spec = EMAIL_KINDS[req.kind];
  if (spec.class !== "operator" && !req.accountId) throw new Error(`email gate: ${req.kind} needs its account`);
  const address = emailLedgerAddress(req.to);
  if (!address) return { kind: "blocked", reason: "no_address" };
  const now = req.now ?? new Date();

  if (emailReadsLedger(req.kind)) {
    if (!deps.db) throw new Error(`email gate: ${req.kind} reads the ledger and needs a client`);
    try {
      const state = await readConsentState(deps.db, req.accountId!, "email", address);
      if (state.state === "stopped") return { kind: "blocked", reason: "stopped" };
      if (state.state === "held") return { kind: "blocked", reason: "held" };
    } catch (e) {
      console.error(`email gate: ${req.kind} for account ${req.accountId} blocked, consent state unreadable: ${loggableError(e)}`);
      return { kind: "blocked", reason: "ledger_unavailable" };
    }
  }

  if (spec.hours !== "any") {
    let zone: string | null;
    if (req.accountZone !== undefined) {
      zone = req.accountZone;
    } else {
      if (!deps.db) throw new Error(`email gate: ${req.kind} needs a client to read the account's zone`);
      try {
        zone = await readAccountTimezone(deps.db, req.accountId!);
      } catch (e) {
        console.error(`email gate: ${req.kind} for account ${req.accountId} blocked, zone unreadable: ${loggableError(e)}`);
        return { kind: "blocked", reason: "ledger_unavailable" };
      }
    }
    const opening = nextOpening(spec.hours, now, zone);
    if (expiresBeforeOpening(opening, req.deadline)) return { kind: "blocked", reason: "window_after_deadline" };
    if (opening) return { kind: "deferred", until: opening, zone: hoursZone(zone) };
  }

  // Decision P1 (G18): the three follow-ups whose templates print no postal
  // address get the account's, whenever it is set. Blank never blocks them;
  // an unreadable one is a re-hold, never a send without it.
  let postal: string[] = [];
  if (FOOTER_ADDRESS_KINDS.has(req.kind)) {
    if (!deps.db) throw new Error(`email gate: ${req.kind} reads the mailing address and needs a client`);
    try {
      postal = addressLines(await getMailingAddress(deps.db, req.accountId!));
    } catch (e) {
      console.error(`email gate: ${req.kind} for account ${req.accountId} blocked, mailing address unreadable: ${loggableError(e)}`);
      return { kind: "blocked", reason: "ledger_unavailable" };
    }
  }

  let provider: EmailProvider;
  try {
    provider = getEmailProvider(env);
  } catch (e) {
    return { kind: "failed", stage: "provider_unavailable", error: e instanceof Error ? e.message : String(e) };
  }

  let input: SendEmailInput;
  if (spec.footer === "unsubscribe") {
    const links = unsubscribeLinks(req, address, now, env);
    if (links === "unavailable") return { kind: "blocked", reason: "unsubscribe_unavailable" };
    input = withFooter(req, links, postal);
  } else {
    input = withoutFooter(req);
  }

  try {
    const { providerMessageId } = await provider.send(input);
    return { kind: "sent", providerMessageId };
  } catch (e) {
    return { kind: "failed", stage: "provider", error: e instanceof Error ? e.message : String(e) };
  }
}

/** The gate said no. `message` is the provider's own words for a failure. */
export class EmailNotSent extends Error {
  constructor(readonly result: Exclude<EmailSendResult, { kind: "sent" }>) {
    super(result.kind === "failed" ? result.error
      : result.kind === "blocked" ? `email not sent: ${result.reason}`
      : `email deferred until ${result.until.toISOString()}`);
    this.name = "EmailNotSent";
  }
}

/** `sendEmail` for a caller whose existing catch handles a throw. */
export async function sendEmailOrThrow(req: EmailRequest, deps: EmailGateDeps = {}): Promise<SendEmailResult> {
  const r = await sendEmail(req, deps);
  if (r.kind === "sent") return { providerMessageId: r.providerMessageId };
  throw new EmailNotSent(r);
}

/** What a cron tick's `ctx.email` is (harness.ts): the gate, bound to the tick's client. */
export type GatedEmail = {
  readonly isFake: boolean;
  send(input: EmailRequest): Promise<SendEmailResult>;
};

/** Builds the provider ONCE, eagerly: a production tick with Resend unset
 *  fails at construction, before any query (context.ts's designed failure).
 *  That instance is only the fail-fast check and `isFake`: each send builds
 *  its own through `sendEmail`'s `getEmailProvider(env)` (a client object, no
 *  network), so the gate's per-send rules never depend on this one (review
 *  R2-m9). */
export function emailSenderFor(db: SupabaseClient, env: NodeJS.ProcessEnv = process.env): GatedEmail {
  const provider = getEmailProvider(env);
  return { isFake: provider.isFake, send: (input) => sendEmailOrThrow(input, { db, env }) };
}

/**
 * A provider-shaped sender bound to ONE operator kind (plan G11), for the two
 * operator paths that take an EmailProvider: the sending-address check
 * (preflight.ts, which also reads `isFake`) and the billing link
 * (billing-link.ts). It rethrows the provider's own words. It builds the
 * provider at once, exactly where the `getEmailProvider()` call it replaces
 * did, so a production deployment with Resend unset throws where it threw
 * before; each send then goes through `sendEmail` (review R2-m9).
 */
export function operatorMailer(kind: OperatorEmailKind, accountId: string | null, env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const provider = getEmailProvider(env);
  return {
    isFake: provider.isFake,
    ...(provider.redirectTo !== undefined ? { redirectTo: provider.redirectTo } : {}),
    send: (input) => sendEmailOrThrow({ ...input, accountId, kind }, { env }),
  };
}
