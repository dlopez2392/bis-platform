/**
 * The instant an automation's clock runs from: the LATER of the meeting's
 * end and the operator's status stamp (0026; spec, "Decisions taken after
 * Milestone A shipped"). A client who marks a week's jobs completed on
 * Friday gets review requests on Saturday morning; with ends_at alone
 * everything older than 61h aged out unsent and no counter said so. The
 * no-show nudge runs from laterOf(ends_at, no_show_at) the same way.
 *
 * A null stamp (a row flipped before 0026) or one that cannot be read falls
 * back to the meeting end — the pre-B behaviour exactly.
 */
export function laterOf(endsAt: Date, stampedAt: Date | null): Date {
  if (stampedAt === null || !Number.isFinite(stampedAt.getTime())) return endsAt;
  return stampedAt.getTime() > endsAt.getTime() ? stampedAt : endsAt;
}
