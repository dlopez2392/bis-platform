# BIS Platform — Pricing and Packaging for the Rio Grande Valley

**Date:** 2026-09-21 · **Branch:** `claude/fervent-lamport-74vudn`
**Question:** what have we actually built, what does the market charge, what can the
Valley pay, and what should go on a price card?

---

## 1. The recommendation, in one table

Four tiers, Spanish-named because the market is 91.9% Hispanic, priced against a
local price ceiling that competitors have already set in public.

| | **Lista** | **Recibe** | **Opera** | **Crece** |
|---|---|---|---|---|
| **Per month** | **$97** | **$297** | **$497** | **$997** |
| **One-time setup** | **$0** | **$0** | **$497** | **$1,497** |
| Answered calls included | — | 300 | 800 | 1,500 |
| AI receptionist (EN/ES) | — | ✓ | ✓ | ✓ |
| CRM, booking, forms, inbox | ✓ | ✓ | ✓ | ✓ |
| Full automation suite | — | partial | ✓ | ✓ |
| White-label + staff logins | — | — | ✓ | ✓ |
| Website built + hosted | — | — | — | ✓ |
| Cost to serve, current model | $16 | $74 | $173 | $321 |
| Margin, current model | 83% | **75%** | **65%** | **68%** |
| Cost to serve, on mini | $16 | $41 | $83 | $152 |
| **Margin, on mini** | **83%** | **86%** | **83%** | **85%** |

Month-to-month, no term contract. Annual prepay: two months free.

**Four decisions behind the table, in order of how much they matter:**

1. **Move voice to `gpt-realtime-mini`, or do not sell these allowances.** This is now
   a commercial decision, not an engineering preference. The Valley's published price
   ceiling forces generous call allowances (§4), and at those volumes the full model
   drops Opera to 65% margin, below the 75% software benchmark. On mini every tier
   clears 83%. Test it on real Spanish calls first, but treat the test as urgent.
2. **Drop the setup fee on the first two tiers.** A bilingual AI receptionist is being
   sold in McAllen today at $299 a month with **no setup fee and no contract**. Asking
   $997 up front against that, in a market where 24.4% live below the poverty line,
   loses deals we would otherwise win. Charge setup only where real labor happens.
3. **Bundle the minutes. Never meter, never promise unlimited.** Usage-only pricing
   runs a 62% median gross margin industry-wide against 76–84% for subscriptions. Sell
   a flat price with an allowance generous enough that the median business never
   thinks about it, and treat overage as an upgrade conversation rather than a bill.
4. **Capture the phone number during onboarding.** Porting or forwarding the business
   line is the highest-value retention act available. Moving monthly churn from 5% to
   2.5% doubles lifetime value, the same effect as doubling price with none of the
   conversion penalty.

---

## 2. What we have actually built

Read from the tree on 2026-09-21: 41 migrations, 35 tables, 262 test files, 28
Playwright specs, 12 row-level-security and grants suites, 151 commits. The voice
receptionist is live on a real client. This is not a prototype and the price card
should not apologize like one.

**Layer 1 — CRM foundation.** Contacts with server-side paging and sort, dedupe keys
and duplicate flags, CSV import and export, custom fields, tags, notes, tasks.
Pipeline and opportunities. Forms with a builder, public pages, an embed script,
submissions, consent and rate limits. Unified inbox across SMS and email. Search and
a command palette. Blueprints and an activation checklist. Per-tenant branding and
theming. Client-role logins. *Marginal cost: effectively zero.*

**Layer 2 — Booking.** Availability and slot engine handling time zones, daylight
saving, buffers, notice and horizon. Public booking page and embed, cancel flow.
Video meeting links. Email and SMS reminders, follow-ups, no-show nudges, review
requests. *Marginal cost: cents.*

**Layer 3 — The voice receptionist.** This is the product. Bilingual by construction,
not by translation: `voice_profiles.languages` is `en | es | both`, greetings are
stored separately per language, and `detectSpokenLanguage` labels each call by what
the caller actually spoke. Sofía books, reschedules and cancels appointments live,
captures leads, takes messages, and transfers to a human. Spam screening and caller
reputation turn away robots. Call summaries and transcripts. Missed-call text-back.
Call proposals, where a finished call suggests CRM updates a human accepts or
dismisses. A "Talk to Sofía" web demo. *Marginal cost: the whole cost of the
business. See §3.*

**Layer 4 — Reporting.** Weekly client report with four metrics and week-over-week
deltas in words, weekly agency roll-up, website traffic. *Marginal cost: pennies.*

**Layer 5 — Done-for-you.** Website build and hosting, A2P 10DLC registration,
onboarding, ongoing management. This is labor and must be priced as labor.

**What we deliberately do not have,** and should not pretend to: funnels and website
builder, social planner, ad manager, courses and memberships, payments and invoicing,
e-sign, affiliate manager, app marketplace, listings management. GoHighLevel has all
of these; we decided against them. That is defensible on a sales call, but it means
we cannot win a feature-count bake-off and should never agree to have one.

**One structural advantage worth naming.** We built directly on Telnyx and the OpenAI
Realtime API rather than on Retell, Vapi or Bland, which charge $0.07–$0.31 a minute.
Our own stack costs $0.048–$0.10 on the full model and $0.015–$0.035 on mini. **That
two-to-five-times delta is the arbitrage**, and it is the reason we can bundle 300
calls into $297 while RankRGV, reselling GoHighLevel down the street, cannot.

---

## 3. What it costs us to serve an account

The founding spec estimates **$2–5 per client per month**. That predates the voice
receptionist and is wrong by roughly an order of magnitude once Sofía is switched on.

**Verified input prices (fetched 2026-09-21):**

| Input | Rate |
|---|---|
| `gpt-realtime` audio in / out | $32.00 / $64.00 per 1M tokens |
| `gpt-realtime-mini` audio in / out | $10.00 / $20.00 per 1M tokens |
| Telnyx inbound local voice | $0.0052/min (API $0.002 + SIP $0.0032) |
| Telnyx local number | $1.00/month |
| Telnyx SMS out, registered | ~$0.007/segment incl. carrier fee |
| **10DLC campaign, monthly** | **$10 standard / $1.50 low-volume** |
| 10DLC brand + campaign vetting | $4.50 + $15 one-time |
| Resend email, marginal | ~$0.0004 each |

Audio tokenizes at about 600 tokens per minute heard and 1,200 per minute spoken, and
every turn resubmits the conversation so far, which is why an unmanaged long call gets
superlinearly expensive. A conversational minute costs roughly **$0.048–$0.10 on the
full model** and **$0.015–$0.035 on mini**, with a measured production datapoint at
$0.069/min on full. Across a corpus of 1,446,980 analyzed business calls, **most run
1.5 to 3 minutes**; we size on 2.5.

**One answered call costs us about $0.19 on the full model and about $0.07 on mini.**

**Cost to serve, per account per month, at the allowances in §1:**

| | Lista | Recibe (300) | Opera (800) | Crece (1,500) |
|---|---|---|---|---|
| Voice minutes | — | 750 | 2,000 | 3,750 |
| Realtime AI, full model | — | $52.50 | $140.00 | $262.50 |
| *Realtime AI, mini* | — | *$18.75* | *$50.00* | *$93.75* |
| Telnyx voice | — | $3.90 | $10.40 | $19.50 |
| Number + 10DLC campaign | $11.00 | $11.00 | $11.00 | $11.00 |
| SMS | $1.40 | $3.00 | $7.00 | $10.00 |
| Email + shared infra | $4.00 | $4.00 | $5.00 | $6.00 |
| Website hosting | — | — | — | $12.00 |
| **Total, full model** | **$16** | **$74** | **$173** | **$321** |
| **Total, on mini** | **$16** | **$41** | **$83** | **$152** |

Three lines deserve attention. **Telephony is economically irrelevant** at about $4 a
month; optimize it last. **The 10DLC standard campaign fee is $10 a month and is more
than half the cost of a Lista account** — qualifying clients for the Low Volume Mixed
campaign at $1.50 where it legitimately applies saves $8.50 per client per month,
which at fifty clients is $5,100 a year for a form change. And **the model choice is
worth 18 margin points at Opera**, which is the difference between a healthy software
business and a thin one.

---

## 4. What the market charges

### 4.1 The Valley is already contested

This is the finding that should change the plan. The RGV is not an untapped market. It
is an **underpriced** one, with at least six AI-receptionist vendors already running
McAllen-targeted landing pages and one local GoHighLevel reseller selling almost
exactly our bundle.

| Competitor | Where | Published price | Bilingual claim |
|---|---|---|---|
| **RankRGV** | McAllen, built on GoHighLevel | **$750 setup + $250/mo** | **none** |
| **28thDeveloper** | Names McAllen, Brownsville, Harlingen | **$299/mo flat, unlimited calls, $0 setup, no contract** | **yes, all tiers, auto-detects on the first sentence** |
| Ovox | McAllen landing page | ~$197/mo flat (secondhand) | not stated |
| Axis Operating Systems | Physical RGV office | not published | not stated |
| Ruben Arevalo | McAllen, solo builder | not published | yes, "standard, not an add-on" |
| Spiderbug AI | RGV-targeted | "a few hundred to set up, modest monthly" | yes, heavily |

**Read those two top rows carefully.** RankRGV sells missed-call text-back, CRM
pipeline, review automation and appointment reminders in McAllen at $250 a month, on
GoHighLevel, and makes no Spanish claim anywhere on its page. 28thDeveloper sells a
bilingual AI receptionist at $299 flat with unlimited inbound calls, no setup fee and
no contract.

**The public price ceiling for a bilingual AI receptionist in the Valley is therefore
$197–$299 a month, flat, no setup.** Our original $997 setup fee and 150-call
allowance were both out of line with that, which is why both moved.

### 4.2 The wider market, for context

Jobber sells an AI receptionist as a **$29/month add-on including 30 conversations**,
$0.79 per conversation after, free and unlimited on its $499 Plus tier. The vertical
incumbents are nearly giving AI answering away to defend the core subscription.

Like-for-like at **300 answered calls a month**, which is what Recibe now includes:

| Offer | Monthly at 300 calls | CRM | Booking | Bilingual |
|---|---|---|---|---|
| Ovox | ~$197 flat | — | ? | ? |
| Rosie Growth | $299 (2,000 min ≈ 800 calls) | — | limited | ? |
| 28thDeveloper Starter | **$299 flat, unlimited** | — | ✓ | **✓** |
| **BIS Recibe** | **$297** | **✓** | **✓** | **✓** |
| RankRGV | $250 + $750 setup | ✓ | ✓ | — |
| Jobber Connect + Receptionist | $139 + $29 + 270 × $0.79 = **$381** | ✓ | ✓ | — |
| Podium Core | **$399** (no AI answering at this tier) | partial | ✓ | — |
| Jobber Plus | **$499** unlimited conversations | ✓ | ✓ | — |
| Smith.ai AI Enterprise | **$500** (~300 calls) | — | add-on | ✓ humans |

**Human answering, for the ROI slide.** Ruby charges $250 for 50 minutes, about $5.00
a minute, rising to $1,725 for 500. Smith.ai's human service is $300 for 30 calls and
$11.50 each after. Locally, Specialty Answering Service quotes McAllen plans from $44
a month, with typical 24/7 small-business coverage around **$169**.

**The wedge nothing human can answer.** From the same 1.4-million-call corpus, **28.5%
of business calls arrive outside business hours and 34.8% of those callers have buying
intent.** This is the strongest evidence-backed argument we have.

---

## 5. What the Valley can pay

### 5.1 The structural squeeze

| Measure | McAllen MSA | Brownsville MSA | US | Ratio |
|---|---|---|---|---|
| Median household income (ACS 2024, 1-yr) | $56,720 | $53,267 | $81,604 | **65–70%** |
| Mean hourly wage, all occupations (May 2025) | $22.53 | — | $33.54 | **67%** |
| Private-sector average annual pay (QCEW 2024) | $38,898 | $41,659 | — | — |
| Poverty rate | 24.4% | 24.7% | ~12% | **2×** |
| Unemployment (2026) | 6.8% | 7.0% | TX 4.4% | — |
| **Cost of living index** | **~81** | **~85** | 100 | **15–19% below** |

**Income runs 30–35% below the national median but cost of living is only 15–19%
below.** The discount on what Valley households earn is roughly double the discount on
what they pay, because software is a traded good sold at national prices while the
income is local. A national SaaS bill lands harder here than the cost-of-living index
alone suggests. That gap is the entire opportunity and the entire risk.

**No US software vendor prices by metro.** I looked specifically; intra-US regional
SaaS pricing essentially does not exist, and the literature on price localization is
all country-level purchasing-power adjustment. Podium arrives in McAllen at $399
unchanged, priced for a market where the receptionist it displaces earns $38,010.
Here she earns $28,530. **Podium is effectively a third more expensive in McAllen than
in Dallas relative to the labor it replaces, and the national vendors have no
mechanism to follow us down.**

### 5.2 The receptionist anchor, and why it is weaker here

BLS Occupational Employment and Wage Statistics, May 2025:

| | McAllen | Brownsville | US |
|---|---|---|---|
| Receptionist median hourly | **$13.72** | $13.81 | $18.27 |
| Receptionist median annual | **$28,530** | $28,720 | $38,010 |
| 25th percentile hourly | $11.76 | $12.34 | — |
| Employed receptionists | 1,780 | 1,070 | — |

A McAllen receptionist at the median costs about **$2,615 a month fully loaded** with
payroll burden. Half-time is roughly $1,190.

> Recibe at $297 is **11% of a full-time front desk** and about **25% of a part-time
> one** — and it works the 28.5% of calls that arrive after she has gone home.

**But be careful with this pitch here.** The Valley has 7% unemployment and the
cheapest abundant bilingual phone labor in the United States, which is precisely why
TTEC, Qualfon and AnswerOne put contact centers in McAllen; local call-center pay
averages about $17 an hour. The receptionist we are displacing is cheap **and natively
bilingual at no premium**. The raw "replace a salary" ratio is roughly 25% weaker here
than it is nationally. **Sell coverage, not headcount** — 24 hours a day, 365 days a
year, never a missed call, never a voicemail — and leave the wage comparison as
support rather than as the headline.

### 5.3 Bilingual is table stakes, not a premium feature

| | Hidalgo | Cameron | Starr | US |
|---|---|---|---|---|
| Hispanic or Latino | 91.9% | 89.3% | 97.2% | 19.3% |
| **Speaks Spanish at home (5+)** | **78.9%** | 71.3% | **91.0%** | 13.6% |
| **Speaks English less than "very well"** | **29.2%** | 24.0% | **37.5%** | 5.4% |

Nearly a third of Hidalgo County speaks English less than very well, and callers
code-switch mid-sentence. A receptionist product that is merely Spanish-capable is not
competitive here. **We cannot charge a premium for bilingual, because four of the six
local competitors already claim it.** What we can do is be better at it and prove it,
and point out that RankRGV, the incumbent selling our exact bundle at $250, does not
claim it at all.

### 5.4 The market is wide, shallow, and healthcare-heavy

| Band | Establishments | Share |
|---|---|---|
| 1–4 employees | 10,389 | 49.7% |
| 5–9 | 4,185 | 20.0% |
| 10–19 | 3,115 | 14.9% |
| **Under 20 employees** | **17,689** | **84.6%** |

Plus roughly **57,600 unincorporated self-employed** across the four counties; Hidalgo
County's 11.2% self-employment rate is nearly double the national 6.0%.

**Health care is 35% of all RGV employment**, which is unusual, and the
appointment-driven healthcare cluster is **about 2,376 establishments** — physicians,
dentists, other practitioners, home health — more than restaurants. Insurance agencies
(560), legal services (553), specialty trades (351), auto repair (332) and personal
care (244) follow.

**Local agency supply is thin: 45 advertising and PR establishments in the entire
four-county region, employing 221 people.** We are not fighting a crowded field of
local competitors. We are fighting a handful of them plus a wall of national landing
pages.

**Thirty-four accounts on Recibe is $10,000 in monthly recurring revenue.**

### 5.5 What an RGV small business already pays

| Line item | Monthly |
|---|---|
| Weslaco chamber membership, entry tier | ~$30 ($365/yr) |
| Answering service, entry / typical 24/7 | $44 / $169 |
| Website care plan, McAllen local | $139 / $189 / $299 |
| Bilingual AI receptionist, flat | $197–$299 |
| CRM + missed-call automation, local | $250 + $750 setup |
| **Full local marketing bundle** | **$360** |
| Website build, one-time | $1,500–$5,000 |

**The realistic monthly software and marketing budget for an RGV small service
business clusters at $150–$400**, and $360 currently buys an entire local marketing
bundle on Main Street in McAllen. That is the wallet we are competing for. Recibe at
$297 fits inside it. Opera at $497 asks a business to spend more on us than it
currently spends on all of its marketing, which is a real sale and not a default one.

---

## 6. The tiers, in detail

### Lista — $97/month · no setup fee
*"Everything organized. Nothing lost."*

Contacts, pipeline, forms and embeds, booking page and calendar, unified SMS and email
inbox, reminders and follow-ups, weekly report, one client login. No AI receptionist.

**Why it exists:** the land-and-expand tier and the answer to "I can't do $297 yet."
It sits just below the local website care plans at $139–$299 and gets a business's
contacts into our database, where the upgrade conversation happens by itself the first
month they miss twenty calls. Margin 83% on either model.

### Recibe — $297/month · no setup fee — **the flagship**
*"Sofía contesta, en inglés y en español, y agenda la cita."*

Everything in Lista, plus the bilingual AI receptionist 24/7, **300 answered calls**,
missed-call text-back, call summaries and transcripts, spam screening, transfer to a
human, and the SMS reminder suite.

**Why $297 with no setup fee:** it matches 28thDeveloper's $299 to the dollar while
adding an entire CRM, a real booking engine and a weekly report they do not have. It
beats RankRGV's first-year total by $750 and offers Spanish they do not claim. Three
hundred calls is twice the volume the median small business generates, so it reads as
effectively unlimited without exposing us to the tail. Margin 75% on the current model,
**86% on mini**. **This is the tier to sell**, and every piece of marketing should
point at it.

### Opera — $497/month · $497 setup
*"The whole front office, running itself."*

Everything in Recibe, plus **800 answered calls**, the full automation suite (review
requests, no-show nudges, post-job follow-ups), call proposals, CSV import and export
with dedupe, custom fields, lead alerts, white-label branding, and unlimited staff
logins.

**Why $497:** it matches Jobber Plus at $499 and undercuts Podium Pro at $599, and the
multi-location clinics and multi-truck trades that need 800 calls are the accounts
that can carry it. **Watch this tier's margin.** On the current model it is 65%, below
the software benchmark; on mini it is 83%. Do not push Opera hard until the model
question is settled.

### Crece — $997/month · $1,497 setup
*"We build it, we run it, you answer the ones that matter."*

Everything in Opera, plus **1,500 answered calls**, a bilingual website built and
hosted by us with traffic reporting, A2P 10DLC registration handled end to end, a
named contact, and a quarterly strategy review.

**Why the setup fee survives here:** a 5-page website in McAllen starts at $2,500
locally and the range runs to $5,000, so $1,497 bundled with the platform is visibly
good value rather than a barrier. Infrastructure costs $152–$321, but the real cost is
our hours: Crece assumes about two hours of service a month, and a client who needs
six needs a project quote instead.

### Consulting, kept separate

The three service lines on bis-rgv.com are project work and must not be folded into a
subscription, where they quietly become unpaid scope. Bill them at a fixed fee per
project, or **$125–$150 an hour** for Valley small-business work — consistent with
local wages at two-thirds of national and with what RGV agencies charge. Reserve
higher rates for cross-border, logistics and enterprise engagements.

### Where to sell, and where not to

Jobber and Housecall Pro are entrenched in home services and now bundle AI answering
defensively. **The better ground is the appointment-driven healthcare cluster** —
about 2,376 establishments in a region where healthcare is 35% of employment, a
concentration almost no other US metro has. Clinics, dental offices, home health and
other practitioners run on phones and appointments, which is exactly our shape, and
the field-service incumbents do not serve them at all. Insurance agencies, legal
practices and auto repair follow.

---

## 7. What has to be built before we can sell this

**We cannot enforce a single line of the price card today.** There is no Stripe, no
subscription record, no plan, no entitlement and no usage rollup anywhere in the
codebase. Milestone M7 was never started. The caps in
`apps/web/src/lib/voice/call-limits.ts` — 5 calls per caller, 50 per account per day —
are abuse guards read from global environment variables, not per-account allowances.
Note that 50 a day would cut off a Crece account well before its 1,500-call allowance.

The good news: **the data is already there.** The `calls` table carries `account_id`,
`started_at` and `duration_secs` on every row. Monthly minutes per account is one SQL
query. Metering here is a reporting problem, not a data-capture problem.

The minimum honest path, in order:

1. **Run the model comparison.** `gpt-realtime` against `gpt-realtime-mini` on real
   Valley calls, scored on Spanish handling, code-switching and interruption behavior.
   This is worth 18 margin points at Opera and it gates the whole price card.
2. **Add `plan` and `call_allowance` to `accounts`.** One migration. Nothing can be
   enforced or even reported per tier until an account knows what it bought.
3. **Read the per-account daily cap from that row, not the environment.** A global
   ceiling cannot express four tiers, and today's would throttle our best customers.
4. **Build the monthly usage rollup and show it to the client.** A client who can see
   they used 240 of 300 upgrades themselves; a client surprised by an invoice churns.
5. **Do not build automated billing yet.** With a handful of clients, Stripe Invoices
   sent by hand is correct. Revisit at roughly fifteen accounts.

**Also open before volume:** there is no per-account spend cap on the OpenAI side. The
founding spec lists this as Risk 6 and it is unresolved. A runaway caller pattern on an
unmetered account is the one failure mode that produces a bill with no revenue behind
it.

---

## 8. How to position, given that bilingual is table stakes

Four of six local competitors already claim Spanish, so "we speak Spanish" is not a
differentiator here the way it would be in Dallas. Three things that are:

- **Publish the price.** Seven of eight RGV agencies I checked publish nothing and
  route everything to "call for a free quote." In a market with no visible price
  anchor, a clear published number is itself a differentiator, and it is the thing a
  capital-constrained owner responds to.
- **No contract, no setup fee, launch in a week.** This is what 28thDeveloper leads
  with and it is correct for a market where a quarter of households live in poverty
  and Latino-owned firms are documented as capital-constrained rather than
  technology-averse. The evidence says price and terms are the barrier, not appetite:
  86% of Hispanic and Latino workers report using AI at work.
- **Prove the Spanish rather than claiming it.** Put a recorded code-switching call on
  the site. Before launch, call Rosie, Goodcall, Jobber's receptionist and
  28thDeveloper with a Spanish caller and write down what actually happens. Claim only
  what survives that test, then show it.

Say the wage comparison plainly, but lead with coverage: **24/7/365, never a missed
call, for about a tenth of one front-desk salary.**

---

## 9. Risks I would not paper over

1. **The local ceiling is $299 and it was set by someone else.** 28thDeveloper sells
   bilingual, unlimited, no-setup, no-contract at that number today. Every dollar we
   price above it needs a sentence a landscaper understands. Our sentence is the CRM,
   the booking engine and the weekly report. If that sentence stops working, the price
   has to move, not the story.
2. **Opera's margin is 65% on the current model.** That is below the software
   benchmark and it is the tier most exposed to a heavy month. Settle the model
   question before pushing it.
3. **The margin is unprotected until metering ships.** Today a client on any price can
   generate any cost, and the daily cap would throttle a paying customer before it
   protected us.
4. **The "replace a receptionist" pitch is ~25% weaker here** than nationally, because
   local bilingual phone labor is cheap and abundant. Lead with coverage.
5. **Crece is a labor business wearing a SaaS price.** Past two hours a month it
   becomes an under-priced retainer.
6. **A quarter of this market lives below the poverty line.** Some of it genuinely
   cannot buy at these prices, and discounting our way in will not fix that. Lista at
   $97 is the floor; below it the answer is no, politely.
7. **Concentration.** The voice product is live on one real client. Allowances built on
   one usage pattern are built on a sample of one. Revisit after the third and tenth.
8. **We never found the customer's own voice.** Every demand signal in §4 is a vendor
   asserting demand, not a buyer reporting it. Six vendors building RGV landing pages
   proves that supply believes in this market, not that the market has spoken.
   **Calling thirty McAllen clinics and HVAC shops would be worth more than any
   further desk research**, and it is the single highest-value next step in this
   document.

---

## 10. Sources

Product facts read from this repository on 2026-09-21. Market figures fetched the same
day. Government figures are pulled from primary files where noted.

**Costs:** [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) ·
[Realtime measured session costs, n=4,000](https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions) ·
[Telnyx voice](https://telnyx.com/pricing/call-control) ·
[Telnyx messaging](https://telnyx.com/pricing/messaging) ·
[Telnyx 10DLC fees](https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges) ·
[Resend](https://resend.com/pricing)

**RGV competitors:** [RankRGV business automation](https://rankrgv.com/business-automation/) ·
[28thDeveloper virtual receptionist](https://www.28thdeveloper.com/virtual-receptionist-texas) ·
[RSP.Marketing](https://www.rsp.marketing/360brandingpartners) ·
[Design With Mike pricing](https://designwithmike.com/pricing) ·
[RGV Web Marketing](https://rgvwebmarketing.com/digital-marketing-in-mcallen/) ·
[Axis Operating Systems](https://www.axisoperatingsystems.com/axis-receptionist) ·
[Spiderbug AI on the Valley](https://spiderbug.ai/blog/ai-automation-rio-grande-valley) ·
[Specialty Answering Service, McAllen](https://www.specialtyansweringservice.net/coverage/texas-answering-service/mcallen/) ·
[Weslaco Chamber dues](https://www.weslaco.com/member-packages-benefits/)

**National competitors:** [Jobber](https://www.getjobber.com/pricing/) ·
[Jobber AI Receptionist](https://help.getjobber.com/hc/en-us/articles/25315927533847-Receptionist-powered-by-Jobber-AI) ·
[Housecall Pro](https://www.housecallpro.com/pricing/) ·
[GoHighLevel](https://www.gohighlevel.com/pricing) · [Podium](https://www.podium.com/pricing/) ·
[Rosie](https://heyrosie.com/pricing) · [Goodcall](https://www.goodcall.com/pricing) ·
[Smith.ai](https://smith.ai/pricing) · [Ruby](https://www.ruby.com/pricing/) ·
[Retell AI](https://www.retellai.com/pricing) · [Vapi](https://vapi.ai/pricing)

**Rio Grande Valley statistics:**
[BLS OEWS May 2025 metro workbook](https://www.bls.gov/oes/special-requests/oesm25ma.zip) ·
[BLS McAllen MSA at a glance](https://www.bls.gov/eag/eag.tx_mcallen_msa.htm) ·
[BLS Brownsville MSA at a glance](https://www.bls.gov/eag/eag.tx_brownsville_msa.htm) ·
[BLS QCEW](https://www.bls.gov/cew/) ·
[Census County Business Patterns 2023](https://www.census.gov/programs-surveys/cbp.html) ·
[Census Reporter, McAllen MSA](http://censusreporter.org/profiles/31000US32580-mcallen-edinburg-mission-tx-metro-area/) ·
[Census Reporter, Brownsville MSA](http://censusreporter.org/profiles/31000US15180-brownsville-harlingen-tx-metro-area/) ·
[C2ER cost of living, McAllen](https://www.rentcafe.com/cost-of-living-calculator/us/tx/mcallen/)

**Call-corpus and benchmarks:**
[NextPhone AI receptionist statistics, n=1,446,980](https://www.getnextphone.com/blog/ai-receptionist-statistics) ·
[OnceHub answering-service costs](https://www.oncehub.com/blog/answering-service-cost) ·
[SaaS gross margin 2026](https://www.getaleph.com/answers/saas-gross-margin-2026) ·
[SaaS churn benchmarks](https://www.mrrsaver.com/blog/saas-churn-rate-benchmarks) ·
[Intuit QuickBooks Hispanic and Latino AI adoption](https://quickbooks.intuit.com/r/small-business-data/hispanic-latino-ai/)
