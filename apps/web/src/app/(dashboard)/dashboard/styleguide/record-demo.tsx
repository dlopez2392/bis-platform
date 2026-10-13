"use client";

import { CalendarCheck } from "lucide-react";
import { AuthorMark } from "@/components/record/author-mark";
import { TimelineItem, TimelineItemSkeleton } from "@/components/record/timeline-item";
import { RecordCardView } from "@/components/record/record-card";
import { RecordHeader } from "@/components/record/record-header";
import { RecordLayout } from "@/components/record/record-layout";
import { m, type MessageKey } from "@/lib/messages";

/**
 * The record kit (S-03 part 1, spec §15) in every state, for the styleguide: the layout at a desk
 * and a phone width (the grid is a CONTAINER query, so a narrow box shows the phone order), the
 * header with all and with no actions, and a card in each state. Specimen words come from the
 * catalogue, so this file adds nothing to the i18n ratchet.
 */
const DEALS = m["record.card.deals"];
const failedText = (title: string) => m["record.card.failed"].replace("{title}", title);
const showText = (title: string) => m["record.card.show"].replace("{title}", title);

const card = (sg: string, over: Partial<Parameters<typeof RecordCardView>[0]> = {}, body: React.ReactNode = <p className="text-sm">{m["record.facts.openDealsOne"]}</p>) => (
  <div data-sg-record-card={sg} className="w-[280px]">
    <RecordCardView id={`sg-${sg}`} title={DEALS} state="ready" skeletonRows={3} errorText={failedText(DEALS)}
      retryLabel={m["record.card.retry"]} showLabel={showText(DEALS)} disclosure={false} open={false} onToggle={() => {}} {...over}>
      {body}
    </RecordCardView>
  </div>
);

const stub = (key: MessageKey) => (
  <RecordCardView id={`sg-${key}`} title={m[key]} state="ready" skeletonRows={2} errorText={failedText(m[key])}
    retryLabel={m["record.card.retry"]} showLabel={showText(m[key])} disclosure={false} open={false} onToggle={() => {}}>
    <p className="text-sm text-muted-foreground">…</p>
  </RecordCardView>
);

const header = (all: boolean, subtitleHref?: string) => (
  <RecordHeader name="Ana García" subtitle={all ? m["record.group.household"].replace("{group}", "García") : null}
    subtitleHref={subtitleHref}
    back={{ href: "/dashboard/styleguide", label: m["record.back"] }}
    actions={all ? [
      { id: "call", label: m["record.action.call"], href: "tel:+19565550100", ariaLabel: m["record.action.callAria"].replace("{name}", "Ana García"), primary: true },
      { id: "text", label: m["record.action.text"], href: "#compose-sms" },
      { id: "email", label: m["record.action.email"], href: "#compose-email" },
      { id: "directions", label: m["record.action.directions"], href: "https://www.google.com/maps/search/?api=1&query=McAllen", external: true },
    ] : []} />
);

// The fixed width sits on the INNER box and the frame around it scrolls: a 1120px box that is
// itself the scroller would still be 1120px wide and push /styleguide sideways on a phone.
const layout = (width: string, idPrefix: string) => (
  <div className="min-w-0 max-w-full overflow-x-auto">
    <div className={`${width} rounded-xl border border-dashed border-[var(--line-strong)]`}>
      <RecordLayout skipLabel={m["record.skipToDetails"]} idPrefix={idPrefix} skipLink={false} header={header(true)} columns={[
        { column: "happening", content: <>{stub("record.card.summary")}{stub("record.card.nextUp")}{stub("record.card.activity")}</> },
        { column: "have", content: <>{stub("groups.title")}{stub("places.title")}{stub("record.card.deals")}</> },
        { column: "who", content: <>{stub("contact.details")}{stub("contact.tags")}{stub("relationships.title")}</> },
      ]} />
    </div>
  </div>
);

// A specimen person's name: a variable, not a JSX literal (the i18n ratchet counts literals).
const PERSON = "Dan López";
const MARKS = [
  { kind: "person", label: PERSON },
  { kind: "ai", label: m["provenance.ai"].replace("{name}", "Sofía") },
  { kind: "automation", label: m["provenance.automation"] },
  { kind: "customer", label: m["provenance.customer"] },
  { kind: "import", label: m["provenance.import"] },
] as const;

export function RecordDemo() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* Two layouts on one page: their own ids, and no skip link (the page has its own). */}
      {layout("w-[1120px]", "sg-desk")}
      {layout("w-[390px]", "sg-phone")}
      {header(true)}
      {header(false)}
      {/* S-03 part 2b: a record header whose subtitle links to the group's own page. */}
      <div data-sg-header-linked>{header(true, "#")}</div>
      <div className="flex flex-wrap gap-4">
        {card("loading", { state: "loading" })}
        {card("ready")}
        {card("empty", { state: "empty" }, <p className="text-sm text-muted-foreground">{m["contact.noOpportunities"]}</p>)}
        {card("error", { state: "error" })}
        {card("closed", { disclosure: true, open: false })}
      </div>
      <div data-sg-author-marks className="flex flex-wrap gap-2">
        {MARKS.map((mk) => <AuthorMark key={mk.kind} kind={mk.kind} label={mk.label} />)}
      </div>
      <div data-sg-timeline-item className="w-[420px] max-w-full rounded-xl border border-border bg-card glass px-4 py-2">
        <TimelineItem kind="booking" icon={CalendarCheck} mark={{ kind: "customer", label: m["provenance.customer"] }}
          verb={m["record.nextUp.booking"].replace("{when}", "Thu, Oct 16 · 10:00 AM")}
          status={{ tone: "accent", word: m["calendar.bookings.status.booked"] }}
          time="Oct 9, 2026, 4:12 PM" dateTime="2026-10-09T21:12:00Z" />
        {/* S-03 part 2b: a row on a household's or business's merged timeline, naming the member it is about. */}
        <TimelineItem kind="booking" icon={CalendarCheck} mark={{ kind: "customer", label: m["provenance.customer"] }}
          subject={{ label: PERSON, href: "#" }}
          verb={m["record.nextUp.booking"].replace("{when}", "Thu, Oct 16 · 10:00 AM")}
          status={{ tone: "accent", word: m["calendar.bookings.status.booked"] }}
          time="Oct 9, 2026, 4:12 PM" dateTime="2026-10-09T21:12:00Z" />
        <TimelineItemSkeleton rows={2} />
      </div>
    </div>
  );
}
