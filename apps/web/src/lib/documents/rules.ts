import {
  DOCUMENT_TITLE_MAX, type DocumentCategory, type DocumentContentType,
} from "@bis/db/document-rules";
import { cleanEdgeSpace } from "@/lib/inline-rule";
import type { Locale } from "@/lib/i18n/locale";

/** Spec 4.2: up to 10 files open the panel at once. */
export const MAX_BATCH = 10;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
const BY_EXTENSION: Readonly<Record<string, DocumentContentType>> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", docx: DOCX, xlsx: XLSX,
};
const EXTENSION_FOR: Readonly<Record<DocumentContentType, string>> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", [DOCX]: "docx", [XLSX]: "xlsx",
};
/** Word and Excel files are never rendered; the viewer offers Download only (spec 4.3). */
export const OFFICE_TYPES: readonly DocumentContentType[] = [DOCX, XLSX];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).trim().toLowerCase();
}
export const extensionAllowed = (name: string): boolean => Object.hasOwn(BY_EXTENSION, extensionOf(name));
export const extensionForType = (t: DocumentContentType): string => EXTENSION_FOR[t];

/** The type a chosen file declares: its extension decides, and a browser type that disagrees refuses it. */
export function typeForFile(name: string, browserType: string): DocumentContentType | null {
  const ext = extensionOf(name);
  if (!Object.hasOwn(BY_EXTENSION, ext)) return null;
  const byExt = BY_EXTENSION[ext]!;
  return browserType === "" || browserType === byExt ? byExt : null;
}

export const isImageType = (t: DocumentContentType): boolean => t.startsWith("image/");
export const defaultCategory = (t: DocumentContentType): DocumentCategory => (isImageType(t) ? "photo" : "other");

/** The name without its extension, edges cleaned, cut to 200 code points; null when nothing is left. */
export function titleFromFileName(name: string): string | null {
  const trimmed = cleanEdgeSpace(name);
  const dot = trimmed.lastIndexOf(".");
  const base = cleanEdgeSpace(dot > 0 ? trimmed.slice(0, dot) : dot === 0 ? "" : trimmed);
  if (!base) return null;
  return cleanEdgeSpace([...base].slice(0, DOCUMENT_TITLE_MAX).join("")) || null;
}

export function formatMb(bytes: number, locale: Locale): string {
  const n = new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", { maximumFractionDigits: 1 }).format(bytes / 1048576);
  return `${n} MB`;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isDay(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const p = DAY.exec(v);
  if (!p) return false;
  const at = new Date(Date.UTC(Number(p[1]), Number(p[2]) - 1, Number(p[3])));
  return at.getUTCFullYear() === Number(p[1]) && at.getUTCMonth() === Number(p[2]) - 1 && at.getUTCDate() === Number(p[3]);
}
