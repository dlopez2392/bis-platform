import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEMO_PEOPLE, DEMO_EMAIL_RE, DEMO_PHONE_RE, DEMO_BUSINESS_LINE,
  demoPhone, demoEmail,
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
