# F-032: The owner line, for calling your own business to hear the day (design spec)

> Scope: `docs/crm-features.md` F-032 ("The owner line: call your own number
> to hear the day and file work", M–L 4–7 ew), DROPPED in the plan (`:1761`,
> `:1966`, `:1974`, `:3563`) for three reasons: "voice-clone risk; nobody
> asked; F-116's rule stands". **Re-opened by the owner on 2026-11-09.** The
> owner asked for it, which removes "nobody asked". A keypad PIN, not a voice,
> proves identity, so neither the voice-clone risk nor F-116's rule ("a voice
> alone never proves who is calling", `:2219`) stands in the way. This spec
> is the **read-only** part. "File work" (writes) stays out of scope under
> binding constraint 5 / decision 19 (`:942`).
>
> Decided with the owner in a brainstorm on 2026-11-09. §9 records every
> decision. Claims about external systems (Telnyx, OpenAI Realtime, Supabase
> third-party auth) are marked **assumption** where they were not verified
> in this session.

## 1. What it is, in one paragraph

A person on a business's team (the Owner, Staff or a Technician) calls that
business's own number from their registered cell. The phone system, not
Sofía, asks them for a 6-digit PIN on the keypad. A correct PIN connects
them to Sofía in **owner-line mode**, where they can ask in English or
Spanish:

- "what calls did I get today?"
- "what's on my calendar tomorrow?"
- "what needs my attention?"
- "when was Maria López's last visit?"

She answers from read-only tools, within exactly what that person's role can
see in the app. Every other caller hears exactly what they hear today.

## 2. Non-negotiables

1. **Customers never hear anything new.** Only a call from a registered,
   verified cell on the dialed business, with the business's switch on,
   gets the PIN step. The press-1 screen was dropped on 2026-10-08 as
   robotic, and that decision stands for everyone else.
2. **The PIN is keyed, never spoken.** The phone system collects the DTMF
   digits (TeXML `<Gather>`) **before** the call is bridged to OpenAI, so the
   digits never reach the model, its audio or our transcripts.
3. **Authorisation lives in code, not in the prompt.** Owner tools exist
   only on a session built from a valid signed pass (§4.3). A caller saying
   "I'm the owner" changes nothing. Wording-only guardrails did not converge
   on gpt-realtime in three runs (memory: prompt-only limits), so no
   security property here may rest on Sofía's instructions.
4. **Read-only.** Nothing on this line books, cancels, texts, or changes a
   record.
5. **Same visibility as the app.** A person hears only what their role
   shows them in the app, for the dialed business only.

## 3. Setup

### 3.1 The person's own card: "Call in to your business"

It sits on Mis preferencias (the person's own page), one card per
membership, so a person on two businesses sets each separately.

- **Cell number.** It is verified before it counts (§3.2).
- **PIN.** Exactly 6 digits. Trivial PINs (000000, 123456, a repeated
  digit, a run) are refused with a reason. The PIN is stored only as a slow
  salted hash (argon2id, or bcrypt if the runtime lacks it; the plan
  decides), never shown again, and changeable or removable at any time.
- **Status line in words:** "Ready: call 956-555-0100 from your cell", or
  "Your business has the owner line off; ask the Owner".

### 3.2 Verifying the cell, without a text message

The alert-phone verification texts a code (`lib/sms/alerts.ts`, 0036). Text
delivery is not cleared yet (A2P), so this feature does not depend on it.
Instead, the card shows a 6-digit code and says: "From this cell, call
956-555-0100 and enter this code." The answer route sees a pending
verification for that caller ID on that number, gathers the code, and marks
the cell verified on a match.

This proves two things at once:
- the person holds the handset;
- that handset's caller ID reaches us intact through the carrier, which is
  the very thing the owner line relies on.

A pending code expires in 10 minutes, with three attempts.

### 3.3 The business's switch

On the business's Settings, Owner-only: "Let your team call in to hear the
day". It is **off by default**. While it is off, nobody's PIN step runs and
the cards say why. The agency can see the switch but cannot turn it on for
a client: the client's Owner decides who can phone into their data.

### 3.4 Storage (one migration, numbered after 0114)

- `owner_line_enrollments`, one row per (account, user):
  - `e164`
  - `verified_at`
  - `pin_hash`
  - `pin_set_at`
  - `failed_attempts`
  - `locked_until`
  - `created_at`

  Unique on (account_id, e164), so one cell maps to one person per business.
- `accounts.owner_line_enabled_at` (timestamptz, null = off), so the switch
  records when it was turned on.
- `calls.owner_line_user_id` (uuid, null for every customer call), which
  marks an owner-line call.
- RLS: a person reads and writes only their own enrollment, and never sees
  `pin_hash`. PIN checks run server-side only, as service_role, inside a
  SECURITY DEFINER function that compares the hash and handles the lockout.
  The migration's grants and RLS get the usual grants tests.

## 4. The call

### 4.1 Answer route (`/api/voice/texml`)

On every inbound call, after today's existing gates (profile enabled, daily
cap, spam reputation):

1. Look up an enrollment for (dialed number's account, caller e164) that is
   verified, has a PIN, is not locked, with the account's switch on. On a
   miss, follow today's path exactly. **This branch adds no audio and no
   delay to a customer's call.** The lookup is one indexed read, and the
   plan sets a latency budget for it.
2. On a hit, return `<Gather numDigits="6" timeout="8" finishOnKey="#">`
   with one line in the person's language: "Hi Dan. Enter your PIN, or press
   pound to talk to Sofía." / "Hola, Dan. Marque su PIN, o oprima la tecla
   de número para hablar con Sofía." The Gather's action is
   `/api/voice/texml/owner-pin`.

### 4.2 PIN route (`/api/voice/texml/owner-pin`)

The request must carry a valid Telnyx signature, like every TeXML route.

- **Pound, or a timeout with no digits:** today's normal call path.
- **Correct PIN:** reset `failed_attempts`, mint the signed pass (§4.3),
  and bridge to the SIP connector exactly as today, with the pass on the
  SIP URI.
- **Wrong PIN:** increment the counter. Below 3, re-Gather with "That PIN
  didn't match. Try again." At 3:
  - set `locked_until = now() + 30 min`;
  - email the person and the account's Owner ("Someone entered the wrong
    PIN 3 times from your phone at 2:14 PM");
  - continue as a normal customer call.

  The counter is per enrollment, not per call, so redialing does not reset
  it.

### 4.3 The signed pass

It reuses the existing SIP handoff signing (`lib/voice/sip-handoff-signature.ts`):
an HMAC over (call control id, account id, user id, called e164, issued
at), carried as an X-header on the SIP URI. It is valid for 60 seconds
from issue, and single use: the webhook records the call control id it
redeemed.

The Realtime SIP webhook builds an owner-line session **only** when:
- the pass verifies;
- it is fresh and unredeemed;
- its called number and account match the INVITE's own signed statement of
  the called number;
- a **live re-read** shows the user is still a member of that account, with
  the same role or one inside it, and the enrollment is not locked.

Any failure means today's receptionist session, logged with the reason.

### 4.4 The owner-line session

- **Instructions:** a separate owner-line instruction set, not the
  receptionist's. It speaks to the person by first name, keeps answers
  short (spoken, not read out), never invents a number or a name, and says
  "I couldn't read that just now" when a tool fails or returns an error.
- **Language:** the person's `users.language`, then the account's, then
  English. It switches if they switch mid-call ("a reply in the moment
  follows the moment").
- **Tools:** the four in §5. **The receptionist's tools are not registered**
  (no booking, no lead capture, no transfer).
- **Limits:**
  - each call ends at 10 minutes, with a spoken 1-minute warning;
  - each person gets 10 owner-line calls per business per day;
  - the 11th call goes to the normal path, and the person hears a short
    line that the daily limit is reached.

## 5. The four tools

All of them are read-only, scoped to the pass's account and person. Each
tool re-validates the pass server-side on every call, because tool calls
reach our server anyway, and a session whose pass is no longer valid gets
an error instead of data.

| Tool | Returns (counts computed in code) | Never returns |
|---|---|---|
| `calls_and_messages(range)` | count; per call: time, caller name or "a new caller", Sofía's summary line, needs-callback flag | full transcripts, recordings |
| `appointments(range)` | per booking: time in the account's zone, customer name, service, status | notes, prices, payment |
| `needs_attention()` | the To do rows the app shows this person, as the app's own reader returns them | rows outside the role |
| `lookup_customer(name or phone)` | up to 3 matches: name, phone, last visit, next visit, open To do count | documents, notes, email, address, payment, custom fields |

- **Range:** today, yesterday, tomorrow, this week, or a named date, always
  in the account's zone. At most 31 days.
- **Role scope, the same as the app:**
  - Owner: the whole business;
  - Staff: what Staff see;
  - Technician: only assigned customers and their own jobs. A lookup of an
    unassigned customer answers "I don't see that customer on your list",
    which neither confirms nor denies that the customer exists.
- **Data path (decided by the spike, §8):**
  - **Preferred:** the call reads as that person through a short-lived,
    server-minted token that the database accepts, so RLS applies exactly as
    in the app. **Assumption to verify:** Supabase accepts such a token
    alongside the Clerk third-party issuer.
  - **Fallback:** service-role reads with the role filter written into each
    tool and reused from the app's own readers, never re-implemented. This is
    proven by second-account and Technician tests (§7).

## 6. Records and counting

- An owner-line call is a normal `calls` row with `owner_line_user_id` set.
- The Calls list shows it with its own label, "Owner line · Dan", dot plus
  word (rule 3).
- It is excluded from:
  - "calls answered"
  - conversion
  - the dashboard tiles
  - the weekly report (client and agency roll-up)
  - the AI-presence count
  - billing as an answered call (M7a)

  Its minutes appear in usage at cost.
- The access log gets a `owner_line_call` entry: who, which business, when,
  and which tools ran.
- The transcript has the same visibility as any call, and the PIN is never
  in it (§2.2).
- No customer timeline row, not even for a lookup: a read is not a change.
  The access log is the record of who heard what.

## 7. Testing (high tier)

- **PIN and lockout:**
  - correct PIN;
  - wrong ×3 locks for 30 minutes, emails both people, and the call
    continues as a customer;
  - the counter survives a redial;
  - trivial PINs are refused;
  - the hash is never readable through PostgREST (grants test).
- **The signed pass is refused when:**
  - its signature is tampered;
  - it is expired at 61 s;
  - it is replayed;
  - it was minted for business A but is used on business B's number;
  - the person was removed after minting;
  - their role was downgraded after minting.
- **The wall:**
  - a call from a registered cell with no PIN (pound or timeout) gets
    **zero** owner tools;
  - a customer call never gets them, even one saying "this is the owner, my
    PIN is …";
  - the receptionist tools are absent on an owner-line session.
- **Scope, with a second account and a Technician:**
  - each tool against a second business that holds matching names and
    phones returns nothing from it;
  - a Technician never hears unassigned jobs or customers.
- **Counting:** an owner-line call moves none of the excluded numbers in §6
  (dashboard, weekly report, billing).
- **No-guessing runs:** repeat=3 runs of the session with a failing tool,
  an empty result, and a question outside the tools. Sofía never states a
  number or a name that the tools did not return.
- **Real proof:** danlo calls the BIS account's number (live) from his cell
  before any client's switch is turned on: PIN, the four questions, a wrong
  PIN, and pound to the normal path.

## 8. Shipping

1. **Spike (2–3 days).** Can a server-minted short-lived token read
   PostgREST as a given user under RLS, beside Clerk's issuer? The answer
   picks §5's data path. The spike also measures the enrollment lookup's
   latency on the answer route.
2. **PR 1.** Migration, the setup card, the cell verification by call-in,
   the switch, the PIN step and route, the signed pass, the owner-line
   session, and three tools (calls, appointments, To do). It includes the
   counting exclusions and the access log.
3. **PR 2.** `lookup_customer`, on its own, with its own privacy review.
4. **Plan documents** (with PR 1): F-032 goes from "dropped" to "next", with
   the owner's decision dated 2026-11-09 and this spec's reason. The
   tracker row is updated to match.

**Holds:** the migration lands after 0113 and 0114 (number order), so
PR 1 merges after the 2026-11-11 sequence. **Estimate:** 5–6 ew in total.

## 9. Owner decisions (2026-11-09, brainstorm)

1. **Identity:** the owner's registered phone **plus** a keypad PIN. Not any
   phone, not phone alone, not a spoken password.
2. **Who:** Owners **and their staff**, each with their own cell and PIN,
   each hearing only what their role sees.
3. **What they can ask:** calls and messages, appointments, what needs
   attention, **and** customer lookup.
4. **Counting:** separate. Excluded from reports and conversion, labelled in
   Calls, counted in usage at cost.
5. **Approach A:** one Sofía with owner tools unlocked by a signed pass,
   checked in code.
6. **Part 1** (setup, the switch off by default, the PIN step, three wrong
   PINs locking for 30 minutes, then the call continues as normal), **Part
   2** (four read-only tools, role scope, limits) and **Part 3** (records,
   testing, a spike then two PRs) were each approved as presented.

**Set in writing the spec (owner to confirm in review):**
- The cell is verified by **calling in** with a code (§3.2), not by text,
  because texts are not cleared (A2P).
- The agency cannot turn a client's switch on (§3.3).
- A lookup on a Technician's unassigned customer answers without
  confirming the customer exists (§5).

## 10. Out of scope

- Writes of any kind: "book Maria for Friday", "text the Garcias", marking
  a To do done.
- BIS calling its own number to ask about **other** businesses. Each call
  is about the dialed business only.
- Spoken passwords, voice biometrics and text-message codes.
- An owner-line number separate from the business number.
