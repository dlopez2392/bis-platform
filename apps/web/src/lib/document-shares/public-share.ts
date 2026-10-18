import {
  findDocumentShareByTokenHash, documentShareState, getShareTarget, claimDocumentShareDownload, signedDocumentReadUrl,
  getBranding, brandLogoUrl, listPhoneNumbersForAccount,
  type Branding, type DocumentContentType, type DocumentShareRow, type ShareTarget, type SupabaseClient,
} from "@bis/db";
import { isTokenShape, tokenHash } from "@/lib/document-requests/token";
import { formatPhone } from "@/lib/document-requests/customer-state";
import { extensionForType, formatMb } from "@/lib/documents/rules";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/forms/guards";
import { loggableError } from "@/lib/loggable-error";

/**
 * The public rule for a share link (study 3.4; spec 4.2): the token is proven FIRST on every request
 * (its shape, then a lookup by its sha256, then open: not revoked, not expired, the document not
 * trashed, the shared version ready and clean), and every later read carries the TOKEN ROW's account,
 * document and version. The browser sends nothing else. Every refused download is the same answer
 * (plan deviation 6); the page states differ only for a real token's holder. Logs name the share id,
 * never the token. The client is the CALLER's (the route's or the page's); this file names none of its
 * own. The one mint is signedDocumentReadUrl, 2a's gate.
 */
export const SHARE_URL_SECONDS = 120;
/** Ruling O3: a link is downloaded at most this many times in all, from any address (0085's p_link_max; past it the claim answers closed). */
export const SHARE_LINK_MAX_DOWNLOADS = 100;
export type ShareState = "open" | "expired" | "revoked" | "trashed" | "removed" | "not_found";
export type ResolvedShare =
  | { state: Exclude<ShareState, "not_found">; share: DocumentShareRow; target: ShareTarget }
  | { state: "not_found" };

export async function resolveShare(db: SupabaseClient, token: string, now: Date): Promise<ResolvedShare> {
  if (!isTokenShape(token)) return { state: "not_found" };
  const share = await findDocumentShareByTokenHash(db, tokenHash(token));
  if (!share) return { state: "not_found" };
  const target = await getShareTarget(db, share);
  if (!target) return { state: "not_found" };
  const life = documentShareState(share, now);
  if (life !== "open") return { state: life, share, target };
  if (target.document.deleted_at !== null) return { state: "trashed", share, target };
  if (target.version.status !== "ready" || target.version.scan_status !== "clean") return { state: "removed", share, target };
  return { state: "open", share, target };
}

export const shareFileName = (title: string, contentType: DocumentContentType): string => `${title}.${extensionForType(contentType)}`;
/** Under a megabyte reads in KB (never "0 MB"); the rest as the vault's own MB words. */
export function shareSize(bytes: number, language: "en" | "es"): string {
  return bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : formatMb(bytes, language);
}

export type SharePage = {
  state: ShareState; language: "en" | "es"; branding: Branding | null; logoUrl: string | null; phone: string | null;
  file: { title: string; type: string; size: string } | null;
};
const NOT_FOUND_PAGE: SharePage = { state: "not_found", language: "en", branding: null, logoUrl: null, phone: null, file: null };

/** Decorative reads (the /d page's rule): a blip never costs the visitor the page; logged by share id. */
async function accountLanguage(db: SupabaseClient, accountId: string, shareId: string): Promise<"en" | "es"> {
  try {
    const { data, error } = await db.from("accounts").select("language").eq("id", accountId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { language: string | null } | null)?.language === "es" ? "es" : "en";
  } catch (e) {
    console.error(`document share ${shareId}: language unreadable: ${loggableError(e)}`);
    return "en";
  }
}
async function brandingOf(db: SupabaseClient, accountId: string, shareId: string): Promise<Branding | null> {
  try {
    return await getBranding(db, accountId);
  } catch (e) {
    console.error(`document share ${shareId}: branding unreadable: ${loggableError(e)}`);
    return null;
  }
}
async function livePhone(db: SupabaseClient, accountId: string, shareId: string): Promise<string | null> {
  try {
    const live = (await listPhoneNumbersForAccount(db, accountId)).find((p) => p.status === "live");
    return live ? formatPhone(live.e164) : null;
  } catch (e) {
    console.error(`document share ${shareId}: phone number unreadable: ${loggableError(e)}`);
    return null;
  }
}

/** The page's whole read (spec 4.2). A refusal page still names the business and its phone; an unknown token reads nothing more. */
export async function sharePage(db: SupabaseClient, token: string, now: Date): Promise<SharePage> {
  const r = await resolveShare(db, token, now);
  if (r.state === "not_found") return NOT_FOUND_PAGE;
  const accountId = r.share.account_id;
  const [language, branding, phone] = await Promise.all([
    accountLanguage(db, accountId, r.share.id), brandingOf(db, accountId, r.share.id), livePhone(db, accountId, r.share.id),
  ]);
  return {
    state: r.state, language, branding, phone,
    logoUrl: branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null,
    file: r.state === "open" ? {
      title: r.target.document.title,
      type: extensionForType(r.target.version.content_type).toUpperCase(),
      size: shareSize(r.target.version.bytes, language),
    } : null,
  };
}

export type RouteAnswer = { status: number; body: Record<string, unknown> };
const unavailable = (): RouteAnswer => ({ status: 410, body: { error: "unavailable" } });

/**
 * The Download (spec 4.2, 4.3): re-proves the token, claims the download (0085: re-proved open and
 * clean under the share's lock, the forms limiter's numbers per link and address, the link's total cap,
 * the first open exactly once), then mints a 120 s URL for the SHARED version (the token row's
 * version_id, never the document's current one) through the one gate. Counted before the mint (plan
 * deviation 5). Only the per-address window answers 429; the link's cap is `closed`, the same 410 as
 * every other refusal.
 */
export async function shareDownload(db: SupabaseClient, token: string, ipHash: string, now: Date): Promise<RouteAnswer> {
  let shareId = "unknown";
  try {
    const r = await resolveShare(db, token, now);
    if (r.state !== "open") return unavailable();
    shareId = r.share.id;
    const claim = await claimDocumentShareDownload(db, {
      accountId: r.share.account_id, shareId: r.share.id, ipHash, max: RATE_LIMIT_MAX, windowSeconds: RATE_LIMIT_WINDOW_MS / 1000,
      linkMax: SHARE_LINK_MAX_DOWNLOADS,
    });
    if (claim.status === "rate_limited") return { status: 429, body: { error: "rate_limited" } };
    if (claim.status !== "ok") return unavailable();
    // Review F7: the one moment the timeline gains its "opened" row; ids only, never the token or the title.
    if (claim.first) console.info(`document share ${r.share.id}: first opened`);
    const signed = await signedDocumentReadUrl(db, r.share.account_id, r.share.version_id, {
      seconds: SHARE_URL_SECONDS, download: shareFileName(r.target.document.title, r.target.version.content_type),
    });
    if (signed.status !== "ok") {
      // Deviation 5's residual: the claim already counted this download (and maybe the first open). Ids only.
      console.error(`document share ${r.share.id}: claimed but not minted (${signed.status})`);
      return unavailable();
    }
    return { status: 200, body: { url: signed.url } };
  } catch (e) {
    console.error(`document share ${shareId}: download failed: ${loggableError(e)}`);
    return { status: 503, body: { error: "failed" } };
  }
}
