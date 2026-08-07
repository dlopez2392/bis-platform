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
