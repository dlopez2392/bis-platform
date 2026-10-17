"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { TimelineItem } from "@/components/record/timeline-item";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTimeInZone } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { MessageThread } from "../accounts/[accountId]/conversations/message-thread";

/**
 * S-06 part 3 (spec §5, §5a, §7): a lead's website chat on the inbox thread — the visitor's lines
 * (the customer mark) and Sofía's (the AI mark, no status word), each body in the language they
 * chatted in, the one unconfirmed-match line above the chat's first row, and an outbound text after
 * it keeping its status — in English and then in Spanish, for a teammate of each language (G26).
 * Below it, the record's ONE row for the chat, with its count and the "Open chat" ghost link.
 * Every id here is made up; nothing reaches an account.
 */
type Rows = ComponentProps<typeof MessageThread>["messages"];
const CHAT = "00000000-0000-4000-8000-000000000001";
const AT = "2026-10-17T19:14:00Z";
const chatRow = (index: number, direction: "inbound" | "outbound", body: string) => ({
  id: `sg-webchat-${index}`, conversation_id: "sg-convo", channel: "webchat", direction, status: "delivered",
  provider_message_id: `webchat:${CHAT}:${index}`, subject: null, body, error: null, created_at: AT,
  author_kind: direction === "inbound" ? "customer" : "ai", author_id: null,
  meta: { webchat: { chat_id: CHAT, index, locale: "es", submission_id: "sg-submission", matched_existing: true } },
});
const ROWS = [
  chatRow(0, "inbound", "¿Hacen bancas de concreto para el patio?"),
  chatRow(1, "outbound", "Sí, con gusto. ¿Qué medida tiene en mente?"),
  chatRow(2, "inbound", "Como de dos metros. ¿Me pueden llamar mañana?"),
  chatRow(3, "outbound", "Claro. Le dejo sus datos al equipo para que le llame mañana temprano."),
  {
    id: "sg-text", conversation_id: "sg-convo", channel: "sms", direction: "outbound", status: "delivered",
    provider_message_id: null, subject: null, body: "Buenos días, le llamamos a las 9.", error: null, created_at: AT,
    author_kind: "person", author_id: "sg-person", meta: {},
  },
] as unknown as Rows;

const NO_SENDERS: ReadonlySet<string> = new Set();
const NO_VIEWS: ComponentProps<typeof MessageThread>["emailViews"] = new Map();
const NO_NAMES: ReadonlyMap<string, string> = new Map();

export function WebchatDemo() {
  return (
    // CI fix (phone-width.spec.ts): CardContent is a wrapping flex row, so this root's min-content width is
    // its widest child's. One shrinkable column below md, and no fixed pixel width, keep it inside 320px.
    <div className="grid w-full min-w-0 grid-cols-1 gap-4" data-testid="styleguide-webchat">
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        {(["en", "es"] as const).map((locale) => (
          <div key={locale} lang={locale} data-webchat-demo={locale} className="min-w-0">
            <MessageThread
              messages={ROWS}
              contactName="Ana Gómez"
              composer={null}
              timezone="America/Chicago"
              contactLanguage="en"
              accountId="sg"
              conversationId="sg-convo"
              contactId="sg-contact"
              locale={locale}
              visibleSenderIds={NO_SENDERS}
              emailViews={NO_VIEWS}
              forwardedNames={NO_NAMES}
              personaName={null}
            />
          </div>
        ))}
      </div>
      <div data-sg-webchat-row className="w-full min-w-0 max-w-lg rounded-xl border border-border bg-card glass px-4 py-2">
        <TimelineItem
          kind="chat"
          icon={MessagesSquare}
          mark={{ kind: "customer", label: t(m, "provenance.customer", "en") }}
          verb={t(m, "timeline.webchat", "en", { name: "Sofía" })}
          detail={t(m, "timeline.webchatCount", "en", { count: 12 })}
          time={formatDateTimeInZone(AT, "America/Chicago", "en")}
          dateTime={AT}
          action={
            <Link href="#" data-timeline-open-chat
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>
              {t(m, "timeline.openChat", "en")}
            </Link>
          }
        />
      </div>
    </div>
  );
}
