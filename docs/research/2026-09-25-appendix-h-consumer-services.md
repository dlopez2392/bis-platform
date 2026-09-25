# Appendix H — Consumer services: events and quinceañeras, route services, studios, vets, auto, salons, funeral homes

Part of `2026-09-25-crm-feature-research.md`. Compiled 2026-09-25 by a delegated research agent: incumbent software and prices, capabilities, documents, and compliance cited to primary sources (Texas Health Spa Act, TBVME record rules, FTC Funeral Rule, FTC Safeguards Rule, Texas contract law on deposits, SB 140). Secondhand claims marked [2H].

---

# Research H: Consumer-service segments for BIS in the Rio Grande Valley

Prepared 2026-09-25 for the BIS owner. Scope: seven consumer-facing segments that are not yet covered by the chosen packs (home services, child-care front office, restaurant catering and events). For each segment the report covers incumbents and 2026 prices, the capabilities that matter most, the documents involved, compliance, AI competition, what not to build, and a verdict.

---

## 0. How to read this

- **Citations.** Every price and compliance claim carries a URL. **[2H]** marks a secondhand claim: a review aggregator, a competitor's blog, a law-firm summary, a news item or a search-engine excerpt. Unmarked claims come from the vendor's own page, statute or rule text, a court opinion, a regulator's page, or Census data.
- **BIS status legend.** **HAVE** means live today: the bilingual voice receptionist Sofía, web chat, booking pages, forms, SMS and email automations (reminders, confirmations, review and referral asks, no-show nudges, reactivation, quote follow-ups), call summaries with AI-proposed CRM updates that a human approves, and the weekly report. **PLANNED** means on the roadmap: households and relationships, properties and equipment, a document vault with expiry reminders and required-document checklists, e-signature, quotes/invoices/deposits/recurring billing (Stripe), a client portal, calendar sync with per-staff calendars and round-robin, an SMS consent ledger, broadcasts and segments, a Spanish dashboard, and an MCP server. **NEW** means BIS would have to add it.
- **Scores run 1–5.** Fit is how well BIS's product fits. Valley demand is the number of businesses and how much they need this. Willingness to pay (WTP) is budget relative to what incumbents charge. Incumbent weakness scores 5 when incumbents are weak, which is good for BIS. Compliance cost scores **5 when compliance is cheapest**.
- **Compliance ratings** are negligible, moderate or expensive, and describe the cost to BIS and the tenant of doing it right.
- **Limits.**
  - The Firecrawl scraper ran out of credits partway through, so a few JavaScript-heavy pricing pages (Square) could not be read first-hand.
  - Many vendors quote prices only through sales.
  - Census counts cover employer establishments (County Business Patterns 2023) and nonemployer businesses (Nonemployer Statistics 2022) by NAICS code. The mapping to segments is imperfect, and event venues have no clean NAICS code.

---

## 1. Bottom line

| Rank | Segment | Fit | Valley demand | WTP | Incumbent weakness | Compliance (5 = cheap) | Total /25 | Next 12 months? |
|---|---|---|---|---|---|---|---|---|
| 1 | **Quinceañera and wedding vendors** (venues/salones, planners, decor, cake, dress; photographers and DJs secondary) | 5 | 5 | 3 | 4 | 4 | **21** | **YES**: extend the catering and events pack |
| 2 | **Recurring route services** (pest, lawn, pool, cleaning) | 4 | 4 | 3 | 2 | 4 | **17** | **YES, as part of the home-services pack.** Cheap templates, no separate go-to-market |
| 3 | **Studios and schools** (martial arts, dance, boxing, tutoring, driving schools) | 4 | 4 | 3 | 3 | 3 | **17** | **PILOT in months 9–12**, once households, recurring billing and e-sign ship |
| 4 | Pet grooming and boarding | 4 | 3 | 2 | 3 | 5 | 17 | **LATER** (12–18 months) |
| 5 | Auto repair, body and tire shops | 2 | 4 | 3 | 2 | 5 | 16 | **NO pack.** At most a receptionist-only add-on |
| 6 | Veterinary clinics | 2 | 2 | 4 | 2 | 4 | 14 | **NO** |
| 7 | Funeral homes | 3 | 2 | 4 | 3 | 2 | 14 | **NO** |
| 8 | Salons, barbers, nails, spas | 2 | 5 | 1 | 1 | 5 | 14 | **NO**. Cheap, entrenched, and already shipping Spanish AI receptionists |
| 9 | Used-car dealers, especially buy-here-pay-here (BHPH) | 2 | 4 | 3 | 2 | 2 | 13 | **NO** |

**The four segments that tie at 17** are broken by what each reuses. Route services reuse the home-services pack almost entirely. Studios reuse the household and minor modelling already needed for child care. Grooming needs the pet model and competes with incumbents that already ship vaccine vaults.

**Headline reasoning.**

1. **Quinceañeras and weddings are the one segment where everything BIS plans lines up.** The sales motion is: phone inquiry, then tour booking, then a package quote, a deposit schedule with several payments, a contract e-signature, a client portal, and date-relative reminders. Incumbents' pricing pages do not mention Spanish. The Valley runs two quince/wedding expos a year at the McAllen Convention Center.
2. **Salons and barbers are the clearest "don't".** Booksy launched an English/Spanish AI receptionist that is free for 12 months. Fresha ($99.95/location) and Boulevard ($125 per 200 minutes) ship native AI receptionists, and base subscriptions start at $24–$30/month.
3. **Auto repair looks attractive until you see AutoLeap AIR.** It launched on 2026-04-28 at $99/month, speaks Spanish, and works with any shop software.
4. **Vets and funeral homes are small markets in the Valley.** There are 32 employer veterinary establishments and 46 employer funeral establishments across the four counties. Both also depend on systems BIS will not build (the vet practice-management system, or PIMS; funeral case management), and funeral homes carry real FTC Funeral Rule exposure on price answers.

**New capabilities that recur across the recommended segments,** in build-priority order:

1. Resource/date availability with tentative holds that expire (events, and later studio rooms).
2. Payment schedules with multiple payers and a ledger for cash payments. This covers padrinos (quinceañera sponsors), family tuition and deposits.
3. Automations timed relative to the event date: T-30 final headcount, T-14 final payment, a review request at T+2.
4. A bilingual contract and e-sign template library that shows statutory text and release language conspicuously. It must hold the Health Spa Act cancellation notice, cancellation schedules for events, and the Texas kennel unattended-boarding notice.
5. Guardian and minor modelling in households. It is shared with the child-care pack and serves the quinceañera's parents and padrinos, driving-school students, and martial-arts kids.
6. Answers grounded in the tenant's price list, with a versioned record of "what Sofía quoted". This is essential for funeral homes, valuable for event packages, and a general trust feature.
7. An SMS consent ledger that honours Spanish opt-out words and Texas calling hours in the recipient's local time (see §3).
8. Integration adapters for the systems each trade already runs (field-service management software, PIMS, shop systems). These are expensive, so defer them.

**The competitive picture on MCP has changed.** HoneyBook launched an MCP connector for Claude and a ChatGPT app in September 2026 ([HoneyBook blog](https://www.honeybook.com/blog/introducing-the-honeybook-mcp-ask-claude-about-your-pipeline-invoices-and-contracts); [GlobeNewswire, 2026-09-09](https://www.globenewswire.com/news-release/2026/09/09/3358831/0/en/honeybook-launches-on-chatgpt-as-part-of-openai-s-new-small-business-collection.html)). In events, BIS's planned MCP server is parity, not a differentiator.

---

## 2. Valley context: how many businesses are there?

- **Language.** In Hidalgo County, 80.7% of residents speak Spanish at home and 18.2% speak English [2H] ([Data USA](https://datausa.io/profile/geo/hidalgo-county-tx)).
- **Establishment counts** for the four RGV counties (Hidalgo, Cameron, Starr, Willacy) are in the table below. Employer counts come from Census County Business Patterns 2023 ([program page](https://www.census.gov/programs-surveys/cbp.html); county file `cbp23co`). Nonemployer counts come from Nonemployer Statistics 2022 ([program page](https://www.census.gov/programs-surveys/nonemployer-statistics.html); county file `nonemp22co`). I computed the totals from the Census county files. Nonemployers are mostly sole proprietors: they are relevant to demand but usually have very low WTP.

| Segment (NAICS) | Employer establishments, 4 counties (2023) | Nonemployer businesses, 4 counties (2022) |
|---|---|---|
| Veterinary services (541940 / 54194) | 32 (Hidalgo 19, Cameron 13) | 21 |
| Pet care, i.e. grooming and boarding (812910 / 81291) | 30 | 186 |
| Photographic services (5419 group; portrait 541921) | 16 portrait studios | 473 |
| Retail bakeries (311811 / 3118) | 48 | 545 |
| Clothing stores (4581) | n/a | 1,779 |
| Performing arts companies, incl. DJs and bands (7111) | 10+ | 262 |
| Party and consumer goods rental (532289) | 29 | 114 |
| Caterers (722320) | 26 | not separately reported |
| General auto repair (811111) | 147 | 1,914 mechanical/electrical |
| Auto body (811121) | 43 | 477 |
| Tire dealers (441320) | 64 (Hidalgo 49, Cameron 15) | n/a |
| Used car dealers (441120 / 44112) | 140 | 1,462 |
| Pest control (561710) | 40 | 137 |
| Landscaping (561730) | 63 | 4,321 |
| Janitorial (561720) | 66 | 7,792 |
| Other services to buildings, incl. pool cleaning (561790) | 27 | 1,332 |
| Beauty salons (812112) | 134 | 2,698 |
| Nail salons (812113) | 26 | 1,544 |
| Barber shops (812111) | 15 | 608 |
| Other personal care, incl. day spas (812199) | 63 | 653 |
| Fitness and recreational sports centers (713940) | 71 | n/a (7139 total: 417) |
| Fine arts schools, i.e. dance and music (611610) | 23 | educational services (611) total: 2,718 |
| Sports and recreation instruction, e.g. martial arts (611620) | 26 | (in 611) |
| Tutoring and exam prep (611691) | 12 | (in 611) |
| Driving schools (611692) | 9 | (in 611) |
| Funeral homes (812210) | 46 | 77 |
| *Comparator: plumbing/HVAC (238220)* | *213* | *1,429* |
| *Comparator: child day care (624410)* | *482* | *4,762* |

**Takeaway.** Veterinary (32) and funeral (46) are thin markets. Salons, nails, barbers, janitorial and landscaping are huge but made up overwhelmingly of sole proprietors. Auto repair and used-car dealing are large on both counts. Event businesses are scattered across many codes (venues, bakeries, photographers, DJs, rentals, dress shops); the expo evidence in §6 is the better demand signal.

---

## 3. Cross-cutting compliance: calls and texts (TCPA, Texas SB 140)

This section applies to every segment. **Rating: moderate.** It is the main reason the planned SMS consent ledger should ship before broadcasts.

- **Texas SB 140** took effect 2025-09-01. It expands "telephone solicitation" under Business & Commerce Code ch. 302 to include "transmission of a text or graphic message or of an image" sent to induce a purchase. It also makes violations actionable under the Texas Deceptive Trade Practices Act (DTPA) ([enrolled bill text](https://capitol.texas.gov/tlodocs/89R/billtext/html/SB00140F.htm)).
- **Registration exemptions** under ch. 302 include soliciting former or current customers and businesses that earn most of their revenue at a physical retail location [2H] ([Morgan Lewis](https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages)). The Texas Attorney General settled *Ecommerce Marketers Alliance v. Texas* on the position that consent-based text programs are outside SB 140's registration and disclosure regime [2H] ([CFS Law Monitor](https://www.consumerfinancialserviceslawmonitor.com/2025/11/texas-attorney-general-confirms-opt-in-sms-is-outside-registration-under-sb-140/)). Private remedies are reported at up to $1,500 per violation, trebled when willful [2H] ([Morgan Lewis](https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages)).
- **Calling hours.** Telephone solicitation is allowed only between 9 a.m. and 9 p.m. on weekdays and Saturdays, and between noon and 9 p.m. on Sundays ([Bus. & Com. Code §301.051](https://texas.public.law/statutes/tex._bus._and_com._code_section_301.051)). **Marketing sends should be scheduled by the recipient's local time.**
- **Federal consent revocation.** The FCC's "revoke-all" provision, under which one opt-out stops all of a caller's unrelated messages, is delayed to **2027-01-31** ([FCC DA-26-12](https://docs.fcc.gov/public/attachments/DA-26-12A1.pdf); [2H summary](https://www.consumerfinancialserviceslawmonitor.com/2026/01/fcc-further-extends-effective-date-for-tcpa-revoke-all-rule/)). Honouring revocation "through any reasonable method" is already in force [2H] (same source). **Recommendation:** treat Spanish opt-outs ("ALTO", "BAJA", "CANCELAR", "NO MÁS") as revocations. The "any reasonable method" standard makes that the prudent reading.
- **What this means for BIS.** Keep informational messages (reminders, balances due, "your car is ready") separate from marketing (promotions, reactivation, broadcasts). Store the source and timestamp of each consent in the consent ledger. Apply Texas calling hours to marketing sends. Keep an audit export per tenant.

---

## 4. HIPAA and HIPAA-like flags (the owner has ruled out HIPAA verticals)

| Segment | HIPAA? | What is HIPAA-like and needs care | Source |
|---|---|---|---|
| Veterinary | **No.** HIPAA does not cover animal records | Texas statutory client confidentiality (Occ. Code §801.353): written authorization is needed to release records | [2H: AccountableHQ](https://www.accountablehq.com/post/veterinary-clinic-hipaa-requirements-what-applies-and-what-doesn-t); [§801.353](https://texas.public.law/statutes/tex._occ._code_section_801.353) |
| Grooming and boarding | No | None | n/a |
| Events | No | Photos and data of minors (the quinceañera is 14–15) | best practice, no statute cited |
| Auto repair | No | None | n/a |
| Auto dealers that finance | No, but **the GLBA Safeguards Rule is comparable in weight**: MFA, encryption, vendor contracts, breach notice | Credit applications, SSNs, income | [FTC](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know) |
| Route services | No | None | n/a |
| Salons and spas | **Med spas and aesthetics (injectables, lasers under medical delegation): flag and exclude.** A provider is a HIPAA covered entity only if it conducts standard electronic transactions, such as billing health plans | Health-history intake forms for massage and lashes | [HHS covered entities](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html) |
| Studios and schools | No. **Flag and exclude physical therapy, chiropractic and "medical fitness"** | Health questionnaires (PAR-Q), minors' medical and allergy info | [HHS covered entities](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html) |
| Funeral homes | Not a covered entity, but receives protected health information (PHI): covered entities may disclose PHI to funeral directors "as necessary to carry out their duties" | Cause-of-death and medical info | [45 CFR 164.512(g)(2)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.512) |

---

## 5. Segment 1: Veterinary clinics and pet services (grooming, boarding)

### a. Incumbent software and 2026 prices

**Vet client communications** (layered on top of the PIMS):
- **PetDesk** (Petvisor), which has absorbed Vetstoria (booking), WhiskerCloud and Kontak (phones) [2H]. Reported pricing: from ~$149/month for a single location; the original app plus email appointment requests from $389/month; Vetstoria direct booking an add-on from $200/month. Pricing is quote-only [2H] ([VetSoftwareHub](https://www.vetsoftwarehub.com/product/petdesk/pricing); [PupPilot](https://www.puppilot.co/compare/best-ai-receptionist)).
- **Weave.** Pro $249/month per location; Elite and Ultimate by quote [2H] ([Costbench](https://costbench.com/software/business-phone/weave/); [Emitrr](https://emitrr.com/blog/weave-pricing/)).
- **Generic AI receptionists for vets** run $79–$600/month in 2026 [2H, search excerpt] ([South Arc Digital](https://www.southarcdigital.com/journal/ai-receptionist-for-veterinary-clinics-2026-buyers-guide)).

**PIMS (do not build):** ezyVet, Cornerstone, AVImark, Covetrus Pulse, Shepherd, Vetspire, Provet Cloud, Digitail [2H] ([VetRec](https://vetrec.io/blog/veterinary-pims-integration-the-complete-guide)). Legacy PIMS (AVImark, Cornerstone, ImproMed) expose no REST API; reaching their data takes ODBC/SQL access or an agent installed at the clinic [2H] ([DataHub Vet](https://www.datahubvet.com/veterinary-api/)).

**Grooming and boarding:**
- **MoeGo.** Mobile $49/$99/$159 per van per month; salon $79/$149/$239 per location per month. SMS caps run 200–1,350 texts/month [2H] ([GroomBoard](https://groomboard.com/blog/moego-pricing-2026-complete-breakdown)).
- **Gingr** ([Gingr pricing](https://www.gingrapp.com/pricing)):
  - Spa: $109/month ($100 billed annually).
  - Play: $169/month ($142 annually).
  - Stay: $179/month with Gingr's integrated payments, $209 without ($154 annually).
  - Add-ons: two-way SMS, messaging bundle, payments, scheduling.
  - A $200 setup fee per location is reported [2H] ([Animalo](https://www.animalo.com/blog/gingr-pricing-alternatives-2026-comparison)).
- Others: DaySmart Pet, PetExec, Revelation (not priced here).

### b. The 8 capabilities that matter

| # | Capability | Why | BIS |
|---|---|---|---|
| 1 | Bilingual answering with emergency routing ("my dog ate chocolate") and no diagnosis | Phones are the clinic's bottleneck | **HAVE** (Sofía). **NEW:** vet guardrail script |
| 2 | Booking that writes into the PIMS or grooming calendar | Double-booking kills trust | Booking pages **HAVE**. PIMS write-back **NEW** (integration) |
| 3 | Vaccine and wellness due-date reminders | The main revenue driver | Automations **HAVE**, but for vets the due dates live in the PIMS: **NEW** integration. Grooming: **PLANNED** (vault expiry) |
| 4 | Pet as a record inside a household (several pets, several owners) | Every workflow is per pet | **PLANNED** (equipment modelled as a pet, plus households) |
| 5 | Vaccination vault with expiry, and check-in gated on current records | Required for boarding and daycare | **PLANNED** |
| 6 | E-signed consents: kennel unattended-hours notice, grooming release, records-release authorization | Texas law requires some of these (see d) | **PLANNED** |
| 7 | Deposits, no-show fees, daycare passes and memberships | Protects revenue | Deposits and recurring billing **PLANNED**. Passes and packages **NEW** |
| 8 | Two-way texting, photo "report cards", review asks | Retention | SMS and reviews **HAVE**. MMS photo updates **NEW** |

### c. Documents collected, and how the vault, expiry and e-sign would serve them

- **Rabies certificate.** The vaccinating vet must issue a certificate meeting state minimum standards ([H&S Code §826.021](https://texas.public.law/statutes/tex._health_and_safety_code_section_826.021)). An animal counts as currently vaccinated only within the manufacturer's booster interval ([DSHS rabies page](https://www.dshs.texas.gov/notifiable-conditions/zoonosis-control/zoonosis-control-diseases-and-conditions/rabies)). Store the expiry date, send a reminder 30 days out, and block boarding or grooming check-in once it has lapsed.
- **Other vaccines** set by facility policy (DHPP, Bordetella, influenza), spay/neuter proof, and county pet registration: same expiry pattern. **Incumbents already do this.** Gingr emails owners 30 days before a required vaccine expires and accepts uploads through its portal ([Gingr support](https://support.gingrapp.com/hc/en-us/articles/26757720199309-Upload-Vaccination-Records-How-To); [Gingr blog](https://www.gingrapp.com/blog/simplifying-immunization-management-with-gingr)). MoeGo sends vaccine-expiry notifications by default ([MoeGo help](https://help.moego.pet/en/articles/14092060-how-to-manage-vaccine-records-on-a-pet-profile)). For BIS this is **table stakes, not a differentiator.**
- **Boarding consent with the statutory unattended-hours notice.** Kennels, including vet clinics that board, must give written notice of the hours animals will be unattended and whether there is a working sprinkler system, and must obtain the owner's signed consent. The penalty is $500 per animal per day. Kennels boarding three or fewer animals are exempt. Effective 2023-09-01 ([HB 2063 enrolled text](https://capitol.texas.gov/tlodocs/88R/billtext/html/HB02063F.htm)). This is a **ready-made e-sign template.**
- **Records-release authorization** (vet). Written client authorization is required (§801.353, below). E-sign fits.
- **Grooming release** (matting, senior pets), **emergency-care authorization with a spending cap**, and **payment-plan agreements**.
- **Keep out of BIS:** estimates and treatment consents, which belong in the PIMS.

### d. Compliance

| Rule | What it says | What it means for BIS | Rating |
|---|---|---|---|
| TBVME record keeping, [22 TAC §573.52](https://law.cornell.edu/regulations/texas/22-Tex-Admin-Code-SS-573-52) | Specifies required contents (owner name, address, phone; findings; drugs). Records kept **≥3 years after the last visit**. Copies to owners "within a reasonable time" at reasonable cost, and records may not be withheld over unpaid fees. Last amended 2022-08-16. | The PIMS is the system of record. If Sofía's call summaries capture symptoms, push them into the PIMS or keep them 3 years. | Negligible → moderate |
| Confidentiality, [Occ. Code §801.353](https://texas.public.law/statutes/tex._occ._code_section_801.353) | No release without a written authorization or waiver from the client, or a court order or subpoena. Exceptions include rabies-vaccination status to public-health authorities, and cruelty or controlled-substance reports. | Sofía must verify the caller is the client before discussing a pet's care. Records requests go through an e-signed authorization. | Moderate |
| Vet-client-patient relationship (VCPR), [Occ. Code §801.351](https://texas.public.law/statutes/tex._occ._code_section_801.351) | A VCPR cannot be established "solely by telephone or electronic means". Unlicensed practice creates civil and criminal exposure [2H] ([L&L Law Group](https://landllawgroup.com/insights/texas-veterinary-board-discipline/)). | Sofía must never diagnose or recommend treatment. Script it as "route to a vet or the nearest emergency clinic". | Moderate |
| Rabies, [H&S Code §826.021](https://texas.public.law/statutes/tex._health_and_safety_code_section_826.021) | Vaccination by 4 months, then at the intervals set by rule; certificate issued. | Vault expiry logic. | Negligible |
| Kennels, [HB 2063 / H&S Code ch. 824](https://capitol.texas.gov/tlodocs/88R/billtext/html/HB02063F.htm) | Notice plus signed consent before leaving animals unattended. | E-sign template (a feature, not a cost). | Negligible |
| Boarding licences | Texas has no statewide boarding licence; cities issue permits (e.g., Houston) [2H] ([Petunia](https://www.petuniapets.com/en/blog/texas-dog-boarding-daycare-laws-2025); [Houston BARC](https://www.houstontx.gov/barc/pdfs/Commercial_Pet_Service_Facility_License_Application.pdf)). | None. | Negligible |
| HIPAA | Not applicable to animals [2H] ([AccountableHQ](https://www.accountablehq.com/post/veterinary-clinic-hipaa-requirements-what-applies-and-what-doesn-t)). | — | — |

### e. AI features incumbents ship (2025–2026), and where Spanish matters

- **Weave** has an omnichannel AI receptionist that was slated for general availability in H1 2026, sold inside higher-tier bundles [2H] ([Investing.com](https://www.investing.com/news/company-news/weave-launches-ai-receptionist-and-insurance-automation-tools-93CH-4791176); [Weave](https://www.getweave.com/ai-receptionist/)).
- **VetRec** launched an AI receptionist in July 2026 that answers calls and books appointments [2H] ([HealthTechnologyNet](https://healthtechnologynet.com/2026/07/15/vetrec-launches-ai-receptionist-to-ensure-clinics-never-miss-a-call/)).
- **PetDesk** documents AI post-call summaries and an AI scribe, but no voice answering as of August 2026 [2H] ([PupPilot](https://www.puppilot.co/compare/best-ai-receptionist)).
- **Third-party receptionists** advertise Spanish (Whippy, AgentZap) [2H] ([Whippy](https://www.whippy.ai/blog/ai-in-veterinary-smarter-veterinary-answering-service); [AgentZap](https://agentzap.ai/industries/veterinary)).
- **Grooming and boarding:** MoeGo, DaySmart and Gingr had no native AI voice receptionist as of mid-2026, only text and chat automation. Third parties (AgentZap from $109/month) book into MoeGo through its API [2H] ([Teddy blog](https://tryteddy.com/blog/the-rise-of-ai-receptionists-in-pet-grooming); [AgentZap](https://agentzap.ai/integrations/moego)).
- **Where Spanish matters:** after-hours emergency triage-to-routing, explaining boarding vaccine requirements, and booking for Spanish-dominant owners.

### f. Do not build, and what to integrate with

**Do not build:** a PIMS or medical record, e-prescribing or pharmacy, lab integrations, inventory or POS, euthanasia and treatment consents.

**Integrate with:**
- Cloud PIMS APIs (ezyVet, Shepherd, Vetspire, Digitail), or an aggregator for legacy PIMS [2H] ([DataHub Vet](https://www.datahubvet.com/)).
- MoeGo and Gingr for grooming.
- Stripe.
- Consumer financing partners (CareCredit or Scratchpay), subject to vendor terms.

### g. Verdict

| | Fit | Demand | WTP | Incumbent weakness | Compliance | Total |
|---|---|---|---|---|---|---|
| Vet clinics | 2 | 2 | 4 | 2 | 4 | 14 |
| Grooming and boarding | 4 | 3 | 2 | 3 | 5 | 17 |

**Vets: no.** Clinics do pay $250–$600/month for communications, but the whole workflow hinges on PIMS write-back. Without it, BIS is a sidecar that cannot see due dates. Weave and VetRec are shipping AI receptionists in 2026. The Valley has only about 32 employer clinics.

**Grooming and boarding fit BIS well:** pets as equipment, the vault, the kennel-consent e-sign, deposits, no native AI voice from incumbents. But the businesses are small (186 of the ~216 pet-care businesses are sole proprietors), incumbents already ship vaccine vaults, and MoeGo starts at $49. **Revisit in 12–18 months**, after the pet/equipment model and the vault ship, as a light template sold opportunistically.

---

## 6. Segment 2: Event businesses (quinceañeras and weddings)

### a. Incumbent software and 2026 prices

- **HoneyBook** ([HoneyBook pricing](https://www.honeybook.com/pricing)):
  - Starter $29/month billed annually ($36 month-to-month [2H]: [Agiled](https://agiled.app/blog/honeybook-pricing)).
  - Essentials $49 annually / $59 monthly.
  - Premium $109 annually / $129 monthly.
  - Card payments from 2.7% + 10¢; ACH 1.5%.
  - AI on all plans: AI chat, automations builder, email drafts, meeting notetaker, lead enrichment.
  - The pricing page does not mention Spanish.
- **Dubsado.** Starter $335/year and Premier $525/year; invoicing with payment plans; scheduling on Premier ([Dubsado pricing](https://www.dubsado.com/pricing)). Monthly equivalents are reported at $35 and $55 since 2025-12-01 [2H] ([Agiled](https://agiled.app/blog/dubsado-pricing)).
- **17hats.** A single plan at $60/month ($600/year), with modules at $5–$10 each [2H] ([Agiled](https://agiled.app/blog/17hats-pricing)).
- **Aisle Planner.** Tiered by active projects, $39.99–$169.99/month. Sources conflict [2H] ([EC Marketing](https://www.eventcertificate.com/aisle-planner-pricing-plans/)).
- **Perfect Venue** ([Perfect Venue pricing](https://www.perfectvenue.com/pricing)):
  - Annual billing: Basic $59/month, Professional $119, Premium $189.
  - Monthly billing: Professional $199, Premium $299.
  - Card processing: 3.8% on Basic, 3.2% on Professional (annual), 2.8% on Premium (annual).
  - "AI Email Reply" on Professional and Premium. No Spanish mentioned.
- **Tripleseat.** From about $149/month, by quote [2H] ([SelectHub](https://www.selecthub.com/p/event-management-software/tripleseat/)).
- **Planning Pod.** Venue pricing is not published on its page, which confirms e-signed contracts and scheduled installments paid by card or ACH ([Planning Pod](https://www.planningpod.com/venue-software-pricing.cfm)). Reported: event plans $59–$89/month, and $199–$319/month for most single venues [2H] ([Capterra](https://www.capterra.com/p/125947/Planning-Pod/pricing/)).
- **Hypothesis to validate in discovery (no source):** many Valley salones run on Facebook/Instagram DMs, WhatsApp, phone calls, paper contracts and cash.

**Demand evidence.**
- RGV Wedding & Quince Expo at the McAllen Convention Center on 2026-02-15 and 2026-09-27 ([expo site](https://rgvweddingandquinceexpo.com/); [Explore McAllen](https://experiencemcallen.com/event/rgv-wedding-quince-expo-mcallen/)).
- RGV Bridal & Quince Expo on 2026-02-22 in Edinburg ([Valley Wedding Pages](https://valleyweddingpages.com/rgv-bridal-quince-expo-february-22-2026)).
- A South Texas 300-guest quince package (venue, food, decor, cake, linens) costs about $8,200 [2H] ([New Dawn Photo](https://www.newdawnphoto.com/blog/average-quinceanera-cost-real-budgets)). Texas families cite $17k–$20k for all-inclusive halls [2H] ([Marketplace](https://www.marketplace.org/story/2024/02/12/how-much-do-quinceaneras-cost)).
- A typical payment plan has 2–5 instalments: a 25–30% deposit, a mid-point payment, and the balance 2–4 weeks before the event [2H] ([ThePerfectWedding](https://www.theperfectwedding.com/articles/5916/venue-deposit-payment-guide)).

**Typical workflow:** inquiry (phone, DM or expo lead) → date check and a **tentative hold** → tour → package quote by guest count → deposit and contract signing → instalments (often from **several payers**: parents plus **padrinos** who sponsor items such as the cake, dress or DJ) → final headcount and menu at T-30 → balance at T-14 → event → review, referral and photos.

### b. The 8 capabilities that matter

| # | Capability | BIS |
|---|---|---|
| 1 | Instant bilingual inquiry capture (phone, chat, forms), with a live answer on whether a date and room are free | Capture **HAVE**. **NEW:** room/date availability calendar with tentative holds that expire |
| 2 | Tour booking, with reminders and no-show nudges | **HAVE** |
| 3 | Package quote builder (tiers × guest count plus add-ons such as DJ, photo booth, cake, decor), with bilingual PDF | Quotes **PLANNED**. **NEW:** tiered, guest-count pricing |
| 4 | Deposit plus instalment schedule with automated reminders, partial and **cash** payments logged, **multiple payers** | Deposits and invoices **PLANNED**. **NEW:** splitting across payers and a cash ledger |
| 5 | Bilingual contract e-signature with the cancellation schedule shown conspicuously; addenda for guest-count changes | E-sign **PLANNED**. **NEW:** bilingual template library |
| 6 | Relationships: festejada (a minor), parents, padrinos, couple, planner, vendor contacts | Households **PLANNED** |
| 7 | Client portal: balance, documents to sign, guest-list and menu uploads | **PLANNED** |
| 8 | Automations timed off the event date (T-30 headcount, T-14 balance, T+2 review and referral ask) | Review and referral asks **HAVE**. **NEW (verify):** triggers relative to the event date |

### c. Documents, and how the vault and e-sign serve them

- **Contract or rental agreement:** e-sign.
- **Payment schedule and receipts,** including cash receipts: portal plus ledger.
- **Cancellation and reschedule policy acknowledgment:** e-sign initials.
- **Menu selection or banquet event order (BEO), final headcount, and floor plan:** portal uploads.
- **Damage or security deposit terms.**
- **Outside vendors' certificates of insurance (COIs)** with expiry: vault reminder, and a required-documents checklist per event.
- **Photo/video release for the minor, signed by a parent:** e-sign (best practice).
- **Dress order form, measurements and fitting schedule** (dress shops): vault plus date-relative reminders.
- **Cake order with allergen note** (bakeries): e-sign.
- **Decor rental checklist.**

### d. Compliance

| Rule | What it says | What it means for BIS | Rating |
|---|---|---|---|
| Deposits and refunds under Texas contract law. **No event-deposit statute was found.** | A pre-set amount kept on cancellation (liquidated damages) is enforceable only if (1) the harm was hard to estimate when the contract was signed and (2) the amount is a reasonable forecast of just compensation. Otherwise it is an unenforceable penalty ([FPL Energy v. TXU Portfolio Mgmt., Tex. 2014](https://law.justia.com/cases/texas/supreme-court/2014/11-0050.html)). Keeping 100% of a large deposit when the venue rebooks is likely a penalty [2H] ([Terms.Law](https://terms.law/Demand-Letters/Consumer/texas-wedding-venue-deposit-refund-demand-letters.html); [Engaged Legal](https://blog.engagedlegal.com/blog/keep-nonrefundable-deposit-for-wedding-event)). | Contract templates should step the retained amount by time-to-event, not a flat 100%. Tenants need legal review; BIS supplies the structure, not legal advice. | Moderate |
| Texas DTPA ([Bus. & Com. Code ch. 17](https://statutes.capitol.texas.gov/Docs/BC/htm/BC.17.htm)) | Prohibits deceptive practices. Consumers must give 60 days' notice before suing, and knowing violations carry up to 3× damages [2H] ([Terms.Law](https://terms.law/Demand-Letters/Consumer/texas-wedding-venue-deposit-refund-demand-letters.html)). | Sofía must ground refund and price answers in the tenant's current contract and package sheet, never improvise. | Moderate |
| TCPA and SB 140 (§3) | Payment reminders are informational. Promotions to past inquiries are marketing. | Consent ledger. | Moderate |
| Minors | The quinceañera is 14–15. | Use a parent-signed release before marketing use of photos (best practice). | Negligible |

### e. AI features incumbents ship, and where Spanish matters

- **Tripleseat Intelligence** (2026-05-18): agentic lead management, instant brand-aligned auto-responses, drafted contracts, live proposals with e-sign, and nudges on unsigned proposals ([PR Newswire](https://www.prnewswire.com/news-releases/tripleseat-unveils-ai-suite-to-transform-event-management-302774151.html)). Its focus is restaurants and hotels.
- **Perfect Venue:** AI Email Reply ([pricing](https://www.perfectvenue.com/pricing)).
- **HoneyBook:** an AI suite on all plans, plus its MCP connector and ChatGPT app (September 2026) ([pricing](https://www.honeybook.com/pricing); [MCP blog](https://www.honeybook.com/blog/introducing-the-honeybook-mcp-ask-claude-about-your-pipeline-invoices-and-contracts)).
- **None of these ships a voice receptionist, and none of the pricing pages mentions Spanish.**
- **Where Spanish matters most:** mothers and grandmothers calling in Spanish about dates, prices and what a package includes, on evenings and weekends while staff are running events. Tripleseat itself frames lead-response speed as the top predictor of bookings ([PR Newswire](https://www.prnewswire.com/news-releases/tripleseat-unveils-ai-suite-to-transform-event-management-302774151.html)).

### f. Do not build, and what to integrate with

**Do not build:** a floor-plan or diagramming designer, BEO and kitchen production, a full rental-inventory system, seating charts, RSVP or wedding websites, photo proofing galleries, a bar POS.

**Integrate with:**
- Stripe and QuickBooks.
- Google and Outlook calendars (planned).
- Meta lead ads.
- CSV import from HoneyBook and Perfect Venue.
- **WhatsApp as a channel is a NEW item** to validate in discovery, since border families may prefer it (hypothesis).

### g. Verdict

| Fit | Demand | WTP | Incumbent weakness | Compliance | Total |
|---|---|---|---|---|---|
| 5 | 5 | 3 | 4 | 4 | **21** |

**YES: target this in the next 12 months,** as the natural extension of the already-chosen catering and events pack.

- **Who to lead with:** venues and salones and full-package quince or wedding sellers. They have the highest ticket per event (about $8k–$20k), the most phone-driven sales, several payers per event, and weekend call spikes that Sofía can absorb.
- **Who comes second:** decor, cake and dress shops.
- **Who comes last:** solo photographers and DJs, where HoneyBook at $29 with AI is hard to beat on price.
- **Build order:** availability and holds → quotes and packages → payment schedule with multiple payers → bilingual e-sign templates → portal. Most of this is already PLANNED.

---

## 7. Segment 3: Auto repair, body shops, tire shops, and small used-car dealers

### a. Incumbent software and 2026 prices

**Shop management:**
- **Tekmetric.** Start $199/month, Grow $349, Scale $439, Enterprise custom. Two-way texting only on Scale and above. Marketing add-on $345/month per shop (online booking, reminders, reviews). Tire Suite +$39 ([Tekmetric pricing](https://www.tekmetric.com/pricing)).
- **Shopmonkey.** Basic $215 annual / $239 monthly; Clever $359/$399; Genius $449/$499. Two-way text and email included ([Shopmonkey pricing](https://www.shopmonkey.io/pricing)).
- **AutoLeap AIR (AI receptionist)** ([AutoLeap AIR](https://autoleap.com/air/)):
  - $99/month for 200 calls, $199/month for 500 calls, or $1 per call.
  - Speaks English, Spanish, French and more.
  - "Compatible with any shop software."
  - Launched 2026-04-28 [2H] ([Business Wire via Yahoo](https://finance.yahoo.com/sectors/technology/articles/autoleap-introduces-first-ai-receptionist-194700717.html)).

**Independent dealers:**
- **DealerCenter** ([DealerCenter pricing](https://www.dealercenter.com/pricing/)):
  - DMS $99/month.
  - CRM Plus $99 or CRM Pro $199 (click-to-call, call recording).
  - BHPH module $50.
  - Accounting $99.
  - Websites $99–$125.
  - **AI Sales Agent $99.**
  - eContract $3 each.
- **Frazer** (a DMS widely used for BHPH): quote-based [2H] ([Capterra](https://www.capterra.com/compare/34553-71935/Frazer-Auto-Dealer-Software-vs-DealerCenter)).
- **AI BDC vendors** (AI for the dealer's business development centre, i.e. lead calls and appointments) range from ~$34 to $300–$1,000+/month, many with Spanish [2H] ([11x](https://www.11x.ai/guides/ai-voice-agents-car-dealerships)).

### b. The 8 capabilities that matter

| # | Capability | BIS |
|---|---|---|
| 1 | Bilingual answering, booking and "¿ya está mi carro?" status | Answering **HAVE**. Status needs a shop-system read: **NEW** integration |
| 2 | Vehicle record (VIN, plate, mileage) inside a household | **PLANNED** (equipment) |
| 3 | Estimate approval and signed repair authorization by text | Quotes and e-sign **PLANNED**. Digital vehicle inspections (DVI) with photos are the incumbents' core: do not build |
| 4 | Service reminders by mileage or time | Automations **HAVE**. **NEW:** mileage-based triggers |
| 5 | Review requests and reactivation | **HAVE** |
| 6 | Parts deposits and payment links | **PLANNED** |
| 7 | Dealers: answering from live inventory, test-drive booking, lead delivery to the DMS/CRM (ADF/XML) | **NEW** (inventory feed and ADF push) |
| 8 | BHPH payment reminders and logged collection contacts | **NEW, and regulated** (see d) |

### c. Documents

- **Repair order or authorization with the customer's signature.** A worker's-lien notice to sell an unclaimed vehicle requires the signed work order, filed within 30 days of the charges for vehicles under 16,000 lb GVWR ([Prop. Code §70.006](https://texas.public.law/statutes/tex._prop._code_section_70.006)). E-sign fits.
- Estimates, supplements, insurance-claim info, photos (body shops), warranty cards.
- Proof of insurance (expiry) and registration renewal date (captured from the customer): vault reminders.
- **Dealers:** Buyers Guide (in Spanish when the sale is in Spanish; see d), retail installment contract, credit application, title documents, driver licence. **Most of these belong in the DMS, not BIS.**

### d. Compliance

| Rule | What it says | What it means for BIS | Rating |
|---|---|---|---|
| **FTC Safeguards Rule** (16 CFR 314) | Dealers that finance, help arrange financing, or lease for more than 90 days are "financial institutions". Cash-only dealers are not covered ([FTC dealer FAQ](https://www.ftc.gov/business-guidance/resources/automobile-dealers-ftcs-safeguards-rule-frequently-asked-questions)). Dealers must pick capable service providers, require safeguards by contract, and reassess them periodically (same). They must use MFA for anyone accessing customer information and encrypt it at rest and in transit, with some provisions exempt below 5,000 consumers ([FTC guide](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)). A breach affecting ≥500 consumers must be reported to the FTC within 30 days, from 2024-05-13 ([FTC release](https://www.ftc.gov/news-events/news/press-releases/2023/10/ftc-amends-safeguards-rule-require-non-banking-financial-institutions-report-data-security-breaches)). | BIS becomes a contracted **service provider**. It would need documented security, MFA, encryption, a way to keep SSNs and income out of call transcripts, breach cooperation, and a security questionnaire for every dealer. | **Expensive** |
| FTC CARS Rule | Vacated by the Fifth Circuit on 2025-01-27 ([opinion](https://www.ca5.uscourts.gov/opinions/pub/24/24-60013-CV0.pdf)). Formally withdrawn from 16 CFR 463, effective 2026-02-12 ([Federal Register 2026-02866](https://www.federalregister.gov/documents/2026/02/12/2026-02866/revision-of-the-negative-option-rule-withdrawal-of-the-cars-rule-removal-of-the-non-compete-rule-to)). | Not in effect. FTC Act §5 still applies. | Negligible |
| **FTC Used Car Rule, Spanish** ([16 CFR 455.5](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-455)) | If the sale is conducted in Spanish, the Buyers Guide and contract disclosures must be in Spanish. | A Spanish-speaking AI that negotiates a sale may pull the dealer into Spanish-sale obligations. Keep Sofía to lead intake and appointments. | Moderate |
| Texas OCCC motor-vehicle sales-finance licence for BHPH ([OCCC](https://occc.texas.gov/industry/motor-vehicle-sales-finance-mvsf/)). Records: [7 TAC §84.708](https://law.cornell.edu/regulations/texas/7-Tex-Admin-Code-SS-84-708) | BHPH dealers holding their own contracts need a licence. Required records include **written records of all collection contacts** (date, method, parties, summary). Retention: 4 years from the contract date or 2 years from the final entry, whichever is later. | If Sofía or BIS texts or calls about payments, those logs become regulated records: retention plus export. | Moderate–expensive |
| Texas DMV dealer records ([43 TAC §215.144](https://www.law.cornell.edu/regulations/texas/43-Tex-Admin-Code-SS-215.144)) | Purchase and sale records kept 48 months. | The DMS's job. | Negligible |
| Safety inspections ([Texas DPS](https://www.dps.texas.gov/news/vehicle-safety-inspection-changes-take-effect-january-2025)) | Non-commercial safety inspections ended 2025-01-01. Emissions tests continue only in listed metro counties; Hidalgo and Cameron are not listed. A $7.50 replacement fee is paid at registration. | **The classic "inspection due" reminder does not exist in the RGV.** | — |
| TCPA and SB 140 (§3) | Service promotions are marketing. | Consent ledger. | Moderate |

### e. AI features incumbents ship, and where Spanish matters

- **AutoLeap AIR**, in Spanish, works with any shop system (above).
- **Tekmetric** offers a native AI agent inside its platform [2H] ([Growth100X](https://growth100x.com/insights/best-ai-voice-agents-auto-repair-shops-2026/)).
- **DealerCenter's** AI Sales Agent (above).
- A crowded field of AI BDC vendors with Spanish [2H] (above).
- **Where Spanish matters:** status calls and estimate explanations for Spanish-dominant customers. **But the cheapest competitor already does Spanish at $99.**

### f. Do not build, and what to integrate with

**Do not build:** a DMS, desking, F&I, credit pulls, loan servicing or repossession, shop management, DVI, parts ordering or labour guides.

**Integrate with:** Tekmetric, Shopmonkey and AutoLeap APIs; ADF/XML lead delivery to dealer CRMs.

### g. Verdict

| | Fit | Demand | WTP | Incumbent weakness | Compliance | Total |
|---|---|---|---|---|---|---|
| Repair, body, tire | 2 | 4 | 3 | 2 | 5 | 16 |
| Used-car / BHPH | 2 | 4 | 3 | 2 | 2 | 13 |

**No pack in 12 months.** Repair shops are numerous: 147 employer and ~1,900 nonemployer general repair businesses, plus 43 and 477 body shops. But the job is status plus estimates plus the shop system. BIS's value is the phone line, and AutoLeap already sells that in Spanish for $99 with no switching.

Dealers are numerous too: 140 employer and ~1,460 nonemployer used-car dealers. But BHPH brings Safeguards-Rule vendor obligations, OCCC collection-record rules and Spanish-sale disclosure exposure, and DealerCenter already bundles a CRM and a $99 AI agent.

---

## 8. Segment 4: Recurring route services (pest control, pool, lawn, cleaning)

### a. Incumbent software and 2026 prices

- **Jobber** ([Jobber pricing](https://www.getjobber.com/pricing/)):
  - Monthly, no commitment: Core $49, Connect $139, Grow $199, Plus $499. Annual prepaid is lower.
  - **AI Receptionist: $29/month add-on on every plan.**
  - Marketing Suite $99. Pipeline $49.
  - Third-party guides report higher team-plan prices [2H] ([BuyerSprint](https://buyersprint.com/2026/04/17/jobber-pricing-2026/)).
- **GorillaDesk.** $49 / $99 / $149 per route per month [2H] ([ServiceAgent](https://serviceagent.ai/blogs/gorilladesk-pricing/)). "AI Agents" cover phone, SMS, web chat and the portal; the AI voice agent requires the VoIP Pro plan [2H] ([GorillaDesk](https://gorilladesk.com/features/ai-agents/); [help center](https://intercom.help/gorilladesk/en/articles/10521606-ai-agents-customer-portal)).
- **Skimmer** (pools) ([Skimmer pricing](https://www.getskimmer.com/pricing)):
  - $1 per pool per month (minimum $49), or $2 per pool (minimum $98).
  - **AI Phone $99/month.** Marketing Suite $150. Texts at $0.029 on the entry tier.
- **FieldRoutes:** ~$249–$350/month plus $1,500–$2,000 implementation [2H]. **PestPac** (WorkWave): quote-only, suited to budgets over $1,000/month, with the AskWAIve conversational AI [2H] ([Aplos AI](https://aplosai.com/blog/fieldroutes-vs-pestpac); [PestPac](https://www.pestpac.com/features/pest-control-crm-software)).

### b. The 8 capabilities that matter

| # | Capability | BIS |
|---|---|---|
| 1 | Recurring service agreements with autopay (monthly or quarterly pest, weekly pool) | **PLANNED** (recurring billing) |
| 2 | Bilingual answering and booking of the first service or estimate | **HAVE** |
| 3 | E-signed agreement plus renewal reminders | **PLANNED** |
| 4 | Property record (gate codes, pets, pool gallons, lawn square footage) | **PLANNED** (properties) |
| 5 | "On my way" / skip / rain-delay texts and post-visit service-report delivery | SMS **HAVE**. The report comes from the field-service system: **NEW** integration |
| 6 | Routing, dispatch and chemical-use logs | **Do not build**: integrate |
| 7 | Seasonal reactivation (mosquito, termite, spring lawn), reviews and referrals | **HAVE** |
| 8 | Segmented broadcasts with consent | **PLANNED** |

### c. Documents

- **Service agreement** (term, auto-renew, price changes): e-sign, with a renewal-date reminder.
- **TDA Consumer Information Sheet** for indoor treatment of an owner-occupied home. The Texas Department of Agriculture publishes it in English and Spanish ([4 TAC §7.147](http://txrules.elaws.us/rule/title4_chapter7_sec.7.147)). BIS can **auto-send the Spanish or English version** by contact language.
- **Pesticide-use records,** kept 2 years (see d). These belong in the field-service system.
- Pool chemistry logs; equipment warranties (vault); key and access authorizations (cleaning); **COIs for commercial accounts** (vault expiry).

### d. Compliance

| Rule | What it says | What it means for BIS | Rating |
|---|---|---|---|
| TDA pest-control use records ([4 TAC §7.144](https://www.law.cornell.edu/regulations/texas/4-Tex-Admin-Code-SS-7-144)) | Records of every pesticide use kept **2 years**, "on the premises of the business facility", and provided to TDA on request. Required fields include customer, location, product and EPA registration number, amount, target pest, date and applicator licence. | Keep BIS out of the chemical log; that belongs in the field-service system. | Negligible (moderate if BIS were the only system) |
| Consumer information sheet ([4 TAC §7.147](http://txrules.elaws.us/rule/title4_chapter7_sec.7.147)) | Must be made available for indoor residential treatments. English and Spanish versions exist. | An automation opportunity. | Negligible |
| Lawn herbicide licensing | Fertilizer-only applicators need no licence. Applying herbicide requires a TDA or Structural Pest Control Service licence [2H] ([Texas A&M School IPM](https://schoolipm.tamu.edu/2021/01/29/spn-how-do-i-get-a-pesticide-license-in-texas/); [TDA](https://texasagriculture.gov/Regulatory-Programs/Pesticides/Agricultural-Applicators/Applying-Pesticides-to-Lawns-Trees-Ornamentals)). | Store the licence number on the tenant profile and in the vault. | Negligible |
| TCPA and SB 140 (§3) | Seasonal promotions are marketing. | Consent ledger. | Moderate |

### e. AI features incumbents ship, and where Spanish matters

- Jobber AI Receptionist ($29), Skimmer AI Phone ($99), GorillaDesk AI Agents, PestPac AskWAIve (above).
- **Where Spanish matters:** residential first calls and "when is my tech coming?" questions. **But the price floor for an AI receptionist in this segment is now $29/month (Jobber).**

### f. Do not build, and what to integrate with

**Do not build:** routing, technician mobile apps, chemical inventory, wood-destroying-insect inspection forms, pool chemistry calculators.

**Integrate with:** Jobber, GorillaDesk, Skimmer, FieldRoutes, PestPac, QuickBooks.

### g. Verdict

| Fit | Demand | WTP | Incumbent weakness | Compliance | Total |
|---|---|---|---|---|---|
| 4 | 4 | 3 | 2 | 4 | 17 |

**YES, but only as templates inside the home-services pack:** recurring agreement, consumer-information-sheet auto-send, seasonal campaigns, property fields. Do not run a separate go-to-market.

Demand is real: 40 employer and 137 nonemployer pest controllers, thousands of sole-proprietor landscapers and cleaners, and 1,332 building-services businesses including pool cleaners. But Jobber's $29 AI receptionist and GorillaDesk's all-channel AI make a standalone pitch weak. Aim at operators not yet on a field-service system, and position BIS as the Spanish front office.

---

## 9. Segment 5: Salons, barber shops, nail salons, spas

### a. Incumbent software and 2026 prices

- **Vagaro.** $23.99/month introductory, then $30 base plus $10 per bookable calendar up to seven. "Vera" AI assistant ([Vagaro pricing](https://www.vagaro.com/pro/pricing)). Add-ons: text marketing, forms, website [2H] ([Koalendar](https://koalendar.com/blog/vagaro-pricing)).
- **GlossGenius.** Standard $28 monthly / $24 annual; Gold $56/$48; Platinum $168/$148. Flat 2.6% processing. AI Marketing Assistant and Growth Analyst; **"Reception AI: coming soon"** ([GlossGenius pricing](https://glossgenius.com/pricing)).
- **Fresha.** Individual $19.95/month; Team $14.95 per bookable member; 20% new-client marketplace fee [2H] ([Pabau](https://pabau.com/blog/fresha-pricing/)).
- **Boulevard.** Essentials ~$176, Premier ~$293, Prestige ~$410 per month, plus $495 onboarding [2H] ([SchedulingKit](https://schedulingkit.com/pricing-guides/boulevard-pricing)).
- **Square Appointments.** Free plan plus paid tiers. Reported as $29/$69 [2H] ([Koalendar](https://koalendar.com/blog/square-appointments-pricing)) versus $49/$149 [2H] (search excerpt). Sources conflict and Square's own page did not render prices ([Square](https://squareup.com/us/en/appointments/pricing)).
- **Booksy.** $29.99/month plus $20 per additional member [2H] ([GlossGenius blog](https://glossgenius.com/blog/booksy-price)).

### b. The 8 capabilities that matter

| # | Capability | BIS |
|---|---|---|
| 1 | Staff-calendar booking and rebooking | Per-staff calendars **PLANNED** |
| 2 | Deposits and no-show fees | **PLANNED** |
| 3 | POS, tips, commissions, retail | **Do not build** (the incumbents' core) |
| 4 | Marketplace discovery | Not possible for BIS |
| 5 | Rebooking and "due for a fill" reminders | **HAVE** |
| 6 | Reviews | **HAVE** |
| 7 | Memberships and packages | Recurring billing **PLANNED**. Packages **NEW** |
| 8 | Client notes and formulas, consent forms (patch test, waxing, lashes) | Notes **HAVE**. E-sign **PLANNED** |

### c. Documents

Patch-test and allergy consents, waxing, lash and brow waivers (e-sign). Booth-rental agreements. **Practitioner licences** (vault expiry: a staff-side use case). The renter and independent-contractor list that TDLR inspectors can request ([TDLR common violations](https://www.tdlr.texas.gov/barbering-and-cosmetology/establishments/most-common-violations.htm)).

### d. Compliance

| Rule | What it says | What it means for BIS | Rating |
|---|---|---|---|
| TDLR licence display ([TDLR inspections guide](https://www.tdlr.texas.gov/barbering-and-cosmetology/inspections-guide/)) | The practitioner displays the original licence with a photo near their chair, **or** keeps it at the reception desk, where "a digital image of the license and photograph" is allowed (Occ. Code §1603.2107). The establishment licence, consumer-complaint sign, human-trafficking sign and inspection-report notice must be posted. | Optional: a staff-licence vault with expiry. | Negligible |
| Remote-service businesses ([16 TAC 83.77(h)(3)](https://www.tdlr.texas.gov/barbering-and-cosmetology/establishments/most-common-violations.htm)) | Must give clients TDLR's website and phone number for complaints. | Add them to confirmations for mobile services. | Negligible |
| **Med spa HIPAA flag** | Out of scope (§4). | Exclude med spas. | Expensive, excluded |

### e. AI features incumbents ship (the decisive factor)

- **Booksy AI Receptionist (beta):** answers calls, **English and Spanish**, switches to the caller's language; **free for at least 12 months for the first 500 providers**; no deposit or no-show protection yet ([Booksy](https://biz.booksy.com/features/ai-receptionist-beta)).
- **Fresha AI Concierge** (launched 2026-05-18): phone, SMS and in-app chat, 24/7, books against the live calendar. English markets first, other languages later ([Fresha blog](https://www.fresha.com/blog/fresha-ai-concierge-launch)). $99.95 per location per month [2H] ([Stork.AI](https://www.stork.ai/en/fresha-ai-concierge)).
- **Boulevard "Beau" AI Receptionist (beta):** free August–November 2026, then **$125 per 200 minutes plus $0.60 per minute** from 2026-12-01. Sends booking links rather than booking directly. Languages not stated ([Boulevard FAQ](https://support.boulevard.io/en/articles/16105159-ai-receptionist-frequently-asked-questions)).
- **GlossGenius Reception AI:** "coming soon" ([pricing](https://glossgenius.com/pricing)).
- **Vagaro:** the Vera AI assistant ([pricing](https://www.vagaro.com/pro/pricing)), plus a reported $10/month Connect AI add-on [2H] ([AgentPlace](https://agentplace.io/blog/top-10-best-ai-receptionist-for-salons-you-need-in-2026)).
- **The Spanish-receptionist advantage BIS would bring is already being given away** by Booksy, the platform Valley barbers most likely use (the platform-share claim is a hypothesis).

### f. Do not build, and what to integrate with

Do not build POS, payroll or commissions, retail inventory, or a marketplace. No integration is worth prioritising.

### g. Verdict

| Fit | Demand | WTP | Incumbent weakness | Compliance | Total |
|---|---|---|---|---|---|
| 2 | 5 | 1 | 1 | 5 | 14 |

**NO, and this is the clearest "don't".** There are huge numbers of businesses (2,698 nonemployer beauty salons, 1,544 nail salons, 608 barbers), but they are mostly single chairs paying $0–$30/month. The software sits inside the POS and the marketplace, which BIS will not build. Four incumbents ship or are about to ship native AI receptionists, one of them bilingual and free.

---

## 10. Segment 6: Studios and schools (fitness, boxing, martial arts, dance, music, tutoring, driving schools)

### a. Incumbent software and 2026 prices

- **Mindbody.** Starter from $79/month per location; Accelerate and Ultimate by quote ([Mindbody pricing](https://www.mindbodyonline.com/business/pricing)). Reported: Accelerate ~$259–$279, Ultimate ~$499 [2H] ([Koalendar](https://koalendar.com/blog/mindbody-pricing-costs)).
- **Glofox.** From ~$99/month, by quote, plus a platform surcharge [2H] ([Vibefam](https://vibefam.com/glofox-pricing-2026/)).
- **Jackrabbit Class.** From $49/month, scaled by student count. Plus from $93 (branded app, $169 setup). Enterprise $245 ([Jackrabbit pricing](https://www.jackrabbitclass.com/pricing/)).
- **Pike13.** Essential $139 annual / $159 monthly; Advanced $195/$225; Premium $249/$286. **Digital waivers from Advanced; family and dependent accounts on all plans** ([Pike13 pricing](https://www.pike13.com/pricing-and-plans)).
- **ClassJuggler.** $44.95 / $64.95 / $84.95 per month by school size ([ClassJuggler pricing](https://www.classjuggler.com/pricing)).
- **TutorBird.** $14.95/month plus $4.95 per extra tutor ([TutorBird](https://www.tutorbird.com/affordable/)).
- **Kicksite** (martial arts). $49 for up to 25 students, $99 for 26–50, $149 for 51–100, $199 for 101+ ([Kicksite pricing](https://kicksite.com/pricing/)).
- **Spark Membership:** $199–$249/month [2H] ([Spark help](https://help.sparkmembership.com/en/articles/15345619-what-are-the-costs-and-pricing-details-for-spark-and-ignite-memberships)). **Zen Planner:** $99–$289 [2H] ([Gymdesk](https://gymdesk.com/blog/zen-planner-review)).
- **Drivers Ed Solutions** (driving schools). $6.25 per registered student; setup packages $600–$1,200; online payments $275 setup; no monthly fee ([Drivers Ed Solutions pricing](https://www.driversedsolutions.com/pricing.phtml)).

### b. The 8 capabilities that matter

| # | Capability | BIS |
|---|---|---|
| 1 | Trial-class booking plus bilingual lead nurture | **HAVE** |
| 2 | Family accounts: one guardian, several minor students, sibling discounts | Households **PLANNED**. Discount logic **NEW** |
| 3 | Recurring tuition and memberships, failed-payment retries (dunning), class packs | Recurring billing **PLANNED**. Class packs **NEW** |
| 4 | Guardian-signed waivers and enrollment agreements, with conspicuous release language | E-sign **PLANNED** |
| 5 | Class schedules, rosters, attendance and check-in | **NEW**, or integrate (Kicksite, Jackrabbit, Pike13) |
| 6 | Document vault: emergency and medical info, pickup authorization, learner licence, age proof for competition divisions | **PLANNED** |
| 7 | Cancellation handling that complies with the Health Spa Act (3-business-day notice; see d) | **NEW** contract template plus cancellation workflow |
| 8 | Broadcasts (closures, tournaments, recitals) with consent; Spanish staff dashboard | **PLANNED** |

### c. Documents

- **Membership or enrollment contract** with the statutory cancellation notice (Health Spa Act).
- **Liability release** for adults, and a **parental consent and acknowledgment** for minors.
- Medical, allergy and emergency contacts.
- Pickup authorization.
- Photo release for minors.
- **Driving schools:** enrollment contract, learner licence, and completion certificates under TDLR's certificate rule ([16 TAC §84.43](https://www.law.cornell.edu/regulations/texas/16-Tex-Admin-Code-SS-84-43)).

Vault, expiry and e-sign handle all of these. Expiry matters for learner licences, belt and competition registrations, and annual waiver renewals.

### d. Compliance

| Rule | What it says | What it means for BIS | Rating |
|---|---|---|---|
| **Texas Health Spa Act** (Occ. Code ch. 702) | A business selling memberships for exercise instruction or facilities must register with the Secretary of State ($100/year). It must post security of **$20k–$50k**, unless it offers no contracts longer than 31 days **and no recurring drafts** or initiation fees. Dance- and aerobics-only businesses are excluded ([SOS health-spa FAQ](https://www.sos.state.tx.us/statdoc/faqs3000.shtml)). Contracts must carry the right to cancel by "midnight of the **third business day**" ([§702.304](https://texas.public.law/statutes/tex._occ._code_section_702.304)). Martial-arts studios are covered [2H] ([Mike Young Law](https://mikeyounglaw.com/texas-martial-arts-contract-health-spa-act/)). | **Turning on recurring autopay can trigger the bond requirement.** BIS's recurring-billing setup should ask whether the tenant is registered and exempt, and templates must carry the §702.304 notice. | **Moderate** |
| Waivers for minors | Texas appellate courts hold that parents cannot waive a child's personal-injury claim (*Munoz v. II Jaz*, 1993). Federal courts predict the Texas Supreme Court would agree [2H] ([Texas A&M AgriLife](https://agrilife.org/texasaglaw/2020/01/20/will-texas-courts-enforce-liability-waivers-signed-on-behalf-of-minor-children/)). For adult releases, express-negligence and **conspicuousness** requirements apply ([Dresser v. Page Petroleum, Tex. 1993](https://www.courtlistener.com/opinion/2450513/dresser-industries-inc-v-page-petroleum-inc/)). | E-sign must render release language conspicuously (bold or caps, separate initials) and capture the guardian's identity. Do not market waivers as protection against a child's claim. | Moderate |
| Child-care licensing boundary | Single-skill programs (such as martial arts) are exempt only if they provide nothing unrelated to the skill and do not advertise child care ([HHS exemptions](https://www.hhs.texas.gov/providers/child-care-regulation/become-a-provider/ccr-licensing-exemptions); [Hum. Res. Code §42.041](https://texas.public.law/statutes/tex._human_resources_code_section_42.041)). | "After-school karate with pickup" can cross into licensed child care, where BIS's child-care pack applies instead. | Negligible (a flag) |
| Driving schools (TDLR) | Owners retain student records at least 3 years [2H] ([TDLR school closure](https://www.tdlr.texas.gov/driver/education/providers/closing-a-school.htm)). Certificates are governed by [16 TAC §84.43](https://www.law.cornell.edu/regulations/texas/16-Tex-Admin-Code-SS-84-43). | Retention settings, if BIS holds records. | Moderate |
| Auto-renewal | **No general Texas auto-renewal statute:** HB 2859 and SB 838 died in committee in 2025 ([HB 2859](https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=HB2859); [SB 838](https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=SB838)). The FTC click-to-cancel rule was vacated by the Eighth Circuit on 2025-07-08 [2H] ([Cooley](https://www.cooley.com/news/insight/2025/2025-07-11-click-to-cancel-just-got-cancelled-eighth-circuit-vacates-entirety-of-ftcs-negative-option-rule)), and the FTC conformed its rule on 2026-02-12 ([Federal Register](https://www.federalregister.gov/documents/2026/02/12/2026-02866/revision-of-the-negative-option-rule-withdrawal-of-the-cars-rule-removal-of-the-non-compete-rule-to)). ROSCA still governs online negative-option sign-ups [2H] ([Gibson Dunn](https://www.gibsondunn.com/ftc-restarts-negative-option-rulemaking-after-eighth-circuit-vacatur-enforcement-under-rosca-continues/)). | Clear disclosure plus consent at checkout, and an easy cancel path in the portal. | Moderate |

### e. AI features incumbents ship, and where Spanish matters

- **Mindbody AI Concierge** covers **SMS and web chat** (no voice mentioned) and is included in Ultimate ([Mindbody](https://www.mindbodyonline.com/business/ai-concierge)). Messenger[ai] texts back missed calls [2H] ([SourceForge](https://sourceforge.net/software/product/Messenger-ai/)).
- **Kicksite, Jackrabbit, Pike13, ClassJuggler and TutorBird** mention no AI on their pricing pages (sources above).
- **Where Spanish matters:** parents calling in the evening about schedules, prices, trial classes and belt tests; driving-school parents booking drive times.
- **This is a real gap: no voice AI among the niche incumbents.**

### f. Do not build, and what to integrate with

**Do not build:** belt-rank and curriculum tracking, check-in kiosks and door access, video on demand, a tutoring LMS, driver-ed course delivery and TDLR reporting.

**Integrate with:** Kicksite, Jackrabbit, Pike13 and Mindbody (API or CSV); Stripe; Google Calendar.

### g. Verdict

| Fit | Demand | WTP | Incumbent weakness | Compliance | Total |
|---|---|---|---|---|---|
| 4 | 4 | 3 | 3 | 3 | 17 |

**PILOT in months 9–12**, once households with guardians and minors, recurring billing and e-sign ship. Most of that is shared with the child-care pack.

- **Best sub-segments:** martial arts and dance (family accounts, tuition autopay, Spanish-speaking parents, fragmented cheap software with no voice AI), and **driving schools** (only 9 employer schools in the four counties, but phone-heavy, with weak per-student software).
- **Avoid:** big-box gyms on Mindbody or ABC.
- **The Health Spa Act is the main trap.** Any tenant that turns on recurring drafts may owe a bond.

---

## 11. Segment 7: Funeral homes

### a. Incumbent software and 2026 prices

- **Passare, Gather and SRS Computing (Tribute Technology)** are all quote-based.
  - Gather charges a one-time activation fee plus a monthly subscription, includes one-click e-sign, and refunds the onboarding fee within 60 days [2H] ([Software Finder](https://softwarefinder.com/legal/gather); [Gather](https://gather.app/pricing/)).
  - SRS reports 5,000+ installations [2H] ([SRS Computing](https://www.srscomputing.com/)).
  - Passare offers no free tier; a reviewer cited about $10k including cemetery mapping [2H] ([Capterra](https://www.capterra.com/p/164764/Passare/)).
- **Answering:** ASD (Answering Service for Directors) is reported to serve more than a third of US funeral homes. Full 24/7 human coverage costs ~$200–$900/month; AI-only agents ~$99–$399/month [2H, search excerpt] ([ASD](https://www.myasd.com/); [NextPhone](https://www.getnextphone.com/blog/funeral-home-answering-service)).

### b. The 8 capabilities that matter

| # | Capability | BIS |
|---|---|---|
| 1 | 24/7 bilingual answering with **human-first death calls**: capture the decedent's location and the caller's details, then page the on-call director with acknowledgement and escalation | Sofía plus handoff **HAVE**. **NEW:** on-call paging ladder |
| 2 | **Price answers grounded in the current General Price List (GPL),** with versioning and a transcript audit | **NEW** |
| 3 | Arrangement-conference booking | **HAVE** |
| 4 | Family relationships: next of kin, authorizing agent, payers | **PLANNED** |
| 5 | Authorizations (cremation, embalming) and the Statement of Goods and Services | E-sign **PLANNED**, but these usually live in case management: integrate |
| 6 | Deposits, insurance assignments, payment plans | **PLANNED** |
| 7 | Aftercare sequences (grief support, anniversaries) | Automations **HAVE**. Sensitive |
| 8 | Obituaries, websites, livestream | **Do not build** |

### c. Documents

GPL, casket and outer-burial-container price lists (versioned by effective date: vault). Statement of Funeral Goods and Services Selected. Cremation and embalming authorizations. Vital-statistics information. Insurance assignment. Preneed contracts. Veterans' DD-214. ID of the authorizing agent.

### d. Compliance

| Rule | What it says | What it means for BIS | Rating |
|---|---|---|---|
| **FTC Funeral Rule, phone prices** ([FTC guidance](https://www.ftc.gov/business-guidance/resources/complying-funeral-rule); [16 CFR 453.2](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-453/section-453.2)) | Callers who ask must get "accurate information" from the GPL, casket and outer-burial-container price lists. A provider "cannot require consumers to come to the funeral home in person" and cannot require callers to identify themselves. The GPL must be offered at any face-to-face discussion, including at the family's home. Misrepresentations (e.g., about embalming or legal requirements) are prohibited ([16 CFR part 453](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-453)). Online posting is not yet required; the FTC's 2022 advance notice (ANPR) is considering it ([Federal Register](https://www.federalregister.gov/documents/2022/11/02/2022-23832/funeral-industry-practices-rule)). | **Sofía may not deflect with "come in for pricing".** She must answer from the current GPL or hand off live. That requires a versioned price knowledge base, a transcript audit, and scripts that never state legal requirements. | **Expensive** |
| Texas retail price list ([Occ. Code §651.405](https://codes.findlaw.com/tx/occupations-code/occ-sect-651-405.html)) | Required items, the establishment's details, the effective date, and a mandatory consumer notice. | Keep the price list and its effective date in the vault. | Moderate |
| Preneed | A permit is needed to sell prepaid funeral benefits (Finance Code ch. 154), regulated by the Texas Department of Banking [2H] ([Justia ch. 154](https://law.justia.com/codes/texas/2009/finance-code/title-3-financial-institutions-and-businesses/chapter-154-prepaid-funeral-services); [TX DOB](https://www.prepaidfunerals.texas.gov/content/statutes-and-rules)). | Sofía must not sell or quote preneed contracts; route to a licensed agent. | Moderate |
| HIPAA | Not a covered entity, but receives PHI ([45 CFR 164.512(g)(2)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.512)). | Treat as sensitive. | Negligible legally, high reputationally |

### e. AI features, and where Spanish matters

- AI answering entrants are multiplying. The industry norm is that a synthetic voice should not be the first voice a family hears on a death call [2H] ([Layer3Labs](https://www.layer3labs.io/guides/ai-answering-service-for-funeral-homes)).
- **Where Spanish matters:** 2 a.m. calls from hospitals and families in Spanish. This is the segment where a bilingual receptionist is *most* humane, and also the one where mistakes are *most* costly.

### f. Do not build, and what to integrate with

**Do not build:** case management, embalming and prep-room logs, vital-statistics filing, cemetery mapping, obituaries, websites or livestream, preneed trust accounting.

**Integrate with:** Passare, Gather and SRS. Partner with human answering services such as ASD for escalation.

### g. Verdict

| Fit | Demand | WTP | Incumbent weakness | Compliance | Total |
|---|---|---|---|---|---|
| 3 | 2 | 4 | 3 | 2 | 14 |

**NO for 12 months.** There are only 46 employer funeral establishments (plus 77 nonemployers) in the four counties. The core system is case management, which BIS won't build. The Funeral Rule turns every wrong price answer into regulatory exposure, and the death call is a moment the industry itself wants handled by a human. A narrow "after-hours bilingual overflow, human-first" offering could be revisited once price-list-grounded answering exists for events.

---

## 12. What to do next (for the owner)

1. **Commit to events** (quinceañeras and weddings) as the next pack, built on the catering and events pack. Run 5–10 discovery calls with McAllen and Edinburg salones and quince-package sellers. Validate three things:
   - that inquiries arrive by phone and WhatsApp;
   - that sponsors (padrinos) pay separately;
   - which cancellation-schedule terms they use.
2. **Pull the event-critical PLANNED items forward:** quotes/deposits, e-sign, households, portal. Add the three NEW items: availability with holds, multi-payer payment schedules, and date-relative triggers.
3. **Add route-service templates** to the home-services pack. This is cheap.
4. **Line up studios and schools for months 9–12,** with Health Spa Act handling built into recurring billing and waiver templates.
5. **Explicitly skip** salons, vets, funeral homes and used-car/BHPH. Park auto repair unless a shop-system integration partner appears.

---

## Appendix: source list by topic

**Valley data:**
[Census CBP](https://www.census.gov/programs-surveys/cbp.html) · [Census Nonemployer Statistics](https://www.census.gov/programs-surveys/nonemployer-statistics.html) · [Data USA, Hidalgo](https://datausa.io/profile/geo/hidalgo-county-tx) [2H]

**Texting and calls:**
[SB 140](https://capitol.texas.gov/tlodocs/89R/billtext/html/SB00140F.htm) · [Morgan Lewis](https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages) [2H] · [CFS Law Monitor, AG settlement](https://www.consumerfinancialserviceslawmonitor.com/2025/11/texas-attorney-general-confirms-opt-in-sms-is-outside-registration-under-sb-140/) [2H] · [§301.051](https://texas.public.law/statutes/tex._bus._and_com._code_section_301.051) · [FCC DA-26-12](https://docs.fcc.gov/public/attachments/DA-26-12A1.pdf)

**Veterinary and pet:**
[22 TAC 573.52](https://law.cornell.edu/regulations/texas/22-Tex-Admin-Code-SS-573-52) · [Occ. §801.353](https://texas.public.law/statutes/tex._occ._code_section_801.353) · [Occ. §801.351](https://texas.public.law/statutes/tex._occ._code_section_801.351) · [H&S §826.021](https://texas.public.law/statutes/tex._health_and_safety_code_section_826.021) · [DSHS rabies](https://www.dshs.texas.gov/notifiable-conditions/zoonosis-control/zoonosis-control-diseases-and-conditions/rabies) · [HB 2063](https://capitol.texas.gov/tlodocs/88R/billtext/html/HB02063F.htm) · [Gingr pricing](https://www.gingrapp.com/pricing) · [MoeGo, GroomBoard](https://groomboard.com/blog/moego-pricing-2026-complete-breakdown) [2H] · [PetDesk, VetSoftwareHub](https://www.vetsoftwarehub.com/product/petdesk/pricing) [2H]

**Events:**
[HoneyBook pricing](https://www.honeybook.com/pricing) · [Perfect Venue pricing](https://www.perfectvenue.com/pricing) · [Dubsado pricing](https://www.dubsado.com/pricing) · [Planning Pod](https://www.planningpod.com/venue-software-pricing.cfm) · [Tripleseat Intelligence](https://www.prnewswire.com/news-releases/tripleseat-unveils-ai-suite-to-transform-event-management-302774151.html) · [FPL Energy v. TXU](https://law.justia.com/cases/texas/supreme-court/2014/11-0050.html) · [RGV Wedding & Quince Expo](https://rgvweddingandquinceexpo.com/)

**Auto:**
[Tekmetric](https://www.tekmetric.com/pricing) · [Shopmonkey](https://www.shopmonkey.io/pricing) · [AutoLeap AIR](https://autoleap.com/air/) · [DealerCenter](https://www.dealercenter.com/pricing/) · [FTC dealer Safeguards FAQ](https://www.ftc.gov/business-guidance/resources/automobile-dealers-ftcs-safeguards-rule-frequently-asked-questions) · [FTC Safeguards guide](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know) · [CARS withdrawal, Federal Register](https://www.federalregister.gov/documents/2026/02/12/2026-02866/revision-of-the-negative-option-rule-withdrawal-of-the-cars-rule-removal-of-the-non-compete-rule-to) · [16 CFR 455](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-455) · [7 TAC 84.708](https://law.cornell.edu/regulations/texas/7-Tex-Admin-Code-SS-84-708) · [43 TAC 215.144](https://www.law.cornell.edu/regulations/texas/43-Tex-Admin-Code-SS-215.144) · [DPS inspections](https://www.dps.texas.gov/news/vehicle-safety-inspection-changes-take-effect-january-2025) · [Prop. §70.006](https://texas.public.law/statutes/tex._prop._code_section_70.006)

**Route services:**
[Jobber](https://www.getjobber.com/pricing/) · [Skimmer](https://www.getskimmer.com/pricing) · [4 TAC 7.144](https://www.law.cornell.edu/regulations/texas/4-Tex-Admin-Code-SS-7-144) · [4 TAC 7.147](http://txrules.elaws.us/rule/title4_chapter7_sec.7.147) · [GorillaDesk, ServiceAgent](https://serviceagent.ai/blogs/gorilladesk-pricing/) [2H]

**Salons:**
[Vagaro](https://www.vagaro.com/pro/pricing) · [GlossGenius](https://glossgenius.com/pricing) · [Booksy AI Receptionist](https://biz.booksy.com/features/ai-receptionist-beta) · [Fresha AI Concierge](https://www.fresha.com/blog/fresha-ai-concierge-launch) · [Boulevard AI FAQ](https://support.boulevard.io/en/articles/16105159-ai-receptionist-frequently-asked-questions) · [TDLR inspections guide](https://www.tdlr.texas.gov/barbering-and-cosmetology/inspections-guide/)

**Studios:**
[Mindbody](https://www.mindbodyonline.com/business/pricing) · [Jackrabbit](https://www.jackrabbitclass.com/pricing/) · [Pike13](https://www.pike13.com/pricing-and-plans) · [ClassJuggler](https://www.classjuggler.com/pricing) · [TutorBird](https://www.tutorbird.com/affordable/) · [Kicksite](https://kicksite.com/pricing/) · [Drivers Ed Solutions](https://www.driversedsolutions.com/pricing.phtml) · [SOS health-spa FAQ](https://www.sos.state.tx.us/statdoc/faqs3000.shtml) · [§702.304](https://texas.public.law/statutes/tex._occ._code_section_702.304) · [Dresser](https://www.courtlistener.com/opinion/2450513/dresser-industries-inc-v-page-petroleum-inc/) · [AgriLife on Munoz](https://agrilife.org/texasaglaw/2020/01/20/will-texas-courts-enforce-liability-waivers-signed-on-behalf-of-minor-children/) [2H] · [HHS child-care exemptions](https://www.hhs.texas.gov/providers/child-care-regulation/become-a-provider/ccr-licensing-exemptions)

**Funeral:**
[FTC Funeral Rule guidance](https://www.ftc.gov/business-guidance/resources/complying-funeral-rule) · [16 CFR 453](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-453) · [2022 ANPR](https://www.federalregister.gov/documents/2022/11/02/2022-23832/funeral-industry-practices-rule) · [Occ. §651.405](https://codes.findlaw.com/tx/occupations-code/occ-sect-651-405.html) · [TX DOB preneed](https://www.prepaidfunerals.texas.gov/content/statutes-and-rules) · [45 CFR 164.512](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.512)
