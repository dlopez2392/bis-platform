import { cache } from "react";
import { serviceDb } from "@bis/db";
import { customerPage, type CustomerPage } from "@/lib/document-requests/customer-upload";
import { loggableError } from "@/lib/loggable-error";

/**
 * The page's one read, shared by `layout.tsx` (its `lang`), `page.tsx` and its `generateMetadata`:
 * React's `cache()` dedupes the three to ONE read per request as long as they call this same function
 * with the same token (the `/f` tree's `loadForm`). `customerPage` proves the token before any other
 * read and carries the request's own account into every later one; the service client is the public
 * tree's, outside `in-account-service-reads`' roots.
 */
export const loadPage = cache((token: string) => customerPage(serviceDb(), token, new Date()));

/**
 * The layout and the metadata read through THIS (plan review I8; `app/f/[publicId]/data.ts`'s
 * `loadFormSafe`): a cached rejection re-throws for every caller, and a throw from a layout or from
 * `generateMetadata` escapes every `error.tsx` to Next's bare shell. Only the page component's own call
 * may throw; `error.tsx` catches it inside the shell this keeps standing. Never logs the token.
 */
export async function loadPageSafe(token: string): Promise<CustomerPage | null> {
  try {
    return await loadPage(token);
  } catch (e) {
    console.error(`customer documents page: read failed: ${loggableError(e)}`);
    return null;
  }
}
