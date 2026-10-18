import { cache } from "react";
import { serviceDb } from "@bis/db";
import { sharePage, type SharePage } from "@/lib/document-shares/public-share";
import { loggableError } from "@/lib/loggable-error";

/**
 * The page's one read, shared by `layout.tsx` (its `lang`), `page.tsx` and its `generateMetadata`
 * through React's `cache()` (the `/d` tree's shape: one read per request). `sharePage` proves the token
 * before anything else is read and carries the token row's own account into every later read; the
 * service client is the public tree's, outside `in-account-service-reads`' roots.
 */
export const loadPage = cache((token: string) => sharePage(serviceDb(), token, new Date()));

/**
 * The layout and the metadata read through THIS (`app/d/[token]/data.ts`'s `loadPageSafe`): a cached
 * rejection re-throws for every caller, and a throw from a layout or from `generateMetadata` escapes
 * every `error.tsx` to Next's bare shell. Only the page component's own call may throw. Never logs the
 * token; itself `cache()`d, so a failed read logs once per request.
 */
export const loadPageSafe = cache(async (token: string): Promise<SharePage | null> => {
  try {
    return await loadPage(token);
  } catch (e) {
    console.error(`shared file page: read failed: ${loggableError(e)}`);
    return null;
  }
});
