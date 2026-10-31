"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, nativeFieldClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { HighlightedText } from "@/components/highlighted-text";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { RelationshipKey, WordForm } from "@bis/db/relationship-keys";
import { relationshipOptions, formChoices, chipText, personName, type FormChoice } from "@/lib/contacts/relationship-labels";
import { nameRanges, phoneRanges } from "@/lib/contacts/search-highlight";
import { previewPair, type RelationshipView } from "@/lib/contacts/relationship-view";
import {
  otherForSubmit, flagHintFor, flagHintText, hitsToShow, afterFailedAdd, type SearchAnswer, type FailedAddState,
} from "@/lib/contacts/relationship-dialog";
import { addRelationshipAction, searchRelatableContactsAction, type RelatableHit } from "./relationship-actions";

type Name = { firstName: string | null; lastName: string | null };

const radioClass = "size-4 shrink-0 accent-[var(--accent)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const hintClass = "text-xs text-muted-foreground";

/**
 * A line the dialog wants heard without interrupting: a POLITE live region, never Notice's
 * role="alert" (final review item 7). The region is always mounted, empty when there is nothing to
 * say, so the words that arrive in it are announced.
 */
function PoliteNote({ kind, text, className }: { kind: "flag-hint" | "person-saved"; text: string | null; className: string }) {
  return (
    <div aria-live="polite" data-relationship-note={kind}>
      {text ? <p className={className}>{text}</p> : null}
    </div>
  );
}
// The tinted ground of Notice's warn tone with the foreground ink Notice prescribes for a sentence.
const flagHintClass = "rounded-[var(--radius-ctl)] bg-[var(--warn-bg)] p-2 text-xs text-foreground";

/** One person's word form for this relationship (spec C1): neutral preselected. */
function WordsRow({ group, legend, words, value, onChange }: {
  group: string; legend: string; words: FormChoice; value: WordForm | null; onChange: (f: WordForm | null) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className={hintClass}>{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {([[null, words.n], ["f", words.f], ["m", words.m]] as const).map(([form, label]) => (
          <label key={form ?? "n"} className="inline-flex items-center gap-1.5">
            <input type="radio" name={group} className={radioClass} checked={value === form} onChange={() => onChange(form)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AddRelationshipDialog({ accountId, contactId, subject, views, onAdded }: {
  accountId: string; contactId: string; subject: Name;
  /** The record's relationships, so a flag on an existing row is offered before a second row (finding 5). */
  views: readonly RelationshipView[];
  onAdded: (view: RelationshipView) => void;
}) {
  const locale = useLocale();
  const tt = (key: MessageKey, params?: Record<string, string>) => t(m, key, locale, params);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"find" | "new">("find");
  const [term, setTerm] = useState("");
  /** The picker's last answer, with the term it answered (final review item 7: never shown under another). */
  const [answer, setAnswer] = useState<SearchAnswer<RelatableHit> | null>(null);
  const [picked, setPicked] = useState<RelatableHit | null>(null);
  const [fresh, setFresh] = useState({ firstName: "", lastName: "", phone: "" });
  /** The "New person" the server already saved or matched when the add itself failed (finding 3), and whether it saved them. */
  const [failed, setFailed] = useState<FailedAddState>({ createdId: null, personSaved: false });
  const { createdId } = failed;
  const [choice, setChoice] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [otherForm, setOtherForm] = useState<WordForm | null>(null);
  const [subjectForm, setSubjectForm] = useState<WordForm | null>(null);

  const searching = mode === "find" && term.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    let stale = false;
    const id = setTimeout(() => {
      void searchRelatableContactsAction(accountId, contactId, term)
        .catch(() => ({ ok: false as const }))
        .then((r) => { if (!stale) setAnswer({ term, hits: r.ok ? r.hits : "failed" }); });
    }, 250);
    return () => { stale = true; clearTimeout(id); };
  }, [accountId, contactId, searching, term]);
  const shownHits = mode === "find" ? hitsToShow(answer, term) : "idle";

  const subjectName = personName(subject, tt("relationships.noName"));
  const other: Name = mode === "new" ? { firstName: fresh.firstName || null, lastName: fresh.lastName || null } : (picked ?? { firstName: null, lastName: null });
  const otherName = personName(other, tt("relationships.dialog.thisPerson"));
  const options = useMemo(() => relationshipOptions(locale, subjectName), [locale, subjectName]);
  const [key, side] = (choice ? choice.split(":") : ["", ""]) as [RelationshipKey | "", "a" | "b" | ""];
  const hasPerson = mode === "new" ? Boolean(createdId || fresh.firstName.trim() || fresh.lastName.trim()) : picked !== null;
  const ready = hasPerson && key !== "" && side !== "" && (key !== "other" || customLabel.trim().length > 0);
  const otherWords = key && side ? formChoices(key, side, locale, "other") : null;
  const subjectWords = key && side ? formChoices(key, side, locale, "subject") : null;
  const preview = ready && key && side
    ? previewPair({ labelKey: key, otherSide: side, customLabel: customLabel.trim() || null, otherForm, subjectForm, subject, other })
    : null;
  const names = { hidden: tt("relationships.hiddenPerson"), noName: tt("relationships.noName") };
  const hint = mode === "find" ? flagHintFor(views, picked?.id ?? null, key, side) : null;

  const reset = () => {
    setMode("find"); setTerm(""); setAnswer(null); setPicked(null); setFresh({ firstName: "", lastName: "", phone: "" });
    setFailed({ createdId: null, personSaved: false });
    setChoice(""); setCustomLabel(""); setOtherForm(null); setSubjectForm(null);
  };

  // onSubmit through useFormSubmit, never the `action` prop: a failed add keeps every choice on
  // screen (lib/forms/use-form-submit.ts), and its in-flight guard stops a double Add.
  const { pending, onSubmit } = useFormSubmit(async () => {
    const otherInput = otherForSubmit({ mode, picked, fresh, createdId });
    if (!ready || !key || !side || !otherInput) return;
    const r = await addRelationshipAction(accountId, {
      subjectId: contactId, other: otherInput,
      labelKey: key, side, customLabel: key === "other" ? customLabel : null, otherForm, subjectForm,
    }).catch(() => ({ ok: false as const, error: "relationships.error.failed" as const, contactId: undefined }));
    if (!r.ok) {
      setFailed((prev) => afterFailedAdd(prev, mode, r));
      toast.error(tt(r.error));
      return;
    }
    onAdded(r.view);
    reset();
    setOpen(false);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost"><Plus className="size-4" aria-hidden />{tt("relationships.add")}</Button>
      </DialogTrigger>
      <DialogContent lang={locale}>
        <DialogHeader><DialogTitle>{tt("relationships.add")}</DialogTitle></DialogHeader>
        <form className="min-w-0 space-y-4" onSubmit={onSubmit}>
          {mode === "find" ? (
            <div className="space-y-2">
              <Label htmlFor="rel-search">{tt("relationships.dialog.search")}</Label>
              <Input id="rel-search" value={term} onChange={(e) => { setTerm(e.target.value); setPicked(null); }} autoComplete="off" />
              {shownHits === "idle" ? null
                : shownHits === "pending" ? <Skeleton data-relationship-search-pending className="h-5 w-full rounded-[var(--radius-ctl)]" />
                : shownHits === "failed" ? <p className={hintClass}>{tt("relationships.dialog.searchFailed")}</p>
                : shownHits.length === 0 ? <p className={hintClass}>{tt("relationships.dialog.searchEmpty")}</p>
                : (
                  <ul className="space-y-1">
                    {shownHits.map((h) => {
                      const hName = personName(h, tt("relationships.noName"));
                      return (
                        <li key={h.id}>
                          <label className="flex min-w-0 items-center gap-2 text-sm">
                            <input type="radio" name="rel-person" className={radioClass} checked={picked?.id === h.id} onChange={() => setPicked(h)} />
                            <span className="min-w-0 truncate"><HighlightedText text={hName} ranges={nameRanges(hName, term)} /></span>
                            {h.phone ? (
                              <span className={cn(hintClass, "shrink-0 tabular-nums")}>
                                <HighlightedText text={h.phone} ranges={phoneRanges(h.phone, term)} />
                              </span>
                            ) : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              <Button type="button" size="sm" variant="ghost" onClick={() => { setMode("new"); setPicked(null); }}>{tt("relationships.dialog.newPerson")}</Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {/* Once the server has created this person, they exist: the names are theirs now,
                  and the next Add relates them (finding 3). */}
              <div className="space-y-1"><Label htmlFor="rel-first">{tt("relationships.dialog.firstName")}</Label>
                <Input id="rel-first" readOnly={createdId !== null} value={fresh.firstName} onChange={(e) => setFresh({ ...fresh, firstName: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="rel-last">{tt("relationships.dialog.lastName")}</Label>
                <Input id="rel-last" readOnly={createdId !== null} value={fresh.lastName} onChange={(e) => setFresh({ ...fresh, lastName: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="rel-phone">{tt("relationships.dialog.phone")}</Label>
                <Input id="rel-phone" type="tel" readOnly={createdId !== null} value={fresh.phone} onChange={(e) => setFresh({ ...fresh, phone: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2">
                {createdId === null ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMode("find")}>{tt("relationships.dialog.findPerson")}</Button>
                ) : null}
                {/* Only when this dialog's add CREATED them: a match on someone already saved
                    says nothing of the kind (final review item 7). */}
                <PoliteNote kind="person-saved" className={hintClass}
                  text={failed.personSaved ? tt("relationships.dialog.personSaved", { name: otherName }) : null} />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="rel-kind">{tt("relationships.dialog.question", { name: otherName, customer: subjectName })}</Label>
            <select id="rel-kind" value={choice} onChange={(e) => { setChoice(e.target.value); setOtherForm(null); setSubjectForm(null); }}
              className={cn(nativeFieldClass, "h-9 py-1")}>
              <option value="" disabled>{tt("relationships.dialog.pick")}</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <PoliteNote kind="flag-hint" className={flagHintClass} text={hint ? flagHintText(hint, locale, names) : null} />
          </div>
          {key === "other" ? (
            <div className="space-y-1">
              <Label htmlFor="rel-custom">{tt("relationships.dialog.otherLabel")}</Label>
              <Input id="rel-custom" maxLength={60} value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} />
              <p className={hintClass}>{tt("relationships.dialog.otherHint")}</p>
            </div>
          ) : null}
          {otherWords ? <WordsRow group="rel-words-other" legend={tt("relationships.dialog.wordsFor", { name: otherName })} words={otherWords} value={otherForm} onChange={setOtherForm} /> : null}
          {subjectWords ? <WordsRow group="rel-words-subject" legend={tt("relationships.dialog.wordsFor", { name: subjectName })} words={subjectWords} value={subjectForm} onChange={setSubjectForm} /> : null}
          {preview ? (
            <div className="space-y-1 rounded-[var(--radius-ctl)] bg-[var(--surface-2)] p-2 text-sm" aria-live="polite">
              <p className="break-words"><span className="text-muted-foreground">{tt("relationships.dialog.preview", { name: subjectName })}: </span>{chipText(preview.onSubject, locale, names)}</p>
              <p className="break-words"><span className="text-muted-foreground">{tt("relationships.dialog.preview", { name: otherName })}: </span>{chipText(preview.onOther, locale, names)}</p>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">{tt("relationships.dialog.cancel")}</Button></DialogClose>
            <Button type="submit" disabled={!ready || pending}>{tt("relationships.dialog.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
