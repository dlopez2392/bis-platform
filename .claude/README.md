# BIS Platform — subagent architecture

Project-level agents live in `.claude/agents/`. They are committed (unlike
`.superpowers/`, which is gitignored), so they are also where a domain's hard
lessons are kept between sessions. Invoke one by name in a prompt
(`@bis-voice …`), through the Agent tool (`subagent_type: "bis-voice"`), or let
the orchestrator pick from the `description` lines. `/agents` lists them.

## The split

Domains follow the product's own seams (the nav groups, the provider factories,
the `packages/db` modules) so that two agents working at once touch disjoint
files. There is no Cal.com in this repo: scheduling is built in-house, with
Daily.co for video links.

| Agent | Model | Owns | Never |
|---|---|---|---|
| `bis-db-schema` | opus | migrations, RLS, grants, the two clients, test harnesses, generated-column twins | applies a migration |
| `bis-voice` | opus | Telnyx TeXML + OpenAI Realtime SIP, call lifecycle, tools, text-back, Calls/Voice UI, phone setup steps, `voice.ts`, voice runbook | places a call, touches a vendor dashboard |
| `bis-comms` | sonnet | Resend + Telnyx SMS providers and guards, templates and shell, webhooks, Conversations, sending identity, A2P, `messaging.ts` | sends to a real address outside production |
| `bis-booking` | opus | slot engine (zones, DST), `/b/[publicId]`, Calendar, Daily.co, reminder/follow-up windows, `booking.ts` | runs Playwright |
| `bis-automations` | sonnet | cron harness, every pass, weekly reports, website traffic, `automations.ts`/`weekly-report.ts`/`sites.ts` | adds a second scheduler |
| `bis-crm` | sonnet | contacts, import/export, dedupe flags, pipeline, forms + `/f/[publicId]`, search, blueprints, checklist | mutates Test Client One |
| `bis-frontend` | sonnet | tokens, shadcn components, theming engine, shell, dashboard, Branding, setup wizard shell, styleguide, copy catalogue | hard-codes a color |
| `bis-platform` | opus | Clerk auth/tenancy, middleware, CI, hooks, Vercel config, env contract, tooling, runbooks, deploy verification | pushes to main |
| `bis-reviewer` | opus | two-stage review (spec, then quality) with empirical proof | edits or commits |
| `bis-design-reviewer` | sonnet | DESIGN.md definition-of-done audit, measured on a running build | starts a build |
| `bis-e2e-qa` | sonnet | Playwright suite, fixture discipline, the three gates, CI diagnosis | runs two gates at once |

Why these models: opus goes where a mistake is irreversible or silent
(production migrations and RLS, real phone calls, time-zone math, the auth
boundary) and where this repo's own history shows the stronger review finding
the critical defects. Sonnet goes where the patterns are well trodden and the
test suites are dense enough to catch a slip (templates, passes, list UI,
tokens). Any agent can be re-run on opus for one task by passing `model` at
dispatch; the file's tier is the default, not a ceiling. `inherit` is an
option when the parent session is on a stronger model than opus.

## What the orchestrator (the main session) is responsible for

The orchestrator is the controller from `.superpowers/sdd/progress.md`. It does
not write feature code. It:

1. **Turns a plan into briefs**, one task each, with every signature read from
   source (not from the plan), the files to touch, the interfaces consumed and
   produced, numbered steps, and the expected red evidence. The brief names
   its owner agent and lists anything outside that agent's ownership as "ask
   the orchestrator", so the agent stops instead of reaching across.
2. **Owns everything irreversible or shared**: applying migrations (Supabase
   MCP `apply_migration` against `tlbkbmlrfafquucsmsmm`, after a pre-flight
   READ that matches `schema_migrations.name` and the concrete objects, then a
   post-apply verification, then an "APPLIED — NEVER RE-APPLY" ledger line);
   opening and merging PRs (both `verify` and `e2e` green on the CURRENT HEAD,
   read from check runs via REST); pushing branches; the fixture sweep; and any
   env or Vercel change, which it writes as a runbook step for danlo.
3. **Sequences the work.** Schema first (`bis-db-schema`, apply, then the
   domain agent builds on the applied schema). Then domain tasks, in parallel
   when their ownership sets are disjoint. Then `bis-reviewer` and, for UI,
   `bis-design-reviewer` in parallel on the same range. Fix waves go back to
   the same implementer with the review attached. Then `bis-e2e-qa` runs the
   gates one at a time. Then the PR.
4. **Assigns the hot shared files per wave** (`packages/db/src/index.ts`,
   `lib/messages.ts`, the registries, `.env.example`, `vercel.json`,
   `DESIGN.md`): additive edits only, and when two agents in one wave both
   need the same one, the orchestrator makes the edit itself after the wave.
5. **Decides commit policy per wave.** Serial task: the implementer commits
   with path-scoped `git add`. Parallel wave in one working tree: implementers
   do not commit; the orchestrator commits per domain with explicit paths
   after reading the reports. Worktree mode (`isolation: "worktree"` at
   dispatch) is for work that must build independently; it needs
   `apps/web/.env.local` and `packages/db/.env` copied in (both are gitignored)
   and a `pnpm install`, and gates in worktrees still run one at a time.
6. **Reads reports skeptically.** Plan code is not evidence; a claimed green
   without the summary line is not a claim; when a fix is verified and still
   wrong, ask whether the check measured the thing changed or the thing
   wanted. Deviations are checked against the source the implementer cited.
7. **Keeps the ledger** (`.superpowers/sdd/progress.md`): task state, commits,
   what was applied, decisions danlo made, minors deferred to the final
   whole-branch review, and what danlo still owes (env vars, dashboard
   settings, a real test call).
8. **Curates lessons into the agent files.** A lesson learned in a task goes
   into the `Facts you build on` section of the agent that owns that domain,
   in the same commit or the next, because `.superpowers/` does not survive a
   clone and the agent files do.
9. **Never delegates**: merging, applying, pushing, `Test Client One`
   mutations, real sends or calls, or the decision to loosen a test.

## Brief shape (what an agent receives)

```
### Task N: <title>
Owner: bis-<agent>            Model override: (none | opus)
Branch: <name> off main <sha>  Commit: yes | no (orchestrator commits)

**Files:** create / modify / test (paths)
**Interfaces:** consumes (signatures quoted from source, file:line) / produces
**Outside your ownership (ask, do not touch):** …

- [ ] Step 1: pre-flight read / failing test (expected red: `<assertion>`)
- [ ] Step 2: implement
- [ ] Step 3: run <exact command>; expected: <summary line>
- [ ] Step 4: mutation check: <what to change>, expected to fail by name: <test>
```

The agent answers in the report format at the bottom of every implementer
file. The orchestrator files the report and the review, then updates the
ledger.
