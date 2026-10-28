# The owner's calendar feed (F-048 part 2)

**Status:** draft for the owner's review, 2026-10-28. Nothing here is built.
**Branch:** `feat/calendar-feed`, off `main` at `e1d1c831`. **Migration:** `0104_calendar_feeds.sql`.
0103 is on the contacts-archive branch and goes to bis-ci first, so 0104 goes to bis-ci after it.
**Sources:** `docs/crm-features.md` §4.4, the row "F-048 (part: the owner's calendar feed)" (:1418);
§5.5 (:2022-2049); §7.1 (:2967-2968, "The calendar feed needs no review"); the integrations table (:2932);
the summary (:130-135); H17 (:3493). DESIGN.md (the module contract, rules 5, 6 and 8, and the 7 AM voice).

The roadmap row, verbatim (`docs/crm-features.md:1418`):

> Proposal. A private, revocable link per person, in both languages, that Apple, Google and Outlook
> calendars subscribe to: every BIS booking on the owner's own phone, with the time, the service and the
> customer's first name only. It needs no Google review and no Microsoft admin, and it is the only route
> for an owner whose calendar is the iPhone's own. One-way: the owner's own events do not block Sofía's
> slots until S-22. It can refresh fastest on Apple devices: as often as every 15 minutes when the
> iPhone's fetch setting is an interval, though only while it charges on Wi-Fi when the setting is
> Automatic, and only by hand when it is Manual; Outlook refreshes a subscribed feed about every 3 hours
> on Outlook.com and 6 on Outlook on the web, though it can take more than 24 hours (Microsoft), and
> Google publishes no interval, with users reporting 8 to 24 hours; a Google user adds the feed once from
> a computer, not the phone app. So the booking alert email, and the text once A2P clears, stays the
> prompt channel, and S-22 is the real-time answer

The refresh numbers in this spec are the roadmap's, with the roadmap's own citations (:2932: Apple
`support.apple.com/guide/iphone/change-calendar-settings-iphc37be2016/ios`, Microsoft
`support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web`,
Google `support.google.com/calendar/answer/37100`). This spec verified none of them again. Every other
claim about Apple, Google or Outlook is labelled **ASSUMPTION**.

## 0. What the code says (verified 2026-10-28, and where the brief's leads were off)

| Lead | What the source says |
|---|---|
| Booking data in `booking.ts`, migrations 0016/0017 | Yes. `bookings` is in `0016_booking.sql:29-53`, with `status` in `booked/cancelled/completed/no_show` (:38-39) and `updated_at` (:52). 0017 makes every booking FK `on delete restrict` (`0017_booking_fk_and_policy_scope.sql:27-37`). Policies are `to authenticated` (0017:8-16). |
| "The service" | **No booking has a service today.** The booking columns are `booking.ts:131-135` and 0016:29-53; F-047's services are still "later" (`crm-features.md:1512`), and `voice_services` (0095:99) is Sofía's price list, not linked to a booking. The only per-calendar "what kind" fact is `calendars.meeting_type` (`0022_meetings_followups.sql:3-4`: `in_person`, `phone`, `video`). §4.3 uses it until F-047 lands. |
| A customer `.ics` to reuse | Yes: `apps/web/src/lib/booking/ics.ts` (`bookingIcs` :98, `bookingUid` :43, UTF-8 octet folding `fold` :78, TEXT escaping `text` :59), wrapped by `lib/booking/calendar-file.ts:32` and served at `app/b/[publicId]/ics/[token]/route.ts:29`. It writes ONE VEVENT; the feed needs many, so §4.1 splits it. |
| "Move in place" keeps the UID | The move is NOT in place in the database. `moveBooking` inserts a NEW row naming the old one (`rescheduled_from_id`, 0061:21-23) and cancels the old row (`booking.ts:746-800`, :857-862). The UID comes from the chain's first row (`rescheduleChain`, `booking.ts:719-733`; `calendar-file.ts:52-53`). So a feed must drop the superseded, cancelled rows, or one appointment carries two VEVENTs with one UID. |
| S-01 staff and roles shipped | Yes: roles `owner/staff` (0066:34-37), `technician` (0068:32-33); `users.language` `en/es`, NULL = follow the account (0066:47); `resolveLocale` (`lib/i18n/locale.ts:12-19`). |
| Technicians see only assigned customers | Yes, through `contacts.assigned_to`; `bookings_technician_scope` (0068:110-121) admits a booking only when its `contact_id` is in `app.my_contact_ids()` (0068:83-88). That is RLS: the feed reads with the service role, so it must apply the same fence itself (§2.4). |
| Time zones on `accounts` | Yes: `accounts.timezone not null default 'America/Chicago'` (0001:26). The feed does not need it (§4.2). |
| Next migration 0104 | Yes: the newest on main is `0102_jobs.sql`; 0103 is on another branch. |
| Token-addressed public reads | The vault share link stores only `sha256(token)` (0085:50-51, 93-95) and claims each download in one locked, service-only function (0085:104-142). The document-request link DERIVES its token from the row id under a server key so staff can copy it again (`lib/document-requests/token.ts:3-24`). The proxy never runs Clerk on a path with a dot in it (`proxy.ts:39`). |

## 1. Scope

**In:** one private, revocable feed link per person per account; a public `GET /cal/<token>.ics`; the
booking card on the Calendar page where a person makes, copies, turns off and replaces their link, with
instructions for the iPhone, Google and Outlook in English and Spanish; "last checked" on the card.

**Not in:** anything two-way (S-22). The owner's own events never block a slot; nothing here reads a
calendar. No per-staff calendars (S-23, decision 4: there is still one calendar per account,
`0016_booking.sql:10-11`). No job address or service name (F-047). No feed for agency operators (§2.5).
No push: a feed is pulled, and the booking alert stays the prompt channel.

## 2. Token model

### 2.1 Recommendation: a derived token, stored as its hash, one live feed per membership

`calendar_feeds`, one row per link ever made:

```
id uuid primary key                      -- minted by the app (randomUUID) so it can derive the token first
account_id uuid not null
user_id uuid not null
foreign key (account_id, user_id) references memberships (account_id, user_id) on delete cascade
token_hash text not null unique          -- sha256 hex of the token, 64 chars, 0085:50-51's check
created_by text not null                 -- the Clerk id of whoever made it (always the person themselves)
created_at timestamptz not null default now()
revoked_at timestamptz                   -- turned off or replaced; Undo clears it inside the window
last_fetched_at timestamptz              -- §5.3
fetch_window_started_at timestamptz      -- §3.2's per-link limit
fetch_count integer not null default 0 check (fetch_count >= 0)
unique index calendar_feeds_one_live on (account_id, user_id) where revoked_at is null
```

**The token** is `HMAC-SHA256(key, "calendar-feed:v1:" + id)`, base64url, 43 characters, the exact shape of
`requestToken` (`lib/document-requests/token.ts:20-22`) so `isTokenShape` (:23) and `tokenHash` (:24) serve
it. The key is `CALENDAR_FEED_SECRET`, at least 32 characters, with no fallback, mirroring
`DOCUMENT_LINK_SECRET` (:14-18). Open question 2 covers whether to use a separate secret.

Why derived and not random-and-shown-once (the vault share's choice, `share-token.ts:11`): a share link lives
24 hours and is sent once. This link lives for years, and the same person adds it to a second device
months later. Show-once would make them replace it, which kills the first device's copy. Derivation lets
the card show it again, and the database still never holds the token. Reading the table gives you
nothing without the key, and the key alone gives you nothing without a row id.

Why the route needs no key: it looks the token up BY HASH, as the share does (`public-share.ts:29-33`).
Rotating the secret therefore does not end any link. It only means the card can no longer re-derive a
link whose hash no longer matches, and the card shows "Make a new link" for it (§5.1). To end every link
at once, revoke the rows (the runbook line in §7).

**One feed per person per account** is the partial unique index. Membership is unique per
`(account_id, user_id)` (0066:39), and that same key is what the FK references, so no new constraint is
needed on `memberships`.

### 2.2 Turn off, replace, Undo

DESIGN.md rule 6: reversible actions run at once with an Undo toast. Both actions qualify, because a
derived token comes back with its row:

- **Turn off** sets `revoked_at`. Undo clears it, as long as no other live row exists and less than 30
  seconds have passed (the window the toast holds).
- **Make a new link** does both steps in ONE service-only function (`replace_calendar_feed`): it revokes
  the live row and inserts the new one, which the app has derived first. Undo (`restore_calendar_feed`)
  deletes the new row and un-revokes the old one, in one function, only while the new row is the live
  one. This is the share links' restore shape (`document-shares.ts:153`).

Revoked rows stay (they are a few bytes and hold no token). They go with the membership.

### 2.3 Leaving, losing a role, a paused or deleted account

| Event | What happens to the link | Mechanism |
|---|---|---|
| Removed from the team | Gone at once | `remove_account_member` deletes the membership (0066:158); the FK cascade deletes every feed row. Re-inviting them makes a new membership and no link. |
| Role changes (Owner → Technician, say) | Stays, and its scope follows the NEW role at the next fetch | The role is read on every fetch, never stored on the feed (§2.4). |
| Client access switched off by the agency | 404 while off, back when on | Checked on every fetch, as the sign-in is (`auth.ts:72`). Otherwise the feed would be a door that outlives the switch. |
| Billing pause (M7a) | Keeps serving; the person can still turn the link off, replace it and Undo, but cannot make a first link | A pause makes the account read-only and never refuses a GET (`auth.ts:44-52`), so the bookings stay visible. Turning off, replacing and Undo are protective (a leaked link must be closable while paused), so their three actions opt out of the pause with `duringPause: "allow"` and sit on `READ_ONLY_ALLOWED` (`lib/billing/read-only.test.ts:148`). Making a first link is an ordinary write and stays refused (coordinator decision, plan review I3). |
| Account deleted | Gone | FK `on delete cascade` on `account_id`; `calendar_feeds` is added to `ACCOUNT_OWNED_TABLES` before `bookings` (`account-teardown.ts:21-24` pattern). |
| User row deleted | Gone | memberships cascade from users (0066:40-44), and feeds cascade from memberships. |

### 2.4 Re-proved on every fetch, in one round trip

`claim_calendar_feed_fetch(p_token_hash text, p_max int, p_window_seconds int) returns jsonb`, security
definer, `search_path = ''`, EXECUTE for `service_role` only (0085:143-144's grant shape). Under
`for update` on the feed row it checks, and answers `not_found` on the FIRST failure:

1. a row with this hash exists and `revoked_at is null`;
2. `memberships` has `scope = 'account'` for `(account_id, user_id)`, and the function reads `role` from it;
3. `accounts.client_access_enabled` is true;
4. the per-link window (§3.2), answering `rate_limited` when it is exceeded;

then it stamps `last_fetched_at` (at most once a minute, §5.3) and returns
`{status:'ok', feed_id, account_id, user_id, role, user_language}`. Both NULLs are coalesced (memory:
plpgsql NULL guard): a missing role is `not_found`, never "sees all".

The app then reads the bookings with that `account_id`, and with `role = 'technician'` it adds
`contacts.assigned_to = user_id`, which is `bookings_technician_scope`'s rule (0068:113-118) restated.
Every read carries the FEED ROW's account, never anything from the URL. This mirrors the share's rule that
"every later read carries the TOKEN ROW's account" (`public-share.ts:13-19`).

### 2.5 Who can have a link

Every client member: Owner, Staff and Technician. Staff and Owners see the whole calendar; a Technician
sees only the bookings of customers assigned to them (open question 1). **Not the agency:** an operator
holds no client membership (`auth.ts:63`), so the FK has nothing to reference. Their card explains that
each person on the business's team makes their own link.

### 2.6 RLS and grants

RLS on, no policy. `revoke all on calendar_feeds from anon, authenticated`; `grant select, insert, update,
delete … to service_role`. This is 0053's server-only pattern and 0085:93-95's shape. The card reads
through server code after `requireAccountAccess`, keyed by the caller's OWN user id. No client token ever
reads this table, because nothing on it is anyone else's business. `schema-grants-guard.test.ts`'s
`EXPECTED_WRITES` (:65) gains the table, service_role only. The functions are `claim_calendar_feed_fetch`,
`create_calendar_feed`, `replace_calendar_feed`, `revoke_calendar_feed` and `restore_calendar_feed`, all
EXECUTE `service_role` only.

## 3. The route

### 3.1 `GET /cal/<token>.ics`

`apps/web/src/app/cal/[file]/route.ts`. A route segment cannot be `[token].ics`, so the segment is the
whole file name: the route requires the `.ics` suffix and strips it, then runs `isTokenShape`. Because the
path holds a dot, the proxy never runs Clerk on it (`proxy.ts:39`), so a signed-in browser gets no
handshake, which is the embed lesson in `proxy.ts:10-27`. Pin that with a matcher test. `dynamic =
"force-dynamic"`. **HEAD** answers the same headers with no body (ASSUMPTION: some subscribers probe with
HEAD; a test pins Next's behaviour, and we export `HEAD` explicitly if the test shows Next does not
derive it).

Answer, in order:

1. Wrong shape or suffix: **404**.
2. `claim_calendar_feed_fetch` answers `not_found`: **404**, the SAME body and headers. An unknown token,
   a turned-off one, a removed person and an account with access off are indistinguishable, so nobody
   learns whether a token ever existed. Each costs one indexed lookup. The 404 is
   `Cache-Control: no-store`, `X-Robots-Tag: noindex`, as `ics/[token]/route.ts:25-27` does.
3. `rate_limited`: **429** with `Retry-After` (`lib/http/retry-after.ts`).
4. A read throws: **500** `no-store`, logged with the feed id and never the token
   (`ics/[token]/route.ts:51-53`'s shape). ASSUMPTION: a subscriber keeps its last good copy on an error.
5. **200**, with:
   - `Content-Type: text/calendar; charset=utf-8`
   - `Content-Disposition: inline; filename="bookings.ics"`
   - `Cache-Control: private, no-cache`. `private`: no shared cache, Vercel's CDN included, may store a
     person's bookings. `no-cache`: every refresh revalidates.
   - `ETag: W/"<first 32 hex of sha256(body)>"`. With a matching `If-None-Match` the answer is **304**,
     no body. The body is deterministic for the same data because DTSTAMP is the booking's
     `updated_at` and not "now" (§4.2).
   - `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.

### 3.2 Abuse limits

- **Guessing** is closed by the token itself: 256 bits, looked up by hash.
- **Per link:** at most **120 fetches per rolling hour**, counted in the claim function. Apple's fastest
  interval is 15 minutes (roadmap), which is 4 an hour for each device, so 120 leaves room for a person
  with several devices and calendars and still stops a leaked link being used as a load generator.
- **No per-address limit.** ASSUMPTION: Google and Microsoft fetch from shared server pools, so one IP
  carries many people's feeds, and a per-IP limit would cut off honest people. If unknown-token traffic
  ever matters, a Vercel Firewall rule on `/cal/` is the place for it (a proposal for bis-platform, §7).
- **Size:** the window is starts_at in **[now − 30 days, now + 180 days)**, read as two bounded queries:
  at most **1,500 upcoming** (ascending from now) and **300 past** (descending from now). Booking up to 365
  days ahead is possible (0016:18), so anything past day 180 is left out by design; the card says
  "the next six months". When a cap is hit, the route logs it with the feed id and the count. A test
  pins the body of a full feed (1,800 events at the longest name) under 1 MB (ASSUMPTION: no subscriber
  documents a limit; 1 MB is a conservative ceiling).

### 3.3 Leaks this route accepts, stated

The token is in the URL, so Vercel's request log records it, as it does for `/d/<token>`
(`token.ts:9-10`). Google and Microsoft store the URL on their side once a person subscribes. Both are the
price of a subscribable link, and both are why the content is minimal (§4) and why revoking it is one tap.

## 4. Content

### 4.1 The builder

Split `ics.ts`. Its private `utcStamp`, `text`, `uri` and `fold` (:51-96) become shared by:

- a new `calendarFeedIcs({ name, events })`: one VCALENDAR with `PRODID`, `VERSION:2.0`,
  `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, `NAME` (RFC 7986) and `X-WR-CALNAME`, both as escaped TEXT,
  `REFRESH-INTERVAL;VALUE=DURATION:PT15M` (RFC 7986) and `X-PUBLISHED-TTL:PT15M` (ASSUMPTION: these are
  hints that some clients honour and none is bound by), then one VEVENT per event;
- `bookingIcs`, unchanged in output. `ics.test.ts:38-153` pins it, and that suite must stay green
  untouched.

Every line of a feed is folded at 75 octets without splitting a UTF-8 character (:73-96), and every line
ends in CRLF. Invalid input fails CLOSED per event: an event with a NaN or inverted time is left out and
logged, and never sinks the whole feed (`ics.ts:23`'s rule, applied per row).

### 4.2 One VEVENT per appointment, never per row

The query reads `status in ('booked','completed','no_show')`, so cancelled rows never enter. Then:

- **UID** = `bookingUid(rootId)` (`ics.ts:43`), the chain's first row. That is the customer file's UID,
  so a reschedule keeps the event's identity. Chains are resolved in BATCHES, never with
  `rescheduleChain` per row (that is one query per hop per booking, `booking.ts:719-733`). A new
  `rescheduleRoots(db, accountId, ids)` in `booking.ts` walks every unresolved parent at once, one
  account-scoped `id in (…)` query per hop, bounded by `RESCHEDULE_CHAIN_MAX` (:708). It must agree with
  `rescheduleChain` row for row (a test).
- **SEQUENCE** = the chain depth, as the customer file has it (`calendar-file.ts:53`).
- **Two live rows with one UID** is `moveBooking`'s accepted failure mode ("two live is visible",
  `booking.ts:870-873`). The deeper row is kept, the tie goes to the later `created_at`, and the duplicate
  is logged with both ids. A calendar never sees one UID twice.
- **Cancelled appointments are DROPPED, not sent as `STATUS:CANCELLED`.** A subscribed feed is a snapshot
  that replaces what the client held (ASSUMPTION about all three apps), so an absent event disappears.
  `STATUS:CANCELLED` is defined for iTIP updates (RFC 5546), and how each app shows it in a subscription
  is unverified (ASSUMPTION: some show it as a normal event). The cancel already reaches the owner by
  the alert and the dashboard.
- **DTSTART/DTEND are UTC instants**, with no TZID and no VTIMEZONE, for `ics.ts:6-15`'s reason: the slot
  engine already resolved the instant, and a second copy of the zone rules could move it by an hour. The
  phone shows the instant in the phone's own zone, which is right for an owner who travels.
- **DTSTAMP** = the row's `updated_at` (0016:52), so the same data gives the same bytes and the ETag
  works. RFC 5545 asks for DTSTAMP to be when the object was created in a METHOD'd object, and
  `updated_at` is when this version was.
- `TRANSP:OPAQUE`, `STATUS:CONFIRMED`.

### 4.3 What an event says (data minimisation)

- **SUMMARY** = `<kind>: <first name>`, with the kind from `calendars.meeting_type` until F-047 gives
  bookings a service. EN: "Appointment: Maria", "Phone call: Maria", "Video call: Maria". ES: "Cita:
  María", "Llamada: María", "Videollamada: María". A `no_show` gets a lead word: "No-show · Appointment:
  Maria" / "No se presentó · Cita: María". `completed` reads as booked. When F-047 ships, the service name
  replaces the kind word; that is a one-line change in the strings module.
- **First name** = the first whitespace-separated word of `contacts.first_name` (`contacts.ts:79`), at
  most 40 code points. It falls back to "Customer" / "Cliente" when that word is empty, holds a digit or
  an `@` (a phone or email typed into the name box; the seeded Name field already takes full names,
  `crm-features.md:817`), or is a stand-in from #301's list.
- **DESCRIPTION** = one line, "Open in BIS: <origin>/dashboard/accounts/<id>/calendar" / "Ver en BIS: …".
  That page needs a sign-in, so the link reveals nothing more.
- **Never:** last name, phone, email, the booking note (free text, often the customer's own words), the
  booker's zone, the cancel token, the meeting URL (open question 3) or any address. No `ORGANIZER`
  and no `ATTENDEE`, because those make some apps offer to email the customer (ASSUMPTION).
- **Calendar name:** "<brand> bookings" / "Citas de <brand>", from `brandDisplayName`, never
  `accounts.name` (working rule 8). Without a brand: "Bookings" / "Citas".

### 4.4 Language

Each fetch reads `users.language`, then `accounts.language`, then English (`resolveLocale`,
`locale.ts:12-19`). A person who switches language sees the feed follow at their calendar's next refresh.
One feed is in one language, end to end (DESIGN.md, "A customer's language", applied to the person). The
strings live in a new `lib/booking/feed-strings.ts`, EN and ES, under the `INTERNAL_MILESTONE` guard.

### 4.5 What a Technician sees

Only bookings whose customer is assigned to them right now (§2.4), with the same fields. A customer who is
reassigned leaves their feed at the next fetch. Their card says so in one sentence (§5.1).

## 5. Settings UI and observability

### 5.1 Where: one card on the Calendar page

The module contract allows "one settings section" or "a card on" an existing surface, and adds no new
top-level surface. The card goes on the Calendar page because every role reaches that page:
`requireAccountAccess` (`calendar/page.tsx:55`) and the Technician nav (`nav-groups.ts:117`). The owner-only
settings form is hidden from Staff (`page.tsx:51-54`), so the card sits OUTSIDE that form. Each person sees
only their own link. The card registers in the ⌘K palette as "Bookings on your phone" / "Tus citas en el
teléfono" (DESIGN.md: settings sections are registered). It has ONE primary per state, by rule 8.

| State | What it shows |
|---|---|
| Loading | None of its own: the view is read in the page's server render and arrives with the page (plan deviation 9). |
| Empty | "Put every booking on your phone's calendar: iPhone, Google or Outlook. You get your own private link." Primary **Make my link**. / "Pon cada cita en el calendario de tu teléfono: iPhone, Google u Outlook. Tienes tu propio enlace privado." **Crear mi enlace**. |
| Live | The link in a read-only field. Primary **Copy link** / **Copiar enlace**. Ghost **Add to iPhone** / **Agregar al iPhone** (`webcal://` + host + path; ASSUMPTION: iOS offers Subscribe for a webcal link). Ghost **Make a new link** / **Crear un enlace nuevo** and **Turn off** / **Desactivar**, each run at once with Undo (§2.2). The line "Anyone with this link can see your booking times and your customers' first names. Don't share it." / "Quien tenga este enlace puede ver las horas de tus citas y el nombre de tus clientes. No lo compartas." The line "Shows the last 30 days and the next six months." / "Muestra los últimos 30 días y los próximos seis meses." The instructions (§5.2), closed until tapped. |
| Live, Technician | Adds: "Your link shows bookings for the customers assigned to you." / "Tu enlace muestra las citas de los clientes asignados a ti." |
| Link can't be shown again | The secret changed (§2.1): "Your link needs to be made again. The old one keeps working until you do." / "Tu enlace se tiene que crear de nuevo. El anterior sigue funcionando hasta que lo hagas." Primary **Make a new link**. |
| Agency | "Each person on the business's team makes their own link here." / "Cada persona del equipo del negocio crea aquí su propio enlace." No button. |
| Error | "We couldn't load your link. Try again." / "No pudimos cargar tu enlace. Inténtalo de nuevo." The card's own boundary, so the page stands (rule 5). |
| Not set up | No `CALENDAR_FEED_SECRET`: "Phone calendars aren't available yet." / "Los calendarios del teléfono aún no están disponibles." No button. |

Toasts: "New link made. Your old link stopped working." / "Enlace nuevo creado. El anterior dejó de
funcionar." with **Undo** / **Deshacer**, and "Link turned off." / "Enlace desactivado." with Undo.

### 5.2 Instructions, both languages (the 7 AM read)

The menu paths are ASSUMPTIONS. The build checks each one against the vendor's page that day and files any
correction as a copy change. The "from a computer" fact and the refresh times are the roadmap's.

**iPhone.** 1. On your iPhone, open this page and tap **Add to iPhone**. 2. Tap **Subscribe**, then
**Done**. To see new bookings sooner, open **Settings › Apps › Calendar › Calendar Accounts › Fetch New
Data** and choose **Every 15 Minutes**.
*ES:* 1. En tu iPhone, abre esta página y toca **Agregar al iPhone**. 2. Toca **Suscribirse** y luego
**OK**. Para ver antes las citas nuevas, abre **Ajustes › Apps › Calendario › Cuentas de calendario ›
Obtener datos** y elige **Cada 15 minutos**.

**Google Calendar.** 1. On a computer, go to calendar.google.com. The phone app can't add it. 2. Next to
**Other calendars**, click **+**, then **From URL**. 3. Paste your link and click **Add calendar**. It
shows up on your phone by itself.
*ES:* 1. En una computadora, entra a calendar.google.com. La app del teléfono no puede agregarlo. 2. Junto
a **Otros calendarios**, haz clic en **+** y luego en **Desde URL**. 3. Pega tu enlace y haz clic en
**Agregar calendario**. Aparece solo en tu teléfono.

**Outlook.** 1. Go to outlook.com and open **Calendar**. 2. Click **Add calendar**, then **Subscribe from
web**. 3. Paste your link, give it a name and click **Import**.
*ES:* 1. Entra a outlook.com y abre **Calendario**. 2. Haz clic en **Agregar calendario** y luego en
**Suscribirse desde la web**. 3. Pega tu enlace, ponle un nombre y haz clic en **Importar**.

**Below all three:** "New bookings can take a few hours to show up on Google and Outlook, sometimes a
day. The email for each booking still comes right away." / "Las citas nuevas pueden tardar unas horas en
aparecer en Google y Outlook, a veces un día. El correo de cada cita sigue llegando al momento."

### 5.3 Observability: "last checked"

`last_fetched_at`, stamped by the claim function on every fetch, costs nothing beyond the claim's existing
row lock. It is stamped BEFORE the bookings are read, so a fetch that then fails (a 500) still counts: it
records when a calendar last ASKED, not when it last got a good copy. The card says so in its words: "Your
calendar last asked for your bookings 12 minutes ago." / "Tu calendario pidió tus citas por última vez hace
12 minutos."
Before any fetch: "No calendar has used this link yet. Google can take up to a day." / "Ningún calendario
ha usado este enlace todavía. Google puede tardar hasta un día." **Deferred:** naming which app fetched,
from the User-Agent (ASSUMPTION: the vendors' UA strings are stable enough to classify). It is cheap, but
it adds a column and a classifier with no proven need.

## 6. Tests and mutation probes

Each probe must make the named test fail BY NAME (working rule 2). A `-t` filter that matches no test does
not count.

| # | Test (file) | It proves | Mutation that must fail it |
|---|---|---|---|
| 1 | Token hash (`lib/booking/feed-token.test.ts`) | The token derived from an id hashes to the stored value. A token one character different, or the right token for another row, is `not_found`. The DB row never contains the token (assert across every column). | Store the token instead of its hash; derive without the id (a constant input). |
| 2 | Cross-account isolation (`packages/db/src/test/calendar-feeds.test.ts`) | A SECOND account with its own bookings: account A's token never returns a B booking, even when B's booking id is the parent of an A row's `rescheduled_from_id` (which the composite FK should refuse; the test proves `rescheduleRoots` is account-scoped regardless). | Drop `.eq("account_id", …)` from the feed query, or from one `rescheduleRoots` hop. |
| 3 | Revoked token (db + route) | Turn off → 404. Undo → 200 with the same body. Make a new link → the old one is 404 and the new one 200. The 404 body and headers are byte-identical for unknown, revoked, removed member and access off. | Skip the `revoked_at` check in the claim; give revoked a different status (410). |
| 4 | Removed member (db) | `remove_account_member` → the feed row is gone (cascade) → 404. Re-adding the member gives no link. | FK without `on delete cascade`, with no check for a current membership in the claim. |
| 5 | Technician scope (db + `lib/booking/calendar-feed.test.ts`) | Technician T, customers C1 (assigned to T), C2 (assigned to Staff S) and C3 (unassigned): T's feed has C1 only. Change T to Staff → all three. Change S's customer to T → it appears at the next fetch. | Read the role once at link creation; filter on `sees_all` using `!== "technician"` with a NULL role (it must fail closed). |
| 6 | Folding and escaping (`lib/booking/ics.test.ts`, new `describe`) | First names and a brand with `;`, `,`, `\`, CR, LF and "ñ" at the 75th octet: no injected property, unfold-then-unescape gives the text back, no line over 75 octets, every line CRLF. | Fold by characters, not octets; drop the LF escape; join with `\n`. |
| 7 | Line length on a whole feed (same file) | A 1,800-event feed: every physical line ≤ 75 octets, under 1 MB, one `BEGIN:VCALENDAR`, balanced `BEGIN/END:VEVENT`. | Remove `fold` from the feed path only (`bookingIcs` keeps it, so the old suite stays green and only this test fails). |
| 8 | A reschedule keeps the UID (db + feed) | Book, then `moveBooking`, twice: the feed has ONE event, UID = `bookingUid(root)`, SEQUENCE 2, at the new time. The two cancelled ancestors are absent. | UID from the row's own id; include `cancelled` in the status filter (two VEVENTs, one UID). |
| 9 | `rescheduleRoots` agrees with `rescheduleChain` (`booking.test.ts`) | Root and depth are equal for every row of a 3-deep chain and a 0-deep one. It uses ≤ depth + 1 queries (a counting stub). | One query per row (the count assertion). |
| 10 | Determinism and the ETag (route test) | Same data → same body and ETag; `If-None-Match` → 304 with no body. A status change → a new ETag. | DTSTAMP from `new Date()`. |
| 11 | Data minimisation (`feed-content.test.ts`) | A contact with every field set (last name, phone, email, note, a meeting URL): the body contains none of them. "Maria Lopez" → "Maria". "956-555-0100" or `a@b.co` as first name → "Customer". | Pass `first_name` through whole; add the note to DESCRIPTION. |
| 12 | Language (`feed-content.test.ts`) | `users.language = 'es'` on an English account → every string in the body is Spanish. NULL → the account's. Neither → English. | Read the account first. |
| 13 | Status set | A booked, a completed and a no-show row appear (the no-show with its lead word). A cancelled row with no successor is absent. | Drop `no_show` from the filter. |
| 14 | Rate limit (db) | The 121st fetch in the hour is `rate_limited`, then `ok` once the window passes. `p_max < 1` raises (0085:113-115's guard). | `>` for `>=` at the boundary. |
| 15 | Proxy (`proxy.test.ts`) | `/cal/<43 chars>.ics` is not matched by the Clerk matcher. | Remove the `.*\\..*` clause. |
| 16 | Grants (`schema-grants-guard.test.ts`, `calendar-feeds-grants.test.ts`) | `anon` and `authenticated` can neither read nor write the table, and only service_role executes the five functions. | Grant `select` to authenticated. |
| 17 | Copy guards (`feed-strings.test.ts`, `messages.test.ts`) | EN/ES parity; `INTERNAL_MILESTONE`; no `{{`; no arrows. | Put "F-048" in a string. |
| 18 | e2e (`apps/web/e2e/calendar-feed.spec.ts`) | On the PER-RUN FIXTURE ACCOUNT only: make a link, fetch it with the request API, the fixture booking is in it, turn off, 404, Undo, 200. Never `Test Client One`. | — (bis-e2e-qa runs it). |

## 7. Tasks

Tiers follow the speed process: per task, high = security or schema.

| # | Wave | Tier | Owner | Files (disjoint within a wave) | What |
|---|---|---|---|---|---|
| T1 | 1 | high | bis-db-schema | `packages/db/supabase/migrations/0104_calendar_feeds.sql`; `packages/db/src/test/calendar-feeds-grants.test.ts` (new); `packages/db/src/test/schema-grants-guard.test.ts`; `packages/db/src/account-teardown.ts` | §2's table, index, FKs, five functions, grants and rollback block. Grants tests pre and post on the local PG18 replica. Apply order: bis-ci after 0103, then production, then parity (orchestrator). |
| T2 | 1 | medium | bis-booking | `apps/web/src/lib/booking/ics.ts`; `apps/web/src/lib/booking/ics.test.ts`; `apps/web/src/lib/booking/feed-content.ts` (new); `apps/web/src/lib/booking/feed-content.test.ts` (new); `apps/web/src/lib/booking/feed-strings.ts` (new); `apps/web/src/lib/booking/feed-strings.test.ts` (new) | Pure: split the builder (§4.1), events from rows (§4.2-4.4). Tests 6, 7, 11, 12, 13 (pure half), 17. |
| T3 | 2 | high | bis-booking | `packages/db/src/calendar-feeds.ts` (new); `packages/db/src/booking.ts` (`rescheduleRoots`, `listFeedBookings`); `packages/db/src/index.ts` (additive exports); `packages/db/src/test/calendar-feeds.test.ts` (new); `packages/db/src/test/booking.test.ts` | Typed wrappers for the five functions; the bounded two-query window with the Technician filter. Tests 2, 3, 4, 5, 8, 9, 14. |
| T4 | 3 | high | bis-booking | `apps/web/src/lib/booking/feed-token.ts` (new); `apps/web/src/lib/booking/feed-token.test.ts` (new); `apps/web/src/lib/booking/calendar-feed.ts` (new, takes a client); `apps/web/src/lib/booking/calendar-feed.test.ts` (new); `apps/web/src/app/cal/[file]/route.ts` (new); `apps/web/src/app/cal/[file]/route.test.ts` (new); `apps/web/src/proxy.test.ts` (one case) | Token derivation, the loader, the route (§3). Tests 1, 3 (route), 5 (loader), 10, 15. |
| T5 | 3 | medium | bis-frontend | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card.tsx` (new); `…/calendar/feed-card.test.ts` (new); `…/calendar/feed-actions.ts` (new); `…/calendar/feed-actions.test.ts` (new); `…/calendar/page.tsx`; `…/[accountId]/in-account-service-reads.test.ts` (one entry, reason `proven-target`: every read is keyed by the caller's own user id); `apps/web/src/lib/messages.ts` (`calendar.feed.*`, additive); `apps/web/src/lib/palette/registry.ts` (one line) | §5. The actions call T3 and T4's `feed-token.ts`; they never import the route. |
| T6 | 4 | medium | bis-e2e-qa | `apps/web/e2e/calendar-feed.spec.ts` (new) | Test 18 on the per-run fixture account. |

**For the orchestrator / bis-platform (proposals, not edits):** `.env.example` gains
`CALENDAR_FEED_SECRET=` with the comment "at least 32 characters; different in Production and Preview;
rotating it does not end links, it only stops the card showing them again". The owner sets it in Vercel
Production and Preview. Runbook line: "to end every calendar link at once, `update calendar_feeds set
revoked_at = now() where revoked_at is null`". The optional Vercel Firewall rule for `/cal/` (§3.2).

## 8. Open questions for the owner

**Decided by the owner, 2026-10-28, all three as recommended:**

| # | Decision |
|---|---|
| D1 | Everyone on the team gets a link (Owner, Staff, Technician). A Technician's feed carries only the bookings of customers assigned to them; the agency gets none. |
| D2 | A separate secret, `CALENDAR_FEED_SECRET`, set by the owner in Vercel Production and Preview (different values). |
| D3 | No video join link in the event. It stays in the booking email and on the Calendar page. |

The plan (`docs/superpowers/plans/2026-10-28-calendar-feed.md`, "Deviations from the spec") corrects
details of this spec against the source: four database functions instead of five (turn-off is one, so
`revoked_at` is the database's clock), a fixed hourly window, no `schema-grants-guard.test.ts` edit, no use
of `lib/http/retry-after.ts`, an archived account answering 404, no loading skeleton, and the pause rule
above.

The questions as they were asked:


1. **Who gets a link: everyone on the team, or Owners only at first?** *Recommendation: everyone.*
   Staff see the whole calendar, and a Technician sees only the customers assigned to them. That is the
   same fence the app already keeps, and a technician's phone is where "what's my next job" is most
   useful.
2. **A separate secret for these links (`CALENDAR_FEED_SECRET`), or reuse the document-link secret?**
   *Recommendation: a separate one.* It costs you one value to set in Vercel, Production and Preview. In
   return, resetting one kind of link never touches the other, and a leak of one secret does not reach
   both.
3. **Should a video booking's join link be in the event?** *Recommendation: no.* Anyone holding the
   calendar link could join the customer's call, and the roadmap promises the time, the service and the
   first name only. The join link stays in the booking email and on the Calendar page.
