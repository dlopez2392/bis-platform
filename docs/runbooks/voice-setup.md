# Voice Receptionist — owner setup runbook

Audience: danlo, doing this once per environment (today: production only —
there is one Vercel deployment). Walk the 7 steps in order; each has its own
verification. Step 6 is **the exit gate** — nothing here ships to a real
client until it's been walked with an actual phone call and the resulting
rows have been read, not just "it rang."

Two URLs everything below points at:

- Production: `https://bis-platform-six.vercel.app`
- Webhook (OpenAI → us): `https://bis-platform-six.vercel.app/api/voice/incoming`
- TeXML (Telnyx → us): `https://bis-platform-six.vercel.app/api/voice/texml`

---

## Step 1 — OpenAI: a dedicated project, a key, a webhook

Voice gets its own OpenAI project rather than reusing an existing one — a
separate blast radius for the key and the webhook secret, and a project id
that's meaningful in billing/usage dashboards.

1. platform.openai.com → create a **new project** named `BIS Platform Voice`.
2. Note its **project id** (`proj_…`) — this is `VOICE_OPENAI_PROJECT_ID`.
3. Inside that project → **API keys** → create a key. This is `OPENAI_API_KEY`.
4. Inside that project → **Settings → Webhooks** → add an endpoint:
   - URL: `https://bis-platform-six.vercel.app/api/voice/incoming`
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
2. **Voice Method: GET** (not POST — the webhook URL below is hit with the
   dialed number as a query param, `?To=…`).
3. **Webhook URL**: `https://bis-platform-six.vercel.app/api/voice/texml`
4. **Inbound**: enable the **OPUS** codec.
5. **Outbound**: attach the account's existing **OVP** (Outbound Voice
   Profile) — the same one other Telnyx numbers on this account already use.

**Verify:** the TeXML app's summary page shows Voice Method GET, the correct
webhook URL, OPUS listed under inbound codecs, and a non-empty OVP under
outbound.

---

## Step 4 — Buy a TEST number and assign it

1. Telnyx portal → **Numbers → Buy Numbers** → pick any RGV-local number
   (a real local area code makes test calls behave like a real client's
   would; this is a throwaway test number, not the one you'll sell).
2. After purchase → **Numbers → My Numbers** → open it → **Voice** tab →
   **Routing** → point it at the `BIS Platform Voice` TeXML app from Step 3.

(Wizard note for the future self-serve number-purchase flow — sub-project 2,
not this milestone: Telnyx's `POST /v2/number_orders` can set `connection_id`
at order time, skipping this manual routing step entirely.)

**Verify:** the number's Voice → Routing tab shows the TeXML app from Step 3
as its connection, not "none" or a different app.

---

## Step 5 — Platform: assign the number to a test account

1. Platform dashboard → pick (or create) a test account → its **Voice**
   page (`/dashboard/accounts/<accountId>/voice`).
2. **Phone numbers** panel → **Assign number**: enter the E.164 number from
   Step 4 and (optionally) its Telnyx id.
3. **Voice profile** panel: fill in persona name, greeting(s), facts,
   services — enough that a test call has something real to say.
4. Set the number's status to **Testing** (not Live — this is the exit-gate
   call, not a real client).
5. Toggle **Receptionist enabled** ON and save.

**Verify:** the Voice page shows the number under Phone numbers with status
Testing, and the voice profile shows "Voice profile saved" with the fields
you entered persisted after a reload.

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
4. Hang up.
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

---

## Env vars — reference

See `.env.example` at the repo root for the full commented list (`OPENAI_*`,
`VOICE_OPENAI_PROJECT_ID`, all `REALTIME_MODEL`/`PHONE_*` tuning knobs with
their defaults). This runbook covers the three that MUST be set for voice to
work at all (Step 2); everything else is optional and ships with a sane
default — only touch them if a real call revealed a reason to.

## Troubleshooting quick-reference

- **Call rings then dead air, nothing in `calls`:** check Step 2's env vars
  actually redeployed (the silent-no-op trap), then check Telnyx's TeXML app
  webhook URL and Voice Method (must be GET) from Step 3.
- **Call reaches Sofía but she doesn't know the business:** the voice
  profile's `facts`/`services` fields are probably empty or the wrong
  account's number got assigned in Step 5 — check the E.164 match.
- **No staff alert email:** confirm `notify_emails` is set on the account's
  calendar (same field the booking-confirmation flow uses) — voice reuses
  it, it isn't a separate setting.
- **Booking succeeds but no confirmation email:** this is a soft failure by
  design (`emailFailed: true` in the tool result, never a hard booking
  failure) — check Resend delivery for the account's `from_email`/domain
  before assuming code is broken.
