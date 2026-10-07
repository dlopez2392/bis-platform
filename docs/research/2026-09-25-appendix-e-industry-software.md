# Appendix E — Industry software: plumbers, restaurants, child day care, adult day care

Part of `2026-09-25-crm-feature-research.md`. Research compiled 2026-09-25 by a delegated research agent, with Texas rules (26 TAC Ch. 746 and 559, TWC CCS, DAHS, EVV, TDLR/TSBPE, SB 140) cited to primary sources where reachable. Secondhand claims marked [2H]. The research brief named two products in error: "Turnout" could not be verified as an adult-day product, and Kidsoft is Australian and does not apply to Texas; the report says so in its caveats.

**Owner decision, 2026-09-25:** adult day care is out of scope because of HIPAA's compliance burden and cost. Section 4 below is kept as research only; nothing in it is planned.

---

# Vertical software research for a bilingual (EN/ES) Rio Grande Valley small-business CRM
*Research date: 2026-09-25. Every claim is linked inline. **[2H]** marks secondhand claims (third-party reviews, aggregators, law-firm summaries, or search-engine summaries I could not open at the primary source). Prices change often, so re-check them before quoting to customers.*

**Caveats up front**
- **"Turnout" could not be verified.** Searches for an adult-day product by that name returned nothing, so I treat it as unknown. Check the name.
- **Kidsoft is Australian** ([kidsoft.com.au](https://kidsoft.com.au/)). The "CCS" it bills is Australia's Child Care Subsidy, not Texas TWC Child Care Services. It is not relevant to Texas.
- **Solutionreach, and Tadpoles pricing, were not verified.** The session's WebSearch budget (200 calls) ran out before I reached them. After that I only opened known URLs directly.

---

## 1. Plumbers and home services (plumbing, HVAC, electrical, landscaping, cleaning)

### a. Core records and how they relate
- **Customer (who pays) → Property/Location (where the work happens) → Equipment (what is installed there).**
  - In ServiceTitan the *customer* record is the bill-to party with the billing address. The *location* record is the service address ([ServiceTitan help](https://help.servicetitan.com/how-to/overview-records)).
  - Equipment lives only on the location. It is added automatically when invoiced, or manually. Its status is *installed* or *replaced*, and replaced units are kept as history, not deleted ([ServiceTitan equipment](https://help.servicetitan.com/docs/add-equipment-to-a-service-location-without-invoicing-the-customer)).
  - In Jobber, clients own properties, and properties attach to quotes and jobs ([Jobber Properties](https://help.getjobber.com/hc/en-us/articles/115010161128-Properties)).
- **Pipeline objects.** Request → Quote → Job (one-off or recurring; visits and assigned crew) → Invoice ([Jobber workflow](https://help.getjobber.com/hc/en-us/articles/360056046054-Jobber-Workflow-Overview)). The invoice carries the billing address plus the job's property address ([Jobber Properties](https://help.getjobber.com/hc/en-us/articles/115010161128-Properties)).
- **Fields a CRM needs:**
  - Customer: name, phones, emails, billing address, tags, lead source, SMS consent, language preference.
  - Property: service address, gate/access notes, pets, property type (residential vs commercial matters for Texas tax, see b).
  - Equipment: type, make, model, serial number, install date, warranty expiry, status, photos.
  - Service agreement: plan, visit cadence, price, billing frequency, renewal date.
  - Quote: line items, optional items or tiers, expiry, signature.
  - Job: visits, technician, checklist, photos, notes.
  - Invoice: payments, tips, deposits.

### b. Documents per client; retention and consent (Texas)
- **HVAC (TDLR).** Every A/C and refrigeration job needs an invoice. Proposals and invoices must show:
  - the company name, address and phone;
  - the affiliated licensee's number;
  - the line "Regulated by The Texas Department of Licensing and Regulation, P.O. Box 12157, Austin, Texas 78711, 1-800-803-9202…", which must also appear on written contracts.

  Source: [16 TAC §75.71](https://www.law.cornell.edu/regulations/texas/16-Tex-Admin-Code-SS-75-71).
- **Plumbing (TSBPE).** The first page of every proposal, invoice or contract must show, in at least 12-point font, the responsible master plumber's (RMP) first and last name and license number, "regulated by the Texas State Board of Plumbing Examiners," and the Board's address, phone and website. Ads must carry the license number. Service vehicles must show the license number on both sides ([22 TAC §367.10](https://www.law.cornell.edu/regulations/texas/22-Tex-Admin-Code-SS-367-10)).
- **Sales tax changes by job type** ([Comptroller 96-259](https://comptroller.texas.gov/taxes/publications/96-259.php); [94-157](https://comptroller.texas.gov/taxes/publications/94-157.php)):
  - Labor to repair or remodel *residential* property is not taxable.
  - Nonresidential repair or remodel is taxable.
  - Landscaping, lawn care and janitorial work are taxable "real property services." There is a small-operator exemption for self-employed people with no employees and ≤ $5,000 in receipts.
- **Lead-safe renovation (EPA RRP).** Keep job records for 3 years after completion, including proof of the owner's pre-renovation education and signed owner/resident documents ([40 CFR 745.86](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-E/section-745.86)). Electronic storage is allowed ([EPA FAQ](https://www.epa.gov/lead/under-rrp-rule-can-required-records-and-documentation-be-stored-electronically-rather-paper)).
- **Consent to text:**
  - Texas SB 140 (effective 2025-09-01) brings marketing texts under the state telephone-solicitation law: registration with the Secretary of State, a $200 fee and a $10,000 bond, with penalties up to $5,000 per violation ([Morgan Lewis](https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages) [2H]).
  - Genuine opt-in programs are effectively exempt from registration ([Nixon Peabody](https://www.nixonpeabody.com/insights/articles/2025/12/10/texas-telemarketing-update---no-registration-for-consent-based-text-messages) [2H]).
  - US carriers also require A2P 10DLC brand and campaign registration. Unregistered traffic pays extra fees and gets filtered ([Twilio](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)).
  - **A per-contact consent ledger (timestamp, source, wording) is therefore mandatory.**

### c. Daily workflows
- **Dispatch and scheduling.**
  - Housecall Pro Essentials adds routes, checklist automations, photo reports with annotations, GPS tracking and commissions ([HCP pricing](https://www.housecallpro.com/pricing/)).
  - Jobber Plus adds crew scheduling and job costing ([Jobber pricing](https://www.getjobber.com/pricing/)).
- **Good/better/best estimates.**
  - Jobber's "optional line items" are on the Grow tier and up ([Jobber pricing](https://www.getjobber.com/pricing/)).
  - Housecall Pro's sales proposal tool is on Max ([HCP pricing](https://www.housecallpro.com/pricing/)). Reviewers say the visual GBB proposals sit on Essentials/Max ([Fieldservicetools](https://fieldservicetools.com/reviews/housecall-pro/) [2H]).
- **Maintenance agreements.**
  - Housecall Pro's recurring service plans are on Max ([HCP pricing](https://www.housecallpro.com/pricing/)). Customers can pay monthly, quarterly or annually ([HCP service agreements](https://www.housecallpro.com/features/service-agreement-software/)).
  - Workiz service plans are on Ultimate ([Workiz](https://www.workiz.com/pricing-plans/)).
- **Invoicing and payments.**
  - Service Fusion offers progressive billing, recurring invoicing and e-signed documents on Pro ([Service Fusion](https://www.servicefusion.com/pricing)).
  - GorillaDesk offers subscription billing and e-signatures on Pro ([GorillaDesk](https://gorilladesk.com/pricing/)).

### d. Client-facing surfaces
- **Jobber Client Hub:** approve quotes, pay, request work, see appointments, tip. Spanish ("Español") is supported ([Jobber Client Hub](https://www.getjobber.com/features/client-hub/)).
- **Customer portals and online booking:**
  - Service Fusion: customer web portal on Pro, add-on below that ([Service Fusion](https://www.servicefusion.com/pricing)).
  - GorillaDesk Pro: portal and online booking ([GorillaDesk](https://gorilladesk.com/pricing/)).
  - Workiz: client portal on all plans ([Workiz](https://www.workiz.com/pricing-plans/)).
  - Housecall Pro: online booking on every plan, with English and Spanish options ([HCP pricing](https://www.housecallpro.com/pricing/)).

### e. AI features, 2025–2026
- **Jobber.**
  - Copilot (announced Oct 2024) is an advisory assistant ([PR](https://www.prnewswire.com/news-releases/jobber-launches-copilot-the-first-of-several-ai-powered-products-aimed-at-making-home-service-business-ownership-simpler-than-ever-before-302264047.html)).
  - The AI Receptionist answers calls and texts 24/7 and books jobs ([PR](https://www.prnewswire.com/news-releases/jobber-launches-ai-powered-receptionist-to-answer-calls-and-texts-for-busy-home-service-businesses-302531125.html)). It costs $29/mo as an add-on and is included on Plus ([pricing](https://www.getjobber.com/pricing/)).
  - Released 2025-09-25 ([PR](https://www.prnewswire.com/news-releases/industry-leader-jobber-unveils-exciting-new-ai-offerings-for-home-service-businesses-302567290.html)):
    - Jobber Voice: 100+ hands-free actions such as quoting and invoicing.
    - Campaign Generator.
    - AI quote automations: auto-drafted quotes and high-value quote alerts.
- **Housecall Pro "AI Team."**
  - Included on every plan: Analyst, Coach and Marketing AI ([HCP AI Team](https://www.housecallpro.com/features/ai-team/)).
  - CSR AI (answers calls, chats and texts 24/7 and books jobs) is sold separately with no public price ([Beside](https://www.beside.com/blog/housecall-pro-ai-phone-answering) [2H]).
- **ServiceTitan (Pantheon 2025).** Atlas is a natural-language or voice assistant that runs reports, schedules and dispatches. Also announced: AI booking agents, interactive SMS scheduling, demand-based capacity, benchmark pricing, and throttling marketing spend when schedules are full ([ServiceTitan press](https://www.servicetitan.com/press/servicetitan-introducing-the-next-evolution-of-ai-at-pantheon-2025-keynote)).
- **Workiz.** Genius Answering is an AI that answers calls, email and SMS in **English, Spanish and French**. Genius Leads and Genius Scheduling are on Pro and up ([Workiz](https://www.workiz.com/pricing-plans/)).
- **Others.**
  - Markate: AI receptionist at $1 per call ([Markate](https://www.markate.com/pricing)).
  - GorillaDesk: "AI Agents" as a separate feature ([GorillaDesk](https://gorilladesk.com/pricing/)).

### f. Integrations they treat as essential
- **QuickBooks Online sync:**
  - Jobber: Connect tier and up ([Jobber](https://www.getjobber.com/pricing/)).
  - Housecall Pro: Essentials and up ([HCP](https://www.housecallpro.com/pricing/)).
  - Workiz and Service Fusion: all tiers ([Workiz](https://www.workiz.com/pricing-plans/); [Service Fusion](https://www.servicefusion.com/pricing)).
  - GorillaDesk: Pro, along with Zapier ([GorillaDesk](https://gorilladesk.com/pricing/)).
- **Integrated card payments.** Housecall Pro processing starts at 2.59% ([HCP](https://www.housecallpro.com/pricing/)).
- **Open API.** Housecall Pro Max, Workiz Ultimate and Service Fusion Pro.
- **GPS fleet tracking.** Add-on at Service Fusion and Housecall Pro.

### g. Pricing
| Vendor | Price | Source |
|---|---|---|
| Jobber | Monthly: Core $49, Connect $139, Grow $199, Plus $499 (5 users; +$29 per user). Annual prepaid shown as $21/$70/$105/$280 per month under a promo ending 2026-09-30. Add-ons: AI Receptionist $29, Pipeline $49, Marketing Suite $99 | [getjobber.com/pricing](https://www.getjobber.com/pricing/) |
| Housecall Pro | Basic $79 ($59 annual), Essentials $189 ($149), Max $329 ($299; 8 users, +$35 per user) | [housecallpro.com/pricing](https://www.housecallpro.com/pricing/) |
| Workiz | Official page: "request pricing." Third parties report Standard $229, Pro $270, Ultimate by quote | [Workiz](https://www.workiz.com/pricing-plans/); [Tooled Up Pro](https://tooleduppro.com/guides/workiz-pricing/) [2H] |
| ServiceTitan | Not published. About $245–$500 per technician per month, $5k–$50k+ implementation, 12-month contract | [Tooled Up Pro](https://tooleduppro.com/guides/servicetitan-pricing/) [2H]; [Projul](https://projul.com/blog/servicetitan-pricing-analysis-2026/) [2H] |
| FieldEdge | Quote-only. About $100–$125 per user per month plus setup | [HVAC Software Hub](https://hvacsoftwarehub.com/hvac/pricing/fieldedge-pricing/) [2H] |
| Service Fusion | Starter $245 ($208 annual), Plus $382 ($325), Pro $627 ($533); unlimited users | [servicefusion.com/pricing](https://www.servicefusion.com/pricing) |
| Markate | $49.95/mo ($39.95 annual), +$5 per employee; online booking $10/mo; AI receptionist $1 per call | [markate.com/pricing](https://www.markate.com/pricing) |
| GorillaDesk | Basic $49, Pro $99, Growth $149 per month; SMS $5/mo plus $50 per 1,000 texts | [gorilladesk.com/pricing](https://gorilladesk.com/pricing/) |

### h. What a general CRM must have, and what it should not build
**10 must-haves**
1. Customer → multiple properties → equipment model, with warranty and install dates and replaced-equipment history.
2. Request → quote → job/visit → invoice pipeline, with **optional or good/better/best line items** and e-signed approval.
3. Lightweight scheduling and dispatch board, plus a technician mobile view (photos, checklists, notes).
4. Payment links, deposits, tips and card-on-file.
5. **Service agreements** that auto-create visits and auto-bill monthly, quarterly or annually.
6. Bilingual customer portal: approve, pay, request work, see appointments.
7. Two-way SMS (on-my-way, reminders, review requests) with a **consent ledger** covering SB 140, TCPA and 10DLC.
8. 24/7 **bilingual AI receptionist** that books straight into the calendar. Price anchors: $29/mo at Jobber, $1 per call at Markate.
9. Texas compliance templates: TDLR and TSBPE first-page disclosures, license numbers, and a tax class per line (residential repair vs taxable real-property service).
10. QuickBooks Online sync, a price book, and basic job costing.

**Five things not to build (integrate or partner instead)**
1. Route optimization and GPS fleet telematics.
2. Truck-stock inventory and purchasing.
3. Payroll and commissions.
4. Consumer financing underwriting.
5. Full field-service management (FSM) for 10+-technician HVAC shops. Sync with ServiceTitan or Housecall Pro through their APIs instead.

---

## 2. Restaurants

### a. Core records
- **Guest profile.** Name, phone, email, birthday and anniversary, visit history, order history, real-time POS spend (lifetime and by item), notes, and unlimited tags plus rule-based auto-tags such as allergies, preferences and "positive reviewer." SevenRooms cites 100+ data points per guest and 65+ POS integrations ([SevenRooms CRM](https://sevenrooms.com/platform/crm/); [SevenRooms search result](https://sevenrooms.com/blog/how-to-elevate-your-hospitality-and-drive-repeat-revenue-with-auto-tags/)).
- OpenTable plans include 360° guest profiles, automated guest tags, real-time guest-spend alerts and a pre-shift report ([OpenTable plans](https://www.opentable.com/restaurant-solutions/plans/)).
- Square creates a customer profile automatically on each sale, with purchase history ([Square pricing](https://squareup.com/us/en/point-of-sale/restaurants/pricing)).
- **Related objects:**
  - Reservation or waitlist entry: party size, time, table, status, deposit or card hold.
  - Event or catering order: inquiry, BEO (banquet event order), payment schedule.
  - Loyalty account and gift cards.
  - Marketing consent (email and SMS separately).
  - Feedback and reviews.

### b. Documents; retention and consent
- **Catering and event contracts, BEOs and deposit receipts.** Toast Catering & Events supports multiple deposit requests on a payment schedule, then a final invoice ([Toast support](https://support.toasttab.com/en/article/Catering-and-Events-Deposits)).
- **Texas gratuity rule.** A mandatory gratuity is not taxable only if it is ≤ 20%, labeled "tip" or "gratuity," and paid in full to the service staff ([34 TAC §3.337](https://law.cornell.edu/regulations/texas/34-Tex-Admin-Code-SS-3-337)). Quote and BEO templates need this labeling.
- **Consent.** SMS marketing falls under SB 140 and 10DLC (see §1b).
- **Allergy notes may be "health" data.** The Texas privacy act (TDPSA) exempts SBA-size small businesses except that they must get consent before *selling* sensitive data, which includes health-diagnosis data ([Texas AG](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/texas-data-privacy-and-security-act); [Ketch](https://www.ketch.com/regulatory-compliance/texas-data-privacy-security-act-tdpsa) [2H]). Never sell or share allergy tags.

### c. Workflows
- **Reservations and waitlist.** OpenTable Basic includes in-house and online waitlist, deposits and card holds, experiences and ticketing (2% fee on prepaid), direct messaging, and post-dining surveys ([OpenTable plans](https://www.opentable.com/restaurant-solutions/plans/)).
- **Catering and events.** Tripleseat covers lead forms, BEOs, proposals, e-signature, payments and deposits. Its add-ons are Direct Book (self-serve booking), Floor Plans (2D/3D diagrams), and Hotels (PMS integration, room blocks) ([Tripleseat packages](https://tripleseat.com/packages/)).
- **Loyalty and marketing automations.** Square offers welcome, birthday, lapsed-guest and Google-review-request flows. Texts: 500 per month included on Plus, then 3¢ each; 2,500 on Premium, then 1.5¢ ([Square](https://squareup.com/us/en/point-of-sale/restaurants/pricing)).
- **Automatic gratuity by party size, house accounts, and deferred revenue for catering pre-orders** are all in Square's plans ([Square](https://squareup.com/us/en/point-of-sale/restaurants/pricing)).

### d. Client-facing surfaces
- **Booking widgets.** OpenTable ([plans](https://www.opentable.com/restaurant-solutions/plans/)).
- **Toast Local app.** Reservations and waitlist across 20,000+ restaurants (Toast Tables plus Resy, through an American Express partnership), loyalty signup and offers ([Toast IQ Grow PR](https://pos.toasttab.com/news/toast-debuts-toast-iq-grow-spring-release-2026)).
- **Branded ordering and loyalty apps.** Owner.com includes a branded app, an AI-optimized site and loyalty on both plans ([Owner](https://www.owner.com/pricing)).
- **Guest-side payments and order texts.** Square offers QR pay, order-ready texts and Order with Google ([Square](https://squareup.com/us/en/point-of-sale/restaurants/pricing)).

### e. AI features, 2025–2026
- **Toast.**
  - ToastIQ launched 2025-05-01 ([Toast](https://pos.toasttab.com/news/toast-launches-toastiq-superpower-future-of-restaurants)). A conversational assistant that can act (edit a menu, change a shift) followed in Oct 2025 ([Toast](https://pos.toasttab.com/news/toast-expands-toast-iq-smart-ai-assistant)).
  - **Toast IQ Grow** (2026-05-05), a **$499/mo** bundle ([Toast PR](https://pos.toasttab.com/news/toast-debuts-toast-iq-grow-spring-release-2026)), includes:
    - an AI **Marketing Agent** (beta) that builds audiences and runs campaigns over email, SMS and social;
    - a human Marketing Success Manager;
    - Guest CRM, loyalty, gift cards, website and ordering;
    - AI menu upsells and AI invoice scanning.
- **SevenRooms Voice AI** (built on ElevenLabs).
  - Answers every call, books, modifies and cancels, recognizes returning guests from their profile, collects deposits by secure link, and hands off to staff ([SevenRooms Voice AI](https://sevenrooms.com/platform/VoiceAI/)).
  - Reports 400k+ calls across 600+ restaurants ([ElevenLabs](https://elevenlabs.io/blog/sevenrooms) [2H]).
  - SevenRooms "AI Notes" standardize CRM notes ([SevenRooms CRM](https://sevenrooms.com/platform/crm/)).
- **OpenTable.** AI Concierge launched July 2025 ([PR](https://www.prnewswire.com/news-releases/opentable-launches-gen-ai-powered-concierge-to-arm-diners-with-instant-insights-for-its-60-000-global-restaurants-302504834.html)). The 2026-08-26 suite added:
  - booking integrations with Google/Gemini, ChatGPT, Copilot, Perplexity and Alexa+;
  - natural-language reporting (testing) and table automations;
  - 20+ voice-AI partners.

  Source: [PR](https://www.prnewswire.com/news-releases/opentable-launches-its-largest-suite-of-new-and-updated-product-features-for-restaurants-302860569.html).
- **Square.** Square AI (beta) and AI voice ordering (beta) that sends orders to the kitchen ([Square](https://squareup.com/us/en/point-of-sale/restaurants/pricing)).
- **Popmenu.** AI-written emails and social posts, and AI review replies ([Popmenu](https://get.popmenu.com/pricing)). Its AI phone answering add-on answers hours, parking and allergen questions and texts links mid-call ([Certus](https://www.certus-ai.com/blogs/popmenu-review) [2H]).

### f. Essential integrations
- **POS is the hub:**
  - SevenRooms: 65+ POS integrations ([CRM](https://sevenrooms.com/platform/crm/)).
  - OpenTable: POS integration on all plans ([plans](https://www.opentable.com/restaurant-solutions/plans/)).
  - Owner.com: Square, Clover and Toast (via Otter) ([Certus](https://www.certus-ai.com/blogs/owner-com-review) [2H]).
- **Reservation data into marketing.** Popmenu integrates OpenTable menu and guest data ([Popmenu](https://get.popmenu.com/pricing)).
- **Delivery and accounting.** Toast third-party delivery integrations, and xtraCHEF accounting sync ([Toast pricing](https://pos.toasttab.com/pricing)).

### g. Pricing
| Vendor | Price | Source |
|---|---|---|
| Toast | Starter Kit from $0/mo; POS from $69/mo; "Build Your Own" custom; POS + Payroll $69 + $9 per employee | [pos.toasttab.com/pricing](https://pos.toasttab.com/pricing) |
| Toast IQ Grow | $499/mo | [Toast PR](https://pos.toasttab.com/news/toast-debuts-toast-iq-grow-spring-release-2026) |
| Square for Restaurants | Free $0, Plus $49, Premium $149 per location per month; in-person processing 2.6% / 2.5% / 2.4% + 15¢; KDS $30/$20 per device | [Square](https://squareup.com/us/en/point-of-sale/restaurants/pricing) |
| OpenTable | Basic $149 ($1.50 per network cover; website covers $0.25 each or $49/mo flat); Core $299 and Pro $499 ($1 per network cover; website bookings free) | [OpenTable plans](https://www.opentable.com/restaurant-solutions/plans/) |
| Resy (ResyOS) | Platform $249, Essential $269, Platform 360 / Premium $399; no cover fees | [RestaurantBookingSystem](https://restaurantbookingsystem.com/compare/resy-pricing/) [2H] |
| SevenRooms | Quote-only; about $499/mo for a single venue | [RestaurantBookingSystem](https://restaurantbookingsystem.com/compare/sevenrooms-pricing/) [2H] |
| Popmenu | Starter $179 ($159 annual), Essentials $299 ($269), Premier $499 ($449); ordering and AI phone quoted separately (AI phone about $150 per 500 calls) | [Popmenu](https://get.popmenu.com/pricing); [Certus](https://www.certus-ai.com/blogs/popmenu-review) [2H] |
| Owner.com | Flexible $249/mo + 5% per order; Flat Rate $499/mo | [Owner](https://www.owner.com/pricing) |
| Tripleseat | Quote-based; from about $149/mo | [Packages](https://tripleseat.com/packages/); [SelectHub](https://www.selecthub.com/p/event-management-software/tripleseat/) [2H] |
| Thanx / Paytronix | Custom quotes; Paytronix about $500–$1,000+/mo | [SaaSworthy](https://www.saasworthy.com/product/thanx-platform/pricing) [2H]; [Loop](https://loop.fans/blog/paytronix-alternative) [2H] |
| BentoBox | Now sold only to Clover POS customers; historically about $119+/mo | [getbento.com](https://www.getbento.com/); [Sauce](https://www.getsauce.com/post/bentobox-pricing-fees) [2H] |

### h. What a general CRM must have, and what it should not build
**10 must-haves**
1. Guest profile unified from the POS: visits, spend, favorite items.
2. **Allergy and dietary tags** flagged as sensitive, plus birthdays and occasions.
3. Reservation and waitlist **sync** (OpenTable, Resy, Toast Tables, SevenRooms) into the profile.
4. Catering and private-event pipeline: inquiry form → quote/BEO → e-sign → **deposit schedule** → final invoice, with Texas-compliant gratuity labeling.
5. Segmented email and SMS: lapsed, VIP, birthday, first-visit follow-up. Include attribution (Toast now sells ROI attribution).
6. Review requests and AI-drafted replies.
7. **Bilingual AI phone and text answering**: hours, menu, allergens, catering leads, reservation links.
8. Offers and promotions tied to slow shifts.
9. Multi-location roles and permissions; a pre-shift VIP and allergy brief.
10. Consent ledger (SB 140 and 10DLC) and a no-sale rule for health-type data.

**Five things not to build**
1. POS, payments and KDS.
2. Online ordering and delivery dispatch.
3. Floor plans, table management and diner reservation networks.
4. A POS-linked loyalty points engine and gift cards.
5. Inventory, recipe costing, payroll and tips.

---

## 3. Child day care

### a. Core records (Texas HHSC minimum standards, 26 TAC Ch. 746)
- **Household → Child → Guardians.** Admission information must include:
  - the child's name, birth date, address and phone;
  - parents' names, addresses and phones while the child is in care;
  - another emergency contact;
  - **names and phones of non-parents the child may be released to**;
  - physician or emergency-care facility, and authorization for emergency care and transport;
  - a special-needs statement (limits, adaptive equipment, long-term medications);
  - **allergies and a food-allergy emergency plan**;
  - consents for transportation, field trips and water activities, and swim competency or flotation-device needs.

  Source: [§746.605](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-746-605).
- **Required child file** ([§746.603](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-746-603)):
  - enrollment agreement;
  - admission information;
  - health statement from a health-care professional;
  - immunizations;
  - TB screening and vision/hearing screening, if applicable;
  - incident/illness reports;
  - a daily arrival and departure tracking record;
  - medication records;
  - health-care professional orders.
- **Pickup identity.** Release a child only to a parent or someone the parent designated. Policies must record the identity of an unfamiliar pickup person (photo-ID copy, photo, or license and plate numbers). Keep that record ≥ 3 months (§746.4101 and §746.4103, in the [HHSC Ch. 746 PDF](https://www.hhs.texas.gov/sites/default/files/documents/doing-business-with-hhs/provider-portal/protective-services/ccl/min-standards/chapter-746-centers.pdf)).
- **Operational fields a CRM needs beyond the rule:**
  - classroom and age group, schedule (days and hours), tuition plan;
  - subsidy case: TWC "child care scholarship," parent share of cost (PSoC), Board;
  - CACFP (child-care food program) eligibility;
  - custody or no-contact flags;
  - photo and media consent.

### b. Documents, retention and consent (Texas)
- **Retention floors** ([§746.603](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-746-603)):
  - medication records: 3 months after administration;
  - health-care professional orders: 3 months after they are no longer needed;
  - all other child records: **3 months after the child's last day**.

  These are minimums. Records must be available for Licensing review during operating hours.
- **Personnel records** ([§746.901](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-746-901) [2H via search summary]):
  - background-check requests, training hours, receipt of policies;
  - kept 3 months after an employee's last day;
  - training records for the current and last full training year.
- **Center records** ([§746.801](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-746-801)): drills, fire, sanitation and gas inspections, staff time sheets, pest control, playground checklists, pet vaccinations, vehicle and crib records.
- **Electronic records and signatures:**
  - Electronic or mixed records are expressly allowed (§746.805).
  - Parent medication authorization may be electronic "capable of being viewed and saved" (§746.3803).
  - Immunization records may carry an electronic signature (§746.623).

  Source: [HHSC Ch. 746 PDF](https://www.hhs.texas.gov/sites/default/files/documents/doing-business-with-hhs/provider-portal/protective-services/ccl/min-standards/chapter-746-centers.pdf).
- **Enrollment agreement.** Parents sign it on or before admission. One copy per child, or one per family for siblings enrolled together ([§746.503](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-746-503)).
- **CACFP.**
  - Keep enrollment, daily attendance, meal counts by type, and menus ([7 CFR 226.15(e)](https://www.law.cornell.edu/cfr/text/7/226.15)).
  - Retain **3 years after the final claim for the fiscal year**, longer if audits are open ([7 CFR 226.10(d)](https://www.law.cornell.edu/cfr/text/7/226.10)).
- **COPPA.** Amended rule effective 2025-06-23, with a compliance deadline of **2026-04-22** ([Federal Register](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)). It applies only if the product collects information directly from children under 13.
- **TDPSA.** Data from a known child under 13 is "sensitive" ([Texas AG](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/texas-data-privacy-and-security-act)).

### c. Daily workflows
- **Sign-in/sign-out.** Each entry must record the child's name, date, arrival and departure times, and staff or parent initials or another unique ID (§746.631, [PDF](https://www.hhs.texas.gov/sites/default/files/documents/doing-business-with-hhs/provider-portal/protective-services/ccl/min-standards/chapter-746-centers.pdf)).
- **Ratios** (children per caregiver, §746.1601, same PDF):

  | Age | Children per caregiver |
  |---|---|
  | 0–11 months | 4 |
  | 12–17 months | 5 |
  | 18–23 months | 9 |
  | 2 years | 11 |
  | 3 years | 15 |
  | 4 years | 18 |
  | 5 years | 22 |
  | 6–13 years | 26 |

- **Incidents.**
  - Log incidents on Form 7239 or equivalent ([§746.701](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-746-701)).
  - Notify parents immediately of alleged abuse, or of an injury or illness that needs medical treatment or hospitalization (§746.307).
  - **Get the parent's signature on the report within 48 hours** (§746.707).
  - Notify Licensing within 2 days for injuries that need treatment (§746.305).

  §746.307/707/305 source: [PDF](https://www.hhs.texas.gov/sites/default/files/documents/doing-business-with-hhs/provider-portal/protective-services/ccl/min-standards/chapter-746-centers.pdf).
- **Medication log.** Child's full name, drug name, date, time, amount, and the full name of the employee who gave it (§746.3805, same PDF).
- **Daily reports with photos, tuition billing with autopay, subsidy management, CACFP tracking, waitlists.** All are standard in brightwheel ([brightwheel pricing](https://mybrightwheel.com/pricing/)).
- **TWC Child Care Services (subsidy) attendance.** Policy letter WD 06-26, 2026-04-06; the original was rescinded and replaced by Change 1 on 2026-06-15 ([WD 06-26 PDF](https://www.twc.texas.gov/sites/default/files/2026-04/06-26-twc.pdf); [rescission note](https://www.twc.texas.gov/sites/default/files/wf/policy-letter/wd/06-26-twc.pdf)).
  - **Both a check-in and a check-out are required each day.** A missing one counts as an unexplained absence. Local boards describe this as effective 2026-04-01 ([Workforce Solutions RCA](https://workforcesolutionsrca.com/blog/a-simple-shift-a-stronger-system-whats-changing-with-child-care-services-attendance)).
  - **Only the sponsor (parent or designee) records attendance.** When the provider transports the child, the provider may record one of the two punches per day.
  - Sponsors may backdate up to 6 days.
  - **More than 40 unexplained absences in a 12-month eligibility period is "excessive."**
  - **Boards pay providers based on enrollment**, except relative providers.
- **Attendance systems.** The state system is TX3C: KinderSign (tablet), KinderConnect (portal), and **KinderBridge, an API for certified child-care management systems** ([WD 06-26](https://www.twc.texas.gov/sites/default/files/2026-04/06-26-twc.pdf)).
  - Certified systems include Procare (desktop and web), Brightwheel, Wonderschool, ChildPilot, Playground, SmartCare, HiMama/Lillio, Famly, DailyConnect, LineLeader, EZChildTrack, iCare and others.
  - New vendors contact partners@kindersystems.com.

  Source: [TX3C partner list](https://tx3c.info/index.php/api-cms-providers/).
- **Subsidy billing duties.**
  - The provider collects the assessed PSoC and reports non-payment.
  - It may not charge subsidy families fees that private-pay families don't pay.
  - It must follow Commission attendance procedures.

  Source: [40 TAC §809.92](https://www.law.cornell.edu/regulations/texas/40-Tex-Admin-Code-SS-809-92).
- **Other subsidy parameters.** Texas Rising Star providers get a rate at least 5% above non-designated providers, and PSoC is capped at 7% of family income ([TWC Ch. 809 rules](https://www.twc.texas.gov/sites/default/files/ogc/docs/fr-809-ch-rev-09-01-twc.pdf) [2H]).

### d. Client-facing surfaces
- **brightwheel** parent app: messaging, photos and video, newsletters, calendars, online bill pay and autopay ([brightwheel](https://mybrightwheel.com/pricing/)).
- **Procare Connect** parent app and contactless check-in ([Procare](https://www.procaresoftware.com/)).
- **Kangarootime** KT Connect app: photos, daily logs, messages ([Kangarootime](https://kangarootime.com/)).
- **Tadpoles** Family App: photos, notes, bill pay ([Tadpoles](https://www.tadpoles.com/)).
- **Playground** parent app, available in Spanish ("Disponible en español") ([Playground](https://www.tryplayground.com/)).

### e. AI features, 2025–2026
- **brightwheel, Back-to-School 2026** ([brightwheel](https://mybrightwheel.com/back-to-school-2026/)):
  - Teacher and Admin AI assistants.
  - **Automatic message translation.**
  - CACFP compliance checks.
  - **Spanish web app for staff.**
  - Coming soon: "brightwheel AI," **brightwheel CRM** (lead pipeline, interest forms, tours, waitlist, automated messages) and enrollment forecasting.
- **Playground "Camber" AI employee.** Answers inquiry calls 24/7, qualifies families and logs them in the CRM, is trained on the handbook and state licensing, drafts messages, issues refunds, **reconciles subsidies** and builds reports ([Playground](https://www.tryplayground.com/)).
- **Procare RoomRunner.** AI-assisted enrollment planning: future openings and room transitions ([Procare](https://www.procaresoftware.com/)).
- **Famly.** AI writing assistant ([Famly](https://www.famly.co/us/pricing)).
- **Kangarootime, Lillio, Tadpoles.** No AI features found on their homepages.

### f. Essential integrations
- TX3C KinderBridge certification.
- Payments (autopay, ACH).
- Payroll (Playground, brightwheel).
- CACFP reporting.
- **Playground is state-sponsored at no cost** to providers in AZ, IA, ID, KS and NY ([Playground](https://www.tryplayground.com/)).

### g. Pricing
- **Mostly quote-only.** brightwheel ([official](https://mybrightwheel.com/pricing/)), Procare ([official](https://www.procaresoftware.com/request-pricing/)), Playground (demo) and Kangarootime.
- brightwheel is estimated at about $2–4 per child per month ([Neztio](https://neztio.com/en/blog/brightwheel-pricing) [2H]).
- The category runs about $5–15 per child per month plus 2–3% on payments ([Neztio comparison](https://neztio.com/en/best-childcare-software) [2H]).
- Famly prices per child ([Famly](https://www.famly.co/us/pricing)).

### h. What a general CRM must have, and what it should not build
**10 must-haves**
1. Household graph: guardians with custody or restriction flags; **authorized pickups with ID capture**; emergency contacts and physician (mirrors §746.605).
2. **Enrollment CRM:** inquiry → tour → waitlist by room, age and start date → registration. This competes directly with brightwheel CRM (coming soon) and Playground Camber.
3. E-signed registration packet: enrollment agreement, policies, consents, medication authorization.
4. Document vault with **expiry reminders** (immunizations, health statement) and per-type retention floors.
5. Bilingual broadcast and 1:1 family messaging with auto-translation.
6. Tuition billing: autopay, late fees, sibling and multi-payer splits, **a PSoC line separate from the agency portion**, year-end statements.
7. **Incident workflow:** parent signature within 48 hours, and a 2-day Licensing notice reminder.
8. Bilingual AI receptionist trained on the handbook and Texas licensing FAQ that books tours.
9. Role-based access (teacher vs admin vs non-custodial parent), an audit log, and a one-click "inspection packet" export.
10. APIs or sync to the center's child-care management system (brightwheel, Procare, Playground) for attendance and ratio data.

**Five things not to build**
1. TX3C/KinderBridge-certified subsidy attendance kiosks (requires KinderSystems certification).
2. Classroom operations: ratios, daily reports with photos, naps and meals.
3. Curriculum, lesson plans and assessments.
4. CACFP claiming.
5. Staff payroll and scheduling.

---

## 4. Adult day care and home care

### a. Core records
- **Participant record:**
  - demographics and language;
  - payer and authorization: Medicaid ID, managed-care plan (MCO), Title XX, VA or private pay; units authorized (**max 10 units per week**) with start and end dates;
  - **responsible party or legal representative**, emergency contacts, physician;
  - diagnoses, allergies, diet, mobility and adaptive equipment;
  - attendance schedule; transport address and pickup notes.
- **Related objects:**
  - Health Assessment / Individual Service Plan (**Form 3050**);
  - physician orders (**Form 3055**);
  - medication record;
  - progress and nursing notes;
  - daily attendance (**Form 3683**) and transportation (**Form 3682**);
  - incident reports.

  Sources: [DAHS manual 5000](https://fhb.hhs.texas.gov/handbooks/day-activity-health-services-provider-manual/5000-service-requirements); [6000](https://fhb.hhs.texas.gov/handbooks/day-activity-health-services-provider-manual/6000-billing-recordkeeping-requirements).
- **WellSky Adult Day** (formerly ADS Data Systems) models care-plan libraries, progress notes, eMARs, physician orders, assessments, activities and attendance ([WellSky](https://wellsky.com/adult-day-software/)).

### b. Documents; retention and consent (Texas DAHS and HIPAA)
- **What DAHS is and its rules.** DAHS is licensed under **26 TAC Ch. 559** and is for adults 18+ living in the community. Services must be prescribed for a chronic condition with a functional limit, and a licensed nurse oversees them. Funding is Title XIX and Title XX ([HHSC DAHS](https://www.hhs.texas.gov/providers/long-term-care-providers/day-activity-health-services-dahs)).
- **Two retention clocks; keep the longer:**
  - **Licensing:** client records kept **5 years after services end**. Disposal must be by shredding or incineration with a destruction log. Clients may **view records within 24 hours and get copies within 48 hours** (excluding weekends and holidays) ([§559.75](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-559-75)).
  - **Billing:** records supporting claims kept **6 years after the end of the federal fiscal year** of service ([DAHS 6000](https://fhb.hhs.texas.gov/handbooks/day-activity-health-services-provider-manual/6000-billing-recordkeeping-requirements)).
- **Form timing.** Form 3050 and physician orders are due within 14 days of a case-manager referral, or before services start for a facility referral ([DAHS 5000](https://fhb.hhs.texas.gov/handbooks/day-activity-health-services-provider-manual/5000-service-requirements)).
- **HIPAA:**
  - A vendor storing ePHI is a **business associate** that needs a BAA, even if it only stores encrypted data without the key ([HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html); [HHS BAs](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/business-associates/index.html)).
  - HIPAA documentation retention is 6 years ([45 CFR 164.316](https://www.law.cornell.edu/cfr/text/45/164.316)).
  - Unencrypted email is allowed only at the patient's request, after a risk warning ([HHS FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/does-hipaa-permit-health-care-providers-to-use-email-to-discuss-health-issues-with-patients/index.html)).
- **Texas overlays:**
  - **HB 300 / Health & Safety Code ch. 181** treats anyone who stores PHI as a Texas "covered entity." That requires workforce training within 60 days of hire and every 2 years, and 15-business-day electronic access ([HIPAA Journal](https://www.hipaajournal.com/what-is-texas-hb-300/) [2H]).
  - **SB 1188** requires EHRs to be **physically stored in the US from 2026-01-01**, and it reaches vendors and cloud hosts ([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/texas-enacts-electronic-health-record-data-localization-law) [2H]).

### c. Daily workflows
- **Billing units.** One unit is more than 3 but less than 6 hours; two units is more than 6 hours up to 10 ([DAHS 5000](https://fhb.hhs.texas.gov/handbooks/day-activity-health-services-provider-manual/5000-service-requirements)).
- **Daily program.** A hot noon meal plus two snacks, and ≥ 3 scheduled activities daily (same source).
- **Staffing.** Direct staff to clients **1:8**, and an RN or LVN on site ≥ 8 hours a day ([§559.61](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-559-61)).
- **Medications** ([§559.69](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-559-69)):
  - the record holds name, strength, dosage, amount received, directions, route, Rx number, pharmacy and issue date;
  - only licensed staff administer;
  - storage is locked, with Schedule II drugs double-locked;
  - missed doses are documented.
- **Incidents.** Immediately notify the physician and the responsible party ([§559.71](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-559-71)).
- **Claims.** Units from Form 3683 are submitted through TMHP ([DAHS 6000](https://fhb.hhs.texas.gov/handbooks/day-activity-health-services-provider-manual/6000-billing-recordkeeping-requirements)). STAR+PLUS MCO billing is also supported by DAHS software ([Adult Day Genie](https://adultdaygenie.com/texas-dahs-software) [2H]).
- **EVV applies to in-home Medicaid care, not the day center:**
  - Required for Medicaid personal care since 2021-01-01 and home health since 2024-01-01 ([HHSC EVV](https://www.hhs.texas.gov/providers/long-term-care-providers/long-term-care-provider-resources/electronic-visit-verification-evv)).
  - STAR+PLUS services covered: personal assistance services, Community First Choice PAS/HAB, and (under HCBS) in-home respite and protective supervision ([1 TAC §354.4005](https://regulations.justia.com/states/texas/title-1/part-15/chapter-354/subchapter-o/section-354-4005) [2H]).
  - **DAHS is facility-based and does not appear in the EVV-required lists** ([HHSC EVV](https://www.hhs.texas.gov/providers/long-term-care-providers/long-term-care-provider-resources/electronic-visit-verification-evv)). Confirm with the MCO.
  - HHAeXchange is the state-provided system. Clock-in is by mobile app, landline IVR, or alternative device, and alternative devices are being phased down from 2025-09-01 to 2028-09-01 ([HHSC 7000](https://fhb.hhs.texas.gov/handbooks/electronic-visit-verification-policy-handbook/7000-clock-clock-out-methods) [2H]).
  - Third-party EVV systems integrate with HHAeXchange by API ([TMHP](https://www.tmhp.com/news/2023-12-05-evv-third-party-software-system-integration-hhaexchange)).
  - Non-EVV services must *not* be entered in EVV ([HHSC 15000](https://fhb.hhs.texas.gov/handbooks/electronic-visit-verification-policy-handbook/15000-evv-optional-services-non-evv-services)).

### d. Client-facing surfaces
- Family portals: CareSmartz360 includes a family portal plus integrated email and SMS ([CareSmartz360](https://www.caresmartz360.com/pricing/)).
- Ankota advertises a family portal with visit updates ([Ankota](https://www.ankota.com/) [2H via search summary]).
- **Participants' 24-hour right to view their records** ([§559.75](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-559-75)) argues for a portal or export.

### e. AI features, 2025–2026
- **WellSky SkySense AI.** Scribe (ambient documentation), Extract (medication reconciliation) and WILA, included with its Home Health EHR ([WellSky](https://wellsky.com/blog/built-for-care-powered-by-ai-making-healthcare-more-human-with-wellsky-skysense-ai/); [Scribe results, Aug 2026](https://wellsky.com/wellsky-scribe-solution-helps-home-health-clinicians-see-more-patients-spend-less-time-on-after-hours-documentation/)).
- **AxisCare Intelligence.** Axi chat assistant, care analytics and AI scheduling ([AxisCare](https://axiscare.com/)).
- **CareSmartz360.** AI scheduling and caregiver-retention insights ([SelectHub](https://www.selecthub.com/p/home-care-software/caresmartz360/) [2H]).
- **AlayaCare.** Clinical Notes Detector ([Software Finder](https://softwarefinder.com/emr-software/alayacare/pricing) [2H]).
- **Ankota.** AI-assisted visit approval ([Ankota](https://www.ankota.com/) [2H]).

### f. Essential integrations
- TMHP claims and MCO portals.
- HHAeXchange (for home-care lines).
- VA and managed-care billing ([WellSky](https://wellsky.com/adult-day-software/)).
- Payroll.
- CSV/PDF audit exports ([Adult Day Genie](https://adultdaygenie.com/texas-dahs-software)).

### g. Pricing
| Vendor | Price | Source |
|---|---|---|
| Adult Day Genie (Texas DAHS) | Attendance only $99/mo; full platform $299/mo; BAA included | [adultdaygenie.com](https://adultdaygenie.com/texas-dahs-software) |
| ElderSuite | $299/mo per location | [ElderSuite](https://www.eldersuite.com/adult-day-care-resources/how-much-does-adult-day-care-software-cost) |
| CareSmartz360 | Tiered by active clients; from about $10 per client | [official](https://www.caresmartz360.com/pricing/); [SelectHub](https://www.selecthub.com/p/home-care-software/caresmartz360/) [2H] |
| AxisCare | From about $200/mo | [Jotform](https://www.jotform.com/blog/axiscare-pricing/) [2H] |
| AlayaCare | About $1,650/mo + $5,000 setup | [Software Finder](https://softwarefinder.com/emr-software/alayacare/pricing) [2H] |
| Therap | About $500–$1,000 | [SelectHub](https://www.selecthub.com/p/home-health-software/therap/) [2H] |
| Ankota | Per participant; the category runs $2–6 per participant per month | [Ankota](https://www.ankota.com/blog/adult-day-care-software/adult-day-care-software-pricing) |
| WellSky Adult Day | Quote | [WellSky](https://wellsky.com/adult-day-software/) |

### h. What a general CRM must have, and what it should not build
**10 must-haves**
1. Participant, responsible-party and payer model, with authorization and unit tracking (≤ 10 units per week).
2. Referral pipeline from MCO service coordinators, discharge planners and families.
3. **HIPAA mode:** BAA, encryption, MFA, access audit, US-only storage.
4. Storage for Forms 3050, 3055, 3683 and 3682, with renewal reminders.
5. Consent and authorization management: HIPAA authorizations, release of information, photo consent.
6. Time-in/out capture that **computes DAHS units** and exports a Form 3683 equivalent; transport log.
7. Incident workflow with immediate responsible-party and physician notification.
8. Private-pay invoicing and autopay, plus claims-ready unit exports per payer.
9. Dual retention engine (5 years after services end vs 6 years after the federal fiscal year) with a destruction log.
10. PHI-minimized bilingual family messaging, and a records-access portal that meets the 24/48-hour rights.

**Five things not to build**
1. eMAR and clinical EHR / nursing documentation.
2. EVV (use HHAeXchange or a certified vendor).
3. 837 claim submission, the clearinghouse and remittance posting.
4. Transport route optimization.
5. Caregiver scheduling and payroll.

---

## 5. Other South Texas verticals (one paragraph each)

**Salons, barbers and spas.** Must-haves are:
- online booking with deposits and waitlists;
- forms and waivers (SOAP notes for spas);
- packages and memberships;
- a card-on-file flat processing rate;
- marketplace discovery.

Prices and features:
- **GlossGenius:** Standard $24, Gold $48 (adds forms and waivers, Google booking, automated waitlist), Platinum $148 per month billed annually; flat 2.6% processing; medspa EMR plans at $148 and $248 ([GlossGenius](https://glossgenius.com/pricing)).
- **Vagaro:** $23.99/mo intro (then $30) plus $10 per calendar up to 7; forms and SOAP notes included; "Vera" AI assistant; Affirm buy-now-pay-later ([Vagaro](https://www.vagaro.com/pro/pricing)).
- **Boulevard:** about $176–$410 per location per month ([GlossGenius blog](https://glossgenius.com/blog/boulevard-price) [2H]).
- **Fresha:** about $19.95 solo, $14.95 per team member, plus a 20% new-client marketplace fee ([SchedulingKit](https://schedulingkit.com/pricing-guides/fresha-pricing) [2H]).

A CRM should add rebooking prompts, deposits and no-show fees, and bilingual reminders. It should integrate rather than rebuild marketplaces.

**Small medical and dental practices.** The front-office CRM is:
- two-way texting, reminders and recalls from the practice-management or EHR system;
- online scheduling, digital intake forms, payments and reviews;
- VoIP phones.

Prices and features:
- **Weave:** about $300–$500/mo for small practices ([NoShowCost](https://noshowcost.com/tools/weave-pricing) [2H]).
- **NexHealth:** from about $299/mo plus $500–$3,000 implementation for the practice-system connection ([Capterra](https://www.capterra.com/p/182271/NexHealth/pricing/) [2H]).
- **Solutionreach:** not verified.

The defining requirement is *two-way practice-system sync plus HIPAA*: BAA, HB 300 and SB 1188 (US storage) apply exactly as in §4b. Never build the practice system itself.

**Auto repair.** Must-haves are:
- digital vehicle inspections with photos texted to the customer;
- estimates with e-signature, labor guides and parts lookup, payments, QuickBooks Online;
- two-way text and email;
- follow-ups on declined work.

Prices and features:
- **Tekmetric:** Start $199, Grow $349, Scale $439 per month (from $179 annual); two-way texting is on Scale ([Tekmetric](https://www.tekmetric.com/pricing)).
- **Shopmonkey:** Basic $239 ($215 annual), including 2-way text, inspections, e-signature and payments; Clever $399 (QuickBooks Online, ALLDATA); Genius $499 (Google reviews, automated estimate follow-ups) ([Shopmonkey](https://www.shopmonkey.io/pricing)).

The CRM model is Customer → Vehicles (VIN, mileage) → Repair orders, much like home services' property → equipment.

**Insurance agencies.** Must-haves are:
- household → policies with X-dates (renewal dates);
- renewal and win-back automation;
- comparative-rater and agency-management-system integration;
- commission and chargeback tracking;
- producer goals, referral sites, 2-way texting.

AgencyZoom lists all of these, with tiers from $99 to $349/mo ([AgencyZoom](https://www.agencyzoom.com/pricing)). Do not rebuild the agency management system or raters; sync with them. SB 140 and TCPA consent is critical for quote follow-ups.

**Legal practices.** Must-haves are:
- matters linked to contacts;
- **trust (client-funds) accounting**;
- conflict checks, intake forms and consult booking;
- e-signature and a client portal.

Clio pricing and features ([Clio](https://www.clio.com/pricing/)):
- Starter $49 per user per month; higher tiers are quote-only.
- Core and up include the Clio for Clients portal and AI features: matter creation, AI client updates, scheduling automation.
- **Clio Grow add-on:** AI phone, web and email intake agents, priced per matter hired, plus lead nurture.
- **Clio for Personal Injury:** medical records with HIPAA BAA.

A general CRM can win on intake and bilingual follow-up. It should not build trust accounting.

---

## 6. Cross-vertical synthesis

### Platform features (all four priority verticals share these)
1. **Relationship graph.** Account/household → people with typed roles: payer, guardian, authorized pickup, responsible party, emergency contact. Plus "things served": property, equipment, vehicle, child, participant.
2. **Intake pipeline.** Web, phone and SMS lead capture → qualification → booking (tour, estimate, tasting, assessment).
3. **Scheduling and calendar** with Google and Microsoft sync.
4. **Quotes and contracts with e-signature, deposits and payment schedules.** Tiered quotes for home services, BEOs for catering, enrollment agreements for child care, service agreements for adult day.
5. **Invoicing, payment links, autopay and recurring billing,** with multi-payer splits (subsidy PSoC, Medicaid vs private pay, catering deposits).
6. **Two-way SMS and email with a consent ledger,** SB 140 and 10DLC-ready ([Morgan Lewis](https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages) [2H]; [Twilio](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)).
7. **Bilingual everything.** Templates, portal and auto-translation. Incumbents already market Spanish: Housecall Pro, Jobber Client Hub, Workiz AI, the brightwheel staff app, Playground.
8. **AI receptionist (voice and text) trained on a per-business knowledge base.** It is now standard in every vertical: Jobber and Housecall Pro, SevenRooms and Popmenu, Playground Camber, Clio Grow. Price anchors run from $1 per call to $29/mo.
9. **Forms builder and document vault** with expiry reminders, retention classes and audit exports.
10. **Reviews and reputation; segmented campaigns with attribution;** QuickBooks Online sync; roles, permissions and audit log; a portal.

### Industry packs (templates, fields, rules)
- **Home services:** property/equipment objects; good/better/best quotes; service agreements; TDLR and TSBPE disclosure blocks; Texas tax class per line; RRP 3-year pack.
- **Restaurants:** POS guest sync; allergy and occasion tags; reservation sync; catering BEO and deposit schedule with the Texas ≤ 20% gratuity label; offers for slow shifts.
- **Child care:** §746.605 admission form; pickup-ID capture; room/age waitlist and capacity; incident form with 48-hour parent signature; PSoC billing line; CACFP 3-year retention; certified-CCMS integration.
- **Adult day:** participant, payer and authorization; unit calculator (>3h = 1, >6h = 2); Forms 3050/3055/3682/3683; 1:8 ratio alert; 5-year and 6-year retention; HIPAA mode.

### How regulated data changes document storage
- **PHI (adult day, medical and dental, personal-injury law).**
  - The CRM vendor becomes a HIPAA business associate. It must sign BAAs and flow BAAs down to its cloud, SMS and AI subprocessors, even for encrypted-only storage ([HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html)).
  - Under Texas law the vendor is itself a covered entity, so it must train staff ([HIPAA Journal](https://www.hipaajournal.com/what-is-texas-hb-300/) [2H]).
  - It must keep EHR data **physically in the US** ([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/texas-enacts-electronic-health-record-data-localization-law) [2H]).
  - Build now for encryption at rest and in transit, MFA and access logging. These are the core of the pending Security Rule update, which HHS reportedly pushed to July 2027 ([HHS NPRM](https://www.hhs.gov/hipaa/for-professionals/security/hipaa-security-rule-nprm/factsheet/index.html); [Clark Hill](https://www.clarkhill.com/news-events/news/hipaa-security-rule-update-delayed-until-2027/) [2H]).
  - Design implications:
    - a per-tenant "PHI mode" with segregated storage and region pinning;
    - no PHI in SMS or email bodies by default (a secure link instead), with an unencrypted opt-in only after a risk warning ([HHS FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/does-hipaa-permit-health-care-providers-to-use-email-to-discuss-health-issues-with-patients/index.html));
    - AI features in PHI mode only with BAA-covered models;
    - access-within-24-hours export and destruction logs ([§559.75](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-559-75)).
- **Children's records** (usually not HIPAA).
  - Texas requires them to be **immediately accessible to caregivers in an emergency** and **available to Licensing during operating hours**, and allows electronic records ([§746.603](https://www.law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-746-603); §746.805 in the [PDF](https://www.hhs.texas.gov/sites/default/files/documents/doing-business-with-hhs/provider-portal/protective-services/ccl/min-standards/chapter-746-centers.pdf)). That means offline or mobile read access and an inspector export.
  - Retention periods are *floors* (3 months after last day, etc.), so the system needs configurable retention, not forced deletion.
  - Field-level permissions are needed for custody restrictions and for teacher vs admin access.
  - Media-consent flags must gate photo sharing.
  - Under TDPSA, under-13 data is sensitive: never sell it ([Texas AG](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/texas-data-privacy-and-security-act)).
  - COPPA is triggered only if the product collects directly from children ([Federal Register](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)).
- **Every document store should support:**
  - a retention class per document type, with the longest applicable clock winning;
  - legal and audit holds (CACFP holds extend while audits are open, [7 CFR 226.10](https://www.law.cornell.edu/cfr/text/7/226.10));
  - append-only audit history and e-signature evidence;
  - versioning, expiry reminders, and per-role redaction.

### Competitive notes
- **Incumbents are moving into "CRM":**
  - brightwheel CRM, coming soon ([brightwheel](https://mybrightwheel.com/back-to-school-2026/));
  - Playground's Camber, which logs inquiries in a CRM ([Playground](https://www.tryplayground.com/));
  - Toast IQ Grow, a $499 marketing bundle ([Toast](https://pos.toasttab.com/news/toast-debuts-toast-iq-grow-spring-release-2026));
  - Jobber's Pipeline add-on at $49 ([Jobber](https://www.getjobber.com/pricing/)).
- **The durable wedge for a local bilingual CRM:**
  - Spanish-first AI answering and messaging;
  - Texas-specific templates (TDLR/TSBPE, HHSC 746/559, TWC CCS, gratuity tax);
  - cross-vertical front-office automation;
  - integration with, not replacement of, the operations systems of record.
- **Gating item for Texas child care:** KinderSystems certification, if the CRM ever wants to carry subsidy attendance ([TX3C](https://tx3c.info/index.php/api-cms-providers/)).
