# bis-rgv.com Insights: what to publish next, and what the research says the platform should do

**Date:** 2026-09-20 · **Scope:** the Insights section of bis-rgv.com (a separate Next.js
deployment, not this repo), plus platform ideas the same research points at.
**Companion file:** `2026-09-20-insights-drafts.md` holds four posts drafted in
English and Spanish, ready to paste.

---

## 1. What is on the site today

Nine posts, all dated July 9 to September 6, 2026, in four categories. The
catalogue is heavy on AI and thin on Culture, and nothing yet reacts to news.

| Category | Posts | Titles |
| --- | --- | --- |
| AI | 4 | Before you buy an AI scheduler · What AI actually costs · We answer our own phone · (Bilingual scheduler questions) |
| Security | 2 | What your website says first · Where your data goes |
| Insights | 3 | The paperwork tax · Who holds the keys · Find your first hour back |
| Culture | 1 | Bilingual by design, not by translation |

House voice, read off the existing posts: 350 to 700 words, a plain first
paragraph that names the situation, two or three `##` sections, one
opinionated claim, a "Where to start" close with one link to a tool or an
industry page. No citations, no jargon, no arrows. Every post exists in EN and
ES at the same slug.

Adjacent assets the new posts should link into: `/tools/security-check`,
`/tools/first-hour-back`, `/resources/cybersecurity-guide`,
`/resources/ai-readiness-checklist`, `/trust`, `/platform`, the five industry
pages and the five city pages.

---

## 2. What the research found (September 2026)

Everything below was verified against the linked source this week. Where a
claim rests on a vendor blog rather than a primary source, it says so.

### Security

- **Texas has a cybersecurity safe-harbor law and almost nobody in the Valley
  knows it.** SB 2610, signed June 20, 2025, in force since September 1, 2025:
  a Texas business with fewer than 250 employees that holds sensitive personal
  information and maintains a documented, active security program cannot be
  assessed punitive (exemplary) damages after a breach. Tiered by headcount:
  under 20 employees = password policy plus staff awareness training; 20 to 99
  = CIS Controls IG1; 100 to 249 = NIST CSF / ISO 27001 class frameworks. The
  program has to be written and provably active on the day of the breach. It
  does not shield compensatory damages, AG enforcement or class actions.
  Sources: [Echelon Risk + Cyber](https://echeloncyber.com/intelligence/entry/texas-cybersecurity-safe-harbor-law-sb2610-10-things-smbs),
  [Spencer Fane](https://www.spencerfane.com/insight/texas-cybersecurity-safe-harbor-for-small-and-mid-sized-businesses/),
  [Texas Bar Journal](https://www.texasbar.com/AM/Template.cfm?Section=articles&Template=%2FCM%2FHTMLDisplay.cfm&ContentID=70314),
  [LegiScan SB 2610](https://legiscan.com/TX/supplement/SB2610/id/580852).
- **Texas Cyber Command is live in San Antonio** (HB 150, signed June 2, 2025,
  $135M), and its Texas Small Business Cybersecurity Advocacy Center at UTSA
  offers free training, one-on-one advising and assessments to smaller
  organisations. Sources: [Texas EDC, Aug 6, 2026](https://businessintexas.com/business-growth-and-expansion/what-businesses-need-to-know-about-the-new-texas-cyber-command/),
  [txcc.texas.gov](https://www.txcc.texas.gov/),
  [Texas Monthly / UTSA](https://connect.texasmonthly.com/utsa-2026/texas-americas-cybersecurity-command-center).
- **The Valley has its own incident history.** City of Mission's network was
  attacked February 28, 2025 ([Texas Border Business](https://texasborderbusiness.com/cyberattack-targets-city-of-mission-officials-urge-caution-in-digital-security/));
  DHR Health, the region's largest hospital system, announced a cyber incident
  March 20, 2025 and patients were turned away ([MyRGV, Mar 28, 2025](https://myrgv.com/featured/2025/03/28/dhr-is-saying-little-about-its-cyberattack-the-latest-to-expose-the-valleys-vulnerability/));
  the February 2024 Change Healthcare attack stopped Valley pharmacies
  processing prescriptions ([KRGV, Feb 24, 2024](https://www.krgv.com/news/valley-pharmacies-impacted-by-cyberattack)).
  Note: a search summary dated the pharmacy story to August 2026; the article
  is from 2024. Do not cite it as current.
- **AI voice cloning is now an FBI headline.** KPRC Houston, June 2, 2026: FBI
  warning on voice-clone "loved one in distress" scams; IC3 recorded $893M in
  losses across complaints referencing AI in 2025; a convincing clone needs a
  few seconds of audio; the same tooling is aimed at small businesses
  (fake-boss payment requests). Sources: [KPRC](https://www.click2houston.com/news/local/2026/06/02/fbi-warns-of-ai-voice-cloning-scam-that-mimics-loved-ones-in-distress/),
  [Eyesift stats round-up](https://www.eyesift.com/blog/ai-voice-cloning-scam-statistics-2026/),
  [CybelAngel on deepfake CEO fraud](https://cybelangel.com/blog/deepfake-ceo-fraud-how-voice-cloning-targets-us-executives/).
- **HIPAA Security Rule update is still not final.** The NPRM (Jan 6, 2025)
  would make MFA and encryption mandatory with no small-practice exemption;
  OMB now targets July 2027 for final action. Source: [Medcurity](https://medcurity.com/hipaa-security-rule-2026-update/).
- **Texas SB 1188** (effective Sept 1, 2025; data-localisation clause Jan 1,
  2026): electronic health records must be physically kept in the US; a
  practitioner using AI for diagnosis must disclose it to the patient; civil
  penalties $5,000 to $250,000 per violation. Sources: [McDonald Hopkins](https://www.mcdonaldhopkins.com/insights/news/s-b-1188-texas-ehr-law-data-localization-ai-and-access-requirements),
  [Texas Medical Association](https://www.texmed.org/Template.aspx?id=66759),
  [Hendershot Cowart, Feb 9, 2026](https://www.hchlawyers.com/blog/2026/february/new-texas-laws-require-ai-disclosure-in-healthca/).

### AI and regulation

- **TRAIGA (HB 149) is in force since January 1, 2026** and the Attorney
  General's online AI complaint portal was due live by September 1, 2026.
  Broad jurisdiction (anyone doing business in Texas or serving Texans);
  prohibits intentional discrimination, behavioural manipulation and unlawful
  deepfakes; disparate impact alone is not a violation; AG-only enforcement
  with written notice and a 60-day cure; penalties $10k to $12k per curable
  violation, $80k to $200k uncurable, $2k to $40k per day continuing; following
  the NIST AI RMF is a named defence; the AG can demand documentation of a
  system's purpose, training data, inputs, outputs, limits and safeguards.
  **Health-care providers must give patients a clear, plain-language AI
  disclosure no later than first use** (Bus. & Com. Code §552.051). A pending
  federal moratorium could pause state enforcement. Sources:
  [Duane Morris, May 27, 2026](https://www.duanemorris.com/alerts/texas_new_ai_law_is_now_in_effect_what_employers_need_to_know_about_traiga2_0526.html),
  [Haynes Boone](https://www.haynesboone.com/news/publications/texas-responsible-artificial-intelligence-governance-act-what-businesses-need-to-know),
  [Texas AG Consumer AI Rights page](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-ai-rights) (page exists; it refused an automated fetch),
  [Hendershot Cowart](https://www.hchlawyers.com/blog/2026/february/new-texas-laws-require-ai-disclosure-in-healthca/).
- **Google now phones local businesses on a shopper's behalf.** The agentic
  calling feature ("Ask for Me") launched in US Search and AI Mode in November
  2025 for retail stock checks and, per Google I/O coverage (May 19, 2026),
  expanded to home repair, beauty and pet care over the summer. The customer
  asks, Google's assistant calls the businesses on the map, asks price and
  availability, and texts the customer a summary. Primary: [Google blog, updated July 24, 2026](https://blog.google/products-and-platforms/products/shopping/how-to-agentic-calling-let-google-call/).
  Expansion categories and the opt-out-in-Business-Profile detail come from
  vendor coverage ([JobNimbus](https://www.jobnimbus.com/blog/google-ai-calling-home-services),
  [Wizeb](https://wizeb.com/blog/google-agentic-calling-business-phone-readiness-2026)); treat the
  state exclusions list (IN, LA, MN, MT, NE) as reported, not confirmed.
- **AI search is now the front door for local discovery.** AI Overviews on
  roughly 68% of local searches (Q1 2025); 48% of consumers had used a
  conversational AI tool to research a local business (Q3 2025); a top-10
  organic ranking gives only about a 25% chance of appearing in AI Overviews;
  reviews and FAQ content in customers' own words are the signals AI Mode
  cites. Google said at I/O 2026 that AI Mode passed one billion monthly
  users. Sources: [Whitespark guide](https://whitespark.ca/guides/whitesparks-guide-to-googles-ai-mode-for-local-businesses/),
  [ALM Corp round-up](https://almcorp.com/blog/how-ai-is-impacting-local-search/).
- **Outbound AI calls are "artificial voice" under the TCPA** (FCC, Feb 2024):
  prior express written consent for marketing. The FCC's "revoke-all" rule
  (one STOP cancels every robocall and robotext from that sender) is now
  effective **January 31, 2027**; the rest of the revocation order has applied
  since April 11, 2025 (any reasonable method, 10 business days). Sources:
  [FCC](https://www.fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal),
  [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/fccs-tcpa-global-revocation-rules-now-effective-january-2027),
  [Burr & Forman](https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027).
- **Texas's mini-TCPA now covers marketing texts.** SB 140, effective
  September 1, 2025, makes a marketing SMS a "telephone solicitation";
  unregistered senders need a $200 Secretary of State registration and a
  $10,000 bond unless exempt (texts to current customers, texts with prior
  consent per a 2025 settlement). Appointment reminders and confirmations are
  transactional and exempt. Sources: [Paul Hastings](https://www.paulhastings.com/insights/ph-privacy/marketing-texts-in-texas-sb-140-broadens-state-telemarketing-regulations),
  [Kelley Drye FAQ](https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/texas-mini-tcpa-law-faqs-for-marketing-texts),
  [Texas SOS FAQ](https://www.sos.state.tx.us/statdoc/faqs3400.shtml).
- **Carriers block 100% of unregistered 10DLC traffic** since February 1, 2025.
  Source: [Apten](https://www.apten.ai/blog/a2p-dlc-compliance-2026).
- **Free AI training exists in Texas, none of it in the Valley.** OpenAI's
  Small Business AI Jam (Houston, Nov 20, 2025), Google workshops (Richardson,
  Frisco), Meta's accelerator (San Antonio), Amazon at TAB (Austin). Source:
  [Texas Border Business op-ed, TAB](https://texasborderbusiness.com/empowering-texas-small-businesses-with-ai/).
  TWC's Skills for Small Business pays up to $1,800 per new and $900 per
  existing employee for training through a community college, for employers
  under 100 staff ([Granted AI summary](https://grantedai.com/grants/texas-workforce-commission-skills-for-small-business-texas-workforce-commission-c970da5c)).

### Culture and the Valley economy

- **Stanford's 2025 State of Latino Entrepreneurship** (published April 13,
  2026; 10,000+ employer firms): Latino-owned firms adopt AI at the same rate
  as white-owned firms and use more than doubled 2024 to 2025; nearly half
  operate internationally and those report higher margins; Latino-owned
  construction firms grew 86% 2017 to 2023 vs 2%; more likely to be weighing an
  acquisition (38% vs 26%); under 2% of 2025 venture funding; loan denials
  more often without reasons; inflation the top worry. Source: [Stanford Report](https://news.stanford.edu/stories/2026/04/latino-business-owners-ai-vc-inflation-report).
- **The Valley's tech labour market is soft while its industrial market
  booms.** McAllen's information sector fell 5.56% year over year to July
  2026 and regional job growth "slowed to a trickle"; UTRGV computer
  engineering graduates are queuing at hospital career fairs
  ([RGV Business Journal, Sept 17, 2026](https://www.rgvbusinessjournal.com/news/17/09/2026/rio-grande-valley-tech-jobs-workforce-ai/),
  [Aug 25](https://www.rgvbusinessjournal.com/news/25/08/2026/rio-grande-valley-job-growth-july-2026/)).
  Meanwhile Saronic's $3.2B AI drone shipyard at the Port of Brownsville
  ([KRGV](https://www.krgv.com/news/brownsville-lands-3-2b-ai-drone-tech-company-community-members-question-the-impact-it-could-bring)),
  a Navy landing-craft contract, Cameron County negotiating a $20M Fluidstack
  data-centre donation after Harlingen hesitated
  ([RGVBJ, Sept 11](https://www.rgvbusinessjournal.com/news/11/09/2026/cameron-county-is-negotiating-a-20m-fluidstack-data-center-donation-after-harlingen-waffles-on-the-same-offer/)),
  Brownsville's new Office for the Space Economy
  ([Area Development](https://www.areadevelopment.com/Aerospace/q3-2026/brownsville-opens-an-office-for-the-space-economy.shtml)),
  Reynosa's AI/semiconductor technical high school and TSTC retooling for
  advanced manufacturing.
- **Trade is the Valley's weather.** The US declined to renew USMCA on July 1,
  2026, triggering annual reviews with no immediate tariff change
  ([RGVBJ](https://www.rgvbusinessjournal.com/news/01/07/2026/u-s-declines-to-renew-usmca-creating-new-uncertainty-for-rio-grande-valley-trade/));
  the Pharr bridge expansion doubles commercial capacity from June 2026
  ([Mexico Business News](https://mexicobusiness.news/trade-and-investment/news/pharr-bridge-expansion-double-trade-capacity));
  Pharr's first Gateway Forum on cross-border trade is in October
  ([RGVBJ, Sept 7](https://www.rgvbusinessjournal.com/news/07/09/2026/pharr-gateway-forum-cross-border-trade-logistics-investment/));
  Mexico raised import tariffs in January 2026.
- **Local small-business calendar:** Mission's first Small Business Expo ($25K
  in prizes, Aug 23), Harlingen's $65K startup pitch competition (finals in
  October, training through UTRGV's Entrepreneurship and Commercialization
  Center), Texas A&M's $53.5M McAllen research centre.
- **Disaster memory is fresh.** The March 26 to 28, 2025 floods did over $100M
  in damage across the four counties; SBA economic-injury applications closed
  February 23, 2026 ([ValleyCentral](https://www.valleycentral.com/news/local-news/a-look-back-one-year-since-historic-floods-swept-through-the-rio-grande-valley/),
  [SBA](https://www.sba.gov/article/2025/07/11/sba-opens-disaster-loan-outreach-centers-rio-grande-city-sebastian)).

---

## 3. What to publish next (ranked)

Strong opinion: the section's gap is not volume, it is **news reaction**. Every
post so far is evergreen. The four hooks below have dates on them, which is
what earns a share on a Valley chamber's Facebook page and a citation in an AI
answer. Publish two a month, alternate categories, and write the Spanish
version first at least once (practise what "Bilingual by design" preaches).

Drafted in full (EN + ES) in the companion file:

1. **AI · "Google's assistant is going to call your business. Who picks up?"**
   The best hook of the year for Sofía: Google's agent phones the map-pack
   businesses, asks price and availability, and never leaves a voicemail.
   Links `/platform`, `/tools/first-hour-back`, trades and medical pages.
2. **Security · "Texas will not punish you for a breach if you did the basics."**
   SB 2610 in plain language, tiered by headcount, with the City of Mission
   and DHR incidents as local proof. Links `/tools/security-check`,
   `/resources/cybersecurity-guide`.
3. **Culture · "The Valley is not behind on AI. It is early."** Stanford data
   plus local signals; the argument that bilingual, cross-border, owner-answered
   habits are AI advantages and the true deficit is capital and training.
   Links `/resources/ai-readiness-checklist`.
4. **AI · "Texas has an AI law now. Here is the paragraph that applies to you."**
   TRAIGA and SB 1188 for a business owner; the AG portal opening this month
   is the news peg; the clinic disclosure sentence is the practical payload.
   Links `/trust`, `/industries/medical`.

Outlined only:

5. **Security · "The voice on the line might not be your daughter, or your
   boss."** FBI June warning; three-second clones; the family safe word; the
   call-back rule; never move money on a phone call alone. Contrast: Sofía
   says what she is on every call. Culture angle in the ES version: abuelos,
   remittances, family businesses.
6. **Insights · "Half your customers are asking an AI, not Google."** AI Mode
   and AI Overviews numbers; why a complete profile, recent reviews and an FAQ
   written in customers' words (both languages) now beat backlinks. Sets up
   the platform feature in §5.C.
7. **Insights · "Your appointment reminder is legal. Your 'we miss you' text
   might not be."** SB 140 registration, 10DLC blocking, revoke-all in
   January 2027. Transactional vs marketing in one table. Pairs with the A2P
   registration state already in the platform.
8. **Insights · "The bridge is doubling. Your phone line is not."** Pharr
   capacity, USMCA annual reviews, Gateway Forum in October; freight offices
   will take more after-hours Spanish broker and driver calls. Links
   `/industries/logistics`, "The paperwork tax".
9. **Security · "Before the next flood: five things your business should be
   able to do from a phone in a parking lot."** March 2025 floods; forward the
   line, export contacts, reach the calendar, know the backup exists, tell
   customers. Continuity as a security topic, Valley-specific.
10. **AI · "HIPAA's new rules are late. Do not wait for them."** MFA and
    encryption for clinics now, because SB 2610 already rewards it and the
    federal rule slipped to 2027. Links `/industries/medical`.

Do not write: SpaceX or data-centre takes (off-voice, polarising locally),
"AI will replace your receptionist" (contradicts the brand), anything that
quotes a statute number in the title.

---

## 4. Site ideas beyond the post list

- **A third free tool: the AI caller test.** "Is your business reachable by
  an assistant?" The owner enters their own number, consents, and Sofía's
  stack calls it as a shopper would (two questions: price range, next
  opening). The result page grades rings-to-answer, whether a price was given,
  whether Spanish was handled, and whether it hit voicemail. This is the
  security-check tool's sibling, sells the platform without a pitch, and is
  the single highest-leverage thing on this list. Calling a number the owner
  just submitted, at their request, is consented; keep it to business lines.
- **Resources:** an EN/ES "AI disclosure notice" template for clinics (§552.051
  wording), a printable family "safe word" card (EN/ES, shareable), an SMS
  consent-language snippet, and a one-page SB 2610 policy template for the
  under-20 tier gated behind the same email capture as the checklist.
- **Sources line on news-based posts.** Existing posts cite nothing. For the
  dated posts add a small "Sources" line; it is what AI answers and local
  journalists look for when deciding whether to cite a small firm.
- **Events:** a free bilingual "Valley Small Business AI Jam" in Harlingen,
  with UTRGV's Entrepreneurship and Commercialization Center or Harlingen EDC
  as host; time it against the October Harlingen pitch finals and the Pharr
  Gateway Forum. The TAB op-ed makes the pitch for you: every vendor-run
  workshop skipped the Valley.
- **Insights index:** add "Regulation" as a filter or keep it inside AI and
  Security; add "Updated" dates to evergreen posts (AI answers weight
  freshness).

---

## 5. What the research says the platform should do

Mapped against `docs/superpowers/plans/2026-09-03-product-roadmap.md` and the
specs that shipped since (screened calls, call proposals, lead SMS alerts,
weekly report, A2P registration state).

- **A. Recognise an automated caller and give it its own outcome.** The call
  pipeline already asks "what answered" on outbound legs and screens spam
  inbound. Add the inverse: detect an assistant caller (Google's agent
  identifies itself), tag the call `assistant`, and put a line in the Monday
  email: "3 calls were an assistant shopping for someone; you were able to
  quote on 2." Small change, first-in-market story.
- **B. A per-account answer sheet Sofía quotes from.** Google's agent asks
  price and availability. Most accounts have neither in a place Sofía can
  read. A Setup step "What Sofía may quote" (services, price ranges, next
  opening rule) makes A useful and is what the AI caller test grades.
- **C. "Questions your customers actually asked."** Transcripts are the
  richest FAQ source any local business has. A weekly or monthly roll-up of
  the distinct questions Sofía heard, in the language they were asked,
  rendered as a bilingual FAQ block the client can paste into their site, is
  the AI-search-visibility feature the deferred "Websites + Local Visibility"
  line needs, and the review-request pass already feeds the other signal.
- **D. A safe-harbour pack for accounts.** MFA enforced through Clerk, access
  per person through memberships, a dated one-page policy and a training
  acknowledgement per user stored on the account, exportable as "program in
  force on date X". For the under-20 tier that is the entire SB 2610 bar.
  Sells the IT line and turns the trust page's promises into a record.
- **E. A regulated-tenant mode for medical and dental.** One account flag
  that turns on the plain-language AI disclosure on the booking page, forms,
  SMS and web chat, stamps `disclosed_at` on each call row when Sofía says it,
  pins and documents US-only data residency (SB 1188), and lists the vendors
  with agreements. It also pre-empts the HIPAA MFA/encryption rule.
- **F. A consent ledger ahead of January 31, 2027.** Per-channel consent and
  revocation with timestamps on the contact; a STOP on SMS revokes AI-call
  consent as well; templates classified transactional vs marketing so SB 140
  registration status can gate marketing sends the way A2P status gates the
  composer today.
- **G. A fraud flag on call summaries.** Any inbound call asking for payment
  by wire, gift card or crypto, or asking to change bank details, is tagged
  "possible impersonation" and Sofía never acts on it. Cheap, and the
  voice-clone post writes itself around it.
- **H. Storm mode.** One switch: forward or answer with a storm greeting,
  export contacts, confirm the last backup, text customers a status line.
  The March 2025 floods are the reason; the Setup wizard is the place.
- **I. A "Texas AI law" page in Trust.** The AI inventory for BIS's own
  systems, purpose, inputs, outputs, retention, and a sentence on NIST AI RMF
  alignment. It is the documentation the AG can demand, it is what clients
  need for their own file (post 4 promises it), and it is sales collateral.

Order of value, in my view: A+B together, then C, then D. E is the right thing
to do before the next clinic signs. F has a hard date and belongs in the
automations work already gated on the Vercel plan decision.

---

## 6. Sources not linked above

- [RGV Business Journal home](https://www.rgvbusinessjournal.com/) ·
  [5 things about border manufacturing, Sept 20, 2026](https://www.rgvbusinessjournal.com/news/20/09/2026/5-things-to-know-about-manufacturing-along-the-south-texas-mexico-border/) ·
  [Pharr and Brownsville bridges flagged vulnerable, Mar 15, 2026](https://www.rgvbusinessjournal.com/news/15/03/2026/pharr-and-brownsville-bridges-flagged-as-vulnerable-as-trade-with-mexico-hits-record-levels/) ·
  [Mexico raises import tariffs, Jan 19, 2026](https://www.rgvbusinessjournal.com/news/19/01/2026/mexico-raises-import-tariffs-affecting-border-manufacturers-and-valley-supply-chains/)
- [UTRGV MS in Business Analytics and AI](https://www.utrgv.edu/newsroom/2025/07/30/mastery-of-ai-utrgv-program-renamed-to-reflect-new-focus.htm) ·
  [UTRGV national top five, Sept 3, 2026](https://www.rgvbusinessjournal.com/news/03/09/2026/utrgv-national-top-five-washington-monthly-ranking/)
- [Rio Grande Guardian, "2025-2026 was the turning point"](https://riograndeguardian.com/stories/salinas-were-going-to-look-back-and-say-2025-2026-was-the-turning-point-the-time-when,73861)
- [Texas Border Business, Jacqueline Puente on Latina leaders and AI](https://texasborderbusiness.com/jacqueline-puente-urges-latina-leaders-to-embrace-ai-data-and-economic-opportunity/)
- [QuickBooks Hispanic and Latino AI survey](https://quickbooks.intuit.com/r/small-business-data/hispanic-latino-ai/)
- [Henson Legal AI voice compliance](https://www.henson-legal.com/ai-voice-compliance) ·
  [Retell TCPA playbook](https://www.retellai.com/blog/tcpa-compliance-playbook-voice-ai-outbound)
- [Texas Tribune / KRGV Starship Flight 14 coverage via KRGV news index](https://www.krgv.com/news/page/3)
