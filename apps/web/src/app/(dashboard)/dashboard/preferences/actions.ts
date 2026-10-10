"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serviceDb, type PersonLanguage, type PersonTheme, type PersonProfile } from "@bis/db";
import { saveMyPreferenceWith, type PrefsResult } from "@/lib/preferences/save";
import { loggableError } from "@/lib/loggable-error";

/**
 * Mis preferencias (F-096, spec §7): a person's own language and theme.
 *
 * NO person id parameter, by design — `auth()` is the only source of the
 * row these actions touch, so nothing a form or a caller passes can redirect
 * the write to someone else's row (global-constraints.md: "the actions
 * write ONLY the caller's own users row, keyed on the authenticated Clerk
 * userId from auth(), never on a value from the browser"). `saveMyPreferenceWith`
 * validates against the closed list BEFORE `serviceDb()` is ever touched.
 *
 * `currentUser()` runs only on a first-ever save (no `users` row yet) to get
 * the email `savePersonPreference` needs to create one; it reads the
 * signed-in person's OWN Clerk record, never another person's.
 */

export async function setMyThemeAction(theme: string | null): Promise<PrefsResult<PersonTheme>> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const r = await saveMyPreferenceWith({ userId, db: serviceDb, profile: clerkProfile }, "theme", theme);
  if (r.ok) revalidatePath("/dashboard", "layout");
  return r;
}

export async function setMyLanguageAction(language: string | null): Promise<PrefsResult<PersonLanguage>> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const r = await saveMyPreferenceWith({ userId, db: serviceDb, profile: clerkProfile }, "language", language);
  if (r.ok) revalidatePath("/dashboard", "layout");
  return r;
}

async function clerkProfile(): Promise<PersonProfile | null> {
  try {
    const u = await currentUser();
    const email = u?.primaryEmailAddress?.emailAddress;
    return email ? { email, name: u?.fullName ?? null } : null;
  } catch (e) {
    console.error(`preferences: Clerk profile unavailable: ${loggableError(e)}`);
    return null;
  }
}
