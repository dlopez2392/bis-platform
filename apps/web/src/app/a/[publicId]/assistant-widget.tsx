"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isTextUIPart, type UIMessage } from "ai";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { labelParts } from "@/lib/forms/linkify";
import { assistantErrorBody, type AssistantStrings } from "@/lib/assistant/public-strings";

type Props = {
  publicId: string;
  /** `?embed=1` — set by `assistant.js`. Decides launcher-vs-always-open,
   *  whether a close button exists at all, and whether this widget talks to
   *  a parent window. */
  embedded: boolean;
  locale: PublicLocale;
  /** The host page the visitor is on, lifted by `assistant.js` off the HOST
   *  page's own url (the iframe's own url can never see it) — forwarded
   *  verbatim in every chat request body. `null` on a direct visit. */
  page: string | null;
  /** Signed server-side at render (`signRenderToken`), bound to this
   *  publicId — see `f/[publicId]/page.tsx`'s identical pattern. */
  token: string;
  /** `AssistantRow.name` — never empty (the column defaults to "Assistant"),
   *  but guarded with `strings.titleFallback` anyway rather than trust a
   *  database default to hold forever. */
  name: string;
  /** `AssistantRow.greeting[locale]`, already resolved server-side — `null`
   *  falls back to the platform's own greeting. */
  greeting: string | null;
  /** `AssistantRow.suggestions[locale]`, already resolved and capped to 3
   *  server-side. */
  suggestions: string[];
  brandLogoUrl: string | null;
  strings: AssistantStrings;
};

/** The transcript's own text, concatenated across every text part — a
 *  message can stream in as several `text-delta` chunks that arrive as
 *  separate parts, and `isTextUIPart` is the SDK's own filter for "the parts
 *  that are prose" (as opposed to a tool call or a data part, neither of
 *  which this widget renders). */
function messageText(message: UIMessage): string {
  return message.parts.filter(isTextUIPart).map((part) => part.text).join("");
}

/** Plain text, not markdown (the prompt forbids it — `lib/assistant/prompt.ts`)
 *  — every fragment renders as a text node, never `dangerouslySetInnerHTML`.
 *  The one thing this widget marks up is a bare `https://` URL, with the
 *  same `labelParts` split `public-form.tsx`'s consent disclosure already
 *  uses for the identical reason: a model can name its own booking link or
 *  policy page in a sentence, and a stranger cannot tap a URL that never
 *  became an anchor. Bare `http://` (no "s") is not covered — `labelParts`
 *  only recognises `https://`, the same restriction the consent disclosure
 *  already accepted; every link this platform ever hands a model expects to
 *  produce (the booking link, the account's own site) is https.
 */
function renderMessageText(text: string) {
  return labelParts(text).map((part, i) => (
    part.kind === "link" ? (
      <a key={i} href={part.value} target="_blank" rel="noreferrer noopener" className="bis-assistant-link">
        {part.value}
      </a>
    ) : (
      <span key={i}>{part.value}</span>
    )
  ));
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

export function AssistantWidget({
  publicId, embedded, locale, page, token, name, greeting, suggestions,
  brandLogoUrl, strings,
}: Props) {
  // Direct visits render open with no launcher and no way to close (there is
  // no host page to reveal behind it) — embedded visits start closed, the
  // same "closed = launcher" state `assistant.js` assumes before its first
  // `bis-assistant-state` message ever arrives.
  const [open, setOpen] = useState(!embedded);
  const [draft, setDraft] = useState("");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasOpenRef = useRef(open);

  // The server issues the session id on the FIRST response
  // (`x-bis-session`), not before — there is nothing to send it with on the
  // opening message. Plain state, not a ref: `assistantFetch` only ever
  // writes it from inside a `fetch` call the transport makes at SEND time
  // (an event, never render), and `react-hooks/refs` — the React Compiler
  // ruleset `eslint-config-next` now ships — flags embedding a ref-reading
  // function into any value built during render, which a `useMemo`'d
  // transport is, even though the read only ever happens later. State sent
  // through the transport's plain `body` object (rather than the function
  // form) sidesteps that entirely: nothing here closes over a ref, so there
  // is nothing for the rule to flag, and the one extra render this setState
  // could cost bails out on its own the moment the server hands back the
  // SAME id it always does after the first reply (`Object.is` sees no
  // change).
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);

  const assistantFetch = useCallback<typeof fetch>(async (input, init) => {
    const response = await fetch(input, init);
    const sid = response.headers.get("x-bis-session");
    if (sid) setSessionId((current) => (current === sid ? current : sid));
    return response;
  }, []);

  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({
      api: `/api/assistant/${publicId}/chat`,
      fetch: assistantFetch,
      body: { token, locale, page, sessionId },
    }),
    [publicId, assistantFetch, token, locale, page, sessionId],
  );

  const { messages, sendMessage, regenerate, status } = useChat<UIMessage>({
    id: publicId,
    transport,
  });

  const busy = status === "submitted" || status === "streaming";
  const thinking = status === "submitted";

  // Embedded only: tell the host page's own copy of `assistant.js` what to
  // resize itself to. "*" outbound, same reasoning
  // `public-form.tsx`/`booking-page.tsx` already document for their own
  // postMessages — the payload (a boolean) carries nothing a stranger
  // origin could use, and the host's listener is the side that must be
  // strict about source and origin, which it is (`assistant.js` checks both).
  useEffect(() => {
    if (!embedded || typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage({ type: "bis-assistant-state", open }, "*");
  }, [embedded, open]);

  // The host page's own Esc handler (`assistant.js`) and its
  // `window.BISAssistant.open()/close()` both act by messaging INTO this
  // document — this widget owns whether it is open, the parent only asks.
  useEffect(() => {
    if (!embedded) return;
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const data = event.data as { type?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "bis-assistant-close") setOpen(false);
      else if (data.type === "bis-assistant-open") setOpen(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);

  // Keyboard: Esc closes (embedded only — a direct visit has nowhere to
  // return focus to), and focus returns to the now-visible launcher,
  // whichever of the three paths above closed it (a click on the header's
  // own close button, Esc inside the panel, or the host page's Esc).
  useEffect(() => {
    if (embedded && wasOpenRef.current && !open) launcherRef.current?.focus();
    wasOpenRef.current = open;
  }, [embedded, open]);

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (embedded && event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    send(draft);
    setDraft("");
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  const title = name.trim() || strings.titleFallback;
  const empty = messages.length === 0;

  const panel = (
    <div
      className="bis-assistant-panel"
      role="dialog"
      aria-label={title}
      {...(embedded ? { "aria-modal": "true" as const } : {})}
      onKeyDown={handlePanelKeyDown}
    >
      <header className="bis-assistant-header">
        {brandLogoUrl ? (
          // Decorative, same call `public-brand.tsx` makes for its own logo:
          // the title text beside it already carries the meaning.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brandLogoUrl} alt="" className="bis-assistant-logo" />
        ) : null}
        <span className="bis-assistant-title">{title}</span>
        {embedded ? (
          <button
            type="button"
            className="bis-assistant-iconbtn"
            aria-label={strings.close}
            onClick={() => setOpen(false)}
          >
            <CloseIcon />
          </button>
        ) : null}
      </header>

      <div className="bis-assistant-body">
        <div className="bis-assistant-messages" aria-live="polite">
          <div className="bis-assistant-row is-assistant">
            <div className="bis-assistant-bubble bis-assistant-bubble-assistant">
              {greeting?.trim() || strings.greetingFallback}
            </div>
          </div>
          {messages.map((message) => (
            <div
              key={message.id}
              className={`bis-assistant-row ${message.role === "user" ? "is-user" : "is-assistant"}`}
            >
              <div
                className={`bis-assistant-bubble ${
                  message.role === "user" ? "bis-assistant-bubble-user" : "bis-assistant-bubble-assistant"
                }`}
              >
                {renderMessageText(messageText(message))}
              </div>
            </div>
          ))}
          {thinking ? (
            <div className="bis-assistant-row is-assistant">
              {/* The dots are decorative (aria-hidden); the sentence beside
                  them is what `aria-live="polite"` on the list above actually
                  announces — the same split `booking-page.tsx`'s own skeleton
                  draws between its bars and its sr-only "Loading available
                  times". Without it, a screen-reader user hears nothing at
                  all until the reply itself lands. */}
              <div className="bis-assistant-bubble bis-assistant-bubble-assistant bis-assistant-thinking"
                   data-testid="assistant-thinking">
                <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
                <span className="bis-assistant-sr">{strings.thinking}</span>
              </div>
            </div>
          ) : null}
        </div>

        {empty && suggestions.length > 0 ? (
          <div className="bis-assistant-suggestions" role="group" aria-label={strings.suggestionsLabel}>
            {suggestions.slice(0, 3).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="bis-assistant-chip"
                disabled={busy}
                onClick={() => send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {status === "error" ? (
        <div className="bis-assistant-error" role="alert" data-testid="assistant-error">
          <p className="bis-assistant-error-heading">{strings.errorHeading}</p>
          <p className="bis-assistant-error-body">
            {/* No phone reaches this widget in phase 1 — see
                `assistantErrorBody`'s own doc comment. */}
            {assistantErrorBody(strings, null)}
          </p>
          <button type="button" className="bis-assistant-retry" onClick={() => void regenerate()}>
            {strings.retry}
          </button>
        </div>
      ) : (
        <form ref={formRef} className="bis-assistant-form" onSubmit={handleSubmit}>
          <textarea
            data-testid="assistant-input"
            className="bis-assistant-input"
            rows={1}
            maxLength={2000}
            placeholder={strings.placeholder}
            aria-label={strings.placeholder}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button
            type="submit"
            className="bis-assistant-send"
            aria-label={strings.send}
            disabled={busy || !draft.trim()}
          >
            <SendIcon />
          </button>
        </form>
      )}

      {/* Opens in a new tab, same reasoning `booking-page.tsx`'s identical
          footer link documents: this widget routinely lives in an iframe on
          the client's own site, and a same-tab navigation would replace the
          conversation the visitor is in the middle of. */}
      <p className="bis-assistant-poweredby">
        <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">
          {strings.poweredBy}
        </a>
      </p>
    </div>
  );

  if (!embedded) return panel;

  return (
    <>
      {!open ? (
        <button
          ref={launcherRef}
          type="button"
          data-testid="assistant-launcher"
          className="bis-assistant-launcher"
          aria-label={strings.open}
          onClick={() => setOpen(true)}
        >
          <ChatIcon />
        </button>
      ) : panel}
    </>
  );
}
