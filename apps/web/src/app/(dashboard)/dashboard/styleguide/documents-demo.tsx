"use client";

import type { DocumentsLoad, DocumentView } from "@/lib/documents/documents-load";
import type { DocumentRequestsLoad } from "@/lib/document-requests/requests-load";
import { m } from "@/lib/messages";
import type { RequirementsLoad } from "@/lib/documents/requirements-load";
import { DocumentsCardView, addedWhen, type ChecklistSlot, type DocumentHandlers, type RequestsSlot } from "../accounts/[accountId]/contacts/documents-card";
import { DocumentChecklist } from "../accounts/[accountId]/contacts/document-checklist";
import { DocumentVersionsList } from "../accounts/[accountId]/contacts/document-viewer";
import { DocumentPurgeForm } from "../accounts/[accountId]/contacts/document-purge-dialog";
import { DocumentUploadPanel } from "../accounts/[accountId]/contacts/document-upload-panel";
import { DocumentRequestForm } from "../accounts/[accountId]/contacts/document-request-dialog";
import { DocumentRequestsList } from "../accounts/[accountId]/contacts/document-requests-list";

/**
 * The Documents card (S-07 part 1, spec 4) in every state it has, in both languages, and with its upload
 * panel open mid-batch (one file uploading, one being checked, one refused with its Retry; the header's
 * Upload gives way to the panel's, rule 8). A client component of its own because the card's handlers
 * are functions a server page cannot hand down (places-demo.tsx's reasoning); here they do nothing.
 * The loaded card shows a contract expiring in 12 days (a warn dot), a camera photo you took, an ID
 * that expired (a crit dot) and is Owners only (a lock and the word), and two files in the trash (one whose Delete forever stopped part-way: "Being deleted", no Restore). Tab
 * through it to see the focus rings. Each loaded card shows a contract on its second version, the account above
 * 80% of its space, and Delete forever beside Restore in the trash; the panel card shows a new version
 * uploading; then the viewer's Versions list and the typed-name form on their own.
 * S-07 2b: each card's header offers a ghost "Ask the customer", the Checking estimate is one the customer
 * sent ("Sent by the customer"), and below the cards sit the request form (English with every channel on
 * offer; Spanish with no texting and the Other note's error) and the open requests, loaded (one item
 * received, one waiting) and failed.
 * S-07 2c: the English loaded card carries the required documents ("Required 1 of 4" in its top row, the
 * gaps under it), and below everything the checklist stands alone in its five states: English and Spanish
 * partial (a missing, an expired, a checking and a skipped item), complete with one skipped item, loading,
 * and failed. Every button in it is ghost; the card keeps its one primary, Upload.
 */
const base: Omit<DocumentView, "id" | "title" | "category" | "createdAt" | "addedOn"> = {
  addedBy: { you: false, name: "Ana" }, deletedAt: null, ownersOnly: false, source: "upload", expiresOn: null,
  version: { id: "sg-v", contentType: "application/pdf", bytes: 120_000, scan: "clean", createdAt: "2026-10-10T15:00:00.000Z" },
  versions: [{ id: "sg-v", contentType: "application/pdf", bytes: 120_000, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", scan: "clean" }], purging: false,
};
const DATA: Extract<DocumentsLoad, { status: "ready" }>["data"] = {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "sg-c" }, capped: false,
  live: [
    { ...base, id: "sg-1", title: "Signed contract", category: "contract", createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", expiresOn: "2026-10-25",
      versions: [{ id: "sg-v", contentType: "application/pdf", bytes: 120_000, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", scan: "clean" }, { id: "sg-v0", contentType: "application/pdf", bytes: 98_000, createdAt: "2026-09-28T15:00:00.000Z", addedOn: "2026-09-28", scan: "clean" }] },
    { ...base, id: "sg-2", title: "Roof, before", category: "photo", source: "camera", createdAt: "2026-10-13T02:30:00.000Z", addedOn: "2026-10-12",
      addedBy: { you: true, name: null }, version: { id: "sg-v2", contentType: "image/jpeg", bytes: 800_000, scan: "clean", createdAt: "2026-10-13T02:30:00.000Z" },
      versions: [{ id: "sg-v2", contentType: "image/jpeg", bytes: 800_000, createdAt: "2026-10-13T02:30:00.000Z", addedOn: "2026-10-12", scan: "clean" }] },
    { ...base, id: "sg-3", title: "Driver license", category: "id", createdAt: "2026-09-01T15:00:00.000Z", addedOn: "2026-09-01", ownersOnly: true,
      expiresOn: "2026-10-01", addedBy: { you: false, name: null } },
    // S-07 2a: a Checking file and a removed-by-the-scan file, as a dot and a word (rule 3). S-07 2b: the
    // Checking one came from the customer's request link, so it reads "Sent by the customer".
    { ...base, id: "sg-6", title: "New estimate", category: "estimate", createdAt: "2026-10-13T14:59:00.000Z", addedOn: "2026-10-13",
      source: "customer", addedBy: { you: false, name: null },
      version: { id: "sg-v6", contentType: "application/pdf", bytes: 50_000, scan: "pending", createdAt: "2026-10-13T14:59:00.000Z" },
      versions: [{ id: "sg-v6", contentType: "application/pdf", bytes: 50_000, createdAt: "2026-10-13T14:59:00.000Z", addedOn: "2026-10-13", scan: "pending" }] },
    { ...base, id: "sg-7", title: "Bad upload", category: "other", createdAt: "2026-10-13T14:00:00.000Z", addedOn: "2026-10-13",
      version: { id: "sg-v7", contentType: "application/pdf", bytes: 50_000, scan: "infected", createdAt: "2026-10-13T14:00:00.000Z" },
      versions: [{ id: "sg-v7", contentType: "application/pdf", bytes: 50_000, createdAt: "2026-10-13T14:00:00.000Z", addedOn: "2026-10-13", scan: "infected" }] },
    // Owner ruling 2026-10-15: a password-protected file reads its own words, never the generic "couldn't check".
    { ...base, id: "sg-8", title: "Bank statement", category: "other", createdAt: "2026-10-13T14:00:00.000Z", addedOn: "2026-10-13",
      version: { id: "sg-v8", contentType: "application/pdf", bytes: 50_000, scan: "locked", createdAt: "2026-10-13T14:00:00.000Z" },
      versions: [{ id: "sg-v8", contentType: "application/pdf", bytes: 50_000, createdAt: "2026-10-13T14:00:00.000Z", addedOn: "2026-10-13", scan: "locked" }] },
    // Final whole-branch review item 7: the generic "Couldn't check this file" (not a password — a scan
    // limit, a crash, anything else unscannable carries the same words, spec 3.4).
    { ...base, id: "sg-9", title: "Scanned plans", category: "other", createdAt: "2026-10-13T13:00:00.000Z", addedOn: "2026-10-13",
      version: { id: "sg-v9", contentType: "application/pdf", bytes: 50_000, scan: "unscannable", createdAt: "2026-10-13T13:00:00.000Z" },
      versions: [{ id: "sg-v9", contentType: "application/pdf", bytes: 50_000, createdAt: "2026-10-13T13:00:00.000Z", addedOn: "2026-10-13", scan: "unscannable" }] },
  ],
  trashed: [{ ...base, id: "sg-4", title: "Old estimate", category: "estimate", createdAt: "2026-08-01T15:00:00.000Z", addedOn: "2026-08-01", deletedAt: "2026-10-10T15:00:00.000Z" },
    // A Delete forever that stopped part-way: "Being deleted" as a dot and a word, no Restore; an Owner keeps Delete forever to finish it.
    { ...base, id: "sg-5", title: "Old invoice", category: "invoice", createdAt: "2026-07-01T15:00:00.000Z", addedOn: "2026-07-01", deletedAt: "2026-10-09T15:00:00.000Z", purging: true }],
  space: { used: 4_500_000_000, quota: 5_368_709_120 },
};
const READY: DocumentsLoad = { status: "ready", data: DATA };
const EMPTY: DocumentsLoad = { status: "ready", data: { ...DATA, live: [], trashed: [], space: null } };
const noop = () => {};
/** Inert (PR 1a review M6): the styleguide never reaches a server action, however its rows are used. */
export const demoHandlers: DocumentHandlers = {
  trash: async () => {}, restore: async () => {}, setOwnersOnly: async () => {}, download: async () => {},
  saveField: async (doc, field, value) => ({ ok: true, undoPayload: { documentId: doc.id, field, prior: null, written: value }, shown: value }),
  undoField: async () => ({ ok: true }),
  purge: async () => false,
  changed: noop,
  askCustomer: async () => null, copyRequestLink: async () => {}, revokeRequest: async () => {},
};
const REQUESTS_NOW = "2026-10-15T15:00:00.000Z";
/** Ready with nothing open: each card draws its "Ask the customer" and no list (the lists are drawn on their own below). */
const NO_REQUESTS: DocumentRequestsLoad = { kind: "ready", data: { now: REQUESTS_NOW, channels: { text: true, email: true }, requests: [] } };
const OPEN_REQUESTS: DocumentRequestsLoad = { kind: "ready", data: { now: REQUESTS_NOW, channels: { text: true, email: true }, requests: [
  { id: "sg-r1", channel: "text", createdAt: "2026-10-14T15:00:00.000Z", expiresAt: "2026-10-21T15:00:00.000Z", items: [
    { key: "insurance", category: "insurance", note: null, answered: true },
    { key: "other", category: "other", note: "Pool permit", answered: false },
  ] },
] } };
const requests: RequestsSlot = { load: NO_REQUESTS, onAsk: noop, onRetry: noop, onCopy: noop, onRevoke: noop };
const common = {
  accountId: "sg", canManage: true, handlers: demoHandlers, onRetry: noop, onFiles: noop, onOpen: noop, panel: null,
  versionPhases: {}, onNewVersion: noop, onPurge: noop, requests,
};
const box = "min-w-0 rounded-[var(--radius-card)] border border-border p-4";

const requirements = (items: [string, string][]): RequirementsLoad =>
  ({ kind: "ready", data: { items: items.map(([category, state]) => ({ category, state })) } } as RequirementsLoad);
const PARTIAL = requirements([["contract", "met"], ["insurance", "missing"], ["id", "expired"], ["warranty", "checking"], ["photo", "skipped"]]);
const COMPLETE = requirements([["contract", "met"], ["insurance", "met"], ["photo", "skipped"]]);
const checklistActs = { canSkip: true, canAsk: true, onAsk: noop, onSkip: noop, onUnskip: noop, onRetry: noop };
const cardChecklist: ChecklistSlot = { load: PARTIAL, ...checklistActs };
const standalone = (load: RequirementsLoad, locale: "en" | "es" = "en") => (
  <DocumentChecklist locale={locale} load={load} panelOpen={false} onUpload={noop} {...checklistActs} />
);
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
      <div className={box}><DocumentsCardView {...common} load={READY} emptyText={m["documents.empty.contact"]} locale="en" checklist={cardChecklist} /></div>
      <div className={box} lang="es"><DocumentsCardView {...common} load={READY} emptyText={m["documents.empty.contact.es"]} locale="es" /></div>
      <div className={box}><DocumentsCardView {...common} load={EMPTY} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box}><DocumentsCardView {...common} load={{ status: "loading" }} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box}><DocumentsCardView {...common} load={{ status: "error" }} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box}>
        <DocumentsCardView {...common} load={READY} emptyText={m["documents.empty.contact"]} locale="en" panel={<PanelOpen />}
          versionPhases={{ "sg-1": { kind: "uploading", percent: 60 } }} />
      </div>
      <div className={box}>
        <DocumentVersionsList doc={DATA.live[0]!} locale="en" when={(day) => addedWhen(day, DATA.today, "en")} onDownload={noop} />
      </div>
      <div className={box}>
        <DocumentPurgeForm title={DATA.trashed[0]!.title} versionCount={1} typed="Old est" busy={false} locale="en" onTyped={noop} onCancel={noop} onConfirm={noop} />
      </div>
      <div className={box}>
        <DocumentRequestForm locale="en" name="Ana" channels={{ text: true, email: true }} busy={false} error={null} onSubmit={noop} onCancel={noop} />
      </div>
      <div className={box} lang="es">
        <DocumentRequestForm locale="es" name="Ana" channels={{ text: false, email: true }} initialItems={["insurance", "other"]}
          busy={false} error="documents.request.noteNeeded" onSubmit={noop} onCancel={noop} />
      </div>
      <div className={box}>
        <DocumentRequestsList locale="en" load={OPEN_REQUESTS} onRetry={noop} onCopy={noop} onRevoke={noop} />
      </div>
      <div className={box}>
        <DocumentRequestsList locale="en" load={{ kind: "error" }} onRetry={noop} onCopy={noop} onRevoke={noop} />
      </div>
      <div className={box}>{standalone(PARTIAL)}</div>
      <div className={box} lang="es">{standalone(PARTIAL, "es")}</div>
      <div className={box}>{standalone(COMPLETE)}</div>
      <div className={box}>{standalone({ kind: "loading" })}</div>
      <div className={box}>{standalone({ kind: "error" })}</div>
    </div>
  );
}
