import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * M7a PR-4, Task 7 (plan G11): "dashboard read-only" for a CLIENT on a paused
 * account. The first half is the refusal itself (`refuseActionWhilePaused`,
 * `sameAccountPath`); the second is the source scans that pin which server
 * actions stay usable while paused, why, and that none of them writes. Every
 * case names the mutation that turns it red.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const fx = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  headersCalls: 0,
  paused: true,
  verdictCalls: [] as string[],
}));
vi.mock("next/headers", () => ({
  headers: async () => { fx.headersCalls++; return new Headers(fx.headers); },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); },
}));
vi.mock("./standing-read", () => ({
  billingVerdictFor: async (accountId: string) => {
    fx.verdictCalls.push(accountId);
    return { paused: fx.paused, voice: !fx.paused, concierge: !fx.paused, forward: true, cause: fx.paused ? "payment" : null, pausedAt: null };
  },
}));

const { ACTION_HEADER, refuseActionWhilePaused, sameAccountPath } = await import("./read-only");

const HOME = `/dashboard/accounts/${A}/dashboard`;
const redirectedTo = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (typeof url !== "string") throw e;
    return url;
  }
};

beforeEach(() => {
  fx.headers = { [ACTION_HEADER]: "abc123", referer: `https://app.example/dashboard/accounts/${A}/contacts?q=ana` };
  fx.headersCalls = 0;
  fx.paused = true;
  fx.verdictCalls = [];
  vi.stubEnv("BILLING_ENFORCE", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sameAccountPath (plan G11)", () => {
  it("keeps a path inside this account only, dropping the origin (mutation: accept any /dashboard path → FAILS)", () => {
    expect(sameAccountPath(`https://x/dashboard/accounts/${A}/contacts?q=1`, A)).toBe(`/dashboard/accounts/${A}/contacts?q=1`);
    expect(sameAccountPath(`https://evil.example/dashboard/accounts/${A}/calendar`, A)).toBe(`/dashboard/accounts/${A}/calendar`);
    expect(sameAccountPath(`https://x/dashboard/accounts/${B}/contacts`, A)).toBeNull();
    expect(sameAccountPath("https://x/dashboard/work", A)).toBeNull();
    expect(sameAccountPath(`https://x/dashboard/accounts/${A}`, A)).toBeNull();
    expect(sameAccountPath(`https://x/dashboard/accounts/${A}/../${B}/contacts`, A)).toBeNull();
    expect(sameAccountPath("not a url", A)).toBeNull();
    expect(sameAccountPath(`/dashboard/accounts/${A}/contacts`, A)).toBeNull();
    expect(sameAccountPath(null, A)).toBeNull();
  });
});

describe("refuseActionWhilePaused (plan G11)", () => {
  it("switch off → returns, reads nothing (mutation: drop the switch check → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "");
    expect(await redirectedTo(refuseActionWhilePaused(A, HOME))).toBeNull();
    expect(fx.headersCalls).toBe(0);
    expect(fx.verdictCalls).toEqual([]);
  });

  it("no next-action header (a page render) → returns, and billing is not read (mutation: drop the header check → FAILS)", async () => {
    delete fx.headers[ACTION_HEADER];
    expect(await redirectedTo(refuseActionWhilePaused(A, HOME))).toBeNull();
    expect(fx.verdictCalls).toEqual([]);
  });

  it("a server action on a paused account → redirect to the referer's path (mutation: always redirect home → FAILS)", async () => {
    expect(await redirectedTo(refuseActionWhilePaused(A, HOME))).toBe(`/dashboard/accounts/${A}/contacts?q=ana`);
    expect(fx.verdictCalls).toEqual([A]);
  });

  it("no usable referer → the fallback (mutation: redirect to '/' → FAILS)", async () => {
    fx.headers.referer = `https://app.example/dashboard/accounts/${B}/contacts`;
    expect(await redirectedTo(refuseActionWhilePaused(A, HOME))).toBe(HOME);
    delete fx.headers.referer;
    expect(await redirectedTo(refuseActionWhilePaused(A, HOME))).toBe(HOME);
  });

  it("not paused → returns (mutation: refuse every action while the switch is on → FAILS)", async () => {
    fx.paused = false;
    expect(await redirectedTo(refuseActionWhilePaused(A, HOME))).toBeNull();
    expect(fx.verdictCalls).toEqual([A]);
  });
});

/* ------------------------------------------------------------------------ */
/* The scans.                                                                */
/* ------------------------------------------------------------------------ */

const SRC = join(__dirname, "../..");   // apps/web/src
const ACCOUNT_ROOTS = ["app/(dashboard)/dashboard/accounts/[accountId]", "lib"];

/**
 * THE ALLOW-LIST (plan G11, Task 7 Step 1). Every account-scoped server
 * action that stays usable for a client while the account is paused, keyed
 * `file#function`, each with its reason. The audit read every exported action
 * in the 38 account-scoped "use server" files (36 under accounts/[accountId],
 * lib/ai-acts/actions.ts, lib/proposals/actions.ts): these are the ones that
 * write nothing and call no model or provider, plus Manage billing, which is
 * how a paused client pays. A getter that lazily creates a row is a write:
 * getForwardingAddressAction is NOT here (M6). Agency-only actions need no
 * entry (a client is refused by their own guard first).
 */
const READ_ONLY_ALLOWED: Record<string, string> = {
  "app/(dashboard)/dashboard/accounts/[accountId]/billing/actions.ts#openBillingPortalAction":
    "the way to pay (spec flow 5): a Stripe Customer Portal session, no row written",
  "app/(dashboard)/dashboard/accounts/[accountId]/shell-actions.ts#getShellSnapshot":
    "the shell's background read on every in-account navigation (badge, meter, presence, status): reads only",
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts#getDocumentUrlAction":
    "opening a file: reads the version and mints a 120-second signed read URL, writes nothing",
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts#countContactDocumentsAction":
    "the delete dialog's file count: one count on the request client (the delete itself is refused)",
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-actions.ts#searchGroupsAction":
    "the Groups card's search: one read on the request client",
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationship-actions.ts#searchRelatableContactsAction":
    "the relationship and holding-move pickers' search: one read on the request client",
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-requests-actions.ts#documentRequestLinkAction":
    "Copy link on an open request: reads the request and builds its URL, writes nothing",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.ts#cancelNoticeOptionAction":
    "Cancel's notice check: reads the booking's email and suppression state (the cancel itself is refused)",
};

/** The non-GET handlers under app/api/accounts, each with how a paused account is answered. */
const NON_GET_HANDLERS: Record<string, string> = {
  "app/api/accounts/[accountId]/contacts/[contactId]/ai-summary/route.ts#POST": "AI off while paused (G21)",
};

/** Plan Global Constraints: the only non-test files that read the billing standing. Tasks 5 and 6 add the
 *  first four; until both have landed this is a ceiling, and standing-read.ts must already be one of them. */
const STANDING_READERS = [
  "lib/consent/gate.ts",
  "lib/consent/email-gate.ts",
  "app/api/voice/texml/route.ts",
  "app/api/concierge/[publicId]/turn/route.ts",
  "lib/billing/standing-read.ts",
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(SRC, p).split(sep).join("/");
const source = (r: string) => readFileSync(join(SRC, r), "utf8");

/** The account-scoped "use server" files: the directive is the file's first line. */
function actionFiles(): string[] {
  return ACCOUNT_ROOTS.flatMap((r) => walk(join(SRC, r)))
    .filter((p) => /^\s*["']use server["']/.test(readFileSync(p, "utf8")))
    .map(rel).sort();
}

/**
 * The body of the function declared at `start`: past the balanced parameter
 * list, the first `{` that ends its line opens the body (a return type's own
 * braces never end a line in this tree), then to the matching `}`
 * (technician-guards.test.ts's scanner). Returns the body's [from, to) range.
 */
function bodyRange(src: string, start: number): [number, number] {
  let i = src.indexOf("(", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  const open = src.slice(i).search(/\{\s*\n/) + i;
  depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return [open, j + 1];
  }
  throw new Error("unbalanced body");
}

type Fn = { key: string; name: string; body: string; from: number; to: number };
function exportedActions(r: string): Fn[] {
  const src = source(r);
  return [...src.matchAll(/export async function (\w+)\(/g)].map((m) => {
    const [from, to] = bodyRange(src, m.index!);
    return { key: `${r}#${m[1]}`, name: m[1]!, body: src.slice(from, to), from, to };
  });
}

/** Any mention of the option as a value, comments included (a mention in a comment of a write action
 *  fails the scan rather than slipping past it). The definition (`duringPause?:`) never matches. */
const OPTION = /\bduringPause\s*:/g;

/** Every `file#function` whose body passes the option, and every mention of it OUTSIDE such a body. */
function optOuts(): { inside: string[]; stray: string[] } {
  const inside = new Set<string>();
  const stray: string[] = [];
  const files = new Set(actionFiles());
  for (const p of walk(SRC)) {
    const r = rel(p);
    if (r === "lib/auth.ts") continue; // the definition; auth.test.ts pins how it is passed through
    const src = readFileSync(p, "utf8");
    const fns = files.has(r) ? exportedActions(r) : [];
    for (const m of src.matchAll(OPTION)) {
      const fn = fns.find((f) => m.index! >= f.from && m.index! < f.to);
      if (fn) inside.add(fn.key); else stray.push(`${r} at offset ${m.index}`);
    }
  }
  return { inside: [...inside].sort(), stray };
}

describe("the allow-list (plan G11, Task 7 Step 1)", () => {
  it("the scan sees every account-scoped action file (a scan of nothing proves nothing)", () => {
    const files = actionFiles();
    expect(files.length).toBeGreaterThanOrEqual(38);
    for (const f of [
      "app/(dashboard)/dashboard/accounts/[accountId]/billing/actions.ts",
      "app/(dashboard)/dashboard/accounts/[accountId]/shell-actions.ts",
      "lib/ai-acts/actions.ts", "lib/proposals/actions.ts",
    ]) expect(files).toContain(f);
  });

  it("THE ALLOW-LIST: the set of (file, function) passing `duringPause: \"allow\"` equals READ_ONLY_ALLOWED, each with a reason (mutation: add the option to a write action → FAILS by name)", () => {
    const { inside, stray } = optOuts();
    expect(stray, "the option outside an exported action's body").toEqual([]);
    expect(inside).toEqual(Object.keys(READ_ONLY_ALLOWED).sort());
    for (const [key, why] of Object.entries(READ_ONLY_ALLOWED)) expect(why.trim().length, key).toBeGreaterThan(10);
  });

  it("each allowed action passes the option to its awaited access guard, once (mutation: pass it to a second call → FAILS)", () => {
    for (const key of Object.keys(READ_ONLY_ALLOWED)) {
      const [file, name] = key.split("#") as [string, string];
      const fn = exportedActions(file).find((f) => f.name === name);
      expect(fn, key).toBeDefined();
      expect([...fn!.body.matchAll(OPTION)].length, key).toBe(1);
      expect(fn!.body, key).toMatch(/await\s+require(?:AccountAccess|AccountOwner|NotTechnician)\(accountId,\s*\{\s*duringPause:\s*"allow"\s*\}\)/);
    }
  });

  it("getForwardingAddressAction is NOT allowed: it creates the forwarding address on first use (M6) (mutation: add it → FAILS by name)", () => {
    const key = "app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/forwarding-actions.ts#getForwardingAddressAction";
    expect(exportedActions(key.split("#")[0]!).map((f) => f.key)).toContain(key);
    expect(Object.keys(READ_ONLY_ALLOWED)).not.toContain(key);
    expect(optOuts().inside).not.toContain(key);
  });

  it("no allowed action revalidates: a revalidation re-renders the page inside the action's own request, where the guard would refuse it (mutation: add revalidatePath to getShellSnapshot → FAILS)", () => {
    for (const key of Object.keys(READ_ONLY_ALLOWED)) {
      const [file, name] = key.split("#") as [string, string];
      const fn = exportedActions(file).find((f) => f.name === name)!;
      expect(fn.body, key).not.toMatch(/\b(?:revalidatePath|revalidateTag|updateTag|refresh)\s*\(/);
    }
  });
});

describe("one decision, read in few places (plan Global Constraints)", () => {
  it("only the five named non-test files import readBillingStanding, standing-read.ts among them (mutation: import it from a pass → FAILS by name)", () => {
    const readers = walk(SRC).filter((p) => /\breadBillingStanding\b/.test(readFileSync(p, "utf8"))).map(rel).sort();
    expect(readers.filter((r) => !(STANDING_READERS as readonly string[]).includes(r))).toEqual([]);
    expect(readers).toContain("lib/billing/standing-read.ts");
  });
});

describe("the client API's writes (plan G11, G21)", () => {
  it("every non-GET handler under app/api/accounts is listed with its reason (mutation: add a POST without a reason → FAILS)", () => {
    const found: string[] = [];
    for (const p of walk(join(SRC, "app/api/accounts"))) {
      const src = readFileSync(p, "utf8");
      const verbs = /\b(POST|PUT|PATCH|DELETE)\b/;
      for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)) {
        if (verbs.test(m[1]!) && m[1] === m[1]!.toUpperCase()) found.push(`${rel(p)}#${m[1]}`);
      }
      for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const name of m[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!)) {
          if (/^(POST|PUT|PATCH|DELETE)$/.test(name)) found.push(`${rel(p)}#${name}`);
        }
      }
    }
    expect(found.sort()).toEqual(Object.keys(NON_GET_HANDLERS).sort());
    for (const [key, why] of Object.entries(NON_GET_HANDLERS)) expect(why.trim().length, key).toBeGreaterThan(5);
  });
});
