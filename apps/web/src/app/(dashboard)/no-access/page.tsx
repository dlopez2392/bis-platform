import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";

export default async function NoAccess({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const off = reason === "off";
  return (
    // The shell owns Ground and the card now. This page used to mount its own
    // of each — and so did the landing page, while /sign-in mounted neither.
    // Its inner glass card is GONE rather than nested: a card inside a card is
    // a fifth surface by another name (DESIGN.md rule 2). The block is
    // left-aligned for the same reason — the rail makes the card asymmetric,
    // and centred text in the right-hand column reads as a mistake.
    <AuthShell>
      <div className="flex flex-col items-start gap-3">
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
    </AuthShell>
  );
}
