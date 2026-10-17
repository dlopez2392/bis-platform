import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

/**
 * Spec §7.2's guard: every file in the in-account route trees and lib/ that
 * can GET a service-key client is listed here WITH its reason. A new one
 * fails by name until someone decides which reason it has, so a service-key
 * read of customer data cannot slip past the Technician's RLS unnoticed.
 *
 * "Can get one" is any value-level mention of a getter, `serviceDb` or its
 * consent wrapper `ledgerDb`, once comments and type-only references are
 * stripped. Not just the named static import: that missed
 * `const { serviceDb } = await import("@bis/db")` (lib/ops/stamp.ts does it),
 * `import * as bis from "@bis/db"` then `bis.serviceDb()`, and a wrapper
 * such as `ledgerDb()`, which hands out the same client under another name.
 * The self-test below pins each of those shapes on fixture files. A NEW
 * wrapper is caught too: to return a service client it has to name one of
 * the getters itself, and then it is an importer here.
 *
 * Deliberately NOT scanned: the `writer` that textsContextFor and
 * emailContextFor return. Those two functions ARE listed (proven-target):
 * they build `writer` only after getContact on the caller's own client found
 * the contact, so every consumer of `ctx.writer` holds a client bound to an
 * already-proven contact, and the chokepoint is the function that made it.
 * The same holds for any helper that takes a client as a parameter: the
 * caller who chose to pass a service client is the one this scan lists.
 * Chasing `.writer` or every `db` parameter would list half the codebase and
 * teach people to add entries without reading them.
 */
type Reason = "agency-only" | "owner-only" | "configuration" | "proven-target" | "technician-filtered" | "before-trust" | "public-or-cron";
const SRC = join(__dirname, "../../../../..");   // apps/web/src
const ROOTS = ["app/(dashboard)/dashboard/accounts/[accountId]", "app/api/accounts", "lib"];
/**
 * Comments out. Block comments go first. A line comment is stripped only
 * when `//` starts the line or follows whitespace, so a URL ("https://…")
 * keeps the rest of its line. Strings are NOT tokenized: an apostrophe in
 * JSX text would otherwise swallow real code. Every shortcut here can only
 * leave a mention IN (a false positive costs one list entry), never take a
 * real one out.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Type-only references out: `import type {…}`, an inline `type serviceDb`
 *  specifier, and `typeof serviceDb` (the `ReturnType<typeof serviceDb>` idiom). */
function stripTypeOnly(source: string): string {
  return source
    .replace(/import\s+type\s*\{[^}]*\}\s*from\s*["'][^"']*["'];?/g, " ")
    .replace(/\btype\s+(?:serviceDb|ledgerDb)\b(?:\s+as\s+\w+)?/g, " ")
    .replace(/\btypeof\s+(?:serviceDb|ledgerDb)\b/g, " ");
}

/** Does this source get a service-key client? Any value-level mention of a
 *  getter that survives the two strips above (named, destructured from a
 *  dynamic import, a namespace member, or the ledger wrapper). */
function getsServiceClient(source: string): boolean {
  return /\b(?:serviceDb|ledgerDb)\b/.test(stripTypeOnly(stripComments(source)));
}

const ALLOWED: Record<string, Reason> = {
  "app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/automations/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/billing/page.tsx": "owner-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/branding/page.tsx": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/cancel-notice.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/page.tsx": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.ts": "proven-target",
  // ledgerDb after getContact on the request client found the call's contact.
  "app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.tsx": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.ts": "agency-only",
  // completeTaskAction's hold check: ledgerDb, beside a task write on the request client.
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/actions.ts": "proven-target",
  // ledgerDb after getContact on the request client found the contact.
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx": "proven-target",
  // setContactBusinessAction / undoContactBusinessAction: the group writes run on the service client
  // only after getContact on the request client found the contact (0069's tables are server-written).
  // createContactAction's narrow-caller flag write moved to lib/contacts/add-contact-by-hand.ts.
  // The language actions (S-09 §7.5) follow the same rule: the service writers run only after
  // getContact on the request client found the contact.
  // bulkDeleteContactsAction (0077, owner ruling 2026-10-13): the documents purge runs on the service
  // client only for the ids deleteContacts' request-client pre-read left deletable, scoped to the same
  // account, and only after requireAccountOwner.
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts": "proven-target",
  // The document vault (S-07): every service write and every minted URL follows a request-client read of the
  // record (getContact / readGroup) or the document (getDocument / getDocumentVersion, 0077's RLS).
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts": "proven-target",
  // Ask the customer (S-07 2b): the record or the request is read on the request client first (getContact /
  // readGroup / getDocumentRequest under 0080's RLS); the target and the channels on offer are read there too,
  // ledgerDb for the consent state only after that proof, and only then the service client's writes.
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-requests-actions.ts": "proven-target",
  // The required-documents checklist (S-07 2c): every skip write follows a request-client read of the contact,
  // the account's list and the skip row (0081's RLS), and a role check; the Undo is the actor's own.
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-requirements-actions.ts": "proven-target",
  // The Groups card: every service write follows a request-client read of its contact, membership or group;
  // restore's events read vouches a narrow caller's own removal (0069's tables are server-written).
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-actions.ts": "proven-target",
  // importContactsBatchAction's groupWriter: serviceDb() hands applyImportBatch
  // the service client, and its one business write runs only against contacts
  // the SAME batch just wrote through the request client, never an arbitrary id.
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts": "proven-target",
  // Task 12's held-email actions (File / Choose a record / Not a customer, each with Undo):
  // every service write follows provedRow's own read of the inbound_emails row (and its thread's
  // contact_id) on the request client, 0082's RLS; "Choose a record" additionally proves the
  // CHOSEN contact the same way — getContact on this same request client, never the service one —
  // before any service write names that contact at all (fix round 1 item 3).
  "app/(dashboard)/dashboard/accounts/[accountId]/conversations/inbound-actions.ts": "proven-target",
  // Fix round 1 (Task 11 UI review): the thread's own inbound-email notice needs each involved
  // contact's CURRENT email-consent state — ledgerDb, only after getContact on the request
  // client proved that contact (0068's own RLS scope), same pattern as the contact page.
  "app/(dashboard)/dashboard/accounts/[accountId]/conversations/page.tsx": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-section.tsx": "agency-only",
  // The required-documents list (S-07 2c): an Owner or the agency only (canManage), one account column.
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/document-requirements-actions.ts": "owner-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/shell-actions.ts": "technician-filtered",
  // completeWorkTask's hold check: ledgerDb, beside a task write on the request client.
  "app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/team/actions.ts": "owner-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/voice/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/website/actions.ts": "agency-only",
  // The drawer's Texts and Email rows: ledgerDb after getContact on the request client.
  "app/api/accounts/[accountId]/contacts/[contactId]/email/route.ts": "proven-target",
  "app/api/accounts/[accountId]/contacts/[contactId]/texts/route.ts": "proven-target",
  // The list drawer's summary (S-03 part 3): ledgerDb for the Text gate, only after getContact on the request client.
  "app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts": "proven-target",
  // The Documents card's requests (S-07 2b): getContact / readGroup on the request client first; ledgerDb for
  // the consent state after that proof.
  "app/api/accounts/[accountId]/contacts/[contactId]/document-requests/route.ts": "proven-target",
  "app/api/accounts/[accountId]/groups/[groupId]/document-requests/route.ts": "proven-target",
  "lib/auth.ts": "before-trust",
  "lib/booking/availability.ts": "public-or-cron",
  "lib/branding/tenant-theme-reader.ts": "configuration",
  "lib/consent/email-context.ts": "proven-target",
  "lib/consent/email-gate.ts": "proven-target",
  "lib/consent/ledger-db.ts": "proven-target",
  "lib/consent/texts-context.ts": "proven-target",
  // addContactByHand (moved from createContactAction; also the Relationships dialog's "New person",
  // spec R4): a narrow caller's duplicate flags are written by the service client, for a row the
  // caller just created.
  "lib/contacts/add-contact-by-hand.ts": "proven-target",
  // The webhook routes' heartbeat (dynamic import): writes ops_heartbeats, never reads customer data.
  "lib/ops/stamp.ts": "public-or-cron",
  "lib/preferences/person-prefs.ts": "before-trust",
  // loadPrimaryText (the group page's Text): ledgerDb only after getContact on the request client
  // proved the call-first member (S-03 part 2, C14).
  "lib/record/group-loaders.ts": "proven-target",
  "lib/setup/setup-inputs.ts": "agency-only",
  "lib/team/ensure-role.ts": "before-trust",
  "lib/voice/presence.ts": "technician-filtered",
  "lib/voice/tools/registry.ts": "public-or-cron",
  "lib/zone.ts": "configuration",
};

function importers(roots: readonly string[] = ROOTS, base: string = SRC): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && getsServiceClient(readFileSync(p, "utf8"))) {
        out.push(relative(base, p).split(sep).join("/"));
      }
    }
  };
  for (const r of roots) walk(join(base, r));
  return out.sort();
}

describe("every service-client getter on the in-account surface has a stated reason (spec §7.2)", () => {
  it("no unlisted importer (mutation: import serviceDb into contacts/page.tsx -> FAILS naming it)", () => {
    expect(importers().filter((f) => !(f in ALLOWED))).toEqual([]);
  });
  it("no stale entry (a file that stopped importing it leaves the list)", () => {
    const now = new Set(importers());
    expect(Object.keys(ALLOWED).filter((f) => !now.has(f))).toEqual([]);
  });
});

/**
 * The scan's own self-test, on throwaway fixture files laid out like the real
 * tree: each way of getting a service client is reported BY NAME, and the
 * mentions that get nothing (a comment, an `import type`, an inline
 * `type serviceDb`, a test file) are not.
 */
describe("the scan itself: every way to get a service client is caught, and nothing else is", () => {
  const base = mkdtempSync(join(tmpdir(), "service-reads-"));
  const dir = join(base, "app", "fixture");
  mkdirSync(dir, { recursive: true });
  const fixture = (name: string, body: string) => writeFileSync(join(dir, name), body);
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const GETS: Record<string, string> = {
    "static-named.ts": `import {\n  getContact,\n  serviceDb,\n} from "@bis/db";\nexport const f = () => getContact(serviceDb(), "a", "c");\n`,
    "dynamic-destructure.ts": `export async function f() {\n  const { serviceDb } = await import("@bis/db");\n  return serviceDb().from("contacts").select("*");\n}\n`,
    "namespace-import.ts": `import * as bis from "@bis/db";\nexport const f = () => bis.serviceDb().from("contacts").select("*");\n`,
    "ledger-wrapper.tsx": `import { ledgerDb } from "@/lib/consent/ledger-db";\nexport const f = () => ledgerDb().from("contacts").select("*");\n`,
  };
  const GETS_NOTHING: Record<string, string> = {
    "comment-only.ts": `// serviceDb is not used here\n/* nor ledgerDb() */\nexport const x = 1; // NEVER serviceDb here\n/**\n * serviceDb() in a doc comment\n */\nexport const url = "https://example.test";\n`,
    "import-type.ts": `import type { serviceDb } from "@bis/db";\nexport type Db = ReturnType<typeof serviceDb>;\n`,
    "import-type-renamed.ts": `import type { serviceDb as serviceDbType } from "@bis/db";\nexport type Db = ReturnType<typeof serviceDbType>;\n`,
    "inline-type.ts": `import { insertProposal, type serviceDb } from "@bis/db";\nexport type Db = ReturnType<typeof serviceDb>;\nexport { insertProposal };\n`,
    "getter.test.ts": `import { serviceDb } from "@bis/db";\nserviceDb();\n`,
  };
  for (const [name, body] of Object.entries({ ...GETS, ...GETS_NOTHING })) fixture(name, body);

  for (const name of Object.keys(GETS)) {
    it(`reports ${name} by name`, () => {
      expect(importers(["app"], base)).toContain(`app/fixture/${name}`);
    });
  }
  it("reports nothing for a comment, an import type, an inline type specifier or a test file", () => {
    expect(importers(["app"], base)).toEqual(Object.keys(GETS).map((n) => `app/fixture/${n}`).sort());
  });
});
