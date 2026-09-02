import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import type { StepDetailProps } from "./step-shared";

export function BrandingStep({ kind, href }: StepDetailProps): React.ReactNode {
  const rows: React.ReactNode[] = [];

  // A finished step keeps its door — the agency still edits branding and
  // hours long after setup — but it stops shouting: ghost rather than
  // outline, so the eye lands on the step that still needs doing.
  if (href) {
    rows.push(
      <Link
        key="open"
        href={href}
        className={cn(
          buttonVariants({ variant: kind === "done" ? "ghost" : "outline", size: "sm" }),
        )}
      >
        {m["setup.openStep"]}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>,
    );
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">{rows}</div>
    </div>
  );
}
