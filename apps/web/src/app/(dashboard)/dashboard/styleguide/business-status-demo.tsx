"use client";

// S-47d fix round D12: the one switch's surfaces as specimens with static props — the menu's trigger in
// both of its namings (the topbar's status words, the card's "Change") and the dashboard status card open,
// closed with its affected rows, running late and in its error state. Every specimen is the REAL component
// (`BusinessStatusMenu`, `BusinessStatusCardView`, `BusinessStatusCardError`); only the data is fixed.
// The account id names no account: opening the menu shows the real items, and choosing one is refused
// by the server without writing anything (an agency session reaches the action, which fails on the id).
// Every specimen sits in a `w-full max-w-md min-w-0` box, so the styleguide's own phone-width sweep
// (`e2e/phone-width.spec.ts`, /dashboard/styleguide at 375px) holds with them.
import { BusinessStatusMenu } from "@/components/business-status-menu";
import { closedWords } from "@/components/topbar-presence";
import { BusinessStatusCardView } from "../accounts/[accountId]/dashboard/business-status-card-view";
import { BusinessStatusCardError } from "../accounts/[accountId]/dashboard/business-status-card-error";
import { toWire, type EffectiveStatus } from "@/lib/business-status/status";
import { topbarLabels } from "@/lib/business-status/labels";
import { m } from "@/lib/messages";
import type { ShellBusinessStatus } from "@/lib/shell/snapshot";
import type { AffectedView } from "../accounts/[accountId]/dashboard/business-status-card-view";

const ACCOUNT = "styleguide";
const TZ = "America/Chicago";
// Monday, June 7 2027, 10:00 in Chicago.
const NOW = new Date("2027-06-07T15:00:00.000Z");

const OPEN: EffectiveStatus = {
  state: "open",
  nextClosedDay: { starts_on: "2027-06-10", ends_on: "2027-06-10", reason: "holiday" },
};
const CLOSED_TODAY: EffectiveStatus = {
  state: "closed_today", reopensAt: new Date("2027-06-08T13:00:00.000Z"), reopensTimeKnown: true,
};
const LATE: EffectiveStatus = { state: "running_late", lateMinutes: 30, endsAt: new Date("2027-06-08T05:00:00.000Z") };
const STORM: EffectiveStatus = { state: "storm", reopensAt: null, reopensTimeKnown: false };

const AFFECTED: AffectedView = {
  capped: false,
  windowTo: new Date("2027-06-08T05:00:00.000Z"),
  appointments: [
    { id: "sg-b1", contactId: "sg-c1", name: "Ana Reyes", startsAt: "2027-06-07T19:00:00.000Z", held: 2, kept: false },
    { id: "sg-b2", contactId: "sg-c2", name: "Luis Ortega", startsAt: "2027-06-07T21:30:00.000Z", held: 0, kept: true },
    { id: "sg-b3", contactId: "sg-c3", name: "", startsAt: "2027-06-07T22:00:00.000Z", held: 1, kept: false },
  ],
};

function status(effective: EffectiveStatus, canChange: ShellBusinessStatus["canChange"] = "all"): ShellBusinessStatus {
  return { effective: toWire(effective), canChange, timezone: TZ, personaName: "Sofía", now: NOW.toISOString() };
}

const box = "w-full min-w-0 max-w-md";

const AFFECTED_ES: AffectedView = { ...AFFECTED, appointments: AFFECTED.appointments.map((a) => ({ ...a, id: `${a.id}-es` })) };

export function BusinessStatusDemo() {
  const closed = topbarLabels(CLOSED_TODAY, TZ, NOW, "en")!;
  const closedEs = topbarLabels(CLOSED_TODAY, TZ, NOW, "es")!;
  return (
    <div className="flex w-full flex-col gap-4" data-testid="styleguide-business-status">
      {/* The trigger: the topbar's own status words (named "<words>, Change today's status"), and Open. */}
      <div className="flex flex-wrap items-center gap-3">
        <BusinessStatusMenu
          accountId={ACCOUNT} status={status(CLOSED_TODAY)} locale="en"
          trigger={<span lang="en">{closedWords("bg-[var(--crit)]", closed.short, closed.full)}</span>}
        />
        <BusinessStatusMenu
          accountId={ACCOUNT} status={status(CLOSED_TODAY)} locale="es"
          trigger={<span lang="es">{closedWords("bg-[var(--crit)]", closedEs.short, closedEs.full)}</span>}
        />
        <BusinessStatusMenu
          accountId={ACCOUNT} status={status(OPEN)} locale="en"
          trigger={<span lang="en">{closedWords("bg-[var(--good)]", m["business.topbar.open"], m["business.topbar.open"])}</span>}
        />
      </div>
      <div className={box}>
        <BusinessStatusCardView
          accountId={ACCOUNT} status={status(OPEN)} effective={OPEN} timezone={TZ} now={NOW}
          locale="en" pseudo={false} affected={null} canAct id="sg-business-status-open"
        />
      </div>
      <div className={box}>
        <BusinessStatusCardView
          accountId={ACCOUNT} status={status(CLOSED_TODAY)} effective={CLOSED_TODAY} timezone={TZ} now={NOW}
          locale="en" pseudo={false} affected={AFFECTED} canAct id="sg-business-status-closed"
        />
      </div>
      <div className={box}>
        <BusinessStatusCardView
          accountId={ACCOUNT} status={status(CLOSED_TODAY)} effective={CLOSED_TODAY} timezone={TZ} now={NOW}
          locale="es" pseudo={false} affected={AFFECTED_ES} canAct id="sg-business-status-closed-es"
        />
      </div>
      <div className={box}>
        <BusinessStatusCardView
          accountId={ACCOUNT} status={status(LATE, "late_only")} effective={LATE} timezone={TZ} now={NOW}
          locale="en" pseudo={false} affected={null} canAct id="sg-business-status-late"
        />
      </div>
      <div className={box}>
        <BusinessStatusCardView
          accountId={ACCOUNT} status={status(STORM, null)} effective={STORM} timezone={TZ} now={NOW}
          locale="en" pseudo={false} affected={{ appointments: [], capped: false, windowTo: NOW }} canAct
          id="sg-business-status-storm"
        />
      </div>
      <div className={box}>
        <BusinessStatusCardError locale="en" id="sg-business-status-error" />
      </div>
    </div>
  );
}
