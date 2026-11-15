# Google Calendar busy times (S-22)

Audience: danlo (Google Cloud and Vercel steps) and the orchestrator (rotation,
reading a connection's health). Plan:
`docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md`.

## 1. What it is

An account's Owner (or the agency, on their behalf) connects one Google
account from the Calendar page. BIS asks Google for `openid`, `email` and
`calendar.freebusy` only: it sees WHEN the owner is busy on their main
calendar, never what an event is. Those times are then not offered to
customers (booking page and Sofía; slice 1 is read-only).

Stored, per account, in `public.google_calendar_connections` (service role
only, RLS on with no policy): the Google email, the granted scope, the
health of the link, and the refresh token SEALED with AES-256-GCM under
`GOOGLE_CALENDAR_TOKEN_KEY`. The key lives in the environment, never in the
database; the sealed value is bound to its row (account, id, version), so a
copy on any other row does not open. Access tokens are never stored.

Code: `apps/web/src/lib/google/` (`calendar-client.ts`, `token-seal.ts`,
`oauth-state.ts`, `oauth-routes.ts`), the routes
`/api/google-calendar/connect` and `/api/google-calendar/callback`, and
`disconnectGoogleCalendarAction` beside the Calendar page.

**Never call Google from a script, a test or a REPL.** Every function in
`calendar-client.ts` takes `fetch` as an argument; tests hand it a fake and
make the global `fetch` throw. Agents never call Google at all. The only
real calls are a person pressing Connect or Disconnect, and (from PR 4) a
booking read.

## 2. The environment (five names, `.env.example`)

| Name | What | Sensitive |
|---|---|---|
| `GOOGLE_CALENDAR_CLIENT_ID` | the OAuth Web client's id | no |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | its secret | yes |
| `GOOGLE_CALENDAR_TOKEN_KEY` | 32 random bytes, base64url | yes |
| `GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS` | the key before a rotation; unset otherwise | yes |
| `GOOGLE_CALENDAR_REDIRECT_URI` | the exact callback URI registered on the client | no |

**Dormant unless all four of id, secret, key and redirect URI are set and
sound.** A key under 32 bytes, a fixture value in production, or a redirect
URI that is not https (http is allowed on localhost only) leaves the feature
off: no card, both routes answer 404, nothing calls Google. A refused value
logs one line naming the variable, never its value.

One Google Cloud project, two Web clients. Production holds the production
client (`https://app.bis-rgv.com/api/google-calendar/callback`). Preview and
`apps/web/.env.local` hold the development client and their OWN key each,
against bis-ci. Never put a production value in Preview
(`production-isolation.md`). In Vercel: Remove-then-Add on an existing name,
then redeploy. Generate a key without echoing it:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,
piped straight into `vercel env add`.

Google matches the redirect URI exactly (scheme, host, port, path, no
trailing slash) and allows no wildcard, and the connect's nonce cookie is
bound to that host. So Connect works only on the page at the redirect URI's
origin: a per-push Preview URL is sent back to the Calendar page with
`?google=failed`; use the stable Preview alias registered on the
development client.

## 3. Google Cloud setup (danlo, once; labels as of 2026-11, check as you click)

1. console.cloud.google.com > New project "BIS Platform".
2. APIs & Services > Library > "Google Calendar API" > Enable.
3. Google Auth Platform > Get started: app name "BIS", support email,
   Audience **External**, contact email.
4. Audience: leave Publishing status at **Testing** (never "Publish app" in
   slice 1). Test users: your own address, later each pilot owner's (100 max).
5. Data access > add `openid`, `.../auth/userinfo.email`,
   `.../auth/calendar.freebusy`. Note whether `calendar.freebusy` is filed as
   sensitive and tell the orchestrator.
6. Branding: authorized domain `bis-rgv.com`.
7. Clients > Create client > Web application "BIS web (production)",
   redirect URI `https://app.bis-rgv.com/api/google-calendar/callback`.
8. A second Web client "BIS web (development)": redirect URIs
   `http://localhost:3000/api/google-calendar/callback` and the stable Preview
   alias's `/api/google-calendar/callback`.
9. Vercel env as in section 2. Production only after the busy-blocks PR (PR 4)
   has merged.

## 4. Reading a connection's health

Read only; never select `refresh_token_sealed`:

```sql
select account_id, google_email, status, needs_reconnect_since, last_checked_at,
       refresh_expires_at, key_version, version, connected_at
from public.google_calendar_connections;
```

- `status = 'connected'`: BIS can read busy times. `last_checked_at` is the
  last successful read (stamped at most every 10 minutes).
- `status = 'needs_reconnect'`: Google refused the refresh token
  (`invalid_grant`). Bookings carry on exactly as before the feature (owner
  answer Q1: no Google answer means today's slots), and the card says
  "Needs reconnecting". The owner presses Reconnect; nothing else fixes it.

Why a token dies: **in Testing mode every connection expires after 7 days**
(Google's rule for External apps in Testing; only verification removes it),
the person removed BIS at myaccount.google.com, six months unused, more than
100 tokens for one client and Google account, or an admin restriction.

The callback lands on the Calendar page with `?google=connected`, `denied`
(the person pressed Cancel or unticked the calendar box; nothing written, the
grant revoked) or `failed` (the exchange or the write failed; logs say which
by Google's error code only). A refused state (expired after 10 minutes, a
different browser, another user) lands on `/`.

## 5. Rotating the token key

1. Generate a new key (section 2). In each environment separately: set
   `GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS` to the CURRENT key, then
   `GOOGLE_CALENDAR_TOKEN_KEY` to the new one; redeploy.
2. Rows keep opening under the previous key; each reconnect re-seals under
   the new one. `key_version` names the key (an id derived from it), so
   `select key_version, count(*) from public.google_calendar_connections group by 1`
   shows how many rows still need the old key.
3. When none do (or after asking those owners to reconnect), remove
   `_PREVIOUS` and redeploy. A row whose key is gone cannot be read; Disconnect
   still deletes it (it cannot revoke at Google without the token).

If a key LEAKED, rotation is not enough (the old key still opens old rows):
remove both values, rotate the client secret in Google Cloud, and ask every
connected owner to reconnect.

## 6. Disconnect

Disconnect (the agency or the Owner) revokes the refresh token at Google,
then deletes the row, even when the revoke fails (logged by error code). It
has no Undo: undoing would need the revoked token. It works while the account
is paused for billing.
