import type { CallState } from "./call-state";

/** Rendered in place of an empty section so the model cannot read blank as "unknown". */
const NONE = "(none)";

function bookedAppointments(state: CallState) {
  return state.bookings.filter((b) => b.status === "booked");
}

function capturedIntake(state: CallState) {
  return state.leads.filter((l) => Object.values(l.fields ?? {}).some((v) => String(v).trim()));
}

/**
 * Input for the staff summary.
 *
 * BOOKED and INTAKE used to render blank when empty, so the model was asked to
 * "note booked appointments and intake captured" against a section that simply
 * was not there — and it filled in the expected shape. Three production calls
 * were recorded `abandoned` while their summaries asserted appointments and
 * captured phone numbers; one of them had a single transcript event, which
 * cannot support that sentence. The sections are now explicitly `(none)`.
 */
export function buildSummaryInput(state: CallState): string {
  const tr = state.transcript.map((t) => `${t.role}: ${t.text}`).join("\n");
  const appts = bookedAppointments(state)
    .map((b) => `- ${b.contactName} @ ${b.startsAt}`)
    .join("\n");
  const intake = capturedIntake(state)
    .map((i) => JSON.stringify(i.fields))
    .join("\n");
  return [
    `TRANSCRIPT:\n${tr || "(no speech captured)"}`,
    `BOOKED:\n${appts || NONE}`,
    `INTAKE:\n${intake || NONE}`,
  ].join("\n\n");
}

/**
 * What the call actually produced, stated from stored state rather than from
 * the model. This leads the saved summary so the first line a human reads is
 * never a guess — it is what the system will act on.
 */
export function summaryFactLine(state: CallState): string {
  const booked = bookedAppointments(state);
  const intake = capturedIntake(state);
  const parts: string[] = [];

  if (booked.length > 0) {
    parts.push(
      `Booked: ${booked.map((b) => `${b.contactName || "caller"} at ${b.startsAt}`).join("; ")}`,
    );
  } else {
    parts.push("Booked: no appointment was recorded");
  }

  parts.push(intake.length > 0 ? "Intake: captured" : "Intake: nothing captured");
  if (state.messages.length > 0) parts.push(`Messages: ${state.messages.length}`);
  return `RECORDED — ${parts.join(" · ")}.`;
}

export interface SummaryCheck {
  /** Prose says an appointment was booked; stored state has none. */
  claimsBooking: boolean;
  /** Prose says contact details were captured; stored state has none. */
  claimsIntake: boolean;
}

const BOOKING_CLAIM =
  /\b(?:appointment|assessment|consultation|meeting)\b[^.]*\b(?:booked|scheduled|confirmed|set up)\b|\b(?:booked|scheduled)\b[^.]*\b(?:appointment|assessment|consultation|meeting)\b/i;

const INTAKE_CLAIM =
  /\b(?:intake|contact (?:information|details)|phone number|email address)\b[^.]*\b(?:captured|collected|provided|received|includes?|obtained)\b|\b(?:captured|collected|provided|obtained)\b[^.]*\b(?:intake|contact (?:information|details)|phone number|email address)\b/i;

const NEGATION = /\b(?:no|not|never|without|declined|unable|did ?n[o']t|was ?n[o']t|were ?n[o']t)\b/i;

/** Sentence-level so "No follow-up needed." cannot mask a claim in the next sentence. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertsWithoutNegation(text: string, claim: RegExp): boolean {
  return sentences(text).some((s) => claim.test(s) && !NEGATION.test(s));
}

/**
 * Does the prose assert something the stored state contradicts? Pure, so the
 * failure that shipped to production is testable without placing a call.
 */
export function checkSummaryAgainstState(summary: string, state: CallState): SummaryCheck {
  return {
    claimsBooking: bookedAppointments(state).length === 0 && assertsWithoutNegation(summary, BOOKING_CLAIM),
    claimsIntake: capturedIntake(state).length === 0 && assertsWithoutNegation(summary, INTAKE_CLAIM),
  };
}

/**
 * The summary as stored, emailed and shown on the dashboard: the recorded facts
 * first, then a warning when the prose disagrees with them, then the prose.
 *
 * The prose is kept rather than discarded — if the model claimed a booking, the
 * likeliest reason is that the caller was TOLD one happened, which is the most
 * important thing on the page, not something to hide.
 */
export function composeSummary(prose: string, state: CallState): string {
  const check = checkSummaryAgainstState(prose, state);
  const blocks = [summaryFactLine(state)];

  if (check.claimsBooking || check.claimsIntake) {
    const claimed = [
      check.claimsBooking ? "an appointment" : null,
      check.claimsIntake ? "captured contact details" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    blocks.push(
      `⚠ MISMATCH — the notes below mention ${claimed}, which the system did not record. ` +
        `The caller may have been told otherwise on the call. Check before following up.`,
    );
  }

  const trimmed = prose.trim();
  if (trimmed) blocks.push(trimmed);
  return blocks.join("\n\n");
}
