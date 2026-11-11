# F-032 owner line: Task 0 spike decision record

Date: 2026-11-09. Plan: `docs/superpowers/plans/2026-11-09-owner-line.md`, Task 0.
Spec: `docs/superpowers/specs/2026-11-09-owner-line-design.md`.
Production (`tlbkbmlrfafquucsmsmm`) was not read, queried or logged at any point. Every
hosted read and write below is on the CI project `bis-ci` (`odnobiodsftffphuuosz`).

## 1. The question

> Can a server-minted short-lived token read PostgREST as a person under RLS, beside Clerk's issuer?

## 2. Inventory (Step 2)

### What the spike established without the dashboard (bis-ci only)

| Fact | Evidence |
|---|---|
| bis-ci's app keys are the new kind, not the legacy JWTs | `apps/web/.env.local` classified by a script that prints labels only: `anon: sb_publishable`, `service: sb_secret`. So the app's own traffic can no longer show whether the legacy HS256 secret is still trusted. |
| bis-ci has moved to JWT signing keys | Its public discovery endpoint `GET /auth/v1/.well-known/jwks.json` lists exactly one key: `{"kty":"EC","alg":"ES256","use":"sig"}` (kid present). A legacy HS256 secret is never published there, whatever its state. |
| PostgREST's refusal message cannot tell the inventory | Seven tokens that must be refused were sent to bis-ci's REST API, among them HS256 with a wrong secret, ES256 with an unknown kid, ES256 carrying **the project's real kid** (certainly trusted), and RS256 with an `ins_` kid. Every one got `401 PGRST301 "No suitable key or wrong key type"`, and `a.b.c` got `401 PGRST301 "JWT cryptographic operation failed"`. So whether the legacy secret is still trusted is answered only by danlo's dashboard read, or by a correctly signed token. |
| bis-ci trusts Clerk's development instance | Not re-probed: no Clerk token was minted, because the Clerk backend is out of bounds for this agent. Vercel Preview signs in on bis-ci every day, and `docs/runbooks/ci-supabase-project.md:116-119` records the Third-Party Auth entry `topical-redfish-40.clerk.accounts.dev`. |

### The questions for danlo (names and statuses only, never a value)

Asked verbatim in the task report. The answers go here.

| | bis-ci | production |
|---|---|---|
| JWT Keys: each key's algorithm and state (Current / Standby / Previously used / Revoked) | _pending_ | _pending_ |
| The Legacy JWT secret: listed, and in which state | _pending_ | _pending_ |
| Legacy `anon` / `service_role` API keys: enabled or disabled | _pending_ | _pending_ |
| "Create standby key" or "Import" offered | _pending_ | _pending_ |
| Third-Party Auth: the Clerk domain listed | _pending_ (expected `topical-redfish-40.clerk.accounts.dev`) | _pending_ (expected `clerk.app.bis-rgv.com`) |

## 3. Step 3: the local proof

**Where it ran.** A PG18.6 replica built from all 112 migrations (through `0112_record_changes_q1.sql`), with PostgREST 14.14 (the version CI pins) behind a `/rest/v1` proxy. PostgREST's `jwt-secret` was ONE JWKS holding two keys:
- the stack's `oct` secret, which signs the minted tokens and the service key;
- an RSA "Clerk stand-in" public key with kid `ins_spikelocalclerkstandin0000`.

That is the JWKS shape `.github/scripts/ci-local-supabase.sh:15-34` hands the e2e stack.

**Why not the plan's PG17 or Docker.** The PG17 binaries on disk do not load on this machine (missing UCRT DLLs). Docker was not started, because the machine had about 1.5 GB free.

**Seed.**
- Two accounts, A and B, both with `client_access_enabled`.
- A's Owner, Staff and Technician, plus B's Owner.
- In each account: a contact assigned to A's Technician and a contact assigned to nobody, each with one call, one booking and one task.

**Token.** HS256 `{ role: "authenticated", aud: "authenticated", sub, org_id, iat, exp: iat + 120 }`, read through `userDb(token)` with the real `listCalls`, `listAgendaBookings` and `listAccountWork`.

Red first: the same file with the minted tokens signed by a secret PostgREST does not hold:
`Tests  6 failed | 1 passed (7)`, e.g. `Error: listCalls failed: No suitable key or wrong key type`.

Green:

```
 ✓ (a) the Owner's minted token: listCalls, listAgendaBookings and listAccountWork return A's rows, and zero from B
 ✓ (a2) the Staff member's minted token sees exactly what the Owner sees
 ✓ (b) the Technician's minted token sees only the assigned contact's call, booking and task
 ✓ (c) a token whose exp is in the past (120 s, beyond any skew allowance) is refused with 401 PGRST303
 ✓ (c2) PostgREST's clock-skew allowance: 20 s past exp is still ACCEPTED, 45 s past exp is refused
 ✓ (d) a token signed with a different secret is refused with 401 PGRST301
 ✓ (e) org_id of B with sub of A's Owner reads nothing from A, and nothing scoped from B
 ✓ (f) beside: the same PostgREST accepts the RS256 Clerk-shaped token for the same person and returns the same rows
 ✓ (g) why the key is service-role-grade: the same signer minting app_role agency_admin (for A's Technician, org A) reads B's rows too
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

**Mutation probe (the plan's).** Seeding A's Technician contact with no assignee fails (b) by name:
`× (b) the Technician's minted token sees only the assigned contact's call, booking and task`.
The Technician received `{ calls: [], bookings: [], tasks: [] }`, so RLS decides the scope, not a filter in the probe. Final line: `Tests  1 failed | 7 passed (8)`.

**Two findings the plan did not have:**
- **(c) as written in the plan cannot fail at small offsets.** PostgREST 14 accepts a token up to its clock-skew allowance past `exp`: 30 s past was ACCEPTED (200) in the first green attempt, and 20 s accepted / 45 s refused is pinned in (c2). A 120 s TTL is therefore usable for up to about 150 s. The pass's 60 s freshness is an app-side HMAC check and is unaffected.
- **(g) confirms the options table's warning with a measurement.** A key that signs these tokens can mint `app_role: agency_admin` and read every account.

## 4. Step 4: the hosted proof on bis-ci

Two scratch scripts sit in the session scratchpad (`owner-line-spike/probe.ts` and `latency.ts`) and are never committed. Both open with `refuseProduction(process.env, …)`, and the probe also refuses any URL that is not bis-ci.

### Proven so far

**probe.ts locally, all four modes** (the probe has a loopback-only `SPIKE_LOCAL=1` mode for exactly this):

| Mode | Result |
|---|---|
| HS256 with the stack secret | `PASS d`, `PASS a`, `PASS a2`, `PASS b`, `PASS c`, `PASS e` |
| ES256 with a JWK whose public half was in the JWKS | the same six PASS lines |
| A wrong key (negative control) | `PASS d` only. a, a2, b and e: `FAIL … (listCalls failed: No suitable key or wrong key type)`; c: `FAIL c (401 PGRST301)` |
| No key | `PASS d`, then `SKIP` for the other five |

**On bis-ci, no key**, run twice (once with the env sourced, once with danlo's exact command below):

```
variant: no key (seed, (d), sweep only)
seeded two spike accounts
PASS d (a different key is refused)
SKIP a (no SPIKE_JWT_SIGNING_KEY)
SKIP a2 (no SPIKE_JWT_SIGNING_KEY)
SKIP b (no SPIKE_JWT_SIGNING_KEY)
SKIP c (no SPIKE_JWT_SIGNING_KEY)
SKIP e (no SPIKE_JWT_SIGNING_KEY)
swept: spike accounts left 0, spike users left 0
```

### Not yet run: (a), (a2), (b), (c) and (e) on bis-ci with a real signing key

This needs a key only danlo can provide. The plan's variant rule needs one correction, from Supabase's own docs (`https://supabase.com/docs/guides/auth/signing-keys`, read 2026-11-09; external, and not verified here):
- A newly created or imported key "starts out in the standby state", and the accepted signatures in that state are "**Current key only**".
- "Once imported, click **Rotate key** to activate your new signing key."
- The plan said "imported as a standby key", which per the docs is not enough. The run below checks it both ways.

**Variant ES256** (recommended, because it is what production would use). On bis-ci only:
1. Make a key in a Git Bash shell. It prints a private JWK once. Copy it, and never save it to a file:
   ```bash
   node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey;console.log(JSON.stringify({...k.export({format:'jwk'}),kid:c.randomUUID()}))"
   ```
2. In the bis-ci dashboard, go to Settings → JWT Keys → Create standby key → Import, and paste it.
3. Run the probe. Expect FAIL on a, a2, b and e if the docs are right that a standby key is not trusted. Record either way.
4. Rotate keys. Wait the 5 minutes the dashboard imposes. Run again, expecting six PASS lines.
5. Afterwards: move the previous key back to standby, rotate to it, then revoke the spike key.

**Variant HS256.** Only if the inventory shows bis-ci's Legacy JWT secret is Current or Previously used. Paste that secret at the prompt instead.

**The run.** `tsx` is not hoisted to the repo root, so the plan's command fails from there. Run it from `packages/db`:

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/f032/packages/db
read -rs SPIKE_JWT_SIGNING_KEY && export SPIKE_JWT_SIGNING_KEY
node --env-file=/c/Users/danlo/bis-platform/apps/web/.env.local --import tsx /c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/ad5ce625-1074-4ef0-8101-d89981650acf/scratchpad/owner-line-spike/probe.ts
unset SPIKE_JWT_SIGNING_KEY
```

The probe prints only `variant`, `PASS`/`FAIL`/`SKIP` lines and the sweep counts, never a key or a token. It creates two `spike-owner-line-probe-*` accounts with four `user_spike_*` users and deletes them in `finally`.

| Case | bis-ci result |
|---|---|
| a, a2, b, c, e with the imported key, standby | _pending (danlo)_ |
| a, a2, b, c, e with the imported key, after rotation | _pending (danlo)_ |

## 5. Step 5: the answer route's added latency

**Method.** Run against bis-ci from danlo's machine with `latency.ts`, on one throwaway `spike-owner-line-latency-*` account seeded with 60 calls and swept afterwards.
- **Baseline** is today's four reads at `route.ts:337-348`. `countCallerHistorySince` is three requests and `countForwardedCallsSince` two, so the baseline is seven concurrent PostgREST requests.
- **"+ lookup"** adds an eighth request beside them: one select served by `calls_caller_idx`, standing in for `owner_line_answer_lookup`.
- The two arms are interleaved, alternating which runs first, after 5 warm-up rounds.

| Run | n | Baseline p50 / p95 | + lookup p50 / p95 | Added p50 / p95 | Paired median (same iteration) | Lookup alone p50 / p95 |
|---|---|---|---|---|---|---|
| 1 | 50 | 219.6 / 320.1 ms | 217.1 / 264.9 ms | **−2.5 / −55.3 ms** | n/a | 149.7 / 171.1 ms |
| 2 | 150 | 228.1 / 1478.4 ms | 231.9 / 1505.7 ms | **+3.8 / +27.2 ms** | +5.9 ms | 154.5 / 191.8 ms |
| 3 | 100 | 224.1 / 1488.9 ms | 226.0 / 1469.0 ms | **+1.9 / −19.9 ms** | +8.9 ms | 152.5 / 174.7 ms |

**Server-side cost of the lookup itself.** Measured with `EXPLAIN (ANALYZE)` on bis-ci inside `begin read only`: an Index Scan using `calls_caller_idx`, execution **0.161 ms** and **0.167 ms**. bis-ci holds only 50 call rows, but the plan is a bounded index lookup at any size.

**The route's own baseline from Vercel: not obtained.**
- Vercel's MCP tools were not available to this agent.
- Preview receives no Telnyx traffic (the numbers point at production).
- Under the hard rule, no production log was read.

The question for danlo below asks for the duration column only.

**Verdict against the budget** (added p95 ≤ 25 ms target, 50 ms hard ceiling): **within budget, and the plan does not change.**
- Added p50 is +1.9 to +3.8 ms (paired medians +5.9 and +8.9 ms).
- Added p95 is inside the 50 ms ceiling on all three runs, and inside 25 ms on two of three.
- The one over 25 ms (+27.2 ms) came from a run whose baseline p95 was 1478 ms. Both arms of runs 2 and 3 show the same ~1.4–1.5 s client-side stall (connection setup on a residential link, about 150 ms per round trip to us-east-1), which is noise about 50 times the signal.
- The database cost is 0.16 ms, so on Vercel, a few milliseconds from Supabase, the added cost is one extra concurrent request whose result arrives with the batch: `max()`, not `+`, as Task 7 designs it.
- Caveat: these are client-side numbers from this machine, not from Vercel.

## 6. The options table

| Option | Who gets the line | Secret added to Vercel Production | Production's legacy JWT secret | Ongoing cost | Rollback |
|---|---|---|---|---|---|
| **T** (minted token, RLS decides) | Owner, Staff, Technician. Proven locally: (a), (a2), (b), and (b)'s mutation. | ES256: `OWNER_LINE_JWT_PRIVATE_KEY` (a private JWK holding its kid). HS256: `SUPABASE_JWT_SECRET`. **As powerful as the service-role key**, measured in (g): it can mint `app_role: agency_admin` and read every account. So it gets the service-role key's handling: Sensitive, Production only, and rotation in `production-isolation.md`. | **ES256 does not touch it**: import a key, then **rotate to it** (the docs say a standby key is not trusted). That leaves production's legacy secret and legacy API keys exactly as the isolation runbook left them (`production-isolation.md:765-769` advises disabling the legacy keys). Rotation also changes the key Supabase Auth signs with; this app signs in through Clerk, so that is unused, but Storage signed URLs (the document vault and logos) should be checked on bis-ci after its rotation [assumption: they keep working, because the previous key stays trusted until revoked]. HS256 works only if production's legacy secret is still Current or Previously used. It is a shared secret Supabase calls "not recommended for production", so it is not the path this record proposes. | The secret. Plus one key-state rule: **never revoke the imported key while any switch is on**, or every tool answers "I couldn't read that" (fail closed, never open). Tokens live 120 s plus PostgREST's ~30 s skew allowance. | Remove the env var: every tool answers "I couldn't read that". Turn the switches off. Move the imported key to Previously used, then Revoked. |
| **F2** (service reads, Owner and Staff) | Owner, Staff | none | untouched | none | n/a; flip `OWNER_LINE_DATA_PATH` |
| **F1** (F2 plus a Technician code filter) | Owner, Staff, Technician | none | untouched | Every future change to `app.my_contact_ids()` (0068:80-88) or to a Technician policy must be mirrored in code. A parity test (the code filter's contact set equals `app.my_contact_ids()` under the same claims) fails on drift, but someone must then fix it. | Drop the filter; it becomes F2. |

## 7. Recommendation

**By the plan's rule, today's answer is F2, and it becomes T the moment danlo's ES256 run on bis-ci prints the six PASS lines after rotation.**

T's first condition, (a)–(e) passing on bis-ci, needs a signing key that only danlo can import. Its second condition is met on paper, because production can sign with an imported and rotated ES256 key without re-enabling any legacy key. The local proof shows T works for all three roles, with RLS, beside an RS256 issuer, under both HS256 and ES256.

Recommended order:
1. danlo answers the inventory.
2. danlo runs the ES256 variant on bis-ci (about 15 minutes, most of it the dashboard's 5-minute wait).
3. O-1 then offers T first.

If the owner wants a decision before that run, the rule selects F1 only if Technicians must be on the line now and the parity upkeep is accepted; otherwise F2. Either way `OWNER_LINE_DATA_PATH` is a one-line flip (plan, O-1).

Value for Task 10 today: `OWNER_LINE_DATA_PATH = "service"`, roles `["owner", "staff"]`. Under T: `"token"`, roles `["owner", "staff", "technician"]`.

## 8. Under T: the exact token

- **Header:** `{ "alg": "ES256", "typ": "JWT", "kid": "<the imported key's kid>" }`, or `{ "alg": "HS256", "typ": "JWT" }` on the legacy path.
- **Claims:** `{ "role": "authenticated", "aud": "authenticated", "sub": "<Clerk user id>", "org_id": "<Clerk org id of the dialed account>", "iat": <now>, "exp": <now + 120> }`.
- **`app_role` is never set.** (g) shows what it would do.
- **Env var, Vercel Production only, Sensitive:** `OWNER_LINE_JWT_PRIVATE_KEY` (ES256, the private JWK including `kid`), or `SUPABASE_JWT_SECRET` (HS256). Never in Preview (`docs/runbooks/production-isolation.md`). The CI e2e stack signs with its own local secret.
- **TTL:** 120 s. PostgREST accepts up to about 30 s past `exp` (observed: 20 s accepted, 45 s refused), so mint per tool call rather than once per call.
- **Read through `userDb(token)`**, the same client every signed-in page uses, so the RLS policies the app relies on are the ones that bound the line.

## 9. Q-G

Closed. The owner ruled on 2026-11-09 for the dashboard's spam number only ("plus N calls that looked like spam", the same read as the dashboard). Nothing in this spike reopens it.

## Corrections to the plan found by the spike

1. **Step 4's ES256 variant** said to import the key "as a standby key". Supabase's docs say standby keys are not trusted ("Current key only"), so the variant is import, then **rotate**. danlo's run checks both.
2. **Step 3's case (c)** needs an `exp` beyond PostgREST's clock-skew allowance (about 30 s). The 120 s TTL is effectively about 150 s.
3. **Step 4's run command** (`node --env-file=apps/web/.env.local --import tsx …` from the repo root) fails, because `tsx` is not hoisted to the root. Run from `packages/db`, as in section 4.
4. **Step 2 cannot be inferred from PostgREST.** Every signature failure returns the same `PGRST301` message, even for a token carrying the project's real kid.
5. **Step 3's replica** ran on PG18.6 with PostgREST 14.14, because the on-disk PG17 binaries do not load here.
