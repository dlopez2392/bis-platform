import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { DocumentView, DocumentsLoad, ScanState } from "./documents-load";

/**
 * What the Documents card shows about virus scanning (spec 3.5), as pure functions the card, the
 * viewer and their tests share. Browser-safe. A row's state is its SHOWN version's (documentView:
 * the newest clean one, else the newest ready one), so a pending NEW version never hides a clean
 * older one; the Versions list shows each version's own state.
 */
export const SCAN_SLOW_MS = 15 * 60_000;
export const POLL_FAST_MS = 5_000;
export const POLL_SLOW_MS = 30_000;
export const POLL_FAST_FOR_MS = 2 * 60_000;

export type RowScan = { kind: "ok" } | { kind: "pending"; slow: boolean } | { kind: "infected" } | { kind: "unscannable" } | { kind: "locked" };

/** `now` is the read's own server instant (DocumentsResponse.now), never the browser's clock. Deviation 6: age from the version's reservation. */
export function rowScan(doc: DocumentView, now: string): RowScan {
  const v = doc.version;
  if (v.scan === "clean") return { kind: "ok" };
  if (v.scan === "pending") return { kind: "pending", slow: Date.parse(now) - Date.parse(v.createdAt) > SCAN_SLOW_MS };
  return { kind: v.scan };
}

const WORD: Readonly<Record<ScanState, MessageKey | null>> = {
  clean: null, pending: "documents.status.scanning", infected: "documents.status.virusRemoved", unscannable: "documents.status.unscannable",
  locked: "documents.status.passwordRemoved",
};

/** Rule 3: the dot's tone and the words, in the reader's language; null for a clean file (the ordinary row). */
export function scanLabel(s: RowScan | ScanState, locale: Locale): { tone: "warn" | "crit"; text: string } | null {
  const state: ScanState = typeof s === "string" ? s : s.kind === "ok" ? "clean" : s.kind;
  const key = WORD[state];
  if (!key) return null;
  const slow = typeof s !== "string" && s.kind === "pending" && s.slow;
  const text = slow ? `${t(m, key, locale)} · ${t(m, "documents.status.scanSlow", locale)}` : t(m, key, locale);
  return { tone: state === "pending" ? "warn" : "crit", text };
}

/** Re-read while any live file has a version Checking: fast for its first two minutes, then slow; null when none is. */
export function nextPollMs(load: DocumentsLoad): number | null {
  if (load.status !== "ready") return null;
  const now = Date.parse(load.data.now);
  let youngest = Number.POSITIVE_INFINITY;
  for (const d of load.data.live) {
    for (const v of d.versions) if (v.scan === "pending") youngest = Math.min(youngest, now - Date.parse(v.createdAt));
  }
  if (youngest === Number.POSITIVE_INFINITY) return null;
  return youngest < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS;
}

/** The viewer's sentence for a file that cannot be opened; null when it can. */
export function viewerNotice(doc: DocumentView): MessageKey | null {
  switch (doc.version.scan) {
    case "clean": return null;
    case "pending": return "documents.viewer.scanning";
    case "infected": return "documents.viewer.virusRemoved";
    case "unscannable": return "documents.viewer.unscannable";
    case "locked": return "documents.viewer.passwordRemoved";
  }
}
