"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InlineField } from "@/components/inline-field";
import { contactDisplayName, initials } from "@/lib/format";
import { relativeTime } from "@/lib/dashboard/relative-time";
import { m } from "@/lib/messages";
import { updateContactFieldAction } from "./actions";
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

const FIELDS: { field: EditableField; labelKey: keyof typeof m; type: "text" | "email" | "tel" }[] = [
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
  }, [accountId, contactId]);

  const load: LoadResult | { status: "loading" } =
    contactId && fetched?.contactId === contactId ? fetched.result : { status: "loading" };

  const fullHref = contactId
    ? `/dashboard/accounts/${accountId}/contacts/${contactId}` : "#";

  return (
    <Sheet open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
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
                  className="text-muted-foreground hover:text-foreground ml-auto"
                  aria-label={m["drawer.openFull"]}
                >
                  <ExternalLink className="size-4" aria-hidden />
                </Link>
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 overflow-y-auto px-4 pb-6">
              <dl className="space-y-1">
                {FIELDS.map(({ field, labelKey, type }) => (
                  <div key={field} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
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
                <div className="border-border rounded-md border p-3 text-sm" role="alert">
                  <p className="text-muted-foreground">{m["drawer.loadFailed"]}</p>
                  <div className="mt-2 flex gap-3">
                    <Button size="sm" variant="outline" onClick={() => {
                      const id = row.id;
                      // Drop the paired fetch so `load` falls back to
                      // "loading" (the mismatch check above) while this
                      // retry is in flight — an event handler, so a plain
                      // setState here (not inside an effect) is fine.
                      setFetched(null);
                      fetch(`/api/accounts/${accountId}/contacts/${id}/summary`)
                        .then(async (res) => {
                          if (!res.ok) { setFetched({ contactId: id, result: { status: "error" } }); return; }
                          const summary = (await res.json()) as ContactSummary;
                          setFetched({ contactId: id, result: { status: "ready", summary, nowMs: Date.now() } });
                        })
                        .catch(() => setFetched({ contactId: id, result: { status: "error" } }));
                    }}>
                      {m["common.retry"]}
                    </Button>
                    <Link href={fullHref} className="text-sm underline">{m["drawer.openFull"]}</Link>
                  </div>
                </div>
              ) : (
                <>
                  <TagsRow accountId={accountId} contactId={row.id} tags={load.summary.tags} />
                  <div>
                    <p className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.14em] uppercase">
                      {m["drawer.recent"]}
                    </p>
                    {load.summary.recent.length === 0 ? (
                      <p className="text-muted-foreground text-sm">{m["drawer.recentEmpty"]}</p>
                    ) : (
                      <ul className="space-y-1.5 text-sm">
                        {load.summary.recent.map((r, i) => (
                          <li key={i} className="flex items-baseline justify-between gap-2">
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
// as contact-fields-panel.tsx (do not invent a new action shape). CAVEAT:
// after a tag add/remove the `tags` prop above does NOT auto-refresh (the
// summary was fetched once) — accepted for v1, the server revalidates the
// page and reopening the drawer shows the truth.
function TagsRow({ accountId, contactId, tags }: {
  accountId: string; contactId: string; tags: ContactSummary["tags"];
}) {
  const boundAdd = addTagAction.bind(null, accountId);
  const boundRemove = removeTagAction.bind(null, accountId);
  const hidden = <input type="hidden" name="contactId" value={contactId} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <form key={t.id} action={boundRemove} className="inline-flex">
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
      <form action={boundAdd} className="inline-flex items-center gap-1">
        {hidden}
        <Input name="tag" placeholder={m["contact.addTag"]} className="h-7 w-28 text-xs" />
        <Button type="submit" size="icon-xs" variant="outline" aria-label={m["contact.addTag"]}>
          <Plus className="size-3" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
