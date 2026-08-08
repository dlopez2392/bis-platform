# M3 White-Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client company's users, and their own customers, see that company's name and logo instead of BIS's.

**Architecture:** Two nullable columns on `accounts` (`brand_name`, `brand_logo_path`) plus a public Supabase Storage bucket. The agency sets both from the account's Settings page, which `requireAgencyOnlyAccountAccess` already gates — so no client-facing write path or file upload exists. Two surfaces read the branding: the client's sidebar, and the public lead form at `/f/<publicId>`.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Supabase Postgres + Supabase Storage, `@bis/db` workspace package, Clerk, Vitest, Playwright, Tailwind v4 semantic tokens. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-07-m3-white-labeling-design.md` — read it before Task 1.

## Global Constraints

- **Branding is agency-only.** Both the page and the actions are gated by `requireAgencyOnlyAccountAccess(accountId)`. There is no client-facing upload path, and none may be introduced.
- **SVG must be rejected.** An SVG is an XML document that can carry `<script>`, and the logo is served to the client's *customers* on a public page. Accepting one makes this upload a stored-XSS vector on the least-trusted surface in the product. **Accept PNG, JPEG and WebP only, validated by decoded magic bytes — never by filename extension or the browser-supplied MIME type**, both of which the client controls.
- **The storage path is derived server-side from the account id.** Never from user input, never from the uploaded filename.
- **Nothing renders blank when branding is unset.** Every surface has a fallback (spec §5).
- **The agency's own chrome never wears a client's brand.** `m["shell.brand"]` stays "BIS" for the agency.
- **`accountId` on any server action is bound server-side** via `.bind(null, accountId)`, never a hidden input. A previous milestone shipped 12 latent IDORs from exactly that mistake.
- **A `"use server"` file may export only async functions.** Sync helpers go in a sibling module.
- **All user-visible strings from the `m` catalog**; semantic Tailwind tokens only, no raw colors.
- **Query-level faults fail loud:** check `.error` and throw naming which query failed. Never `?? []`.
- **No new npm dependencies.** In particular, do not add `@supabase/supabase-js` to `apps/web` — the `SupabaseClient` type is re-exported from `@bis/db`.
- **Do NOT delete or modify pre-existing data in the shared dev database.** Two agents have done so unprompted on this project. Restore anything you toggle.
- **Five gates green before every commit**, each as its own unpiped command: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm --filter web build` · `pnpm --filter web test:e2e`

### Testing notes specific to this codebase

- **A `packages/db` flake has hit three different files** (`activities`, `checklist`, `crm-config`), each passing on isolated rerun. Rerun a single failing db test alone before assuming you broke it.
- E2E timeouts across *unrelated* specs usually mean a stale `node`/`next` process holding port 3000.
- `apps/web` has no `.tsx` or server-action unit-test harness. Do not invent one — verify via `pnpm --filter web build`, the E2E suite, and reading.
- Do not run ad-hoc browser walkthroughs against the shared dev database.

---

## File Structure

**`packages/db`**
- Create `supabase/migrations/0010_branding.sql` — the two columns.
- Create `src/branding.ts` — `setBranding`, `getBrandingByAccountId`, and the logo upload/remove helpers. Separate from `accounts.ts` because it owns Storage as well as Postgres.
- Modify `src/index.ts` — exports.

**`apps/web`**
- Create `src/lib/branding/validate-logo.ts` — magic-byte format validation. Pure, unit-testable, no I/O.
- Create `src/lib/branding/validate-logo.test.ts`
- Create `src/app/(dashboard)/dashboard/accounts/[accountId]/settings/branding-panel.tsx`
- Modify `settings/page.tsx`, `settings/actions.ts`
- Modify `src/components/app-sidebar.tsx`, `src/app/(dashboard)/dashboard/layout.tsx`
- Create `src/app/f/[publicId]/form-brand.tsx` — the public form's brand header
- Modify `src/app/f/[publicId]/page.tsx`
- Modify `src/lib/messages.ts`
- Modify `e2e/client-access.spec.ts`

---

## Task 1: Prove Supabase Storage end to end

This task exists to fail fast. **No Supabase Storage bucket exists in this project** — nothing in `apps/` or `packages/` calls `.storage`. Everything else assumes a bucket that can be written server-side and read anonymously.

**Files:**
- Create: `packages/db/src/branding.ts`
- Create: `packages/db/src/test/branding.integration.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces:
  - `uploadBrandLogo(db: SupabaseClient, accountId: string, bytes: Uint8Array, contentType: string): Promise<string>` — returns the stored object path.
  - `brandLogoUrl(path: string): string` — the public URL for a stored path.

- [ ] **Step 1: Create the bucket**

Create a **public** bucket named `brand-logos` on project `tlbkbmlrfafquucsmsmm`. Public because the logo is rendered on `/f/<publicId>` to anonymous visitors; signed URLs would expire and add a request per render for no benefit.

Use the Supabase management API, the CLI, or an MCP tool. **If this requires dashboard access you do not have, STOP and report NEEDS_CONTEXT with the exact steps the owner must perform.** Do not improvise an alternative store, and do not fall back to base64-in-Postgres.

Record in your report how the bucket was created and how you verified it exists.

- [ ] **Step 2: Write the failing integration test**

Create `packages/db/src/test/branding.integration.test.ts`. This hits live Storage, so it belongs in the **integration** config that Task 1 of M2 established — see `packages/db/vitest.integration.config.ts` and the `test:integration` script. It must **skip loudly, not fail**, when credentials are absent, matching `user-client.integration.test.ts`'s existing guard.

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { uploadBrandLogo, brandLogoUrl } from "../branding";

// A 1x1 PNG, byte-for-byte. Magic bytes 89 50 4E 47 make this a genuine PNG,
// not a renamed file — the point is to prove a real image round-trips.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("brand logo storage", () => {
  it("uploads server-side and serves the bytes back anonymously", async () => {
    const db = serviceDb();
    const accountId = "00000000-0000-0000-0000-0000000000aa";
    const path = await uploadBrandLogo(db, accountId, PNG_1PX, "image/png");
    try {
      const res = await fetch(brandLogoUrl(path));
      expect(res.status).toBe(200);
      const back = Buffer.from(await res.arrayBuffer());
      expect(back.equals(PNG_1PX)).toBe(true);
    } finally {
      await db.storage.from("brand-logos").remove([path]);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @bis/db test:integration`
Expected: FAIL — `uploadBrandLogo` does not exist.

- [ ] **Step 4: Implement**

Create `packages/db/src/branding.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "brand-logos";

/** Extension for a validated content type. The caller has already proven the
 *  bytes really are this format (see apps/web's validate-logo); this only
 *  picks a filename, and must never be derived from user input. */
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Stores a brand logo. SERVER ONLY — takes the service-role client.
 *
 * The path is derived from accountId, never from the uploaded filename: a
 * client-controlled path is how an upload escapes its own prefix.
 */
export async function uploadBrandLogo(
  db: SupabaseClient, accountId: string, bytes: Uint8Array, contentType: string,
): Promise<string> {
  const ext = EXT[contentType];
  if (!ext) throw new Error(`uploadBrandLogo: unsupported content type ${contentType}`);
  const path = `${accountId}/logo.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true, // replacing a logo overwrites in place; no delete path in v0
  });
  if (error) throw new Error(`uploadBrandLogo failed: ${error.message}`);
  return path;
}

export function brandLogoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("brandLogoUrl: NEXT_PUBLIC_SUPABASE_URL missing");
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}
```

Export both from `packages/db/src/index.ts`.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @bis/db test:integration`
Expected: PASS — 200, and the bytes returned match the bytes sent.

**This passing is the milestone's go/no-go.** If it cannot pass, report BLOCKED with what you observed rather than proceeding.

- [ ] **Step 6: Gates and commit**

`pnpm typecheck` · `pnpm lint` · `pnpm test`

```bash
git add packages/db
git commit -m "feat(db): brand logo storage, proven against a live public bucket"
```

---

## Task 2: Migration 0010 and the branding service

**Files:**
- Create: `packages/db/supabase/migrations/0010_branding.sql`
- Modify: `packages/db/src/branding.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: Task 1's module.
- Produces:
  - `setBranding(db, accountId, input: { brandName?: string | null; brandLogoPath?: string | null }, actorId): Promise<void>`
  - `getBranding(db, accountId): Promise<{ brandName: string | null; brandLogoPath: string | null }>`

- [ ] **Step 1: Write the migration**

```sql
-- Both nullable: null means "not branded", every surface falls back, and
-- shipping this changes nothing for existing accounts.
--
-- brand_name is deliberately separate from accounts.name. accounts.name is
-- the agency's internal label ("Rio Roofing - trial"); brand_name is what
-- that company's own customers see on their lead form.
--
-- brand_logo_path stores the object path within the bucket, not a URL:
-- URLs change with project or CDN configuration, paths do not.
alter table public.accounts
  add column brand_name text,
  add column brand_logo_path text;
```

- [ ] **Step 2: Apply it to the dev database**

Apply the same way migrations 0001–0009 were applied. Confirm by reading `information_schema.columns` back — do not trust the push output.

- [ ] **Step 3: Add the service functions**

In `packages/db/src/branding.ts`, following `accounts.ts`'s conventions (throw naming the query; `emit` an event on write):

```ts
export async function setBranding(
  db: SupabaseClient,
  accountId: string,
  input: { brandName?: string | null; brandLogoPath?: string | null },
  actorId: string,
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if ("brandName" in input) patch.brand_name = input.brandName ?? null;
  if ("brandLogoPath" in input) patch.brand_logo_path = input.brandLogoPath ?? null;
  if (Object.keys(patch).length === 0) return;
  const { error } = await db.from("accounts").update(patch).eq("id", accountId);
  if (error) throw new Error(`setBranding failed: ${error.message}`);
  await emit(db, accountId, "account.branding_updated", actorId, {});
}

export async function getBranding(
  db: SupabaseClient, accountId: string,
): Promise<{ brandName: string | null; brandLogoPath: string | null }> {
  const { data, error } = await db.from("accounts")
    .select("brand_name, brand_logo_path").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getBranding failed: ${error.message}`);
  return { brandName: data?.brand_name ?? null, brandLogoPath: data?.brand_logo_path ?? null };
}
```

- [ ] **Step 4: Gates and commit**

`pnpm typecheck` · `pnpm lint` · `pnpm test`

```bash
git add packages/db
git commit -m "feat(db): brand_name and brand_logo_path on accounts"
```

---

## Task 3: Logo format validation

The security-critical piece. Pure and unit-testable, deliberately separate from any I/O.

**Files:**
- Create: `apps/web/src/lib/branding/validate-logo.ts`
- Create: `apps/web/src/lib/branding/validate-logo.test.ts`

**Interfaces:**
- Produces: `sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { sniffImageType } from "./validate-logo";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("sniffImageType", () => {
  it("recognizes the three accepted raster formats", () => {
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  // The whole reason this module exists. An SVG can carry <script>, and the
  // logo is served to the client's CUSTOMERS on a public page — accepting one
  // would make this upload a stored-XSS vector on the least-trusted surface.
  it("rejects SVG, including one that claims to be a PNG", () => {
    expect(sniffImageType(svg)).toBeNull();
  });

  it("rejects a file whose bytes do not match any accepted format", () => {
    expect(sniffImageType(new TextEncoder().encode("not an image at all"))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    // Truncated PNG signature: a prefix must not be treated as a match.
    expect(sniffImageType(Uint8Array.from([0x89, 0x50]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter web test -- src/lib/branding/validate-logo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Identifies an image by its actual leading bytes.
 *
 * Deliberately does NOT consult the filename or the browser-supplied MIME
 * type — the client controls both, so a .png extension on an SVG would sail
 * straight through a check based on either. SVG is absent from this list on
 * purpose: it is an XML document that can carry <script>, and this file is
 * served to the client's customers on a public page.
 */
export function sniffImageType(
  bytes: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | null {
  const starts = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length &&
    sig.every((b, i) => bytes[offset + i] === b);

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  // WebP is a RIFF container: "RIFF" then 4 size bytes then "WEBP".
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

/** Bytes. A logo far above this is a mistake or an attack, not a logo. */
export const MAX_LOGO_BYTES = 512 * 1024;
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm --filter web test -- src/lib/branding/validate-logo.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

`pnpm typecheck` · `pnpm lint` · `pnpm test`

```bash
git add apps/web/src/lib/branding
git commit -m "feat(web): identify logo format by magic bytes, rejecting SVG"
```

---

## Task 4: The Branding panel in Settings

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/branding-panel.tsx`
- Modify: `settings/page.tsx`, `settings/actions.ts`, `src/lib/messages.ts`

**Interfaces:**
- Consumes: `setBranding`, `getBranding`, `uploadBrandLogo`, `brandLogoUrl` (Tasks 1-2); `sniffImageType`, `MAX_LOGO_BYTES` (Task 3).

- [ ] **Step 1: Message strings**

```ts
"branding.title": "Branding",
"branding.body": "Shown to this company's users in place of the BIS name and mark, and on their public lead forms.",
"branding.name": "Display name",
"branding.nameHint": "What this company's own customers see. Your internal name for them stays private.",
"branding.logo": "Logo",
"branding.logoHint": "PNG, JPEG or WebP, up to 512 KB.",
"branding.upload": "Upload",
"branding.saved": "Branding updated",
"branding.saveFailed": "Could not update branding",
"branding.badFormat": "That file isn't a PNG, JPEG or WebP.",
"branding.tooLarge": "That file is larger than 512 KB.",
"branding.noLogo": "No logo set",
```

- [ ] **Step 2: The server action**

In `settings/actions.ts`. Note the guard: this is agency-only, matching the sibling `setClientAccessAction`.

```ts
export async function setBrandingAction(
  accountId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);

  const brandName = String(formData.get("brandName") ?? "").trim() || null;
  const file = formData.get("logo");

  let brandLogoPath: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) return { ok: false, error: m["branding.tooLarge"] };
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Sniff the real bytes. file.type is browser-supplied and the filename is
    // client-controlled; neither is evidence of anything.
    const contentType = sniffImageType(bytes);
    if (!contentType) return { ok: false, error: m["branding.badFormat"] };
    brandLogoPath = await uploadBrandLogo(serviceDb(), accountId, bytes, contentType);
  }

  await setBranding(
    serviceDb(), accountId,
    brandLogoPath ? { brandName, brandLogoPath } : { brandName },
    userId,
  );
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}
```

`serviceDb()` is correct here and elsewhere in this file: Settings is agency-only, and Storage writes need the service role.

- [ ] **Step 3: The panel**

`branding-panel.tsx` — a display-name text input, a file input, a submit button, and a preview of the current logo (or `m["branding.noLogo"]`). Match the visual structure of the sibling panels in that directory. Semantic tokens only, all strings from `m`. Errors returned by the action render inline or via `toast.error`, following `client-access-panel.tsx`'s existing pattern.

Mount it in `settings/page.tsx` with `setBrandingAction.bind(null, accountId)`.

- [ ] **Step 4: Gates and commit**

All five.

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings" apps/web/src/lib/messages.ts
git commit -m "feat(web): set a company's display name and logo from Settings"
```

---

## Task 5: The client's sidebar wears the brand

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/app/(dashboard)/dashboard/layout.tsx`

**Interfaces:**
- Consumes: `getBranding`, `brandLogoUrl`.

Background: PR #8 added a `clientAccountName` prop, rendered in the switcher's slot for clients. This extends that with the brand.

- [ ] **Step 1: Resolve branding in the layout**

`dashboard/layout.tsx` already resolves the client's account via `resolveClientAccessState()` and passes `clientAccountName`. Extend it to also pass the brand name and logo URL when set.

**The agency branch must not change.** The agency always sees `m["shell.brand"]` and the account switcher.

- [ ] **Step 2: Render in the sidebar**

In the non-agency branch of `app-sidebar.tsx`, prefer the logo, then the brand name, then the account name (PR #8's current behavior). Collapsed state shows the logo alone, or the existing `Building2` icon when there is none.

The top-of-sidebar `m["shell.brand"]` link reads "BIS" for both audiences today. For a client with branding set, it should show their brand instead — that link is the most visible instance of the problem this milestone exists to fix.

Use `next/image` if the codebase already uses it; otherwise a plain `<img>` with explicit width/height to avoid layout shift. Constrain the rendered height so a tall logo cannot distort the sidebar.

- [ ] **Step 3: Gates and commit**

All five. The existing agency E2E (`shell.spec.ts`) must pass unchanged — it is the proof the agency's chrome is untouched.

```bash
git add apps/web/src/components apps/web/src/app
git commit -m "feat(web): a client's sidebar shows their brand, not the agency's"
```

---

## Task 6: The public lead form wears the brand

**Files:**
- Create: `apps/web/src/app/f/[publicId]/form-brand.tsx`
- Modify: `apps/web/src/app/f/[publicId]/page.tsx`, `src/app/f/[publicId]/form.css` if needed

**Interfaces:**
- Consumes: `getBranding`, `brandLogoUrl`.

Background, verified: **the public form has no header at all today** — `page.tsx` renders `<main>` straight into `<PublicForm>`, which opens with `<form>`. So this is a new element, not a modification of an existing one.

`getPublishedFormByPublicId` selects only from `forms`, so the account's branding needs a second read keyed on the form's `account_id`.

- [ ] **Step 1: Read the branding in the page**

In `page.tsx`, after the form is fetched and the `notFound()` guard, read the branding for `form.account_id` using `serviceDb()` — this route is anonymous, there is no user token, and `serviceDb()` is already what it uses.

Fail loud on a query error, consistent with the rest of the file.

- [ ] **Step 2: The brand header**

`form-brand.tsx` — renders the logo and/or brand name above the form. Renders **nothing at all** when neither is set, so an unbranded form looks exactly as it does today.

This page has its own stylesheet (`form.css`) and its own theme handling (`form.theme.mode === "dark"`), and is **not** part of the dashboard's Tailwind semantic-token system in the same way. Follow the conventions already in `form.css` and `public-form.tsx` rather than importing dashboard tokens.

Constrain the logo's rendered height so a large upload cannot dominate the page.

- [ ] **Step 3: Gates and commit**

All five. The existing `forms.spec.ts` E2E must pass unchanged — an unbranded form must render exactly as before.

```bash
git add "apps/web/src/app/f/[publicId]"
git commit -m "feat(web): the public lead form wears the client's brand"
```

---

## Task 7: End-to-end coverage and the final gate

**Files:**
- Modify: `apps/web/e2e/client-access.spec.ts`, `apps/web/e2e/auth.setup.ts`

- [ ] **Step 1: Brand the fixture account**

`auth.setup.ts` already creates a client fixture account. Set a `brand_name` on it (a logo upload in the fixture is optional — say so in your report if you skip it, and why).

- [ ] **Step 2: Assert the client sees the brand**

Extend `client-access.spec.ts`: the signed-in client sees the brand name, and does **not** see "BIS" anywhere in the sidebar.

PR #8 added an assertion that the client sees their *account* name. If branding replaces it, update that assertion rather than leaving two that contradict each other — and say in your report which behavior you settled on.

- [ ] **Step 3: Assert the public form is branded**

A form on the branded fixture account renders the brand name at `/f/<publicId>`. Note this is an **anonymous** page — do not reuse a signed-in storage state.

- [ ] **Step 4: Prove each new assertion can fail**

Break the production code, confirm the assertion goes red, revert. Report exactly what you did and observed. An assertion that cannot fail is worse than none — the M2 client spec passed for a week while proving less than it appeared to.

- [ ] **Step 5: All five gates**

Each as its own unpiped command, with real output captured. Clean up anything the fixture created, including uploaded objects, and report before/after counts proving no residue.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e
git commit -m "test(e2e): a client and their customers see the client's brand"
```

---

## Self-Review

**Spec coverage.** §2 agency-controlled → Tasks 4 (guard). §2 surfaces → Tasks 5, 6. §2 name model → Task 2 (`brand_name` column), Task 5, Task 6. §3 data → Task 2. §4 storage and the SVG constraint → Tasks 1, 3, 4. §5 fallbacks → Tasks 5 (sidebar), 6 (renders nothing unbranded). §6 out of scope → nothing in this plan touches colors, email, custom domains, or a client-facing write path. §7's open question about the form header → **resolved during planning: there is no header today**, recorded in Task 6.

**Known gaps, deliberately left:**
- **Task 1 Step 1 may need dashboard access the implementer lacks.** It is instructed to STOP and report rather than improvise. This is the milestone's principal unknown and is why it is Task 1, alone.
- **Task 4 Step 3's panel and Tasks 5-6's markup are specified by behavior, not by code.** They must match sibling panels and an existing stylesheet the implementer can read; prescribing markup here would fight the conventions already in those files.
- **No logo *delete* path in v0** — replacing overwrites in place (`upsert: true`). Spec §7 records this as the default choice.
- Task 7 Step 2 may require changing an assertion PR #8 just added. That is flagged rather than hidden, because two assertions disagreeing about the same slot is worse than either.
