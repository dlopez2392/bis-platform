# Migration pipeline: timestamped files, bis-ci applied by CI, production behind one click

Tier: **HIGH** (migrations, CI secrets, the production database). Plan only; nothing here is built yet.
Source: Platform Review row "Migration pipeline" (owner adopted, "fix now"). Owner decision, 2026-11-13:
"GitHub applies a PR's migration to bis-ci automatically and runs the comparison. Production still waits
for one approval click from you on each migration."
**Done when:** two schema PRs merge on the same day with no hold (no number collision, no merge order,
no hand apply), and the app never deploys before the schema it needs.

## 0. Today (read before changing anything)

- Numbered files `0001`..`0116` (`packages/db/supabase/migrations/`); two branches that both pick the
  next number collide, so schema work queues.
- Order of work, by hand: bis-ci first (`ci-project-setup.yml` dispatch `push-dry-run` then `push`),
  post-apply reads, green CI, production by the MCP `apply_migration`, parity by hand, ledger, merge
  (`docs/runbooks/ci-supabase-project.md:209-228`; `CLAUDE.md:59-73`). Append-only: a changed migration
  is a new migration (`ci-supabase-project.md:230-234`).
- `ci-project-setup.yml:17` is MANUAL ONLY ("no push trigger and there must never be one");
  `db:push:ci` refuses `--include-all` by design (`packages/db/src/ci/push.ts:10-12,43-46`).
- The only CI-enforced part is `e2e-migrations` (`.github/workflows/ci.yml:393-414`), inside the required
  `e2e` gate (`ci.yml:654-665`): `ci-migrations-applied.sh` matches each file's numeric prefix against
  bis-ci's `schema_migrations.version` (`.github/scripts/ci-migrations-applied.sh:104-118`), in one
  read-only transaction (`:91-92`). Production and parity are not checked by anything (`CLAUDE.md:65`).
- History differs per project: bis-ci (CLI push) records `version=0115, name=owner_line`; production (MCP)
  records `version=<apply timestamp>, name=0115_owner_line` (`packages/db/supabase/parity/migration-history.sql:8-18`;
  `.claude/agents/bis-db-schema.md:29`, "pre-flight matches on name, not version").
- Ordering by file name: the types generator sorts names (`packages/db/src/types-gen/plan.ts:168-174`);
  the job stacks run `supabase db push --local` (`.github/scripts/ci-local-supabase.sh:318`).
- Parity is `fingerprint.sql` / `fingerprint-detail.sql` on both projects, diffed by a person, with four
  allowed differences (`packages/db/supabase/parity/fingerprint.sql:15-23`; runbook section 5).
- CI triggers on `push` only (`ci.yml:105-107`), cancels a branch's older run (`ci.yml:138-140`), holds no
  production credential (`ci.yml:34-37`; pinned by `apps/web/ci/ci-workflow.test.ts:243-251`), and reads
  `CI_SUPABASE_DB_URL` on exactly one line (`ci-workflow.test.ts:302-305`). Production secrets live in the
  `production` environment, which admits `main` only (`seed-demo.yml:56-59`, `ops-health.yml:43-47`).
- Lesson that sets the order: an app that ships before its migration misbehaves (0115: "app before 0115 =
  caps fail open"). Push to main deploys production at once, so production's schema must exist BEFORE merge.

## 1. Decisions (one recommendation each; the rejected alternative in one line)

**D1. Names.** New files are `YYYYMMDDHHMMSS_slug.sql` (UTC, 14 digits, slug `[a-z0-9_]+`), created only by
`pnpm --filter @bis/db migration:new <slug>`. `0001`..`0116` stay as they are, frozen.
- Ordering: every 14-digit name starts with `2`, every legacy name with `0`, so name order, numeric order and
  Postgres `order by version` (text) all agree: legacy first, then by time. `schemaFiles` (types-gen) and
  `supabase db push --local` need no change [A1].
- History: new files are recorded as `version=<14 digits>, name=<slug>` in BOTH projects (D3's runner writes
  both), which is also what the CLI would write. A file is "in a project's history" when a row matches the
  PAIR: `(version, name) = (prefix, slug)`, or, for legacy files only, `name = <whole stem>` (production's MCP
  rows). Never by version alone: a production MCP row's version is an apply timestamp and could equal a new
  file's version; a version taken by a different name is refused ("rename the file").
- `ci-migrations-applied.sh` moves to the pair rule and gains a content check for timestamped files (D2).
- Refusal of a new numbered file, twice: a directory test (exactly 116 legacy files, `0001`..`0116`
  contiguous, no other 4-digit name, no duplicate version, every other name 14 digits that parse as a UTC time
  no later than tomorrow), and the plan job (D2) refusing an ADDED file with a 4-digit prefix.
- Rejected: keep numbering with a reservation file or label: still collides across branches and needs a queue.

**D2. bis-ci, automatically.** A new job in `ci.yml`, `migrations-bis-ci`, applies the branch's new migration
files to bis-ci when ALL hold: the push is not to `main`; `verify` and every `e2e-shard` passed on this SHA
(the migration has been built twice from the files and run under the whole app: the Review's "after the e2e
tests"); an open, non-draft PR has this SHA as its head (REST `commits/{sha}/pulls`; a draft or no PR fails the
job with "mark the PR ready, then Re-run failed jobs", so a re-run re-checks it). Before it, a credential-free
`migrations-plan` job (git only, `fetch-depth: 0`, diff against the merge base with `origin/main`) refuses:
any modified, deleted or renamed file that exists on main; an added 4-digit name; top-level
`begin`/`commit`/`rollback`, `concurrently`, a line starting with a backslash, or a `:bis_mig_` token (the
runner is psql, D3); `drop table`, `drop column` or `rename` without a `-- contract: <why>` line (production
gets the schema before the app, so every migration must work with the app on main); and a branch that adds a
migration AND changes the pipeline itself (`.github/workflows/**`, the migration scripts, `parity/**`).
- Guards: `push` trigger only (forks never run here; a test pins no `pull_request`/`pull_request_target`);
  `if: github.repository == '<owner>/bis-platform'`; `CI_SUPABASE_DB_URL` on the apply step's env only; the
  runner re-validates the bis-ci pooler form and refuses production's ref (same rule as
  `ci-migrations-applied.sh:56-68`, moved to a shared `ci-db-target.sh`); job concurrency
  `bis-ci-migrations`, `queue: max`, never cancelled; and inside each transaction a lock on
  `supabase_migrations.schema_migrations`, so two branches cannot interleave.
- Only files ADDED by the branch are applied, and only those not already recorded. A recorded file whose
  content digest differs from the branch's file is REFUSED, naming it: bis-ci is append-only.
- Order rule, bis-ci only: a pending file's version must exceed every 14-digit version bis-ci already holds;
  otherwise "rename it with `migration:new`, it has been applied nowhere". This keeps bis-ci's apply order equal
  to file order, the order every stack and the types generator use. Not applied to production (D3), where approvals may
  arrive in either order and renaming is no longer possible.
- A later fix to an unmerged, already-applied migration: a NEW file with a later timestamp in the same PR.
  Production then receives both, in order, under one click if it had received neither.
- Rejected: apply on every green push. WIP versions would pile up on append-only bis-ci, then on production.

**D3. Production, one click, before merge.** A job `migrations-production` in `ci.yml`, `needs:
migrations-bis-ci`, with `environment: production-migrations` (required reviewer: danlo). The environment holds
the ONE production secret, `PROD_MIGRATIONS_DB_URL` (production's Session pooler URI, user
`postgres.tlbkbmlrfafquucsmsmm`, `sslmode=require`), created by the owner by hand. The apply step also gets
`CI_SUPABASE_DB_URL`, read only, for steps 2 and 4. The job installs nothing (`actions/checkout` pinned to a
commit SHA, then bash and psql), and runs `migrations-apply.sh --target production`:
1. refuse unless the URL is exactly production's pooler form and `GITHUB_ACTIONS=true`;
2. read production's history (read-only transaction); refuse if any file on main is missing ("production is
   behind main: <files>") or any pending file is missing from bis-ci or differs from bis-ci's recorded digest;
3. apply each pending file in name order, each in ONE transaction: `set local lock_timeout='5s'`,
   `statement_timeout='10min'`, the file, the history row (`version`, `name`, `statements=array[file text]`);
   `\set VERBOSITY terse` and `SHOW_CONTEXT never`, so a failing constraint cannot print a customer's row in
   a public log;
4. run parity (D4), then the full-tree history check against production (every file in the branch, by D1's
   pair rule, plus the digest for timestamped files).
- ORDER guarantee: the history gate is `e2e-migrations` (existing name, inside the required `e2e`), now
  `needs: [migrations-plan, migrations-bis-ci, migrations-production]`, `if: always()`. Green only when bis-ci
  holds every file of the branch (pair and digest) AND, if the branch adds migrations, `migrations-production`
  succeeded in this run (or, after PR 6, an earlier success on identical migration files). The ruleset already
  requires `e2e` on the head SHA, so a branch cannot merge, and so cannot deploy, before production holds its
  schema. Squash merge: the merged tree's migrations are main's (in production by this same gate) plus the
  branch's (in production by its gate). No ruleset change.
- No production gate on `main`'s own run (no credential outside the environment); `main` keeps the bis-ci check.
- One click per migration: the job runs only when the branch adds files, after bis-ci. A later push on the
  same branch asks again until PR 6, which skips the click when a previous production run succeeded on
  byte-identical migration files (a no-op approval is confusing, and the e2e check waits on it).
- Rejected: apply in a post-merge workflow before Vercel deploys. It needs Vercel's auto-deploy rerouted, and a
  failed apply leaves main deployed without its schema, which is the 0115 failure.
- Rejected: `workflow_run` (main-defined workflow). It closes the "branch edits the job" hole, but its check
  lands outside the PR's head SHA and needs a re-run bot; revisit if anyone else gets write access.

**D4. Parity.** After each production apply, in that job: `fingerprint-detail.sql` on production and on bis-ci,
each in one read-only transaction; compare the item lines `kind, key, def-digest` and subtract
`packages/db/supabase/parity/allowed-differences.txt` (today's four, each with its reason). Print only the
differing KEYS, never definitions.
- If the two histories (normalised by D1) are equal: any remaining difference FAILS the job, so `e2e` stays red
  and the PR cannot merge.
- If they differ (another PR is between bis-ci and production): report which migrations differ and do NOT judge
  the schema; parity is judged by the next apply whose histories match. Always judged, either way: each newly
  applied file's digest is equal in the file, bis-ci and production.
- Rejected: a fingerprint against a stack built from the branch's files. bis-ci and production both hold other
  PRs' in-flight migrations, so it would differ most days.

**D5. Failure and rollback.** One transaction per file means a failed file leaves neither its schema nor its
history row; files before it stay applied and recorded (frozen). Nothing retries: one attempt, no retry loop,
no `continue-on-error`. A re-run of a production job is a fresh click [A5].
- plan job refuses: nothing touched. Fix the branch.
- bis-ci apply fails: red, naming the file and psql's message. The file was never recorded, so it may be
  edited; push. A failure that looks like bis-ci's state (drift, a hand edit) is an ENVIRONMENT finding
  (runbook section 6).
- Production apply fails: red; production keeps its files up to the failed one. The schema is identical to
  bis-ci where the same file succeeded, so a SQL error here means drift: run `fingerprint-detail` on both,
  find the difference, fix by a new migration (or a hand repair recorded in the ledger), never by editing
  `schema_migrations`. A `lock_timeout` is transient: Re-run failed jobs (a new click) when traffic is quiet.
- Parity fails: schema applied and recorded; merge blocked. Fix forward by a new migration, or add the item to
  `allowed-differences.txt` with its reason in a reviewed PR.
- A run cancelled mid-apply (a newer push): the open transaction dies with its connection; at most the
  current file is lost, never half-written.
- PR abandoned after an apply: the schema stays. Remove it with a reverting migration in its own PR
  (`if exists` throughout, so it is a no-op where the original never landed); until then the gate's notice
  names the orphan on every run.

**D6. Security.**
- Blast radius: `PROD_MIGRATIONS_DB_URL` is the `postgres` role (full DDL and data). It exists in ONE
  environment, is released only after danlo's approval, reaches ONE step's env, and the job runs no installed
  code. Rotation: reset production's database password and update the secret. Today no secret holds a
  production DB URL (names read 2026-11-13: repository = `CI_*`, Clerk, OpenAI; `production` = the Supabase
  URL, the service-role key, `OPS_HEALTH_SECRET`), so this becomes the only one.
- Who approves: danlo only; administrator bypass OFF. Residual: agents act with danlo's GitHub token and the
  REST API can approve a pending deployment, so the click is an agent rule plus a user-level Claude Code
  hook that blocks the approval endpoint (Q4, done outside the repo). Second residual: a push-triggered job is defined by the
  branch's own YAML; the "migration XOR pipeline change" rule (D2) stops a slip, not intent.
- Forks: no fork run ever starts (push trigger), and environment secrets are never given to one anyway.
- Logs: GitHub masks the secret; the scripts never echo a URL, run `{ set +x; }`, use terse verbosity for
  production, upload no artifact from either apply job.
- Guards that stay: `ci-target-guard.sh --before-local-stack` in every job (now also refusing
  `PROD_MIGRATIONS_DB_URL` in any job scope but the production step); the loopback guard in stack jobs;
  `ci-migrations-applied.sh`'s URL check; `assertCiTarget`; local runs refusing production (#135).
- **CLAUDE.md replacement** for "CI runs on neither production's Supabase ... nor ... the shared CI project"
  and "Production and parity are still checked by hand":
  > CI TESTS run on neither production's Supabase nor bis-ci: every suite builds a throwaway stack in its own
  > runner. CI WRITES to two places, each from one job: `migrations-bis-ci` applies a ready PR's new migration
  > files to bis-ci after verify and the e2e shards pass, and `migrations-production` applies them to
  > production only after danlo approves the `production-migrations` environment, the only place the
  > production database credential exists. No other job, workflow or test holds a production database
  > credential; `seed-demo.yml` and `ops-health.yml` keep their `production` environment secrets (main only).
  > The required `e2e` check is red until production holds every migration of the branch, so the app never
  > deploys ahead of its schema. Parity is checked by that job after every apply.

**D7. Owner's hands** (section 3). **D8. Tasks** (section 4).

## 2. Assumptions to verify (none of these is stated as fact)

- A1 `supabase db push --local` (CLI 2.109.1) accepts 4- and 14-digit versions together and orders by name.
  Verify: PR 1's implementer runs it locally with a scratch `select 1` file; the first real timestamped
  migration's verify-db proves it again.
- A2 bis-ci's legacy rows are `version=NNNN, name=slug` (true since `ci-migrations-applied.sh` has passed on
  them since 2026-10-08, by version; the name half is unread).
- A3 every production legacy row has `name=NNNN_slug`. Verify before PR 5: the orchestrator runs
  `migration-history.sql` on production through the MCP, read only, and every row normalises.
- A4 `schema_migrations` has `version text primary key, statements text[], name text`, other columns nullable.
  Verify on a local stack in PR 3.
- A5 GitHub Environments: a required-reviewer job waits without consuming its timeout; the triggering user may
  approve unless "prevent self-review" is on; a re-run asks again; a newer run's cancel cancels a waiting job;
  secrets are released only after approval. Verify in PR 5 with a no-op job before the secret exists.
- A6 an environment job creates a deployment carrying `sha` and `ref`, listable with `deployments: read` (PR 6).
- A7 runner psql is 15+, and `\set var \`cat file\`` reads the file whole, dropping one trailing newline.
- A8 `GITHUB_TOKEN` with `pull-requests: read` lists the PRs of a commit.
- A9 `queue: max` concurrency (already used by `screenshots.yml:39`) keeps every waiting bis-ci apply.
- A10 production's objects are owned by `postgres`, the role the MCP applied as, so a `postgres` login keeps
  ownership and default privileges identical. Verify by an MCP read before PR 5.

## 3. Owner's manual checklist (danlo; nobody else may do these)

1. Settings > Environments > New `production-migrations`: required reviewer **danlo**; "prevent self-review"
   OFF (agents push as you); administrator bypass OFF; deployment branches: all branches; no wait timer.
2. In that environment only: secret `PROD_MIGRATIONS_DB_URL` = production's Session pooler URI. Never a
   repository secret, never Vercel.
3. Q1-Q6: answered 2026-11-13 (section 6).
4. No ruleset change (the gate lives inside `e2e`).
Until 1 and 2 are done, PR 5 does not merge, and production stays as today: the MCP `apply_migration` by
hand, parity by hand. Interim rule from PR 1 on: the MCP apply of a timestamped file uses `name=<whole stem>`
so D1's legacy pair rule still finds it.

## 4. Tasks (each PR under ~800 changed lines, each shippable alone, in this order)

**PR 1 — Timestamped names** (MEDIUM, ~300 lines). `packages/db/src/migrations/names.ts` (pure: parse, kind,
validate), `migration:new` script, a directory test, a `schemaFiles` ordering case, the pair rule in
`ci-migrations-applied.sh` and its test, runbook section 6 step 1, `bis-db-schema.md` naming lines.
- Tests: `names.test.ts`; `migrations-dir.test.ts` (the 116, contiguity, no new 4-digit, no duplicate,
  14-digit parse); `plan.test.ts` (`0116_a` before `20261114000000_b`); `ci-migrations-applied.test.ts` (a
  14-digit file found by its pair; same version with another name is NOT found).
- Probes: allow `0117_x.sql` → the directory test fails by name; match by version only → the "another name"
  case fails; sort descending → the ordering case fails.

**PR 2 — The plan job** (MEDIUM, ~450). `.github/scripts/migrations-plan.sh` (D2's refusals, outputs the added
files), `migrations-plan` job in `ci.yml` (no secret, before `e2e-migrations`, which `needs` it), and
`ci-workflow.test.ts` pins (no secret in the job; no `pull_request` trigger).
- Tests: `apps/web/ci/migrations-plan.test.ts` on scratch git repos (the pattern in `ci-docs-only.test.ts`):
  edit, delete and rename of a main file refused; added 4-digit refused; `concurrently`, `commit;`, leading
  backslash, `:bis_mig_x` refused; `concurrently` inside a `--` comment allowed (0103 and 0114 do that);
  `drop column` and `ALTER TABLE x DROP COLUMN` without `-- contract:` refused, with it allowed; migration +
  workflow change refused; a clean addition listed.
- Probes: drop `R` from the diff filter → the rename test fails; scan comments too → the "inside a comment"
  test fails; match case-sensitively → the upper-case `DROP COLUMN` test fails.

**PR 3 — The runner** (HIGH, ~750). `.github/scripts/ci-db-target.sh` (shared target rules: `bis-ci`,
`production`, `loopback`), `migrations-apply.sh` (D2/D3 steps; `--dry-run` lists pending and applies nothing),
`ci-migrations-applied.sh --target production` support. Nothing in CI calls the runner yet.
- Tests: `migrations-apply.test.ts` with a fake psql: production's ref under `--target bis-ci` refused, a
  non-pooler or wrong-user URL refused, `production` outside Actions refused, the URL never printed.
  `migrations-apply.live.test.ts` (vitest `live`, real psql, a scratch DATABASE created on the loopback stack,
  never the suite's own): applies a file and records `(version, name, digest)`; a file failing at its last
  statement leaves neither its table nor its row; a second run applies nothing; an edited recorded file is
  refused; a version lower than a recorded 14-digit one is refused for bis-ci, allowed for production; a held
  lock makes it fail on `lock_timeout`, not wait.
- Probes: remove the `begin`/`commit` wrapper → "leaves neither" fails; remove `ON_ERROR_STOP` → same; make the
  digest compare always true → "edited file refused" fails; delete the production-ref refusal from the bis-ci
  target → its refusal test fails; drop `VERBOSITY terse` → a test asserting no `DETAIL:` line fails.

**PR 4 — bis-ci applied by CI** (HIGH, ~450). `migrations-bis-ci` job (D2), `e2e-migrations` needs it and
reads the digest, `ci-project-setup.yml` `push`/`push-dry-run` replaced by the runner (`apply`/`apply-dry-run`)
so one applier writes bis-ci's history, `ci-workflow.test.ts` pins (secret on exactly the two steps, needs
order, concurrency, no artifact), runbook sections 3, 6 and 8.
- Tests: the workflow pins; `ci-gate` cases for the new needs; the ready-PR check with a fake `gh`.
- Probes: drop `needs: verify` → its pin fails; map `CI_SUPABASE_DB_URL` at job level → the guard test fails.
- Ships alone: production stays manual, as in section 3's interim rule.

**PR 5 — Production behind the click, and parity** (HIGH, ~700). Merge only after section 3 items 1-2 and A3,
A5, A10. `migrations-production` job (D3), `migrations-parity.sh` + `allowed-differences.txt` (D4), the gate
logic, guard refusal of `PROD_MIGRATIONS_DB_URL` elsewhere, `ci-workflow.test.ts` pins (the secret on one line,
in the one job that declares `production-migrations`; no other workflow names it; no install step in that
job), the CLAUDE.md wording (D6), runbook sections 5 and 6, `bis-platform.md` and `bis-db-schema.md` (the
orchestrator no longer applies by MCP; the MCP path stays the documented fallback).
- Tests: parity on two scratch databases on the loopback stack (identical → pass; extra column → fail naming
  the key; an allowed item → pass; histories differing → "not comparable" notice, pass); gate cases (new files
  + production skipped → red; + success → green; none → bis-ci only).
- Probes: make parity ignore `function` kind → the extra-function case fails; let the gate accept a skipped
  production job → its case fails; move the secret to job env → its pin fails.
- First live use: the next real migration, with the orchestrator watching the run and reading production's
  history (MCP, read only) afterwards.

**PR 6 — No second click for unchanged migrations** (HIGH, ~250). `migrations-plan` reads successful
`production-migrations` deployments of this branch (A6) and passes `prod_evidence` when one was on a commit
whose migrations directory is byte-identical to HEAD's; missing or ambiguous evidence asks for the click.
- Tests: fake `gh` + scratch repo: identical directory → evidence; one byte changed → none; force-pushed-away
  commit → none. Probe: compare the file list instead of the bytes → the "one byte" case fails.

Acceptance after PR 5: two PRs, each with one migration, both ready and approved the same day, both merged
the same day; read each merge's head-SHA check runs, then production's history (pair + digest) and parity.

## 5. Open questions for the owner

- Q1 bis-ci applies only for a ready (non-draft) PR (recommended), or on every green push?
- Q2 Production credential: the `postgres` pooler URL (recommended), or a dedicated `migrator` role (separate
  rotation, but a production role created by hand and an unverified `set role` on the pooler)?
- Q3 A parity failure blocks the merge (recommended), or warns?
- Q4 Add a Claude Code deny rule so no agent can approve `production-migrations` through the API?
- Q5 You are the only approver: a migration PR waits for you. Acceptable, or name a delegate?
- Q6 "A PR adds a migration or changes the pipeline, never both" (recommended): agreed?

## 6. Owner answers (2026-11-13)

- Q1 bis-ci gets a migration when the PR is marked ready (D2 as written).
- Q2 the main `postgres` Session pooler URL is `PROD_MIGRATIONS_DB_URL`; no `migrator` role.
- Q3 a parity failure blocks the merge (D4 as written).
- Q4 yes, and already done OUTSIDE the repo: a user-level Claude Code PreToolUse hook blocks any shell
  command that can reach the GitHub API and names the deployment-approval endpoint. Nothing is added in the
  repo for it.
- Q5 danlo is the only approver.
- Q6 agreed: a PR adds a migration OR changes the pipeline, never both (D2's plan-job refusal).
