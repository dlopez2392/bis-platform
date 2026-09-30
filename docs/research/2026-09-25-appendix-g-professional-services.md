# Appendix G — Professional services: law, insurance, tax, real estate, freight

Part of `2026-09-25-crm-feature-research.md`. Compiled 2026-09-25 by a delegated research agent: incumbent software and prices, the capabilities each segment needs, documents, and compliance cited to primary sources (FTC Safeguards Rule, IRC 7216, Texas disciplinary rules and ethics opinions 680 and 705, Gov't Code 406.017 on notarios, Texas Insurance Code 4001.051, 45 CFR 155.220, SB 140). Secondhand claims marked [2H].

---

# Research G — Professional-services segments for BIS in the Rio Grande Valley

**Date:** 2026-09-25 · **Scope:** law firms, independent insurance agencies, tax/bookkeeping offices, real estate agents and property managers, customs brokers/freight forwarders/small trucking, all in the Rio Grande Valley (RGV: Hidalgo, Cameron, Starr, Willacy counties), with Laredo (Webb) noted for freight.
**Method:** I checked vendor pricing pages, primary regulations and statutes (eCFR via Cornell LII, Texas statutes, the Texas legal-ethics center, TDI, TREC, IRS, FTC, CBP), and Census County Business Patterns and Nonemployer Statistics files. I did not read the BIS codebase. BIS capabilities below come from the brief.

**Legend**
- **[2H]** = secondhand. The claim comes from a reseller, aggregator, competitor, trade association or law-firm summary, not from the vendor's own page or the primary legal text.
- **Status column:** **HAVE** = live in BIS today · **PLANNED** = on the stated roadmap · **NEW** = not on the roadmap.
- **Compliance class:** **(i)** negligible · **(ii)** moderate: achievable with controls BIS should have anyway (MFA, encryption, access logs, WISP support, DPA) · **(iii)** expensive, HIPAA-like.
- **Scores:** 1–5. For compliance cost, 5 means cheapest.

---

## 0. Bottom line

| Rank | Segment (focus) | Fit | Valley demand | Willingness to pay | Incumbent weakness | Compliance cost (5 = cheap) | Total /25 | Target in the next 12 months? |
|---|---|---|---|---|---|---|---|---|
| 1 | **Law firms**: immigration, family, criminal defense; personal injury for inbound intake only | 4 | 5 | 4 | 3 | 3 | **19** | **Yes, first** |
| 2 | **Independent insurance agencies**: personal lines, non-standard auto and ACA-marketplace storefronts | 4 | 5 | 3 | 3 | 3 | **18** | **Yes, second** (P&C plus ACA; hold back Medicare and group health) |
| 3 | Customs brokers, forwarders, small trucking (Pharr/McAllen, Laredo) | 2 | 4 | 3 | 3 | 4 | 16 | Pilot only (2–3 design partners), not a launch segment |
| 4 | Real estate agents and residential property managers | 3 | 3 | 2 | 2 | 4 | 14 | No. At most, small property managers through a Buildium/AppFolio integration |
| 5 | Tax preparation and bookkeeping | 3 | 4 | 2 | 2 | 2 | 13 | No, with one exception: a receptionist-only seasonal overflow offer that stores no tax documents |

Why these two go first:

- **Law firms and insurance agencies both need the same next roadmap items:** document vault, required-document checklists, expiry reminders, e-signature, households/relationships and the consent ledger.
- **They are the two places where a Spanish-first AI voice is worth the most.**
  - Immigration callers are overwhelmingly Spanish-speaking and are facing shorter hearing notices.
  - Non-standard auto and ACA storefronts run on Spanish phone traffic.
- **Neither triggers HIPAA or the FTC Safeguards Rule directly:**
  - Law firms are governed by Texas ethics rules.
  - Insurance agencies fall under GLBA as enforced by TDI, not the FTC.
- **Incumbent AI in both segments is either brand-new or bolted on:**
  - Clio's voice intake agent launched 2026-08-20.
  - AgencyZoom has no native voice agent and relies on partners.

Why not the others:

- **Tax preparation:** it is the only segment where BIS's own obligations grow sharply.
  - BIS would be a service provider under the FTC Safeguards Rule.
  - BIS would likely also be a "tax return preparer" for IRC §7216 purposes.
  - The incumbents are strong and cheap: TaxDome costs $58–$100 per user per month and ships a Spanish client portal.
- **Real estate:** buyers have low willingness to pay and many already get a CRM free from their brokerage. Zillow, Lofty and AppFolio already ship multilingual AI leasing and lead agents.
- **Freight:** the job to be done lives in the TMS or ABI system, not a CRM.

**HIPAA flags** (all four stay out of scope):
- Insurance agencies selling Medicare or group health, which can become business associates of health plans (my analysis; see §4d).
- Law firms whose clients are healthcare providers, such as medical-malpractice defense, because they are HIPAA business associates.
- Personal-injury plaintiff firms are **not** HIPAA-covered, although they hold medical records ([2H](https://www.ernstlawgroup.com/personal-injury-faqs/are-personal-injury-lawyers-subject-to-hipaa/), [2H](https://www.uslegalsupport.com/blog/hipaa-compliance-law-firms/)).
- DOT medical certificates in trucking driver files are not HIPAA-covered, but they are sensitive.

---

## 1. Valley context

**Population and language**
- McAllen–Edinburg–Mission MSA: population 914,820; 26% foreign-born; median household income $56,720; poverty 24.4% (ACS 2024 1-year) ([Census Reporter](http://censusreporter.org/profiles/31000US32580-mcallen-edinburg-mission-tx-metro-area/)).
- Brownsville–Harlingen MSA: population 431,874; 23.5% foreign-born; median household income $53,267; poverty 24.7% ([Census Reporter](http://censusreporter.org/profiles/31000US15180-brownsville-harlingen-tx-metro-area/)).
- About 80.7% of Hidalgo County residents speak Spanish at home (2023 ACS, via [BorderReport](https://www.borderreport.com/news/census-bureau-estimates-1-in-3-texans-speak-a-language-other-than-english-at-home/) [2H]).

**Health insurance**
- Hidalgo County had 200,636 ACA-marketplace enrollees in 2025, the fifth-most of any Texas county.
- 98% of RGV enrollees received advance premium tax credits.
- The enhanced subsidies expired, so premiums rose for 2026 ([Texas Tribune](https://www.texastribune.org/2025/12/29/texas-rio-grande-valley-counties-aca-cuts-enhanced-subsidies/)). That means more service calls and more churn for agents.

**Immigration**
- 3,092,988 cases were pending nationally at the end of August 2026 ([TRAC](https://tracreports.org/immigration/quickfacts/eoir.html)).
- Courts, Harlingen among them, are compressing hearing notice times. No-show rates doubled to 40% by June 2026 ([ABC News](https://abcnews.com/US/wireStory/breakneck-pace-immigration-courts-driving-deportation-orders-135280987) [2H]).
- Result: urgent, time-sensitive Spanish calls to immigration firms.

**Freight**
- Pharr is the top U.S. produce crossing: more than 200,000 produce truckloads a year and about 70% of U.S. avocado imports ([Pharr International Bridge](https://bridge.pharr-tx.gov/our-services/) [2H via search summary]).
- Truck crossings were up 16% year over year in October FY2025-26 ([Pharr bridge crossings](https://bridge.pharr-tx.gov/crossings-and-revenues-monthly-comparison/)).

**Business counts: the addressable base.** Employer establishments come from Census [County Business Patterns 2023](https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23co.zip). Sole proprietors with no employees come from Census [Nonemployer Statistics 2023](https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2023/historical-datasets/nonemp23co.zip). I computed the RGV figures from the county files (four RGV counties; Webb = Laredo).

| Industry (NAICS) | RGV employer establishments | Of which under 5 employees (Hidalgo + Cameron) | RGV nonemployers (average receipts) | Webb (Laredo) employer establishments |
|---|---|---|---|---|
| Offices of lawyers (541110) | 510 | 355 | 879 in legal services, NAICS 5411 (~$65k) | 85 |
| Insurance agencies/brokerages (524210) | 524 | 354 | 1,555 (~$59k) | 90 |
| Tax preparation (541213) | 139 | 86 | 622 (~$39k) | 30 |
| Bookkeeping/other accounting (541219) + CPA (541211) | 128 + 92 | 92 + 54 | 1,128 + 78 (~$22k / ~$50k) | 53 + 38 |
| Real estate agents/brokers (531210) | 190 | 168 | 1,362 (~$53k) | 33 |
| Residential property managers (531311) | 120 | 95 | 732 in NAICS 53131 (~$58k) | 16 |
| Freight transportation arrangement (488510: customs brokers, forwarders, freight brokers) | 218 | 118 | 991 in NAICS 488 (all transport support) | **663** |
| Truckload trucking (484121) + local (484110) | 286 + 108 | 188 + 77 | 10,370 in NAICS 4841 (~$120k) | 446 + 153 |

How to read the table:
- Law, insurance and freight have the most **employer** offices, meaning staffed front desks that miss calls.
- Tax, bookkeeping and real estate are dominated by **one-person operations with low receipts**. That is weak willingness to pay for a multi-seat CRM.
- Laredo, not the RGV, is the customs-brokerage center: 663 freight-arrangement establishments versus 218 in the RGV.

Other reference points:
- The Greater McAllen Association of REALTORS reports 5,000+ members ([AgentFire](https://agentfire.com/mls-coverage/greater-mcallen-association-of-realtors/) [2H]).
- The Hidalgo County Bar Association has 600+ members ([Hidalgo County](https://www.hidalgocounty.us/3060/Hidalgo-County-Bar-Association) [2H]).

---

## 2. Cross-cutting compliance: read this once, it applies to every segment

### 2.1 FTC Safeguards Rule (16 CFR Part 314): who is a "financial institution"?

**Scope:** the rule applies to financial institutions under FTC jurisdiction. Institutions that another regulator enforces under GLBA §505 are excluded ([FTC guidance](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)). GLBA §505 hands insurance to the **state insurance authority** and leaves everything else to the FTC ([15 U.S.C. §6805(a)(6)–(7)](https://www.law.cornell.edu/uscode/text/15/6805)).

| Segment | Covered by the FTC Safeguards Rule? | Basis |
|---|---|---|
| Tax preparers | **Yes, explicitly** | "Tax preparation services" is a listed example in [16 CFR 314.2(h)](https://www.law.cornell.edu/cfr/text/16/314.2). "Tax preparation firms" appear in the [FTC guidance](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know). The IRS says "tax professionals are required by law to have a WISP" ([IRS, 2024-12-06](https://www.irs.gov/newsroom/tax-professional-tips-for-creating-a-data-security-plan)). |
| Bookkeepers / CPA firms | Yes when they prepare returns. Treat pure bookkeeping as likely covered. | Tax-preparation example above. The bookkeeping-only position is my analysis, not a cited ruling. |
| Independent insurance agencies | **No** (GLBA is enforced by TDI instead) | [15 U.S.C. §6805(a)(6)](https://www.law.cornell.edu/uscode/text/15/6805); Texas privacy rules at [Ins. Code ch. 601](https://texas.public.law/statutes/tex._ins._code_title_5_subtitle_d_chapter_601) and [28 TAC ch. 22](https://www.tdi.texas.gov/rules/2001/privacy3.html) (§4d) |
| Real estate agents/brokers, property managers | Generally **no** | Not among the §314.2(h) examples. The examples that *are* listed include real estate appraisers, mortgage brokers, "finders" and "real estate settlement service providers" ([16 CFR 314.2](https://www.law.cornell.edu/cfr/text/16/314.2)). Title agents fall under the state insurance commissioner; closing-only companies fall under the FTC ([ALTA](https://www.alta.org/news-and-publications/news/20231031-FTC-Amends-GLBAs-Safeguards-Rule) [2H]). |
| Law firms | Generally **no**, unless the firm also prepares tax returns or does lending-type work | Not a listed activity (my analysis). |
| Customs brokers / forwarders / trucking | Generally **no** | Customs brokerage is not among the listed "financial in nature" examples (my analysis). Freight **factoring** companies are lenders and would be covered, but they are not BIS's target. |

**What the rule requires** ([16 CFR 314.4](https://www.law.cornell.edu/cfr/text/16/314.4)):
- A designated **Qualified Individual**.
- A **written risk assessment**.
- Access controls, a data inventory, and **encryption of customer information in transit and at rest** ((c)(3)).
- Secure development practices.
- **MFA "for any individual accessing any information system"** ((c)(5)).
- Secure **disposal no later than two years** after last use ((c)(6)).
- Change management ((c)(7)).
- **Logging and monitoring of authorized-user activity** ((c)(8)).
- Annual penetration tests and vulnerability scans every six months ((d)).
- Staff training ((e)).
- **Service-provider oversight** ((f)).
- A written incident-response plan ((h)).
- An annual written report to the board ((i)).
- **FTC notification within 30 days of discovering a "notification event" involving 500 or more consumers** ((j)). A notification event is the unauthorized acquisition of *unencrypted* customer information ([§314.2](https://www.law.cornell.edu/cfr/text/16/314.2)). The FTC says this took effect in **May 2024** ([FTC guidance](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)).

**Small-institution exemption:** institutions holding data on fewer than 5,000 consumers are exempt from §314.4(b)(1), (d)(2), (h) and (i). That covers the written risk assessment, pen testing and scans, the written IR plan and the board report ([16 CFR 314.6](https://www.law.cornell.edu/cfr/text/16/314.6)). Most RGV tax shops are under 5,000 consumers, but **MFA, encryption, logging and vendor oversight still apply**.

**What this means for BIS as a CRM vendor holding covered clients' data:**
- BIS is a "service provider": an entity that "receives, maintains, processes, or otherwise is permitted access to customer information" through services to a financial institution ([§314.2](https://www.law.cornell.edu/cfr/text/16/314.2)).
- The rule does not regulate BIS directly. Instead, the client must:
  - select a provider capable of appropriate safeguards;
  - **require them by contract**;
  - periodically assess the provider ([§314.4(f)](https://www.law.cornell.edu/cfr/text/16/314.4)).
- Responsibility stays with the client even when implementation is outsourced ([FTC guidance](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)).
- In practice BIS will be asked for:
  - a security addendum or DPA;
  - proof that MFA is enforced, data is encrypted at rest and in transit, and user access is logged;
  - breach-notice timing fast enough for the client's 30-day FTC clock;
  - disposal controls;
  - a subprocessor list;
  - answers to a security questionnaire.

  This is class (ii) work, not HIPAA-grade. There is no mandated BAA-style regime and no OCR-style audit program.

### 2.2 Texas-wide data rules that bind BIS itself

- **Breach notification** ([Bus. & Com. Code §521.053](https://texas.public.law/statutes/tex._bus._and_com._code_section_521.053)):
  - A holder of data it does not own (BIS) must notify the owner (the tenant) **"immediately after discovering the breach"** (§521.053(c)).
  - The owner must notify individuals within 60 days (§521.053(b)).
  - The owner must notify the Attorney General within 30 days if 250 or more Texans are affected (§521.053(i)).
- **Texas Data Privacy and Security Act (TDPSA, Bus. & Com. Code ch. 541):** effective 2024-07-01 ([Hunton](https://www.hunton.com/insights/legal/texas-enacts-texas-data-privacy-and-security-act) [2H]).
  - "Sensitive data" expressly includes **citizenship or immigration status**. This matters for immigration firms.
  - Processors owe contract terms, confidentiality and subprocessor oversight.
  - SBA-defined small businesses are largely exempt, except that selling sensitive data needs consent.
  - GLBA-covered financial institutions are exempt at the entity level ([Hunton](https://www.hunton.com/insights/legal/texas-enacts-texas-data-privacy-and-security-act) [2H]).
- **Texas Responsible AI Governance Act (HB 149):** effective 2026-01-01. It places AI-interaction disclosure duties mainly on government agencies and **healthcare providers**; most private businesses have no disclosure mandate ([Sheppard](https://www.sheppard.com/insights/blogs/texas-enacts-sweeping-ai-law-disclosure-consent-and-compliance-requirements-take-effect-in-2026) [2H], [Norton Rose](https://www.nortonrosefulbright.com/en/knowledge/publications/c6c60e0c/the-texas-responsible-ai-governance-act) [2H]). None of the five segments is healthcare. BIS should still have Sofía disclose that she is a virtual assistant, because ethics rules and TREC effectively require it (below).

### 2.3 Texting and calling: TCPA and Texas SB 140

- **SB 140 (effective 2025-09-01)** extends Texas telephone-solicitation law (Bus. & Com. Code ch. 302) to marketing **texts** ([Morgan Lewis](https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages) [2H]).
  - Unless exempt, a sender must register with the Secretary of State.
  - Consumers get a DTPA private right of action of up to $1,500 per violation, with treble damages for willful violations.
- **Exemptions that matter:**
  - holders of an **Insurance Code license, when the transaction is governed by that code** ([§302.053(3)](https://texas.public.law/statutes/tex._bus._and_com._code_section_302.053));
  - solicitations to **current or former customers by a business operating under the same name for at least two years** ([§302.058](https://texas.public.law/statutes/tex._bus._and_com._code_section_302.058));
  - solicitors who do not complete the sale during the call and instead **arrange a later in-person presentation**, which arguably covers appointment-setting for consultations, plus retail establishments of at least two years ([§302.059](https://texas.public.law/statutes/tex._bus._and_com._code_section_302.059)).
- The Texas AG told a federal court that **consent-based (opt-in) text programs fall outside registration** ([CFS Law Monitor, 2025-11](https://www.consumerfinancialserviceslawmonitor.com/2025/11/texas-attorney-general-confirms-opt-in-sms-is-outside-registration-under-sb-140/) [2H]).
- **There is no real-estate exemption.**
- **Federal TCPA:**
  - The FCC's one-to-one consent rule was **vacated** by the Eleventh Circuit on 2025-01-24 in *Insurance Marketing Coalition v. FCC* ([MoFo](https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule) [2H]).
  - The FCC ruled that **AI-generated voices are "artificial" voices under the TCPA**, so outbound AI calls need prior express consent ([FCC 24-17](https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf)).
- **Implication:** the planned **consent ledger** is a hard requirement for every segment. It must record who consented, how (web form, keyword, recorded call), when, the scope, and revocations. It is the evidence behind the AG's opt-in safe harbor and TCPA defenses. Sofía's outbound calling should stay consent-gated.

### 2.4 The "regulated-professional baseline" BIS should build once for all five segments

All of this is class (ii) and applies across segments:
1. **Controls:**
   - MFA enforced per tenant.
   - Encryption at rest and in transit (documented).
   - An immutable, exportable per-user access/audit log.
   - Per-tenant retention and disposal policies that can hold records for years: 2-year disposal default for FTC-covered tenants; 5 years for CBP; 10 years for CMS consents.
   - Legal hold.
2. **Paperwork:**
   - A **DPA/security addendum** mirroring 16 CFR 314.4(f) and TDPSA processor terms, promising owner notice within 24 hours or less.
   - A published subprocessor list, including LLM, voice and telephony vendors, with **U.S.-only processing** (needed for IRC §7216; see §5d).
   - A WISP-support pack.
   - A government-data-request policy (important for immigration tenants).
3. **Sofía guardrail packs per vertical:**
   - no legal, insurance or tax advice;
   - fair-housing-safe language;
   - disclosure that she is a virtual assistant, in the caller's language;
   - **caller identity verification before discussing an existing matter, policy or return**;
   - hot-transfer rules for emergencies.
4. **Consent ledger** (see §2.3).

---

## 3. Segment 1 — Law firms (immigration, personal injury, family, criminal defense)

### 3a. Incumbents and 2026 prices

| Product | What it does | 2026 price | Source |
|---|---|---|---|
| **Clio Manage + Grow** | Practice management (matters, billing, trust) plus Grow (intake CRM) | Starter $39/user/mo (annual), $49 (monthly); Core $69/$79 (Grow is an add-on); **Signature $99/$119, includes Grow**; Elite $249/$299, adds Grow AI | [clio.com/pricing](https://www.clio.com/pricing/) (page modified 2026-07-31) |
| **Clio Grow AI** | Phone, email and web-chat intake agents; lead assessment; SMS/email follow-up | **$25 per converted lead**, nothing if the lead does not convert; voice agent U.S.-only; launched 2026-08-20; no Spanish support mentioned | [LawSites](https://www.lawnext.com/2026/08/clio-grows-clio-grow-with-launch-of-grow-ai-providing-24-7-intake-agents.html) [2H] |
| **Lawmatics** | Intake and marketing automation CRM | Quote-only: Essential and Premium (3-user minimum), Enterprise (5-user minimum). Add-ons: QualifyAI; Merlin Engage (outcome-based pricing); Merlin Copilot (per user) | [lawmatics.com/pricing](https://www.lawmatics.com/pricing) |
| **MyCase** | Practice management plus intake, texting, e-sign at Pro | Basic $50, **Pro $100**, Advanced $130 per user/mo annual ($60/$120/$150 monthly) | [MyCase help center, 2026-06-01](https://supportcenter.mycase.com/en/articles/9369812-how-much-does-mycase-cost) |
| **Docketwise** (immigration) | USCIS smart forms, case management, multilingual questionnaires, client portal | Basic $80, **Pro $100** (adds CRM/leads, texting, e-sign, Docketwise IQ AI), Advanced $120 per user/mo annual ($90/$120/$140 monthly) | [docketwise.com/pricing](https://www.docketwise.com/pricing/) |
| **CASEpeer** (PI) | PI case management: intake at Pro, texting, portal, 8am IQ AI | Basic $90, **Pro $130**, Advanced $160 per user/mo; e-sign is an add-on | [casepeer.com/pricing](https://www.casepeer.com/pricing/) |
| **Smith.ai** | AI and human receptionist and legal intake | AI Receptionist: Free (25 calls, $3 overage), **Pro $150/mo** (75–300 calls), Enterprise $500/mo; lists "bilingual answering" | [smith.ai AI pricing](https://smith.ai/pricing/ai-receptionist) |
| LawPay (payments) | Trust-safe card/ACH | Starter $20, Grow $70, Pro $149/mo; 2.99% + $0.30 per card | [Lawyerist](https://lawyerist.com/reviews/accounting-billing-finance/lawpay/) [2H], [Merchant Insiders](https://merchantinsiders.com/blogs/lawpay-fees/) [2H] |

### 3b. The 8 capabilities that matter most

| # | Capability | Why it matters here | BIS status |
|---|---|---|---|
| 1 | **24/7 Spanish-first intake and triage by practice area** (immigration / PI / family / criminal), with urgency routing (detained relative, hearing within 7 days, arrest tonight, accident today) | Missed calls go to the next firm. Urgent calls need a human now. | **HAVE** (Sofía, booking, handoff). **NEW:** legal triage scripts and urgency rules |
| 2 | **Consultation booking with paid-consult deposit** | Most immigration consults are paid | **HAVE** booking; **PLANNED** Stripe payments. **NEW:** route funds through a trust-safe processor such as LawPay; card fees must not hit the IOLTA ([TLIE](https://www.tlie.org/resource/can-you-pay-credit-card-and-paypal-fees-from-trust-accounts) [2H]; [Rule 1.15](https://www.legalethicstexas.com/resources/rules/texas-disciplinary-rules-of-professional-conduct/safekeeping-property/)) |
| 3 | **Conflict-check data capture** (adverse parties, co-defendants, other driver) before the consult | Ethics requirement before accepting a matter | **NEW** (capture fields plus a simple name search; leave full conflicts to the practice-management system) |
| 4 | **Engagement letter / fee agreement e-signature**, bilingual | Converts the consult into a client | **PLANNED** (e-signature) |
| 5 | **Case-type document checklists with a Spanish client portal**: I-130/I-485/N-400/DACA/U-visa packets; PI crash-report and medical-bill packet | This is most of the paralegal chase work | **PLANNED** (vault, required-document checklists, portal) |
| 6 | **Deadline and expiry engine**: EAD, green card, passport, I-94 dates; hearing dates; RFE response windows; PI limitation dates | Missed dates mean malpractice | **PLANNED** (expiry reminders). **NEW:** matter-deadline object; optional sync with [USCIS Case Status API](https://developer.uscis.gov/article/case-status-api-production) (requires onboarding plus Form G-1595 and a demo) and [EOIR case-status lookup](https://www.justice.gov/eoir/eoir-case-information) |
| 7 | **Households/relationships**: petitioner ↔ beneficiary ↔ derivatives; co-defendants; spouses in divorce, with conflict flags | Immigration is inherently family-graph work | **PLANNED** (households/relationships) |
| 8 | **AI call summaries into the practice-management system, human-approved; consented Spanish SMS status updates** | Opinion 705 requires lawyer verification of AI output. BIS's human-approve pattern fits that directly. | **HAVE** (summaries, proposed updates, SMS). **PLANNED** (consent ledger, MCP). **NEW:** Clio/MyCase/Docketwise integrations |

### 3c. Documents collected, and how the planned vault features serve them

**Immigration**
- Passports (expiry), I-94 records (admit-until date), birth and marriage certificates, divorce decrees, **certified English translations of Spanish documents**, prior USCIS notices (I-797), EAD and green cards (expiry dates), police records and court dispositions, Notices to Appear and hearing notices, tax returns and pay stubs (I-864 affidavit of support), photos, the sealed I-693 medical exam, and a signed G-28.
- Per-case-type checklists auto-generated at matter open cut paralegal chasing.
- Expiry reminders drive **renewal revenue**, since EAD and green-card renewals are repeat business.
- E-signature covers the fee agreement, G-28 and client declarations. Wet-ink USCIS signature rules still apply to many forms; the firm decides.

**Personal injury**
- Crash report, photos, the other party's insurance, health-insurance cards, medical records and bills, letters of protection, lien notices, wage-loss letters, HIPAA authorizations signed by the client.
- **Not HIPAA for the firm** ([2H](https://www.ernstlawgroup.com/personal-injury-faqs/are-personal-injury-lawyers-subject-to-hipaa/)), but these files contain health data. Restrict them by role and log access.

**Family**
- Financial disclosures, pay stubs, tax returns, orders, custody schedules.

**Criminal**
- Bond paperwork, charging instruments, discovery, court settings.
- Court-date reminder texts cut failures to appear and forfeited bonds, a strong use for the existing SMS automations.

### 3d. Compliance (class ii)

**Confidentiality — Rule 1.05**
- Protects all client information, privileged and unprivileged ([Rule 1.05](https://www.legalethicstexas.com/resources/rules/texas-disciplinary-rules-of-professional-conduct/confidentiality-of-information/)).
- The Texas rule text has no ABA 1.6(c)-style technology clause. The duties come from ethics opinions instead.

**Cloud — Opinion 680 (2018)**
- Lawyers may store confidential data in the cloud with "reasonable precautions":
  - understand the technology;
  - review the provider's terms;
  - learn its security protections;
  - consider encryption;
  - monitor vulnerabilities;
  - train staff ([Opinion 680](https://www.legalethicstexas.com/resources/opinions/opinion-680/)).

**AI — Opinion 705 (February 2025)**
- Lawyers must understand the tool, review and possibly renegotiate its terms of service, learn its data-security protections, and train staff.
- It warns that "self-learning" tools may store confidential inputs and reveal them to third parties.
- Lawyers "cannot blindly rely" on AI output. The duty is analogized to supervising nonlawyer assistants under Rule 5.03.
- Lawyers may not bill for time AI "saved" ([Opinion 705](https://www.legalethicstexas.com/resources/opinions/opinion-705/)).
- **BIS needs a one-page "Opinion 680/705 due-diligence sheet"** covering:
  - no training on tenant data;
  - zero-retention LLM subprocessors;
  - encryption;
  - retention and deletion;
  - human approval of AI-proposed updates, which BIS already has.

**Solicitation and advertising**
- Rule 7.03(b) bars soliciting non-clients through **"regulated telephone, social media, or other electronic contact"**: live or electronically interactive communication initiated by, or on behalf of, a lawyer ([Rule 7.03](https://www.legalethicstexas.com/resources/rules/texas-disciplinary-rules-of-professional-conduct/solicitation-and-other-prohibited-communications/)).
  - → Sofía must be **inbound-only** for law firms.
  - Follow-ups go only to people who contacted the firm and consented.
  - No AI outbound to purchased lists.
- For PI, Penal Code §38.12 criminalizes written solicitation about an accident before the 31st day. It was reportedly amended effective 2025-09-01 to reach electronic direct messages ([Justia §38.12](https://law.justia.com/codes/texas/penal-code/title-8/chapter-38/section-38-12/); amendment per search summary [2H]).
- Rule 7.01(a): a statement is misleading if it creates "unjustified expectations about the results the lawyer can achieve."
- Rule 7.01(d): required disclaimers must be made "in each language used in the communication" ([Rule 7.01](https://www.legalethicstexas.com/resources/rules/texas-disciplinary-rules-of-professional-conduct/communications-concerning-a-lawyers-services/)). Sofía's disclaimers must be bilingual.

**Unauthorized practice of law (UPL)**
- "Practice of law" includes "the giving of advice or the rendering of any service requiring the use of legal skill or knowledge" ([Gov't Code §81.101](https://texas.public.law/statutes/tex._gov't_code_section_81.101)).
- The statutory software carve-out needs a conspicuous "not a substitute for the advice of an attorney" statement ([same](https://law.justia.com/codes/texas/government-code/title-2/subtitle-g/chapter-81/subchapter-g/section-81-101/)).
- The practical frame is that Sofía is the firm's **nonlawyer assistant** and must not give legal advice.

**Notario fraud**
- [Gov't Code §406.017](https://texas.public.law/statutes/tex._gov't_code_section_406.017) makes it an offense for a notary to:
  - claim or imply being a licensed attorney;
  - accept pay to prepare immigration documents or obtain relief from an agency;
  - **use "notario" or "notario publico" in advertising**.
- Non-English advertising requires the notice *"I am not an attorney licensed to practice law in Texas and may not give legal advice or accept fees for legal advice."*
- Penalties: Class A misdemeanor, a third-degree felony on repeat, plus DTPA liability.
- Federally, only attorneys and accredited representatives may represent people before USCIS ([8 CFR 292.1](https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-292/section-292.1); [USCIS](https://www.uscis.gov/scams-fraud-and-misconduct/avoid-scams/common-scams)).
- → **BIS tenant policy:** accept immigration-services tenants only if they are licensed attorneys (verify the bar number) or DOJ-recognized organizations with accredited representatives. Otherwise BIS risks powering a notario operation.

**What Sofía must never say to an immigration caller** (a guardrail pack, in both languages):
1. **Eligibility and outcomes.** Never tell a caller they "qualify," "will get papers / permiso / green card," or that a case "is easy." That is legal advice and creates unjustified expectations (Rules 7.01 and 5.03).
2. **Identity.** Never call itself or the firm a "notario," never imply it is an attorney, and never say "we can file your papers" unless the tenant is a law firm or accredited organization (§406.017; 8 CFR 292.1).
3. **Case strategy.**
   - Never advise whether to attend or skip a hearing, travel or leave the U.S., talk to ICE, or sign anything.
   - Never recommend a specific form.
   - Never quote legal fees as a guarantee of any result.
4. **Money.** Never ask for payment "for the forms." USCIS warns that official forms are free ([USCIS](https://www.uscis.gov/scams-fraud-and-misconduct/avoid-scams/common-scams)).
5. **Other clients.** Never discuss any client's case without identity verification.

What Sofía **should** always do:
- Disclose that she is a virtual assistant and not a lawyer, in the caller's language.
- Book a consult.
- Hot-transfer detention, same-week hearing and ICE-encounter calls to a human.

**Other risks**
- **Law-enforcement requests.** Immigration status is TDPSA sensitive data ([Hunton](https://www.hunton.com/insights/legal/texas-enacts-texas-data-privacy-and-security-act) [2H]). Publish a policy to notify the tenant and require legal process for any government request.
- **Personal injury.** Plaintiff firms are not HIPAA-covered, but firms that act *for* healthcare providers are business associates ([2H](https://www.uslegalsupport.com/blog/hipaa-compliance-law-firms/)). Exclude med-mal defense and healthcare-client firms.

**Verdict on compliance: class (ii).** The spend is mostly guardrail engineering and a vendor due-diligence packet. There is no statutory audit regime.

### 3e. Incumbent AI (2025–26) and where bilingual voice wins

**What incumbents ship**
- **Clio:** Grow AI with phone, email and chat intake agents at $25 per converted lead (voice U.S.-only, launched 2026-08-20) [2H](https://www.lawnext.com/2026/08/clio-grows-clio-grow-with-launch-of-grow-ai-providing-24-7-intake-agents.html). Clio Work and Vincent agents after the vLex deal ([Artificial Lawyer](https://www.artificiallawyer.com/2026/04/08/clio-rolls-out-agents-for-work-and-vincent/) [2H]). "Manage AI" features across Core and above ([Clio](https://www.clio.com/pricing/)).
- **Lawmatics:** QualifyAI, Merlin Engage agents and Merlin Copilot ([Lawmatics](https://www.lawmatics.com/pricing)).
- **MyCase / CASEpeer:** 8am IQ writing assistance ([CASEpeer](https://www.casepeer.com/pricing/)).
- **Docketwise:** Docketwise IQ ([Docketwise](https://www.docketwise.com/pricing/)).
- **Smith.ai:** AI receptionist from $0–$150 per month ([Smith.ai](https://smith.ai/pricing/ai-receptionist)).

**Where BIS wins**
- None of the practice-management vendors publicly positions a **Spanish-first** voice intake agent.
- Clio's announcement mentions no languages.
- BIS's wedge: Sofía as the Spanish/English front door, pushing structured intake and human-approved summaries into Clio, MyCase or Docketwise.
- Highest value is at **immigration** firms (Spanish callers, urgent hearing notices, family members of detainees) and **criminal defense** (after-hours arrests).

### 3f. Do not build — integrate instead

**Do not build:**
- matter and practice management, time and billing, **IOLTA trust accounting**;
- USCIS form filling or e-filing;
- court e-filing;
- legal research;
- full conflict databases.

**Integrate with:**
- Clio (API; Grow and Manage), MyCase, Docketwise, CASEpeer;
- LawPay for trust-safe payments;
- USCIS Case Status API (through BIS's own Torch onboarding, or a partner);
- EOIR status lookup.

### 3g. Verdict

Fit 4 · Valley demand 5 · Willingness to pay 4 · Incumbent weakness 3 · Compliance cost 3 → **target first.**

Firms already pay $100–$130 per user per month for Pro tiers that bundle intake, plus $25 per converted lead for Clio's AI. BIS can price below Smith.ai's human bilingual plans and match Clio's AI on Spanish.

Start with **immigration + family + criminal defense**, where the Spanish-call share is highest and deadlines drive repeat revenue. Add **PI as inbound-only intake**: PI firms have the biggest budgets, but solicitation law and medical-record handling make outbound and vault use riskier.

The rollout depends on four roadmap items: document vault/checklists/portal, e-signature, households and the consent ledger. Payments should route through LawPay rather than raw Stripe.

---

## 4. Segment 2 — Independent insurance agencies (personal lines, non-standard auto, bilingual)

### 4a. Incumbents and 2026 prices

| Product | What it does | 2026 price | Source |
|---|---|---|---|
| **AgencyZoom** (Vertafore) | Sales/retention CRM on top of an agency management system (AMS). Its own FAQ: "Does this replace my AMS? No." | Independent agencies: Essential $149, Growth $199 (adds texting, renewal automation, Google reviews), Pro $349 (adds click-to-call, service center) per month; **7 users included**; annual billing −20% | [agencyzoom.com/pricing](https://www.agencyzoom.com/pricing) |
| **EZLynx** (Applied) | AMS plus comparative rater plus client portal; EVA AI assistant | Quote-based ("depends on how many users"). Third party: from ~$350/mo; $400–$600/mo for a small agency with modules | [EZLynx](https://www.ezlynx.com/why-ezlynx/pricing/); [unLocked CRM](https://unlockedcrm.ai/blog/how-much-does-ezlynx-really-cost) [2H] |
| **HawkSoft 6** | Cloud AMS | **$99/user/mo retail**; text messaging and e-sign cost extra (text messaging $20/agency/mo per HawkSoft's blog [2H]) | [HawkSoft 6 FAQ](https://www.hawksoft.com/6/faq.html) |
| **Applied Epic** | Enterprise AMS | No public rate card. ~$150–$200+ per user per month; implementation $10k+ | [ITQlick](https://www.itqlick.com/applied-epic/pricing) [2H] |
| **Better Agency** | P&C CRM | $149/mo for 3 users, plus $35 per extra user | [SelectHub/aggregators](https://www.selecthub.com/p/insurance-agency-management-systems/better-agency/) [2H] |
| NowCerts | Low-cost AMS popular with small agencies | From ~$99/mo | [SelectHub](https://www.selecthub.com/p/insurance-agency-management-systems/nowcerts/) [2H] |
| ITC TurboRater / QuoteRUSH | Comparative raters (TurboRater is strong in non-standard auto) | ~$150–$250 per user per month mid-tier | [InSifter](https://insifter.com/guide-raters.html) [2H] |
| **Sonant** | Insurance-native AI receptionist; Spanish "from the first ring"; Applied Epic integration | Unpublished; est. ~$299/mo for 200 calls | [Sonant](https://www.sonant.ai/blog/best-ai-receptionists-for-insurance-agencies) [2H]; [Velocity](https://insights.velocityaipartners.co/tools/sonant-ai) [2H] |

### 4b. The 8 capabilities that matter most

| # | Capability | Why it matters | BIS status |
|---|---|---|---|
| 1 | **Bilingual inbound quote-request intake** (drivers, license numbers, VINs, prior carrier) with a warm transfer to a **licensed** agent; ID-card and payment-due calls deflected | Storefront phones in Spanish; producers' time is scarce | **HAVE** (Sofía, handoff). **NEW:** structured auto/home intake schema |
| 2 | **Households with vehicles, drivers and properties** | A policy is a household, not a person | **PLANNED** (households; properties/equipment) |
| 3 | **Renewal / X-date pipelines, win-back, cross-sell** (auto → renters/home) | Retention is the profit center | **NEW** (pipelines with renewal dates). Existing SMS/email automations can run the cadences. |
| 4 | **Document vault**: DL, dec pages, proof of prior insurance, SR-22 filings, signed applications, **written PIP/UM rejections** | Carrier underwriting and audits | **PLANNED** (vault, checklists, e-signature) |
| 5 | **Expiry reminders**: policy renewals, driver's-license expiry, SR-22 maintenance periods | Lapses mean lost commission, and SR-22 lapses are reported to the state | **PLANNED** (expiry reminders) |
| 6 | **Consent ledger with recorded verbal consent**, retained 10 years for ACA-marketplace clients | CMS requires consent documentation (below) | **PLANNED** (consent ledger). **NEW:** 10-year retention plus a call-recording link |
| 7 | **AMS / rater integration** (NowCerts, EZLynx, HawkSoft, AgencyZoom, TurboRater) | The AMS is the system of record | **NEW** (integration). The MCP server (**PLANNED**) helps. |
| 8 | **Self-service**: ID cards, payment links, certificate requests via SMS/portal; caller identity verification before discussing a policy | Routine service calls (ID cards, payment dates) otherwise tie up licensed staff | **PLANNED** (portal). **NEW:** identity verification step in Sofía |

### 4c. Documents and how the vault serves them

**Auto (non-standard especially)**
- Driver's licenses (expiry) or Mexican licenses/matrícula for rating, VINs, registration/title, prior dec page or proof of prior insurance (for discounts), SR-22 filing confirmations, excluded-driver forms, inspection photos, signed applications, ID cards.
- **Written rejections of UM/UIM and PIP.** Texas makes both coverages mandatory unless "any insured named in the insurance policy rejects the coverage in writing" ([Ins. Code §1952.101(c)](https://texas.public.law/statutes/tex._ins._code_section_1952.101); [§1952.152(b)](https://texas.public.law/statutes/tex._ins._code_section_1952.152)).
- That makes bilingual **e-signature plus vault** a compliance feature: a lost rejection form can mean paying claims on coverage the client declined.

**Home**
- Dec pages, wind/hail and flood documents (the Cameron County coast), photos, mortgagee clauses.

**ACA marketplace**
- 1095-A forms, income documents, immigration-status documents for eligibility, the **signed or recorded consumer consent**, and the application-review attestation.

**How the planned features serve these**
- Checklists per line of business.
- Expiry reminders for licenses, renewals and SR-22 terms.
- E-sign for applications, rejections and exclusion forms.
- Households link the documents to the right drivers and vehicles.

### 4d. Compliance (class ii)

**GLBA and privacy**
- GLBA for insurance is enforced by **state insurance authorities**, not the FTC ([15 U.S.C. §6805(a)(6)](https://www.law.cornell.edu/uscode/text/15/6805)). So the **FTC Safeguards Rule does not apply to agencies**; it covers only institutions under FTC jurisdiction ([FTC](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)).
- Texas implements GLBA privacy through Ins. Code ch. 601 and **28 TAC ch. 22**:
  - Subchapter A covers financial-information privacy notices and opt-outs ([TDI](https://www.tdi.texas.gov/rules/2001/privacy3.html); [ch. 601](https://texas.public.law/statutes/tex._ins._code_title_5_subtitle_d_chapter_601)).
  - Subchapter B covers **health** information for life and health lines ([TDI](https://www.tdi.texas.gov/rules/2001/privacy2.html)).

**No insurance-specific security law in Texas**
- **Texas has *not* adopted the NAIC Insurance Data Security Model Law (#668).** NAIC's state chart lists Texas only under "Related Activity," citing the general TDPSA (Bus. & Com. Code §§541.001–.205) ([NAIC chart](https://content.naic.org/sites/default/files/model-law-state-page-668.pdf)).
- So there is no Texas insurance-specific written security program or 72-hour commissioner notice. The general breach law (§2.2) applies. Carrier agency agreements may still impose security terms (my inference).

**Licensing: TDI and the AI receptionist**
- Acting as an agent includes soliciting insurance, **receiving or transmitting an application**, collecting premium, and taking "any other action in the making or consummation of an insurance contract" ([Ins. Code §4001.051(b)](https://texas.public.law/statutes/tex._ins._code_section_4001.051)).
- An unlicensed person's **referral** to an agent is not an agent act "unless the unlicensed person discusses specific insurance policy terms or conditions" ([§4001.051(d)](https://texas.public.law/statutes/tex._ins._code_section_4001.051)).
- Therefore Sofía must:
  - capture a *quote request* and route it;
  - **never** quote premiums, bind, confirm "you're covered," interpret coverage or claims, or advise rejecting UM/PIP.
  - A licensed agent owns the application.
- Have tenant counsel review the "receives or transmits an application" line against the intake design.

**ACA marketplace agents (a large RGV book)**
- Agents must **obtain and document consumer consent before assisting**. Acceptable forms include a signature, an email or **a recorded verbal conversation**, and the records must be kept **at least 10 years** ([45 CFR 155.220(j)(2)(iii)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-B/part-155/subpart-C/section-155.220); [CMS FAQ](https://www.cms.gov/marketplace/agents-brokers/files/2024-pn-ab-faq-9-8-23.pdf)).
- Agents must also document that the consumer reviewed the application (§155.220(j)(2)(ii)).
- The consent ledger plus Sofía's call recordings are a direct fit. **Retention settings must allow 10 years.**

**HIPAA flag**
- Agencies selling **Medicare Advantage/Part D or group health benefits** often sign downstream or business-associate terms with health plans (my analysis; not verified this session). Exclude those lines until the HIPAA investment is made.
- ACA-marketplace agents working for consumers are not HIPAA covered entities (analysis), but TDI's health-privacy subchapter and the CMS agent agreement apply.

**Texting and calling**
- Insurance licensees are exempt from ch. 302 **registration** for Insurance-Code-governed transactions ([§302.053(3)](https://texas.public.law/statutes/tex._bus._and_com._code_section_302.053)). The TCPA still applies.
- AI-voiced outbound renewal calls need prior express consent ([FCC 24-17](https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf)).
- The vacated one-to-one rule came from an *insurance* lead-generation challenge ([MoFo](https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule) [2H]). Lead-vendor consent quality is the live litigation risk.

**Verdict: class (ii).**

### 4e. Incumbent AI and where bilingual voice wins

**What incumbents ship**
- **EZLynx EVA:** email drafting, account summaries and automated text replies (e.g., sends ID cards); no voice ([EZLynx AI](https://www.ezlynx.com/solutions/artificial-intelligence/)).
- **AgencyZoom:** relies on partners for AI voice and call summaries, e.g., Lightspeed Voice NOVA ([Lightspeed](https://www.lightspeedvoice.com/integration/vertafore) [2H]).
- **Insurance-native AI receptionists** (Sonant, Liberate, Cara) advertise bilingual first-ring handling ([Sonant](https://www.sonant.ai/blog/best-ai-answering-services-insurance) [2H]). **This is the crowded flank.**

**Where BIS wins**
- The value is highest at **non-standard auto and ACA storefronts**:
  - reportedly 41–44% of border-metro auto books are non-standard ([A-LA](https://alaautoinsurance.com/resources/texas-auto-insurance-statistics-2026) [2H, vendor]);
  - Hidalgo County has 200k ACA enrollees ([Texas Tribune](https://www.texastribune.org/2025/12/29/texas-rio-grande-valley-counties-aca-cuts-enhanced-subsidies/)).
- Callers ask "¿cuánto debo?", "necesito mi tarjeta" and "¿me cubre?" at volume, peaking in the November–January open-enrollment season.
- BIS differentiates on **CRM plus voice plus consent ledger in one product at AgencyZoom-like pricing**, not on voice alone.

### 4f. Do not build — integrate instead

**Do not build:**
- rating engines or comparative raters;
- policy administration, carrier downloads (IVANS), commission accounting;
- ACA enrollment (enhanced direct enrollment) platforms;
- premium collection on behalf of carriers.

**Integrate with:**
- NowCerts and HawkSoft (common with small shops);
- EZLynx and AgencyZoom (sync contacts and tasks);
- TurboRater/QuoteRUSH (hand off the intake payload).

Stripe (**PLANNED**) is for agency or broker fees only.

### 4g. Verdict

Fit 4 · Valley demand 5 · Willingness to pay 3 · Incumbent weakness 3 · Compliance cost 3 → **target second.**

Price anchors: AgencyZoom is $149–$349 per month for 7 seats; HawkSoft is $99 per user.

Scope the launch to **P&C personal lines plus ACA storefronts**, and exclude Medicare and group health because of the HIPAA exposure. It needs the same shared core as law firms plus one AMS integration (NowCerts or EZLynx first).

---

## 5. Segment 3 — Tax preparation and bookkeeping offices

### 5a. Incumbents and 2026 prices

| Product | What it does | 2026 price | Source |
|---|---|---|---|
| **TaxDome** | Practice management, CRM, client portal, e-sign, SMS; **Spanish-language client portal** | Per user per year: Essentials $800 (1-yr) / $750 (2-yr) / $700 (3-yr); Pro $1,000/$950/$900; Business $1,200/$1,150/$1,100. Seasonal seats: $100/mo (Pro); $500 per 4 months (Business) | [taxdome.com/pricing](https://taxdome.com/pricing) (modified 2026-08-14) |
| **Canopy** | Practice management, portal, doc management, e-sign | Standard $74, Plus $109, Premium $149 per user/mo annual. Tax Workflow Automation from **$34 per client credit**; Tax Resolution $50/user; AI notetaker, doc renaming, smart tax-prep beta | [getcanopy.com/pricing](https://www.getcanopy.com/pricing) |
| **Karbon** | Workflow, email, client requests/portal | Team $59 (annual) / $79 (monthly); Business $89/$99 per user/mo; Enterprise custom | [karbonhq.com/pricing](https://karbonhq.com/pricing/) |
| **SmartVault** | Document portal integrated with Drake, ProSeries, Lacerte, UltraTax and others | Business Pro $55/$75 (3-user minimum); Accounting Pro $65/$85; Accounting Unlimited $85/$110 (unlimited e-sign and KBA, **WISP templates**) per user/mo; SmartRequestAI $12.50/return | [smartvault.com/pricing](https://www.smartvault.com/pricing/) |
| **Drake Portals** (SecureFilePro) | File exchange, questionnaires, messaging, encryption at rest | $29.95/user/mo or $229.95/user/yr; Drake E-Sign costs extra | [Drake KB](https://kb.drakesoftware.com/kb/Drake-Portals/10307.htm) (features); price from [Drake Portals via search](https://securefilepro.com/) [2H] |
| Drake Tax (context) | Tax software | Pay-per-return $379.99 for 10 returns, then $49.99 per individual return [2H] | [Verito](https://verito.com/blog/drake-tax-software/) [2H] |

### 5b. The 8 capabilities that matter most

| # | Capability | BIS status |
|---|---|---|
| 1 | Seasonal (January–April) Spanish overflow answering and booking; "¿ya salió mi reembolso?" deflection to IRS tools **after identity verification** | **HAVE** (Sofía, booking). **NEW:** identity verification |
| 2 | Document request lists per return type: W-2, 1099s, 1098, **1095-A** (ACA reconciliation; big in the RGV), IDs, SSN/ITIN letters | **PLANNED** (checklists, vault, portal) |
| 3 | E-sign: engagement letters, **§7216 consent forms**, e-file authorizations | **PLANNED** (e-sign). **NEW:** §7216 templates; knowledge-based authentication (KBA) |
| 4 | Households (spouse, dependents) | **PLANNED** |
| 5 | Invoices and payments for prep fees. Refund-transfer bank products are *not* BIS's job. | **PLANNED** |
| 6 | Recurring monthly bookkeeping document chase (statements, receipts) | **PLANNED** (checklists) plus automations (**HAVE**) |
| 7 | Security baseline: MFA, encryption, logs, U.S.-only processing, WISP pack | **NEW** (baseline, §2.4) |
| 8 | Integrations with Drake, ProSeries, TaxSlayer Pro, CrossLink and QuickBooks Online | **NEW** |

### 5c. Documents

- W-2, 1099-NEC/MISC/K/G/SSA, 1098/1098-T, 1095-A, photo IDs, Social Security cards, ITIN letters.
- **W-7 packets with passports** for ITIN applicants. Certified Acceptance Agents are common locally ([Garduño Tax](https://gardunotax.com/itin-application) [2H]).
- Prior-year returns, direct-deposit details, dependents' proof of residency and relationship (EITC due diligence), business receipts, and bank statements for bookkeeping.
- The vault, requests and e-sign all fit well. **But every one of these documents is "tax return information,"** which drives the compliance cost below.

### 5d. Compliance: class (ii), at the upper edge

**FTC Safeguards Rule applies to the tenant** (§2.1). BIS becomes a service provider under §314.4(f), expected to show:
- MFA (§314.4(c)(5));
- encryption (§314.4(c)(3));
- logging (§314.4(c)(8));
- disposal within 2 years (§314.4(c)(6));
- incident support for the 500-consumer / 30-day FTC notice (§314.4(j)) ([16 CFR 314.4](https://www.law.cornell.edu/cfr/text/16/314.4)).

**IRS Publications 4557 and 5708 — the WISP**
- "Tax professionals are required by law to have a WISP." The IRS points to Publication 5708 (WISP template), 5709 and 5293, and lists "Contract a service provider that maintains safeguards" as an element ([IRS](https://www.irs.gov/newsroom/tax-professional-tips-for-creating-a-data-security-plan)).
- PTIN renewal now asks for a WISP attestation ([WISPbuilder](https://wispbuilder.com/resources/blog/ptin-renewal-wisp-compliance-2025/) [2H]).
- Publication 4557's "Security Six" include MFA and encryption ([Rightworks](https://www.rightworks.com/blog/irs-pub-4557/) [2H]).
- → BIS should ship a WISP appendix describing its own controls. SmartVault already sells "WISP templates" at its top tier ([SmartVault](https://www.smartvault.com/pricing/)).

**IRC §7216 — does holding tax documents trigger consent?**

Definitions:
- "Tax return information" is any information, including name, address and identifying number, "furnished in any form or manner for, or in connection with, the preparation of a tax return" ([26 CFR 301.7216-1(b)(3)](https://www.law.cornell.edu/cfr/text/26/301.7216-1)).
- "Tax return preparer" includes any person "engaged in the business of providing **auxiliary services** in connection with the preparation of tax returns" (§301.7216-1(b)(2)).
- → **BIS, holding intake data, call summaries and document uploads for a preparer, is likely itself a §7216 "tax return preparer."** It may use or disclose the data only as the regulations permit (my reading).

Disclosures allowed **without** taxpayer consent:
- To another tax return preparer **located in the United States** "for the purpose of … obtaining or providing auxiliary services in connection with the preparation of any tax return," if the services are not substantive tax determinations ([§301.7216-2(d)(1)](https://www.law.cornell.edu/cfr/text/26/301.7216-2)).
- To a contractor "in connection with the programming, maintenance, repair, testing, or procurement of equipment or software used for purposes of tax return preparation," **only if** each recipient gets written notice of "the requirements and penalties of sections 6713 and 7216" (§301.7216-2(d)(2)).

Consent **is** required when:
1. **Data goes offshore.** Disclosures to preparers outside the U.S. need consent, and SSNs generally may not be disclosed offshore; they must be redacted or masked ([§301.7216-3(b)(4)](https://www.law.cornell.edu/cfr/text/26/301.7216-3)). → **BIS's LLM, voice, transcription, support and backup subprocessors must process in the U.S.**, or SSNs must be masked before any offshore hop.
2. **Data is used for non-tax marketing.** Using return information to solicit business unrelated to return preparation, such as insurance or loans, needs a separate consent. The consent cannot be requested after the return is handed over for signature and lasts one year by default (§301.7216-3).

Bottom line:
- A U.S.-only BIS used strictly for the preparer's tax business does **not** need per-taxpayer consent.
- The preparer must give BIS the §6713/§7216 written notice, and BIS must never repurpose the data, including for cross-tenant analytics or model training.

**CPA firms**
- TSBPA Rule 501.75 requires "all reasonable measures" to keep client records confidential and **immediate written notice to clients** on loss of control, including cyber breaches ([22 TAC 501.75](https://www.law.cornell.edu/regulations/texas/22-Tex-Admin-Code-SS-501-75) [via search summary]).
- TSBPA's August 2026 newsletter addresses AI and client data ([TSBPA](https://www.tsbpa.texas.gov/wp-content/uploads/2026/08/br_082026_web_final.pdf) [2H]).

**Texting**
- Marketing texts that use return information need §7216 consent.
- SB 140 registration applies unless an exemption fits: current or former customers of a business operating under the same name for at least two years (§302.058), a retail storefront (§302.059), or opt-in consent ([§302.058](https://texas.public.law/statutes/tex._bus._and_com._code_section_302.058), [§302.059](https://texas.public.law/statutes/tex._bus._and_com._code_section_302.059)).

**Verdict: (ii)-high.** There is no HIPAA-style BAA regime, but the combination of the FTC service-provider role, §7216's criminal exposure, a U.S.-only subprocessor chain and 5,000-plus-consumer tenants (who need pen tests) makes this the costliest of the five. It is still not class (iii).

### 5e. Incumbent AI and bilingual value

**What incumbents ship**
- **Canopy:** AI notetaker, AI document renaming, smart e-sign fields, Smart Tax Prep beta, AI intake and document requests in Tax Workflow Automation ([Canopy](https://www.getcanopy.com/pricing)).
- **TaxDome:** AI reporting, analytics and document organization ([TaxDome](https://taxdome.com/pricing)).
- **SmartVault:** SmartRequestAI at $12.50/return ([SmartVault](https://www.smartvault.com/pricing/)).

**Where BIS wins**
- The bilingual receptionist is valuable in **January–April** and for ITIN/CAA and 1095-A questions.
- Outside the season, call volume collapses, and so does willingness to pay.

### 5f. Do not build

**Do not build:**
- tax software, e-file or bank products;
- a returns archive as system of record;
- a general ledger.

**Integrate with** Drake, ProSeries, TaxSlayer Pro and CrossLink (client lists), QuickBooks Online, and TaxDome or SmartVault as the document system of record.

### 5g. Verdict

Fit 3 · Valley demand 4 · Willingness to pay 2 · Incumbent weakness 2 · Compliance cost 2 → **do not target in the next 12 months.**

The RGV base is mostly sole proprietors: 622 nonemployer tax preparers averaging about $39k in receipts, and 1,128 bookkeepers averaging about $22k (Census Nonemployer 2023, §1). Entrenched tools cost under $100 per user per month and already ship a Spanish portal.

The one exception: a **receptionist-only seasonal SKU**. It covers booking, reminders and FAQs in Spanish, with **no document vault**, SSN fields disabled, and U.S.-only processing. That keeps BIS mostly out of §7216 data handling.

---

## 6. Segment 4 — Real estate agents/teams and residential property managers

### 6a. Incumbents and 2026 prices

| Product | What it does | 2026 price | Source |
|---|---|---|---|
| **Follow Up Boss** (Zillow) | Agent/team CRM | Grow $69/user/mo ($58 annual); Pro $499/mo ($416 annual) for 10 users; Platform $1,000/mo ($833) for 30 users | [followupboss.com/pricing](https://www.followupboss.com/pricing) |
| **Lofty** | CRM plus IDX site plus AI agents | Quote-only (Agent/Team/Broker/Enterprise); Sales, Social and Homeowner AI agents are add-ons. Third party: ~$449+/mo | [lofty.com](https://lofty.com/price-packages); [Luxury Presence](https://www.luxurypresence.com/blogs/lofty-pricing/) [2H] |
| **BoldTrail** (ex-kvCORE) | Brokerage platform, CRM, IDX | Quote-only; ~$299–$1,800/mo reported | [GetApp/aggregators](https://www.getapp.com/real-estate-property-software/a/kvcore/) [2H] |
| **Buildium** | Property-management system: accounting, leasing, portals, Lumina AI | Essential from $62/mo, Growth from $192, Premium from $400; e-sign $5/$1/unlimited; screening $17–$35 | [buildium.com/pricing](https://www.buildium.com/pricing/) |
| **AppFolio** | Property-management system; Realm-X AI | Quote-only; "50 unit minimum" (Core). Third party: $1.40 / $3 / $5 per unit | [AppFolio](https://www.appfolio.com/pricing); [costbench](https://costbench.com/software/property-management/appfolio/) [2H] |
| **TenantCloud** | Small-landlord property management | Starter $18 ($15 annual), Growth $35 ($29.17), Pro $60 ($50), Business from $100 | [tenantcloud.com/pricing](https://www.tenantcloud.com/pricing) |

### 6b. The 8 capabilities that matter most

| # | Capability | BIS status |
|---|---|---|
| 1 | Speed-to-lead on sign and listing calls in Spanish; booking showings with the listing agent | **HAVE** |
| 2 | **Auto-send the IABS notice** at first substantive communication about a specific property | **NEW** (small) |
| 3 | Properties/listings linked to buyers and sellers | **PLANNED** (properties) |
| 4 | Transaction checklists and dates (option period, financing, survey, closing) | **PLANNED** (checklists, expiry). **NEW:** contract-date calculator |
| 5 | Long-horizon nurture, past-client anniversaries, reviews | **HAVE** (automations, review requests) |
| 6 | Consent ledger (no ch. 302 exemption for real estate) | **PLANNED** |
| 7 | MLS/IDX and CRM integrations (FUB, Lofty, BoldTrail) | **NEW** (integrate) |
| 8 | Property managers: 24/7 bilingual maintenance intake and triage, tenant portal, rent reminders (not collection) | **HAVE** (voice, SMS). **PLANNED** (portal). **NEW:** Buildium/AppFolio sync |

### 6c. Documents

**Sales**
- TREC-promulgated contracts and addenda, the IABS notice, pre-approval letters, proof of funds, earnest-money receipts, seller's disclosure, survey/T-47 affidavit, HOA addenda.

**Property management**
- Leases, rental applications, IDs, income proof, screening reports, move-in/move-out inspection photos.

**How the planned features serve these**
- Vault and checklists fit.
- **E-sign must not become a contract-authoring tool.** License holders must use TREC-promulgated forms and may add only factual or business details ([22 TAC 537.11](https://www.law.cornell.edu/regulations/texas/22-Tex-Admin-Code-SS-537-11) via search summary). Integrate the forms tools rather than templating contracts.

### 6d. Compliance (class i–ii)

**Not GLBA-covered for brokerage** (§2.1).

**TREC advertising**
- Advertising must show the broker's name at least half the size of the largest agent or team contact information.
- Team names may not imply a brokerage ([TREC advertising article](https://www.trec.texas.gov/article/trecs-advertising-rules-what-you-need-know) [via search summary]).
- The sponsoring broker is responsible for agent advertising ([2H](https://www.passtexasrealestate.com/blog/texas-real-estate-advertising-rules)).
- → AI-drafted texts and posts need a broker-approved footer.

**IABS notice**
- It must be provided "at the time of a license holder's first substantive communication with a party relating to a proposed transaction regarding specific real property." Exceptions: residential leases under one year with no sale considered, represented parties, and open houses ([Occ. Code §1101.558](https://texas.public.law/statutes/tex._occ._code_section_1101.558); [22 TAC 531.20](https://www.law.cornell.edu/regulations/texas/22-Tex-Admin-Code-SS-531-20)).
- An IABS link is also required on the website homepage ([TREC](https://www.trec.texas.gov/forms/information-about-brokerage-services) via search summary).

**Unlicensed activity**
- Texas practice guidance: an unlicensed person may answer the brokerage's phones **after identifying as unlicensed**, confirm advertised listing details and schedule showings with sellers. They **cannot call prospects to solicit business** and cannot show property ([MetroTex](https://www.mymetrotex.com/what-unlicensed-assistants-can-and-cant-do/) [2H]; [TREC](https://www.trec.texas.gov/article/use-unlicensed-assistants-real-estate-transactions)).
- → Sofía: inbound only, announces that she is a virtual assistant, **no AI outbound prospecting**, and no price opinions or negotiation.

**Fair housing**
- [42 U.S.C. §3604(c)](https://www.law.cornell.edu/uscode/text/42/3604) bars any "notice, statement, or advertisement" indicating a preference based on race, color, religion, sex, handicap, familial status or national origin.
- An AI that answers "is it a good area for families / Hispanic families / safe?" or writes listing copy can violate it.
- HUD **withdrew** its 2024 advertising guidance on 2025-09-17 ([NAA](https://naahq.org/news/hud-withdraws-fair-housing-related-guidance-documents) [2H]), but the statute is unchanged.
- → A fair-housing guardrail pack is required, including never steering by the caller's language.

**Texting**
- No real-estate registration exemption under §302.053. Cold texting ("we buy houses," expired listings) needs registration or opt-in consent ([§302.053](https://texas.public.law/statutes/tex._bus._and_com._code_section_302.053); [AG position](https://www.consumerfinancialserviceslawmonitor.com/2025/11/texas-attorney-general-confirms-opt-in-sms-is-outside-registration-under-sb-140/) [2H]).

**Verdict: (i)–(ii).** Property-management screening is consumer-report territory; leave it to the property-management system.

### 6e. Incumbent AI and bilingual value

**What incumbents ship**
- **FUB AI:** smart summaries and messages, suggested tasks, predictive prioritization ([FUB](https://www.followupboss.com/pricing)); inbound voice comes through partner apps ([FUB integrations](https://www.followupboss.com/integrations/vocaly-ai)).
- **Zillow AI Assist** (EliseAI): lead response in 50+ languages ([Zillow](https://www.zillow.com/rentals-network/ai-assist/) [2H via search]).
- **AppFolio Realm-X Leasing Performer:** engages prospects in Spanish and French and books tours ([AppFolio](https://www.appfolio.com/blog/leasing-performer)).
- **Buildium Lumina:** AI Leasing Agent ([Buildium](https://help.buildium.com/hc/s/article/Lumina-AI-Leasing-Agent)).
- **Lofty:** AI Sales Agent add-on ([Lofty](https://lofty.com/price-packages)).

**Where BIS wins**
- Spanish voice is useful, but **incumbents already ship multilingual AI** in the lead and leasing flow.
- The residual gap is small RGV property managers' after-hours Spanish **maintenance** calls.

### 6f. Do not build

**Do not build:**
- MLS/IDX, listing syndication, transaction-management and TREC forms software;
- rent collection and trust accounting;
- tenant screening.

**Integrate with** FUB, Lofty and BoldTrail (push leads and calls), and Buildium and AppFolio (work orders, tenants).

### 6g. Verdict

Fit 3 · Valley demand 3 · Willingness to pay 2 · Incumbent weakness 2 · Compliance cost 4 → **not in the next 12 months.**

The RGV has 1,362 nonemployer agents and brokers averaging about $53k in receipts, versus 190 employer brokerages (§1). Brokerages often supply the CRM, and incumbents already ship multilingual AI.

Revisit small property managers (120 employer firms, 732 nonemployers) as an add-on once a Buildium integration exists.

---

## 7. Segment 5 — Customs brokers, freight forwarders and small trucking (Pharr/McAllen/Laredo)

### 7a. Incumbents and 2026 prices

| Product | What it does | 2026 price | Source |
|---|---|---|---|
| **CargoWise** (WiseTech) | Forwarding, customs, warehouse, land transport ERP | "Value Packs": per-transaction community prices, e.g. **$9.95 per import formal customs procedure**, $3.28 per export/land-border procedure, $19.95 per FCL import shipment, $1.45 per LTL consignment; no seat fees (v26.09) | [CargoWise community pricing](https://www.cargowise.com/cargowise-value-pack/cargowise-value-pack-community-pricing/) |
| **Descartes** (customs, ABI; MyCarrierPortal) | ABI filing; carrier onboarding and monitoring | ABI quote-only. **MyCarrierPortal Standard $515/mo** (unlimited users; insurance validation and monitoring, FMCSA monitoring, identity/fraud) | [Descartes ABI](https://www.descartes.com/resources/knowledge-center/descartes-abi-softwaretm); [MyCarrierPortal pricing](https://www.mycarrierportal.com/features/pricing/) |
| **Magaya** | Forwarder operations and WMS | ~$150–$300/user/mo, quote-based | [SourceForge/ITQlick](https://www.itqlick.com/magaya-cargo-system/pricing) [2H] |
| **CustomsCity** | Low-cost ABI | $0 (1 transaction), $49 (20), $99 (65), **$299 (300)**, $499 (1,000) … $1,999/mo | [customscity.com](https://customscity.com/abi-pricing/) |
| **Rose Rocket / TMS.ai** | TMS with AI agents (TED email-to-order, Rosie, Rocky) | Full Service Platform **from $2,080/mo**, unlimited users | [roserocket.com/pricing](https://www.roserocket.com/pricing) |
| **Tai TMS** | Broker TMS | Growth $995/mo (2 staff logins, 200 shipments), Premium $2,465, Premium+ $4,595, Pro $7,925 | [tai-software.com/pricing](https://tai-software.com/pricing/) |
| **AscendTMS** | Small-broker TMS | Basic $69, Premium $119, Pro $149 per user/mo (the official page shows a 30-day trial, not a free plan; third parties still describe a free tier) | [thefreetms.com/pricing](https://www.thefreetms.com/pricing) |
| Small carriers | Accounting, IFTA, dispatch | Rigbooks ~$19/mo; TruckingOffice from $20/mo | [PCS](https://pcssoft.com/blog/trucking-accounting-software/) [2H] |

### 7b. The 8 capabilities that matter most

| # | Capability | BIS status |
|---|---|---|
| 1 | Bilingual (EN/ES) answering for shippers, importers, Mexican carriers and transfer drivers; after-hours crossing emergencies | **HAVE** |
| 2 | Customer onboarding: CBP POA (Form 5291) signed directly with the importer, W-9, bond info; e-sign | **PLANNED** (e-sign, vault) |
| 3 | Carrier packets: W-9, MC/DOT authority, COI (auto liability, cargo), broker–carrier agreement | **PLANNED** (vault, checklists) |
| 4 | **Expiry tracking**: COI and cargo insurance, CDL, medical certificates, POA revocations, bonds | **PLANNED** (expiry reminders). **NEW:** FMCSA/insurer data feeds |
| 5 | Company ↔ contacts ↔ trucks/trailers relationships | **PLANNED** (relationships, equipment) |
| 6 | Quotes → invoices for small forwarders and drayage | **PLANNED** (quotes, invoices) |
| 7 | Shipment/load status answers | **NEW** (needs TMS integration; do not build a TMS) |
| 8 | Records controls: U.S.-only storage, 5-year retention, 24-hour breach notice to tenant, caller verification against double-brokering fraud | **NEW** (baseline, §2.4) |

### 7c. Documents

**Customs**
- CBP Form 5291 power of attorney, commercial invoices, packing lists, USMCA certificates of origin, FDA/USDA produce documents, bonds, in-bond documents, correspondence.
- Brokers must keep "copies of all … correspondence and other records relating to [their] customs business" ([19 CFR 111.21](https://www.law.cornell.edu/cfr/text/19/111.21)).

**Carriers and brokers**
- W-9, MC authority letter, COIs that **expire**, broker–carrier agreement, notice of assignment (factoring), banking details.

**Trucking (driver qualification file)**
- Application, annual motor-vehicle record, road test, **medical examiner's certificate**, annual review.
- Retained for the employment period plus 3 years. Medical certificates and annual MVRs may be removed 3 years after execution ([49 CFR 391.51](https://www.law.cornell.edu/cfr/text/49/391.51)).

The vault, expiry reminders and e-sign map almost one-to-one onto carrier-packet and COI workflows. MyCarrierPortal charges $515/mo for the monitored version ([MyCarrierPortal](https://www.mycarrierportal.com/features/pricing/)).

### 7d. Compliance (class i–ii)

**Customs brokers — 19 CFR Part 111**
- **Records:** brokers keep records of account and correspondence and designate a knowledgeable recordkeeper. They must **notify CBP's Security Operations Center within 72 hours of discovering a breach** of electronic or physical records, including compromised importer numbers ([19 CFR 111.21](https://www.law.cornell.edu/cfr/text/19/111.21); detail per [eCFR via search](https://www.ecfr.gov/current/title-19/chapter-I/part-111/subpart-C/section-111.21)).
- **Retention:** at least **5 years** after entry. POAs are kept until revoked, then 5 years. **Originals stay within the U.S. customs territory** ([19 CFR 111.23](https://www.law.cornell.edu/cfr/text/19/111.23) via search summary).
- **Confidentiality:** client records are confidential except to the client, the surety, DHS, subpoena holders or with written client authorization ([19 CFR 111.24](https://www.law.cornell.edu/cfr/text/19/111.24)).
- **POA:** the POA must be executed **directly with the importer of record**, not through a forwarder ([19 CFR 111.36(c)(3)](https://www.law.cornell.edu/cfr/text/19/111.36)). This is part of the 2022 modernization rule, effective 2022-12-19 ([Federal Register](https://www.federalregister.gov/documents/2022/10/18/2022-22445/modernization-of-the-customs-broker-regulations)).
- A reported client-identity-verification requirement tied to TFTEA §116 could not be pinned to a CFR section this session [2H, unverified].
- **What BIS must provide if brokers store records in it:** U.S. data residency, 5-year-plus retention and legal hold, access logs, and a tenant breach notice fast enough for the broker's 72-hour CBP clock (commit to 24 hours or less).

**Not FTC Safeguards** (§2.1). **Not HIPAA**: DOT medical certificates in a motor carrier's file are employment records.

**Texting and calling**
- Mostly B2B.
- Owner-operators' cell phones still trigger TCPA rules for AI-voice outbound calls ([FCC 24-17](https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf)).

**Verdict: (i)–(ii).**

### 7e. Incumbent AI and bilingual value

**What incumbents ship**
- **Rose Rocket:** agents included in the price ([Rose Rocket](https://www.roserocket.com/pricing)).
- **HappyRobot:** voice agents for check calls and rate negotiation, 8 of the top 10 U.S. brokers, reported minimum spend of about $250k/year ([Value Add VC](https://valueaddvc.com/blog/happyrobot-150m-series-c-1-2-billion-valuation-ai-agents-logistics) [2H]).
- Vooma and others ([Freight Blueprint](https://www.freightblueprint.com/blog/ai-agents/best-ai-voice-agent-for-freight-brokers) [2H]).

**Where BIS wins**
- Enterprise voice AI is priced far above RGV SMEs.
- Spanish matters for Mexican carriers, transfer (drayage) drivers and importer contacts in Reynosa/Monterrey.
- Most high-value calls ("where's my load / is my entry released?") require live TMS or ABI data, which BIS does not have.

### 7f. Do not build

**Do not build:**
- TMS, dispatch or tracking;
- ABI/ACE/ISF filing;
- carrier-fraud vetting;
- ELD, IFTA or factoring.

**Integrate with** CargoWise, Magaya, Descartes and CustomsCity exports; Tai, AscendTMS and Rose Rocket APIs; MyCarrierPortal and Highway; DAT and Truckstop.

### 7g. Verdict

Fit 2 · Valley demand 4 · Willingness to pay 3 · Incumbent weakness 3 · Compliance cost 4 → **pilot only.**

Recruit 2–3 Pharr/McAllen customs brokers or forwarders. Test two things:
- bilingual after-hours answering;
- document expiry for carrier and customer packets, reusing the vault and expiry features built for law and insurance.

Laredo, with 663 freight-arrangement establishments versus the RGV's 218, is the bigger prize if the pilot works.

---

## 8. Build implications for the roadmap

**Shared core for segments 1 and 2, most of it already planned:**
1. Document vault with **required-document checklists per case type or line of business**, expiry reminders and a bilingual client portal (**PLANNED**).
2. E-signature, bilingual (**PLANNED**).
3. Households/relationships (**PLANNED**). Law needs petitioner/beneficiary, co-defendants and spouses; insurance needs drivers, vehicles and properties (properties/equipment is **PLANNED**).
4. **Consent ledger** with channel, scope, timestamps, revocation, linked call recording and **configurable retention up to 10 years** (**PLANNED**; the 10-year retention is **NEW**).
5. The **regulated-professional baseline** in §2.4 (**NEW**, class ii): enforced MFA, audit log, retention/disposal policies, DPA, U.S.-only subprocessor attestation, WISP pack, government-request policy.
6. **Vertical guardrail packs for Sofía** (**NEW**): legal (no advice; notario-safe; inbound-only; bilingual disclaimers), insurance (no quote, bind or coverage opinions; licensed-agent handoff), and later tax (identity verification before return status) and fair housing.
7. **Caller identity verification** (**NEW**) before discussing any existing matter, policy or return.
8. **Integrations before features** (**NEW**): Clio, MyCase and Docketwise; LawPay; NowCerts or EZLynx; AgencyZoom. The planned **MCP server** is a cheap path to several of these.

**Pricing anchors to beat or match:**
- Law: Clio Signature $99, MyCase Pro $100, Docketwise Pro $100 per user per month; Clio Grow AI $25 per converted lead; Smith.ai AI Pro $150 per month.
- Insurance: AgencyZoom $149–$349 per month for 7 seats; HawkSoft $99 per user.

---

## 9. Could not verify this session

- **Clio Grow AI language support.** No language was mentioned in the LawSites write-up.
- **Lawmatics list prices.** Quote-only.
- **Lofty, BoldTrail, AppFolio, Applied Epic, EZLynx, Sonant list prices.** Quote-only; the third-party figures above are marked [2H].
- **The exact CFR section for the customs-broker client-identity verification requirement.**
- **Whether Medicare/group-benefits agents' carrier contracts impose HIPAA business-associate terms.** My analysis says treat them as HIPAA-gated.
- **Any Texas ethics opinion specifically on AI receptionists or chatbots.** None found beyond Opinion 705, which covers generative AI generally.
- **Penal Code §38.12's 2025 electronic-message amendment.** Taken from a search summary [2H].
