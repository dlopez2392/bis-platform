// F-032 §3.1, §3.2: the "Call in to your business" card's pure status logic — no React, no I/O, every branch a
// plain assertion. Task 5 review m-3 (Task 6 brief's must #1): a role the owner line no longer offers (Staff
// demoted to Technician) still gets to remove a cell it already holds, so `offered` is a SEPARATE input from the
// enrolment itself, and a lost offer outranks every other state the enrolment and the switch could otherwise show.
// `ownerLineCardApplies` is the gate the caller runs FIRST — a role with no offer and no enrolment gets no card at
// all (must #1's second half); `ownerLineCardView` assumes that gate already passed, so it only needs to decide
// WHAT the card shows, never WHETHER one renders.
import type { OwnerLineEnrollment } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";

export type OwnerLineCardStep = "cell" | "pin" | "ready" | "off" | "locked" | "stopOnly";
export type OwnerLineCardStatusKey =
  | "ownerLine.card.status.ready" | "ownerLine.card.status.off" | "ownerLine.card.status.locked"
  | "ownerLine.card.status.notOffered" | null;
export type OwnerLineCardView = {
  step: OwnerLineCardStep;
  cell: string | null;
  status: { key: OwnerLineCardStatusKey; params: Record<string, string> };
};

/** US numbers read 956-555-0100; anything else (no cell, or a non-US one) stays as given. */
export function nationalNumber(e164: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/[^0-9]/g, "");
  return e164.startsWith("+1") && d.length === 11 ? `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}` : e164;
}

/**
 * Must #1's gate (Task 5 review m-3): render a card at all only for a role the owner line is offered to, or a
 * role that still holds an enrolment to remove. A caller that skips this and still calls `ownerLineCardView` for
 * a never-offered, never-enrolled membership gets `stopOnly` with no cell — correct in isolation, but a card with
 * nothing to stop, which is why this gate exists: it is the caller's job to never reach that case at all.
 */
export function ownerLineCardApplies(offered: boolean, hasEnrollment: boolean): boolean {
  return offered || hasEnrollment;
}

export function ownerLineCardView(i: {
  enrollment: OwnerLineEnrollment | null; switchOn: boolean; number: string | null; now: Date; zone: string; locale: Locale;
  offered: boolean;
}): OwnerLineCardView {
  const e = i.enrollment;
  const none = { key: null, params: {} } as const;
  // Must #1: a lost offer outranks the ready/off/locked/pin/cell state below — the only thing left to do is stop.
  if (!i.offered) {
    return { step: "stopOnly", cell: nationalNumber(e?.e164 ?? null), status: { key: "ownerLine.card.status.notOffered", params: {} } };
  }
  if (!e || !e.verifiedAt) return { step: "cell", cell: e ? nationalNumber(e.e164) : null, status: none };
  const cell = nationalNumber(e.e164);
  if (!e.pinSetAt) return { step: "pin", cell, status: none };
  if (!i.switchOn) return { step: "off", cell, status: { key: "ownerLine.card.status.off", params: {} } };
  if (e.lockedUntil && new Date(e.lockedUntil) > i.now) {
    const time = new Intl.DateTimeFormat(i.locale === "es" ? "es-US" : "en-US",
      { timeZone: i.zone, hour: "numeric", minute: "2-digit" }).format(new Date(e.lockedUntil)).replace(/ /g, " ");
    return { step: "locked", cell, status: { key: "ownerLine.card.status.locked", params: { time } } };
  }
  return { step: "ready", cell, status: { key: "ownerLine.card.status.ready", params: { number: nationalNumber(i.number) } } };
}
