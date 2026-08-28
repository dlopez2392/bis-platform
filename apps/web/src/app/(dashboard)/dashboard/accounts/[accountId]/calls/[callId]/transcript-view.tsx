import type { TranscriptEvent } from "@bis/db";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

/**
 * Clock time only — the date already leads the page header, and repeating it
 * on forty turns of a four-minute call would bury the one thing these
 * timestamps are for: the PACING of the conversation, which is how a reader
 * spots the pause where a caller was left waiting.
 *
 * Pinned to the ACCOUNT's zone, like every other timestamp on this page, and
 * to "en-US" for the same reason `formatCallTime` is: an SSR/client locale
 * disagreement would rewrite the string after hydration.
 */
function turnClock(at: string, timeZone: string): string | null {
  // `at` arrives out of a jsonb column. A row written by an older shape — or
  // by a test fixture — can hold anything, and `Intl` would render the string
  // "Invalid Date" rather than throw. No timestamp is better than that.
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit", second: "2-digit",
  }).format(new Date(ms));
}

/** Same defensive read: `transcript` is jsonb, so nothing in the type system
 *  actually guarantees an array of well-formed turns reached this page. A turn
 *  with no text is dropped rather than rendered as an empty bubble, which
 *  would look like the receptionist said nothing and be indistinguishable
 *  from a real silent turn. */
function usableTurns(transcript: TranscriptEvent[]): TranscriptEvent[] {
  if (!Array.isArray(transcript)) return [];
  return transcript.filter(
    (t) => t && typeof t.text === "string" && t.text.trim().length > 0,
  );
}

/**
 * The call as a conversation rather than a column of rows: caller on the left,
 * assistant on the right, running down a shared spine so the two sides read as
 * one exchange with a rhythm to it.
 *
 * Everything here is PLAIN TEXT through React's own escaping. The transcript is
 * attacker-adjacent by construction — every caller-side turn is a stranger
 * speaking into a phone and a speech model writing down what it heard — so
 * there is no `dangerouslySetInnerHTML` on this page and no markdown pass, on
 * purpose. `whitespace-pre-wrap` is what preserves the shape of a spoken turn.
 *
 * Server component: nothing here is interactive.
 */
export function TranscriptView({
  transcript,
  timezone,
}: {
  transcript: TranscriptEvent[];
  /** The ACCOUNT's IANA zone, already validated by the page — the company's
   *  wall clock, not the viewer's. */
  timezone: string;
}) {
  const turns = usableTurns(transcript);

  if (turns.length === 0) {
    return <p className="text-sm text-muted-foreground">{m["calls.detail.noTranscript"]}</p>;
  }

  return (
    <div className="relative">
      {/* The spine. Decorative, and only once there are two columns to divide
          — below `sm` the turns stack and a centre line would cut through
          them. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-2 left-1/2 hidden w-px -translate-x-1/2 bg-border sm:block"
      />

      <ol className="relative grid gap-3 sm:grid-cols-2 sm:gap-x-10">
        {turns.map((turn, i) => {
          const isCaller = turn.role === "caller";
          // The role is SHOWN once per run, not once per turn: a back-and-forth
          // of thirty turns would otherwise be half labels, and the side and the
          // tint carry it in between for anyone who can see them.
          //
          // It is still RENDERED on every turn, `sr-only` on continuations —
          // side and tint are exactly the two cues a screen reader does not
          // have, and without the label a listener hears a bare timestamp and
          // a sentence with nobody attached to it.
          const startsRun = i === 0 || turns[i - 1]?.role !== turn.role;
          const clock = turnClock(turn.at, timezone);

          return (
            <li
              key={`${i}-${turn.at}`}
              className={cn(
                "flex flex-col items-start gap-1",
                isCaller ? "sm:col-start-1" : "sm:col-start-2 sm:items-end",
              )}
            >
              <div
                className={cn(
                  "flex items-baseline gap-2 text-[11px] leading-none",
                  isCaller ? null : "sm:flex-row-reverse",
                )}
              >
                <span
                  className={cn(
                    "font-medium tracking-wider text-muted-foreground uppercase",
                    startsRun ? null : "sr-only",
                  )}
                >
                  {isCaller ? m["calls.detail.caller"] : m["calls.detail.assistant"]}
                </span>
                {clock ? (
                  // Full `--muted-foreground`, not a faded one. At 11px this is
                  // small text and has to clear 4.5:1 — #6b7280 on the card
                  // measures 4.83:1, and every step of fading it drops below.
                  <time dateTime={turn.at} className="tabular-nums text-muted-foreground">
                    {clock}
                  </time>
                ) : null}
              </div>

              <p
                className={cn(
                  "max-w-full rounded-2xl border px-3.5 py-2.5 text-sm leading-6 break-words whitespace-pre-wrap text-foreground",
                  isCaller
                    ? "rounded-tl-sm border-border bg-muted"
                    : "rounded-tl-sm border-primary/25 bg-primary/10 sm:rounded-tl-2xl sm:rounded-tr-sm",
                )}
              >
                {turn.text}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
