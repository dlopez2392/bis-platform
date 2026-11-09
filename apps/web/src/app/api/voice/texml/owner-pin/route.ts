// apps/web/src/app/api/voice/texml/owner-pin/route.ts
// The owner line's PIN and call-in code step (F-032 §3.2, §4.2). /api/voice/texml asked a registered cell for a
// PIN (or for the code shown on their screen) with <Gather>; Telnyx posts the keys here.
//
// TELNYX-SIGNED OR NOTHING. A request whose signature fails is refused 403 by the shared reader before this file
// reads a thing (../telnyx-request.ts). An UNSIGNED request (TELNYX_PUBLIC_KEY unset) checks nothing and gets today's
// path, unsigned: this route would otherwise be an oracle anyone could feed a caller ID and guesses (spec §4.2:
// "must carry a valid Telnyx signature"), and its one bridge that carries an owner pass (../route.ts
// ownerLineBridge) is minted as Telnyx-signed by construction. That guard is what makes the construction true.
// GET is 405 always, because a GET carries no signed body.
//
// The account and the person are re-derived from the SIGNED To/From on every request; nothing on the query string is
// trusted. The role is re-checked against OWNER_LINE_ROLES here (O-1 = F2: Owner and Staff), because the two SQL
// attempt functions check no role at all. A PIN check happens only in SQL (owner_line_attempt_pin), under a row lock
// that owns the counter and the lock.
//
// LOGS carry statuses and the account id only: never the caller's number, the digits, the code or its hash, and
// for a failure the error's CLASS, never its message (a message can quote any of those).
//
// WHAT THE CALLER GETS. Every path that is not the owner's own ends in TODAY'S PATH: answer() with the screen and the
// owner line skipped, which re-runs every customer check (a refusal is spoken and recorded in screened_calls, a
// clear call gets the cleared bridge). Never a hang-up of this route's own (plan I-3, spec §2.1).
//   - pound, a timeout, or no digits: today's path, and NOT an attempt;
//   - the right PIN: today's bridge with the owner pass, bound to THAT dial's handoff token (ownerLineBridge),
//     once today's states are re-read (ownerLineStillOffered);
//   - a wrong PIN, 1st or 2nd: asked again; the re-ask re-reads today's verdicts for its own fallthrough;
//   - the 3rd wrong PIN: the lock, today's path as a customer, and the two emails, prepared and sent after the response;
//   - no OWNER_LINE_PIN_PEPPER (plan O-3): today's path, and no attempt is counted against the person;
//   - a call-in code: verified (a goodbye), wrong (asked again), spent or unknown (today's path; the card tells the
//     person to make a new code);
//   - the right PIN while today's path no longer reaches Sofía (the forward, billing, the drill): today's path;
//   - no usable VOICE_HANDOFF_SECRET: today's path, nothing checked (SC-14);
//   - anything that throws: today's path (fail closed); only if that throws too, the last-resort bridge, never a 500.
//
// No module-scope @bis/db, directly or through anything imported here (plan SC-18; ../texml-no-static-db.test.ts):
// the database is imported inside the handler, and the lockout module (which reaches it through the email gate)
// only inside after(), once the caller has been answered (lockoutEmailsAfterResponse).
import { NextResponse, after } from "next/server";
import { e164Of } from "@/lib/voice/phone-number";
import {
  actionOrigin, answer, bridgeAfterFailure, ownerLineBridge, ownerLineGatherAgain, ownerLineStillOffered, xmlResponse,
} from "../route";
import { logFormFields, readTelnyxForm } from "../telnyx-request";
import { ownerVerifiedXml } from "../owner-line-xml";
import { candidateFor, hashVerifyCode, pinPepperConfigured } from "@/lib/owner-line/secrets";
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import { sipHandoffSecretConfigured } from "@/lib/voice/sip-handoff-signature";

export const runtime = "nodejs";
const SIX = /^[0-9]{6}$/;

/** An error as a log line may name it: its class only. */
const errorClass = (e: unknown) => (e instanceof Error ? e.name : typeof e);

/**
 * The third wrong PIN's two emails (spec §4.2), entirely OFF Telnyx's answer deadline.
 *   - The lock instant is captured HERE, before after() defers anything, so the email's "at 2:14 PM" is when the PIN
 *     was wrong a third time, not whenever the deferred work runs (Task 8's m-7).
 *   - The lockout module is imported INSIDE after(), never before the response: it reaches @bis/db through the email
 *     gate (SC-18; ../texml-no-static-db.test.ts), and its chunk is about 613 KB with the catalogue, which a cold
 *     load would otherwise spend on the carrier's clock.
 *   - after() itself throws synchronously outside a request scope; that throw is caught here, so it can never turn
 *     this caller's today's path into the last-resort bridge. The deferred work has its own catch, so nothing it
 *     does can reject unseen. Both log the error's class and the account only.
 */
function lockoutEmailsAfterResponse(
  p: { accountId: string; userId: string; lockedUntil: string; accountLanguage: "en" | "es" | null },
): void {
  const at = new Date();
  try {
    after(async () => {
      try {
        const { sendOwnerLineLockoutEmails } = await import("@/lib/owner-line/lockout");
        await sendOwnerLineLockoutEmails({ ...p, at });
      } catch (e) {
        console.error(`texml owner-pin: lockout emails failed (${errorClass(e)}), accountId ${p.accountId}`);
      }
    });
  } catch (e) {
    console.error(`texml owner-pin: lockout emails could not be scheduled (${errorClass(e)}), accountId ${p.accountId}`);
  }
}

async function decide(form: URLSearchParams, origin: string, authenticated: boolean): Promise<NextResponse> {
  const called = e164Of(form.get("To") || null);
  const caller = e164Of(form.get("From") || null);
  const today = () => answer(called, caller, origin, authenticated, { skipScreen: true, skipOwnerLine: true });
  try {
    if (!authenticated) {
      console.error("texml owner-pin: request not Telnyx-signed — today's path, nothing checked");
      return await today();
    }
    // Review m-3 (SC-14): with no usable VOICE_HANDOFF_SECRET no owner pass can be signed, so no PIN is checked and no
    // attempt is counted against anyone: today's path.
    if (!sipHandoffSecretConfigured()) {
      console.error("texml owner-pin: VOICE_HANDOFF_SECRET is not usable — today's path, nothing checked");
      return await today();
    }
    if (!called || !caller) {
      console.log("texml owner-pin: no called or caller number — today's path");
      return await today();
    }
    const {
      serviceDb, getPhoneNumberByE164, ownerLineAnswerLookup, attemptOwnerLineVerify, attemptOwnerLinePin,
      OWNER_LINE_MAX_CALLS_PER_DAY,
    } = await import("@bis/db");
    const db = serviceDb();
    const line = await getPhoneNumberByE164(db, called);
    if (!line || (line.status !== "testing" && line.status !== "live")) {
      console.log("texml owner-pin: the called number is not live — today's path");
      return await today();
    }
    const who = `accountId ${line.account_id}`;
    const look = await ownerLineAnswerLookup(db, line.account_id, caller, OWNER_LINE_MAX_CALLS_PER_DAY);
    if ((look.status !== "verify" && look.status !== "pin") || !OWNER_LINE_ROLES.includes(look.role)) {
      console.log(`texml owner-pin: not asked here (${look.status}) — today's path, ${who}`);
      return await today();
    }
    const locale = look.language ?? look.accountLanguage ?? "en";
    // The finish key ends the entry; Telnyx may or may not include it (owner-line-xml.ts header, (b)).
    const digits = (form.get("Digits") ?? "").trim().replace(/#+$/, "");

    if (look.status === "verify") {
      if (!SIX.test(digits)) {
        console.log(`texml owner-pin: no call-in code entered — today's path, ${who}`);
        return await today();
      }
      const r = await attemptOwnerLineVerify(db, line.account_id, caller, hashVerifyCode(digits));
      console.log(`texml owner-pin: call-in code ${r}, ${who}`);
      if (r === "verified") return xmlResponse(ownerVerifiedXml(locale));
      if (r === "wrong") return await ownerLineGatherAgain(called, caller, origin, { kind: "verify", locale, accountId: line.account_id, name: look.name });
      // spent (expired, or the third wrong code) and none: TODAY'S PATH, never a hang-up (plan I-3, spec §2.1).
      return await today();
    }

    if (digits === "") {
      console.log(`texml owner-pin: pound or no PIN — today's path, ${who}`);
      return await today();
    }
    // No pepper (O-3) is a deployment fault: today's path, and NO attempt is counted against the person.
    if (!pinPepperConfigured()) {
      console.error(`texml owner-pin: OWNER_LINE_PIN_PEPPER is not set — today's path, nothing checked, ${who}`);
      return await today();
    }
    // A short or malformed entry is still an attempt: it is a wrong PIN, counted like one.
    const candidate = (await candidateFor(digits, look.pinParams ?? "")) ?? "invalid";
    const r = await attemptOwnerLinePin(db, look.enrollmentId, candidate);
    console.log(`texml owner-pin: PIN ${r.status}, ${who}`);
    if (r.status === "ok") {
      // Review m-4: the pass only while today's path still reaches Sofía (the forward, billing's no-voice, the drill,
      // VOICE_FORWARD_TO, each re-read; ../route.ts ownerLineStillOffered). Otherwise today's path, with no pass.
      if (!(await ownerLineStillOffered(called, caller, line.account_id))) return await today();
      return ownerLineBridge(called, caller, origin, { accountId: line.account_id, userId: look.userId, role: look.role });
    }
    if (r.status === "wrong") return await ownerLineGatherAgain(called, caller, origin, { kind: "pin", locale, accountId: line.account_id, name: look.name });
    if (r.status === "locked_now") {
      lockoutEmailsAfterResponse({ accountId: line.account_id, userId: look.userId, lockedUntil: r.lockedUntil, accountLanguage: look.accountLanguage });
    }
    // locked_now, locked (another call locked it first) and none: today's path, as a customer.
    return await today();
  } catch (e) {
    // Review m-2 (orchestrator decision): FAIL CLOSED to today's path, which re-runs every customer check, so an
    // over-cap caller still hears the cap sentence and the screened_calls row is still written. Only if today's
    // path ALSO throws is it the last-resort bridge, never a 500.
    console.error(`texml owner-pin failed (${errorClass(e)}) — today's path for ${called ?? "unknown"}`);
    try {
      return await today();
    } catch (e2) {
      console.error(`texml owner-pin: today's path failed too (${errorClass(e2)}) — the last-resort bridge, for ${called ?? "unknown"}`);
      return bridgeAfterFailure(called, caller, origin, authenticated);
    }
  }
}

export async function GET(): Promise<NextResponse> {
  return new NextResponse(null, { status: 405 });
}

export async function POST(req: Request): Promise<NextResponse> {
  const read = await readTelnyxForm(req, "texml owner-pin", { logCaller: false });
  if (!read.ok) return read.response;
  // Field NAMES only (telnyx-request.ts): `Digits` appears as a name, and its value is never printed.
  logFormFields("texml owner-pin", read.form);
  return decide(read.form, actionOrigin(req), read.authenticated);
}
