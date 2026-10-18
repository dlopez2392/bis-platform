"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type DownloadOutcome = { kind: "go"; url: string } | { kind: "refresh" } | { kind: "limit" } | { kind: "failed" };

/** The route's answer, as the button acts on it. Only an absolute http(s) URL is followed. 410 re-reads the page into its refusal. */
export function downloadOutcome(status: number, body: unknown): DownloadOutcome {
  const url = typeof body === "object" && body !== null ? (body as Record<string, unknown>).url : undefined;
  if (status === 200) return typeof url === "string" && /^https?:\/\//.test(url) ? { kind: "go", url } : { kind: "failed" };
  if (status === 410) return { kind: "refresh" };
  if (status === 429) return { kind: "limit" };
  return { kind: "failed" };
}

export type DownloadDeps = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  go: (url: string) => void;
  refresh: () => void;
};

/**
 * One press of Download (spec 4.2). A fetch POST, never a form post or a navigation to the route: a
 * document request to /api would meet Clerk's handshake redirect for a signed-in visitor (Task 7
 * review). Then the browser goes to the returned 120 s URL, which downloads. Answers the note to show,
 * or null when the browser went somewhere. A 410 re-reads the page AND answers "failed" (final review
 * minor 1): a refusal page unmounts the button and its note together, so the sentence is only ever seen
 * when the page re-reads OPEN again (a scan flip between claim and mint), where a silent button would
 * otherwise press into nothing for ever.
 */
export async function requestDownload(token: string, deps: DownloadDeps): Promise<"limit" | "failed" | null> {
  try {
    const res = await deps.fetch(`/api/s/${encodeURIComponent(token)}/download`, {
      method: "POST", cache: "no-store", referrerPolicy: "no-referrer", headers: { accept: "application/json" },
    });
    const o = downloadOutcome(res.status, await res.json().catch(() => null));
    if (o.kind === "go") deps.go(o.url);
    else if (o.kind === "refresh") {
      deps.refresh();
      return "failed";
    } else return o.kind;
    return null;
  } catch {
    return "failed";
  }
}

/**
 * A busy Download is the same word, dimmed (rule 7: no spinner), through aria-disabled rather than
 * `disabled`, which would drop the keyboard's focus mid-press. A late sentence stands 8px below the
 * button only when it has words. No colour of its own: DOCREQ_CSS paints the button.
 */
export const SHARE_CSS = `.bis-docreq-primary[aria-disabled="true"] { opacity: 0.6; cursor: default; }
.bis-docreq-detail[data-share-note]:not(:empty) { margin-top: 8px; }`;

export type DownloadWords = { limitText: string; failedText: string };

/** After one press: busy clears, and the sentence the answer earns (none when the browser went on). */
export function settleDownload(kind: "limit" | "failed" | null, words: DownloadWords): { busy: false; note: string | null } {
  return { busy: false, note: kind === "limit" ? words.limitText : kind === "failed" ? words.failedText : null };
}

/** The button and its live region, as rendered for a state. Busy keeps the button focusable (aria-disabled). */
export function ShareDownloadView({ label, busy, note, onClick }: {
  label: string; busy: boolean; note: string | null; onClick: () => void;
}) {
  return (
    <>
      <style>{SHARE_CSS}</style>
      <div className="bis-docreq-actions">
        <button type="button" className="bis-docreq-primary" data-share-download aria-disabled={busy} aria-busy={busy || undefined} onClick={onClick}>
          {label}
        </button>
      </div>
      {/* Always present, so a sentence that appears later is announced. */}
      <p role="status" aria-live="polite" className="bis-docreq-detail" data-share-note>{note}</p>
    </>
  );
}

/** The page's one primary (rule 8). Only the token and the words cross to the browser. */
export function ShareDownload({ token, label, limitText, failedText }: {
  token: string; label: string; limitText: string; failedText: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function onClick() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const kind = await requestDownload(token, {
      fetch: (input, init) => fetch(input, init),
      go: (url) => window.location.assign(url),
      refresh: () => router.refresh(),
    });
    const after = settleDownload(kind, { limitText, failedText });
    setNote(after.note);
    setBusy(after.busy);
  }
  return <ShareDownloadView label={label} busy={busy} note={note} onClick={() => void onClick()} />;
}
