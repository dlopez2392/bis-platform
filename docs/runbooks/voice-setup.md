# Voice Receptionist — owner setup runbook

Audience: danlo, doing this once per environment (today: production only —
there is one Vercel deployment). Walk the 7 steps in order; each has its own
verification. Step 6 is **the exit gate** — nothing here ships to a real
client until it's been walked with an actual phone call and the resulting
rows have been read, not just "it rang."

Two follow-on procedures live alongside the 7 steps, not numbered into them:
**"Client onboarding (wizard)"** (after Step 4) covers how every account —
test or real — actually gets set up now, via the Setup wizard page; and
**"TELNYX_PUBLIC_KEY — hardened activation procedure"** (after Step 3) is an
optional hardening upgrade you can do later, on your own schedule.

Two URLs everything below points at:

- Production: `https://app.bis-rgv.com`
- Webhook (OpenAI → us): `https://app.bis-rgv.com/api/voice/incoming`
- TeXML (Telnyx → us): `https://app.bis-rgv.com/api/voice/texml`

---

## Step 1 — OpenAI: a dedicated project, a key, a webhook

Voice gets its own OpenAI project rather than reusing an existing one — a
separate blast radius for the key and the webhook secret, and a project id
that's meaningful in billing/usage dashboards.

1. platform.openai.com → create a **new project** named `BIS Platform Voice`.
2. Note its **project id** (`proj_…`) — this is `VOICE_OPENAI_PROJECT_ID`.
3. Inside that project → **API keys** → create a key. This is `OPENAI_API_KEY`.
4. Inside that project → **Settings → Webhooks** → add an endpoint:
   - URL: `https://app.bis-rgv.com/api/voice/incoming`
   - Event: `realtime.call.incoming`
5. Note the endpoint's signing secret (`whsec_…`) — this is `OPENAI_WEBHOOK_SECRET`.

**Verify:** the project shows the new key under its own API keys list (not a
different project's), and the webhook endpoint shows `realtime.call.incoming`
as its only (or primary) subscribed event, pointed at the `/api/voice/incoming`
URL above.

---

## Step 2 — Vercel: the three required env vars

Project **bis-platform**, environment **Production**, add:

| Name | Value | Type |
|---|---|---|
| `OPENAI_API_KEY` | the key from Step 1 | **Sensitive** |
| `OPENAI_WEBHOOK_SECRET` | the `whsec_…` secret from Step 1 | **Sensitive** |
| `VOICE_OPENAI_PROJECT_ID` | the `proj_…` id from Step 1 | plain |

⚠️ **Vercel silently no-ops "Add New" on a name that already exists** — if any
of these three are already present (e.g. a placeholder from an earlier
milestone), **Remove** the existing entry first, then **Add New**. Clicking
"Add New" over an existing name looks like it succeeded but the value never
changes.

After adding/replacing all three: **redeploy**. Env var changes never take
effect on an already-running deployment — Vercel dashboard → Deployments →
redeploy the latest Production deployment (or push a commit).

**Verify:** Vercel dashboard → Settings → Environment Variables shows all
three under Production, `OPENAI_API_KEY` and `OPENAI_WEBHOOK_SECRET` marked
Sensitive (value hidden, not just masked-but-visible), and the most recent
Production deployment's "Redeployed" timestamp is AFTER these were saved.

---

## Step 3 — Telnyx: the TeXML application

1. Telnyx portal → **TeXML Applications** → create a new app: `BIS Platform Voice`.
2. **Voice Method: GET** — this is the DEFAULT, unhardened configuration:
   the webhook URL below is hit with the dialed number as a query param
   (`?To=…`), and the TeXML route answers it unauthenticated. This is
   correct and sufficient to go live with real clients as-is. A hardened
   POST + signature-verified mode exists (see "TELNYX_PUBLIC_KEY —
   hardened activation procedure" below) but it is optional, and flipping
   Voice Method to POST outside that procedure's order breaks every call —
   read it before touching this setting.
3. **Webhook URL**: `https://app.bis-rgv.com/api/voice/texml`
4. **Inbound**: enable the **OPUS** codec.
5. **Outbound**: attach the account's existing **OVP** (Outbound Voice
   Profile) — the same one other Telnyx numbers on this account already use.

**Verify:** the TeXML app's summary page shows Voice Method **GET** (this is
the expected, unhardened default — it only reads POST if you've completed
the activation procedure below), the correct webhook URL, OPUS listed under
inbound codecs, and a non-empty OVP under outbound.

---

## TELNYX_PUBLIC_KEY — hardened activation procedure (optional)

Voice Method GET (Step 3) is not insecure by accident — it's simply
unauthenticated: anyone who finds the TeXML URL can hit it directly and get
back TeXML pointing at whatever `To=`/`From=` they supply. Setting the
`TELNYX_PUBLIC_KEY` env var switches the TeXML route into a hardened mode:
it verifies an Ed25519 signature that Telnyx only sends on **POST**
requests, and it closes the unauthenticated GET path entirely (returns 405).

⚠️ **This is an outage switch if done out of order.** Once
`TELNYX_PUBLIC_KEY` is set, the route's GET and POST handlers are no longer
interchangeable — POST becomes the only path that answers calls. If the
TeXML app is still configured for Voice Method GET when the key goes live,
Telnyx keeps sending GET requests, the hardened route now rejects every one
of them with 405, and **every live call fails** until one side or the other
is fixed. Follow all four steps below, in order, every time — don't set the
key first and "flip the method after."

1. **Flip the TeXML app's Voice Method to POST** in the Telnyx portal
   (TeXML Applications → the app from Step 3 → Voice Method → POST). Save.
2. **Verify a test call still routes** — call the test number, confirm
   Sofía answers normally. POST-without-the-key is exactly today's
   unauthenticated behavior, just delivered via POST instead of GET;
   nothing about call handling changes yet.
3. **Set `TELNYX_PUBLIC_KEY` in Vercel** (Production environment) — value
   is the Ed25519 public key (base64, raw 32 bytes) from the Telnyx portal
   → **Keys & Credentials → Public Key**. The same Remove-then-Add,
   then-redeploy caution from Step 2's three vars applies here too.
4. **One more test call** — confirm it still routes normally, then check
   the Vercel function logs for the `/api/voice/texml` route around that
   call. A normal accepted call logs nothing new (the signature check just
   passes silently); **a 403 in the logs means Telnyx isn't signing the
   request the way this route expects** — don't leave the key set with
   calls failing while you investigate.

**Rollback:** remove `TELNYX_PUBLIC_KEY` from Vercel and redeploy.
Optionally also flip the TeXML app's Voice Method back to GET — not
required (POST without the key set is exactly as safe as GET, just still
unauthenticated), but it keeps the two systems' configuration matched if
you're stepping away from hardening for a while rather than actively
retrying it.

---

## Step 4 — Buy a TEST number and assign it

1. Telnyx portal → **Numbers → Buy Numbers** → pick any RGV-local number
   (a real local area code makes test calls behave like a real client's
   would; this is a throwaway test number, not the one you'll sell).
2. After purchase → **Numbers → My Numbers** → open it → **Voice** tab →
   **Routing** → point it at the `BIS Platform Voice` TeXML app from Step 3.

(Still a deferred follow-up, not built by the wizard sub-project either:
Telnyx's `POST /v2/number_orders` can set `connection_id` at order time,
skipping this manual routing step entirely. Buying a number stays a
Telnyx-dashboard step regardless of how far onboarding gets automated on
our side — see "Client onboarding (wizard)" below.)

**Verify:** the number's Voice → Routing tab shows the TeXML app from Step 3
as its connection, not "none" or a different app.

---

## Moving a number between companies

There are TWO halves to a phone number, and the platform owns only one.

| | Where it lives | What changes it |
|---|---|---|
| **Who answers** | `phone_numbers.account_id` | `/dashboard/numbers` → Move |
| **Where the call goes** | Telnyx → the number → Voice → Routing | The Telnyx portal, by hand |

Moving a number on `/dashboard/numbers` re-points the ANSWERING side. The
TeXML route resolves the tenant from the dialed number (`To`), so whichever
company holds the row is the company the receptionist greets a caller as.
Nothing in this app writes the carrier side — `phone_numbers.telnyx_id` is an
optional field and is usually empty, so the platform does not even hold the
handle it would need.

So a move is complete only when BOTH are done:

1. `/dashboard/numbers` → **Move…** → pick the company → **Move**.
2. Telnyx → **Numbers → My Numbers** → the number → **Voice → Routing** →
   the `BIS Platform Voice` TeXML app from Step 3.
3. The number lands as `provisioned` after a move, by design
   (`reassignPhoneNumber` resets status) — walk the test-call and go-live
   steps again before it answers for real.

### When a number answers as the WRONG company

The symptom is a caller hearing another client's greeting. It means the call
did not arrive as the number you dialed. Diagnose it from the logs, not by
guessing:

```
Vercel → the production deployment → Runtime Logs → "/api/voice/incoming"
```

Look at the `incoming call` line's `calledNumber`. That is the number the
platform was told about, and the ONLY thing that picks the tenant:

- **`calledNumber` is the number you dialed** → the platform chose the wrong
  tenant. That is a bug here; check `phone_numbers` for that e164.
- **`calledNumber` is a DIFFERENT number** → the carrier sent the call
  somewhere else and the platform answered correctly for whatever number it
  actually received. Fix the routing on the dialed number in Telnyx: either
  it is not pointed at the TeXML app, or it is forwarding to another line.

A worked example, 2026-09-16: `+19567055146` had just been moved to
956 Woodworks and still answered as Bespoke Intelligent Solutions. The log
read `calledNumber: '+19565061545'` — BIS's own number. The call never
arrived as `+19567055146` at all, so every layer behaved correctly; the
number simply was not pointed at the platform. Both calls were also billed
and logged against the BIS account, which is the other reason to fix the
routing rather than live with it.

---

## Client onboarding (wizard)

Every client — test or real — now onboards through one page:
**`/dashboard/accounts/<accountId>/setup`**. Creating a new account from
the dashboard redirects straight there. The wizard is agency-only — a
client-side login never sees the "Setup" nav item or this route.

The wizard shows nine steps, each a **live read of that account's actual
rows** — nothing here is a separate "I did this" checkbox that can drift
from reality, except the two genuinely unobservable ones (email,
forwarding):

1. **Account** — always done (the account itself exists).
2. **Branding** — brand name set.
3. **Hours** — calendar enabled AND at least one day has a non-empty
   open-hours window. An enabled calendar with empty hours (`{}`) reads as
   **NOT done** — this is the exact wiped-config state that made the AI
   report "no availability" on every day during the exit-gate's first real
   call, so the wizard deliberately does not let it pass as done.
4. **Voice profile** — facts filled in AND the greeting for the account's
   primary language is filled in (Spanish-only accounts check the Spanish
   greeting; everything else checks the English one — this mirrors the
   incoming-call route's own greeting pick exactly, so the wizard can never
   call a profile "done" that the live route would still leave silent).
5. **Number** — at least one phone number assigned to the account in any
   non-released status.
6. **Email** *(skippable)* — a sending-from address set, or manually
   ticked "skip" if this client will send with the platform default.
7. **Forwarding** *(manual tick)* — there's no live signal for "did the
   client forward their old number to this one"; check it off once
   confirmed with the client.
8. **Test call** *(read from real rows, not fakeable)* — done once at
   least one row exists in `calls` for this account. An actual phone call
   is still required to reach this state, which means the assigned number
   has to actually be answering first: this card carries its own **Enable
   test calls** button, a one-click flip of the number from `provisioned`
   to `testing`. Testing answers real calls immediately, with **no
   dependency on the Receptionist-enabled toggle** — but it does require a
   saved voice profile (step 4 above), so the button renders **disabled**
   with a "needs profile" note until that step is done.
9. **Go live** — one server action that flips the number to `live` and the
   voice profile to enabled together, but only once hours, voice profile,
   number, and test call (steps 3/4/5/8 above — deliberately **not**
   email/forwarding) are all done. Re-derived server-side at click time,
   not trusted from whatever the page happened to render.

**Buying a number stays a Telnyx-dashboard step** (Step 4 above) — there is
no in-app "buy" button.

**Assigning or moving a number happens in the wizard's number step or the
account's Voice page** (same underlying action either way). Moving a
number that is currently `testing` or `live` on **another** account
requires an explicit in-app two-click confirm — the button itself flips
into a destructive-styled "yes, move it" plus a separate Cancel — because
doing so **takes that other client's line out of service immediately**:
the reassign resets the number to `provisioned`, and the incoming route
stops answering calls to it under the old account. Numbers already
`provisioned` or `released` move with a single click; there's nothing live
to interrupt.

---

## Step 5 — Platform: onboard the test account through the wizard

For this runbook's exit-gate account specifically (see "Client onboarding
(wizard)" above for the general flow):

1. Platform dashboard → **Accounts** → create (or open) a test account —
   creating one redirects straight to its Setup wizard
   (`/dashboard/accounts/<accountId>/setup`).
2. Walk the wizard's **branding**, **hours**, and **voice profile** steps —
   fill in persona/greeting(s)/facts/services enough that a test call has
   something real to say.
3. Walk the wizard's **number** step to assign the E.164 number from
   Step 4 (optionally with its Telnyx id).
4. Back on the Setup wizard, the **test call** card now shows a live
   **Enable test calls** button — click it. One click flips the assigned
   number from `provisioned` to `testing` (not Live — this is the exit-gate
   call, not a real client going live — and not the wizard's separate
   Go-live button, which sets Live directly). See "Testing-status
   semantics" right below before you click if the button looks disabled.

**Testing-status semantics (current behavior):** a number in **Testing**
answers real calls the moment the status write lands, **regardless of the
Receptionist-enabled toggle** — there is nothing further to switch on for a
testing-only call. It **does** require a saved voice profile: the wizard's
Enable-test-calls button renders **disabled** with a "needs profile" note
if the account has no voice profile row yet (walk step 2 above first). This
is different from **Live**, which still genuinely requires the profile's
own Receptionist-enabled toggle — see Step 7's Go-live note. The Voice
page's manual status dropdown can also set `testing` directly and does not
enforce the profile check itself; prefer the wizard button so you don't hit
a testing number that silently declines every call.

**Verify:** the Setup wizard shows **branding**, **hours**, **voice
profile**, and **number** all ticked done; the test-call card's button read
**Enable test calls** (not disabled) before you clicked it; the Voice page
shows the number under Phone numbers with status Testing, and the voice
profile shows "Voice profile saved" with the fields you entered persisted
after a reload.

---

## Step 6 — THE EXIT GATE: a real call

This is the milestone gate, not a formality. Five reception bugs on the
demo this code is ported from were invisible to every green test suite —
the only thing that has ever caught that class of bug is an actual phone
call, actually listened to, with the resulting rows actually read.

1. **Call the test number** from a real phone.
2. Sofía should answer with the profile's greeting within ~1s of the call
   connecting (not dead air, not the generic fallback greeting unless you
   left greeting fields blank on purpose).
3. Have a short real conversation: ask a question the `facts`/`services`
   fields actually answer, and either leave a message or (see Step 7) book
   an appointment.
4. Hang up. (The Setup wizard's **Test call** step should now read done —
   it's a live read of the very `calls` row this call just wrote.)
5. **Read the rows** — don't just confirm the call happened:
   - Platform dashboard → the account's **Conversations**/calls list → a
     new `calls` row with a sensible `outcome` (message/lead/booked/
     abandoned), a `transcript`, and a `summary` that actually reflects
     what was said (not a hallucinated booking that didn't happen — this
     is the exact failure class `summarize.ts`'s "authoritative records"
     layer exists to prevent).
   - The account's **Contacts**/Conversations view shows the new contact
     (if one was created) with an **unread badge**.
   - The staff **alert email** arrived at the account's `notify_emails`
     address.
6. **Check the Vercel function logs** for this call (Project → Logs, filter
   to `/api/voice/incoming` around the call time). Find the line logged at
   incoming-call time — `{callId, callerNumber, calledNumber,
   sipHeaderNames}` — and **record in this runbook's own copy (or the
   ledger) which header actually carried the called number**:
   - Expected: `x-bis-called` (our own TeXML route writes this — see Step 3
     of the code, `apps/web/src/app/api/voice/texml/route.ts`).
   - Fallbacks, already implemented and tested if the expected header
     doesn't show up: `to`, then `diversion` (SIP `Diversion` header,
     carrier-dependent).

   ⚠️ **Vercel Hobby retains runtime logs for roughly 1 hour.** Check this
   immediately after the call — waiting until tomorrow means the log line
   is gone and this check has to be redone with a fresh call.

**Do not proceed to a real client's number until every sub-item in this step
has been walked and confirmed**, not just "the phone rang and someone
answered."

---

## Step 7 — Booking leg

A second call, this time actually booking:

1. Call the test number again.
2. Ask to book an appointment; give a name and either a phone or an email.
3. Confirm the AI offers a real available time and books it when you accept.
4. Hang up.
5. **Verify three places:**
   - Platform **Calendar** page for the account shows the new booking.
   - If you gave an email, the **confirmation email** arrives (subject
     "You're booked in").
   - The booked slot **disappears** from the public booking page
     `/b/<publicId>` for that account (open it in a browser, confirm the
     slot you just took is no longer offered).

Once both exit-gate calls above pass, the Setup wizard's **Go live**
prerequisites (hours, voice profile, number, test call) should all read
done — click **Go live** on the wizard to flip the number to `live` and the
profile to enabled together. This is now the one action that takes a real
client's number into production; the separate manual status-dropdown +
Receptionist-enabled toggle from Step 5 above stays available on the Voice
page but is no longer the recommended path for taking a client live.

---

## Video meetings (Daily.co)

Optional, per-company, off by default in the sense that it's entirely
config-driven — there is no separate on/off toggle beyond the calendar's
own **Meeting type** setting.

1. **Get a Daily.co API key**: Daily.co dashboard → **Developers** → API
   keys.
2. **Set `DAILY_API_KEY` in Vercel** — Project **bis-platform**,
   environment **Production**, type **Sensitive**. Same Remove-then-Add,
   then-redeploy caution as Step 2's voice vars applies here too.
3. **Set the calendar's Meeting type**: the account's **Calendar** page →
   Settings → **Meeting type** → **Video**. (The other two options, In
   person and Phone, never touch Daily.co at all — a room is only ever
   created for a `video` calendar.)

**DORMANT until `DAILY_API_KEY` is set**: `getMeetingProvider()`
(`apps/web/src/lib/meetings/provider.ts`) returns `null` with no key
configured, in every environment including production — this is a
deliberate design choice, not a placeholder. There is no fake provider the
way email has `fakeEmailProvider`; a video calendar with no key simply
**books without a meeting link**, silently, the same shape as a client who
never set video up. Nothing errors, nothing warns in the logs, the booking
still completes — check this env var first if a video calendar's
confirmation/reminder emails never carry a join link.

**Booking behavior once the key is set**: a booking on a `video` calendar
gets a Daily.co room created before the booking write commits (so a
room-creation failure never leaves a half-booked slot), and the join link
travels in the confirmation email and the reminder email. On voice bookings
the link is deliberately NEVER read aloud — Sofía says it arrives by email
(a URL by voice is noise; the prompt forbids reading web links).
**Video bookings require the caller's email at the tool layer**:
`book_appointment` (voice) refuses a video booking without a valid email
(a video-conditional gate); the public booking form requires an email for
EVERY booking regardless of meeting type, so it covers video incidentally — there is no code path that books a video meeting and
leaves the customer with no way to receive the join link. A caller who
declines to give an email on a video calendar gets the same polite refusal
+ take-a-message fallback as any other tool-boundary decline.

**Reschedules get a new room**, not a reused one — the old booking's room
is simply allowed to expire on Daily's side, never explicitly deleted (no
delete-room call exists in this milestone).

**Verify:** with `DAILY_API_KEY` set and redeployed, book a slot on a
`video` calendar (voice or public page) with a real email — the
confirmation email's "Join" link should open a working Daily.co room in the
browser for both parties.

---

## Follow-up emails

Off by default, per-company, next-morning delivery riding the existing
daily reminder cron (`apps/web/src/app/api/cron/reminders/route.ts` — the
same route booking reminders already ride, Hobby-tier daily granularity).

1. **Turn it on**: the account's **Calendar** page → Settings → the
   **"Send a follow-up email"** checkbox.
2. **Body (optional)**: the textarea directly below it. **Leave it empty to
   use the live default copy** (`DEFAULT_FOLLOWUP_BODY`,
   `apps/web/src/lib/email/templates/followup.ts`) — the empty textarea
   shows that default as greyed-out placeholder text, not a value that gets
   saved. Typing something and saving pins that exact text as the
   company's follow-up body going forward; clearing it back to empty and
   saving returns to the live default (the server normalizes a
   default-matching save back to `""` — saving never accidentally freezes
   the default text in place, even if a future edit changes what the
   "default" is).
3. **Who gets one**: every booking with a saved contact email, the morning
   after the appointment, sent once (`followup_sent_at` stamped
   send-then-stamp, same pattern as booking reminders — a delivery failure
   never gets silently marked sent). A booking with no contact email on
   file (e.g. the recorded voice-booking `fillBlanks` gap) is skipped on
   every tick — never stamped, never an error, counted as `skippedNoEmail`
   in the cron output each day until the 25h window ages it out. Seeing the
   same booking skip across consecutive days is designed repetition, not a
   bug; it is never sent.

**Verify:** enable follow-ups on a test calendar with a short custom body,
complete a real booking (voice or public page) with a real email, wait for
the next daily cron tick after the appointment's end time, and confirm the
email arrives with your custom text (or the default copy, if you left the
body empty).

---

## Env vars — reference

See `.env.example` at the repo root for the full commented list (`OPENAI_*`,
`VOICE_OPENAI_PROJECT_ID`, all `REALTIME_MODEL`/`PHONE_*` tuning knobs with
their defaults). This runbook covers the three that MUST be set for voice to
work at all (Step 2); everything else is optional and ships with a sane
default — only touch them if a real call revealed a reason to.

Two more env vars, not voice-specific but load-bearing for this milestone:

- **`APP_ORIGIN`** — set to `https://app.bis-rgv.com`. Absolute origin used
  to build every link inside outbound email (booking confirmations, staff
  alerts, cron reminders) instead of deriving one from the triggering
  request. Why it matters: cron/webhook-triggered emails have no browser
  request to derive an origin from, so without this they fall back to the
  `vercel.app` deployment URL — a link domain that doesn't match the
  sending domain (`bis-rgv.com`), which is exactly the mismatch signal that
  made Gmail silently discard platform mail for weeks (the deliverability
  saga this milestone closed out). Unset behavior: still works, just leaks
  the `vercel.app` domain into links again — don't unset this without a
  reason.
- **`TELNYX_PUBLIC_KEY`** — unset by default. See "TELNYX_PUBLIC_KEY —
  hardened activation procedure" above before ever setting this one; it is
  not a "set and forget" var, the TeXML app's Voice Method has to be
  flipped to POST first or every live call breaks.
- **`DAILY_API_KEY`** — unset by default. See "Video meetings (Daily.co)"
  above. Sensitive in Vercel. Unset behavior: not an error — video
  calendars simply book without a meeting link, silently, in every
  environment.

## Troubleshooting quick-reference

- **Call rings then dead air, nothing in `calls`:** check Step 2's env vars
  actually redeployed (the silent-no-op trap), then check Telnyx's TeXML
  app's webhook URL and Voice Method from Step 3 — GET unless you've
  deliberately completed the `TELNYX_PUBLIC_KEY` activation procedure, in
  which case it must be POST.
- **Every live call suddenly 405s:** classic sign `TELNYX_PUBLIC_KEY` got
  set in Vercel before the TeXML app's Voice Method was flipped to POST (or
  the two got out of sync some other way) — see the activation procedure's
  rollback (remove the key, redeploy).
- **Calls start 403ing after setting `TELNYX_PUBLIC_KEY`:** Telnyx isn't
  signing the request the way the route expects — don't leave the key set
  while calls are failing; roll back (remove the key) and investigate.
- **Call reaches Sofía but she doesn't know the business:** the voice
  profile's `facts`/`services` fields are probably empty or the wrong
  account's number got assigned (wizard's **number** step, or Step 5 for
  the exit-gate account) — check the E.164 match.
- **No staff alert email:** confirm `notify_emails` is set on the account's
  calendar (same field the booking-confirmation flow uses) — voice reuses
  it, it isn't a separate setting.
- **Booking succeeds but no confirmation email:** this is a soft failure by
  design (`emailFailed: true` in the tool result, never a hard booking
  failure) — check Resend delivery for the account's `from_email`/domain
  before assuming code is broken.
- **Platform email lands as "Delivered" in Resend but never shows up in
  Gmail:** check `APP_ORIGIN` is actually set in Production and the
  deployment was redeployed after — a link/sender domain mismatch is a
  silent-discard trigger, not a bounce, so nothing in our own logs will
  flag it.
- **Video calendar bookings have no join link:** check `DAILY_API_KEY` is
  actually set in Vercel Production and the deployment was redeployed after
  — this is the designed dormant behavior (no error, no fake link), not a
  bug, until the key is live.
- **Voice caller can't complete a booking on a video calendar:**
  `book_appointment` refuses video bookings without a valid email at the
  tool layer by design — confirm the caller actually gave (and the model
  actually captured) an email; a declined/missing email should route to
  the take-a-message fallback, not a silent failure.
- **Follow-up email never arrives:** confirm the checkbox is ON for that
  calendar, the booking has a saved contact email (voice bookings can lack
  one — the recorded `fillBlanks` gap), and enough time has passed for the
  next daily cron tick after the appointment ended — this is next-morning
  granularity on Hobby, not real-time.
- **Testing number doesn't answer calls:** check the wizard's test-call
  card — if the **Enable test calls** button is disabled with a "needs
  profile" note, the account has no saved voice profile yet (see
  "Testing-status semantics" under Step 5); this is unrelated to the
  Receptionist-enabled toggle, which Testing status ignores entirely.
