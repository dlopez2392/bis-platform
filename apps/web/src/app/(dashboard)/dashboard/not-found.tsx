"use client";

// A client component (S-10) only to read the locale the dashboard layout's
// LocaleProvider already resolved; it has no data of its own.
import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";

export default function DashboardNotFound() {
  const locale = useLocale();
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        icon={SearchX}
        title={t(m, "notFound.title", locale)}
        body={t(m, "notFound.body", locale)}
        action={
          <Button variant="outline" asChild>
            <Link href="/dashboard">{t(m, "notFound.back", locale)}</Link>
          </Button>
        }
      />
    </div>
  );
}
