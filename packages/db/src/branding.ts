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
  if (Object.keys(patch).length === 0) return;

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
  await emit(db, accountId, "account.branding_updated", actorId, {});
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
 * `brand_name` from the name given at creation, the Branding save refuses to
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
