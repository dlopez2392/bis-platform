# Mis preferencias: a person's own language and theme (F-096 part 1)

Date: 2026-10-10. Status: design APPROVED by the owner (2026-10-10); this document records it and fills in the
mechanics from the source. First-release item 1, last-but-one piece. Builds on staff and roles (#235, migration
0066) and the Spanish runtime (#234, migration 0065).

Plan: `docs/superpowers/plans/2026-10-10-mis-preferencias.md`.

## 1. Goal

Every person who signs in (agency staff, a client's Owner, a client's Staff) can choose, for themselves only:

- the **language** the app speaks to them (English or Español, or, for a client login, "Follow the account"), and
- the **theme** (Light, Dark, or Follow my device),

on one page, `/dashboard/preferences`, reached from the user menu (Clerk's UserButton) and from ⌘K. The choice is
stored on the person's own `users` row, so it follows them to every browser and device.

## 2. Non-goals

- Per-reader Spanish call summaries (a summary is written once per call; who reads it is a later problem).
- Larger text and more contrast (F-096 part 2).
- Any change to the ACCOUNT's language (Settings, 0065) or a tenant's `brand_mode` (Branding).
- Any change to who may see or change another person's language (the Team card, 0066, is unchanged).
- A sidebar nav entry. The page is reached from the user menu and ⌘K only.

## 3. Decisions (owner, 2026-10-10; not re-opened here)

| # | Decision |
|---|---|
| D1 | Migration `0067` adds `users.theme text null check (theme in ('light','dark','system'))`. NULL = no choice. `users.language` (en, es, NULL) already exists (0066). |
| D2 | An agency person gets a `users` row on their FIRST save (clerk_user_id, email, name) and NO membership. The team list and every team sync keep ignoring agency users; this is verified and pinned by tests (section 9). |
| D3 | Language: the person's own `users.language` wins for EVERYONE, the agency included. With no choice: agency gets English, a client gets the account's language (today's behaviour). |
| D4 | Both `LocaleProvider` mounts and every server `requestLocale` call pass `userLanguage` from ONE cached per-request read, which extends the cached stored-role read, so the client hot path gains no query. |
| D5 | Theme precedence: `users.theme` > `bis-theme` cookie > role default (agency dark, client light). `'system'` follows the device (`prefers-color-scheme`). The topbar toggle also writes `users.theme`. The cookie is kept in step so the server's first paint never flashes. |
| D6 | The page: Language and Theme, two inline fields, each saving at once with an undo toast (DESIGN rule 6). Renders in the person's locale through `t()` with `.es` twins. Tokens only, both themes, keyboard, loaded/empty/error states. |
| D7 | Safety: the save writes ONLY the caller's own `users` row, keyed on the authenticated Clerk `userId` (never a client-supplied id), through `serviceDb()` (users writes are server-only since 0066), the value validated against a closed list before the database. |

## 4. Data

### 4.1 Migration `0067_person_preferences.sql`

```sql
set local lock_timeout = '5s';
alter table public.users
  add column theme text constraint users_theme_check check (theme in ('light', 'dark', 'system'));
comment on column public.users.theme is
  'The person''s own theme: light, dark or system (follow the device). NULL = no choice: the bis-theme cookie, then the role default (agency dark, client light). Written only by the person''s own Preferences page and topbar toggle, server-side.';
```

Nothing else changes in the database:

- **Grants.** 0066 revoked INSERT/UPDATE/DELETE on `public.users` from `authenticated`; that covers the new column.
  Only `serviceDb()` writes it.
- **Reads.** `users_agency_read` (agency reads every row) and `users_member_read` (a client reads the rows of its
  own account's members) already govern SELECT. A client can therefore read a teammate's `theme`, exactly as it
  can already read their `language`. That is acceptable (a theme is not sensitive) and is recorded here so nobody
  "discovers" it. An agency person's row has no membership, so no client token can ever read it.
- **Rollback.** Revert the code FIRST (it selects `theme`), then `alter table public.users drop column theme;`.

### 4.2 Why the migration must precede the code everywhere

The stored-role read becomes `memberships.select("role, users!inner(clerk_user_id, language, theme)")`. Against a
database without `users.theme`, PostgREST rejects that select, the read resolves `STORED_READ_FAILED`, and every
client request fails closed: no role, so every Owner loses Delete, calendar settings, Billing and Team until the
column exists. That is safe (closed, not open) but a visible outage, which is why section 8's order is
CI project, then production, then parity, then merge, with no exception.

## 5. Resolution rules

### 5.1 One per-request read: `getPersonPrefs()`

`apps/web/src/lib/preferences/person-prefs.ts` exports a React-`cache()`d `getPersonPrefs(): Promise<PersonPrefs>`
(`{ language: "en"|"es"|null; theme: "light"|"dark"|"system"|null }`). It never throws (Next's control-flow errors
are re-thrown with `unstable_rethrow`; anything else logs and yields `NO_PREFS`).

| Caller | How it reads | Extra queries |
|---|---|---|
| Signed out (`/sign-in`, public routes reaching the root layout) | no `userId`, returns `NO_PREFS` | none |
| Client whose account resolves `ok` | `readStoredPerson(state.id, userId)`: the SAME cache entry `requireAccountAccess`'s `readStoredRole` now derives from (one `memberships ⋈ users` read carries role, language, theme) | none on the hot path |
| Client with a users row but no membership yet (the fallback has not run) | the joined read finds nothing; falls back to `readPersonPrefs(userId)` | one, only in that rare window |
| Agency | `readPersonPrefs(userId)` (users by `clerk_user_id`, unique index) | one indexed read, started in parallel with the layout's other reads. The agency has no stored-role read to extend. |
| A failed read of any kind | `NO_PREFS` (defaults apply) | none |

`readStoredRole(accountId, clerkUserId)` keeps its signature and its never-rejects contract; it becomes
`readStoredPerson(...).then(toStoredRole)`, so `ensureAccountRole`'s cache-key discipline (dashboard layout,
review I1 of staff and roles) is untouched.

### 5.2 Language

`requestLocale` (`lib/i18n/request-locale.ts`) already takes `userLanguage` and already lets it win on both
branches (`isOperator ? resolveLocale(userLanguage, null) : resolveLocale(userLanguage, account.language)`). No
logic changes there; only the doc comment, which still says "not yet populated by any caller".

The three server call sites pass `userLanguage: (await getPersonPrefs()).language`:

1. `app/(dashboard)/dashboard/layout.tsx` (the chrome's `LocaleProvider`),
2. `app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx` (the account's `LocaleProvider`),
3. `app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx` (the KPI row).

Server-side alert languages (`b/[publicId]/actions.ts`, `lib/voice/finish-call.ts`) call `resolveLocale(undefined,
account.language)` for messages sent to a business's alert recipients, not to a signed-in reader. They are out of
scope (section 2) and stay as they are.

Result table:

| Person | `users.language` | Account language | Renders |
|---|---|---|---|
| Agency | NULL | (any) | English |
| Agency | es | (any) | Español, in every account and on agency pages |
| Client | NULL | es | Español (follows the account) |
| Client | en | es | English |
| Client | es | en / NULL | Español |

### 5.3 Theme

`resolveThemeMode(cookie, brandMode, isOperator, userTheme = null)` gains a fourth parameter, checked FIRST:

| `userTheme` | `serverMode` (tokens painted) | `providerDefault` (next-themes) |
|---|---|---|
| `light` / `dark` | that mode | that mode |
| `system` | the cookie if it is `light`/`dark` (ThemeCookieSync's snapshot of the OS), else the role default | `system` |
| NULL | today's chain, unchanged: tenant `follow` special case, then cookie, then `brand_mode`, then role default | unchanged |

`brand_mode` keeps its place between the cookie and the role default; the owner's precedence line names the three
person-level sources and does not move the tenant's.

`getRequestTheme` (`lib/branding/tenant-theme-reader.ts`) adds `getPersonPrefs()` to its existing `Promise.all`
and returns `userTheme` beside `serverMode`/`providerDefault`. It stays the ONE place `resolveThemeMode` is invoked.

**Keeping the browser in step (no flash, no fight).** next-themes keeps its own value in `localStorage`, which
another device's choice cannot reach. The root layout passes `userTheme` to `ThemeProvider`, which passes it to
`ThemeCookieSync`. A pure `userThemeSyncPlan(userTheme, theme, existingCookie)` decides, on mount:

- `userTheme` NULL: do nothing new (today's migration and `system` snapshot logic run as before).
- `userTheme` set and next-themes' `theme` differs: `setTheme(userTheme)`, so localStorage follows the database.
- `userTheme` `light`/`dark` and the cookie differs: write the cookie (no refresh: the server already painted it).
- `userTheme` `system`: leave the cookie to the existing `cookieModeToPersist` snapshot.
- While `userTheme` is set, the one-time `cookieModeToMigrate` migration is skipped: a stored choice outranks a
  localStorage leftover, and running both would refresh twice.

**The toggle.** `toggleTheme(resolvedTheme, setTheme, refresh, persist)` keeps writing the cookie and calling
`setTheme` at once (instant), then calls `persist(next)` = `setMyThemeAction(next)`. If the save fails it shows
`theme.saveFailed` ("Couldn't save your theme. It may switch back when the page reloads.") because, with a stored
`users.theme`, the server would otherwise silently repaint the old choice. The palette's `toggle-theme` action uses
the same function and so persists too.

## 6. The page: `/dashboard/preferences`

**Path.** The approved design names "/preferences". It lives at `/dashboard/preferences` so that `proxy.ts`'s
existing `/dashboard(.*)` protection, the dashboard chrome and its `LocaleProvider` all apply with no change to the
proxy matcher. This is a placement detail, not a design change.

**Who.** Everyone signed in who reaches the dashboard tree: agency, client Owner, client Staff. A client whose
access is off or unresolved is already redirected by `dashboard/layout.tsx` before the page runs. The page guards
itself (`auth()`; no `userId` redirects to `/sign-in`) like every leaf does; it needs no role check because it can
only ever touch the caller's own row.

**Reached from.**

- The user menu: a client component `components/user-menu.tsx` renders Clerk's `UserButton` with
  `<UserButton.MenuItems><UserButton.Link label=… labelIcon=… href="/dashboard/preferences" /></UserButton.MenuItems>`.
  API verified in the installed packages (`@clerk/nextjs` 7.6.1 re-exports `@clerk/react` 6.12.8):
  `node_modules/.pnpm/@clerk+nextjs@7.6.1_…/node_modules/@clerk/react/dist/index.d.mts` lines 36-41
  (`UserButtonExportType` = `_UserButton & { …, MenuItems, Action, Link }`) and 107-115 (`MenuLink` takes
  `UserButtonLinkProps`), with `types-BnGFcHu4.d.mts` lines 10970-10974: `{ href: string; label: string;
  labelIcon: React.ReactNode }`. It must be a client component: `topbar.tsx` is a server component, and reading a
  static property (`UserButton.MenuItems`) off a client reference on the server is not possible. `label` is a
  plain string, so the client component resolves it with `useLocale()` + `t()`.
- ⌘K: one `navigation` entry in `lib/palette/registry.ts`, emitted for every caller (agency and client, any base),
  `agencyOnly: false`, keywords including "language", "idioma", "theme", "dark", "light", "español".

**Layout.** Page title (Display role), one sentence under it, then two cards (DESIGN rule 8: two independent views,
each saving itself, so neither has a primary Save; nothing on the page has one):

1. **Language.** A radio group. Client logins: English / Español / Follow the account ("Right now that's
   Español."). Agency: English / Español. Option labels "English" and "Español" are written in their own language
   (reuse `LANGUAGE_OPTIONS`, `lib/i18n/language-options.ts`).
2. **Theme.** A radio group: Light / Dark / Follow my device.

Native radio inputs in a `role="radiogroup"` fieldset with a legend: arrow keys move, Space selects, the house
`:focus-visible` ring shows. No `<form>`, no Radix Select (so `useFormSubmit`'s Radix-reset defect cannot arise;
any future Select here would go through `useFormSubmit`).

**Saving (rule 6).** A change applies at once (theme: `setTheme` + cookie; language: the page re-renders after the
save), calls the action, then shows a toast with Undo for 10 s (`TEAM_TOAST_MS`'s length, a separate constant).
Undo calls the same action with the `previous` value the server returned, which may be NULL (back to "no choice").
A failed save puts the radio back where it was and shows the error toast. A language toast is written in the
language just chosen.

**States.**

- Loading: `loading.tsx`, two card-shaped skeletons (rule 7).
- Empty (no choice yet): theme NULL shows no radio checked and the line "You haven't picked one. You're seeing the
  dark look, the default for your login." Agency language NULL: "English until you pick one." A client's NULL
  language is not empty: it IS "Follow the account", checked.
- Error: the page reads through `loadMyPreferences()`, which THROWS on a failed read (unlike `getPersonPrefs()`,
  which degrades). A degraded read would show the defaults as if they were the person's choice and invite them to
  overwrite their real one. The route's `error.tsx` says "We couldn't load your preferences. Reload the page." with
  a Reload ghost button.

**Copy.** Every string in `messages.ts` under `prefs.*` with a `.es` twin (the ratchet requires it; the page is not
agency-only, so `ratchet-scan` scans it and its baseline is zero). It passes the 7 AM read in both languages and
the pseudo-locale's +35% length.

## 7. Safety

- **The actions take no person id.** `setMyLanguageAction(language)` and `setMyThemeAction(theme)` read `userId`
  from `auth()` and pass it to `saveMyPreferenceWith`, which keys every read and write on
  `.eq("clerk_user_id", userId)`. There is no parameter through which a browser could name another row.
- **Closed lists before the database.** Language must be `en`, `es` or `null`; theme `light`, `dark`, `system` or
  `null`. Anything else returns `{ ok: false, error: "prefs.invalid" }` and makes no query. `null` is accepted from
  everyone because Undo of a first choice restores "no choice"; the agency's page simply never offers it as an
  option. The database `check` constraints are the second wall.
- **`serviceDb()`** because 0066 made users writes server-only. This is the trusted-caller case: Clerk has
  authenticated `userId`, and the write is confined to that row.
- **First save creates the row.** No row means an agency person (or a client before the fallback ran). The save
  asks Clerk for that one person's email and name (`currentUser()`), then upserts
  `{ clerk_user_id, email, name, <field> }` on `clerk_user_id`. It never creates a membership. If Clerk returns no
  email, the save fails cleanly (`prefs.failed`).
- **Agency rows stay out of every team.** Team list, team actions and team sync all go through `memberships`, and
  the agency never has one (plan deviation 6 of staff and roles). The webhook's `user.updated` ignores agency
  users, so an agency row's email/name are set at its first save and never refreshed afterwards (a later save
  updates only the chosen field). That staleness is harmless: nothing shows an agency row to anyone.
- **Revalidation.** A language save calls `revalidatePath("/dashboard", "layout")` so the chrome re-renders in the
  new language; a theme save does too (the server paint changes).

## 8. Errors and failure modes

| Failure | Behaviour |
|---|---|
| Prefs read fails on a normal page | `getPersonPrefs` logs and returns `NO_PREFS`; the page renders in defaults. Never a 500. |
| Prefs read fails on `/dashboard/preferences` | `error.tsx` (section 6). |
| Save: invalid value | `prefs.invalid`, no query. |
| Save: database error | `prefs.failed`, radio reverts, error toast. Logged with `loggableError`. |
| Save: Clerk profile unavailable on first save | `prefs.failed`, nothing written. |
| Toggle saves the cookie but not the database | `theme.saveFailed` toast. |
| Column missing (code ahead of migration) | role read fails closed for clients (section 4.2). Prevented by the rollout order. |

## 9. Testing (each test's failure mode)

| Test | File | Fails when |
|---|---|---|
| `theme` check rejects `'blue'`, accepts the three values and NULL | `packages/db/src/test/person-preferences-schema.test.ts` | the constraint is dropped or widened |
| a client token cannot UPDATE `users.theme` | same | `update` is granted back to `authenticated` |
| `savePersonPreference` creates an agency row with no membership; `listAccountTeam` never lists it | `packages/db/src/test/preferences.test.ts` | the save also inserts a membership, or the team list stops joining memberships |
| a save changes only the caller's row | same | the update loses its `clerk_user_id` filter |
| a save returns the previous value (Undo) | same | `previous` is read after the write |
| `reconcileMembership` still returns `agency_user` and writes nothing when the agency user HAS a users row with preferences | `packages/db/src/test/team.test.ts` | the agency check moves after the users upsert |
| `readAccountRoleAndPrefs` returns role and prefs from one read; null with no membership | `preferences.test.ts` | prefs are read by a second query, or a missing membership reads as Owner |
| `readStoredRole` derives from `readStoredPerson` (one fake-db `from()` call yields both) | `apps/web/src/lib/team/ensure-role.test.ts` | the two reads are separate queries |
| `resolvePersonPrefsWith`: signed out, client ok, client no membership, agency, failure | `apps/web/src/lib/preferences/person-prefs.test.ts` | any row of 5.1's table regresses (e.g. agency read skipped) |
| every `requestLocale(` call under `app/` passes `userLanguage` | `apps/web/src/lib/i18n/request-locale-callers.test.ts` | one layout drops it |
| `resolveThemeMode` with `userTheme` light/dark/system/NULL | `apps/web/src/lib/branding/theme-mode.test.ts` | user theme checked after the cookie |
| `userThemeSyncPlan` cases | same | the plan writes a cookie for `system`, or migrates while a user theme is set |
| `toggleTheme` calls `persist(next)` and toasts on failure | `apps/web/src/components/theme-toggle.test.ts` | persist dropped |
| `saveMyPreferenceWith`: rejects unlisted values with no query, keys on `userId`, no profile = failed | `apps/web/src/lib/preferences/save.test.ts` | validation moved after the query, or the key comes from input |
| option lists: agency gets two language options, client three | `apps/web/src/lib/preferences/preference-options.test.ts` | "Follow the account" offered to the agency |
| handlers: toast + Undo restores `previous`, failure reverts | `apps/web/src/components/preferences/preference-handlers.test.ts` | Undo sends the new value |
| palette has the Preferences entry for agency and client | `apps/web/src/lib/palette/registry.test.ts` | the entry is agency-only or missing |
| ratchet: no raw copy in the new files, every `prefs.*` key has `.es` | `apps/web/src/lib/i18n/ratchet.test.ts` (existing) | a literal or a missing twin |
| e2e: agency opens the user menu, picks Español, the chrome speaks Spanish, Undo restores; Light survives a reload with no flash | `apps/web/e2e/preferences.spec.ts` | a call site drops `userLanguage`, or the server ignores `users.theme` |

## 10. Rollout

1. Merge `main` into the branch; confirm `0067` is still the next free number (renumber if not).
2. Before any Supabase MCP call that may show an Accept/Decline prompt, the orchestrator warns danlo first.
3. Apply `0067` to the CI project (`ci-project-setup.yml`). The e2e job's migration check enforces this.
4. Apply `0067` to production via MCP.
5. Parity check (`docs/runbooks/ci-supabase-project.md`).
6. Merge (REST PUT, `sha` pinned, after reading the head SHA's check runs) and verify the deploy (READY with the
   merge SHA, aliased, `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404, and a marker: the
   `data-prefs-page` attribute on `/dashboard/preferences` for a signed-in person; the orchestrator cannot sign in
   to production, so danlo loads the page or the check is recorded as owner-verified).
7. DESIGN.md's Identity line, which says the cookie is the per-person choice "until F-096's per-person preferences
   store", is updated (exact text in the plan's Task 8). Roadmap tracker: F-096 part 1 done.

No backfill: every existing person has NULL and keeps today's behaviour until they choose.
