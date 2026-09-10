"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { autoMap, mapRows, IMPORT_FIELDS, type ParsedRow } from "@/lib/contacts/csv";
import { importContactsBatchAction } from "./actions";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

/**
 * Rows per server call. The action enforces its own, larger ceiling — this is
 * the size that keeps one request short enough to show honest progress and to
 * make a failure lose at most this many rows, not the whole file.
 */
const BATCH_SIZE = 200;

/** The mapping dropdown's "leave this column out" value. */
const IGNORE = "";

type Phase =
  | { name: "choose" }
  | { name: "map" }
  | { name: "running"; done: number; total: number }
  | { name: "done"; created: number; updated: number }
  | { name: "stopped"; done: number; error: string };

export function ImportWizard(
  { accountId, existingTags }: { accountId: string; existingTags: string[] },
) {
  const [phase, setPhase] = useState<Phase>({ name: "choose" });
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [createTags, setCreateTags] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const contactsHref = `/dashboard/accounts/${accountId}/contacts`;

  function onFile(file: File) {
    setFileError(null);
    // Parsed HERE, in the browser. The file itself is never uploaded — only
    // the rows that survive mapping travel to the server.
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const fields = result.meta.fields ?? [];
        // +2: the header is line 1, so the first data row is line 2 — the
        // number the operator sees in their spreadsheet.
        const parsed = result.data.map((values, i) => ({ line: i + 2, values }));
        if (parsed.length === 0 || fields.length === 0) {
          setFileError(m["contacts.import.empty"]);
          return;
        }
        setHeaders(fields);
        setRows(parsed);
        setMapping(autoMap(fields));
        setPhase({ name: "map" });
      },
      error: () => setFileError(m["contacts.import.empty"]),
    });
  }

  // The same mapRows the server re-runs. This copy drives the preview only;
  // nothing here is trusted on the way in.
  const { mapped, errors } = useMemo(() => mapRows(rows, mapping), [rows, mapping]);

  const ignoredCount = useMemo(
    () => headers.filter((h) => !mapping[h]).length, [headers, mapping]);

  /** Tag names in the file that the account does not already have. Computed
   *  against real tags read on the server — never guessed. */
  const newTags = useMemo(() => {
    const known = new Set(existingTags.map((t) => t.toLowerCase()));
    const seen = new Set<string>();
    for (const row of mapped) {
      for (const tag of row.tags) {
        const name = tag.toLowerCase();
        if (name && !known.has(name)) seen.add(name);
      }
    }
    return [...seen];
  }, [mapped, existingTags]);

  function downloadSkipped() {
    const body = ["line,reason", ...errors.map((e) => `${e.line},"${e.reason}"`)].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "skipped-rows.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const { pending, onSubmit } = useFormSubmit(async () => {
    let created = 0;
    let updated = 0;
    let done = 0;
    setPhase({ name: "running", done: 0, total: rows.length });

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE);
      const result = await importContactsBatchAction(
        accountId, slice, { mapping, createTags });
      if (!result.ok) {
        // Stop at the first failure and say exactly how far we got. Rows
        // before this point ARE committed; claiming otherwise would send the
        // operator looking for contacts that exist.
        setPhase({ name: "stopped", done, error: result.error });
        return;
      }
      created += result.created;
      updated += result.updated;
      done += slice.length;
      setPhase({ name: "running", done, total: rows.length });
    }
    setPhase({ name: "done", created, updated });
  });

  if (phase.name === "done") {
    return (
      <div className="glass rounded-[var(--radius-card)] border border-line p-6">
        <p className="text-text-1">
          {m["contacts.import.done"]
            .replace("{created}", String(phase.created))
            .replace("{updated}", String(phase.updated))}
        </p>
        <Link href={contactsHref} className="mt-4 inline-block text-sm text-accent underline">
          {m["contacts.import.back"]}
        </Link>
      </div>
    );
  }

  if (phase.name === "stopped") {
    return (
      <div className="glass rounded-[var(--radius-card)] border border-line p-6">
        <p className="text-text-1">{phase.error}</p>
        <p className="mt-2 text-sm text-text-2">
          {m["contacts.import.partial"].replace("{done}", String(phase.done))}
        </p>
        <Link href={contactsHref} className="mt-4 inline-block text-sm text-accent underline">
          {m["contacts.import.back"]}
        </Link>
      </div>
    );
  }

  if (phase.name === "choose") {
    return (
      <div className="glass rounded-[var(--radius-card)] border border-line p-8 text-center">
        <Upload className="mx-auto size-8 text-text-3" aria-hidden />
        <p className="mt-3 text-text-2">
          Bring your contacts over from a spreadsheet. Export from anywhere,
          match the columns, and we will add what is new and update what is not.
        </p>
        <label className="mt-5 inline-block cursor-pointer">
          <span className="sr-only">{m["contacts.import.drop"]}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm text-text-2 file:mr-3 file:cursor-pointer
                       file:rounded-[var(--radius-ctl)] file:border-0 file:bg-accent
                       file:px-4 file:py-2 file:text-sm file:text-accent-foreground"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>
        {fileError ? (
          <p className="mt-3 text-sm text-[var(--form-error)]">{fileError}</p>
        ) : null}
      </div>
    );
  }

  const running = phase.name === "running";

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-6">
      <div className="glass rounded-[var(--radius-card)] border border-line p-6">
        <h2 className="text-sm font-semibold text-text-1">{m["contacts.import.mapTitle"]}</h2>

        <ul className="mt-4 space-y-2">
          {headers.map((header) => (
            <li key={header} className="flex items-center justify-between gap-4">
              <span className="truncate text-sm text-text-2" title={header}>{header}</span>
              {/* A native select on purpose: Radix's Select drives its value
                  BACKWARDS on a form reset, which is the whole reason
                  useFormSubmit exists. Nothing here needs the styled one. */}
              <select
                aria-label={header}
                value={mapping[header] ?? IGNORE}
                disabled={running}
                onChange={(e) => setMapping((prev) => ({
                  ...prev, [header]: e.target.value === IGNORE ? null : e.target.value,
                }))}
                className="rounded-[var(--radius-ctl)] border border-line-strong bg-surface-2
                           px-2 py-1 text-sm text-text-1"
              >
                <option value={IGNORE}>{m["contacts.import.ignore"]}</option>
                {IMPORT_FIELDS.map((field) => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        {ignoredCount > 0 ? (
          <p className="mt-4 text-sm text-text-3">
            {ignoredCount === 1
              ? m["contacts.import.ignoredOne"]
              : m["contacts.import.ignored"].replace("{count}", String(ignoredCount))}
          </p>
        ) : null}
      </div>

      <div className="glass rounded-[var(--radius-card)] border border-line p-6">
        <p className="text-text-1">
          {mapped.length === 1
            ? m["contacts.import.previewOne"]
            : m["contacts.import.preview"].replace("{count}", String(mapped.length))}
        </p>

        {errors.length > 0 ? (
          <div className="mt-3">
            <p className="text-sm text-text-2">
              {errors.length === 1
                ? m["contacts.import.errorsOne"]
                : m["contacts.import.errors"].replace("{count}", String(errors.length))}
            </p>
            <button
              type="button"
              onClick={downloadSkipped}
              className="mt-1 text-sm text-accent underline"
            >
              {m["contacts.import.downloadErrors"]}
            </button>
          </div>
        ) : null}

        {newTags.length > 0 ? (
          <label className="mt-4 flex items-center gap-2 text-sm text-text-2">
            <input
              type="checkbox"
              checked={createTags}
              disabled={running}
              onChange={(e) => setCreateTags(e.target.checked)}
            />
            {newTags.length === 1
              ? m["contacts.import.createTagsOne"]
              : m["contacts.import.createTags"].replace("{count}", String(newTags.length))}
          </label>
        ) : null}

        <div className="mt-6 flex items-center gap-4">
          <Button type="submit" disabled={pending || running || mapped.length === 0}>
            {m["contacts.import.confirm"]}
          </Button>
          {running ? (
            <span aria-live="polite" className="text-sm text-text-2">
              {m["contacts.import.importing"]
                .replace("{done}", String(phase.done))
                .replace("{total}", String(phase.total))}
            </span>
          ) : (
            <Link href={contactsHref} className="text-sm text-text-3 underline">
              {m["contacts.import.back"]}
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
