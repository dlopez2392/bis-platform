# A2P 10DLC registration — once per client company

Audience: danlo. Run this **once per company** you put on SMS, including BIS
itself. Everything below was verified against Telnyx's own help centre on
2026-09-16; fees and timescales are theirs, not estimates.

**Nothing in this app can shortcut it.** `resolveSmsSender`
(`apps/web/src/lib/sms/sender.ts`) refuses every outbound text until
`accounts.a2p_status` is `approved`, and that column is a RECORD of what the
carriers decided — setting it does not make anything true. The checklist copy
says the useful part: *"Expect days to weeks; start it early because nothing
you do here speeds it up."*

---

## Why this is per-client, not once for BIS

**10DLC allows one brand per EIN.** Your clients are separate legal
businesses sending under their own names from their own numbers, so each one
needs its own brand and its own campaign, registered under THEIR EIN.

That is why `a2p_brand_id`, `a2p_campaign_id` and `a2p_status` are columns on
`accounts` (migration 0023) rather than a single platform-wide setting. The
schema is not being cautious; it is the shape the regulation requires.

BIS has its own account and its own number, so BIS needs its own brand too.

**Register BIS first.** It is the one whose EIN and website you control, you
can fix the opt-in form on `bis-rgv.com` without asking anyone, and a
rejection costs you nothing but time. Learn the process on yourself before
spending a client's goodwill on it.

---

## What SMS actually unlocks

Worth knowing before paying for it, because the answer is "most of the
product's follow-through":

- Missed-call text-back (`finish-call.ts`)
- Lead alert texts to the business owner (`lib/sms/alerts.ts`)
- The alert-phone verification code itself — so the Settings screen's
  "Alert texts" form cannot be completed either
- Appointment reminders, no-show nudges, review requests
  (the automations passes)
- Form instant reply

All of them consult the same gate. None of them can be tested until this is
approved.

---

## Platform prerequisite (once, not per business)

Inbound texts are refused with a 401 (invalid signature) unless
`TELNYX_PUBLIC_KEY` is set in Vercel production — the webhook every
messaging profile is configured to call (`/api/sms/inbound`, see "The
messaging profile" step below) verifies Telnyx's signature and has nowhere
to check it against without this key. Setting it
also hardens the voice routes, since the same env var gates both; follow
`docs/runbooks/voice-setup.md`'s "TELNYX_PUBLIC_KEY — hardened activation
procedure" section, in its order (TeXML app's Voice Method flipped to POST
**first**, then the key set in Vercel — reversing that order breaks every
live call). **Completed for production on 2026-09-29.**

---

## Step 1 — Collect from the client

Nothing starts until all of it is in hand. Send this list verbatim.

**The app carries this list too.** `/dashboard/accounts/<accountId>/checklist`
→ the **A2P registration** panel shows it while the recorded status is
`not_started` or `rejected`, so the operator with the client on the phone does
not have to know this file exists. It is the one part of this runbook that is
deliberately duplicated into the UI — keep the two in lockstep. The copy lives
under the `a2p.gather.*` keys in `apps/web/src/lib/messages.ts`.

| Item | Notes |
|---|---|
| Legal company name | Must match the name the EIN was issued under |
| DBA / brand name | Required even when identical to the legal name |
| EIN | Federal Tax ID |
| Business address | The legal address matching the EIN. **PO boxes and PMBs are rejected** |
| Website URL | Live, and recognisably the same business |
| Vertical | Industry category, from Telnyx's list |
| Contact name, email, phone | A person who will answer |

**No EIN → the Sole Proprietor path**, which is a different flow with lower
throughput (~1,000 messages/day) and a manual verification step:

1. Create the brand with **Entity Type: Sole Proprietorship**
2. Email `10dlcquestions@telnyx.com` asking for an OTP PIN
3. They text a 6-digit PIN to the registered mobile
4. Reply to that email with the PIN **within 24 hours** — it expires, and an
   expired PIN means starting over

A Sole Proprietor brand supports only ONE campaign, and the entity name and
website must not contain terms like LLC, Inc, Bank or School.

---

## Step 2 — Register the brand

Telnyx Mission Control Portal → **Messaging → 10DLC → Brands** →
**Create a brand**
(<https://portal.telnyx.com/#/messaging-10dlc/brands>)

Fill from Step 1.

**The Reseller checkbox:** tick it on the BIS brand (you resell to other
businesses — that is the ISV case). Leave it unticked on a client's brand;
the client sells to consumers.

**Verify:** the brand reaches status **Verified** before you go on. A
campaign submitted against an unverified brand wastes the vetting fee.

---

## Step 3 — Build the compliance evidence BEFORE creating the campaign

This is where campaigns are rejected, and the vetting fee is charged per
submission, so a rejection costs real money. Do this part first.

### The client's website needs a compliant opt-in form

- The SMS checkbox is **optional** — the form must submit without it
- Consent is **SMS-only** — it cannot be bundled with email or phone consent
- Opt-in language beneath it stating message frequency, that standard message
  and data rates may apply, and what they will receive
- **Terms and Conditions** and **Privacy Policy** as real links, never
  pop-ups
- It must actually work and actually record the consent

### The privacy policy AND a terms page — both, and both linked

Telnyx, Twilio and Bandwidth all state the same requirement, and the campaign
form has a field for each: a privacy policy **and** a terms & conditions page,
reachable as real links. A site with only a privacy policy is short one
document. (bis-rgv.com had no terms page at all until 2026-09-17.)

- **Brand-specific** — the client's own, not BIS's and not a generic template
- It must carry the CTIA sentence, close to verbatim. "We do not sell your
  information" does NOT satisfy it: that sentence is about selling, and the
  carriers are asking about **sharing**, of mobile information specifically.
  The wording to use:

  > Mobile information will not be shared with third parties or affiliates for
  > marketing or promotional purposes. All text messaging originator opt-in
  > data and consent will not be shared with any third parties.

- The terms page carries the programme terms: who sends and from what number,
  that opt-in is explicit and optional, what is sent, that frequency varies,
  that carrier rates may apply, STOP, HELP, and that carriers are not liable
  for undelivered messages. `bis-rgv.com/en/terms` is the worked example —
  copy its shape for a client.

### Call-to-action disclosures

Wherever the number is advertised: program/brand name, what the messages are,
frequency, "Standard Message and Data Rates may apply", "Reply STOP to opt
out", "Reply HELP for help".

---

## Step 4 — Create the campaign

**Messaging → 10DLC → Campaigns → Create a campaign**

**Use case: Customer Care.** It fits what this platform actually sends —
every message is a response to someone who already contacted the business.

**Message flow — read this twice.** An earlier version of this runbook said to
describe the consent path as IMPLIED ("the customer phoned and hung up"). That
is wrong and would have cost a rejection and the fee. **TCR requires prior
express consent, collected before any message is sent, specific to text
messaging, and one-to-one.** "They called us" is not consent. Neither is a
checkbox that also covers email, nor a checkbox that is required to submit the
form.

What to describe instead is the real opt-in: the customer ticked an optional
SMS box on the business's own web form, at the moment they gave their number,
under wording naming the sender, the message types, that frequency varies, that
rates may apply, HELP and STOP, and linking the privacy policy. That is what the
BIS form does, and what every client's form must do before their campaign goes
in. Do not describe a marketing list you do not have.

**Sample messages.** Use what the platform genuinely sends, from
`apps/web/src/lib/messages.ts` — a sample that does not match the traffic is
a rejection reason:

```
Hi, this is 956 Woodworks. Sorry we missed you just now, reply here
and we'll help. Reply STOP to opt out.
```

```
Thanks for choosing 956 Woodworks! If you have a minute, we'd love a
quick review: https://g.page/r/... Reply STOP to opt out.
```

Both are literally what `defaultTextbackBody` and the review-request pass
produce, disclosure included.

At least one sample must carry opt-out language, samples should stay under
160 characters, and if the real messages embed a link then the samples must
embed one too. Since 2026-09-17 the platform appends "Reply STOP to opt out."
to every programme message itself, so a sample copied from what the product
actually sends carries it — which is the point: a sample that does not match
the traffic is a rejection reason.

**Keywords:** STOP/UNSUBSCRIBE (opt-out), HELP (help), and an opt-in
confirmation. The help reply must name the brand and give customer care
contact details; the opt-out reply must confirm no further messages.

**Both Telnyx and the platform implement these.** Telnyx detects its default
keywords (STOP, STOPALL, STOP ALL, UNSUBSCRIBE, CANCEL, END, QUIT; START,
UNSTOP; HELP), blocks a STOP at the messaging-profile level, and answers with
the profile's configured reply. Since consent chain PR-2 the platform ALSO
reads every inbound text (`/api/sms/inbound`): the same English words plus
REVOKE, OPT OUT, OPTOUT and the Spanish PARAR, DETENER, ALTO, CANCELAR, BAJA,
NO MAS, and stop sentences, and records each in the consent ledger that the
send gate reads before every text. When Telnyx already answered (the webhook's
`autoresponse_type`), the platform sends nothing more, so a customer never
gets two confirmations. `lib/sms/opt-out.ts` still appends the opt-out
LANGUAGE to every programme message, which is what makes the sample messages
below match real traffic.

The default auto-responses are generic. Custom ones naming the brand are worth
setting per profile — `POST /v2/messaging_profiles/{id}/autoresp_configs` with
`op` of `stop`, `help` or `start` — and the HELP reply in particular should
carry the brand name and a contact, because that is what the campaign promises
it will say. Registering the Spanish keywords (PARAR, DETENER) is what gets
Telnyx's OWN block and branded reply to fire on them — the platform's own
matcher reads them regardless of registration, same as it reads STOP. The
disclosure still names STOP because it is the one word every carrier and
Telnyx recognise with no registration at all.

---

## The messaging profile (per business)

Learned setting up BIS's own texting (2026-09-29): nothing in this app
tracked this step, and without it the number cannot text at all.

**Every business needs its OWN messaging profile — never share one across
companies.** A STOP blocks every number on a profile, and a profile has only
one set of reply texts. Sharing a profile means one company's opt-out or
rename reaches into another's.

Telnyx portal → **Messaging → Programmable Messaging → Profiles → Create
profile** (<https://portal.telnyx.com/#/programmable-messaging/profiles>):

1. **Inbound tab** — webhook URL: `https://app.bis-rgv.com/api/sms/inbound`,
   API version **v2**.
2. **Outbound tab** — leave everything off, including Smart Encoding.
3. **Senders** — add ONLY this business's number. No other business's
   number ever goes on this profile.
4. **Settings** — turn AI/opt-out detection **off**; the platform's own
   consent ledger (`/api/sms/inbound`) already reads every inbound text for
   STOP/START/HELP and the Spanish equivalents, so Telnyx's own detection
   would be a second, uncoordinated opinion on the same message.
5. **Keywords tab, Global section** — set the opt-out (STOP), opt-in
   (START) and HELP keywords, each with its reply text signed with the
   business's name **exactly as set on its account** (its brand name), and
   the HELP reply carrying its support contact (the account's own
   `reply_to_email` when it has one, else BIS's). Take the exact wording
   from `telnyxReplyText(op, brandName, supportEmail)` in
   `apps/web/src/lib/consent/replies.ts` rather than retyping it — it is one
   English line naming the business plus a Spanish line, e.g. for a business
   named "Example Co" with no support email of its own,
   `telnyxReplyText("stop", "Example Co")` renders:
   > Example Co: You will receive no further messages. Reply START to
   > resubscribe. Ya no le enviaremos mas mensajes. Responda START para
   > volver a recibirlos.

   Renaming the business later means redoing these replies — the reply text
   is not derived from the account, it is typed once into Telnyx.

   **Rewritten 2026-10-05** (TCR rejection, reason 611 — see this runbook's
   history and `apps/web/src/lib/messages.ts`'s `sms.consentReply.*`
   comment): the opt-in/STOP/HELP wording changed to carry the frequency,
   rates, HELP/STOP and "no further messages" disclosures TCR requires. A
   reply-text change in the app does **not** reach Telnyx or TCR on its
   own — `telnyxReplyText`'s output is typed into each profile by hand, and
   the keywords tab is the ONLY place it lives once set. Whenever the
   wording in `replies.ts`/`messages.ts` changes:
   1. Re-run `telnyxReplyText` for every LIVE business and retype its three
      keyword replies (STOP, START, HELP) on that business's OWN messaging
      profile in the Telnyx portal — there is no bulk edit, and a profile
      still carrying the old wording means that business's customers keep
      getting the old, non-compliant text even though the app's own records
      (and any NEW profile) are current.
   2. Resubmit the campaign's Opt-in message, Opt-out message and Help
      message fields in TCR with the new wording for every campaign that
      wording was submitted under — a campaign's approval is pinned to the
      exact text it was approved with, same as the sample-message rule
      above.

   BIS's own profile (`4001a0ee-bd95-4fb6-b2b7-6e8d66a9834a`) needed exactly
   this on 2026-10-05: it still carried the pre-rejection wording at the
   time of the fix PR, so its three keyword replies and TCR's three MT
   fields both needed retyping from the new `telnyxReplyText`/catalogue
   output — not just the code.

Once created, paste the profile's ID into the **Messaging profile ID** field
on this account's **A2P registration** card
(`/dashboard/accounts/<accountId>/checklist#a2p-registration`) — the app
refuses to text without it (`resolveSmsSender`).

### After approval: assign the number to the campaign

This is Step 5 below, and it is easy to forget once the carriers approve the
campaign: without it, carriers quietly filter the texts even though
everything reads approved.

### Before telling the client texting is live

From a real phone that is **not** this account's alert phone: text STOP,
then START, then HELP to the business's number. Confirm each reply arrives
and that the contact's Texts row changes (Stopped → Texting on) between the
STOP and the START. This is `sms_live_check` on the checklist — a stored
tick, not something the app can verify for itself, because a recorded
profile ID does not prove the keywords/replies above are actually configured.

---

## Step 5 — Assign the number to the approved campaign

Approval takes **3–7 business days** from submission.

**Numbers → My Numbers** → select the number → assign the approved brand and
campaign → **Save**.

A number that is not assigned to an approved campaign will not send, however
approved the brand is.

---

## Step 6 — Record it in the app

`/dashboard/accounts/<accountId>/checklist` → **A2P registration**:

1. Paste the **Brand ID** and **Campaign ID**
2. Set **Status** to **Approved**
3. Save

The form refuses **Approved** without both identifiers
(`a2p.approvedNeedsIds`), deliberately: the tick ticks a checklist item that
claims the carriers approved this, and a tick must not be able to outrun
them.

**Verify:** the account's Settings page stops saying "Texting isn't turned on
for this account yet", and the alert-phone form will now send a code.

---

## Fees and timing

From Telnyx's published Sole Proprietor figures (2026-09-16). Standard brands
differ — the portal shows the price before you submit.

| | |
|---|---|
| Brand registration | $4.00 one-time |
| Campaign vetting | $15.00 **per submission** — a rejection costs this again |
| Monthly maintenance | $2.00 |
| Carrier approval | 3–7 business days |

---

## Troubleshooting

- **Campaign rejected.** The common causes, in Telnyx's own order:
  brand/website/sample messages that do not describe the same business; an
  opt-in form that is non-compliant (required checkbox, bundled consent, or
  pop-up policy links); missing CTA disclosures; a privacy policy that is
  generic or missing the no-sale language. Fix the evidence, then resubmit —
  and note the fee is charged again.
- **Approved at Telnyx but the app still refuses to text.** Read the account
  on `/dashboard/accounts/<id>/checklist`: `a2p_status` is a record you set
  by hand, not a sync. If it says approved there too, check the account has a
  number at status `live` — `resolveSmsSender` needs BOTH, and returns
  `no_live_number` when the brand is fine but no number qualifies.
- **The alert-phone form will not send a verification code.** Same gate. The
  code is itself an SMS, so it cannot go out before approval; the screen says
  so (`settings.alertPhoneNotClearedToSend`).
