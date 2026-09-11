import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";
import { resolveClientAccount, type AppClaims } from "@/lib/auth";

export default async function Home() {
  const { userId, sessionClaims } = await auth();
  const claims = sessionClaims as AppClaims | null;
  const hasAccess = claims?.app_role === "agency_admin";

  const clientAccount = await resolveClientAccount();
  if (clientAccount) redirect(`/dashboard/accounts/${clientAccount.id}/dashboard`);

  // Ground and the card belong to AuthShell now; this page used to mount its
  // own of each. Copy is untouched — only the frame around it changed.
  return (
    <AuthShell>
      {/* Title and tagline sit OUTSIDE the branch, exactly as they did before:
          in the old file they were unconditional siblings of the three-armed
          ternary, so they rendered above the no-access card too. Nesting them
          in the else-arm silently drops both for a signed-in non-agency user —
          a real, reachable state that no test in this repo exercises, since
          nothing signs in at `/`. Copy is unchanged by this work. */}
      <h1 className="font-display text-4xl font-[650] tracking-[-0.01em] text-foreground">
        {m["landing.title"]}
      </h1>
      <p className="max-w-md text-balance text-muted-foreground">{m["landing.tagline"]}</p>

      {userId && !hasAccess ? (
        <div className="flex flex-col items-start gap-3">
          <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">{m["landing.noAccess.title"]}</p>
          <p className="text-sm text-muted-foreground">{m["landing.noAccess.body"]}</p>
          <SignOutButton>
            <Button variant="outline">{m["landing.signOut"]}</Button>
          </SignOutButton>
        </div>
      ) : (
        <Button asChild size="lg" className="self-start">
          <Link href="/dashboard">
            {userId ? m["landing.goToDashboard"] : m["landing.signIn"]}
          </Link>
        </Button>
      )}
    </AuthShell>
  );
}
