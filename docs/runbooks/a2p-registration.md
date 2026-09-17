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

### The privacy policy

- **Brand-specific** — the client's own, not BIS's and not a generic template
- Must state that information **will not be sold or shared with third parties
  for promotional or marketing purposes**

### Call-to-action disclosures

Wherever the number is advertised: program/brand name, what the messages are,
frequency, "Standard Message and Data Rates may apply", "Reply STOP to opt
out", "Reply HELP for help".

---

## Step 4 — Create the campaign

**Messaging → 10DLC → Campaigns → Create a campaign**

**Use case: Customer Care.** It fits what this platform actually sends —
every message is a response to someone who already contacted the business.

**Message flow:** describe the real consent path, which is unusually strong
here and worth saying plainly. Most of it is IMPLIED consent: the customer
phoned the business and hung up, or submitted the business's own form. Say
that. Do not describe a marketing list you do not have.

**Sample messages.** Use what the platform genuinely sends, from
`apps/web/src/lib/messages.ts` — a sample that does not match the traffic is
a rejection reason:

```
Hi, this is 956 Woodworks. Sorry we missed you just now, reply here
and we'll help. Reply STOP to opt out.
```

```
Thanks for choosing us! If you have a minute, we'd love a quick
review: https://g.page/r/... Reply STOP to opt out.
```

At least one sample must carry opt-out language, samples should stay under
160 characters, and if the real messages embed a link then the samples must
embed one too.

**Keywords:** STOP/UNSUBSCRIBE (opt-out), HELP (help), and an opt-in
confirmation. The help reply must name the brand and give customer care
contact details; the opt-out reply must confirm no further messages.

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
