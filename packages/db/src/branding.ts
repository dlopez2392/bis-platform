import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";

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
 * The path is derived from accountId and the bytes themselves, never from the
 * uploaded filename: a client-controlled path is how an upload escapes its own
 * prefix.
 *
 * Content-addressed rather than a fixed `logo.png` per account, because this
 * bucket is public and therefore CDN-cached. Overwriting a fixed path in place
 * leaves the URL unchanged, so the edge keeps serving the OLD image — to the
 * agency admin who just uploaded, and to the client's own customers on the
 * public lead form, for as long as the cache entry lives. That is the same
 * edge-cache behaviour that produced a false positive during this milestone's
 * storage proof; here it would look like "the upload silently did nothing".
 * A digest in the filename means a changed image is always a changed URL.
 *
 * Re-uploading identical bytes lands on the same path, which `upsert` makes
 * idempotent. The caller is responsible for removing the account's previous
 * object once the new path is committed — see removeBrandLogo.
 */
export async function uploadBrandLogo(
  db: SupabaseClient, accountId: string, bytes: Uint8Array, contentType: string,
): Promise<string> {
  const ext = EXT[contentType];
  if (!ext) throw new Error(`uploadBrandLogo: unsupported content type ${contentType}`);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const path = `${accountId}/logo-${digest}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`uploadBrandLogo failed: ${error.message}`);
  return path;
}

/**
 * Deletes one stored object. SERVER ONLY.
 *
 * Used to sweep up an account's previous logo after a replacement is safely
 * recorded. Callers should treat a failure here as cosmetic — an orphaned
 * object costs a few KB, whereas failing the save would lose the branding the
 * user actually asked for.
 */
export async function removeBrandLogo(db: SupabaseClient, path: string): Promise<void> {
  const { error } = await db.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`removeBrandLogo failed: ${error.message}`);
}

/**
 * Whether a logo object is still in Storage. SERVER ONLY.
 *
 * The Storage-side half of `restoreBrandLogoAction`'s two Undo checks (the
 * database-side half is `restoreBrandLogoIfCleared` below) — "Remove logo"
 * never deletes the object right away, but a LATER action can have by the
 * time a stale Undo toast fires: another Remove's own sweep, or this
 * account's next upload (both call `sweepOrphanedLogos`).
 */
export async function logoExists(db: SupabaseClient, path: string): Promise<boolean> {
  const { data, error } = await db.storage.from(BUCKET).exists(path);
  if (error) throw new Error(`logoExists failed: ${error.message}`);
  return data;
}

/**
 * Deletes every object under one account's logo prefix EXCEPT `keepPath` AND
 * the account's CURRENT `brand_logo_path` (re-read right here, never just
 * trusted from the caller). SERVER ONLY.
 *
 * Exists for "Remove logo" (web's removeBrandLogoAction): that action clears
 * `brand_logo_path` WITHOUT deleting the stored object, so an Undo toast can
 * restore it — the object sits unreferenced until something else touches
 * this account's logo. Both call sites that touch it (a fresh upload, or a
 * new Remove) pass the path they are about to make current as `keepPath`, so
 * this sweeps up whatever was left behind by an EARLIER Remove nobody undid,
 * never the object a caller is relying on still being there.
 *
 * The live re-read closes a race a near-Critical review caught (2026-10-04):
 * `keepPath` is a SNAPSHOT the caller computed before this call was
 * scheduled, and Remove's own sweep in particular can be scheduled well
 * after its write. If a second save — a concurrent upload, say — changes
 * `brand_logo_path` in between, a sweep that trusted only the stale
 * `keepPath` would delete the object that upload just wrote. Keeping
 * whatever is live at sweep-time as well closes that window; it does not
 * widen the account/prefix scope below, which is still exactly `keepPath`
 * and the DB row's own current value for THIS account.
 *
 * Lists exactly one prefix (`${accountId}/`) and only ever removes objects
 * found under it — `uploadBrandLogo`'s content-addressed paths all start
 * there, so a cross-account delete is impossible by construction, not by a
 * check here. Account ids are fixed-length UUID folders and Storage's `list`
 * is per-folder (non-recursive), so this can never see — let alone touch —
 * another account's objects.
 *
 * `keepPath === null` and no live `brand_logo_path` sweeps the whole prefix:
 * there is nothing to keep (the account has no current logo at all).
 */
export async function sweepOrphanedLogos(
  db: SupabaseClient, accountId: string, keepPath: string | null,
): Promise<void> {
  const { data: row, error: readError } = await db.from("accounts")
    .select("brand_logo_path").eq("id", accountId).maybeSingle();
  if (readError) throw new Error(`sweepOrphanedLogos: read failed: ${readError.message}`);
  const current = (row as { brand_logo_path: string | null } | null)?.brand_logo_path ?? null;
  const keep = new Set([keepPath, current].filter((p): p is string => p !== null));

  const { data, error } = await db.storage.from(BUCKET).list(accountId);
  if (error) throw new Error(`sweepOrphanedLogos: list failed: ${error.message}`);
  const stale = (data ?? [])
    .map((o) => `${accountId}/${o.name}`)
    .filter((p) => !keep.has(p));
  if (stale.length === 0) return;
  const { error: removeError } = await db.storage.from(BUCKET).remove(stale);
  if (removeError) throw new Error(`sweepOrphanedLogos: remove failed: ${removeError.message}`);
}

/**
 * The Undo of "Remove logo" — restores `brand_logo_path` to `path`, but ONLY
 * if the column is still NULL right now. A compare-and-set, not a plain
 * write: this is the fix for a near-Critical review finding (2026-10-04),
 * reproduced as writes=[null, "acct_1/logo-new.png", "acct_1/logo-old.png"]
 * — Remove, then a fresh upload, then a STALE Undo toast (sonner pauses its
 * timer on hover/focus, so "stale" can be seconds or minutes) silently
 * overwriting the upload that came after it. The `.is("brand_logo_path",
 * null)` below is translated to a single `UPDATE … WHERE id = … AND
 * brand_logo_path IS NULL`, so the check and the write are one atomic
 * statement — there is no read-then-write gap for a second save to land in.
 *
 * Returns whether the write actually happened; the caller (restoreBrandLogo-
 * Action) turns `false` into a plain-language refusal rather than reporting
 * success for a write that did not occur. Never re-derived from an upload —
 * the caller is responsible for the object still existing in Storage (see
 * `.exists()` at the call site); this function only owns the database side
 * of the compare-and-set.
 */
export async function restoreBrandLogoIfCleared(
  db: SupabaseClient, accountId: string, path: string, actorId: string,
): Promise<boolean> {
  const { data, error } = await db.from("accounts")
    .update({ brand_logo_path: path })
    .eq("id", accountId)
    .is("brand_logo_path", null)
    .select("id");
  if (error) throw new Error(`restoreBrandLogoIfCleared failed: ${error.message}`);
  if (!data?.length) return false;
  await emit(db, accountId, "account.branding_updated", actorId, {});
  return true;
}

export function brandLogoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("brandLogoUrl: NEXT_PUBLIC_SUPABASE_URL missing");
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** What a surface needs to wear a company's brand. All null = not branded. */
export type Branding = {
  brandName: string | null;
  brandLogoPath: string | null;
  brandColor: string | null;
  brandNeutral: "warm" | "cool" | "slate" | null;
  brandCorners: "sharp" | "soft" | "round" | null;
  brandType: "geist" | "inter" | "serif" | null;
  brandMode: "light" | "dark" | "follow" | null;
  /** Where a reply to this company's outbound mail should go.
   *
   *  Not visual branding, and it rides this type deliberately. The client's
   *  own /branding page is safe to expose because it reads branding and
   *  NOTHING else -- a property of what it reads rather than of a conditional,
   *  so there is no branch for a future edit to get wrong. A second accessor
   *  would cost exactly that property for one column. Extract it the day M4d
   *  grows a real email identity (custom domain, per-account From). */
  replyToEmail: string | null;
};

/**
 * The columns `brandingChangePayload` carries an old -> new value for: short
 * text/enum scalars a person reads directly on an audit row. Deliberately
 * excludes `brand_logo_path` (a Storage path, not file content, but not what
 * this row exists to show either) and `mailing_address` (free text, possibly
 * several lines) — both still appear in `fields` below, so the record still
 * shows WHAT was touched.
 */
const SHORT_SCALAR_AUDIT_FIELDS = new Set([
  "brand_name", "brand_color", "brand_neutral", "brand_corners", "brand_type",
  "brand_mode", "reply_to_email",
]);

/**
 * D-069: `setBranding` used to emit `account.branding_updated` with an empty
 * `{}` payload — the record showed WHO changed branding, never WHAT. Builds
 * the payload from the patch about to be written and the row's values just
 * before it: every CHANGED column's name, plus old -> new for the short
 * scalar fields (see `SHORT_SCALAR_AUDIT_FIELDS`). Exported and pure so it
 * carries its own unit tests, same reason `color.ts` stays separate from the
 * action that calls it.
 *
 * Review round: `fields` is every key in `patch` whose value actually
 * DIFFERS from `before` — not simply `Object.keys(patch)`. The real (and
 * only) caller, branding/actions.ts, resends all 7-8 columns on EVERY save
 * (its own form always submits every field), so a colour-only edit was
 * logging 8 "changed" fields with 6 of them `from === to`.
 *
 * `snapshotFailed` is the caller's explicit admission the before-read
 * itself FAILED (a query fault, not "no row") — it must never be inferred
 * from `before` being `null`, because `null` is also the legitimate answer
 * for a row that genuinely does not exist yet (getBranding's own contract).
 * Conflating the two was the bug this round closes: a read fault silently
 * became `before = null`, which made every patched field read as "changed"
 * with a fabricated `from: null`. On a failed read this still names every
 * patched column (the write DID touch them), but logs no old/new values at
 * all and marks `snapshot: false`, so a reader of the event can tell the
 * difference between a verified delta and an unverifiable one.
 */
export function brandingChangePayload(
  patch: Record<string, string | null>,
  before: Record<string, string | null> | null,
  snapshotFailed = false,
): {
  fields: string[];
  changes: Record<string, { from: string | null; to: string | null }>;
  snapshot?: false;
} {
  if (snapshotFailed) {
    return { fields: Object.keys(patch), changes: {}, snapshot: false };
  }
  const fields: string[] = [];
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const field of Object.keys(patch)) {
    const from = before?.[field] ?? null;
    const to = patch[field] ?? null;
    if (from === to) continue;
    fields.push(field);
    if (SHORT_SCALAR_AUDIT_FIELDS.has(field)) {
      changes[field] = { from, to };
    }
  }
  return { fields, changes };
}

/**
 * Patches one account's branding. SERVER ONLY, agency-gated at the call site.
 *
 * A field is written only when it is present AND not `undefined`. The two are
 * not the same thing, and the distinction is load-bearing: the Settings action
 * omits `brandLogoPath` entirely when the form carried no new file, and must
 * not wipe the logo the account already has. Testing `"brandLogoPath" in input`
 * alone would clear it the moment a caller spread in an optional variable that
 * happened to be undefined -- a silent data loss on a field nobody edited.
 * `undefined` therefore means "leave it alone"; an explicit `null` clears.
 */
export async function setBranding(
  db: SupabaseClient,
  accountId: string,
  input: {
    brandName?: string | null; brandLogoPath?: string | null; brandColor?: string | null;
    brandNeutral?: Branding["brandNeutral"]; brandCorners?: Branding["brandCorners"];
    brandType?: Branding["brandType"]; brandMode?: Branding["brandMode"];
    replyToEmail?: string | null;
    /** Migration 0048. Not on `Branding` (see `getMailingAddress`), but
     *  written here because the Branding page saves it with everything else,
     *  through the same RLS-enforced write and the same granted column list. */
    mailingAddress?: string | null;
  },
  actorId: string,
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if (input.brandName !== undefined) patch.brand_name = input.brandName;
  if (input.brandLogoPath !== undefined) patch.brand_logo_path = input.brandLogoPath;
  if (input.brandColor !== undefined) patch.brand_color = input.brandColor;
  if (input.brandNeutral !== undefined) patch.brand_neutral = input.brandNeutral;
  if (input.brandCorners !== undefined) patch.brand_corners = input.brandCorners;
  if (input.brandType !== undefined) patch.brand_type = input.brandType;
  if (input.brandMode !== undefined) patch.brand_mode = input.brandMode;
  if (input.replyToEmail !== undefined) patch.reply_to_email = input.replyToEmail;
  if (input.mailingAddress !== undefined) patch.mailing_address = input.mailingAddress;
  if (Object.keys(patch).length === 0) return;

  // D-069's "before" snapshot, read just ahead of the write so the audit
  // payload can carry old -> new for the short scalar fields, AND (review
  // round) so `brandingChangePayload` can tell a real change from one of
  // the real caller's own no-op resends. Best-effort, not a compare-and-set:
  // a save that lands between this read and the update below can make a
  // logged "from" stale by one write, which is an audit-log imprecision,
  // not a correctness bug — restoreBrandLogoIfCleared above is the actual
  // guard against two writes racing on the same column.
  //
  // `.error` is checked (review round: it used to be dropped here, so a
  // query FAULT silently became `before = null` — indistinguishable from a
  // genuinely absent row, and `brandingChangePayload` would then report
  // every patched field as "changed" with a fabricated `from: null`). A
  // failed read is logged and passed through explicitly as `snapshotFailed`
  // rather than guessed at from the shape of `before` alone.
  const { data: beforeRow, error: beforeError } = await db.from("accounts")
    .select(Object.keys(patch).join(", ")).eq("id", accountId).maybeSingle();
  if (beforeError) {
    console.error(`setBranding: before-snapshot read failed for account ${accountId}: ${beforeError.message}`);
  }
  const before = beforeError ? null : (beforeRow as Record<string, string | null> | null);

  // `.select("id")` so the update reports WHICH rows it touched. Without it,
  // PostgREST returns no error and no rows for an account that does not exist,
  // which is indistinguishable from success -- and the caller would report a
  // save that changed nothing. Today an emit against a missing account_id
  // happens to fail the events foreign key and throw, but that is incidental:
  // events are audit data, and the day emitting becomes best-effort this goes
  // silent. Two milestones on this project have already lost work to a write
  // that reported success while matching nothing.
  const { data, error } = await db.from("accounts")
    .update(patch).eq("id", accountId).select("id");
  if (error) throw new Error(`setBranding failed: ${error.message}`);
  if (!data?.length) throw new Error(`setBranding: no account ${accountId}`);
  await emit(db, accountId, "account.branding_updated", actorId,
    brandingChangePayload(patch, before, Boolean(beforeError)));
}

/**
 * Reads one account's branding.
 *
 * A row that does not exist reads as unbranded rather than throwing: every
 * surface already falls back, and the public lead form calls this for an
 * anonymous visitor -- 500ing a customer's page over a missing account would
 * be a worse failure than showing them the form without a logo. A genuine
 * query fault still throws, per the milestone's fail-loud rule; callers on
 * customer-facing paths catch it and degrade to unbranded.
 *
 * Deliberately the opposite of setBranding above, which now throws when it
 * matches nothing. A read that finds nothing has a correct answer -- "not
 * branded". A write that changes nothing does not.
 */
export async function getBranding(
  db: SupabaseClient, accountId: string,
): Promise<Branding> {
  const { data, error } = await db.from("accounts")
    .select("brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode, reply_to_email")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getBranding failed: ${error.message}`);
  return {
    brandName: data?.brand_name ?? null,
    brandLogoPath: data?.brand_logo_path ?? null,
    brandColor: data?.brand_color ?? null,
    brandNeutral: data?.brand_neutral ?? null,
    brandCorners: data?.brand_corners ?? null,
    brandType: data?.brand_type ?? null,
    brandMode: data?.brand_mode ?? null,
    replyToEmail: data?.reply_to_email ?? null,
  };
}

/**
 * Reads one account's postal address (migration 0048), as stored: plain text,
 * possibly several lines, never trimmed here. Callers that judge "is it set"
 * trim it themselves, with `.trim()`, which strips exactly the whitespace the
 * column's CHECK strips.
 *
 * Its own read, NOT a field on `Branding`, deliberately: dozens of files
 * construct a `Branding`, and only the Branding panel and the reactivation
 * gate need this. (The due-lists get it from the shared per-account read in
 * `booking.ts`, not from here.)
 *
 * Same contract as getBranding: an account that does not exist reads as not
 * set, and a genuine query fault throws, because "not set" is an answer a
 * gate acts on and a failed query is not one.
 */
export async function getMailingAddress(
  db: SupabaseClient, accountId: string,
): Promise<string | null> {
  const { data, error } = await db.from("accounts")
    .select("mailing_address")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getMailingAddress failed: ${error.message}`);
  return (data as { mailing_address: string | null } | null)?.mailing_address ?? null;
}

/**
 * The company name a CUSTOMER may be shown — `brand_name`, trimmed, AND
 * NOTHING ELSE.
 *
 * THERE IS NO FALLBACK, deliberately. `accounts.name` is the agency's
 * internal label for the company ("Rio Roofing — trial") and it reached
 * customers three times while this resolver still took it as a second
 * argument. A parameter that carries the label is a parameter someone
 * passes; removing it is what makes the leak impossible rather than merely
 * discouraged.
 *
 * A blank result is unreachable through the product: `createAccount` seeds
 * `brand_name` (Add company asks for it as its own required field), the Branding save refuses to
 * blank it, go-live requires the branding step, and migration 0028 backfilled
 * the rows that predate all three.
 *
 * DELIBERATELY A SECOND COPY of `brandDisplayName` in
 * `apps/web/src/lib/email/templates/shell.ts`, and the only one allowed:
 * the data layer cannot import from the web app, and the web copy cannot
 * import from here without breaking every web test that mocks `@bis/db`
 * with a factory (vitest throws on an export the factory omits). The two are
 * pinned against each other in
 * `apps/web/src/lib/email/templates/brand-name-parity.test.ts`; change one,
 * and that test says so. Used by the automations due-lists so a due-row
 * carries the resolved `brandName` and never the internal label.
 */
export function brandDisplayName(branding: Branding): string {
  return branding.brandName?.trim() || "";
}
