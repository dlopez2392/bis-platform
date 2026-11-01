import { headers } from "next/headers";
import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { localeFromAcceptLanguage } from "@/lib/i18n/accept-language";

export default async function NoAccess({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const off = reason === "off";
  // S-10 T7 (spec §7 Q5): /no-access is part of the signed-out/no-access
  // family — the browser's own language, same reasoning as "/" and
  // /sign-in.
  const locale = localeFromAcceptLanguage((await headers()).get("accept-language"));
  return (
    // The shell owns Ground and the card now. This page used to mount its own
    // of each — and so did the landing page, while /sign-in mounted neither.
    // Its inner glass card is GONE rather than nested: a card inside a card is
    // a fifth surface by another name (DESIGN.md rule 2). The block is
    // left-aligned for the same reason — the rail makes the card asymmetric,
    // and centred text in the right-hand column reads as a mistake.
    <AuthShell locale={locale}>
      <div className="flex flex-col items-start gap-3">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          {off ? t(m, "clientAccess.off.title", locale) : t(m, "clientAccess.none.title", locale)}
        </p>
        <p className="text-sm text-muted-foreground">
          {off ? t(m, "clientAccess.off.body", locale) : t(m, "clientAccess.none.body", locale)}
        </p>
        <SignOutButton>
          <Button variant="outline">{t(m, "landing.signOut", locale)}</Button>
        </SignOutButton>
      </div>
    </AuthShell>
  );
}
