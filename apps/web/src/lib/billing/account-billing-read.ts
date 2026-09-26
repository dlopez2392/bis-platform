import { cache } from "react";
import { getAccountBilling, type AccountBilling } from "@bis/db";
import { dbForRequest } from "@/lib/db";

/**
 * The account's billing row for THIS request, read once.
 *
 * The account layout reads it on every page for the payment-failed banner
 * (G21), and the client's Billing page needs the same row on the same
 * navigation. `cache()` makes that one query instead of two, and it only
 * dedupes callers of this exact binding (React keys the memo on the wrapped
 * function's identity, `tenant-theme-reader.ts`'s note), so every in-account
 * reader of the row goes through here, never `getAccountBilling` directly.
 *
 * On the signed-in caller's RLS client (0051: the agency and the account's
 * own client may read it), never serviceDb: the database backstop stands
 * behind the caller's `requireAccountAccess`, which must already have run.
 * A failure rejects; each caller decides what that means (the layout fails
 * soft, the page reaches the error boundary).
 */
export const readAccountBilling = cache(async (accountId: string): Promise<AccountBilling | null> =>
  getAccountBilling(await dbForRequest(), accountId));
