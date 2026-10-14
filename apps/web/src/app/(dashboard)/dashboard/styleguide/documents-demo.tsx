"use client";

import type { DocumentsLoad, DocumentView } from "@/lib/documents/documents-load";
import { m } from "@/lib/messages";
import { DocumentsCardView } from "../accounts/[accountId]/contacts/documents-card";
import { DocumentUploadPanel } from "../accounts/[accountId]/contacts/document-upload-panel";

/**
 * The Documents card (S-07 part 1, spec 4) in every state it has, in both languages, and with its upload
 * panel open mid-batch (one file uploading, one being checked, one refused with its Retry; the header's
 * Upload gives way to the panel's, rule 8). A client component of its own because the card's handlers
 * are functions a server page cannot hand down (places-demo.tsx's reasoning); here they do nothing.
 * The loaded card shows a contract expiring in 12 days (a warn dot), a camera photo you took, an ID
 * that expired (a crit dot) and is Owners only (a lock and the word), and one file in the trash. Tab
 * through it to see the focus rings.
 */
const base: Omit<DocumentView, "id" | "title" | "category" | "createdAt"> = {
  addedBy: { you: false, name: "Ana" }, deletedAt: null, ownersOnly: false, source: "upload", expiresOn: null,
  version: { id: "sg-v", contentType: "application/pdf", bytes: 120_000 },
};
const DATA: Extract<DocumentsLoad, { status: "ready" }>["data"] = {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "sg-c" }, capped: false,
  live: [
    { ...base, id: "sg-1", title: "Signed contract", category: "contract", createdAt: "2026-10-10T15:00:00.000Z", expiresOn: "2026-10-25" },
    { ...base, id: "sg-2", title: "Roof, before", category: "photo", source: "camera", createdAt: "2026-10-12T15:00:00.000Z",
      addedBy: { you: true, name: null }, version: { id: "sg-v2", contentType: "image/jpeg", bytes: 800_000 } },
    { ...base, id: "sg-3", title: "Driver license", category: "id", createdAt: "2026-09-01T15:00:00.000Z", ownersOnly: true,
      expiresOn: "2026-10-01", addedBy: { you: false, name: null } },
  ],
  trashed: [{ ...base, id: "sg-4", title: "Old estimate", category: "estimate", createdAt: "2026-08-01T15:00:00.000Z", deletedAt: "2026-10-10T15:00:00.000Z" }],
};
const READY: DocumentsLoad = { status: "ready", data: DATA };
const EMPTY: DocumentsLoad = { status: "ready", data: { ...DATA, live: [], trashed: [] } };
const noop = () => {};
const handlers = { trash: async () => {}, restore: async () => {}, setOwnersOnly: async () => {}, download: async () => {}, changed: noop };
const common = { accountId: "sg", canManage: true, handlers, onRetry: noop, onFiles: noop, onOpen: noop, panel: null };
const box = "min-w-0 rounded-[var(--radius-card)] border border-border p-4";
const file = (name: string) => new File([new Uint8Array(1)], name);

function PanelOpen() {
  return (
    <DocumentUploadPanel locale="en" ownersOnly expiresOn="" canChooseOwnersOnly busy={false}
      files={[
        { key: "a", file: file("lease.pdf"), title: "lease", category: "contract", phase: { kind: "uploading", percent: 45 } },
        { key: "b", file: file("roof.jpg"), title: "roof", category: "photo", phase: { kind: "checking" } },
        { key: "c", file: file("plans.pdf"), title: "plans", category: "other", phase: { kind: "failed", error: "documents.error.quota" } },
      ]}
      onCategory={noop} onRemove={noop} onOwnersOnly={noop} onExpires={noop} onUpload={noop} onRetry={noop} onCancel={noop} />
  );
}

export function DocumentsDemo() {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2" data-testid="styleguide-documents">
      <div className={box}><DocumentsCardView {...common} load={READY} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box} lang="es"><DocumentsCardView {...common} load={READY} emptyText={m["documents.empty.contact.es"]} locale="es" /></div>
      <div className={box}><DocumentsCardView {...common} load={EMPTY} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box}><DocumentsCardView {...common} load={{ status: "loading" }} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box}><DocumentsCardView {...common} load={{ status: "error" }} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box}>
        <DocumentsCardView {...common} load={READY} emptyText={m["documents.empty.contact"]} locale="en" panel={<PanelOpen />} />
      </div>
    </div>
  );
}
