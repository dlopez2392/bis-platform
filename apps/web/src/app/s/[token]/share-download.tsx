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
 * or null when the browser went somewhere or the page re-reads.
 */
export async function requestDownload(token: string, deps: DownloadDeps): Promise<"limit" | "failed" | null> {
  try {
    const res = await deps.fetch(`/api/s/${encodeURIComponent(token)}/download`, {
      method: "POST", cache: "no-store", referrerPolicy: "no-referrer", headers: { accept: "application/json" },
    });
    const o = downloadOutcome(res.status, await res.json().catch(() => null));
    if (o.kind === "go") deps.go(o.url);
    else if (o.kind === "refresh") deps.refresh();
    else return o.kind;
    return null;
  } catch {
    return "failed";
  }
}

/** A busy Download is the same word, dimmed (rule 7: no spinner). No colour of its own: DOCREQ_CSS paints the button. */
export const SHARE_CSS = `.bis-docreq-primary:disabled { opacity: 0.6; cursor: default; }`;

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
    setNote(kind === "limit" ? limitText : kind === "failed" ? failedText : null);
    setBusy(false);
  }
  return (
    <>
      <style>{SHARE_CSS}</style>
      <div className="bis-docreq-actions">
        <button type="button" className="bis-docreq-primary" data-share-download disabled={busy} aria-busy={busy || undefined} onClick={() => void onClick()}>
          {label}
        </button>
      </div>
      {/* Always present, so a sentence that appears later is announced. */}
      <p role="status" aria-live="polite" className="bis-docreq-detail" data-share-note>{note}</p>
    </>
  );
}
