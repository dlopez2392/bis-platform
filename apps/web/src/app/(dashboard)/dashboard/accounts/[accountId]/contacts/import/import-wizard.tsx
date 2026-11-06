"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { autoMap, mapRows, IMPORT_FIELDS, importFieldLabel, type ParsedRow } from "@/lib/contacts/csv";
import {
  looksLikeVCard, parseVCardText, vCardContactsToRows, vCardFileTooLarge, decodeVCardBytes, vCardDisplayNames,
  type VCardContact,
} from "@/lib/contacts/vcard";
import { NO_IMPORT_YET, addImportBatch, importBusinessNotes, doneLine, flaggedLine, type ImportTotals } from "@/lib/contacts/import-summary";
import { importContactsBatchAction } from "./actions";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { Button } from "@/components/ui/button";
import { makeTr } from "@/lib/record/copy";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { useLocale } from "@/components/locale-provider";

/**
 * Rows per server call. The action enforces its own, larger ceiling — this is
 * the size that keeps one request short enough to show honest progress and to
 * make a failure lose at most this many rows, not the whole file.
 */
const BATCH_SIZE = 200;

/** The mapping dropdown's "leave this column out" value. */
const IGNORE = "";

type Source = "csv" | "vcard";

type Phase =
  | { name: "choose" }
  | { name: "map" }
  | { name: "running"; done: number; total: number }
  | { name: "done"; totals: ImportTotals }
  | { name: "stopped"; done: number; error: string };

export function ImportWizard(
  // Fix round D1: `pseudo` is a plain boolean prop, never a `Tr` object or a
  // function handed down from the server page — that shape crashed F-115 PR
  // E. Optional with a default so every caller written before this param
  // existed (this file's own tests) is unchanged; the real page passes the
  // real value.
  { accountId, existingTags, pseudo = false }: { accountId: string; existingTags: string[]; pseudo?: boolean },
) {
  // S-10 T3: the dashboard shell's LocaleProvider (requestLocale) — this screen spoke English
  // only until now (spec row 12); the .es twins were already in the catalogue.
  const locale = useLocale();
  // Fix round D1: built HERE, from the client-side locale above plus the
  // pseudo flag threaded in as a prop — `?locale=pseudo` could resolve the
  // page's OWN strings (page.tsx already does) but never reached this
  // component's own t()/plural() calls until now.
  const tr = makeTr(locale, pseudo);
  const pseudoWrap = (s: string) => (pseudo ? pseudoLocale(s) : s);
  const [phase, setPhase] = useState<Phase>({ name: "choose" });
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  // Fix round M-5: which copy reads — "rows" (a spreadsheet) or "contacts"
  // (a phone's vCard). Fix round M-4: a vCard's own per-row display name,
  // read back into the skipped-rows download so "no email or phone" names
  // someone instead of just a line number — the CSV download's shape never
  // carries this and never changes.
  const [source, setSource] = useState<Source>("csv");
  const [vcardNames, setVcardNames] = useState<string[]>([]);
  const [createTags, setCreateTags] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const contactsHref = `/dashboard/accounts/${accountId}/contacts`;

  // F-150 part 1: the same CSV path as before, moved into its own function
  // so a vCard sniff (below) can run first without touching this body.
  function parseCsvFile(file: File) {
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
          setFileError(tr.text("contacts.import.empty"));
          return;
        }
        setSource("csv");
        setVcardNames([]);
        setHeaders(fields);
        setRows(parsed);
        setMapping(autoMap(fields));
        setPhase({ name: "map" });
      },
      error: () => setFileError(tr.text("contacts.import.empty")),
    });
  }

  // A phone's share sheet hands the browser odd or missing MIME types for a
  // .vcf far more often than a desktop export does, so this never reads
  // file.type — looksLikeVCard checks the extension, then (for anything
  // else) the file's own opening bytes.
  async function parseVCardFile(file: File) {
    if (vCardFileTooLarge(file.size)) {
      setFileError(tr.text("contacts.import.tooLarge"));
      return;
    }
    // Fix round I-1: read as BYTES, not file.text() — file.text() always
    // decodes as UTF-8 and silently replaces an invalid byte with U+FFFD,
    // losing an old phone's raw 8-bit Latin-1/windows-1252 export entirely.
    // Fix round D2: a read (or decode) failure reads as "we couldn't open
    // that file", never the "no rows/contacts" wording — those mean the
    // file WAS read and genuinely had nothing in it.
    let text: string;
    try {
      text = decodeVCardBytes(await file.arrayBuffer());
    } catch {
      setFileError(tr.text("contacts.import.readFailed"));
      return;
    }
    // Fix round D2: parseVCardText/vCardContactsToRows used to run with no
    // guard at all — a throw here left the screen stuck on "choose" with no
    // error shown. A parse failure gets the vCard "nothing to read" wording,
    // same as a file that parsed clean but genuinely had zero cards.
    let contacts: VCardContact[];
    let converted: ReturnType<typeof vCardContactsToRows>;
    try {
      contacts = parseVCardText(text);
      if (contacts.length === 0) {
        setFileError(tr.text("contacts.import.vcardEmpty"));
        return;
      }
      // PRE-MAPPED: every header here is one of the fields vCard.ts
      // understands, mapped to itself (ORG aside — M-3(b) RULING), so the
      // match step below (and the confirm step after it) run exactly as
      // they do for a CSV — the owner can still review or re-point any
      // column, nothing is hidden from them.
      converted = vCardContactsToRows(contacts, locale);
    } catch {
      setFileError(tr.text("contacts.import.vcardEmpty"));
      return;
    }
    setSource("vcard");
    setVcardNames(vCardDisplayNames(contacts));
    setHeaders(converted.headers);
    setRows(converted.rows);
    setMapping(converted.mapping);
    setPhase({ name: "map" });
  }

  async function onFile(file: File) {
    setFileError(null);
    if (/\.vcf$/i.test(file.name)) {
      await parseVCardFile(file);
      return;
    }
    // Sniff a short opening slice rather than the whole file — enough to
    // decide, never a reason to hold the whole file in memory before we even
    // know which parser it needs.
    let head = "";
    try {
      head = await file.slice(0, 256).text();
    } catch {
      // Fall through to the CSV path; Papa.parse's own error callback is
      // what reports an unreadable file.
    }
    if (looksLikeVCard(file.name, head)) {
      await parseVCardFile(file);
      return;
    }
    parseCsvFile(file);
  }

  // The same mapRows the server re-runs. This copy drives the preview only;
  // nothing here is trusted on the way in.
  const { mapped, errors } = useMemo(() => mapRows(rows, mapping, locale), [rows, mapping, locale]);

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

  // Fix round M-4: a vCard source adds a "name" column, read back from the
  // card's own first/last name by LINE NUMBER (vCardContactsToRows numbers
  // rows 1-based, in the same order vCardDisplayNames returns them) — the
  // CSV download keeps its exact original shape, "line,reason".
  function downloadSkipped() {
    const header = source === "vcard" ? "line,name,reason" : "line,reason";
    const dataRows = errors.map((e) => (
      source === "vcard"
        ? `${e.line},"${vcardNames[e.line - 1] ?? ""}","${e.reason}"`
        : `${e.line},"${e.reason}"`
    ));
    const body = [header, ...dataRows].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "skipped-rows.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const { pending, onSubmit } = useFormSubmit(async () => {
    let totals = NO_IMPORT_YET;
    let done = 0;
    setPhase({ name: "running", done: 0, total: rows.length });

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE);
      const result = await importContactsBatchAction(
        accountId, slice, { mapping, createTags }, locale);
      if (!result.ok) {
        // Stop at the first failure and say exactly how far we got. Rows
        // before this point ARE committed; claiming otherwise would send the
        // operator looking for contacts that exist.
        setPhase({ name: "stopped", done, error: result.error });
        return;
      }
      totals = addImportBatch(totals, result);
      done += slice.length;
      setPhase({ name: "running", done, total: rows.length });
    }
    setPhase({ name: "done", totals });
  });

  if (phase.name === "done") {
    // Review fix round (M-7): computed once, not twice (the condition and the body used to
    // call flaggedLine separately).
    const flagged = flaggedLine(phase.totals, locale);
    return (
      <div className="glass rounded-[var(--radius-card)] border border-line p-6">
        <p className="text-text-1">
          {pseudoWrap(doneLine(phase.totals, locale))}
        </p>
        {flagged ? (
          <p className="mt-2 text-sm text-text-2">
            {pseudoWrap(flagged)}
          </p>
        ) : null}
        {importBusinessNotes(phase.totals, locale).map((note) => (
          <p key={note} className="mt-2 text-sm text-text-2">{pseudoWrap(note)}</p>
        ))}
        <Link href={contactsHref} className="mt-4 inline-block text-sm text-accent underline">
          {tr.text("contacts.import.back")}
        </Link>
      </div>
    );
  }

  if (phase.name === "stopped") {
    return (
      <div className="glass rounded-[var(--radius-card)] border border-line p-6">
        <p className="text-text-1">{phase.error}</p>
        <p className="mt-2 text-sm text-text-2">
          {tr.text("contacts.import.partial", { done: phase.done })}
        </p>
        <Link href={contactsHref} className="mt-4 inline-block text-sm text-accent underline">
          {tr.text("contacts.import.back")}
        </Link>
      </div>
    );
  }

  if (phase.name === "choose") {
    return (
      <div className="glass rounded-[var(--radius-card)] border border-line p-8 text-center">
        <Upload className="mx-auto size-8 text-text-3" aria-hidden />
        <p className="mt-3 text-text-2">
          {tr.text("contacts.import.intro")}
        </p>
        <p className="mt-2 text-sm text-text-3">
          {tr.text("contacts.import.vcardHint")}
        </p>
        <label className="mt-5 inline-block cursor-pointer">
          <span className="sr-only">{tr.text("contacts.import.drop")}</span>
          <input
            type="file"
            accept=".csv,text/csv,.vcf,text/vcard,text/x-vcard"
            className="block w-full text-sm text-text-2 file:mr-3 file:cursor-pointer
                       file:rounded-[var(--radius-ctl)] file:border-0 file:bg-accent
                       file:px-4 file:py-2 file:text-sm file:text-accent-foreground"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
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
        <h2 className="text-sm font-semibold text-text-1">{tr.text("contacts.import.mapTitle")}</h2>

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
                <option value={IGNORE}>{tr.text("contacts.import.ignore")}</option>
                {IMPORT_FIELDS.map((field) => (
                  <option key={field} value={field}>{importFieldLabel(field, locale)}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        {ignoredCount > 0 ? (
          <p className="mt-4 text-sm text-text-3">
            {tr.count("contacts.import.ignored", ignoredCount)}
          </p>
        ) : null}
      </div>

      <div className="glass rounded-[var(--radius-card)] border border-line p-6">
        <p className="text-text-1">
          {source === "vcard"
            ? tr.count("contacts.import.previewContacts", mapped.length)
            : tr.count("contacts.import.preview", mapped.length)}
        </p>

        {errors.length > 0 ? (
          <div className="mt-3">
            <p className="text-sm text-text-2">
              {source === "vcard"
                ? tr.count("contacts.import.errorsContacts", errors.length)
                : tr.count("contacts.import.errors", errors.length)}
            </p>
            <button
              type="button"
              onClick={downloadSkipped}
              className="mt-1 text-sm text-accent underline"
            >
              {tr.text("contacts.import.downloadErrors")}
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
            {tr.count("contacts.import.createTags", newTags.length)}
          </label>
        ) : null}

        <div className="mt-6 flex items-center gap-4">
          <Button type="submit" disabled={pending || running || mapped.length === 0}>
            {tr.text("contacts.import.confirm")}
          </Button>
          {running ? (
            <span aria-live="polite" className="text-sm text-text-2">
              {tr.text("contacts.import.importing", { done: phase.done, total: phase.total })}
            </span>
          ) : (
            <Link href={contactsHref} className="text-sm text-text-3 underline">
              {tr.text("contacts.import.back")}
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
