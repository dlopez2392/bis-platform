"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@/lib/messages";
import {
  CUSTOMER_STATE_KEY, nextCustomerPollMs, pollKey, type CustomerFile, type CustomerFileState,
} from "@/lib/document-requests/customer-state";
import { uploadCustomerFile, browserCustomerDeps, type CustomerPhase } from "@/lib/document-requests/customer-client";
import { docCopy } from "./copy";

type Locale = "en" | "es";
type Tone = "good" | "warn" | "crit";
export type CustomerItemView = { key: string; label: string; files: CustomerFile[]; local: CustomerPhase[] };

/** The part 1 picker's own list, plus the bare image types a phone's gallery reports. */
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,image/*";
/** A refusal that comes from the SCAN: the file is stored, so the server lists it from now on. */
const SCAN_WHY: ReadonlySet<MessageKey> = new Set(["customerDocs.why.virus", "customerDocs.why.password", "customerDocs.why.unscannable"]);
const REMOVED: ReadonlySet<CustomerFileState> = new Set(["virus", "password", "unscannable"]);

/**
 * What the list does when one upload ends: "server" — the file is stored and the server now lists it
 * (Checking, Received, or removed by the scan), so the local line goes and the page re-reads; "closed" —
 * the request shut meanwhile, so the page re-reads into its dead end; "refresh" — the bytes landed but
 * the finish never answered, so the line stays AND the page re-reads, and the server's truth lists the
 * file if it was filed (Task 9 review ruling); "local" — nothing was stored (a refusal before the bytes,
 * or a failure), so the line stays as the page's own.
 */
export function afterUpload(end: CustomerPhase): "server" | "closed" | "refresh" | "local" {
  if (end.kind === "received" || end.kind === "checking") return "server";
  if (end.kind === "refused" && SCAN_WHY.has(end.why)) return "server";
  if (end.kind === "closed") return "closed";
  if (end.kind === "failed" && end.maybeStored) return "refresh";
  return "local";
}

/**
 * One status line: a dot and a word (rule 3). `progress` makes the word a progressbar whose moving
 * percent is hidden from the live region, so a screen reader hears each PHASE (Uploading, Checking,
 * Received), not every percent (Task 9 review): the value rides on aria-valuenow and the name.
 */
function Line({ tone, children, progress }: { tone: Tone; children: string; progress?: number }) {
  return (
    <li className="bis-docreq-line">
      <span className={`bis-docreq-dot bis-docreq-dot--${tone}`} aria-hidden="true"></span>
      {progress === undefined ? <span>{children}</span> : (
        <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={children}>
          <span aria-hidden="true">{children}</span>
        </span>
      )}
    </li>
  );
}

/**
 * Presentational (plan review I7): every word goes through docCopy with the business, so a sentence
 * naming it never leaves "{business}" behind; `business` is the brand name, or null when the account has
 * none, and then each sentence is its own no-name wording ("llame al negocio", never "a el"). A file is
 * a dot and a word, never its name, title, size or a link: nothing stored is shown back.
 */
export function CustomerUploadView({ locale, business, items, onPick }: {
  locale: Locale; business: string | null; items: CustomerItemView[]; onPick: (itemKey: string, file: File) => void;
}) {
  const tt = docCopy(locale, business);
  const refusedLine = (why: MessageKey, p?: Record<string, string>) => `${tt("customerDocs.refused")} · ${tt(why, p)}`;
  const fileLine = (f: CustomerFile, i: number) => (
    REMOVED.has(f.state)
      ? <Line key={`f${i}`} tone="crit">{refusedLine(CUSTOMER_STATE_KEY[f.state])}</Line>
      : <Line key={`f${i}`} tone={f.state === "received" ? "good" : "warn"}>{tt(CUSTOMER_STATE_KEY[f.state])}</Line>
  );
  const localLine = (p: CustomerPhase, i: number) => {
    const key = `l${i}`;
    switch (p.kind) {
      case "uploading": return <Line key={key} tone="warn" progress={p.percent}>{tt("customerDocs.uploading", { percent: p.percent })}</Line>;
      case "checking": return <Line key={key} tone="warn">{tt("customerDocs.checking")}</Line>;
      case "received": return <Line key={key} tone="good">{tt("customerDocs.received")}</Line>;
      case "refused": return <Line key={key} tone="crit">{refusedLine(p.why, p.params)}</Line>;
      case "failed": return <Line key={key} tone="crit">{tt("customerDocs.failed")}</Line>;
      case "closed": return null;
    }
  };
  return (
    <ul className="bis-docreq-items">
      {items.map((it) => (
        <ItemRow key={it.key} item={it} upload={tt("customerDocs.upload")} photo={tt("customerDocs.takePhoto")} onPick={onPick}>
          {it.files.map(fileLine)}
          {it.local.map(localLine)}
        </ItemRow>
      ))}
    </ul>
  );
}

function ItemRow({ item, upload, photo, onPick, children }: {
  item: CustomerItemView; upload: string; photo: string; onPick: (itemKey: string, file: File) => void; children: React.ReactNode;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file may be chosen again after a failure
    if (file) onPick(item.key, file);
  };
  return (
    <li className="bis-docreq-item" data-docreq-item={item.key}>
      <p className="bis-docreq-label">{item.label}</p>
      {/* Always rendered: a live region must exist before the words it announces arrive. */}
      <ul className="bis-docreq-lines" aria-live="polite">{children}</ul>
      <div className="bis-docreq-actions">
        <button type="button" className="bis-docreq-primary" onClick={() => uploadRef.current?.click()}>{upload}</button>
        <button type="button" className="bis-docreq-ghost bis-docreq-photo" onClick={() => cameraRef.current?.click()}>{photo}</button>
      </div>
      <input ref={uploadRef} type="file" accept={ACCEPT} hidden onChange={pick} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
    </li>
  );
}

type LocalEntry = { id: number; itemKey: string; phase: CustomerPhase };

/**
 * The container: holds each in-flight upload's phase and re-reads the page while a file is Checking.
 * The server's render is the truth for every stored file; a local line lives only until its file is
 * stored (afterUpload), then the re-read lists it.
 */
export function CustomerUploadList({ token, locale, business, items }: {
  token: string; locale: Locale; business: string | null; items: { key: string; label: string; files: CustomerFile[] }[];
}) {
  const router = useRouter();
  const [local, setLocal] = useState<LocalEntry[]>([]);
  const nextId = useRef(0);

  // Re-read while a file is Checking, scheduled from each Checking file's own age as the SERVER computed
  // it at this render (plan review I9; never the browser's clock, never the page-open time). Keyed on
  // pollKey(ms, reads), not ms alone: ms is the same number while the same file stays Checking, so an
  // effect keyed on ms alone would fire ONCE (2a Task 9's defect); reads changes on every re-read.
  const [reads, setReads] = useState(0);
  const ms = nextCustomerPollMs(items.flatMap((i) => i.files));
  const key = pollKey(ms, reads);
  useEffect(() => {
    if (ms === null) return;
    const timer = setTimeout(() => {
      router.refresh();
      setReads((r) => r + 1);
    }, ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key already folds ms and reads together (see pollKey); ms alone would under-trigger (2a Task 9, I1).
  }, [key]);

  const onPick = (itemKey: string, file: File) => {
    const id = nextId.current++;
    const set = (phase: CustomerPhase) => setLocal((l) => l.map((e) => (e.id === id ? { ...e, phase } : e)));
    setLocal((l) => [...l, { id, itemKey, phase: { kind: "uploading", percent: 0 } }]);
    void uploadCustomerFile(token, itemKey, file, browserCustomerDeps(), set)
      .catch((): CustomerPhase => ({ kind: "failed" }))
      .then((end) => {
        const next = afterUpload(end);
        if (next === "local" || next === "refresh") {
          set(end);
          if (next === "refresh") router.refresh();
          return;
        }
        // One transition: the local line goes in the same commit as the re-read that lists the file.
        startTransition(() => {
          setLocal((l) => l.filter((e) => e.id !== id));
          router.refresh();
        });
      });
  };

  const view = items.map((i) => ({ ...i, local: local.filter((e) => e.itemKey === i.key).map((e) => e.phase) }));
  return <CustomerUploadView locale={locale} business={business} items={view} onPick={onPick} />;
}
