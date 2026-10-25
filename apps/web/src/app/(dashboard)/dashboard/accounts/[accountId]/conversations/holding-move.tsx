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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { makeTr } from "@/lib/record/copy";
import { contactDisplayName } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locale";
import { moveHoldingThreadAction, undoMoveHoldingThreadAction } from "./actions";
import { searchRelatableContactsAction, type RelatableHit } from "../contacts/relationship-actions";
import { moveAndToast } from "./holding-move-handlers";

type Answer = { term: string; hits: RelatableHit[] | "failed" };

export function HoldingMove({ accountId, conversationId, holdingContactId, people, locale }: {
  accountId: string; conversationId: string; holdingContactId: string;
  /** The real contacts on the number, by name (holding records already out). */
  people: { id: string; name: string }[];
  locale: Locale;
}) {
  const tr = makeTr(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const open = (id: string) => router.push(`/dashboard/accounts/${accountId}/conversations?c=${id}`);
  const moveTo = async (contactId: string) => {
    setBusy(true);
    await moveAndToast({
      move: () => moveHoldingThreadAction(accountId, conversationId, contactId),
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
          <Button variant="ghost" size="sm" disabled={busy} data-holding-move="">
            {tr.text("conversation.holding.move")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {people.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => { void moveTo(p.id); }}>{p.name}</DropdownMenuItem>
          ))}
          {people.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => setFinding(true)}>{tr.text("conversation.holding.moveOther")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={finding} onOpenChange={(o) => { setFinding(o); if (!o) { setTerm(""); setAnswer(null); } }}>
        <DialogContent lang={locale}>
          <DialogHeader><DialogTitle>{tr.text("conversation.holding.moveOther")}</DialogTitle></DialogHeader>
          <Label htmlFor="holding-find">{tr.text("conversation.holding.findLabel")}</Label>
          <Input
            id="holding-find" value={term} autoComplete="off"
            onChange={(e) => {
              const v = e.target.value;
              setTerm(v);
              setSearching([...v.trim()].length >= 2);
            }}
          />
          {searching && !tooShort ? <Skeleton className="h-8 w-full" />
            : failed ? <p role="alert" className="text-sm text-[var(--crit)]">{tr.text("conversation.holding.findFailed")}</p>
            : hits === null ? null
            : hits.length === 0 ? <p className="text-sm text-muted-foreground">{tr.text("conversation.holding.findNone")}</p>
            : (
              <ul className="space-y-1">
                {hits.map((h) => (
                  <li key={h.id}>
                    <Button variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => { void moveTo(h.id); }}>
                      {contactDisplayName({ first_name: h.firstName, last_name: h.lastName })}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
