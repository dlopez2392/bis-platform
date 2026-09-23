import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FIXTURE_ACCOUNT_RE, FIXTURE_BLUEPRINT_PREFILTER, FIXTURE_BLUEPRINT_RE, FIXTURE_CO_ACCOUNT_RE,
  FIXTURE_FORM_RE, FIXTURE_NAME_PREFILTER, STALE_AFTER_MS,
  isStaleFixtureAccount, isStaleFixtureBlueprint, isStaleFixtureForm,
} from "./stale";

/**
 * Every stamped `E2E …` name a spec mints is either one the sweep deletes by
 * name, or listed below with the reason it does not need to be.
 *
 * WHY. The sweep (sweep.ts) is what cleans up after a KILLED run, and it finds
 * things only by name. A spec that mints a new name shape is invisible to it:
 * `blueprints.spec.ts` created `E2E Co <stamp>` (a real Clerk org and account)
 * and `E2E Blueprint <stamp>` for months while the sweep knew only
 * `E2E Client Co <stamp>`, so every killed run stranded both, permanently —
 * the same gap packages/db's sweep had until #115. This walks the source
 * rather than trusting a list someone remembers to update: a new stamped name
 * reds here, by name, until the sweep admits it or someone writes down why it
 * does not have to.
 *
 * WHAT IT READS. Every `.ts` file under `apps/web/e2e` except this folder
 * (whose tests are full of fixture-shaped literals on purpose): the specs,
 * `auth.setup.ts`, `auth.teardown.ts`, `sweep.setup.ts`, `support.ts`. It
 * collects every template literal that STARTS with `E2E ` and interpolates
 * something — the shape every stamped fixture name has — substitutes a stamp
 * for each `${…}`, and asks the SAME three DECISION predicates sweep.ts calls
 * (`isStaleFixtureAccount`, `isStaleFixtureForm`, `isStaleFixtureBlueprint`)
 * whether they would admit it a day later. That is narrower than "whether a
 * sweep would admit it": sweep.ts's own `.like()` prefilter decides what a
 * decision predicate ever gets to see, and this file said nothing about that
 * prefilter until the "the network prefilter" describe block below — before
 * it existed, narrowing that prefilter to `"E2E Client Co %"` still left
 * every case here green, because a predicate never got asked about a row the
 * network never returned.
 *
 * LIMITS, stated rather than hidden: a name built by concatenation
 * (`"E2E Co " + stamp`) is not seen; and "admitted" means admitted by SOME
 * leg — an account minted with a form-shaped name would pass here while the
 * accounts leg ignored it. Both would take a deliberate act to write.
 *
 * Mutation: drop `FIXTURE_CO_ACCOUNT_RE` from `FIXTURE_ACCOUNT_PATTERNS`
 * (stale.ts) and the `blueprints.spec.ts: E2E Co ${stamp}` case reds.
 */

const E2E_DIR = path.join(__dirname, "..");
const HERE = path.resolve(__dirname);

/** Any plausible 13-digit stamp; the sweep reads the stamp from the name. */
const SAMPLE_STAMP = 1786412389258;
/** A day later — far past the window, so only the NAME decides. */
const A_DAY_LATER = SAMPLE_STAMP + 24 * 60 * 60 * 1000;

/**
 * Stamped names the sweep deliberately does NOT match by name, keyed
 * `<file relative to e2e/>: <literal>`. Keyed by FILE as well as text so that
 * reusing one of these strings for an account in some other spec is still a
 * new, unexplained name and reds.
 */
const NOT_SWEPT_BY_NAME: Record<string, string> = {
  "auth.setup.ts: E2E Brand Form ${stamp}":
    "a form on the per-run fixture account — removed by that account's cascade (teardown, or the accounts leg)",
  "concierge.spec.ts: E2E Concierge ${stamp}":
    "a form on the per-run fixture account — removed by that account's cascade",
  "forms.spec.ts: E2E Lead ${stamp}":
    "a CONTACT row the public form captures, on the SEEDED account (Test Client One) — its " +
    "purge runs in a `finally` that a killed run never reaches, so a killed run DOES strand it " +
    "(the ledger has found one). Contacts are outside the name sweep entirely — no leg queries " +
    "the contacts table by name — which is a known gap, ledgered, not a behaviour this sweep " +
    "closes today.",
  // NOT the same account as E2E Lead, despite the shape looking alike: this
  // contact is created on the PER-RUN FIXTURE account (`fixture.accountId`,
  // work-queue.spec.ts:163-174), never on Test Client One — the spec's own
  // comment says so (:156-158). `contacts` has no name-based leg of its own,
  // but it IS in `ACCOUNT_OWNED_TABLES` (packages/db), so once the fixture
  // ACCOUNT is recognised stale by name (FIXTURE_ACCOUNT_RE) and swept — by
  // teardown on a completed run, or by the accounts leg's cascade on a
  // killed one — this row goes with it. It is not independently stranded the
  // way E2E Lead is; it rides the account's own sweep.
  "work-queue.spec.ts: E2E WorkQueue ${stamp}":
    "a contact row on the PER-RUN FIXTURE account, not the seeded account — removed by that " +
    "account's own cascade (teardown, or the accounts leg once the account's name is " +
    "recognised stale) because contacts is in ACCOUNT_OWNED_TABLES; contacts have no name-based " +
    "leg of their own, but this row is not independently stranded the way E2E Lead is.",
  "activity.spec.ts: E2E reason ${STAMP}": "free text on a row, not a name the sweep could key on",
  "automations-b.spec.ts: E2E reason ${STAMP}": "free text on a row, not a name the sweep could key on",
  "calendar-meeting-settings.spec.ts: E2E follow-up body ${Date.now()}":
    "a message body on the per-run fixture account",
  "booking.spec.ts: E2E booking note ${stamp}": "a booking note on the per-run fixture account",
  "messaging.spec.ts: E2E ${Date.now()}": "an email subject line, not a name",
};

type Found = { key: string; file: string; line: number; literal: string; sample: string };

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path.resolve(full) === HERE) continue;
      out.push(...tsFilesUnder(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function findStampedNames(): Found[] {
  const found: Found[] = [];
  for (const file of tsFilesUnder(E2E_DIR)) {
    const src = fs.readFileSync(file, "utf8");
    // Portable in failure prints: "blueprints.spec.ts", never a backslash path.
    const rel = path.relative(E2E_DIR, file).split(path.sep).join("/");
    for (const match of src.matchAll(/`(E2E [^`]*)`/g)) {
      const literal = match[1]!;
      if (!literal.includes("${")) continue;
      const line = src.slice(0, match.index).split("\n").length;
      found.push({
        key: `${rel}: ${literal}`,
        file: rel,
        line,
        literal,
        sample: literal.replace(/\$\{[^}]*\}/g, String(SAMPLE_STAMP)),
      });
    }
  }
  return found;
}

function sweptByName(name: string): boolean {
  return isStaleFixtureAccount(name, A_DAY_LATER)
    || isStaleFixtureForm(name, A_DAY_LATER)
    || isStaleFixtureBlueprint(name, A_DAY_LATER);
}

const FOUND = findStampedNames();

describe("every stamped E2E name a spec mints is known to the sweep", () => {
  // Without this, a walker that silently found nothing would leave every
  // per-name case below absent and the file green.
  it("the walk finds the names the sweep exists for", () => {
    const keys = FOUND.map((f) => f.key);
    expect(keys).toContain("auth.setup.ts: E2E Client Co ${stamp}");
    expect(keys).toContain("blueprints.spec.ts: E2E Co ${stamp}");
    expect(keys).toContain("blueprints.spec.ts: E2E Blueprint ${stamp}");
    expect(keys).toContain("forms.spec.ts: E2E Form ${stamp}");
    expect(keys).toContain("forms.spec.ts: E2E Spam ${stamp}");
  });

  // Exercises the substitution itself, so a broken `${…}` replacement cannot
  // turn every case below into a comparison of junk.
  it("a substituted sample is the name a run would really mint", () => {
    const co = FOUND.find((f) => f.key === "blueprints.spec.ts: E2E Co ${stamp}");
    expect(co?.sample).toBe(`E2E Co ${SAMPLE_STAMP}`);
    expect(A_DAY_LATER - SAMPLE_STAMP).toBeGreaterThan(STALE_AFTER_MS);
  });

  for (const found of FOUND) {
    it(found.key, () => {
      const admitted = sweptByName(found.sample);
      const reason = NOT_SWEPT_BY_NAME[found.key];
      expect(
        admitted || reason !== undefined,
        `${found.file}:${found.line} mints "${found.literal}", which no sweep pattern in ` +
        `fixtures/stale.ts admits and NOT_SWEPT_BY_NAME does not explain. If it names an ` +
        `account, Clerk org, form or blueprint, add an anchored pattern to stale.ts and a leg ` +
        `to sweep.ts; if it is text on a row the cascade already removes, list it with the reason.`,
      ).toBe(true);
    });
  }

  // An exemption for a literal that no longer exists is dead text that could
  // one day excuse a real name reintroduced under it; and an exemption for a
  // name the sweep DOES match is a contradiction.
  it("every exemption names a literal that still exists and is not swept", () => {
    const keys = new Set(FOUND.map((f) => f.key));
    for (const key of Object.keys(NOT_SWEPT_BY_NAME)) {
      expect(keys.has(key), `NOT_SWEPT_BY_NAME has a stale entry: ${key}`).toBe(true);
      const sample = FOUND.find((f) => f.key === key)?.sample ?? "";
      expect(sweptByName(sample), `${key} is exempt but the sweep matches it`).toBe(false);
    }
  });
});

/**
 * Translates a SQL `LIKE` pattern into the regex Postgres behaves as, so a
 * sample name can be checked against sweep.ts's own network prefilter
 * exactly the way the database would apply it: `%` is "any run of
 * characters", `_` is "any one character", and everything else is literal
 * (escaped here so a future prefilter carrying a regex metacharacter is
 * still read literally rather than silently, which is what makes "everything
 * else is literal" true instead of assumed).
 */
function likeToRegex(pattern: string): RegExp {
  const body = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${body}$`);
}

/**
 * #120 review m1: the database prefilters (`FIXTURE_NAME_PREFILTER`,
 * `FIXTURE_BLUEPRINT_PREFILTER` in stale.ts) were untested — reverting the
 * first to `"E2E Client Co %"` left `vitest run e2e/fixtures` fully green,
 * because nothing checked that the row a decision predicate is willing to
 * admit is a row the network prefilter would ever fetch in the first place.
 * This walks the SAME `FOUND` samples the describe block above does and
 * asserts each one satisfies the LIKE of the two EXPORTED CONSTANTS,
 * translated to a regex above.
 *
 * #121 review I3: that is narrower than it sounds — it pins what the
 * constants themselves would admit, not what `sweep.ts` actually SENDS.
 * Reverting `sweep.ts`'s accounts leg to the literal
 * `.like("name", "E2E Client Co %")` changes nothing this describe block
 * reads, so the suite stayed 52/52 green under that regression too. The
 * describe block below this one reads `sweep.ts`'s own source instead, and
 * is the one that actually catches a call site drifting onto its own
 * literal.
 */
describe("the network prefilter each leg's .like() sends actually admits what its decision predicate admits", () => {
  const ACCOUNT_PREFILTER_RE = likeToRegex(FIXTURE_NAME_PREFILTER);
  const BLUEPRINT_PREFILTER_RE = likeToRegex(FIXTURE_BLUEPRINT_PREFILTER);

  // Pinned directly, by name, rather than relying only on the walk below:
  // the exact regression this item exists for.
  it("admits E2E Co, not just E2E Client Co (the shape a revert would silently starve)", () => {
    expect(ACCOUNT_PREFILTER_RE.test(`E2E Co ${SAMPLE_STAMP}`)).toBe(true);
    expect(ACCOUNT_PREFILTER_RE.test(`E2E Client Co ${SAMPLE_STAMP}`)).toBe(true);
  });

  for (const found of FOUND) {
    // Exempt names are contacts / free text / message bodies — no leg's
    // `.like()` ever queries the table they would appear in by this name, so
    // no prefilter applies to them at all.
    if (NOT_SWEPT_BY_NAME[found.key] !== undefined) continue;

    const isAccount = FIXTURE_ACCOUNT_RE.test(found.sample) || FIXTURE_CO_ACCOUNT_RE.test(found.sample);
    const isForm = FIXTURE_FORM_RE.test(found.sample);
    const isBlueprint = FIXTURE_BLUEPRINT_RE.test(found.sample);

    it(`${found.key} satisfies the LIKE its leg sends over the network`, () => {
      // At least one of the three must be true here: the describe block
      // above already reds on any FOUND sample that is neither exempt nor
      // admitted by some leg, so reaching this `it` at all means one is.
      if (isAccount || isForm) {
        expect(ACCOUNT_PREFILTER_RE.test(found.sample), found.sample).toBe(true);
      }
      if (isBlueprint) {
        expect(BLUEPRINT_PREFILTER_RE.test(found.sample), found.sample).toBe(true);
      }
    });
  }
});

/**
 * Copied from `packages/db/src/__tests__/cascade-export-boundary.test.ts`,
 * not imported: that file's helper is private to its own test, and a shared
 * module is one more file to keep honest for a handful of lines used in two
 * places. Strings are tracked so a `//` inside a literal cannot eat the rest
 * of its line, and block comments keep their newlines.
 */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    // inside a string literal
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}

/**
 * #121 review I3: the describe block above pins the two EXPORTED CONSTANTS
 * (`FIXTURE_NAME_PREFILTER`, `FIXTURE_BLUEPRINT_PREFILTER`) against every
 * sample name this file walks — it never reads `sweep.ts` itself, so
 * changing `sweep.ts`'s accounts leg (:150) to the literal
 * `.like("name", "E2E Client Co %")` left `vitest run e2e/fixtures` at
 * 52/52 green: the constant `FIXTURE_NAME_PREFILTER` was still correct, it
 * was simply no longer what got sent over the network.
 *
 * This reads `sweep.ts` with comments stripped and asserts every
 * `.like("name", X)` call site passes one of the two exported identifiers —
 * never a string literal of its own, even one shaped exactly like the
 * constant it should have used. Three call sites at last count: the
 * accounts leg and the forms leg both send `FIXTURE_NAME_PREFILTER`, the
 * blueprints leg sends `FIXTURE_BLUEPRINT_PREFILTER`.
 *
 * Mutation: revert `sweep.ts:150`'s `.like("name", FIXTURE_NAME_PREFILTER)`
 * to `.like("name", "E2E Client Co %")` — reds "every call site passes an
 * exported identifier" by naming the literal. Add a fourth
 * `.like("name", "E2E %")` anywhere in `sweep.ts` — reds "finds exactly
 * three" (four found) and the identifier check (the added literal is not
 * one of the two names). Both revert byte-identical.
 */
describe("sweep.ts's own .like(\"name\", …) call sites send an exported identifier, not a literal", () => {
  const SWEEP_PATH = path.join(HERE, "sweep.ts");
  const SWEEP_SRC = stripComments(fs.readFileSync(SWEEP_PATH, "utf8"));
  const LIKE_NAME_RE = /\.like\(\s*"name"\s*,\s*([^)]+?)\s*\)/g;
  const ARGS = [...SWEEP_SRC.matchAll(LIKE_NAME_RE)].map((m) => m[1]!.trim());
  const ALLOWED = ["FIXTURE_NAME_PREFILTER", "FIXTURE_BLUEPRINT_PREFILTER"];

  it("finds exactly three .like(\"name\", …) call sites in sweep.ts", () => {
    expect(ARGS).toEqual([
      "FIXTURE_NAME_PREFILTER", "FIXTURE_NAME_PREFILTER", "FIXTURE_BLUEPRINT_PREFILTER",
    ]);
  });

  it("every call site passes an exported prefilter identifier, never a literal", () => {
    for (const arg of ARGS) {
      expect(ALLOWED, `sweep.ts sends .like("name", ${arg}), not an exported identifier`)
        .toContain(arg);
    }
  });
});
