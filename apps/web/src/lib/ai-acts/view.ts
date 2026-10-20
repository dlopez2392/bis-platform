import type { AiAct, AiActKind } from "@bis/db/ai-act-rules";
import { formatDateInZone } from "@/lib/format";
import { authorLabel } from "@/lib/record/author-mark";
import { makeTr, type Tr } from "@/lib/record/copy";
import { purgeNameKey } from "@/lib/documents/rules";
import { controlOf, describeAct, REASON_KEY, stillSafeOf, type ActControl, type ActFacts } from "./kinds";
import { FIELD_LABEL } from "./kinds/contact-field-filled";

/**
 * What one act's timeline row shows (item 8c, plan Task 5 item 3), built on the SERVER and handed to the row
 * as plain data. Pure, and never in a `"use client"` module: the record page builds it during its render
 * (8b-2 final review I-1's rule: a server never calls a client module's export).
 */
export type AiActUndoView =
  | {
    state: "available"; control: ActControl;
    /** Booking controls only: the customer's name for "Let {name} know by email", or, with no email on file,
     *  the sentence that says to call them instead (owner Q3). */
    notify: { name: string } | { none: string } | null;
    /** The name the typed confirmation compares against (the contact control), and the notice's {name}. */
    contactName: string;
    /** The field control's words for the field ("email", "el correo"), for its toast; null otherwise. */
    fieldLabel: string | null;
  }
  | { state: "blocked"; line: string }
  | { state: "undone"; line: string }
  | { state: "unknown" };

export type AiActView = {
  id: string; kind: AiActKind; verb: string; detail: string | null;
  source: { label: string; href: string | null };
  /** The receptionist's name as the account sets it, else Sofía: the field redo toast's {persona}. */
  persona: string;
  undo: AiActUndoView;
};

export type ActViewCtx = {
  tr: Tr; zone: string; personaName: string | null;
  /** The page's ONE names read (`listPeopleNames`), undoers and editors included. */
  names: Readonly<Record<string, string>>;
  viewerId: string | null; accountId: string;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** The customer's name as the record's header shows it, else "(no name)" in the reader's language. The
 *  contact Undo's typed confirmation compares against exactly this (`actions.ts`). */
export function actContactName(contact: Record<string, unknown> | null, tr: Tr): string {
  const name = [str(contact?.first_name), str(contact?.last_name)].filter(Boolean).join(" ");
  return name || tr.text("contact.noName");
}

/**
 * The contact Undo's typed confirmation (rule 6; the `DocumentPurgeForm` shape): the typed text equals the
 * customer's name in `purgeNameKey`'s form. A customer with no name is confirmed by the placeholder the
 * page shows, in either language (the action's own language and the page's may differ). The dialog's
 * button and `undoAiActAction` both ask this, so they can never disagree.
 */
export function typedNameMatches(typed: string, contact: Record<string, unknown>): boolean {
  const key = purgeNameKey(typed);
  if (key === "") return false;
  const name = [str(contact.first_name), str(contact.last_name)].filter(Boolean).join(" ");
  const accepted = name ? [name] : [makeTr("en").text("contact.noName"), makeTr("es").text("contact.noName")];
  return accepted.some((a) => purgeNameKey(a) === key);
}

export function buildActView(act: AiAct, facts: ActFacts | null, ctx: ActViewCtx): AiActView {
  const { tr, zone } = ctx;
  const { verb, detail } = describeAct(act, { tr, zone });
  const day = (iso: string) => formatDateInZone(iso, zone, tr.locale);
  // The web chat has no page of its own to open, so its source is words only.
  const source = act.actor === "voice" && act.callId
    ? { label: tr.text("aiActs.source.call", { date: day(act.createdAt) }), href: `/dashboard/accounts/${ctx.accountId}/calls/${act.callId}` }
    : { label: tr.text("aiActs.source.webchat"), href: null };
  const author = { tr, viewerId: ctx.viewerId, names: ctx.names, personaName: ctx.personaName };
  const persona = ctx.personaName?.trim() || "Sofía";
  const view = { id: act.id, kind: act.kind, verb, detail, source, persona };

  // The stamp is on the act itself, so "Undone by" stands even when the facts read failed.
  if (act.undoneAt) {
    return { ...view, undo: { state: "undone", line: tr.text("aiActs.undoneBy", { name: authorLabel("person", act.undoneBy, author), date: day(act.undoneAt) }) } };
  }
  if (!facts) return { ...view, undo: { state: "unknown" } };

  const safe = stillSafeOf(act, facts);
  if (!safe.ok) {
    const line = safe.reason === "changedBy"
      ? tr.text(REASON_KEY.changedBy, { name: authorLabel("person", facts.editors[act.id] ?? null, author) })
      : tr.text(REASON_KEY[safe.reason]);
    return { ...view, undo: { state: "blocked", line } };
  }
  const control = controlOf(act);
  const contactName = actContactName(facts.contact, tr);
  const notify = control !== "booking" ? null
    : str(facts.contact?.email) ? { name: contactName } : { none: tr.text("aiActs.notify.noEmail", { name: contactName }) };
  const fieldLabel = act.kind === "contact_field_filled" ? tr.text(FIELD_LABEL[act.target.field]) : null;
  return { ...view, undo: { state: "available", control, notify, contactName, fieldLabel } };
}
