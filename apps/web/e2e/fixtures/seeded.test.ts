import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CI_SEED_COMMAND, lookupSeededAccountId, restoreSeededBrandColor, seededAccountMissingMessage,
} from "./seeded";

/**
 * The lookup client-branding.spec.ts uses to find its "another company" row.
 * Playwright cannot run from `pnpm check`, so the decision it rests on — found
 * exactly one, or fail naming the fix — is pinned here.
 *
 * Mutations (each reds the named case, each reverted byte-identical):
 *  - never take the zero-rows branch (so it returns `rows[0]!.id`, undefined)
 *    → "throws, naming ci:seed, when no account has the name" and "treats a
 *    null data payload as no account";
 *  - drop the `rows.length > 1` branch → "throws when the name is ambiguous";
 *  - hard-code `.eq("name", "Test Client One")` → "queries by the name it is
 *    given" (the spec would then look up a constant, not SEEDED_ACCOUNT_NAME).
 */

type Result = { data: Array<{ id: string }> | null; error: { message: string } | null };

function fakeDb(result: Result) {
  const limit = vi.fn(async () => result);
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const db = { from } as unknown as Parameters<typeof lookupSeededAccountId>[0];
  return { db, from, select, eq, limit };
}

const NAME = "Some Seeded Co";

describe("lookupSeededAccountId", () => {
  it("returns the id when exactly one account has the name", async () => {
    const { db } = fakeDb({ data: [{ id: "acc-1" }], error: null });
    await expect(lookupSeededAccountId(db, NAME)).resolves.toBe("acc-1");
  });

  it("queries by the name it is given, on the accounts table, fetching enough rows to see a duplicate", async () => {
    const { db, from, eq, limit } = fakeDb({ data: [{ id: "acc-1" }], error: null });
    await lookupSeededAccountId(db, NAME);
    expect(from).toHaveBeenCalledWith("accounts");
    expect(eq).toHaveBeenCalledWith("name", NAME);
    const [n] = limit.mock.calls[0] as unknown as [number];
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("throws, naming ci:seed, when no account has the name", async () => {
    const { db } = fakeDb({ data: [], error: null });
    await expect(lookupSeededAccountId(db, NAME)).rejects.toThrow(CI_SEED_COMMAND);
    await expect(lookupSeededAccountId(db, NAME)).rejects.toThrow(`"${NAME}"`);
  });

  it("treats a null data payload as no account, not as success", async () => {
    const { db } = fakeDb({ data: null, error: null });
    await expect(lookupSeededAccountId(db, NAME)).rejects.toThrow(CI_SEED_COMMAND);
  });

  it("throws when the name is ambiguous", async () => {
    const { db } = fakeDb({ data: [{ id: "acc-1" }, { id: "acc-2" }], error: null });
    await expect(lookupSeededAccountId(db, NAME)).rejects.toThrow(/More than one account/);
  });

  it("throws on a query fault, carrying the database's message", async () => {
    const { db } = fakeDb({ data: null, error: { message: "permission denied for table accounts" } });
    await expect(lookupSeededAccountId(db, NAME)).rejects.toThrow(/permission denied/);
  });
});

/**
 * A fake `accounts` table holding one row, recording every update patch. The
 * two chains restoreSeededBrandColor uses are reproduced exactly:
 * select → eq → maybeSingle, and update → eq → select.
 */
function fakeAccounts(row: { id: string; brand_color: string | null } | null) {
  const updates: Array<Record<string, unknown>> = [];
  const events = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === "events") return { insert: events };
    return {
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: row && row.id === id ? { brand_color: row.brand_color } : null, error: null,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => ({
          select: async () => {
            if (!row || row.id !== id) return { data: [], error: null };
            updates.push(patch);
            Object.assign(row, patch);
            return { data: [{ id }], error: null };
          },
        }),
      }),
    };
  });
  const db = { from } as unknown as Parameters<typeof restoreSeededBrandColor>[0];
  return { db, updates, events };
}

/**
 * The seeded account is someone else's real row. A green run must write
 * nothing to it; a red one must put back exactly the colour it found.
 *
 * Mutations:
 *  - disable the `=== before` early return → "writes nothing when the colour
 *    never moved" and "…still unbranded" (one update recorded each);
 *  - write `{ brand_color: before, brand_name: null }` → "puts back exactly the
 *    colour it found, and only that column" and "restores a null…".
 */
describe("restoreSeededBrandColor", () => {
  it("writes nothing when the colour never moved (the green-run case)", async () => {
    const { db, updates, events } = fakeAccounts({ id: "seed", brand_color: "#112233" });
    await expect(restoreSeededBrandColor(db, "seed", "#112233")).resolves.toBe(false);
    expect(updates).toEqual([]);
    expect(events).not.toHaveBeenCalled();
  });

  it("writes nothing when an unbranded account is still unbranded", async () => {
    const { db, updates } = fakeAccounts({ id: "seed", brand_color: null });
    await expect(restoreSeededBrandColor(db, "seed", null)).resolves.toBe(false);
    expect(updates).toEqual([]);
  });

  it("puts back exactly the colour it found, and only that column", async () => {
    const { db, updates, events } = fakeAccounts({ id: "seed", brand_color: "#654321" });
    await expect(restoreSeededBrandColor(db, "seed", "#112233")).resolves.toBe(true);
    expect(updates).toEqual([{ brand_color: "#112233" }]);
    expect(events).not.toHaveBeenCalled();
  });

  it("restores a null it found as null, not as some default", async () => {
    const { db, updates } = fakeAccounts({ id: "seed", brand_color: "#654321" });
    await restoreSeededBrandColor(db, "seed", null);
    expect(updates).toEqual([{ brand_color: null }]);
  });

  it("throws rather than reporting a restore of an account that is not there", async () => {
    const { db } = fakeAccounts(null);
    await expect(restoreSeededBrandColor(db, "seed", "#112233")).rejects.toThrow(/no account seed/);
  });
});

/**
 * The spec side, read as source because Playwright cannot run from
 * `pnpm check`. client-branding.spec.ts carried the production row id
 * `45240784-…` as its "another company" for months; on any other project that
 * made its boundary check vacuous. These pin that the spec finds the seeded
 * account BY NAME through the fail-loud lookup, and that no e2e file outside
 * this folder (whose tests hold id-shaped literals on purpose) addresses a row
 * by a literal id again.
 *
 * Mutations: put `const otherAccount = "45240784-a70e-43a0-8a0c-0027c7073f98";`
 * back in the spec → both cases red; pass `"Nonexistent Co"` instead of
 * `SEEDED_ACCOUNT_NAME` → "client-branding.spec.ts looks up…" reds.
 */
/**
 * Strips `//` line comments and `/* *\/` block comments before a
 * source-scanning guard matches against a file's text. Naive (it does not
 * understand string or regex literals), which is fine for guarding this
 * repo's own formatted source: without it, a regex like the one below is
 * satisfied by a call left behind IN A COMMENT — proving nothing — as soon as
 * the real call is deleted, renamed or broken.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("no e2e spec addresses an account by a hard-coded id", () => {
  const E2E_DIR = path.join(__dirname, "..");
  const HERE = path.resolve(__dirname);
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function tsFilesOutsideFixtures(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(full) !== HERE && entry.name !== ".auth") {
          out.push(...tsFilesOutsideFixtures(full));
        }
      } else if (entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
    return out;
  }

  it("client-branding.spec.ts looks up its other company by SEEDED_ACCOUNT_NAME (mutation: comment out the real call, leaving it in the file → FAILS once the match runs on comment-stripped source)", () => {
    const src = fs.readFileSync(path.join(E2E_DIR, "client-branding.spec.ts"), "utf8");
    expect(stripComments(src)).toMatch(/lookupSeededAccountId\(\s*serviceDb\(\)\s*,\s*SEEDED_ACCOUNT_NAME\s*\)/);
  });

  it("is not fooled by the call surviving only in a comment (proves the guard above reads code, not comments)", () => {
    const commentedOut = [
      "// const other = await lookupSeededAccountId(serviceDb(), SEEDED_ACCOUNT_NAME);",
      "/* const other2 = await lookupSeededAccountId(serviceDb(), SEEDED_ACCOUNT_NAME); */",
    ].join("\n");
    // Raw text still matches — this is exactly what would let a broken spec
    // read as green if the check above matched `src` instead of the stripped
    // text.
    expect(commentedOut).toMatch(/lookupSeededAccountId\(\s*serviceDb\(\)\s*,\s*SEEDED_ACCOUNT_NAME\s*\)/);
    expect(stripComments(commentedOut)).not.toMatch(/lookupSeededAccountId/);
  });

  it("no .ts file under e2e/ (outside fixtures/) carries a uuid literal", () => {
    const files = tsFilesOutsideFixtures(E2E_DIR);
    // Guards the walk itself: an empty list would make the loop vacuous.
    expect(files.map((f) => path.basename(f))).toContain("client-branding.spec.ts");
    for (const file of files) {
      const hit = fs.readFileSync(file, "utf8").match(UUID_RE);
      expect(hit?.[0], `${path.relative(E2E_DIR, file)} hard-codes a row id`).toBeUndefined();
    }
  });
});

describe("seededAccountMissingMessage", () => {
  it("names the account, where it was looked for, and the exact command that seeds it", () => {
    const msg = seededAccountMissingMessage(NAME, "on /dashboard/accounts");
    expect(msg).toContain(`"${NAME}"`);
    expect(msg).toContain("on /dashboard/accounts");
    expect(msg).toContain("pnpm --filter @bis/db ci:seed");
  });

  // The message is only useful if the command it names exists. A rename of
  // the script in packages/db would otherwise leave every missing-seed failure
  // telling the operator to run something that is not there.
  it("names a script packages/db actually defines, in the package it filters on", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../../../packages/db/package.json"), "utf8"),
    ) as { name: string; scripts: Record<string, string> };
    const [, , filter, script] = CI_SEED_COMMAND.split(" ");
    expect(pkg.name).toBe(filter);
    expect(Object.keys(pkg.scripts)).toContain(script);
  });
});

/**
 * `openAccountByName` (../support.ts) used to `test.skip` when the account
 * card was not found, which turned a missing seed into a green run on any
 * project that lacked it (this file's own header explains why that reads as
 * success). #132 made it fail loudly instead — the same fail-instead-of-skip
 * rule `lookupSeededAccountId` above enforces for client-branding.spec.ts —
 * but nothing stopped a later edit from re-adding a skip path. This is that
 * guard, read as source because Playwright cannot run from `pnpm check`.
 */
describe("openAccountByName fails loudly rather than skipping when the account is missing", () => {
  const SUPPORT_SRC = fs.readFileSync(path.join(__dirname, "../support.ts"), "utf8");

  /** The named function's body, matched by simple brace counting from its first `{`. */
  function functionBody(source: string, name: string): string {
    const at = source.indexOf(`function ${name}(`);
    if (at < 0) throw new Error(`support.ts has no function ${name}`);
    const braceStart = source.indexOf("{", at);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) return source.slice(braceStart, i + 1);
      }
    }
    throw new Error(`could not find the end of ${name}`);
  }

  const body = functionBody(SUPPORT_SRC, "openAccountByName");

  it(
    "never calls test.skip when the account card is not found (mutation: replace the failing " +
    "expect with `if ((await card.count()) === 0) { test.skip(true, seededAccountMissingMessage(" +
    "accountName, \"on /dashboard/accounts\")); return; }` → FAILS)",
    () => {
      expect(stripComments(body)).not.toMatch(/test\.skip/);
    },
  );

  it("fails via a not.toHaveCount(0) expectation naming seededAccountMissingMessage, not a silent return", () => {
    expect(body).toMatch(/\.not\.toHaveCount\(0\)/);
    expect(body).toMatch(/seededAccountMissingMessage\(/);
  });
});
