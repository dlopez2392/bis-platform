import Link from "next/link";
import type { ResolvedZone } from "@bis/db";

import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";

/**
 * Names the zone every date on this screen is printed in, and says so out
 * loud when that zone had to be guessed.
 *
 * ONE rule for five screens. Calls, Call detail, the account dashboard's KPI
 * windows, the Checklist and the work queue all render dates in the
 * account's zone and, before this, each answered an unusable zone
 * differently — four clamped silently to UTC, the work queue omitted the
 * date, and the dashboard did both. The clamp was the defect, but so was the
 * omission: danlo, 2026-09-17, "I do not want to omit the dates so let's
 * find a workaround." The workaround is that the date ALWAYS renders and the
 * screen always says which zone it is in.
 *
 * ONE PER SCREEN, never one per row. A table of fifty calls repeating
 * "AMERICA/CHICAGO" fifty times is noise, and the zone is a property of the
 * screen, not of a row. `formatCallTime` already prints the short zone name
 * ("CDT") inside each Calls row; this names the zone those abbreviations
 * belong to, which is the part a reader cannot otherwise infer.
 *
 * DESIGN.md rule 3 — the marker is a WORD. The tinted ground below carries
 * no meaning on its own: strip the colour and the sentence still says
 * everything. Rule 1 too, in its own way: a date is a metric, and the zone
 * is the context it ships with.
 */
/**
 * The SENTENCE caption treatment, not the Label role.
 *
 * The Label role (`stat-tile.tsx`'s `LABEL_ROLE` — mono 10px, +0.14em,
 * UPPERCASE) is built for one-to-three-word KPI captions. Applied to a whole
 * sentence it renders "TIMES SHOWN IN AMERICA/CHICAGO", which reads as a
 * system code rather than the plain language DESIGN.md asks for — and
 * shouting an IANA id undercuts the very thing the copy comment argues for,
 * that this string is the human-chosen name the operator sees in Settings.
 *
 * This is `website-section.tsx:44`'s treatment instead — the repo's own
 * answer to the same problem, a date-adjacent full-sentence caption ("Updated
 * on {date}") in the same mono family with the tracking relaxed and the
 * uppercase dropped. Same page even uses the true Label role two lines above
 * it for an actual terse label, so the distinction is deliberate there.
 */
const SENTENCE_CAPTION =
  "font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground";

export function ZoneNote({
  zone,
  isAgency,
  accountId,
  className,
}: {
  /** Straight from `renderZone` (lib/zone.ts) — never a bare zone string, so
   *  a caller cannot render this note without also having decided what to do
   *  about `guessed`. */
  zone: ResolvedZone;
  /** From `requireAccountAccess`. Decides whether the fix is a LINK or a
   *  person to ask: Settings is agency-only
   *  (`requireAgencyOnlyAccountAccess`), so a client who followed the link
   *  would be redirected back to their own dashboard. Two screens here
   *  (Checklist) are agency-only anyway and pass `true` as a constant; the
   *  other three are reached by both audiences and must pass the real
   *  value. */
  isAgency: boolean;
  accountId: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className={SENTENCE_CAPTION}>{m["zone.note"].replace("{zone}", zone.label)}</p>

      {zone.guessed ? (
        // `role="note"` overrides Notice's own `role="alert"` (the spread
        // puts our props last). This is a standing configuration fact that
        // is present on first paint, not something that just happened — an
        // assertive live region would interrupt a screen-reader user for a
        // sentence that was already there when the page loaded.
        //
        // `text-foreground`, per the repo's standing rule (setup-shell.tsx):
        // a full SENTENCE keeps the foreground colour and lets the ground
        // carry the hue, because a sentence in `--warn` sits at the AA floor.
        <Notice tone="warn" role="note" className="text-foreground">
          {isAgency ? (
            <>
              {zone.source === "agency"
                ? m["zone.guessed.agency"]
                : m["zone.guessed.fallback"]}{" "}
              {/* `underline underline-offset-2` and NOTHING else, matching
                  `alert-phone-card.tsx`'s Link-inside-a-warn-Notice, which is
                  the same pattern in the same place. The focus ring comes
                  from globals.css's un-layered `:focus-visible` rule, which
                  beats every Tailwind utility on purpose — a hand-rolled
                  `focus-visible:ring-*` here would be redundant and its
                  companion `focus-visible:outline-none` could not have
                  suppressed the global outline anyway (Tailwind utilities sit
                  inside a cascade layer that rule deliberately outranks). */}
              <Link
                href={`/dashboard/accounts/${accountId}/settings`}
                className="underline underline-offset-2"
              >
                {m["zone.guessed.fix"]}
              </Link>
            </>
          ) : (
            m["zone.guessed.client"]
          )}
        </Notice>
      ) : null}
    </div>
  );
}
