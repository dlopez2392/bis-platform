"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InlineField } from "@/components/inline-field";
import { contactDisplayName, initials } from "@/lib/format";
import { relativeTime } from "@/lib/dashboard/relative-time";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { updateContactFieldAction } from "./actions";
import { MarketingOptOutSwitch } from "./marketing-optout-switch";
import { addTagAction, removeTagAction } from "./[contactId]/actions";
import type { ContactRow } from "./contacts-table";
import type { ContactSummary } from "@/app/api/accounts/[accountId]/contacts/[contactId]/summary/route";
import type { EditableField } from "@/lib/contacts/field-input";

type LoadResult =
  | { status: "error" }
  // `nowMs` travels WITH the ready result, captured inside the fetch's own
  // `.then()` (an allowed impure read — react-hooks/purity flags Date.now()
  // reachable from the render body itself, same as f/[publicId]/page.tsx's
  // own comment on signRenderToken's Date.now()) rather than a bare
  // `Date.now()` call in the component body.
  | { status: "ready"; summary: ContactSummary; nowMs: number };

// Paired with the id it was fetched for, the same shape shell-data.tsx uses
// for its own fetch effect: "loading" for a newly-peeked contact falls out
// of the mismatch check in `load` below instead of a synchronous setState
// reset at the top of the effect (react-hooks/set-state-in-effect) — only
// the fetch's own `.then()`/`.catch()` callbacks below write state.
type Fetched = { contactId: string; result: LoadResult } | null;

// Exported so contact-fields-panel.tsx (the full contact page) shares this
// vocabulary instead of duplicating it — one list of standard fields, two
// InlineField call sites (drawer + full page).
export const FIELDS: { field: EditableField; labelKey: keyof typeof m; type: "text" | "email" | "tel" }[] = [
  { field: "first_name", labelKey: "contacts.firstName", type: "text" },
  { field: "last_name", labelKey: "contacts.lastName", type: "text" },
  { field: "email", labelKey: "contacts.email", type: "email" },
  { field: "phone", labelKey: "contacts.phone", type: "tel" },
  { field: "company_name", labelKey: "contact.company", type: "text" },
];

export function ContactDrawer({
  accountId, row, onClose,
}: {
  accountId: string;
  row: ContactRow | null;
  onClose: () => void;
}) {
  const [fetched, setFetched] = useState<Fetched>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const contactId = row?.id ?? null;

  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/summary`)
      .then(async (res) => {
        if (stale) return;
        if (!res.ok) { setFetched({ contactId, result: { status: "error" } }); return; }
        const summary = (await res.json()) as ContactSummary;
        setFetched({ contactId, result: { status: "ready", summary, nowMs: Date.now() } });
      })
      .catch(() => { if (!stale) setFetched({ contactId, result: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);

  const load: LoadResult | { status: "loading" } =
    contactId && fetched?.contactId === contactId ? fetched.result : { status: "loading" };

  const fullHref = contactId
    ? `/dashboard/accounts/${accountId}/contacts/${contactId}` : "#";

  return (
    <Sheet open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md"
        // Radix's own Escape listener sits on `document` with
        // `{capture: true}` and runs BEFORE any bubble-phase `onKeyDown` on
        // a field inside this sheet — including InlineField's own Escape
        // handler, which only means to cancel the field being edited.
        // Without this, Escape while editing (or mid-tag-draft in TagsRow
        // below) closed the whole drawer instead of just abandoning the
        // edit. preventDefault here stops Radix's dismiss for THIS keypress
        // only; the focused field's own onKeyDown still runs right after
        // (same event, same phase, just later), so the edit itself still
        // cancels normally. Esc with no field focused — document.activeElement
        // isn't an input — is untouched and still closes the drawer.
        onEscapeKeyDown={(e) => {
          const el = document.activeElement;
          if (
            el instanceof HTMLInputElement &&
            e.currentTarget instanceof Node &&
            e.currentTarget.contains(el)
          ) {
            e.preventDefault();
          }
        }}
      >
        {row === null ? null : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                  {initials(contactDisplayName(row))}
                </span>
                <span className="truncate">{contactDisplayName(row)}</span>
                <Link
                  href={fullHref}
                  // mr-8 clears SheetContent's own close button, which is
                  // absolutely positioned at top-4 right-4 — without it the
                  // two icons render on top of each other.
                  className="text-muted-foreground hover:text-foreground mr-8 ml-auto"
                  aria-label={m["drawer.openFull"]}
                >
                  <ExternalLink className="size-4" aria-hidden />
                </Link>
              </SheetTitle>
              <SheetDescription className="sr-only">{m["drawer.description"]}</SheetDescription>
            </SheetHeader>

            <div
              data-testid="drawer-scroll"
              className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6"
            >
              <dl className="space-y-1">
                {FIELDS.map(({ field, labelKey, type }) => (
                  // Keyed by contact id + field, not field alone: the peek
                  // overlay blocks row clicks while it's open so `row` can't
                  // change out from under it today, but a bare `field` key
                  // would reconcile instead of remount if it ever could,
                  // showing/writing contact A's values under contact B.
                  <div key={`${row.id}:${field}`} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
                    <dt className="text-muted-foreground text-xs">{m[labelKey]}</dt>
                    <dd>
                      <InlineField
                        label={m[labelKey]}
                        field={field}
                        inputType={type}
                        value={(row[field] as string | null) ?? null}
                        save={(v) => updateContactFieldAction(accountId, row.id, field, v)}
                      />
                    </dd>
                  </div>
                ))}
              </dl>

              {load.status === "loading" ? (
                <div className="space-y-2" data-testid="drawer-skeleton">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : load.status === "error" ? (
                <Notice tone="crit" className="p-3">
                  <p className="text-muted-foreground">{m["drawer.loadFailed"]}</p>
                  <div className="mt-2 flex gap-3">
                    <Button size="sm" variant="outline" onClick={() => {
                      // Drop the paired fetch so `load` falls back to
                      // "loading" (the mismatch check above), then bump the
                      // nonce so the guarded effect above refires the fetch
                      // itself — retry rides the same `stale` closure guard
                      // as the normal load, so a switched-away contact can
                      // never have its state overwritten by this retry.
                      setFetched(null);
                      setRetryNonce((n) => n + 1);
                    }}>
                      {m["common.retry"]}
                    </Button>
                    <Link href={fullHref} className="text-sm underline">{m["drawer.openFull"]}</Link>
                  </div>
                </Notice>
              ) : (
                <>
                  <TagsRow
                    accountId={accountId}
                    contactId={row.id}
                    tags={load.summary.tags}
                    onChanged={() => setRetryNonce((n) => n + 1)}
                  />
                  {/* From the summary, not `row`: a `?peek=` of a contact on
                      another page has only missingRow's all-null stub, which
                      would show an opted-out contact as unticked. Keyed by
                      contact so its local state never carries across. */}
                  <MarketingOptOutSwitch
                    key={row.id}
                    accountId={accountId}
                    contactId={row.id}
                    optedOutAt={load.summary.marketing_email_opted_out_at}
                  />
                  <div>
                    <p className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.14em] uppercase">
                      {m["drawer.recent"]}
                    </p>
                    {load.summary.recent.length === 0 ? (
                      <p className="text-muted-foreground text-sm">{m["drawer.recentEmpty"]}</p>
                    ) : (
                      <ul className="space-y-1.5 text-sm">
                        {load.summary.recent.map((r, i) => (
                          <li key={i} data-testid="drawer-recent-item" className="flex items-baseline justify-between gap-2">
                            <span className="truncate">{r.label}</span>
                            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                              {relativeTime(r.at, load.nowMs)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Reuses the EXISTING FormData tag actions with the same hidden-input idiom
// as contact-fields-panel.tsx (do not invent a new action shape). `onChanged`
// fires only after a successful submission and bumps ContactDrawer's own
// `retryNonce`, which the guarded fetch effect above already depends on — so
// a tag add/remove refetches the one-shot summary GET the badges below come
// from. Before this, the server actions' own `revalidatePath` targeted the
// contact DETAIL path (not this drawer), so the badges stayed stale with no
// toast either way and an operator watching a tag not disappear had no way
// to tell a slow success from a silent failure.
async function submitTagAction(run: () => Promise<void>, onChanged: () => void): Promise<boolean> {
  try {
    await run();
    onChanged();
    return true;
  } catch {
    // Same crash-safety reasoning as notifyActionResult (action-feedback.ts):
    // a stale tab posting a content-hashed server-action id from before a
    // redeploy REJECTS rather than resolving, and that must reach the
    // operator as a toast, not vanish silently.
    toast.error(m["inline.crashed"]);
    // Reported rather than swallowed, so the caller can keep the operator's
    // typed tag on screen instead of clearing a field whose write failed.
    return false;
  }
}

function TagsRow({ accountId, contactId, tags, onChanged }: {
  accountId: string; contactId: string; tags: ContactSummary["tags"]; onChanged: () => void;
}) {
  const boundAdd = addTagAction.bind(null, accountId);
  const boundRemove = removeTagAction.bind(null, accountId);
  const hidden = <input type="hidden" name="contactId" value={contactId} />;
  const addTag = useFormSubmit(async (formData, form) => {
    const ok = await submitTagAction(() => boundAdd(formData), onChanged);
    // Cleared for the next tag ONLY on success. On failure the typed tag has
    // to stay — that is the whole point of the conversion.
    if (ok && form.isConnected) form.reset();
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <form
          key={t.id}
          // Keeps the `action` prop: this form carries no operator-typed
          // input (just hidden ids), so React's post-action reset has nothing
          // to discard. `void` because submitTagAction now reports success for
          // the add form's benefit, and an action prop must return void.
          action={(formData) => void submitTagAction(() => boundRemove(formData), onChanged)}
          className="inline-flex"
        >
          {hidden}
          <input type="hidden" name="tagId" value={t.id} />
          <button type="submit" className="group" title={t.name}
            aria-label={m["contact.removeTag"].replace("{name}", t.name)}>
            <Badge variant="secondary" className="gap-1 pr-1.5">
              {t.name}
              <X className="text-muted-foreground group-hover:text-foreground size-3" aria-hidden />
            </Badge>
          </button>
        </form>
      ))}
      {/* onSubmit, NOT the `action` prop: submitTagAction catches and toasts,
          so a failed add used to resolve, trigger React's post-action reset,
          and wipe the tag the operator had just typed. One short word to
          retype, but the same defect as the rest — see
          lib/forms/use-form-submit.ts. The REMOVE forms above carry no typed
          input, so they keep the `action` prop. */}
      <form
        onSubmit={addTag.onSubmit}
        className="inline-flex items-center gap-1"
      >
        {hidden}
        <Input name="tag" placeholder={m["contact.addTag"]} className="h-7 w-28 text-xs" />
        <Button type="submit" size="icon-xs" variant="outline" aria-label={m["contact.addTag"]}>
          <Plus className="size-3" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
