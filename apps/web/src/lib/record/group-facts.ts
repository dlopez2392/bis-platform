import type { Fact, GroupFacts } from "@bis/db";
import { talkedWhen, type FactsView } from "./record-facts";
import type { Tr } from "./copy";

/**
 * The group summary's one line (S-03 part 2b, spec §8.6). A zero is left out; a failed read is left
 * out AND named (DESIGN.md: omitted, never zeroed). C4: "you can see" qualifies the people fact for
 * EVERY narrow reader (a Technician, or a role that could not be settled), never only when something
 * is hidden: this view is given no hidden count, so it cannot leak one. `names` maps a member's
 * contact id to the name the page built in its own language. The member named is always one this
 * reader can see (the facts read the activity set), so a member with no name in `names` is a
 * customer with no name, and reads as the customer rule's "(no name)", never the team's
 * "Someone on the team".
 */
export function groupFactsView(
  input: { total: Fact<number>; narrow: boolean; facts: GroupFacts; names: Readonly<Record<string, string>> },
  ctx: { zone: string; now: Date; tr: Tr },
): FactsView {
  const { tr, zone, now } = ctx;
  const line: string[] = [];
  const missing: string[] = [];
  if (!input.total.ok) missing.push(tr.text("groupPage.facts.what.people"));
  else if (input.total.value > 0) {
    line.push(tr.count(input.narrow ? "groupPage.facts.peopleVisible" : "groupPage.facts.people", input.total.value));
  }
  const booked = input.facts.bookingsMade;
  if (!booked.ok) missing.push(tr.text("record.facts.what.bookings"));
  else if (booked.value > 0) line.push(tr.count("record.facts.booked", booked.value));
  const talked = input.facts.lastTalked;
  if (!talked.ok) missing.push(tr.text("record.facts.what.talked"));
  else if (talked.value) {
    const id = talked.value.contactId;
    line.push(tr.text("groupPage.facts.lastTalked", {
      when: talkedWhen(talked.value.at, now, zone, tr.locale),
      name: Object.hasOwn(input.names, id) ? input.names[id]! : tr.text("contact.noName"),
      channel: tr.text(`record.facts.channel.${talked.value.channel}` as const),
    }));
  }
  const tag = tr.locale === "es" ? "es-US" : "en-US";
  return {
    line,
    missing: missing.length > 0
      ? tr.text("record.facts.couldntCount", { what: new Intl.ListFormat(tag, { type: "conjunction" }).format(missing) })
      : null,
    allFailed: !input.total.ok && !booked.ok && !talked.ok,
  };
}

/**
 * D7: one plain line, only past the cap, governing the summary, Next up and the timeline below it
 * (plan deviation 12: its own node, so a failed summary never hides it). With the exact count it says
 * "50 of 73"; when the count failed but the scan held more than were shown (`more`,
 * groupActivityMembers), it still says the activity is for 50 people, never a total it does not know.
 */
export function groupCapLine(input: { total: Fact<number>; shown: number; narrow: boolean; more?: boolean }, tr: Tr): string | null {
  if (!input.total.ok) {
    return input.more
      ? tr.text(input.narrow ? "groupPage.cap.unknownTotalVisible" : "groupPage.cap.unknownTotal", { shown: input.shown })
      : null;
  }
  if (input.total.value <= input.shown) return null;
  return tr.text(input.narrow ? "groupPage.cappedVisible" : "groupPage.capped", { shown: input.shown, total: input.total.value });
}
