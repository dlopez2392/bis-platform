"use client";

import { Dialog } from "@/components/ui/dialog";
import { ArchiveControls, ArchivedBanner } from "../accounts/[accountId]/contacts/archive-controls";
import { DeleteDialogBody, type BlockersState } from "../accounts/[accountId]/contacts/bulk-action-bar";

/**
 * The contact archive on the styleguide (final review M4): the record header's controls before and after an
 * archive, the archived banner as the record page and the drawer say it, and the bulk delete dialog's body in
 * each state. Specimen words come from the catalogue. The account id is not a real one, so a click here is
 * inert: the server refuses it (held-emails-demo's rule). Nothing is fixed-width, so the page holds at 375px.
 */
const ACCOUNT = "00000000-0000-4000-8000-00000000a5c1";
const CONTACT = "00000000-0000-4000-8000-00000000c0a1";
const ANA = { first_name: "Ana", last_name: "López", email: null, phone: "+19565550100" };
const AT = "2026-10-20T16:00:00Z";
const ZONE = "America/Chicago";
const noop = () => {};

const STATES: { state: string; blockers: BlockersState; count: number }[] = [
  { state: "loading", blockers: { status: "loading" }, count: 3 },
  { state: "blocked", blockers: { status: "ready", kept: ["c1", "c2", "c3"] }, count: 3 },
  { state: "deletable", blockers: { status: "ready", kept: ["c3"] }, count: 3 },
  { state: "error", blockers: { status: "error" }, count: 3 },
];

export function ArchiveDemo() {
  return (
    <div className="flex min-w-0 w-full flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3" data-sg-archive="active">
          <span className="text-sm font-medium">Ana López</span>
          <ArchiveControls accountId={ACCOUNT} contactId={CONTACT} label="Ana López" contact={ANA} archived={null}
            canArchive canDelete timezone={ZONE} variant="page" />
        </div>
        <div className="flex flex-wrap items-center gap-3" data-sg-archive="archived">
          <span className="text-sm font-medium">Ana López</span>
          <ArchiveControls accountId={ACCOUNT} contactId={CONTACT} label="Ana López" contact={ANA}
            archived={{ at: AT, byLabel: "Ana López" }} canArchive canDelete timezone={ZONE} variant="page" />
        </div>
        <ArchivedBanner archived={{ at: AT, byLabel: "Ana López" }} timezone={ZONE} variant="page" locale="en" />
        <ArchivedBanner archived={{ at: AT, byLabel: null }} timezone={ZONE} variant="drawer" locale="en" />
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {STATES.map(({ state, blockers, count }) => (
          // A Dialog root gives the title and description their context; with no Content there is no overlay.
          <div key={state} data-sg-delete-state={state} className="min-w-0 rounded-[var(--radius-card)] border border-[var(--line)] p-4">
            <Dialog open>
              <DeleteDialogBody count={count} typed="" onTyped={noop} files={{ status: "ready", count: 2 }} blockers={blockers}
                view="active" canArchive locale="en" onCancel={noop} onArchiveInstead={noop} onDelete={noop} />
            </Dialog>
          </div>
        ))}
      </div>
    </div>
  );
}
