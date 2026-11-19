# Ask your business from your own AI app: the read-only MCP server (focus row 13)

Status: plan, 2026-11-19; spike done the same day (§7), its findings folded into §3. Tier: HIGH (auth and tenancy: a token from outside the app reads one business's
customers). Focus list row 13. `docs/crm-features.md` S-33 (line 1594: "the spike rules out agency-admin
tokens"), line 3023 ("reads answer at once, writes become proposals; the auth spike proves tokens are scoped to
one client organisation"). Builds on F-023 (`lib/tools/staff`, #393, #395).

## 1. What it is

An Owner or Staff member adds BIS to Claude (claude.ai, Desktop, Code) or ChatGPT as a connector, signs in with
their own BIS sign-in, and asks "who called today?", "what's on tomorrow?", "what's on my To do?", "what's the
latest with Ana Ruiz?". The answers come from the same four reads the owner line uses, with the same words, the
same counts and the same scope. Nothing is written to the business's records. Writes as proposals into the
review tray are a later slice (S-33's second half), not this plan.

## 2. Decisions (owner, 2026-11-19: "go with your recommendations")

- **D1. Who.** Owners and Staff of a business whose client access is on and that is not archived: exactly
  `OWNER_LINE_ROLES` (`lib/owner-line/data-path.ts`) through `listMyMemberships`
  (`lib/owner-line/memberships.ts:18`). Technicians are refused, for the owner line's reason: on the F2 data path
  their scope lives only in RLS. The agency never: an agency membership (`scope` not `account`) is never
  returned by `listMyMemberships`, so an agency login reaches no business through this door (S-33's rule).
- **D2. Off until the business's Owner switches it on.** Customer names and numbers leave BIS for the AI app's
  maker, so the business decides, not each person: one switch per business, Owner only (not Staff, not the
  agency, unlike the owner line's switch, which the agency can also set). Off by default for every account.
  Turning it off stops every person's next read at once (checked on every call, §3.4).
- **D3. Reads only, the four staff tools plus one.** `calls_and_messages`, `appointments`, `needs_attention`,
  `lookup_customer` from `STAFF_TOOL_SPECS` (`lib/tools/staff/specs.ts`), run by `lib/tools/staff/read.ts`
  unchanged, plus `my_businesses` (the businesses this person may ask about). No write tool exists on the
  server, so no prompt can make one.
- **D4. Every read is logged and the Owner can see it.** Each read writes one row to the access-log tables
  (`agency_visits` / `agency_visit_items`, as the owner line does through `note_owner_line_call`, 0115) under a
  third actor kind. Like the owner line's rows (0115 keeps them off the Team page: `access_log_page` filters
  `actor_kind = 'agency'`, `0115:356,381`), they stay off the agency's Team log; the Owner reads them on the
  AI apps card itself (§3.6): who, which read, when. Kinds only, never the content.
- **D5. Any MCP client that signs in with OAuth.** No per-app code. The spike proves Claude Code and claude.ai;
  ChatGPT is danlo's acceptance check (§6), because its connector setup needs a paid ChatGPT plan.
- **D6. Language.** Answers follow the person's own language (`users.language`, as the owner line and the daily
  brief do), else the business's, else English.

## 3. Design

### 3.1 Transport and sign-in

- One route, `apps/web/src/app/api/mcp/route.ts`: MCP Streamable HTTP, STATELESS (no session store; every POST
  carries its bearer token and is checked from zero). GET and DELETE answer 405, as the spec allows a stateless
  server to.
- Clerk is the OAuth authorization server. Development: dynamic client registration switched on by the spike
  (§7.1, Backend API). Production (danlo, §6): Clerk's MCP setup with resource
  `https://app.bis-rgv.com/api/mcp`, which turns on the `aud` claim and Clerk's client registration for MCP
  (decided 2026-11-19, the spike's recommendation). Tokens are JWTs, scopes `profile email offline_access`.
- `/.well-known/oauth-protected-resource/api/mcp` (and the root form) answers the protected-resource metadata,
  built with `generateClerkProtectedResourceMetadata({ publishableKey, resourceUrl: origin + "/api/mcp" })` so
  `resource` names the endpoint (`protectedResourceHandlerClerk` would name the bare origin);
  `/.well-known/oauth-authorization-server` answers Clerk's metadata (`authServerMetadataHandlerClerk`), with
  `metadataCorsOptionsRequestHandler` for OPTIONS. A request with no token, a bad token or an expired one gets 401
  with `WWW-Authenticate: Bearer resource_metadata="…"`, so the client starts the sign-in.
- Libraries (read 2026-11-19 on npm): `@clerk/mcp-tools` 0.9.0 (needs `@modelcontextprotocol/sdk` ^1.29,
  `@clerk/nextjs` ^7.2.3, `next` ^16.1; the app has `@clerk/nextjs` ^7.6.1, `next` 16.3.6).
  `mcp-handler` 2.x moved to `@modelcontextprotocol/server` 2.x and 1.1.0 pins sdk 1.26.0, so neither matches
  Clerk's ^1.29: the route uses `McpServer` + `WebStandardStreamableHTTPServerTransport`
  (`{ sessionIdGenerator: undefined, enableJsonResponse: true }`, `handleRequest(req, { authInfo })`), one
  server and transport per request, and no `mcp-handler` (proven under `next start`, §7.5).
- `/api/mcp` is taken OUT of both entries of `proxy.ts`'s matcher (it is matched today, and a malformed
  three-part bearer makes `clerkMiddleware` throw → 500, §7.3). The route authenticates itself:
  `(await clerkClient()).authenticateRequest(req, { acceptsToken: "oauth_token" })`, then
  `verifyClerkToken(state.toAuth(), token)`. Tests pin the exclusion and `Bearer a.b.c` → 401.

### 3.2 The token is only a person

The OAuth token proves a Clerk user id and nothing else. It carries no org, no role, no account. Everything
about WHICH business and WHAT role is read fresh from BIS's own tables on every request:

1. The token → `clerkUserId`, or 401. A Clerk session JWT is refused (§7.3, pinned by a test).
   `verifyClerkToken` checks no audience, so the route does: when `MCP_RESOURCE_URL` is https (production),
   `aud` must be present and equal it; a token with an `aud` naming anything else is refused everywhere.
   Tokens live 24 h, cannot be revoked and outlive the person's Clerk deletion (§7.4), so steps 2-3 on EVERY
   request are the control, never the token.
2. `listMyMemberships(serviceDb(), clerkUserId)` → memberships, filtered to `OWNER_LINE_ROLES` and to accounts
   whose AI-app switch is on (§3.4). Empty → every tool answers `{ ok: false, error: "no_business" }` with one
   sentence telling the person how to get access ("Ask the business's Owner to switch on AI apps in Settings").
3. The tool's `business` argument (an account id from `my_businesses`) must be in that list. Omitted → the only
   one if there is exactly one, else `{ ok:false, error:"choose_business", businesses:[…] }`. An id not in the
   list (another business, a typo, an archived account) gets the SAME answer as an omitted one with several
   choices, so the server never says whether some other business exists.

### 3.3 Reads

`StaffReadContext` = `{ db, accountId, timezone, locale, now }`. `db` comes from the owner line's own factory
`ownerLineReadClient` (`lib/owner-line/reader.ts`) with the membership's role and the person's Clerk ids, so the
F2-vs-token decision stays in ONE place (`data-path.ts`): when the owner line flips to the token path, so does
this server, Technicians included. `timezone` is the account's; `locale` per D6. The tool result is the read's
own JSON (`CallsAndMessagesResult` etc.) serialised as one text content block; any throw → `couldnt_read`, and
the log line carries `errorClass(err)` (`lib/tools/belt.ts`), never the message.

Tool definitions come from `STAFF_TOOL_SPECS` through a new `mcpShape` beside `realtimeShape`/`chatShape` in
`lib/tools/belt.ts`: same name, same description, the parameters plus `business` (string, optional). Pinned by a
fixture like `owner-tool-schemas.fixture.json`, so a word change to a staff tool shows up in both reviews.
`runOffered` (belt.ts) runs them: unknown name → refused, never thrown.

### 3.4 The switch and the access log (PR A, one migration)

- `accounts.ai_apps_enabled_at timestamptz`, `ai_apps_changed_at timestamptz`, `ai_apps_changed_by uuid`
  (the Owner's `users.id`; always an Owner per D2, so no kind column). Written the owner line's way: a server
  action checks the session is an Owner of the account, then `setAiAppsSwitch` (packages/db, beside
  `setOwnerLineSwitch`, `owner-line.ts:231`) writes on `serviceDb`, and a trigger copied from
  `app.owner_line_switch_record_guard` refuses a change without its record (changed_at, changed_by). No new
  SECURITY DEFINER function, so `EXPECTED_DEFINERS` does not move.
- `agency_visits.actor_kind` adds `'ai_app'`, `reason` adds `'ai_app_read'` with the owner line's pairing
  check copied (`(actor_kind = 'ai_app') = (reason = 'ai_app_read')`); `agency_visit_items.kind` adds
  `ai_app_calls_and_messages`, `ai_app_appointments`, `ai_app_needs_attention`, `ai_app_lookup_customer`,
  `ai_app_my_businesses`. Constraint lists are copied from 0115's text plus these, never retyped.
- `note_ai_app_read(p_account_id, p_actor, p_actor_name, p_kind, p_request_id)` SECURITY INVOKER, granted to
  `service_role` only, exactly as `note_owner_line_call` (`0115:575,608`; 0115's header `:63-64`: a definer
  "would add privilege and nothing else"). One visit with one item per tool call, re-checking inside that the
  actor is an Owner or Staff member of the account AND the switch is on (fail closed: no row, raise). The
  owner line keys its visit on the call (`record_id` = call id, `clerk_session_id` = `'call:'||id`,
  `0115:593`); an AI-app read has no record, so PR A first reads the `agency_visits` / `agency_visit_items`
  constraints (0105, 0112, 0115) for `record_id` nullability and the session column, and keys the visit on
  `'ai_app:'||p_request_id` (a uuid the route makes per request). The route calls it BEFORE the read's result
  leaves the server; a failed write fails the call (F-118 owner ruling 4, `lib/access-log/note.ts:13`).
- `readAiAppLog(db, accountId, limit)` (packages/db, beside `readOwnerLineCallLog`) returns the last reads
  for the card: person name, kind, when. Owner only, through the card's server read.
- Down migration written in the file's header, as 0115 does.

### 3.5 Limits

Per person: 60 tool calls per rolling 10 minutes and 500 per rolling 24 hours across businesses, counted from
the access log's own rows (no new table), checked inside `note_ai_app_read` under a per-person advisory lock, so the count and the
write are one serial step per person (the owner line's own cap also lives in SQL: `owner_line_session_check`'s `p_max`). Over →
`{ ok:false, error:"rate_limited" }` with a retry hint. A read that a client loops on cannot run up the
database.

### 3.6 Turning it on (PR C, UI)

- Settings → a card on the business's own settings page, Owner only: "AI apps" — one switch, the sentence
  "Lets Owners and Staff ask about calls, appointments, To dos and customers from Claude or ChatGPT. What they
  read is sent to that app's maker.", who changed it and when, and the last 20 reads (`readAiAppLog`): who,
  which read, when. Reversible → immediate with an undo toast
  (DESIGN rule 6). English and Spanish (usted, su negocio).
- Mis preferencias → a card "Use BIS from your AI app", shown to Owners and Staff, with the server URL
  (`https://app.bis-rgv.com/api/mcp`), a copy button, two short how-tos (Claude: Settings → Connectors → Add
  custom connector; ChatGPT: Settings → Connectors, developer mode) and, per business, whether its Owner has
  switched AI apps on. The how-to words are ASSUMPTIONS until danlo's acceptance (§6) and are fixed there.
- Command palette: both cards registered (DESIGN key pattern).

## 4. PRs

| PR | Tier | What | Size |
|---|---|---|---|
| 0 | HIGH | Spike, NOT merged: branch `spike/mcp-auth`, notes appended to this plan as §7. | ~0.5 day |
| A | HIGH | Migration only (§3.4, §3.5): switch columns + record guard, access-log kinds, `note_ai_app_read` with the limits; `setAiAppsSwitch`, `readAiAppLog`. Grants/RLS tests in packages/db. | ~350 lines |
| B | HIGH | `/api/mcp` + `.well-known` routes, `mcpShape`, the per-request checks (§3.2), reads (§3.3), log + limits, access-log wording. Inert in production: no account has the switch on, and production Clerk has no DCR until danlo's click. | ~600 lines |
| C | LOW (+ design review) | The two cards, palette entries, copy en/es, styleguide if a new variant. | ~400 lines |

A ships before B (B calls A's function). PR A adds the migration and changes no pipeline file (standing rule:
the production click is skipped only when the migrations AND pipeline files are byte-identical, CLAUDE.md).

**PR 0, the spike, must prove (each a line in §7, with what was run):**
1. Clerk development instance: switch on dynamic client registration (DEVELOPMENT only; never production).
2. Local app (`pnpm --filter web dev` on bis-ci) + `claude mcp add --transport http bis-local
   http://localhost:3000/api/mcp`: the 401 starts OAuth, the browser sign-in with a bis-ci test user succeeds,
   the token arrives, `verifyClerkToken` returns the user id.
3. A Clerk SESSION token sent as the bearer is refused; an expired OAuth token is refused.
4. Which scopes the token has, and whether `verifyClerkToken` checks the audience/resource. If it does not,
   record it: the server's own checks (§3.2) still bind the token to one person, and the risk is a token
   minted for ANOTHER OAuth client of this Clerk instance being replayed here — today there is none.
5. The stateless transport answers `initialize` and `tools/list` under `next build && next start` (the Node
   runtime the route will run on). The repo has no Vercel protection-bypass secret and the spike adds none, so
   the first run on Vercel itself is production (§6); the route is inert there until the switch is on.
6. claude.ai can reach the server only on a public URL; Preview sits behind Vercel Authentication, so the
   claude.ai check waits for production (§6). Recorded, not worked around.

## 5. Tests that must fail on broken code (mutation probes in B's review)

- No token / bad token / session token → 401 with `resource_metadata`; probe: accept any bearer → FAILS.
- Person with an Owner membership in A only asks with `business` = B's id → `choose_business` with A only,
  byte-identical to the omitted-argument answer; probe: skip the membership filter → FAILS.
- Technician of A → `no_business`; probe: drop the role filter → FAILS.
- A's switch off → `no_business`, and switching it off between two calls stops the second; probe: read the
  switch once per process → FAILS.
- Agency user with no account memberships → `no_business`.
- Each tool writes exactly one access-log item of its kind before the result is returned; probe: log after
  returning, or swallow the log error → FAILS.
- Rate limit: the 61st call in 10 minutes is refused and writes nothing.
- `tools/list` equals the fixture; a write-shaped tool name (`book_appointment`) called directly is refused
  with nothing read.
- Live test on the replica (`read.live.test.ts` pattern): two accounts, the reads through the real factory
  return only A's rows.

## 6. Done when (danlo, after B and C merge)

1. danlo sets up MCP on the PRODUCTION Clerk instance with resource `https://app.bis-rgv.com/api/mcp` (Clerk
   dashboard; agents never change production Clerk), then confirms tokens carry that `aud`.
2. On BIS's own account: Settings → AI apps → on.
3. claude.ai → Settings → Connectors → Add custom connector → `https://app.bis-rgv.com/api/mcp` → sign in →
   ask "who called today?" and "what's the latest with" a real customer, then a made-up name ("I don't see that
   customer on your list."). The answers match the dashboard's Calls answered tile and the owner line.
4. The AI apps card lists each read with his name.
5. Switch AI apps off → the next question gets the "ask the Owner" answer.
6. Optional: the same in ChatGPT (paid plan, developer mode).

## 7. Spike notes

Run 2026-11-19 on branch `spike/mcp-auth` (from main 98659526), throwaway code under `apps/web/spike/`,
`apps/web/src/app/api/mcp/route.ts`, `apps/web/src/app/.well-known/**` and a matcher change in `proxy.ts`. Env:
the main checkout's `apps/web/.env.local` (Clerk DEVELOPMENT instance `topical-redfish-40`, bis-ci) loaded into
the process by `spike/with-env.mjs` (`process.loadEnvFile` in a launcher that spawns `next`, refusing a
production ref); no `.env` file in the worktree. `node --env-file` does not work for `next dev` (Next copies
it into NODE_OPTIONS, where Node forbids it). Versions: `@clerk/mcp-tools` 0.9.0, `@modelcontextprotocol/sdk`
1.32.2 (resolved from ^1.29), `@clerk/nextjs` 7.6.1, `@clerk/testing` 2.x, `next` 16.3.6, Playwright 1.62.

**1. DCR on the development instance: PROVEN, but not through `patch_instance_config`.** The Clerk MCP's
instance config schema has no OAuth-application key (`get_instance_config_schema` lists 51 top-level keys, none
for OAuth applications), so `patch_instance_config` cannot switch it. `check_mcp_server` READS the settings
(`dynamic_oauth_client_registration:false`, `aud_claim_enabled:false`, `pkce_required:false` on dev). Clerk's
`configure_mcp_server` (registers an MCP resource URL, turns on the audience claim and CIMD registration, not
DCR) refused `http://localhost:3000/api/mcp`: "resource_url must use https." So the switch went through the
Backend API with the DEV secret key (script `spike/oauth-settings.mjs`, refuses unless the key is `sk_test_`
and the publishable key decodes to `topical-redfish-40`): `GET /v1/instance/oauth_application_settings` →
200, `dynamic_oauth_client_registration:false` (the "dry run"); `PATCH` with `{dynamic_oauth_client_registration:
true}` → 200, `true`. Production was only READ (`check_mcp_server instance=production`): DCR false,
`pkce_required:true`, unchanged. Gap reported to Clerk (`submit_feedback` fbk_3MKXcn4DZnGI1u8kfU9KBR6AHIo).

**2. Route + OAuth end to end with no human: PROVEN** (`spike/oauth-e2e.mjs`, against `next dev` and again
against `next start`). `POST /api/mcp` no token → 401, `WWW-Authenticate: Bearer resource_metadata=
"…/.well-known/oauth-protected-resource/api/mcp"` → PRM names `https://topical-redfish-40.clerk.accounts.dev` →
its `/.well-known/oauth-authorization-server` → `registration_endpoint` `/oauth/register`. DCR (public client,
`token_endpoint_auth_method:none`) → 201, scope `email offline_access profile`, no secret. Throwaway user
`e2e-client-<13 digits>@example.com` (the e2e sweep's own shape), signed in by ticket with a testing token.
Authorize with PKCE S256 → the app's localhost session does NOT carry over: Clerk sends the browser to the
Account Portal (`topical-redfish-40.accounts.dev/sign-in`); a second ticket sign-in there, then
`/oauth-consent` with **Allow / Deny** buttons. Playwright clicks Allow; nothing blocked automation (one trap:
`setupClerkTestingToken`'s route re-fetches FAPI calls and follows the 303 itself, so the callback needs a real
listener, not `context.route`). Callback state matches, code exchange → 200. Then with the access token:
`initialize` 200 (protocol 2025-06-18), `tools/list` 200 (`whoami` only), `tools/call whoami` 200 returning
exactly the throwaway user's id. The user is deleted by the script.
Exported names that worked: `verifyClerkToken`, `protectedResourceHandlerClerk`, `authServerMetadataHandlerClerk`,
`metadataCorsOptionsRequestHandler` from `@clerk/mcp-tools/next`; `McpServer` (`…/sdk/server/mcp.js`,
`registerTool`, the handler's `extra.authInfo`); `WebStandardStreamableHTTPServerTransport`
(`…/sdk/server/webStandardStreamableHttp.js`, `{ sessionIdGenerator: undefined, enableJsonResponse: true }`,
`handleRequest(req, { authInfo })`), one server + transport per request. Not run: `claude mcp add` (Claude
Code's own client needs a person to click Allow); the script runs the same RFC 9728/8414/7591/7636 steps.

**3. Session token and bad tokens: PROVEN refused.** Clerk SESSION JWT as bearer → 401. `garbage` → 401.
No bearer → 401. The real access token with `exp` edited into the past (signature no longer matches) → 401.
A genuinely expired OAuth token was not waited for (lifetime 24 h). **Finding:** with the app's matcher as it
is, a three-part malformed bearer (`a.b.c`, `garbage.token.value`) makes `clerkMiddleware` throw
`SyntaxError: Unexpected end of data` → **500** before any route runs, on EVERY matched path (`/`,
`/dashboard`, `/api/nope`; reproduced under `next start`). Pre-existing, fails closed, not MCP-specific. The
spike excludes `/api/mcp` from both matcher entries and authenticates in the route with
`(await clerkClient()).authenticateRequest(req, { acceptsToken: "oauth_token" })` then
`verifyClerkToken(state.toAuth(), token)`: `a.b.c` on `/api/mcp` → 401.

**4. Token shape, scopes, audience: RECORDED.** Access tokens are JWTs (`oauth_jwt_access_tokens:true`),
claims `client_id, exp, iat, iss, jti, nbf, scope, sub`; **no `aud`** (the `resource` parameter sent on
authorize and token is ignored while `aud_claim_enabled` is false), lifetime 86 400 s, refresh token issued
(`offline_access` is added by DCR's default). `verifyClerkToken(auth, token)` does NOT verify anything itself: it
reads the `auth` object (`isAuthenticated`, `tokenType === "oauth_token"`, `clientId`, `scopes`, `userId`) and
never looks at an audience, so any OAuth token this Clerk instance issued to ANY client would be accepted.
Revocation: `POST /oauth/token/revoke` → 400 `unsupported_token_type`, "JWT access tokens cannot be revoked";
the token still works after. **A deleted Clerk user's access token still answers `whoami` (200)**; only its
refresh fails (400). So for up to 24 h the token outlives the person in Clerk: §3.2's per-request membership
read from BIS's tables is the actual control, not the token.

**5. Built server: PROVEN.** `next build` (with the env launcher) exit 0, compiled in 27 s, routes listed:
`ƒ /api/mcp`, `ƒ /.well-known/oauth-protected-resource`, `ƒ /.well-known/oauth-protected-resource/api/mcp`,
`ƒ /.well-known/oauth-authorization-server`. `next start` → the whole script again: `initialize` 200,
`tools/list` 200, `whoami` 200 with the right user, every negative case as in 3. `GET /api/mcp` → 405. No
memory trouble. Vercel's own runtime was not run (no bypass secret; as planned).

**6. claude.ai: NOT RUN, as planned.** claude.ai's connector reaches only a public https URL; Preview sits
behind Vercel Authentication and this repo has no protection-bypass secret, so the first claude.ai check is
production (§6). Recorded, not worked around.

**Folded into §3.1-§3.2 above** (matcher exclusion, in-route authentication, PRM path, audience check,
token lifetime). Separate, pre-existing: any matched route answers 500 to `Authorization: Bearer a.b.c`; worth
its own small fix, not in this plan.
