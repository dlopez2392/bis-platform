# BIS Platform — Pricing and Packaging for the Rio Grande Valley

**Date:** 2026-09-21 · **Branch:** `claude/fervent-lamport-74vudn`
**Question:** what have we actually built, what does the market charge, what can the
Valley pay, and what should go on a price card?

---

## 1. The recommendation, in one table

Four tiers, Spanish-named because the market is 91.9% Hispanic, priced against the
local cost of a front-desk employee rather than against national list prices.

| | **Lista** | **Recibe** | **Opera** | **Crece** |
|---|---|---|---|---|
| **Per month** | **$97** | **$297** | **$497** | **$997** |
| One-time setup | $497 | $997 | $997 | $1,997 |
| Answered calls included | — | 150 | 400 | 800 |
| AI receptionist (EN/ES) | — | ✓ | ✓ | ✓ |
| CRM, booking, forms, inbox | ✓ | ✓ | ✓ | ✓ |
| Full automation suite | — | partial | ✓ | ✓ |
| White-label + staff logins | — | — | ✓ | ✓ |
| Website built + hosted | — | — | — | ✓ |
| Est. cost to serve | ~$17 | ~$44 | ~$91 | ~$187 |
| **Gross margin** | **82%** | **85%** | **82%** | **81%** |

Annual prepay: **two months free**. Every tier month-to-month, no term contract — a
term contract is the fastest way to lose a Valley small business's trust, and the
retention mechanism should be the phone number, not a signature.

Three structural decisions behind the table:

1. **Bundle the minutes into a flat price. Do not sell per-minute.** Usage-only
   pricing runs a 62% median gross margin across the industry against 76–84% for
   subscription variants. Metering costs roughly 14–22 margin points and it makes the
   bill unpredictable for a buyer who is already price-sensitive.
2. **Never offer unlimited.** The allowance is what keeps the margin honest. Overage
   exists as a backstop at **$1 per answered call**, waived the first time it happens
   in exchange for an upgrade conversation. The goal of overage is to move someone up
   a tier, not to collect.
3. **Capture the phone number during onboarding.** Porting or forwarding the business
   line is the single highest-value retention act available. Moving monthly churn
   from 5% to 2.5% doubles lifetime value — the same effect as doubling price, with
   none of the conversion penalty.

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
of these; we decided against them. That decision is defensible on a sales call — "we
do the five things that answer your phone and fill your calendar, and we do them in
Spanish" beats fifteen half-used modules — but it means we cannot win a feature-count
bake-off and should never agree to have one.

**One structural advantage worth naming.** We built directly on Telnyx and the OpenAI
Realtime API rather than on Retell, Vapi or Bland. Those platforms charge $0.07–$0.31
per minute; our own stack costs $0.05–$0.10 on the full model and $0.015–$0.035 on
mini. **That two-to-five-times delta is the arbitrage**, and it is why we can bundle
150 calls into $297 while a competitor reselling Vapi cannot.

---

## 3. What it costs us to serve an account

The founding spec estimates **$2–5 per client per month**. That predates the voice
receptionist and is wrong by roughly an order of magnitude for any account with Sofía
switched on. Correcting it is the reason this document recommends call allowances.

**Verified input prices (fetched 2026-09-21):**

| Input | Rate |
|---|---|
| `gpt-realtime` audio in / out | $32.00 / $64.00 per 1M tokens |
| `gpt-realtime` cached audio in | $0.40 per 1M tokens |
| `gpt-realtime-mini` audio in / out | $10.00 / $20.00 per 1M tokens |
| Telnyx inbound local voice | $0.0052/min (API $0.002 + SIP $0.0032) |
| Telnyx local number | $1.00/month |
| Telnyx SMS out, registered | ~$0.007/segment incl. carrier fee |
| 10DLC brand + campaign vetting | $4.50 + $15 one-time |
| **10DLC campaign, monthly** | **$10 standard / $1.50 low-volume** |
| Resend email, marginal | ~$0.0004 each |

Audio tokenizes at about 600 tokens per minute heard and 1,200 per minute spoken, and
every turn resubmits the conversation so far, which is why an unmanaged long call gets
superlinearly expensive. A conversational minute therefore costs roughly **$0.048–$0.10
on the full model** and **$0.015–$0.035 on mini**, with a measured production datapoint
at $0.069/min on full. Across a corpus of 1,446,980 analyzed business calls, **most run
1.5 to 3 minutes**; we size on **2.5 minutes**.

**So one answered call costs us about $0.19 on the full model and about $0.08 on mini.**

**Cost to serve, per account per month:**

| | Lista (no voice) | Recibe (150) | Opera (400) | Crece (800) |
|---|---|---|---|---|
| Voice minutes | — | 375 | 1,000 | 2,000 |
| Realtime AI | — | $26.25 | $70.00 | $140.00 |
| Telnyx voice | — | $1.95 | $5.20 | $10.40 |
| Number + 10DLC campaign | $11.00 | $11.00 | $11.00 | $11.00 |
| SMS | $1.40 | $2.10 | $4.20 | $7.00 |
| Email + shared infra | $4.00 | $4.00 | $5.00 | $6.00 |
| Website hosting | — | — | — | $12.00 |
| **Total** | **~$17** | **~$44** | **~$91** | **~$187** |
| **Margin at list** | **82%** | **85%** | **82%** | **81%** |

Two lines deserve attention. **Telephony is economically irrelevant** at about $2 a
month; optimize it last. **The 10DLC standard campaign fee is $10/month and is more
than half the cost of a Lista account** — qualifying clients for the Low Volume Mixed
campaign at $1.50 where it legitimately applies saves $8.50 per client per month, which
at fifty clients is $5,100 a year for a form change.

**The biggest single lever is model choice.** Moving voice from `gpt-realtime` to
`gpt-realtime-mini` cuts voice cost by roughly two-thirds and lifts every tier above
90% margin. That is worth a genuine A/B test on real Valley calls — especially on
Spanish handling and on interruption behavior, which is where a smaller model is most
likely to disappoint. Do not switch on the arithmetic alone.

Margins of 81–85% put us above the pure-SaaS benchmark of 75% and well above the
55–70% band typical of AI-native businesses, precisely because we sell flat
subscriptions with bundled usage instead of metered minutes.

---

## 4. What the market charges

**The most important competitive fact:** Jobber sells an AI receptionist as a **$29/month
add-on including 30 conversations, $0.79 per conversation after that, and free and
unlimited on their $499/month Plus tier.** The vertical incumbents are nearly giving
AI phone answering away to defend the core subscription. Any AI-answering price above
about $150 needs a reason that survives a Jobber customer's arithmetic.

Our reason is the bundle, the language, and the verticals Jobber does not serve. Here
is the like-for-like comparison at **150 answered calls a month**, which is the volume
Recibe is built around:

| Offer | Monthly at 150 calls | CRM | Booking | Bilingual |
|---|---|---|---|---|
| Goodcall Growth | $129 (250 unique callers) | — | limited | ? |
| Rosie Scale | $149 (1,000 min ≈ 400 calls) | — | limited | ? |
| Jobber Connect + Receptionist | $139 + $29 + 120 × $0.79 = **$263** | ✓ | ✓ | — |
| Smith.ai AI Pro | $150 + ~70 × $2.00 = **$290** | — | add-on | ✓ humans |
| **BIS Recibe** | **$297** | ✓ | ✓ | **✓** |
| Jobber Plus | **$499** (unlimited conversations) | ✓ | ✓ | — |
| Housecall Pro Max + Voice | $329 + ~$150–250 = **$479–579** | ✓ | ✓ | — |
| Podium Pro | **$599** (300 Voice AI minutes) | partial | ✓ | — |

We sit mid-pack: more than the voice-only point tools, less than every true bundle
except Jobber's. That is the correct place to be.

**The wider bands, for context.** All-in-one SMB platforms run $228–$599: Podium Core
$399 and Pro $599, Birdeye quote-only but reported around $299–$449 per location plus
$500–$1,500 onboarding, Thryv from $228, GoHighLevel $97/$297/$497 with usage billed
on top. Field-service verticals run $29–$499. Standalone AI receptionists cluster at
$49–$299. **The modal small business pays $100–$500 a month** for phone answering of
some kind.

**Human answering, for the ROI slide.** Ruby charges $250 for 50 minutes, about **$5.00
a minute**, rising to $1,725 for 500. PATLive runs $1.49–$2.99 a minute. Smith.ai's
human service is $300 for 30 calls, **$11.50 per call** after. We should quote these
numbers often. They are what the alternative actually costs.

**The wedge that nothing human can answer.** From the same 1.4-million-call corpus:
**28.5% of business calls arrive outside business hours, and 34.8% of those callers
have buying intent.** A receptionist cannot cover that; voicemail loses it. This is the
strongest evidence-backed argument we have and it should open the sales conversation.

---

## 5. What the Valley can pay

This is where national price cards stop being useful.

| Measure | RGV | US | Ratio |
|---|---|---|---|
| Mean hourly wage, McAllen MSA (May 2025) | $22.53 | $33.54 | **67%** |
| Median household income, McAllen MSA (2024) | $54,338 | ~$80,600 | **67%** |
| Median household income, Brownsville-Harlingen (2024) | $52,601 | ~$80,600 | 65% |
| Office/admin support mean wage, McAllen | $19.38/hr | $24.79/hr | 78% |
| Poverty rate, McAllen MSA | 26.7% | 12.5% | 2.1× |

Three independent measures converge: **the Valley runs at about two-thirds of national
purchasing power.** A $399 Podium subscription in McAllen costs what a $595 subscription
costs in the average American metro. That is why national vendors underperform here, and
it is our opening.

**The local competitive anchor is not Podium, it is the agency down the street.** Kennedy
Media Group, serving McAllen through Brownsville, retains from **$200/month**, with tiers
at $500 and $1,000. Websites in McAllen run **$1,500–$5,000**. RankRGV charges a flat
monthly fee against ad budgets that typically start at $1,000–$3,000. Valley businesses
already write recurring four-figure-a-year checks to local marketing firms: **$200 to
$1,000 a month is a familiar band here**, and our tiers sit inside it on purpose.

**The ROI argument that closes.** Office and administrative support in McAllen averages
$19.38 an hour. A modest full-time front desk hire at $13.50 is about $28,000 a year,
roughly **$2,850 a month fully loaded**. Half-time is about **$1,400 a month**, and that
person does not work the 28.5% of calls that arrive after hours.

> Recibe at $297 is **10% of a full-time receptionist** and about **21% of a part-time
> one** — and it answers at 2 AM, in Spanish, and writes down what was said.

That sentence, in both languages, is the pitch.

**The market is large enough.** The McAllen-Edinburg-Mission metro alone holds 891,977
people, 91.9% Hispanic; with Brownsville-Harlingen the four-county Valley is well over
1.4 million. **Thirty-four accounts on Recibe is $10,000 in monthly recurring revenue.**

---

## 6. The tiers, in detail

### Lista — $97/month · setup $497
*"Everything organized. Nothing lost."*

Contacts, pipeline, forms and embeds, booking page and calendar, unified SMS and email
inbox, reminders and follow-ups, weekly report, one client login. No AI receptionist.

**Why it exists:** it is the land-and-expand tier and the answer to "I can't do $297
yet." It competes with Jobber Connect at $139 and undercuts Housecall Pro Essentials at
$189. Its job is to get a business's contacts into our database, where the upgrade
conversation happens by itself the first month they miss twenty calls. Margin 82%.

### Recibe — $297/month · setup $997 — **the flagship**
*"Sofía answers, in English and Spanish, and books the job."*

Everything in Lista, plus the bilingual AI receptionist 24/7, up to **150 answered
calls**, missed-call text-back, call summaries and transcripts, spam screening, transfer
to a human, and the SMS reminder suite.

**Why $297:** it is below Podium's $399 and within 13% of the true Jobber equivalent
($263) while including a booking engine, a bilingual receptionist and a weekly report
that Jobber's add-on does not match. It is above the $49–149 commodity band because we
are not a commodity. Margin 85%. **This is the tier to sell**, and every piece of
marketing should point at it.

### Opera — $497/month · setup $997
*"The whole front office, running itself."*

Everything in Recibe, plus **400 answered calls**, the full automation suite (review
requests, no-show nudges, post-job follow-ups), call proposals, CSV import and export
with dedupe, custom fields, lead alerts, white-label branding, and unlimited staff
logins.

**Why $497:** it matches GoHighLevel's SaaS Pro, undercuts Podium Pro at $599 and
Housecall Pro Max with voice at $479–579, and roughly matches Jobber Plus at $499 while
adding Spanish. Margin 82%. This is the tier for a multi-truck home service company or
a clinic with real call volume.

### Crece — $997/month · setup $1,997
*"We build it, we run it, you answer the ones that matter."*

Everything in Opera, plus **800 answered calls**, a bilingual website built and hosted
by us with traffic reporting, A2P 10DLC registration handled end to end, a named
contact, and a quarterly strategy review.

**Why $997:** the website alone is $1,500–$5,000 locally as a one-time project.
Infrastructure costs about $187, but the real cost is our hours. Price Crece on time,
not tokens: it assumes roughly two hours of service a month, and a client who needs six
is a client who needs a project quote instead.

### Consulting, kept separate

The three service lines on bis-rgv.com — AI strategy and adoption, secure
infrastructure, modern digital presence — are project work and must not be folded into
a monthly subscription, where they quietly become unpaid scope. Bill them at a fixed fee
per project, or **$125–$150 an hour** for Valley small-business work. That is consistent
with local wages at two-thirds of national and with what RGV agencies charge. Reserve
higher rates for cross-border, logistics and enterprise engagements, where the buyer is
not a Valley small business.

### Where to sell, and where not to

Jobber and Housecall Pro are entrenched in home services and are now bundling AI
answering defensively. We can win there on Spanish and on price-per-conversation, but it
is a fight. **The better ground is the verticals the field-service incumbents do not
serve**: medical and dental clinics, legal practices, insurance agencies, real estate,
auto shops, beauty and salon, restaurants, and cross-border logistics. In those
categories the alternative to Sofía is a human receptionist at $2,850 a month or a
voicemail box, and our ROI story is unanswerable.

---

## 7. What has to be built before we can sell this

**We cannot enforce a single line of the price card today.** There is no Stripe, no
subscription record, no plan, no entitlement and no usage rollup anywhere in the
codebase. Milestone M7 was never started. The caps in
`apps/web/src/lib/voice/call-limits.ts` — 5 calls per caller, 50 per account per day —
are abuse guards read from global environment variables, not per-account allowances.

The good news: **the data is already there.** The `calls` table carries `account_id`,
`started_at` and `duration_secs` on every row. Monthly minutes per account is one SQL
query. Metering here is a reporting problem, not a data-capture problem.

The minimum honest path, in order:

1. **Add `plan` and `call_allowance` to `accounts`.** One migration. Nothing can be
   enforced or even reported per tier until an account knows what it bought.
2. **Read the per-account daily cap from that row, not the environment.** A single
   global ceiling cannot express four tiers, and a spike day on Crece should not hit the
   same wall as a spike day on Recibe.
3. **Build the monthly usage rollup and show it to the client.** Calls answered against
   the allowance, on the account dashboard. A client who can see they used 140 of 150
   upgrades themselves; a client surprised by an overage invoice churns.
4. **Do not build automated billing yet.** With a handful of clients, Stripe Invoices
   sent by hand is correct. Building subscription infrastructure for five accounts is
   the wrong month's work. Revisit at roughly fifteen accounts.

Steps 1 through 3 are small and they protect the margin. Step 4 is a real project and it
can wait.

**Also open before volume:** there is no per-account spend cap on the OpenAI side. The
founding spec lists this as Risk 6 and it is still unresolved. A runaway caller pattern
on an unmetered account is the one failure mode that produces a bill with no revenue
behind it.

---

## 8. The moat, and how to say it

Every national competitor treats Spanish as a translation layer bolted onto an English
product. We store greetings per language, let an account run `en`, `es` or `both`, label
each call by what the caller actually spoke, and carry both languages through the staff
interface, the customer-facing pages and the weekly report. In a market that is **91.9%
Hispanic**, where a roofing customer may open in Spanish and switch to English
mid-sentence, that is not a feature-list item. It is the reason a Valley business picks
us over Podium.

Three things to put on the price page, in both languages:

- **"Contesta en español. De verdad."** Not translated menus — a receptionist that works
  in the language the caller chose, end to end.
- **"Built in the Valley, for the Valley."** Local presence against out-of-state vendors
  is worth real money here, and worth more than the 33% purchasing-power gap costs us.
- **"10% of a receptionist's wage."** The $2,850-a-month comparison, stated plainly.

**One claim to verify before we make it in writing.** Several competitors may now
advertise Spanish support. Our defensible claim is not "we are the only ones who speak
Spanish" — it is that we are bilingual end to end rather than at the voice layer only.
Before the price page goes live, test Rosie, Goodcall and Jobber's receptionist with a
Spanish caller and write down what actually happens. Claim only what survives that test.

---

## 9. Risks I would not paper over

1. **Jobber has anchored AI answering at $29.** The vertical incumbents are bundling it
   to protect the seat. If we find ourselves defending $297 against $29 on features
   alone we have already lost the call — reframe to the full-bundle comparison ($263 for
   the real Jobber equivalent at 150 calls) before the prospect anchors.
2. **Unlimited minutes would be fatal.** At $0.19 a call, a 1,500-call month costs $285
   to serve. Never offer it, not to close a deal.
3. **The margin is unprotected until metering ships.** See §7. Today a client on any
   price can generate any cost.
4. **Crece is a labor business wearing a SaaS price.** Watch the hours. Past two a month
   it stops being a tier and becomes an under-priced retainer.
5. **The poverty rate is 26.7%.** Part of this market genuinely cannot buy at these
   prices, and discounting our way in will not fix that. Lista at $97 is the floor.
   Below it, the answer is no, politely.
6. **Concentration.** The voice product is live on one real client. Allowances built on
   one account's usage pattern are built on a sample of one. Revisit after the third and
   the tenth voice accounts.
7. **Churn matters more than price.** At $297 and 3% monthly churn, lifetime value is
   about $8,400; at 5% it is about $5,000. Port the phone number during onboarding and
   send the weekly report without fail. Those two habits are worth more than any price
   increase we could push through.

---

## 10. Sources

Product facts read from this repository on 2026-09-21. Market figures fetched the same
day.

**Costs:** [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) ·
[Realtime measured session costs, n=4,000](https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions) ·
[Telnyx voice](https://telnyx.com/pricing/call-control) ·
[Telnyx messaging](https://telnyx.com/pricing/messaging) ·
[Telnyx 10DLC fees](https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges) ·
[Resend](https://resend.com/pricing)

**Competitors:** [Jobber](https://www.getjobber.com/pricing/) ·
[Jobber AI Receptionist](https://help.getjobber.com/hc/en-us/articles/25315927533847-Receptionist-powered-by-Jobber-AI) ·
[Housecall Pro](https://www.housecallpro.com/pricing/) ·
[GoHighLevel](https://www.gohighlevel.com/pricing) ·
[Podium](https://www.podium.com/pricing/) · [Thryv](https://www.thryv.com/pricing/) ·
[Rosie](https://heyrosie.com/pricing) · [Goodcall](https://www.goodcall.com/pricing) ·
[Smith.ai](https://smith.ai/pricing) · [Ruby](https://www.ruby.com/pricing/) ·
[PATLive](https://www.patlive.com/pricing/) · [Abby Connect](https://www.abby.com/pricing) ·
[Retell AI](https://www.retellai.com/pricing) · [Vapi](https://vapi.ai/pricing)

**Call-corpus statistics (n=1,446,980 calls):**
[NextPhone AI receptionist statistics](https://www.getnextphone.com/blog/ai-receptionist-statistics) ·
[NextPhone pricing guide](https://www.getnextphone.com/blog/ai-receptionist-pricing-guide) ·
[OnceHub answering-service cost survey](https://www.oncehub.com/blog/answering-service-cost)

**Rio Grande Valley:**
[BLS, Occupational Employment and Wages, McAllen-Edinburg-Mission, May 2025](https://www.bls.gov/regions/southwest/news-release/occupationalemploymentandwages_mcallen.htm) ·
[McAllen-Edinburg-Mission metro profile](https://datausa.io/profile/geo/mcallen-edinburg-mission-tx) ·
[Brownsville-Harlingen metro profile](https://datausa.io/profile/geo/brownsville-harlingen-tx) ·
[Hidalgo County QuickFacts](https://www.census.gov/quickfacts/hidalgocountytexas) ·
[Kennedy Media Group](https://kennedymedia.com/) · [RankRGV](https://rankrgv.com/ads-management/)

**Margin and churn benchmarks:**
[SaaS gross margin 2026](https://www.getaleph.com/answers/saas-gross-margin-2026) ·
[SaaS churn benchmarks](https://www.mrrsaver.com/blog/saas-churn-rate-benchmarks)
