import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmbedSnippet } from "@/components/embed-snippet";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import type { StateKind } from "@/lib/setup/setup-view";
import { STEP_PATH, TONE, type StepDetailProps } from "./step-shared";

/**
 * The numbered walkthrough for putting the text assistant on a client's
 * website — #103 shipped the feature as a card on the Voice page plus a
 * checklist tick, but a tick is not a walkthrough (see this task's own
 * brief). Four rows, each independently derived from live rows, same
 * discipline as every other setup step (setup-status.ts:3-7).
 *
 * Row 3's condition (`concierge_enabled`) is what the RAIL shows — it is the
 * same conjunction `deriveSetupStatus`'s `website_assistant.done` checks
 * (concierge_enabled AND concierge_form_id; `enableConcierge` always sets
 * both together, so `concierge_enabled` alone is the honest visible signal
 * here). Row 4 is PROOF, not a gate: a client can be fully "done" on this
 * step (assistant on, form chosen) with no visitor having opened it yet —
 * that is a real, unremarkable state ("Not seen on your site yet"), not a
 * failure, and it never holds the rail's own green tick hostage.
 */

/** One row: a number, a status dot + word (DESIGN.md rule 3 — status is
 *  never colour alone), the row's own title, optional body content below it,
 *  and an optional ghost link to where the work happens. `data-row`/
 *  `data-row-state` are the row's own address (this pane's version of
 *  `data-contact-row`) — deterministic hooks for a render-harness test,
 *  since the four rows' generic status words repeat across rows and a
 *  fragile text-count assertion would not tell them apart. */
function Row({
  n, kind, word, title, href, children,
}: {
  n: number;
  kind: StateKind;
  /** Overridable per row — rows 1–3 use the generic setup.state.* words;
   *  row 4 (proof, not a gate) uses its own "seen"/"not seen yet" wording,
   *  since "Done"/"To do" would be lying about what the dot actually means
   *  there (a quiet week is not a broken product, DESIGN.md's weekly-report
   *  rule generalises here too). */
  word: string;
  title: string;
  href?: string;
  children?: React.ReactNode;
}) {
  const tone = TONE[kind];
  return (
    <div
      data-row={n}
      data-row-state={kind}
      className="flex gap-3 border-b border-border py-3 last:border-b-0"
    >
      <span
        aria-hidden
        className="mt-0.5 w-4 shrink-0 text-xs font-medium text-muted-foreground tabular-nums"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-card-foreground">{title}</p>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
              tone.chip,
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
            {word}
          </span>
        </div>
        {children}
        {href ? (
          // `aria-label`, not the bare visible "Open" (fix-round review,
          // MINOR 9): all four rows' links share that one visible word, so
          // a screen reader landing on any of them heard "Open" four times
          // with nothing to tell them apart. The row's own title disambiguates.
          <Link
            href={href}
            aria-label={title}
            className={cn(buttonVariants({ variant: kind === "done" ? "ghost" : "outline", size: "sm" }))}
          >
            {m["setup.openStep"]}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function WebsiteAssistantStep({
  base, views, conciergeProfile, publishedFormCount, conciergeSiteConversation, origin,
}: StepDetailProps): React.ReactNode {
  // Read voice_profile's OWN done/unknown off the views this render already
  // computed — never re-derived here (setup-status.ts:3-7's whole promise:
  // one computation, everywhere the answer is needed).
  const voiceProfileView = views.find((v) => v.key === "voice_profile");
  const voiceProfileDone = voiceProfileView?.done === true;
  // READS_BEHIND.voice_profile is `["profile"]` alone (setup-view.ts), so
  // this is exactly "did the profile read fail" — the same signal rows 3
  // and 4 need for the SAME row (they read the same voice_profiles row),
  // with no second flag to keep in sync.
  const profileUnknown = voiceProfileView?.unknown === true;

  const conciergeEnabled = conciergeProfile?.concierge_enabled === true;
  const publicId = conciergeProfile?.public_id ?? null;

  const row1Kind: StateKind = profileUnknown ? "unknown" : voiceProfileDone ? "done" : "open";

  const row2Kind: StateKind =
    publishedFormCount === "unknown" ? "unknown" : publishedFormCount > 0 ? "done" : "open";

  const row3Kind: StateKind = profileUnknown ? "unknown" : conciergeEnabled ? "done" : "open";

  // Row 4 is proof, never a gate (see file header) — its OWN status is
  // "unknown" when either the profile read failed (we cannot even tell
  // on/off) or the conversations read failed; "to do" while off; "seen"/
  // "not seen yet" while on, per the real count.
  const conversationsUnknown = conciergeSiteConversation === "unknown";
  const seen = conciergeSiteConversation === true;
  const row4Kind: StateKind =
    profileUnknown || conversationsUnknown ? "unknown" : !conciergeEnabled ? "open" : seen ? "done" : "open";
  const row4Word =
    row4Kind === "unknown" ? m["setup.state.unknown"]
    : !conciergeEnabled ? m["setup.state.open"]
    : seen ? m["setup.step.website_assistant.row4.seen"]
    : m["setup.step.website_assistant.row4.notSeen"];

  // Only when we can actually confirm the address exists — a profile read
  // that failed must not paint a snippet built from a stale/blank public_id.
  const showSnippet = conciergeEnabled && !profileUnknown && Boolean(publicId);

  const voiceProfileHref = `${base}${STEP_PATH.voice_profile}`;

  return (
    <div className="mt-3">
      <Row n={1} kind={row1Kind} word={genericWord(row1Kind)} title={m["setup.step.website_assistant.row1.title"]} href={voiceProfileHref} />
      <Row n={2} kind={row2Kind} word={genericWord(row2Kind)} title={m["setup.step.website_assistant.row2.title"]} href={`${base}/forms?from=setup`}>
        <p className="text-xs text-muted-foreground">{m["setup.step.website_assistant.row2.body"]}</p>
      </Row>
      <Row n={3} kind={row3Kind} word={genericWord(row3Kind)} title={m["setup.step.website_assistant.row3.title"]} href={`${voiceProfileHref}#website-assistant`} />
      <Row n={4} kind={row4Kind} word={row4Word} title={m["setup.step.website_assistant.row4.title"]}>
        {showSnippet ? (
          // The pane's own paste-hint IS EmbedSnippet's `hint` here (fix-round
          // review, MINOR 8) — it used to ALSO render as a separate paragraph
          // below the card, stacking the same instruction twice. `surface="2"`
          // (MINOR 7): this card sits nested inside the pane's own card
          // (--surface-1), so it paints from the ladder's next step rather
          // than the same one nested on itself.
          <EmbedSnippet
            attribute="data-concierge"
            publicId={publicId!}
            origin={origin}
            title={m["voice.assistant.snippetTitle"]}
            hint={m["setup.step.website_assistant.row4.pasteHint"]}
            disabledHint={m["setup.step.website_assistant.row4.pasteHint"]}
            enabled
            copyLabel={m["voice.assistant.copy"]}
            copiedLabel={m["voice.assistant.copied"]}
            publicLinkLabel={m["voice.assistant.publicLink"]}
            surface="2"
          />
        ) : !profileUnknown && !conciergeEnabled ? (
          <p className="text-xs text-muted-foreground">{m["setup.step.website_assistant.row4.off"]}</p>
        ) : null}
      </Row>
    </div>
  );
}

/** Rows 1–3's generic word, off the same three-state vocabulary the rest of
 *  the wizard already uses — row 4 supplies its own (see `row4Word` above). */
function genericWord(kind: StateKind): string {
  if (kind === "unknown") return m["setup.state.unknown"];
  if (kind === "done") return m["setup.state.done"];
  return m["setup.state.open"];
}
