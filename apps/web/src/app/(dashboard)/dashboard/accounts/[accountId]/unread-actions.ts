"use server";

import { serviceDb, sumUnreadCount } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";

/**
 * The sidebar's Conversations badge (app-sidebar.tsx, "use client") calls
 * this directly from a useEffect keyed on the active account id — there is
 * no form here, so this isn't bound via `<form action={...}>` the way every
 * sibling actions.ts file in this tree is used; a plain imperative call is
 * an equally supported way to invoke a Server Action from a client
 * component, and the only one that fits a background badge read.
 *
 * dashboard/layout.tsx (the shared chrome AppSidebar renders from) sits
 * ABOVE dashboard/accounts/[accountId] in the route tree and — contrary to
 * an earlier version of this wiring — never receives accountId via its own
 * `params`: ancestor layouts only get the params for segments up to and
 * including themselves. So the account-scoped read has to happen from
 * inside this [accountId] segment, as a client-callable action, not from
 * the layout that draws the sidebar.
 *
 * requireAccountAccess, not requireAgencyOnlyAccountAccess: Conversations
 * is a both-audience item (see nav-groups.ts) — a client reads their own
 * unread count same as the agency does.
 *
 * serviceDb(), not dbForRequest(): this is a read behind requireAccountAccess,
 * not a write behind a grant boundary (contrast calendar/actions.ts's choice
 * for the same two options, on a write) — the guard above is what stands
 * behind it, same as listAccounts elsewhere in this tree.
 *
 * The sumUnreadCount call, specifically, is caught and folded to 0: a badge
 * must never take the shell down with it. console.error keeps a real outage
 * visible in logs, the same best-effort shape as createMessage's
 * conversation touch in packages/db/src/messaging.ts. requireAccountAccess
 * itself is deliberately NOT inside this try — it can redirect() on an
 * unauthorized or stale account id, and Next's redirect works by throwing;
 * catching it here would swallow that throw and silently strand the caller
 * instead of sending them where every other guarded surface in this tree
 * already would.
 */
export async function getUnreadTotal(accountId: string): Promise<number> {
  await requireAccountAccess(accountId);
  try {
    return await sumUnreadCount(serviceDb(), accountId);
  } catch (error) {
    console.error(
      `getUnreadTotal failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}
