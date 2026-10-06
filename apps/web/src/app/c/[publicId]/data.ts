import { cache } from "react";
import {
  serviceDb, getVoiceProfileAnyStatusByPublicId, getBranding,
  type ConciergeProfileAnyStatus, type Branding,
} from "@bis/db";

/**
 * Shared by `layout.tsx` (lang + not-found branding) and `page.tsx`
 * (content + the live/not-found decision) — React's `cache()` dedupes this
 * to ONE query per request as long as both call the SAME function reference
 * with the same `publicId`. Mirrors `app/f/[publicId]/data.ts`'s split.
 *
 * Unlike the old `getVoiceProfileByPublicId`-backed loader, this returns a
 * profile whose concierge is off, or has no destination form — the layout
 * needs the row's own `account_id` and `languages` for a not-found page
 * EVEN then. `page.tsx` applies `isConciergeLive` itself before deciding
 * whether to render or call `notFound()`.
 */
export const loadProfile = cache(
  (publicId: string) => getVoiceProfileAnyStatusByPublicId(serviceDb(), publicId),
);

/** The profile's own default language — known even while the concierge is
 *  off, so a not-found page can be correctly `lang`-tagged instead of
 *  defaulting to English just because the widget is not live.
 *
 *  Same `"both"` → `"en"` fallback `page.tsx` has always used — not this
 *  task's call to revisit. */
export function profileLangDefault(profile: ConciergeProfileAnyStatus | null): "en" | "es" {
  return profile?.languages === "es" ? "es" : "en";
}

/** Shared `cache()`'d branding reader — same split and the same null-on-
 *  failure reasoning as `app/f/[publicId]/data.ts`'s `loadFormBranding`. */
export const loadProfileBranding = cache(async (accountId: string, publicId: string) => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`concierge ${publicId}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
});

export const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
