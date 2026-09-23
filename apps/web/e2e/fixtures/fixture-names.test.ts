import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  STALE_AFTER_MS, isStaleFixtureAccount, isStaleFixtureBlueprint, isStaleFixtureForm,
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
 * for each `${…}`, and asks the SAME three predicates sweep.ts calls
 * (`isStaleFixtureAccount`, `isStaleFixtureForm`, `isStaleFixtureBlueprint`)
 * whether a sweep a day later would admit it.
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
    "a CONTACT name the public form captures, not a form; forms.spec.ts's own purge removes it",
  "work-queue.spec.ts: E2E WorkQueue ${stamp}": "a contact name, not an account/org/form/blueprint",
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
