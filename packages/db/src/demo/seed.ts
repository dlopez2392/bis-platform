import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAccount } from "../accounts";
import { setBranding, uploadBrandLogo, removeBrandLogo } from "../branding";
import { createContact } from "../contacts";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity, moveOpportunityToStage, setOpportunityStatus } from "../opportunities";
import { ensureConversation, createMessage } from "../messaging";
import { getOrCreateCalendar, createBooking, setBookingStatus,
         updateCalendarSettings } from "../booking";
import { setChecklistItem } from "../checklist";
import { setFromEmail } from "../sending-identity";
import { createForm, updateForm, createSubmission, recordRejectedSubmission, linkSubmissionContact } from "../forms";
import { upsertAutomation } from "../automations";
import { upsertSite, writeTrafficDay } from "../sites";
import { assignPhoneNumber, upsertVoiceProfile, startCallRow, finishCallRow } from "../voice";
import { deleteAccountCascade } from "../account-teardown";
import {
  DEMO_ORG_ID, DEMO_ACCOUNT_NAME, DEMO_TIMEZONE, DEMO_BRAND_COLOR,
  DEMO_PEOPLE, DEMO_SERVICES,
  DEMO_EMAIL_RE, DEMO_PHONE_RE, demoPhone, demoEmail,
  demoBusinessLines, demoVercelProjectId,
  DEMO_OPEN_HOURS, DEMO_FROM_EMAIL, DEMO_FORWARDING_TICK_KEY,
  type DemoPerson,
} from "./fiction";
import { DEMO_TRANSCRIPTS } from "./transcripts";

/** Every write is attributed to this. Not a real Clerk user id — it reads in
 *  the event log as what it is, rather than impersonating a person. */
const ACTOR = "system_demo_seed";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * A seeded LCG, not `Math.random`. Phase 2 screenshots this data, and a
 * capture pipeline that re-seeds between two runs needs the same board, the
 * same ordering and the same numbers both times — otherwise every diff is
 * noise and pinning the clock buys nothing. Numerical Recipes' constants; the
 * bar here is "reproducible", not "unpredictable".
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1_664_525, s) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}
type Rng = () => number;

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const between = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ---------------------------------------------------------------------------
// The two walls
// ---------------------------------------------------------------------------

/**
 * Refuses to write anything reachable.
 *
 * Called on each address and number as it goes in, not once over the source
 * list. The check has to sit where a future edit would have to route around
 * it: a value built by string concatenation somewhere else sails straight
 * past a review of `fiction.ts`, and this is the line it cannot pass.
 */
function assertFiction(email: string | undefined, phone: string | undefined, who: string): void {
  if (email !== undefined && !DEMO_EMAIL_RE.test(email)) {
    throw new Error(`demo seed refused: ${who} has a deliverable email ${email}`);
  }
  if (phone !== undefined && !DEMO_PHONE_RE.test(phone)) {
    throw new Error(`demo seed refused: ${who} has a dialable phone ${phone}`);
  }
}

/**
 * Suppresses the account BEFORE it owns a single row, and reads the flag back
 * rather than trusting the update.
 *
 * The ordering is the whole point. The cron ticks every 15 minutes against
 * every account with no filter, so the gap between "account exists" and
 * "account is suppressed" is a gap in which a seeded booking would be due
 * work. Nothing is written into it: the flag goes on while the account is
 * empty, a read confirms it, and only then does seeding begin. A failure here
 * throws with nothing seeded, which is the cheap failure.
 */
async function suppressAndVerify(db: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await db.from("accounts")
    .update({ outbound_suppressed: true }).eq("id", accountId).select("id");
  if (error) throw new Error(`demo seed: could not suppress ${accountId}: ${error.message}`);

  const { data, error: readErr } = await db.from("accounts")
    .select("outbound_suppressed").eq("id", accountId).single();
  if (readErr || !data) throw new Error(`demo seed: could not verify suppression: ${readErr?.message}`);
  if (data.outbound_suppressed !== true) {
    throw new Error(
      `demo seed ABORTED: ${accountId} is not suppressed — refusing to seed contactable data`);
  }
}

/**
 * Runs `fn` over every item with at most `CONCURRENCY` in flight.
 *
 * The seeder makes several hundred small writes and they have no ordering
 * dependency on each other, so doing them strictly one at a time spends the
 * whole seed waiting on round-trip latency. Bounded rather than unbounded
 * because this is the one Supabase project production runs on: a seeder that
 * opens four hundred simultaneous connections is a seeder that degrades the
 * live app while it works.
 */
const CONCURRENCY = 12;

async function inParallel<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
}

/** Rewrites a timestamp column the helpers set to `now()` by default. The
 *  helpers are used deliberately — they validate, emit and enforce the same
 *  rules a real write does — and the price of that is one update per row to
 *  put it back in the past. A seeder is allowed to be chatty. */
async function backdate(
  db: SupabaseClient, table: string, id: string, patch: Record<string, string>,
): Promise<void> {
  const { error } = await db.from(table).update(patch).eq("id", id);
  if (error) throw new Error(`backdate ${table}.${id} failed: ${error.message}`);
}

/**
 * The demo company's own mark: three strokes of moving air on a rounded
 * square, in the brand blue. Invented for this tenant and nobody's trademark.
 *
 * Committed as PNG bytes rather than rendered at seed time, because
 * `uploadBrandLogo` takes png/jpeg/webp only — no SVG — and adding an image
 * pipeline to `@bis/db` to produce one file would be a dependency the library
 * carries forever for a script nobody runs in CI. The SVG sits beside it as
 * the editable source.
 *
 * `import.meta.url`, not `__dirname`: this package is `"type": "module"`, so
 * under tsx there is no `__dirname` to read.
 */
const LOGO_PATH = fileURLToPath(new URL("./assets/resaca-air-mark.png", import.meta.url));

// ---------------------------------------------------------------------------
// Re-seed
// ---------------------------------------------------------------------------

/**
 * The org ids this seeder will touch, at all.
 *
 * `orgId` is injectable so the suite can seed a throwaway account and prove
 * the whole thing end to end against real rows — the alternative is a test
 * that builds and destroys the ACTUAL demo tenant on every CI run, which
 * would leave the demo missing or half-written for the length of a run, in
 * the one Supabase project production also uses.
 *
 * Injectable, but not arbitrary. Clerk mints organisation ids as `org_` plus
 * random base58; it does not mint `org_demo_` or `org_test_` prefixes, so
 * this narrows a destructive function to ids no real organisation can hold.
 * It is the outer of three checks, not the only one: `dropDemoAccount` still
 * requires that the row was found BY this id and that it is suppressed.
 */
const SEEDABLE_ORG_ID = /^org_(demo|test)_[a-z0-9_]+$/;

function assertSeedableOrgId(orgId: string): void {
  if (!SEEDABLE_ORG_ID.test(orgId)) {
    throw new Error(
      `demo seed refused: ${orgId} is not a seedable org id. This function ` +
      `deletes the account it finds, so it only accepts org_demo_* / org_test_*.`);
  }
}

export async function findDemoAccount(
  db: SupabaseClient, orgId: string = DEMO_ORG_ID,
): Promise<{ id: string; outboundSuppressed: boolean } | null> {
  assertSeedableOrgId(orgId);
  const { data, error } = await db.from("accounts")
    .select("id, outbound_suppressed").eq("clerk_org_id", orgId).maybeSingle();
  if (error) throw new Error(`findDemoAccount failed: ${error.message}`);
  return data ? { id: data.id, outboundSuppressed: data.outbound_suppressed === true } : null;
}

/**
 * Removes the existing demo account so a re-seed produces one deterministic
 * board rather than a pile of runs.
 *
 * TWO independent conditions guard the delete, checked HERE and not at the
 * call site. This runs against the same Supabase project as production, so
 * "the caller passed the right id" is not a guarantee worth anything: the row
 * must have been found BY the demo org id, and it must be suppressed. An
 * account that is somehow not suppressed is one this function has no business
 * deleting, because the likeliest explanation is that it is not the demo.
 */
export async function dropDemoAccount(
  db: SupabaseClient, orgId: string = DEMO_ORG_ID,
): Promise<boolean> {
  const existing = await findDemoAccount(db, orgId);
  if (!existing) return false;
  if (!existing.outboundSuppressed) {
    throw new Error(
      `demo seed ABORTED: the account at ${orgId} is not suppressed. Refusing to ` +
      `delete it — an unsuppressed account is not one this seeder created.`);
  }
  // Storage is not covered by the row cascade, and the logo's path is
  // content-addressed under the ACCOUNT id — so a re-seed, which mints a new
  // account id, would orphan the old object in the bucket on every run. Best
  // effort: a stranded 6 KB object is not worth failing a teardown over, and
  // the rows are the part that must go.
  const { data: branded } = await db.from("accounts")
    .select("brand_logo_path").eq("id", existing.id).maybeSingle();
  if (branded?.brand_logo_path) {
    try {
      await removeBrandLogo(db, branded.brand_logo_path);
    } catch (e) {
      console.warn(`dropDemoAccount: left a logo object behind: ${String(e)}`);
    }
  }

  await deleteAccountCascade(db, existing.id, "dropDemoAccount");
  return true;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

type Seeded = { id: string; person: DemoPerson; createdAt: number };

export type SeedCounts = {
  contacts: number; conversations: number; messages: number; calls: number;
  bookings: number; opportunities: number; submissions: number; trafficDays: number;
};

export type SeedResult = { accountId: string; replacedExisting: boolean; counts: SeedCounts };

/**
 * Builds the whole demo tenant. Idempotent by replacement — two runs leave
 * one account, and the second produces the same board as the first.
 *
 * Deliberately NOT re-exported from `index.ts`, and that is enforced rather
 * than merely observed: `@bis/db`'s package `exports` map names `.` and
 * `./search-term` and nothing else, so a deep import of this file from
 * `apps/web` does not resolve. Nothing the web app serves should be able to
 * reach a function that deletes an account.
 *
 * `now` is injectable because Phase 2's capture pipeline pins its clock.
 * Every timestamp is derived from it, so the demo is always "this week"
 * relative to its last seed: a dashboard whose newest call is four months old
 * sells nothing.
 */
export async function seedDemoTenant(
  db: SupabaseClient, opts: { now?: Date; orgId?: string } = {},
): Promise<SeedResult> {
  const now = (opts.now ?? new Date()).getTime();
  const orgId = opts.orgId ?? DEMO_ORG_ID;
  assertSeedableOrgId(orgId);
  const r = rng(0x5e5ca17);

  const replacedExisting = await dropDemoAccount(db, orgId);

  const { id: accountId } = await createAccount(db, {
    clerkOrgId: orgId, name: DEMO_ACCOUNT_NAME, timezone: DEMO_TIMEZONE, actorId: ACTOR,
  });
  await suppressAndVerify(db, accountId);

  // From here on, EVERY failure takes the half-built account with it.
  //
  // This is not tidiness. CI proved the cost: the first run failed inside
  // `backdateEvents` and left a complete account behind — 40 contacts, 34
  // calls, a business line, a site, 60 days of traffic — in the one Supabase
  // project production uses. The NEXT run then failed on something with no
  // apparent connection to the bug, `phone_numbers_e164_key`, because the
  // orphan still held the demo's phone number and `e164` is unique across
  // every account. That is the exact failure `withTestAccount`'s own comment
  // warns about: rows left behind surface later, somewhere else, on a
  // constraint, far from the cause.
  //
  // `dropDemoAccount` re-checks both its guards on the way out, so this
  // cannot delete anything the seeder did not just create. The original
  // error is rethrown — a cleanup failure must never replace the reason the
  // seed failed, which is the thing the operator actually needs to read.
  try {
    return await build();
  } catch (e) {
    try {
      await dropDemoAccount(db, orgId);
    } catch (cleanupError) {
      console.error(`demo seed: failed to remove the half-built account: ${String(cleanupError)}`);
    }
    throw e;
  }

  async function build(): Promise<SeedResult> {
  // Brand name and colour ONLY. `deriveTheme` returns null unless one of
  // neutral/corners/type/mode is set, so a brand colour alone never engages
  // the tenant theme: the dashboard keeps BIS's own lit ground and glass,
  // while the booking page's CTA and the client switcher carry the client's
  // colour and name. That pair is the one worth screenshotting — our
  // aesthetic, their brand.
  const brandLogoPath = await uploadBrandLogo(
    db, accountId, new Uint8Array(fs.readFileSync(LOGO_PATH)), "image/png");
  await setBranding(db, accountId,
    { brandName: DEMO_ACCOUNT_NAME, brandColor: DEMO_BRAND_COLOR, brandLogoPath }, ACTOR);

  await seedVoice(db, accountId, orgId);
  const contacts = await seedContacts(db, accountId, now, r);
  const convos = await seedConversations(db, accountId, contacts, now, r);
  const calls = await seedCalls(db, accountId, contacts, convos, now, r);
  const bookings = await seedBookings(db, accountId, contacts, now, r);
  const opportunities = await seedPipeline(db, accountId, contacts, now, r);
  const submissions = await seedForm(db, accountId, contacts, now, r);
  await seedAutomations(db, accountId);
  await seedSetupState(db, accountId);
  const trafficDays = await seedSite(db, accountId, orgId, now, r);
  await backdateEvents(db, accountId, now);

  return {
    accountId, replacedExisting,
    counts: {
      contacts: contacts.length,
      conversations: convos.length,
      messages: convos.reduce((n, c) => n + c.messages, 0),
      calls, bookings, opportunities, submissions, trafficDays,
    },
  };
  }
}

// ---------------------------------------------------------------------------

/**
 * Takes the first business line in the reserved block that nobody else holds.
 *
 * READ FIRST, then insert. `assignPhoneNumber` reports a duplicate as a bare
 * `Error` carrying the constraint name and nothing else, so probing by
 * insert-and-catch would mean matching on `phone_numbers_e164_key` in a
 * message string — and would still have to tell "somebody holds this" apart
 * from every other reason an insert can fail. A select answers the question
 * being asked and can name the account holding the number in the error.
 *
 * The gap between the read and the insert is a real race, and it is left
 * unclosed deliberately: it needs two seeds inside a few milliseconds of each
 * other landing on the same slot, and if that ever happens the loser fails
 * loudly on the unique index, drops its half-built account, and can simply be
 * re-run. The alternative — an advisory lock held across the whole seed —
 * would be more machinery than the hazard it prevents.
 */
async function claimBusinessLine(
  db: SupabaseClient, orgId: string,
): Promise<string> {
  const candidates = demoBusinessLines(orgId);
  const { data, error } = await db.from("phone_numbers")
    .select("e164, account_id").in("e164", candidates);
  if (error) {
    throw new Error(`demo seed: could not read the reserved business lines: ${error.message}`);
  }
  const taken = new Map(
    (data ?? []).map((row) => [row.e164 as string, row.account_id as string]));
  const free = candidates.find((e164) => !taken.has(e164));
  if (free) return free;

  // Both failures mean the same thing — an account that should not exist
  // does — so both name every holder and neither falls back to a number the
  // caller did not ask for. Silently answering on a different line is how a
  // demo drifts away from the screenshots taken of it.
  const holders = candidates.map((e164) => `${e164} held by ${taken.get(e164)}`).join(", ");
  throw new Error(
    (candidates.length === 1
      ? `demo seed ABORTED: the demo's pinned business line is taken — ${holders}. `
      : `demo seed ABORTED: every one of the ${candidates.length} spare business lines `
        + `in the reserved block is taken — ${holders}. `)
    + `Each of those accounts is one a seed left behind; remove it with `
    + `deleteAccountCascade and re-run.`);
}

async function seedVoice(
  db: SupabaseClient, accountId: string, orgId: string,
): Promise<void> {
  const businessLine = await claimBusinessLine(db, orgId);
  assertFiction(undefined, businessLine, "the business line");
  await assignPhoneNumber(db, accountId, { e164: businessLine, status: "live" }, ACTOR);
  await upsertVoiceProfile(db, accountId, {
    persona_name: "Sofía",
    greeting_en:
      "Thanks for calling Resaca Air Conditioning and Heating, this is Sofía. How can I help?",
    greeting_es:
      "Gracias por llamar a Resaca Air Conditioning and Heating, habla Sofía. ¿En qué le puedo ayudar?",
    facts:
      "Family owned in Harlingen since 2004. Serving Harlingen, San Benito, La Feria, Los Fresnos " +
      "and Raymondville. Office hours Monday to Friday 8 AM to 5 PM, Saturday 8 AM to noon. " +
      "After-hours calls are taken as messages and returned before 8 AM. We do not quote " +
      "replacements over the phone — an estimator measures first, at no charge.",
    services: DEMO_SERVICES.join(", "),
    languages: "both",
    booking_enabled: true,
    after_hours: "hours_then_message",
    enabled: true,
    textback_enabled: true,
    textback_body:
      "Thanks for calling Resaca Air — sorry we missed you. Reply here and we'll get you on the schedule.",
  }, ACTOR);
}

/**
 * Forty contacts across six months, weighted toward recent: `age` is the
 * square of a uniform draw, so the book looks like a business that is
 * growing rather than one that acquired everybody on the same afternoon.
 * Every "new this week" delta on the dashboard reads off this shape.
 */
async function seedContacts(
  db: SupabaseClient, accountId: string, now: number, r: Rng,
): Promise<Seeded[]> {
  const out: Seeded[] = [];
  for (const person of DEMO_PEOPLE) {
    const email = demoEmail(`${person.first}.${person.last}`);
    const phone = demoPhone(person.line);
    assertFiction(email, phone, `${person.first} ${person.last}`);

    const createdAt = now - Math.floor(r() ** 2 * 180 * DAY);
    const { id, existing } = await createContact(db, accountId, {
      firstName: person.first, lastName: person.last, email, phone,
      companyName: person.company, source: person.source,
    }, ACTOR);
    if (existing) throw new Error(`demo seed: duplicate contact ${email} — the people list collides`);
    await backdate(db, "contacts", id,
      { created_at: new Date(createdAt).toISOString(), updated_at: new Date(createdAt).toISOString() });
    out.push({ id, person, createdAt });
  }
  return out;
}

type Convo = { id: string; contact: Seeded; messages: number };

/**
 * Twelve threads over the last two weeks. Mixed channels on purpose: the
 * inbox is one surface for email, SMS, web chat and the form, and a demo that
 * shows only one of them shows a mailbox rather than the product.
 */
async function seedConversations(
  db: SupabaseClient, accountId: string, contacts: Seeded[], now: number, r: Rng,
): Promise<Convo[]> {
  const scripts: { channel: "sms" | "email" | "form"; turns: [string, string][] }[] = [
    { channel: "sms", turns: [
      ["inbound", "Is someone still coming out today?"],
      ["outbound", "Yes ma'am — Danny is finishing a call in San Benito and you're next. Should be about 40 minutes."],
      ["inbound", "Perfect, thank you!"],
    ] },
    { channel: "sms", turns: [
      ["inbound", "Buenas tardes, ¿el técnico ya viene en camino?"],
      ["outbound", "Buenas tardes. Sí, va en camino y llega en unos 25 minutos. Le avisamos cuando esté afuera."],
      ["inbound", "Gracias"],
    ] },
    { channel: "email", turns: [
      ["inbound", "Hi — could you send the quote from Tuesday's visit again? I don't think it came through."],
      ["outbound", "Of course, resending it now. It's the 3-ton 16 SEER with the new return, $4,780 installed, good for 30 days. Let me know if you'd like the financing sheet too."],
      ["inbound", "Got it this time, thanks. Sending it to my wife tonight."],
    ] },
    { channel: "sms", turns: [
      ["inbound", "Do y'all do the maintenance plan for rentals? I have 4 units."],
      ["outbound", "We do — four units on one plan is our most common setup for landlords. I'll have someone call you with the number today."],
    ] },
    { channel: "email", turns: [
      ["inbound", "The upstairs is still not keeping up after the repair last week."],
      ["outbound", "Sorry to hear that — that's covered under our 90-day workmanship warranty, so there's no charge for the follow-up. I have tomorrow 8–10 or Thursday 1–3."],
      ["inbound", "Tomorrow 8-10 please."],
      ["outbound", "Booked. You'll get a confirmation text shortly."],
    ] },
    { channel: "form", turns: [
      ["inbound", "Requesting a quote for a new system. Two story, about 2,400 sq ft, current unit is 20 years old."],
      ["outbound", "Thanks for reaching out. An estimator measures first so the number doesn't move later — it's free and takes about 45 minutes. What days work for you?"],
    ] },
    { channel: "sms", turns: [
      ["inbound", "¿Cuánto cobran por revisar el aire? No enfría bien."],
      ["outbound", "La visita de diagnóstico son $89 y se le acredita si hace la reparación con nosotros. ¿Le agendo para mañana en la mañana?"],
      ["inbound", "Sí por favor"],
    ] },
    { channel: "email", turns: [
      ["inbound", "Invoice 4471 — I think we were billed twice for the same visit."],
      ["outbound", "You're right, there's a duplicate charge on 4471. It's reversed and you'll see it back in 3–5 business days. Sorry about that."],
      ["inbound", "Appreciate the quick fix."],
    ] },
    { channel: "sms", turns: [
      ["inbound", "Can we move Thursday to next week? Something came up."],
      ["outbound", "No problem at all. I have next Tuesday 10–12 or next Wednesday 8–10."],
      ["inbound", "Tuesday works"],
      ["outbound", "Moved to Tuesday 10–12. Old slot released."],
    ] },
    { channel: "form", turns: [
      ["inbound", "Commercial — 3 rooftop units at the storage facility on Ed Carey. Need a service contract quote."],
      ["outbound", "Happy to help. Commercial RTUs are quoted after a walkthrough. Is a weekday morning good for that?"],
    ] },
    { channel: "sms", turns: [
      ["inbound", "Técnico ya se fue, todo quedó bien. Gracias!"],
      ["outbound", "¡Qué bueno! Gracias por confiar en nosotros. Cualquier cosa aquí estamos."],
    ] },
    { channel: "email", turns: [
      ["inbound", "Do you install mini-splits? Adding a room over the garage."],
      ["outbound", "We do. A room over a garage is usually a single-zone mini-split — an estimator can size it on site. No charge for the visit."],
    ] },
  ];

  const out: Convo[] = [];
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i]!;
    const contact = contacts[i * 3 % contacts.length]!;
    const { id } = await ensureConversation(db, accountId, contact.id, ACTOR);

    // Threads run newest-first across the last 14 days; turns inside a thread
    // are minutes apart, which is what a real SMS exchange looks like.
    let t = now - (i * 28 * HOUR) - between(r, 0, 6) * HOUR;
    for (const [direction, body] of script.turns) {
      const { id: messageId } = await createMessage(db, accountId, {
        conversationId: id, channel: script.channel,
        direction: direction as "inbound" | "outbound",
        subject: script.channel === "email" ? "Resaca Air" : undefined,
        body,
      }, ACTOR);
      await backdate(db, "messages", messageId, { created_at: new Date(t).toISOString() });
      t += between(r, 3, 40) * MIN;
    }
    const lastAt = new Date(t).toISOString();
    await backdate(db, "conversations", id,
      { last_message_at: lastAt, updated_at: lastAt, created_at: new Date(now - (i * 28 * HOUR) - 7 * HOUR).toISOString() });
    out.push({ id, contact, messages: script.turns.length });
  }

  // Three threads left unread, because an inbox with a zero badge is a
  // screenshot of an empty product.
  for (const c of out.slice(0, 3)) {
    const { error } = await db.from("conversations").update({ unread_count: between(r, 1, 3) }).eq("id", c.id);
    if (error) throw new Error(`demo seed: unread badge failed: ${error.message}`);
  }
  return out;
}

/**
 * Thirty-four calls across three weeks, cycling the eight transcripts so
 * every outcome — including `abandoned` and `spam` — appears more than once.
 * A call log that is five green rows out of five is the first thing a
 * sceptical buyer stops believing.
 */
async function seedCalls(
  db: SupabaseClient, accountId: string, contacts: Seeded[], convos: Convo[], now: number, r: Rng,
): Promise<number> {
  const { data: phone, error } = await db.from("phone_numbers")
    .select("id").eq("account_id", accountId).single();
  if (error || !phone) throw new Error(`demo seed: no business line: ${error?.message}`);

  // Split ONCE, so a transcript can only ever land on somebody who speaks
  // its language. The previous version indexed the contact list directly and
  // the two were unrelated: the call log showed María Guzmán and Verónica
  // Alaniz on English calls while Kevin Braun and Owen Serrato took Spanish
  // ones. Individually each is possible in the Valley; as a column of six it
  // reads as a product that does not know who it is talking to — on the one
  // page whose argument is that it does.
  const byLang: Record<"en" | "es", Seeded[]> = {
    en: contacts.filter((c) => c.person.lang === "en"),
    es: contacts.filter((c) => c.person.lang === "es"),
  };

  const TOTAL = 34;
  for (let i = 0; i < TOTAL; i++) {
    const script = DEMO_TRANSCRIPTS[i % DEMO_TRANSCRIPTS.length]!;
    // Spam and abandoned callers are strangers: no contact row, which is
    // exactly how the real product records them.
    const known = script.outcome !== "spam" && script.outcome !== "abandoned";
    // Same stride as before so the spread across the book is unchanged; it
    // just walks the matching pool instead of the whole list.
    const pool = byLang[script.lang];
    const contact = known && pool.length > 0 ? pool[(i * 7) % pool.length]! : null;
    const callerE164 = contact ? demoPhone(contact.person.line) : demoPhone(between(r, 50, 99));
    assertFiction(undefined, callerE164, `caller on call ${i}`);

    // Business hours, working backwards day by day, two or three a day.
    const daysAgo = Math.floor(i / 2);
    const startedAt = now - daysAgo * DAY - (between(r, 8, 17) * HOUR) + between(r, 0, 59) * MIN;

    const { id: callId } = await startCallRow(db, accountId,
      { phoneNumberId: phone.id, callerE164 });

    // Turn timestamps are stamped from the call's own start, so a re-seed
    // moves the whole conversation together instead of leaving a transcript
    // dated to whenever transcripts.ts was written.
    const step = Math.max(1, Math.floor(script.durationSecs / script.turns.length));
    const transcript = script.turns.map((turn, n) => ({
      role: turn.role, text: turn.text,
      at: new Date(startedAt + n * step * 1000).toISOString(),
    }));

    await finishCallRow(db, accountId, callId, {
      outcome: script.outcome,
      endedAt: new Date(startedAt + script.durationSecs * 1000),
      durationSecs: script.durationSecs,
      turnCount: script.turns.length,
      transcript,
      summary: script.summary,
      language: script.lang,
      contactId: contact?.id,
      conversationId: convos.find((c) => c.contact.id === contact?.id)?.id,
    });
    await backdate(db, "calls", callId, { started_at: new Date(startedAt).toISOString() });
  }
  return TOTAL;
}

/**
 * Sixteen bookings — five ahead, eleven behind, with the past ones resolved
 * into completed / no_show / cancelled rather than all left "booked".
 *
 * Slots are two hours apart on whole hours and never repeat a start, because
 * `bookings_no_overlap` is a real exclusion constraint on this table and a
 * seeder that trips it fails halfway through with an account already half
 * written.
 *
 * `setBookingStatus` stamps `completed_at`/`no_show_at` with `now()` — the
 * automation clocks the review request and the no-show nudge read from. Those
 * stamps are backdated with the rest, so the demo's history is internally
 * consistent even though nothing on this account can send.
 */
async function seedBookings(
  db: SupabaseClient, accountId: string, contacts: Seeded[], now: number, r: Rng,
): Promise<number> {
  const cal = await getOrCreateCalendar(db, accountId, ACTOR);

  // ENABLE IT. `calendars.enabled` defaults to false and `/b/[publicId]`
  // answers a disabled calendar with notFound(), so without this the demo's
  // booking page is a 404 — which is exactly what the first capture run
  // photographed and shipped as a marketing screenshot. The hours are the
  // same ones Sofía reads out in seedVoice; see DEMO_OPEN_HOURS.
  //
  // Enabling it does make the page publicly bookable by anyone holding the
  // link. That is the point of a demo booking page, and it is safe for the
  // same reason everything else here is: the account is suppressed, so a
  // stranger's booking notifies nobody, and the next re-seed clears it.
  await updateCalendarSettings(db, accountId, {
    enabled: true,
    openHours: DEMO_OPEN_HOURS,
    slotDurationMinutes: 120,
    minNoticeHours: 12,
    maxAdvanceDays: 21,
    meetingType: "in_person",
  }, ACTOR);

  const NOTES = [
    "Upstairs unit not cooling. Gate code 4417.",
    "Annual maintenance — two units.",
    "No enfría. Perro en el patio, favor de tocar el timbre.",
    "Replacement estimate. Please call before arriving.",
    "Water at the indoor unit. System is off at the breaker.",
    "Thermostat replaced last month, still short cycling.",
    "Commercial — 3 rooftop units, roof access through the back.",
    "Duct cleaning quote.",
  ];

  const slots: { at: number; status: "booked" | "completed" | "no_show" | "cancelled" }[] = [];
  // Ahead: the next ten days, skipping Sundays.
  for (let d = 1, made = 0; made < 5 && d < 14; d++) {
    const day = new Date(now + d * DAY);
    if (day.getUTCDay() === 0) continue;
    day.setUTCHours(13 + made * 2, 0, 0, 0);
    slots.push({ at: day.getTime(), status: "booked" });
    made++;
  }
  // Behind: the last four weeks. Eight completed, two no-shows, one cancelled
  // — roughly the ratio an HVAC shop actually runs.
  const past: typeof slots[number]["status"][] = [
    "completed", "completed", "completed", "no_show", "completed",
    "completed", "cancelled", "completed", "completed", "no_show", "completed",
  ];
  for (let i = 0; i < past.length; i++) {
    const day = new Date(now - (i * 2 + 1) * DAY);
    day.setUTCHours(14 + (i % 3) * 2, 0, 0, 0);
    slots.push({ at: day.getTime(), status: past[i]! });
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const contact = contacts[(i * 5 + 2) % contacts.length]!;
    const createdAt = Math.min(slot.at, now) - between(r, 1, 6) * DAY;

    const { id } = await createBooking(db, accountId, {
      calendarId: cal.id, contactId: contact.id,
      startsAt: new Date(slot.at), endsAt: new Date(slot.at + 2 * HOUR),
      note: pick(r, NOTES), bookerTimezone: DEMO_TIMEZONE,
    }, ACTOR);

    const patch: Record<string, string> = { created_at: new Date(createdAt).toISOString() };
    if (slot.status !== "booked") {
      await setBookingStatus(db, accountId, id, slot.status, ACTOR);
      // Resolved shortly after the appointment ended, not at seed time.
      const resolvedAt = new Date(slot.at + 3 * HOUR).toISOString();
      patch.updated_at = resolvedAt;
      if (slot.status === "completed") patch.completed_at = resolvedAt;
      if (slot.status === "no_show") patch.no_show_at = resolvedAt;
    }
    await backdate(db, "bookings", id, patch);
  }
  return slots.length;
}

/**
 * The board. Sixteen deals across the five default stages, weighted the way
 * an HVAC pipeline actually is: many small diagnostics at the front, a few
 * large replacements deep in it, and two closed so the stage is not empty.
 *
 * Values are real Valley numbers — an $89 diagnostic and a $14,200 commercial
 * RTU swap in the same column is what makes the board legible as a business
 * rather than as sample data.
 */
async function seedPipeline(
  db: SupabaseClient, accountId: string, contacts: Seeded[], now: number, r: Rng,
): Promise<number> {
  const { pipelineId } = await ensureDefaultPipeline(db, accountId);
  const { data: stages, error } = await db.from("pipeline_stages")
    .select("id, name, position").eq("pipeline_id", pipelineId).order("position");
  if (error || !stages?.length) throw new Error(`demo seed: no stages: ${error?.message}`);

  const DEALS: { name: string; value: number; stage: number; won?: boolean }[] = [
    { name: "Diagnostic — upstairs not cooling", value: 89, stage: 0 },
    { name: "Diagnostic — no enfría, zumbido afuera", value: 89, stage: 0 },
    { name: "Capacitor + contactor replacement", value: 340, stage: 0 },
    { name: "Maintenance plan — 2 units", value: 380, stage: 0 },
    { name: "Drain line clear + safety switch", value: 225, stage: 1 },
    { name: "Mini-split, room over garage", value: 3_950, stage: 1 },
    { name: "Maintenance plan — 4 rental units", value: 760, stage: 1 },
    { name: "Evaporator coil replacement", value: 1_880, stage: 2 },
    { name: "3-ton 16 SEER changeout", value: 4_780, stage: 2 },
    { name: "Duct cleaning — 1,900 sq ft", value: 640, stage: 2 },
    { name: "4-ton system + return rework", value: 6_400, stage: 3 },
    { name: "Two-story dual system replacement", value: 11_300, stage: 3 },
    { name: "Commercial RTU swap — 3 units", value: 14_200, stage: 3 },
    { name: "Service contract — storage facility", value: 2_400, stage: 3 },
    { name: "2.5-ton changeout, La Feria", value: 4_150, stage: 4, won: true },
    { name: "Heat strip replacement", value: 520, stage: 4, won: true },
  ];

  for (let i = 0; i < DEALS.length; i++) {
    const deal = DEALS[i]!;
    const contact = contacts[(i * 11 + 4) % contacts.length]!;
    const { id } = await createOpportunity(db, accountId,
      { contactId: contact.id, pipelineId, name: deal.name, value: deal.value }, ACTOR);

    if (deal.stage > 0) {
      await moveOpportunityToStage(db, accountId, id, stages[deal.stage]!.id, ACTOR);
    }
    if (deal.won) await setOpportunityStatus(db, accountId, id, "won", ACTOR);

    // Deeper stages are older — a deal does not reach "Quote Sent" the same
    // hour it arrives, and the board's age column is read in demos.
    const createdAt = now - (deal.stage * 6 + between(r, 1, 9)) * DAY;
    const movedAt = now - between(r, 0, deal.stage * 3 + 1) * DAY;
    const oppPatch: Record<string, string> = {
      created_at: new Date(createdAt).toISOString(),
      updated_at: new Date(movedAt).toISOString(),
      stage_changed_at: new Date(movedAt).toISOString(),
    };
    // setOpportunityStatus stamps status_changed_at at now() too — same
    // reason setBookingStatus's clocks are backdated above: a deal that
    // closed three weeks ago must not read as closed this second.
    if (deal.won) oppPatch.status_changed_at = new Date(movedAt).toISOString();
    await backdate(db, "opportunities", id, oppPatch);
  }
  return DEALS.length;
}

/**
 * The website's own request form, plus three weeks of submissions — two of
 * them blocked as spam, recorded rather than discarded, because "37 blocked
 * this week" is a number an owner wants and silence is not.
 */
async function seedForm(
  db: SupabaseClient, accountId: string, contacts: Seeded[], now: number, r: Rng,
): Promise<number> {
  const { id: formId } = await createForm(db, accountId, {
    name: "Request service",
    // The platform's own field vocabulary, not free-form input types: `core.*`
    // is what tells the lead pipeline which answer becomes which contact
    // column. A demo form built out of "text"/"email" would look right on
    // screen and enrich nothing.
    fields: [
      { key: "first_name", kind: "core.first_name", label: "First name", required: true },
      { key: "last_name", kind: "core.last_name", label: "Last name", required: true },
      { key: "phone", kind: "core.phone", label: "Phone", required: true },
      { key: "email", kind: "core.email", label: "Email", placeholder: "Optional", required: false },
      { key: "message", kind: "message", label: "What's going on?", required: true },
    ],
    localeDefault: "en",
  }, ACTOR);
  await updateForm(db, accountId, formId, { status: "published" }, ACTOR);

  const ISSUES = [
    "AC stopped cooling last night, house is 84 already.",
    "Necesito una cotización para cambiar el sistema completo.",
    "Annual maintenance, two units, whenever you have an opening.",
    "Water dripping from the ceiling vent in the hallway.",
    "System runs constantly but never reaches the thermostat setting.",
    "Quiero el plan de mantenimiento para dos unidades.",
    "New construction — need a quote for a 2,100 sq ft single story.",
    "Outdoor unit is making a loud grinding noise.",
    "Heater not igniting, it got cold this week.",
  ];

  let count = 0;
  for (let i = 0; i < ISSUES.length; i++) {
    const contact = contacts[(i * 13 + 1) % contacts.length]!;
    const email = demoEmail(`${contact.person.first}.${contact.person.last}`);
    const phone = demoPhone(contact.person.line);
    assertFiction(email, phone, `submission ${i}`);

    const { id } = await createSubmission(db, accountId, formId, {
      answers: [
        { key: "first_name", label: "First name", value: contact.person.first },
        { key: "last_name", label: "Last name", value: contact.person.last },
        { key: "phone", label: "Phone", value: phone },
        { key: "email", label: "Email", value: email },
        { key: "message", label: "What's going on?", value: ISSUES[i]! },
      ],
      attribution: { source: pick(r, ["google", "direct", "facebook", "referral"]), medium: "organic" },
      locale: contact.person.lang,
    });
    await linkSubmissionContact(db, accountId, id, contact.id);
    await backdate(db, "form_submissions", id,
      { created_at: new Date(now - between(r, 0, 21) * DAY - between(r, 0, 23) * HOUR).toISOString() });
    count++;
  }

  for (const reason of ["honeypot", "rate_limited"] as const) {
    const { id } = await recordRejectedSubmission(db, accountId, formId, {
      answers: [
        { key: "first_name", label: "First name", value: "SEO Growth" },
        { key: "last_name", label: "Last name", value: "Partners" },
        { key: "phone", label: "Phone", value: demoPhone(99) },
        { key: "message", label: "What's going on?", value: "Boost your ranking — reply for a free audit." },
      ],
      spamReason: reason,
    });
    await backdate(db, "form_submissions", id,
      { created_at: new Date(now - between(r, 1, 14) * DAY).toISOString() });
    count++;
  }
  return count;
}

/** Both the recipes an HVAC shop actually runs. Nothing sends — the account
 *  is suppressed — but the settings screens are a surface people screenshot,
 *  and an all-off automations page shows a product nobody is using. */
async function seedAutomations(db: SupabaseClient, accountId: string): Promise<void> {
  await upsertAutomation(db, accountId, "review_request", {
    enabled: true,
    body:
      "Hi {{first_name}}, thanks for letting Resaca Air take care of you. " +
      "If we did right by you, a quick review helps our neighbors find us: {{review_url}}",
    // `parseReviewRequestConfig` only accepts http(s), validated on read AND
    // write. example.com is reserved, so this is a URL that resolves nowhere.
    config: { channel: "sms", reviewUrl: "https://example.com/resaca-air/review" },
  }, ACTOR);

  await upsertAutomation(db, accountId, "sms_reminder", {
    enabled: true,
    body:
      "Reminder: Resaca Air is scheduled for {{date}} between {{window}}. " +
      "Reply here if you need to move it.",
    config: {},
  }, ACTOR);
}

/**
 * The last two setup steps, so the sidebar's meter reads 9/9 rather than 6/9.
 *
 * Seven of the nine are already true of a seeded account — the eighth,
 * `hours`, is true as of the calendar being enabled in seedBookings. These
 * are the remaining two, and neither is cosmetic:
 *
 *   email       `accounts.from_email`. Reserved domain like everything else
 *               here; the account is suppressed, so this configures an
 *               identity that can never actually send.
 *   forwarding  The one step with no derivable source — no row can prove a
 *               carrier-side change — so the wizard stores a tick, and a
 *               business that has been taking calls for months has made it.
 *
 * A demo that shows the product's own setup wizard two-thirds finished is a
 * demo arguing that the product is hard to set up.
 */
async function seedSetupState(db: SupabaseClient, accountId: string): Promise<void> {
  assertFiction(DEMO_FROM_EMAIL, undefined, "the sending identity");
  await setFromEmail(db, accountId, DEMO_FROM_EMAIL, ACTOR);
  await setChecklistItem(db, accountId, DEMO_FORWARDING_TICK_KEY, { done: true }, ACTOR);
}

/**
 * Sixty days of website traffic. Written straight through `writeTrafficDay`
 * rather than pulled: the demo's `vercel_project_id` points at no real
 * project, and since the suppression guard covers `listSitesToSync`, nothing
 * will ever try to.
 *
 * Weekends dip, because the DESIGN.md chart spec has a `--bar-wk` treatment
 * for exactly that and a flat series never exercises it.
 */
async function seedSite(
  db: SupabaseClient, accountId: string, orgId: string, now: number, r: Rng,
): Promise<number> {
  const site = await upsertSite(db, accountId, {
    // Derived from the org id, because `sites.vercel_project_id` is unique
    // across every account — the same trap as the business line, and the one
    // that would have failed the instant that was fixed. See
    // `demoVercelProjectId`.
    vercelProjectId: demoVercelProjectId(orgId),
    domain: "resaca-air.example",
    analyticsEnabledAt: new Date(now - 90 * DAY).toISOString(),
  });

  const DAYS = 60;
  // Each day is three writes (breakdown delete, breakdown insert, totals
  // upsert) and no day depends on another, so this is the seed's biggest
  // loop and its most obviously parallel one. The per-day random draws are
  // taken BEFORE anything is dispatched, so the numbers stay deterministic
  // regardless of what order the writes actually complete in — otherwise the
  // shared LCG would be consumed in whatever order the scheduler picked and
  // two seeds with the same clock would produce different charts.
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = DAYS - i;
    const date = new Date(now - d * DAY);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    // A slow upward trend, so the week-over-week delta on the dashboard is a
    // real number computed from real rows rather than a hardcoded "+12%".
    const base = 38 + Math.floor((DAYS - d) * 0.45);
    const visitors = Math.max(6, Math.round(base * (weekend ? 0.55 : 1) + between(r, -7, 9)));
    return { day: date.toISOString().slice(0, 10), visitors, pageviews: visitors * between(r, 2, 4) };
  });

  await inParallel(days, async ({ day, visitors, pageviews }) => {
    await writeTrafficDay(db, { id: site.id, accountId }, day, { visitors, pageviews }, [
      { dimension: "page", value: "/", visitors: Math.round(visitors * 0.52), pageviews: Math.round(pageviews * 0.4) },
      { dimension: "page", value: "/ac-repair", visitors: Math.round(visitors * 0.24), pageviews: Math.round(pageviews * 0.28) },
      { dimension: "page", value: "/schedule", visitors: Math.round(visitors * 0.14), pageviews: Math.round(pageviews * 0.2) },
      { dimension: "page", value: "/maintenance-plans", visitors: Math.round(visitors * 0.1), pageviews: Math.round(pageviews * 0.12) },
      { dimension: "source", value: "google", visitors: Math.round(visitors * 0.61), pageviews: Math.round(pageviews * 0.58) },
      { dimension: "source", value: "direct", visitors: Math.round(visitors * 0.22), pageviews: Math.round(pageviews * 0.24) },
      { dimension: "source", value: "facebook", visitors: Math.round(visitors * 0.11), pageviews: Math.round(pageviews * 0.12) },
      { dimension: "source", value: "nextdoor", visitors: Math.round(visitors * 0.06), pageviews: Math.round(pageviews * 0.06) },
      { dimension: "place", value: "Harlingen", visitors: Math.round(visitors * 0.44), pageviews: Math.round(pageviews * 0.44) },
      { dimension: "place", value: "San Benito", visitors: Math.round(visitors * 0.19), pageviews: Math.round(pageviews * 0.19) },
      { dimension: "place", value: "Brownsville", visitors: Math.round(visitors * 0.16), pageviews: Math.round(pageviews * 0.16) },
      { dimension: "place", value: "McAllen", visitors: Math.round(visitors * 0.12), pageviews: Math.round(pageviews * 0.12) },
      { dimension: "device", value: "mobile", visitors: Math.round(visitors * 0.74), pageviews: Math.round(pageviews * 0.7) },
      { dimension: "device", value: "desktop", visitors: Math.round(visitors * 0.21), pageviews: Math.round(pageviews * 0.25) },
      { dimension: "device", value: "tablet", visitors: Math.round(visitors * 0.05), pageviews: Math.round(pageviews * 0.05) },
    ]);
  });
  return DAYS;
}

/**
 * The activity feed, made honest.
 *
 * Every helper this seeder calls emits an event, correctly — that is the
 * point of using the helpers rather than raw inserts. But `emit` stamps
 * `now()`, so a feed built this way shows six months of history as several
 * hundred rows from the same second, which is the single most obvious tell
 * that a dashboard is seeded. Each event carries the id of the thing it
 * happened to, so each is re-dated to match that row.
 *
 * Events whose subject cannot be dated — the account's own creation, the
 * branding write, the voice profile — are spread across the account's first
 * hours instead, in their existing order. Setup genuinely did all happen at
 * once.
 *
 * Written back as one update per row, `CONCURRENCY` at a time. This is the
 * largest single step in the seed — several hundred rows — so the parallelism
 * is what keeps it from dominating the wall clock.
 */
async function backdateEvents(db: SupabaseClient, accountId: string, now: number): Promise<void> {
  const subjects = new Map<string, string>();
  for (const [table, key] of [
    ["contacts", "contactId"], ["bookings", "bookingId"], ["opportunities", "opportunityId"],
    ["messages", "messageId"], ["conversations", "conversationId"], ["calls", "callId"],
  ] as const) {
    const stamp = table === "calls" ? "started_at" : "created_at";
    const { data, error } = await db.from(table).select(`id, ${stamp}`).eq("account_id", accountId);
    if (error) throw new Error(`backdateEvents read ${table} failed: ${error.message}`);
    for (const row of (data ?? []) as Record<string, string>[]) {
      if (row[stamp]) subjects.set(`${key}:${row.id}`, row[stamp]!);
    }
  }

  const { data: events, error } = await db.from("events")
    .select("id, payload").eq("account_id", accountId).order("created_at");
  if (error) throw new Error(`backdateEvents read events failed: ${error.message}`);

  const setupStart = now - 180 * DAY;
  let setupN = 0;
  const rows = ((events ?? []) as Record<string, unknown>[]).map((ev) => {
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    let when: string | undefined;
    for (const [key, id] of Object.entries(payload)) {
      if (typeof id !== "string") continue;
      const hit = subjects.get(`${key}:${id}`);
      if (hit) { when = hit; break; }
    }
    when ??= new Date(setupStart + (setupN++) * 4 * MIN).toISOString();
    return { id: ev.id as number, created_at: when };
  });

  // One UPDATE per row, run `CONCURRENCY` at a time.
  //
  // NOT a bulk upsert, which is what this tried first and what CI rejected:
  // `events.id` is `bigint generated ALWAYS as identity`, so Postgres refuses
  // any statement that supplies a value for it — and an upsert has to, since
  // the id is what it conflicts on. There is no PostgREST shape that rewrites
  // one column across many rows with different values, so the round trips are
  // real; only the waiting is optional.
  await inParallel(rows, async ({ id, created_at }) => {
    const { error: upErr } = await db.from("events").update({ created_at }).eq("id", id);
    if (upErr) throw new Error(`backdateEvents update failed for event ${id}: ${upErr.message}`);
  });
}
