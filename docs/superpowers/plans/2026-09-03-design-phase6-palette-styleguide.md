# Design Phase 6 — Command Palette + /styleguide — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ⌘K over the whole operator surface — static destinations plus live
contact/call/conversation search — and the agency-only `/dashboard/styleguide`
page the definition-of-done already references.

**Architecture:** Two result classes. A pure, role-filtered registry module
(`lib/palette/registry.ts`) built FROM `lib/nav-groups.ts` so a nav destination
cannot exist without a palette entry — filtered by a pure function that is unit
testable without a DOM. And a debounced live half riding a **GET route handler**
(`/api/accounts/[accountId]/search`) on an RLS-scoped `dbForRequest()` client,
with `AbortController` plus a query-pairing stale guard. The palette mounts once
in the dashboard shell and derives the current account from `usePathname()`.

**Tech Stack:** Next.js App Router, React client components, `cmdk` + the
installed `Command*` primitives (already in `package.json` — **add no
dependency**), Supabase/PostgREST via `@bis/db`, vitest (no DOM), Playwright.

## Global Constraints

- **Reads ride a GET route handler, never a server action.** Next serializes
  same-client server actions; a per-keystroke read implemented as an action
  would queue the user's own mutations behind it.
- **`dbForRequest()`, never `serviceDb()`** in the search route. Only e2e can
  prove column grants — this repo has shipped three defects behind mock
  blindness.
- **`AbortController` + a stale-response guard.** A response whose query no
  longer matches the current input is discarded, never rendered.
- **The palette carries its own loaded / empty / error states.** Silence on a
  failed fetch reads as "nothing found" — a lie about a failure. Static results
  keep rendering while the live query is in flight, so it is never blank.
- **Navigation and safe actions only.** No destructive action is ever reachable
  from a fuzzy match one keystroke from Enter.
- **Tokens only** — no hard-coded colors/radii/shadows. Renders in dark AND
  light (the app's `.dark` class via next-themes, not `data-theme`).
- **Copy passes the "landscaper at 7 AM" read.** All user-visible strings go in
  `apps/web/src/lib/messages.ts` as `m["key"]`; never inline a literal.
- Search is scoped to the **current account only** (danlo's locked decision 3).
- **Both audiences get the palette**; the registry is role-filtered so a client
  never sees an agency-only destination.

## Three spec corrections this plan makes (read before starting)

1. **The styleguide gate.** The spec says `/dashboard/styleguide` is gated by
   `requireAgencyOnly...`. `requireAgencyOnlyAccountAccess(accountId)` **takes an
   accountId** (`apps/web/src/lib/auth.ts:59`) and `/dashboard/styleguide` has
   none. The correct existing gate is **`requireAgency()`**
   (`apps/web/src/lib/auth.ts:7`), which `/dashboard/accounts` and
   `/dashboard/blueprints` already use. It redirects a non-agency caller to
   `"/"` — NOT to their own dashboard, so the e2e assertion differs from
   `setup.spec.ts`'s.
2. **`listContacts`'s search is injectable-by-typing.** `packages/db/src/contacts.ts:166-167`
   builds an interpolated PostgREST `.or()` string sanitized only against
   `% , ( )`. It does **not** strip `"` or `\`. The same file's own comment block
   (`contacts.ts:23-49`) documents that a value containing `"` or `,` breaks out
   of PostgREST's filter grammar, and that a broken filter previously
   masqueraded as "no match". Today only a deliberate CRM search reaches it;
   **P6 puts it behind every keystroke of a ⌘K box**, where a quote is something
   users will genuinely type. Task 1 fixes it at the source.
3. **`CommandDialog` has two defects** (`apps/web/src/components/ui/command.tsx:32-61`):
   it renders `DialogHeader`/`DialogTitle` as a **sibling of** `DialogContent`
   rather than inside it (Radix requires the title inside — this logs an
   accessibility warning and leaves the dialog unnamed for screen readers), and
   it spreads unknown props onto `Dialog`, so `shouldFilter` cannot reach
   `Command`. Task 6 fixes both, additively.

## File Structure

**Create**
- `packages/db/src/search-term.ts` — the one shared query sanitizer.
- `packages/db/src/test/search.test.ts` — sanitizer + both new search functions.
- `apps/web/src/lib/palette/registry.ts` — pure entry registry + pure filter.
- `apps/web/src/lib/palette/registry.test.ts` — parity, role filtering, matching.
- `apps/web/src/app/api/accounts/[accountId]/search/route.ts` — the GET route.
- `apps/web/src/app/api/accounts/[accountId]/search/route.test.ts`
- `apps/web/src/components/command-palette.tsx` — the palette itself.
- `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`
- `apps/web/e2e/palette.spec.ts`
- `apps/web/e2e/styleguide.spec.ts`

**Modify**
- `packages/db/src/contacts.ts` — use the shared sanitizer.
- `packages/db/src/voice.ts` — add `searchCalls` (star-exported; add NO barrel line).
- `packages/db/src/messaging.ts` — add `searchConversations`.
- `packages/db/src/index.ts` — export `sanitizeSearchTerm` + `searchConversations`.
- `apps/web/src/components/ui/command.tsx` — fix the two `CommandDialog` defects.
- `apps/web/src/app/(dashboard)/dashboard/layout.tsx` — mount the palette.
- `apps/web/src/components/topbar.tsx` — the visible Search affordance.
- `.../[accountId]/settings/page.tsx` — anchor ids on each section.
- `apps/web/src/lib/messages.ts` — all new copy.

---

### Task 1: One hardened search-term sanitizer

**Files:**
- Create: `packages/db/src/search-term.ts`
- Modify: `packages/db/src/contacts.ts:160-171`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/test/search.test.ts`

**Interfaces:**
- Produces: `sanitizeSearchTerm(value: string): string` — exported from `@bis/db`.
  Tasks 2 and 5 depend on it.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/test/search.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeSearchTerm } from "../search-term";

describe("sanitizeSearchTerm", () => {
  it("strips every character that breaks PostgREST's filter grammar", () => {
    // A double quote or comma terminates the operand inside an interpolated
    // .or() string — contacts.ts:23-49 documents a real past incident where a
    // broken filter came back as "no match" instead of an error.
    expect(sanitizeSearchTerm(`ro"se,(x)`)).toBe("rosex");
  });

  it("strips ILIKE and PostgREST wildcards so a query matches literally", () => {
    // % and _ are ILIKE wildcards; * is PostgREST's own alias for %. A user
    // typing one must not silently turn their search into "match everything".
    expect(sanitizeSearchTerm("a%b_c*d")).toBe("abcd");
    expect(sanitizeSearchTerm("back\\slash")).toBe("backslash");
  });

  it("trims, collapses inner whitespace, and caps length", () => {
    expect(sanitizeSearchTerm("  rosa   trevino  ")).toBe("rosa trevino");
    expect(sanitizeSearchTerm("x".repeat(200))).toHaveLength(80);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeSearchTerm("   ")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @bis/db test -- search`
Expected: FAIL — `Cannot find module '../search-term'`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/search-term.ts`:

```ts
/**
 * The one sanitizer for every user-typed search term in this package.
 *
 * Two different dangers, both real, both documented by contacts.ts:23-49:
 *
 * 1. PostgREST's FILTER GRAMMAR. Multi-column searches are expressed as an
 *    interpolated `.or("a.ilike.%x%,b.ilike.%x%")` string. A `"`, `,`, `(` or
 *    `)` in the operand terminates it early — and the incident that comment
 *    records is that a filter which fails to parse came back as "no match"
 *    rather than an error, so the breakage was invisible.
 * 2. ILIKE WILDCARDS. `%` and `_` are pattern metacharacters, `\` escapes
 *    them, and PostgREST additionally accepts `*` as an alias for `%`. Left
 *    in, a typed `%` quietly turns a search into "match everything".
 *
 * Both are handled by REMOVAL rather than escaping. Escaping would have to be
 * correct in two different grammars at once; for a fuzzy find-as-you-type box
 * dropping the character is both safer and what the user means. The length cap
 * keeps a pathological paste from becoming a pathological query.
 *
 * Callers must treat `""` as "no searchable term" and skip the query entirely.
 */
const MAX_TERM_LENGTH = 80;

export function sanitizeSearchTerm(value: string): string {
  return value
    .replace(/[\\%_"(),*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM_LENGTH);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bis/db test -- search`
Expected: PASS, 4 tests.

- [ ] **Step 5: Point `listContacts` at it**

In `packages/db/src/contacts.ts`, add to the imports at the top of the file:

```ts
import { sanitizeSearchTerm } from "./search-term";
```

Then replace line 166 — currently:

```ts
  const s = opts.search?.trim().replace(/[%,()]/g, "");
```

with:

```ts
  // Was a local `.replace(/[%,()]/g, "")`, which left `"` and `\` in place —
  // both break the interpolated .or() string one line below (see
  // search-term.ts, and this file's own comment block above escapeLikePattern).
  // Harmless while only a deliberate CRM search reached it; P6 put this call
  // behind every keystroke of the ⌘K palette.
  const s = opts.search ? sanitizeSearchTerm(opts.search) : undefined;
```

- [ ] **Step 6: Add the regression test for the real query path**

Append to `packages/db/src/test/search.test.ts`:

```ts
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact, listContacts } from "../contacts";

describe("listContacts search, hardened", () => {
  it("survives a quote and a wildcard instead of erroring or matching everything", () =>
    withTestAccount(async (db, accountId) => {
      await createContact(db, accountId, { firstName: "Rosa", lastName: "Trevino" }, "user_test");
      await createContact(db, accountId, { firstName: "Zed", lastName: "Quill" }, "user_test");

      // The grammar-breaking character: before the fix this threw (or, worse,
      // silently returned nothing). "trevi" still has to find Rosa.
      const quoted = await listContacts(db, accountId, { search: `trevi"` });
      expect(quoted).toHaveLength(1);
      expect(quoted![0]!.last_name).toBe("Trevino");

      // A bare wildcard must NOT become "match everything".
      const wildcard = await listContacts(db, accountId, { search: "%" });
      expect(wildcard).toHaveLength(2); // term sanitizes to "", so no filter
      const wildcarded = await listContacts(db, accountId, { search: "trev%" });
      expect(wildcarded).toHaveLength(1);
    }));
});
```

Note: an all-punctuation query sanitizes to `""`, which `listContacts` treats as
"no search filter" and returns the unfiltered list — that is the pre-existing
contract of the `if (s)` guard, and the assertion above pins it deliberately.

- [ ] **Step 7: Export from the barrel**

In `packages/db/src/index.ts`, add a line beside the other module exports:

```ts
export { sanitizeSearchTerm } from "./search-term";
```

- [ ] **Step 8: Run the db suite**

Run: `pnpm --filter @bis/db test`
Expected: PASS. Baseline is 171 tests; this adds 5.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/search-term.ts packages/db/src/contacts.ts packages/db/src/index.ts packages/db/src/test/search.test.ts
git commit -m "fix(db): one hardened search-term sanitizer; listContacts no longer breaks on a quote"
```

---

### Task 2: `searchCalls` and `searchConversations`

**Files:**
- Modify: `packages/db/src/voice.ts` (append)
- Modify: `packages/db/src/messaging.ts` (append)
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/test/search.test.ts` (append)

**Interfaces:**
- Consumes: `sanitizeSearchTerm` (Task 1).
- Produces:
  - `searchCalls(db: SupabaseClient, accountId: string, opts: { search: string; limit?: number }): Promise<CallListRow[]>`
  - `searchConversations(db: SupabaseClient, accountId: string, opts: { search: string; limit?: number }): Promise<ConversationSummary[]>`
  - Task 5 calls both.

**Existing types these reuse (verbatim from source):**
`CallListRow` is `packages/db/src/voice.ts:272-280`; `ConversationSummary` is
`packages/db/src/messaging.ts:18-26`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/test/search.test.ts`:

```ts
import { searchCalls } from "../voice";
import { searchConversations, ensureConversation, createMessage } from "../messaging";
import { assignPhoneNumber, startCallRow, finishCallRow } from "../voice";

describe("searchCalls", () => {
  it("matches the caller's number and the summary text, newest first, capped", () =>
    withTestAccount(async (db, accountId) => {
      const stamp = Date.now();
      const number = await assignPhoneNumber(
        db, accountId, { e164: `+1555${String(stamp).slice(-7)}`, status: "testing" }, "user_test",
      );
      const started = await startCallRow(db, accountId, {
        phoneNumberId: number.id, callerE164: "+19565551234",
      });
      await finishCallRow(db, accountId, started.id, {
        outcome: "booked", endedAt: new Date(), durationSecs: 90, turnCount: 2,
        transcript: [], summary: "Roof inspection booked for Tuesday", language: "en",
        contactId: null,
      });

      const bySummary = await searchCalls(db, accountId, { search: "roof inspection" });
      expect(bySummary).toHaveLength(1);
      expect(bySummary[0]!.id).toBe(started.id);

      const byNumber = await searchCalls(db, accountId, { search: "9565551234" });
      expect(byNumber).toHaveLength(1);

      expect(await searchCalls(db, accountId, { search: "nothing matches this" })).toEqual([]);
      // An all-punctuation query must return NOTHING, not the whole log.
      expect(await searchCalls(db, accountId, { search: "%%%" })).toEqual([]);
    }));
});

describe("searchConversations", () => {
  it("finds a conversation by its message body and previews the matched message", () =>
    withTestAccount(async (db, accountId) => {
      const contact = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const conversation = await ensureConversation(db, accountId, contact.id);
      await createMessage(db, accountId, {
        conversationId: conversation.id, contactId: contact.id, channel: "sms",
        direction: "inbound", body: "Can you quote a cedar fence?", status: "delivered",
      });

      const hits = await searchConversations(db, accountId, { search: "cedar fence" });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.id).toBe(conversation.id);
      expect(hits[0]!.contactFirstName).toBe("Ana");
      expect(hits[0]!.lastMessagePreview).toContain("cedar fence");

      expect(await searchConversations(db, accountId, { search: "zzz nothing" })).toEqual([]);
      expect(await searchConversations(db, accountId, { search: "%" })).toEqual([]);
    }));
});
```

⚠️ Before writing the implementation, confirm the exact signatures of
`ensureConversation` and `createMessage` in `packages/db/src/messaging.ts` and
of `assignPhoneNumber` / `startCallRow` / `finishCallRow` in
`packages/db/src/voice.ts`, and adjust the seeding calls above to match. They
are used here only to create rows; `apps/web/e2e/calls.spec.ts:80-110` shows the
same four voice calls in their production shapes.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bis/db test -- search`
Expected: FAIL — `searchCalls is not a function`.

- [ ] **Step 3: Implement `searchCalls`**

Append to `packages/db/src/voice.ts` (it already imports `SupabaseClient`; add
`import { sanitizeSearchTerm } from "./search-term";` at the top):

```ts
/**
 * The ⌘K palette's calls half. Own-table columns ONLY — `caller_e164` and the
 * receptionist's `summary` — so the filter never has to reach through the
 * embedded `contact:contacts(...)` join, which would need a `!inner` rewrite
 * and change what `listCalls` returns for everyone else.
 *
 * A caller whose contact is known is still findable: the palette's CONTACTS
 * group returns that person, and their calls hang off the contact page.
 *
 * An empty sanitized term returns [] rather than the newest N calls — a
 * palette showing the whole log for a query of "%%%" would read as a match.
 */
export async function searchCalls(
  db: SupabaseClient, accountId: string, opts: { search: string; limit?: number },
): Promise<CallListRow[]> {
  const s = sanitizeSearchTerm(opts.search);
  if (!s) return [];
  const { data, error } = await db.from("calls").select(CALL_LIST_COLS)
    .eq("account_id", accountId)
    .or(`caller_e164.ilike.%${s}%,summary.ilike.%${s}%`)
    .order("started_at", { ascending: false })
    .limit(opts.limit ?? 5);
  if (error) throw new Error(`searchCalls failed: ${error.message}`);
  return (data ?? []) as unknown as CallListRow[];
}
```

- [ ] **Step 4: Implement `searchConversations`**

Append to `packages/db/src/messaging.ts` (add
`import { sanitizeSearchTerm } from "./search-term";` at the top):

```ts
/**
 * The ⌘K palette's conversations half — matched on MESSAGE BODY, which is what
 * someone means by "find the thread where we talked about the fence".
 *
 * Two queries, deliberately. The first is a single-column `.ilike()`, whose
 * operand PostgREST sends as a parameter — no interpolated filter grammar to
 * break (see search-term.ts). The second fetches only the handful of parent
 * conversations that survived, so the `max_rows` truncation that
 * `listConversations` has to worry about cannot bite here.
 *
 * `lastMessagePreview` is the MATCHED message, not the newest one — in a
 * palette, showing the line you searched for is the whole point.
 */
export async function searchConversations(
  db: SupabaseClient, accountId: string, opts: { search: string; limit?: number },
): Promise<ConversationSummary[]> {
  const s = sanitizeSearchTerm(opts.search);
  if (!s) return [];
  const limit = opts.limit ?? 5;

  const { data: msgs, error: msgErr } = await db.from("messages")
    .select("conversation_id, body, created_at")
    .eq("account_id", accountId)
    .ilike("body", `%${s}%`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (msgErr) throw new Error(`searchConversations failed: ${msgErr.message}`);

  // Newest matching message per conversation, in match order, capped.
  const preview = new Map<string, string>();
  for (const row of (msgs ?? []) as { conversation_id: string; body: string }[]) {
    if (!preview.has(row.conversation_id)) preview.set(row.conversation_id, row.body);
    if (preview.size >= limit) break;
  }
  const ids = [...preview.keys()];
  if (ids.length === 0) return [];

  const { data, error } = await db.from("conversations")
    .select("id, contact_id, last_message_at, unread_count, contacts(first_name, last_name)")
    .eq("account_id", accountId)
    .in("id", ids);
  if (error) throw new Error(`searchConversations failed: ${error.message}`);

  const byId = new Map(
    ((data ?? []) as any[]).map((r) => [r.id as string, r]),
  );
  // Ordered by match recency (the `ids` order), not by the second query's
  // arbitrary return order.
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return []; // RLS filtered it out — drop it rather than half-render
    return [{
      id: r.id,
      contactId: r.contact_id,
      contactFirstName: r.contacts?.first_name ?? null,
      contactLastName: r.contacts?.last_name ?? null,
      lastMessageAt: r.last_message_at,
      lastMessagePreview: preview.get(id) ?? null,
      unreadCount: r.unread_count ?? 0,
    }];
  });
}
```

- [ ] **Step 5: Export from the barrel**

In `packages/db/src/index.ts`, add `searchConversations` to the existing
messaging export list (the group at `index.ts:17-21`).

**Do NOT add a line for `searchCalls`** — `index.ts:45` is
`export * from "./voice";`, so voice additions are exported automatically.
(The P4 plan's "export all four from index.ts" instruction is stale for voice.)

- [ ] **Step 6: Run the db suite**

Run: `pnpm --filter @bis/db test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/voice.ts packages/db/src/messaging.ts packages/db/src/index.ts packages/db/src/test/search.test.ts
git commit -m "feat(db): searchCalls + searchConversations for the command palette"
```

---

### Task 3: The palette registry (pure, role-filtered, nav-derived)

**Files:**
- Create: `apps/web/src/lib/palette/registry.ts`
- Test: `apps/web/src/lib/palette/registry.test.ts`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `buildNavGroups(base: string | null, isAgency: boolean): NavGroupSpec[]`
  from `@/lib/nav-groups`; `m` / `MessageKey` from `@/lib/messages`.
- Produces:
  - `type PaletteGroup = "navigation" | "settings" | "actions"`
  - `type PaletteEntry = { id: string; label: string; group: PaletteGroup; agencyOnly: boolean; keywords: string[] } & ({ kind: "href"; href: string } | { kind: "action"; actionId: PaletteActionId })`
  - `type PaletteActionId = "toggle-theme"`
  - `buildPaletteEntries(base: string | null, isAgency: boolean): PaletteEntry[]`
  - `filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[]`
  - Task 6 renders both.

- [ ] **Step 1: Add the copy**

In `apps/web/src/lib/messages.ts`, insert before the closing `} as const;`:

```ts
  // ── Command palette (DESIGN.md's ⌘K key pattern) ───────────────────────
  "palette.placeholder": "Search contacts, calls, pages…",
  "palette.group.navigation": "Go to",
  "palette.group.settings": "Settings",
  "palette.group.actions": "Actions",
  "palette.group.contacts": "Contacts",
  "palette.group.calls": "Calls",
  "palette.group.conversations": "Conversations",
  "palette.hint": "Keep typing to search your contacts, calls and conversations.",
  "palette.empty": "Nothing matches “{query}”.",
  // Names the failure instead of showing an empty list. An empty list would
  // say "you have no such contact", which is a lie about a broken request.
  "palette.error": "Couldn't search your records just now.",
  "palette.retry": "Try again",
  "palette.action.toggleTheme": "Switch between light and dark",
  "palette.settings.clientAccess": "Client access",
  "palette.settings.sendingAddress": "Sending address",
  "palette.settings.customFields": "Custom fields",
  "palette.settings.customValues": "Custom values",
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/palette/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildNavGroups } from "@/lib/nav-groups";
import { buildPaletteEntries, filterEntries } from "./registry";

const BASE = "/dashboard/accounts/acc_1";

describe("buildPaletteEntries", () => {
  it("registers EVERY nav destination — the contract's own parity rule", () => {
    for (const isAgency of [true, false]) {
      const navHrefs = buildNavGroups(BASE, isAgency).flatMap((g) => g.items.map((i) => i.href));
      const entryHrefs = new Set(
        buildPaletteEntries(BASE, isAgency)
          .filter((e) => e.kind === "href")
          .map((e) => (e as { href: string }).href),
      );
      for (const href of navHrefs) expect(entryHrefs).toContain(href);
    }
  });

  it("hides agency-only destinations and settings from a client", () => {
    const client = buildPaletteEntries(BASE, false);
    expect(client.some((e) => e.agencyOnly)).toBe(false);
    expect(client.some((e) => e.group === "settings")).toBe(false);
    // Voice is the agency's receptionist config, not the client's own data.
    expect(client.some((e) => e.kind === "href" && e.href === `${BASE}/voice`)).toBe(false);
  });

  it("gives the agency every settings section, each with its own anchor", () => {
    const settings = buildPaletteEntries(BASE, true).filter((e) => e.group === "settings");
    expect(settings.length).toBeGreaterThanOrEqual(4);
    for (const entry of settings) {
      expect(entry.kind).toBe("href");
      expect((entry as { href: string }).href).toMatch(
        new RegExp(`^${BASE}/settings#[a-z-]+$`),
      );
    }
  });

  it("has no duplicate ids and no entry without a label", () => {
    for (const isAgency of [true, false]) {
      const entries = buildPaletteEntries(BASE, isAgency);
      expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
      for (const e of entries) expect(e.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("outside an account offers only the top-level destinations", () => {
    const entries = buildPaletteEntries(null, true);
    const hrefs = entries.filter((e) => e.kind === "href").map((e) => (e as { href: string }).href);
    expect(hrefs).toContain("/dashboard/accounts");
    expect(hrefs).toContain("/dashboard/blueprints");
    expect(hrefs.some((h) => h.includes("/contacts"))).toBe(false);
  });
});

describe("filterEntries", () => {
  const entries = buildPaletteEntries(BASE, true);

  it("returns everything for an empty query", () => {
    expect(filterEntries(entries, "   ")).toHaveLength(entries.length);
  });

  it("matches case-insensitively on the label", () => {
    const hit = filterEntries(entries, "contac");
    expect(hit.some((e) => e.label === "Contacts")).toBe(true);
  });

  it("matches on keywords the label does not contain", () => {
    // "Opportunities" is what the nav calls it; an operator types "deals".
    expect(filterEntries(entries, "deals").some((e) => e.label === "Opportunities")).toBe(true);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(filterEntries(entries, "zzzzqqq")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter web test -- registry`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 4: Write the registry**

Create `apps/web/src/lib/palette/registry.ts`:

```ts
import { buildNavGroups } from "@/lib/nav-groups";
import { m } from "@/lib/messages";

export type PaletteGroup = "navigation" | "settings" | "actions";

/** Actions are NAVIGATION-SAFE only (DESIGN.md rule 6 governs destructive
 *  work on its own surfaces). Nothing that writes tenant data belongs here:
 *  a fuzzy match is one keystroke from Enter. */
export type PaletteActionId = "toggle-theme";

export type PaletteEntry = {
  id: string;
  label: string;
  group: PaletteGroup;
  /** Belt-and-braces only. `buildPaletteEntries` never EMITS an agency-only
   *  entry for a client — this flag exists so a test can assert that, and so a
   *  future consumer cannot re-add one by accident. Hiding an entry is not
   *  authorization; every route still guards itself. */
  agencyOnly: boolean;
  /** Words an operator might type that the label does not contain. */
  keywords: string[];
} & (
  | { kind: "href"; href: string }
  | { kind: "action"; actionId: PaletteActionId }
);

/**
 * Settings sections, each pointing at an anchor on the settings page.
 *
 * DESIGN.md's command-palette pattern ends with "Settings sections must be
 * registered in the palette index" — this list IS that index, and the ids
 * match the `id` attributes on the page's own sections. Settings is gated by
 * `requireAgencyOnlyAccountAccess` (settings/page.tsx:52), so every entry here
 * is agency-only.
 */
const SETTINGS_SECTIONS: { anchor: string; label: string; keywords: string[] }[] = [
  { anchor: "client-access", label: m["palette.settings.clientAccess"], keywords: ["login", "invite", "portal"] },
  { anchor: "sending-address", label: m["palette.settings.sendingAddress"], keywords: ["email", "from", "domain"] },
  { anchor: "custom-fields", label: m["palette.settings.customFields"], keywords: ["field", "crm"] },
  { anchor: "custom-values", label: m["palette.settings.customValues"], keywords: ["value", "variable", "merge"] },
];

/** Extra search words per nav destination, keyed by the href SUFFIX so this
 *  survives a base change. A destination with no entry simply has none. */
const NAV_KEYWORDS: Record<string, string[]> = {
  "/dashboard": ["home", "overview"],
  "/contacts": ["people", "customers", "leads"],
  "/pipeline": ["deals", "opportunities", "sales"],
  "/conversations": ["messages", "inbox", "sms", "email"],
  "/calls": ["phone", "receptionist", "sofia"],
  "/forms": ["lead form", "intake"],
  "/calendar": ["booking", "availability", "hours"],
  "/branding": ["logo", "colors", "theme"],
  "/voice": ["receptionist", "sofia", "ai"],
  "/dashboard/accounts": ["companies", "clients"],
  "/dashboard/blueprints": ["templates"],
};

function keywordsFor(href: string, base: string | null): string[] {
  const suffix = base && href.startsWith(base) ? href.slice(base.length) : href;
  return NAV_KEYWORDS[suffix] ?? [];
}

/**
 * Every palette destination and action for this caller.
 *
 * Navigation entries are DERIVED from `buildNavGroups` rather than re-listed,
 * so a nav destination cannot exist without a palette entry — which is exactly
 * what DESIGN.md's registration rule asks for, enforced by construction rather
 * than by a promise. `registry.test.ts` asserts the parity in both roles.
 *
 * `base` is the in-account prefix (`/dashboard/accounts/<id>`), or null at the
 * agency top level where there is no account in scope.
 */
export function buildPaletteEntries(base: string | null, isAgency: boolean): PaletteEntry[] {
  const entries: PaletteEntry[] = [];

  for (const group of buildNavGroups(base, isAgency)) {
    for (const item of group.items) {
      entries.push({
        kind: "href",
        id: `nav:${item.href}`,
        label: m[item.labelKey],
        group: "navigation",
        agencyOnly: false, // buildNavGroups already withheld agency-only items
        keywords: keywordsFor(item.href, base),
        href: item.href,
      });
    }
  }

  if (base && isAgency) {
    entries.push({
      kind: "href",
      id: "nav:settings",
      label: m["nav.settings"],
      group: "navigation",
      agencyOnly: true,
      keywords: ["configuration", "preferences"],
      href: `${base}/settings`,
    });
    entries.push({
      kind: "href",
      id: "nav:setup",
      label: m["nav.setup"],
      group: "navigation",
      agencyOnly: true,
      keywords: ["wizard", "activation", "onboarding", "go live"],
      href: `${base}/setup`,
    });
    for (const section of SETTINGS_SECTIONS) {
      entries.push({
        kind: "href",
        id: `settings:${section.anchor}`,
        label: section.label,
        group: "settings",
        agencyOnly: true,
        keywords: section.keywords,
        href: `${base}/settings#${section.anchor}`,
      });
    }
  }

  entries.push({
    kind: "action",
    id: "action:toggle-theme",
    label: m["palette.action.toggleTheme"],
    group: "actions",
    agencyOnly: false,
    keywords: ["dark", "light", "appearance", "theme"],
    actionId: "toggle-theme",
  });

  return entries;
}

/**
 * Pure substring matching over label + keywords.
 *
 * The palette runs cmdk with `shouldFilter={false}` and calls this instead, for
 * two reasons: the live half's server results must NOT be re-filtered by a
 * client-side matcher that never saw the row's other columns, and matching that
 * lives in a pure function is testable in this app's vitest, which has no DOM.
 */
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const terms = q.split(/\s+/);
  return entries.filter((entry) => {
    const haystack = [entry.label, ...entry.keywords].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter web test -- registry`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/palette apps/web/src/lib/messages.ts
git commit -m "feat(palette): nav-derived, role-filtered entry registry with pure matching"
```

---

### Task 4: Anchor the settings sections

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/client-access-panel.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/sending-address-card.tsx`

**Interfaces:**
- Consumes: the `anchor` values in `SETTINGS_SECTIONS` (Task 3):
  `client-access`, `sending-address`, `custom-fields`, `custom-values`.
- Produces: DOM ids of those exact names. Task 8's e2e asserts them.

Registry entries that point at anchors which do not exist are a broken promise —
the palette would navigate to the top of the page and look like it did nothing.

- [ ] **Step 1: Add the ids**

In `settings/page.tsx`, give the two Cards their anchors. The custom-fields Card
opens at line ~184 and the custom-values Card at ~245:

```tsx
          <Card id="custom-fields" className="scroll-mt-24">
```

```tsx
          <Card id="custom-values" className="scroll-mt-24">
```

`scroll-mt-24` keeps the anchored section clear of the sticky topbar instead of
landing underneath it.

- [ ] **Step 2: Anchor the two extracted panels**

`ClientAccessPanel` and `SendingAddressCard` render their own roots. Give each
an id at its outermost element — inside the component, so the id travels with
the component rather than depending on a wrapper at the call site:

In `client-access-panel.tsx`, on the outermost rendered element, add:

```tsx
    id="client-access" className={cn("scroll-mt-24", /* existing classes */)}
```

In `sending-address-card.tsx`, likewise:

```tsx
    id="sending-address" className={cn("scroll-mt-24", /* existing classes */)}
```

Read each file first and merge the id/`scroll-mt-24` into whatever root element
and className already exist; do not wrap them in a new `<div>`, which would
change the settings page's spacing.

- [ ] **Step 3: Verify the anchors exist and are unique**

Run:

```bash
grep -rn 'id="client-access"\|id="sending-address"\|id="custom-fields"\|id="custom-values"' apps/web/src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/settings/
```

Expected: exactly four lines, one per anchor.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings"
git commit -m "feat(settings): anchor each section so the palette can jump to it"
```

---

### Task 5: The search GET route

**Files:**
- Create: `apps/web/src/app/api/accounts/[accountId]/search/route.ts`
- Test: `apps/web/src/app/api/accounts/[accountId]/search/route.test.ts`

**Interfaces:**
- Consumes: `apiAccountAccess(accountId: string): Promise<{ userId: string; isAgency: boolean } | null>`
  from `@/lib/auth`; `dbForRequest(): Promise<SupabaseClient>` from `@/lib/db`;
  `listContacts`, `searchCalls`, `searchConversations` from `@bis/db`;
  `callerLabel` + `OUTCOMES` from the calls `format` module.
- Produces:
  - `type SearchHit = { id: string; label: string; sublabel: string | null; at: string | null; href: string }`
  - `type SearchResults = { contacts: SearchHit[]; calls: SearchHit[]; conversations: SearchHit[] }`
  - Task 6 imports `SearchResults` from this file (the same shape the P4 drawer
    imports `ContactSummary` from its route).

**The route models itself on `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts` — read that file first.**

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/api/accounts/[accountId]/search/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (...a: unknown[]) => access(...a) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));

const dbMocks = {
  listContacts: vi.fn(), searchCalls: vi.fn(), searchConversations: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const { GET } = await import("./route");

function req(q: string) {
  return new Request(`http://x/api/accounts/a1/search?q=${encodeURIComponent(q)}`);
}
function ctx() { return { params: Promise.resolve({ accountId: "a1" }) }; }

beforeEach(() => {
  access.mockReset();
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listContacts.mockResolvedValue([]);
  dbMocks.searchCalls.mockResolvedValue([]);
  dbMocks.searchConversations.mockResolvedValue([]);
});

describe("account search route", () => {
  it("404s without access — same answer for no-access and unknown account", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(req("rosa"), ctx())).status).toBe(404);
  });

  it("returns empty groups for a too-short query without touching the database", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    const body = await (await GET(req("a"), ctx())).json();
    expect(body).toEqual({ contacts: [], calls: [], conversations: [] });
    expect(dbMocks.listContacts).not.toHaveBeenCalled();
  });

  it("caps every source at five and asks the database for no more", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.listContacts.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({
        id: `c${i}`, first_name: "A", last_name: `B${i}`, email: null, phone: null,
      })),
    );
    const body = await (await GET(req("rosa"), ctx())).json();
    expect(body.contacts).toHaveLength(5);
    expect(dbMocks.listContacts).toHaveBeenCalledWith({}, "a1", { search: "rosa", limit: 5 });
  });

  it("builds a working href and a localized sublabel for each kind", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.listContacts.mockResolvedValue([
      { id: "c1", first_name: "Rosa", last_name: "Trevino", email: "rosa@x.com", phone: null },
    ]);
    dbMocks.searchCalls.mockResolvedValue([
      {
        id: "k1", started_at: "2026-09-01T10:00:00+00:00", outcome: "booked",
        caller_e164: "+19565551234", contact: null, duration_secs: 60,
        language: "en", contact_id: null,
      },
    ]);
    dbMocks.searchConversations.mockResolvedValue([
      {
        id: "v1", contactId: "c1", contactFirstName: "Rosa", contactLastName: "Trevino",
        lastMessageAt: "2026-09-01T10:00:00+00:00", lastMessagePreview: "cedar fence",
        unreadCount: 0,
      },
    ]);
    const body = await (await GET(req("rosa"), ctx())).json();

    expect(body.contacts[0].label).toBe("Rosa Trevino");
    expect(body.contacts[0].href).toBe("/dashboard/accounts/a1/contacts/c1");
    expect(body.calls[0].href).toBe("/dashboard/accounts/a1/calls/k1");
    // The LOCALIZED outcome, never the raw `calls.outcome` enum — the P4
    // drawer shipped "booked" beside a table showing "Booked" two clicks away.
    expect(body.calls[0].sublabel).toBe("Booked");
    expect(body.calls[0].sublabel).not.toBe("booked");
    expect(body.conversations[0].href).toBe("/dashboard/accounts/a1/conversations?c=v1");
    expect(body.conversations[0].sublabel).toBe("cedar fence");
  });

  it("500s rather than reporting an empty result when a source throws", async () => {
    // Silence would render as "nothing found" — a lie about a failure. The
    // route must fail loudly so the palette can show its error row.
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.searchCalls.mockRejectedValue(new Error("permission denied for table calls"));
    expect((await GET(req("rosa"), ctx())).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- search/route`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

Create `apps/web/src/app/api/accounts/[accountId]/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { listContacts, searchCalls, searchConversations } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { callerLabel, OUTCOMES } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calls/format";

export const dynamic = "force-dynamic";

export type SearchHit = {
  id: string;
  label: string;
  sublabel: string | null;
  /** Raw ISO, formatted by the CLIENT. Never formatted here: Intl on the
   *  server formats in the SERVER's zone (UTC on Vercel), which renders the
   *  previous day for every Americas timezone after ~6pm local. */
  at: string | null;
  href: string;
};

export type SearchResults = {
  contacts: SearchHit[];
  calls: SearchHit[];
  conversations: SearchHit[];
};

/** Per source, so one noisy source cannot crowd the others out. */
const PER_SOURCE = 5;
/** Below this the palette shows its static half only — a one-character query
 *  matches most of a CRM and costs three round trips to say so. */
const MIN_QUERY = 2;

const EMPTY: SearchResults = { contacts: [], calls: [], conversations: [] };

function contactName(row: { first_name: string | null; last_name: string | null }): string {
  const name = [row.first_name, row.last_name].map((p) => p?.trim() ?? "").filter(Boolean).join(" ");
  return name || "Unnamed contact";
}

/**
 * The ⌘K palette's live half.
 *
 * A GET ROUTE HANDLER, not a server action, and for a specific reason: Next
 * serializes same-client server actions, so a per-keystroke read written as an
 * action would queue the user's own mutations behind every letter they type.
 * Same call the P4 contact-summary route made.
 *
 * `dbForRequest()` — RLS-scoped — is load-bearing, NOT a style choice. A client
 * session must see exactly its own rows, and `serviceDb()` would hand back
 * every tenant's. Nothing below this line can prove that; only the client-role
 * e2e in palette.spec.ts can.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  const access = await apiAccountAccess(accountId);
  // 404 for both no-access and unknown account — never confirm existence.
  if (!access) return NextResponse.json({}, { status: 404 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY) return NextResponse.json(EMPTY);

  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const base = `/dashboard/accounts/${accountId}`;

  // No try/catch: a source that throws must 500 so the palette can show its
  // honest error row. Swallowing it here would render as "no matches", which
  // tells the user their contact does not exist when the read actually failed.
  const [contacts, calls, conversations] = await Promise.all([
    listContacts(db, accountId, { search: q, limit: PER_SOURCE }),
    searchCalls(db, accountId, { search: q, limit: PER_SOURCE }),
    searchConversations(db, accountId, { search: q, limit: PER_SOURCE }),
  ]);

  const body: SearchResults = {
    contacts: (contacts ?? []).slice(0, PER_SOURCE).map((c): SearchHit => ({
      id: c.id,
      label: contactName(c),
      sublabel: c.email ?? c.phone ?? null,
      at: null,
      href: `${base}/contacts/${c.id}`,
    })),
    calls: calls.slice(0, PER_SOURCE).map((c): SearchHit => ({
      id: c.id,
      label: callerLabel(c),
      // The localized label, never the raw `calls.outcome` enum. Unknown
      // values fall back to the raw string instead of throwing and taking the
      // whole search down — same defensive lookup the P4 summary route uses.
      sublabel: (OUTCOMES as Record<string, { label: string }>)[c.outcome]?.label
        ?? String(c.outcome),
      at: c.started_at,
      href: `${base}/calls/${c.id}`,
    })),
    conversations: conversations.slice(0, PER_SOURCE).map((v): SearchHit => ({
      id: v.id,
      label: [v.contactFirstName, v.contactLastName]
        .map((p) => p?.trim() ?? "").filter(Boolean).join(" ") || "Unnamed contact",
      sublabel: v.lastMessagePreview,
      at: v.lastMessageAt,
      // The conversations page selects a thread with ?c= — there is no
      // /conversations/<id> route (conversations/page.tsx:21).
      href: `${base}/conversations?c=${v.id}`,
    })),
  };

  return NextResponse.json(body);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter web test -- search/route`
Expected: PASS, 5 tests.

If the `listContacts` call-shape assertion fails, fix the ASSERTION to match the
verified signature `listContacts(db, accountId, opts)` — do not change the route
to satisfy a wrong test.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/accounts/[accountId]/search"
git commit -m "feat(api): GET account search route for the command palette"
```

---

### Task 6: The palette itself

**Files:**
- Modify: `apps/web/src/components/ui/command.tsx` (fix `CommandDialog`)
- Create: `apps/web/src/components/command-palette.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/layout.tsx`
- Modify: `apps/web/src/components/topbar.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `buildPaletteEntries`, `filterEntries`, `PaletteEntry` (Task 3);
  `SearchResults` (Task 5); `ACCOUNT_ROUTE_RE` from `@/lib/account-route`.
- Produces: `CommandPalette({ isAgency }: { isAgency: boolean })`.

- [ ] **Step 1: Fix `CommandDialog`**

In `apps/web/src/components/ui/command.tsx`, replace the whole `CommandDialog`
function (lines 32-61) with:

```tsx
function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = true,
  shouldFilter,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  /** Forwarded to the inner Command. Destructured out of `...props` on
   *  purpose: spread onto Dialog it would land on a DOM node and warn. */
  shouldFilter?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("overflow-hidden p-0", className)}
        showCloseButton={showCloseButton}
      >
        {/* INSIDE DialogContent. Radix requires the title within the content
            it names; as a sibling (which is where this shipped) the dialog was
            announced unnamed and Radix logged a warning on every open. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={shouldFilter}
          className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Add the remaining copy**

In `apps/web/src/lib/messages.ts`, add beside the other `palette.*` keys:

```ts
  "palette.searchHint": "Search",
  "palette.shortcut": "⌘K",
```

(`m["shell.search"]` already exists and is currently unused — it is the
accessible name for the topbar trigger; do not add a duplicate.)

- [ ] **Step 3: Write the palette**

Create `apps/web/src/components/command-palette.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ACCOUNT_ROUTE_RE } from "@/lib/account-route";
import {
  buildPaletteEntries, filterEntries, type PaletteEntry,
} from "@/lib/palette/registry";
import type { SearchResults, SearchHit } from "@/app/api/accounts/[accountId]/search/route";
import { formatDate } from "@/lib/format";
import { m } from "@/lib/messages";

const DEBOUNCE_MS = 200;
/** Must match the route's own floor, or the palette spins for a query the
 *  server answers with empty groups. */
const MIN_QUERY = 2;

type Settled = { status: "ready"; results: SearchResults } | { status: "error" };
/** The response PAIRED WITH THE QUERY IT ANSWERS — the P4 drawer's guard. A
 *  reply whose query no longer matches the box is not stale-checked, it is
 *  simply never selected. */
type Live = { query: string; state: Settled } | null;

const EMPTY_RESULTS: SearchResults = { contacts: [], calls: [], conversations: [] };

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
  );
}

export function CommandPalette({ isAgency }: { isAgency: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [live, setLive] = useState<Live>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const accountId = pathname.match(ACCOUNT_ROUTE_RE)?.[1] ?? null;
  const base = accountId ? `/dashboard/accounts/${accountId}` : null;
  const entries = filterEntries(buildPaletteEntries(base, isAgency), query);

  const q = query.trim();
  const wantsLive = accountId !== null && q.length >= MIN_QUERY;
  /** Only a settled response FOR THIS EXACT QUERY counts. Anything else —
   *  never fetched, still debouncing, in flight, or answering an older
   *  query — leaves this null, which is precisely the pending state. */
  const settled = live && live.query === q ? live.state : null;
  const pending = wantsLive && settled === null;
  const results = settled?.status === "ready" ? settled.results : EMPTY_RESULTS;

  // ⌘K / Ctrl+K, global.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      // ⌘K is ours everywhere. Ctrl+K inside a text field is NOT: on macOS
      // that is the OS's own "delete to end of line", and stealing it from
      // someone mid-sentence is worse than making them reach for the mouse.
      if (event.ctrlKey && !event.metaKey && isEditable(event.target)) return;
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The live half: debounced, aborted on every keystroke, and never allowed to
  // report an older query's answer.
  useEffect(() => {
    if (!open || !wantsLive || !accountId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/accounts/${accountId}/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) { setLive({ query: q, state: { status: "error" } }); return; }
          const payload = (await res.json()) as SearchResults;
          setLive({ query: q, state: { status: "ready", results: payload } });
        })
        .catch((error: unknown) => {
          // An abort is this component cancelling itself, not a failure —
          // reporting it would flash an error row on every keystroke.
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLive({ query: q, state: { status: "error" } });
        });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, wantsLive, accountId, q, retryNonce]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function runEntry(entry: PaletteEntry) {
    close();
    if (entry.kind === "href") { router.push(entry.href); return; }
    // The only action, and deliberately a safe one: no tenant data is written
    // from a fuzzy match one keystroke from Enter.
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  function openHit(hit: SearchHit) {
    close();
    router.push(hit.href);
  }

  const groups: { key: string; heading: string; items: PaletteEntry[] }[] = [
    { key: "navigation", heading: m["palette.group.navigation"], items: entries.filter((e) => e.group === "navigation") },
    { key: "settings", heading: m["palette.group.settings"], items: entries.filter((e) => e.group === "settings") },
    { key: "actions", heading: m["palette.group.actions"], items: entries.filter((e) => e.group === "actions") },
  ];

  const liveGroups: { key: string; heading: string; hits: SearchHit[] }[] = [
    { key: "contacts", heading: m["palette.group.contacts"], hits: results.contacts },
    { key: "calls", heading: m["palette.group.calls"], hits: results.calls },
    { key: "conversations", heading: m["palette.group.conversations"], hits: results.conversations },
  ];

  const liveHitCount = liveGroups.reduce((total, group) => total + group.hits.length, 0);
  const nothingAtAll =
    entries.length === 0 && !pending && settled?.status !== "error" && liveHitCount === 0;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={m["shell.search"]}
        aria-keyshortcuts="Meta+K Control+K"
        className="gap-2 text-muted-foreground"
      >
        <span>{m["palette.searchHint"]}</span>
        <kbd className="rounded-[--radius-ctl] border border-line px-1.5 py-0.5 font-mono text-[10px]">
          {m["palette.shortcut"]}
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title={m["shell.search"]}
        description={m["palette.placeholder"]}
        // Matching lives in filterEntries (a pure, unit-tested function) and,
        // for the live half, in Postgres. cmdk must not re-filter server rows
        // it never saw the columns of.
        shouldFilter={false}
      >
        <CommandInput
          placeholder={m["palette.placeholder"]}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <CommandGroup key={group.key} heading={group.heading}>
                {group.items.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.id}
                    onSelect={() => runEntry(entry)}
                  >
                    {entry.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ),
          )}

          {/* Skeletons shaped like a result row, never a spinner (rule 7). */}
          {pending ? (
            <div className="space-y-2 p-2" data-testid="palette-loading">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex flex-col gap-1.5 px-2 py-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : null}

          {/* An honest failure, with a way out. NEVER silence: an empty list
              would tell the user the record does not exist. */}
          {settled?.status === "error" ? (
            <div
              role="alert"
              data-testid="palette-error"
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground">{m["palette.error"]}</span>
              <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
                {m["palette.retry"]}
              </Button>
            </div>
          ) : null}

          {settled?.status === "ready"
            ? liveGroups.map((group) =>
                group.hits.length === 0 ? null : (
                  <CommandGroup key={group.key} heading={group.heading}>
                    {group.hits.map((hit) => (
                      <CommandItem
                        key={`${group.key}:${hit.id}`}
                        value={`${group.key}:${hit.id}`}
                        onSelect={() => openHit(hit)}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{hit.label}</span>
                          {hit.sublabel || hit.at ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {[hit.sublabel, hit.at ? formatDate(hit.at) : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
              )
            : null}

          {/* Below the search floor, inside an account: say what would help. */}
          {accountId && q.length > 0 && q.length < MIN_QUERY ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{m["palette.hint"]}</p>
          ) : null}

          {nothingAtAll ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {m["palette.empty"].replace("{query}", query)}
            </p>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
```

- [ ] **Step 4: Mount it in the shell**

In `apps/web/src/app/(dashboard)/dashboard/layout.tsx`, add the import:

```tsx
import { CommandPalette } from "@/components/command-palette";
```

The palette must mount ONCE for the whole dashboard tree, and it derives the
account from `usePathname()` — this layout sits ABOVE `[accountId]`, so it
cannot pass an accountId down and must not try. Pass only the role.

Replace the `<Topbar isAgency={isAgency} />` line with:

```tsx
          <Topbar isAgency={isAgency} palette={<CommandPalette isAgency={isAgency} />} />
```

- [ ] **Step 5: Render it in the topbar**

In `apps/web/src/components/topbar.tsx`, widen the props and render the node.
Read the file first; the change is:

```tsx
export function Topbar({ isAgency, palette }: { isAgency: boolean; palette?: React.ReactNode }) {
```

and place `{palette}` in the topbar's left-hand cluster, before the presence
indicator. A `ReactNode` prop rather than importing `CommandPalette` directly:
`Topbar` is rendered by a server component, and this keeps the client boundary
where it already is.

⚠️ If `Topbar` is itself a client component (`"use client"` at the top), passing
a rendered element as a prop from the server layout is fine — elements
serialize. Passing a FUNCTION would not: that is the exact React Flight
violation that 500'd the whole setup page in P5. Do not convert this to a
render-prop.

- [ ] **Step 6: Typecheck, lint, build**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: exit 0 for all three.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/command-palette.tsx apps/web/src/components/ui/command.tsx apps/web/src/components/topbar.tsx "apps/web/src/app/(dashboard)/dashboard/layout.tsx" apps/web/src/lib/messages.ts
git commit -m "feat(palette): ⌘K over destinations, settings sections and live records"
```

---

### Task 7: `/dashboard/styleguide`

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `requireAgency(): Promise<{ userId: string }>` from `@/lib/auth`
  (**not** `requireAgencyOnlyAccountAccess` — see spec correction 1);
  `STATE_LABEL` and `STATE_TONE` from the setup rail
  (`.../setup/setup-rail.tsx:37,49`), both already exported.

- [ ] **Step 1: Add the copy**

In `apps/web/src/lib/messages.ts`:

```ts
  "styleguide.title": "Style guide",
  "styleguide.body":
    "Every component this app draws, in the theme you're looking at right now. Switch themes with the toggle to check both.",
```

- [ ] **Step 2: Write the page**

Create `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`:

```tsx
import { requireAgency } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagChips } from "@/components/tag-chips";
import {
  STATE_LABEL, STATE_TONE,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/setup/setup-rail";
import type { RailKind } from "@/lib/setup/setup-rail";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { Inbox } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * The working index DESIGN.md's definition-of-done refers to ("`/styleguide`
 * page updated if a new component/variant was added").
 *
 * AGENCY-ONLY but reachable in PRODUCTION — danlo's locked decision. The point
 * is precisely that tenant branding surprises only show up against real
 * production theming, which a dev-only page could never surface.
 *
 * `requireAgency()`, not `requireAgencyOnlyAccountAccess()`: this route has no
 * accountId, and that function requires one. A client who types the URL is
 * redirected to "/".
 *
 * Every entry NAMES ITS FILE so this stays an index rather than a poster.
 */
const RAIL_KINDS: RailKind[] = ["done", "open", "next", "skipped", "unknown", "locked"];

function Section({
  title, file, children,
}: { title: string; file: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {file}
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start gap-3">{children}</CardContent>
    </Card>
  );
}

export default async function StyleguidePage() {
  await requireAgency();

  return (
    <>
      <PageHeader title={m["styleguide.title"]} />
      <div className="space-y-6 p-6">
        <p className="max-w-prose text-sm text-muted-foreground">{m["styleguide.body"]}</p>

        <Section title="Buttons" file="components/ui/button.tsx">
          {(["default", "destructive", "outline", "secondary", "ghost", "link"] as const).map(
            (variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ),
          )}
          {(["xs", "sm", "default", "lg"] as const).map((size) => (
            <Button key={size} size={size}>
              size {size}
            </Button>
          ))}
          <Button disabled>disabled</Button>
        </Section>

        <Section title="Badges" file="components/ui/badge.tsx">
          {(["default", "secondary", "destructive", "outline", "ghost"] as const).map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </Section>

        <Section title="Tag chips" file="components/tag-chips.tsx">
          <TagChips tags={[{ id: "1", name: "vip" }, { id: "2", name: "roofing" }, { id: "3", name: "overflow" }]} />
        </Section>

        {/* DESIGN.md rule 3: status is never colour alone — dot + word. All
            six rail states, read straight off the rail's own exported maps so
            this page can never drift from the wizard. */}
        <Section title="Status states (setup rail)" file="…/setup/setup-rail.tsx">
          {RAIL_KINDS.map((kind) => (
            <span
              key={kind}
              className={cn(
                "inline-flex items-center gap-2 rounded-[--radius-pill] border px-2.5 py-1 text-xs",
                STATE_TONE[kind].chip,
              )}
            >
              <span className={cn("size-1.5 rounded-full", STATE_TONE[kind].dot)} aria-hidden />
              {STATE_LABEL[kind]}
            </span>
          ))}
        </Section>

        <Section title="Form controls" file="components/ui/{input,label,checkbox}.tsx">
          <div className="grid w-full max-w-sm gap-2">
            <Label htmlFor="sg-input">Label</Label>
            <Input id="sg-input" placeholder="Placeholder" />
            <Input id="sg-input-disabled" placeholder="Disabled" disabled />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox id="sg-check" /> Checkbox
            </label>
          </div>
        </Section>

        <Section title="Table + row states" file="components/ui/table.tsx">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Resting row</TableCell>
                <TableCell><Badge variant="outline">Booked</Badge></TableCell>
              </TableRow>
              <TableRow data-state="selected">
                <TableCell>Selected row</TableCell>
                <TableCell><Badge variant="secondary">Lead</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Section>

        <Section title="Loading skeletons" file="components/ui/skeleton.tsx">
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Section>

        <Section title="Empty state" file="components/empty-state.tsx">
          <div className="w-full">
            <EmptyState
              icon={Inbox}
              title="No conversations yet"
              body="When someone replies to a form or a call, the thread shows up here."
              action={<Button size="sm">Send a message</Button>}
            />
          </div>
        </Section>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Interactive components with their own state — the contact drawer
          (…/contacts/contact-drawer.tsx), InlineField
          (components/inline-field.tsx), the bulk-action bar
          (…/contacts/bulk-action-bar.tsx) and toasts (components/ui/sonner.tsx)
          — are exercised on their own screens and in the e2e suite rather than
          re-mounted here with fake data that could drift from the real thing.
        </p>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: exit 0.

If `PageHeader`'s or `TagChips`'s props differ from the call above, fix the CALL
to match the verified signature.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/styleguide" apps/web/src/lib/messages.ts
git commit -m "feat(styleguide): agency-only component index against live theming"
```

---

### Task 8: e2e — the palette, the grant, and the gate

**Files:**
- Create: `apps/web/e2e/palette.spec.ts`
- Create: `apps/web/e2e/styleguide.spec.ts`

**Interfaces:**
- Consumes: `SEEDED_ACCOUNT_NAME`, `SEEDED_CONTACT_NAME`, `openAccountByName`
  from `./support`; the client fixture at `e2e/.auth/client-fixture.json`.

**These specs are READ-ONLY.** They seed nothing and delete nothing, so they
target the seeded `Test Client One` for the agency half — the convention
`support.ts:68-79` sets out. The client half reads the per-run client fixture.
**Do not add seeding to these specs**; `deleteAccountCascade` does not cover
opportunities/pipelines/tags, and a stranded row makes the whole account
teardown fail.

- [ ] **Step 1: Write the palette spec**

Create `apps/web/e2e/palette.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SEEDED_ACCOUNT_NAME, SEEDED_CONTACT_NAME, openAccountByName } from "./support";

/**
 * The palette's live half rides `dbForRequest()` — an RLS-scoped client — and
 * a client session must see only its own rows. Unit tests mock the database
 * and are blind to column grants; this project has shipped three defects
 * behind exactly that blindness. Only the client-role block at the bottom of
 * this file can prove it.
 */
test.describe("the command palette, as the agency", () => {
  test("opens on the shortcut, navigates by keyboard, and closes on Esc", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await expect(page).toHaveURL(/\/dashboard\/accounts\/[^/]+/);

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    // The dialog must be NAMED — the stock CommandDialog rendered its title
    // outside the content, which left it unnamed for screen readers.
    await expect(palette).toHaveAccessibleName(/search/i);

    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  });

  test("a static destination is reachable with the keyboard alone", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("dialog").getByRole("combobox").fill("calendar");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/calendar$/);
  });

  test("a settings section jumps to its own anchor", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("dialog").getByRole("combobox").fill("custom fields");
    await page.getByRole("option", { name: "Custom fields" }).click();
    await expect(page).toHaveURL(/\/settings#custom-fields$/);
    // The anchor must EXIST — a registry entry pointing at a missing id looks
    // like the palette did nothing at all.
    await expect(page.locator("#custom-fields")).toBeVisible();
  });

  test("typing a seeded contact returns it live and Enter opens that contact", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await palette.getByRole("combobox").fill(SEEDED_CONTACT_NAME.split(" ")[0]!);

    const hit = palette.getByRole("option", { name: new RegExp(SEEDED_CONTACT_NAME, "i") });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();

    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: SEEDED_CONTACT_NAME })).toBeVisible();
    // A 404 renders not-found.tsx, which still satisfies the URL check above.
    await expect(page.getByText("Page not found")).toHaveCount(0);
  });

  test("a query that matches nothing says so instead of going blank", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await palette.getByRole("combobox").fill("zzzqqqnothingmatchesthis");
    await expect(palette.getByText(/nothing matches/i)).toBeVisible({ timeout: 15_000 });
  });

  test("a failed search shows an honest error, never an empty list", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    // Silence on a failed fetch reads as "no such contact" — a lie about a
    // failure. This is the only way to see that row.
    await page.route("**/api/accounts/*/search*", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await palette.getByRole("combobox").fill("rosa");
    await expect(palette.getByTestId("palette-error")).toBeVisible({ timeout: 15_000 });
    await expect(palette.getByRole("button", { name: /try again/i })).toBeVisible();
  });
});

/**
 * The grant, through a real client session — the assertion no unit test can
 * make. The client fixture account has its own contact; `Test Client One`'s
 * Maria Garcia belongs to a DIFFERENT tenant and must be invisible here.
 */
test.describe("the command palette, as the client", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("searches its own records and cannot see another tenant's", async ({ page }) => {
    const fixture = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as { accountId: string; contactName: string };

    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");

    // The POSITIVE case first — the M2 lesson. Every absence check in this
    // suite's client specs once passed while the client's whole CRM was a 404.
    await palette.getByRole("combobox").fill(fixture.contactName.split(" ")[0]!);
    await expect(
      palette.getByRole("option", { name: new RegExp(fixture.contactName, "i") }),
    ).toBeVisible({ timeout: 15_000 });

    // And now the boundary: another tenant's contact, by name, returns nothing.
    await palette.getByRole("combobox").fill(SEEDED_CONTACT_NAME);
    await expect(palette.getByText(/nothing matches/i)).toBeVisible({ timeout: 15_000 });
    await expect(palette.getByText(SEEDED_CONTACT_NAME)).toHaveCount(0);
  });

  test("is never offered an agency-only destination", async ({ page }) => {
    const fixture = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as { accountId: string };
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");

    // Positive control: the palette really is populated.
    await expect(palette.getByRole("option", { name: "Contacts" })).toBeVisible();
    // The absence checks, which only mean anything because that passed.
    await expect(palette.getByRole("option", { name: "Voice", exact: true })).toHaveCount(0);
    await expect(palette.getByRole("option", { name: "Setup", exact: true })).toHaveCount(0);
    await expect(palette.getByRole("option", { name: "Custom fields" })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Write the styleguide spec**

Create `apps/web/e2e/styleguide.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("the style guide", () => {
  test("renders for the agency, in both themes", async ({ page }) => {
    await page.goto("/dashboard/styleguide");
    await expect(page.getByRole("heading", { name: "Style guide" })).toBeVisible();
    await expect(page.getByRole("button", { name: "destructive" })).toBeVisible();
    // Six rail states, dot + word (DESIGN.md rule 3).
    await expect(page.getByText("Couldn't check")).toBeVisible();
  });
});

test.describe("the style guide is agency-only", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client is redirected away", async ({ page }) => {
    await page.goto("/dashboard/styleguide");
    // requireAgency() sends a non-agency caller to "/", NOT to their own
    // dashboard — that is requireAgencyOnlyAccountAccess's behaviour, and this
    // route has no accountId to send them to.
    await expect(page).not.toHaveURL(/styleguide/);
    await expect(page.getByRole("heading", { name: "Style guide" })).toHaveCount(0);
  });
});
```

`m["setup.state.unknown"]` is verbatim `"Couldn't check — reload to retry"`
(`messages.ts:781`). `getByText` is a substring match, so `"Couldn't check"`
matches it correctly — this is deliberate, not a truncation to fix.

- [ ] **Step 3: Run the two new specs alone first**

Run: `pnpm --filter web test:e2e -- palette styleguide`
Expected: PASS.

**Never diagnose an e2e failure while a second run is alive** — two runs share
one Supabase project and produce meaningless failures.

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter web test:e2e`
Expected: PASS. Baseline is 56 specs; this adds 8.

`contacts-drawer.spec.ts:348` is known to be flake-prone under contention — if
it is the only red, re-run that spec alone before treating it as a regression.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/palette.spec.ts apps/web/e2e/styleguide.spec.ts
git commit -m "test(e2e): palette keyboard, states, tenancy boundary, and the styleguide gate"
```

---

## Final gates before merge

- [ ] `pnpm check` — exit 0 (typecheck + lint + db + web tests)
- [ ] `pnpm --filter web build`
- [ ] `pnpm --filter web test:e2e` — full suite
- [ ] **Screenshot pass, both themes:** palette open with mixed static + live
      results, its empty state, its error state, and the styleguide. DESIGN.md's
      "renders in dark AND light" is checked against the `.dark` class
      (next-themes), not `data-theme`.
- [ ] Review gate (no autonomous merge — danlo's standing rule)
- [ ] danlo's screenshot gate

## Self-review notes

Spec coverage checked section by section: two result classes (Tasks 3+5), GET
route with `apiAccountAccess` + `dbForRequest` + per-source caps (Task 5),
debounce/abort/stale guard (Task 6), palette shell on ⌘K **and** Ctrl+K with Esc
(Task 6), its own loaded/empty/error states (Task 6), navigation + safe actions
only (Task 3's `PaletteActionId`), settings sections registered in the index
(Tasks 3+4), `/styleguide` agency-only in production (Task 7), and every test
the spec's Testing section names (Tasks 3, 5, 8).

Two spec items deliberately NOT implemented, and why: **cross-account search**
is out of scope by the spec's own Out-of-scope list, and **"safe creates"** ship
as a supported entry KIND (`kind: "action"`) with exactly one safe action
(theme) rather than a create — the spec states creates as a permission boundary,
not a deliverable, and every create in this app currently lives behind a dialog
on its own page. Adding one would mean cross-page dialog plumbing for no locked
requirement. Flagging for danlo rather than silently expanding scope.
