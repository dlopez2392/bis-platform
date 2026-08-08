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

/** What a surface needs to wear a company's brand. Both null = not branded. */
export type Branding = {
  brandName: string | null;
  brandLogoPath: string | null;
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
  input: { brandName?: string | null; brandLogoPath?: string | null },
  actorId: string,
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if (input.brandName !== undefined) patch.brand_name = input.brandName;
  if (input.brandLogoPath !== undefined) patch.brand_logo_path = input.brandLogoPath;
  if (Object.keys(patch).length === 0) return;

  const { error } = await db.from("accounts").update(patch).eq("id", accountId);
  if (error) throw new Error(`setBranding failed: ${error.message}`);
  await emit(db, accountId, "account.branding_updated", actorId, {});
}

/**
 * Reads one account's branding.
 *
 * A row that does not exist reads as unbranded rather than throwing: every
 * surface already falls back, and the public lead form calls this for an
 * anonymous visitor -- 500ing a customer's page over a missing account would
 * be a worse failure than showing them the form without a logo. A genuine
 * query fault still throws, per the milestone's fail-loud rule.
 */
export async function getBranding(
  db: SupabaseClient, accountId: string,
): Promise<Branding> {
  const { data, error } = await db.from("accounts")
    .select("brand_name, brand_logo_path").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getBranding failed: ${error.message}`);
  return {
    brandName: data?.brand_name ?? null,
    brandLogoPath: data?.brand_logo_path ?? null,
  };
}
