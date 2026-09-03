"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ACCOUNT_ROUTE_RE } from "@/lib/account-route";
import {
  buildPaletteEntries, filterEntries, type PaletteEntry,
} from "@/lib/palette/registry";
import type { SearchResults, SearchHit } from "@/app/api/accounts/[accountId]/search/route";
import { formatDate } from "@/lib/format";
import { m } from "@/lib/messages";

const DEBOUNCE_MS = 200;
/** Must match the route's own floor, or the palette spins for a query the
 *  server answers with empty groups. */
const MIN_QUERY = 2;

type Settled = { status: "ready"; results: SearchResults } | { status: "error" };
/** The response PAIRED WITH THE QUERY IT ANSWERS — the P4 drawer's guard. A
 *  reply whose query no longer matches the box is not stale-checked, it is
 *  simply never selected. */
type Live = { query: string; state: Settled } | null;

const EMPTY_RESULTS: SearchResults = { contacts: [], calls: [], conversations: [] };

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
  );
}

/**
 * DESIGN.md's ⌘K key pattern: finds contacts/calls/conversations, jumps to any
 * settings section by name, runs safe actions.
 *
 * Mounted ONCE in dashboard/layout.tsx, which sits ABOVE the [accountId]
 * segment and therefore cannot pass an account id down. The current account is
 * derived from the pathname with the same ACCOUNT_ROUTE_RE every other
 * pathname-keyed client component in this tree already shares. Off-account
 * (the agency top level) the static half still works and the live half is
 * simply not offered — there is no account to scope a search to.
 */
export function CommandPalette({ isAgency }: { isAgency: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [live, setLive] = useState<Live>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const accountId = pathname.match(ACCOUNT_ROUTE_RE)?.[1] ?? null;
  const base = accountId ? `/dashboard/accounts/${accountId}` : null;
  const entries = filterEntries(buildPaletteEntries(base, isAgency), query);

  const q = query.trim();
  const wantsLive = accountId !== null && q.length >= MIN_QUERY;
  /** Only a settled response FOR THIS EXACT QUERY counts. Anything else —
   *  never fetched, still debouncing, in flight, or answering an older
   *  query — leaves this null, which is precisely the pending state. No
   *  synchronous setState in an effect is needed to model "loading". */
  const settled = live && live.query === q ? live.state : null;
  const pending = wantsLive && settled === null;
  const results = settled?.status === "ready" ? settled.results : EMPTY_RESULTS;

  // ⌘K / Ctrl+K, global.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      // ⌘K is ours everywhere. Ctrl+K inside a text field is NOT: on macOS
      // that is the OS's own "delete to end of line", and stealing it from
      // someone mid-sentence is worse than making them reach for the mouse.
      if (event.ctrlKey && !event.metaKey && isEditable(event.target)) return;
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The live half: debounced, aborted on every keystroke, and never allowed to
  // report an older query's answer.
  useEffect(() => {
    if (!open || !wantsLive || !accountId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/accounts/${accountId}/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) { setLive({ query: q, state: { status: "error" } }); return; }
          const payload = (await res.json()) as SearchResults;
          setLive({ query: q, state: { status: "ready", results: payload } });
        })
        .catch((error: unknown) => {
          // An abort is this component cancelling itself, not a failure —
          // reporting it would flash an error row on every keystroke.
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLive({ query: q, state: { status: "error" } });
        });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, wantsLive, accountId, q, retryNonce]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function runEntry(entry: PaletteEntry) {
    close();
    if (entry.kind === "href") { router.push(entry.href); return; }
    // The only action, and deliberately a safe one: no tenant data is written
    // from a fuzzy match one keystroke from Enter.
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  function openHit(hit: SearchHit) {
    close();
    router.push(hit.href);
  }

  const groups: { key: string; heading: string; items: PaletteEntry[] }[] = [
    { key: "navigation", heading: m["palette.group.navigation"], items: entries.filter((e) => e.group === "navigation") },
    { key: "settings", heading: m["palette.group.settings"], items: entries.filter((e) => e.group === "settings") },
    { key: "actions", heading: m["palette.group.actions"], items: entries.filter((e) => e.group === "actions") },
  ];

  const liveGroups: { key: string; heading: string; hits: SearchHit[] }[] = [
    { key: "contacts", heading: m["palette.group.contacts"], hits: results.contacts },
    { key: "calls", heading: m["palette.group.calls"], hits: results.calls },
    { key: "conversations", heading: m["palette.group.conversations"], hits: results.conversations },
  ];

  const liveHitCount = liveGroups.reduce((total, group) => total + group.hits.length, 0);
  const nothingAtAll =
    entries.length === 0 && !pending && settled?.status !== "error" && liveHitCount === 0;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={m["shell.search"]}
        aria-keyshortcuts="Meta+K Control+K"
        className="gap-2 text-muted-foreground"
      >
        <span>{m["palette.searchHint"]}</span>
        {/* `[var(--radius-ctl)]`, not the bare `[--radius-ctl]` shorthand:
            that form was Tailwind v3 and this repo is on v4, where it emits an
            invalid declaration and silently drops the radius. --radius-ctl is
            DESIGN.md's 8px control radius. */}
        <kbd className="rounded-[var(--radius-ctl)] border border-border px-1.5 py-0.5 font-mono text-[10px]">
          {m["palette.shortcut"]}
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title={m["shell.search"]}
        description={m["palette.placeholder"]}
        // Matching lives in filterEntries (a pure, unit-tested function) and,
        // for the live half, in Postgres. cmdk must not re-filter server rows
        // whose matched columns it never saw.
        shouldFilter={false}
      >
        <CommandInput
          placeholder={m["palette.placeholder"]}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <CommandGroup key={group.key} heading={group.heading}>
                {group.items.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.id}
                    onSelect={() => runEntry(entry)}
                  >
                    {entry.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ),
          )}

          {/* Skeletons shaped like a result row, never a spinner (rule 7).
              Plain divs, not CommandItems — an arrow key must never land on
              a placeholder. */}
          {pending ? (
            <div className="space-y-2 p-2" data-testid="palette-loading">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex flex-col gap-1.5 px-2 py-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : null}

          {/* An honest failure, with a way out. NEVER silence: an empty list
              would tell the user the record does not exist. */}
          {settled?.status === "error" ? (
            <div
              role="alert"
              data-testid="palette-error"
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground">{m["palette.error"]}</span>
              <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
                {m["palette.retry"]}
              </Button>
            </div>
          ) : null}

          {settled?.status === "ready"
            ? liveGroups.map((group) =>
                group.hits.length === 0 ? null : (
                  <CommandGroup key={group.key} heading={group.heading}>
                    {group.hits.map((hit) => (
                      <CommandItem
                        key={`${group.key}:${hit.id}`}
                        value={`${group.key}:${hit.id}`}
                        onSelect={() => openHit(hit)}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{hit.label}</span>
                          {hit.sublabel || hit.at ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {[hit.sublabel, hit.at ? formatDate(hit.at) : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
              )
            : null}

          {/* Below the search floor, inside an account: say what would help. */}
          {accountId && q.length > 0 && q.length < MIN_QUERY ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{m["palette.hint"]}</p>
          ) : null}

          {nothingAtAll ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {m["palette.empty"].replace("{query}", query)}
            </p>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
