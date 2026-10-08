"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

/**
 * D-021. On a phone the list and the open thread stacked in one scroll —
 * select a thread and the WHOLE list still sat above it, with nothing that
 * went back to just the list. Pure so the actual keydown wiring below is
 * one line (concierge-chat.tsx's `shouldCloseOnKey` pattern).
 *
 * Guarded against an editable element: Esc while the operator is mid-draft
 * in the composer's Textarea (or the subject Input) must finish its normal
 * job — cancelling, say, a browser autocomplete suggestion — not navigate
 * off the thread and silently drop what they were writing.
 */
export function shouldGoBackOnEscape(key: string, activeTag: string | null | undefined): boolean {
  return key === "Escape" && activeTag !== "TEXTAREA" && activeTag !== "INPUT";
}

/**
 * The visible Back link AND the Esc listener, together: both return to the
 * same `base` (the conversations path with no `?c=`), which is what clears
 * `active` in page.tsx and renders the list again.
 *
 * `lg:hidden`: at `lg` and up both panes already show side by side (the
 * grid this sits beside stacks only below `lg`), so a Back link there would
 * duplicate a selection the list right next to it already shows.
 */
export function ConversationBack({ base }: { base: string }) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (shouldGoBackOnEscape(e.key, document.activeElement?.tagName)) {
        router.push(base);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [base, router]);

  return (
    <Link
      href={base}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "lg:hidden")}
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {m["nav.conversations"]}
    </Link>
  );
}
