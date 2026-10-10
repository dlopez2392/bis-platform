import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import { NO_PREFS, readPersonPrefs, serviceDb, type PersonPrefs } from "@bis/db";
import { getTenantAccessState } from "@/lib/branding/tenant-theme-reader";
import { loggableError } from "@/lib/loggable-error";
import { readStoredPerson, STORED_READ_FAILED, type StoredPerson } from "@/lib/team/ensure-role";

/**
 * A person's own language and theme (F-096, mis preferencias), read once per
 * request (spec 5.1). The owner's rule: a person's own choice wins for
 * everyone; with no choice, the agency gets English and a client gets the
 * account's language (requestLocale draws that default, not this module).
 *
 * - Signed out: nothing is read.
 * - A client whose account resolves "ok": the SAME cache entry
 *   requireAccountAccess's readStoredRole derives from (one memberships ⋈
 *   users read carries role, language and theme), so no extra query on the
 *   hot path. cache() keys on argument count as well as values, so this
 *   calls readStoredPerson with exactly (accountId, clerkUserId), as
 *   readStoredRole does (pinned in person-prefs.test.ts).
 * - A client with a users row but no membership yet: that joined read finds
 *   nothing, so the users row is read instead.
 * - The agency: its users row (it never has a membership).
 */
export type AccessState = Awaited<ReturnType<typeof import("@/lib/auth").resolveClientAccessState>>;

type Deps = {
  userId: string | null;
  state: () => Promise<AccessState>;
  readStored: (accountId: string, clerkUserId: string) => Promise<StoredPerson>;
  readUser: (clerkUserId: string) => Promise<PersonPrefs | null>;
};

/** The strict core: rejects on any failed read. loadMyPreferences uses it directly. */
export async function readPersonPrefsOrThrowWith(deps: Deps): Promise<PersonPrefs> {
  if (!deps.userId) return NO_PREFS;
  const state = await deps.state();
  if (state.status === "agency") return (await deps.readUser(deps.userId)) ?? NO_PREFS;
  // "off" and "none" are redirected by the layouts before anything renders.
  if (state.status !== "ok") return NO_PREFS;
  const stored = await deps.readStored(state.id, deps.userId);
  if (stored === STORED_READ_FAILED) throw new Error("the stored-person read failed");
  if (stored) return stored.prefs;
  return (await deps.readUser(deps.userId)) ?? NO_PREFS;
}

/** Never rejects: a failed read of any kind means defaults (spec 5.1). */
export async function resolvePersonPrefsWith(deps: Deps): Promise<PersonPrefs> {
  try {
    return await readPersonPrefsOrThrowWith(deps);
  } catch (e) {
    unstable_rethrow(e);
    console.error(`person-prefs: read failed: ${loggableError(e)}`);
    return NO_PREFS;
  }
}

/**
 * serviceDb() for the users read is the pre-trust read auth.ts's rule allows:
 * it runs in the same request phase as requireAccountAccess and is keyed on
 * Clerk's own userId, never on anything from the browser.
 */
function liveDeps(userId: string | null): Deps {
  return {
    userId, state: getTenantAccessState, readStored: readStoredPerson,
    readUser: (id) => readPersonPrefs(serviceDb(), id),
  };
}

/** React cache()d per request: every layout and page calls it with no arguments. */
export const getPersonPrefs = cache(async (): Promise<PersonPrefs> => {
  try {
    const { userId } = await auth();
    return await resolvePersonPrefsWith(liveDeps(userId ?? null));
  } catch (e) {
    unstable_rethrow(e);
    console.error(`person-prefs: read failed: ${loggableError(e)}`);
    return NO_PREFS;
  }
});

/** For /dashboard/preferences only: THROWS on a failed read, so the page shows its error state instead of defaults. */
export async function loadMyPreferences(): Promise<PersonPrefs> {
  const { userId } = await auth();
  return readPersonPrefsOrThrowWith(liveDeps(userId ?? null));
}
