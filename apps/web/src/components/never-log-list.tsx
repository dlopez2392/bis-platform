"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { AddNeverLogActionResult, RemoveNeverLogActionResult, NeverLogView } from "@/app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions";
import { runAddNeverLog, runRemoveNeverLog, type NeverLogDeps } from "./never-log-handlers";

/**
 * S-06 part 2: the account's Never record list, on Settings (agency) and Branding (Owner). Server-rendered
 * entries (null = the read failed: rule 5's error state); Add and Remove run at once with Undo (rule 6),
 * both ghost (rule 8: the host card keeps its own one primary). No <form>: on Branding the card sits next
 * to the branding form (plan G6), and Enter here must never submit anything else.
 */
export function NeverLogList({ entries, add, remove, locale, idPrefix }: {
  entries: NeverLogView[] | null;
  add: (input: string) => Promise<AddNeverLogActionResult>;
  remove: (id: string) => Promise<RemoveNeverLogActionResult>;
  locale: Locale;
  idPrefix: string;
}) {
  const [list, setList] = useState<NeverLogView[]>(entries ?? []);
  const [value, setValue] = useState("");
  const [inline, setInline] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const deps: NeverLogDeps = {
    add, remove, toast, locale,
    onAdded: (e) => setList((l) => [e, ...l.filter((x) => x.id !== e.id && x.pattern !== e.pattern)]),
    onRemoved: (id) => setList((l) => l.filter((x) => x.id !== id)),
    onInlineError: setInline,
  };
  const titleId = `${idPrefix}-never-log-title`;
  const inputId = `${idPrefix}-never-log-input`;
  const errorId = `${inputId}-error`;

  async function submit() {
    if (pending) return;
    setPending(true);
    try {
      if (await runAddNeverLog(deps, value)) setValue("");
    } finally {
      setPending(false);
    }
  }

  return (
    <section data-never-log="" lang={locale} aria-labelledby={titleId} className="space-y-3">
      <div className="space-y-1">
        <h3 id={titleId} className="text-sm font-semibold text-card-foreground">{t(m, "neverLog.title", locale)}</h3>
        <p className="text-xs text-muted-foreground">{t(m, "neverLog.body", locale)}</p>
      </div>
      {entries === null ? (
        <p data-never-log-error="" role="alert" className="text-sm text-[var(--crit)]">{t(m, "neverLog.loadFailed", locale)}</p>
      ) : (
        <>
          {list.length === 0 ? (
            <p data-never-log-empty="" className="text-sm text-muted-foreground">{t(m, "neverLog.empty", locale)}</p>
          ) : (
            <ul className="divide-y divide-[var(--line)] rounded-[var(--radius-ctl)] border border-[var(--line)]">
              {list.map((e) => (
                <li key={e.id} data-never-log-entry={e.pattern} className="flex min-h-11 items-center gap-3 px-3 md:min-h-8">
                  <span className="min-w-0 flex-1 truncate text-sm text-card-foreground">{e.pattern}</span>
                  <span className="text-xs text-muted-foreground">{t(m, e.kind === "domain" ? "neverLog.kind.domain" : "neverLog.kind.address", locale)}</span>
                  <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                    aria-label={t(m, "neverLog.removeLabel", locale, { pattern: e.pattern })}
                    onClick={() => { void runRemoveNeverLog(deps, e); }}>
                    {t(m, "neverLog.remove", locale)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>{t(m, "neverLog.inputLabel", locale)}</Label>
            <div className="flex gap-2">
              <Input id={inputId} value={value} placeholder={t(m, "neverLog.placeholder", locale)}
                autoComplete="off" spellCheck={false}
                aria-invalid={inline ? true : undefined} aria-describedby={inline ? errorId : undefined}
                onChange={(ev) => { setValue(ev.target.value); if (inline) setInline(null); }}
                onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); void submit(); } }} />
              <Button type="button" variant="ghost" className="min-h-11 md:min-h-8" disabled={pending} onClick={() => { void submit(); }}>
                {t(m, "neverLog.add", locale)}
              </Button>
            </div>
            {inline ? <p id={errorId} role="alert" className="text-xs text-[var(--crit)]">{inline}</p> : null}
          </div>
        </>
      )}
    </section>
  );
}
