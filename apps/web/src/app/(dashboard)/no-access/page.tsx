import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

export default async function NoAccess({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const off = reason === "off";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-8">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          {off ? m["clientAccess.off.title"] : m["clientAccess.none.title"]}
        </p>
        <p className="text-sm text-muted-foreground">
          {off ? m["clientAccess.off.body"] : m["clientAccess.none.body"]}
        </p>
        <SignOutButton>
          <Button variant="outline">{m["landing.signOut"]}</Button>
        </SignOutButton>
      </div>
    </main>
  );
}
