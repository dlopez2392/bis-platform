# Sofía's structured business hours, services and prices, with a knowledge version stamp, PR S-47c (F-037 part 1, migration 0095): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **Ceremony is tiered PER TASK** (owner rule 2026-10-19, binding; spec §9; memory "Speed process"): read each task's tier before dispatching it. HIGH gets the full ceremony; MEDIUM gets one review; LOW gets a short brief and no per-task review. One end-of-PR final review (opus) + one design review + ONE fix agent.

**Goal:** the agency gives Sofía an account's business hours and a price list as structured records on the Voice page. Code renders each price into ONE fixed sentence in English and one in Spanish, and computes "open right now" in the account's zone. Sofía quotes prices only from the list, answers "are you open?" from the hours, and every call and website chat records which numbered, never-edited snapshot of her knowledge it ran under.

**Architecture:**
- Migration 0095 adds `voice_profiles.business_hours` (jsonb), the `voice_services` table (six price kinds, a shape CHECK), the append-only `voice_knowledge_snapshots` table, a `knowledge_version` stamp (with a composite FK to the snapshot) on `calls` and on `concierge_conversations`, a private hours-shape validator, and two `SECURITY DEFINER` RPCs executed by `service_role` only: `save_voice_knowledge` (every Voice page knowledge save, all-or-nothing, with its snapshot) and `ensure_knowledge_snapshot` (call and chat start). The client role reads; nothing but the two RPCs writes the new tables.
- `@bis/db`: `business_hours` on `VoiceProfileRow`/`PROFILE_COLS`; `knowledge_version` on `CallDetailRow`/`CALL_DETAIL_COLS` and `ConciergeConversationRow`/`CONVO_COLS`; `startCallRow` and `createConciergeConversation` take an optional `knowledgeVersion`; a new `voice-knowledge.ts` (reads and the two RPC wrappers).
- Web: pure renderers under `apps/web/src/lib/voice/knowledge/` (price sentences, hours lines, the open-now line, the snapshot payload, the Facts flags, the prompt blocks, the form validators). `buildSystemPrompt` gains two optional inputs (`businessHours`, `priceList`); absent, null or empty is byte-identical to today (`PRE_S47C_DIGEST`). The phone route and the chat's first turn build ONE payload, `ensure` it, stamp the row and build the prompt from that same payload; a chat's later turns read its stamped snapshot. The Voice page gains two cards and two Facts flags; the call page links to a read-only "What Sofía knew" page.

**Tech stack:** Next.js App Router (server components, server actions), Supabase Postgres + PostgREST, plpgsql, vitest, Playwright, `pg`.

**Spec:** `docs/superpowers/specs/2026-10-23-sofia-structured-facts-design.md` at `d3c377aa`. Decisions C1–C18 are the owner's and are not reopened. Every file:line below was read at `d3c377aa` (= `main` `044b1ab2` + the spec; `git diff 044b1ab2 d3c377aa --stat` touches only that spec file).

**Base:** `feat/s47c-facts` at `d3c377aa`.
- `<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s47c` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s47c`).
- `<SCRATCH>` = the orchestrator's session scratchpad. Each brief carries it literally, plus a subdirectory of its own per agent.
- `<KIT>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/ec121ebe-7e97-4a98-9a73-44be5c530909/scratchpad/s15e-kit` (`replica.sh`, `pgrst.sh`; read 2026-10-23, lines cited under Global constraints).

Path abbreviations:
- `…/voice/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/`
- `…/call/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/`
- `…/turn/` = `apps/web/src/app/api/concierge/[publicId]/turn/`
- `…/incoming/` = `apps/web/src/app/api/voice/incoming/`
- `…/websession/` = `apps/web/src/app/api/voice/web/session/`
- `…/knowledge/` = `apps/web/src/lib/voice/knowledge/`

---

## Spec deviations (code contradicts or under-specifies the spec; each with evidence and the resolution this plan uses)

- **SD1. `go_live` is SECURITY INVOKER, not DEFINER.** Spec C9 cites `go_live` (0063) and 0077's two functions as the definer pattern. Evidence: `0063_go_live.sql:87` is `security invoker` (its header, `:40-47`, explains why: `service_role` already held every write it needed). `0077_document_vault.sql:168` and `:201` are `security definer`. **Resolution:** the two RPCs follow 0077's shape (definer, `set search_path = ''`, revoke from `public, anon, authenticated, service_role`, grant execute to `service_role`; `0077_document_vault.sql:190-191`, `:222-223`). DEFINER is required here, not a style choice: `service_role` gets no write on either new table (spec §4), so only the function owner can write them. Citation fix only; no behaviour change.
- **SD2. `NOT VALID` then `VALIDATE` in the same file buys no lock relief.** Spec §4 says the two FKs are added NOT VALID then VALIDATEd "in the same file (the scan then holds SHARE UPDATE EXCLUSIVE, not the ALTER's ACCESS EXCLUSIVE)". Evidence: the same file first runs `alter table … add column knowledge_version` on the same two tables, which takes ACCESS EXCLUSIVE, and both the CLI push and MCP `apply_migration` run a file as one transaction, so that lock is held to commit anyway. **Resolution:** keep NOT VALID + VALIDATE exactly as the spec says (harmless; the column is all NULL, so the scan checks nothing), and the 0095 header says plainly that the protection is `lock_timeout` 5s (`0094_trade_modules.sql:65-68` shape), not the split.
- **SD3. The load-bearing list (spec §4.3) misses four sites.** Each names a 0095 column, table or function through PostgREST and so fails on a project without 0095:
  - `getVoiceProfileAnyStatusByPublicId` (`packages/db/src/concierge.ts:94-98`, `${PROFILE_COLS}`): the website chat PAGE (`apps/web/src/app/c/[publicId]/data.ts`), not only its turns.
  - `upsertVoiceProfile`'s own two `.select(PROFILE_COLS)` (`packages/db/src/voice.ts:193`, `:200`): every profile save, the demo seed, every e2e spec that seeds a profile.
  - The Voice page profile Save: Facts and Services now go through `save_voice_knowledge` (spec §5.7 last bullet), so the existing card's Save fails without 0095.
  - `getConciergeConversation` is also read by `packages/db/src/webchat.ts` (the web-chat sync).
  **Resolution:** no scope change; the merge gate already waits for 0095 on production. The 0095 header, the PR body and Task 12 name all of them.
- **SD4. Teardown: the two new tables must stay OFF `ACCOUNT_OWNED_TABLES`.** Evidence: `deleteAccountCascade` deletes every listed table with `.delete()` as `service_role` (`packages/db/src/account-teardown.ts:139-142`); spec §4 gives `service_role` no DELETE, so listing either would throw 42501 on every test account's teardown and every demo re-seed (the `consent_events` precedent, `:75-87`). Both tables carry `account_id … on delete cascade`, so the final `accounts` delete (`:152`) carries them away. Also: `public.events.account_id` has NO cascade (`0001_tenancy.sql:60`) and `calls.account_id` and `voice_profiles.account_id` are `on delete restrict` (`0019_voice_core.sql:46`, `:24`), so the db test's cascade case deletes `calls`, the chat, the form, the profile and the number first (deleteAccountCascade's own order) and writes no `events` row. **Resolution:** Task 5 adds a paragraph to the `account-teardown.ts` doc block; Task 1's test asserts neither table is on the list.
- **SD5. The phone's closed AFTER HOURS line says "or it is urgent" only when there is a trade module.** Spec §5.2's template ends "If they ask for a person, or it is urgent, you can still put them through" whenever `handoffAvailable`; §5.2.1's last paragraph and C14 say an account without a trade module puts a closed-hours caller through "only when they ask", and §5.2.1 point 2's TOOLS line says "Call it only when the caller asks … {, or … URGENT path … only when the account has a trade module}". With no module the template would contradict the TOOLS line in the same prompt. **Resolution:** with a module: "If they ask for a person, or it is urgent, you can still put them through."; without: "If they ask for a person, you can still put them through." This is C14 word for word, not a new rule.
- **SD6. The web chat's and the voice demo's definite AFTER HOURS lines keep today's tail.** Spec §5.2 gives "AFTER HOURS — The business is closed right now (see Right now above); say so briefly and {use capture_lead … / take a message …}". Evidence: today's lines are `system-prompt.ts:273` (web: "…say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.") and `:274` (demo: "…say so briefly and take a message; do not attempt anything else."). **Resolution:** replace only the conditional opening ("If the business is closed right now, ") with "The business is closed right now (see Right now above); "; the tail stays byte-for-byte. Literals in "The model".
- **SD7. A service's description line.** Spec §5.2 shows `  About it: <description in the language spoken, if any>`, but the prompt is built once, before anyone speaks. **Resolution:** each description that exists gets its own line, `  About it, in English: …` and `  About it, in Spanish: …`; she answers in the language she is speaking (the base LANGUAGE line decides). Descriptions are not prices, so the "word for word" rule does not bind them.
- **SD8. The insurance block's heading.** Spec §5.4/C13 say an `insurance_pc` account's block lists names and descriptions only, but the spec's heading ("SERVICES AND PRICES (the only prices you may give; …)") promises prices. **Resolution:** on insurance, the heading is `SERVICES (what the business offers):` and each item is `- {name_en}` plus ` (in Spanish: {name_es})` when there is one; the HARD LIMITS price line stays today's (spec §5.4).
- **SD9. A failed services read on the phone.** Spec §5.5: "the call goes on, unstamped, with the knowledge it could read (the profile's free text if the services read failed)". The hours live on the profile row, which was read. **Resolution:** the prompt keeps the free text AND the hours, carries no list (so the HARD LIMITS line is today's), `ensure` is NOT called (a payload with an unknown list would record a lie), and the row is unstamped. The same rule on the chat's first turn and in the voice demo. If a stored row cannot render (impossible past the CHECK, but defended), the same path is taken.
- **SD10. What the stale check compares.** Spec §4.1: `p_base_version` "no longer the latest (`stale`: someone saved in between; the action re-reads and retries once …)". **Resolution:** `p_base_version` is the latest version the ACTION read (0 when there is none) immediately before it built the payload from a fresh read of the other parts, not what the page loaded. The one retry re-reads everything, so it never overwrites another person's part: each card writes only its own part, and the payload's other parts are always the stored ones. An automatic call-start snapshot in that window also reads as stale, and the retry absorbs it.
- **SD11. Midnight as a closing time.** `<input type="time">` holds `00:00`–`23:59`; it cannot hold `24:00`, which `normalizeOpenHours` uses as the end of a day (`apps/web/src/lib/booking/slots.ts:124-155`). **Resolution:** a CLOSING time of `00:00` means midnight and is stored `"24:00"`; a stored `"24:00"` shows as `00:00` in a closing field. An opening time of `00:00` stays `"00:00"`.
- **SD12. A stamped chat whose snapshot read fails.** Spec §5.5 says a later turn reads the stamped snapshot, and a chat with NO stamp reads the live profile; it does not say what a failed read of a stamped one does. **Resolution:** a read ERROR is thrown into the route's existing catch, which answers `unavailable()` (503) without spending the turn (`…/turn/route.ts:765-770`), the posture of every other read in that route. A snapshot that is missing or does not parse (bad data) falls back to the live knowledge with one log line (ids only).
- **SD13. The zone of a stamped chat.** The payload records `timezone` (spec §4.2) and the open-now line is recomputed each turn "from the snapshot's hours". **Resolution:** a stamped chat's prompt uses the snapshot's `timezone` for both the "current date and time" line and the Right now line, so the two can never disagree.
- **SD14. The profile Save skips the RPC when nothing it carries changed.** Spec §5.7: "The profile card's Facts and Services boxes save through the same RPC". **Resolution:** only when the submitted Facts or Services text differs from the stored value (no event, no snapshot otherwise). C4 ("every Voice page save that CHANGES hours, services, Facts or the Services text writes a snapshot") is satisfied.
- **SD15. "Clear hours" carries an Undo.** Spec §5.7: "'Clear hours' (ghost) saves NULL". DESIGN.md rule 6: a reversible action runs immediately with an undo toast. **Resolution:** Clear hours runs at once and its toast's Undo re-saves the hours the card held before (the same action).
- **SD16. Three open-now lines the spec does not list.** **Resolution, pinned as literals:** a stretch that never ends inside a week (open 24/7): `Right now: open.`; the next opening is the same weekday a week later: `Right now: closed; opens next Monday at 8:00 AM.`; a span that starts exactly when the current one ends (the same day, or `00:00` after `24:00`) continues the stretch, so "8–12, 12–6" reads "open until 6:00 PM".
- **SD17. An hours object with no open day.** **Resolution:** the RPC refuses it (`invalid`; spec §5.7's "Mark at least one day open, or clear the hours"); closed days are absent keys (no empty arrays, as `normalizeOpenHours` emits); and `buildSystemPrompt` treats an input with no open day as no hours (byte-identical; pinned by the digest).
- **SD18. Where the two added round trips sit on the phone path.** Spec §5.5 says the services read runs "in parallel"; it says nothing of the RPC. **Resolution:** the services read starts before step 9's account read and is awaited after it; `ensure` starts right after step 9 (it needs the zone) and is awaited at step 10, so it overlaps step 9b's two handoff reads (`…/incoming/route.ts:1063-1076`). Task 0 reads the latency.
- **SD19. Weekday labels.** `calendar.settings.day.*` (`apps/web/src/lib/messages.ts:1668-1674`) have no `.es` twins. **Resolution:** new `voice.hours.day.*` keys with twins (spec §6 allows it).
- **SD20. The amounts flag names both boxes.** Spec §5.3 checks amounts in Facts OR Services but its Notice says "these amounts in Facts". **Resolution:** the copy says "in Facts or Services" (the list it shows covers both). Read by the design reviewer at the 7 AM read.
- **SD21. The RPCs RAISE (not return a status) on a programming error:** a null argument or a blank actor (22004, `go_live`'s shape, `0063_go_live.sql:91-93`), and `ensure` on an account that does not exist (P0002). Every status the spec names is a return value.
- **Confirmed, not deviations:**
  - The incoming route reads the profile ONCE at step 7 (`…/incoming/route.ts:925`), the account at step 9 (`:1043`), and stamps at step 10 (`:1103-1110`); the chat creates its row on turn 1 (`…/turn/route.ts:373-377`) and reads it back on turn 2+ (`:402`). Spec §5.5's sites are right.
  - No PostgREST embed names `calls` or `concierge_conversations` (`grep -rn "calls(\|concierge_conversations(\|calls!"` over `packages/db/src` and `apps/web/src`, excluding tests: no hit), so the new composite FKs add no embedding ambiguity.

---

## Owner questions

- **OQ1. Under "Always take a message", does a closed business change who she offers to put through?** (Blocks Task 4 only; the orchestrator asks with choice tiles, memory "Choice tiles", recommended first, before dispatching Task 4.)
  - The conflict: spec §5.2.1 makes `closedNow` independent of the after-hours setting, so when closed its point 2 TOOLS line ("the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person …") applies under "Always take a message" too. But its point 5 keeps that setting's MESSAGES ONLY line unchanged "open or closed", and that line says "If they ask for a person, or it cannot wait, you can still put them through" (`system-prompt.ts:266`). On an account with a transfer number and NO trade module, the closed prompt would then say both "only when the caller asks" and "or it cannot wait". A model resolves contradictory lines unpredictably.
  - **Recommended: (B) C14's closed-hours changes (the four offers become "offer to take a message"; the closed TOOLS line) apply only under "Follow business hours, then take a message".** "Always take a message" already holds at every hour (spec §5.2.1 point 5's own words) and its line already says when to put someone through, so under it nothing about transfers changes with the hours. Implementation: `closedNow` also requires `input.afterHours === "hours_then_message"`; one more condition and two test cases.
  - (A) The spec literally: `closedNow` under both settings; the contradiction above stays in the prompt on no-module accounts.
  - Until answered, Task 4 is not dispatched. The rest of the plan does not depend on the answer.

---

## Tiers (binding, per task)

| Task | What | Tier | Owner | Review |
|---|---|---|---|---|
| 0 | `pnpm install`, A-checks, MCP reads, the latency read, OQ1 to the owner, re-read every cite (orchestrator) | — | orchestrator | — |
| 1 | Migration 0095, the two RPCs, the validator, their db proof (withRollback + a two-session lock test) | **HIGH** | bis-db-schema (opus) | opus bis-reviewer in its OWN detached worktree, own replica, mutation probes; re-review on any change; orchestrator applies once |
| 2 | Every new and changed copy key, English and Spanish | LOW | bis-frontend | none |
| 3 | The pure renderers: price sentence, hours lines, open-now, payload, Facts flags | MEDIUM | bis-voice | one sonnet bis-reviewer, own worktree |
| 4 | `PRE_S47C_DIGEST` first; the prompt blocks and the prompt wiring | MEDIUM | bis-voice | one **opus** bis-reviewer (model input; recomputes the digest from `044b1ab2`) |
| 5 | `@bis/db`: columns in the row types and select lists, the two stamps, `voice-knowledge.ts`, every typed literal and bare factory | MEDIUM | bis-voice | one sonnet bis-reviewer, own worktree and replica |
| 6 | Stamping and prompt-from-payload on the three surfaces | MEDIUM | bis-voice | one sonnet bis-reviewer, own worktree |
| 7 | The save path: validators, `saveKnowledgeParts`, the two new actions, the profile action | MEDIUM | bis-voice | one sonnet bis-reviewer, own worktree |
| 8 | The Voice page: Business hours card, Services & prices card, the two Facts flags, the page's reads | LOW | bis-frontend | none |
| 9 | "What Sofía knew" page, the call-page link, palette keywords, i18n baselines | LOW | bis-frontend | none |
| 10 | The e2e spec | LOW | bis-e2e-qa | none |
| 11 | Whole-branch final review (opus), design review (opus), ONE fix agent | — | bis-reviewer, bis-design-reviewer, one fixer | checkpoint |
| 12 | Rollout | — | orchestrator | — |

**Waves (tasks in one wave share no file):**
- **Wave A** (parallel), after Task 0:
  - Task 1: `packages/db/supabase/migrations/0095_structured_facts.sql`, `packages/db/src/test/structured-facts-schema.test.ts`, `packages/db/src/test/structured-facts-lock.test.ts`.
  - Task 2: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.test.ts`.
  - Task 3: `…/knowledge/{price-sentence,hours,payload,facts-warnings}.ts` + their four tests.
- **Wave B** (parallel):
  - Task 4 (after Task 3 and OQ1): `…/knowledge/prompt-blocks.ts` (+ test), `apps/web/src/lib/voice/system-prompt.ts`, `apps/web/src/lib/voice/system-prompt.test.ts`, `apps/web/src/lib/voice/session-config.ts`.
  - Task 5 (after Task 1's review approves; needs 0095 on its replica): `packages/db/src/{voice,concierge,voice-knowledge,index,account-teardown}.ts`, `packages/db/src/test/{voice,concierge,voice-knowledge}.test.ts`, `packages/db/src/voice-forward.test.ts`, one line in each of `…/knowledge/{price-sentence,payload}.ts` (type re-point), and the typed literals / bare factories Task 5 lists (all test files plus `…/voice/voice-settings.tsx:35-45`).
- **Wave C** (parallel):
  - Task 6 (after Tasks 4, 5): `…/incoming/route.ts` (+ `route.test.ts`, `lifecycle.test.ts`), `…/turn/route.ts` (+ `route.test.ts`), `…/websession/route.ts` (+ `route.test.ts`).
  - Task 7 (after Tasks 2, 3, 5): `…/knowledge/{validate,save}.ts` (+ tests), `…/voice/actions.ts` (+ `actions.test.ts`).
- **Wave D:** Task 8 (after Task 7): `…/voice/{page.tsx,voice-settings.tsx,business-hours-card.tsx,services-prices-card.tsx,facts-flags.tsx}` (+ their tests, `page.test.ts`, `voice-settings.test.ts`).
- **Wave E** (parallel, after Task 8):
  - Task 9: `…/voice/knowledge/[version]/page.tsx` (+ test), `…/call/page.tsx` (+ `page.test.ts`), `apps/web/src/lib/palette/registry.ts` (+ test), `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts`, `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.
  - Task 10: `apps/web/e2e/structured-facts.spec.ts`.
- **Then:** Task 11, Task 12.
- **Pushes:** the orchestrator pushes after Task 1's review approves, so CI `verify` applies 0095 on the CLI's PostgreSQL early, and applies 0095 to bis-ci then too (Task 12 step 1), so the PR's `e2e` migration check (`.github/scripts/ci-migrations-applied.sh`) can go green and Vercel Preview can read profiles again (SD3: every profile read names `business_hours`).

---

## File map

| File | Task | Change |
|---|---|---|
| `packages/db/supabase/migrations/0095_structured_facts.sql` | 1 | new |
| `packages/db/src/test/structured-facts-schema.test.ts` | 1 | new (withRollback): shape, every CHECK by name, trigger, grants, RLS by role, FKs, validator, both RPCs, comments, teardown list |
| `packages/db/src/test/structured-facts-lock.test.ts` | 1 | new (two sessions, committed seed): the account lock; two concurrent `ensure`s make one row |
| `apps/web/src/lib/messages.ts` (+ one `describe` in `messages.test.ts`, and the S-47b `eventsHint` pin at `messages.test.ts:1413-1415`) | 2 | new keys after `"calls.detail.tradeModule.events.es"` (`messages.ts:2067`); `voice.profile.factsHint` (`:1802`) and `voice.tradeRules.eventsHint`/`.es` (`:2058-2059`) changed |
| `…/knowledge/price-sentence.ts`, `hours.ts`, `payload.ts`, `facts-warnings.ts` (+ four tests) | 3 | new, pure, relative imports only |
| `…/knowledge/prompt-blocks.ts` (+ test) | 4 | new, pure |
| `apps/web/src/lib/voice/session-config.ts:49-55` | 4 | two optional fields after `tradeModule?` |
| `apps/web/src/lib/voice/system-prompt.ts:9-11` (imports), `:57-61` (offer), `:119-125` (WHAT YOU KNOW, HARD LIMITS), `:134-140` (block hoisted), `:184-188` (TOOLS), `:248-276` (after hours) (+ `system-prompt.test.ts`) | 4 | the wiring; absent = byte-identical |
| `packages/db/src/voice.ts:11-37` (types/row), `:46` (patch type), `:77-82` (`PROFILE_COLS`), `:180-188` (refusal), `:269-340` (`startCallRow` and its doc comment), `:989-1000` (`CallDetailRow`, `CALL_DETAIL_COLS`) | 5 | |
| `packages/db/src/concierge.ts:211-235` | 5 | `knowledge_version` on the row, `CONVO_COLS`, `createConciergeConversation` |
| `packages/db/src/voice-knowledge.ts` (new), `packages/db/src/index.ts:143` (one `export *` line after it) | 5 | reads + RPC wrappers |
| `packages/db/src/account-teardown.ts:40-102` | 5 | one doc paragraph (SD4) |
| `packages/db/src/test/voice-knowledge.test.ts` (new), `packages/db/src/test/voice.test.ts`, `packages/db/src/test/concierge.test.ts`, `packages/db/src/voice-forward.test.ts` | 5 | |
| typed literals and bare factories (list in Task 5) | 5 | `business_hours: null`, `knowledge_version: null`, the new function mocks |
| `…/incoming/route.ts:75-80` (import), `:1042-1044` (step 9), `:1081-1112` (9c, 10), `:1138-1147` (prompt) (+ `route.test.ts`, `lifecycle.test.ts`) | 6 | |
| `…/turn/route.ts:186-191` (lazy import), `:358-399` (turn 1), `:400-424` (turn 2+), `:440-468` (prompt) (+ `route.test.ts`) | 6 | |
| `…/websession/route.ts:101-104` (lazy import), `:186-201` (+ `route.test.ts`) | 6 | live knowledge, no stamp |
| `…/knowledge/validate.ts`, `…/knowledge/save.ts` (+ tests) | 7 | new |
| `…/voice/actions.ts:27-42` (imports), `:65-165` (profile action), new `saveBusinessHoursAction`, `saveServicesAction` (+ `actions.test.ts`) | 7 | |
| `…/voice/business-hours-card.tsx`, `services-prices-card.tsx`, `facts-flags.tsx` (new, + tests); `…/voice/voice-settings.tsx` (Facts flags slot, the two cards, props); `…/voice/page.tsx` (reads, copy, props) (+ `page.test.ts`) | 8 | |
| `…/voice/knowledge/[version]/page.tsx` (new, + `page.test.ts`) | 9 | |
| `…/call/page.tsx:302-303` (before `</dl>`) (+ `page.test.ts`) | 9 | the agency-only Knowledge link |
| `apps/web/src/lib/palette/registry.ts:73` (+ `registry.test.ts`) | 9 | five keywords |
| `…/accounts/[accountId]/in-account-service-reads.test.ts:147-148` | 9 | the knowledge page, `agency-only` |
| `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` | 9 | regenerated |
| `apps/web/e2e/structured-facts.spec.ts` | 10 | new |

**Not touched:**
- `apps/web/src/lib/voice/modules/**` (C12: no module file, no `VERSION`, no `SHA256_HISTORY` entry; Task 4 runs `modules/index.test.ts` unchanged as the proof).
- `apps/web/src/lib/voice/tools/**` (C7: the placeholder sanitizer; `session-config.ts`'s `toolSchemas` call is unchanged, spec §5.2.1 point 2).
- `apps/web/src/lib/booking/slots.ts` (read only: `normalizeOpenHours`, `partsInZone`, `OpenHours`).
- Styleguide: existing components only (spec C8).

---
## The model (every task reads this; names are binding)

### 0095 (Task 1)

| Object | Name and rule |
|---|---|
| `voice_profiles.business_hours` | `jsonb`, nullable, no default, `constraint voice_profiles_business_hours_check check (business_hours is null or jsonb_typeof(business_hours) = 'object')`. NULL = no structured hours. Shape (keys `sun`..`sat`, each a non-empty array of `["HH:MM","HH:MM"]` spans, end after start, spans in order and not overlapping, at least one day) is enforced by `app.voice_business_hours_valid` inside the RPC, not by a CHECK (0016's precedent, spec §4). |
| `voice_services` | columns, CHECK names and the shape rule exactly as Task 1 step 4's SQL. Constraint names: `voice_services_position_check`, `voice_services_name_en_check`, `voice_services_name_es_check`, `voice_services_description_en_check`, `voice_services_description_es_check`, `voice_services_price_kind_check`, `voice_services_amount_cents_check`, `voice_services_unit_en_check`, `voice_services_unit_es_check`, `voice_services_account_position_key` (unique), six `voice_services_<column>_one_line` CHECKs, `voice_services_price_shape_check`. |
| `voice_knowledge_snapshots` | `id`, `account_id`, `version` (`voice_knowledge_snapshots_version_check`, > 0), `payload` (`voice_knowledge_snapshots_payload_check`, an object), `created_at`, `created_by` (`voice_knowledge_snapshots_created_by_check`, not blank), `voice_knowledge_snapshots_account_version_key` unique `(account_id, version)`; trigger `voice_knowledge_snapshots_never_edited` (BEFORE UPDATE, raises 55000). |
| `calls.knowledge_version`, `concierge_conversations.knowledge_version` | `integer`, nullable, no default; `calls_knowledge_version_check` / `concierge_conversations_knowledge_version_check` (> 0); FKs `calls_knowledge_version_fkey` / `concierge_conversations_knowledge_version_fkey` on `(account_id, knowledge_version)` → `voice_knowledge_snapshots (account_id, version)`, MATCH SIMPLE (NULL passes), NO ACTION. |
| RLS | `voice_services_member_read`, `voice_services_owners_only` (restrictive), `voice_knowledge_snapshots_member_read`, `voice_knowledge_snapshots_owners_only` (restrictive) — 0066's `account_billing_owner_read` shape (`0066_staff_and_roles.sql:95-98`). |
| Grants | both tables: `revoke all … from public, anon, authenticated, service_role`; `grant select … to authenticated, service_role`. Nothing else. |
| Functions | `app.voice_business_hours_valid(jsonb) returns boolean` (no EXECUTE for anyone but the owner); `app.voice_knowledge_snapshots_never_edited()` (trigger); `public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer) returns jsonb`; `public.ensure_knowledge_snapshot(uuid, jsonb) returns integer` — both definer, EXECUTE for `service_role` only. |
| `save_voice_knowledge` statuses | `{"status":"ok","version":N}`, `{"status":"stale"}`, `{"status":"no_profile"}`, `{"status":"invalid"}`. Raises 22004 on a null argument or a blank actor. |
| Event | inside `save_voice_knowledge`: `voice_profile.updated`, actor_type `user`, actor_id `p_actor`, payload `{"fields": [...]}`, the names in this order, each present only when its part was sent: `facts`, `services` (the Services TEXT, the column's own name), `business_hours`, `voice_services` (the list). |

### `@bis/db` (Task 5)

```ts
// packages/db/src/voice.ts
/** 0095. The weekly hours shape (calendars.open_hours's, 0016): absent day = closed. */
export type WeeklyHours = Partial<Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", [string, string][]>>;
// VoiceProfileRow gains, after trade_module:
  business_hours: WeeklyHours | null;
// VoiceProfilePatch = Partial<Omit<VoiceProfileRow, "id" | "account_id" | "forward_calls" | "business_hours">>
// PROFILE_COLS ends: "public_id, concierge_enabled, concierge_form_id, forward_calls, disclosure, trade_module, business_hours"
// upsertVoiceProfile throws "upsertVoiceProfile cannot write business_hours; use saveVoiceKnowledge" when the key is present
// startCallRow's input gains: knowledgeVersion?: number            -> knowledge_version, named only when given
// CallDetailRow gains: knowledge_version: number | null;
// CALL_DETAIL_COLS: CALL_LIST_COLS + ", turn_count, transcript, summary, booking_id, trade_module, trade_module_version, knowledge_version"

// packages/db/src/concierge.ts
// ConciergeConversationRow gains: knowledge_version: number | null;
// CONVO_COLS ends: "locale, attribution, origin, trade_module, trade_module_version, knowledge_version"
// createConciergeConversation's input gains: knowledgeVersion?: number   -> knowledge_version, named only when given

// packages/db/src/voice-knowledge.ts (new; `export * from "./voice-knowledge";` in index.ts after line 143)
export type PriceKind = "fixed" | "from" | "range" | "per_unit" | "free" | "after_visit";
export type VoiceServiceInput = {
  name_en: string; name_es: string | null; description_en: string | null; description_es: string | null;
  price_kind: PriceKind; amount_cents: number | null; amount_max_cents: number | null; unit_en: string | null; unit_es: string | null;
};
export type VoiceServiceRow = VoiceServiceInput & { id: string; account_id: string; position: number; created_at: string };
export type KnowledgeSnapshotRow = { id: string; account_id: string; version: number; payload: unknown; created_at: string; created_by: string };
export type KnowledgeParts = { facts?: string; services_text?: string; business_hours?: WeeklyHours | null; services?: VoiceServiceInput[] };
export type SaveKnowledgeResult = { status: "ok"; version: number } | { status: "stale" | "no_profile" | "invalid" };
export async function listVoiceServices(db: SupabaseClient, accountId: string): Promise<VoiceServiceRow[]>;          // position asc
export async function getKnowledgeSnapshot(db: SupabaseClient, accountId: string, version: number): Promise<KnowledgeSnapshotRow | null>;
export async function getLatestKnowledgeVersion(db: SupabaseClient, accountId: string): Promise<number>;            // 0 = none
export async function saveVoiceKnowledge(db: SupabaseClient, accountId: string,
  input: { actor: string; parts: KnowledgeParts; payload: Record<string, unknown>; baseVersion: number }): Promise<SaveKnowledgeResult>;
export async function ensureKnowledgeSnapshot(db: SupabaseClient, accountId: string, payload: Record<string, unknown>): Promise<number>;
```

No new `@bis/db` VALUE is read at import time (all five are functions, read at call time; no constant). Every bare `vi.mock("@bis/db", () => ({…}))` factory whose module under test CALLS one of them still has to list it (vitest throws on an unlisted export, and the phone route's fail-open catch would swallow that silently; `…/incoming/lifecycle.test.ts:158-161`, `:168-170`'s own note).

### Web (Tasks 3, 4)

```ts
// …/knowledge/price-sentence.ts (Task 3)
export type PriceKind = …;                         // local until Task 5, then `import type { PriceKind } from "@bis/db"`
export const PRICE_KINDS: readonly ["fixed", "from", "range", "per_unit", "free", "after_visit"];
export type PricedService = { name_en: string; name_es: string | null; price_kind: PriceKind;
  amount_cents: number | null; amount_max_cents: number | null; unit_en: string | null; unit_es: string | null };
export function formatUsd(cents: number): string;
export function priceSentence(s: PricedService, lang: "en" | "es"): string;   // throws on a shape the CHECK refuses

// …/knowledge/hours.ts (Task 3)
export const HOURS_DAYS_MONDAY_FIRST: readonly ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export function clockTime(hhmm: string): string;                  // "08:00" -> "8:00 AM"; "24:00" -> "midnight"
export function hoursLines(hours: OpenHours): string[];           // always 7 lines, Monday first
export function hasOpenDay(hours: OpenHours | null | undefined): hours is OpenHours;
export type OpenNow = { open: boolean; line: string };
export function openNow(hours: OpenHours, timeZone: string, now: Date): OpenNow;

// …/knowledge/payload.ts (Task 3)
export const KNOWLEDGE_RENDERER_VERSION = 1;
export type ServiceInput = PricedService & { description_en: string | null; description_es: string | null };
export type KnowledgeService = ServiceInput & { position: number; sentence_en: string; sentence_es: string };
export type KnowledgePayload = { schema: 1; facts: string; services_text: string; timezone: string;
  business_hours: OpenHours | null; hours_lines: string[] | null; services: KnowledgeService[]; renderer_version: number };
export type RenderedService = Pick<KnowledgeService, "name_en" | "name_es" | "description_en" | "description_es" | "sentence_en" | "sentence_es">;
export function usableHours(raw: unknown): OpenHours | null;     // normalized, spans sorted; null when no open day (SD17)
export function buildKnowledgePayload(input: { facts: string; servicesText: string; timezone: string;
  businessHours: unknown; services: readonly ServiceInput[] }): KnowledgePayload;
export function parseKnowledgePayload(raw: unknown): KnowledgePayload | null;
export function knowledgeFromLive(input: { profile: { facts: string; services: string; business_hours?: unknown };
  timezone: string; services: readonly ServiceInput[] | null }): { payload: KnowledgePayload; recordable: boolean };
export function promptKnowledge(p: KnowledgePayload): { facts: string; services: string;
  businessHours: OpenHours | null; priceList: RenderedService[] | null };

// …/knowledge/facts-warnings.ts (Task 3)
export type AmountMatch = { source: "facts" | "services"; index: number; text: string };
export function factsWarnings(facts: string, servicesText: string, o: { hasHours: boolean; hasPriceList: boolean }):
  { hours: "notice" | "hint" | null; amounts: AmountMatch[] };

// …/knowledge/prompt-blocks.ts (Task 4) — every literal in "The prompt lines" below
// apps/web/src/lib/voice/session-config.ts — VoicePromptInput gains (Task 4):
  businessHours?: OpenHours | null;
  priceList?: RenderedService[] | null;
```

`OpenHours` is `apps/web/src/lib/booking/slots.ts:10`, structurally identical to `WeeklyHours`.

### The prompt lines (spec §5.2, §5.2.1, §5.4; SD5–SD8; word for word)

- Headings:
  - `BUSINESS HOURS (the regular weekly hours; where hours written above differ, these are right, except a closure written above for a specific date):`
  - `SERVICES AND PRICES (the only prices you may give; for a price, say that service's sentence exactly as it is written here, in the language you are speaking):`
  - `SERVICES (what the business offers):` (insurance only, SD8)
- A list item: `- {name_en} — English: "{sentence_en}" Spanish: "{sentence_es}"`; insurance: `- {name_en}` or `- {name_en} (in Spanish: {name_es})`. Then, each only when present: `  About it, in English: {description_en}` and `  About it, in Spanish: {description_es}` (two leading spaces).
- The list's HARD LIMITS price line (replaces `system-prompt.ts:125` only when a list is given and the account is not insurance):
  `- Give a price only by saying, word for word, that service's sentence from SERVICES AND PRICES above. Any other amount written above, in the facts or the services, is not a price you may give. Never multiply, add up, estimate or round a price, never work out a total, and never quote a service that is not on the list: say the business will confirm pricing and offer to take their details. Wherever a rule below speaks of prices "in the facts", it means this list.`
- Phone, "Follow business hours", closed now (`B` = booking mode full, `H` = `handoffAvailable`, `M` = a trade module's block is in the prompt):
  `AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above{B: ", and book a time that check_availability returns"}. For anything that needs someone on the team, take a message and say the team will call them back once it opens.{H and M: " If they ask for a person, or it is urgent, you can still put them through."}{H and not M: " If they ask for a person, you can still put them through."}`
- Web chat, closed now: `AFTER HOURS — The business is closed right now (see Right now above); say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.`
- Voice demo, closed now: `AFTER HOURS — The business is closed right now (see Right now above); say so briefly and take a message; do not attempt anything else.`
- TOOLS, phone, `closedNow` and `handoffAvailable` (spec §5.2.1 point 2):
  - with a module: `- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person, or when they accept the offer on the URGENT path in the trade rules above. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.`
  - without: `- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.`
- The Right now lines (Task 3, `openNow`): `Right now: open until {t}.` / `Right now: open.` (SD16) / `Right now: closed; opens today at {t}.` / `… opens tomorrow at {t}.` / `… opens {Weekday} at {t}.` / `… opens next {Weekday} at {t}.` (SD16).

### The twelve price sentences (spec §5.1 table, C18; copied verbatim; pinned in Task 3)

| kind | English | Spanish |
|---|---|---|
| fixed | The price for {N} is {A}. | El precio de {N} es {A}. |
| from | The price for {N} starts at {A}. | El precio de {N} es desde {A}. |
| range | The price for {N} is between {A} and {B}. | El precio de {N} es de {A} a {B}. |
| per_unit | The price for {N} is {A} per {U}. | El precio de {N} es {A} por {U}. |
| free | There is no charge for {N}. | {N} no tiene costo. |
| after_visit | The price for {N} is given after a visit. | El precio de {N} se lo damos después de una visita. |

---

## Assumptions (each labelled, each with its check)

- **A1** No other lane has claimed 0095. Check (Task 0): `git -C <WT> log --all --oneline -- 'packages/db/supabase/migrations/0095*'` prints nothing (read 2026-10-23: nothing), and the newest file is `0094_trade_modules.sql` (read: it is).
- **A2** Both projects are at 0094: bis-ci `0094`, production `20261022093953` (ledger, 2026-10-22). Check (Task 0): read-only `max(version)` on both.
- **A3** PostgREST passes a JSON object to a `jsonb` RPC argument such that the stored snapshot deep-equals the object sent, and a second identical call is jsonb-equal (no new version). Check: Task 5's `voice-knowledge.test.ts` round-trip and equal-payload cases over PostgREST.
- **A4** A plpgsql `BEGIN … EXCEPTION` block rolls back every write made inside it when it catches (a subtransaction). Check: Task 1's "nothing written on refusal" case (an invalid list sent WITH a facts change leaves facts unchanged).
- **A5** `FOR NO KEY UPDATE` on `accounts` does not block inserts that reference the account (they take `FOR KEY SHARE`, which does not conflict). Check: Task 1's lock test inserts a call on the locked account from the second session WITHOUT a lock wait, before it asserts the second `ensure` waits.
- **A6** The logs the latency read needs exist: Supabase MCP `query_logs` on production returns PostgREST request rows with a duration, and the Vercel MCP `get_runtime_logs` returns the incoming route's invocations with a duration. If either does not, Task 0 says which and uses the fallback it names.
- **A7** `<input type="time">` cannot hold `24:00` (SD11). Check: Task 8 renders a stored `"24:00"` close as `00:00` and Task 7's validator maps it back; the design reviewer confirms in a browser if a build is provided.
- **A8** The client fixture user (`e2e/.auth/client-state.json`) is the fixture org's Owner (S-47a's A5 checked it). Not needed by Task 10's tests; listed because Task 11's reviewer may use it to view the call page as a client.

---

## Global constraints (every task brief inherits these; the S-47b plan's, `docs/superpowers/plans/2026-10-21-sofia-trade-modules-pr47b.md:249-321`, re-verified at `d3c377aa` where carried over)

- **Git:**
  - Never `git stash`, `git reset`, `git restore`, `git checkout` (not even to revert a probe), `--amend` or `rm -rf` under `<WT>` (memory "No rm -rf on worktrees").
  - Revert a probe by hand: `cp` the original back, then `cmp` it.
  - Stage new files with `git add -- <new paths>`. Commit with `git commit -m "…" -- <every path>`, never `-A` or `.`. Check `git diff --cached --stat` before every commit.
  - Never push (the orchestrator pushes). Never touch `main`.
  - Commits end with the two trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
  - Shared worktree: a task whose typecheck goes red re-runs it once after any sibling commit lands (`git log --oneline -3`) before reporting red.
- **Reviewers** probe in their OWN `git worktree add --detach <sha> <SCRATCH>/<name>-wt` (+ ONE `pnpm install --frozen-lockfile --prefer-offline`), never in `<WT>`, and remove it with `git worktree remove --force` only.
- **Databases:**
  - **No `@bis/db` vitest runs locally against bis-ci until Task 12 step 1 has applied 0095 there.** That includes mock-only files (the package's globalSetup sweep, `packages/db/vitest.config.ts:5-8`, runs on every invocation and `deleteAccountCascade` reads `document_versions` and deletes the listed tables; a test that seeds through `upsertVoiceProfile` names `business_hours` in its select). The same holds for the three LIVE web tests: `apps/web/src/app/f/[publicId]/actions.returning-lead.test.ts`, `…/call/actions.test.ts`, `weekly-metrics.live.test.ts`.
  - `withRollback` db tests run on the agent's own PG18 replica. `withTestAccount`/PostgREST tests run on the agent's own replica + PostgREST (`pgrst.sh`), or are proven by CI `verify` (its own in-runner stack, `.github/scripts/ci-local-supabase.sh`).
  - `packages/db/.env` and `apps/web/.env.local` do not exist in `<WT>`. Never create or copy either. To list e2e specs, source the main checkout's file into the SHELL only: `set -a; . /c/Users/danlo/bis-platform/apps/web/.env.local; set +a`. Never print it.
  - **0095 is applied only by the orchestrator**: bis-ci through `ci-project-setup.yml` (`push-dry-run`, then `push`), then production through MCP `apply_migration` ONCE, md5 compare, parity. Agents never apply a migration anywhere but their own replica.
- **The replica kit:** build `<SCRATCH>/<agent>-kit/` from `<KIT>` with `sed` and show the `diff`. Only these lines may differ (read 2026-10-23):
  - `replica.sh:6`: `WT=` becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s47c`.
  - `replica.sh:31`: `*0091_*` becomes `*0095_*`.
  - `replica.sh:36-40`: `0091_ai_acts.sql` becomes `0095_structured_facts.sql` (twice), and the three messages become `post = pre + 0095`, `0095 FAILED`, `post = pre (no 0095 yet)`.
  - `pgrst.sh:6`: `SECRET=` becomes `s47c-local-postgrest-jwt-secret-not-used-anywhere-real-0000`.
  - Unchanged and relied on: `replica.sh:15` (the three roles), `:19` (`sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql`, still the default-privileges lines at `d3c377aa`), `:21-29` (the storage stub 0077 needs); `pgrst.sh:5` (the `postgrest.exe`, `make-jwt.js`, `proxy.mjs` source directory, which exists), `:24-29` (`env-run.sh`).
  - `pre` = every migration through 0094; `post` = `pre` + 0095.
  - Stop your own kit only, by the four steps in `docs/superpowers/plans/2026-10-18-ai-proposals-tray-pr8b1.md:295-298` (`touch stop`; stop YOUR `postgrest.exe` by path; stop the gateway listener by port; `pg_ctl stop -m fast`). Never `taskkill /IM postgrest.exe`. A SQL probe on `post` with PostgREST up needs `notify pgrst, 'reload schema'` after it.
- **Ports:** this lane uses **55433-55445** only; each agent checks its ports are free first (PowerShell `Get-NetTCPConnection -LocalPort <p> -State Listen`).

  | Who | Postgres | PostgREST | gateway |
  |---|---|---|---|
  | Task 1 implementer | 55433 | — | — |
  | Task 1 reviewer | 55434 | — | — |
  | Task 5 implementer | 55435 | 55436 | 55437 |
  | Task 5 reviewer | 55438 | 55439 | 55440 |
  | Task 11 final reviewer | 55441 | 55442 | 55443 |
  | spare (a re-review) | 55444 | 55445 | — |
- **Faithfulness:** the client-write digest (the query at `packages/db/src/test/proposals-drop.test.ts:88-98`) on `pre` must equal bis-ci's value, which Task 0 reads (expected `51|0dd3e2d7e19f3f3649a893cfd9967d94`, the pinned literal at `:98`). 0095 must leave it UNCHANGED on `post`, and `schema-grants-guard.test.ts`'s `EXPECTED_WRITES` (`:65`) gains nothing.
- **SQL byte rules for 0095:**
  - ASCII only and no backslash: `LC_ALL=C tr -d '\000-\177' < f | wc -c` prints `0`; `grep -nF '\' f` prints nothing. "Sofia", never "Sofía". Regexes are written without backslashes (`[0-9]`, never `\d`) and without `$` anchors (a length check pins the end instead), so memory "MCP SQL escapes" cannot bite and every `$` is part of a `$$` pair.
  - Exactly **20** `$` characters: five `$$ … $$` bodies (the `do` block, the trigger function, the validator, the two RPCs). No `$` in any comment (write "dollar").
  - The word `cascade` appears exactly twice, both `on delete cascade` (the two new tables' `account_id`): `grep -niw cascade f` prints exactly those two lines. No `drop … cascade` anywhere, and no comment uses the word.
  - `''` appears exactly four times, each `set search_path = ''` (`grep -n "''" f` prints exactly those four lines): a blank check is written `length(btrim(x)) > 0`, never `<> ''`. No apostrophe inside a `--` comment or inside the text of a `comment on … is '…'` string (so no possessives: "the account row", never "the account's row").
  - No `begin;`/`commit;` wrapper.
  - `lock_timeout` set inside the first `do` block (`0094_trade_modules.sql:65-68`).
- **plpgsql NULL guard** (memory "plpgsql NULL guard"): any SQL condition on `app.is_agency()`-style helpers inside a definer function or a restrictive policy is `coalesce(…, false)`; an `IF NOT (…)` on a helper fails OPEN on NULL. Neither RPC calls a tenancy helper (they are reached only through `serviceDb()` behind the app's agency check, as `go_live`).
- **Tests must be able to fail** (memories "Test vacuity", "Vacuous test shapes"):
  - The implementer runs each named mutation, pastes the failing assertion line, and reverts by `cp` + `cmp`. A mutation counts as caught only if the WHOLE FILE goes red, never under one `-t` filter.
  - Each negative fixture is shaped so the rule it claims is the ONLY thing that can reject it (a shape refusal carries a valid name, kind and lengths; a newline refusal carries a valid shape).
  - Prompt lines, price sentences and copy are asserted as typed-out literals, never built by the function under test. A guard that greps source strips comments first and counts calls, not substrings. A loop over a literal list asserts what it iterated. Never a guard satisfiable by a doc comment or a WANT-constant.
  - Seed tests from what the REAL writer writes (rows through `save_voice_knowledge`/`saveVoiceKnowledge`, calls through `startCallRow`), never a hand-shaped row a writer would never produce.
  - Every account-scoped read gets a second-account case (`listVoiceServices`, `getKnowledgeSnapshot`, `getLatestKnowledgeVersion`, the RLS reads).
- **`@bis/db` in web:**
  - `…/knowledge/*.ts` imports only TYPES from `@bis/db` (`import type`), and only RELATIVE paths otherwise (`../../booking/slots`, never `@/…`): `system-prompt.ts` imports `prompt-blocks.ts`, and `scripts/sofia-corpus.ts` runs that graph under `tsx` with relative imports only (`apps/web/scripts/sofia-corpus.ts:15-20`). The one exception is `…/knowledge/save.ts` (Task 7, server-only, imports `@bis/db` values; never imported by the prompt).
  - The turn route and the web-session route import `@bis/db` LAZILY (`…/turn/route.ts:181-191`; `…/websession/route.ts:18-20`, `:101-104`); new functions are added to those destructures, never to a module-scope import.
  - A bare `vi.mock("@bis/db", () => ({…}))` factory: 81 files carry one (`grep -rln 'vi.mock("@bis/db", () =>' apps/web/src | wc -l`, read 2026-10-23). The 18 that import a changed accessor are Task 5's list. A module under test that CALLS a new function needs it in the factory, or the call silently fails open.
- **Affected tests, never the full suite locally** (memory "Agent test scope"): every test file that references a changed export, plus every source-scanning test: `grep -rln "readFileSync\|webSources\|code(" apps/web/src --include=*.test.ts`. Run by path: `pnpm --filter web exec vitest run "<path>" …`. `pnpm --filter web typecheck` in every task touching `.ts`/`.tsx`; `pnpm --filter @bis/db typecheck` in every task touching `packages/db/src`; both GREEN at every commit; `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on your replica, from `packages/db`: `node node_modules/vitest/vitest.mjs run <files>` after `export SUPABASE_DB_URL=postgres://postgres@localhost:<pg>/post` (withRollback) or `source <dir>/env-run.sh` (PostgREST). Capture the exit code to a file with nothing after the command in the same block. Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`); never Playwright beyond `--list`.
- **Copy:**
  - Every UI string through the catalogue (`apps/web/src/lib/messages.ts`) with its `.es` twin, rendered through `makeTr(locale, pseudo).text(key, params)` (`apps/web/src/lib/record/copy.ts:15-22`; usable in a client component, `components/ai-acts/act-undo.tsx` does). Spanish operator copy is **usted**. No JSX literal copy with a letter in it. No plumbing words ("snapshot" is allowed only on the knowledge page's internal heading if Task 2 names it; never "jsonb", "null", "payload", "price_kind", "RPC", "per_unit"). The persona is `{persona}`, never a typed "Sofía".
  - `messages.ts` belongs to **Task 2 only**. A later task that finds a key missing STOPS and reports.
  - The price sentences and the prompt lines are model input, not catalogue copy (spec §6): they live in `…/knowledge/*.ts` and are pinned by tests.
- **UI** (DESIGN.md binds every UI task): tokens only; both themes via `.dark`; existing components only (`Card`, `Checkbox`, `Input type="time"`, `Select`, `Button` ghost, `Notice`, `SubmitButton`, `EmptyState`); ONE primary per card (rule 8); loaded/empty/error states (rule 5); `useFormSubmit` for every form (`apps/web/src/lib/forms/use-form-submit.ts`), so a refused save keeps the operator's edits; time fields seed on pointerdown via `seedTimeOnPickerOpen` (`…/calendar/hours-form.ts:65-68`), never on focus.
- **Logs:** ids and codes only. Never a caller number, a name, a fact, a price, a prompt line, a payload or a key.

---
## Task 0: Pre-reads, the latency read, OQ1 (orchestrator)

- [ ] **Install once.** `cd <WT> && pnpm install --frozen-lockfile --prefer-offline`. No agent runs `pnpm install` in `<WT>` after this.
- [ ] **A1:** `git -C <WT> log --all --oneline -- 'packages/db/supabase/migrations/0095*'` prints nothing; `ls <WT>/packages/db/supabase/migrations | tail -1` is `0094_trade_modules.sql`.
- [ ] **Base check:** `git -C <WT> diff --stat 044b1ab2 HEAD -- apps packages` prints nothing (the plan commit and the spec are docs only), so `system-prompt.ts` and `modules/*` at HEAD ARE `044b1ab2`'s and Task 4's digest is recorded "at main 044b1ab2" as spec §7 asks. If HEAD has moved past a merge from `origin/main`, re-derive every file:line cite and amend this plan in one commit on this file only before dispatching.
- [ ] **The bare-factory list:** `grep -rln 'vi.mock("@bis/db", () =>' apps/web/src | xargs grep -lE "getCall\b|getVoiceProfile|startCallRow|createConciergeConversation|getConciergeConversation|upsertVoiceProfile"`. Expected: 18 files, read 2026-10-23:
  - `…/call/page.test.ts`, `contacts/[contactId]/page.test.ts`, four `conversations/page*.test.ts` (`page`, `page.pagination`, `page.webchat`, `page.zone`), `dashboard/page.test.ts`, `groups/[groupId]/page.test.ts`, `…/voice/page.test.ts`
  - `api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts`, `…/incoming/lifecycle.test.ts`, `…/incoming/route.test.ts`, `api/voice/texml/{handoff-result/route,route,screen/route,wellformed}.test.ts`
  - `lib/record/{group-loaders,loaders}.test.ts`

  Put the list into Task 5's brief. Of these, the modules under test of THREE call a new function: `…/incoming/route.test.ts` and `…/incoming/lifecycle.test.ts` (the route: `listVoiceServices`, `ensureKnowledgeSnapshot`; Task 6) and `…/voice/page.test.ts` (the page: `listVoiceServices`, `readAccountTimezone`, `getCalendarForAccount`; Task 8).
- [ ] **Read-only MCP `execute_sql`** on **both** `odnobiodsftffphuuosz` (bis-ci) and `tlbkbmlrfafquucsmsmm` (production):
  1. `select max(version) from supabase_migrations.schema_migrations;` (A2).
  2. The client-write digest (the query in `packages/db/src/test/proposals-drop.test.ts:89-97`), on bis-ci only → expected `51|0dd3e2d7e19f3f3649a893cfd9967d94`.
  3. `select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'voice_profiles' and column_name = 'business_hours') or (table_name in ('calls', 'concierge_conversations') and column_name = 'knowledge_version'));` → `0` on both. And `select to_regclass('public.voice_services'), to_regclass('public.voice_knowledge_snapshots');` → both NULL.
  4. Production only: `select count(*) from public.voice_profiles where trade_module is not null;` → `0` (the modules are paused, ledger 2026-10-23); recorded so Task 12's after-deploy read has a baseline.
- [ ] **STOP** if read 1 is not 0094 on both, or read 3 is non-zero anywhere.
- [ ] **The latency read (spec §5.5; A6).** What the phone path gains: one PostgREST GET (`listVoiceServices`) and one RPC POST (`ensure_knowledge_snapshot`), placed to overlap existing reads (SD18). Measure, read-only, and record in the ledger as `s47c T0 latency: …`:
  1. The cost of one PostgREST round trip from production's function region: Supabase MCP `query_logs` on `tlbkbmlrfafquucsmsmm`, the API (edge) log source, last 7 days, requests whose path starts `/rest/v1/voice_profiles` (the incoming route's step-7 read is one) and `/rest/v1/rpc/` (any RPC); record the count, p50 and p95 of the duration column the source exposes.
  2. The incoming route's own duration today: Vercel MCP `get_runtime_logs` for the production deployment, path `/api/voice/incoming`, last 14 days; record the count, p50 and max duration.
  3. Fallback if (1) or (2) has no duration: say so in the ledger and read it later from Preview instead (Task 12 step 3 times ten web-demo session mints on bis-ci before and after Task 6's build is deployed to Preview; the demo route gains the same services read).
  - **Gate:** if (1)'s p95 for a single round trip exceeds 300 ms, STOP before dispatching Task 6 and tell the owner (the added RPC is sequential with step 10 only if step 9b finishes first; see SD18).
- [ ] **OQ1 to the owner** with choice tiles (recommended first). Record the answer in the ledger and put it in Task 4's brief. Task 4 is not dispatched before it.
- [ ] **Ports** 55433-55445 free (`Get-NetTCPConnection -LocalPort <p> -State Listen` for each, PowerShell). If any is taken, shift the whole table by 20 and amend this plan in one commit.
- [ ] **Ledger line** `s47c T0: …` with every value. Put the digest into Task 1's and Task 5's briefs.

---

## Task 1 (HIGH): Migration 0095, the two RPCs, the validator, and their proof (bis-db-schema, opus)

**Files:**
- Create: `packages/db/supabase/migrations/0095_structured_facts.sql`
- Create: `packages/db/src/test/structured-facts-schema.test.ts` (withRollback)
- Create: `packages/db/src/test/structured-facts-lock.test.ts` (two sessions, committed seed)

**Interfaces:**
- Consumes: nothing.
- Produces: every object in "The model, 0095". Task 5 calls the two RPCs through PostgREST.

**Read first:** spec §4 and §4.1 whole; `0094_trade_modules.sql` (header style, the `do` block); `0077_document_vault.sql:123-223` (grants, policies, the trigger function's grants, the two definer functions); `0066_staff_and_roles.sql:61-98` (`is_account_owner`, the restrictive policies); `0063_go_live.sql:84-134` (the event insert, the revokes); `packages/db/src/test/db.ts` (`withRollback`, `actAs`, `actAsMember`, `actAsOwner`); `packages/db/src/test/document-requests-reserve-lock.test.ts:1-60` (the two-session lock shape).

- [ ] **Step 1: Build the kit** (Global constraints) on 55433. Show the `diff` against `<KIT>`. Confirm `pre`'s client-write digest equals Task 0's bis-ci value.

- [ ] **Step 2: Write the failing schema test** `packages/db/src/test/structured-facts-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0095_structured_facts.sql (S-47c): voice_profiles.business_hours, voice_services, voice_knowledge_snapshots,
 * the knowledge_version stamps with their composite keys, app.voice_business_hours_valid, and the two RPCs.
 * RED BEFORE APPLY: every case names an object that does not exist yet (except the teardown-list case, green on
 * pre by design).
 *
 * Every refusal names its constraint AND is shaped so that constraint is the only one that can refuse it: a shape
 * refusal carries a valid name, kind and lengths and changes exactly one amount or unit of a VALID row; a one-line
 * refusal carries a valid shape. Postgres tests CHECKs in alphabetical order of their names, so where two could
 * refuse one row (an unknown kind fails both price_kind and price_shape) the case names the first.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const P = (o: unknown) => JSON.stringify(o);
/** Line breaks built from code points, so this file holds no backslash escape (memory "Lane pipeline", 2026-10-22). */
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

type Seed = { accountId: string; orgId: string; phoneId: string; formId: string };
async function seed(c: Client, label: string, opts: { profile?: boolean } = {}): Promise<Seed> {
  await actAsOwner(c);
  const orgId = `org_facts_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Facts') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Structured facts', true) returning id`, [agency!.id, orgId]);
  if (opts.profile !== false) await c.query("insert into public.voice_profiles (account_id) values ($1)", [account!.id]);
  const { rows: [phone] } = await c.query<{ id: string }>(
    "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [account!.id, testPhoneNumber()]);
  const { rows: [form] } = await c.query<{ id: string }>(
    "insert into public.forms (account_id, public_id, name) values ($1, $2, 'Chat') returning id",
    [account!.id, `pub_facts_${label}_${RUN}`]);
  return { accountId: account!.id, orgId, phoneId: phone!.id, formId: form!.id };
}

type Row = {
  position?: number; name_en?: string; name_es?: string | null; description_en?: string | null; description_es?: string | null;
  price_kind: string; amount_cents: number | null; amount_max_cents: number | null; unit_en: string | null; unit_es: string | null;
};
/** One VALID row per kind; every refusal below changes exactly one field of one of these. */
const VALID: Record<string, Row> = {
  fixed: { price_kind: "fixed", amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null },
  from: { price_kind: "from", amount_cents: 15000, amount_max_cents: null, unit_en: null, unit_es: null },
  range: { price_kind: "range", amount_cents: 12000, amount_max_cents: 25050, unit_en: null, unit_es: null },
  per_unit: { price_kind: "per_unit", amount_cents: 3500, amount_max_cents: null, unit_en: "guest", unit_es: "invitado" },
  free: { price_kind: "free", amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null },
  after_visit: { price_kind: "after_visit", amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null },
};
function insertService(c: Client, accountId: string, r: Row) {
  return c.query(
    `insert into public.voice_services (account_id, position, name_en, name_es, description_en, description_es,
       price_kind, amount_cents, amount_max_cents, unit_en, unit_es)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [accountId, r.position ?? 1, r.name_en ?? "Haircut", r.name_es ?? null, r.description_en ?? null,
     r.description_es ?? null, r.price_kind, r.amount_cents, r.amount_max_cents, r.unit_en, r.unit_es]);
}
const SHAPE = { code: "23514", constraint: "voice_services_price_shape_check" };

/** Each clause of voice_services_price_shape_check, refused on its own (C16 is the per_unit/no unit_es row). */
const REFUSE: Array<[string, Row]> = [
  ["fixed without its amount", { ...VALID.fixed!, amount_cents: null }],
  ["fixed with a maximum", { ...VALID.fixed!, amount_max_cents: 3000 }],
  ["fixed with an English unit", { ...VALID.fixed!, unit_en: "hour" }],
  ["from with a Spanish unit", { ...VALID.from!, unit_es: "hora" }],
  ["from with a maximum", { ...VALID.from!, amount_max_cents: 20000 }],
  ["range without its maximum", { ...VALID.range!, amount_max_cents: null }],
  ["range with the maximum equal to the amount", { ...VALID.range!, amount_max_cents: 12000 }],
  ["range with the maximum below the amount", { ...VALID.range!, amount_max_cents: 11999 }],
  ["range with an English unit", { ...VALID.range!, unit_en: "hour" }],
  ["per_unit without its amount", { ...VALID.per_unit!, amount_cents: null }],
  ["per_unit without the English unit", { ...VALID.per_unit!, unit_en: null }],
  ["per_unit without the Spanish unit (C16)", { ...VALID.per_unit!, unit_es: null }],
  ["per_unit with a maximum", { ...VALID.per_unit!, amount_max_cents: 5000 }],
  ["free with an amount", { ...VALID.free!, amount_cents: 100 }],
  ["free with a maximum", { ...VALID.free!, amount_max_cents: 100 }],
  ["after_visit with a Spanish unit", { ...VALID.after_visit!, unit_es: "hora" }],
  ["after_visit with an amount", { ...VALID.after_visit!, amount_cents: 100 }],
];

describe("0095 voice_profiles.business_hours", () => {
  it("is jsonb, nullable, no default; a profile made without it reads null (mutation: default '{}' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'voice_profiles' and column_name = 'business_hours'`);
      expect(rows).toEqual([{ data_type: "jsonb", is_nullable: "YES", column_default: null }]);
      const { accountId } = await seed(c, "bh_null");
      expect((await c.query("select business_hours from public.voice_profiles where account_id = $1", [accountId])).rows)
        .toEqual([{ business_hours: null }]);
    }));
  it("takes an object and null; refuses an array by voice_profiles_business_hours_check (mutation: drop the CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "bh_check");
      await c.query("update public.voice_profiles set business_hours = $2::jsonb where account_id = $1", [accountId, P({ mon: [["08:00", "17:00"]] })]);
      await c.query("update public.voice_profiles set business_hours = null where account_id = $1", [accountId]);
      await expect(c.query("update public.voice_profiles set business_hours = '[]'::jsonb where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_profiles_business_hours_check" });
    }));
});

describe("0095 voice_services: the price shape (spec section 4; C2, C16)", () => {
  it("the refusal list has one row per clause (guards the loop from vacuity)", () => {
    expect(REFUSE.length).toBe(17);
    expect(Object.keys(VALID)).toEqual(["fixed", "from", "range", "per_unit", "free", "after_visit"]);
  });
  it.each(Object.entries(VALID))("accepts a valid %s row", (_k, row) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, `ok_${_k}`);
      await insertService(c, accountId, row);
      expect((await c.query("select count(*)::int as n from public.voice_services where account_id = $1", [accountId])).rows)
        .toEqual([{ n: 1 }]);
    }));
  it.each(REFUSE)("refuses %s by voice_services_price_shape_check (mutation: drop the CHECK -> FAILS)", (_n, row) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "shape");
      await expect(insertService(c, accountId, row)).rejects.toMatchObject(SHAPE);
    }));
  it("an unknown kind is refused by voice_services_price_kind_check (the first by name; mutation: drop it -> FAILS on the shape name instead)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "kind");
      await expect(insertService(c, accountId, { ...VALID.fixed!, price_kind: "hourly" }))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_services_price_kind_check" });
    }));
});

describe("0095 voice_services: one line per text column, lengths, positions", () => {
  const COLS = ["name_en", "name_es", "description_en", "description_es", "unit_en", "unit_es"] as const;
  it.each(COLS)("a line feed in %s is refused by voice_services_<column>_one_line (mutation: drop that CHECK -> FAILS)", (col) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, `nl_${col}`);
      const base: Row = col.startsWith("unit") ? { ...VALID.per_unit! } : { ...VALID.fixed! };
      const row: Row = { ...base, [col]: col.startsWith("unit") ? `per${LF}hour` : `Hair${LF}cut` };
      await expect(insertService(c, accountId, row)).rejects.toMatchObject({ code: "23514", constraint: `voice_services_${col}_one_line` });
    }));
  it("a carriage return is refused too (mutation: check chr(10) only -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "cr");
      await expect(insertService(c, accountId, { ...VALID.fixed!, name_en: `Hair${CR}cut` }))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_services_name_en_one_line" });
    }));
  it.each([
    ["name_en blank", { name_en: "   " }, "voice_services_name_en_check"],
    ["name_en 81 characters", { name_en: "a".repeat(81) }, "voice_services_name_en_check"],
    ["name_es empty", { name_es: "" }, "voice_services_name_es_check"],
    ["description_en 301 characters", { description_en: "d".repeat(301) }, "voice_services_description_en_check"],
    ["description_es blank", { description_es: " " }, "voice_services_description_es_check"],
  ] as const)("refuses %s by its named CHECK", (_n, over, constraint) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "len");
      await expect(insertService(c, accountId, { ...VALID.fixed!, ...over })).rejects.toMatchObject({ code: "23514", constraint });
    }));
  it("refuses a 31-character unit by voice_services_unit_es_check, and accepts 30 (mutation: between 1 and 31 -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "unit");
      await insertService(c, accountId, { ...VALID.per_unit!, unit_es: "u".repeat(30) });
      await expect(insertService(c, accountId, { ...VALID.per_unit!, position: 2, unit_es: "u".repeat(31) }))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_services_unit_es_check" });
    }));
  it("positions 1 and 50 are accepted; 0 and 51 refused by voice_services_position_check; a repeat by the unique key", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "pos");
      await insertService(c, accountId, { ...VALID.fixed!, position: 1 });
      await insertService(c, accountId, { ...VALID.fixed!, position: 50 });
      await expect(insertService(c, accountId, { ...VALID.fixed!, position: 0 })).rejects.toMatchObject({ code: "23514", constraint: "voice_services_position_check" });
    }));
  it("position 51 is refused (mutation: between 1 and 51 -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "pos51");
      await expect(insertService(c, accountId, { ...VALID.fixed!, position: 51 })).rejects.toMatchObject({ code: "23514", constraint: "voice_services_position_check" });
    }));
  it("one account cannot hold two rows at one position (mutation: drop the unique key -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "dup");
      await insertService(c, accountId, { ...VALID.fixed!, position: 3 });
      await expect(insertService(c, accountId, { ...VALID.free!, position: 3 }))
        .rejects.toMatchObject({ code: "23505", constraint: "voice_services_account_position_key" });
    }));
});

describe("0095 voice_knowledge_snapshots: numbered, never edited", () => {
  const snap = (c: Client, accountId: string, version: number, payload = "{}", by = "user_x") =>
    c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, $2, $3::jsonb, $4)",
      [accountId, version, payload, by]);
  it.each([
    ["version 0", 0, "{}", "user_x", "voice_knowledge_snapshots_version_check"],
    ["an array payload", 1, "[]", "user_x", "voice_knowledge_snapshots_payload_check"],
    ["a blank author", 1, "{}", "  ", "voice_knowledge_snapshots_created_by_check"],
  ] as const)("refuses %s by its named CHECK", (_n, v, payload, by, constraint) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "snapchk");
      await expect(snap(c, accountId, v, payload, by)).rejects.toMatchObject({ code: "23514", constraint });
    }));
  it("one version per account (mutation: drop the unique key -> FAILS); another account may hold the same number", () =>
    withRollback(async (c) => {
      const a = await seed(c, "snapdupA"); const b = await seed(c, "snapdupB");
      await snap(c, a.accountId, 1); await snap(c, b.accountId, 1);
      await expect(snap(c, a.accountId, 1)).rejects.toMatchObject({ code: "23505", constraint: "voice_knowledge_snapshots_account_version_key" });
    }));
  it("an UPDATE raises 55000 even for the table owner (mutation: drop the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "never");
      await snap(c, accountId, 1, P({ facts: "a" }));
      await expect(c.query("update public.voice_knowledge_snapshots set payload = '{}'::jsonb where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "55000" });
    }));
  it("the account row delete carries snapshots and services away, once its restrict-keyed rows are gone (deleteAccountCascade order; SD4; mutation: snapshots account_id on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "gone");
      await snap(c, s.accountId, 1);
      await insertService(c, s.accountId, VALID.fixed!);
      const { rows: [call] } = await c.query<{ id: string }>(
        "insert into public.calls (account_id, phone_number_id, knowledge_version) values ($1, $2, 1) returning id", [s.accountId, s.phoneId]);
      await c.query("delete from public.calls where id = $1", [call!.id]);
      await c.query("delete from public.forms where account_id = $1", [s.accountId]);
      await c.query("delete from public.voice_profiles where account_id = $1", [s.accountId]);
      await c.query("delete from public.phone_numbers where account_id = $1", [s.accountId]);
      await c.query("delete from public.accounts where id = $1", [s.accountId]);
      const { rows } = await c.query(`select (select count(*)::int from public.voice_knowledge_snapshots where account_id = $1) as snaps,
        (select count(*)::int from public.voice_services where account_id = $1) as services`, [s.accountId]);
      expect(rows).toEqual([{ snaps: 0, services: 0 }]);
    }));
  it("neither new table is on ACCOUNT_OWNED_TABLES: service_role cannot DELETE them, so a listed delete would fail every teardown (SD4)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed.includes("voice_services")).toBe(false);
    expect(listed.includes("voice_knowledge_snapshots")).toBe(false);
    expect(listed.includes("calls")).toBe(true); // the list is the real one, not an empty import
  });
});

/** The two stamped tables, as a literal list whose iteration is itself asserted. */
const STAMPED = ["calls", "concierge_conversations"] as const;
it("the stamped-table loop covers exactly calls and concierge_conversations", () => {
  expect([...STAMPED]).toEqual(["calls", "concierge_conversations"]);
});
for (const T of STAMPED) {
  describe(`0095 ${T}.knowledge_version`, () => {
    const insertRow = (c: Client, s: Seed, v: number | null) => T === "calls"
      ? c.query("insert into public.calls (account_id, phone_number_id, knowledge_version) values ($1, $2, $3) returning id", [s.accountId, s.phoneId, v])
      : c.query("insert into public.concierge_conversations (account_id, form_id, ip_hash, knowledge_version) values ($1, $2, 'iph', $3) returning id", [s.accountId, s.formId, v]);
    it("is integer, nullable, no default; NULL is admitted with no snapshot at all (MATCH SIMPLE)", () =>
      withRollback(async (c) => {
        const { rows } = await c.query(`select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = 'knowledge_version'`, [T]);
        expect(rows).toEqual([{ data_type: "integer", is_nullable: "YES", column_default: null }]);
        const s = await seed(c, `${T}_null`);
        await insertRow(c, s, null);
      }));
    it(`a version this account holds is admitted; a missing one is refused by ${T}_knowledge_version_fkey (mutation: drop the key -> FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_fk`);
        await c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 1, '{}', 'system')", [s.accountId]);
        await insertRow(c, s, 1);
        await expect(insertRow(c, s, 2)).rejects.toMatchObject({ code: "23503", constraint: `${T}_knowledge_version_fkey` });
      }));
    it("ANOTHER account's version 1 does not satisfy the key (the composite key; mutation: key on knowledge_version alone to a unique version column -> FAILS)", () =>
      withRollback(async (c) => {
        const a = await seed(c, `${T}_xa`); const b = await seed(c, `${T}_xb`);
        await c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 1, '{}', 'system')", [b.accountId]);
        await expect(insertRow(c, a, 1)).rejects.toMatchObject({ code: "23503", constraint: `${T}_knowledge_version_fkey` });
      }));
    it(`version 0 is refused by ${T}_knowledge_version_check`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_zero`);
        await expect(insertRow(c, s, 0)).rejects.toMatchObject({ code: "23514", constraint: `${T}_knowledge_version_check` });
      }));
  });
}

describe("0095 every new constraint, as defined", () => {
  it("pg_get_constraintdef for each (pinned after reading the replica's own output)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where contype <> 'n'
            and (conrelid in ('public.voice_services'::regclass, 'public.voice_knowledge_snapshots'::regclass)
                 or conname in ('voice_profiles_business_hours_check', 'calls_knowledge_version_check', 'calls_knowledge_version_fkey',
                                'concierge_conversations_knowledge_version_check', 'concierge_conversations_knowledge_version_fkey'))
          order by conname`);
      expect(Object.fromEntries(rows.map((r) => [r.conname, r.def]))).toEqual({
        // Step 5 pastes every def exactly as the post replica prints it, after reading that each says what the
        // migration says (the primary, unique and foreign keys included). contype 'n' is excluded on purpose: the
        // PG18 replica lists NOT NULL as named constraints and CI's stack is PostgreSQL 17
        // (packages/db/supabase/config.toml:42, major_version = 17), which does not, so a pinned map that held them
        // would pass locally and fail in verify.
      });
    }));
});

describe("0095 grants: the client role reads, nobody writes but the two functions", () => {
  it("table privileges on both new tables (mutations: grant insert to service_role -> FAILS; grant update to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || t || ' ' || p as k
           from (values ('public.voice_services'), ('public.voice_knowledge_snapshots')) tt(t)
          cross join (values ('anon'), ('authenticated'), ('service_role')) rr(r)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) pp(p)
          where has_table_privilege(r, t, p) order by 1`);
      expect(rows.map((r) => r.k)).toEqual([
        "authenticated public.voice_knowledge_snapshots SELECT", "authenticated public.voice_services SELECT",
        "service_role public.voice_knowledge_snapshots SELECT", "service_role public.voice_services SELECT",
      ]);
    }));
  it("function privileges: only service_role executes the two RPCs; nobody but the owner the validator (mutation: grant execute on save_voice_knowledge to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || f as k
           from (values ('public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer)'),
                        ('public.ensure_knowledge_snapshot(uuid, jsonb)'),
                        ('app.voice_business_hours_valid(jsonb)')) ff(f)
          cross join (values ('anon'), ('authenticated'), ('service_role')) rr(r)
          where has_function_privilege(r, f, 'EXECUTE') order by 1`);
      expect(rows.map((r) => r.k)).toEqual([
        "service_role public.ensure_knowledge_snapshot(uuid, jsonb)",
        "service_role public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer)",
      ]);
    }));
  it("business_hours: authenticated may SELECT it and not UPDATE it (column privileges; C17)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query(
        `select has_column_privilege('authenticated', 'public.voice_profiles', 'business_hours', 'SELECT') as sel,
                has_column_privilege('authenticated', 'public.voice_profiles', 'business_hours', 'UPDATE') as upd,
                has_column_privilege('anon', 'public.voice_profiles', 'business_hours', 'SELECT') as anon_sel`);
      expect(r).toEqual({ sel: true, upd: false, anon_sel: false });
    }));
  it("service_role cannot write either table directly (insert, update, delete, truncate: 42501)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "srv");
      await c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 1, '{}', 'system')", [accountId]);
      await c.query("set local role service_role");
      for (const sql of [
        "insert into public.voice_services (account_id, position, name_en, price_kind) values ($1, 1, 'A', 'free')",
        "insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 2, '{}', 'system')",
        "update public.voice_knowledge_snapshots set created_by = 'x' where account_id = $1",
        "delete from public.voice_knowledge_snapshots where account_id = $1",
        "delete from public.voice_services where account_id = $1",
      ]) {
        await c.query("savepoint s");
        await expect(c.query(sql, [accountId]), sql).rejects.toMatchObject({ code: "42501" });
        await c.query("rollback to savepoint s");
      }
      await expect(c.query("truncate public.voice_knowledge_snapshots")).rejects.toMatchObject({ code: "42501" });
    }));
  it("the agency's own token can neither write a row nor run either RPC (it writes through serviceDb)", () =>
    withRollback(async (c) => {
      const { accountId, orgId } = await seed(c, "agency");
      await actAs(c, { org_id: orgId, app_role: "agency_admin", sub: "user_facts_agency" });
      await c.query("savepoint s");
      await expect(c.query("insert into public.voice_services (account_id, position, name_en, price_kind) values ($1, 1, 'A', 'free')", [accountId]))
        .rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint s");
      await expect(c.query("select public.ensure_knowledge_snapshot($1, '{}'::jsonb)", [accountId])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0095 RLS: Owners read, Staff and Technicians do not, other accounts do not", () => {
  async function seeded(c: Client, label: string) {
    const s = await seed(c, label);
    await insertService(c, s.accountId, VALID.fixed!);
    await c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 1, '{}', 'system')", [s.accountId]);
    return s;
  }
  const counts = async (c: Client, accountId: string) => (await c.query(
    `select (select count(*)::int from public.voice_services where account_id = $1) as services,
            (select count(*)::int from public.voice_knowledge_snapshots where account_id = $1) as snaps`, [accountId])).rows[0];
  it("an Owner of the account reads both (mutation: drop the member-read policy -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seeded(c, "owner");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      expect(await counts(c, s.accountId)).toEqual({ services: 1, snaps: 1 });
    }));
  it.each(["staff", "technician"] as const)("a %s member reads neither (mutation: drop the owners-only policy -> FAILS)", (role) =>
    withRollback(async (c) => {
      const s = await seeded(c, `role_${role}`);
      await actAsMember(c, s.accountId, s.orgId, role);
      expect(await counts(c, s.accountId)).toEqual({ services: 0, snaps: 0 });
    }));
  it("an Owner of ANOTHER account reads neither (mutation: member-read using (true) -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seeded(c, "xa"); const b = await seed(c, "xb");
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect(await counts(c, a.accountId)).toEqual({ services: 0, snaps: 0 });
    }));
  it("the agency reads both", () =>
    withRollback(async (c) => {
      const s = await seeded(c, "ag");
      await actAs(c, { app_role: "agency_admin", sub: "user_facts_ag" });
      expect(await counts(c, s.accountId)).toEqual({ services: 1, snaps: 1 });
    }));
  it("anon has no grant at all (42501)", () =>
    withRollback(async (c) => {
      await seed(c, "anon");
      await c.query("set local role anon");
      await expect(c.query("select 1 from public.voice_services limit 1")).rejects.toMatchObject({ code: "42501" });
    }));
  it("every member reads business_hours, Staff included (C17; it is a voice_profiles column)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "bh_staff");
      await c.query("update public.voice_profiles set business_hours = $2::jsonb where account_id = $1", [s.accountId, P({ mon: [["08:00", "17:00"]] })]);
      await actAsMember(c, s.accountId, s.orgId, "staff");
      expect((await c.query("select business_hours from public.voice_profiles where account_id = $1", [s.accountId])).rows)
        .toEqual([{ business_hours: { mon: [["08:00", "17:00"]] } }]);
    }));
});

describe("0095 app.voice_business_hours_valid", () => {
  const ok = async (c: Client, h: unknown) =>
    (await c.query<{ v: boolean }>("select app.voice_business_hours_valid($1::jsonb) as v", [P(h)])).rows[0]!.v;
  it.each([
    ["one day", { mon: [["08:00", "17:00"]] }],
    ["a lunch gap", { tue: [["08:00", "12:00"], ["13:00", "18:00"]] }],
    ["touching spans", { wed: [["08:00", "12:00"], ["12:00", "18:00"]] }],
    ["an end at 24:00 and a start at 00:00", { fri: [["18:00", "24:00"]], sat: [["00:00", "02:00"]] }],
  ] as const)("accepts %s", (_n, h) => withRollback(async (c) => { expect(await ok(c, h)).toBe(true); }));
  it.each([
    ["an array", []],
    ["an empty object (no open day; SD17)", {}],
    ["an unknown day key", { monday: [["08:00", "17:00"]] }],
    ["an empty day", { mon: [] }],
    ["a span that is not a pair", { mon: [["08:00"]] }],
    ["a time without its leading zero", { mon: [["8:00", "17:00"]] }],
    ["24:00 as a start", { mon: [["24:00", "24:00"]] }],
    ["minute 60", { mon: [["08:60", "17:00"]] }],
    ["an end before its start", { mon: [["17:00", "08:00"]] }],
    ["an end equal to its start", { mon: [["08:00", "08:00"]] }],
    ["overlapping spans", { mon: [["08:00", "13:00"], ["12:00", "18:00"]] }],
    ["spans out of order", { mon: [["13:00", "18:00"], ["08:00", "12:00"]] }],
    ["a number for a time", { mon: [[800, 1700]] }],
  ] as const)("refuses %s (mutation: drop the matching check in the function -> that case FAILS)", (_n, h) =>
    withRollback(async (c) => { expect(await ok(c, h)).toBe(false); }));
});

describe("0095 save_voice_knowledge (spec 4.1)", () => {
  const H = { mon: [["08:00", "12:00"], ["13:00", "18:00"]] };
  const call = async (c: Client, accountId: string, parts: unknown, payload: unknown, base: number, actor = "user_saver") => {
    await c.query("set local role service_role");
    const { rows: [r] } = await c.query<{ r: Record<string, unknown> }>(
      "select public.save_voice_knowledge($1, $2, $3::jsonb, $4::jsonb, $5) as r", [accountId, actor, P(parts), P(payload), base]);
    await actAsOwner(c);
    return r!.r;
  };
  const state = async (c: Client, accountId: string) => (await c.query(
    `select vp.facts, vp.services, vp.business_hours,
            (select count(*)::int from public.voice_knowledge_snapshots s where s.account_id = vp.account_id) as snaps,
            (select count(*)::int from public.events e where e.account_id = vp.account_id and e.type = 'voice_profile.updated') as events,
            (select coalesce(json_agg(v.name_en order by v.position), '[]'::json) from public.voice_services v where v.account_id = vp.account_id) as names
       from public.voice_profiles vp where vp.account_id = $1`, [accountId])).rows[0];

  it("ok: writes the named parts, one event naming them, and snapshot 1 with the payload as sent, by the actor", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_ok");
      expect(await call(c, accountId, { facts: "Open late.", business_hours: H }, { v: 1 }, 0)).toEqual({ status: "ok", version: 1 });
      expect(await state(c, accountId)).toEqual({ facts: "Open late.", services: "", business_hours: H, snaps: 1, events: 1, names: [] });
      const { rows } = await c.query(`select s.version, s.payload, s.created_by, e.actor_type, e.actor_id, e.payload as ev
        from public.voice_knowledge_snapshots s join public.events e on e.account_id = s.account_id
       where s.account_id = $1 and e.type = 'voice_profile.updated'`, [accountId]);
      expect(rows).toEqual([{ version: 1, payload: { v: 1 }, created_by: "user_saver", actor_type: "user", actor_id: "user_saver",
        ev: { fields: ["facts", "business_hours"] } }]);
    }));
  it("the event names every part sent, in the fixed order (mutation: drop the services_text branch -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_fields");
      await call(c, accountId, { services: [], business_hours: null, services_text: "Roofs", facts: "F" }, { v: 1 }, 0);
      const { rows } = await c.query("select payload from public.events where account_id = $1 and type = 'voice_profile.updated'", [accountId]);
      expect(rows).toEqual([{ payload: { fields: ["facts", "services", "business_hours", "voice_services"] } }]);
    }));
  it("an equal payload records no new version and answers the latest (mutation: always append -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_eq");
      await call(c, accountId, { facts: "A" }, { v: 1 }, 0);
      expect(await call(c, accountId, { facts: "A" }, { v: 1 }, 1)).toEqual({ status: "ok", version: 1 });
      expect((await state(c, accountId))!.snaps).toBe(1);
    }));
  it("a different payload records version n+1", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_next");
      await call(c, accountId, { facts: "A" }, { v: 1 }, 0);
      expect(await call(c, accountId, { facts: "B" }, { v: 2 }, 1)).toEqual({ status: "ok", version: 2 });
    }));
  it("stale: a base that is no longer the latest writes nothing at all (mutation: drop the stale check -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_stale");
      await call(c, accountId, { facts: "A" }, { v: 1 }, 0);
      const before = await state(c, accountId);
      expect(await call(c, accountId, { facts: "B" }, { v: 2 }, 0)).toEqual({ status: "stale" });
      expect(await state(c, accountId)).toEqual(before);
    }));
  it("no_profile: an account with no voice profile, and an account that does not exist", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_noprof", { profile: false });
      expect(await call(c, accountId, { facts: "A" }, { v: 1 }, 0)).toEqual({ status: "no_profile" });
      expect(await call(c, "00000000-0000-0000-0000-000000000000", { facts: "A" }, { v: 1 }, 0)).toEqual({ status: "no_profile" });
    }));
  it("the services are replaced in order, positions 1..n (mutation: insert without the delete -> FAILS on the unique key)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_svc");
      const svc = (name_en: string) => ({ name_en, name_es: null, description_en: null, description_es: null, ...VALID.free! });
      await call(c, accountId, { services: [svc("A"), svc("B")] }, { v: 1 }, 0);
      await call(c, accountId, { services: [svc("C"), svc("A"), svc("D")] }, { v: 2 }, 1);
      expect((await state(c, accountId))!.names).toEqual(["C", "A", "D"]);
      const { rows } = await c.query("select position from public.voice_services where account_id = $1 order by position", [accountId]);
      expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    }));
  it.each([
    ["a per_unit row without its Spanish unit (C16)", { services: [{ name_en: "Catering", ...VALID.per_unit!, unit_es: null }] }],
    ["51 services", { services: Array.from({ length: 51 }, (_v, i) => ({ name_en: `S${i}`, ...VALID.free! })) }],
    ["an amount that is not a whole number of cents", { services: [{ name_en: "A", ...VALID.fixed!, amount_cents: "12.5" }] }],
    ["a service with no English name", { services: [{ ...VALID.free! }] }],
    ["malformed hours", { business_hours: { mon: [["17:00", "08:00"]] } }],
    ["hours as an array", { business_hours: [] }],
    ["facts as a number", { facts: 7 }],
    ["services as an object", { services: {} }],
    ["an unknown part", { facts: "A", notes: "x" }],
    ["no part at all", {}],
  ] as const)("invalid: %s, and nothing is written (mutation: drop the exception block -> the RPC raises instead, FAILS)", (_n, parts) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_inv");
      const before = await state(c, accountId);
      expect(await call(c, accountId, parts, { v: 9 }, 0)).toEqual({ status: "invalid" });
      expect(await state(c, accountId)).toEqual(before);
    }));
  it("a bad list sent WITH a facts change leaves the facts unchanged (A4: the block rolls back the update it already made; mutation: run the profile update before the block -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_atomic");
      await call(c, accountId, { facts: "Old" }, { v: 1 }, 0);
      expect(await call(c, accountId, { facts: "New", services: [{ name_en: "X", ...VALID.per_unit!, unit_es: null }] }, { v: 2 }, 1))
        .toEqual({ status: "invalid" });
      expect(await state(c, accountId)).toMatchObject({ facts: "Old", snaps: 1, events: 1 });
    }));
  it("clears the hours with JSON null", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_clear");
      await call(c, accountId, { business_hours: H }, { v: 1 }, 0);
      await call(c, accountId, { business_hours: null }, { v: 2 }, 1);
      expect((await state(c, accountId))!.business_hours).toBeNull();
    }));
  it("a null argument or a blank actor raises 22004 (SD21)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_null");
      await c.query("set local role service_role");
      await c.query("savepoint s");
      await expect(c.query("select public.save_voice_knowledge($1, '  ', '{}'::jsonb, '{}'::jsonb, 0)", [accountId]))
        .rejects.toMatchObject({ code: "22004" });
      await c.query("rollback to savepoint s");
      await expect(c.query("select public.save_voice_knowledge($1, 'u', null, '{}'::jsonb, 0)", [accountId]))
        .rejects.toMatchObject({ code: "22004" });
    }));
});

describe("0095 ensure_knowledge_snapshot (spec 4.1, 5.6)", () => {
  const ensure = async (c: Client, accountId: string, payload: unknown) => {
    await c.query("set local role service_role");
    const { rows: [r] } = await c.query<{ v: number }>("select public.ensure_knowledge_snapshot($1, $2::jsonb) as v", [accountId, P(payload)]);
    await actAsOwner(c);
    return r!.v;
  };
  it("appends version 1 as system, answers it again for an equal payload, and appends 2 for a different one (mutation: drop the equality -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "ens");
      expect(await ensure(c, accountId, { a: 1 })).toBe(1);
      expect(await ensure(c, accountId, { a: 1 })).toBe(1);
      expect(await ensure(c, accountId, { a: 2 })).toBe(2);
      const { rows } = await c.query("select version, created_by from public.voice_knowledge_snapshots where account_id = $1 order by version", [accountId]);
      expect(rows).toEqual([{ version: 1, created_by: "system" }, { version: 2, created_by: "system" }]);
    }));
  it("an account that does not exist raises P0002", () =>
    withRollback(async (c) => {
      await c.query("set local role service_role");
      await expect(c.query("select public.ensure_knowledge_snapshot('00000000-0000-0000-0000-000000000000', '{}'::jsonb)"))
        .rejects.toMatchObject({ code: "P0002" });
    }));
});

describe("0095 comments name their writer", () => {
  it("every column of the two new tables, both tables, and the three added columns carry a comment (mutation: delete one -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select cl.relname || '.' || a.attname as k from pg_attribute a
           join pg_class cl on cl.oid = a.attrelid join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
            and (cl.relname in ('voice_services', 'voice_knowledge_snapshots')
                 or (cl.relname = 'voice_profiles' and a.attname = 'business_hours')
                 or (cl.relname in ('calls', 'concierge_conversations') and a.attname = 'knowledge_version'))
            and coalesce(col_description(cl.oid, a.attnum), '') = ''
          order by 1`);
      expect(rows).toEqual([]);
      const { rows: t } = await c.query(`select obj_description('public.voice_services'::regclass, 'pg_class') is not null as s,
        obj_description('public.voice_knowledge_snapshots'::regclass, 'pg_class') is not null as k`);
      expect(t).toEqual([{ s: true, k: true }]);
    }));
  it("the stamps name their writers", () =>
    withRollback(async (c) => {
      const d = async (t: string) => (await c.query<{ d: string }>(
        "select col_description($1::regclass, (select attnum from pg_attribute where attrelid = $1::regclass and attname = 'knowledge_version')) as d", [t])).rows[0]!.d;
      expect(await d("public.calls")).toContain("startCallRow");
      expect(await d("public.concierge_conversations")).toContain("createConciergeConversation");
    }));
});
```

- If a role-read case returns `[]` where a row is expected, check the seed is `client_access_enabled = true` (`app.current_account_id()` is NULL otherwise, `0066_staff_and_roles.sql:82-83`) before touching the policy.

- [ ] **Step 3: Run on `pre` to verify it fails.** `export SUPABASE_DB_URL=postgres://postgres@localhost:55433/pre; node node_modules/vitest/vitest.mjs run src/test/structured-facts-schema.test.ts`. Expected: every case FAILS except three: the teardown-list case, the stamped-loop guard, and the refusal-count guard; the defs case's map is `{}` until Step 5. Record the counts.

- [ ] **Step 4: Write the migration** `packages/db/supabase/migrations/0095_structured_facts.sql`:

```sql
-- 0095_structured_facts.sql - Sofia knowledge as records: business hours, a price list she quotes word
-- for word, and a numbered snapshot of exactly what she was given, stamped on every call and website
-- chat (S-47 part c; F-037 part 1; decisions 21 and 28)
-- (docs/superpowers/specs/2026-10-23-sofia-structured-facts-design.md section 4;
--  docs/superpowers/plans/2026-10-23-sofia-structured-facts-pr47c.md, Task 1)
--
-- WHY. Until this file everything Sofia knew about a business was two free-text boxes (facts, services)
-- pasted into her prompt. She worked out whether the business was open herself, any amount anywhere in
-- the prose was quotable in her own words, and nobody could tell afterwards what she had been told on
-- the afternoon of a given call. Now the hours and the prices are records, code renders each price into
-- one fixed sentence per language, and every call and chat records the numbered snapshot of what she was
-- given (owner decisions C1 to C4).
--
-- WHAT THIS FILE ADDS:
--   public.voice_profiles.business_hours  jsonb, NULL = no structured hours (the behaviour before this
--     file). The calendars.open_hours shape (0016). Only an object is admitted by the CHECK; the inner
--     shape is checked by app.voice_business_hours_valid inside save_voice_knowledge (0016 set the
--     precedent of no deep CHECK on this JSON).
--   public.voice_services  the price list: up to 50 ordered rows per account, six price kinds, each kind
--     carrying exactly its amounts (voice_services_price_shape_check). No text column may hold a line
--     break: a name is one prompt line, and a break would start a line of instructions.
--   public.voice_knowledge_snapshots  append-only, numbered 1, 2, 3 per account, the payload exactly as
--     she is given it. Never edited (a BEFORE UPDATE trigger raises) and never deleted by any role
--     (UPDATE, DELETE and TRUNCATE are granted to nobody); rows leave only with their account, because
--     referential actions run as the table owner.
--   public.calls.knowledge_version and public.concierge_conversations.knowledge_version  the snapshot each
--     call and chat started under, with a composite foreign key to a snapshot of the SAME account. NULL
--     for every call and chat before this file, and for one whose snapshot could not be recorded.
--   app.voice_business_hours_valid, public.save_voice_knowledge, public.ensure_knowledge_snapshot.
--
-- WHO WRITES. Only the two functions, run as the function owner (security definer), EXECUTE granted to
-- service_role alone, called through serviceDb() behind the app agency check, as go_live (0063) and the
-- document functions (0077) are. save_voice_knowledge: every Voice page knowledge save (the Business
-- hours card, the Services and prices card, and the Facts and Services boxes of the profile card), all
-- of it in one transaction with its snapshot, under a lock on the account row so two writes on one
-- account queue and version numbers never collide. ensure_knowledge_snapshot: the incoming call route
-- and the concierge turn route, at call and chat start; it appends a snapshot (created_by system) only
-- when what she is about to be given differs from the latest one. The stamp columns: startCallRow and
-- createConciergeConversation, server only.
--
-- GRANTS AND POLICIES. Both new tables: everything revoked from public, anon, authenticated and
-- service_role, then SELECT to authenticated and service_role and nothing else, so even the server cannot
-- change the list without recording a snapshot. RLS on both: the tenant read (0077 shape) and a
-- restrictive Owners-only read (0066 shape, every helper coalesced). Client Owners read; Staff,
-- Technicians and anon read nothing; no client role writes anything, the agency token included.
-- business_hours inherits voice_profiles: authenticated SELECT (every member, as facts; decision C17),
-- no write verb. The client-write digest is unchanged.
--
-- TEARDOWN. Neither new table may be listed in ACCOUNT_OWNED_TABLES (packages/db/src/account-teardown.ts):
-- service_role holds no DELETE on them, so a listed delete would fail every teardown (the consent_events
-- precedent). The account row delete carries both away.
--
-- LOCKS. The ALTERs take ACCESS EXCLUSIVE on voice_profiles, calls and concierge_conversations for the
-- length of this file; the lock_timeout of 5s below is the protection. The two foreign keys are added
-- NOT VALID and then validated as the spec asks; inside one transaction that saves no lock (plan SD2),
-- and the validation reads an all-NULL column.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. LOAD-BEARING: PostgREST refuses a request
-- naming a column, table or function it does not know, and the build after this file names them on
-- every voice profile read (PROFILE_COLS: every call, every chat turn, the chat page, the Voice page,
-- every profile save), every call page (CALL_DETAIL_COLS), every later chat turn and the web chat sync
-- (CONVO_COLS), nearly every call and chat start (the stamp and ensure_knowledge_snapshot), every price
-- list read, and every Voice page knowledge save (save_voice_knowledge).
-- SAFE UNDER THE RUNNING BUILD: additive. The running build names none of these objects; the new columns
-- are nullable with no default, so its inserts leave them NULL, which every CHECK and key here admits.
--
-- ROLLBACK (roll the app back first), in this order. The stamp columns and the snapshots table only on an
-- owner decision, because they drop the record of what each call and chat knew:
--   drop function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer);
--   drop function public.ensure_knowledge_snapshot(uuid, jsonb);
--   drop function app.voice_business_hours_valid(jsonb);
--   alter table public.concierge_conversations drop column knowledge_version;  (its CHECK and key go too)
--   alter table public.calls drop column knowledge_version;                    (its CHECK and key go too)
--   drop table public.voice_knowledge_snapshots;                               (its trigger goes too)
--   drop function app.voice_knowledge_snapshots_never_edited();
--   drop table public.voice_services;
--   alter table public.voice_profiles drop column business_hours;              (its CHECK goes too)
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block, so it is always in
--    the block transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. Business hours on the profile.
alter table public.voice_profiles
  add column business_hours jsonb
    constraint voice_profiles_business_hours_check
      check (business_hours is null or jsonb_typeof(business_hours) = 'object');

comment on column public.voice_profiles.business_hours is
  'The regular weekly hours the receptionist answers whether the business is open from (the calendars.open_hours shape: keys sun to sat, each a list of HH:MM to HH:MM spans, 24:00 ends a day, an absent day is closed). NULL means no structured hours. Written only by save_voice_knowledge (0095), which checks the shape with app.voice_business_hours_valid and records a knowledge snapshot in the same transaction; upsertVoiceProfile refuses it. authenticated has SELECT (every member, decision C17) and no write.';

-- 2. The price list.
create table public.voice_services (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  position integer not null constraint voice_services_position_check check (position between 1 and 50),
  name_en text not null constraint voice_services_name_en_check check (length(btrim(name_en)) between 1 and 80),
  name_es text constraint voice_services_name_es_check check (name_es is null or length(btrim(name_es)) between 1 and 80),
  description_en text constraint voice_services_description_en_check
    check (description_en is null or length(btrim(description_en)) between 1 and 300),
  description_es text constraint voice_services_description_es_check
    check (description_es is null or length(btrim(description_es)) between 1 and 300),
  price_kind text not null constraint voice_services_price_kind_check
    check (price_kind in ('fixed', 'from', 'range', 'per_unit', 'free', 'after_visit')),
  amount_cents integer constraint voice_services_amount_cents_check
    check (amount_cents is null or amount_cents between 1 and 100000000),
  amount_max_cents integer,
  unit_en text constraint voice_services_unit_en_check check (unit_en is null or length(btrim(unit_en)) between 1 and 30),
  unit_es text constraint voice_services_unit_es_check check (unit_es is null or length(btrim(unit_es)) between 1 and 30),
  created_at timestamptz not null default now(),
  constraint voice_services_account_position_key unique (account_id, position),
  constraint voice_services_name_en_one_line check (strpos(name_en, chr(10)) = 0 and strpos(name_en, chr(13)) = 0),
  constraint voice_services_name_es_one_line check (strpos(name_es, chr(10)) = 0 and strpos(name_es, chr(13)) = 0),
  constraint voice_services_description_en_one_line
    check (strpos(description_en, chr(10)) = 0 and strpos(description_en, chr(13)) = 0),
  constraint voice_services_description_es_one_line
    check (strpos(description_es, chr(10)) = 0 and strpos(description_es, chr(13)) = 0),
  constraint voice_services_unit_en_one_line check (strpos(unit_en, chr(10)) = 0 and strpos(unit_en, chr(13)) = 0),
  constraint voice_services_unit_es_one_line check (strpos(unit_es, chr(10)) = 0 and strpos(unit_es, chr(13)) = 0),
  constraint voice_services_price_shape_check check (
       (price_kind in ('fixed', 'from') and amount_cents is not null
          and amount_max_cents is null and unit_en is null and unit_es is null)
    or (price_kind = 'range' and amount_cents is not null and amount_max_cents is not null
          and amount_max_cents > amount_cents and unit_en is null and unit_es is null)
    or (price_kind = 'per_unit' and amount_cents is not null and amount_max_cents is null
          and unit_en is not null and unit_es is not null)
    or (price_kind in ('free', 'after_visit') and amount_cents is null
          and amount_max_cents is null and unit_en is null and unit_es is null))
);

comment on table public.voice_services is
  'The price list the receptionist quotes from (0095, decisions C2, C3, C11, C16): up to 50 ordered rows per account. Code renders each row into one fixed sentence in English and one in Spanish, and she says only those sentences. Written only by save_voice_knowledge, which replaces the whole list and records a knowledge snapshot in the same transaction; no role holds INSERT, UPDATE or DELETE. Owners and the agency read it.';
comment on column public.voice_services.id is 'Row id. Never part of a knowledge snapshot (the list is replaced on every save).';
comment on column public.voice_services.account_id is 'The account. The account row delete carries the list away. Written by save_voice_knowledge.';
comment on column public.voice_services.position is 'Order on the Voice page and in the prompt, 1 to 50, unique per account. Written by save_voice_knowledge as 1..n in the order sent.';
comment on column public.voice_services.name_en is 'The service name, one line, 1 to 80 characters. Written by save_voice_knowledge.';
comment on column public.voice_services.name_es is 'The Spanish name, or NULL, in which case the Spanish sentence uses the English name. Written by save_voice_knowledge.';
comment on column public.voice_services.description_en is 'An optional one-line description in English, up to 300 characters. Written by save_voice_knowledge.';
comment on column public.voice_services.description_es is 'An optional one-line description in Spanish, up to 300 characters. Written by save_voice_knowledge.';
comment on column public.voice_services.price_kind is 'fixed, from, range, per_unit, free or after_visit; voice_services_price_shape_check holds each kind to exactly its amounts. Written by save_voice_knowledge.';
comment on column public.voice_services.amount_cents is 'US cents: the price (fixed, from, per_unit) or the low end (range); NULL for free and after_visit. Written by save_voice_knowledge.';
comment on column public.voice_services.amount_max_cents is 'US cents, the high end of a range, above amount_cents; NULL for every other kind. Written by save_voice_knowledge.';
comment on column public.voice_services.unit_en is 'The English unit of a per_unit price (guest, hour); required with unit_es for per_unit (decision C16), NULL otherwise. Written by save_voice_knowledge.';
comment on column public.voice_services.unit_es is 'The Spanish unit of a per_unit price (invitado, hora); required for per_unit, no English fallback (decision C16). Written by save_voice_knowledge.';
comment on column public.voice_services.created_at is 'When save_voice_knowledge wrote this row (every save rewrites the list).';

-- 3. The snapshots, append-only.
create table public.voice_knowledge_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  version integer not null constraint voice_knowledge_snapshots_version_check check (version > 0),
  payload jsonb not null constraint voice_knowledge_snapshots_payload_check check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  created_by text not null constraint voice_knowledge_snapshots_created_by_check check (length(btrim(created_by)) > 0),
  constraint voice_knowledge_snapshots_account_version_key unique (account_id, version)
);

comment on table public.voice_knowledge_snapshots is
  'Numbered, never-edited snapshots of exactly what the receptionist is given about an account (0095, decisions C4 and C15). Appended only by save_voice_knowledge (a Voice page save) and ensure_knowledge_snapshot (call or chat start, when what she is about to be given differs from the latest). calls and concierge_conversations stamp the version they started under. No role holds INSERT, UPDATE, DELETE or TRUNCATE; a trigger refuses every UPDATE; rows leave only with their account.';
comment on column public.voice_knowledge_snapshots.id is 'Row id.';
comment on column public.voice_knowledge_snapshots.account_id is 'The account. The account row delete carries its snapshots away.';
comment on column public.voice_knowledge_snapshots.version is 'Per account, 1, 2, 3 in order, under a lock on the account row in both writing functions.';
comment on column public.voice_knowledge_snapshots.payload is 'Exactly what she is given, built by the app (apps/web/src/lib/voice/knowledge/payload.ts): facts, services text, zone, hours and their rendered lines, the list with both rendered sentences, and the renderer version. Not the moment-dependent Right now line.';
comment on column public.voice_knowledge_snapshots.created_at is 'When the snapshot was appended.';
comment on column public.voice_knowledge_snapshots.created_by is 'The Clerk user id of the agency person who saved, or system for a snapshot ensure_knowledge_snapshot recorded at call or chat start.';

create function app.voice_knowledge_snapshots_never_edited() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'voice_knowledge_snapshots: a snapshot is never edited' using errcode = '55000';
end $$;
create trigger voice_knowledge_snapshots_never_edited before update on public.voice_knowledge_snapshots
  for each row execute function app.voice_knowledge_snapshots_never_edited();
revoke all on function app.voice_knowledge_snapshots_never_edited() from public, anon;
grant execute on function app.voice_knowledge_snapshots_never_edited() to authenticated, service_role;

-- 4. Grants and policies (spec section 4). SELECT for the client role and the server, nothing else.
alter table public.voice_services enable row level security;
alter table public.voice_knowledge_snapshots enable row level security;
revoke all on public.voice_services, public.voice_knowledge_snapshots from public, anon, authenticated, service_role;
grant select on public.voice_services, public.voice_knowledge_snapshots to authenticated, service_role;

create policy voice_services_member_read on public.voice_services for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy voice_services_owners_only on public.voice_services as restrictive for select to authenticated
  using ((select coalesce(app.is_agency(), false))
         or (account_id = (select app.current_account_id())
             and (select app.is_account_owner(app.current_account_id()))));
create policy voice_knowledge_snapshots_member_read on public.voice_knowledge_snapshots for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy voice_knowledge_snapshots_owners_only on public.voice_knowledge_snapshots as restrictive for select to authenticated
  using ((select coalesce(app.is_agency(), false))
         or (account_id = (select app.current_account_id())
             and (select app.is_account_owner(app.current_account_id()))));

-- 5. The stamps. NULL passes the composite key (MATCH SIMPLE).
alter table public.calls
  add column knowledge_version integer
    constraint calls_knowledge_version_check check (knowledge_version > 0);
alter table public.calls
  add constraint calls_knowledge_version_fkey foreign key (account_id, knowledge_version)
    references public.voice_knowledge_snapshots (account_id, version) not valid;
alter table public.calls validate constraint calls_knowledge_version_fkey;

comment on column public.calls.knowledge_version is
  'The knowledge snapshot (voice_knowledge_snapshots.version of this account) this call started under, written once at call start by the incoming call route through startCallRow, from the same payload that built the prompt. NULL for calls before 0095 and for a call whose snapshot could not be recorded (fail-open). Server-written only.';

alter table public.concierge_conversations
  add column knowledge_version integer
    constraint concierge_conversations_knowledge_version_check check (knowledge_version > 0);
alter table public.concierge_conversations
  add constraint concierge_conversations_knowledge_version_fkey foreign key (account_id, knowledge_version)
    references public.voice_knowledge_snapshots (account_id, version) not valid;
alter table public.concierge_conversations validate constraint concierge_conversations_knowledge_version_fkey;

comment on column public.concierge_conversations.knowledge_version is
  'The knowledge snapshot this website chat runs under, written once when the concierge turn route creates the conversation (createConciergeConversation). Every later turn builds its prompt from that snapshot, not the live profile, so a chat keeps its starting knowledge. NULL for chats before 0095 and for one whose snapshot could not be recorded. Server-written only.';

-- 6. The hours shape. Times are compared as minutes, never as text, so no collation can reorder them.
create function app.voice_business_hours_valid(p_hours jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_day text; v_spans jsonb; v_span jsonb; v_from text; v_to text;
  v_from_m integer; v_to_m integer; v_prev_m integer; v_days integer := 0;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then return false; end if;
  for v_day, v_spans in select e.key, e.value from jsonb_each(p_hours) as e loop
    if v_day not in ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat') then return false; end if;
    if jsonb_typeof(v_spans) <> 'array' or jsonb_array_length(v_spans) = 0 then return false; end if;
    v_prev_m := null;
    for v_span in select a.value from jsonb_array_elements(v_spans) as a loop
      if jsonb_typeof(v_span) <> 'array' or jsonb_array_length(v_span) <> 2
         or jsonb_typeof(v_span -> 0) <> 'string' or jsonb_typeof(v_span -> 1) <> 'string' then
        return false;
      end if;
      v_from := v_span ->> 0;
      v_to := v_span ->> 1;
      if length(v_from) <> 5 or v_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]' then return false; end if;
      if length(v_to) <> 5 or (v_to <> '24:00' and v_to !~ '^([01][0-9]|2[0-3]):[0-5][0-9]') then return false; end if;
      v_from_m := substr(v_from, 1, 2)::integer * 60 + substr(v_from, 4, 2)::integer;
      v_to_m := substr(v_to, 1, 2)::integer * 60 + substr(v_to, 4, 2)::integer;
      if v_to_m <= v_from_m then return false; end if;
      if v_prev_m is not null and v_from_m < v_prev_m then return false; end if;
      v_prev_m := v_to_m;
    end loop;
    v_days := v_days + 1;
  end loop;
  return v_days > 0;
end $$;
revoke all on function app.voice_business_hours_valid(jsonb) from public, anon, authenticated, service_role;
comment on function app.voice_business_hours_valid(jsonb) is
  'True when a value is a valid business_hours object: keys sun to sat only, each a non-empty list of two-string spans HH:MM to HH:MM (24:00 may end a day), each end after its start, spans in order and not overlapping, at least one day. Called only by save_voice_knowledge, as the function owner.';

-- 7. Every Voice page knowledge save, all or nothing, with its snapshot (spec 4.1).
create function public.save_voice_knowledge(
  p_account_id uuid, p_actor text, p_parts jsonb, p_payload jsonb, p_base_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_latest integer;
  v_latest_payload jsonb;
  v_version integer;
  v_fields text[] := array[]::text[];
begin
  if p_account_id is null or p_parts is null or p_payload is null or p_base_version is null then
    raise exception 'save_voice_knowledge: a required argument is null' using errcode = '22004';
  end if;
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'save_voice_knowledge: an actor is required' using errcode = '22004';
  end if;
  perform 1 from public.accounts where id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'no_profile'); end if;
  perform 1 from public.voice_profiles where account_id = p_account_id;
  if not found then return jsonb_build_object('status', 'no_profile'); end if;
  select s.version, s.payload into v_latest, v_latest_payload
    from public.voice_knowledge_snapshots s
   where s.account_id = p_account_id
   order by s.version desc
   limit 1;
  if coalesce(v_latest, 0) <> p_base_version then
    return jsonb_build_object('status', 'stale');
  end if;
  if jsonb_typeof(p_parts) <> 'object' or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not (p_parts ?| array['facts', 'services_text', 'business_hours', 'services'])
     or exists (select 1 from jsonb_object_keys(p_parts) as k(key)
                 where k.key not in ('facts', 'services_text', 'business_hours', 'services')) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if (p_parts ? 'facts' and jsonb_typeof(p_parts -> 'facts') <> 'string')
     or (p_parts ? 'services_text' and jsonb_typeof(p_parts -> 'services_text') <> 'string')
     or (p_parts ? 'services' and jsonb_typeof(p_parts -> 'services') <> 'array') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_parts ? 'business_hours' and jsonb_typeof(p_parts -> 'business_hours') <> 'null'
     and not app.voice_business_hours_valid(p_parts -> 'business_hours') then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Every write is inside this block: a refusal by any CHECK, key or cast rolls back what the block
  -- already wrote (a subtransaction) and answers invalid.
  begin
    if p_parts ?| array['facts', 'services_text', 'business_hours'] then
      update public.voice_profiles
         set facts = case when p_parts ? 'facts' then p_parts ->> 'facts' else facts end,
             services = case when p_parts ? 'services_text' then p_parts ->> 'services_text' else services end,
             business_hours = case
               when not (p_parts ? 'business_hours') then business_hours
               when jsonb_typeof(p_parts -> 'business_hours') = 'null' then null
               else p_parts -> 'business_hours' end,
             updated_at = pg_catalog.now()
       where account_id = p_account_id;
    end if;
    if p_parts ? 'services' then
      delete from public.voice_services where account_id = p_account_id;
      insert into public.voice_services (account_id, position, name_en, name_es, description_en, description_es,
                                         price_kind, amount_cents, amount_max_cents, unit_en, unit_es)
      select p_account_id, e.ord::integer, e.v ->> 'name_en', e.v ->> 'name_es', e.v ->> 'description_en',
             e.v ->> 'description_es', e.v ->> 'price_kind', (e.v ->> 'amount_cents')::integer,
             (e.v ->> 'amount_max_cents')::integer, e.v ->> 'unit_en', e.v ->> 'unit_es'
        from jsonb_array_elements(p_parts -> 'services') with ordinality as e(v, ord);
    end if;
    if p_parts ? 'facts' then v_fields := array_append(v_fields, 'facts'); end if;
    if p_parts ? 'services_text' then v_fields := array_append(v_fields, 'services'); end if;
    if p_parts ? 'business_hours' then v_fields := array_append(v_fields, 'business_hours'); end if;
    if p_parts ? 'services' then v_fields := array_append(v_fields, 'voice_services'); end if;
    insert into public.events (account_id, type, actor_type, actor_id, payload)
    values (p_account_id, 'voice_profile.updated', 'user', p_actor,
            pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(v_fields)));
    if v_latest is not null and v_latest_payload = p_payload then
      v_version := v_latest;
    else
      v_version := coalesce(v_latest, 0) + 1;
      insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by)
      values (p_account_id, v_version, p_payload, p_actor);
    end if;
  exception
    when check_violation or not_null_violation or unique_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation then
      return jsonb_build_object('status', 'invalid');
  end;
  return jsonb_build_object('status', 'ok', 'version', v_version);
end $$;
revoke all on function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer) to service_role;
comment on function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer) is
  'Every Voice page knowledge save (0095, decision C9). Under a lock on the account row: answers no_profile (no account or no voice profile), stale (p_base_version is not the latest snapshot version, 0 for none) or invalid (a malformed part, or any row a CHECK or key refuses), writing nothing; otherwise, in one transaction, writes the named parts (facts, services_text into voice_profiles.services, business_hours, and services, which replaces the whole list at positions 1..n), records voice_profile.updated naming them, and appends a snapshot of p_payload by p_actor unless the latest payload already equals it. Raises 22004 on a null argument or a blank actor. EXECUTE: service_role only, through serviceDb behind the app agency check.';

-- 8. The call and chat start snapshot (spec 4.1, 5.6).
create function public.ensure_knowledge_snapshot(p_account_id uuid, p_payload jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_latest integer;
  v_latest_payload jsonb;
begin
  if p_account_id is null or p_payload is null then
    raise exception 'ensure_knowledge_snapshot: a required argument is null' using errcode = '22004';
  end if;
  perform 1 from public.accounts where id = p_account_id for no key update;
  if not found then
    raise exception 'ensure_knowledge_snapshot: no such account' using errcode = 'P0002';
  end if;
  select s.version, s.payload into v_latest, v_latest_payload
    from public.voice_knowledge_snapshots s
   where s.account_id = p_account_id
   order by s.version desc
   limit 1;
  if v_latest is not null and v_latest_payload = p_payload then
    return v_latest;
  end if;
  insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by)
  values (p_account_id, coalesce(v_latest, 0) + 1, p_payload, 'system');
  return coalesce(v_latest, 0) + 1;
end $$;
revoke all on function public.ensure_knowledge_snapshot(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ensure_knowledge_snapshot(uuid, jsonb) to service_role;
comment on function public.ensure_knowledge_snapshot(uuid, jsonb) is
  'At call and chat start (0095, spec 5.6): under a lock on the account row, answers the latest snapshot version when its payload equals p_payload, else appends p_payload as the next version by system and answers it. Raises 22004 on a null argument and P0002 when the account does not exist; a payload that is not an object is refused by the table CHECK. The callers fail open (the call or chat goes on unstamped). EXECUTE: service_role only.';
```

**Plan-writer check (2026-10-23; evidence that the SQL above is sound, NOT a substitute for Steps 5–8).** The SQL block above, extracted from this plan file, was applied with `psql -1` to a PG18 replica built by `replica.sh` on top of every migration through 0094 (port 55460, outside this lane's ports; stopped since). It applied cleanly. On `post`: the client-write digest read `51|0dd3e2d7e19f3f3649a893cfd9967d94`. As `service_role`, `save_voice_knowledge` answered, in order: ok v1; ok v1 (an equal payload); stale; invalid (a `per_unit` row without `unit_es` sent with a Facts change — Facts stayed as before, A4); invalid (`amount_cents` `"12.5"`); invalid (an unknown part); ok v2 (hours cleared with JSON null). `ensure_knowledge_snapshot` then answered 2 (equal) and 3 (new, `created_by` system). The three events read `{"fields": ["facts", "business_hours", "voice_services"]}`, `{"fields": ["facts"]}`, `{"fields": ["business_hours"]}`. The table owner's UPDATE of a snapshot raised the trigger; `service_role`'s insert into `voice_services` was denied; an unknown kind was refused by `voice_services_price_kind_check` (first by name). With real memberships, an Owner read 1 service and 1 snapshot, a Staff member 0 and 0, the agency 1; the agency token's `ensure` was denied. The validator answered t/f/f/f for a valid week with touching spans and a 24:00 end, `{}`, an overlap, and a 24:00 start. The defs query below read 30 rows. Not run by the plan writer: the vitest files, the lock test, the mutations, the rollback.

- [ ] **Step 5: Re-build the kit** (it applies 0095 to `post` with `psql -1`). Read every def: `psql -h localhost -p 55433 -U postgres -d post -c "select conname, pg_get_constraintdef(oid) from pg_constraint where contype <> 'n' and (conrelid in ('public.voice_services'::regclass, 'public.voice_knowledge_snapshots'::regclass) or conname in ('voice_profiles_business_hours_check','calls_knowledge_version_check','calls_knowledge_version_fkey','concierge_conversations_knowledge_version_check','concierge_conversations_knowledge_version_fkey')) order by 1"` (expected: **30** rows, read by the plan writer on 2026-10-23 off a PG18 replica with this file's SQL applied: see "Plan-writer check" below). Check each says what the migration says, then paste all into the defs test's `toEqual({...})`. Run on `post`: `export SUPABASE_DB_URL=postgres://postgres@localhost:55433/post; node node_modules/vitest/vitest.mjs run src/test/structured-facts-schema.test.ts src/test/trade-modules-schema.test.ts src/test/schema-grants-guard.test.ts src/test/proposals-drop.test.ts src/test/server-only-writes-grants.test.ts src/test/concierge-grants.test.ts src/test/go-live-grants.test.ts` → all green (all seven are withRollback-only, read 2026-10-23). Read the run counts.

- [ ] **Step 6: Write the lock test** `packages/db/src/test/structured-facts-lock.test.ts`, in the shape of `document-requests-reserve-lock.test.ts:1-60` (committed seed whose org id carries `TEST_ORG_ID_PREFIX`; three connections; cleanup in `finally` in this order: `voice_profiles`, `accounts`; the RPCs write no `events` row here, so the account delete is not blocked):

```ts
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import "dotenv/config";
import { TEST_ORG_ID_PREFIX } from "../org-id";

/**
 * 0095 (spec 4.1): both RPCs lock the account row FOR NO KEY UPDATE before they read the latest version, so two
 * knowledge writes on one account queue and version numbers never collide. Proven directly: while session A holds
 * an open ensure_knowledge_snapshot, session B's own FOR NO KEY UPDATE on that account row times out (55P03), and
 * B can still insert a call that references the account (A5: FOR KEY SHARE does not conflict). Then two concurrent
 * ensures of one NEW payload make exactly one row: B waits for A, then finds A's payload equal and answers it.
 */
const URL = process.env.SUPABASE_DB_URL;
const RUN = Math.random().toString(36).slice(2, 10);
const conn = () => new Client({ connectionString: URL, connectionTimeoutMillis: 10_000 });
const ENSURE = "select public.ensure_knowledge_snapshot($1, $2::jsonb) as v";

async function seedAccount(c: Client, label: string): Promise<{ acct: string; phone: string }> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Facts lock') returning id",
    [agency!.id, `${TEST_ORG_ID_PREFIX}factslock_${label}_${RUN}`])).rows[0]!.id;
  await c.query("insert into voice_profiles (account_id) values ($1)", [acct]);
  const phone = (await c.query<{ id: string }>(
    "insert into phone_numbers (account_id, e164) values ($1, $2) returning id",
    [acct, `+1557${String(1_000_000 + Math.floor(Math.random() * 8_999_999))}`])).rows[0]!.id;
  return { acct, phone };
}
async function cleanup(c: Client, acct: string | null) {
  if (!acct) return;
  await c.query("delete from calls where account_id = $1", [acct]);
  await c.query("delete from voice_profiles where account_id = $1", [acct]);
  await c.query("delete from phone_numbers where account_id = $1", [acct]);
  await c.query("delete from accounts where id = $1", [acct]);
}

describe("0095: knowledge writes serialise on the account row", () => {
  it("an open ensure holds the account row lock; a call insert on that account does not wait (mutation: drop `for no key update` from ensure -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const s = await seedAccount(seedC, "lock"); acct = s.acct;
      await a.query("begin");
      expect((await a.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ a: 1 })])).rows[0]!.v).toBe(1);
      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      await b.query("insert into calls (account_id, phone_number_id) values ($1, $2)", [acct, s.phone]); // A5
      await expect(b.query("select 1 from accounts where id = $1 for no key update", [acct])).rejects.toMatchObject({ code: "55P03" });
      await b.query("rollback");
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {}); await b.query("rollback").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });

  it("two concurrent ensures of one new payload make exactly one row (mutation: drop the equality check -> B answers 2, FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      acct = (await seedAccount(seedC, "pair")).acct;
      await a.query("begin");
      expect((await a.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ p: 1 })])).rows[0]!.v).toBe(1);
      const bDone = b.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ p: 1 })]); // waits on A
      await new Promise((r) => setTimeout(r, 200));
      await a.query("commit");
      expect((await bDone).rows[0]!.v).toBe(1);
      expect((await seedC.query("select count(*)::int as n from voice_knowledge_snapshots where account_id = $1", [acct])).rows).toEqual([{ n: 1 }]);
    } finally {
      await a.query("rollback").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});
```

  Payloads travel as query parameters (`JSON.stringify`), never as quoted JSON inside the SQL text, so no file in this task holds a backslash escape (memory "Lane pipeline", 2026-10-22: the Bash tool decodes backslashes; write test files with the Write tool). Run it on `post` (green) and on `pre` (red: no function). The snapshot rows the second case commits are removed by the account delete (the table owner's referential action), which is also a live proof of SD4.

- [ ] **Step 7: Run each mutation** on `post`. For each: edit the migration, rebuild the kit, run BOTH new files, paste the failing assertion line, edit back, `cmp`.
  1. Drop `voice_services_price_shape_check` → every REFUSE case FAILS.
  2. In the shape CHECK, drop `and unit_es is not null` from the per_unit branch → only "per_unit without the Spanish unit (C16)" FAILS.
  3. Drop `voice_services_name_en_one_line` → "a line feed in name_en" and "a carriage return" FAIL.
  4. `position between 1 and 51` → "position 51 is refused" FAILS.
  5. Drop `voice_services_account_position_key` → "one account cannot hold two rows" and "the services are replaced in order" (positions) FAIL.
  6. Drop the trigger → "an UPDATE raises 55000" FAILS.
  7. Append `grant update on public.voice_knowledge_snapshots to service_role;` → "table privileges" and "service_role cannot write" FAIL.
  8. Drop `voice_services_owners_only` → "a staff member reads neither" FAILS.
  9. Replace `voice_services_member_read`'s USING with `(true)` → "an Owner of ANOTHER account reads neither" FAILS.
  10. Drop `calls_knowledge_version_fkey` (both statements) → the calls FK and cross-account cases FAIL.
  11. In `save_voice_knowledge`, delete the stale `if … return … 'stale'` → the stale case FAILS.
  12. In `save_voice_knowledge`, replace the equality branch with an unconditional append → "an equal payload records no new version" FAILS.
  13. In `save_voice_knowledge`, move the profile `update` above `begin` (out of the block) → "a bad list sent WITH a facts change" FAILS.
  14. Drop `for no key update` from `ensure_knowledge_snapshot` → the lock test's first case FAILS.
  15. Append `grant execute on function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer) to authenticated;` → "function privileges" FAILS.
  16. In the validator, delete the `v_from_m < v_prev_m` check → "overlapping spans" and "spans out of order" FAIL.
  17. Delete `comment on column public.voice_services.unit_es` → the comments case FAILS.
  18. Change `snapshots.account_id` to `on delete restrict` → the cascade case FAILS.

- [ ] **Step 8: Rollback, digest and bytes.**
  - On a throwaway `create database rb template post`, run the ROLLBACK lines in order; then `select count(*) from pg_constraint where conname like '%knowledge_version%' or conname like 'voice_services%' or conname like 'voice_knowledge%'` → `0`, `select to_regproc('public.save_voice_knowledge')` → NULL. Drop `rb`.
  - The client-write digest on `post` equals `pre`'s (`51|0dd3e2d7…` per Task 0).
  - `LC_ALL=C tr -d '\000-\177' < packages/db/supabase/migrations/0095_structured_facts.sql | wc -c` → `0`.
  - `grep -nF '\' …` → nothing.
  - `grep -o '\$' … | wc -l` → `20`.
  - `grep -niw cascade …` → exactly the two `on delete cascade` lines.
  - `grep -n "''" …` → exactly the four `set search_path = ''` lines.
  - Record `md5sum` of the file.

- [ ] **Step 9: Commit.**

```bash
git add -- packages/db/supabase/migrations/0095_structured_facts.sql packages/db/src/test/structured-facts-schema.test.ts packages/db/src/test/structured-facts-lock.test.ts
git diff --cached --stat
git commit -m "db: business hours on the voice profile, a price list with six price kinds, and numbered never-edited knowledge snapshots stamped on calls and website chats, written only through two service-role functions (S-47c, migration 0095)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- packages/db/supabase/migrations/0095_structured_facts.sql packages/db/src/test/structured-facts-schema.test.ts packages/db/src/test/structured-facts-lock.test.ts
```

**Acceptance:** every case green on `post` and red on `pre` (except the three noted). Every mutation fails by name. The digest is unchanged, the rollback leaves nothing, the bytes pass, and the md5 is in the report.

**Review (HIGH):** opus bis-reviewer in its own detached worktree, with its own kit on 55434.
- Applies 0095 to a fresh `pre` copy through `psql -1` only; reads every def itself.
- Re-runs mutations 2, 11, 13 and 14, plus three of its own: `grant select on public.voice_services to anon` (the table-privilege case must catch it); swap `'after_visit'` for `'after-visit'` in `voice_services_price_kind_check` (only the accept case and the defs pin can catch it); and remove `or (p_parts ? 'services' and jsonb_typeof(p_parts -> 'services') <> 'array')` (the "services as an object" case must still go red, by the cast or the block, and the reviewer says which).
- Checks the bytes and the md5, and that no comment string or `--` line holds an apostrophe.
- Reads both RPCs for a path that writes before the lock, a status returned after a write outside the block, or a definer function that names an unqualified object a caller could shadow (`set search_path = ''` everywhere).
- A re-review follows any change. The md5 that reaches bis-ci is the reviewed one.

---
## Task 2 (LOW): Every new and changed key (bis-frontend)

**Brief.** Add every key below to `apps/web/src/lib/messages.ts`, each `.es` twin on the line after its key, after `"calls.detail.tradeModule.events.es"` (`messages.ts:2067`), under one comment line: `// S-47c: Business hours, Services & prices, the Facts flags, the call page's Knowledge link and the knowledge page (agency only). Usted.` Change the two existing keys in place. Append ONE `describe("S-47c: structured facts copy, English and Spanish (plan Task 2)")` to `apps/web/src/lib/messages.test.ts` in the shape of the S-47b describe (`messages.test.ts:1365-1442`): a literal `EXPECTED_PARAMS` map over every new key (assert its length is **97**, the number of rows in the new-keys table below, counted off this file with `awk` on 2026-10-23; recount it yourself before you trust it), every key and twin present and different (none is the same in both languages), params identical across the twin, every sentence pinned as a typed literal pair, usted (the S-47b regex), no typed "Sofía", no plumbing word (`jsonb|null|payload|price_kind|per_unit|RPC|snapshot`). Update the S-47b pin of `voice.tradeRules.eventsHint` (`messages.test.ts:1413-1415`) to the new pair. Run `messages.test.ts`, `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/accents-guard.test.ts` → green; typecheck; eslint; commit `copy: business hours, services and prices, the Facts flags and what Sofía knew, English and Spanish (S-47c)` naming the two files. No baseline regeneration here (Task 9 does it once).

| Key | English | Spanish (usted) |
|---|---|---|
| `voice.hours.title` | Business hours | Horario del negocio |
| `voice.hours.body` | {persona} tells callers whether you're open right now from these hours. Bookable times still come from the calendar. | {persona} les dice a quienes llaman si está abierto en este momento según este horario. Los horarios para citas siguen saliendo del calendario. |
| `voice.hours.zone` | Times are in {zone}. | Las horas están en {zone}. |
| `voice.hours.day.mon` | Monday | Lunes |
| `voice.hours.day.tue` | Tuesday | Martes |
| `voice.hours.day.wed` | Wednesday | Miércoles |
| `voice.hours.day.thu` | Thursday | Jueves |
| `voice.hours.day.fri` | Friday | Viernes |
| `voice.hours.day.sat` | Saturday | Sábado |
| `voice.hours.day.sun` | Sunday | Domingo |
| `voice.hours.open` | Open | Abierto |
| `voice.hours.from` | Opens | Abre |
| `voice.hours.to` | Closes | Cierra |
| `voice.hours.addSpan` | Add hours | Agregar horas |
| `voice.hours.removeSpan` | Remove these hours | Quitar estas horas |
| `voice.hours.midnightHint` | To close at midnight, set the closing time to 12:00 AM. | Para cerrar a medianoche, ponga la hora de cierre en 12:00 a. m. |
| `voice.hours.copyFromCalendar` | Copy from calendar | Copiar del calendario |
| `voice.hours.copyFromCalendarNone` | The calendar has no hours to copy yet. | El calendario todavía no tiene horas para copiar. |
| `voice.hours.clear` | Clear hours | Quitar el horario |
| `voice.hours.save` | Save hours | Guardar horario |
| `voice.hours.saved` | Business hours saved | Horario guardado |
| `voice.hours.cleared` | Business hours cleared | Horario quitado |
| `voice.hours.empty` | Add your hours so {persona} can tell callers whether you're open right now. | Agregue su horario para que {persona} pueda decirles a quienes llaman si está abierto en este momento. |
| `voice.hours.setHours` | Set hours | Poner horario |
| `voice.hours.error.blank` | {day}: fill in both times, or remove those hours. | {day}: llene las dos horas, o quite esas horas. |
| `voice.hours.error.endBeforeStart` | {day}: each closing time must be after its opening time. | {day}: cada hora de cierre debe ser después de la de apertura. |
| `voice.hours.error.overlap` | {day}: these hours overlap. | {day}: estas horas se cruzan. |
| `voice.hours.error.noDay` | Mark at least one day open, or clear the hours. | Marque al menos un día abierto, o quite el horario. |
| `voice.hours.saveFailed` | Couldn't save the hours. Try again. | No se pudo guardar el horario. Intente de nuevo. |
| `voice.services.title` | Services & prices | Servicios y precios |
| `voice.services.titleInsurance` | Services | Servicios |
| `voice.services.body` | {persona} says these prices exactly as written below, and no others. | {persona} dice estos precios tal como están escritos abajo, y ningún otro. |
| `voice.services.insuranceNotice` | On insurance accounts {persona} names these services but never gives a price. | En cuentas de seguros, {persona} nombra estos servicios pero nunca da un precio. |
| `voice.services.empty` | List your services and prices so {persona} quotes them exactly. | Anote sus servicios y precios para que {persona} los diga exactamente. |
| `voice.services.add` | Add a service | Agregar un servicio |
| `voice.services.max` | You can list up to 50 services. | Puede anotar hasta 50 servicios. |
| `voice.services.moveUp` | Move up | Subir |
| `voice.services.moveDown` | Move down | Bajar |
| `voice.services.edit` | Edit | Editar |
| `voice.services.done` | Done | Listo |
| `voice.services.remove` | Remove | Quitar |
| `voice.services.removing` | Removed when you save | Se quita al guardar |
| `voice.services.keep` | Keep | Conservar |
| `voice.services.nameEn` | Name in English | Nombre en inglés |
| `voice.services.nameEs` | Name in Spanish (optional) | Nombre en español (opcional) |
| `voice.services.descriptionEn` | Description in English (optional) | Descripción en inglés (opcional) |
| `voice.services.descriptionEs` | Description in Spanish (optional) | Descripción en español (opcional) |
| `voice.services.kind` | How it's priced | Cómo se cobra |
| `voice.services.kind.fixed` | Fixed price | Precio fijo |
| `voice.services.kind.from` | Starting price | Precio desde |
| `voice.services.kind.range` | Price range | Rango de precio |
| `voice.services.kind.per_unit` | Price per unit | Precio por unidad |
| `voice.services.kind.free` | Free | Sin costo |
| `voice.services.kind.after_visit` | Priced after a visit | Precio después de una visita |
| `voice.services.amount` | Price in dollars | Precio en dólares |
| `voice.services.amountMin` | Lowest price in dollars | Precio más bajo en dólares |
| `voice.services.amountMax` | Highest price in dollars | Precio más alto en dólares |
| `voice.services.unitEn` | Unit in English (for example, guest) | Unidad en inglés (por ejemplo, guest) |
| `voice.services.unitEs` | Unit in Spanish (for example, invitado) | Unidad en español (por ejemplo, invitado) |
| `voice.services.previewEn` | What {persona} says in English | Lo que {persona} dice en inglés |
| `voice.services.previewEs` | What {persona} says in Spanish | Lo que {persona} dice en español |
| `voice.services.save` | Save services | Guardar servicios |
| `voice.services.saved` | Services saved | Servicios guardados |
| `voice.services.saveFailed` | Couldn't save the services. Try again. | No se pudieron guardar los servicios. Intente de nuevo. |
| `voice.services.loadFailed` | Couldn't load the services. Reload the page to try again. | No se pudieron cargar los servicios. Recargue la página para intentar de nuevo. |
| `voice.services.error.name` | Give every service a name in English. | Póngale a cada servicio un nombre en inglés. |
| `voice.services.error.amount` | Add the price for {name}. | Agregue el precio de {name}. |
| `voice.services.error.range` | For {name}, the highest price must be more than the lowest. | En {name}, el precio más alto debe ser mayor que el más bajo. |
| `voice.services.error.units` | Add the unit in English and in Spanish for {name}. | Agregue la unidad en inglés y en español para {name}. |
| `voice.services.error.tooLong` | {name}: use at most 80 characters for a name, 300 for a description and 30 for a unit. | {name}: use como máximo 80 caracteres para un nombre, 300 para una descripción y 30 para una unidad. |
| `voice.services.summary.range` | {min} to {max} | {min} a {max} |
| `voice.services.summary.perUnit` | {amount} per {unit} | {amount} por {unit} |
| `voice.knowledge.stale` | Someone else just saved this. Reload to see their change. | Alguien más acaba de guardar esto. Recargue la página para ver su cambio. |
| `voice.knowledge.noProfile` | Save the voice profile above first. | Primero guarde el perfil de voz de arriba. |
| `voice.knowledge.invalid` | Something in this card couldn't be saved. Check it and try again. | Algo en esta tarjeta no se pudo guardar. Revíselo e intente de nuevo. |
| `voice.facts.hoursNotice` | Facts mentions hours. {persona} uses Business hours below, so take regular hours out of Facts. A closure on a specific date can stay. | Los datos mencionan horarios. {persona} usa el Horario del negocio de abajo, así que quite el horario normal de los datos. Un cierre en una fecha específica puede quedarse. |
| `voice.facts.hoursHint` | Add Business hours below so {persona} can tell callers whether you are open right now. | Agregue el Horario del negocio abajo para que {persona} pueda decirles a quienes llaman si está abierto en este momento. |
| `voice.facts.amountsNotice` | {persona} gives prices only from Services & prices, so these amounts in Facts or Services will not be said: {amounts}. Add each one she should say as its own row (a deposit or a fee too), or take it out. Refund and cancellation terms without an amount can stay. | {persona} da precios solo de Servicios y precios, así que no dirá estos montos de los datos o los servicios: {amounts}. Agregue cada uno que deba decir como su propia fila (también un depósito o una cuota), o quítelo. Los términos de reembolso y cancelación sin monto pueden quedarse. |
| `calls.detail.knowledge` | Knowledge | Conocimiento |
| `calls.detail.knowledgeLink` | What {persona} knew (#{version}) | Lo que {persona} sabía (#{version}) |
| `voice.knowledge.title` | What {persona} knew | Lo que {persona} sabía |
| `voice.knowledge.savedBy` | Version {version} · saved {date} by {person} | Versión {version} · guardada el {date} por {person} |
| `voice.knowledge.recordedAutomatically` | Version {version} · recorded automatically {date} | Versión {version} · registrada automáticamente el {date} |
| `voice.knowledge.facts` | Facts | Datos |
| `voice.knowledge.servicesText` | Services (free text) | Servicios (texto libre) |
| `voice.knowledge.hours` | Business hours | Horario del negocio |
| `voice.knowledge.prices` | Services and prices | Servicios y precios |
| `voice.knowledge.inEnglish` | In English | En inglés |
| `voice.knowledge.inSpanish` | In Spanish | En español |
| `voice.knowledge.nothing` | Nothing was written here. | No había nada escrito aquí. |
| `voice.knowledge.noHours` | No business hours were set. | No había horario del negocio. |
| `voice.knowledge.noPrices` | No services were listed. | No había servicios en la lista. |
| `voice.knowledge.older` | Older | Anterior |
| `voice.knowledge.newer` | Newer | Más reciente |
| `voice.knowledge.back` | Back to Voice | Volver a Voz |
| `voice.knowledge.notFound` | This account has no version {version}. | Esta cuenta no tiene la versión {version}. |
| `voice.knowledge.loadFailed` | Couldn't load this version. Reload the page to try again. | No se pudo cargar esta versión. Recargue la página para intentar de nuevo. |

**Changed keys** (spec §6):

| Key | New English | New Spanish |
|---|---|---|
| `voice.profile.factsHint` (`:1802`, English only today: the profile card is English, `…/voice/page.tsx:138-143`) | Policies and anything else a caller might ask about. Hours and prices go in their own cards below. | (no twin, as today) |
| `voice.tradeRules.eventsHint` / `.es` (`:2058-2059`) | {persona} takes event details for the team to confirm, never says a date is free, and gives prices only word for word from Services & prices, or from Facts when there is no list. | {persona} toma los datos del evento para que el equipo los confirme, nunca dice que una fecha está libre y da precios solo palabra por palabra de Servicios y precios, o de los datos del negocio cuando no hay lista. |

The UI's "Undo" is the existing `common.undo` (`messages.ts:298-299`).

---

## Task 3 (MEDIUM): The pure renderers (bis-voice)

**Files:**
- Create: `…/knowledge/price-sentence.ts`, `…/knowledge/hours.ts`, `…/knowledge/payload.ts`, `…/knowledge/facts-warnings.ts`
- Create: `…/knowledge/price-sentence.test.ts`, `…/knowledge/hours.test.ts`, `…/knowledge/payload.test.ts`, `…/knowledge/facts-warnings.test.ts`

**Interfaces:**
- Consumes: `normalizeOpenHours`, `partsInZone`, `OpenHours` from `apps/web/src/lib/booking/slots.ts` (`:10`, `:40`, `:132`), by the RELATIVE path `../../booking/slots`.
- Produces: everything in "The model, Web (Tasks 3, 4)" for these four files. Tasks 4, 6, 7, 8, 9 read them.
- `PriceKind` is declared locally here with a comment; Task 5 re-points it to `import type { PriceKind } from "@bis/db"` (one line, Task 5's).

**Rules:** pure (no I/O, no `Date.now()`, no `new Date()` without an argument), relative imports only, no `@bis/db` value import. Every rendered string in a test is a typed literal.

- [ ] **Step 1: Write the failing tests.**

`…/knowledge/price-sentence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { priceSentence, formatUsd, PRICE_KINDS, type PricedService } from "./price-sentence";

/**
 * Spec section 5.1's table, copied VERBATIM (owner's read, C18, 2026-10-23). The twelve instantiated sentences
 * below are typed out in full; this table is here so a reviewer can hold the two side by side, and the last case
 * checks the instantiation against it with a test-side fill (never priceSentence itself).
 */
const SPEC_TABLE: Record<string, readonly [string, string]> = {
  fixed: ["The price for {N} is {A}.", "El precio de {N} es {A}."],
  from: ["The price for {N} starts at {A}.", "El precio de {N} es desde {A}."],
  range: ["The price for {N} is between {A} and {B}.", "El precio de {N} es de {A} a {B}."],
  per_unit: ["The price for {N} is {A} per {U}.", "El precio de {N} es {A} por {U}."],
  free: ["There is no charge for {N}.", "{N} no tiene costo."],
  after_visit: ["The price for {N} is given after a visit.", "El precio de {N} se lo damos después de una visita."],
};

const base = { name_es: null, amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null } as const;
const ROWS: Array<[string, PricedService, string, string]> = [
  ["fixed", { ...base, name_en: "Haircut", name_es: "Corte de cabello", price_kind: "fixed", amount_cents: 2500 },
    "The price for Haircut is $25.", "El precio de Corte de cabello es $25."],
  ["from", { ...base, name_en: "Roof repair", name_es: "Reparación de techo", price_kind: "from", amount_cents: 15000 },
    "The price for Roof repair starts at $150.", "El precio de Reparación de techo es desde $150."],
  ["range", { ...base, name_en: "Gutter cleaning", name_es: "Limpieza de canaletas", price_kind: "range", amount_cents: 12000, amount_max_cents: 25050 },
    "The price for Gutter cleaning is between $120 and $250.50.", "El precio de Limpieza de canaletas es de $120 a $250.50."],
  ["per_unit", { ...base, name_en: "Catering", name_es: "Banquete", price_kind: "per_unit", amount_cents: 3500, unit_en: "guest", unit_es: "invitado" },
    "The price for Catering is $35 per guest.", "El precio de Banquete es $35 por invitado."],
  ["free", { ...base, name_en: "Estimate", name_es: "Presupuesto", price_kind: "free" },
    "There is no charge for Estimate.", "Presupuesto no tiene costo."],
  ["after_visit", { ...base, name_en: "Full replacement", name_es: "Reemplazo completo", price_kind: "after_visit" },
    "The price for Full replacement is given after a visit.", "El precio de Reemplazo completo se lo damos después de una visita."],
];

describe("priceSentence: the twelve sentences (C18; mutation: change one word in any template -> FAILS)", () => {
  it("covers every kind exactly once, in PRICE_KINDS order (guards the loop)", () => {
    expect(ROWS.map((r) => r[0])).toEqual([...PRICE_KINDS]);
    expect(PRICE_KINDS).toEqual(["fixed", "from", "range", "per_unit", "free", "after_visit"]);
  });
  it.each(ROWS)("%s, English and Spanish", (_k, s, en, es) => {
    expect(priceSentence(s, "en")).toBe(en);
    expect(priceSentence(s, "es")).toBe(es);
  });
  it("each typed sentence is the spec table's template, filled (a test-side fill, not the function under test)", () => {
    const fill = (t: string, v: Record<string, string>) => t.replace(/\{([NABU])\}/g, (_m, k: string) => v[k]!);
    for (const [kind, s, en, es] of ROWS) {
      const a = s.amount_cents === null ? "" : formatUsd(s.amount_cents);
      const b = s.amount_max_cents === null ? "" : formatUsd(s.amount_max_cents);
      expect(fill(SPEC_TABLE[kind]![0], { N: s.name_en, A: a, B: b, U: s.unit_en ?? "" })).toBe(en);
      expect(fill(SPEC_TABLE[kind]![1], { N: s.name_es ?? s.name_en, A: a, B: b, U: s.unit_es ?? "" })).toBe(es);
    }
  });
});

describe("priceSentence: names, amounts, refusals", () => {
  it("Spanish falls back to the English name when there is no Spanish name (C2; mutation: drop the fallback -> FAILS)", () => {
    expect(priceSentence({ ...base, name_en: "Haircut", price_kind: "fixed", amount_cents: 2500 }, "es")).toBe("El precio de Haircut es $25.");
  });
  it("English never uses the Spanish name", () => {
    expect(priceSentence({ ...base, name_en: "Haircut", name_es: "Corte", price_kind: "free" }, "en")).toBe("There is no charge for Haircut.");
  });
  it.each([
    [2500, "$25"], [2550, "$25.50"], [2505, "$25.05"], [120000, "$1,200"], [123456, "$1,234.56"], [100000000, "$1,000,000"], [1, "$0.01"],
  ] as const)("formatUsd(%i) is %s, the same in both languages (mutation: toFixed(2) always -> FAILS)", (cents, text) => {
    expect(formatUsd(cents)).toBe(text);
    expect(priceSentence({ ...base, name_en: "X", price_kind: "fixed", amount_cents: cents }, "es")).toBe(`El precio de X es ${text}.`);
  });
  it.each([
    ["a fixed price without its amount", { ...base, name_en: "X", price_kind: "fixed" }, "en"],
    ["a range without its maximum", { ...base, name_en: "X", price_kind: "range", amount_cents: 100 }, "en"],
    ["a range whose maximum is not above its amount", { ...base, name_en: "X", price_kind: "range", amount_cents: 100, amount_max_cents: 100 }, "es"],
    ["a per_unit without its English unit", { ...base, name_en: "X", price_kind: "per_unit", amount_cents: 100, unit_es: "hora" }, "en"],
    ["a per_unit without its Spanish unit (C16: no English fallback)", { ...base, name_en: "X", price_kind: "per_unit", amount_cents: 100, unit_en: "hour" }, "es"],
  ] as const)("throws on %s (mutation: fall back to the English unit -> the C16 case FAILS)", (_n, s, lang) => {
    expect(() => priceSentence(s as PricedService, lang)).toThrow(/priceSentence/);
  });
});
```

`…/knowledge/hours.test.ts` (`H` = Monday to Friday 8–12 and 1–6, Saturday 9–1, Sunday closed; every instant is UTC, its Chicago wall time in the name):

```ts
import { describe, it, expect } from "vitest";
import { hoursLines, openNow, clockTime, hasOpenDay } from "./hours";
import type { OpenHours } from "../../booking/slots";

const WK: [string, string][] = [["08:00", "12:00"], ["13:00", "18:00"]];
const H: OpenHours = { mon: WK, tue: WK, wed: WK, thu: WK, fri: WK, sat: [["09:00", "13:00"]] };
const TZ = "America/Chicago";
const at = (iso: string) => new Date(iso);

describe("clockTime", () => {
  it.each([["08:00", "8:00 AM"], ["00:00", "12:00 AM"], ["12:00", "12:00 PM"], ["13:05", "1:05 PM"], ["23:59", "11:59 PM"], ["24:00", "midnight"]] as const)(
    "%s reads %s", (t, s) => { expect(clockTime(t)).toBe(s); });
});

describe("hoursLines (Monday first, 7 lines)", () => {
  it("the week, word for word (mutation: Sunday first -> FAILS)", () => {
    expect(hoursLines(H)).toEqual([
      "Monday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Tuesday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Wednesday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Thursday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Friday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Saturday: 9:00 AM to 1:00 PM",
      "Sunday: closed",
    ]);
  });
  it("three spans join with a comma and a final and; 24:00 reads midnight", () => {
    expect(hoursLines({ fri: [["06:00", "08:00"], ["10:00", "12:00"], ["18:00", "24:00"]], sat: [["00:00", "02:00"]] }).slice(4, 6)).toEqual([
      "Friday: 6:00 AM to 8:00 AM, 10:00 AM to 12:00 PM and 6:00 PM to midnight",
      "Saturday: 12:00 AM to 2:00 AM",
    ]);
  });
  it("hasOpenDay is false for {} and null, true for one span", () => {
    expect([hasOpenDay({}), hasOpenDay(null), hasOpenDay(undefined), hasOpenDay({ sun: [["10:00", "11:00"]] })]).toEqual([false, false, false, true]);
  });
});

describe("openNow (spec 5.1; all arithmetic in the zone; SD16)", () => {
  it.each([
    ["open (Tue 10:00)", H, "2027-06-01T15:00:00Z", true, "Right now: open until 12:00 PM."],
    ["the lunch gap (Tue 12:30)", H, "2027-06-01T17:30:00Z", false, "Right now: closed; opens today at 1:00 PM."],
    ["closed until tomorrow (Tue 18:30)", H, "2027-06-01T23:30:00Z", false, "Right now: closed; opens tomorrow at 8:00 AM."],
    ["closed today, a day with no hours (Sun 10:00)", H, "2027-06-06T15:00:00Z", false, "Right now: closed; opens tomorrow at 8:00 AM."],
    ["closed until Monday (Sat 18:30)", H, "2027-06-05T23:30:00Z", false, "Right now: closed; opens Monday at 8:00 AM."],
    ["the 24:00/00:00 join (Fri 23:30)", { fri: [["18:00", "24:00"]], sat: [["00:00", "02:00"]] }, "2027-06-05T04:30:00Z", true, "Right now: open until 2:00 AM."],
    ["open until midnight (Fri 23:30, nothing after)", { fri: [["18:00", "24:00"]] }, "2027-06-05T04:30:00Z", true, "Right now: open until midnight."],
    ["touching spans are one stretch (Tue 11:00)", { tue: [["08:00", "12:00"], ["12:00", "18:00"]] }, "2027-06-01T16:00:00Z", true, "Right now: open until 6:00 PM."],
    ["the same weekday next week (Mon 13:00)", { mon: [["08:00", "12:00"]] }, "2027-06-07T18:00:00Z", false, "Right now: closed; opens next Monday at 8:00 AM."],
    ["open around the clock", Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [["00:00", "24:00"]]])) as OpenHours,
      "2027-06-01T15:00:00Z", true, "Right now: open."],
    ["a DST day: Sun 2027-03-14 08:30Z is 3:30 AM CDT (mutation: a fixed -6 offset reads 2:30 -> FAILS)", { sun: [["03:00", "04:00"]] },
      "2027-03-14T08:30:00Z", true, "Right now: open until 4:00 AM."],
  ] as const)("%s", (_n, hours, iso, open, line) => {
    expect(openNow(hours as OpenHours, TZ, at(iso))).toEqual({ open, line });
  });
  it("the zone is the account's, never the server's: the same instant in America/New_York is an hour later (mutation: drop timeZone -> FAILS on one of the two)", () => {
    expect(openNow(H, "America/New_York", at("2027-06-01T22:30:00Z")).line).toBe("Right now: closed; opens tomorrow at 8:00 AM.");
    expect(openNow(H, TZ, at("2027-06-01T22:30:00Z")).line).toBe("Right now: open until 6:00 PM.");
  });
});
```

`…/knowledge/payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildKnowledgePayload, parseKnowledgePayload, knowledgeFromLive, promptKnowledge, usableHours, KNOWLEDGE_RENDERER_VERSION } from "./payload";

const SVC = { name_en: "Haircut", name_es: "Corte", description_en: "Wash and cut.", description_es: null,
  price_kind: "fixed" as const, amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null };
const INPUT = { facts: "We fix roofs.", servicesText: "Roofs", timezone: "America/Chicago",
  businessHours: { tue: [["13:00", "18:00"], ["08:00", "12:00"]] }, services: [SVC, { ...SVC, name_en: "Shave", name_es: null, price_kind: "free" as const, amount_cents: null }] };

describe("buildKnowledgePayload (spec 4.2)", () => {
  it("is exactly the spec's object: fixed keys, positions 1..n, both sentences, spans sorted, no row id (mutation: drop renderer_version -> FAILS)", () => {
    const p = buildKnowledgePayload(INPUT);
    expect(Object.keys(p)).toEqual(["schema", "facts", "services_text", "timezone", "business_hours", "hours_lines", "services", "renderer_version"]);
    expect(p).toStrictEqual({
      schema: 1, facts: "We fix roofs.", services_text: "Roofs", timezone: "America/Chicago",
      business_hours: { tue: [["08:00", "12:00"], ["13:00", "18:00"]] },
      hours_lines: ["Monday: closed", "Tuesday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM", "Wednesday: closed", "Thursday: closed",
        "Friday: closed", "Saturday: closed", "Sunday: closed"],
      services: [
        { position: 1, name_en: "Haircut", name_es: "Corte", description_en: "Wash and cut.", description_es: null, price_kind: "fixed",
          amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null,
          sentence_en: "The price for Haircut is $25.", sentence_es: "El precio de Corte es $25." },
        { position: 2, name_en: "Shave", name_es: null, description_en: "Wash and cut.", description_es: null, price_kind: "free",
          amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null,
          sentence_en: "There is no charge for Shave.", sentence_es: "Shave no tiene costo." },
      ],
      renderer_version: KNOWLEDGE_RENDERER_VERSION,
    });
    expect(KNOWLEDGE_RENDERER_VERSION).toBe(1);
  });
  it("is deterministic: the same input twice is deep-equal and serialises to the same string", () => {
    expect(JSON.stringify(buildKnowledgePayload(INPUT))).toBe(JSON.stringify(buildKnowledgePayload(structuredClone(INPUT))));
  });
  it("no hours, or hours with no open day, give null hours and null lines (SD17)", () => {
    for (const businessHours of [null, undefined, {}, { mon: [] }, "nonsense"]) {
      const p = buildKnowledgePayload({ ...INPUT, businessHours });
      expect([p.business_hours, p.hours_lines]).toEqual([null, null]);
    }
    expect(usableHours({ mon: [["08:00", "12:00"]] })).toEqual({ mon: [["08:00", "12:00"]] });
  });
});

describe("parseKnowledgePayload", () => {
  it("round-trips a built payload through JSON (what a jsonb read returns)", () => {
    const p = buildKnowledgePayload(INPUT);
    expect(parseKnowledgePayload(JSON.parse(JSON.stringify(p)))).toStrictEqual(p);
  });
  it.each([null, [], {}, { schema: 2 }, { ...buildKnowledgePayload(INPUT), services: [{ position: 1 }] }, { ...buildKnowledgePayload(INPUT), facts: 3 }])(
    "refuses %j (mutation: accept any object -> FAILS)", (raw) => { expect(parseKnowledgePayload(raw)).toBeNull(); });
});

describe("knowledgeFromLive (spec 5.5; SD9)", () => {
  const profile = { facts: "We fix roofs.", services: "Roofs", business_hours: { tue: [["08:00", "12:00"]] } };
  it("rows read: the payload carries them and is recordable", () => {
    const r = knowledgeFromLive({ profile, timezone: "America/Chicago", services: [SVC] });
    expect(r.recordable).toBe(true);
    expect(r.payload.services.map((s) => s.sentence_en)).toEqual(["The price for Haircut is $25."]);
  });
  it("the services read failed (null): free text and hours kept, no list, NOT recordable (mutation: recordable true -> FAILS)", () => {
    const r = knowledgeFromLive({ profile, timezone: "America/Chicago", services: null });
    expect(r).toMatchObject({ recordable: false, payload: { facts: "We fix roofs.", services: [], business_hours: { tue: [["08:00", "12:00"]] } } });
  });
  it("a row that cannot render (bad data) is treated as a failed read, never a throw", () => {
    const bad = { ...SVC, price_kind: "per_unit" as const, unit_en: "hour", unit_es: null };
    expect(knowledgeFromLive({ profile, timezone: "America/Chicago", services: [bad] })).toMatchObject({ recordable: false, payload: { services: [] } });
  });
});

describe("promptKnowledge", () => {
  it("an empty list and no hours give nulls, so the prompt is byte-identical (C3)", () => {
    const p = buildKnowledgePayload({ ...INPUT, businessHours: null, services: [] });
    expect(promptKnowledge(p)).toEqual({ facts: "We fix roofs.", services: "Roofs", businessHours: null, priceList: null });
  });
  it("a list gives name, descriptions and both sentences only", () => {
    expect(promptKnowledge(buildKnowledgePayload(INPUT)).priceList![0]).toStrictEqual({
      name_en: "Haircut", name_es: "Corte", description_en: "Wash and cut.", description_es: null,
      sentence_en: "The price for Haircut is $25.", sentence_es: "El precio de Corte es $25." });
  });
});
```

`…/knowledge/facts-warnings.test.ts` (each pattern in both languages, the amounts in order with their words, the false-positive guards):

```ts
import { describe, it, expect } from "vitest";
import { factsWarnings } from "./facts-warnings";

const none = { hasHours: false, hasPriceList: false };
describe("hours in Facts (spec 5.3)", () => {
  it.each([
    "Open 8am to 5pm.", "We open at 8:00 a.m.", "Hours 8–5 weekdays.", "Hours 8-5 weekdays.", "Monday 9 to 3",
    "Abrimos de 8 a 5.", "lunes a viernes 9", "Cerramos a las 17:30.", "Sábado 10",
  ])("finds hours in %j: a notice with structured hours, a hint without (mutation: drop that pattern -> FAILS)", (facts) => {
    expect(factsWarnings(facts, "", { hasHours: true, hasPriceList: false }).hours).toBe("notice");
    expect(factsWarnings(facts, "", none).hours).toBe("hint");
  });
  it.each(["Call (956) 292-1696.", "Visit us at 1200 Main St, McAllen TX 78501.", "Since 2026.", "We answer 24/7.", "Licensed, 3 trucks, 2-3 day turnaround."])(
    "does not read %j as hours (mutation: a bare-number pattern -> FAILS)", (facts) => {
      expect(factsWarnings(facts, "", { hasHours: true, hasPriceList: true }).hours).toBeNull();
    });
  it("hours in the Services text are not flagged (Facts only)", () => {
    expect(factsWarnings("", "Open 8am to 5pm", { hasHours: true, hasPriceList: false }).hours).toBeNull();
  });
});

describe("amounts in Facts or Services (C11)", () => {
  it("lists each amount, in order, Facts first, with the words that follow it up to the end of its phrase (mutation: drop the services box -> FAILS)", () => {
    const r = factsWarnings("A $500 deposit to hold the date is due at signing. Catering is $35 per guest.",
      "Cleanings from 40 dólares, or USD 60 for two", { hasHours: false, hasPriceList: true });
    expect(r.amounts.map((a) => [a.source, a.text])).toEqual([
      ["facts", "$500 deposit to hold the date"],
      ["facts", "$35 per guest"],
      ["services", "40 dólares"],
      ["services", "USD 60 for two"],
    ]);
  });
  it.each(["$40", "$1,200.50 total", "40 dollars", "40 dolares", "40 dólares", "USD 40", "40 USD"])("finds %j", (s) => {
    expect(factsWarnings(s, "", { hasHours: false, hasPriceList: true }).amounts).toHaveLength(1);
  });
  it.each(["Call (956) 292-1696.", "McAllen TX 78501", "Since 2026.", "We answer 24/7.", "Up to 150 guests."])("ignores %j", (s) => {
    expect(factsWarnings(s, "", { hasHours: false, hasPriceList: true }).amounts).toEqual([]);
  });
  it("without a price list there is no amounts flag at all (today's behaviour)", () => {
    expect(factsWarnings("$40 per hour", "", none).amounts).toEqual([]);
  });
});
```

- [ ] **Step 2:** `pnpm --filter web exec vitest run src/lib/voice/knowledge` → FAIL (modules absent).

- [ ] **Step 3: Implement.**

`…/knowledge/price-sentence.ts`:

```ts
// S-47c (spec section 5.1; C2, C16, C18): the ONE place a price becomes words. Sofía reads only these sentences,
// so every template here is model input that reaches a live call. The twelve are the owner's read of 2026-10-23;
// changing one means bumping KNOWLEDGE_RENDERER_VERSION in ./payload.ts (spec 4.2), and price-sentence.test.ts
// pins every one as a literal. Pure; relative imports only (the corpus runner loads this under tsx).

/** The twin of voice_services_price_kind_check (0095). Task 5 re-points this to `import type { PriceKind } from "@bis/db"`. */
export type PriceKind = "fixed" | "from" | "range" | "per_unit" | "free" | "after_visit";
/** In the order the Voice page's Select lists them. */
export const PRICE_KINDS = ["fixed", "from", "range", "per_unit", "free", "after_visit"] as const satisfies readonly PriceKind[];

export type PricedService = {
  name_en: string; name_es: string | null; price_kind: PriceKind;
  amount_cents: number | null; amount_max_cents: number | null; unit_en: string | null; unit_es: string | null;
};

/** US dollars, the same en-US form in both languages (the RGV market writes and says "$1,200"): whole dollars
 *  without cents, otherwise two decimals. Integer arithmetic, no locale lookup. */
export function formatUsd(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`formatUsd: not a whole number of cents: ${String(cents)}`);
  const dollars = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = cents % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, "0")}`;
}

function need<T>(v: T | null, what: string, kind: PriceKind): T {
  if (v === null || v === undefined) throw new Error(`priceSentence: a ${kind} price needs ${what}`);
  return v;
}

/** "The price for {N} …": the frame avoids articles, so no name ever needs a gender (spec 5.1). Throws on any shape
 *  voice_services_price_shape_check refuses; a stored row can never reach that (the CHECK), and the Voice page's
 *  preview never calls this on an incomplete row (Task 8). */
export function priceSentence(s: PricedService, lang: "en" | "es"): string {
  const en = lang === "en";
  const name = en ? s.name_en : (s.name_es ?? s.name_en);
  switch (s.price_kind) {
    case "fixed": {
      const a = formatUsd(need(s.amount_cents, "an amount", s.price_kind));
      return en ? `The price for ${name} is ${a}.` : `El precio de ${name} es ${a}.`;
    }
    case "from": {
      const a = formatUsd(need(s.amount_cents, "an amount", s.price_kind));
      return en ? `The price for ${name} starts at ${a}.` : `El precio de ${name} es desde ${a}.`;
    }
    case "range": {
      const lo = need(s.amount_cents, "an amount", s.price_kind);
      const hi = need(s.amount_max_cents, "a maximum", s.price_kind);
      if (hi <= lo) throw new Error("priceSentence: a range needs its maximum above its amount");
      return en ? `The price for ${name} is between ${formatUsd(lo)} and ${formatUsd(hi)}.`
        : `El precio de ${name} es de ${formatUsd(lo)} a ${formatUsd(hi)}.`;
    }
    case "per_unit": {
      const a = formatUsd(need(s.amount_cents, "an amount", s.price_kind));
      // C16: both units are required; the Spanish never falls back to the English unit.
      const u = need(en ? s.unit_en : s.unit_es, en ? "an English unit" : "a Spanish unit", s.price_kind);
      return en ? `The price for ${name} is ${a} per ${u}.` : `El precio de ${name} es ${a} por ${u}.`;
    }
    case "free":
      return en ? `There is no charge for ${name}.` : `${name} no tiene costo.`;
    case "after_visit":
      return en ? `The price for ${name} is given after a visit.` : `El precio de ${name} se lo damos después de una visita.`;
  }
}
```

  The regex `/\B(?=(\d{3})+(?!\d))/g` is TypeScript, not SQL; write the file with the Write tool (memory "Lane pipeline", 2026-10-22).

`…/knowledge/hours.ts`:

```ts
// S-47c (spec section 5.1; C5, SD16): the hours lines and the "Right now" line. All arithmetic in the account's
// zone through partsInZone (Intl.DateTimeFormat with an explicit timeZone), the slot engine's rule, so DST is the
// zone's, never the server's. Pure; relative imports only.
import { partsInZone, type OpenHours } from "../../booking/slots";

type Day = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
const SUN_FIRST: readonly Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const HOURS_DAYS_MONDAY_FIRST = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME: Record<Day, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "08:00" -> "8:00 AM", "00:00" -> "12:00 AM", "12:00" -> "12:00 PM", "24:00" -> "midnight". */
export function clockTime(hhmm: string): string {
  if (hhmm === "24:00") return "midnight";
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** A day's spans, sorted by start (the stored value is sorted already; a copied calendar value may not be). */
function spansOf(hours: OpenHours, day: Day): [string, string][] {
  return [...(hours[day] ?? [])].sort((a, b) => minutes(a[0]) - minutes(b[0]));
}

export function hasOpenDay(hours: OpenHours | null | undefined): hours is OpenHours {
  return !!hours && SUN_FIRST.some((d) => (hours[d] ?? []).length > 0);
}

/** Seven lines, Monday first (the calendar panel's order): "Monday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM". */
export function hoursLines(hours: OpenHours): string[] {
  return HOURS_DAYS_MONDAY_FIRST.map((d) => {
    const parts = spansOf(hours, d).map(([f, t]) => `${clockTime(f)} to ${clockTime(t)}`);
    if (parts.length === 0) return `${DAY_NAME[d]}: closed`;
    const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
    return `${DAY_NAME[d]}: ${joined}`;
  });
}

export type OpenNow = { open: boolean; line: string };

export function openNow(hours: OpenHours, timeZone: string, now: Date): OpenNow {
  const p = partsInZone(now, timeZone);
  const today = SUN_FIRST.indexOf(p.weekday);
  const t = p.hh * 60 + p.mi;
  const dayAt = (offset: number): Day => SUN_FIRST[(today + offset) % 7]!;

  const current = spansOf(hours, dayAt(0)).find(([f, to]) => minutes(f) <= t && t < minutes(to));
  if (current) {
    // One stretch: a span that starts exactly when this one ends continues it (the same day, or 00:00 the next
    // day after a 24:00 end). A stretch that never ends inside a week is "open." (SD16).
    let end = current[1];
    let offset = 0;
    for (let guard = 0; guard < 7 * 48; guard++) {
      const nextOffset = end === "24:00" ? offset + 1 : offset;
      if (nextOffset > 7) return { open: true, line: "Right now: open." };
      const from = end === "24:00" ? "00:00" : end;
      const next = spansOf(hours, dayAt(nextOffset)).find(([f]) => f === from);
      if (!next) break;
      end = next[1];
      offset = nextOffset;
    }
    return { open: true, line: `Right now: open until ${clockTime(end)}.` };
  }

  const laterToday = spansOf(hours, dayAt(0)).find(([f]) => minutes(f) > t);
  if (laterToday) return { open: false, line: `Right now: closed; opens today at ${clockTime(laterToday[0])}.` };
  for (let d = 1; d <= 7; d++) {
    const first = spansOf(hours, dayAt(d))[0];
    if (!first) continue;
    const when = d === 1 ? "tomorrow" : d === 7 ? `next ${DAY_NAME[dayAt(d)]}` : DAY_NAME[dayAt(d)];
    return { open: false, line: `Right now: closed; opens ${when} at ${clockTime(first[0])}.` };
  }
  return { open: false, line: "Right now: closed." }; // no open day at all: callers never pass one (hasOpenDay)
}
```

`…/knowledge/payload.ts`:

```ts
// S-47c (spec 4.2, 5.5, 5.6): the snapshot payload, "exactly what she was given". The SAME object is sent to
// ensure_knowledge_snapshot / save_voice_knowledge and builds the prompt (promptKnowledge), so the two cannot
// disagree. Deterministic: fixed key order, positions 1..n, spans sorted, never a row id. Pure; relative imports.
import { normalizeOpenHours, type OpenHours } from "../../booking/slots";
import { priceSentence, PRICE_KINDS, type PricedService } from "./price-sentence";
import { hasOpenDay, hoursLines } from "./hours";

/** Bump with ANY change to a template here, in ./price-sentence.ts or in ./hours.ts's lines: the next call then
 *  records a new snapshot (spec 4.2, 5.6). */
export const KNOWLEDGE_RENDERER_VERSION = 1;

export type ServiceInput = PricedService & { description_en: string | null; description_es: string | null };
export type KnowledgeService = ServiceInput & { position: number; sentence_en: string; sentence_es: string };
export type KnowledgePayload = {
  schema: 1; facts: string; services_text: string; timezone: string;
  business_hours: OpenHours | null; hours_lines: string[] | null;
  services: KnowledgeService[]; renderer_version: number;
};
export type RenderedService = Pick<KnowledgeService,
  "name_en" | "name_es" | "description_en" | "description_es" | "sentence_en" | "sentence_es">;

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Normalized (slots.ts's defensive reader), spans sorted, keys Sunday first; null when no day is open (SD17). */
export function usableHours(raw: unknown): OpenHours | null {
  const n = normalizeOpenHours(raw);
  if (!hasOpenDay(n)) return null;
  const out: OpenHours = {};
  for (const d of DAYS) {
    const spans = n[d];
    if (spans && spans.length > 0) out[d] = [...spans].sort((a, b) => mins(a[0]) - mins(b[0])).map(([f, t]) => [f, t]);
  }
  return out;
}

export function buildKnowledgePayload(input: {
  facts: string; servicesText: string; timezone: string; businessHours: unknown; services: readonly ServiceInput[];
}): KnowledgePayload {
  const hours = usableHours(input.businessHours);
  return {
    schema: 1,
    facts: input.facts,
    services_text: input.servicesText,
    timezone: input.timezone,
    business_hours: hours,
    hours_lines: hours ? hoursLines(hours) : null,
    services: input.services.map((s, i) => ({
      position: i + 1,
      name_en: s.name_en, name_es: s.name_es,
      description_en: s.description_en, description_es: s.description_es,
      price_kind: s.price_kind, amount_cents: s.amount_cents, amount_max_cents: s.amount_max_cents,
      unit_en: s.unit_en, unit_es: s.unit_es,
      sentence_en: priceSentence(s, "en"), sentence_es: priceSentence(s, "es"),
    })),
    renderer_version: KNOWLEDGE_RENDERER_VERSION,
  };
}
```

  Then `parseKnowledgePayload(raw)`: `null` unless `raw` is a plain object with `schema === 1`, `facts`/`services_text`/`timezone` strings, `business_hours` null or an object (passed through `usableHours`; a non-null value that yields null fails the parse), `hours_lines` null or an array of strings, `renderer_version` a positive integer, and `services` an array whose every entry has an integer `position`, string `name_en`, string-or-null `name_es`/`description_en`/`description_es`/`unit_en`/`unit_es`, `price_kind` in `PRICE_KINDS`, integer-or-null amounts, and string `sentence_en`/`sentence_es`. It returns a NEW object in `buildKnowledgePayload`'s key order (so `toStrictEqual` round-trips). It never re-renders a sentence: a stored snapshot is what she was given then, whatever the renderer says now.

  `knowledgeFromLive({ profile, timezone, services })`: `services === null` → `buildKnowledgePayload` with `services: []`, `recordable: false` (SD9). Otherwise build with the rows (each mapped to `ServiceInput` by its ten fields, never spread, so a row's `id`/`account_id`/`position`/`created_at` never enter the payload); if that throws (a row that cannot render), log nothing here (the routes log) and return the `services: []` payload with `recordable: false`.

  `promptKnowledge(p)`: `{ facts: p.facts, services: p.services_text, businessHours: p.business_hours, priceList: p.services.length === 0 ? null : p.services.map(({ name_en, name_es, description_en, description_es, sentence_en, sentence_es }) => ({ name_en, name_es, description_en, description_es, sentence_en, sentence_es })) }`.

`…/knowledge/facts-warnings.ts`: implement exactly what the test pins.
- Hours (Facts only): a 12-hour time with a.m./p.m. (`8am`, `8 am`, `8:00 a.m.`, `8 p.m.`), a 24-hour `HH:MM`, a dash range of two 1–12 numbers (`8-5`, `8–5`), Spanish `de 8 a 5` / `a las 17:30`, and an English or Spanish weekday name (with or without accents, short or long) followed within 20 characters by a 1–2 digit number. Every number pattern is word-bounded on both sides, so a phone number, a ZIP, a year and "24/7" are not hours; a dash range followed by a duration word (`day`, `days`, `week`, `weeks`, `month`, `months`, `hour`, `hours`, `día`, `días`, `semana`, `semanas`) is not hours either, so "2-3 day turnaround" is excluded while "8-5 weekdays" is found. Write the cases first, then make the patterns pass them and the guards.
- Amounts (Facts, then Services, each by position): `$` followed by digits with optional thousands commas and optional two decimals; digits followed by `dollars`, `dolares`, `dólares` or `USD`; `USD` followed by digits. Each match's `text` is the amount plus up to five following words, stopping before a `.`, `,`, `;`, `:`, `!`, `?` or a line break; `index` is the amount's start in its own box.
- `hours`: `"notice"` when hours are found and `hasHours`, `"hint"` when found and not `hasHours`, else `null`. `amounts`: `[]` unless `hasPriceList`.

- [ ] **Step 4:** Re-run → PASS. Then run each named mutation (one per describe at least: a template word, the Spanish-name fallback, the C16 fallback, `toFixed(2)` always, Sunday first, a fixed `-6` offset in place of `partsInZone`, `recordable` true on a failed read, a bare-number hours pattern, dropping the Services box), paste each failing line, revert by `cp` + `cmp`.
- [ ] **Step 5:** `pnpm --filter web typecheck`; eslint on the eight files; `grep -nE "from ['\"]@/" apps/web/src/lib/voice/knowledge/*.ts` → nothing; `grep -nE "from ['\"]@bis/db['\"]" apps/web/src/lib/voice/knowledge/*.ts` → nothing yet (Task 5 adds `import type` lines). Commit `voice: the price sentences, hours lines, open-now line, knowledge payload and Facts flags, pure and pinned word for word (S-47c)` naming the eight files.

**Review (MEDIUM, sonnet, own detached worktree):** read the twelve sentences against spec §5.1 character by character (the accents in "después" and "Reparación"); run the DST case under `TZ=Asia/Tokyo pnpm --filter web exec vitest run src/lib/voice/knowledge/hours.test.ts` (the server's zone must not matter); re-run two mutations of your choice; confirm `parseKnowledgePayload` cannot return a payload `buildKnowledgePayload` could not have built.

---
## Task 4 (MEDIUM): `PRE_S47C_DIGEST` first, then the prompt blocks and the wiring (bis-voice)

**Dispatch gate:** OQ1 answered (Task 0). This task's text implements the RECOMMENDED answer (B); if the owner picks (A), the brief says so and the implementer drops the `input.afterHours === "hours_then_message"` term from `closedNow` and swaps the two OQ1 cases' expectations (both marked below).

**Files:**
- Modify: `apps/web/src/lib/voice/system-prompt.test.ts` (Step 1 appends the digest; Step 3 appends the S-47c describes)
- Create: `…/knowledge/prompt-blocks.ts`, `…/knowledge/prompt-blocks.test.ts`
- Modify: `apps/web/src/lib/voice/session-config.ts:49-55`, `apps/web/src/lib/voice/system-prompt.ts` (sites listed in Step 4)

**Interfaces:**
- Consumes: Task 3's `openNow`, `hoursLines`, `hasOpenDay` (`./knowledge/hours`), `RenderedService` (`./knowledge/payload`).
- Produces: `VoicePromptInput.businessHours?`, `VoicePromptInput.priceList?`; the exported literals of `prompt-blocks.ts`. Task 6 passes `promptKnowledge(payload)`'s fields in.

**Read first:** `system-prompt.ts` whole (279 lines) and `system-prompt.test.ts:1-20`, `:505-630`.

- [ ] **Step 1: Pin today's prompts BEFORE touching `system-prompt.ts`.** Append to `system-prompt.test.ts`:

```ts
// S-47c (spec section 7): every existing combination × trade module (none, insurance_pc, events). A literal list,
// so the loop's reach is asserted (5184 prompts) rather than assumed. Recorded on the UNMODIFIED system-prompt.ts,
// which at this plan's base is main 044b1ab2's (Task 0's base check).
function everyS47cBaseInput(): VoicePromptInput[] {
  const out: VoicePromptInput[] = [];
  for (const i of everyExistingInput())
    for (const tradeModule of [undefined, "insurance_pc", "events"] as const)
      out.push(tradeModule === undefined ? i : { ...i, tradeModule });
  return out;
}
/** sha256 over all 5184 prompts as they were at 044b1ab2, BEFORE S-47c touched system-prompt.ts. */
const PRE_S47C_DIGEST = "";

describe("buildSystemPrompt — no hours and no list is byte-identical to before S-47c (C3)", () => {
  it("covers 5184 combinations (guards the digest from an empty loop)", () => {
    expect(everyS47cBaseInput().length).toBe(5184);
  });
  it("with neither new key, every combination is byte-identical to 044b1ab2 (mutation: push an unconditional \"\" after the Services line -> FAILS)", () => {
    expect(digestOf(everyS47cBaseInput().map((i) => buildSystemPrompt(i, now)))).toBe(PRE_S47C_DIGEST);
  });
});
```

  Run `pnpm --filter web exec vitest run src/lib/voice/system-prompt.test.ts` on the UNMODIFIED `system-prompt.ts`. The digest case fails with `Expected: "" Received: "<64 hex>"`. Paste the received value into `PRE_S47C_DIGEST`. Re-run: all green (the S-47b `PRE_S47B_DIGEST` cases included), on unmodified code. **Commit this alone** (`test: pin all 5184 of today's prompts before S-47c touches the prompt (S-47c)`, `-- apps/web/src/lib/voice/system-prompt.test.ts`), so the history shows the pin was green before any prompt change.

- [ ] **Step 2: Write `…/knowledge/prompt-blocks.ts`** (every literal from "The model, The prompt lines"):

```ts
// S-47c (spec 5.2, 5.2.1, 5.4; plan SD5-SD8): the prompt lines structured knowledge adds. Model input, not
// catalogue copy (spec 6): every string here is pinned word for word by system-prompt.test.ts and
// prompt-blocks.test.ts. Pure; relative imports only (scripts/sofia-corpus.ts loads system-prompt.ts under tsx).
import type { OpenHours } from "../../booking/slots";
import { hoursLines, openNow } from "./hours";
import type { RenderedService } from "./payload";

export const BUSINESS_HOURS_HEADING =
  "BUSINESS HOURS (the regular weekly hours; where hours written above differ, these are right, except a closure written above for a specific date):";
export const SERVICES_AND_PRICES_HEADING =
  "SERVICES AND PRICES (the only prices you may give; for a price, say that service's sentence exactly as it is written here, in the language you are speaking):";
/** Insurance accounts (C13, SD8): names and descriptions only; no sentence, no amount, no promise of prices. */
export const SERVICES_NAMES_ONLY_HEADING = "SERVICES (what the business offers):";

/** Replaces the HARD LIMITS price line only when a list is given on a non-insurance account (spec 5.2). Its last
 *  sentence is what keeps the events module's "word for word from the facts above" pointed at the list (C12). */
export const LIST_PRICE_LINE =
  "- Give a price only by saying, word for word, that service's sentence from SERVICES AND PRICES above. Any other amount written above, in the facts or the services, is not a price you may give. Never multiply, add up, estimate or round a price, never work out a total, and never quote a service that is not on the list: say the business will confirm pricing and offer to take their details. Wherever a rule below speaks of prices \"in the facts\", it means this list.";

export const AFTER_HOURS_CLOSED_WEB =
  "AFTER HOURS — The business is closed right now (see Right now above); say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.";
export const AFTER_HOURS_CLOSED_WEB_VOICE =
  "AFTER HOURS — The business is closed right now (see Right now above); say so briefly and take a message; do not attempt anything else.";

/** Phone, "Follow business hours, then take a message", closed now (spec 5.2; SD5). */
export function afterHoursClosedPhoneLine(o: { canBook: boolean; handoffAvailable: boolean; hasTradeRules: boolean }): string {
  const book = o.canBook ? ", and book a time that check_availability returns" : "";
  const person = !o.handoffAvailable ? ""
    : o.hasTradeRules ? " If they ask for a person, or it is urgent, you can still put them through."
      : " If they ask for a person, you can still put them through.";
  return `AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above${book}. For anything that needs someone on the team, take a message and say the team will call them back once it opens.${person}`;
}

/** The TOOLS line for transfer_to_human when the phone is closed now and a transfer number exists (spec 5.2.1 point 2). */
export function transferToolLineClosed(hasTradeRules: boolean): string {
  return `- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person${hasTradeRules ? ", or when they accept the offer on the URGENT path in the trade rules above" : ""}. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.`;
}

/** ["", heading, seven day lines, the Right now line], and whether it is open now. */
export function businessHoursBlock(hours: OpenHours, timeZone: string, now: Date): { lines: string[]; open: boolean } {
  const state = openNow(hours, timeZone, now);
  return { lines: ["", BUSINESS_HOURS_HEADING, ...hoursLines(hours), state.line], open: state.open };
}

/** [] for an empty list; else ["", heading, item lines]. `namesOnly` on insurance accounts (C13). SD7: each
 *  description that exists gets its own line. */
export function servicesBlock(list: readonly RenderedService[], namesOnly: boolean): string[] {
  if (list.length === 0) return [];
  return ["", namesOnly ? SERVICES_NAMES_ONLY_HEADING : SERVICES_AND_PRICES_HEADING, ...list.flatMap((s) => [
    namesOnly
      ? `- ${s.name_en}${s.name_es ? ` (in Spanish: ${s.name_es})` : ""}`
      : `- ${s.name_en} — English: "${s.sentence_en}" Spanish: "${s.sentence_es}"`,
    ...(s.description_en ? [`  About it, in English: ${s.description_en}`] : []),
    ...(s.description_es ? [`  About it, in Spanish: ${s.description_es}`] : []),
  ])];
}
```

  (`\"in the facts\"` is the only escape in the file: a double quote inside a double-quoted TS string. Write the file with the Write tool.)

  `…/knowledge/prompt-blocks.test.ts`: every exported string and every branch of the two functions as a typed literal: the three headings, `LIST_PRICE_LINE`, both closed web lines, `afterHoursClosedPhoneLine` for all 8 combinations of its three booleans (a literal table of 8 rows), `transferToolLineClosed(true)` and `(false)`, `servicesBlock([], …)` → `[]`, a two-service list with and without `namesOnly` (one service with both descriptions and a Spanish name, one with neither). Mutations: drop the `hasTradeRules` branch of `person` → the SD5 rows FAIL; print `sentence_en` on insurance → FAILS.

- [ ] **Step 3: Write the failing prompt tests.** Append to `system-prompt.test.ts` (move the imports up to the file's existing imports):

```ts
import { buildRealtimeSessionConfig } from "./session-config";
import type { OpenHours } from "../booking/slots";
import type { RenderedService } from "./knowledge/payload";

// now = 2027-06-01T15:00:00Z = Tuesday 10:00 AM in America/Chicago (base.timezone).
const OPEN_H: OpenHours = { tue: [["08:00", "18:00"]] };
const CLOSED_H: OpenHours = { tue: [["13:00", "18:00"]], wed: [["08:00", "12:00"]] };
const HEADING = "BUSINESS HOURS (the regular weekly hours; where hours written above differ, these are right, except a closure written above for a specific date):";
const DAYS_OPEN = ["Monday: closed", "Tuesday: 8:00 AM to 6:00 PM", "Wednesday: closed", "Thursday: closed", "Friday: closed", "Saturday: closed", "Sunday: closed"];
const DAYS_CLOSED = ["Monday: closed", "Tuesday: 1:00 PM to 6:00 PM", "Wednesday: 8:00 AM to 12:00 PM", "Thursday: closed", "Friday: closed", "Saturday: closed", "Sunday: closed"];
const OPEN_BLOCK = `\n\n${[HEADING, ...DAYS_OPEN, "Right now: open until 6:00 PM."].join("\n")}`;
const CLOSED_BLOCK = `\n\n${[HEADING, ...DAYS_CLOSED, "Right now: closed; opens today at 1:00 PM."].join("\n")}`;
const LIST: RenderedService[] = [{
  name_en: "Haircut", name_es: "Corte de cabello", description_en: "Wash and cut.", description_es: "Lavado y corte.",
  sentence_en: "The price for Haircut is $25.", sentence_es: "El precio de Corte de cabello es $25.",
}];
const LIST_BLOCK = `\n\n${[
  "SERVICES AND PRICES (the only prices you may give; for a price, say that service's sentence exactly as it is written here, in the language you are speaking):",
  `- Haircut — English: "The price for Haircut is $25." Spanish: "El precio de Corte de cabello es $25."`,
  "  About it, in English: Wash and cut.",
  "  About it, in Spanish: Lavado y corte.",
].join("\n")}`;
const NAMES_BLOCK = `\n\n${["SERVICES (what the business offers):", "- Haircut (in Spanish: Corte de cabello)",
  "  About it, in English: Wash and cut.", "  About it, in Spanish: Lavado y corte."].join("\n")}`;
const TODAY_PRICE = "- Never quote a price, rate, or estimate unless one is stated above. If asked, say the business will confirm pricing and offer to take their details.";
const LIST_PRICE = "- Give a price only by saying, word for word, that service's sentence from SERVICES AND PRICES above. Any other amount written above, in the facts or the services, is not a price you may give. Never multiply, add up, estimate or round a price, never work out a total, and never quote a service that is not on the list: say the business will confirm pricing and offer to take their details. Wherever a rule below speaks of prices \"in the facts\", it means this list.";
const PUT_THROUGH = "offer to put them through to someone on the team";
const TOOL_TODAY = "- transfer_to_human() — call this as soon as the caller asks to speak to a person, or accepts when you offer. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.";
const TOOL_CLOSED = "- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.";
const TOOL_CLOSED_URGENT = "- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person, or when they accept the offer on the URGENT path in the trade rules above. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.";
const lastLine = (p: string) => p.split("\n").at(-1);

describe("buildSystemPrompt — S-47c digests", () => {
  it("null and empty new fields are byte-identical too, across all 5184 (mutation: treat [] as a list -> FAILS; treat {} as hours -> FAILS)", () => {
    expect(digestOf(everyS47cBaseInput().map((i) => buildSystemPrompt({ ...i, businessHours: null, priceList: null }, now)))).toBe(PRE_S47C_DIGEST);
    expect(digestOf(everyS47cBaseInput().map((i) => buildSystemPrompt({ ...i, businessHours: {}, priceList: [] }, now)))).toBe(PRE_S47C_DIGEST);
  });
});

describe("buildSystemPrompt — hours (S-47c spec 5.2)", () => {
  it("open now: exactly the BUSINESS HOURS block, after the Services line, and nothing else, on every surface (72 combinations; mutation: place it after HARD LIMITS -> FAILS)", () => {
    let seen = 0;
    for (const medium of ["phone", "web", "web_voice"] as const)
      for (const handoffAvailable of [false, true])
        for (const afterHours of ["hours_then_message", "message_only"] as const)
          for (const bookingEnabled of [true, false])
            for (const tradeModule of [null, "insurance_pc", "events"] as const) {
              const input = baseInput({ medium, handoffAvailable, afterHours, bookingEnabled, tradeModule });
              const withH = buildSystemPrompt({ ...input, businessHours: OPEN_H }, now);
              expect(withH.indexOf("Services: ")).toBeLessThan(withH.indexOf(HEADING));
              expect(withH.indexOf(HEADING)).toBeLessThan(withH.indexOf("HARD LIMITS:"));
              const stripped = withH.replace(OPEN_BLOCK, "");
              // message_only on web/demo drops today's conditional line when open (spec 5.2): put it back to compare.
              const without = buildSystemPrompt(input, now);
              if (medium !== "phone" && afterHours === "message_only") expect(stripped).toBe(without.split("\n").slice(0, -2).join("\n"));
              else expect(stripped).toBe(without);
              seen += 1;
            }
    expect(seen).toBe(72);
  });
  it("closed now, web chat: the block plus the definite AFTER HOURS line, under both settings (SD6)", () => {
    for (const afterHours of ["hours_then_message", "message_only"] as const) {
      const p = buildSystemPrompt(baseInput({ medium: "web", afterHours, businessHours: CLOSED_H }), now);
      expect(p).toContain(CLOSED_BLOCK);
      expect(lastLine(p)).toBe("AFTER HOURS — The business is closed right now (see Right now above); say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.");
      expect(p.split("AFTER HOURS").length - 1).toBe(1);
    }
  });
  it("closed now, voice demo: the definite demo line (SD6)", () => {
    const p = buildSystemPrompt(baseInput({ medium: "web_voice", afterHours: "hours_then_message", businessHours: CLOSED_H }), now);
    expect(lastLine(p)).toBe("AFTER HOURS — The business is closed right now (see Right now above); say so briefly and take a message; do not attempt anything else.");
  });
  it("closed now, phone, Follow business hours: the closed line, booking clause only where a new booking can be made (mutation: canBook from bookingEnabled -> no change here, so also see the message_only case)", () => {
    expect(lastLine(buildSystemPrompt(baseInput({ bookingEnabled: true, handoffAvailable: false, businessHours: CLOSED_H }), now))).toBe(
      "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above, and book a time that check_availability returns. For anything that needs someone on the team, take a message and say the team will call them back once it opens.");
    expect(lastLine(buildSystemPrompt(baseInput({ bookingEnabled: false, handoffAvailable: true, businessHours: CLOSED_H }), now))).toBe(
      "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above. For anything that needs someone on the team, take a message and say the team will call them back once it opens. If they ask for a person, you can still put them through.");
    expect(lastLine(buildSystemPrompt(baseInput({ bookingEnabled: true, handoffAvailable: true, tradeModule: "events", businessHours: CLOSED_H }), now))).toBe(
      "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above, and book a time that check_availability returns. For anything that needs someone on the team, take a message and say the team will call them back once it opens. If they ask for a person, or it is urgent, you can still put them through.");
  });
  it("phone, Always take a message: the MESSAGES ONLY line unchanged, open or closed (spec 5.2.1 point 5)", () => {
    for (const businessHours of [OPEN_H, CLOSED_H]) {
      const input = baseInput({ afterHours: "message_only", handoffAvailable: true });
      expect(lastLine(buildSystemPrompt({ ...input, businessHours }, now))).toBe(lastLine(buildSystemPrompt(input, now)));
    }
  });
});

describe("buildSystemPrompt — closed now and the offer of a person (C14, spec 5.2.1)", () => {
  // callerNumber null and booking on, so all four offer sites are in the prompt.
  const PHONE = baseInput({ handoffAvailable: true, callerNumber: null, bookingEnabled: true, afterHours: "hours_then_message" });
  const SITES = [
    "then offer to take a message if they would rather talk to a person. Never claim to be human.",
    "if they ask, offer to take a message instead.",
    "If either refuses, apologize and offer to take a message.",
    "and offer to take a message, or suggest they call back from that phone.",
  ];
  it("all four offer sites read 'offer to take a message' and none offers a transfer (mutation: ignore closedNow in the offer -> FAILS)", () => {
    for (const disclosed of [false, true]) {
      const p = buildSystemPrompt({ ...PHONE, disclosed, businessHours: CLOSED_H }, now);
      for (const s of SITES.slice(disclosed ? 1 : 0)) expect(p, s).toContain(s);
      if (disclosed) expect(p).toContain("Then offer to take a message if they would rather talk to a person.");
      expect(p).not.toContain(PUT_THROUGH);
    }
  });
  it("the TOOLS line is the closed one; with a trade module it names the URGENT path; transfer_to_human stays on the session (mutation: drop the tool when closed -> FAILS)", () => {
    const none = buildSystemPrompt({ ...PHONE, businessHours: CLOSED_H }, now);
    const evt = buildSystemPrompt({ ...PHONE, tradeModule: "events", businessHours: CLOSED_H }, now);
    expect(none).toContain(TOOL_CLOSED);
    expect(none).not.toContain(TOOL_TODAY);
    expect(evt).toContain(TOOL_CLOSED_URGENT);
    const tools = buildRealtimeSessionConfig({ ...PHONE, businessHours: CLOSED_H }, now).tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toContain("transfer_to_human");
  });
  it("the trade module block is byte-identical closed and open (C12: the module still gets handoffAvailable; mutation: pass !closedNow -> FAILS)", () => {
    for (const tradeModule of ["insurance_pc", "events"] as const) {
      const block = (p: string) => p.slice(p.indexOf("TRADE RULES —"), p.indexOf("\n\nTOOLS"));
      const closed = buildSystemPrompt({ ...PHONE, tradeModule, businessHours: CLOSED_H }, now);
      const open = buildSystemPrompt({ ...PHONE, tradeModule, businessHours: OPEN_H }, now);
      expect(block(closed).length).toBeGreaterThan(100);
      expect(block(closed)).toBe(block(open));
    }
  });
  it("open now: the no-hours prompt plus the block, nothing else (the offer and TOOLS lines are today's)", () => {
    expect(buildSystemPrompt({ ...PHONE, businessHours: OPEN_H }, now).replace(OPEN_BLOCK, "")).toBe(buildSystemPrompt(PHONE, now));
  });
  it("web chat and voice demo, closed: no C14 line at all, even with handoffAvailable", () => {
    for (const medium of ["web", "web_voice"] as const) {
      const p = buildSystemPrompt({ ...PHONE, medium, businessHours: CLOSED_H }, now);
      expect(p).not.toContain("the business is closed right now, so do not offer this");
    }
    const demo = buildSystemPrompt({ ...PHONE, medium: "web_voice", businessHours: CLOSED_H }, now);
    expect(demo).toContain(PUT_THROUGH); // today's demo wording, untouched
  });
  // OQ1 (B, recommended): under Always take a message nothing about transfers changes with the hours.
  // If the owner chose (A): these two expectations flip (PUT_THROUGH absent; TOOL_CLOSED present).
  it("OQ1: Always take a message, closed: the offers and the TOOLS line are today's (mutation: drop the afterHours term from closedNow -> FAILS)", () => {
    const p = buildSystemPrompt({ ...PHONE, afterHours: "message_only", businessHours: CLOSED_H }, now);
    expect(p).toContain(PUT_THROUGH);
    expect(p).toContain(TOOL_TODAY);
  });
});

describe("buildSystemPrompt — the price list (S-47c spec 5.2, 5.4)", () => {
  it("a list alone adds the list after the Services line and swaps exactly the one HARD LIMITS line (mutation: keep today's line too -> FAILS)", () => {
    for (const medium of ["phone", "web", "web_voice"] as const)
      for (const tradeModule of [null, "events"] as const) {
        const input = baseInput({ medium, tradeModule });
        const withL = buildSystemPrompt({ ...input, priceList: LIST }, now);
        expect(withL).toContain(LIST_BLOCK);
        expect(withL.split(LIST_PRICE).length - 1).toBe(1);
        expect(withL).not.toContain(TODAY_PRICE);
        expect(withL.replace(LIST_BLOCK, "").replace(LIST_PRICE, TODAY_PRICE)).toBe(buildSystemPrompt(input, now));
      }
  });
  it("hours and a list together: hours first, then the list, both before HARD LIMITS", () => {
    const p = buildSystemPrompt(baseInput({ businessHours: OPEN_H, priceList: LIST }), now);
    expect(p).toContain(`${OPEN_BLOCK}${LIST_BLOCK}\n\nHARD LIMITS:`);
  });
  it("insurance: names and descriptions only, no sentence, no amount, today's HARD LIMITS line (C13; mutation: print the sentences on insurance -> FAILS)", () => {
    const p = buildSystemPrompt(baseInput({ tradeModule: "insurance_pc", priceList: LIST }), now);
    expect(p).toContain(NAMES_BLOCK);
    expect(p).toContain(TODAY_PRICE);
    for (const s of ["The price for Haircut", "El precio de", "$25", "SERVICES AND PRICES", LIST_PRICE]) expect(p).not.toContain(s);
  });
  it("events: the module's own words are untouched and the list sits above them (C12)", () => {
    const p = buildSystemPrompt(baseInput({ tradeModule: "events", priceList: LIST }), now);
    expect(p.indexOf("SERVICES AND PRICES")).toBeLessThan(p.indexOf("TRADE RULES — EVENTS AND VENUES:"));
    expect(p).toContain("- You may give prices, packages, deposits, payment plans and refund or cancellation terms only by repeating what the facts above say, word for word, with every number exactly as it is written there. For these, and only these, this overrides the TONE line about not reading the facts verbatim.");
  });
});
```

  Run → FAIL (`businessHours`/`priceList` unknown keys; then the cases).

- [ ] **Step 4: Wire it.**
  - `session-config.ts`: add `import type { OpenHours } from "../booking/slots";` and `import type { RenderedService } from "./knowledge/payload";` after `:7`; after `tradeModule?: TradeModuleId | null;` (`:54`):

```ts
  /**
   * S-47c: the account's structured weekly hours (`voice_profiles.business_hours`, through the knowledge payload),
   * or none. OPTIONAL; absent, null or an object with no open day gives NO lines, so every existing prompt is
   * byte-identical (system-prompt.test.ts's PRE_S47C_DIGEST). The phone and the chat pass the payload's value.
   */
  businessHours?: OpenHours | null;
  /**
   * S-47c: the rendered price list (name, descriptions and the two fixed sentences), from the SAME payload the
   * call or chat is stamped with. OPTIONAL; absent, null or [] gives no lines and keeps today's HARD LIMITS line.
   */
  priceList?: RenderedService[] | null;
```

  - `system-prompt.ts`:
    - Imports after `:11`: `import { businessHoursBlock, servicesBlock, LIST_PRICE_LINE, AFTER_HOURS_CLOSED_WEB, AFTER_HOURS_CLOSED_WEB_VOICE, afterHoursClosedPhoneLine, transferToolLineClosed } from "./knowledge/prompt-blocks";` and `import { hasOpenDay } from "./knowledge/hours";`.
    - After `const onWeb = …` (`:32`), MOVE the `const onPhone = !input.medium || input.medium === "phone";` declaration up from `:259` (delete it there; its comment block `:248-258` stays above the after-hours code), and add:

```ts
  // S-47c (spec 5.2, 5.2.1, C5, C14): structured hours, only when at least one day is open (SD17). `closedNow`
  // is the PHONE under "Follow business hours" with the hours saying closed right now (OQ1: B); while it holds, the
  // offers of a person become "offer to take a message" and the TOOLS line says not to offer a transfer, while
  // transfer_to_human stays on the session (toolSchemas is unchanged) for a caller who asks or an URGENT path.
  const hoursBlock = hasOpenDay(input.businessHours) ? businessHoursBlock(input.businessHours, input.timezone, now) : null;
  const closedNow = onPhone && hoursBlock !== null && !hoursBlock.open && input.afterHours === "hours_then_message";
  const priceList = input.priceList && input.priceList.length > 0 ? input.priceList : null;
  const insurance = input.tradeModule === "insurance_pc";
```

    - `wouldRatherTalkToAPerson` (`:57-61`): `: input.handoffAvailable && !closedNow ? "offer to put them through to someone on the team" : "offer to take a message"`.
    - Hoist the module block above `const lines` (so the TOOLS and AFTER HOURS lines can ask whether one is present), unchanged in its arguments:

```ts
  const tradeBlock = tradeModuleBlock(input.tradeModule, {
    businessName: input.businessName,
    medium: input.medium ?? "phone",
    handoffAvailable: input.handoffAvailable === true,
    canBook: booking && !onWeb,
    languages: input.languages,
  });
```

      and replace `:134-140` with `...tradeBlock,` (the S-47b comment above it stays).
    - After `input.services ? \`Services: ${input.services}\` : "",` (`:121`):

```ts
    // S-47c (spec 5.2): the hours, then the list, inside WHAT YOU KNOW. Neither present: no lines at all.
    ...(hoursBlock ? hoursBlock.lines : []),
    ...servicesBlock(priceList ?? [], insurance),
```

    - `:125` becomes `priceList && !insurance ? LIST_PRICE_LINE : \`- Never quote a price, rate, or estimate unless one is stated above. If asked, say the business will confirm pricing and offer to take their details.\`,` (today's line byte for byte in the else; C13/§5.4 keep it on insurance).
    - `:184-188`: `lines.push(closedNow ? transferToolLineClosed(tradeBlock.length > 0) : "<today's line, byte for byte>");`
    - `:260-276` becomes:

```ts
  if (input.afterHours === "message_only") {
    const always = [ /* unchanged, :261-267 */ ].join(" ");
    if (onPhone) lines.push("", always);
    // Web chat and demo: today's conditional line when there are no structured hours; with hours, the definite
    // line when closed and nothing when open (spec 5.2).
    else if (!hoursBlock) lines.push("", onWeb
      ? "AFTER HOURS — If the business is closed right now, say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up."
      : "AFTER HOURS — If the business is closed right now, say so briefly and take a message; do not attempt anything else.");
    else if (!hoursBlock.open) lines.push("", onWeb ? AFTER_HOURS_CLOSED_WEB : AFTER_HOURS_CLOSED_WEB_VOICE);
  } else if (hoursBlock && !hoursBlock.open) {
    // "Follow business hours, then take a message", closed now: the setting finally has hours to follow.
    lines.push("", onPhone
      ? afterHoursClosedPhoneLine({ canBook: booking, handoffAvailable: input.handoffAvailable === true, hasTradeRules: tradeBlock.length > 0 })
      : onWeb ? AFTER_HOURS_CLOSED_WEB : AFTER_HOURS_CLOSED_WEB_VOICE);
  }
```

- [ ] **Step 5:** Re-run `system-prompt.test.ts` and `…/knowledge/prompt-blocks.test.ts` → PASS. Then, unchanged: `src/lib/voice/session-config.test.ts`, `src/lib/voice/greeting.test.ts`, `src/lib/voice/modules` (all four test files: `pin.ts`'s hashes must not move), `…/incoming/route.test.ts`, `…/incoming/lifecycle.test.ts`, `…/websession/route.test.ts`, `…/turn/route.test.ts`, `src/lib/voice/modules/corpus-lib.test.ts` → all PASS (their prompts are byte-identical). Run `pnpm --filter web sofia:corpus events --dry-run` (the corpus graph still loads under `tsx`; if the dry run needs a key, it is a finding: report it, never read `.env.local`).
- [ ] **Step 6: Mutations** (paste each failing line, revert by `cp` + `cmp`): an unconditional `""` after the Services line; `[]` treated as a list; `{}` treated as hours; the block placed after HARD LIMITS; today's price line kept beside the list line; sentences printed on insurance; `wouldRatherTalkToAPerson` ignoring `closedNow`; the module ctx given `handoffAvailable: !closedNow`; the transfer tool line ignoring `closedNow`; `closedNow` without the `afterHours` term (OQ1 case); `canBook: input.bookingEnabled` in the phone closed line.
- [ ] **Step 7:** `pnpm --filter web typecheck`; eslint on the five files. Commit `voice: Sofía is given the business hours with an open-now line and the price list as fixed sentences; a closed phone offers a message, not a transfer; no hours and no list is byte-identical (S-47c)` naming them.

**Review (MEDIUM, opus, own detached worktree):**
- **Recompute `PRE_S47C_DIGEST` independently:** in your worktree, `git show 044b1ab2:apps/web/src/lib/voice/system-prompt.ts > <your-wt>/apps/web/src/lib/voice/system-prompt.ts` (keep a `cp` of the branch file first); the modules are identical at `044b1ab2` and HEAD (`git diff 044b1ab2 HEAD -- apps/web/src/lib/voice/modules` prints nothing). Run `pnpm --filter web exec vitest run src/lib/voice/system-prompt.test.ts -t "byte-identical to 044b1ab2"`, read the run count, and confirm the pinned hex is what the `044b1ab2` file produces. Restore by `cp` + `cmp`, never `git checkout`.
- Read every new line against spec §5.2/§5.2.1/§5.4 and SD5–SD8 word by word; hunt a prompt where two lines contradict each other (the OQ1 class).
- Re-run two mutations of your choice.

---
## Task 5 (MEDIUM): `@bis/db` — the columns, the stamps, `voice-knowledge.ts`, every typed literal (bis-voice)

**Dispatch gate:** Task 1's review has APPROVED (the md5 is final); 0095 is on this agent's replica.

**Files:**
- Modify `packages/db/src/voice.ts`: `:11-37` (`WeeklyHours`, `VoiceProfileRow.business_hours`), `:46` (`VoiceProfilePatch` also omits `business_hours`), `:77-82` (`PROFILE_COLS` + its LOAD-BEARING comment), `:180-188` (the run-time refusal), `:269-340` (`startCallRow` input + one doc paragraph), `:989-1000` (`CallDetailRow`, `CALL_DETAIL_COLS` + comment).
- Modify `packages/db/src/concierge.ts:211-235` (`ConciergeConversationRow`, `CONVO_COLS` + comment, `createConciergeConversation`).
- Create `packages/db/src/voice-knowledge.ts`; add `export * from "./voice-knowledge";` after `packages/db/src/index.ts:143`.
- Modify `packages/db/src/account-teardown.ts`: one paragraph at the end of the doc block above `deleteAccountCascade` (`:40-102`), SD4's reasoning in the `consent_events` paragraph's style.
- Tests: create `packages/db/src/test/voice-knowledge.test.ts`; add cases to `packages/db/src/test/voice.test.ts` (inside `describe("call handoff accessors")`, after the S-47b case at `:708-725`), `packages/db/src/test/concierge.test.ts` (after the S-47b case at `:387`), `packages/db/src/voice-forward.test.ts` (beside `:92-110`).
- Web type re-point: `…/knowledge/price-sentence.ts` (`PriceKind` → `import type { PriceKind } from "@bis/db"`; keep the local `PRICE_KINDS` value, typed `satisfies readonly PriceKind[]`).
- Typed literals the two typechecks name (the typecheck is the authority). Expected, read 2026-10-23 off `grep -rn "trade_module: null"` / `"trade_module_version: null"`: `business_hours: null` in `…/voice/voice-settings.tsx:35-45` (`DEFAULT_PROFILE`), `…/voice/voice-settings.test.ts` (the six profile literals at `:416`, `:624`, `:733`, `:874`, `:901`, `:945`), `…/voice/page.test.ts:112`, `…/turn/route.test.ts:144` (`PROFILE`), `…/incoming/lifecycle.test.ts:191`, `…/incoming/route.test.ts:137`, `apps/web/src/app/api/voice/texml/handoff-result/route.test.ts:98`, `…/texml/route.test.ts:59`, `…/texml/screen/route.test.ts:48`, `…/texml/wellformed.test.ts:258`, `…/websession/route.test.ts:82`; `knowledge_version: null` in `…/call/page.test.ts:155-156` (`CALL`) and `…/turn/route.test.ts:151` (`CONVERSATION`). Also the 18 bare-factory files of Task 0 wherever they build a profile, call-detail or conversation literal: add the null explicitly, so the "no hours, no stamp" path is exercised with the real null shape, not `undefined`.

**Interfaces:**
- Consumes: 0095 (on your replica).
- Produces: "The model, `@bis/db`". Tasks 6, 7, 8, 9 read it.

- [ ] **Step 1: Build your kit** on 55435/55436/55437 with PostgREST (`replica.sh 55435 <dir>`, then `pgrst.sh 55435 55436 55437 <dir>`).

- [ ] **Step 2: Write the failing tests.**
  - `packages/db/src/test/voice-knowledge.test.ts` (withTestAccount, over PostgREST; each case seeds through `upsertVoiceProfile` and `saveVoiceKnowledge`, the real writers):
    1. "saveVoiceKnowledge writes the list and the snapshot; listVoiceServices reads it in position order; getKnowledgeSnapshot returns the payload deep-equal to what was sent; getLatestKnowledgeVersion reads 1 (A3)". Payload: a nested object with a string, a number, a null, an array and an accented string (`"Corte de cabello"`, `"después"`).
    2. "an equal payload sent again over PostgREST answers the same version (A3: jsonb equality survives the trip; mutation: the RPC always appends -> FAILS)".
    3. "stale, no_profile and invalid come back as statuses, not throws; a transport error throws naming the function" (stale: `baseVersion: 0` after version 1; no_profile: an account with no profile; invalid: a `per_unit` row without `unit_es`).
    4. "ensureKnowledgeSnapshot returns the version as a number (not a string), and the same version for an equal payload".
    5. **Second account:** "listVoiceServices, getKnowledgeSnapshot and getLatestKnowledgeVersion read nothing of another account" (A has a list and version 1; for B: `[]`, `null`, `0`). Mutation: drop `.eq("account_id", accountId)` from each → FAILS.
    6. "the account teardown after a save leaves nothing and throws nothing" (the `withTestAccount` `finally` runs `deleteAccountCascade`; a second `withTestAccount` reads the first account's id afterwards through `serviceDb()`: `voice_services` and `voice_knowledge_snapshots` count 0). Mutation: add `"voice_services"` to `ACCOUNT_OWNED_TABLES` → the teardown throws 42501 → FAILS.
  - `voice.test.ts`, after the S-47b case:

```ts
  it("startCallRow stamps knowledge_version when given and getCall reads it; omitted leaves it null; a version the account does not hold is refused by the key (S-47c; mutations: drop knowledge_version from CALL_DETAIL_COLS -> FAILS; name it as null always -> the omitted insert still works but the stamped read FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await upsertVoiceProfile(db, accountId, {}, "user_test");
      const v = await ensureKnowledgeSnapshot(db, accountId, { facts: "x" });
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const stamped = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, knowledgeVersion: v });
      const plain = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null });
      expect((await getCall(db, accountId, stamped.id))?.knowledge_version).toBe(v);
      expect((await getCall(db, accountId, plain.id))?.knowledge_version).toBeNull();
      await expect(startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, knowledgeVersion: v + 1 }))
        .rejects.toThrow(/startCallRow failed/);
    });
  });
```

  - `concierge.test.ts`, after the S-47b case: the same three halves for `createConciergeConversation({ …, knowledgeVersion })` / `getConciergeConversation` (stamped reads the version, plain reads null).
  - `voice-forward.test.ts` (hermetic), beside the forward_calls refusal: "upsertVoiceProfile refuses business_hours at run time, before any read (mutation: drop the check -> the fake client sees an update, FAILS)", asserting `rejects.toThrow("upsertVoiceProfile cannot write business_hours; use saveVoiceKnowledge")` and that the fake client's `from` was never called.

- [ ] **Step 3: Run on your replica** (`source <dir>/env-run.sh`; from `packages/db`): `node node_modules/vitest/vitest.mjs run src/test/voice-knowledge.test.ts src/test/voice.test.ts src/test/concierge.test.ts src/voice-forward.test.ts` → the new cases FAIL. Read the counts.

- [ ] **Step 4: Implement.**
  - `voice.ts`: `WeeklyHours` (after `TradeModuleSetting`, `:15`); `business_hours: WeeklyHours | null;` after `trade_module` in `VoiceProfileRow` with a doc line ("0095. The regular weekly hours; written only by save_voice_knowledge, so `upsertVoiceProfile` refuses it"); `VoiceProfilePatch` omits `"business_hours"` too and its doc comment says why; `PROFILE_COLS` ends `…, disclosure, trade_module, business_hours"` and the LOAD-BEARING comment above it names 0095 (and SD3's sites); in `upsertVoiceProfile`, after the `forward_calls` check (`:186-188`): `if (Object.prototype.hasOwnProperty.call(patch, "business_hours")) throw new Error("upsertVoiceProfile cannot write business_hours; use saveVoiceKnowledge");`; `startCallRow`'s input gains `knowledgeVersion?: number;` and its insert `...(input.knowledgeVersion === undefined ? {} : { knowledge_version: input.knowledgeVersion }),` after the trade-module spread; append to its doc comment: "`knowledgeVersion` (0095, S-47c) is the snapshot this call's prompt was built from (`ensure_knowledge_snapshot` at call start). Named only when given, for the same deployment-ordering reason as the token, the disclosure and the trade-module stamps; 0095's composite key refuses a version this account does not hold."; `CallDetailRow` gains `knowledge_version: number | null;`; `CALL_DETAIL_COLS` gains `, knowledge_version` and its comment names 0095.
  - `concierge.ts`: `ConciergeConversationRow` gains `knowledge_version: number | null;`; `CONVO_COLS` ends `…, trade_module, trade_module_version, knowledge_version"` (comment names 0095); the create input gains `knowledgeVersion?: number` and the insert `...(input.knowledgeVersion === undefined ? {} : { knowledge_version: input.knowledgeVersion }),`.
  - `voice-knowledge.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyHours } from "./voice";

/** 0095. The TypeScript twin of voice_services_price_kind_check. */
export type PriceKind = "fixed" | "from" | "range" | "per_unit" | "free" | "after_visit";
export type VoiceServiceInput = {
  name_en: string; name_es: string | null; description_en: string | null; description_es: string | null;
  price_kind: PriceKind; amount_cents: number | null; amount_max_cents: number | null; unit_en: string | null; unit_es: string | null;
};
export type VoiceServiceRow = VoiceServiceInput & { id: string; account_id: string; position: number; created_at: string };
export type KnowledgeSnapshotRow = { id: string; account_id: string; version: number; payload: unknown; created_at: string; created_by: string };
export type KnowledgeParts = { facts?: string; services_text?: string; business_hours?: WeeklyHours | null; services?: VoiceServiceInput[] };
export type SaveKnowledgeResult = { status: "ok"; version: number } | { status: "stale" | "no_profile" | "invalid" };

// LOAD-BEARING (0095): every one of these names a 0095 table or function; a project without 0095 refuses them.
const SERVICE_COLS =
  "id, account_id, position, name_en, name_es, description_en, description_es, price_kind, amount_cents, amount_max_cents, unit_en, unit_es, created_at";

/** The price list, in its order. RLS-safe on a user client (Owners and the agency read; spec 4). */
export async function listVoiceServices(db: SupabaseClient, accountId: string): Promise<VoiceServiceRow[]> {
  const { data, error } = await db.from("voice_services").select(SERVICE_COLS)
    .eq("account_id", accountId).order("position", { ascending: true });
  if (error) throw new Error(`listVoiceServices failed: ${error.message}`);
  return (data ?? []) as VoiceServiceRow[];
}

export async function getKnowledgeSnapshot(db: SupabaseClient, accountId: string, version: number): Promise<KnowledgeSnapshotRow | null> {
  const { data, error } = await db.from("voice_knowledge_snapshots")
    .select("id, account_id, version, payload, created_at, created_by")
    .eq("account_id", accountId).eq("version", version).maybeSingle();
  if (error) throw new Error(`getKnowledgeSnapshot failed: ${error.message}`);
  return (data as KnowledgeSnapshotRow | null) ?? null;
}

/** The latest version, 0 when the account has none. A row read, never a head count (memory "Head-count null"). */
export async function getLatestKnowledgeVersion(db: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await db.from("voice_knowledge_snapshots").select("version")
    .eq("account_id", accountId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`getLatestKnowledgeVersion failed: ${error.message}`);
  return (data as { version: number } | null)?.version ?? 0;
}

/**
 * Every Voice page knowledge save, through 0095's save_voice_knowledge (service_role only: call it with
 * serviceDb() behind the app's agency check). A refusal is a status, never a throw; a transport error throws.
 */
export async function saveVoiceKnowledge(db: SupabaseClient, accountId: string,
  input: { actor: string; parts: KnowledgeParts; payload: Record<string, unknown>; baseVersion: number },
): Promise<SaveKnowledgeResult> {
  const { data, error } = await db.rpc("save_voice_knowledge", {
    p_account_id: accountId, p_actor: input.actor, p_parts: input.parts, p_payload: input.payload, p_base_version: input.baseVersion,
  });
  if (error) throw new Error(`saveVoiceKnowledge failed: ${error.message}`);
  const r = data as { status?: unknown; version?: unknown } | null;
  if (r?.status === "ok" && typeof r.version === "number") return { status: "ok", version: r.version };
  if (r?.status === "stale" || r?.status === "no_profile" || r?.status === "invalid") return { status: r.status };
  throw new Error("saveVoiceKnowledge failed: an answer the function never gives");
}

/** Call and chat start (spec 5.6). The callers fail open: a throw leaves the call or chat unstamped. */
export async function ensureKnowledgeSnapshot(db: SupabaseClient, accountId: string, payload: Record<string, unknown>): Promise<number> {
  const { data, error } = await db.rpc("ensure_knowledge_snapshot", { p_account_id: accountId, p_payload: payload });
  if (error) throw new Error(`ensureKnowledgeSnapshot failed: ${error.message}`);
  if (typeof data !== "number" || !Number.isInteger(data) || data < 1) throw new Error("ensureKnowledgeSnapshot failed: not a version");
  return data;
}
```

  - Typed literals and fixtures as listed under **Files**. Then `pnpm --filter @bis/db typecheck` and `pnpm --filter web typecheck` → green.

- [ ] **Step 5: Run on your replica:** the new cases → PASS; then whole files unchanged: `src/test/voice.test.ts`, `src/test/concierge.test.ts`, `src/test/voice-schema.test.ts` (its "PROFILE_COLS returns exactly the voice_profiles columns" case is the live proof `business_hours` is selected; mutation: drop it from `PROFILE_COLS` → FAILS), `src/test/webchat.test.ts`, `src/test/record.test.ts`, `src/test/demo-seed.test.ts` (the seed writes facts through `upsertVoiceProfile`, which must still work). Web: every test file the typecheck made you touch, by path → PASS.
- [ ] **Step 6:** Run the named mutations (the three `.eq("account_id")` drops, `ACCOUNT_OWNED_TABLES` + `voice_services`, `CALL_DETAIL_COLS`, `CONVO_COLS`, `PROFILE_COLS`, the `business_hours` refusal), paste, revert, `cmp`. Both typechecks green; eslint on touched files.
- [ ] **Step 7:** Commit `db: business hours on every voice profile read, the knowledge version stamped on calls and website chats and read back, and the price-list and snapshot reads and writers (S-47c)` with the trailers, naming every path. Stop your kit.

**Review (MEDIUM, sonnet, own worktree and kit on 55438/55439/55440):**
- `grep -rn 'from("voice_profiles")\|from("concierge_conversations")\|from("calls")' packages/db/src apps/web/src` and read each hit for a select list that builds its own column list and should carry a new column (SD3's sites are the expected ones).
- Re-run the `CONVO_COLS` mutation and the teardown-list mutation.
- Confirm no `@bis/db` VALUE export was added that is read at import time (`grep -n "^export const" packages/db/src/voice-knowledge.ts` → nothing).

---

## Task 6 (MEDIUM): Stamping, and the prompt from the same payload, on the three surfaces (bis-voice)

**Dispatch gate:** Tasks 4 and 5 committed; Task 0's latency gate passed.

**Files:**
- Modify `…/incoming/route.ts`: the `@bis/db` import (`:75-80`) gains `listVoiceServices, ensureKnowledgeSnapshot`; add `import { knowledgeFromLive, promptKnowledge } from "@/lib/voice/knowledge/payload";`; step 9 (`:1042-1044`), steps 9c–10 (`:1081-1115`), `promptInput` (`:1138-1147`).
- Modify `…/incoming/route.test.ts` and `…/incoming/lifecycle.test.ts` (both bare factories gain the two functions; the existing exact `startCallRow` assertions gain the stamp).
- Modify `…/turn/route.ts`: the lazy destructure (`:187-191`) gains `listVoiceServices, ensureKnowledgeSnapshot, getKnowledgeSnapshot`; imports gain `knowledgeFromLive, parseKnowledgePayload, promptKnowledge, type KnowledgePayload` from `@/lib/voice/knowledge/payload`; turn 1 (`:356-399`), turn 2+ (`:400-424`), the prompt (`:440-468`). Modify `…/turn/route.test.ts`.
- Modify `…/websession/route.ts`: the lazy destructure (`:101-104`) gains `listVoiceServices`; `promptInput` (`:186-201`). Modify `…/websession/route.test.ts`.

**Interfaces:**
- Consumes: Task 3's `knowledgeFromLive`, `parseKnowledgePayload`, `promptKnowledge`; Task 4's `VoicePromptInput.businessHours/priceList`; Task 5's functions and stamps.
- Produces: nothing new for later tasks (the e2e and the knowledge page read what this writes).

- [ ] **Step 1: Write the failing tests.**
  - **Factories.** `…/incoming/route.test.ts` and `…/incoming/lifecycle.test.ts`: add hoisted `listVoiceServicesMock` and `ensureKnowledgeSnapshotMock`, wire both into the bare factory, and in each file's `beforeEach` give them the defaults `mockResolvedValue([])` and `mockResolvedValue(5)`. Every existing EXACT `startCallRowMock` input assertion then gains `knowledgeVersion: 5`: `route.test.ts:592`, `:815`, `:825`, `:872`, `:889`, `:898`, `:909`, `:966`, `:974`, `:996` (10) and `lifecycle.test.ts:1788` (1), read off `grep -n "startCallRowMock).toHaveBeenCalledWith"`. A `toMatchObject` assertion (`route.test.ts:987`) stays as it is. `…/turn/route.test.ts`: add `listVoiceServices: vi.fn(async () => [])`, `ensureKnowledgeSnapshot: vi.fn(async () => 5)`, `getKnowledgeSnapshot: vi.fn()` to `dbFns` (`:8-22`) and re-set those three defaults in the file's `beforeEach` (`:244-263`, which re-arms the other `dbFns` the same way); the two exact `createConciergeConversation` input assertions (`grep -n "createConciergeConversation).toHaveBeenCalledWith"`: 2) gain `knowledgeVersion: 5`. `…/websession/route.test.ts`: add a hoisted `listVoiceServicesMock` (default `[]`) to its factory (`:28-55`).
  - Append to `…/incoming/route.test.ts`:

```ts
describe("POST /api/voice/incoming — what Sofía knows (S-47c)", () => {
  const acceptedInstructions = () => {
    const [, init] = fetchMock.mock.calls[0]!;
    return (JSON.parse(String((init as { body: string }).body)) as { instructions: string }).instructions;
  };
  const ROW = { id: "s1", account_id: "acct1", position: 1, created_at: "2026-10-23T00:00:00Z", name_en: "Haircut", name_es: null,
    description_en: null, description_es: null, price_kind: "fixed", amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null };
  const SENTENCE = `- Haircut — English: "The price for Haircut is $25." Spanish: "El precio de Haircut es $25."`;

  it("the row is stamped with the version the RPC returned, and the prompt is built from the SAME payload the RPC was given (mutation: build the prompt from a second read -> FAILS)", async () => {
    listVoiceServicesMock.mockResolvedValue([ROW]);
    ensureKnowledgeSnapshotMock.mockResolvedValue(42);
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(startCallRowMock.mock.calls[0]![2]).toMatchObject({ knowledgeVersion: 42 });
    const [, accountId, payload] = ensureKnowledgeSnapshotMock.mock.calls[0]! as [unknown, string, { services: { sentence_en: string }[]; facts: string }];
    expect(accountId).toBe("acct1");
    expect(payload.services.map((s) => s.sentence_en)).toEqual(["The price for Haircut is $25."]);
    expect(payload.facts).toBe(PROFILE_ROW.facts);
    expect(acceptedInstructions()).toContain(SENTENCE);
    expect(listVoiceServicesMock).toHaveBeenCalledTimes(1);
    expect(getVoiceProfileMock).toHaveBeenCalledTimes(1);
  });
  it("the profile's hours reach the prompt and the payload (mutation: drop businessHours from promptInput -> FAILS)", async () => {
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, business_hours: { tue: [["08:00", "18:00"]] } });
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(acceptedInstructions()).toContain("BUSINESS HOURS (");
    expect((ensureKnowledgeSnapshotMock.mock.calls[0]![2] as { business_hours: unknown }).business_hours).toEqual({ tue: [["08:00", "18:00"]] });
  });
  it("the RPC failing leaves the call unstamped and ANSWERED, with the knowledge it read (fail-open)", async () => {
    listVoiceServicesMock.mockResolvedValue([ROW]);
    ensureKnowledgeSnapshotMock.mockRejectedValue(new Error("ensureKnowledgeSnapshot failed: boom"));
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect("knowledgeVersion" in (startCallRowMock.mock.calls[0]![2] as object)).toBe(false);
    expect(acceptedInstructions()).toContain(SENTENCE);
  });
  it("the services read failing: no RPC, unstamped, free text and hours kept, no list (SD9; mutation: ensure the empty-list payload -> FAILS)", async () => {
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, business_hours: { tue: [["08:00", "18:00"]] } });
    listVoiceServicesMock.mockRejectedValue(new Error("listVoiceServices failed: boom"));
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(ensureKnowledgeSnapshotMock).not.toHaveBeenCalled();
    expect("knowledgeVersion" in (startCallRowMock.mock.calls[0]![2] as object)).toBe(false);
    expect(acceptedInstructions()).toContain("BUSINESS HOURS (");
    expect(acceptedInstructions()).not.toContain("SERVICES AND PRICES");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("no hours and no list: the prompt is byte-identical to a prompt built without the new inputs, and the call is still stamped (spec 8.4)", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(acceptedInstructions()).not.toContain("BUSINESS HOURS");
    expect(startCallRowMock.mock.calls[0]![2]).toMatchObject({ knowledgeVersion: 5 });
  });
  it("a call declined by the per-account cap reads no services and records no snapshot (the arrangement of route.test.ts:917-925)", async () => {
    countCallsSinceMock.mockResolvedValue(999);
    unwrapMock.mockResolvedValue(callIncomingEvent());
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, declined: "per-account" });
    expect(listVoiceServicesMock).not.toHaveBeenCalled();
    expect(ensureKnowledgeSnapshotMock).not.toHaveBeenCalled();
  });
});
```

  Mutation for the last case: start `servicesP` above step 8 (the caps) → FAILS.

  - Append to `…/turn/route.test.ts`:

```ts
describe("POST /api/concierge/[publicId]/turn — what Sofía knows (S-47c)", () => {
  const SNAP = {
    schema: 1, facts: "Snapshot facts.", services_text: "Snapshot services", timezone: "America/Chicago",
    business_hours: null, hours_lines: null, renderer_version: 1,
    services: [{ position: 1, name_en: "Tables", name_es: null, description_en: null, description_es: null, price_kind: "fixed",
      amount_cents: 9900, amount_max_cents: null, unit_en: null, unit_es: null,
      sentence_en: "The price for Tables is $99.", sentence_es: "El precio de Tables es $99." }],
  };
  it("turn 1 stamps the conversation with the version the RPC returned and builds the first prompt from that payload", async () => {
    dbFns.ensureKnowledgeSnapshot.mockResolvedValue(7);
    await firstTurn();
    expect(dbFns.createConciergeConversation.mock.calls[0]![1]).toMatchObject({ knowledgeVersion: 7 });
    expect(sentToModel().messages[0]!.content).toContain(PROFILE.facts);
  });
  it("a later turn builds from the STAMPED snapshot after the profile changed (C4; mutation: read the live profile -> FAILS)", async () => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, facts: "LIVE facts that changed." });
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: 3 });
    dbFns.getKnowledgeSnapshot.mockResolvedValue({ id: "k", account_id: "a1", version: 3, payload: SNAP, created_at: "x", created_by: "system" });
    await laterTurn();
    const system = sentToModel().messages[0]!.content;
    expect(dbFns.getKnowledgeSnapshot).toHaveBeenCalledWith(expect.anything(), "a1", 3);
    expect(system).toContain("Snapshot facts.");
    expect(system).not.toContain("LIVE facts that changed.");
    expect(system).toContain(`- Tables — English: "The price for Tables is $99." Spanish: "El precio de Tables es $99."`);
    expect(dbFns.listVoiceServices).not.toHaveBeenCalled();
    expect(dbFns.ensureKnowledgeSnapshot).not.toHaveBeenCalled();
  });
  it("an unstamped later turn reads the live profile and list, as today, and records nothing", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: null });
    await laterTurn();
    expect(dbFns.getKnowledgeSnapshot).not.toHaveBeenCalled();
    expect(dbFns.listVoiceServices).toHaveBeenCalledTimes(1);
    expect(dbFns.ensureKnowledgeSnapshot).not.toHaveBeenCalled();
  });
  it("a stamped snapshot read that THROWS answers 503 and spends no turn (SD12)", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: 3 });
    dbFns.getKnowledgeSnapshot.mockRejectedValue(new Error("getKnowledgeSnapshot failed: boom"));
    const res = await laterTurn();
    expect(res.status).toBe(503);
    expect(dbFns.claimConciergeTurn).not.toHaveBeenCalled();
  });
  it("a stamped snapshot that is missing or does not parse falls back to the live knowledge (SD12)", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: 3 });
    dbFns.getKnowledgeSnapshot.mockResolvedValue(null);
    await laterTurn();
    expect(sentToModel().messages[0]!.content).toContain(PROFILE.facts);
  });
  it("turn 1 with the RPC failing creates the conversation unstamped and still answers", async () => {
    dbFns.ensureKnowledgeSnapshot.mockRejectedValue(new Error("boom"));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect("knowledgeVersion" in (dbFns.createConciergeConversation.mock.calls[0]![1] as object)).toBe(false);
  });
});
```

  - Append to `…/websession/route.test.ts`: "the demo's prompt carries the live list and hours, records nothing and stamps nothing" (`listVoiceServicesMock` resolves one row → the instructions contain its English sentence; the module has no `ensureKnowledgeSnapshot` in its destructure: assert the factory's `ensureKnowledgeSnapshot` — add it as a spy — was never called); "a failed services read still mints the session, without the list" (status 200, no `SERVICES AND PRICES`).
- [ ] **Step 2:** Run the four route test files → the new cases FAIL; the existing ones go red only where an exact assertion now lacks the stamp (fix those by adding `knowledgeVersion: 5`, never by loosening to `objectContaining`).
- [ ] **Step 3: Implement.**
  - **Incoming route.** Just before step 9 (`:1042`):

```ts
    // S-47c (spec 5.5; plan SD9, SD18): the price list, read beside the account and calendar reads below so it adds
    // no wait of its own. Fail-soft: a failed read answers with the free text and the hours (both on the profile
    // read at step 7), no list, and records nothing.
    const servicesP = listVoiceServices(db, accountId).then(
      (rows) => rows,
      (e: unknown) => {
        log("knowledge: services read failed — answering without the price list", { callId, accountId, error: loggableError(e) });
        return null;
      },
    );
```

    After the two step-9 reads (`:1044`):

```ts
    // ONE payload: it is what ensure_knowledge_snapshot records AND what builds the prompt below, so the call's
    // stamp and its prompt cannot disagree (spec 5.5, C4). The snapshot RPC runs while step 9b's reads do (SD18).
    const knowledge = knowledgeFromLive({ profile, timezone: accountRow.timezone, services: await servicesP });
    const versionP: Promise<number | null> = knowledge.recordable
      ? ensureKnowledgeSnapshot(db, accountId, knowledge.payload).then(
        (v) => v,
        (e: unknown) => {
          log("knowledge: snapshot failed — the call answers unstamped", { callId, accountId, error: loggableError(e) });
          return null;
        })
      : Promise.resolve(null);
```

    Step 10: before the `try` (`:1102`), `const knowledgeVersion = await versionP;` (it never rejects); the `startCallRow` input gains `...(knowledgeVersion === null ? {} : { knowledgeVersion }),` after the trade-module spread. `promptInput` (`:1138-1147`): `const pk = promptKnowledge(knowledge.payload);` above it; `facts: pk.facts, services: pk.services,` in place of `facts: profile.facts, services: profile.services,`; and `businessHours: pk.businessHours, priceList: pk.priceList,` after `tradeModule`.
  - **Turn route.** Declare `let knowledge: KnowledgePayload;` beside `let conversation` (`:270`). Turn 1, after `ctx1` and before the trade stamp (`:358`):

```ts
      // S-47c (spec 5.5): the chat's knowledge is decided ONCE, here, and stamped on the conversation; every later
      // turn reads the stamped snapshot. Fail-soft and fail-open exactly as the phone (SD9).
      const servicesRows = await listVoiceServices(db, profile.account_id).catch((e: unknown) => {
        log("knowledge: services read failed", { accountId: profile.account_id, error: String(e) });
        return null;
      });
      const live = knowledgeFromLive({ profile, timezone, services: servicesRows });
      const knowledgeVersion = live.recordable
        ? await ensureKnowledgeSnapshot(db, profile.account_id, live.payload).catch((e: unknown) => {
          log("knowledge: snapshot failed — the chat starts unstamped", { accountId: profile.account_id, error: String(e) });
          return null;
        })
        : null;
      knowledge = live.payload;
```

    The `createConciergeConversation` input gains `...(knowledgeVersion === null ? {} : { knowledgeVersion }),`; the in-memory `conversation` literal (`:393-399`) gains `knowledge_version: knowledgeVersion,`. Turn 2+, after `ctx2` (`:424`), before the claim:

```ts
      // S-47c (C4, SD12, SD13): a stamped chat keeps its starting knowledge, its zone included. A read error is the
      // route's 503 (the catch below; no turn spent); a missing or unreadable snapshot falls back to the live read.
      const stamped = existing.knowledge_version === null ? null
        : await getKnowledgeSnapshot(db, profile.account_id, existing.knowledge_version);
      const parsed = stamped ? parseKnowledgePayload(stamped.payload) : null;
      if (parsed) {
        knowledge = parsed;
      } else {
        if (existing.knowledge_version !== null) {
          log("knowledge: stamped snapshot unreadable — this turn uses the live knowledge", { conversationId, version: existing.knowledge_version });
        }
        const rows = await listVoiceServices(db, profile.account_id).catch(() => null);
        knowledge = knowledgeFromLive({ profile, timezone, services: rows }).payload;
      }
```

    The prompt (`:440-468`): `const pk = promptKnowledge(knowledge);` above it; `facts: pk.facts, services: pk.services,` in place of the profile's; `timezone: knowledge.timezone,` in place of `timezone,` (SD13; on turn 1 and an unstamped turn the payload's zone IS the account's); `businessHours: pk.businessHours, priceList: pk.priceList,` after `tradeModule`.
  - **Web session route.** After the calendar read (`:174`): `const rows = await listVoiceServices(db, accountId).catch(() => null);` then `const pk = promptKnowledge(knowledgeFromLive({ profile, timezone: acct.timezone, services: rows }).payload);` and in `promptInput`: `facts: pk.facts, services: pk.services,` and `businessHours: pk.businessHours, priceList: pk.priceList,`. No RPC, no stamp (spec 5.5). Log the failed read like the phone (ids only).
- [ ] **Step 4:** Re-run the four files → PASS. Then, unchanged: `src/lib/concierge/*.test.ts`, `src/lib/voice/system-prompt.test.ts`, every source-scanning test (`grep -rln "readFileSync\|webSources\|code(" apps/web/src --include=*.test.ts`, run by path).
- [ ] **Step 5:** Run the named mutations (the second read for the prompt, `businessHours` dropped, ensure on a failed read, the live profile on a stamped turn, the payload's zone ignored), paste, revert, `cmp`.
- [ ] **Step 6:** Typecheck, eslint. Commit `voice: every call and website chat is stamped with the knowledge snapshot its prompt was built from, a chat keeps its starting knowledge, and the voice demo reads the live hours and prices (S-47c)` with the trailers, naming every path.

**Review (MEDIUM, sonnet, own worktree):** read the incoming route from step 7 to step 13 for any path where the stamp and the prompt could come from two payloads, or a second profile read; read the turn route for any path where a stamped chat's prompt reads the live profile; check the `versionP` promise can never reject unhandled (its handler is attached on creation); re-run the stamped-turn mutation.

---

## Task 7 (MEDIUM): The save path — validators, `saveKnowledgeParts`, the two new actions, the profile action (bis-voice)

**Dispatch gate:** Tasks 2, 3 and 5 committed.

**Files:**
- Create: `…/knowledge/validate.ts` (+ `validate.test.ts`), `…/knowledge/save.ts` (+ `save.test.ts`).
- Modify: `…/voice/actions.ts` (imports `:27-42`; `saveVoiceProfileAction` `:65-165`; two new exported actions after it) and `…/voice/actions.test.ts` (`dbMocks` at `:9-19` gains `saveVoiceKnowledge`, `listVoiceServices`, `getLatestKnowledgeVersion`, `readAccountTimezone`; three new describes).

**Interfaces:**
- Consumes: Task 2's keys; Task 3's `buildKnowledgePayload`, `PRICE_KINDS`, `HOURS_DAYS_MONDAY_FIRST`; Task 5's functions and types.
- Produces (Task 8 reads):

```ts
// …/knowledge/validate.ts — pure; client and server; relative imports and `import type` only
export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type HoursFormDay = { day: WeekdayKey; open: boolean; spans: { from: string; to: string }[] };
export type HoursError = { code: "blank" | "endBeforeStart" | "overlap"; day: WeekdayKey } | { code: "noDay" };
export function formFromHours(hours: OpenHours | null): HoursFormDay[];           // Monday first; "24:00" shown as "00:00" (SD11)
export function hoursFromForm(days: readonly HoursFormDay[]): { ok: true; hours: OpenHours } | { ok: false; error: HoursError };
export type ServiceForm = { name_en: string; name_es: string; description_en: string; description_es: string;
  price_kind: PriceKind | ""; amount: string; amount_max: string; unit_en: string; unit_es: string };
export type ServiceError = { code: "name" | "amount" | "range" | "units" | "tooLong" | "lineBreak" | "tooMany"; name: string };
export function parseDollars(raw: string): number | null;                         // "25" | "25.5" | "$1,200.50" -> cents
export function dollarsOf(cents: number | null): string;                           // 2500 -> "25", 2550 -> "25.50", null -> ""
export function formFromServices(rows: readonly VoiceServiceInput[]): ServiceForm[];
export function servicesFromForm(rows: readonly ServiceForm[], o: { insurance: boolean }):
  { ok: true; services: VoiceServiceInput[] } | { ok: false; error: ServiceError };
export function hoursErrorKey(e: HoursError): MessageKey;   // and serviceErrorKey(e: ServiceError): MessageKey
// …/knowledge/save.ts — server only
export type SaveOutcome = { ok: true; version: number } | { ok: false; reason: "stale" | "no_profile" | "invalid" | "failed" };
export async function saveKnowledgeParts(db: Db, accountId: string, actor: string, parts: KnowledgeParts): Promise<SaveOutcome>;
// …/voice/actions.ts
export async function saveBusinessHoursAction(accountId: string, formData: FormData): Promise<ActionResult>;
export async function saveServicesAction(accountId: string, formData: FormData): Promise<ActionResult>;
```

  Form fields: `locale` (`en`|`es`, anything else = `en`), and for hours `intent` (`save`|`clear`) and `days` (JSON `HoursFormDay[]`); for services `services` (JSON `ServiceForm[]`).

**Rules the code and tests pin:**
- `hoursFromForm`: a closed day is omitted (closed days are absent keys, SD17); an open day with no span, or a span with a blank side → `blank`; a closing `00:00` is `24:00` (SD11); a span whose end is not after its start → `endBeforeStart`; spans sorted by start, then a start before the previous end → `overlap` (touching spans are fine); no open day → `noDay`. The days are checked Monday first, so the FIRST error the operator sees is the earliest day's.
- `parseDollars`: trims, drops one leading `$` and thousands commas, accepts digits with at most two decimals, returns whole cents (`"25.5"` → 2550) or `null` for anything else, for 0, or above 100,000,000 cents (the CHECK's bound).
- `servicesFromForm`: more than 50 rows → `tooMany`; per row, trimmed: blank English name → `name`; a CR or LF in any field → `lineBreak` (an `<input>` cannot hold one; a hand-built POST can); a name over 80, a description over 300 or a unit over 30 → `tooLong`; blank optional fields become `null`. Kinds: `fixed`/`from` need an amount (`amount`); `range` needs both and the high above the low (`amount` / `range`); `per_unit` needs an amount and BOTH units (`units`, C16, naming the row); `free`/`after_visit` carry no amount and no unit whatever was typed. On an insurance account a row with no kind (`""`, a row added there) is saved as `after_visit` (C13); a row that came in carrying a stored kind and amounts is validated and saved exactly as sent ("sent back as it was stored").
- `saveKnowledgeParts(db, accountId, actor, parts)`: up to TWO attempts. Each reads, in parallel, `getVoiceProfile`, `listVoiceServices`, `readAccountTimezone`, `getLatestKnowledgeVersion`; no profile or no zone → `no_profile`; builds the payload from the stored state with `parts` laid over it (`facts` ← `parts.facts ?? profile.facts`, `servicesText` ← `parts.services_text ?? profile.services`, hours ← `"business_hours" in parts ? parts.business_hours : profile.business_hours`, services ← `parts.services ?? rows`); calls `saveVoiceKnowledge` with that payload and the read version as `baseVersion` (SD10). `ok` → `{ ok: true, version }`; `stale` → the second attempt (everything re-read); `stale` again → `stale`; `no_profile`/`invalid` → that reason; any throw → `failed` (logged with ids only).
- Each action: `requireAccountAccess`, `isAgency` or `voice.agencyOnly` (English, as every other action here); parse; validate (error → the mapped key in the form's locale through `makeTr`); `saveKnowledgeParts(serviceDb(), accountId, userId, <only its part>)`; map `stale` → `voice.knowledge.stale`, `no_profile` → `voice.knowledge.noProfile`, `invalid` → `voice.knowledge.invalid`, `failed` → the card's `saveFailed`; `revalidatePath` on success. The services action reads the profile's `trade_module` for the insurance rule (a failed read → `saveFailed`).
- `saveVoiceProfileAction`: the patch NO LONGER carries `facts` or `services`. When the profile exists and the submitted Facts or Services text differs from the stored value (SD14), `saveKnowledgeParts(…, { facts, services_text })` runs FIRST and a failure returns its mapped error with nothing else written; then `upsertVoiceProfile(patch)` as today. When there is no profile yet: `upsertVoiceProfile(patch)` creates it, then `saveKnowledgeParts` (spec 5.7: "the first save then records version 1"); a failure there returns `voice.profile.saveFailed` (the profile exists now; pressing Save again goes through the first path). Its messages stay English (the profile card is English, `…/voice/page.tsx:138-143`), except the stale message, which reads `voice.knowledge.stale` in English.

- [ ] **Step 1: Write the failing tests.**
  - `validate.test.ts`: every rule above as its own case with typed literals: the closing `00:00` → `24:00` round trip (`formFromHours(hoursFromForm(x).hours)` gives `x` back); each `HoursError` code with its day; Monday's error reported before Friday's; `parseDollars` on `"25"`, `"25.5"`, `"25.50"`, `"$1,200.50"`, `" 7 "` (accepted) and `"0"`, `"-5"`, `"25.505"`, `"abc"`, `"1000000.01"` (refused); `servicesFromForm` per kind accepted and refused, the C16 row (`units`, carrying the row's English name), the insurance `""` → `after_visit` row, an insurance row carrying a stored `per_unit` price returned unchanged, 51 rows → `tooMany`, a LF in a description → `lineBreak`. Mutation for each: weaken its rule → its case FAILS.
  - `save.test.ts` (bare `vi.mock("@bis/db", () => ({ getVoiceProfile, listVoiceServices, readAccountTimezone, getLatestKnowledgeVersion, saveVoiceKnowledge }))`): the payload sent is the stored state with ONLY the part laid over (hours part: `payload.facts` is the stored facts and `payload.services` the stored rows' sentences); `baseVersion` is the read version; stale then ok → two reads of everything, two RPC calls, `ok`; stale twice → `stale`; a throw → `failed`; no profile → `no_profile` with no RPC call. Second account: the reads are called with the action's own `accountId` and no other.
  - `actions.test.ts`, three describes:
    - `saveBusinessHoursAction`: a non-agency caller → `voice.agencyOnly`, no RPC; a valid week → `saveVoiceKnowledge` called with `parts` whose ONLY key is `business_hours`, equal to the canonical object; `intent=clear` → `parts` exactly `{ business_hours: null }`; an overlap → the Spanish error when `locale=es` (`"Martes: estas horas se cruzan."` built from the catalogue entry, not hard-coded), no RPC; stale twice → `m["voice.knowledge.stale"]`.
    - `saveServicesAction`: `parts` whose only key is `services`; the C16 row → `"Add the unit in English and in Spanish for Catering."`, no RPC; on an insurance profile a new row arrives as `after_visit` and a stored row's price is sent back unchanged.
    - `saveVoiceProfileAction — Facts and Services go through the snapshot (S-47c)`: changed Facts → `saveVoiceKnowledge` called with `parts` exactly `{ facts, services_text }` and BEFORE `upsertVoiceProfile` (compare `mock.invocationCallOrder`), and the `upsertVoiceProfile` patch has neither `facts` nor `services`; the RPC failing → `upsertVoiceProfile` never called; unchanged Facts and Services → no RPC (SD14); no profile yet → `upsertVoiceProfile` first, then the RPC. Update every existing case of this action whose patch assertion names `facts` or `services` (read `grep -n "facts\|services:" actions.test.ts`; at `d3c377aa` the profile fixtures at `:70`, `:212`, `:655`, `:669` carry `facts`).
- [ ] **Step 2:** Run the three files → FAIL.
- [ ] **Step 3: Implement** to the rules above. `save.ts` types its client as `ReturnType<typeof serviceDb>` from `import type { serviceDb } from "@bis/db"` and never names `serviceDb` as a value (the in-account service-reads scan, `in-account-service-reads.test.ts:43-62`, then does not list it; the actions file that calls `serviceDb()` is already listed at `:147`).
- [ ] **Step 4:** Re-run → PASS; then `…/voice/page.test.ts`, `…/voice/voice-settings.test.ts`, `…/accounts/[accountId]/in-account-service-reads.test.ts`, `…/accounts/[accountId]/never-log-actions.test.ts` → PASS.
- [ ] **Step 5:** Named mutations (each validator rule; the profile action calling the RPC after `upsertVoiceProfile`; the patch still carrying `facts`; `baseVersion` from the page instead of the read; no retry), paste, revert, `cmp`. Typecheck, eslint. Commit `voice: business hours and the price list save through one all-or-nothing snapshot, and the profile's Facts and Services do too; a refused save says why in the page's language (S-47c)` with the trailers, naming every path.

**Review (MEDIUM, sonnet, own worktree):** read `saveKnowledgeParts` for any path where the payload's other parts are not the stored ones, or where a stale retry could overwrite another card's part; read the profile action for a path that writes the profile before a failed snapshot; re-run the RPC-order mutation.

---
## Task 8 (LOW): The Voice page — the two cards and the two Facts flags (bis-frontend)

**Dispatch gate:** Task 7 committed.

**Brief.**
- **Files:** create `…/voice/business-hours-card.tsx`, `…/voice/services-prices-card.tsx`, `…/voice/facts-flags.tsx` (each `"use client"`, each with a `*.test.ts` render test in the shape of `voice-settings.test.ts`); modify `…/voice/voice-settings.tsx` (render `<FactsFlags>` under the Facts box, `:211-216`, and the two cards after the profile card, through new props), `…/voice/page.tsx` (reads and props), `…/voice/page.test.ts` (its bare factory, `:40`, gains `listVoiceServices`, `readAccountTimezone`, `getCalendarForAccount`; captured props asserted).
- **Reads in `page.tsx`** (same `serviceDb()` client; agency only; `page.tsx` is already listed `agency-only` in `in-account-service-reads.test.ts:148`): add to the existing `Promise.all` `readAccountTimezone(db, accountId)`, `listVoiceServices(db, accountId)` wrapped to `{ ok: true, rows } | { ok: false }` (a failed read is the Services card's ERROR state, never the page's), and `getCalendarForAccount(db, accountId)` wrapped to `null` on failure (cosmetic: it only feeds "Copy from calendar", the brand-name read's precedent at `page.tsx:102-109`). Hours come from `profile.business_hours`; insurance is `profile?.trade_module === "insurance_pc"`.
- **Copy** reaches the client cards as `locale` + `pseudo` props; each card builds `makeTr(locale, pseudo)` itself (`apps/web/src/lib/record/copy.ts:15-22`; `components/ai-acts/act-undo.tsx` does the same in a client component). Every string from Task 2's keys; `{persona}` from the page's `persona`. The cards set `lang={locale}` on their root.
- **Business hours card** (`id="business-hours"`; spec §5.7): title, body, "Times are in {zone}."; seven rows Monday first (`voice.hours.day.*`), each a `Checkbox` "Open" and, when open, its spans as two `Input type="time"` ("Opens"/"Closes") with a ghost remove button (`aria-label` "Remove these hours") and a ghost "Add hours"; the midnight hint under the grid (SD11). Time fields seed on pointerdown with `seedTimeOnPickerOpen` and `DEFAULT_OPEN_TIME`/`DEFAULT_CLOSE_TIME` (`…/calendar/hours-form.ts:21-22`, `:65-68`), never on focus. Ghost "Copy from calendar" fills the rows from `formFromHours(usableHours(calendarHours))` WITHOUT saving; disabled with `voice.hours.copyFromCalendarNone` as its described-by hint when the calendar has no open day. Live validation with `hoursFromForm` (the first error under the grid, `role="alert"`). ONE primary, "Save hours" (`SubmitButton`), through `useFormSubmit` + `notifyActionResult` (toast `voice.hours.saved`), posting `locale`, `intent=save`, `days` (JSON). Ghost "Clear hours" posts `intent=clear` at once and its success toast (`voice.hours.cleared`) carries `common.undo`, which re-posts the hours the card held before (SD15). **Empty state** (no stored hours and the form not yet opened): `EmptyState` with `voice.hours.empty`, ghost "Copy from calendar" and "Set hours" (opens the grid with Monday to Friday open 08:00–18:00 as a starting point, unsaved).
- **Services & prices card** (`id="services-prices"`): title (`voice.services.titleInsurance` on insurance), body (not on insurance), and on insurance the `Notice tone="warn"` `voice.services.insuranceNotice` (C13). An ordered list; each row shows the name, the kind label and the amount summary (`formatUsd`; `summary.range`/`summary.perUnit`), with ghost Move up / Move down / Edit / Remove. Edit opens the row inline: English name, Spanish name, kind `Select` (`PRICE_KINDS`, labels `voice.services.kind.*`), only the amount fields the kind needs, the two units for `per_unit`, both descriptions, and a live preview of BOTH sentences from `priceSentence` (the function the prompt uses) under `voice.services.previewEn`/`previewEs`, shown only when the row is complete (never call `priceSentence` on an incomplete row; it throws). "Done" closes the row. Remove is STAGED: the row stays, dimmed, reading "Removed when you save" with a ghost "Keep", and is left out of the posted list (spec §5.7: nothing is destroyed before Save). Ghost "Add a service" (disabled at 50 with `voice.services.max`). ONE primary, "Save services", posting `locale` and `services` (JSON of `ServiceForm[]` from `formFromServices`/state), toast `voice.services.saved`; a refused save keeps every edit (`useFormSubmit`) and shows the action's sentence. **On insurance (C13):** no kind `Select`, no amount or unit field, no preview, no amount in the row summary; a row added there posts `price_kind: ""` (the action saves `after_visit`); a stored row posts back exactly the kind and amounts it was loaded with. **Empty state:** `EmptyState` with `voice.services.empty` and "Add a service". **Error state** (the read failed): a `Notice tone="crit"` with `voice.services.loadFailed` and no form.
- **Facts flags** (`facts-flags.tsx`, rendered under the Facts box, recomputed live from the textarea's value with `factsWarnings`; never block Save; spec §5.3): `hours === "notice"` → `Notice tone="warn"` `voice.facts.hoursNotice`; `"hint"` → a muted `<p>` `voice.facts.hoursHint`; amounts → `Notice tone="warn"` `voice.facts.amountsNotice` with `{amounts}` = each match's text in straight double quotes, joined by ", ". `hasHours`/`hasPriceList` are the STORED state (props). The Facts and Services textareas need a client value to watch: lift each to a controlled `value`/`onChange` pair inside `VoiceProfileForm` (the form still posts `name="facts"`/`name="services"`).
- **Rules:** existing components only (no styleguide change, C8); tokens only; one primary per card (rule 8: three cards, three primaries, none on the page); ghost for everything else; `useFormSubmit` everywhere; no JSX literal copy; `voice-settings.tsx` never imports `@/lib/voice/modules` or `…/knowledge/save.ts` (`grep -nE "from ['\"]@/lib/voice/(modules|knowledge/save)" …/voice/*.tsx` → nothing); the cards may import `…/knowledge/{price-sentence,hours,payload,validate,facts-warnings}.ts` (pure).
- **Tests** (render tests; typed literals from `m[...]`): each card's loaded, empty and error states; exactly ONE `data-variant="default"` button per card; the hours card's Copy button disabled with its hint when the calendar has no hours, and a click fills rows without calling the action; a stored `"24:00"` close renders `00:00` (A7); the services card's preview shows `"The price for Catering is $35 per guest."` and `"El precio de Banquete es $35 por invitado."` for a complete per_unit row and no preview for an incomplete one; **insurance (spec §7, C13):** no kind `Select`, no amount/unit input, no sentence and no `$` in the card's markup for a stored fixed row, the Notice present, a new row posts `price_kind: ""`, the stored row posts back its kind and amounts unchanged (read the posted JSON from the captured action call); the flags: the amounts Notice lists `"$500 deposit to hold the date", "$35 per guest"` for that Facts text with a price list, nothing without one; `lang="es"` on each card's root for `locale: "es"`. `page.test.ts`: the captured props carry the zone, the calendar hours, the services rows, `insurance`, and a failed services read gives the error state while the page still renders.
- **Verify:** the four test files + `voice-settings.test.ts` + `page.test.ts` + `src/components/ui/material.test.ts` + `src/lib/i18n/ratchet.test.ts` + `…/accounts/[accountId]/in-account-service-reads.test.ts` by path; typecheck; eslint. Commit `ui: the Voice page's Business hours and Services & prices cards, each with its own Save, and the Facts flags for hours and amounts (S-47c)` naming every path.

---

## Task 9 (LOW): "What Sofía knew", the call-page link, the palette, the baselines (bis-frontend)

**Dispatch gate:** Task 8 committed (this task regenerates the i18n baselines once, last).

**Brief.**
- **The knowledge page** `…/voice/knowledge/[version]/page.tsx` (server component; `requireAgencyOnlyAccountAccess`, as the Voice page, `page.tsx:71`; a sub-page of the agency-only Voice section, not a new top-level surface; spec §5.8): `version` must match `/^[1-9][0-9]{0,8}$/`, else the not-found state. Reads through `serviceDb()`: `getKnowledgeSnapshot(db, accountId, N)`, `getLatestKnowledgeVersion(db, accountId)` (for "Newer"), `getVoiceProfile` (persona), and, when `created_by` is not `system`, `listPeopleNames(db, [created_by])` (`packages/db/src/record.ts:539`; an unknown id reads `assign.someone`, "Someone on the team", the provenance rule). `parseKnowledgePayload` the payload; null → the error state. Locale from `requestLocale({ account: null, isOperator: true, userLanguage }, { locale })` as the Voice page (`page.tsx:144-145`). Render: `PageHeader` `voice.knowledge.title`; the line `voice.knowledge.savedBy` (date in the payload's zone, `Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone })`) or `voice.knowledge.recordedAutomatically`; sections Facts, Services (free text), Business hours (the stored `hours_lines`, or `noHours`), Services and prices (each service: name, then "In English: …" and "In Spanish: …" with its two stored sentences, or `noPrices`); an empty text field reads `voice.knowledge.nothing`. Older (`N-1`, absent at 1) and Newer (`N+1`, absent at the latest) as ghost links (versions are contiguous per account: both RPCs append `latest + 1` under the account lock). A "Back to Voice" link. **States:** not found (`voice.knowledge.notFound`, in-page, with the back link), error (`voice.knowledge.loadFailed` when a read throws), loaded. Add the file to `in-account-service-reads.test.ts`'s list as `"agency-only"` (beside `:147-148`).
- **The call-page link** (`…/call/page.tsx`, before `</dl>` at `:303`; spec §5.8): agency only and only when `call.knowledge_version !== null`, exactly the trade-rules item's rule and markup (`:287-302`): a visible `<dt>` `calls.detail.knowledge` and a `<dd data-knowledge="">` holding a `Link` to `/dashboard/accounts/${accountId}/voice/knowledge/${call.knowledge_version}` with the text `calls.detail.knowledgeLink` (`{ persona: personaName, version }`; `personaName` is already resolved at `:162-172`). The page is shared with clients (S-47b SD3): a client never sees it.
- **Palette:** `apps/web/src/lib/palette/registry.ts:73`'s `"/voice"` list gains `"hours", "prices", "services", "horario", "precios"` (spec §5.7); one case in `registry.test.ts` beside `:164-171` asserting all five (mutation: drop one → FAILS).
- **Baselines:** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`. Read the diff line by line: it may only REMOVE entries or leave both files unchanged (every new key is twinned and no JSX literal copy was added). An added entry is a finding: fix the copy, never the baseline.
- **Tests:** the knowledge page (agency renders a saved version with its person and both sentences; `system` reads "recorded automatically"; version 1 has no Older, the latest has no Newer; a bad or missing version is the not-found state; a throwing read is the error state; a client is redirected by the guard; Spanish with `?locale=es`); the call page (agency + stamped → the link with exactly `What Sofía knew (#3)` and the right `href`; agency + unstamped → no `data-knowledge`; client + stamped → no `data-knowledge` and no "Knowledge" text; mutation: drop `isAgency &&` → FAILS). Run those, `registry.test.ts`, `in-account-service-reads.test.ts`, `src/lib/i18n/{ratchet,request-locale-callers}.test.ts` by path; typecheck; eslint. Commit `ui: the agency sees what Sofía knew on each call, version by version, and the palette finds hours and prices (S-47c)` naming every path.

---

## Task 10 (LOW): The e2e spec (bis-e2e-qa)

**Brief.** Create `apps/web/e2e/structured-facts.spec.ts` (spec §7 e2e). Fixture account only (`e2e/.auth/client-fixture.json`, read as `trade-modules.spec.ts:50-58` does; skip with a reason when absent); never `Test Client One`. `test.describe.configure({ mode: "serial", timeout: 60_000 })`; default (agency) storage state.
- **`beforeAll` (service client):** capture the fixture's voice profile (`getVoiceProfile`; null IS a captured state), its calendar (`getOrCreateCalendar` then its `open_hours`), its price list (`listVoiceServices`) and its latest version. Ensure a profile exists (`upsertVoiceProfile` with `persona_name: "Sofía"`, `languages: "en"`, `enabled: false`; never `business_hours`, which it refuses). Set the calendar's hours to Monday–Friday 09:00–17:00 (`updateCalendarSettings`) so Copy from calendar has something to copy.
- **Tests:**
  1. **Business hours: Copy from calendar, save, reload, see the rows.** `/dashboard/accounts/<id>/voice`; inside `#business-hours`, click "Copy from calendar" (exact `m[...]` name), see Monday's two fields read 09:00 / 17:00, click "Save hours", see `m["voice.hours.saved"]`; `expect.poll(() => getVoiceProfile(db, id).then((p) => p?.business_hours))` → `{ mon: [["09:00","17:00"]], …, fri: […] }`; reload → the same rows; `getLatestKnowledgeVersion` rose by one.
  2. **Services: add a per_unit row, see both preview sentences, save, reload, see it.** Inside `#services-prices`: "Add a service"; English name `Catering`, Spanish name `Banquete`, kind "Price per unit", price `35`, units `guest` / `invitado`; the preview shows exactly `The price for Catering is $35 per guest.` and `El precio de Banquete es $35 por invitado.`; "Save services"; toast; poll `listVoiceServices` → one row, `per_unit`, 3500, `guest`, `invitado`; reload → the row reads `Catering`.
  3. **Clear both.** "Clear hours" → toast `voice.hours.cleared`; poll → `business_hours` null. Remove the row → it reads "Removed when you save"; "Save services" → poll → `[]`.
- **`afterAll`:** restore through the REAL writer, never a table write (`service_role` has no write on `voice_services`, and snapshots are never removed): `saveVoiceKnowledge` with `parts: { business_hours: <captured or null>, services: <captured rows> }`, a payload from `buildKnowledgePayload` (import from `../src/lib/voice/knowledge/payload`), `baseVersion` from `getLatestKnowledgeVersion`, retried once on `stale`; restore the calendar's `open_hours`; delete the profile row if there was none before (the e2e precedent, `trade-modules.spec.ts:135`). Check every `error`/status, re-read and assert restored, collect problems and throw at the end (`ai-disclosure.spec.ts:146-202` shape). The snapshots this file appends stay on the per-run fixture account and leave with it at `auth.teardown`.
- **Verify:** `pnpm --filter web exec playwright test --list e2e/structured-facts.spec.ts` (3 tests listed; source `.env.local` into the shell only); typecheck; eslint. Commit `e2e: the agency copies hours from the calendar, adds a per-guest price and sees both sentences, saves, reloads, and clears both (S-47c)`.

---

## Task 11: Final review, design review, one fix agent (checkpoint)

- [ ] **bis-reviewer, opus, fresh context**, on `git diff d3c377aa...HEAD`, in its own detached worktree, with replica 55441/55442/55443.
  - Read spec §§4–9 and this plan (SDs, OQ1's answer).
  - Run every touched test file by path, both typechecks, and on `post`: `structured-facts-schema`, `structured-facts-lock`, `voice-knowledge`, `voice`, `concierge`, `voice-schema`, `webchat`, `schema-grants-guard`, `proposals-drop`, `server-only-writes-grants`, `concierge-grants`.
  - Re-check 0095's md5 against Task 1's.
  - Three probes of its own: a byte-identity probe (a stray space on the no-hours path); a stamp/prompt split (the incoming route building the prompt from a second `knowledgeFromLive`); a C14 probe (the closed TOOLS line kept when open).
  - **Hunt:** a no-hours, no-list prompt that differs by one byte; a stamp that disagrees with the prompt's payload; a later chat turn reading the live profile; a price said in any wording but the sentence (a template drift between `price-sentence.ts` and spec §5.1); an amount reaching an insurance prompt; a prompt that both forbids and permits a transfer (OQ1, SD5); a Spanish sentence with a wrong accent; a write path to the new tables other than the two RPCs; a client role that can read Staff-hidden rows; a card with two primaries; a refused save that loses the operator's edits; a vacuous test (a guard a comment satisfies; a loop that never ran; an assertion built by the function under test).
- [ ] **bis-design-reviewer, opus**, on Tasks 8–9's diff, with a running build if the orchestrator provides one (source audit otherwise):
  - tokens only; both themes via `.dark`; the blur fallback (nothing new blurs; cards never blur);
  - rule 8 (three cards, three primaries); rule 5 (each card's loaded/empty/error; the knowledge page's three states); rule 6 (Clear hours' Undo; staged removal);
  - the hours grid and the services row editor at 360 px in pseudo-locale (the longest strings: the amounts Notice and `voice.services.error.tooLong`);
  - keyboard: the time fields and the per-row buttons in order, the focus ring visible, the Select's Esc;
  - the call page's Knowledge `<dt>`/`<dd>` beside the trade-rules item at 360 px;
  - the 7 AM read of every new string in both languages (SD20's "in Facts or Services").
- [ ] **ONE fix agent** takes both reports' Critical, Important and agreed Minor items. A sonnet fix-review only if the fix touched high-tier code (0095 or its tests); otherwise the orchestrator reads the fix diff and re-runs the touched tests by path.
  - **0095 goes to bis-ci and production only with its reviewed md5 UNCHANGED.** Once 0095 is on bis-ci it is never edited: a SQL change found after that is a new migration (0096), reviewed HIGH.
  - Any change to a price-sentence template or an hours line after Task 3 bumps `KNOWLEDGE_RENDERER_VERSION` only if a snapshot has already been recorded somewhere real (bis-ci or production); before that, the version stays 1 and the commit says so.

---

## Task 12: Rollout (orchestrator; spec §8)

Each step reads its own evidence. Nothing is inferred from an earlier run.

- [ ] **1. bis-ci 0095** (after Task 1's review approves).
  - `gh workflow run ci-project-setup.yml --ref feat/s47c-facts -f step=push-dry-run`. Its log lists exactly `0095_structured_facts.sql`. Then `-f step=push`.
  - Read-only post-checks on bis-ci (MCP `execute_sql`, `odnobiodsftffphuuosz`): the three added columns' `data_type`/`is_nullable`/`column_default`; every def from Task 1's pinned map (its query, `contype <> 'n'`; 30 rows), equal; `select count(*) from public.voice_services` → `0`; `select count(*) from public.voice_knowledge_snapshots` → `0`; both functions exist with `has_function_privilege('authenticated', …, 'EXECUTE')` false; the client-write digest UNCHANGED.
  - If a Preview read of a voice profile then fails naming `business_hours`, PostgREST's schema cache is stale: `notify pgrst, 'reload schema'` once on bis-ci, then re-read.
  - Ledger: `0095 APPLIED to bis-ci … NEVER RE-APPLY`.
- [ ] **2. Push and CI.** Read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). `structured-facts.spec.ts` must have RUN (not skipped): read its lines in `gh run view --log`. Read every red check before calling it expected (memory "CI vs local divergence").
- [ ] **3. Preview by hand** (bis-ci, a test account, never Test Client One): both cards in both themes, English and `?locale=es`, at 360 px; one save of each card and one Clear with its Undo; the Facts flags while typing; an insurance account's Services card (no prices); a knowledge page and the call-page link as agency on a seeded stamped call. If Task 0's latency read used the fallback, time ten web-demo session mints here (before/after), and record them.
- [ ] **4. Production 0095**, BEFORE the merge: MCP `apply_migration`, project `tlbkbmlrfafquucsmsmm`, name `structured_facts`, the exact reviewed text, ONCE.
  - Pre-flight: `max(version)` equals Task 0's.
  - Post: the same reads as step 1, and `select md5(array_to_string(statements, '')) from supabase_migrations.schema_migrations where name = 'structured_facts'` equals the file's md5 (the file has no backslash, so memory "MCP SQL escapes" does not bite).
  - Ledger: `0095 APPLIED to production … NEVER RE-APPLY`.
- [ ] **5. Parity.** Runbook §5 (`docs/runbooks/ci-supabase-project.md:184-207`): `-f step=fingerprint` on bis-ci and `packages/db/supabase/parity/fingerprint.sql` on production; equal on every 0095 object (columns, constraints, policies, the trigger, the four functions, grants).
- [ ] **6. PR and merge.**
  - `gh pr create`. The body names: C1–C18 (owner-approved) and SD1–SD21 with their resolutions; OQ1's answer; both apply lines; the tiers; "LOAD-BEARING: PROFILE_COLS (every profile read: calls, chat turns, the chat page, the Voice page, every profile save), CALL_DETAIL_COLS, CONVO_COLS (chat turns, the web chat sync), the startCallRow and createConciergeConversation stamps, listVoiceServices, getKnowledgeSnapshot, and the two RPCs (call and chat start; every Voice page knowledge save, the profile card's Facts and Services included)"; "No env var changes; nothing added to Preview"; "Merging changes no prompt by itself: an account's prompt changes only once the agency saves hours or a list for it. From the first call after deploy every call carries a knowledge version (spec 5.6, C15)".
  - Only after step 4: `gh pr merge <n> --auto --squash --match-head-commit <sha>`, with the head SHA's `verify` and `e2e` green.
- [ ] **7. After the deploy** (READY on the merge SHA, aliased to `app.bis-rgv.com`):
  - Smokes: `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404.
  - As the agency: BIS's Voice page loads with both cards in their empty states (PROFILE_COLS and the list read on production); BIS's newest call page loads (CALL_DETAIL_COLS).
  - A test call on the fixture line, or the browser voice demo, on an account with hours and a list (spec §8 step 3): the call row's `knowledge_version` is set (`select knowledge_version from public.calls where account_id = '<id>' order by started_at desc limit 1`), the call page shows the link, the knowledge page renders. The browser voice demo stamps nothing (spec §5.5); use it only for the say/never-say read.
  - Read-only: `select count(*) from public.voice_knowledge_snapshots where created_by = 'system'` grows with real calls only (C15); `select count(*) from public.voice_profiles where business_hours is not null` → `0` until the agency saves one.
- [ ] **8. Tracker and ledger** (memory "Roadmap tracker"): F-037 part 1 → done (spec §8 step 3); the S-47 subproject row: part c done; bump `meta/plan` asOf and mainSha, with `if_version`. Ledger `s47c MERGED`.

---

## Notes for the owner (no decision reopened)

- **Every account gets snapshot #1 on its first call after deploy** (C15): a `system` row whose payload is its current free text. Nothing in any prompt changes until the agency saves hours or a list.
- **A closed business, by setting** (C14 as implemented): under "Follow business hours", closed now, Sofía offers a message instead of a transfer and puts a caller through only when they ask (or, with a trade module, on its urgent path). Under "Always take a message", see OQ1.
- **The amounts flag** lists what it finds in Facts AND Services (SD20). It is a regex, so it can miss an amount written in words ("forty dollars") and can flag a non-price that looks like one; it never blocks a save.
- **Midnight** is entered as a 12:00 AM closing time (SD11).

## Spec coverage

| Spec | Where |
|---|---|
| §1 Why (hours, prices, no record) | Tasks 1–9 as a whole |
| §2 C1 hours as their own record; Copy from calendar; after-hours uses them; Facts hours flagged | Task 1 (column), Task 4 (prompt, after hours), Task 8 (card, Copy, flag), Task 3 (`factsWarnings`) |
| §2 C2 six price kinds; one fixed sentence per language; no arithmetic | Task 1 (shape CHECK), Task 3 (`priceSentence`), Task 4 (`LIST_PRICE_LINE`) |
| §2 C3 the list is the only source of prices; Facts amounts flagged; byte-identical with no list and no hours | Task 4 (digests, the HARD LIMITS swap), Task 3/8 (flag) |
| §2 C4 numbered immutable snapshots; stamps; a chat keeps its snapshot; the call-page link | Task 1, Task 5, Task 6, Task 9 |
| §2 C5 open-now computed in code, one line; the after-hours rule keys on it | Task 3 (`openNow`), Task 4 |
| §2 C6 the SERVICES AND PRICES block and the changed price line; modules unchanged | Task 4 |
| §2 C7 placeholder sanitizer and S-47b untouched | "Not touched"; Task 4 step 5 (module tests unchanged) |
| §2 C8 two cards, own Saves, existing components, both languages | Tasks 2, 8 |
| §2 C9 snapshot in the save's transaction, definer RPC, service_role only | Task 1 (SD1), Task 7 |
| §2 C10 tiers and rollout | Tiers table; Task 12 |
| §2 C11 amounts as rows; the flag lists each amount | Task 3 (`factsWarnings`), Task 8 (Notice), Task 2 (copy) |
| §2 C12 no module change; events pointed at the list by the base prompt | Task 4 (`LIST_PRICE_LINE`'s last sentence; events test); "Not touched" |
| §2 C13 insurance shows no amounts; names only in the prompt; fields hidden | Task 4 (names-only block, SD8), Task 7 (`after_visit`), Task 8 |
| §2 C14 closed = a message unless asked or urgent | Task 4 (closed offers, TOOLS line, SD5); OQ1 |
| §2 C15 automatic snapshots | Task 1 (`ensure`), Task 6, Task 9 ("recorded automatically") |
| §2 C16 per_unit needs both units | Task 1 (CHECK + mutation 2), Task 3 (throws), Task 7 (the named error) |
| §2 C17 hours readable by every member | Task 1 (Staff read case) |
| §2 C18 the twelve sentences | "The twelve price sentences"; Task 3 (`SPEC_TABLE` + twelve literals) |
| §3 Scope in/out | File map; "Not touched" |
| §4 data, grants, policies, comments, rollback | Task 1 (SD2, SD4) |
| §4.1 the two RPCs | Task 1 |
| §4.2 the payload | Task 3 (`buildKnowledgePayload`, `parseKnowledgePayload`) |
| §4.3 load-bearing sites | Task 5; SD3; Task 12 steps 4, 6 |
| §5.1 renderers | Task 3 |
| §5.2 the prompt (blocks, HARD LIMITS line, after hours) | Task 4 (SD5–SD8, SD17) |
| §5.2.1 closed now and the offer of a person | Task 4; OQ1 |
| §5.3 Facts flags | Task 3, Task 8 (SD20) |
| §5.4 trade modules | Task 4 (insurance, events cases) |
| §5.5 where each surface reads its knowledge; the latency read | Task 6 (SD9, SD12, SD13, SD18); Task 0 |
| §5.6 automatic snapshots | Task 1, Task 6 |
| §5.7 the Voice page (cards, insurance, staged removal, the profile's Facts and Services through the RPC, `upsertVoiceProfile` refusing `business_hours`, palette) | Task 7, Task 8, Task 5, Task 9 (SD10, SD11, SD14, SD15) |
| §5.8 the call page and "What Sofía knew" | Task 9 |
| §6 copy, two changed keys, baselines | Task 2, Task 9 |
| §7 tests (renderers, digests, prompt, flags, insurance UI, db, routes, actions, e2e) | Tasks 1, 3, 4, 5, 6, 7, 8, 10 |
| §8 rollout | Task 12 |
| §9 tiers | Tiers table |
| §10 no open questions | OQ1 is a contradiction inside the spec's own text (§5.2.1 points 2 and 5), not a reopened decision |
