# The customer-facing name — no fallback to the agency's label — Design

**Date:** 2026-09-07 · **Status:** decided by danlo in conversation (two
choices below) · **Origin:** Milestone B's review Decision 2 and Milestone C's
review Important 2 (`docs/superpowers/specs/2026-09-07-automations-milestone-c-design.md`,
"Decisions taken after the review", item 2). Lands as its own PR after PR #30.

## The defect

`accounts.name` is the AGENCY's internal label for a client ("Rio Roofing —
trial"). The customer-facing name is `accounts.brand_name` (nullable, 0010).
`brandDisplayName(branding, accountName)` — two deliberately identical copies,
`apps/web/src/lib/email/templates/shell.ts` and `packages/db/src/branding.ts`,
pinned by `brand-name-parity.test.ts` — returns `brandName ?? accountName`. The
fallback has put the internal label in front of customers four times. Read on
the live project 2026-09-07: every email From name and subject flows through
`emailBrand`, four routes carry their own `account?.name ?? "BIS"` literal
downstream of it, and the VOICE system prompt hands `accounts.name` to the
receptionist with no resolver at all (`api/voice/incoming/route.ts:497`,
`api/voice/web/session/route.ts:124`) — a live leak no sentinel covers. Only
the five SMS copy functions handle a blank name.

Live data (2026-09-07): 13 of 14 accounts have no `brand_name`. They are the
e2e fixture `Test Client One` and eleven orphaned `Fixture Co` test accounts
(client access off). The one real client already has a brand name. So the
fallback is exercised only by test data today, and the structural fix is
what matters.

## Decisions (danlo, 2026-09-07)

1. **Backfill, danlo reviews the list.** Migration `0028_brand_name_backfill`
   sets `brand_name = name` where null or blank. The pre-flight lists every
   affected row; the ledger records the ids; any name carrying "—", "trial"
   or "test" is flagged for a manual edit in that account's Branding panel.
   The eleven `Fixture Co` orphans are reported separately for a cleanup
   decision — NOT deleted by this PR.
2. **A brand name is mandatory going forward, in three places:**
   `createAccount` seeds `brand_name` from the name given (the wizard's
   branding step invites editing it); the Branding save refuses a blank
   (`branding.nameRequired`); `goLivePrereqsMet` gains the `branding` step,
   and `goLiveAction` stops ignoring the `accounts` leg it now depends on.
3. **The resolver loses its second parameter.** `brandDisplayName(branding)`
   returns `branding.brandName?.trim() || ""`; `emailBrand(branding)`
   follows. Every call site drops the label argument — the compiler is the
   checklist — and the two old due-rows (`DueReminder`, `DueFollowup`) plus
   `AccountBrandInfo` lose `accountName`, so no cron row type carries the
   label any more (the three B rows never did). The four `?? "BIS"` literals
   go. A blank name is possible only by a direct database edit after this
   PR; the guards in Decision 2 make it unreachable through the product, so
   no consumer gains a no-name subject variant (YAGNI; the five SMS copy
   functions keep theirs).
4. **Voice uses the resolver.** `businessName` in both prompt builders and
   the default greeting `Thanks for calling …` come from
   `brandDisplayName(branding)`; the branding object is built before the
   prompt input in `incoming/route.ts`.
5. **Dashboard-only surfaces are out of scope**: the `<title>` and the client
   dashboard greeting still read `branding.brandName ?? account.name`; they
   are seen by the client, never by a customer, and are never null after
   Decisions 1–2.

## Tests

- Flip: `shell.test.ts` "falls back…", `packages/db/src/test/branding.test.ts`
  "falls back…", `automations/page.test.ts` "falls back…" → each asserts the
  EMPTY string, not the label. `brand-name-parity.test.ts` cases drop the
  second argument and add `[null]`, `[""]`, `["  "]` → `""`.
- New: `createAccount` seeds `brand_name` (real db); the Branding action
  refuses a blank; `goLivePrereqsMet` requires `branding` (and the existing
  met-with-email-undone case still holds); `goLiveAction` reports an
  `accounts`-leg failure as `setup.goLive.failed`; `buildSystemPrompt` input
  built from the resolver never contains the label (a route-level test if one
  exists, else a unit test on the prompt input builder extracted for it).
- Sentinel: the reminders/follow-ups fixture rows lose `accountName`; a
  `@ts-expect-error` pins that `DueReminder` and `DueFollowup` have none; the
  label scan stays and still proves the brand name went out.
- Gates: `pnpm check`, build, full e2e; one named mutation per new test.
