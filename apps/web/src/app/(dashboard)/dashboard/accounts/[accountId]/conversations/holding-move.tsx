"use client";
// S-47e (E8, spec 5.12.5): the holding thread's "Move to…" (ghost: the thread's one primary stays Send,
// DESIGN.md rule 8). The real contacts on the number first, then "Find another customer".
//
// Deviation from the brief's literal snippet (reported): the brief's effect called `setHits`/`setFailed`/
// `setSearching` SYNCHRONOUSLY in the effect body's own early-return branch, which this repo's
// `react-hooks/set-state-in-effect` lint rule flags as an ERROR (confirmed by `eslint` on this file).
// `add-relationship-dialog.tsx`'s own search effect (the brief's named "pattern") already avoids exactly
// this shape — `searching` is set by the INPUT's onChange, never inside the effect, and the effect's own
// early return calls no setState at all. Restructured to that proven idiom; the externally observable
// behaviour (debounce 250ms, skeleton while searching, "no customers match"/"couldn't search" states,
// moving a contact) is unchanged.
//
// T17 design review: the portaled menu carries lang (I-1); the empty search says how to go on (I-4); the
// skeleton is shaped like the results (M-2); a hit shows its phone beside a truncating name and "no name" in the
// reader's language (M-3); the dialog has a description (M-4); "Find a customer" when nobody else is on the number
// (M-7); closing the dialog hands focus back to "Move to…" (M-9). The results are their own component so they
// render in a test.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/messages";
import { formatPhone } from "@/lib/document-requests/customer-state";
import { HighlightedText } from "@/components/highlighted-text";
import { nameRanges, phoneRanges } from "@/lib/contacts/search-highlight";
import { moveHoldingThreadAction, undoMoveHoldingThreadAction } from "./actions";
import { searchRelatableContactsAction, type RelatableHit } from "../contacts/relationship-actions";
import { moveAndToast } from "./holding-move-handlers";

type Answer = { term: string; hits: RelatableHit[] | "failed" };

/** "Find another customer" beside the people on the number; "Find a customer" when there are none (M-7). */
export function moveOtherKey(peopleCount: number): MessageKey {
  return peopleCount > 0 ? "conversation.holding.moveOther" : "conversation.holding.findCustomer";
}

/** What the search shows: rows of skeleton while it runs, its failure, nobody, or the people found. `query`:
 *  F-092 part 1 (plan Task 10) — the term these hits answered, so the matched letters/digits can be set apart
 *  (never a query typed since: the caller only ever passes hits once `answer.term === term`, so this is always
 *  the exact term that produced them). */
export function HoldingFindResults({ pending, failed, hits, busy, query, onPick, tr }: {
  pending: boolean; failed: boolean; hits: RelatableHit[] | null; busy: boolean; query: string;
  onPick: (contactId: string) => void; tr: Tr;
}) {
  if (pending) {
    return (
      <div className="space-y-1">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full rounded-[var(--radius-ctl)]" />)}
      </div>
    );
  }
  if (failed) return <p role="alert" className="text-sm text-[var(--crit)]">{tr.text("conversation.holding.findFailed")}</p>;
  if (hits === null) return null;
  if (hits.length === 0) return <p className="text-sm text-muted-foreground">{tr.text("conversation.holding.findNone")}</p>;
  return (
    <ul className="space-y-1">
      {hits.map((h) => {
        const given = [h.firstName, h.lastName].filter(Boolean).join(" ");
        const name = given || tr.text("contact.noName");
        const phone = h.phone ? formatPhone(h.phone) : null;
        return (
          <li key={h.id}>
            <Button variant="ghost" className="w-full min-w-0 justify-start" disabled={busy} onClick={() => onPick(h.id)}>
              <span className="min-w-0 truncate"><HighlightedText text={name} ranges={given ? nameRanges(name, query) : []} /></span>
              {phone ? <span className="shrink-0 tabular-nums text-muted-foreground"><HighlightedText text={phone} ranges={phoneRanges(phone, query)} /></span> : null}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function HoldingMove({ accountId, conversationId, holdingContactId, people, locale, pseudo = false }: {
  accountId: string; conversationId: string; holdingContactId: string;
  /** The real contacts on the number, by name (holding records already out). */
  people: { id: string; name: string }[];
  locale: Locale;
  /** The QA pseudo-locale (requestPseudoMode). */
  pseudo?: boolean;
}) {
  const tr = makeTr(locale, pseudo);
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const open = (id: string) => router.push(`/dashboard/accounts/${accountId}/conversations?c=${id}`);
  const moveTo = async (contactId: string) => {
    setBusy(true);
    await moveAndToast({
      move: () => moveHoldingThreadAction(accountId, locale, conversationId, contactId),
      undo: (u) => undoMoveHoldingThreadAction(accountId, u),
      toast, tr, open,
    });
    setBusy(false);
    setFinding(false);
  };
  useEffect(() => {
    if (!searching) return;
    let stale = false;
    const timer = setTimeout(() => {
      void searchRelatableContactsAction(accountId, holdingContactId, term)
        .catch(() => ({ ok: false as const }))
        .then((r) => {
          if (stale) return;
          setAnswer({ term, hits: r.ok ? r.hits : "failed" });
          setSearching(false);
        });
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [accountId, holdingContactId, searching, term]);
  const tooShort = [...term.trim()].length < 2;
  const current = !tooShort && answer?.term === term ? answer : null;
  const hits = current && current.hits !== "failed" ? current.hits : null;
  const failed = current?.hits === "failed";
  return (
    <div lang={locale}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef} variant="ghost" size="sm" disabled={busy} data-holding-move=""
          >
            {tr.text("conversation.holding.move")}
          </Button>
        </DropdownMenuTrigger>
        {/* Portaled: the wrapper's lang does not reach it (I-1). */}
        <DropdownMenuContent align="end" lang={locale}>
          {people.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => { void moveTo(p.id); }}>
              <span className="min-w-0 truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          {people.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => setFinding(true)}>{tr.text(moveOtherKey(people.length))}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={finding} onOpenChange={(o) => { setFinding(o); if (!o) { setTerm(""); setAnswer(null); } }}>
        <DialogContent lang={locale} onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>{tr.text(moveOtherKey(people.length))}</DialogTitle>
            <DialogDescription>{tr.text("conversation.holding.findHint")}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="holding-find">{tr.text("conversation.holding.findLabel")}</Label>
          <Input
            id="holding-find" value={term} autoComplete="off"
            onChange={(e) => {
              const v = e.target.value;
              setTerm(v);
              setSearching([...v.trim()].length >= 2);
            }}
          />
          <HoldingFindResults
            pending={searching && !tooShort} failed={failed} hits={hits} busy={busy} query={term}
            onPick={(id) => { void moveTo(id); }} tr={tr}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
