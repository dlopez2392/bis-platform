import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEMO_PEOPLE, DEMO_EMAIL_RE, DEMO_PHONE_RE, DEMO_BUSINESS_LINE, DEMO_ORG_ID,
  BUSINESS_LINE_SLOTS, CONTACT_LINE_SLOTS,
  DEMO_OPEN_HOURS, DEMO_FROM_EMAIL,
  demoPhone, demoEmail, demoBusinessLines, demoVercelProjectId,
} from "../demo/fiction";
import { DEMO_TRANSCRIPTS } from "../demo/transcripts";

/**
 * The demo tenant's contact details are invented, and this is what makes
 * "invented" a property instead of an intention.
 *
 * `accounts.outbound_suppressed` is the real guard — it is what stops the
 * every-15-minutes cron from acting on this account at all. These tests are
 * the second wall, for the day somebody clears the flag to check something
 * and does not set it back. If that happens, the worst case has to be mail to
 * a reserved domain and calls to a reserved number, not to a stranger.
 *
 * Reserved means two specific things, and neither is "it looks fake":
 *   - RFC 2606 §3 sets aside example.com for documentation. It resolves for
 *     nobody, forever, by standard.
 *   - The NANP sets aside 555-01xx for fiction. 555 ALONE does not — most of
 *     the 555 range is assignable and parts of it are assigned, which is why
 *     the regex pins the `01` and not just the `555`.
 */
const DEMO_DIR = path.join(__dirname, "..", "demo");
const DEMO_FILES = ["fiction.ts", "transcripts.ts", "seed.ts", "run.ts"] as const;
const sourceOf = (f: string) => fs.readFileSync(path.join(DEMO_DIR, f), "utf8");

describe("demo tenant — nothing here can reach a real person", () => {
  it("gives every person a reserved email and a reserved phone", () => {
    for (const p of DEMO_PEOPLE) {
      const email = demoEmail(`${p.first}.${p.last}`);
      const phone = demoPhone(p.line);
      expect(email, `${p.first} ${p.last}`).toMatch(DEMO_EMAIL_RE);
      expect(phone, `${p.first} ${p.last}`).toMatch(DEMO_PHONE_RE);
    }
    expect(DEMO_BUSINESS_LINE).toMatch(DEMO_PHONE_RE);
  });

  it("assigns each person a distinct line, so reordering the list never moves a number", () => {
    const lines = DEMO_PEOPLE.map((p) => p.line);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("refuses a line outside the reserved 01xx block", () => {
    expect(() => demoPhone(100)).toThrow(/reserved/);
    expect(() => demoPhone(-1)).toThrow(/reserved/);
    expect(() => demoPhone(1.5)).toThrow(/reserved/);
    // And the boundaries are IN.
    expect(demoPhone(0)).toBe("+19565550100");
    expect(demoPhone(99)).toBe("+19565550199");
  });

  it("strips anything that could make an address deliverable", () => {
    // Accents and spaces in Valley surnames are the realistic input here, and
    // a local part that keeps them is a local part that may not be what the
    // regex above was checked against.
    expect(demoEmail("María.Guzmán")).toMatch(DEMO_EMAIL_RE);
    expect(demoEmail("Andrea Cantú")).toMatch(DEMO_EMAIL_RE);
    expect(demoEmail("O'Brien")).toMatch(DEMO_EMAIL_RE);
  });

  /**
   * The source scan, and the reason the other tests are not enough: they
   * check the DERIVED values. A literal address pasted into a transcript, a
   * seeded note, or a form answer never passes through `demoEmail` at all.
   *
   * Mutation: put a real-looking address in any of the four demo files — this
   * names the file and the string.
   */
  it("contains no email address outside the reserved domain, anywhere in the demo source", () => {
    const offenders: string[] = [];
    for (const file of DEMO_FILES) {
      for (const m of sourceOf(file).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        if (!/@example\.com$/.test(m[0])) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Same argument for phone numbers. A number typed straight into a
   * transcript ("call us at ...") is the realistic mistake, and it would be
   * a number somebody actually answers.
   *
   * Mutation: write any +1 number outside 956-555-01xx in a demo file.
   */
  it("contains no E.164 number outside the reserved block, anywhere in the demo source", () => {
    const offenders: string[] = [];
    for (const file of DEMO_FILES) {
      for (const m of sourceOf(file).matchAll(/\+1\d{10}/g)) {
        if (!DEMO_PHONE_RE.test(m[0])) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Ten-digit numbers written the way a person writes them — (956) 555-0100,
   * 956-555-0100, 956.555.0100 — would not match the E.164 scan above and are
   * exactly the shape a transcript would carry.
   */
  it("contains no formatted 10-digit number outside the reserved block", () => {
    const offenders: string[] = [];
    for (const file of DEMO_FILES) {
      const text = sourceOf(file);
      for (const m of text.matchAll(/\(?\b(\d{3})\)?[\s.-](\d{3})[\s.-](\d{4})\b/g)) {
        const e164 = `+1${m[1]}${m[2]}${m[3]}`;
        if (!DEMO_PHONE_RE.test(e164)) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The values that are unique across EVERY account, not per account.
 *
 * This suite exists because of a specific outage, and the shape of it
 * generalises. The seeder hard-coded one business line and one Vercel project
 * id. That was invisible while the demo was the only thing ever seeded — and
 * the hour danlo seeded the real demo for the first time, every CI run after
 * it went red, because `demo-seed.test.ts` seeds a throwaway account in the
 * same Supabase project and `phone_numbers.e164` is unique project-wide. The
 * error named `phone_numbers_e164_key` and nothing about a demo.
 *
 * `sites.vercel_project_id` was the identical trap one line further on, and
 * would have surfaced the moment the phone was fixed. So the rule is not "fix
 * the phone": anything the seeder writes into a globally unique column is
 * derived from the org id, and these tests are what hold that.
 *
 * Checked against the live schema on 2026-09-15, the complete set of unique
 * indexes on the seeder's tables that do NOT include `account_id` is:
 * `accounts.clerk_org_id` (the org id itself), `phone_numbers.e164`,
 * `sites.vercel_project_id`, `calendars.public_id`, `forms.public_id`,
 * `bookings.cancel_token`, and the two partial ones on
 * `phone_numbers.telnyx_id` and `messages.provider_message_id`. The public
 * ids and the cancel token are random per row; the two partial indexes ignore
 * NULL and the seeder writes NULL to both. Which leaves exactly the two
 * covered here.
 */
describe("demo tenant — two seeded accounts can coexist in one project", () => {
  // Stand-ins for what `demo-seed.test.ts` generates: same prefix, random
  // suffix, two of them, because one is not a collision.
  const THROWAWAYS = Array.from({ length: 2 }, (_, i) => `org_test_demoseed_case${i}`);

  it("keeps the contact block clear of the business-line block", () => {
    // If a 41st person were ever added at line 09 this would be a
    // globally-unique collision wearing an ordinary contact's clothes.
    for (const p of DEMO_PEOPLE) {
      expect(p.line, `${p.first} ${p.last}`)
        .toBeGreaterThanOrEqual(CONTACT_LINE_SLOTS.first);
      expect(p.line, `${p.first} ${p.last}`)
        .toBeLessThanOrEqual(CONTACT_LINE_SLOTS.last);
    }
    expect(CONTACT_LINE_SLOTS.first).toBeGreaterThan(BUSINESS_LINE_SLOTS.last);
  });

  it("offers the real demo its pinned line and nothing else", () => {
    // One candidate, not nine. A demo that quietly answered on a different
    // number would invalidate every screenshot already taken of it, and the
    // failure it is falling back FROM — an orphaned account holding 00 — is
    // one a human has to clear anyway.
    expect(demoBusinessLines(DEMO_ORG_ID)).toEqual([DEMO_BUSINESS_LINE]);
  });

  it("offers a throwaway every spare slot, in a stable order, never the demo's", () => {
    const spare = BUSINESS_LINE_SLOTS.last - BUSINESS_LINE_SLOTS.first; // 00 is the demo's
    for (const orgId of THROWAWAYS) {
      const lines = demoBusinessLines(orgId);
      expect(lines).toHaveLength(spare);
      expect(new Set(lines).size).toBe(spare);
      expect(lines).not.toContain(DEMO_BUSINESS_LINE);
      for (const line of lines) expect(line).toMatch(DEMO_PHONE_RE);
      // Deterministic: a re-seed of the same org must reuse the same number,
      // or a re-seed is a number change.
      expect(demoBusinessLines(orgId)).toEqual(lines);
    }
  });

  /**
   * The property that actually matters, run the way `claimBusinessLine` runs
   * it: nine different orgs seed one after another, each taking the first
   * line nobody holds. All nine must get one, and all nine must differ —
   * which is guaranteed only because each list is a PERMUTATION of every
   * spare slot rather than a single hashed pick.
   *
   * A single hashed slot per org would collide about one run in nine. That is
   * the worst failure rate there is: rare enough that the first few are
   * written off as flakes, frequent enough to cost a day before anybody
   * reads the log.
   *
   * Mutation: truncate `demoBusinessLines` to its first candidate — the
   * simulation below runs out of lines and this fails.
   */
  it("seats every org that fits in the block, on a distinct line", () => {
    const orgs = Array.from({ length: BUSINESS_LINE_SLOTS.last - BUSINESS_LINE_SLOTS.first },
      (_, i) => `org_test_demoseed_sim${i}`);
    const taken = new Set<string>();
    for (const orgId of orgs) {
      const free = demoBusinessLines(orgId).find((l) => !taken.has(l));
      expect(free, `${orgId} found nothing with ${taken.size} lines held`).toBeDefined();
      taken.add(free!);
    }
    expect(taken.size).toBe(orgs.length);
    expect(taken.has(DEMO_BUSINESS_LINE)).toBe(false);
  });

  it("gives every org its own Vercel project id, and leaves the demo's alone", () => {
    // The canonical string is asserted literally: the `org_` strip exists so
    // that this fix changed what a throwaway writes and NOTHING about the
    // account already seeded in production.
    expect(demoVercelProjectId(DEMO_ORG_ID)).toBe("prj_demo_resaca_air_not_a_real_project");
    const ids = [DEMO_ORG_ID, ...THROWAWAYS].map(demoVercelProjectId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The source scan, for the same reason the email and phone scans exist: the
   * tests above check the derived values, and a literal pasted back into the
   * seeder would pass all of them.
   *
   * Mutation: put `vercelProjectId: "prj_anything"` back in seed.ts.
   */
  it("hard-codes neither globally-unique value in the seeder", () => {
    const src = sourceOf("seed.ts");
    expect(src).not.toMatch(/["'`]prj_/);
    expect(src).not.toMatch(/DEMO_BUSINESS_LINE/);
  });
});

/**
 * The demo has to look like a business that finished setting up.
 *
 * All three of these were visible defects in the first capture run, and none
 * of them was a rendering bug — each was the demo honestly reporting that it
 * was half-configured:
 *   - `booking-page.png` was a 404, because `calendars.enabled` defaults to
 *     false and /b/[publicId] answers a disabled calendar with notFound().
 *   - The sidebar meter read "Setup 6/9" in every dashboard screenshot.
 *   - The three undone steps were exactly `hours`, `email` and `forwarding`.
 */
describe("demo tenant — a business that finished setting up", () => {
  it("opens the hours Sofía says it opens", () => {
    // The voice profile tells callers "Monday to Friday 8 AM to 5 PM,
    // Saturday 8 AM to noon". The booking page is the one screen where a
    // visitor can check that claim against the product, so the two are
    // asserted against each other rather than merely written next to each
    // other.
    const facts = sourceOf("seed.ts");
    expect(facts).toMatch(/Monday to Friday 8 AM to 5 PM, Saturday 8 AM to noon/);
    for (const day of ["mon", "tue", "wed", "thu", "fri"]) {
      expect(DEMO_OPEN_HOURS[day], day).toEqual([["08:00", "17:00"]]);
    }
    expect(DEMO_OPEN_HOURS.sat).toEqual([["08:00", "12:00"]]);
    expect(DEMO_OPEN_HOURS.sun).toBeUndefined();
  });

  /**
   * `deriveSetupStatus`'s `hours` step is
   * `calendar.enabled === true && hasOpenHours(open_hours)`, where
   * hasOpenHours means at least one day has a non-empty window array. An
   * `open_hours: {}` passes "enabled" and still makes every day read "no
   * availability" — the exact wiped-config state that comment warns about.
   */
  it("gives at least one day a real window, which is what the hours step checks", () => {
    const windows = Object.values(DEMO_OPEN_HOURS);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some((w) => w.length > 0)).toBe(true);
  });

  it("keeps the sending identity on the reserved domain", () => {
    // It configures an identity that can never send: the account is
    // suppressed, and the address is unresolvable by RFC 2606 regardless.
    expect(DEMO_FROM_EMAIL).toMatch(DEMO_EMAIL_RE);
  });

  /**
   * Mutation: delete the `updateCalendarSettings` call from seedBookings —
   * the booking page goes back to being a 404 and this fails.
   */
  it("enables the calendar in the seeder, not just in a comment", () => {
    const src = sourceOf("seed.ts");
    // Scoped to the updateCalendarSettings CALL, not merely to the presence
    // of `enabled: true` anywhere in the file — seedAutomations sets that on
    // the SMS reminder, so the loose version of this assertion passed with
    // the calendar enable deleted. Found by running the mutation.
    const call = /updateCalendarSettings\(\s*db,\s*accountId,\s*\{([\s\S]*?)\},/.exec(src);
    expect(call, "seedBookings no longer calls updateCalendarSettings").not.toBeNull();
    expect(call![1]).toMatch(/enabled:\s*true/);
    expect(call![1]).toMatch(/openHours:\s*DEMO_OPEN_HOURS/);
  });
});

describe("demo tenant — the seeder cannot write past the walls", () => {
  const seed = sourceOf("seed.ts");

  /**
   * Every address and number reaching the database goes through
   * `assertFiction` first. The check is a runtime throw rather than a type,
   * because the values that would be dangerous are exactly the ones built at
   * runtime — a concatenation, a value read back from a row, an argument.
   *
   * Mutation: remove any assertFiction call — the count drops and this fails.
   */
  it("calls assertFiction on every path that writes contact details", () => {
    const calls = [...seed.matchAll(/assertFiction\(/g)].length;
    // One declaration plus a call in each of: seedVoice (the business line),
    // seedContacts (each person), seedCalls (each caller), seedForm (each
    // submission). A new writer of contact details must add its own.
    expect(calls).toBeGreaterThanOrEqual(5);
  });

  /**
   * Suppression happens while the account is EMPTY. The window between
   * "account exists" and "account is suppressed" is a window in which a
   * seeded booking is due work to a cron that filters on nothing.
   *
   * Mutation: move suppressAndVerify below any seed* call — this fails and
   * says so.
   */
  it("suppresses the account before it writes a single row", () => {
    const suppress = seed.indexOf("await suppressAndVerify(db, accountId)");
    expect(suppress, "suppressAndVerify is not called in seedDemoTenant").toBeGreaterThan(-1);

    const firstWrite = Math.min(
      ...["await seedVoice(", "await seedContacts(", "await setBranding("]
        .map((s) => seed.indexOf(s))
        .filter((i) => i > -1));
    expect(firstWrite).toBeGreaterThan(suppress);
  });

  /**
   * The business line is injectable — it has to be, because
   * `phone_numbers.e164` is unique across every account, so a throwaway
   * tenant that reused the demo's number could only be seeded while no demo
   * tenant existed. Injectable means a number now arrives from OUTSIDE this
   * file's data, which is exactly the case `assertFiction` exists for, and it
   * is checked before the account is created so a dialable number is refused
   * with nothing written at all.
   *
   * A source walk, because the database cannot tell the two orderings apart:
   * the seeder drops its half-built account on any failure, so a guard that
   * fired late would leave the same rejection and the same absent account.
   *
   * Mutation: delete the assertFiction line from seedDemoTenant, or move it
   * below createAccount — this fails and names which.
   */
  it("checks the business line it was handed before it creates the account", () => {
    const body = seed.slice(seed.indexOf("export async function seedDemoTenant"));
    const guard = body.indexOf('assertFiction(undefined, businessLine, "the business line")');
    expect(guard, "seedDemoTenant does not check the business line it was handed")
      .toBeGreaterThan(-1);
    const create = body.indexOf("await createAccount(db, {");
    expect(create, "createAccount is not called in seedDemoTenant").toBeGreaterThan(-1);
    expect(guard, "the business line is checked after the account exists").toBeLessThan(create);
  });

  /** Mutation: drop either condition from dropDemoAccount — this fails. */
  it("guards the destructive path on both the org id and the flag", () => {
    const drop = seed.slice(seed.indexOf("export async function dropDemoAccount"));
    const body = drop.slice(0, drop.indexOf("\n}\n") + 3);
    expect(body).toMatch(/findDemoAccount\(db, orgId\)/);
    expect(body).toMatch(/outboundSuppressed/);
    expect(body).toMatch(/deleteAccountCascade/);
  });

  /** Mutation: widen the org-id pattern to `^org_` — a real Clerk org id
   *  becomes deletable by this function, and this fails. */
  it("accepts only org ids Clerk does not mint", () => {
    expect(seed).toMatch(/const SEEDABLE_ORG_ID = \/\^org_\(demo\|test\)_/);
  });

  /**
   * A seed that fails takes its half-built account with it.
   *
   * This is a source walk because forcing a mid-seed failure against a real
   * database means breaking the seeder to test the seeder. The shape is what
   * matters and the shape is checkable.
   *
   * It exists because the absence of it cost two CI runs. The first died
   * inside `backdateEvents` and left a COMPLETE account behind — 40 contacts,
   * 34 calls, a business line, a site, 60 days of traffic — in the one
   * Supabase project production uses. The second then failed on
   * `phone_numbers_e164_key`, which looks like an unrelated bug until you
   * notice `e164` is unique across EVERY account and the orphan still held
   * the demo's number.
   *
   * Mutation: remove the try/catch around `build()` — this fails.
   */
  it("removes the half-built account when a seed fails partway", () => {
    const body = seed.slice(seed.indexOf("export async function seedDemoTenant"));
    expect(body).toMatch(/try \{\s*\n\s*return await build\(\);/);
    expect(body).toMatch(/catch \(e\) \{[\s\S]{0,400}await dropDemoAccount\(db, orgId\)/);
    // The original error survives: a cleanup failure must never replace the
    // reason the seed failed, which is what the operator actually needs.
    expect(body).toMatch(/catch \(e\) \{[\s\S]{0,600}throw e;/);
  });

  /**
   * `events.id` is `bigint generated ALWAYS as identity`, so Postgres refuses
   * any statement that supplies a value for it — and an upsert must, because
   * the id is what it conflicts on.
   *
   * This is here because the first version of `backdateEvents` did exactly
   * that, to turn several hundred single-row updates into two bulk writes. It
   * typechecked, it passed every database-free test, and CI rejected it with
   * `cannot insert a non-DEFAULT value into column "id"`. The shape is
   * tempting enough to be worth writing down rather than rediscovering.
   *
   * Mutation: reintroduce an events upsert — this names it.
   */
  it("never tries to upsert an events row, because its id is generated ALWAYS", () => {
    expect(seed).not.toMatch(/from\("events"\)[\s\S]{0,80}\.upsert\(/);
  });

  /**
   * The logo is a committed binary read off disk at seed time, so it is the
   * one input to this seeder that a packaging or checkout mistake can remove
   * without any source change. `uploadBrandLogo` accepts png/jpeg/webp by
   * content type and does NOT sniff the bytes — it trusts the caller to have
   * validated them — so the magic number is checked here instead.
   */
  it("ships a real PNG for the demo company's mark", () => {
    const png = fs.readFileSync(path.join(DEMO_DIR, "assets", "resaca-air-mark.png"));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // 256x256, big-endian, at the fixed IHDR offset.
    expect(png.readUInt32BE(16)).toBe(256);
    expect(png.readUInt32BE(20)).toBe(256);
    // The editable source sits beside it; losing it makes the mark unfixable.
    expect(fs.existsSync(path.join(DEMO_DIR, "assets", "resaca-air-mark.svg"))).toBe(true);
  });
});

describe("demo tenant — the transcripts sell the right thing", () => {
  it("covers every call outcome, so the log is not five green rows out of five", () => {
    const outcomes = new Set(DEMO_TRANSCRIPTS.map((t) => t.outcome));
    expect([...outcomes].sort())
      .toEqual(["abandoned", "booked", "lead", "message", "spam"]);
  });

  it("is genuinely bilingual — the single most valuable thing this does in the Valley", () => {
    const es = DEMO_TRANSCRIPTS.filter((t) => t.lang === "es").length;
    expect(es).toBeGreaterThanOrEqual(3);
    // And the Spanish is Spanish, not an English script with a label on it.
    for (const t of DEMO_TRANSCRIPTS.filter((t) => t.lang === "es")) {
      expect(t.turns.some((turn) => /[áéíóúñ¿¡]/i.test(turn.text)), t.key).toBe(true);
    }
  });

  it("has a unique key per transcript, since the seeder cycles them by index", () => {
    const keys = DEMO_TRANSCRIPTS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never has Sofía quote a replacement price on the phone", () => {
    // The account's own `facts` say an estimator measures first. A demo that
    // shows the assistant contradicting the business's stated policy is a demo
    // of a liability, not a feature.
    for (const t of DEMO_TRANSCRIPTS) {
      for (const turn of t.turns.filter((x) => x.role === "assistant")) {
        expect(turn.text, `${t.key}: Sofía quotes a price`).not.toMatch(/\$\d/);
      }
    }
  });
});
