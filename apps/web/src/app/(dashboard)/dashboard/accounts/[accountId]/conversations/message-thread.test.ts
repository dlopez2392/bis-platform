import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { COMPLAINT_ERROR_MARKER } from "@/lib/email/failure-reason";
import type { EmailView } from "@/lib/consent/email-view";

/** A CURRENT reply stop for `eventId`, not yet past the 7-day window — the shape
 *  `readEmailView` (lib/consent/email-view.ts) answers for an address this stop is
 *  still the newest row on. */
function currentReplyView(eventId: string): EmailView {
  return { kind: "stopped", eventId, since: "2026-10-09T16:12:00Z", how: { kind: "reply", expired: false }, canResume: false };
}

// The thread now renders InboundNotice (a client component) for an inbound
// email bubble — pulled in transitively, so its own "use server" action
// module and its own client-side imports need the same mocks a direct test
// of InboundNotice would supply (Global Constraints: a "use server" module
// is never imported into vitest without a vi.mock for it).
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./inbound-actions", () => ({ undoReplyStopAction: vi.fn(), stopEmailsFromReplyAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// S-47e Task 12: HoldingMove ("./holding-move", pulled in transitively like InboundNotice above) binds
// two "use server" modules it never calls in a static render — mocked for the same reason.
vi.mock("./actions", () => ({ moveHoldingThreadAction: vi.fn(), undoMoveHoldingThreadAction: vi.fn() }));
vi.mock("../contacts/relationship-actions", () => ({ searchRelatableContactsAction: vi.fn() }));

const { MessageThread } = await import("./message-thread");

/** The minimal shape `MessageThread` reads off a row — matches `MESSAGE_COLS`
 *  in packages/db/src/messaging.ts (id, conversation_id, channel, direction,
 *  status, provider_message_id, subject, body, error, meta, created_at). */
function message(status: string, error: string | null) {
  return {
    id: "m1", conversation_id: "c1", channel: "email", direction: "outbound",
    status, provider_message_id: null, subject: null, body: "hi", error,
    created_at: "2026-10-05T10:00:00Z",
  };
}

const THREAD_PROPS = {
  accountId: "a1", conversationId: "c1", contactId: "k1", locale: "en" as const,
  visibleSenderIds: new Set<string>(), emailViews: new Map<string, EmailView>(),
  forwardedNames: new Map<string, string>() as ReadonlyMap<string, string>,
};

function html(status: string, error: string | null, timezone = "UTC"): string {
  return renderToStaticMarkup(createElement(MessageThread, {
    messages: [message(status, error)] as never,
    contactName: "Ada",
    composer: null,
    timezone,
    contactLanguage: null,
    ...THREAD_PROPS,
  }));
}

/**
 * D-017. The thread stored WHY an outbound message bounced or failed
 * (`messages.error`) and never showed it — the dot-and-word status alone
 * told the operator something went wrong, never what to tell the customer.
 */
describe("MessageThread's failure reason (D-017)", () => {
  it("shows the plain-language complaint reason for a bounce carrying the complaint marker (mutation: drop the failure-reason paragraph → FAILS)", () => {
    const text = renderedText(html("bounced", COMPLAINT_ERROR_MARKER));
    expect(text).toContain(m["conversations.failureReason.complained"]);
  });

  it("shows the generic bounce reason for a bounce with no marker", () => {
    const text = renderedText(html("bounced", null));
    expect(text).toContain(m["conversations.failureReason.bounced"]);
  });

  it("shows the generic failed reason and NEVER the raw provider string stored in error", () => {
    const raw = "550 5.1.1 mailbox unavailable (Google)";
    const text = renderedText(html("failed", raw));
    expect(text).toContain(m["conversations.failureReason.failed"]);
    expect(text).not.toContain(raw);
  });

  it("shows no failure reason for a message that sent cleanly", () => {
    const text = renderedText(html("sent", null));
    expect(text).not.toContain(m["conversations.failureReason.failed"]);
    expect(text).not.toContain(m["conversations.failureReason.bounced"]);
    expect(text).not.toContain(m["conversations.failureReason.complained"]);
  });
});

/**
 * A bubble's own timestamp rendered through `formatDateTime` — the RUNTIME's
 * zone (server or browser), never the account's — the same bug D-010 fixed
 * for the contacts list and the activity timeline.
 */
describe("MessageThread's bubble timestamp renders in the ACCOUNT's zone, not the runtime's", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a bubble's clock time follows the account's zone (Berlin), not the runtime's (Chicago)", () => {
    vi.stubEnv("TZ", "America/Chicago");
    const msg = { ...message("sent", null), created_at: "2026-10-08T05:00:00.000Z" };
    const text = renderedText(renderToStaticMarkup(createElement(MessageThread, {
      messages: [msg] as never, contactName: "Ada", composer: null, timezone: "Europe/Berlin",
      contactLanguage: null, ...THREAD_PROPS,
    })));
    // 05:00 UTC is 7:00 AM in Berlin but 12:00 AM (midnight) in Chicago.
    expect(text).toContain("7:00 AM");
    expect(text).not.toContain("12:00 AM");
  });
});

describe("inbound bubbles carry the contact's language (S-09 §9, C10)", () => {
  const at = "2026-10-09T16:12:00Z";
  const bubble = (id: string, direction: "inbound" | "outbound", channel: string, body: string) =>
    ({ id, direction, channel, body, subject: null, status: "delivered", error: null, created_at: at }) as never;
  const render = (contactLanguage: "en" | "es" | null) => renderToStaticMarkup(createElement(MessageThread, {
    messages: [bubble("m1", "inbound", "sms", "Necesito cambiar mi cita"), bubble("m2", "outbound", "sms", "Claro"), bubble("m3", "inbound", "voice", "Caller wants a quote.")],
    contactName: "Ana", composer: null, timezone: "UTC", contactLanguage, ...THREAD_PROPS,
  }));
  it("an inbound text takes it; what the business wrote and the call summary do not (mutation: tag every bubble -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<p lang="es"[^>]*>Necesito cambiar mi cita<\/p>/);
    expect(html).not.toMatch(/<p lang="es"[^>]*>Claro<\/p>/);
    expect(html).not.toMatch(/<p lang="es"[^>]*>Caller wants a quote\.<\/p>/);
  });
  it("no language: the customer's words are typed-unknown, lang=\"\" (mutation: use the page's language -> FAILS)", () => {
    expect(render(null)).toMatch(/<p lang=""[^>]*>Necesito cambiar mi cita<\/p>/);
  });
});

/**
 * Task 11: InboundNotice renders ONLY for an inbound email that actually
 * carries inbound-email meta — never for an SMS/voice bubble (which has no
 * such meta at all), never for an inbound email with nothing to say.
 */
describe("MessageThread renders InboundNotice only for a filed inbound email", () => {
  const at = "2026-10-09T16:12:00Z";
  const bubble = (direction: "inbound" | "outbound", channel: string, meta: unknown) =>
    ({ id: "m1", direction, channel, body: "hi", subject: null, status: "delivered", error: null, created_at: at, meta }) as never;
  const render = (msg: unknown, emailViews: Map<string, EmailView> = THREAD_PROPS.emailViews) => renderToStaticMarkup(createElement(MessageThread, {
    messages: [msg] as never, contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: null, ...THREAD_PROPS, emailViews,
  }));

  it("an inbound email with a recorded stop renders data-reply-stopped (mutation: render InboundNotice for every inbound → the SMS case below would also carry it, FAILS)", () => {
    const html = render(bubble("inbound", "email", {
      inbound_email_id: "re_1", attachment_count: 0, consent: { kind: "stopped", eventId: "ev_1" },
    }), new Map([[THREAD_PROPS.contactId, currentReplyView("ev_1")]]));
    expect(html).toContain("data-reply-stopped");
  });

  it("an inbound SMS with an empty meta renders no inbound-email notice at all", () => {
    const html = render(bubble("inbound", "sms", {}));
    expect(html).not.toContain("data-reply-stopped");
    expect(html).not.toContain("data-reply-maybe");
  });
});

/**
 * Orchestrator ruling (Task 11, visibility): a Technician may not act for a
 * household member they cannot see. `page.tsx` resolves which of the
 * thread's own `meta.sender.contact_id`s are visible under the request
 * client (RLS) and passes that set down as `visibleSenderIds`; a bubble
 * whose own sender is NOT in it withholds its button even though the
 * status itself still shows.
 */
describe("MessageThread withholds a household-member bubble's button when its sender is not in visibleSenderIds", () => {
  const at = "2026-10-09T16:12:00Z";
  const bubble = (senderContactId: string) =>
    ({
      id: "m1", direction: "inbound", channel: "email", body: "hi", subject: null, status: "delivered", error: null, created_at: at,
      meta: {
        inbound_email_id: "re_1", attachment_count: 0,
        sender: { contact_id: senderContactId, first_name: "Luis", last_name: "Ruiz" },
        consent: { kind: "stopped", eventId: "ev_1" },
      },
    }) as never;
  const emailViews = new Map([["luis", currentReplyView("ev_1")]]);
  const render = (senderContactId: string, visibleSenderIds: Set<string>) => renderToStaticMarkup(createElement(MessageThread, {
    messages: [bubble(senderContactId)] as never, contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: null,
    ...THREAD_PROPS, visibleSenderIds, emailViews,
  }));

  it("the sender is NOT visible: the stop still shows, no Undo button (mutation: ignore visibleSenderIds → FAILS)", () => {
    const html = render("luis", new Set());
    expect(html).toContain("data-reply-stopped");
    expect(html).not.toContain("<button");
  });

  it("the sender IS visible: the Undo button renders", () => {
    const html = render("luis", new Set(["luis"]));
    expect(html).toContain("data-reply-stopped");
    expect(html).toContain("<button");
  });

  it("no sender at all (the thread's own contact, already proven visible by page.tsx): the button renders regardless of visibleSenderIds", () => {
    const msg = {
      id: "m1", direction: "inbound", channel: "email", body: "hi", subject: null, status: "delivered", error: null, created_at: at,
      meta: { inbound_email_id: "re_1", attachment_count: 0, consent: { kind: "stopped", eventId: "ev_1" } },
    } as never;
    const html = renderToStaticMarkup(createElement(MessageThread, {
      messages: [msg] as never, contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: null,
      ...THREAD_PROPS, visibleSenderIds: new Set<string>(),
      emailViews: new Map([[THREAD_PROPS.contactId, currentReplyView("ev_1")]]),
    }));
    expect(html).toContain("<button");
  });
});

/**
 * Fix round 1 (UI review, important #2): the bubble passes along the
 * server-computed `stopIsCurrent`/`initiallyExpired`/`chipActionable`
 * flags (`currentStopState`, `lib/consent/email-view.ts`'s `EmailView`) —
 * never the filing-time snapshot alone.
 */
describe("MessageThread reflects the stop's CURRENT state via emailViews", () => {
  const at = "2026-10-09T16:12:00Z";
  const stoppedBubble = () => ({
    id: "m1", direction: "inbound", channel: "email", body: "hi", subject: null, status: "delivered", error: null, created_at: at,
    meta: { inbound_email_id: "re_1", attachment_count: 0, consent: { kind: "stopped", eventId: "ev_1" } },
  }) as never;
  const render = (view: EmailView | undefined) => renderToStaticMarkup(createElement(MessageThread, {
    messages: [stoppedBubble()], contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: null,
    ...THREAD_PROPS, emailViews: view ? new Map([[THREAD_PROPS.contactId, view]]) : new Map(),
  }));

  it("the stop is still current and under 7 days: the Undo button renders (mutation: ignore emailViews → FAILS)", () => {
    expect(render(currentReplyView("ev_1"))).toContain("<button");
  });

  it("past the 7-day window: no button, the expired sentence shows", () => {
    const html = render({ kind: "stopped", eventId: "ev_1", since: "2026-09-01T00:00:00Z", how: { kind: "reply", expired: true }, canResume: false });
    expect(html).not.toContain("<button");
    expect(renderedText(html)).toContain(m["conversations.reply.stopExpired"]);
  });

  it("no view at all (contact not visible, read failed, or no email on file): no stop notice at all (mutation: default to showing it → FAILS)", () => {
    expect(render(undefined)).not.toContain("data-reply-stopped");
  });

  it("a DIFFERENT event is now the newest row (this one was superseded): no stop notice at all", () => {
    expect(render(currentReplyView("ev_9"))).not.toContain("data-reply-stopped");
  });
});

/**
 * S-06 part 2 (spec §1, G4): a forward filed on the record says who on the team forwarded it. The
 * name is the page's (listPeopleNames on the REQUEST client); an id it could not name, or a forward
 * from the account's own reply-to mailbox, reads "someone on the team" (DESIGN.md provenance). The
 * line is in the STAFF member's language while the body keeps the customer's.
 */
describe("MessageThread names who forwarded a filed email (S-06 part 2)", () => {
  const at = "2026-10-09T16:12:00Z";
  const forward = (forwardedBy: string | null) => ({
    id: "m1", direction: "inbound", channel: "email", body: "Hola, necesito una cita", subject: null, status: "delivered",
    error: null, created_at: at,
    meta: { inbound_email_id: "re_1", attachment_count: 0, consent: { kind: "none" }, forwarded: true, forwarded_by: forwardedBy },
  });
  const reply = {
    id: "m2", direction: "inbound", channel: "email", body: "Thanks!", subject: null, status: "delivered", error: null, created_at: at,
    meta: { inbound_email_id: "re_2", attachment_count: 0, consent: { kind: "none" } },
  };
  const NAMES: ReadonlyMap<string, string> = new Map([["user_maria", "Maria Lopez"]]);
  const render = (msgs: unknown[], locale: "en" | "es", names: ReadonlyMap<string, string> = NAMES) => renderToStaticMarkup(createElement(MessageThread, {
    messages: msgs as never, contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: "es",
    ...THREAD_PROPS, locale, forwardedNames: names,
  }));
  const line = (html: string) => html.match(/<p[^>]*data-forwarded=""[^>]*>[^<]*<\/p>/)?.[0] ?? "";

  it("a named forwarder, English: the line in the staff member's lang, the body in the customer's (mutation: drop lang={locale} -> FAILS)", () => {
    const html = render([forward("user_maria")], "en");
    expect(renderedText(line(html)).trim()).toBe("Forwarded by Maria Lopez · team");
    expect(line(html)).toMatch(/^<p lang="en"/);
    expect(html).toMatch(/<p lang="es"[^>]*>Hola, necesito una cita<\/p>/);
  });

  it("a named forwarder, Spanish (mutation: hard-code English -> FAILS)", () => {
    const html = render([forward("user_maria")], "es");
    expect(renderedText(line(html)).trim()).toBe("Reenviado por Maria Lopez · equipo");
    expect(line(html)).toMatch(/^<p lang="es"/);
  });

  it("an id the reader cannot name, and the reply-to mailbox's own forward, read someone on the team, in both languages (mutation: print the raw id -> FAILS)", () => {
    for (const html of [render([forward("user_gone")], "en"), render([forward(null)], "en")]) {
      expect(renderedText(line(html)).trim()).toBe("Forwarded by someone on the team");
      expect(html).not.toContain("user_gone");
    }
    expect(renderedText(line(render([forward("user_gone")], "es"))).trim()).toBe("Reenviado por alguien del equipo");
    expect(renderedText(line(render([forward(null)], "es"))).trim()).toBe("Reenviado por alguien del equipo");
  });

  it("a customer's own reply carries no forwarded line (mutation: render the line for every inbound email -> FAILS)", () => {
    const html = render([reply, forward("user_maria")], "en");
    expect(html.match(/data-forwarded=""/g)).toHaveLength(1);
    expect(render([reply], "en")).not.toContain("data-forwarded");
  });
});

describe("web chat bubbles (S-06 part 3, spec §5, §5a; G26)", () => {
  const at = "2026-10-17T15:00:00Z";
  const CHAT_A = "11111111-1111-4111-8111-111111111111";
  const CHAT_B = "22222222-2222-4222-8222-222222222222";
  const chat = (id: string, chatId: string, index: number, direction: "inbound" | "outbound", body: string, matched: boolean) => ({
    id, conversation_id: "c1", channel: "webchat", direction, status: "delivered", provider_message_id: `webchat:${chatId}:${index}`,
    subject: null, body, error: null, created_at: at, author_kind: direction === "inbound" ? "customer" : "ai", author_id: null,
    meta: { webchat: { chat_id: chatId, index, locale: "es", submission_id: "s1", matched_existing: matched } },
  });
  const text = { id: "t1", conversation_id: "c1", channel: "sms", direction: "outbound", status: "delivered", provider_message_id: null,
    subject: null, body: "Le escribimos", error: null, created_at: at, author_kind: "person", author_id: "u1", meta: {} };
  const THREAD = [chat("a0", CHAT_A, 0, "inbound", "¿Hacen bancas?", true), chat("a1", CHAT_A, 1, "outbound", "Sí, con gusto.", true),
    chat("b0", CHAT_B, 0, "inbound", "Hola otra vez", false), text];
  const render = (locale: "en" | "es", personaName: string | null = "Rosa") => renderToStaticMarkup(createElement(MessageThread, {
    messages: THREAD as never, contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: "en", ...THREAD_PROPS, locale, personaName,
  }));
  const footers = (html: string) => [...html.matchAll(/<p lang="(en|es)" class="mt-1[^"]*">([\s\S]*?)<\/p>/g)].map((x) => [x[1], renderedText(x[2]!).replace(/^.*? · /, "")]);

  it("each footer names Web chat and the mark, never a status word; a text keeps its status (mutation: show MESSAGE_STATUS for chat rows → 'Delivered', FAILS; drop the mark → FAILS)", () => {
    expect(footers(render("en"))).toEqual([["en", "Web chat · Customer"], ["en", "Web chat · Rosa · AI"], ["en", "Web chat · Customer"], ["en", "Text · Delivered"]]);
  });

  it("in Spanish for a Spanish-speaking teammate, every footer, the text's too (G26; mutation: messageChannelLabel without the locale → 'Web chat', FAILS)", () => {
    expect(footers(render("es"))).toEqual([["es", "Chat web · Cliente"], ["es", "Chat web · Rosa · IA"], ["es", "Chat web · Cliente"], ["es", "Texto · Entregado"]]);
  });

  it("a chat bubble's words carry the language they chatted in, both sides, whatever the contact's (mutation: use contactLanguage → lang=\"en\" on the visitor's line, FAILS)", () => {
    const html = render("en");
    expect(html).toMatch(/<p lang="es"[^>]*>¿Hacen bancas\?<\/p>/);
    expect(html).toMatch(/<p lang="es"[^>]*>Sí, con gusto\.<\/p>/);
    expect(html).not.toMatch(/<p lang="es"[^>]*>Le escribimos<\/p>/);
  });

  it("the footer's date is in the teammate's language too, against the literal the fixture instant renders to (G26; mutation: drop formatDateTimeInZone's locale → the Spanish date reads English, FAILS)", () => {
    const whole = (html: string) => [...html.matchAll(/<p lang="(en|es)" class="mt-1[^"]*">([\s\S]*?)<\/p>/g)].map((x) => renderedText(x[2]!).replace(/[\u202f\u00a0]/g, " "));
    // ICU builds differ on the space before the day period (U+202F or a plain space); either is the same date.
    expect(whole(render("en"))[0]).toBe("Oct 17, 2026, 3:00 PM · Web chat · Customer");
    expect(whole(render("es"))[0]).toBe("17 oct 2026, 3:00 p.m. · Chat web · Cliente");
  });

  it("a web chat row is the chat's whatever its meta: no status word, the AI mark, no row hook and no line when the meta is missing (M-5; mutation: key the mark on readWebchatMeta → ' · Delivered', FAILS)", () => {
    const bare = { ...chat("z1", CHAT_A, 0, "outbound", "Hola", true), meta: {} };
    const html = renderToStaticMarkup(createElement(MessageThread, {
      messages: [bare] as never, contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: "en", ...THREAD_PROPS, locale: "en", personaName: "Rosa",
    }));
    expect(footers(html)).toEqual([["en", "Web chat · Rosa · AI"]]);
    expect(html).not.toContain("data-webchat-row");
    expect(html).not.toContain("data-webchat-unconfirmed");
  });

  it("no persona name: Sofía (author-mark.ts's own fallback; mutation: print an empty name → ' · AI', FAILS)", () => {
    expect(footers(render("en", null))[1]).toEqual(["en", "Web chat · Sofía · AI"]);
  });

  it("ONE unconfirmed line per matched chat, directly above its first row, in the teammate's language; none for a chat that made the customer (spec §5a; mutation: render it on every row → three, FAILS; drop lang → FAILS)", () => {
    const en = render("en");
    expect(en.match(/data-webchat-unconfirmed/g)).toHaveLength(1);
    expect(en).toMatch(/<p lang="en" data-webchat-unconfirmed=""[^>]*>Matched by the phone or email they typed; not confirmed\.<\/p><div[^>]*data-webchat-row="0"/);
    expect(render("es")).toMatch(/<p lang="es" data-webchat-unconfirmed=""[^>]*>Lo relacionamos por el teléfono o el correo que escribió; no está confirmado\.<\/p>/);
  });

  it("the footer wraps rather than overflows a narrow bubble (DoD: long Spanish and pseudo copy; mutation: whitespace-nowrap → FAILS)", () => {
    const classes = [...render("es").matchAll(/<p lang="es" class="(mt-1[^"]*)">/g)].map((x) => x[1]!);
    // Every bubble's footer, so the loop below can never pass on zero matches.
    expect(classes).toHaveLength(4);
    for (const cls of classes) {
      expect(cls).toContain("break-words");
      expect(cls).not.toMatch(/nowrap|truncate/);
    }
  });
});

describe("a bubble never widens the thread at phone width (CI e2e phone-width.spec.ts)", () => {
  it("the subject and body break a long unbroken word inside the bubble (mutation: drop break-words from the body → FAILS)", () => {
    const long = { id: "w1", conversation_id: "c1", channel: "email", direction: "inbound", status: "delivered", provider_message_id: null,
      subject: "https://example.com/a-very-long-link-with-no-spaces-at-all", body: "https://example.com/another-very-long-link-with-no-spaces", error: null, created_at: "2026-10-17T15:00:00Z", meta: {} };
    const html = renderToStaticMarkup(createElement(MessageThread, {
      messages: [long] as never, contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: null, ...THREAD_PROPS,
    }));
    const subject = html.match(/<p lang=""[^>]*class="([^"]*)">https:\/\/example\.com\/a-very/)?.[1] ?? "";
    const body = html.match(/<p lang=""[^>]*class="([^"]*)">https:\/\/example\.com\/another/)?.[1] ?? "";
    expect(subject.split(" ")).toContain("break-words");
    expect(body.split(" ")).toContain("break-words");
  });
});

/**
 * S-47e Task 12: the Notice and the "Move to…" menu, only for a holding thread. `contactName` already
 * carries the holding label (the PAGE computes it via `holdingLabel`); this component just shows it.
 */
describe("MessageThread's holding Notice and Move (S-47e Task 12)", () => {
  const renderHolding = (
    holding: { number: string; canMove: boolean; holdingContactId: string; people: { id: string; name: string }[] } | null,
    locale: "en" | "es" = "en",
  ) => renderToStaticMarkup(createElement(MessageThread, {
    messages: [message("sent", null)] as never, contactName: "Shared number (956) 555-0142", composer: null,
    timezone: "UTC", contactLanguage: null, ...THREAD_PROPS, locale, holding,
  }));

  it("names the holding label with data-thread-name, and the Notice in English (mutation: drop the Notice -> FAILS)", () => {
    const html = renderHolding({ number: "+19565550142", canMove: true, holdingContactId: "hc1", people: [] });
    // T17 design review I-1, M-5: the label carries the reader's lang; the number never splits; the row wraps
    // (the Move button drops below at 360px) and the label may shrink.
    expect(html).toContain('<div class="flex flex-wrap items-center justify-between gap-2"><p data-thread-name="" lang="en" class="min-w-0 text-[13.5px] font-semibold text-card-foreground">Shared number <span class="whitespace-nowrap">(956) 555-0142</span></p>');
    // M-1: a standing explanation is a note, not an alert (mutation: keep role="alert" -> FAILS).
    expect(html).toMatch(/<div role="note" data-slot="notice"/);
    expect(html).not.toContain('role="alert"');
    expect(renderedText(html)).toContain(
      "These texts came from (956) 555-0142, a phone more than one customer uses, so they aren't filed under anyone yet. Move them to the right person.",
    );
  });

  it("Spanish, word for word (mutation: hard-code English -> FAILS)", () => {
    const html = renderHolding({ number: "+19565550142", canMove: true, holdingContactId: "hc1", people: [] }, "es");
    expect(renderedText(html)).toContain(
      "Estos mensajes llegaron desde el (956) 555-0142, un teléfono que usa más de un cliente, así que todavía no están en el registro de ningún cliente. Muévalos a la persona correcta.",
    );
    // I-1: the Spanish label is marked Spanish (mutation: no lang on the label -> FAILS).
    expect(html).toContain('<p data-thread-name="" lang="es" class="min-w-0 text-[13.5px] font-semibold text-card-foreground">Número compartido <span class="whitespace-nowrap">(956) 555-0142</span></p>');
  });

  it("canMove renders the Move button; canMove:false renders the Notice with no Move button (mutation: ignore canMove -> FAILS)", () => {
    const yes = renderHolding({ number: "+19565550142", canMove: true, holdingContactId: "hc1", people: [] });
    expect(yes).toContain('data-holding-move=""');
    const no = renderHolding({ number: "+19565550142", canMove: false, holdingContactId: "hc1", people: [] });
    expect(no).not.toContain('data-holding-move=""');
    expect(no).toContain("These texts came from");
  });

  it("no holding prop at all: no Notice, no Move button (control)", () => {
    const html = renderHolding(null);
    expect(html).not.toContain('data-holding-move=""');
    expect(html).not.toContain("These texts came from");
  });
});

/**
 * S-47e Task 12: a non-holding thread's header changes ONLY by the new `data-thread-name` attribute and
 * its wrapping row (Task 16's e2e locator needs the attribute on every thread, holding or not) — the
 * baseline below was captured by running THIS file's own `html()` helper against message-thread.tsx
 * BEFORE this task's edit, so a stray change anywhere else in the render (an accidental Notice, a moved
 * bubble) fails this byte comparison, not merely a toContain substring.
 */
describe("MessageThread's header for a non-holding thread is unchanged byte-for-byte apart from the known header substitution", () => {
  const BEFORE_WHOLE =
    '<div class="flex flex-col rounded-xl border border-border bg-card glass lg:max-h-[calc(100vh-173px)]">'
    + '<div class="border-b border-[var(--row-line)] px-4 py-3">'
    + '<p class="text-[13.5px] font-semibold text-card-foreground">Ada</p></div>'
    + '<div class="flex-1 space-y-3 overflow-y-auto px-4 py-4">'
    + '<div class="max-w-[75%] rounded-[var(--radius-ctl)] px-3 py-2 ml-auto bg-[var(--accent-dim)]">'
    + '<p class="whitespace-pre-wrap break-words text-sm text-card-foreground">hi</p>'
    + '<p lang="en" class="mt-1 break-words text-xs text-muted-foreground">Oct 5, 2026, 10:00 AM · Sent</p>'
    + '</div></div><div class="border-t border-[var(--row-line)] p-4"></div></div>';
  const OLD_HEADER = '<div class="border-b border-[var(--row-line)] px-4 py-3"><p class="text-[13.5px] font-semibold text-card-foreground">Ada</p></div>';
  const NEW_HEADER = '<div class="border-b border-[var(--row-line)] px-4 py-3"><div class="flex items-center justify-between gap-2"><p data-thread-name="" class="text-[13.5px] font-semibold text-card-foreground">Ada</p></div></div>';

  it("substituting the NEW header back for the OLD one reproduces the pre-edit baseline byte for byte (mutation: render the Notice/Move unconditionally -> FAILS; mutation: change an unrelated bubble class -> FAILS)", () => {
    const after = html("sent", null);
    expect(after).toContain(NEW_HEADER);
    expect(after.replace(NEW_HEADER, OLD_HEADER)).toBe(BEFORE_WHOLE);
  });
});
