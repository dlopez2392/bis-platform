"use client";

import { useEffect, useRef } from "react";
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
 * Guarded against an editable element (Textarea, Input, Select, or any
 * contentEditable region): Esc while the operator is mid-draft must finish
 * its normal job — cancelling a browser autocomplete suggestion, say — not
 * navigate off the thread and silently drop what they were writing.
 * `defaultPrevented` and `isComposing` are the same two guards: a keydown
 * some other handler already acted on, or one that is really an IME
 * composition's own Escape (closing a candidate window), is not a request
 * to leave the thread.
 *
 * Does NOT decide whether the Back link is even on screen — `lg` and up
 * shows both panes side by side, where Esc has no "back" to go to. That
 * check needs the real DOM (the link's own `lg:hidden` box) and lives in
 * the effect below, not here.
 */
export function shouldGoBackOnEscape(
  event: { key: string; defaultPrevented: boolean; isComposing: boolean },
  active: { tagName: string | null | undefined; isContentEditable: boolean },
): boolean {
  if (event.key !== "Escape") return false;
  if (event.defaultPrevented || event.isComposing) return false;
  if (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.tagName === "SELECT") return false;
  if (active.isContentEditable) return false;
  return true;
}

/**
 * The visible Back link AND the Esc listener, together: both return to
 * `base` — WITH the current `before` cursor carried along, when there is
 * one (review fix: DESIGN.md's "Selection survives a page change" — Back
 * from a thread opened off page 2 of the inbox must return to page 2, not
 * silently reset to page one, which `base` alone always means).
 *
 * `lg:hidden`: at `lg` and up both panes already show side by side (the
 * grid this sits beside stacks only below `lg`), so a Back link there would
 * duplicate a selection the list right next to it already shows.
 */
export function ConversationBack({ base, before }: { base: string; before?: string }) {
  const router = useRouter();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const href = before ? `${base}?${new URLSearchParams({ before })}` : base;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Only while the Back link is actually ON SCREEN. It carries
      // `lg:hidden`, so at `lg` and up this element has no box at all
      // (`offsetParent` reads null for any element with no rendered box,
      // same test the DOM itself uses for "is this element displayed") —
      // and Esc has nowhere to "go back" to when both panes already show.
      if (!linkRef.current || linkRef.current.offsetParent === null) return;
      const activeEl = document.activeElement;
      const decided = shouldGoBackOnEscape(
        { key: e.key, defaultPrevented: e.defaultPrevented, isComposing: e.isComposing },
        {
          tagName: activeEl?.tagName,
          isContentEditable: activeEl instanceof HTMLElement && activeEl.isContentEditable,
        },
      );
      if (decided) router.push(href);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [href, router]);

  return (
    <Link
      ref={linkRef}
      href={href}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "lg:hidden")}
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {m["nav.conversations"]}
    </Link>
  );
}
