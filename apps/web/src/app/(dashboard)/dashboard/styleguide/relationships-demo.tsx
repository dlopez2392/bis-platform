"use client";

import { LocaleProvider } from "@/components/locale-provider";
import type { RelationshipView } from "@/lib/contacts/relationship-view";
import type { RelationshipsLoad } from "@/lib/contacts/relationships-load";
import { RelationshipsCardView } from "../accounts/[accountId]/contacts/relationships-card";

/**
 * The Related people card (relationships spec §7) in every state it has, in both languages. A
 * client component of its own because the card's handlers are functions a server page cannot hand
 * down (assign-demo.tsx's reasoning); here they do nothing. The loaded card shows a chip with both
 * toggles and the word-form select, a person not on the reader's list (no name, no controls, C5),
 * and a flag the label already is (a word, not a toggle). Tab through it to see the focus rings.
 */
const ANA: RelationshipView = {
  id: "sg-r1", labelKey: "parent", customLabel: null, namedSide: "a",
  person: { id: "sg-ana", firstName: "Ana", lastName: "Ramírez" },
  namedForm: "f", subjectForm: null, canPickUp: true, isEmergency: false, lockedFlag: null,
};
const HIDDEN: RelationshipView = {
  id: "sg-r2", labelKey: "parent", customLabel: null, namedSide: "a", person: null,
  namedForm: "m", subjectForm: null, canPickUp: false, isEmergency: true, lockedFlag: null,
};
const LEO: RelationshipView = {
  id: "sg-r3", labelKey: "emergency_contact", customLabel: null, namedSide: "a",
  person: { id: "sg-leo", firstName: "Leo", lastName: "Garza" },
  namedForm: null, subjectForm: null, canPickUp: false, isEmergency: true, lockedFlag: "isEmergency",
};
const SUBJECT = { firstName: "Sofía", lastName: "Ramírez" };
const READY: RelationshipsLoad = { status: "ready", subject: SUBJECT, views: [ANA, HIDDEN, LEO] };
const STATES: RelationshipsLoad[] = [{ status: "ready", subject: SUBJECT, views: [] }, { status: "loading" }, { status: "error" }];

const noop = () => {};
const handlers = { onRetry: noop, onToggle: noop, onForm: noop, onRemove: noop, addSlot: null };

export function RelationshipsDemo() {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2" data-testid="styleguide-relationships">
      <div className="min-w-0 rounded-[var(--radius-card)] border border-border p-4">
        <RelationshipsCardView accountId="sg" load={READY} {...handlers} />
      </div>
      <div className="min-w-0 rounded-[var(--radius-card)] border border-border p-4">
        <LocaleProvider locale="es">
          <RelationshipsCardView accountId="sg" load={READY} {...handlers} />
        </LocaleProvider>
      </div>
      {STATES.map((load) => (
        <div key={load.status === "ready" ? "empty" : load.status} className="min-w-0 rounded-[var(--radius-card)] border border-border p-4">
          <RelationshipsCardView accountId="sg" load={load} {...handlers} />
        </div>
      ))}
    </div>
  );
}
