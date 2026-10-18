"use client";

import { createElement, type ReactElement } from "react";
import type { DocumentView } from "@/lib/documents/documents-load";
import type { DocumentsRowView } from "@/lib/documents/account-list";
import {
  RequiredDocumentsSummary,
} from "../accounts/[accountId]/documents/required-documents-summary";
import { DocumentsList } from "../accounts/[accountId]/documents/documents-list";

/**
 * The Documents page's own cards (S-07 3a, spec 3.1 and 3.3): the Owner's Required documents card in
 * every state it has — partial in English and Spanish, off (nothing required), and a failed read — and
 * the account-wide list's three rows (an insurance file expiring soon, an expired permit, and an
 * Owners-only photo on a household, still "Checking"). The Save and Undo are no-ops here (places-demo's
 * reasoning): the styleguide never reaches a server action.
 */
const noopSave = async () => ({ ok: true as const, list: [] as string[] });
const noopUndo = async () => ({ ok: true as const });

/** Exported so a test can render each of the four Required-card states on its own (rule 8's one-primary check). */
export const REQUIRED_DOCUMENTS_DEMO_STATES: ReactElement[] = [
  createElement(RequiredDocumentsSummary, { key: "en", required: ["id", "insurance"], locale: "en", save: noopSave, undo: noopUndo }),
  createElement("div", { key: "es", lang: "es" },
    createElement(RequiredDocumentsSummary, { required: ["id", "insurance"], locale: "es", save: noopSave, undo: noopUndo })),
  createElement(RequiredDocumentsSummary, { key: "off", required: [], locale: "en", save: noopSave, undo: noopUndo }),
  createElement(RequiredDocumentsSummary, { key: "failed", required: null, locale: "en", save: noopSave, undo: noopUndo }),
];

const base: Omit<DocumentView, "id" | "title" | "category" | "createdAt" | "addedOn"> = {
  addedBy: { you: false, name: "Ana" }, deletedAt: null, ownersOnly: false, source: "upload", expiresOn: null,
  version: { id: "sgp-v", contentType: "application/pdf", bytes: 120_000, scan: "clean", createdAt: "2026-10-10T15:00:00.000Z" },
  versions: [{ id: "sgp-v", contentType: "application/pdf", bytes: 120_000, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", scan: "clean" }],
  purging: false,
};
const ROWS: DocumentsRowView[] = [
  {
    doc: { ...base, id: "sgp-1", title: "Liability policy", category: "insurance", createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", expiresOn: "2026-10-29" },
    filedOn: { name: "Ana García", href: "/dashboard/accounts/sg/contacts/sg-c1" },
  },
  {
    doc: { ...base, id: "sgp-2", title: "City permit", category: "permit", createdAt: "2026-09-01T15:00:00.000Z", addedOn: "2026-09-01", expiresOn: "2026-10-01" },
    filedOn: { name: "Luis Pérez", href: "/dashboard/accounts/sg/contacts/sg-c2" },
  },
  {
    doc: { ...base, id: "sgp-3", title: "Roof photo", category: "photo", createdAt: "2026-10-13T15:00:00.000Z", addedOn: "2026-10-13", ownersOnly: true,
      version: { id: "sgp-v3", contentType: "image/jpeg", bytes: 800_000, scan: "pending", createdAt: "2026-10-13T15:00:00.000Z" },
      versions: [{ id: "sgp-v3", contentType: "image/jpeg", bytes: 800_000, createdAt: "2026-10-13T15:00:00.000Z", addedOn: "2026-10-13", scan: "pending" }] },
    filedOn: { name: "Casa García", href: "/dashboard/accounts/sg/groups/sg-g1" },
  },
];

export function DocumentsPageDemo() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">{REQUIRED_DOCUMENTS_DEMO_STATES}</div>
      <DocumentsList accountId="sg" locale="en" today="2026-10-17" now="2026-10-17T15:00:00.000Z" rows={ROWS} />
    </div>
  );
}
