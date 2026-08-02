import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { resolveClientAccount, type AppClaims } from "@/lib/auth";

export default async function Home() {
  const { userId, sessionClaims } = await auth();
  const claims = sessionClaims as AppClaims | null;
  const hasAccess = claims?.app_role === "agency_admin";

  const clientAccount = await resolveClientAccount();
  if (clientAccount) redirect(`/dashboard/accounts/${clientAccount.id}/dashboard`);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        {m["landing.title"]}
      </h1>
      <p className="max-w-md text-balance text-muted-foreground">{m["landing.tagline"]}</p>

      {!userId ? (
        <Button asChild size="lg">
          <Link href="/dashboard">{m["landing.signIn"]}</Link>
        </Button>
      ) : hasAccess ? (
        <Button asChild size="lg">
          <Link href="/dashboard">{m["landing.goToDashboard"]}</Link>
        </Button>
      ) : (
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-8">
          <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">{m["landing.noAccess.title"]}</p>
          <p className="text-sm text-muted-foreground">{m["landing.noAccess.body"]}</p>
          <SignOutButton>
            <Button variant="outline">{m["landing.signOut"]}</Button>
          </SignOutButton>
        </div>
      )}
    </main>
  );
}
