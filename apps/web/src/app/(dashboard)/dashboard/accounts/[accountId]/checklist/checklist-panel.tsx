import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ChecklistEntry } from "@/lib/checklist-catalogue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { m } from "@/lib/messages";

export function ChecklistPanel({
  entries, formsMissingNotify, setAction, addAction, titleHref,
}: {
  entries: ChecklistEntry[];
  formsMissingNotify: number;
  setAction: (formData: FormData) => Promise<void>;
  addAction: (formData: FormData) => Promise<void>;
  /** When set, the panel title links to the full checklist route — used on
   *  the account dashboard, where this panel is one of several things on the
   *  page, so a finished checklist still needs a way back in. */
  titleHref?: string;
}) {
  const remaining = entries.filter((e) => !e.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          {titleHref ? (
            <Link href={titleHref} className="hover:underline">{m["checklist.title"]}</Link>
          ) : (
            m["checklist.title"]
          )}
          {remaining > 0 ? (
            <Badge variant="secondary">{remaining} {m["checklist.remaining"]}</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {remaining === 0 ? m["checklist.complete"] : m["checklist.body"]}
        </p>

        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.key} className="flex items-start gap-3 py-2.5">
              <form action={setAction} className="pt-0.5">
                <input type="hidden" name="itemKey" value={entry.key} />
                <input type="hidden" name="done" value={entry.done ? "false" : "true"} />
                <button
                  type="submit"
                  aria-label={entry.title}
                  aria-pressed={entry.done}
                  className="size-4 rounded border border-input bg-background data-[done=true]:bg-primary"
                  data-done={entry.done}
                />
              </form>
              <div className="min-w-0 flex-1">
                <p className={entry.done
                  ? "text-sm text-muted-foreground line-through"
                  : "text-sm text-card-foreground"}>
                  {entry.title}
                </p>
                {entry.help ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.help}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {/* Say plainly that the platform does not do these. */}
                  {entry.external ? (
                    <Badge variant="secondary">{m["checklist.external"]}</Badge>
                  ) : null}
                  {entry.key === "form_notify" && formsMissingNotify > 0 ? (
                    <span className="text-xs text-destructive">
                      {formsMissingNotify} {m["checklist.formNotify"]}
                    </span>
                  ) : null}
                  {entry.href ? (
                    <a href={entry.href} target="_blank" rel="noreferrer"
                       className="flex items-center gap-1 text-xs text-primary underline">
                      <ExternalLink className="size-3" aria-hidden />
                      {m["checklist.open"]}
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <form action={addAction} className="flex gap-2 pt-1">
          <Input name="title" placeholder={m["checklist.addPlaceholder"]} className="h-8 text-sm" required />
          <Button type="submit" variant="outline" size="sm">{m["checklist.addItem"]}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
