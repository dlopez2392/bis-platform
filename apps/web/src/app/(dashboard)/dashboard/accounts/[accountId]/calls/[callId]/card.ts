// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/card.ts
//
// The card shell shared by the sections on the call-detail page (Summary,
// Transcript, the call card, the failed-textback panel) and the agency Work
// page's Suggestions section. Used to be defined twice, byte-for-byte, in
// page.tsx and the old proposals block (removed in item 8b-1; the Suggestions
// section's cards are components/proposals/) — a "same shape, kept
// in sync by hand" comment stood in for a real fix, the exact anti-pattern
// `../outcome-pill.tsx` (one directory up) opens by naming and was itself
// extracted to stop. A shared module, not the mirrored-constant shape
// (`neutral-ramps.ts`'s `SIDEBAR_FOREGROUND`) is right here specifically
// because a plain module has no circular-import hazard — that shape exists
// only where the two definitions live in files that ALSO import each other,
// which page.tsx and the old block did. A third module broke that circle
// instead of tolerating it.
export const CARD = "overflow-hidden rounded-xl border border-border bg-card glass";

// DESIGN.md's Label role — Geist Mono 500, 10px, +0.14em. The rule under it
// is `--row-line` (.06), not `--line` (.08), like every other row rule.
export const CARD_HEAD =
  "border-b border-[var(--row-line)] px-5 py-3 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase";
