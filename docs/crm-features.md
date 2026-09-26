# BIS CRM: what we have, and what we build next

**Written** 2026-09-26. **Verified against the code** at `e38ed7f`, the working branch that includes `main`'s #146.

**What this is.** A plan for the BIS CRM: what the product does today, what it should do next, in what order, and why. It is the companion to `docs/research/2026-09-25-crm-feature-research.md` ("the study"), not a copy of it. The study sets the direction and the foundation items; this document adds the verified inventory of today, 199 detailed features, a capacity-checked roadmap, the design work underneath, and the decisions the plan needs.

**How it was made.**
- Twelve subsystem inventories were written from the code, and each was checked by an adversarial second reader who tried to prove it wrong.
- Ten independent product lenses (owner workflow, AI, bilingual and border, the end customer, trust, growth, design, industry packs, information architecture, agentic discovery) produced 230 proposals, merged into 192 canonical features, F-001 to F-192. A final pass against the study added seven more, F-193 to F-199.
- Four judges scored every canonical feature for value, feasibility, differentiation and risk.
- The roadmap placed every feature and every study item exactly once, against a stated capacity.

**Status.** Nothing here is decided. Every placement, estimate and recommendation is a proposal until the owner rules on the decisions in section 9. Security work is described generically; its specifics are tracked outside this public repository.

**Binding constraints** (section 3 gives the reasons):
1. Adult day care is out (owner decision, 2026-09-25), and home health with it.
2. HIPAA verticals (medical, dental, therapy, chiropractic, medical spa, Medicare and group health) stay behind study decision 5. Nothing here reopens it.
3. M7a billing is two or three fixed plans. Every plan has the CRM; higher plans add Sofía, the voice receptionist, and the web chat. Priced per business, never per seat.
4. DESIGN.md is the UI contract. Where a feature needs it changed, the amendment is flagged for the owner's dated decision, never improvised.
5. A person approves every AI write; call proposals are the mechanism. Any narrowing is an owner decision.
6. English and Spanish everywhere a customer or an owner reads.

**Conventions.** Effort is in conventional engineer-weeks (ew) for one engineer: S up to 2, M 2–6, L 6–12, XL over 12. Horizons: **now** is Q4 2026 to about March 2027; **next** is H1 2027; **later** is H2 2027 to 2028; **future** is 2029–2030. S-01 to S-62 are the rows of the study's §11.1 table (Appendix B). An asterisk on an effort figure marks this plan's revision of the canonical figure.

**Glossary.** Terms the plan uses before it explains them:
- **M0 to M7, M7a, M1b, M1c, M1d, M2, M4b:** the platform spec's milestones and sub-milestones. M7a is client billing (plans, usage and Stripe); its "PR-3" and "PR-4" are its checkout and non-payment steps. "M7 #2" is self-serve sign-up and "M7 #3" other agencies reselling BIS.
- **Phase 4 to 7, engine B, automations spec B:** earlier design and automation specs in `docs/superpowers/specs/`, named as the specs name themselves. "B21" is decision 21 as the automation engine B spec records it.
- **A2P 10DLC:** the US carriers' registration a business must clear before it can text customers from a local number.
- **Opinion 680 and 705:** the State Bar of Texas ethics opinions on cloud storage and on AI in law practice; "the 680/705 sheet" answers them for law firms.
- **SB 140, SB 2610, TRAIGA:** Texas's 2025 laws on text-message solicitation, on a cybersecurity safe harbour for small businesses, and on AI governance.
- **Riders:** six small now-horizon add-ons, capped at 13.5 ew, that make Sofía and the CRM-only plan sellable this winter (§4.1). **Tenant vetting:** checking at onboarding that a new client business is one BIS may serve (S-53, F-173). **TDPSA:** the Texas Data Privacy and Security Act.
- **BAA:** a HIPAA business associate agreement. **CASA:** Google's paid security assessment for restricted scopes.
- **UM/PIP:** uninsured-motorist and personal-injury-protection coverage, whose rejection Texas requires in writing. **TSBPE, TDLR:** the Texas plumbing board and the Texas licensing department.
- **FLAG-M, FLAG-L, FLAG-H:** each judge's own marks, as the score files define them. In the **V** column (the value judge): FLAG-H strains a binding constraint or a recorded owner decision, or builds something large nobody asked for; FLAG-M rests on a Valley pattern nobody has checked, or revisits a recorded decision; FLAG-L is valuable only once a dependency lands, or only for one regulated segment. In the **D** column (the differentiation judge): FLAG-H is a strategic risk that needs a decision before any work; FLAG-M is a real edge that is perishable, rests on an unchecked Valley pattern, or depends on an outside gate or a revisited decision; FLAG-L is an edge in one pack or segment only. In the **F** column, low, med and HIGH are the feasibility judge's marks for a hidden prerequisite or an understated estimate. The skeptic's severities are blocker, major and minor.
- **MCP (Model Context Protocol):** the open standard that lets AI assistants such as ChatGPT or Claude read and act on a product's data, under that product's rules.
- **The owner:** BIS's owner, who rules on the decisions in §9. The person who runs a client business is "the business owner" wherever the two could be confused; "owners" in the plural are always client business owners.
- **HubSpot #N, monday #N:** item N in the study's list of every HubSpot and monday idea (study §7.2); HubSpot #22, for example, is NPS surveys.
- **Rule numbers:** "rule N" alone means DESIGN.md's rule N; this plan's own rules are always written "§3.2 rule N".

---

## 1. The answer

**Your asks, answered.** Small businesses such as plumbers, restaurants and child day care: item 12. Every customer, with all their documents and information, in one place: item 4. AI with the CRM: items 4 and 7. Microsoft 365 and Google, their calendars first: item 6. Learning from HubSpot and monday: item 13.

1. **BIS today is a working, contact-centred CRM with a bilingual AI receptionist that has answered real client calls.** It has contacts, one pipeline, forms, one booking calendar, email, an inbox, automations and weekly reports, behind server-enforced quality gates. It lacks what the owner asked for (documents on the record, calendar sync) and what the constraints and the study require (staff roles, a Spanish dashboard, a phone layout). No company can text yet, and nothing is charged. *See §2.*
2. **The critical path is the consent chain, not a feature.** The consent ledger, and one send gate that every message must pass, go live by **1 December 2026**, when texting should switch on; no account texts before then, whatever the carrier says. The revocation rule in force since April 2025 applies from the first text. An FCC rewrite, due for a vote on 30 September, could change a revocation's scope from November or December 2026. 31 January 2027, when today's delayed "revoke all" provision takes effect, is an outer limit, not the target. **In the week of 28 September 2026:** start A2P registration for BIS's own line and the one live client, and check the Spanish and missing English stop words on the Telnyx profile. **In October:** engage counsel for five readings (the texting rules, the AI disclosure, the law-firm sheet, the insurance intake and the marketing emails' opt-out). *See §4.2.*
3. **Fix what exists before adding screens.** The inventories and this plan's reviews found 105 distinct defects (about 14–23 ew), and a hardening sprint of 56 known items (about 8–11 ew); monitoring and a tested restore are not yet in place, and the operational floor adds them now. With the legal chain, an operational floor (alerts and a tested restore) and the first Spanish comparison (a published test of Spanish receptionists, F-194), this is about 31–46 ew, and none of it is optional. *See §2.3 and §4.2.*
4. **Centralise every customer and their documents in the study's first release (by about March 2027, its last items possibly in April), re-costed at about 54–73 ew, not 27–36.** Staff and roles, the client record, the record page, the consent ledger, bilingual messages, the document vault, inbound email and one review tray for AI suggestions. It answers "centralise each customer with all their documents", and begins the answer to "use AI with the CRM": first a bilingual summary on every record and call suggestions that wait in one tray; then document intake (S-19) in H1 2027, and drafting, translation (S-16, F-025) and Ask BIS (S-18, F-095) in H2 2027–2028, with an MCP connection that lets the owner's own AI assistant read the CRM and propose changes (S-33) (proposal). *See §4.3, §4.8's AI row and §7.1.*
5. **Sell Sofía first, in parallel.** Guardrail modules, price-list grounding and tenant vetting (checking that each new client business is one BIS may serve) let BIS sell the receptionist to insurance agencies and event venues at once, and to law firms in H1 2027, once the Opinion 680/705 sheet and the law module exist. Six small add-ons (riders), capped at 13.5 ew, make Sofía and the CRM-only plan sellable this winter: a card for every call, texting without Sofía, Spanish at every edge of a call, "manage my appointment", a usable phone width and visible lead sources. *See §4.3.*
6. **Google and Microsoft: Outlook first, then Google, then everything else.** Outlook leads because Microsoft's publisher verification is free and takes days, while Google's calendar scopes need a review. Sign-in and verification come now. In April 2027 a private feed puts every BIS booking on the business owner's own calendar, Apple's included (within about 15 minutes to an hour on Apple devices, as the device's fetch setting allows; hours behind on Google and Outlook; proposal, F-048 part 2). Also in next, that calendar becomes two-way: Outlook for Microsoft 365 clients, Google once its review passes. Per-staff calendars, send-as-me, file pickers and contacts sync follow in H2 2027–2028; full inbox sync only if customers ask. *See §7.*
7. **Keep the AI honest.** Every new AI write lands in one review tray, with its evidence and an undo. Sofía and the web chat already write some records live; until the owner rules, Sofía's filling of blank fields becomes a proposal. Whether an act that callers or visitors ask for and confirm counts as an "AI write" is the owner's decision 19; the plan recommends the narrow reading, meant to cover only their own booking or record, as the identity checks (F-116) establish it. *See §3 and §9.*
8. **Do not build what nobody asked for.** Eighteen features are dropped, among them outbound AI callbacks, payment by consumer agents and a generic lens framework; the design pass also rejects a native app now, a notification bell and a monday-style layout editor. The rule builder stays deferred; four fixed trigger primitives replace it (proposal, decision 30). *See §4.7 and §6.7.*
9. **The biggest bets are the Spanish dashboard and phone shell, industry packs, a measured Spanish receptionist, and being found by AI assistants.** The Spanish dashboard and the phone shell come in H1 2027, because Spanish on the owner's own screens is what national tools lack and four of six local rivals already claim Spanish, and because owners run the business from a truck or a counter. Industry packs follow in order, home services first, because a trade's own words, documents and rules are what a generic CRM cannot give. The receptionist's Spanish quality is published and measured (F-194, F-130), because a claim of Spanish is cheap and a measured one is not. Being found and booked by AI assistants starts with F-157 now, the rest as the traffic appears, because assistants already phone local businesses for their users (§5.13). A published promise of a local bilingual person behind the product (F-195) is a smaller bet, in later's tail. *See §5.*
10. **The capacity holds, just: at five a week on the low bounds, at six on the high.** At 5–6 conventional ew a week, now holds about 112–154 ew against 130–156, and the plan through 2028 about 525–720 ew against 585–702. That is five to six times what one engineer produces working conventionally (about 52 ew a year, the study's unit); at that conventional pace the whole plan would take 13 to 18 years. It rests on the pace this repository has shown since July (about 5.5–8 ew a week, costed by us), re-measured monthly; at three to four a week the owner re-scopes the plan, or adds capacity to one named track, rather than re-ordering it. At five a week on the high bounds, through 2028 runs about 135 ew over, roughly half a year, and the same choice applies rather than later's named tail. A written cut order spares the legal chain, the hardening sprint and the first release's eight study items. *See §4.1 and §4.8.*
11. **Validate before building on a guess.** The RGV Wedding & Quince Expo on 27 September 2026 starts testing how event vendors take inquiries, holds, cash and payments from padrinos (hypotheses H1 to H4, §10); discovery calls in October and November finish those and test the rest. The value judge flagged 26 features (FLAG-M) that rest on an unchecked Valley pattern or revisit a recorded decision; none is built beyond its cheapest part until its hypothesis or decision is answered. *See §10.*
12. **Plumbers and the other trades come first; restaurants and child day care follow once they confirm the need (proposal).** Study decision 8 and today's Sofía point to home services, and the October and November calls with trades test it: trades get today's Sofía, with her guardrails, the call card and the booking fixes now, her home-services module in H1 2027 and the pack in H2 2027–2028. Insurance agencies and event venues buy Sofía first; law firms follow in H1 2027, once the 680/705 sheet and the law module exist. Restaurants meet Sofía at the front desk in H2 2027–2028 if they want it (hypothesis H10), answering hours and large parties rather than taking orders, with catering in 2029–2030. Child day care gets a Spanish front office in 2028 once centres confirm it (hypothesis H9), beside the centre's own system. Until a sector's never-say lines ship, its businesses may buy the CRM but not Sofía or the web chat; tax preparers wait for the 2028 season (§5.14). Adult day care and home health stay out; HIPAA verticals stay on hold. *See §4.8's owner's-asks table and §5.14.*
13. **Much of the first release is HubSpot's and monday's lessons, and BIS goes further where both are weak.** The study decided each of their roughly 50 ideas (study §7.2). The first release carries HubSpot's three-column record and unified timeline, private files with expiry reminders, an address that files forwarded email to a record, monday's one-click AI summary, household grouping and its recency cue (a last-contact column and a "no contact in 30 days" filter); merge with history, the change log and document intake follow in next. Saved views, and quotes that are accepted and paid on one page, come later, and a two-question check-in replaces HubSpot's NPS surveys. BIS goes further where both are weak (study §7.3): Spanish end to end rather than a translated interface, sensitive fields behind roles at small-business prices, properties and equipment on the record, and one price per business. It refuses layout editors, record tabs, owner-built custom objects, anything that needs a CRM administrator, and per-seat pricing: adding a technician should not change the price until the shop outgrows its plan. An MCP server, as both offer, and importers from both come later; the importers are built after BIS's own HubSpot and monday accounts are compared with this plan (study §14). *See §4.3, §4.8, §6.1 and §7.3.*
14. **Seventeen new owner decisions (19 to 35) join the study's eighteen.** Rule on study decisions 1, 2, 6, 14, 15 and 16–18, and on this plan's 19, 20, 21, 25, 27 and 28, decision 33's first group, decision 34's three "needed now" bullets and the first sitting of 35, in October 2026, before the first release starts; on 23, 24 and 35's second sitting in January 2027, before next starts; and on the rest as their features start. *See §9.*

---

## 2. What BIS has today

### 2.1 The whole picture

BIS is one agency platform that runs many client companies. Each company is a Clerk organisation linked to one Postgres account, and access is enforced in the app's guards, and every table has row-level security. A company gets a contact-centred CRM with one sales pipeline, a To do queue, forms and embeds, one bookable calendar with a branded public page, email through Resend, one inbox per company, eight fixed automation recipes on a 15-minute scheduler, a weekly report, website traffic for sites BIS hosts, and branding that reaches every customer surface. Sofía answers calls in English and Spanish over Telnyx and OpenAI's realtime voice model, books and moves appointments, and proposes next steps that a person accepts. A website chat assistant shares her persona. Most configuration is agency-operated. A client can edit its Branding, its booking settings on Calendar (turning the booking page on, hours, appointment length, buffer, notice, horizon, alert addresses, meeting type and the follow-up email's switch and wording) and its forms; Voice, Automations, quiet hours, Settings, Setup and the Checklist are agency-only. Every owner screen is English, and there is no phone layout.

**Production facts** (read-only checks on 2026-09-26 unless dated):
- **Four companies exist in production.** Three have client logins switched on. None is paused or archived. None has plan permissions set.
- **Sofía has answered real client calls, for one real client.** The only real client on the platform is 956 Woodworks, a woodworking business live since 2026-09-16. On 2026-09-17 it took nine calls; eight were the same scam robocall, and the robocall hang-up shipped in response. The other three companies are BIS's own, Test Client One (the test account) and the seeded demo, a fictional HVAC company whose outbound sending is switched off.
- **Email is live; texting is not.** Resend sends from production and its delivery webhook works. By the repository's record no company is carrier-registered (A2P 10DLC) and no text has been sent or received through BIS in production. A carrier API key has been on the production environment since 2026-09-16; the registration gate, not the key, holds texting back.
- **Billing has never run.** Production holds 0 plans, 0 billed companies and 0 Stripe webhook events, and no Vercel environment holds a Stripe key (only CI's end-to-end job holds a test-mode key). Usage is recorded for every company. #146, merged after the inventory, marks a usage row that Stripe already holds as reported instead of retrying it on every tick.
- **Who belongs to which company lives only in Clerk.** The `users` and `memberships` tables are empty, and the `assigned_to` columns are never read.
- **Sign-in moved to a production Clerk instance on 2026-09-14.** Email-code and password sign-in work; Google sign-in has no production credentials. A live client's first sign-in failed on 2026-09-16, and automatic activation of a user's only company shipped in response.
- **Dormant or unconfirmed:** video meetings (no Daily.co key), three of automation part B's four recipes (reactivation, referral ask and quote follow-up; the first two are the marketing emails), never set up on a live company as of 2026-09-23, the website assistant (off by default; no recorded use by a real client), and website traffic (live on one real site, BIS's own, since 2026-09-08).
- **Monitoring and a tested restore are not yet in place.** The operational floor adds them now (§4.2).
- **The quality gates are real.** A server-side ruleset on `main` requires green `verify` and `e2e`; the suites hold about 3,770 web unit test declarations, about 909 database test declarations and 116 Playwright tests. All 42 tables have row-level security enabled. Migrations are applied by hand, separately from the code deploy.
- **Three binding constraints are strained today.** Sofía creates contacts, fills blank fields, and books, reschedules and cancels without a person approving, and the web chat files leads the same way (constraint 5). A plan can say whether it includes Sofía and the web chat, but nothing on the call or chat path reads that flag (constraint 3). The owner's own screens, and Clerk's sign-in widgets and emails, are English only (constraint 6; §3.1 row 6).
- **The dashboard has no Spanish at all:** one English catalogue of 1,257 keys and `<html lang="en">`. Spanish reaches customers only on some public pages, emails and texts.
- **The research behind this plan is not on `main`.** The study, its appendices, the pricing study, and with them the adult-day-care decision, exist only on the working branch.

### 2.2 The twelve subsystems

Each subsystem below has a short description, the verified status table, the gaps an owner would feel most, and where it stands on Spanish. Its defects are gathered in §2.3. Statuses: **Live**; **Partial**; **Behind a flag** (built, switched off by default); **Built, dormant** (waits on an outside step); **Planned only**.

#### 2.2.1 Accounts, sign-in, roles and billing

There are exactly two roles: the agency admin, who sees every company, and a client user, who sees one. Every client user is invited as an admin, and client logins are a per-company switch the agency turns on. Client billing (M7a) is two of four steps in: plans, usage recording and a Stripe reporter are built, but nothing is charged.

| Capability | Status | Evidence |
|---|---|---|
| Sign in by email code or password on a platform-branded page | **Live** | `apps/web/src/app/(dashboard)/sign-in/[[...sign-in]]/page.tsx:227-238` |
| Sign in with Google | **Built, dormant** (no Google credentials on the production Clerk instance) | `docs/runbooks/clerk-setup.md:362-369` |
| Agency admin sees and manages every company | **Live** | `apps/web/src/lib/auth.ts:22-40` |
| Add a company (Clerk organisation, account row and optional blueprint in one step) | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts:21-123` |
| Companies list and searchable company switcher | **Live** | `apps/web/src/components/account-switcher.tsx:76-100` |
| Client login switch (off by default; off blocks every page and every database read) | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts:55-62` |
| Invite a client user by email | **Partial** (every invitee becomes a company admin; clients cannot invite or remove colleagues; removal happens only in Clerk's own screens) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts:104` |
| Automatic switch into a user's only company at first sign-in | **Live** | `apps/web/src/lib/auth/sole-organization.ts:1-52` |
| Staff roles, permissions and record assignment | **Planned only** (columns exist in the schema; nothing reads or writes them) | `packages/db/supabase/migrations/0003_crm_core.sql:12` |
| Pause, archive or offboard a company | **Partial** (status labels exist but nothing can set them; no deletion and no whole-account export) | `packages/db/supabase/migrations/0001_tenancy.sql:27` |
| Per-company stop on outbound sending | **Partial** (only scheduled sends honour it; no screen sets it) | `packages/db/supabase/migrations/0032_outbound_suppressed.sql:1-18` |
| Agency Plans page (monthly price, allowances, overage prices, two premium switches) | **Built, dormant** (no Stripe key on any deployment, so New plan and Edit are disabled; 0 plans) | `apps/web/src/app/(dashboard)/dashboard/plans/page.tsx:43-62` |
| Usage recording (call minutes, text segments, website chats) for every company | **Live** | `apps/web/src/lib/billing/usage.ts:1-39` |
| Usage reported to Stripe every 15 minutes | **Built, dormant** (no Stripe key and no billed company; since #146 a row Stripe already holds is marked reported) | `apps/web/src/lib/automations/passes/usage-report.ts:126-170` |
| Stale-usage banner on the agency work queue | **Built, dormant** (nothing is billed, so nothing can go stale) | `apps/web/src/components/usage-stale-banner.tsx:23-38` |
| Assign a plan, Stripe Checkout, webhooks, client Billing page, Customer Portal | **Planned only** (M7a PR-3; non-payment pause and reconciliation are PR-4) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:52-54` |
| Plans switching Sofía and the web chat on or off | **Planned only** (the flag is stored on a plan; no call or chat path reads it) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:39-40` |
| Self-serve sign-up; other agencies reselling BIS | **Planned only** (M7 #2 and #3) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:3-5` |

**Gaps an owner would feel:** no narrower login for a technician or receptionist, so every invited person can export every contact; every hire and departure goes through the agency; at most five logins per company, the agency's included; no plan, invoice date, or usage measured against a plan's allowances (the "312 of 500 minutes" view); a time zone that cannot be changed after creation.

**Bilingual today:** English only, including Clerk's sign-in screens and invitation emails; no language preference exists for a user or a company.

#### 2.2.2 Contacts, pipeline and the To do queue

A working, contact-centred CRM with one sales pipeline. Contacts have a server-paged list with a true total, a drawer with inline edits and undo, and a full record page with a timeline, tags, notes, tasks and custom fields. A To do queue gathers tasks, unread conversations and unclosed bookings in the company's own zone, and Sofía's call suggestions wait there for a person. Its weakness is breadth: no merge, filters, roles, documents, editable pipeline or change history.

| Capability | Status | Evidence |
|---|---|---|
| Contact list: 50 a page, cursor paging, true total, server-side sort | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.tsx:133-154` |
| List search | **Partial** (runs on Enter, not as you type; misses full names, business names, accents and differently typed phones) | `packages/db/src/contacts.ts:323-329` |
| Contact drawer with inline edits and undo | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx:54-234` |
| Full record: details, custom fields, tags, timeline, composer, deals | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx:19-101` |
| Activity timeline | **Partial** (no bookings; calls appear only as voice messages; dates in the server's zone) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.tsx:84-127` |
| Notes and tasks on a contact | **Partial** (no edit, delete, assignee or reminder; the note's author is not shown) | `packages/db/src/activities.ts:4-38` |
| Tags, including bulk add with undo | **Partial** (tags cannot be renamed or deleted, are not shown in the list and cannot be filtered on) | `packages/db/src/contacts.ts:484-510` |
| CSV import wizard (parsed in the browser; batches of 200; never blanks a field) | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/import-wizard.tsx:43-124` |
| CSV export of the current view | **Partial** (tags column always blank; no custom fields, notes or deals) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/route.ts:75-172` |
| Duplicate check on every new contact | **Partial** (on create only; conflicts are flagged but no screen lists or merges them) | `packages/db/src/contacts.ts:148-189` |
| Custom fields on contacts | **Partial** (agency-defined only; no edit or delete; absent from list, import, export and search) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts:24-35` |
| "No marketing emails" switch with an audit event | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/marketing-optout-switch.tsx:23-83` |
| Pipeline board with drag between stages | **Partial** (one fixed "Sales" pipeline with five English stages; no stage editing, deal delete, close date or link to the contact) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/pipeline/page.tsx:12-54` |
| Dashboard numbers: contacts, open deals, pipeline value, pipeline added in 7 days | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx:100-117` |
| To do queue in the company's zone, with Done and Not now | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.tsx:22-151` |
| Agency-wide work queue across companies | **Partial** (read-only; every action means opening the company) | `apps/web/src/app/(dashboard)/dashboard/work/page.tsx:26-67` |
| ⌘K palette: jump to pages and settings, live search of contacts, calls and conversations | See §2.2.9 | — |
| Contact merge, saved views and filters | **Planned only** (deferred in the 2026-09-09 and 2026-09-11 specs) | `docs/superpowers/specs/2026-09-11-contact-dedupe-hardening-design.md:3-5` |

**Gaps an owner would feel:** nowhere to keep a customer's documents, photos or files; duplicates flagged with nowhere to review or merge them; no filters, saved views or segments; "Garcia" does not find "García"; nobody can be assigned a lead, task or deal; a plumber and a day care get the same five-stage pipeline; a customer who asks to be deleted cannot be.

**Bilingual today:** English only; contacts carry no language although calls and form submissions already record one; search is accent-sensitive; import auto-matches only English headers (Spanish ones must be matched by hand); the default stage names are stored as English data.

#### 2.2.3 Messaging: inbox, email and texts

Every exchange with a person lands in one thread per contact. Email is live, with branded mail, delivery status and an agency-set sending domain. Texting is fully built but switched off: one gate refuses every text until a company's carrier registration is recorded as approved and it has a live number, and no company has cleared it. There is no inbound email, so customer replies never return to the thread.

| Capability | Status | Evidence |
|---|---|---|
| One thread per contact across forms, bookings, calls, texts and email | **Live** | `packages/db/supabase/migrations/0005_messaging.sql:4-25` |
| Conversations inbox with unread counts and a sidebar badge | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/page.tsx:26-56` |
| Reply from the inbox | **Partial** (email only; one-line body; no live refresh) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/page.tsx:70-75` |
| Note, email or text from the contact record | **Partial** (the Text tab is refused until A2P clears; one-line body) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.tsx:84-168` |
| Outbound email through Resend, saved before sending so a failure shows in the thread | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts:69-109` |
| Branded email shell with a composed plain-text part | **Live** | `apps/web/src/lib/email/templates/shell.ts:15-128` |
| Delivery status (Sent, Delivered, Opened, Bounced) | **Partial** (only emails sent from a thread carry it; spam complaints show as bounces) | `apps/web/src/app/api/webhooks/resend/route.ts:4-11` |
| Client reply-to address; agency-set sending domain with a test send | **Live** | `packages/db/src/sending-identity.ts:29-59` |
| Marketing email footer with postal address and reply-to-stop | **Live** | `apps/web/src/lib/email/templates/marketing-footer.ts:20-45` |
| "What went out": every automated send with its status and a plain reason | **Partial** (no message body and no delivery status) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity/page.tsx:21-60` |
| Quiet hours for automated sends | See §2.2.8 | — |
| Outbound texts (typed, automated, text-back) | **Built, dormant** (waits on A2P approval) | `apps/web/src/lib/sms/sender.ts:30-47` |
| Inbound texts into the thread | **Built; live state unknown** (it needs carrier-side set-up that no runbook covers, and customers have nothing to reply to until outbound texting clears A2P) | `apps/web/src/app/api/sms/inbound/route.ts:75-206` |
| English or Spanish opt-out line on every automated text | **Built, dormant** (waits on A2P) | `apps/web/src/lib/sms/opt-out.ts:22-68` |
| Owner alert texts for bookings and calls | **Built, dormant** (waits on A2P; the number's verification code is itself a text) | `apps/web/src/lib/sms/alerts.ts:58-114` |
| A2P registration record on the agency checklist | **Partial** (the record gates every text, and no account is recorded approved; IDs and status typed by hand; no carrier API, no status checks, no setup-wizard step) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/a2p-panel.tsx:25-194` |
| Inbound email, so replies return to the thread | **Planned only** (the study's "email that comes back") | `docs/research/2026-09-25-crm-feature-research.md:478-499` |
| Per-contact consent and revocation record for texts | **Planned only** (the study marks it blocking before 31 January 2027) | `docs/research/2026-09-25-crm-feature-research.md:170` |

**Gaps an owner would feel:** a customer's email reply never comes back into BIS; no company can text, and getting there takes a manual carrier registration of 3 to 7 business days plus fees; the inbox cannot send a text; automatic reminders and receipts do not appear in the thread; nobody can be assigned a thread, and unread is shared; a texted photo arrives as an empty bubble.

**Bilingual today:** the dashboard is English; customers get Spanish only on the lead receipt, the web booking confirmation, the missed-call text-back, the form instant reply and the opt-out line, and nobody has verified that Spanish stop words (PARAR, DETENER and the rest) are registered on the live carrier profile; the code's own comment says they work only once registered.

#### 2.2.4 Forms and lead intake

Forms are shipped and hardened. An operator builds a form from a fixed set of fields and shares it as a hosted link or a self-sizing embed that carries ad attribution. Every submission is written first and cannot be lost; it then creates or matches a contact, lands in Conversations, emails a lead alert and emails the submitter a receipt in English or Spanish. Two more doors feed the same pipeline, the BIS website's assistant and the web chat, and both depend on switches.

| Capability | Status | Evidence |
|---|---|---|
| Form builder (contact fields, custom fields, message, consent; required; reorder) | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/forms/[formId]/form-editor.tsx:24-144` |
| Publish, unpublish and archive | **Live** | `packages/db/src/forms.ts:122`; `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/forms/actions.ts:55-56` |
| Hosted page and self-sizing embed script | **Live** | `apps/web/src/lib/forms/embed-script.ts:10-82` |
| Company branding on the public page | **Live** | `apps/web/src/app/f/[publicId]/page.tsx:61-75` |
| Field types beyond text (dropdown, date, number, checkbox) | **Partial** (custom fields of these types render as plain text boxes) | `apps/web/src/app/f/[publicId]/public-form.tsx:224-228` |
| Consent box with its exact wording and time stored per submission | **Partial** (one consent box per form in the editor) | `apps/web/src/app/f/[publicId]/actions.ts:102-118` |
| Spam guards (hidden field, signed token, fill-time floor, rate limit, duplicate merge) | **Live** | `apps/web/src/lib/forms/guards.ts:3-94` |
| Submission saved first, then contact, thread message and events | **Live** | `apps/web/src/lib/forms/enrich.ts:33-204` |
| Lead alert email to the form's notify list | **Live** | `apps/web/src/lib/forms/enrich.ts:297-370` |
| Receipt email to the submitter in English or Spanish | **Live** | `apps/web/src/lib/email/templates/lead-receipt.ts:18-67` |
| Instant text reply to the submitter, in English or Spanish | **Built, dormant** (waits on A2P; an agency-only recipe, off by default once it clears) | `apps/web/src/lib/automations/instant-reply.ts:95-200` |
| Ad attribution (UTM tags, Google and Facebook click ids, page, referrer) | **Partial** (captured and stored; never shown anywhere) | `apps/web/src/lib/forms/enrich.ts:266-284` |
| Submissions list per form | **Partial** (unpaged; no search, export or delete; spam mixed with leads) | `packages/db/src/forms.ts:325-333` |
| Machine intake for the BIS website's assistant | **Behind a flag** (off unless the deployment enables it; production state not visible in the repository) | `apps/web/src/app/api/intake/[publicId]/route.ts:14-157` |
| Web chat files a captured lead into a chosen form | **Behind a flag** (agency-only switch per company, off by default) | `apps/web/src/lib/concierge/lead.ts:44-150` |
| File upload, signature, conditional logic, multi-step | **Planned only** (study proposals) | `docs/research/2026-09-25-crm-feature-research.md:314-319` |
| One form in two languages (Spanish twins for labels, help and success text) | **Planned only** (study proposal) | `docs/research/2026-09-25-crm-feature-research.md:356-357` |

**Gaps an owner would feel:** a bilingual business needs two forms and two embeds; no address, photo, file, signature or multi-step fields, so a landscaper cannot collect a job address and a day care cannot take an enrolment packet; web-form leads reach the owner by email only; submissions cannot be searched, exported or deleted; the owner cannot see which ad or page produced a lead.

**Bilingual today:** buttons, errors, the thank-you text, the receipt email and the instant text are English and Spanish; the operator's own labels, consent and success text are one language per form; the lead alert, the dashboard and the error and not-found pages are English.

#### 2.2.5 Booking and calendar

Each company has exactly one bookable calendar with one set of weekly hours, one appointment length, a buffer, a minimum notice and a horizon. A pure availability engine works in the company's zone and handles daylight-saving changes, and the database itself stops two bookings overlapping. Customers book on a branded page in English or Spanish, or by phone with Sofía. Staff calendars, services, holidays and Google or Outlook sync are not built.

| Capability | Status | Evidence |
|---|---|---|
| One calendar per company: weekly hours, length, buffer, notice, horizon | **Partial** (one open and close time per day; no holidays or time off; no staff or services) | `packages/db/supabase/migrations/0016_booking.sql:7-27` |
| Availability engine shared by the web page and Sofía | **Live** | `apps/web/src/lib/booking/slots.ts:146-273` |
| Double-booking refused by the database | **Live** | `packages/db/supabase/migrations/0016_booking.sql:60-64` |
| Branded public booking page in English or Spanish | **Behind a flag** (a per-company switch, off by default, that the agency or the client turns on) | `apps/web/src/app/b/[publicId]/page.tsx:95-159` |
| Step indicator on the booking page | **Partial** (the markup ships; its styling never landed) | `apps/web/src/app/b/[publicId]/booking-page.tsx:340-355` |
| Embed on the client's website | **Behind a flag** (the same per-company switch as the page; while it is off, the embed shows a not-found page) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/embed-snippet.tsx:12-29`; `apps/web/src/app/b/[publicId]/page.tsx:103-107` |
| Booking becomes a lead (contact, thread message, staff alert email) | **Live** | `apps/web/src/app/b/[publicId]/actions.ts:290-431` |
| Confirmation email with a cancel link | **Live** | `apps/web/src/lib/email/templates/booking.ts:126-167` |
| Customer cancels by link | **Partial** (no cancellation email to the customer; no way back to rebook) | `apps/web/src/app/b/[publicId]/cancel/[token]/actions.ts:111-201` |
| Reminder email about 24 hours ahead | **Partial** (always on; no switch; English only; skipped for bookings made under about 23 hours ahead) | `packages/db/src/booking.ts:601-612` |
| Next-morning follow-up email | **Behind a flag** (a calendar setting the owner or the agency switches on, off by default) | `apps/web/src/lib/booking/followup-timing.ts:48-86` |
| Upcoming bookings list with completed, no-show and cancel | **Partial** (upcoming only; no history, search or undo) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx:65-98` |
| Close out past bookings from To do | **Live** | `packages/db/src/work-queue.ts:96-110` |
| Sofía checks, books, finds, reschedules and cancels by phone | **Live** | `apps/web/src/lib/voice/tools/registry.ts:73-425` |
| Booking recipes (text reminder, confirm ask, no-show nudge, review and referral requests) | **Behind a flag** for the email legs (agency-only, off by default); **Built, dormant** for the text reminder, the confirm ask and every text leg (wait on A2P; off by default once it clears) | `packages/db/src/automations.ts:110-136` |
| Video room per booking (Daily.co) | **Built, dormant** (no `DAILY_API_KEY`) | `apps/web/src/lib/meetings/daily.ts:7-38` |
| Google or Outlook calendar sync; add-to-calendar file | **Planned only** (out of scope in the 2026-08-21 booking spec; proposed in the study) | `docs/superpowers/specs/2026-08-21-booking-design.md:263-270` |
| Meeting transcripts and AI notes | **Planned only** (blocked on a product decision) | `docs/superpowers/specs/2026-09-15-meeting-notes-design.md:4` |

**Gaps an owner would feel:** nobody can put a walk-in or a phoned-in job on the calendar from the dashboard; a customer cannot reschedule on the web; no closures, holidays or lunch breaks, so Sofía keeps offering those times; one appointment at a time, so three crews still take one job per slot; with no Google or Outlook sync, the owner's own calendar and BIS can double-book; the contact record shows no appointments.

**Bilingual today:** the public page, the cancel page and the web confirmation email are English and Spanish; the reminder, the follow-up, the reschedule email and every confirmation Sofía sends by phone are English only, because no language is stored on a booking.

#### 2.2.6 Sofía, the phone receptionist

Sofía answers a company's calls with OpenAI's realtime voice model, bridged over SIP from Telnyx, in English and Spanish, as the business's brand. She checks availability, books, reschedules and cancels, captures leads, takes messages and transfers to one number. At hangup, one pass classifies the call, writes a summary led by a fact line, files the contact and thread, emails staff, meters minutes and proposes up to three next steps that a person must accept. Cost, silence, robocall and daily caps guard spending. The owner cannot change what she says.

| Capability | Status | Evidence |
|---|---|---|
| AI answers inbound calls, bilingual, as the business's brand | **Live** | `apps/web/src/app/api/voice/incoming/route.ts:711-1045` |
| Voice profile (greetings, facts, services, language, booking, after-hours) | **Partial** (agency only; the owner cannot edit it) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/page.tsx:44` |
| Booking tools on the call | **Live** | `apps/web/src/lib/voice/tools/registry.ts:73-425` |
| Capture a lead; take a message | **Partial** (a left message and callback number are kept only in the transcript and summary, not as fields) | `apps/web/src/lib/voice/tools/registry.ts:104-122` |
| Staff summary with a fact line and a mismatch warning | **Live** | `apps/web/src/lib/voice/summarize.ts:25-163` |
| Contact, thread and staff alert email after booked, lead and message calls | **Live** | `apps/web/src/lib/voice/finish-call.ts:378-433` |
| Call suggestions (task, blank field, stage move) that a person accepts | **Live** | `apps/web/src/lib/proposals/generate.ts:193-560` |
| Cost cap, silence guard, robocall hang-up, daily caps, repeat-spam block | **Live** | `apps/web/src/app/api/voice/incoming/route.ts:340-349` (cost cap); `apps/web/src/lib/voice/silence-guard.ts:48-118`; `apps/web/src/lib/voice/recorded-message.ts:95`; `apps/web/src/lib/voice/call-limits.ts:10-53` (daily caps); `apps/web/src/lib/voice/caller-reputation.ts:119-133` |
| Transfer to a person | **Behind a flag** (off per company until the agency sets a number; a voicemail answering the transfer is detected and recorded, not acted on) | `apps/web/src/app/api/voice/texml/handoff/route.ts:168-318` |
| Staff alert text after a call | **Built, dormant** (waits on A2P) | `apps/web/src/lib/voice/finish-call.ts:459-469` |
| Missed-call text-back | **Built, dormant** (waits on A2P; an agency toggle, off by default once it clears) | `apps/web/src/lib/voice/textback.ts:155-291` |
| Calls list and call detail with transcript | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/page.tsx:23-236` |
| Topbar presence and dashboard calls chart | See §2.2.9 (both count robocalls and abandoned calls) | — |
| Numbers inventory: assign, move, release, carrier routing check | **Partial** (numbers are bought by hand in Telnyx; "release" does not release at the carrier) | `apps/web/src/app/(dashboard)/dashboard/numbers/actions.ts:56-157` |
| Screened calls page and "lines turning callers away" banner | **Live** | `apps/web/src/app/(dashboard)/dashboard/screened/page.tsx:37-155` |
| "Talk to Sofía" web demo on the BIS website | **Behind a flag** (environment-gated, single company, no tools; leaves no call row, transcript or lead, only one row per session for its cap; production state not visible) | `apps/web/src/app/api/voice/web/session/route.ts:55-247` |
| Call audio recording; outbound calling | **Planned only** (deferred in the 2026-08-24 V1 spec) | `docs/superpowers/specs/2026-08-24-voice-receptionist-core-design.md:221-225` |

**Gaps an owner would feel:** every change to the greeting, facts, prices, text-back or transfer number goes through the agency; there is no call audio, only a transcript kept forever; what the caller wanted and the callback number are buried in the summary; Sofía's changes to appointments are not yet stamped on the record as hers (F-022); business hours reach Sofía only as free text.

**Bilingual today:** callers are served in English or Spanish and Sofía switches with them, but the Spanish greeting, phone confirmation emails, the robocall guard and several fixed lines fall back to English, and every summary, alert and staff screen is English.

#### 2.2.7 The website assistant and website traffic

**The website assistant** is a text chat that a client pastes onto its own website as one script line. Visitors get short answers from the business's own facts, in English or Spanish, from the same persona that answers the phone, and a visitor who leaves a name and a way to reach them is filed as a lead. The code is complete and machine-tested, but it is off for every company by default, only the agency can switch it on, and no real client conversation is recorded. It never texts, never books and never hands off to a person.

| Capability | Status | Evidence |
|---|---|---|
| One-line embed: floating bubble, full screen on phones, launcher in the brand colour | **Behind a flag** (per-account switch, off by default) | `apps/web/src/lib/forms/embed-script.ts:86-247` |
| Branded chat page and a shareable direct link | **Behind a flag** | `apps/web/src/app/c/[publicId]/page.tsx:130-159` |
| Answers built from the greeting, facts, services, after-hours note and time zone | **Behind a flag** | `apps/web/src/app/api/concierge/[publicId]/turn/route.ts:347-371` |
| Replies in the visitor's language on a bilingual profile | **Behind a flag** | `apps/web/src/lib/voice/system-prompt.ts:67-78` |
| Lead capture into the CRM through the chosen form (contact, thread, alert, receipt) | **Partial** (only the first capture in a chat is filed; the assistant never learns whether it worked) | `apps/web/src/app/api/concierge/[publicId]/turn/route.ts:442-472` |
| Agency on/off switch with undo, locked until a greeting and a published form exist | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/voice-settings.tsx:268-278` |
| Warnings while live: blank greeting, unpublished destination form | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/voice-settings.tsx:564-580` |
| Setup wizard step "Website assistant", with the snippet and proof of first use | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/steps/website-assistant.tsx:95-173` |
| Cost and abuse caps: per visitor, per client per day, turns, reply length, timeout | **Live** | `apps/web/src/lib/concierge/guards.ts:14-43` |
| "Website chats" count on What went out | **Partial** (counts chats started; billing counts chats answered) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity/usage-card.tsx:21` |
| One billable unit per answered chat | **Partial** (recorded live, as §2.2.1's usage row says; nothing reaches Stripe) | `apps/web/src/app/api/concierge/[publicId]/turn/route.ts:536-549` |
| Plan switch "includes the website chat" | **Built, dormant** (stored and shown on Plans; nothing reads it) | `packages/db/supabase/migrations/0051_billing_core.sql:73-76` |
| Full transcript of every chat | **Built, dormant** (saved; no screen, email or export reads it) | `packages/db/supabase/migrations/0042_web_concierge.sql:52-78` |
| Chats in the Conversations inbox | **Planned only** (the channel is reserved; study proposal) | `packages/db/supabase/migrations/0006_forms.sql:92` |
| Booking from the chat | **Planned only** (excluded from v1) | `docs/superpowers/specs/2026-09-20-web-concierge-design.md:591-593` |
| Answers from documents larger than one facts block | **Planned only** (deferred knowledge base) | `docs/superpowers/specs/2026-09-20-web-concierge-design.md:587-590` |

**Website traffic.** The agency links a client account to the Vercel project hosting the website BIS built. Each night after 03:00 in the account's zone a pass pulls Vercel Web Analytics, and the owner sees a Website page: a plain-words sentence, a busiest-day line, four tiles, a daily chart and panels for pages, sources and devices. It is live on one real site, BIS's own, since 2026-09-08.

| Capability | Status | Evidence |
|---|---|---|
| Link a client's Vercel site: pick the project, test the connection, save | **Live** (agency only) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/actions.ts:40-72` |
| Refuse a project linked elsewhere, or a change of project once data is stored | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/actions.ts:49-67` |
| Unlink, deleting every stored day | **Live** | `packages/db/src/sites.ts:126-136` |
| Nightly pull after 03:00 local, with up to 30 days of backfill | **Live** (one real site) | `apps/web/src/lib/automations/passes/site-traffic.ts:24-64` |
| Website sentence and busiest-day line | **Live** | `apps/web/src/lib/website/sentence.ts:28-74` |
| Four tiles: Visitors, Pageviews, From Google, Top page | **Partial** (the Google share and top page rest on mismatched time windows) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/website-section.tsx:63-78` |
| Visitors-by-day chart with muted weekends and a tooltip on every bar | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/daily-chart.tsx:21-113` |
| Pages, sources and devices panels | **Partial** (top 20 per day only; same window defect) | `apps/web/src/lib/website/view-model.ts:54-67` |
| 7, 14 and 30-day periods, each against the period before | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/page.tsx:16-40` |
| Designed unlinked, waiting, loading and stale states; "Ask BIS about a website" | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/page.tsx:58-100` |
| Visitors line in the weekly report | **Live** (left out when no site is linked) | `apps/web/src/lib/reports/weekly-metrics.ts:66-71` |
| "Where they were" places panel | **Built, dormant** (Vercel groups by country only; countries are stored, not shown) | `apps/web/src/lib/vercel/web-analytics.ts:15-18` |
| Leads the site produced | **Planned only** | `docs/superpowers/specs/2026-09-07-website-traffic-design.md:16-18` |
| Google search performance (Search Console) | **Planned only** | `docs/superpowers/specs/2026-09-07-website-traffic-design.md:19-22` |
| Prospect speed audit (PageSpeed) | **Planned only** | `docs/superpowers/specs/2026-09-07-website-traffic-design.md:23-24` |

**Gaps an owner would feel:** the owner cannot read what a visitor asked or what the assistant said; chats never reach Conversations; a visitor who wants an appointment is told the team will set it up; only websites BIS built and hosts are measured, so a client on Wix, Squarespace or WordPress sees nothing; visitors are never connected to the leads they became.

**Bilingual today:** the chat's buttons, greeting, replies and the visitor's receipt are bilingual, but Spanish is chosen only by an attribute the copied snippet never includes; the Website page, its sentence and its report line are English, with numbers and dates pinned to `en-US`.

#### 2.2.8 Automations, "What went out" and the weekly report

One cron runs every 15 minutes and works through 14 passes in a fixed order, each isolated from the others. The catalogue is eight fixed recipes, deliberately not a rule builder, plus an always-on email reminder and an optional follow-up email. Only the agency configures recipes, every recipe starts switched off, and a send due inside quiet hours is held, not dropped. "What went out" shows every automated send with a dot-and-word status and its reason, and every Monday a client with recipients gets four numbers with the changes stated in words.

| Capability | Status | Evidence |
|---|---|---|
| 15-minute scheduler running 14 passes, one failure isolated from the rest | **Live** | `apps/web/src/lib/automations/registry.ts:50` |
| Email reminder about 24 hours before a booking | See §2.2.5 | — |
| Morning-after follow-up email | **Behind a flag** (per-calendar switch, off by default) | `apps/web/src/lib/automations/passes/followups.ts:12-26` |
| Review request after "Mark completed" | **Behind a flag** (off by default; its text channel waits on A2P) | `apps/web/src/lib/automations/passes/review-request.ts:26-48` |
| Referral ask, the rung after the review request | **Behind a flag** (as above) | `apps/web/src/lib/automations/passes/referral-ask.ts:47-68` |
| No-show nudge after "Mark no-show" | **Behind a flag** (as above) | `apps/web/src/lib/automations/passes/no-show-nudge.ts:33` |
| Quote follow-up on a quiet deal | **Behind a flag** (off by default; fires only on deals made by hand on the board) | `apps/web/src/lib/automations/passes/quote-followup.ts:41-58` |
| Reactivation email to a past customer quiet longer than a set 6 to 18 months (default 9) | **Behind a flag** (email only; 5 a day; once per customer) | `apps/web/src/lib/automations/passes/reactivation.ts:19-58` |
| Text reminder about two hours before | **Built, dormant** (waits on A2P; an agency-only recipe, off by default once it clears) | `apps/web/src/lib/automations/passes/sms-reminder.ts:16-66` |
| Confirmation ask two days out, with a YES or NO reply recorded on the booking | **Built, dormant** (waits on A2P; an agency-only recipe, off by default once it clears) | `apps/web/src/lib/automations/passes/appointment-confirm.ts:29-61` |
| Instant text reply to a new web lead | See §2.2.4 | — |
| Quiet hours per account (default 21:00 to 08:00, company zone); held sends go at the window's end | **Live** (agency edits; clients cannot see the window) | `apps/web/src/lib/automations/quiet-hours.ts:1-40`; `apps/web/src/lib/automations/hold-or-send.ts:169-217` |
| Caps: 10 per pass per tick, 25 per recipe per account per day | **Live** (fixed platform constants; the confirmation ask is uncapped by design, and reactivation is capped at 5 a day) | `apps/web/src/lib/automations/caps.ts:19-33` |
| Editable message per recipe, with a text preview and segment count | **Live** (agency only) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/automations-settings.tsx:75-76` |
| Per-contact "No marketing emails" switch | See §2.2.2 | — |
| Usage report to Stripe meters | See §2.2.1 | — |
| Pause sends when a client stops paying | **Planned only** (M7a PR-4; the column exists and nothing reads it) | `packages/db/supabase/migrations/0051_billing_core.sql:164` |
| Rule builder and multi-step sequences | **Planned only** (deferred by decision) | `docs/superpowers/specs/2026-09-06-automations-design.md:12-21` |
| "This month" card: texts, emails, website chats and calls, each with its cap | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity/usage-card.tsx:17-53` |
| History of every send, hold, skip and failure, with its reason | **Partial** (no filter, search, export, total or link to the contact) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity/activity-table.tsx:18-58` |
| Older and Newer paging, 25 rows a page | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity/page.tsx:52-70` |
| Call and chat rows, with robocalls shown as skipped | **Live** | `apps/web/src/lib/voice/finish-call.ts:579-595` |
| Weekly client report: calls answered, leads, bookings and website visitors, with changes in words | **Behind a flag** (the recipients list is the switch) | `apps/web/src/lib/automations/passes/weekly-report.ts:30-163` |
| Quiet-week version that still sends | **Behind a flag** | `apps/web/src/lib/email/templates/weekly-report.ts:54-77` |
| Recipients typed in by the agency on Settings | **Live** (agency only) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/weekly-report-card.tsx:30-67` |
| Each sent report shown in the client's own history | **Live** | `apps/web/src/lib/automations/passes/weekly-report.ts:144-154` |
| Agency roll-up across every account, flagging accounts nobody receives | **Behind a flag** (sends once an address is set by hand in the database) | `apps/web/src/lib/automations/passes/weekly-agency-report.ts:44-139` |
| The palette words "activity", "held" and "quiet hours" open the page | **Live** | `apps/web/src/lib/palette/registry.ts:55` |
| Owner's plan and usage view ("312 of 500 minutes") | **Planned only** (M7a PR-3 Billing page) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:94` |

**Gaps an owner would feel:** no automated text reaches any customer, so the three recipes that most cut no-shows do nothing; every scheduled message is English; the owner cannot see or change Automations, preview an email or send a test; messages cannot use the customer's first name; automated emails do not appear on the contact's timeline; the report carries four numbers only, and only the agency can add a recipient.

**Bilingual today:** only the dormant instant reply has Spanish bodies, so every scheduled recipe and reminder a customer can receive today is English (the lead receipt and the web booking confirmation, sent automatically but not recipes, have Spanish; §2.2.3); the page, its stored reasons and both report emails are English.

#### 2.2.9 Branding, the app shell and the design system

Each account stores a customer-facing brand name, a logo, a colour and four closed-set theme choices. A pure function derives a full token set and lifts any colour until it meets WCAG AA. The result reaches the client's workspace, the four public pages and every email, and both the agency and the client can edit it; as of 2026-09-11 no logo had been uploaded. The signed-in shell is a grouped sidebar filtered by role and a topbar with the ⌘K palette, Sofía's presence line and a theme toggle; the Northern Lights tokens are pinned by parity tests.

| Capability | Status | Evidence |
|---|---|---|
| Customer-facing brand name, separate from the agency's private label | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts:47-50` |
| Logo upload: PNG, JPEG or WebP up to 512 KB, type read from the bytes | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts:112-137` |
| Brand colour, lifted for contrast and never rejected | **Live** | `apps/web/src/lib/branding/theme.ts:302-311` |
| Surfaces, corners, typeface and default mode | **Live** | `apps/web/src/components/branding-panel.tsx:271-320` |
| The client's own Branding page | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/page.tsx:40-114` |
| Themed client workspace, browser-tab title and icon | **Partial** (a colour alone recolours only the sidebar; borders and greys stay BIS) | `apps/web/src/app/(dashboard)/layout.tsx:102-136` |
| Branded public pages: form, booking, cancel and chat | **Live** | `apps/web/src/lib/branding/public-form-theme.ts:234-334` |
| Branded emails: logo, name and a button in the lifted colour | **Live** | `apps/web/src/lib/email/templates/shell.ts:56-128` |
| Reply-to address and postal address | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts:67-93` |
| Sending address on the client's own domain | **Live** (the agency sets up DNS by hand) | `packages/db/supabase/migrations/0015_from_email.sql:10` |
| Live preview | **Partial** (workspace specimen only; no form, booking page or email preview) | `apps/web/src/components/branding-panel.tsx:322-428` |
| "Powered by BIS" footer on booking, cancel and chat | **Live** (cannot be turned off) | `apps/web/src/lib/booking/public-strings.ts:66` |
| Custom domain per client | **Planned only** (M6 in the platform spec) | `docs/superpowers/specs/2026-07-25-bis-platform-design.md:136` |
| Other agencies reselling BIS under their own brand | **Planned only** (M7 #3; no spec) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:3-5` |
| Grouped sidebar by role, collapsible, with a pinned footer | **Live** | `apps/web/src/lib/nav-groups.ts:94-176` |
| Agency top-level nav and company switcher | **Live** | `apps/web/src/components/account-switcher.tsx:21-106` |
| Unread badge on Conversations | **Live** (refreshes only on navigation) | `apps/web/src/components/app-sidebar.tsx:393-450` |
| Topbar presence: "Sofía · on a call" or "N calls handled this week" | **Partial** (the week's count includes robocalls and abandoned calls, as the dashboard row below does; §2.3) | `apps/web/src/components/topbar-presence.tsx:21-56`; `apps/web/src/lib/voice/presence.ts:24-46` |
| Command palette: pages, Setup, settings sections and record search | **Partial** (searches contacts, calls and conversations only; three settings cards unregistered) | `apps/web/src/lib/palette/registry.ts:36-42` |
| Account dashboard: Calls answered (hero), Appointments, Pipeline added, After-hours | **Partial** (the hero, the 14-day calls chart and the After-hours tile count robocalls and abandoned calls, which the weekly report excludes; §2.3) | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx:272-326` |
| Agency home | **Partial** (four all-time totals; no per-client health or trend) | `apps/web/src/app/(dashboard)/dashboard/page.tsx:10-58` |
| Light and dark toggle, with a company default mode | **Live** | `apps/web/src/components/theme-toggle.tsx:26-43` |
| Northern Lights tokens, glass surfaces and lit ground, pinned by parity tests | **Live** | `apps/web/src/styles/tokens.css` |
| Shared component library (restyled Radix and shadcn primitives plus app components) | **Live** | `apps/web/src/components/ui/button.tsx` |
| Styleguide at `/dashboard/styleguide` | **Partial** (about 20 sections; dialogs, sheets, selects, tabs and the sidebar absent; BIS colours only) | `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx:91-553` |
| Error and not-found screens | **Partial** (error screens on the dashboard, booking and form pages; none on the chat; not-found on the dashboard only) | `apps/web/src/app/(dashboard)/dashboard/error.tsx` |
| Loading skeletons | **Partial** (5 of 28 dashboard pages) | `apps/web/src/app/(dashboard)/dashboard/work/loading.tsx` |
| Phone layout for the signed-in app | **Planned only** (study proposal: an installable web app first, decision 10) | `docs/research/2026-09-25-crm-feature-research.md:1373-1375` |
| Spanish dashboard and a language per user | **Planned only** (the catalogue is single-locale today, keyed so that Spanish is a translation file later) | `docs/superpowers/specs/2026-07-26-bis-platform-ui-overhaul-design.md:184-189` |
| Screens that adapt to the client's plan | **Planned only** (M7a) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:39-40` |

**Gaps an owner would feel:** no phone layout, so a 236 px sidebar sits on a 375 px screen; every screen is English; the dashboard centres on the phone, so a CRM-only plan's headline number would always be 0; the 7-day KPI tiles never say which days they cover (§2.3); customers still see "Powered by BIS", and there are no custom domains; the agency's home shows no client that is quiet, failing or over its allowance.

**Bilingual today:** every signed-in screen, formatter and Clerk widget is English; public pages switch to Spanish through their own string modules, but public tab titles stay English, and only the lead receipt and booking confirmation emails have Spanish.

#### 2.2.10 Setup, the activation checklist and blueprints

Onboarding is something the agency does to a client. Add company creates a Clerk organisation and an account, can apply a blueprint, and lands on a ten-step setup wizard derived from live data. Beside it sit an eight-item activation checklist, whose A2P record gates every outbound text, and blueprints captured from an existing account. All of it is built around Sofía, so a client who buys only the CRM can never finish setup.

| Capability | Status | Evidence |
|---|---|---|
| Add a client company, rolled back cleanly if a step fails | **Live** (agency only) | `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts:21-124` |
| Warning for Clerk organisations with no company behind them | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/page.tsx:65-96` |
| Ten-step wizard derived from live data, opening on the next step | **Live** | `apps/web/src/lib/setup/setup-status.ts:81-131` |
| Locked steps that name their blockers; "Couldn't check" on a failed read | **Live** | `apps/web/src/lib/setup/setup-rail.ts:39-91` |
| Go live: switch Sofía on and mark the number live after a server re-check | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.ts:120-182` |
| Move a number from another client; enable test calls | **Live** | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/setup-move-number-button.tsx:44-168` |
| Buy a phone number inside BIS | **Planned only** (deferred; numbers are bought in the Telnyx portal) | `docs/superpowers/specs/2026-08-27-onboarding-wizard-calls-design.md:15-17` |
| Activation checklist: eight items plus custom items | **Partial** (every item a manual tick except A2P; notes never saved; no dates or owners) | `apps/web/src/lib/checklist-catalogue.ts:14-46` |
| A2P registration record | See §2.2.3 | — |
| Save as blueprint: pipelines, fields, tags, custom-value keys and forms | **Live** | `packages/db/src/blueprints.ts:124-248` |
| Apply a blueprint when creating a company | **Live** (at creation only) | `packages/db/src/blueprints.ts:304-446` |
| Apply or re-apply a blueprint to an existing company | **Planned only** (the function exists; only creation calls it) | `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts:105` |
| Push blueprint updates to live clients | **Planned only** (deferred) | `packages/db/supabase/migrations/0007_blueprints.sql:50-53` |
| Industry packs and "describe your business" onboarding | **Planned only** (study proposal) | `docs/research/2026-09-25-crm-feature-research.md:106-115` |
| Turn away out-of-scope trades at onboarding and hold HIPAA verticals | **Planned only** (study proposal) | `docs/research/2026-09-25-crm-feature-research.md:1132-1135` |

**Gaps an owner would feel:** a CRM-only client can never finish setup, and texting needs a Sofía profile; nothing is captured at creation beyond a name and a time zone, so nothing can turn away an out-of-scope trade; the owner has no onboarding of their own; blueprints cannot be viewed, edited or re-applied; numbers are bought, and call forwarding confirmed, by hand outside BIS.

**Bilingual today:** English only; no language is recorded for the account or its owner, and a bilingual voice profile counts as done with only the English greeting.

#### 2.2.11 Platform quality and operations

Every push runs `verify` (typecheck, lint, unit and database tests, build) and then `e2e` (Playwright on a production build) against a separate CI database, and a server-side ruleset makes both required for `main`. CI and local runs refuse to touch production. Merging to `main` deploys to Vercel. The gates are strong; operations are thin.

| Capability | Status | Evidence |
|---|---|---|
| `verify` on every push | **Live** | `.github/workflows/ci.yml:86-163` |
| `e2e` against a production build | **Partial** (desktop Chrome only; no phone, Safari or accessibility scan) | `apps/web/playwright.config.ts:158-163` |
| Required checks and squash-only merges on `main` | **Live** (no human review required) | `CLAUDE.md:14-28` |
| Separate CI database; CI and local runs refuse production | **Live** | `packages/db/src/test/refuse-production.ts:35-67` |
| Tenant-isolation and grant-pinning tests | **Live** | `packages/db/src/test/rls.test.ts:21-270` |
| Deploy on merge to `main` | **Live** | `CLAUDE.md:13`; `.claude/agents/bis-platform.md:33` |
| Post-deploy checks | **Partial** (a written checklist; nothing automated) | `.claude/agents/bis-platform.md:34` |
| One cron, 14 passes, each failure isolated | **Live** | `apps/web/src/app/api/cron/reminders/route.ts:39-68` |
| Rate limits and bot guards on public forms, booking and chat | **Partial** | `apps/web/src/lib/forms/guards.ts:9-19` |
| Fake email and texts outside production; per-account send switch | **Partial** (the fakes are live; the send switch binds only scheduled sends, §2.2.1) | `apps/web/src/lib/email/index.ts:20-44` |
| Audit log of business events | **Partial** (event-level only; no before-and-after values) | `packages/db/src/events.ts:14-21` |
| Banner for phone numbers turning callers away | **Live** (on page load only; nobody is notified) | `apps/web/src/components/line-down-banner.tsx:5-45` |
| Error boundaries | See §2.2.9 (error and not-found screens) | — |
| Five owner runbooks: CI database, Clerk, voice, website, A2P | **Live** (several statements stale) | `docs/runbooks/voice-setup.md` |
| Environment variable contract | **Partial** (the cron secret and two others undocumented) | `.env.example` |
| Demo seeder and screenshot workflows | **Live** (manual; they write the production database) | `.github/workflows/seed-demo.yml:10-20` |
| Stripe webhook sync | **Planned only** (M7a PR-3) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:58` |

**Gaps an owner would feel:** if reminders or the phone line break at 2 a.m., nobody at BIS is told and the client finds out first; there is no documented backup or restore; a business that leaves can take only its contacts; no automated test covers a phone call, a real text or a webhook; owners on iPhones get no Safari or phone-sized test run.

**Bilingual today:** platform surfaces are English: the booking and form error pages are hard-coded English, a stale public link shows Next's unbranded English "404", and no end-to-end test renders a Spanish public page.

#### 2.2.12 Roadmap, specs and decisions

The repository holds 44 specs, 51 plans and 13 research documents. M0 has shipped; M1 and M2 are built, with texting dormant until A2P and the public booking page off per company until switched on; M3, M4, M5 and M7 are partial; M6 has not started. The platform spec's §8a tracker is stale on billing and on the web chat. The study lists 18 decisions only the owner can make; decisions 1 and 2 gate its first release, and decision 5 is half-made.

| Capability | Status | Evidence |
|---|---|---|
| M0 Foundation: tenancy, row-level security, audit log | **Live** | `packages/db/supabase/migrations/0001_tenancy.sql:15-58` |
| M1 CRM, email, forms and embeds, blueprints, texting and text-back | **Partial** (texting and text-back built, dormant until A2P) | `docs/superpowers/specs/2026-07-25-bis-platform-design.md:165` |
| M2 Booking: one calendar per company, page, embed, reminders | **Partial** (phone booking and the 24-hour reminder run on every account with Sofía; only the public page and its embed sit behind a per-company switch, off by default, that the agency or the client turns on) | `packages/db/supabase/migrations/0016_booking.sql:13-14`; `apps/web/src/app/api/voice/incoming/route.ts:890`; `packages/db/src/booking.ts:660-663` |
| M3 Automation engine | **Partial** (eight fixed recipes; rule builder deferred by decision) | `packages/db/src/automations.ts:15-17` |
| M4 AI: Sofía, call proposals, web concierge | **Partial** (knowledge base deferred; concierge off by default) | `docs/superpowers/specs/2026-07-25-bis-platform-design.md:168` |
| M5 Reviews | **Partial** (a review-request recipe only; no Google Business Profile monitoring or AI replies) | `docs/superpowers/specs/2026-07-25-bis-platform-design.md:169` |
| M6 Hosted landing pages | **Planned only** (not started) | `docs/superpowers/specs/2026-07-25-bis-platform-design.md:170` |
| M7a Client billing | **Partial** (Plans page and usage recording shipped, #146 included; checkout, webhooks, Billing pages and the non-payment pause not started) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:82-84` |
| Plan features switched on per account | **Planned only** (`accounts.permissions` is never read or written) | `packages/db/supabase/migrations/0001_tenancy.sql:28` |
| Self-serve sign-up; other agencies reselling BIS | **Planned only** (no spec) | `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:3-5` |
| Meeting transcripts and AI notes | **Planned only** (blocked on the owner's "meetings inside BIS?" decision) | `docs/superpowers/specs/2026-09-15-meeting-notes-design.md:4` |
| Google Calendar, Gmail, Drive, Contacts and Business Profile | **Planned only** (study proposal) | `docs/research/2026-09-25-crm-feature-research.md:441-575` |
| Microsoft 365: Outlook calendar, Teams links, mail, OneDrive | **Planned only** (study proposal) | `docs/research/2026-09-25-crm-feature-research.md:465-470` |
| Documents, e-signature, quotes, invoices and payments | **Planned only** (platform non-goals until the owner reverses them, study decision 1) | `docs/superpowers/specs/2026-07-25-bis-platform-design.md:180-185` |
| CRM study foundation: staff and roles, client record, consent ledger, bilingual messages, AI on the record, portal, MCP, industry packs | **Planned only** (147–207 ew in all; first release 27–36 ew) | `docs/research/2026-09-25-crm-feature-research.md:1206-1262` |
| Roadmap tracker, platform spec §8a | **Partial** (stale on M7 and M4; counts 40 specs, not 44) | `docs/superpowers/specs/2026-07-25-bis-platform-design.md:156-188` |

**Gaps an owner would feel:** the written tracker says things that are no longer true; nothing in the product yet answers the owner's first asks (every document in one place, Google or Outlook sync, taking a payment); DESIGN.md still describes a branded booking card that design phase 7 decided not to build; health details that callers mention reach the AI provider with no zero-retention agreement (study decision 6).

**Bilingual today:** a contact language field, bilingual twins for every message, the Spanish dashboard and AI output in the reader's language are all study proposals; four of six local competitors already claim Spanish.

### 2.3 Defects to fix now

The inventories and this plan's reviews list **105 distinct defects** across fifteen areas. Each is listed once; where one fix reaches a second area, its row says so. Most take hours, not weeks; the plan allows half a day to a day for each, with tests ("½–1 d" below, 0.1–0.2 ew). Where a feature's slice carries the fix, the cell names it and the defect costs nothing more. Each group's heading gives its effort: its ½–1 d rows at that rate, plus the slices it names (§4.2).

| Defect | Where | Effort |
|---|---|---|
| **Accounts, sign-in and billing: 5 defects, 0.4–0.8 ew** | | |
| A client whose access is switched off is told to open their invitation link instead of "access has been turned off" | `apps/web/src/app/(dashboard)/page.tsx:16-42`; `apps/web/src/lib/messages.ts:79` | ½–1 d |
| The Client access card has two primary buttons (rule 8); the switch shows no On/Off state, and turning access off has no undo | `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/client-access-panel.tsx:56-59` | ½–1 d |
| The agency home's open-deal count and pipeline value undercount silently above 1,000 open deals | `apps/web/src/app/(dashboard)/dashboard/page.tsx:20-22` | F-055 slice |
| Owner alert texts and verification codes go out on the company's number but are never metered | `apps/web/src/lib/sms/alerts.ts:180-190` | ½–1 d |
| A company renamed in BIS keeps its original name in Clerk's invitation emails | `packages/db/src/accounts.ts:78-86` | ½–1 d |
| **Contacts, pipeline and To do: 9 defects, 2.6–3.2 ew with the F-001 and F-055 slices** | | |
| A task due date picked on a contact shows one day early on To do (saved as UTC midnight, shown in the company's zone) | `.../contacts/[contactId]/actions.ts:67-69`; `.../tasks/work-list.tsx:147-157` | ½–1 d |
| Undo after a bulk tag removes the tag from every selected contact, including those that already had it | `.../contacts/bulk-action-bar.tsx:34-53`; `packages/db/src/contacts.ts:502-510` | ½–1 d |
| The CSV export always leaves the tags column blank | `.../contacts/export/route.ts:127-130` | ½–1 d |
| Search deletes `_ ( ) ,` from the term, so "john_doe" or "(956) 555-0199" never match; submitting a search drops the chosen sort | `packages/db/src/search-term.ts:26`; `.../contacts/page.tsx:181-188` | ½–1 d |
| Timeline times and the list's "Created" date render in the server's or browser's zone, not the company's | `.../contacts/[contactId]/activity-timeline.tsx:286`; `.../contacts/contacts-table.tsx:242` | F-001 slice |
| The board's total counts won and lost deals while the dashboard's "Pipeline value" counts open deals only | `packages/db/src/opportunities.ts:108-126`; `.../pipeline/page.tsx:25` | F-055 slice |
| Editing a contact's email or phone to one another contact holds creates a silent duplicate | `packages/db/src/contacts.ts:191-202` | ½–1 d |
| Add contact saves an all-blank contact, checks no email or phone shape, and closes silently on an existing person | `.../contacts/actions.ts:12-20` | ½–1 d |
| The timeline prints the raw status ("failed", "sent") instead of its label | `.../contacts/[contactId]/activity-timeline.tsx:290` | F-001 slice |
| **Messaging: 7 defects, 0.7–1.4 ew** | | |
| Email and text bodies are one-line inputs, so no message can contain a paragraph break | `.../conversations/email-composer.tsx:45-50`; `.../contacts/[contactId]/message-composer.tsx:139-150` | ½–1 d |
| Spam complaints are recorded as bounces, and nothing stops later mail to an address that bounced or complained | `apps/web/src/app/api/webhooks/resend/route.ts:9` | ½–1 d |
| The stored failure reason is never shown in the thread or on the timeline | `.../conversations/message-thread.tsx:27-68` | ½–1 d |
| Once texting is on, an inbound text that meets a database error is acknowledged to the carrier and lost | `apps/web/src/app/api/sms/inbound/route.ts:246-265` | ½–1 d |
| The inbox list is unpaged, and its previews read at most 1,000 messages | `packages/db/src/messaging.ts:529-559` | ½–1 d |
| Stale copy: the empty inbox says threads start only from email | `apps/web/src/lib/messages.ts:647` | ½–1 d |
| On a phone, a selected thread renders below the whole list, with no way back | `.../conversations/page.tsx:55` | ½–1 d |
| **Forms and lead intake: 7 defects, 0.8–1.1 ew with the F-047 slice** | | |
| Email addresses containing `_` or `%` are rejected on every public form, the booking page, the web chat (so a chat lead can be filed with no email) and Sofía's video booking | `apps/web/src/lib/forms/guards.ts:166` | F-047 slice |
| The seeded "Name" field is the first-name field, so a full name lands in first name | `.../forms/actions.ts:24` | F-047 slice |
| A mistyped notify address or redirect URL fails the save with only "Could not save the form." | `.../forms/[formId]/form-editor.tsx:46-49` | ½–1 d |
| A draft, archived or unknown form shows the framework's English "page could not be found" box inside the client's embed | `apps/web/src/app/f/[publicId]/page.tsx:98` | F-102 layout |
| A lead filed through the machine intake (the BIS website's own assistant, not the client web chat, which always withholds the text) on a form with no consent box qualifies for the automatic text, contrary to the route's own contract | `apps/web/src/app/api/intake/[publicId]/route.ts:33-37, 146-148`; `apps/web/src/lib/concierge/lead.ts:131-137` | ½–1 d |
| The checklist's "form has no notify address" count includes drafts and archived forms | `packages/db/src/forms.ts:340-348` | ½–1 d |
| The public page's browser tab title is always the English word "Form" | `apps/web/src/app/f/layout.tsx:27` | F-102 layout |
| **Booking and calendar: 9 defects, 0.6–1.2 ew** | | |
| Any buffer removes the whole next slot: with 60-minute jobs and a 15-minute buffer, a 9:00 booking also blocks 10:00 | `apps/web/src/lib/booking/slots.ts:217-251` | ½–1 d |
| A booking made less than about 23 hours ahead never gets a reminder | `packages/db/src/booking.ts:391-392`; `packages/db/src/booking.ts:601-612` | F-049 (first release) |
| "Completed" and "no-show" buttons appear only on appointments that have not started | `packages/db/src/booking.ts:324-331`; `.../calendar/bookings-list.tsx:75-95` | ½–1 d |
| A returning web booker's new details, such as a first phone number, are dropped | `packages/db/src/contacts.ts:181`; `apps/web/src/app/b/[publicId]/actions.ts:290-298` | ½–1 d |
| The step indicator has no styles and renders as a plain numbered list | `apps/web/src/app/b/[publicId]/booking-page.tsx:340-355` | ½–1 d |
| The success screen says a confirmation was sent even when the email failed | `apps/web/src/app/b/[publicId]/actions.ts:436-445` | ½–1 d |
| Notify addresses are not validated and split on new lines only; the hint promises an alert that does not exist | `.../calendar/actions.ts:60-61`; `apps/web/src/lib/messages.ts:897` | ½–1 d |
| Each Sofía reschedule counts as a new booking on the dashboard and in the weekly report | `apps/web/src/lib/voice/tools/registry.ts:323-332`; `packages/db/src/booking.ts:344-360` | F-048 (rider: a true reschedule) |
| Cancel on the Calendar page is irreversible, with neither a typed confirmation nor an undo (rule 6) | `.../calendar/bookings-list.tsx:93-95` | F-048 (rider: Cancel's dialog composes the customer notice; the cancellation then runs at once with an undo, and the notice sends only when the undo closes, so rule 6's reversible branch applies; proposal) |
| **Sofía, the phone receptionist: 10 defects, 0.8–1.6 ew** | | |
| A bilingual profile's Spanish greeting is never used, and a blank greeting falls back to English on a Spanish-only profile | `apps/web/src/app/api/voice/incoming/route.ts:964-967` | ½–1 d |
| The confirmation email from a phone booking is always English, and the reschedule email has no Spanish version | `apps/web/src/lib/voice/tools/registry.ts:261-268` | S-09 (first release) |
| A 10-digit number spoken by a caller is always stored as a US number, so a Mexican callback number is stored wrong | `apps/web/src/lib/voice/phone-number.ts:6` | F-009 (legal chain, step 1) |
| "Always take a message" tells Sofía to take a message only if the business is closed right now | `apps/web/src/lib/voice/system-prompt.ts:200-207`; `apps/web/src/lib/messages.ts:959` | ½–1 d |
| The topbar's "N calls handled this week", the account dashboard's "Calls answered" hero, its 14-day calls chart and its After-hours tile all count spam and abandoned calls (an answered robocall is stored as a call with outcome `spam`); the weekly report excludes both. One fix, which also reaches the app shell | `apps/web/src/lib/voice/presence.ts:38-43`; `packages/db/src/voice.ts:540-549`; `.../dashboard/page.tsx:210-236` | ½–1 d |
| The Voice page can assign a second active number, a state the setup wizard and go-live cannot describe (the text sender silently picks the oldest live number) | `.../voice/actions.ts:88-113` | ½–1 d |
| Go-live is two separate writes, so a failure between them can leave a testing number answering real callers | `.../setup/actions.ts:171-172` | ½–1 d |
| The voice runbook and `.env.example` name a per-caller daily-cap variable that the code never reads (one fix for both files) | `docs/runbooks/voice-setup.md:586`; `.env.example:175` | ½–1 d |
| The dashboard hard-codes "Sofía" although the persona's name is configurable | `apps/web/src/lib/messages.ts:61` | ½–1 d |
| Sofía fills blank fields on an existing contact live, with no person approving; until decision 19 is dated, §3.2 rule 4 routes these fills to the existing `contact_field` proposal kind | `apps/web/src/lib/voice/tools/registry.ts:209-217` | ½–1 d |
| **Website assistant: 6 defects, 0.5–1 ew** | | |
| The assistant never receives the capture's result, so a "passed on" reply can show beside a failed capture | `apps/web/src/lib/voice/system-prompt.ts:121`; `apps/web/src/app/api/concierge/[publicId]/turn/route.ts:485` | ½–1 d |
| An unpublished destination form leaves the assistant answering while every lead fails to file | `packages/db/src/concierge.ts:24-35`; `apps/web/src/lib/concierge/lead.ts:67-70` | ½–1 d |
| The visible conversation resets to the greeting on every page of the client's site | `apps/web/src/app/c/[publicId]/concierge-chat.tsx:186` | ½–1 d |
| A failed first reply returns no conversation, so a retry opens a second one and uses one of the visitor's three starts | `apps/web/src/app/api/concierge/[publicId]/turn/route.ts:288-302` | ½–1 d |
| The on/off switch demands an English greeting even on a Spanish-only profile | `.../voice/voice-settings.tsx:273-275` | ½–1 d |
| The chat page has no error boundary and always declares `lang="en"` | `apps/web/src/app/c/layout.tsx:55` | F-102 layout |
| **Website traffic: 5 defects, 0.5–1 ew** | | |
| Totals and breakdowns cover different hours, so shares can drift or pass 100% | `apps/web/src/lib/website/sync-window.ts:42-47` | ½–1 d |
| The breakdown read is unpaged; on a busy site the rows cut are the newest days | `packages/db/src/sites.ts:148-156` | ½–1 d |
| The chart gives the `bar-hot` treatment to the hovered bar, not the busiest one (fix the code; the Charts rule is right) | `.../website/daily-chart.tsx:78` | ½–1 d |
| "Test connection" is an outline button, not ghost, and reads "Saving…" while it runs | `.../website/link-site-card.tsx:101` | ½–1 d |
| Unlink deletes history behind a plain confirm, not a typed name (rule 6) | `.../website/link-site-card.tsx:110-129` | ½–1 d |
| **Automations and quiet hours: 5 defects, 0.5–1 ew** | | |
| The demo seed stores recipe bodies with raw `{{first_name}}`-style tags that nothing fills and the preview shows | `packages/db/src/demo/seed.ts:876-894` | ½–1 d |
| The Custom values card promises template variables "from M1c on"; nothing substitutes them, and it names a milestone code | `apps/web/src/lib/messages.ts:486` | ½–1 d |
| The quiet-hours card says no automated texts go out in the window, but the missed-call text-back is never held | `apps/web/src/lib/messages.ts:1425` | ½–1 d |
| The instant reply ignores the per-account send switch that every scheduled pass honours | `apps/web/src/lib/automations/instant-reply.ts:95-110` | ½–1 d |
| The palette's words for Automations leave out referral, reactivation, quote, confirmation and instant reply | `apps/web/src/lib/palette/registry.ts:61` | ½–1 d |
| **What went out and weekly reports: 6 defects, 0.6–1.2 ew** | | |
| The quiet-week report says "Sofía is still answering" whatever the receptionist is called | `apps/web/src/lib/email/templates/weekly-report.ts:57` | ½–1 d |
| A quiet week drops the visitors line, so the email can say "Nothing came in" over a week with visitors | `apps/web/src/lib/email/templates/weekly-report.ts:54-77` | ½–1 d |
| "Calls handled" counts abandoned calls while the report's "calls answered" excludes them | `apps/web/src/lib/voice/finish-call.ts:584-591` | ½–1 d |
| "Emails sent" mixes the owner's weekly reports with customer emails, and shows no failed count | `packages/db/src/automation-log.ts:218-225` | ½–1 d |
| The client report handles at most 10 accounts a tick, about 120 accounts per time zone in the Monday band | `apps/web/src/lib/automations/passes/weekly-report.ts:64-71` | ½–1 d |
| The empty state offers no action (rule 5) | `.../activity/page.tsx:94` | ½–1 d |
| **Branding: 5 defects, 0.4–0.8 ew** | | |
| A branding change is logged with an empty payload, so the record shows who changed branding but not what | `packages/db/src/branding.ts:140` | ½–1 d |
| The name and colour hints say they appear on "lead forms and this sidebar"; they reach booking, chat, emails and texts | `apps/web/src/lib/messages.ts:125-126` | ½–1 d |
| The fallback preview uses a stale sidebar colour | `apps/web/src/lib/branding/color.ts:19` | ½–1 d |
| The workspace tab title, sidebar and greeting fall back to the agency's private label | `apps/web/src/app/(dashboard)/dashboard/layout.tsx:47` | ½–1 d |
| The booking page's tab title is the generic English word "Booking", in both languages (the form page's "Form" is listed under forms) | `apps/web/src/app/b/layout.tsx:22` | F-102 layout |
| **App shell and dashboard: 10 defects, 2.1–3.7 ew with the F-076 slice (the hero follows the plan) and the skeletons** | | |
| The palette's "Toggle theme" skips the cookie write and refresh the topbar toggle performs | `apps/web/src/components/command-palette.tsx:159` | ½–1 d |
| "Calls handled this week" counts from Monday 00:00 UTC, not in the account's zone | `apps/web/src/lib/voice/presence.ts:34-38` | ½–1 d |
| When an account's zone cannot be resolved, the dashboard's zone note tells the agency to "Set it in Settings" and links there, but Settings has no time zone field; the only zone input is in the Add company dialog (§2.2.1) | `apps/web/src/lib/messages.ts:1955`; `apps/web/src/components/zone-note.tsx:102`; `apps/web/src/app/(dashboard)/dashboard/accounts/create-account-dialog.tsx:78` | ½–1 d |
| The 7-day KPI tiles (three or four) never name their window, and three of them show a 14-day sparkline beside a 7-day number; the After-hours tile, shown only when the calendar has hours, has neither (the all-time tiles do say "All time") | `apps/web/src/components/stat-tile.tsx:116-120`; `.../dashboard/page.tsx:274-300` | ½–1 d |
| The account dashboard's Open deals and Pipeline value undercount silently past 1,000 open deals | `.../dashboard/page.tsx:106-112` | F-055 slice |
| On a CRM-only plan the dashboard's hero is always "Calls answered", so its headline number always reads 0 | `.../dashboard/page.tsx:274-281` | F-076 slice |
| Three Settings cards (Branding, Weekly report, Website) are missing from the ⌘K index that DESIGN.md requires | `apps/web/src/lib/palette/registry.ts:36-42` | ½–1 d |
| 23 of 28 dashboard routes have no loading skeleton (rule 7); five do | `apps/web/src/app/(dashboard)/dashboard/work/loading.tsx`; `apps/web/src/components/ui/skeleton.tsx` | 1–2 ew (23 routes on the shared `Skeleton`) |
| The base Button uses a 10 px radius, not the 8 px control radius; Clerk's topbar menus use Clerk's styling | `apps/web/src/components/ui/button.tsx:8` | ½–1 d |
| The booking-cancel page always declares `lang="en"`, even in Spanish | `apps/web/src/app/b/layout.tsx:50` | F-102 layout |
| **Setup and blueprints: 9 defects, 1.8–2.6 ew with the F-099 slice (CRM-plan steps in today's Setup)** | | |
| A client that buys only the CRM can never finish Setup: the steps are built around Sofía, and texting needs a Sofía profile | `apps/web/src/lib/setup/setup-status.ts:81-131` | F-099 slice |
| The sidebar meter counts ten steps while the wizard drops a skipped email step, so a live client shows "9 of 10" forever | `apps/web/src/lib/setup/setup-status.ts:139-141` | ½–1 d |
| The Add company hint promises a blueprint can be applied later; no screen can | `apps/web/src/lib/messages.ts:237` | ½–1 d |
| The half-created-company warning's first remedy creates a second Clerk organisation instead of adopting the orphan | `apps/web/src/lib/messages.ts:99` | ½–1 d |
| Checklist help says "Calling and SMS arrive in M2" and "Review management arrives in M5": stale milestone codes | `apps/web/src/lib/messages.ts:752, 768` | ½–1 d |
| Capture copies archived forms into every new client (the missing-notify count's drafts are listed under forms) | `packages/db/src/blueprints.ts:199-200` | ½–1 d |
| The blueprint list shows the first capture date, and "Applied to N accounts" counts applications | `apps/web/src/app/(dashboard)/dashboard/blueprints/page.tsx:29` | ½–1 d |
| "Test call" reads done after any call, a robocall included | `apps/web/src/lib/setup/setup-status.ts:115` | ½–1 d |
| Re-seeding the demo deletes any agency blueprint captured from the demo account | `packages/db/src/account-teardown.ts:83-84` | ½–1 d |
| **Platform and operations: 9 defects, 0.9–1.8 ew** | | |
| The scheduler's secret is missing from `.env.example` and every runbook (only a spec, four plans and an agent note mention it), so a rebuilt environment would stop every automation with a 503 that nobody is alerted to | `apps/web/src/app/api/cron/reminders/route.ts:39-41` | ½–1 d |
| The pre-push hook says the repository is private with no protected branches; it is public with a ruleset | `.githooks/pre-push:4-6` | ½–1 d |
| README says local gate runs write production; they have been refused since #135 | `README.md:31-36` | ½–1 d |
| The voice runbook still describes Hobby log retention and cron limits; the project is on Pro | `docs/runbooks/voice-setup.md:398` | ½–1 d |
| Code comments say the carrier API key is unset by design; it has been set since 2026-09-16 | `apps/web/src/lib/automations/harness.ts:15-17` | ½–1 d |
| CI runs Node 22; production runs Node 24 | `.github/workflows/ci.yml:148` | ½–1 d |
| `pnpm lint` never lints `packages/db` | `packages/db/package.json:9-18` | ½–1 d |
| Two e2e specs still change the shared seeded account, against CLAUDE.md's rule for mutating specs | `apps/web/e2e/forms.spec.ts:18-40` | ½–1 d |
| No migration creates the logo storage bucket, so a fresh environment lacks it until a bootstrap script runs | `packages/db/supabase/bootstrap/ci-project.sql:75-79` | ½–1 d |
| **Roadmap and specs: 3 defects, 0.2–0.4 ew** | | |
| The platform spec's §8a says M7 has "no Stripe anywhere" and that the web chat's reply path was never machine-tested; both are false | `docs/superpowers/specs/2026-07-25-bis-platform-design.md:168-171` | ½–1 d |
| The lead-SMS-alerts spec is still headed "IDEA. Not planned", though it shipped (#67, #69) | `docs/superpowers/specs/2026-09-15-lead-sms-alerts-design.md:4-5` | ½–1 d |
| The platform spec promises do-not-disturb at the send chokepoint, but `contacts.dnd` is never read | `packages/db/supabase/migrations/0003_crm_core.sql:13` | S-05 (the send gate reads it) |
| **Public front door: the shared layout for `lang`, tab titles and branded not-found pages (F-102), 0.5 ew; its defects are counted above** | | |

Paths beginning `.../` sit under `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. The total is **105 defects, 13.9–23.3 ew**: 84 rows at ½–1 d (8.4–16.8 ew), the skeleton row (1–2 ew), and 20 rows that a feature carries, of which the six feature slices add 4.5 ew and the rest cost nothing more. If the F-048 rider is cut (§4.1), its two booking rows return at ½–1 d each.

**Security.** The hardening sprint closes 56 further known items (§4.2). They are tracked outside this public repository.

---

## 3. The principles every new feature keeps

### 3.1 The binding constraints, and why

| # | Constraint | Why |
|---|---|---|
| 1 | Adult day care is out, and home health with it | The owner decided on 2026-09-25: HIPAA's compliance burden and cost outweigh the market. Onboarding will turn these trades away politely (F-173) |
| 2 | HIPAA verticals stay behind study decision 5 | A clinic's calls put health information in transcripts, summaries and proposals that BIS stores and sends to an AI provider. Only an anchor clinic that funds HIPAA mode, in a hardened production project, reopens it |
| 3 | Two or three fixed plans; every plan has the CRM; higher plans add Sofía and the web chat; per business, never per seat | "Everything but the receptionist, on every plan" is a sentence an owner can repeat, and adding a technician should not change a small shop's price until it outgrows its plan's logins. Today nothing enforces the plan flag, so entitlements (S-13) must land before the first plan is sold at scale |
| 4 | DESIGN.md is the UI contract | Much of the code is written by agents, and a contract only holds if changes to it are dated decisions. Section 6.5 lists every amendment this plan needs, each "Proposed" |
| 5 | A person approves every AI write | Owners trust what they can see and undo. The review tray (F-019) keeps approval fast enough to stay real. Sofía's and the web chat's live writes already strain it; decision 19 settles the reading |
| 6 | English and Spanish everywhere a customer or an owner reads | About four in five Hidalgo County residents aged five and over speak Spanish at home (78.9% in the pricing study's ACS figure; the CRM study's appendices cite 80.7% from the 2023 ACS). The owner's own screens are today the one place BIS is not bilingual. Clerk's sign-in emails and widgets stay English until F-117's part in later: a remaining strain on this constraint, flagged here rather than hidden, and the first candidate to move into next if capacity allows, subject to Clerk's localization limits (§4.5, F-117's row) |

### 3.2 The rules this plan adopts

| # | Rule | Why |
|---|---|---|
| 1 | **The legal chain is never traded.** It ships first and is live by 1 December 2026; no account texts before its send gate is live, whatever the carrier says | The revocation duty in force since April 2025 binds from the first text, and a missed revocation is a per-message liability; the FCC's revised order may change its scope within weeks of publication |
| 2 | **No horizon inversion.** A part depends only on work in its own horizon or an earlier one. Where two features need each other, one slice owns the shared piece: F-084 owns the special-hours record; F-115's first part owns the schema changes F-022 builds on; F-019 owns the proposal kind registry; F-004 owns restriction, and "View as customer" moves to F-062; F-023's shared tool belt ships before S-18 and S-33 and needs neither; F-108 depends on F-081, not the reverse, because the router ships email and in-app first; F-015 owns the address component F-047's job address uses; S-08 signs documents from the vault and does not wait for F-113's renderer; F-051's `held` state does not wait for the events pack. The skeptic's four inversions are resolved: F-133's stop flag no longer needs F-081, and its other flags follow F-081 in later; F-107's first part uses today's labels, and the bottom-tab shell waits with F-089 in next; F-072's check-in does not need F-170; F-127 drops its F-134 dependency for the standard tier. Five more pairs are broken the same way: S-17 owns the gone-quiet promise and F-079 builds on it, not the reverse; F-052 needs only F-046's first part; F-172 needs only F-173's vetting slice; F-049's text legs need only F-065's first part; F-033's callback rows ship on today's To do queue, and F-077's inline Done builds on them (the canonical list has F-033 depend on F-077) | A plan whose early items wait on later ones is not a plan |
| 3 | **No restricted field before roles.** Custody, gate codes, immigration or detention status, a child's date of birth, allergies and health details stay in transcript evidence until F-004 enforces restriction on the server | Every invitee is a company admin today, so a restricted field would be visible to everyone |
| 4 | **A person approves every AI write.** Every new AI write goes through the review tray. Until decision 19 is dated, Sofía's filling of blank fields on an existing contact becomes a proposal of the existing `contact_field` kind; the acts a caller or visitor asks for and confirms (booking, rescheduling or cancelling their own appointment, leaving their own name and number) continue live and gain author stamps and undo; and no new live write path is added. A text sent during a call or chat carrying a link the customer asked for (F-199's reservation or ordering link; the pay link of F-058 and S-29) is such a path: until decision 19 is dated, the link is read out on a call or shown in the chat, never texted. So is a hold on sends placed by model-based detection, once chain step 5's detection uses a model after decision 6. The exception is meant to cover only the caller's or visitor's own booking or record (proposal; decision 19), and S-47's identity checks (F-116) are what establish "own". An AI write is a change to a record, or a message sent to a customer outside a live conversation the customer started (a text, an email, a follow-up). Two things are not: what Sofía says on a call, or what the web chat replies in a chat the visitor opened, which the guardrail modules (F-174) and the approved facts (F-037) bound instead; and a labelled summary or description shown only to the business's own people (F-028's descriptions, F-100's paragraph). If the owner reads either otherwise, decision 19 settles it | Binding constraint 5 |
| 5 | **The Monday report has one owner and a budget.** F-100 owns it: at most four headline numbers and two lines, from one metrics catalogue; the morning brief is an edition of the same engine. This waits for decision 24 and §6.5 row 13; until they are dated, DESIGN.md's four fixed numbers stand | About twelve features want a line of their own; an email that accretes stops being read |
| 6 | **One interim per-person store** (`user_prefs`, created with staff and roles) for language and theme now, and text size, collapsed cards and "last seen" as their features and amendments arrive | Per-person settings scattered across Clerk metadata, cookies and feature tables drift |
| 7 | **Effort bands follow the number.** Above 6 ew is L, whatever the label; a judge's higher re-estimate is used and marked | Labels that understate effort break the capacity check |
| 8 | **Split to ship.** Any feature over 6 ew ships in slices of 4 ew or less, each to a real client before the next; each study item ships to a real client before the next on its track | The study's own rule (§11.3), and the only protection against a year of unshipped work |
| 9 | **One of each shared service:** one short-link service (F-091), one background job runner (F-196; until it lands, today's tick takes at most six new passes, each named here: the vault's two, the operational floor's alert pass, the consent ledger's reconciliation pass with its ten-business-day clock, and M7a's non-payment pause pass and nightly Stripe reconciliation (S-62)), one model gateway (F-020, one provider until decision 2), one agency-scoping design for F-118, F-137 and F-138 | Duplicated plumbing is where cost and incidents hide |
| 10 | **Plans differ by Sofía, the web chat and allowances.** No other feature becomes a plan gate unless the owner decides otherwise (decision 25) | Binding constraint 3 |
| 11 | **Revisits are listed, never silent.** A feature that changes a recorded study decision or spec position waits for its decision | Recorded decisions are the project's memory |
| 12 | **Validate before building on a hypothesis.** The cheapest measurement ships first (§10) | Every demand signal so far comes from vendors, not buyers |
| 13 | **Bilingual by construction.** Every new screen, message and document ships in English and Spanish in its first release; a ratchet gate fails the build on any new English-only string | Binding constraint 6, enforced by the build rather than remembered |
| 14 | **No new path sends a health-marked document or field to a model before decision 6's terms are in place** (the study's rule). Keyword detection only; health-marked documents filed by hand. Calls continue to reach the voice provider, which is why the zero-retention request goes out now | Children's health details already reach the provider when a parent mentions an allergy on a call |
| 15 | **Security specifics stay out of this repository.** The plan names the sprint and its count, never its items | The repository is public |

---

## 4. The plan

This section is order and effort; section 5 is what each feature is and why. Every placement is a proposal until the owner decides (§9). "Part" marks a split feature, shown once per horizon it touches. A "Depends on" cell names the owner decisions a feature waits for; every feature a §9 decision's *Blocks* line names, decision 33's second group and decision 34's later moves and pulled-forward items included, also waits on that decision, whether or not its cell repeats it (§3.2 rule 11). Likewise, every feature that §10's "What waits on the answer" column names waits on that hypothesis, whether or not its cell repeats it (§3.2 rule 12).

### 4.1 Capacity

**The study's own figures.** The whole study costs **147–207 ew**, "roughly three to four years for one engineer working conventionally, or a little over a year for three" (study §11.1). Its first release is **27–36 ew** (study §11.2). The canonical list adds about **660–910 ew** on top of that. The judges counted 79–80 features tagged "now", with stated efforts of about **251–334 ew**, against a first release of 27–36.

**The observed pace.** The study itself warns against reading those units as calendar time: "This repository has not moved at conventional speed: its foundation, CRM spine, booking, voice receptionist, white-labelling, automation engine and web concierge shipped between 25 July and 22 September. Read calendar time off that observed pace, not these units" (study §11.1). Costing what shipped in the study's own units gives about **47–66 ew in eight and a half weeks**. That costing is ours, not the study's: the CRM spine 10–14, the voice receptionist 10–14, the automation engine and reports 6–8, forms, email and the inbox 6–8, the foundation 5–7, booking 4–6, white-labelling 3–5 and the web concierge 3–4. It comes to roughly **5.5–8 ew a week**.

**The assumption.** We plan at **5–6 conventional ew per calendar week**, around the low end of the observed range, for two reasons. The next six months are rework on live data rather than greenfield: roles under row-level security, a record model with a backfill, and one send gate across every send path. And the study's rule that "each item ships to a real client before the next item on that track starts" (study §11.3) adds waits that greenfield work did not have. Effort stays in conventional ew throughout; the pace only converts it to calendar time.

**The pace check (proposal).** The pace is our own backcast of greenfield work, not a measurement of rework, so it is re-measured on the first working day of every month: the conventional ew of the items that shipped to a real client, against the weeks elapsed. If two consecutive months come in at three to four ew a week, re-ordering alone does not rescue the plan, and the owner chooses between two responses: re-scope it, or add capacity to one named track, such as a second engineer or a contracted track for money or the packs (proposal). At that pace now holds 78–104 ew. Keeping only the legal chain, the hardening sprint, the operational floor, the defects, the first release's eight items, M7a (S-62) and the first Spanish comparison (F-194) costs 88.4–123.8 ew, or 81.9–114.8 once the first release's last items (the vault's kit and inbound email, 6.5–9 ew) slide into next: still over. At three a week even the low bound is over (81.9 against 78), and at four a week the high bound is (114.8 against 104). Next, 39–52 ew at that pace, would then absorb those items, the riders (10–13.5 ew) and the rest of the parallel work (13.5–16.5 ew, Sofía's insurance and events modules included) on top of its own 54.5–74: 84.5–113 ew, about twice its capacity. So the first step moves that work, and the second is the owner's: which of next's own items slide to later (F-046 part 1, F-077 part 1 and F-175 part 1 first, then F-092 part 1, F-095 part 1 and F-107 part 2), and how much of later then slides into 2029.

| Horizon | Calendar | Weeks | Capacity at 5–6 ew a week | This plan (ew) |
|---|---|---|---|---|
| Now | 1 October 2026 to 31 March 2027 | 26 | 130–156 | 111.9–153.8 |
| Next | H1 2027; April to June once now ends | 13 | 65–78 | 54.5–74 |
| Later | July 2027 to December 2028 | 78 | 390–468 | 359–492 |
| Future | 2029–2030 | 104 | 520–624 | 161.5–222.5 |

**The rule for the now horizon.** Now holds four things, in this order, and nothing else.
1. **The legal-date chain, and what it stands on:** the consent chain, the hardening sprint, an operational floor, the defects the inventories found, and the first Spanish comparison (F-194, 1 ew). It is not capped, because none of it is optional (31.4–45.8 ew).
2. **The study's first release**, at its re-costed size (53.5–73 ew, against the study's 27–36).
3. **The parallel work the study names in its §11.2** (M7a's remaining steps; Sofía's guardrails, identity checks and price-list grounding; Google sign-in with its branding verified; Microsoft publisher verification), **plus two items this plan adds from the study's §11.3 step 1** (tenant vetting, and Microsoft sign-in beside Google's), and the Opinion 680/705 sheet that gates law sales (17–21.5 ew).
4. **Riders, capped at 13.5 ew**, which is half the study's first-release low bound of 27 (10–13.5 ew). The cap exists so that riders never become a second first release, and half of the smallest first release still carries the six fixes that make Sofía and the CRM-only plan sellable this winter. Each rider must:
   - come from a feature the value judge scored 4 or 5 and the feasibility judge 4 or 5;
   - build on shipped code, or on earlier work inside the now horizon, never on a later horizon;
   - cost 3 ew or less.

   Some riders therefore have named same-horizon prerequisites. The owner-facing riders (F-033's call card, F-141's texting settings and F-157's lead-source display) ship after F-013 part 1's runtime and ratchet gate, so that they ship in English and Spanish as §3.2 rule 13 requires; F-010 follows the Spanish-greeting defect; F-141 also follows the send gate (chain step 4). F-107, and F-048's public-page and customer-email parts, use today's bilingual public string modules or add no owner copy, so they can ship first; F-048's one owner-facing piece, the Calendar page's Cancel dialog, which composes the customer notice and then cancels at once with an undo (the notice sends when the undo closes, so rule 6's reversible branch applies), ships after F-013 part 1's runtime and gate, or with its English and Spanish strings written out. The same sequencing binds the parallel work's owner-facing pieces: F-084's switch and its owner grant ship after F-013 part 1's runtime and gate, or with their English and Spanish strings written out; M7a's client-facing pieces (S-62's client Billing page, its billing-link email and its payment-failed and paused banners) do the same; chain step 5's confirmation row, which must be live by 1 December, ships with its strings written out; and S-05, which goes first as chain step 4, sends its customer confirmation in both languages by design and writes out the strings of any consent line an owner reads.

**The check.** Now totals **111.9–153.8 ew** against a capacity of 130–156. At the low bounds it fits at five a week, with about 18 ew to spare. At the high bounds it needs six a week. If the pace is five and the high bounds hold, cut in this order:
1. the riders, lowest priority first, with F-141 last: without it the CRM-only plan cannot text, so M7a should not sell that plan until F-141 ships;
2. the first release's inbox increments (F-036 part 1 and F-068 part 1), which slide into the first weeks of next;
3. Microsoft sign-in (half of S-28);
4. the Opinion 680/705 sheet (F-124 part 1), which the law module in next needs first.

That brings the horizon to about 137 ew, or about 139 ew if F-141 is kept: 7–9 ew over five a week. The rest is a pace question, not a cut: the first release's last items finish in the first weeks of next, with the cut items next needs (steps 2 to 4), and next's own two-step cut makes room for them (§4.4). Cut riders go to the head of later. F-014 is not cut, because F-013 part 1 cannot ship without it. The legal chain, the hardening sprint and the eight first-release study items are never cut.

**How we will know it is working (proposal).** The pace check measures effort; these outcomes sit beside it, read at the end of March 2027 and again at the end of 2027. The targets are the owner's to set after the October and November calls, not this plan's.
- The send gate is live by 1 December 2026, and every account that clears A2P texts through it.
- Each of the first release's eight study items has shipped to a real client (study §11.3's rule).
- Accounts signed, and the split between the CRM-only plan and the plans with Sofía, once M7a charges.
- In the review tray, the share of AI suggestions a person accepts, edits or discards, read from the tray itself.
- The first Spanish comparison (F-194) is published before any sales material claims Spanish quality; from later, F-130's language-parity report tracks it.

### 4.2 Before the first release (this quarter)

This quarter's work comes before the first release's screens: operational steps that cost owner and staff time, not engineering, except the first Spanish comparison (F-194), the one operational step costed in ew; the one chain with a legal date; a hardening sprint; an operational floor; and the defects the inventories found. Engineering subtotal: **31.4–45.8 ew**.

#### Operational steps

| Step | When | Why |
|---|---|---|
| Register A2P 10DLC for BIS's own line and the one live client, 956 Woodworks (BIS first, as the runbook advises), by hand in the Telnyx portal | Start in the week of 28 September 2026 | No account is approved, so every text path is dormant: typed texts, reminders, the missed-call text-back, owner alerts and the alert-phone code. Each carrier round takes 3–7 business days, plus fees and evidence. **Texting stays switched off for every account until the send gate (chain step 4) is live**, whatever the carrier says |
| Check the live Telnyx messaging profile and register the stop keywords Telnyx does not recognise by default: the study's six Spanish words (PARAR, DETENER, ALTO, CANCELAR, BAJA and NO MAS), NO MÁS as well, since customers type with and without accents, and the English REVOKE, OPT OUT and OPTOUT, which 47 CFR 64.1200(a)(10) names but Telnyx's defaults (STOP, STOPALL, STOP ALL, UNSUBSCRIBE, CANCEL, END and QUIT) leave out. Telnyx matches a keyword only when it is the whole message. Proposal: one Telnyx messaging profile per client business, created when its campaign is registered, starting with BIS's own line and 956 Woodworks, because Telnyx applies keyword replies and stop blocks per profile: on a shared profile one reply cannot name each business, and a stop sent to one business blocks every business on it. Start a staff routine for stop requests written in free text and, if either marketing email is switched on before inbound email (S-06) lands, for emailed replies asking to stop, which reach the client's own mailbox: the client forwards them and staff set "No marketing emails" within ten business days | The week of 28 September 2026 (study §11.2) | Nobody has yet confirmed what is registered: Telnyx recognises only seven English stop words by default, not every word the rule names, and the code's comment says the Spanish ones work only once registered. No system honours a stop request written in a sentence |
| Talk to vendors at the RGV Wedding & Quince Expo | 27 September 2026 | The events pack and six other features rest on hypotheses H1 to H4 (§10) |
| Discovery calls: 5–10 event vendors, 3–5 child-care centres, a handful of restaurants, two insurance agencies, tax preparers, other trades (HVAC, plumbing, pest control), receptionist-first prospects, and the one live client | October and November 2026 | The questions in §10. The pricing study's risk 8 still stands: every demand signal so far comes from vendors, not buyers |
| Put a Stripe key on the production environment | Before M7a step 3 | No deployment (production or preview) has one, so the Plans page cannot create a plan and nothing is charged |
| File the Business Profile API application | This quarter | It needs a verified profile active 60 days or more (BIS's own or a managed client's; study §6.2 step 3), a website for that business (Google's [API prerequisites](https://developers.google.com/my-business/content/prereqs)), and approval has no published timeline (study §6.2 and §11.2) |
| Ask the AI provider for zero data retention or a BAA | This quarter (decision 6) | Health details that callers mention already reach the provider |
| Land the CRM study, its appendices and the pricing study on `main` | This quarter | They exist only on the working branch. So does the owner's decision of 25 September 2026 that adult day care, and home health with it, are out |
| Engage counsel for five readings | October 2026 | The message-class table, the keyword list (the Spanish words, and the English per se words of 47 CFR 64.1200(a)(10)) and the stop confirmation's wording and limits (one confirmation only, as today's (a)(12) requires and BIS keeps by choice after adoption; sent within five minutes, the window the rule presumes consented) against the FCC order as adopted, re-checked after the 30 September vote, with SB 140's reach over consent-based texting (the Secretary of State's registration FAQ and the pending Attorney General request, RQ-0626-KP); the disclosure wording (decision 20); the Opinion 680/705 sheet; the insurance intake against Texas Insurance Code §4001.051(b) and (d), where (d) keeps an unlicensed person's referral to an agent outside an agent's acts unless specific policy terms are discussed; and the two marketing emails' reply-to-stop opt-out under CAN-SPAM, which requires an opt-out honoured within ten business days and can hold the sender, here BIS, responsible beside the business promoted |
| Write a runbook step for honouring a customer's deletion request by hand, and ask counsel which clients the Texas Data Privacy and Security Act (TDPSA) reaches | This quarter | Bulk delete skips any contact with a booking, deal or conversation, and F-122 is 2029–2030 (§5.11) |
| Raise Clerk's membership cap for a company whose client needs a fifth login | When the first one does | S-01's staff logins would otherwise stop at about four client logins per company (§4.3); the M2 spec says to raise the cap when a client outgrows it |
| Confirm whether production's Supabase organisation is on Pro or Team | This quarter | The study asks for it (study §3.4); storage costs depend on it |
| Run the first Spanish comparison of receptionists (F-194), 1 ew, on the marketing site outside this repository | Before any sales material claims Spanish quality | The pricing study's rule is to claim only what survives the test (§8) |
| The owner's decisions needed before the first release starts | October 2026 | Study decisions 1, 2, 6, 14, 15 and 16–18; this plan's 19, 20, 21, 25, 27 and 28, decision 33's first group, decision 34's three "needed now" bullets, and 35's first sitting |

#### The legal-date chain

**What the law says, checked on 26 September 2026.**
- The FCC's 2024 consent-revocation order has required callers and texters since 11 April 2025 to honour a revocation made by any reasonable means, within ten business days (study §13).
- Its "revoke all" provision was delayed twice. The second delay, a Consumer and Governmental Affairs Bureau order of 6 January 2026 (DA 26-12), moved it from 11 April 2026 to **31 January 2027** ([FCC](https://www.fcc.gov/document/cgb-extends-effective-date-tcpas-consent-revocation-rule); [Burr & Forman](https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027)). That is the date the canonical list uses.
- **That date may no longer hold.** On 9 September 2026 the FCC released a draft Report and Order and Further Notice rewriting the rule, circulated for a vote at the Commission's 30 September 2026 open meeting; it has not been adopted ([Troutman Pepper Locke, 17 September 2026](https://www.troutman.com/insights/fcc-revises-tcpa-revocation-of-consent-rules-that-were-set-to-go-into-effect-in-january/); [Covington, 11 September 2026](https://www.insideglobaltech.com/2026/09/11/fcc-releases-draft-rules-and-proposals-on-tcpa-consent-revocation/); [Hall Render, 22 September 2026](https://hallrender.com/2026/09/22/tcpa-update-fcc-seeks-to-overhaul-consent-revocation-rules/)). One post headlines it as adopted ([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/fcc-adopts-clarifying-changes-to-tcpa-revoke-all-rule-effective-30-days-after-publication)); the draft itself ([FCC-CIRC 2609-05 and its fact sheet](https://docs.fcc.gov/public/attachments/DOC-424844A1.pdf)) says it is circulated for tentative consideration at the 30 September open meeting, which contradicts that. As drafted, the order:
  - lets a sender read a revocation made in response to an informational message as covering only that informational category; a revocation made in response to a marketing message still stops all marketing;
  - lets a sender designate one or more of three methods (a key-press opt-out, standard text keywords defined by English words, or a website or number) as the exclusive means of revocation, if the method is disclosed clearly in every call or text;
  - keeps the ten-business-day limit, though its Further Notice asks whether to shorten it (the joint letter it cites suggests seven business days);
  - rewrites (a)(11) and (a)(12): the new (a)(12), on the confirmation text, drops "one-time", "the only additional message" and today's clause that lets a confirmation ask which categories to stop, and keeps the five-minute presumption;
  - **takes effect 30 days after publication in the Federal Register, superseding 31 January 2027.**
- If it is adopted on 30 September and published within weeks, the revised scope could apply from November or December 2026.

**What that means for BIS.**
- No BIS account texts today, and Sofía only answers calls. Exposure begins the day any account texts: the duty in force since April 2025 (any reasonable means, within ten business days) applies from that first text. If adopted, the revised order changes a revocation's scope and lets a sender designate an exclusive method; BIS keeps honouring any reasonable method by choice (decision 27), and the Further Notice may later shorten the ten days.
- **The plan puts the chain live by 1 December 2026** because that is when texting should switch on: BIS's own and the live client's A2P registrations should clear by then, and the CRM-only plan needs texting to sell. It is a planning date, not one the law forces, and 31 January 2027 is an outer limit, not a target.
- No account texts before the chain is live.
- Counsel reads the order after the 30 September vote, and the adopted text in the week it is published.
- Because the order ties a revocation's reach to the message's category, the chain includes message classes (step 3).

| Step | ID | What it does | Effort (ew) | Counted |
|---|---|---|---|---|
| 0 | — | Stop keywords on each business's Telnyx profile: the Spanish words and NO MÁS, and the English REVOKE, OPT OUT and OPTOUT that Telnyx's defaults leave out. Telnyx answers a registered keyword itself, before BIS sees the message, and its default reply is generic English. It picks a custom reply by the country of the sender's number, so a Spanish reply to a US number beside the English one is not a documented setting: confirm it with Telnyx before promising it, or send the Spanish confirmation from BIS (step 4). The interim staff routine for stop requests written in free text | configuration | Operational steps |
| 1 | F-009 | Mexican numbers stored right, with ambiguous 10-digit numbers marked so that Sofía asks. The ledger keys consent on the number, so it must be right first | 1.5–2 | here |
| 2 | F-114 (two items) | Two sprint items are preconditions of the chain | in the sprint | Hardening sprint |
| 3 | F-066 (part) | One table mapping message classes (transactional, informational, marketing) to consent purposes, footers and hours; Texas calling hours in the recipient's time (Business and Commerce Code §301.051; the federal 8 a.m. to 9 p.m. rule in 47 CFR 64.1200(c)(1)), subject to counsel on whether they reach texts | 1.5 | here |
| 4 | S-05 and F-065 (part) | The ledger. One send gate that every send path must pass, pinned by a source-scan test. English and Spanish stop keywords (in English at least the seven words 47 CFR 64.1200(a)(10) names, plus STOPALL), with "CANCELAR" treated as a revocation, as "cancel" is under 47 CFR 64.1200(a)(10): one plain confirmation that carries no promotion and no rebooking offer (§64.1200(a)(12)), asking which messages to stop only where the contact holds consent for more than one category (today's (a)(12) allows that question; the draft drops it, so counsel confirms it after adoption). Treating any stop as stopping all marketing is BIS's conservative choice, not what the draft requires. Reconciliation with Telnyx, which reads the `autoresponse_type` field Telnyx sets on the inbound message webhook when it has handled a keyword, and settles who sends the one confirmation: Telnyx's configured reply answers a keyword and BIS sends nothing more for it, while BIS confirms only step 5's sentences, which Telnyx does not catch, so no customer gets two (proposal; asking which messages to stop needs BIS to replace Telnyx's reply on that profile and send one bilingual confirmation within five minutes itself). A backfill, and a ten-business-day clock kept as one setting, since the Further Notice may shorten it | 2–3 (S-05) and 2–2.5 | S-05 in the first release; the increment here |
| 5 | F-133 (part) | Stop requests written in a sentence, in either language ("ya no me manden mensajes"), caught: sends held at once, and a row on today's To do queue asks a person to confirm or undo (F-019's tray takes it over as a proposal kind when it lands). The row's English and Spanish strings are written out, because F-013's runtime may not be live by 1 December. Keywords only until decision 6 | 1 | here |
| 6 | — | Counsel reads the adopted order against steps 3–5 in the week it is published | — | Operational steps |
| | | **Chain total** | **8–10**, of which **6–7** here | |

The dormant do-not-disturb column (`contacts.dnd`, never read or written today) is read by the new send gate rather than fixed separately.

#### The hardening sprint

The sprint closes **56 known items**. The inventories found them, and they are **tracked outside this public repository**. It runs first, before client sign-ins scale and before any security questionnaire is answered. Two of its items are preconditions of the legal chain.

| ID | What it covers | Effort (ew) |
|---|---|---|
| F-114, with the security parts of related trust features | the 56 items, tracked privately | 8–11 |
| | **Subtotal** | **8–11** |

#### The operational floor

Monitoring and a tested restore are not yet in place (§2.1). The floor adds them, with no new vendor.

| ID | What it does now | Effort (ew) |
|---|---|---|
| F-119 (part) | heartbeats and an alert pass, no new vendor | 1–1.5 |
| F-120 (part) | a restore drill and a per-account call forward | 1.5–2 |
| | **Subtotal** | **2.5–3.5** |

Today one deployment-wide operator override can already send every call on a number to a person, bypassing Sofía. F-120 makes that lever per account, so one client's phones can be taken back, or kept ringing when the model is down, without touching the others.

#### Defects to fix now

§2.3 lists **105 distinct defects** across fifteen areas, and this table gives only the subtotals. Six features carry a slice that is really a defect fix, and those slices are counted here: F-001's timeline fixes, F-047's phase 1, F-055's "now" half, F-076's hero by plan, F-099's CRM-plan steps and F-102's shared public layout.

Each row is costed as §2.3 sets out, plus the slices and the skeletons named.

| Subsystem | Defects listed | Examples | Carried by a feature | Effort (ew) |
|---|---|---|---|---|
| Accounts, sign-in and billing | 5 | the switched-off client told to open an invitation; two primaries on the Client access card; alert texts unmetered; a renamed company keeps its old name in invitations | F-055 carries the agency home's undercount (its cost is in the Contacts row) | 0.4–0.8 |
| Contacts, pipeline and To do | 9 | due dates a day early; bulk-tag undo; blank tags in export; search dropping characters and sort; silent duplicates on edit; blank contacts | F-001: timeline fixes: the company's zone, bookings on the timeline, status labels (1); F-055: `Amount`, the US$ rule, both pipeline totals, the 1,000-row caps (1) | 2.6–3.2 |
| Messaging | 7 | one-line message bodies; complaints recorded as bounces; failure reasons hidden; inbox previews capped; stale empty-inbox copy; phone thread layout | — | 0.7–1.4 |
| Forms and lead intake | 7 | addresses with an underscore refused on every public path; the seeded Name field; vague save errors; drafts counted as missing a notify address | F-047: phase 1: the refused addresses and the blank-name rules (0.5); F-102 carries the embed's not-found box and the tab title (its cost is in the Public front door row) | 0.8–1.1 |
| Booking and calendar | 9 | a buffer that removes the next slot; no-show buttons on future jobs; a returning booker's details dropped; a success screen that claims a sent email; notify addresses | F-049 (first release) carries the late-booking reminder; F-048 (rider) carries Sofía's reschedule and the irreversible cancel | 0.6–1.2 |
| Sofía, the phone receptionist | 10 | the Spanish greeting never used; 'Always take a message'; robocalls counted as calls answered; blank fields filled with no approval; two active numbers; go-live in two writes | F-009 (legal chain) carries the 10-digit number; S-09 (first release) carries the English-only phone emails | 0.8–1.6 |
| Website assistant | 6 | a 'passed on' reply after a failed capture; an unpublished form failing silently; the chat resetting per page; a Spanish-only profile forced to write English | F-102 carries the chat page's error boundary and `lang` (its cost is in the Public front door row) | 0.5–1 |
| Website traffic | 5 | totals and breakdowns over different hours; unpaged breakdowns; `bar-hot` on the hovered bar; unlink without a typed confirmation | — | 0.5–1 |
| Automations and quiet hours | 5 | raw template tags in the demo; a card promising unbuilt variables; quiet-hours copy; the instant reply ignoring the send switch | — | 0.5–1 |
| What went out and weekly reports | 6 | the persona name hard-coded; a quiet week dropping visitors; two definitions of calls handled; mixed email counts | — | 0.6–1.2 |
| Branding | 5 | empty change payloads; hints that understate reach; a stale fallback colour; tab titles | F-102 carries the booking page's tab title (its cost is in the Public front door row) | 0.4–0.8 |
| App shell and dashboard | 10 | the palette's theme toggle; a UTC week; a zone note that links to a missing setting; 7-day tiles that never name their window; a CRM-only plan's hero stuck at 0; a 10 px button radius; skeletons on only 5 of 28 pages (rule 7; the other 23 at 1–2 ew) | F-076: the hero follows the plan (0.5); F-055 carries the undercount (in the Contacts row) and F-102 the cancel page's `lang` (in the Public front door row) | 2.1–3.7 |
| Setup and blueprints | 9 | a CRM-only client who can never finish Setup; a meter stuck at 9 of 10; promises no screen keeps; milestone codes; archived forms copied; a robocall counted as a test call | F-099: CRM-plan steps inside today's Setup (1) | 1.8–2.6 |
| Platform and operations | 9 | an undocumented scheduler setting; stale hook, README and runbook text; CI on Node 22 against production's 24; `packages/db` unlinted; two e2e specs mutating the shared account | — | 0.9–1.8 |
| Roadmap and specs | 3 | the platform spec §8a tracker; a shipped spec headed 'not planned'; do-not-disturb never read | S-05's send gate reads `contacts.dnd` | 0.2–0.4 |
| Public front door | — | (shared layout; its defects are counted in forms, the website assistant, branding and the app shell) | F-102: one shared public layout for `lang`, titles and branded not-found pages (0.5) | 0.5 |
| **Total** | **105** | | | **13.9–23.3** |

**Subtotal before the first release:** operational steps (F-194) 1 ew; the legal chain 6–7 ew; the hardening sprint 8–11 ew; the operational floor 2.5–3.5 ew; the defects 13.9–23.3 ew. That is **31.4–45.8 ew**.

### 4.3 The first release

The study's eight items, in its words (study §11.2), with the canonical features that are their detailed design. A feature adds effort only where it adds scope, and the table shows how much.

| Item | ID | Detailed design and what it adds | Study (ew) | Plan (ew) |
|---|---|---|---|---|
| **1** | **S-01** | **Staff and roles: users, roles enforced, a language per user** | **3–4** | |
| | S-01 | Staff and roles, re-costed | 3–4 | 6–9 |
| | F-013 (part) | the i18n runtime, es-US formatters, account and user language, the ratchet gate (F-012), AI output and alerts in the reader's language | | +2.5–3.5 |
| | F-014 | pseudo-locale and overflow check (the Intl layer is F-013's) | | +1–2 |
| | F-085 (part) | assignment with Mine and Unassigned (inside S-01) | | 0 (inside the study item) |
| | F-096 (part) | Mis preferencias: language and theme (F-111 folded in; its larger text and more contrast wait for amendment 19, ruled when F-096's later part starts) | | +0.5–1 |
| | | *Item 1 total* | *3–4* | *10–15.5* |
| **2** | **S-02** | **Client groups and relationships (restricted flags wait for roles), properties and equipment, the `company_name` backfill** | **5–6** | |
| | S-02 | Client record model, as the study costs it | 5–6 | 5–6 |
| | F-003 (part) | EN/ES relationship labels, padrinos and compadres included | | 0 (inside the study item) |
| | | *Item 2 total* | *5–6* | *5–6* |
| **3** | **S-03** | **The record page and drawer, with the summary, relationships, groups and documents** | **2–3** | |
| | S-03 | Record page and drawer, as the study costs it | 2–3 | 2–3 |
| | F-001 (part) | kit, card registry and three-column page for contacts and groups | | +3–4 |
| | F-101 | DESIGN.md v2 sections for the record page, documents and provenance; amendments batched for the owner | | +1–2 |
| | | *Item 3 total* | *2–3* | *6–9* |
| **4** | **S-05** | **The consent ledger** | **2–3** | |
| | S-05 | Consent ledger, as the study costs it | 2–3 | 2–3 |
| | | *Item 4 total* | *2–3* | *2–3* |
| **5** | **S-09** | **Bilingual automated messages, Sofía's emails included, and a language on every contact** | **3–4** | |
| | S-09 | Bilingual messages, as the study costs it | 3–4 | 3–4 |
| | F-008 | language evidence and the language mix, from transcript text | | +1–1.5 |
| | F-011 (part) | per-language message bodies and the accent segment hint | | +0.5 |
| | F-049 (part) | reminders in the contact's language, however late they booked (email) | | +0.5 |
| | | *Item 5 total* | *3–4* | *5–6.5* |
| **6** | **S-07** | **The document vault, with one default storage quota** | **6–8** | |
| | S-07 | Document vault, re-costed | 6–8 | 8–10 |
| | F-005 | camera upload, the quarantine state, the viewer; EXIF stripping | | +2–3 |
| | | *Item 6 total* | *6–8* | *10–13* |
| **7** | **S-06** | **Inbound email on the client's own domain (a BIS reply subdomain for a business without one), and web-chat threads in the inbox** | **3–4** | |
| | S-06 | Inbound email and web-chat threads in the inbox, as the study costs it | 3–4 | 3–4 |
| | F-036 (part) | chat transcripts in the inbox, the transcript view, the offline panel | | +0.5–1 |
| | F-068 (part) | a composer that follows the thread's channel | | +1 |
| | | *Item 7 total* | *3–4* | *4.5–6* |
| **8** | **S-14, S-15** | **Generalised proposals and the bilingual record summary** | **3–4** | |
| | S-14 | Generalised proposals, as the study costs it | 2 | 2 |
| | S-15 | Summary with caching and caps, as the study costs it | 1–2 | 1–2 |
| | F-019 | the `proposals` table with a kind registry (apply, inverse, evidence) and the one tray | | +4–5 |
| | F-020 (part) | one gateway library, a ledger, a default budget per account, kill switches; one provider | | +1.5–2 |
| | F-022 | author columns, AI writes stamped as AI, visible and undoable acts, and a notice whenever Sofía changes a booking | | +2.5–3 |
| | | *Item 8 total* | *3–4* | *11–14* |
| | | **First release total** | **27–36** | **53.5–73** |

**Why 27–36 becomes 53.5–73.**
- **Realism adds 5–7 ew:** staff and roles +3–5, the vault +2.
- **Detail the items cannot ship without adds 21.5–30 ew:** the review tray and its kind registry (F-019); authorship on every write (F-022); the Spanish runtime and components that let new screens ship bilingual (F-013 part 1, F-014); the record kit and DESIGN.md's new sections (F-001 part 1, F-101); the vault's kit (F-005); one door for model calls (F-020); and smaller increments in the inbox and messages.
- **Nothing the study left out of the first release is pulled into it.** The Spanish dashboard (S-10), history (S-04), merge (S-12) and entitlements (S-13) are next.

**Staff logins and the member cap.** Clerk caps a company at five memberships, the agency's included (§2.2.1), so S-01 gives about four client logins per company. The M2 spec calls the cap "a plan limit, not a design choice. Raise when a client outgrows it", and raising it is a Clerk setting, not code. This plan recommends raising it for a company the day its first client needs a fifth login, as an operational step (§4.2), rather than holding a five-person shop to four logins until F-117's part in later prices logins into the plans (decision 33). If study decision 14 sets a larger entry-plan allowance, that part moves forward.

**Decisions it needs.** Study decisions 1 and 2, as the study says. From this plan: 19, which reads the approval rule for item 8; 27, for the stop confirmation in item 4; 33's first group, for member sync and owner settings in item 1, the reminder timing in item 5 and editing before accept in item 8; and 35's first sitting, for DESIGN.md's new sections, the module contract, "at most one hero", bilingual in the definition of done and the operator's default theme. Suggestions read from email and texts use item 8's tray, but only once study decision 6's terms are in place, because they are a new path for health details to reach the model (§3.2 rule 14).

**Order within the release** (the plan's own, adapted from study §11.3): S-05 goes first, as chain step 4; S-01 and S-02 run in parallel; S-03 and the vault (S-07) follow, because they stand on the record model; inbound email (S-06), which the study lists with no prerequisites, follows them too, only because one engineer cannot run every track at once; S-09 and S-14/S-15 run throughout. Each item ships to a real client before the next item on its track starts.

#### The study's parallel work

These are the items the study's §11.2 runs in parallel, outside its 27–36 ew, re-costed, plus two items this plan adds from the study's §11.3 step 1: tenant vetting (S-53) and Microsoft sign-in (half of S-28). S-47 is where Sofía's receptionist-first sales to insurance agencies and event venues start at once; law firms follow from next, once the Opinion 680/705 sheet and F-174's law module exist (decision 15, as this plan reads it; §5.14).

| ID | Work | Study (ew) | Plan (ew) |
|---|---|---|---|
| S-62 | M7a steps 3–4 (checkout, webhooks, Billing page, pause) | 3–4 | 3.5–5 |
| S-47 | Guardrail packs, identity checks, price-list grounding | 3–4 | 10–12 |
| ↳ F-034 | one disclosure sentence with the transcription notice, measured on one account first | | (in S-47) 1.5–2 |
| ↳ F-037 (part) | structured hours, services and prices, the version stamp on calls | | (in S-47) 2.5–3 |
| ↳ F-084 | the switch, closures in the slot engine, the prompt line, the owner grant | | (in S-47) 2 |
| ↳ F-116 (part) | the verification ladder by pack risk | | (in S-47) 1 |
| ↳ F-174 (part) | insurance property-and-casualty (P&C) and events modules, 20–30 corpus items each, run by hand until F-021's harness exists | | (in S-47) 3–4 |
| S-53 | Tenant vetting | 0.5–1 | 1–1.5 |
| ↳ F-173 (part) | the vetting slice (it is S-53, re-costed) | | (is S-53) |
| S-27 | Verification preparation (Google branding, Microsoft publisher) | 1 | 1 |
| S-28 | Google and Microsoft sign-in | 0.5–1 | 0.5–1 |
| F-124 (part) | the Opinion 680/705 sheet and the subprocessor list | — | 1 |
| | **Parallel total** | | **17–21.5** |

S-47 grows from 3–4 to 10–12 ew because its canonical detail is larger than the study's line: the modules, with 20–30 tested bilingual conversations each (F-174); the one switch and structured facts that ground prices (F-084, F-037); the disclosure line (F-034); and the verification ladder (F-116). F-084's switch and owner grant, and M7a's client Billing page, billing-link email and non-payment banners (S-62), are the parallel work's owner-facing pieces, so they follow the bilingual sequencing §4.1 sets for them (§3.2 rule 13).

#### Riders

Six slices on shipped code, each from a feature judged 4–5 on both value and feasibility.

| Priority | ID | Rider | Value / Feasibility | Effort (ew) | Why it earns a slot |
|---|---|---|---|---|---|
| 1 | F-033 | Every call leaves a card: reason, callback number, the caller's words | 5 / 5 | 2–3 | A caller's message and callback number live only in the transcript and summary today. Who called, why and on which number is what an answering service sells, and the call state and proposals it builds on exist. |
| 2 | F-141 (part) | number mode 'forward', so a CRM-only account can text once A2P clears | 5 / 4 · med | 1.5–2 | M7a promises texting on every plan, and a CRM-only account cannot text today. Without it the entry plan cannot launch honestly. |
| 3 | F-010 | Every edge of the call in the caller's language, and Spanish robocalls caught | 5 / 4 | 1.5–2 | Spanish callers still hear English at the edges of a call. The pricing study's rule is to prove the Spanish before selling it. |
| 4 | F-048 (part) | Manage my appointment: move in place, cancel with a way back, add to calendar | 4 / 5 | 2–2.5 | A business-side cancellation never reaches the customer, and a Sofía reschedule counts as a new booking. A calendar file on the customer's own phone is the cheapest no-show defence while every text is dormant. |
| 5 | F-107 (part) | at phone width the sidebar opens collapsed, its footer pinned, and content reflows to fit | 5 / 4 · med | 1.5–2 | The signed-in app has no phone layout: the sidebar, 236 px expanded, sits on a 375 px screen. Opening the existing collapsible sidebar collapsed keeps rule 10's pinned footer, so it needs no amendment. |
| 6 | F-157 | "Found you through ChatGPT": attribution shown, AI assistants as a source | 4 / 5 | 1.5–2 | Where a lead came from is captured and never shown, and the website's channel rules count Gemini referrals as Google. Expo and truck-door leads need a visible source. The rider is the drawer line, the source question and the Website channel; a Monday-report line waits for F-100 under decision 24 and amendment 13. |
| | | **Riders total** | | **10–13.5** | Cap: 13.5 ew |

**The now horizon, summed:** before the first release 31.4–45.8 ew; the first release 53.5–73 ew; the parallel work 17–21.5 ew; riders 10–13.5 ew. That is **111.9–153.8 ew** against a capacity of 130–156, so it fits under the rule.

### 4.4 Next (H1 2027)

Next is H1 2027, which in practice means April to June, after the now horizon ends. It finishes what M7a and the first release start (entitlements, history and merge); answers the owner's calendar ask (Outlook first, and Google once a review of the calendar scopes alone passes); ships the Spanish dashboard that binding constraint 6 requires; gives owners a phone shell; and extends Sofía's modules to law firms and home services, with a structured intake. Two small proposals open it: a private calendar feed of BIS bookings for any phone calendar (F-048 part 2) and a phone-contacts import (F-150 part 1). Clerk's own sign-in emails and widgets stay English until F-117's part in later (§3.1).

**54.5–74 ew** against 65–78, so it fits on its own. If the pace is five a week and the high bounds hold, next also receives what now could not finish (§4.1): 7–9 ew of the first release's last items, and three items cut from now that next needs, namely the inbox increments (up to 2 ew), the Opinion 680/705 sheet (1 ew, before the law module) and Microsoft sign-in (0.5 ew, before S-22). That is 10.5–12.5 ew in all. Next's cut then has two steps, both to the head of later: first F-046 part 1, F-077 part 1 and F-175 part 1 (10 ew at the high bounds); then F-092 part 1, F-095 part 1 and F-107 part 2 (9.5 ew), so the phone shell waits too. The riders cut from now go to the head of later as well, and the calendar feed (F-048 part 2, 1 ew), which builds on F-048's rider, goes with them. That leaves next at about 64–66 ew against 65: at the edge, and the monthly pace check decides the rest (§4.1).

| ID | Feature | Effort (ew) | Why in this horizon | Depends on |
|---|---|---|---|---|
| **Record** | | | | |
| S-04 | `record_changes` audit log and trash | 2–3 | History must exist before merge, and before law firms are sold the pack | F-115 (part 1), S-02 |
| S-12 | Merge with history | 2–3 | Imports and new channels create duplicates; the import already flags them with nowhere to go | S-04 |
| F-006 | Duplicates found the Valley way, and a merge that keeps everything | 2–3 | The merge UI and phone-key surfacing, with S-12; the nickname scorer waits for F-092 part 2 | S-04, S-12 |
| F-150 (part: a phone-contacts import) | Switch kit: move in from GoHighLevel, Jobber or HoneyBook in a day | 0.5–1 | Proposal. A Valley business keeps its customers in a phone, and phones share contacts as vCard (`.vcf`) files, not CSV. A vCard step on today's import wizard, parsed in the browser as DESIGN.md's CSV rule requires, with the existing duplicate check | none |
| | *Record subtotal* | *6.5–10* | | |
| **Bilingual** | | | | |
| S-10 | Spanish dashboard | 3–4 | Binding constraint 6: the owner's own screens are the one place BIS is not bilingual | F-013 (part 1), F-014, S-01 |
| F-013 (part: every existing screen in order of daily use; the sign-in page's language from Accept-Language) | The Spanish dashboard, in order of daily use | 2–4 | Binding constraint 6; on top of S-10's 3–4 | F-013 (part 1), F-014, S-10 |
| | *Bilingual subtotal* | *5–8* | | |
| **AI** | | | | |
| S-19 | Document intake | 2–3 | The AI half of 'all their documents': a photo or PDF becomes proposed fields | S-07, S-14, decision 6 |
| F-020 (part: budgets per plan) | One door for every model call: gateway, budgets, registry | 0.5–1 | Needs entitlements | S-13 |
| | *AI subtotal* | *2.5–4* | | |
| **Calendar** | | | | |
| F-048 (part: the owner's calendar feed) | Manage my appointment: move in place, cancel with a way back, add to calendar | 1 | Proposal. A private, revocable link per person, in both languages, that Apple, Google and Outlook calendars subscribe to: every BIS booking on the owner's own phone, with the time, the service and the customer's first name only. It needs no Google review and no Microsoft admin, and it is the only route for an owner whose calendar is the iPhone's own. One-way: the owner's own events do not block Sofía's slots until S-22. It refreshes fastest on Apple devices, within about 15 minutes to an hour as the device's fetch setting allows; Outlook refreshes a subscribed feed about every 3 hours on Outlook.com and 6 on Outlook on the web, though it can take more than 24 hours (Microsoft), and Google publishes no interval, with users reporting 8 to 24 hours; a Google user adds the feed once from a computer, not the phone app. So the booking alert email, and the text once A2P clears, stays the prompt channel, and S-22 is the real-time answer | F-048 (part 1), S-01 |
| S-22 | Owner's calendar on Outlook and Google, with Meet, Teams and attendee matching | 6–8 | The owner's own ask; Outlook first; Google's calendar scopes submitted for review alone, a Testing-mode pilot until the review is submitted | S-27, S-28, F-196, decision 34 (the Google review) |
| F-046 (part: the agenda and staff-made bookings) | Run the day from the calendar: agenda, staff bookings, a job card | 3–4 | Staff cannot put a phoned-in job on the calendar today | F-107 (part 2), F-084 |
| F-049 (part: the text legs) | Reminders that reach people: their language, their channel, however late they booked | 1 | As soon as the live accounts clear A2P | A2P, F-065 (part 1) |
| | *Calendar subtotal* | *11–14* | | |
| **Messaging** | | | | |
| F-070 (part: phase 0, a `wa.me` link whose clicks measure demand, and the one-week spike) | WhatsApp through Telnyx, inbound first | 0.5–1 | The link costs about a day and the spike about a week (0.5–1 ew together); they produce the data decision 11 lacks | decision 23 |
| | *Messaging subtotal* | *0.5–1* | | |
| **Owner's day** | | | | |
| F-077 (part: inline accept and Done on today's loose ends: callbacks, failed transfers and Sofía's booking changes) | The work queue finishes what it shows: one-tap actions and every loose end | 3 | Consumes F-019's kind registry and inverses | F-019, F-033 |
| | *Owner's day subtotal* | *3* | | |
| **Navigation** | | | | |
| F-087 | One map of the product: a surface manifest every menu reads | 2.5–3.5 | The manifest F-088, F-089 and the palette read | none |
| F-088 | Show what the business uses: five surface states and one upgrade page | 2–3 | Honest plan states, paired with entitlements so the screen never lies | S-13, F-087, decision 35 (§6.5 row 5) |
| F-089 | The 2027 sidebar: a fixed spine, four module slots, a budget of nine | 1.5–2 | The spine the phone bar mirrors | F-087, decision 35 (sidebar) |
| F-092 (part: contacts search that ignores accents and finds full names and phone digits) | One search that finds García, across every record type | 1.5–2 | 'Garcia' must find 'García' | none |
| F-095 (part: palette v2 with Spanish keywords and 'go') | One box: find, go, or ask, in either language | 1.5 | Ships with the Spanish dashboard | S-10, F-092 (part 1), decision 35 (the one box) |
| | *Navigation subtotal* | *9–12* | | |
| **Design** | | | | |
| F-107 (part: the bottom-tab shell) | Phone first: a bottom-tab shell and content that fits its container | 5–6 | Owners run the business from a phone | F-089, decision 35 (phone) |
| | *Design subtotal* | *5–6* | | |
| **Trust** | | | | |
| F-115 (part: the history tab on S-04) | Evidence-grade records | 1–2 | With S-04 | S-04 |
| | *Trust subtotal* | *1–2* | | |
| **Growth** | | | | |
| S-13 | Entitlements on plans | 2–3 | Follows M7a's checkout; storage, logins and higher-plan features need enforcement | S-62, decision 25 (its scope) |
| F-148 | Connections: one page to find, connect, see and revoke every integration | 2 | Where the calendar connection lives | S-22 |
| F-196 | Room to run: background work beyond one 15-minute tick | 3–4 | Before calendar sync, money and every new scheduled pass | none |
| | *Growth subtotal* | *7–9* | | |
| **Packs** | | | | |
| F-174 (part: the law module, after the 680/705 sheet, and home services) | Sofía industry modules | 2 | Decision 15: sell Sofía to law firms once the sheet exists; this plan also waits for this module's never-say lines, so law sales start here | F-124 (part 1) |
| F-175 (part: intake for home services, insurance and events, through one proposal) | Intake schemas: a pack-shaped intake that opens a deal through one proposal | 2–3 | Only packs without restricted fields | F-174, F-019 |
| | *Packs subtotal* | *4–5* | | |
| | **Horizon total (26 rows)** | **54.5–74** | | |

### 4.5 Later (H2 2027 to 2028)

Later is eighteen months. It holds the money track and the portal; the packs in the study's order (home services first, then law and insurance, events, and child care); the Google and Microsoft track's remaining steps; the AI features that need the record, the vault and the tray first; and the trust work that law and tax buyers ask for.

**359–492 ew** against 390–468. The low bound fits at five a week. The high bound runs about 24 ew past six a week. At five a week on the high bounds, the case §4.1 and §4.4 plan for, later also receives about 32–34 ew from now's and next's cuts (the riders, 11.5–13.5; next's two-step cut, 19.5; the calendar feed, 1), so it holds about 524–526 ew against 390, some 135 ew over: the named tail does not cover that, and the monthly pace check's re-scope, or added capacity, applies (§4.1). **The named tail**, first to slide into 2029 if the high bounds hold, is 18.5–26 ew: F-142 (4–6), F-136 (5–7), F-097 (1.5–2), F-140 (3–4), F-161 (3–4) and F-195 (2–3). F-097 and F-195 are in it because both depend on F-136. S-61's tax offer does not slide with F-142: without its levers, the 2028 season is sold on the ordinary Sofía plan (see S-61's row).

| ID | Feature | Effort (ew) | Why in this horizon | Depends on |
|---|---|---|---|---|
| **Record** | | | | |
| S-11 | Forms with uploads, signatures, logic, pre-fill, booking questions | 3–4 | Enrolment packets and job photos; needs the vault and e-signature first | S-07, S-08, F-102 (part 2) |
| F-001 (part: a peek per record type, the peek stack, breadcrumbs, per-person card preferences) | The record page: one kit, a card registry, and moving between records | 2.5–3.5 | Each record type's peek ships with the module that creates it | F-001 (part 1), F-101 |
| F-002 | Clientes: people, families, businesses and places in one list | 2–3 | Tabs for households and business customers once the record model has run with clients; the record page carries groups first | S-02, F-177 |
| F-003 (part: "habla por" in Sofía's identity check) | Family roles and delegates: padrinos, compadres, "habla por" and "paga por" | 1–1.5 | Rests on hypothesis H5 | F-116, hypothesis H5 |
| F-004 | See who can see it: visibility marks, masked values, "View as customer" | 4–6 | No restricted field before roles: this is the server-side restriction that law and child care stand on | S-01, S-02 |
| F-007 | Terms: one fixed record for anything that renews | 3–4 | v1 keyed to contact and deal, with the first insurance or maintenance-agreement client | S-02, F-071, F-019 |
| F-197 | La caja de zapatos: bring the paper files in | 3–4 | After the vault and document intake; health batches filed by hand | S-07, S-19, decision 6 |
| F-198 | Team papers: staff licences, certificates and training that expire | 2–3 | With child care and insurance; restricted by default | S-01, S-07, F-004 |
| | *Record subtotal* | *20.5–29* | | |
| **Bilingual** | | | | |
| F-011 (part: AI twin drafting, the Valley glossary, the per-account register) | The Valley-Spanish kit: twin drafting, a glossary, texts without the double bill | 3–4 | Needs the model gateway and drafting (S-16) | F-020, S-16 |
| F-015 | Addresses from both sides of the river | 2–3 | Lenient address component with landmarks; F-047's job address uses it | S-02 |
| F-017 | The Valley's year: seasons, two-country holidays, "same week last year" | 2–2.5 | Two-country holiday rule in quiet hours; the same-week-last-year line needs 52 weeks of data | F-084, F-100 |
| | *Bilingual subtotal* | *7–9.5* | | |
| **AI** | | | | |
| S-16 | Drafting and translation | 1–2 | Parity feature; the first release's proposals and summary carry the AI ask first | F-020, S-06 |
| S-17 | Gone-quiet nudges | 1 | Owns the gone-quiet promise; F-079's follow-up plans build on it | none |
| S-18 | Ask BIS with read tools and SMS | 2–3 | Needs the search index, saved views and the shared tool belt | F-092 (part 2), F-093, F-023, A2P |
| S-20 | Notetaker | 1–2 | The in-person notetaker, which the study keeps independent of decision 7 (study §5.1 item 7); piloted with one trade client | F-019 |
| F-021 | The report card: a bilingual evaluation harness | 5–7 | Synthetic evals and the full-versus-mini comparison first, real-call sets after consent and de-identification | F-020, F-019 |
| F-023 | One tool belt for every assistant | 4–5 | The shared tool belt and the chat's tool-result loop, built first when Ask BIS or MCP starts; S-18 and S-33 build on it | F-020, F-019 |
| F-025 | The composer that writes and translates | 4–5 | Translation beside the original first; digits and amounts checked | S-16, F-020, S-06 |
| | *AI subtotal* | *18–25* | | |
| **Sofía** | | | | |
| S-44 | Sofía knowledge base | 2–3 | Before the restaurant and child-care receptionists | F-037 (part 2) |
| F-035 | Warm handoff: transfers that never fail silently | 3–5 | Whisper, alert, queue row and emailed message; no return to Sofía in v1 | F-021, F-081, decision 21 |
| F-036 (part: "Book this time" from the chat) | A web chat that closes the loop | 1–2 | Revisits the concierge spec (decision 33) | F-023, F-046 |
| F-037 (part: owner-edited versioned facts, visibility tiers, freshness, the serializer; packages and menus from F-166) | One source of truth for what the business says | 4.5–5.5 | Decision 28; its readers (F-160, F-161) come later | F-037 (part 1), F-084, decision 28 |
| F-038 | Questions Sofía couldn't answer: a weekly list and a bilingual FAQ | 3–4 | A read-only weekly list first, feeding the knowledge base | S-44, F-037 (part 2) |
| F-039 | Sofía sets herself up from the business's own website | 2 | Agency-run; drafts today's profile and hours as proposals a person accepts; speeds hand-run onboarding | F-037 (part 2), F-173 |
| F-043 | Sofía answers WhatsApp calls | 1 | Spike only; the 4–6 ew build is not planned | F-070, hypothesis H7 |
| | *Sofía subtotal* | *16.5–22.5* | | |
| **Calendar** | | | | |
| S-23 | Per-staff calendars and round-robin | 4–5 | Decision 4, once the owner's calendar has run with real clients | S-22, S-01, S-13, decision 4 |
| S-24 | Send-as-me | 1–2 | After the owner's calendar; in Google's second sensitive-scope review, with contacts sync | S-22 |
| S-25 | Drive and OneDrive pickers | 2–3 | Attach files already in the owner's cloud to the record | S-22, S-07 |
| S-26 | Contacts sync | 1–2 | After the owner's calendar; in Google's second sensitive-scope review (reported at 2–4 weeks) | S-22 |
| S-49 | Rooms and dates with holds | 2–3 | Rooms wait on decision 4 and per-staff calendars | S-23, F-051, decision 4, decision 22 |
| F-046 (part: the job card) | Run the day from the calendar: agenda, staff bookings, a job card | 2–3 | Needs visit statuses | F-052 |
| F-047 (part: services with durations, job address, questions, the email-or-phone rule) | Book the right thing: services, job address, questions, nobody turned away | 3–4 | Parity; with home services part one | F-037, F-015, S-40 |
| F-051 | Holds: a first-class booking state that a person confirms | 3–4 | The `held` status on today's single calendar, before the events pack that uses it | decision 22 (rooms only), hypothesis H4 |
| F-052 | "Va en camino": a live visit page driven by staff taps, not GPS | 3–4 | Staff taps and the text first, the live page second; needs A2P | A2P, F-046 (part 1) |
| | *Calendar subtotal* | *21–30* | | |
| **Money** | | | | |
| S-08 | In-house e-signature | 3–5 | Law, insurance, events and child care need it; it signs documents from the vault and waits on decision 1, which reverses the recorded non-adoption of e-signature (decision 2 sets only its scope, through F-057) | S-07, decision 1 |
| S-29 | Money: price book, quotes, invoices, schedules, bank (ACH) payments, links, Stripe Connect | 9–12 | Getting paid is the close; after M7a, entitlements and decisions 1 and 3 | S-62, S-13, F-196, decisions 1 and 3 |
| S-30 | Document templates | 2 | With money and e-signature | S-29, F-113 |
| S-31 | Portal on scoped tokens | 4–6 | Where links already sent land; after money | S-29, S-07, decision 9 |
| S-32 | QuickBooks push | 3–4 | Home services must-have; after money | S-29, F-196 |
| S-50 | Multi-payer schedules with cash | 2–3 | Events pack stands on it | S-29 |
| S-51 | Contract template library | 1–2 | With e-signature | S-08 |
| F-055 (part: money components) | The money kit: amounts that cannot be misread | 3–4 | With the money track | S-29 |
| F-056 | A quote you can say yes to | 4–5 | Thin parity on the money track | S-29, S-08, decisions 1 and 3 |
| F-057 | Sign on your phone, and understand it first | 4–6 | A vendor for v1 multi-signer, which departs from study decision 2's recommendation to defer e-signature vendors; if decision 2 says no, S-08 adds sequential signers in-house and multi-signer contracts (events, padrinos) wait for it; paired templates need counsel | S-08, F-113, decision 2 |
| F-058 | Pay the way the Valley pays | 3–4 | After M7a; Sofía's pay link needs A2P and consent | S-29, F-065, A2P |
| F-059 | Cash that leaves a trail: receipts, the day's cash, apartado, an 8300 heads-up | 2–3 | Receipts and the day's cash with the events pack | S-50, hypothesis H3 |
| F-061 | Everyone chips in: padrinos and family payers | 3–4 | Only if the Expo confirms padrinos pay separately | F-183, F-058, hypothesis H1 |
| F-062 | Mi Cuenta: one link for everything, with a light version on every plan | 5–6 | Stage 1 and a thin Stage 2 on S-31's tokens; carries View as customer and F-063's property view | S-31, F-004, decision 25 |
| | *Money subtotal* | *48–66* | | |
| **Messaging** | | | | |
| S-21 | Date triggers and repeating tasks | 1–2 | The engine every pack's clocks run on; after the job runner | F-196 |
| S-43 | Broadcasts and segments | 3–4 | On the consent ledger; the base F-030, F-066 and the packs need | S-05, F-093 |
| S-52 | Consent-ledger additions | 1 | With broadcasts | S-05 |
| F-065 (part: the preference page and the consent certificate, CSV first) | The consent ledger: one send gate, evidence for a lawyer, preferences in the customer's hands | 1–1.5 | A new public link, so it follows the public-page kit | F-102 (part 2) |
| F-066 (part: the per-business SB 140 registration card) | A marketing licence per business: message classes, SB 140, Texas calling hours | 0.5–1 | With broadcasts; the card records the business's SB 140 registration or its exemption basis, subject to counsel. The State's position in *Ecommerce Marketers Alliance v. Texas* (2025) is that SB 140's registration does not reach consent-based programmes, so the card records consent as the basis where the ledger proves it | S-43 |
| F-067 | Your number and your texting registration, done inside BIS | 8–10 | In-app registration and number purchase first; porting after | F-066 |
| F-068 (part: bilingual saved replies, open and closed states, assignment) | An inbox that works like the phone's messages app | 2–3 | Needs users (S-01) in use | S-01 |
| F-069 | Customers text the way they text family: photos, upload links, click-to-text | 3–4 | After A2P and the vault; absorbs F-028's attachment half | A2P, S-07 |
| F-070 (part: inbound threads and replies; templates only after the ledger) | WhatsApp through Telnyx, inbound first | 5–7 | Gated on H7 and Meta verification per client | F-065, hypothesis H7, decisions 2 and 23 |
| F-071 | Date and stage clocks: four trigger primitives for messages and team tasks | 5–7 | Four primitives, agency-configured first; the packs' clocks | S-21, F-196, decision 30 |
| F-072 | After the job: a two-question check-in, reviews without gating, replies in their language | 2–3 | An email check-in whose tap opens a page that posts; text replies after A2P | F-065, decision 29 |
| F-193 (part: lead-ad intake through the form pipeline) | Facebook and Instagram: ad leads and direct messages in the one inbox | 1.5–2 | The events segment's leads may live here | S-06, F-065, hypothesis H2, decision 2 |
| | *Messaging subtotal* | *33–45.5* | | |
| **Owner's day** | | | | |
| F-076 (part: Hoy, bands 1 and 4 and the work row) | Hoy: one home screen that starts the day | 3–4 | After the phone shell and the metric catalogue | F-107 (part 2), F-100 |
| F-077 (part: the dismissals table and the remaining sources) | The work queue finishes what it shows: one-tap actions and every loose end | 2–4 | Decision 33 (work-queue spec) | F-077 (part 1) |
| F-079 | Follow-ups that never leak | 4–6 | The promise first (with S-17); AI-drafted plans only after inbound email, the ledger and a decision | S-06, F-065, S-17 |
| F-081 | One notification router | 5–6 | Email and in-app first; push joins with F-108; the weekly report keeps its own recipients field | S-01 |
| F-083 | Quick capture: one "+" for walk-ins, calls, notes, bookings | 3 | Desktop capture first; the phone "+" after its amendment (decision 35) | F-107 (part 2) |
| | *Owner's day subtotal* | *17–23* | | |
| **Navigation** | | | | |
| F-091 | Links that land | 1–2 | One short-link service for alerts, QR codes and the portal | none |
| F-092 (part: one index across every record type, nickname expansion) | One search that finds García, across every record type | 4–5 | With Ask BIS | F-092 (part 1) |
| F-093 | Saved views as navigation | 3–4 | Tag, language, source and date filters; becomes broadcast segments | S-02 |
| F-095 (part: Ask, read-only, with S-18; F-031's text channel folded in) | One box: find, go, or ask, in either language | 3.5–4 | After the index and saved views | S-18, F-093 |
| F-096 (part: Negocio, Equipo y permisos, what BIS manages; larger text and more contrast from F-111) | Ajustes for owners: me, the business, what BIS manages | 3–4 | Owner settings beyond the switch; the display overrides once amendment 19's person overrides are ruled | F-084, F-117, decisions 28 and 29, decision 35 (row 19) |
| F-097 | "Pídele a BIS": a request button on everything the owner cannot change | 1.5–2 | The request button F-195's promise stands on | F-136 |
| F-099 (part: one launch plan for owner and agency) | One launch plan, two views | 2–3 | After the launch-plan amendment; absorbs F-163 | F-087, decision 35 (launch plan) |
| F-100 | Números: one catalogue of metrics | 8–11 | One catalogue and one engine for the Monday report, the brief and pack numbers | decision 24 |
| | *Navigation subtotal* | *26–35* | | |
| **Design** | | | | |
| S-37 | Installable web app with offline read | 2–3 | Push alerts and today's jobs offline; after the phone shell | F-107 (part 2) |
| F-102 (part: the public-page kit, before the first new public link) | The public pages, one kit: a front door that is accessible, fast and operable by agents | 4–6 | The preference page and the portal are the first new links | decision 26 |
| F-103 | WCAG 2.2 AA in the workspace | 3–4 | After the WCAG and look amendments and the licence ruling | decisions 26 and 35 |
| F-105 | The contract enforced: design lint, route-state tests, a styleguide with screenshots | 2 | Agents write most code; the contract must be a test | F-101 |
| F-106 | The state grammar: twelve designed states and honest pending actions | 3–4 | Honest pending states matter most on pay and sign pages | S-29, S-08 |
| F-108 | BIS on the home screen, with push alerts that work before A2P | 3–4 | Push alerts that work without texting | S-37, F-081 |
| F-109 (part: the connection banner and a read-only copy of today's agenda) | Works without signal: connection states, cached reads and a field outbox | 1–2 | On S-37's offline read | S-37 |
| F-113 | Paper that looks like the business: print and tagged PDF | 4–5 | Renderer spike, then quotes, invoices and contracts | S-29, S-08 |
| | *Design subtotal* | *22–30* | | |
| **Trust** | | | | |
| S-39 | Regulated-tenant mode | 1–2 | Holds regulated tenants; F-173's vetting covers the binding constraint until then | F-173 (decision 5 governs only its HIPAA-tenant behaviour, not the tax switch) |
| S-48 | Regulated-professional baseline | 2–3 | Law and insurance packs stand on it | S-04 |
| F-116 (part: one-time codes) | Caller identity checks scaled to each pack's risk | 1 | One-time codes are sent by text, so they follow A2P | A2P |
| F-117 (part: MFA and sessions the owner controls; Clerk's Spanish sign-in emails and widgets; the Clerk member cap priced) | Sign-in security the owner controls | 3–4 | Needed before the tax offer (decision 18). Clerk's component localization is experimental and does not reach its hosted Account Portal ([Clerk](https://clerk.com/docs/guides/customizing-clerk/localization)), and its emails come from dashboard templates, one set per instance ([Clerk](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates)), so bilingual invitations and codes need one bilingual template or emails sent by BIS; confirm before costing | S-01 |
| F-118 (part: the client-facing panel) | See when BIS looked: access transparency and an access log | 1.5–2 | With the law pack (Opinion 680) | S-55 |
| F-119 (part: error tracking, bilingual incident notices, a status page) | Know first, tell fast: monitoring, incidents, bilingual notices | 2 | An error tracker is a new vendor (decision 2) | decision 2 |
| F-120 (part: the fallback host) | Backups actually restored, and a phone line that survives an outage | 2 | A standby that keeps phones ringing when the platform is down | F-119 |
| F-121 (part: the whole business in one download, as a background job) | "Descargar todo": the whole business in one file, and a clean exit | 3 | Makes 'no lock-in' checkable | F-196 |
| F-123 | One retention engine | 3 | Minimisation defaults, then legal hold with the regulated packs | S-48, F-196 |
| F-124 (part: the public Trust Center) | The due-diligence pack and a public Trust Center | 1–2 | After the hardening sprint | F-114 |
| F-125 | A safe-harbour kit for the client's own business (SB 2610) | 1–2 | Pilot as content; build only if used | hypothesis H16 |
| F-126 | Children and minors: sensitive by default | 2–3 | Minor rules in the send gate and segments, with child care | F-004, S-43, S-42 |
| F-130 | A TRAIGA-ready AI record and a language-parity report | 1.5–2 | Proves the Spanish with numbers, on every plan | F-021 |
| F-133 (part: fraud and emergency flags; the call action is an offer, not a transfer) | Sentinel: one watcher for stop, fraud, health data and emergencies | 1.5–2 | After the notification router; decision 21 | F-081, decision 21 |
| F-134 | Privacy tiers for AI | 3–4 | U.S.-only processing and exclusion from evaluation sets, before the tax offer and the law pack | F-020, decision 6 |
| | *Trust subtotal* | *28.5–37* | | |
| **Growth** | | | | |
| S-33 | MCP server with auth spike | 3–4 | Parity with HubSpot and monday; the spike rules out agency-admin tokens | S-14, F-023, decision 6 (its read tools) |
| S-35 | Spreadsheet import (`.xlsx`, and Sheets through S-25's picker) with AI-suggested column matching from the headers only, Spanish headers included, and `.xlsx` export | 1–2 | CSV import with manual column matching already works; suggested matching speeds hand-run onboarding | S-25 (Sheets only) |
| S-36 | Importers from HubSpot and monday | 2–3 | When a switching prospect needs one; first compare BIS's own HubSpot and monday accounts with this plan through the vendors' connectors (study §14) | S-02 |
| F-136 | Agency cockpit and map | 5–7 | The health list first; the map when there are enough clients | F-196 |
| F-138 (part: no literal 'BIS' or 'Sofía' in strings) | Multi-agency white-label, with a three-level brand stack | 0.5–1 | With F-177's persona resolver | F-177 |
| F-140 | Hear your receptionist before you buy | 3–4 | A demo without tools first; share links only after the business phone is verified | F-037, F-039 |
| F-141 (part: the missed-call meter and the evidence card) | A CRM plan that texts without Sofía and sells its own upgrade | 1.5–2 | Sells the upgrade once plans are enforced | S-13, F-088 |
| F-142 | Pricing levers inside two or three plans | 4–6 | After M7a, decision 14 and a CPA's answer on Texas sales tax | S-62, decision 14 |
| F-144 | Scan, text, book: QR codes for the truck door, the flyer and the expo | 1 | QR codes per placement on the one short-link service | F-091, F-157 |
| F-145 | A partner programme for chambers, UTRGV and local associations | 1 | Run as sales activity until then; partner links without logos until the owner rules on the partner line (§6.5 row 23) | hypothesis H15 |
| F-152 (part: the child-care integration, costed as S-46) | Reach the systems a business already runs | 0 (study item) | With the child-care pack | research |
| F-195 | Una persona de BIS: a published local service promise | 2–3 | Publish only what was measured | F-097, F-136; the owner's commitment to staff a Spanish speaker for every published hour; study decision 14 (whether an in-person visit is included) |
| | *Growth subtotal* | *24–34* | | |
| **Agentic** | | | | |
| S-34 | Business Profile reviews and AI replies | 2–3 | After Google approves the API application filed this quarter | API approval, F-019 |
| F-159 | Public write paths that tell people, agents and bots apart, and hold likely spam | 2–3 | Spam holds and abuse limits | F-114 |
| F-161 | Keep Google, Apple and Bing telling the truth | 3–4 | Google only, after API approval, with a Book button that opens BIS's booking page (Place Action Links); decision 32 | S-34, F-037 (part 2), decision 32 |
| | *Agentic subtotal* | *7–10* | | |
| **Packs** | | | | |
| S-38 | Blueprint extensions and 'describe your business' | 3–4 | The pack engine the first pack needs | S-02, S-07, F-172 |
| S-40 | Home services part one | 2 | The first pack (decision 8), after the vault and blueprint extensions | S-07, S-38, S-21 (with F-071's primitives if decision 30 allows them) |
| S-41 | Home services part two, schedule and map views | 2–3 | After money and per-staff calendars | S-29, S-23 |
| S-42 | Child care | 4–6 | Fourth pack; the front-office position is tested with real centres first | S-29, F-004, S-43, S-37, S-46 |
| S-46 | Child-care system integration after research | 3–4 | Research first; with the child-care pack | research |
| S-54 | Events pack | 2–3 | Receptionist sold now; the pack after money, holds and validation | S-29, S-50, F-051 |
| S-55 | Law pack | 2–3 | Receptionist sold from next, with F-174's law module; the pack after the vault, e-signature and roles-enforced restriction | S-07, S-08, S-48, F-004 |
| S-56 | Insurance pack | 2–3 | Receptionist sold now; wins on the bundle | S-07, S-08, S-48, F-007 |
| S-59 | Route-service templates | 1 | Inside home services | S-40 |
| S-60 | Freight pilot | 2–3 | After the vault; a pilot, not a pack | S-07 |
| S-61 | Seasonal tax receptionist offer | 1 | For the January–April 2028 season, because its prerequisites (MFA per business, the security contract, U.S.-only processing) land in later, so the 2027 season is skipped (decision 34). A receptionist-only offer strains binding constraint 3 (every plan has the CRM): this plan's reading is the Sofía plan, CRM included, sold seasonally through F-142's levers. F-142 sits in the named tail, so if it slides into 2029 the 2028 season is sold as the ordinary Sofía plan for the months it is wanted (proposal), and only the seasonal price waits; a receptionist-only shape is study decision 14's to settle. Study decision 18's "stores no tax documents" is kept by a per-tenant switch that turns the vault's uploads off for a tax preparer, set at onboarding (F-173 part 2) and carried by S-39's regulated-tenant mode, both in later before the 2028 season (proposal; inside this 1 ew). It is a narrow exception to decision 25's every CRM feature on every plan, which the owner rules on | F-117, F-124, F-134, S-39, F-173 (part 2), F-142 (not blocking; see the cell before), hypothesis H11, decisions 14, 18 and 25 |
| F-171 | Pack manifest: the blueprint grows into a bilingual industry pack | 4–5 | Today's asset kinds and labels first, after the starter packs' evidence | S-38, F-172 |
| F-172 | Starter packs first, plus the five blueprint fixes | 2–3 | The archived-form capture fix ships now in §2.3; the other four fixes (apply to an existing company, the "Sales" pipeline collision, a pipeline switcher and stage editor, typed controls on public forms) ship here, inside this 2–3 ew; starter packs head the pack work | F-173 (part 1) |
| F-173 (part: onboarding picks the pack and its defaults) | Onboarding picks the pack and vets the tenant | 3–3.5 | With the pack manifest | S-38, F-171 |
| F-175 (part: law and child-care schemas) | Intake schemas: a pack-shaped intake that opens a deal through one proposal | 1 | No restricted field before F-004 | F-004 |
| F-177 | The business's own words: a bilingual pack lexicon | 2–3 | With the first pack; owns the persona-name resolver | F-013, F-171 |
| F-179 | Home services pack | 3–4 | Part one; part two is S-41's line | S-40, F-071, F-187 |
| F-180 | Route services module | 0.5–1 | Templates inside home services | S-59, F-052 |
| F-181 | Law pack | 6–8 | The full pack after the vault, e-signature, households and F-004 | S-55, F-004 |
| F-182 | Insurance pack (personal property and casualty) | 6–8 | Leads with renewals and written UM/PIP rejections | S-56, F-007, S-08 |
| F-183 | Events pack | 7–9 | After money, holds and the Expo's answers; multi-signer contracts wait on decision 2 (F-057) | S-54, F-051, hypotheses H1–H4 |
| F-185 | Child-care front office pack | 6–8 | Fourth pack; carries Sofía's child-care module (F-174's never-say lines: never whether a child is at the centre, a child's health or custody), which the canonical design already counts inside this figure | S-42, S-44, F-004, F-174, hypothesis H9 |
| F-187 | A living Texas rule library | 2–3 | Built with the first template that uses it (TSBPE, TDLR, UM/PIP) | S-51 |
| F-188 | Regulator-ready packets for every pack | 2–3 | The child-care packet with that pack | S-42, F-113 |
| F-199 | Restaurants start with Sofía at the front desk; the catering pack comes later | 2–3 | The owner named restaurants; carries F-174's catering never-say lines (the allergen rule). Sofía takes no table reservations or food orders: she texts (once decision 19 allows) or reads out the restaurant's own link and files large parties as leads. The catering pack waits on POS research | S-44, F-174, F-037 (part 2), hypothesis H10 |
| | *Packs subtotal* | *70.5–95.5* | | |
| | **Horizon total (136 rows)** | **359–492** | | |

### 4.6 Future bets (2029–2030)

**161.5–222.5 ew** against 520–624. The horizon is deliberately under-filled. What sits here needs a density BIS does not have (60–100 accounts, or eight tenants per pack), waits on a hypothesis, rides platforms that are still changing, or is worth less than what later already holds. Only one feature here scored above 3 on value: F-036, for its staff-takeover part. F-193's 4 is provisional.

The spare capacity is for what 2027 and 2028 teach.

**A 2030 direction (proposal, outside the costed total).** Two bets fit what BIS is building. First, a second border market: Laredo, El Paso or another Spanish-speaking Texas market, once the Valley holds 60–100 accounts and F-139's self-serve sign-up is live, because the bilingual product and the packs travel while the agency's local presence does not. Second, businesses on the Mexican side of the river, once the Spanish dashboard, the US$ and MX$ labels and the WhatsApp research have shown what they need, and only after counsel reads the cross-border privacy and payment rules. Each is a decision for its time, triggered by evidence, not a commitment.

| ID | Feature | Effort (ew) | Why in this horizon | Depends on |
|---|---|---|---|---|
| **Record** | | | | |
| F-003 (part: delegates the customer invites) | Family roles and delegates: padrinos, compadres, "habla por" and "paga por" | 3–4.5 | Needs the portal's Stage 2 and a confirmed H5 | F-062, hypothesis H5 |
| | *Record subtotal* | *3–4.5* | | |
| **AI** | | | | |
| F-024 | Customer memory: "What we know", used on the next call | 3–4 | v1 staff-entered facts, used only for callers identified by caller ID | F-019, F-116 |
| F-026 | Job debrief by voice | 2–3 | A record button on the booking, piloted with the first trades client, with the notetaker | S-20, F-019 |
| F-027 | Snap it: data plates and paper read into the record | 2–3 | Data plates for three brands, HVAC first, once equipment and intake exist | S-19, S-02 |
| F-028 | Photos and voice notes, understood | 2–3 | AI descriptions only after F-070 shows voice-note volume | F-069, F-070, hypothesis H7 |
| F-030 | Opportunity finder: revenue BIS spots and drafts for approval | 2–3 | One seasonal template per pack first; F-017's seasonal drafts fold in here | S-43, F-065, F-066 |
| | *AI subtotal* | *11–16* | | |
| **Sofía** | | | | |
| F-036 (part: live staff takeover) | A web chat that closes the loop | 2–3 | Needs realtime infrastructure nobody has built | F-036 (part 2) |
| F-040 | Rehearsal: test Sofía before her words go live | 2–3 | Only once owners edit what Sofía knows | F-037 (part 2), F-174 |
| F-041 | Sofía's one home: calls, website chats, what she knows, how she answers | 2–3 | Lean: calls, chats and a summary tab, after the sidebar amendment | F-089, F-036 |
| F-042 | Shared robocall shield across every BIS line | 2–3 | The cross-account signal needs more lines than four accounts | F-156 |
| | *Sofía subtotal* | *8–12* | | |
| **Calendar** | | | | |
| F-050 | Waitlists that call you back | 3 | The events path with F-051; generic waitlists only when a client asks | F-051 |
| F-053 | The job-done report the customer keeps | 3–4 | A typed report email first, photos with the vault | S-40, S-07 |
| | *Calendar subtotal* | *6–7* | | |
| **Messaging** | | | | |
| F-073 | Call customers from the business number on your own phone | 3–4 | After the number is owned or ported | F-067, F-141 |
| F-074 | RCS: verified, tappable messages | 3–4 | No demand evidence; SMS fallback still needed | F-067 |
| F-193 (part: Messenger and Instagram threads in the inbox) | Facebook and Instagram: ad leads and direct messages in the one inbox | 2.5–4 | Meta app review and a new inbox channel | F-193 (part 1), decision 23 |
| | *Messaging subtotal* | *8.5–12* | | |
| **Owner's day** | | | | |
| F-078 | Speed-to-lead clock | 1.5–2 | Reads F-022's author columns; one line under the report budget | F-022, F-100 |
| F-085 (part: role-tuned homes and hand-offs; no round-robin) | Mine, team and unassigned: role-tuned homes and hand-offs | 2–3 | Shops of five or more first; round-robin waits on decision 4 | S-01 |
| F-086 | One login and one Hoy across several businesses | 1–2 | A switcher under row-level security, one organisation at a time | S-01 |
| | *Owner's day subtotal* | *4.5–7* | | |
| **Design** | | | | |
| F-104 | One token source, many outputs | 2–3 | PDFs use today's CSS tokens first; one token source when outputs multiply | F-113 |
| F-109 (part: the field outbox, only if field demand appears) | Works without signal: connection states, cached reads and a field outbox | not costed | Replaying writes offline is the riskiest engineering in the list | hypothesis H12 |
| F-110 | A performance budget for Valley phones | 2–3 | Measure on a low-end Android first (skeletons ship now as a defect) | decision 35 (lite ground) |
| F-112 | Brand studio: one logo to every customer surface, previewed | 1.5–2 | Remove-logo, previews of existing surfaces, change history | none |
| | *Design subtotal* | *5.5–8* | | |
| **Trust** | | | | |
| F-121 (part: the exit wizard and deletion certificate, with no Drive copy) | "Descargar todo": the whole business in one file, and a clean exit | 2–3 | After the export has run for real clients | F-121 (part 1) |
| F-122 | Honour "delete me" and "what do you have on me" | 3–4 | After merge and retention; law, insurance and tax need it | S-12, F-123 |
| F-127 | Call recording done right | 2–3 | Opt-in after the disclosure; adds a `recording` consent purpose; no F-134 dependency | F-034, F-065 |
| F-128 | SOC 2: aligned now, attested when customers pay for it | 3–4 | No Valley buyer has asked | F-124 |
| F-129 | Field-level encryption and crypto-shredding | 6–8 | Narrow claim; needs a key-management vendor | S-55, decision 2 |
| F-131 | Verified licence badge | 2–3 | Manual TDLR and TSBPE checks with uploaded proof | F-179 |
| F-135 | Messages customers can trust: brand first, official channels, the business's own links | 2–3 | Brand-first texts, an official-channels page, a DMARC check; link domains wait for M6 | A2P |
| | *Trust subtotal* | *20–28* | | |
| **Growth** | | | | |
| F-137 | Setup partners: scoped seats for certified local helpers | 6–8 | Designed once with agency scoping | F-118, F-138, hypothesis H15 |
| F-138 (part: multi-agency white-label) | Multi-agency white-label, with a three-level brand stack | 13.5–19 | Decision 3 and §3.2 rule 9; needs a written decision | decision 3 |
| F-139 | Sign up in Spanish or English in ten minutes, with vetting at the door | 8–10 | After about 15 hand-onboarded accounts; write the M7 #2 spec first | S-62, F-173, F-067 |
| F-143 | Every customer surface recruits | 1 | Footer removal belongs to decision 25 and an amendment | F-091 |
| F-146 | The accountant's desk | 4–5 | Needs money and QuickBooks; a view-only seat is decision 14's | S-32 |
| F-147 | Consented test calls to your own line: an audit for prospects, a monthly check for clients | 7–9 | Revisits study §5.3; counsel first (decision 31) | decision 31 |
| F-149 | Open platform: API keys, signed webhooks, Zapier, Make and n8n | 3–4 | No client uses Zapier today; Meta is the channel H2 tests | F-115 |
| F-150 (part: the switch kit) | Switch kit: move in from GoHighLevel, Jobber or HoneyBook in a day | 4–5 | Spanish headers on S-35 first; the GoHighLevel importer when a prospect needs it | S-35, S-36 |
| F-152 (part: law and insurance adapters, costed as S-57 and S-58) | Reach the systems a business already runs | 0 (study item) | Tied to the first signed tenant that asks | research |
| F-154 | Valley benchmarks and the public Pulso del Valle | 4–5 | Needs 60–100 accounts | F-173 |
| F-155 (a trusted referral list in F-037, costed; handing leads between accounts, not costed) | Recomendados: a referral network between Valley businesses | 0.5–1 | Rests on H6; handing leads between accounts needs density and a privacy review | F-037 (part 2), hypothesis H6 |
| | *Growth subtotal* | *51–67* | | |
| **Agentic** | | | | |
| F-156 | Assistant callers get their own lane | 2–3 | Detection, a label and the cap exemption; measure the volume first | hypothesis H13 |
| F-160 | The business page assistants read | 3–4 | After F-037's second part; how it sits beside the websites BIS builds is decision 25's | F-037 (part 2), decision 25, hypothesis H19 |
| F-162 | What AI says about you: a monthly bilingual check | 2–3 | Other AI APIs are new vendors (decision 2) | F-037 |
| F-164 | A storefront for consumer agents | 5–7 | The protocols keep changing | F-156, F-051 |
| F-170 | Is this reviewer a customer? Review authenticity | 1.5–2 | After Business Profile reviews | S-34 |
| | *Agentic subtotal* | *13.5–19* | | |
| **Packs** | | | | |
| S-45 | Restaurant catering after POS research | 3–4 | Fifth pack; POS research first, and only once a restaurant pays | POS research, S-29, S-43 |
| S-57 | Law integrations after research | 3–4 | One adapter, tied to the first signed law tenant that asks | S-55, research |
| S-58 | Insurance integrations after research | 3–4 | One adapter, tied to the first signed insurance tenant that asks | S-56, research |
| F-176 | Packs with versions and approved updates | 8–10 | About six packs across dozens of accounts first | F-171 |
| F-184 | La fiesta: the family's event page | 3–4 | An event view of the portal, after validation | F-062, F-183, hypothesis H1 |
| F-186 | Catering module | 0.5–1 | Fifth pack | S-45, hypothesis H10 |
| F-189 | Self-service for policyholders and legal clients, behind an identity check | 4–6 | After the law and insurance packs and the portal's Stage 2 | F-181, F-182, F-062 |
| F-190 | Immigration and court status lookups, answered only after identity checks | 3–5 | USCIS onboarding and data sensitivity | F-181 |
| F-191 | The next packs from the same parts: studios, freight, grooming, homebuilders | 3–4 | The studios pilot first; grooming and homebuilder packs only if F-171 proves general. The study put the studios pilot in months 9–12 (outside its total); this plan moves it here (decision 34) | S-08, S-29, F-171 |
| | *Packs subtotal* | *30.5–42* | | |
| | **Horizon total (54 rows)** | **161.5–222.5** | | |

### 4.7 Folded or dropped

**Folded (13).** The feature's surviving part now lives inside another feature, whose effort includes it.

| ID | Feature | Canonical effort | Folded into | What survives, and why |
|---|---|---|---|---|
| F-012 | Bilingual parity by construction: a gate, a style sheet, reasons as codes | S (1.5–2) | F-013 | the ratchet gate ships with the runtime |
| F-018 | "¿Quién le recomendó?": word of mouth, measured | S–M (2–3) | F-157 | the source question; its report line waits for F-100 under decision 24, and the referral link waits on H6 |
| F-029 | A weekly report that reads the week | S (1–2) | F-100 | one report engine |
| F-031 | Ask BIS off the screen: by text and by WhatsApp voice note | M (3–4) | F-095 | the SMS channel of Ask, with S-18; the WhatsApp leg waits on H7 |
| F-060 | Pesos without pretending | M (3) | F-055 | the US$/MX$ labelling rule; peso presentment dropped |
| F-063 | Mi casa: a service record the homeowner keeps and can pass on | L (6–8) | F-062 | a property and equipment view; the transfer flow dropped |
| F-082 | The morning brief | S–M (2) | F-100 | a daily edition of the one digest, opt-in |
| F-090 | The module contract | S (1) | F-101 | a key pattern in DESIGN.md v2 |
| F-098 | View as, and marks for BIS-only surfaces | S (2) | F-087 | audiences in the manifest |
| F-111 | Display settings that follow the person | S (2) | F-096 | display settings in Mis preferencias's one store |
| F-163 | Findable, bookable, payable: the readiness meter | S (1–2) | F-099 | the launch plan |
| F-166 | Menus, packages and price sheets machines can read | M (2–3) | F-037 | packages and menus as sections, with the allergen rule |
| F-178 | Pack reports: four numbers per industry and a pack-aware hero | M (2–3) | F-100 | pack numbers from the one catalogue |

**Dropped (18).** Every one scored 1 or 2 on value. Each also has no segment asking for it, rides a platform BIS does not control, or reopens a position the study settled.

| ID | Feature | Canonical effort | Why dropped |
|---|---|---|---|
| F-016 | Winter Texans: a seasonal-resident profile | S–M (2–3) | unvalidated; a "Temporada" tag and two F-071 recipes if a trade client asks |
| F-032 | The owner line: call your own number to hear the day and file work | M–L (4–7) | voice-clone risk; nobody asked; F-116's rule stands |
| F-044 | Sofía interprets: on transfers and at the door | L–XL | phones will ship live call translation |
| F-045 | Callbacks the customer asked for, placed by Sofía | M (4–5) | study §5.3 stands: no outbound AI calls; F-033's callback rows go to people |
| F-054 | One record card in Gmail, Outlook, AI chats and on the lock screen | L (6–8) | no inbox-sync demand; revisit if customers ask |
| F-064 | In your phone's wallet: appointments, events and insurance cards | M (3–4) | nobody asked; F-048's calendar file covers appointments |
| F-075 | Branded caller ID for calls out | M (2–3) | serves outbound calling, which BIS limits |
| F-080 | Priority: the queue ranks by what is worth most, and says why | M (2–3) | small owners have few rows to rank |
| F-094 | Lenses: list, board, calendar and map | L (6–8) | the events month grid lives in F-183; a map link when a client asks |
| F-132 | A monthly trust note | S (1–1.5) | a security line in the report only when there is news, under F-100's budget |
| F-151 | MCP as a channel | M (3–4) | the study's MCP server, S-33, stays; directory listings dropped |
| F-153 | Sofía as a partner app inside vertical software | L–XL (8–14) | distribution outside the Valley; Jobber and Clio sell their own receptionists |
| F-158 | "Machines and assistants": one settings section | S (1–2) | settings cards arrive with their features |
| F-165 | "Book online" inside Google | L (6–10) | a Book button on the Google profile that opens BIS's booking page (Place Action Links, in F-161's scope) covers it |
| F-167 | Payable by agents: deposits against signed mandates | L (6–8) | agent payment rails belong to Stripe and the card networks, and BIS money is not built |
| F-168 | "Connect your assistant": customer-delegated agents | L (6–8) | no demand; needs the portal's Stage 2, payments and delegated sign-in |
| F-169 | Business-to-business agents: work orders from managers' systems | L (6–8) | no demand from Valley property managers; a bet on other companies' systems |
| F-192 | Seat, date and season forecasting per pack | L (6–8) | needs a season of data nobody asked for |

The 31 folded and dropped features carried **100.5–141.5 ew** in the canonical list, plus F-044's uncosted L–XL. About 8–10 ew of that moved into the targets.

**Also cut from features that stay:** F-115's hash chain witnessed in the owner's inbox (the history ships); F-095's voice input; F-102's slice for machine agents; F-134's on-device "Local" tier; F-121's copy to the owner's Drive; F-149's full public API and its Zapier and Make apps; F-159's lanes for AI agents; F-086's combined Hoy; F-063's transfer flow; F-060's peso presentment; F-018's referral link, which waits on H6; F-105's nightly screenshots; F-043's build, of which only the spike is planned; F-092's recent and frequent records per person (phase 6 keeps frecency and per-user history out of scope, and this plan keeps them out); and F-020's second model provider, which decision 2 would have to allow first.

F-109's field outbox and F-155's cross-account network are placed in future but not costed.

### 4.8 The sums

| Horizon | Effort (ew) | Study items | Features first placed here | Capacity at 5–6 ew a week |
|---|---|---|---|---|
| Before the first release | 31.4–45.8 | — | 16 | |
| The first release (eight items) | 53.5–73 | 9 | 16 | |
| The study's parallel work | 17–21.5 | 5 | 7 | |
| Riders | 10–13.5 | — | 6 | |
| **Now** (Q4 2026 to March 2027, 26 weeks) | **111.9–153.8** | **14** | **45** | 130–156 |
| **Next (H1 2027; April to June in practice)**, 13 weeks | **54.5–74** | **6** | **13** | 65–78 |
| **Later (H2 2027 to 2028)**, 78 weeks | **359–492** | **39** | **68** | 390–468 |
| **Future bets (2029–2030)**, 104 weeks | **161.5–222.5** | **3** | **42** | 520–624 |
| Folded into another feature | 0 (effort moved to the target) | — | 13 | |
| Dropped | 0 | — | 18 | |
| **Total** | **686.9–942.3** | **62** | **199** | |

**Every feature has exactly one disposition.** All 199 features (192 canonical and seven additions) are placed once. A split counts once, under its first horizon; within now, it counts under its disposition.

| Placement | Features |
|---|---|
| Before the first release | 16 |
| First release | 16 |
| The study's parallel work | 7 |
| Riders | 6 |
| Next | 13 |
| Later | 68 |
| Future | 42 |
| Folded | 13 |
| Dropped | 18 |
| **Total** | **199** |

**Every study item has exactly one horizon.** All 62 are placed: 9 in the first release, 5 in the parallel work, 6 next, 39 later and 3 future.
- The study's items not in its total (S-N1 to S-N16) stay outside, except where a feature costs part of one: the studios pilot (F-191, future); Meta lead ads (F-193, later); WhatsApp (F-070); a staff business number (F-073, future); sequences (F-079's second phase); NPS (F-072's check-in); and multi-currency (F-055's US$ and MX$ labelling rule, from F-060).
- HIPAA mode (S-N1) stays behind decision 5.
- Nothing here touches adult day care or home health.

**Against the study.**
- The study's items re-cost from 147–207 to **160–223.5 ew**: S-01 +3–5, S-07 +2, S-47 +7–8, S-53 +0.5 and S-62 +0.5–1.
- Features add **517.5–700 ew** on top, against the canonical list's 660–910. The folds, drops, splits and trims above account for the difference.
- The defects add 9.4–18.8 ew: §2.3's 13.9–23.3 ew less the 4.5 ew that sits in six feature slices, which the features line above already counts.

**Through 2028** (now, next and later), the plan is **525.4–719.8 ew**. The capacity for those 117 weeks is 585–702. The low bound fits. At six a week the high bound runs about 18 ew over, which later's named tail (18.5–26 ew) covers. At five a week it runs about 135 ew over (719.8 against 585, roughly half a year at that pace), all of it landing in later, which also receives the 32–34 ew that now's and next's cuts send it (§4.1, §4.4); the named tail covers less than a fifth of that, so the monthly pace check's re-scope, or added capacity, applies instead. At the study's conventional reading (one engineer, about 52 ew a year), the whole plan's 686.9–942.3 ew would be about 13 to 18 years of work; calendar time is read off the observed pace instead (§4.1).

**No horizon inversion.** A script checked every "Depends on" cell in the next, later and future tables against the horizon of what it names; the now tables carry no such column, and their prerequisites are named in the text (§4.1's rider rule and chain order). No checked part depends on work in a later horizon, and §3.2 rule 2 lists the cycles the plan breaks and the skeptic's inversions it resolves. One now-horizon dependency needed a change: Sofía's industry modules (F-174) are tested now against hand-run corpora of 20–30 bilingual conversations each, and the identity ladder (F-116 part) against hand-run test calls, not against F-021's harness, which is later; the harness re-runs both when it lands.

**The owner's asks, scheduled.**

| Ask | Now | Next | Later | Future |
|---|---|---|---|---|
| Plumbers and other trades | Sofía's guardrails; the call card (F-033); the booking fixes | The home-services Sofía module and intake; the agenda (F-046) | Starter packs, then home services parts one and two (S-40, S-41, F-179), money, QuickBooks | — |
| Restaurant owners | Discovery calls (H10); the CRM-only plan, with Sofía and the web chat not sold to restaurants until F-199's allergen rule ships | — | Sofía at the front desk (F-199), after H10: hours and large parties, the restaurant's own reservation or ordering link, never a food order and never an allergy promise | The catering pack (S-45, F-186), after POS research |
| Child day care | Discovery calls with three to five centres (H9); the CRM-only plan, with Sofía and the web chat not sold to centres until the child-care module ships | — | The child-care pack (S-42, F-185, which carries Sofía's child-care module), in 2028 after H9 | — |
| Others (insurance, events, law, tax) | Sofía sold to insurance and events (S-47); tax preparers held at vetting until the 2028 season (§5.14) | The law module, once the 680/705 sheet exists, and Sofía sold to law firms with it | Their packs (S-54 to S-56, F-181 to F-183); the seasonal tax offer for the 2028 season (S-61) | Law and insurance integrations (S-57, S-58) |
| Centralise each customer, with all documents | Staff and roles, the record model, the record page, the vault, inbound email (first release) | History, merge, document intake (S-19), a phone-contacts import (F-150 part 1) | Forms with uploads, e-signature, the portal, the paper back-file (F-197) | — |
| Use AI with the CRM | The review tray, the record summary, provenance, one model gateway | Document intake; Sofía's structured intake (F-175) | Drafting and translation, Ask BIS, the evaluation harness, the language-parity report, an MCP connection that reads and proposes (S-33) | Memory (F-024), voice debriefs (F-026) |
| Microsoft 365 and Google, such as calendars | Google branding and Microsoft publisher verification (S-27); Google and Microsoft sign-in (S-28); an add-to-calendar file on every booking (F-048 rider) | A private calendar feed for any phone calendar (F-048 part 2); the owner's calendar, Outlook first and Google after a review of its calendar scopes (S-22); Conexiones (F-148) | Send-as-me and contacts sync (a second Google review), Drive and OneDrive pickers (no review), per-staff calendars (decision 4) | Full inbox sync only on demand (S-N10) |
| Learn from the best CRMs | In the first release: HubSpot's three-column record and unified timeline; private files with expiry reminders (S-07); an address that files forwarded email to a record (S-06); monday's one-click summary (S-15), household grouping (S-02) and recency cue, a last-contact column and a "no contact in 30 days" filter on the contact list (S-03) | Merge with history (S-12), the change log (S-04), document intake (S-19) | Saved views; quote, accept and pay (S-29, F-056); the two-question check-in; the MCP server; importers from HubSpot and monday | — |

---

## 5. The feature areas

Section 4 says when and at what cost. This section says what each feature gives a Valley business and why it belongs. Titles, efforts and horizons are the catalogue's (Appendix A); an asterisk marks this plan's revised effort. A horizon reading "folded" or "dropped" means the feature does not ship on its own (§4.7). Everything in this section is a proposal, the design notes included: a note that rests on a DESIGN.md amendment or an owner decision names it, and none is settled until the owner dates it.

### 5.1 Client record and documents

This is the owner's first ask. A Valley business keeps its customers in a phone, a notebook and a filing cabinet; families decide together, a plumber needs the house and its water heater, and a day care needs a child's papers and who may collect them. Today one contact holds everything and no document can be stored. The first release makes one record per customer, with every document on it.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-001 | The record page: one kit, a card registry, and moving between records | One page per customer (who they are, what is happening, what they have), with the call button first on a phone | L (6.5–8.5 beyond S-03)* | now → later |
| F-002 | Clientes: people, families, businesses and places in one list | People, households, business customers and properties in one list, not a sidebar item each | S–M (2–3)* | later |
| F-003 | Family roles and delegates: padrinos, compadres, "habla por" and "paga por" | Relationships that read both ways in Spanish, padrinos included, and who may speak or pay for whom | M (4–6)* | now → later → future |
| F-004 | See who can see it: visibility marks, masked values, "View as customer" | Restricted fields enforced on the server, and masked values; "View as customer" moves to F-062 (§3.2 rule 2) | M (4–6)* | later |
| F-005 | The document vault, designed | Every document on the record: camera upload, scanning, versions, expiry in words, "7 de 9" checklists | M (2–3 beyond the revised S-07)* | now |
| F-006 | Duplicates found the Valley way, and a merge that keeps everything | Duplicates found across two surnames, accents and Mexican numbers, merged without losing history | S–M (2–3) | next |
| F-007 | Terms: one fixed record for anything that renews | Policies, service agreements, enrolment terms and contracts with dates, so no renewal is missed | M (3–4) | later |

**Design notes.**
- Three columns on a desk, one column on a phone in phone order; every card loads, empties and fails on its own. A record page names no hero (proposed; amendment 11).
- Deleting a document moves it to the trash at once with an undo; a typed name confirms only a permanent purge (rule 6).

**What we reject here.** Owner-built layouts and custom-object screens (packs choose the cards instead), HubSpot-style tabs, and, for the first record page, the five-deep peek stack (§6.7).

### 5.2 Bilingual and border

Most of Hidalgo County speaks Spanish at home (§3.1), callers switch language mid-sentence, relatives call from Reynosa, and "$" means pesos across the river. Being bilingual everywhere, including the owner's own screens, is the edge national tools do not have. Today Spanish reaches customers on some pages; the dashboard has none.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-008 | Language on every contact, as observed | Each contact carries a language: one observed on calls or texts, code-switching included, is suggested for approval, the customer's own choice or a staff edit sets it, and it picks every message's language | S (1–1.5 beyond S-09)* | now |
| F-009 | Mexican numbers, stored right | A Reynosa or Matamoros number stored as Mexican, and Sofía asks when a 10-digit number is ambiguous | S (1.5–2)* | now |
| F-010 | Every edge of the call in the caller's language, and Spanish robocalls caught | The greeting, transfer and goodbye in the caller's language, and Spanish robocalls refused | S–M (1.5–2 after the greeting defect)* | now |
| F-011 | The Valley-Spanish kit: twin drafting, a glossary, texts without the double bill | Spanish twins of every message drafted for approval, a Valley glossary, and texts that do not double in cost for one accent | M (3.5–4.5)* | now → later |
| F-012 | Bilingual parity by construction: a gate, a style sheet, reasons as codes | A build that fails on any customer string without its Spanish twin | S (1.5–2) | folded into F-013 |
| F-013 | The Spanish dashboard, in order of daily use | The owner's own screens, alerts and summaries in Spanish, per person, busiest screens first | M–L (4.5–7.5)* | now → next |
| F-014 | Spanish-ready components | Buttons, dates and amounts that survive Spanish's extra length and `es-US` formats | S (1–2)* | now |
| F-015 | Addresses from both sides of the river | Addresses that take colonias, landmarks and Mexican formats, so the technician finds the house | S–M (2–3) | later |
| F-016 | Winter Texans: a seasonal-resident profile | A seasonal-resident profile for snowbird customers | S–M (2–3) | dropped |
| F-017 | The Valley's year: seasons, two-country holidays, "same week last year" | Two-country holidays in quiet hours and "same week last year" comparisons | S–M (2–2.5)* | later |
| F-018 | "¿Quién le recomendó?": word of mouth, measured | One question that measures word of mouth | S–M (2–3) | folded into F-157 |

**Design notes.**
- Spanish is designed in: a pseudo-locale at +35% length, one `es-US` formatting layer, accents kept in capitals, and *usted* for platform strings, normalised by a paid Valley reviewer.
- What a customer wrote stays in their language with its own `lang`; a translation sits beside it, never in its place.

**What we reject here.** The Winter Texan profile (unvalidated; a tag and two recipes if a trade client asks), peso presentment (only the US$ and MX$ labels survive, in F-055), and fifty-language support.

### 5.3 AI across the CRM

The owner asked to use AI with the CRM. We assume a small owner has about an hour a day for the office (an assumption the discovery calls can test), so AI earns its place by summarising a record, drafting a reply in the customer's language and reading paper into fields, never by writing on its own, except the caller-confirmed acts decision 19 covers. Today AI answers calls (and can answer web chats once the agency switches the chat on for a company) and writes call summaries; its only suggestions are up to three per call, which a person accepts.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-019 | One review tray for every AI suggestion | One place where every AI suggestion waits with its evidence: Accept, Edit and accept, Discard, and an undo | M (4–5 beyond S-14)* | now |
| F-020 | One door for every model call: gateway, budgets, registry | A model budget per account, kill switches, and one place that keeps health-marked documents and fields from new model paths | M (2–3)* | now → next |
| F-021 | The report card: a bilingual evaluation harness | Measured AI accuracy in Spanish, English and both at once | M–L (5–7)* | later |
| F-022 | Provenance: every write says who made it; Sofía's acts visible and reversible | Every change names its author (a person, Sofía, an automation, the customer), and Sofía's acts can be undone | M (2.5–3)* | now |
| F-023 | One tool belt for every assistant | Sofía, the chat, Ask BIS and the MCP server share one set of guarded tools | M (4–5)* | later |
| F-024 | Customer memory: "What we know", used on the next call | A "What we know" card ("call after 5") that Sofía uses on the next call | M (3–4) | future |
| F-025 | The composer that writes and translates | Replies drafted in the customer's language, with the translation beside the original | M (4–5 beyond S-16)* | later |
| F-026 | Job debrief by voice | A short voice note after a job becomes proposed record updates | M (2–3)* | future |
| F-027 | Snap it: data plates and paper read into the record | A photo of a data plate or a paper form becomes proposed fields | M (2–3) | future |
| F-028 | Photos and voice notes, understood | A texted photo or Spanish voice note described and summarised in the thread | M (2–3)* | future |
| F-029 | A weekly report that reads the week | A short "what stood out" paragraph under the Monday numbers | S (1–2) | folded into F-100 |
| F-030 | Opportunity finder: revenue BIS spots and drafts for approval | One to three seasonal campaigns, drafted from the record for approval | M (2–3) | future |
| F-031 | Ask BIS off the screen: by text and by WhatsApp voice note | Questions to BIS by text from the owner's phone | M (3–4) | folded into F-095 |
| F-032 | The owner line: call your own number to hear the day and file work | Calling the business number to hear the day and file work | M–L (4–7) | dropped |

**Design notes.**
- AI appears where the work is (the record's summary, the tray, the box), marked "Generado por IA". There is no auto-accept at any confidence, and "Aceptar las 3" never overwrites a filled field.
- A weekly line, "Aceptó el 82% de las sugerencias", keeps approval honest rather than a rubber stamp.

**What we reject here.** A top-level AI section or chat pane, the owner line (voice-clone risk, and nobody asked), and a second model provider until decision 2 allows it.

### 5.4 Sofía and the web chat

Sofía is what BIS sells first. For a plumber on a roof or a venue on a Saturday night, a missed call is a lost job, and a Spanish-speaking mother who hears English at the edge of the call hangs up. She has handled real calls; what she needs now is honesty up front, exact answers from the business's own facts, a card for every call and a handoff that never fails silently.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-033 | Every call leaves a card: reason, callback number, the caller's words | Who called, why, and the number to call back, readable in three seconds | S–M (2–3)* | now |
| F-034 | Honest by design: disclosure, a way to a person, the transcription notice | Sofía and the chat say they are AI, offer a person, and give the transcription notice | S (1.5–2) | now |
| F-035 | Warm handoff: transfers that never fail silently | A whispered summary before a transfer, and an alert and a task when a transfer fails | M (3–5)* | later |
| F-036 | A web chat that closes the loop | Chats and their transcripts in the inbox, then booking from the chat, then staff takeover | M (3.5–6)* | now → later → future |
| F-037 | One source of truth for what the business says | Hours, services, prices and menus as dated facts that Sofía quotes exactly | L (7–8.5)* | now → later |
| F-038 | Questions Sofía couldn't answer: a weekly list and a bilingual FAQ | A weekly list of what callers asked that Sofía could not answer, and a bilingual FAQ from it | M (3–4)* | later |
| F-039 | Sofía sets herself up from the business's own website | Sofía's profile drafted from the business's website or Google profile | S (2) | later |
| F-040 | Rehearsal: test Sofía before her words go live | Simulated callers test a change before it goes live | M (2–3) | future |
| F-041 | Sofía's one home: calls, website chats, what she knows, how she answers | One place for her calls, chats, knowledge and answers | M (2–3)* | future |
| F-042 | Shared robocall shield across every BIS line | A robocaller refused on one BIS line is refused on all of them | S–M (2–3) | future |
| F-043 | Sofía answers WhatsApp calls | A one-week spike, only if WhatsApp demand shows | S (1, spike only)* | later |
| F-044 | Sofía interprets: on transfers and at the door | Live interpretation on transfers and in person | L–XL | dropped |
| F-045 | Callbacks the customer asked for, placed by Sofía | Callbacks placed by Sofía | M (4–5) | dropped |

**Design notes.**
- Presence shows only on plans with Sofía, and on a phone as a dot with a word ("En llamada"), never a bare dot (proposed; amendment 5).
- Owners edit the business status and closures now and facts later; guardrails never become owner-editable (proposed; if decision 28 rules so).

**What we reject here.** Live interpretation (Samsung and Apple phones already translate calls, Spanish included), and callbacks placed by Sofía: the study's "no outbound AI calls" stands, and the callback rows F-033 creates go to people.

**Not in this plan: Sofía by text (proposal to defer).** GoHighLevel's and Podium's AI employees answer customers' texts and chats as well as calls (the study's Appendix C), and Valley customers text. An AI that answers inbound texts and WhatsApp threads is left out of this plan for four reasons: it revisits the SMS spec's exclusion of inbound auto-replies; it cannot start before the send gate and A2P; it would be a higher-plan feature under binding constraint 3; and every reply it sends needs its own reading under decision 19, because a text thread has no clear end and rule 4 exempts only replies inside a live call or chat the customer started. Its natural shape is the web chat's persona on text and WhatsApp threads, answering from F-037's facts, with drafts a person approves and only caller-requested acts live. Bring it back as a proposal once F-036 and F-070 have run with real clients, or sooner if a client asks.

### 5.5 Calendar, booking, visits, Google and Microsoft

The schedule is the business. Today there is one calendar per company, no way to book a phoned-in job from the dashboard, no closures, and no sync with the owner's own calendar, so the two can double-book. Calendar sync with Google and Outlook is the study's own track (S-22 to S-28; §7); the features below make the calendar the whole schedule and cut no-shows.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-046 | Run the day from the calendar: agenda, staff bookings, a job card | A day and week agenda where staff book phoned-in jobs, then a job card | M–L (5–7)* | next → later |
| F-047 | Book the right thing: services, job address, questions, nobody turned away | Services with their own lengths, a job address and questions, and nobody refused for their email address | M (3.5–4.5)* | now → later |
| F-048 | Manage my appointment: move in place, cancel with a way back, add to calendar | Move or cancel in two taps, a notice when the business cancels, and an add-to-calendar file; then a private feed that puts every booking on the owner's own phone calendar | M (3–3.5)* | now → next |
| F-049 | Reminders that reach people: their language, their channel, however late they booked | Reminders in the customer's language and channel, even for late bookings | S (1.5)* | now → next |
| F-050 | Waitlists that call you back | "¿Le avisamos si se abre un espacio?" on a full day, and a freed slot offered to the list | M (3) | future |
| F-051 | Holds: a first-class booking state that a person confirms | A tentative hold, placed by a person or an assistant, that a person confirms | M (3–4)* | later |
| F-052 | "Va en camino": a live visit page driven by staff taps, not GPS | "On my way" texts and a live visit page from staff taps | M (3–4) | later |
| F-053 | The job-done report the customer keeps | A service summary the customer keeps after each visit | M (3–4) | future |
| F-054 | One record card in Gmail, Outlook, AI chats and on the lock screen | The record card inside Gmail, Outlook and AI chats | L (6–8) | dropped |

**Design notes.**
- Customer pages show time in words ("Horario de McAllen (hora del centro)") and step dots that render.
- Rooms as bookable resources wait for per-staff calendars (decision 22); holds ship first on today's single calendar.

**What we reject here.** The Gmail and Outlook record card (no inbox-sync demand), a generic list-board-calendar-map lens framework (the events month grid lives in F-183), and GPS tracking or routing, which the study says not to build.

### 5.6 Money and the customer portal

Getting paid is the close, and every pack depends on it. Valley customers pay in instalments, in cash, by bank, and sometimes several relatives pay for one quinceañera. Today BIS takes no money for its clients: the platform spec recorded payments, invoicing, documents and e-signature as non-goals, and study decision 1 would reverse that.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-055 | The money kit: amounts that cannot be misread | Amounts that cannot be misread ("USD" where pesos could appear) and one pipeline total | S now (1), M later (3–4) | now → later |
| F-056 | A quote you can say yes to | Up to three options with clear tax lines, accepted and signed on a phone | M (4–5) | later |
| F-057 | Sign on your phone, and understand it first | Documents signed on a phone in the customer's language, with a plain explanation first | M (4–6) | later |
| F-058 | Pay the way the Valley pays | Pay pages in the customer's language, instalments, low-fee bank payments, and a pay link from Sofía | M (3–4) | later |
| F-059 | Cash that leaves a trail: receipts, the day's cash, apartado, an 8300 heads-up | Cash receipts, the day's cash, layaway, and a heads-up before the IRS Form 8300 line | S–M (2–3) | later |
| F-060 | Pesos without pretending | US$ and MX$ labels | M (3) | folded into F-055 |
| F-061 | Everyone chips in: padrinos and family payers | A quote line a padrino sponsors and pays separately | M (3–4) | later |
| F-062 | Mi Cuenta: one link for everything, with a light version on every plan | One magic link to the customer's visits and messages, then what they owe and must sign | M (5–6 beyond S-31)* | later |
| F-063 | Mi casa: a service record the homeowner keeps and can pass on | A property and equipment view in the portal | L (6–8) | folded into F-062 |
| F-064 | In your phone's wallet: appointments, events and insurance cards | Wallet passes for appointments and cards | M (3–4) | dropped |

**Design notes.**
- Pay and sign pages use the irreversible pattern: one submission, a "Procesando" state with no second Pay button, and a result that says exactly what happened.
- Where the portal's second stage sits in the plans is decision 25's to make, not settled here.

**What we reject here.** Wallet passes (the calendar file covers appointments), peso presentment, the homeowner-transfer flow, and payment by consumer agents (§5.13).

### 5.7 Messaging, calling and consent

Valley customers text, and they say "ALTO", not "STOP". The consent ledger carries the plan's one legal date, and one inbox that works like a phone's messages app is what owners compare BIS with. Today texting is built but switched off for every company, and customer email replies never come back.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-065 | The consent ledger: one send gate, evidence for a lawyer, preferences in the customer's hands | One send gate every message passes, stop words in both languages, and a consent certificate a lawyer can use | M (3–4 beyond S-05; 5–7 with it)* | now → later |
| F-066 | A marketing licence per business: message classes, SB 140, Texas calling hours | Message classes, Texas calling hours in the recipient's time, and an SB 140 check before marketing texts | S–M (2–2.5)* | now → later |
| F-067 | Your number and your texting registration, done inside BIS | A number bought and the texting registration filed inside BIS, with its status in plain words | L (8–10)* | later |
| F-068 | An inbox that works like the phone's messages app | A multi-line composer on the customer's channel, saved replies, and open and done states | M (3–4)* | now → later |
| F-069 | Customers text the way they text family: photos, upload links, click-to-text | Texted photos land on the record, plus upload links and click-to-text | M (3–4) | later |
| F-070 | WhatsApp through Telnyx, inbound first | A WhatsApp link that measures demand, then WhatsApp threads in the inbox | M–L (5.5–8)* | next → later |
| F-071 | Date and stage clocks: four trigger primitives for messages and team tasks | Four fixed triggers (a date, a stage, a document expiring, a visit done) that send messages and create tasks | M–L (5–7 beyond S-21; 6–9 with it)* | later |
| F-072 | After the job: a two-question check-in, reviews without gating, replies in their language | A two-question check-in after a job, and review requests without gating | S–M (2–3) | later |
| F-073 | Call customers from the business number on your own phone | Callbacks from a personal phone that show the business number and are logged | M (3–4) | future |
| F-074 | RCS: verified, tappable messages | Verified, branded messages with SMS fallback | M (3–4) | future |
| F-075 | Branded caller ID for calls out | Branded caller ID on outbound calls | M (2–3) | dropped |

**Design notes.**
- Where texting is not ready, the channel says so in plain words ("Esperando a las compañías telefónicas · 3–7 días hábiles") instead of a tab that fails on send.
- Enviar stays the composer's only primary; the reminder chip is ghost.

**What we reject here.** Branded caller ID (it serves outbound calling, which BIS limits). The rule builder stays deferred; four fixed primitives answer the packs' clocks (decision 30), and sequences wait for their own decision.

### 5.8 The owner's day

DESIGN.md's test is a business owner reading at 7 AM. Today's dashboard is built around Sofía: its hero is "Calls answered" for everyone, so a CRM-only plan's headline number would always be 0, and the 7-day tiles never say which days they cover. These features start from the day: what happened, what needs the owner, and one tap to finish it.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-076 | Hoy: one home screen that starts the day | One screen at 7 AM: overnight news, what needs the owner, today's appointments, one number | M (3.5–4.5)* | now → later |
| F-077 | The work queue finishes what it shows: one-tap actions and every loose end | Accept, reply, done and snooze in place, with every loose end on the list | M–L (5–7)* | next → later |
| F-078 | Speed-to-lead clock | "Esperando 12 min" on every new lead | S (1.5–2) | future |
| F-079 | Follow-ups that never leak | "Recuérdeme si no responde en 2 días", then follow-up plans a person approves | M (4–6) | later |
| F-080 | Priority: the queue ranks by what is worth most, and says why | A queue ranked by value | M (2–3) | dropped |
| F-081 | One notification router | Each alert to the right person, on the right channel, in their language | M (5–6)* | later |
| F-082 | The morning brief | A daily edition of the digest | S–M (2) | folded into F-100 |
| F-083 | Quick capture: one "+" for walk-ins, calls, notes, bookings | Five-second capture of a walk-in, a personal-phone call, a note or a booking | M (3) | later |
| F-084 | One switch: open, closed today, running late, storm | One tap tells Sofía, the booking page and the chat that the business is closed, late or shut by a storm | S–M (2)* | now |
| F-085 | Mine, team and unassigned: role-tuned homes and hand-offs | Assignment with Mine and Unassigned now, role-tuned homes in 2029–2030 | M (2–3)* | now → future |
| F-086 | One login and one Hoy across several businesses | A company switcher for owners of more than one business | S (1–2)* | future |

**Design notes.**
- Hoy is four bands, the first two above the fold on a phone; its hero is the headline number the metrics catalogue picks for the plan and pack (§6.3) (proposed; amendment 11, decision 24).
- Work goes to Pendientes, news to the timeline; there is no third inbox (proposed; amendment 7).
- **A second location (proposal, not costed).** A business with two branches, centres or sites stays one account in this plan, with each location's staff and bookings on S-23's per-staff calendars; a location model with its own hours and address waits until H23's answers show the need. Separate businesses, with their own brand and books, are separate accounts under F-086's switcher.

**What we reject here.** Ranking the queue by value (small owners have few rows), a notification bell, and a combined Hoy across businesses unless a client asks.

### 5.9 Navigation, search and settings

The study roughly triples what the product holds, and GoHighLevel resellers sell a 17-item sidebar. Today the owner can change only branding, the booking settings and forms without the agency, and "Garcia" does not find "García". These features keep the product findable: one map, one search box, one settings page the owner can use without calling.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-087 | One map of the product: a surface manifest every menu reads | Every menu, the search box and settings read one map, so nothing is missing from any of them | M (2.5–3.5)* | next |
| F-088 | Show what the business uses: five surface states and one upgrade page | Honest states in plain words and one upgrade page, never padlocks | S–M (2–3) | next |
| F-089 | The 2027 sidebar: a fixed spine, four module slots, a budget of nine | Five fixed items (Hoy, Pendientes, Clientes, Bandeja, Agenda) and at most nine in all | S (1.5–2) | next |
| F-090 | The module contract | One rule for how a module appears | S (1) | folded into F-101 |
| F-091 | Links that land | Short links from every alert and QR code straight to the right record | S (1–2) | later |
| F-092 | One search that finds García, across every record type | Search that ignores accents and finds full names and any phone format, across every record | M–L (5.5–7)* | next → later |
| F-093 | Saved views as navigation | Filters as plain chips, saved as the owner's own lists ("¿quién me debe?") | M (3–4)* | later |
| F-094 | Lenses: list, board, calendar and map | Any list as a board, calendar or map | L (6–8) | dropped |
| F-095 | One box: find, go, or ask, in either language | One box to find, go, or ask a read-only question in either language | M (5–5.5)* | next → later |
| F-096 | Ajustes for owners: me, the business, what BIS manages | Owner settings: my account, the business, and what BIS manages | M (3.5–5)* | now → later |
| F-097 | "Pídele a BIS": a request button on everything the owner cannot change | A request button on everything BIS manages, tracked to done | S (1.5–2) | later |
| F-098 | View as, and marks for BIS-only surfaces | "View as owner" for the agency | S (2) | folded into F-087 |
| F-099 | One launch plan, two views | One launch plan by plan and pack: a short list for the owner, the full one for the agency | M (3–4) | now → later |
| F-100 | Números: one catalogue of metrics | One definition for every number, used by tiles, the Monday report and pack reports | L (8–11 with F-029, F-082, F-178)* | later |

**Design notes.**
- The sidebar spine, the one box and one launch plan each need a DESIGN.md amendment (rows 7, 8 and 9 in §6.5); until they are dated, new modules go into today's sidebar groups.
- "Ask" never writes; the box offers no creates (F-083 owns them) and no destructive action, and today's harmless actions, such as the theme toggle, stay; "ask" shows its filter chips before any number.

**What we reject here.** The lens framework (L effort for parity), a sidebar that reorders itself by usage, and a top-level "Tu negocio en internet" section.

### 5.10 Design system, accessibility and mobile

Owners run the business from a phone, often a mid-range Android on weak signal, and some are older readers. Northern Lights keeps its colours, radii and surfaces; it gains a phone, a second language, named states, and rules that tests enforce, because agents write much of the code and CI is the only reviewer every merge must pass.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-101 | DESIGN.md v2: extend the contract and settle its contradictions | A contract that covers records, documents, money, phones and Spanish, changed only by dated decisions | S (1–2)* | now |
| F-102 | The public pages, one kit: a front door that is accessible, fast and operable by agents | Customer pages in Spanish from the first paint, the business's name as the heading, and branded dead ends | M–L (4.5–6.5)* | now → later |
| F-103 | WCAG 2.2 AA in the workspace | Readable labels and field edges for low-vision and older owners, with an honest ledger | M (3–4) | later |
| F-104 | One token source, many outputs | One brand, identical on screen, email, PDF and checkout | M (2–3) | future |
| F-105 | The contract enforced: design lint, route-state tests, a styleguide with screenshots | Lint rules and route-state tests that catch hard-coded colours and missing states | S (2)* | later |
| F-106 | The state grammar: twelve designed states and honest pending actions | Twelve named states and honest pending actions ("No se cobró nada") | M (3–4)* | later |
| F-107 | Phone first: a bottom-tab shell and content that fits its container | A usable phone width now, then a bottom-tab shell | L (6.5–8)* | now → next |
| F-108 | BIS on the home screen, with push alerts that work before A2P | Install to the home screen with the business's icon, and push alerts that work before texting | M (3–4) | later |
| F-109 | Works without signal: connection states, cached reads and a field outbox | A connection banner and today's agenda readable without signal | S (1–2 planned; the outbox not costed)* | later → future |
| F-110 | A performance budget for Valley phones | Fast screens on a mid-range Android over throttled 4G | M (2–3)* | future |
| F-111 | Display settings that follow the person | Theme and text size per person | S (2) | folded into F-096 |
| F-112 | Brand studio: one logo to every customer surface, previewed | Remove a logo, preview each customer surface, and see a change history | S (1.5–2)* | future |
| F-113 | Paper that looks like the business: print and tagged PDF | Quotes, invoices and contracts as accessible PDFs in the business's brand | M (4–5) | later |

**Design notes.**
- Every new surface is drawn at 390 px first: 44 px targets, 16 px inputs, the main action within the thumb's reach (proposed; amendment 20's Layout and touch section).
- No new colours beyond the accessibility tokens of amendment 17, and no new radii, shadows or surfaces; any lighter rendering for cheap phones is chosen by measurement, as the 2026-09-09 blur decision was.

**What we reject here.** A native app now (decision 10: installable web app first), new typefaces and animated glows, and the offline outbox until field demand is shown.

### 5.11 Trust, security and compliance

Law firms, insurance agencies and tax preparers answer to regulators and ask vendors for proof; the Valley is primed for impersonation; and a small owner needs to know their data is safe and can leave with them. Today the quality gates are strong but operations are thin, and the known security items are tracked privately (§2.3).

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-114 | A 30-day hardening sprint | The known security items closed before client sign-ins scale | M–L (5–6.5)* | now |
| F-115 | Evidence-grade records | A full change history, with before-and-after values, on every record | M (2–3.5)* | now → next |
| F-116 | Caller identity checks scaled to each pack's risk | Identity checks scaled to each pack's risk; a voice alone never proves who is calling | M (2.5–3)* | now → later |
| F-117 | Sign-in security the owner controls | Two-step sign-in, sessions the owner can end, and Clerk's sign-in emails and widgets in Spanish | M (3.5–4.5)* | now → later |
| F-118 | See when BIS looked: access transparency and an access log | A log the owner can read of each time BIS staff opened their data, and why | M (2.5–3.5)* | now → later |
| F-119 | Know first, tell fast: monitoring, incidents, bilingual notices | BIS hears of a failure first, and clients get bilingual notices | M (3–3.5)* | now → later |
| F-120 | Backups actually restored, and a phone line that survives an outage | A tested restore, and phones that ring through when the platform is down | M (3.5–4)* | now → later |
| F-121 | "Descargar todo": the whole business in one file, and a clean exit | The whole business in one download, and a clean exit | M (5–6) | later → future |
| F-122 | Honour "delete me" and "what do you have on me" | A customer deleted everywhere, or shown what BIS holds, with a certificate | M (3–4) | future |
| F-123 | One retention engine | Data kept as long as the law asks and no longer, with legal hold | M (3) | later |
| F-124 | The due-diligence pack and a public Trust Center | The Opinion 680/705 sheet, the subprocessor list and security answers a firm can file | M (2–3) | now → later |
| F-125 | A safe-harbour kit for the client's own business (SB 2610) | A written security programme scaled to the business, which under SB 2610 can bar exemplary (punitive) damages after a breach, for a business under 250 employees that holds sensitive personal information. Every size needs safeguards within a recognised framework: simplified requirements (password rules and staff training) below 20 employees, CIS Controls IG1 from 20 to 99, and full framework compliance from 100 to 249. Actual damages remain; counsel confirms before any sales use | S (1–2)* | later |
| F-126 | Children and minors: sensitive by default | Guardian-first messaging; children's data never used for marketing | M (2–3) | later |
| F-127 | Call recording done right | Opt-in call audio after a disclosure | M (2–3) | future |
| F-128 | SOC 2: aligned now, attested when customers pay for it | Controls documented in 2029–2030, attested when customers pay for it | M (3–4) | future |
| F-129 | Field-level encryption and crypto-shredding | The most sensitive fields encrypted per account | L (6–8) | future |
| F-130 | A TRAIGA-ready AI record and a language-parity report | Proof, in numbers, that Spanish callers are served as well as English ones | S–M (1.5–2) | later |
| F-131 | Verified licence badge | Licences checked and shown as verified | M (2–3) | future |
| F-132 | A monthly trust note | A monthly security email | S (1–1.5) | dropped |
| F-133 | Sentinel: one watcher for stop, fraud, health data and emergencies | Stop requests written in a sentence caught in either language, then fraud and emergency flags | M (2.5–3)* | now → later |
| F-134 | Privacy tiers for AI | A protected tier: U.S.-only processing and no use in evaluation sets | M (3–4)* | later |
| F-135 | Messages customers can trust: brand first, official channels, the business's own links | Texts that lead with the business's name, and an official-channels page | S–M (2–3)* | future |

**Privacy law (a reading for counsel to confirm, proposal).** Texas's Data Privacy and Security Act (TDPSA, in force since 1 July 2024) exempts businesses that are small under the U.S. Small Business Administration's definitions, which covers most of BIS's clients and probably BIS itself, except for one rule that still binds them: sensitive data, children's data included, is not sold without consent. Where a client is covered, BIS acts as its processor and owes the processor duties (a contract, help with customers' requests, deletion at the end). Insurance agencies fall under the Gramm-Leach-Bliley Act, which the TDPSA exempts (§541.002(b)(2)), and law firms answer to their own professional rules; and child-care data is sensitive whether or not the TDPSA applies (study decision 6). So F-122's full "delete me" and "what do you have on me" can wait for 2029–2030, but not the path itself: today bulk delete skips any contact with a booking, deal or conversation, so until F-122 ships the agency honours a deletion request by hand, following a short runbook step this quarter, and counsel confirms which clients the TDPSA reaches.

**Design notes.**
- Trust is shown in plain words where the owner looks ("Lo guardamos el tiempo que la ley pide, y no más"), not in a separate security section.
- Security specifics never appear in this repository; the sprint is named and counted only.

**What we reject here.** The monthly trust note (a line in the report only when there is news), the hash chain witnessed in the owner's inbox, and an on-device "Local" AI tier.

### 5.12 Growth, agency and platform

BIS is a small local agency. To serve 50 to 100 businesses it needs problems to find the agency rather than the other way round, an entry plan that sells its own upgrade honestly, and a way for switching prospects to move in quickly. Today every company is created by hand and the agency's home shows four all-time totals.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-136 | Agency cockpit and map | A health list of every client: quiet, failing or over its allowance | M–L (5–7)* | later |
| F-137 | Setup partners: scoped seats for certified local helpers | Scoped seats for certified local setup helpers | L (6–8) | future |
| F-138 | Multi-agency white-label, with a three-level brand stack | No hard-coded "BIS" or "Sofía" (later); other agencies reselling under their own brand (2029–2030) | XL (14–20) | later → future |
| F-139 | Sign up in Spanish or English in ten minutes, with vetting at the door | Self-serve sign-up in either language, with vetting at the door | L (8–10)* | future |
| F-140 | Hear your receptionist before you buy | A prospect hears Sofía answer as their business before paying | M (3–4)* | later |
| F-141 | A CRM plan that texts without Sofía and sells its own upgrade | The entry plan texts without Sofía, then shows the calls it missed | M (3–4) | now → later |
| F-142 | Pricing levers inside two or three plans | Seasonal and annual levers inside the fixed plans | M (4–6) | later |
| F-143 | Every customer surface recruits | An attributed footer on customer pages | S (1)* | future |
| F-144 | Scan, text, book: QR codes for the truck door, the flyer and the expo | QR codes per placement for the truck door, flyer and expo, with results | S (1)* | later |
| F-145 | A partner programme for chambers, UTRGV and local associations | A co-branded page once a chamber signs | S (1)* | later |
| F-146 | The accountant's desk | A bookkeeper's view across the clients they serve | M (4–5) | future |
| F-147 | Consented test calls to your own line: an audit for prospects, a monthly check for clients | Automated test calls to a business's own line; a person places them by hand meanwhile | L (7–9)* | future |
| F-148 | Connections: one page to find, connect, see and revoke every integration | One page to connect, see and cut every integration | M (2)* | next |
| F-149 | Open platform: API keys, signed webhooks, Zapier, Make and n8n | API keys and signed webhooks for outside tools | M (3–4)* | future |
| F-150 | Switch kit: move in from GoHighLevel, Jobber or HoneyBook in a day | A phone's contacts imported from a vCard file in H1 2027; then, in 2029–2030, a move-in from GoHighLevel, Jobber or HoneyBook, with Spanish headers | M (4.5–6)* | next → future |
| F-151 | MCP as a channel | Listings in AI assistants' directories | M (3–4) | dropped |
| F-152 | Reach the systems a business already runs | Adapters to the child-care, law and insurance systems a business already pays for | L (9–12, = S-46, S-57, S-58)* | later → future |
| F-153 | Sofía as a partner app inside vertical software | Sofía sold inside other vendors' marketplaces | L–XL (8–14) | dropped |
| F-154 | Valley benchmarks and the public Pulso del Valle | "Cómo se compara" against Valley peers | M (4–5) | future |
| F-155 | Recomendados: a referral network between Valley businesses | A trusted list Sofía offers when a caller needs another trade | S (0.5–1 planned; the network not costed)* | future |

**Design notes.**
- Plans differ by Sofía, the web chat and allowances only (proposed; decision 25); the upgrade is sold by one measured evidence card on Hoy, never by padlocks inside working screens.

**What we reject here.** MCP directory listings (the study's MCP server, S-33, stays), and Sofía as a partner app inside Jobber or Clio, which sell their own receptionists.

### 5.13 Agentic discovery

Customers increasingly ask an AI assistant to find a plumber or a salón, and Google Search's AI calling already phones local businesses to ask price and availability. Google announced on 19 May 2026 that its AI will call home-repair, beauty and pet-care businesses for users, rolling out across the U.S. over the summer of 2026 ([Google](https://blog.google/products-and-platforms/products/search/search-io-2026/)), so H13's transcript count can start on the live lines now. A Valley business that is correct, in Spanish, where assistants look will be chosen; one that is not will be skipped. Today a lead's source is captured but never shown to the owner, and the website's channel rules count Gemini referrals as Google (§4.3, rider 6).

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-156 | Assistant callers get their own lane | Calls from AI assistants recognised, labelled and served | S–M (2–3) | future |
| F-157 | "Found you through ChatGPT": attribution shown, AI assistants as a source | Where each lead came from, AI assistants included, on the record now and in the Monday report once decision 24 allows | S (1.5–2)* | now |
| F-158 | "Machines and assistants": one settings section | One settings section for assistants and robots | S (1–2) | dropped |
| F-159 | Public write paths that tell people, agents and bots apart, and hold likely spam | Likely spam held before it reaches the calendar or the inbox | M (2–3)* | later |
| F-160 | The business page assistants read | A correct bilingual page an assistant can cite, for a business without a website | M (3–4) | future |
| F-161 | Keep Google, Apple and Bing telling the truth | Hours and holiday hours kept in step on the Google profile first, with a Book button that opens BIS's booking page (Place Action Links) | M (3–4) | later |
| F-162 | What AI says about you: a monthly bilingual check | A monthly check of what AI answers say about the business, half in Spanish | M (2–3) | future |
| F-163 | Findable, bookable, payable: the readiness meter | A readiness meter for assistants | S (1–2) | folded into F-099 |
| F-164 | A storefront for consumer agents | One endpoint where a customer's assistant can ask questions and request a time | M–L (5–7) | future |
| F-165 | "Book online" inside Google | Real-time booking inside Google | L (6–10) | dropped |
| F-166 | Menus, packages and price sheets machines can read | Machine-readable menus and packages | M (2–3) | folded into F-037 |
| F-167 | Payable by agents: deposits against signed mandates | Deposits paid by a customer's agent | L (6–8) | dropped |
| F-168 | "Connect your assistant": customer-delegated agents | A customer's own assistant acting on their account | L (6–8) | dropped |
| F-169 | Business-to-business agents: work orders from managers' systems | Work orders filed by property managers' systems | L (6–8) | dropped |
| F-170 | Is this reviewer a customer? Review authenticity | Each imported review matched privately against real customers | S–M (1.5–2) | future |

**The forward view: found and booked by AI assistants (proposal).** BIS's path is measure first, publish the truth second, open the door last. **Now**, F-157 shows every lead's source, AI assistants included, so an owner can see from their own records whether assistants send business before anyone sells "AI visibility". **Later**, F-037's facts become the one source of truth for what the business says; F-161 keeps the Google profile's hours and holidays in step with Sofía and the booking page after Google approves the API (decision 32, the narrow reading); F-159 holds likely spam before it reaches the calendar; and a machine-made booking lands as a hold that a person confirms (F-051), so constraint 5 holds for assistants too. **In 2029–2030**, once call records show real assistant traffic (hypothesis H13), assistant callers get their own lane (F-156), businesses without a website get a bilingual page assistants can cite (F-160), a monthly check reports what AI answers say (F-162), and a storefront lets a customer's assistant ask and request a time (F-164). What BIS will not do is chase protocols that churn: agent payments, delegated agents and business-to-business agents are dropped until demand exists.

**Design notes.**
- A booking made by an outside assistant is a hold with a named state, never a silent write; the owner sees "Solicitada por un asistente" and confirms. (Sofía's caller-confirmed bookings are decision 19's.)

**What we reject here.** Booking inside Google (a Book button on the Google profile that opens BIS's booking page, through Place Action Links in F-161's scope, covers it), agent payments, customer-delegated agents, business-to-business agents, and a separate settings section for machines (each setting arrives with its feature).

### 5.14 Industry packs

The owner named plumbers, restaurant owners and child day care "and others". A pack gives a trade its own words, pipeline, documents, clocks, Sofía module and Texas rules, so a plumber sees "Trabajos" and a licence block on the quote rather than a generic sales tool. Today there is one English "Sales" pipeline for everyone and blueprints that apply only at creation.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-171 | Pack manifest: the blueprint grows into a bilingual industry pack | A blueprint that carries bilingual labels, statutory text and guardrails for one trade | M (4–5 beyond S-38)* | later |
| F-172 | Starter packs first, plus the five blueprint fixes | Home services, insurance and events starters in the trade's own words, and four of the five blueprint fixes (the archived-form fix ships now, §2.3) | M (2–3)* | later |
| F-173 | Onboarding picks the pack and vets the tenant | Onboarding records the trade, turns away out-of-scope trades and checks licences | M (4–5, with S-53) | now → later |
| F-174 | Sofía industry modules | Sofía knows each trade's rules: no binding coverage, no legal advice, no final diagnosis for a trade; the child-care lines ship inside F-185 and the allergen rule inside F-199 | M (5–6)* | now → next |
| F-175 | Intake schemas: a pack-shaped intake that opens a deal through one proposal | A trade-shaped intake that opens a deal through one proposal | M (3–4) | next → later |
| F-176 | Packs with versions and approved updates | Pack updates that reach live clients with approval | L (8–10) | future |
| F-177 | The business's own words: a bilingual pack lexicon | "Trabajos", "Cotizaciones" and "Inscripciones" instead of generic sales words | M (2–3) | later |
| F-178 | Pack reports: four numbers per industry and a pack-aware hero | Four Monday numbers per trade | M (2–3) | folded into F-100 |
| F-179 | Home services pack | Licence blocks on quotes, equipment history and a heat-risk script | M (3–4 beyond S-40; 5–6 with it)* | later |
| F-180 | Route services module | Route templates and one-tap rain notices for pest, lawn and pool services | S (0.5–1 beyond S-59)* | later |
| F-181 | Law pack | Conflict capture before the consult, case checklists and deadline clocks | L (6–8) | later |
| F-182 | Insurance pack (personal property and casualty) | Renewals, and written UM/PIP rejections that are never lost | L (6–8) | later |
| F-183 | Events pack | Date holds, package quotes by guest count, and payments from several payers | L (7–9) | later |
| F-184 | La fiesta: the family's event page | The family's own page for the quinceañera or wedding | M (3–4) | future |
| F-185 | Child-care front office pack | A Spanish front office beside the centre's own management system | L (6–8) | later |
| F-186 | Catering module | A bilingual catering desk with the allergen rule | S (0.5–1 beyond S-45)* | future |
| F-187 | A living Texas rule library | Texas statutory wording kept current for every template | M (2–3) | later |
| F-188 | Regulator-ready packets for every pack | One click prepares a bilingual packet for an inspection or audit | M (2–3) | later |
| F-189 | Self-service for policyholders and legal clients, behind an identity check | ID cards and case updates, after an identity check | M–L (4–6) | future |
| F-190 | Immigration and court status lookups, answered only after identity checks | Case-status answers only after identity checks (research only) | M (3–5) | future |
| F-191 | The next packs from the same parts: studios, freight, grooming, homebuilders | The studios pilot, freight, grooming and homebuilders from the same parts | M per pack (3–4 planned)* | future |
| F-192 | Seat, date and season forecasting per pack | Seat and season forecasts | L (6–8) | dropped |

**The forward view: the pack order (proposal, study decision 8).** Sofía sells before the packs: insurance agencies and event venues from now, law firms from next, once the Opinion 680/705 sheet and F-174's law module exist (decision 15). The packs then follow one order:
1. **Home services first** (plumbing, HVAC, electrical and route services), after the vault and the blueprint extensions; part two, with schedule and map views, after money and per-staff calendars.
2. **Law and insurance** second, after the vault, e-signature, households, the regulated-professional baseline and identity checks. Insurance wins on the bundle, not the receptionist.
3. **Quinceañera and wedding vendors** third, after money, date holds and multi-payer schedules, and only once the Expo confirms how they sell (H1 to H4). They score best of any segment.
4. **Child care** fourth, as the Spanish front office beside the centre's own system, after money, field-level roles, broadcasts, the installable app and the integration research, and after three to five centres confirm the position (H9). BIS stays beside that system, because brightwheel and Procare already hold the child's file.
5. **Restaurant catering** fifth, after POS research, money and broadcasts, and only once a restaurant pays. Restaurants meet BIS sooner through Sofía at the front desk (F-199), if H10 holds, once Sofía can quote menus and hours as owner-edited facts (S-44, F-037 part 2) and F-199's allergen rule ships. She takes no table reservations and no food orders: she texts (once A2P, the send gate and decision 19 allow) or reads out the restaurant's own reservation or ordering link, and files a large party as a lead. Discovery calls with restaurants start now.

**Adult day care is out, and home health with it; the HIPAA verticals stay behind study decision 5** (binding constraints 1 and 2, §3.1). F-173's vetting turns away adult day care and home health at onboarding, and holds the HIPAA verticals until decision 5 is made. Until a sector's pack arrives, its businesses may buy the core CRM, and Sofía on a higher plan, as any small business can (proposal), with three holds:
- **Restaurants and child-care centres** may buy the CRM-only plan, but Sofía and the web chat are not sold to them until their never-say lines ship (the allergen rule in F-199; the child-care module in F-185), as the study orders it (§11.3: Sofía's knowledge base before the child-care and restaurant receptionists).
- **Law firms** may buy the CRM from now, and Sofía from next, once both the Opinion 680/705 sheet and F-174's law module ("no legal advice") exist (decision 15, as this plan reads it).
- **Tax preparers** are held at S-53's vetting, CRM included, until the 2028 season's prerequisites and S-61's vault switch land (proposal; decisions 18, 25 and 34). The vault ships in the first release with no per-tenant off switch, so admitting them earlier would break study decision 18's "stores no tax documents"; the owner may instead pull S-61's switch forward and admit them CRM-only sooner.

Voice is agency-only today, so these holds need no code. A centre keeps the child's file in its own system; BIS stores no date of birth, allergy or health field until F-004 enforces restriction, and what a parent says on a call stays only in that call's transcript (§3.2 rules 3 and 14). Freight is a pilot after the vault; studios are a pilot in 2029–2030, later than the study's months 9–12 (decision 34).

**Design notes.**
- Packs choose the record's cards, nouns and default views through the card registry and the lexicon; they never add a sidebar item beyond the four module slots (proposed; amendment 7).

**What we reject here.** Seat and season forecasting (it needs a season of data nobody asked for), POS, online ordering and table management for restaurants, and structured restricted fields in any pack before F-004 enforces restriction.

### 5.15 Additions (F-193 to F-199)

Seven features added in the final pass: four answer gaps the judges named, and three are gaps that pass found. Their scores are provisional; no judge has scored them.

| ID | Feature | What the owner or customer gets | Effort | Horizon |
|---|---|---|---|---|
| F-193 | Facebook and Instagram: ad leads and direct messages in the one inbox | Facebook lead ads through the form pipeline, then Messenger and Instagram threads in the inbox | M (4–6) | later → future |
| F-194 | La prueba en español: a published comparison of receptionists in Spanish | A quarterly, published test of receptionists in Spanish, Sofía included | S (1) | now |
| F-195 | Una persona de BIS: a published local service promise | A measured promise: a BIS person answers within one business hour, in Spanish or English | S–M (2–3) | later |
| F-196 | Room to run: background work beyond one 15-minute tick | Reminders and syncs that still arrive on time as background work grows | M (3–4) | next |
| F-197 | La caja de zapatos: bring the paper files in | Years of paper files split, matched to records and filed on approval | M (3–4) | later |
| F-198 | Team papers: staff licences, certificates and training that expire | Staff licences and training that expire, with bilingual reminders | S–M (2–3) | later |
| F-199 | Restaurants start with Sofía at the front desk; the catering pack comes later | Sofía answers hours, large parties and catering for restaurants, texts or reads out the restaurant's own reservation or ordering link rather than taking a booking or an order, and never promises allergen safety | S–M (2–3) | later |

**Design notes.**
- None needs a DESIGN.md amendment: each uses existing patterns (rows that open drawers, status as dot and word, one primary per view). F-197's batch waits in the review tray ("38 listos · 6 por revisar · 4 sin dueño"), and health documents are filed by hand, never read by a model.

---

## 6. Design and experience in 2027

### 6.1 The picture

**The picture (proposed).** At 7 AM an owner in McAllen opens BIS on a phone and reads, in Spanish, one sentence about what happened overnight, the five things that need them, and today's appointments. Everything else hangs off that screen: one record per customer with all their documents, one box to find or ask, one inbox, one tray where AI suggestions wait for a person's OK, and one settings page the owner can use without calling BIS. Customers see the business's brand in their own language on every link. Northern Lights keeps its colours, radii and surfaces; it gains a phone, a second language, named states and rules that tests enforce.

**Today, across every surface (verified).** The signed-in shell has no phone layout. The owner's screens are English only: one 1,257-key catalogue "single-locale by design", `en-US` formatters and `<html lang="en">`. No screen reads the client's plan (`accounts.permissions` is unused), so a CRM-only account sees a hero of 0 and can never finish Setup. Each surface below starts from what exists.

**The owner's asks, as they land in the experience (proposed).**

| Ask | Where it lands |
|---|---|
| Plumbers, restaurants, child day care and others | Packs supply the nouns (Trabajos, Eventos, Inscripciones), the record's card order and default views (F-177, F-001, F-093). Trades lead with properties, equipment and "Cómo llegar"; child care with required documents and authorised pickups (sensitive by default, F-126); restaurants meet BIS first through Sofía at the front desk (F-199), catering later (F-186). Adult day care and home health are out; HIPAA verticals stay behind decision 5. |
| Centralise each customer, with all their documents | The record page and the vault (§6.3, surface 3). |
| Use AI with the CRM | The review tray, the record's summary, the box's "ask", drafts beside the original. Every new AI suggestion waits for a person's OK; what a caller asks Sofía for and confirms may run live, stamped and undoable, if the owner rules that way (decision 19). |
| Microsoft 365 and Google, such as calendars | First a private feed of bookings for the owner's own phone calendar (F-048); then Ajustes › Conexiones; busy blocks on Agenda; calendar events with a known customer on the record's timeline (§6.3, surface 8; §7). |
| Learn from the best CRMs | HubSpot's three-column record and unified timeline; monday's recency cue and saved views; a two-question check-in in place of HubSpot's NPS surveys; the MCP server and importers from both; "packs choose the cards" instead of monday's admin-designed item card. Not taken: layout editors, record tabs, owner-built custom objects, anything that needs a CRM administrator, per-seat pricing. |

### 6.2 Design principles for what comes next (proposed)

1. **Start from the day, not the database.** Every home, list and alert answers "what needs me now?" before "what happened?". *Why:* we assume the owner has about an hour a day for the office, and DESIGN.md's own test is a business owner reading at 7 AM.
2. **Design at 390 pixels first.** Every new surface is drawn for a phone in one hand before the desk: compact containers, 44 px targets, 16 px inputs, the main action within the thumb's reach. *Why:* owners run the business from a truck or a counter, and today's signed-in shell has no phone layout.
3. **Spanish is designed in, not translated after.** Every string, date, amount and sort order is built for both languages from its first commit, and every component survives Spanish's extra length. *Why:* most of the Valley speaks Spanish at home (§3.1, from the pricing study), and the owner's own screens are today the one place BIS is not bilingual.
4. **A person approves every AI write, and the screen shows who did what.** AI proposes into one tray with its evidence; every row names its author (a person, Sofía, an automation, the customer, an import); every accept has an undo. *Why:* binding constraint 5 stays real only if approval is fast, visible and reversible.
5. **One of each.** One box, one work queue, one inbox, one review tray, one Ajustes, one upgrade page; a new module arrives through the record, one list, the box and one settings section, not a new sidebar item. *Why:* the overhaul spec rejected GoHighLevel's 17-item sidebar, and the study roughly triples what the product holds.
6. **Say the state in plain words, and never claim what has not happened.** Every surface is live, needs setup, waiting on someone, in a bigger plan, or absent; a wait names who and how long; a send says "enviaremos" until it is confirmed. *Why:* DESIGN.md bans carrier jargon in client copy, and Setup's "Couldn't check" already proves that a failed read must never look like progress.
7. **The customer sees the business, not BIS.** Every customer link carries the business's logo, colour and name, speaks the customer's language from the first paint, and stays calm: no lit ground, no glass (amendment 15 would make this part of the contract). *Why:* rule 9, and the Phase 7 decision that customer surfaces are quiet.
8. **Northern Lights stays; it gets lighter where the phone is weak.** No new colours beyond the accessibility tokens of amendment 17, and no new radii, shadows or surfaces; the four-step ladder, one hero and dot-and-word status carry every new screen, and any lighter rendering for cheap phones is chosen by measurement. *Why:* DESIGN.md is the contract, and the 2026-09-09 blur decision set the method.
9. **A rule that matters is a test.** Tokens only, a designed state for every route, Spanish keywords in the box and both languages in the styleguide are checked in CI, not remembered in review. *Why:* much of the code is written by agents, and CI is the gate every merge must pass (CLAUDE.md).

**One copy rule underneath.** The canonical examples mix *tú* and *usted* ("Lo que te necesita", "Pídele a BIS"); the canonical list settled *usted* for platform strings, so the labels below use it ("Necesita su atención", "Pedir un cambio"), and a paid Valley reviewer normalises the rest (F-012).

---

### 6.3 The surfaces that change most

Eight surfaces. For each: what it is for, today, what the owner sees first, its states, its Spanish, and the features that build it. Everything after "Today" is **Proposed**.

#### Surface 1. Hoy, the home screen

- **For.** Starting the day, and coming back to it between jobs.
- **Today.** The account dashboard: a greeting, a work row that is only a count link, three or four 7-day tiles with the hero on "Calls answered", a 14-day calls chart (both count robocalls and abandoned calls, which the weekly report excludes; §2.3) and a feed of booking, form and call events. No appointments for today; no "since you last looked"; the 7-day tiles never name their window; no skeleton while its twelve reads load; English only.
- **What the owner sees first.** Four bands, the first two above the fold on a phone: (1) **Mientras no estaba**, one sentence of counts since this person's last visit, each clause a link; (2) **Necesita su atención**, the top five queue rows with one-tap ghost actions and "Ver las 12"; (3) **Hoy en la agenda**, today's appointments with status as dot and word; (4) **the numbers**, one hero picked by the metrics catalogue (the pack's headline, else "Clientes nuevos" on a CRM-only plan and "Llamadas contestadas" with Sofía), every tile naming its window in words. A plan without Sofía sees at most one measured evidence card, never a pop-up; until launch is done, a "Primeros pasos" card.
- **States.** Loaded as above. Empty per band, each selling its feature ("No hay citas hoy. Las citas de su página y de Sofía aparecen aquí — Compartir su enlace"). Error per band: each band fails alone with Reintentar. Pending: a skeleton shaped like the four bands, never a spinner. Later, offline: a "Sin conexión · mostrando lo guardado a las 7:42" banner over a read-only copy of today's agenda.
- **In Spanish.** Greeting, sentence and deltas in the reader's language ("3 más que la semana anterior"); "hace 3 h" in the account's zone; `es-US` formats; labels that take +35%. The morning brief (F-082) is this digest by email, from one digest builder shared with the weekly report.
- **Built by.** F-076 (the hero by plan now, as a defect fix; Hoy itself later), F-077 (next → later), F-078 (the "waiting 12 min" clock, future), F-083 (the "+", later), F-084 (the open, closed, late or storm switch, now), F-100 (the hero's catalogue, later), F-141 (the evidence card, later), F-099 (Primeros pasos: CRM-plan steps now, the launch plan later). The CRM-only zero hero is a defect and ships first.

```
Hoy on a phone, 390 px (proposed)
+----------------------------------------------+
| Plomería Ejemplo      [Buscar]  o En llamada |
+----------------------------------------------+
| Buenos días, Rosa · martes 13 de octubre     |
| MIENTRAS NO ESTABA                           |
| Desde ayer 6:10 p. m.: Sofía contestó 4      |
| llamadas (2 citas, 1 cliente nuevo, 1 men-   |
| saje) · 1 formulario · 2 textos esperando    |
| NECESITA SU ATENCIÓN                 Ver 12  |
| Juan Pérez · fuga en el baño                 |
|   o Esperando 12 min            Llamar  ...  |
| Llamada con Ana López · 3 sugerencias        |
|   o Pendiente                   Revisar ...  |
| HOY EN LA AGENDA                             |
| 10:00  Ana López · calentador  o Confirmada  |
| 13:30  Luis Ríos · drenaje  o Sin confirmar  |
| CLIENTES NUEVOS · ÚLTIMOS 7 DÍAS             |
| 9 (hero) · 3 más que los 7 días anteriores   |
+----------------------------------------------+
| Hoy | Bandeja 2 | +Nuevo | Agenda | Clientes |
+----------------------------------------------+
```

#### Surface 2. The phone shell

- **For.** Running the business from a phone without the screen scrolling sideways.
- **Today.** None exists for signed-in users: the sidebar is 64 or 236 px at every width, there is no off-canvas navigation, and end-to-end tests run on Desktop Chrome only. Only the signed-out shell adapts.
- **What the owner sees first.** A bottom bar: **Hoy · Bandeja · + Nuevo · Agenda · Clientes**. The spine has five items and the bar four, so **Pendientes lives inside Hoy on a phone** (band 2 is the queue) and the home-screen badge counts it, which settles the skeptic's point that the bar omitted it. The rest sits in a **Más** sheet whose first rows are Ajustes and the launch meter (amendment 2). The topbar keeps the name, a search icon and presence as a dot with a word ("En llamada"; a bare dot breaks rule 3). A thread replaces its list; drawers become full-height sheets; tables become stacked rows whose whole row stays the target. Nothing hides or animates on scroll.
- **States.** Each list and sheet keeps its loaded, empty, error and skeleton states. The bar never changes with the plan: a module outside the plan goes to the upgrade page, not the bar.
- **In Spanish.** The bar's nouns are chosen to fit at 320 px in both languages and are tested there; no label truncates. Installed to the home screen, the icon and name are the business's (F-108).
- **Built by.** F-107 (a usable phone width now, as a rider; the bottom-tab shell next), F-089 for the nouns (next), F-108 (install and push, later), F-110 (the budget, future). **Sequencing:** the phone width ships now with today's screens and labels; the bottom bar and the spine's new nouns follow in next, after the January 2027 sitting on amendments 2 to 7.

#### Surface 3. The record page and the vault

- **For.** The owner's central ask: one place for each customer, with all their documents and information.
- **Today.** A contact page and a drawer over the list. The timeline has no bookings or suggestions, shows calls only as voice messages, prints raw statuses and draws dates in the server's zone, so an evening call can show tomorrow's date. Deals cannot be opened from the record. There are no documents.
- **What the owner sees first.** On a desk, the study's three columns: who they are, what is happening, what they have. On a phone: the header (language chip, status as dot and word, Llamar · Mensaje · Cómo llegar), the summary (checked fact line first, prose marked "Generado por IA"), the next three things due, the timeline, holdings as collapsed cards, then identity. Every timeline row reads who · did what · when, with a provenance mark (Sofía · IA, Automatización, Cliente, a name).
- **The vault.** Rows show source ("Lo subió el cliente"), version, expiry in words ("Vence en 12 días") and who can see it. "Tomar foto" uses the rear camera; uploads read Subiendo 45 % → Revisando → Listo. "7 de 9" names each missing document with **Pedir al cliente** and **Subir**. Deleting moves a document to the trash **at once with an undo**; a typed name confirms only a permanent purge (F-005 asked for it on the trash move, which rule 6 reserves for destructive acts).
- **States.** Every card loads, empties and fails on its own, behind its own streaming boundary; a scanning state ("Revisando") that owners would otherwise read as "lost"; a restricted state ("Hay 2 campos restringidos") once roles exist. A record page names **no hero** (amendment 11).
- **In Spanish.** Role chips read both ways ("Madre de Lucía R." ↔ "Hija de Ana R."); document categories and pack activity types are bilingual; what the customer said stays in their language and carries its own `lang`, with a translation beside it, never replacing it.
- **Built by.** F-001 (the kit, card registry and three-column page in the first release; a peek per record type later), F-005 (first release), F-022 (first release), F-003 (relationship labels in the first release), F-004 (later), F-002 (later), F-055 (the money card, later). **Lean first:** timeline fixes as defects on today's data, the three-column page with the first release, the peek stack with the second record type.

```
The record page on a desk, 1,280 px (proposed)
+-- Clientes › Familia García › Ana García -----------------------------------------------+
| Ana García  ES  o Cliente activo  Madre de Lucía R.      [Llamar]  Mensaje  ...         |
+--------------------------+--------------------------------------+-----------------------+
| QUIÉN ES                 | QUÉ ESTÁ PASANDO                     | QUÉ TIENE             |
| 956 555 0199 · celular   | Resumen: 2 citas este año; pidió     | DOCUMENTOS  7 de 9    |
| ana@example.com          | presupuesto de calentador.           |   o Falta: garantía   |
| Idioma: español          | Generado por IA · Regenerar          | CITAS  1 próxima      |
| RELACIONES               | PRÓXIMO: jue 10:00 · revisión        | TRABAJOS  1 abierto   |
|   Madre de Lucía R.      | HOY                                  | PROPIEDADES  1        |
| ETIQUETAS  VIP           |   Sofía · IA · contestó · 9:12 a. m. |   123 Calle Ejemplo   |
| o Textos: sí             |   Ana · texto · ¿Pueden el jueves?   |                       |
+--------------------------+--------------------------------------+-----------------------+
```

#### Surface 4. The one box: find, go or ask

- **For.** Finding anything, reaching any screen, or asking a question, by typing in either language.
- **Today.** The ⌘K palette searches contacts, calls and conversations, five of each. Its only action is the theme toggle, which misbehaves on themed accounts. It has no Spanish keywords, so "citas" finds nothing, and contact search does not match "Garcia" to "García".
- **What the owner sees first.** A "Buscar o preguntar" field at the top of the sidebar and a search icon in the phone header (⌘K still works). Results group by type, with "Ver los 42 resultados" on one server-paged page. "¿Dónde cambio el horario?" is answered from the product map with a link, never generated. "¿Quién no ha confirmado su cita de mañana?" offers **Preguntar a BIS**: editable filter chips first, then the count from the database, the rows and "Guardar como vista". "Preguntar a BIS" never writes, and the box offers no creates and no destructive action.
- **States.** A skeleton row while searching; empty "Sin resultados para 'Garsia' — Pruebe con el teléfono"; error with Reintentar; "ask" shows its chips before any number, so a wrong reading is visible before it misleads.
- **In Spanish.** Accent-folded and typo-tolerant; phone digits in any format; nicknames (Chuy → Jesús) for search only, never for merging; type words in either language filter ("citas mañana"); a test fails when any entry lacks a Spanish keyword. "?" opens a bilingual shortcuts sheet.
- **Built by.** F-092 (contact search next; one index across record types later), F-095 (find and go next, read-only ask later; voice dropped), F-087 (the product map, next), F-093 (saved views, later), F-083 (creates live in "+", not here).

#### Surface 5. The inbox (Bandeja)

- **For.** Answering customers on the channel they used, in their language, from a phone.
- **Today.** The reply box sends email only, one line at a time; the list does not refresh on its own; there are no saved replies and no open or done state; on a phone the thread renders under the list. Texting waits on each account's texting registration, which no client has completed yet.
- **What the owner sees first.** Threads with their channel as icon and word, "Sin responder" first; the header opens the customer's record. The composer is multi-line and follows the customer's last channel; "/" inserts a saved reply from a bilingual pair; a ghost chip offers "Si no responde en 2 días, recuérdeme" (Enviar stays the only primary). Later, drafts and translations sit beside the original, never replacing it (F-025).
- **States.** Abierta · Hecha · Pospuesta, as dot and word; any new message reopens a thread. Delivery status as dot and word. Where texting is not ready, the Text channel reads "Esperando a las compañías telefónicas · 3–7 días hábiles" instead of a tab that fails on send. Empty "Aquí aparecen los mensajes de sus clientes — Compartir su número". Refresh by polling first, live updates later.
- **In Spanish.** Saved replies, delivery words and the waiting state in both languages; the customer's message keeps its own `lang`.
- **Built by.** F-068 (the channel-following composer in the first release; saved replies and states later), F-079 phase 1 (the reminder chip, later), F-067 (the number and texting registration, later), F-065 (every send passes the consent gate, now), F-011 and F-025 (drafting), F-193 (Facebook and Instagram threads, later → future).

#### Surface 6. The review tray for AI suggestions

- **For.** Making "a person approves every AI write" fast enough that it stays real and does not become rubber-stamping.
- **Today.** Up to three suggestions per call (a task, a blank contact field, a later deal stage), each quoting the caller. They can be accepted or dismissed only on the call's page, with no undo and no editing; To do and the agency queue only link there.
- **What the owner sees first.** In Pendientes, cards grouped by customer and source. Each shows the change as before → after, the evidence linked to its exact moment, and **Aceptar** (the card's one primary), Editar y aceptar and Descartar. The same card appears in the drawer and on the call page. "Aceptar las 3" works only within one source and never overwrites a filled field.
- **States.** Pendiente · Aceptada · Editada · Descartada · Vencida, as dot and word. Accept runs at once with a 10-second undo, which names what it cannot reverse ("El correo ya salió"). Empty: "Las sugerencias aparecen aquí después de una llamada, un correo o un documento. Nada cambia hasta que usted acepte." Skeleton cards; Reintentar on error. Phone swipes always have undo and visible buttons.
- **In Spanish.** Titles and summaries in the reader's language; the evidence in the caller's own words, marked with its language. A weekly line, "Aceptó el 82% de las sugerencias", measures accuracy.
- **Built by.** F-019 (first release, on today's call suggestions first), F-077 (next), F-022 (first release), F-021 (later). **No auto-accept at any confidence.** F-022's proposed exemption for caller-directed live writes narrows binding constraint 5; the tray does not assume it, and it waits for the owner's decision 19.

```
One card in the tray, on a phone (proposed)
+----------------------------------------------+
| DE LA LLAMADA DEL MARTES CON ANA LÓPEZ · 1/3 |
| Teléfono:  (vacío)  ->  +52 899 000 0000     |
| "Mejor márqueme a mi celular de Reynosa,     |
|  el 899..."     Ver en la transcripción 02:14|
| Sofía · IA   o Pendiente                     |
| [ Aceptar ]   Editar y aceptar   Descartar   |
+----------------------------------------------+
  after Aceptar:  "Teléfono guardado · Deshacer" (10 s)
```

#### Surface 7. Customer-facing pages, and the customer's own page

- **For.** The customer's side: booking, forms, chat and cancel today; from 2027, manage, share and upload links, then sign, quote and pay links with money, and a page the customer can come back to.
- **Today.** Four public pages carry the business's logo, name and theme and speak Spanish through per-surface string modules. All are served as `lang="en"`, and the chat and cancel pages never correct it; tab titles are generic English words; the booking page has no `<h1>`; a switched-off chat opens a bare 404; email addresses containing "_" are refused on intake. "Powered by BIS" cannot be removed.
- **What the customer sees first.** A front door: logo, the business's name as the page's `<h1>`, the service area ("McAllen · Edinburg · Mission"), "Atendemos en español", tap-to-call, step dots that render, and time in words ("Horario de McAllen (hora del centro)"). The tab reads "{Negocio} · Agendar cita". The language is decided on the server: the link's parameter, then the contact's preference, then the browser, then the form's default, with an EN | ES switch on every page.
- **The customer's own page.** Stage 1, **Mi página**: a magic link in transactional messages, with upcoming and past visits, copies of messages sent and preferences. Stage 2, **Mi cuenta**: what they owe and what the business needs, one primary for the most urgent act (Pagar or Firmar). No password. Placement strains binding constraint 3 (Stage 2 is a non-Sofía feature on higher plans), so both stages' placement is **decision 25's to make** (study decision 14's scope), not settled here.
- **States.** Designed dead ends in the business's brand and the visitor's language: not found, error, expired, revoked, already done, offline ("Estamos fuera de línea — llámenos"). Pay and sign pages use the irreversible pattern: one submission, a "Procesando" state with no second Pay button, and a result that says exactly what happened ("No se cobró nada. Su tarjeta fue rechazada.").
- **In Spanish.** Spanish from the first paint, with the right `lang`; money in `es-US` with "USD" wherever pesos could also appear; 16 px inputs, 44 px targets, errors announced and focused.
- **Built by.** F-102 (the shared layout now, as defects; the public-page kit later, before the first new link type), F-047 (the "_" fix now, as its phase 1), F-048 (manage my appointment, a rider now), F-062 (later), F-106 (the pending patterns, later), F-055 (amounts), F-065 (preferences). Calm surfaces and the no-card booking header need amendments 14 and 15.

#### Surface 8. Ajustes, settings for owners

- **For.** Changing what is the owner's without a phone call, and seeing plainly what BIS manages.
- **Today.** Clients have no Settings page; what they can edit today is listed in §2.1. The theme is saved per browser, not per person.
- **What the owner sees first.** One **Ajustes** in the sidebar footer (at the top of Más on a phone), with a search box and three scopes: **Mis preferencias** (language, display, notifications, my calendar, security; not "Mi cuenta", which names the customer's own page); **Negocio** (Perfil y marca, Horario y cierres, Equipo, Canales, Automatizaciones, Conexiones, Plan y facturación); and **Administrado por BIS** (the phone number, texting registration, sending domain, Sofía's rules), read-only with its status and a ghost **Pedir un cambio** that lands in the agency's queue and is tracked as Recibida · En proceso · Hecha.
- **Conexiones, for Google and Microsoft.** One page for every integration. First the owner's own calendar: busy times block Sofía's slots and the booking page, bookings write events with Meet or Teams links, and events with a known customer join their timeline; Outlook first where a client runs Microsoft 365 (study §6.2). Each connection shows status as dot and word, what it reads, Desconectar.
- **States.** One primary Save per card (rule 8 as amended 2026-09-23); reversible changes with undo, destructive ones confirmed by typing the name; a skeleton per section; each section in one of the five surface states; every change recorded with its before and after.
- **In Spanish.** Section names and search keywords in both languages ("horario", "cierres", "avisos"). Sign-in stays platform-branded (rule 9) and follows the browser's language with an EN | ES switch, because no company is known before sign-in.
- **Built by.** F-096 (Mis preferencias in the first release; Negocio and Equipo later), F-097 (later), F-081 (later), F-084 (now), F-117, F-099, F-112 (future), and F-148 (next) on the study's Google and Microsoft track. The agency keeps its two-pane Setup and gains a read-only "Ver como Dueño" (F-098, folded into F-087).

---

### 6.4 The design system work underneath

These enablers make the eight surfaces possible and keep them consistent. Most are **engineering work an owner never sees**; the value judge scored them mostly 1 to 3 by design, and they should be judged on feasibility and risk instead. Efforts and horizons below are the roadmap's (§4).

| Enabler | What it is (proposed) | Who sees it | Effort · horizon | Features |
|---|---|---|---|---|
| Record kit and card registry | Container-aware `RecordLayout`, `RecordHeader`, `RecordCard`, the `TimelineItem` grammar, `RoleChip`, `CompletenessMeter`, `SummaryBlock`; `record-cards.ts` where core and packs declare cards; the module contract | Owners see the page; the kit and registry are engineering | +3–4 ew in the first release (now); a peek per record type 2.5–3.5 ew later | F-001, F-101 |
| State grammar | A closed catalogue of twelve states with a bilingual copy formula; five pending patterns; the honesty rule; server-side idempotency for money and legal acts | Owners see honest words; the catalogue is engineering | 3–4 ew · later, before pay and sign pages | F-106 |
| Spanish-ready components | A pseudo-locale at +35%; an overflow check; one Intl layer (`es-US`, relative times, ICU plurals); accents kept in capitals and a Label line height that does not clip them; Spanish collation; `lang` on every customer-authored part | Engineering; the precondition for the Spanish dashboard | 1–2 ew · now (first release), before F-013 | F-014, F-013 |
| Accessibility to WCAG 2.2 AA | `--text-label` (the `.label` exemplar measures 2.98:1 on the light ground), `--good-text` and `--warn-text`, field edges at 3:1, "Mover a…" beside every drag, 24 px hit areas, forced colours, and a ledger that says "partial" where it is | Low-vision and older owners feel it; the ledger is paperwork buyers ask for | 3–4 ew · later, after the WCAG amendments and decision 26 | F-103, F-102 |
| Performance budget | Core Web Vitals "good" at p75 on a mid-range Android over throttled 4G; about 170 KB of first-load script per dashboard route and 90 KB per public page; lab and first-party field measurement | Owners feel speed; the rest is engineering | 2–3 ew · future; skeletons on the 23 routes without one ship now as a defect (rule 7; §2.3, 1–2 ew) | F-110 |
| Phone primitives | Three container sizes; `BottomSheet`, `StackedTable`, `ActionBar`, `SegmentedControl`; `--tap-min` and `--safe-bottom`; a WebKit phone test project | Owners see the phone shell; the primitives are engineering | inside F-107: 1.5–2 ew now, the bottom-tab shell 5–6 ew next | F-107 |
| Offline, the read side | A connection banner, stale stamps, a cached app shell and a read-only copy of today's agenda, keyed to the person and purged on sign-out | Owners see the banner and today's jobs without signal | 1–2 ew on S-37's 2–3 · later | F-109, S-37, F-108 |
| One map of the product | A typed manifest that the sidebar, the box, Ajustes, the launch plan and the upgrade page all read; display only, never authorisation | Engineering | 2.5–3.5 ew · next | F-087 |
| The contract enforced | Lint rules (no colour literals, radius tokens only, no JSX literal copy), route-state tests, styleguide v2 in both languages and four fixture brands | Engineering | 2 ew · later (nightly screenshots dropped) | F-105 |
| One token source | Tokens authored once as data, generating CSS, TypeScript, email-safe literals, the PDF theme, the checkout appearance and the home-screen manifest | Engineering | 2–3 ew · future (PDFs use today's CSS tokens first) | F-104 |
| One per-person preferences store | Language, theme, text size, collapsed cards and "last seen" in one interim table, not scattered across auth metadata, cookies and separate tables | Engineering | small, created with staff and roles (S-01) · now | §3.2 rule 6 |

**The honest note.** Only the phone primitives, the accessibility fixes and the offline banner are things an owner would name; the rest is insurance, including a burn-down of known violations such as the base Button's 10 px radius against DESIGN.md's 8 px controls.

### 6.5 DESIGN.md amendments this plan needs

Every row was checked against DESIGN.md's text on 2026-09-26. **Corrected:** the canonical "dark-first" item read DESIGN.md as dark for everyone; it already makes light the default for client-role users, so only the operator default conflicts (row 1). **Kept for the owner's ruling:** "a partner line on the signed-out shell" (F-145, row 23). A partner's line in the content area may leave rule 9's platform mark and accent in place, but that is a reading of rule 9, and DESIGN.md says to flag rather than improvise; until the owner rules, F-145 ships partner links without logos. **Added:** rows 4, 5, 6, 9, 12, 13, 18 and 19, which the canonical list missed. F-101 (DESIGN.md v2, with its own Amendments table) is the vehicle for all of them.

| # | Amendment | Needed by | Recommendation | Status |
|---|---|---|---|---|
| 1 | **Identity, operator default.** DESIGN.md says "Dark-first operator UI"; the code defaults the agency to light, and a role-based default is "explicitly deferred, not planned". | F-111 (in F-096), F-101 · first sitting, October 2026 | "Dark and light are equal. A person's own choice wins and follows them across devices; otherwise the company's default; otherwise light." | Proposed — needs the owner's dated decision |
| 2 | **Rule 10 on a phone.** The footer cluster is "pinned and visible at every viewport height"; a phone has no sidebar. | F-107 · second sitting, January 2027 | Ajustes and the launch meter are the first rows of the Más sheet, one tap from every screen. | Proposed — needs the owner's dated decision |
| 3 | **Blur on the bottom bar.** `--glass-filter` is allowed on "the sidebar and the overlays ONLY". | F-107 · second sitting | The bottom bar is the phone's sidebar: it may carry `--glass-filter` with the existing `@supports not (backdrop-filter)` fallback, and never hides or animates on scroll. | Proposed — needs the owner's dated decision |
| 4 | **Rule 8 and the "+" (added).** "One primary button per view"; a filled "+" in the bar would be a second primary on every screen. | F-083, F-107 · second sitting | Navigation chrome is not a view's primary: the "+" is drawn as chrome (`--accent-dim` with the word "Nuevo"), never as a filled primary. | Proposed — needs the owner's dated decision |
| 5 | **AI presence (added).** The pattern shows the indicator unconditionally; F-107 proposes a bare dot on phones, which rule 3 forbids. | F-088, F-107, F-041 · second sitting | Presence shows only on plans with Sofía; on a phone it keeps a short word ("En llamada"). Counting "this week" in the account's zone is a fix, not an amendment. | Proposed — needs the owner's dated decision |
| 6 | **Record views on a phone (added).** "List click opens a right-side drawer over the list." | F-001 and F-005 (their phone sheet ships inside F-107 part 2, the bottom-tab shell, in next), F-107 · second sitting; until it is dated, the first release's record page and vault follow today's drawer rule on a phone | On a phone the drawer is a full-height sheet with a visible close; one peek at a time, a related record replacing its content with a back link. | Proposed — needs the owner's dated decision |
| 7 | **Sidebar groups.** The pattern fixes OVERVIEW / CRM / COMMUNICATIONS / GROWTH (and the Northern Lights spec made restructuring navigation a non-goal). | F-089, F-001, F-041, F-100, F-107 · second sitting | The spine (Hoy · Pendientes · Clientes · Bandeja · Agenda), up to four module slots by plan and pack, a collapsible Crecer, a budget of nine primary items, the "Buscar o preguntar" field at the top, pinned views once views exist, labels in the reader's language. Grouping the agency's own top level (F-136) rides on the same decision. Until decided, new modules go into today's groups. | Proposed — needs the owner's dated decision |
| 8 | **Setup and the Checklist.** "Checklist remains reachable from the nav's own Checklist entry." | F-099 · when the launch plan starts, later (the CRM-plan step fix ships now inside today's Setup) | One launch plan by plan and pack; the Checklist entry retires; the owner gets "Primeros pasos" on Hoy; once done it leaves the nav and stays in Ajustes and the box. | Proposed — needs the owner's dated decision |
| 9 | **The palette becomes the one box (added; it narrows "runs actions").** The pattern "finds contacts/calls/conversations, jumps to any settings section by name, runs actions". | F-092, F-095 · with the palette v2, next | Every entry carries English and Spanish keywords; search covers every record type; "ask" answers read-only from the database with its filter shown first and never writes; the box offers no creates (F-083 owns them) and no destructive action. | Proposed — needs the owner's dated decision |
| 10 | **The module contract (additive).** | F-090 (in F-101) · with DESIGN.md v2, in the first release | A key pattern: a card on the record, one list, a place in the box, one settings section, work to Pendientes and news to the timeline, AI to the one tray, customer visibility off by default. | Proposed — needs the owner's dated decision |
| 11 | **Rule 11, "at most one hero".** "One hero gradient per screen, named in the screen's spec." | F-001, F-100, F-160 · when the record page starts, first release | "At most one": record pages, the queue and settings name none; Hoy's spec names its hero as "the headline metric the catalogue picks for the plan and pack". | Proposed — needs the owner's dated decision |
| 12 | **Rule 1, a delta names its window (added).** Rule 1 accepts "a delta, sparkline, or period label"; today's 7-day tiles (three or four) never name the window, and three of them show a 14-day spark beside a 7-day number (the all-time tiles do say "All time"). | F-076, F-100 · with Hoy and Números, later | Every delta states in words what it compares, visibly and for screen readers ("Últimos 7 días · frente a los 7 anteriores"); a spark spans the same window as its number. | Proposed — needs the owner's dated decision |
| 13 | **The weekly report's four numbers (added).** The pattern fixes calls answered, leads captured, bookings and website visitors; F-078 adds a speed line, F-100 and F-178 swap numbers by pack, and about twelve features want a line. | F-078, F-082, F-100, F-178 · second sitting (decision 24) | Numbers come from the metrics catalogue: up to four headline numbers and at most two lines, by plan and pack. The three rules (words not arrows, omit what was not measured, a quiet week still sends) stay, and also bind the morning brief. Recipients stay on the account, and the field stays the switch. | Proposed — needs the owner's dated decision |
| 14 | **The booking card.** The pattern asks for a "branded card"; M4b and Phase 7 decided against one. | F-102 · when the public-page kit starts, later | "A branded header, no card": logo, the name as the page's `<h1>`, service area, step dots. | Proposed — needs the owner's dated decision |
| 15 | **Calm customer surfaces.** The foundations say depth "in both modes" comes from the lit ground and glass. | F-102, F-062 · when the public-page kit starts, later | Customer surfaces carry no lit ground and no glass (Phase 7's decision), with their own derived token layer, 16 px inputs and 44 px targets. | Proposed — needs the owner's dated decision |
| 16 | **WCAG 2.2 AA in the definition of done.** The definition names a composite contrast test but no WCAG level, and that test certifies `--text-3` at 3:1. | F-103, F-102 · when F-103 starts, later (with decision 26) | Add "Meets WCAG 2.2 AA" for workspace and customer surfaces, backed by a ledger. The axe-core licence (MPL-2.0 against the platform spec's MIT, BSD or Apache rule) is a platform-spec ruling, asked in the same sitting. | Proposed — needs the owner's dated decision |
| 17 | **The look after the accessibility tokens.** `--text-label`, `--good-text`, `--warn-text` and 3:1 field edges change Northern Lights' quiet look. | F-103 · when F-103 starts, later | Decide by a side-by-side on real screens in both modes, as the blur was; the Label role keeps its size and gains contrast. | Proposed — needs the owner's dated decision |
| 18 | **Bilingual in the definition of done (added).** The definition names no language; binding constraint 6 is bilingual everywhere. | F-012, F-013, F-014 · first sitting, October 2026 | Add: renders correctly in English and Spanish, survives the pseudo-locale's +35%, sets `lang` correctly, and passes the 7 AM read in both languages. | Proposed — needs the owner's dated decision |
| 19 | **Person and device overrides of the foundations (added).** The foundations fix the lit ground (three glows and a grid) and the Label role at 10 px; F-111's "Más contraste" drops the glows and its larger text sets labels to 12 px; F-110's "lite ground" drops a glow and the grid. | F-111 (in F-096) · the person overrides when F-096's later part starts, later; the lite ground with F-110, future | Allow three named overrides: more contrast (opaque surfaces, strong edges, no glows), larger text (a 112.5% root), and a lite ground adopted only after measurement on a low-end Android. | Proposed — needs the owner's dated decision |
| 20 | **New v2 sections, each provisional until a real client uses it.** Record page, Visibility, Documents, Money (the `es-US` rule, "USD" where pesos could appear, one status set), Customer surfaces, Accessibility, Bilingual typography, Layout and touch, Offline, Performance, Pending and progress, Provenance, Print and PDF; detail in a proposed `docs/design/patterns/` folder. | F-101 and each feature named · first sitting for the record page, documents and provenance; the rest as each feature starts | Approve section by section as each feature starts, not all at once. | Proposed — needs the owner's dated decision |
| 21 | **"Powered by BIS" removable or replaced.** The booking pattern names the footer. | F-143, F-138 · future | Do not decide now; decide under decision 25 and only if a reseller signs. | Proposed — needs the owner's dated decision |
| 22 | **Agency sign-in branding.** Rule 9's sign-in exception. | F-138 · future | Do not decide now. A hostname would identify the agency before sign-in, which meets rule 9's condition, but only once a reseller exists; tenant-level sign-in branding is not proposed. | Proposed — needs the owner's dated decision |
| 23 | **A partner line on the signed-out shell.** Rule 9 makes sign-in carry the platform's mark and accent. | F-145 · when F-145 starts, later | A partner's name and link in the content area, below the platform's mark, with no partner logo or colour; the platform's mark and accent stay. Until ruled, partner links ship without logos. | Proposed — needs the owner's dated decision |

### 6.6 Sequencing the design work

The design pass recommended building the product map, the state catalogue, the lint burn-down and the accessibility fixes in the now horizon, because they are cheapest before the record page ships. The capacity check (§4.1) places them as above instead. If the now horizon runs under its low bound, they are the first candidates to move forward, in that order.

The amendments are ruled in two sittings, **October 2026** for the first release and **January 2027** for next, and the rest as their features start; decision 35 lists the rows in each. Until an amendment is dated, new modules go into today's sidebar groups, and no feature ships nouns or patterns the contract does not yet allow.

### 6.7 What we will not do

Design ideas from the ten lenses that this vision rejects or defers. A deferral names what would bring the idea back.

| # | Idea (source) | Verdict | Reason |
|---|---|---|---|
| 1 | A top-level AI section or chat pane (the information-architecture lens) | Reject | AI appears where the work is: the record's summary, the tray, the box (study §5.1). Sofía has a home because she is a receptionist, not because she is AI. |
| 2 | A notification bell or notification centre (the information-architecture lens) | Reject | A third inbox beside Pendientes and Bandeja. Work goes to Pendientes, news to the timeline and Hoy, delivery through one router (F-081). |
| 3 | A sidebar that hides or reorders itself by usage (the owner-workflow lens) | Reject | Owners navigate by position and support says "toque Agenda". Plan and pack decide what shows; pinned views give personal shortcuts. |
| 4 | Owner-built layouts: a monday-style item-card editor, a reorderable menu, custom-object screens (the design and information-architecture lenses) | Reject | Packs choose the cards (the study's reading of monday #1); a five-person shop has no admin; custom objects stay rejected (study §3.2). |
| 5 | HubSpot-style tabs on the record page (the information-architecture lens) | Reject | The study chose three columns; cards collapse by pack and role instead. |
| 6 | Padlocks, upgrade modals and upgrade cards inside working screens (the growth and design lenses) | Reject | One upgrade page, one measured evidence card on Hoy, and a neutral state only on a deep link. |
| 7 | A "Tu negocio en internet" top-level section (the agentic-discovery lens) | Reject | Crecer › Sitio web, Números and Ajustes hold it; no new top-level item. |
| 8 | A role-based dark default for the agency (the design lens's alternative; the design roadmap) | Reject | A remembered per-person choice serves the one operator team and matches the code (amendment 1). |
| 9 | New typefaces, animated glows, Bricolage back, dark-mode emails first (the design lens) | Reject | Northern Lights non-goals; the performance budget argues for less paint on cheap phones, not more. |
| 10 | A native app now (the owner-workflow and design lenses; decision 10) | Reject for now | Installable web app first; native only when Tap to Pay or a larger fleet justifies it. |
| 11 | Scheduled PDF dashboards and staff leaderboards (the owner-workflow and information-architecture lenses; the study's monday #25) | Reject | The Monday email, the brief and Números cover reporting; team medians, not rankings, in shops of three to five. |
| 12 | A generic lens framework: list, board, calendar and map on every object (F-094) | Drop | L effort for parity. Build the events month grid with the events pack (F-183) and a map link for home services when a client asks. |
| 13 | The five-deep peek stack, relationship breadcrumbs and per-person card preferences in the first record page (F-001) | Defer to the second record type | About 40% of F-001's cost (2.5–3.5 of 6.5–8.5 ew); add each record type's peek with the module that creates it. |
| 14 | Speaking into the box (F-095 item 5) and an AI "plan my day" (F-080) | Drop | Typed "ask" must prove itself first; ordering a dozen rows adds little for a small owner. |
| 15 | One combined Hoy across several businesses (F-086) | Defer until a client asks | L-sized isolation work for a modest edge; a company switcher comes first. |
| 16 | The offline outbox and the child-care emergency card (F-109 items 4–5) | Defer | Replaying writes offline is the riskiest engineering in the list; the banner and a read-only agenda come first. The emergency card waits for the child-care pack, roles and a legal check, although study decision 10 recommends an offline read of a child's emergency file with the installable app; that departure is decision 34's. |
| 17 | The full brand studio: colours extracted from the logo and previews of surfaces not yet built (F-112) | Defer | Zero logos had been uploaded as of 2026-09-11, so demand is unshown. Ship remove-logo, previews of existing surfaces and a change history. |
| 18 | One portable record card for Gmail, Outlook, AI chats and the lock screen (the design lens; F-054) | Drop; revisit if customers ask | It waits on the MCP server and Google's review; four hosts, four sets of constraints. |
| 19 | The agent-operable slice of the public pages (F-102 item 7) | Drop; revisit with F-164 | Demand is speculative. The semantic markup that serves screen readers ships anyway and already helps agents. |

---

## 7. Integrations: Google, Microsoft and the rest

### 7.1 The owner's question, answered

**Yes (proposal): BIS should connect to Microsoft 365 and Google, starting with the owner's own calendar.** Today nothing in production connects to Google or Microsoft: Google sign-in is built but has no production credentials, there is no calendar sync and no add-to-calendar file, and the owner's own calendar and BIS can double-book. The study plans the whole track (study §6; S-22 to S-28, 15.5–22 ew); this plan schedules it and adds what the canonical features design around it.

| When | What | Study item or feature | Effort (ew) |
|---|---|---|---|
| Now | Google branding verified and published, Microsoft publisher verification | S-27 | 1 |
| Now | Google and Microsoft sign-in (Google while the project stays in Testing mode) | S-28 | 0.5–1 |
| Now | An add-to-calendar file on every booking, so the customer's own phone holds the appointment | F-048 (rider) | 2–2.5 |
| Next, first | A private, revocable calendar feed of the business's BIS bookings, in both languages, that Apple, Google and Outlook calendars subscribe to, with minimal customer detail. One-way: the owner's own events do not block Sofía's slots until S-22. Within about 15 minutes to an hour on Apple devices, as the device's fetch setting allows; a delayed view on Google and Outlook: Outlook refreshes about every 3 hours on Outlook.com and 6 on Outlook on the web, though it "can take more than 24 hours" ([Microsoft](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web)), Google publishes no interval and users report 8 to 24 hours, and Google users add it once from a computer ([Google](https://support.google.com/calendar/answer/37100?hl=en)) (proposal) | F-048 (part 2) | 1 |
| Next | The background job runner that calendar sync, subscriptions and retries need | F-196 | 3–4 |
| Next | **The owner's calendar**: busy times block Sofía's slots and the booking page; bookings write events with Meet or Teams links; events with a known customer join the record's timeline. Outlook first where the client runs Microsoft 365; Google's calendar scopes submitted for review alone, with a Testing-mode pilot until the review is submitted | S-22 | 6–8 |
| Next | Conexiones: one page to connect, see and cut every integration | F-148 | 2 |
| Later | Per-staff calendars and round-robin, once the owner's calendar has run with real clients (study decision 4) | S-23 | 4–5 |
| Later | Send-as-me from the owner's Gmail or Outlook | S-24 | 1–2 |
| Later | Drive and OneDrive pickers to attach files already in the owner's cloud | S-25 | 2–3 |
| Later | Contacts sync, direction chosen by the user | S-26 | 1–2 |
| Later | Spreadsheet import (`.xlsx`, and Sheets through the picker) with AI-suggested column matching, and `.xlsx` export | S-35 | 1–2 |
| On demand | Full inbox sync (direct for Outlook; Gmail only through a vendor holding the security assessment), then a Gmail add-on and an Outlook add-in | S-N10, study decision 13 | not in the total |
| After decision 7 | Meet and Teams transcripts | S-N14 | not in the total |

**The verification gates** (study §6.1, checked against Google's and Microsoft's documentation on 2026-09-25):
- **Google's sensitive scopes** (calendar, send-as, contacts) need one verification review with no fee: a privacy policy, a demo video of each scope in use and a justification per scope, typically 3–5 business days and realistically 1–3 weeks. The study's rule is to build the calendar, send-as-me, pickers and contacts sync under Testing mode (up to 100 test users, reconnecting weekly) and submit once. This plan ships the owner's calendar in H1 2027 and the other three in H2 2027–2028, so submitting once would keep Google calendar users in Testing mode for up to about eighteen months. **This plan therefore proposes two reviews** (a revision of the study's §6, listed in decision 34): the calendar scopes alone in H1 2027, with the project moved to In production when that review is submitted, as the study's §6.2 step 3 says, because Google reviews only a project already published to production (users who join between submission and approval see Google's unverified-app screen and count toward its lifetime cap of 100); then send-as and contacts in later, a second review reported at 2–4 weeks (study §6.1). Send-as and contacts are built and demonstrated in a separate Testing project, as Google recommends (study §6.2), so that the production project never asks real users for a scope not yet reviewed.
- **Google's restricted scopes** (reading the inbox, browsing all of Drive) need a paid security assessment every year, reported at roughly $540–$4,500 or more. That is why full Gmail sync waits for demand.
- **Microsoft blocks users, not apps.** Ordinary users cannot grant calendar access in a new tenant, so Outlook sync needs the business's Microsoft 365 admin, usually the owner at a five-person business, to approve once through an "approve for your company" link. Publisher verification is free and takes days, which is why Outlook can reach real clients first.
- **The calendar feed needs no review.** Calendars subscribe to F-048 part 2's feed as a link, so it asks for no Google scope and no Microsoft admin approval (§4.4).
- **Google Business Profile** needs its own API approval; its conditions, and the application BIS files this quarter, are in §4.2's operational steps.
- **Do better than both incumbents:** sync recurring events properly, and need no particular Microsoft licence.
- **Validate the order.** Hypothesis H17 asks every discovery call which calendar the owner and staff use (§10).

**Where email stops.** Inbound email in the first release (S-06) captures replies to mail BIS sends and anything the business forwards to a record's own address. Mail a customer writes straight to the business owner's own Gmail or Outlook does not reach the record until full inbox sync, which is direct for Outlook and, for Gmail, needs Google's paid annual security assessment, which the study recommends reaching through a vendor that holds it (decision 13); it waits for customers to ask (study §6.2).

**Google Sheets and Docs.** A customer list kept in a Google Sheet comes in today by downloading it as a CSV file, which the import wizard reads. Importing straight from a Sheet through S-25's Drive picker, with AI suggesting the column matching from the headers only, is part of S-35 as the study adopts and costs it (study §6.3 and §11.1; later); the picker's `drive.file` access adds no Google scope. Exporting to Sheets is a proposal, not costed; `.xlsx` and CSV cover that need until a client asks. Google Docs and Word files attach to a record through the Drive and OneDrive pickers (S-25, later); BIS's own quotes, invoices and contracts render as PDFs (F-113, later); no Docs or Word sync is planned.

**Not planned:** Microsoft Bookings, Google and Microsoft Forms, SharePoint and Google Chat (BIS replaces or does not need them), and the dropped F-054 (a record card inside Gmail, Outlook and AI chats). Task push to Microsoft To Do and Google Tasks, and Teams notifications, are not placed or costed in this plan; the study marks them "Later", and they return as proposals if a client asks.

### 7.2 Money: Stripe and QuickBooks

| Connection | What it does | When | Effort (ew) | Gate |
|---|---|---|---|---|
| Stripe for BIS's own billing (M7a) | Checkout, webhooks, the client Billing page, the non-payment pause | Now (parallel work) | 3.5–5 (S-62) | A Stripe key on production, which no deployment (production or preview) has today |
| Stripe Connect for the business's customers | Quotes, invoices, deposits, instalments, bank payments, payment links from Sofía and the chat; each business its own merchant of record | Later | 9–12 (S-29) | Study decisions 1 and 3; after M7a and entitlements |
| QuickBooks Online | Push-only sync of customers, invoices and payments | Later | 3–4 (S-32) | After money |
| The accountant's desk | A bookkeeper moves between the clients they serve | Future | 4–5 (F-146) | QuickBooks; view-only seats (study decision 14) |

### 7.3 Everything else

| Connection | Today | The plan |
|---|---|---|
| Telnyx (calls and texts) | Live for calls; texts built but held by the registration gate; numbers bought and registered by hand | Registration by hand now; the send gate by 1 December 2026; number purchase and registration inside BIS later (F-067) |
| Resend (email) | Live, with delivery status | Inbound email on the client's own domain, or a BIS reply subdomain for a business without one, in the first release (S-06) |
| OpenAI (voice, summaries, chat) | Live, with cost caps | Zero retention or a BAA requested now (decision 6); one model gateway (F-020) |
| Vercel Web Analytics | Live on BIS's own site | Unchanged; Search Console and PageSpeed remain planned only |
| Daily.co (video) | Built, dormant | Retire it if decision 7 goes as recommended (Meet and Teams links instead) |
| Google Business Profile | A manual checklist tick | Reviews and AI replies (S-34) and hours kept in step (F-161), both later, after API approval |
| Meta (Facebook, Instagram, WhatsApp) | None | A WhatsApp link that measures demand next (F-070); lead ads later and direct messages in 2029–2030 (F-193), if the Expo confirms H2 |
| The MCP server | None | Later (S-33): reads answer at once, writes become proposals; the auth spike proves tokens are scoped to one client organisation. Because Microsoft 365 Copilot (through Copilot Studio) and other assistants accept MCP servers, S-33 may also reach owners who work inside Microsoft 365 or Google; S-33's spike checks which clients a small business can actually use, since Copilot Studio needs its own licence (proposal) |
| Restaurant reservation and ordering systems (OpenTable, Resy, SevenRooms; Toast, Square, Clover) | None | Research only (study §9.3). Sofía texts or reads out the restaurant's own link (F-199); POS research comes with the catering pack (S-45) |
| Industry systems (child-care, law, insurance) | None | One adapter each, after research and tied to a signed tenant that asks (S-46 later; S-57 and S-58 future) |
| Lead marketplaces (Google's Local Services ads, Angi, Thumbtack, Yelp) | None; their leads reach BIS only by hand | Proposal, not costed: where a marketplace offers a lead feed or a lead email, its leads enter through the form pipeline as a named source (F-157), with the home-services pack in later. Whether each offers a usable feed is checked first, and the discovery calls ask where trades' jobs come from (H6). Consumer financing for large jobs is not planned; the money track asks whether trades need it |
| HubSpot and monday.com | None | A comparison of BIS's own HubSpot and monday accounts with this plan, through the vendors' connectors, before the importers are built (study §14); importers when a switching prospect needs one (S-36, later); a switch kit for GoHighLevel, Jobber and HoneyBook in 2029–2030 (F-150) |
| Zapier, Make and n8n | None | API keys and signed webhooks for outside tools only (F-149, future); the full public API is dropped |

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Scope outruns capacity.** The plan totals 686.9–942.3 ew, and the study notes that Appendix D's estimates assume a team of two or three | Plan at 5–6 ew a week, re-measured monthly; at a pace of three to four, the owner re-scopes, or adds capacity to one named track, rather than re-orders (§4.1); a written cut order for now; slices of 4 ew or less, each shipped to a real client; a named tail in later that slides to 2029 first (§4) |
| 2 | **The revocation rules change under a live texting programme.** The FCC's draft order, to be voted on 30 September, may change revocation scope from November or December 2026; the duty in force since April 2025 already binds from the first text | The chain is live by 1 December 2026; no account texts before its gate; counsel reads the order after the vote and the adopted text in the week it is published (§4.2) |
| 3 | **AI writes without a person.** Sofía and the web chat already write some records live, against constraint 5 | One review tray for every new AI write; Sofía's blank-fills become proposals now; author stamps and undo on the caller-confirmed acts that stay live; no new live path before decision 19 is dated (§3.2 rule 4) |
| 4 | **Sensitive data before permissions.** Custody, gate codes, immigration status and children's health details need roles that do not exist yet | No restricted field before F-004 enforces restriction; no new path sends a health-marked document or field to a model before decision 6's terms, and the zero-retention request goes out now (§3.2 rules 3 and 14) |
| 5 | **Operations are thin.** Monitoring and a tested restore are not yet in place | The operational floor ships now: heartbeats, an alert pass, a restore drill and a per-account call forward (F-119, F-120) |
| 6 | **Demand is unvalidated.** The pricing study's risk 8 still stands (§4.2); events, child care and restaurants rest on hypotheses | The Expo and the October and November discovery calls ask H1 to H23's questions, and the measurements (H13, H20) and the trial (H22) answer the rest; a feature whose hypothesis comes back "no" is dropped (§10) |
| 7 | **The Spanish claim does not survive a test.** Four of six local competitors already claim Spanish | A published quarterly comparison (F-194), a language-parity report (F-130), and a build gate that fails on any new English-only string (F-013) |
| 8 | **Outside reviews stall.** Google's scope review, the Business Profile API, Meta's app review and the carriers' 3–7 business days | Outlook first; Google's calendar scopes submitted alone in H1 2027, a Testing-mode pilot until they are submitted; applications filed this quarter; texting states shown to owners in plain words |
| 9 | **Plans are not enforced, and AI costs are uncapped per plan.** No call or chat path reads the plan flag today | Entitlements (S-13) follow M7a's checkout in next; one model gateway with budgets and kill switches in the first release (F-020) |
| 10 | **Regulated professions carry ethics exposure.** A receptionist that gives legal advice or discusses policy terms can breach Texas rules | Guardrail modules tested in both languages (F-174), inbound-only for law firms, counsel's review of the insurance intake, and the Opinion 680/705 sheet and the law module before Sofía is sold to law firms (F-124, F-174) |
| 11 | **One person carries the product.** The pace, the agents' output and the operating knowledge rest on the owner and a very small team | The runbooks and this plan's written rules; the operational floor's alerts reach more than one person; the monthly pace check shows early when capacity drops (§4.1); and, as a proposal, a second engineer or a contracted track once two consecutive months come in under four ew a week (§4.1) |
| 12 | **One model vendor.** Sofía, the summaries and the chat all run on OpenAI, and the platform spec's no-external-services rule, on which study decision 2 rules, keeps it to one provider | One model gateway (F-020) so that a second provider is a configuration change once decision 2 allows it; the per-account kill switches; the call forward (F-120) keeps phones ringing if the model is down |
| 13 | **A known security item is used before the sprint closes.** The repository is public, so anyone can read the code | The hardening sprint runs first, before client sign-ins scale and before any security questionnaire is answered; its items are tracked privately, never here; the operational floor's alerts tell BIS when something breaks (§4.2) |

---

## 9. Decisions the owner needs to make

The study's decisions 1–18 stand and are not repeated. Those this plan needs soonest are 1 and 2, before the first release; 6, the zero-retention request; 14, the plan shape M7a ships; 15, selling Sofía first; and 16–18, which F-173's vetting uses as recommended defaults until the owner confirms them. In one line each, those October decisions are:
- **1:** reverse the platform spec's non-adoption of payments, invoicing, documents and e-signature;
- **2:** the "no external services for core features" rule. The study recommends accepting ClamAV (the vault's scanner) and Stripe and deferring the rest (BoldSign or SignWell, Nylas). This plan departs from that where it names a vendor, each marked "decision 2" in §4: F-057's v1 multi-signer e-signature above all, so multi-signer contracts for events and padrinos wait on this decision, or on sequential signing built in-house;
- **6:** request zero data retention or a BAA from the AI provider, with no health-marked document reaching a model meanwhile;
- **14:** the plan shape M7a ships (how many plans, logins, storage per plan, portal placement, view-only seats, AI and MCP on every plan), and a receptionist-only plan shape for the seasonal tax offer and the auto-shop add-on, which binding constraint 3 strains (S-61 reads it as the Sofía plan sold seasonally, through F-142's levers or, if they slide, the ordinary plan for the season's months, with the vault's uploads switched off for those tenants so that decision 18's "stores no tax documents" still holds);
- **15:** sell Sofía before the packs: to insurance agencies and event venues at once, to law firms once the 680/705 sheet states the AI providers' retention terms (this plan adds: and once F-174's law module ships in next, §5.14), and to seasonal tax preparers once the security contract and U.S.-only processing attestation exist;
- **16 to 18:** insurance scope (property and casualty now; ACA storefronts and final-expense agents only after a review; Medicare and group health never without HIPAA); immigration tenants (licensed attorneys with the bar number checked, and DOJ-recognised organisations with accredited representatives; Sofía inbound-only for every law firm); tax preparers (a seasonal receptionist-only offer that stores no tax documents).

One choice is not numbered, because it arises only if the monthly pace check fails: re-scope the plan, or add capacity to one named track (§4.1). The numbering continues from 19. Each decision below gives today's position, the options, the recommendation with its reason, and what it blocks.

#### 19. Does an act the caller asks for count as an AI write? (F-022; binding constraint 5)

- **Today.** Sofía creates contacts, fills blank fields, and books, reschedules and cancels appointments directly, with no person approving; only her post-call suggestions wait for a person, and her acts carry no author stamp of their own (voice, CRM and booking inventories). The web chat also creates or matches a contact, opens a thread and files a submission with no person approving (web-chat inventory). The skeptic marks this reading the most consequential in the canonical list.
- **Options.** (a) A narrow reading. Acts the caller or visitor asks for and confirms (aloud on a call, in the chat for a visitor) run live: book, reschedule or cancel their own appointment, leave their own name and number, and receive by text a link they ask for (F-199's reservation or ordering link; the pay link of F-058 and S-29). Once chain step 5's detection uses a model (after decision 6), its hold on sends also runs live, because it only stops messages and a person confirms or undoes it from To do at once. The exception is meant to cover only the caller's or visitor's own booking or record, and it relies on S-47's identity checks (F-116) to establish which booking or record that is. Each live act is stamped as AI, visible on the record and undoable. Everything else, filling blank fields on an existing contact included, goes through the review tray. (b) The strict reading. Every such act becomes a proposal, bookings included. (c) F-022 as written, with blank-fills live as well.
- **Recommendation: (a).** A receptionist that cannot book while the caller is on the line is not a receptionist, so (b) would unship the product. Blank-fills are the machine's judgement about a record, and the tray already has a proposal kind for them, so (c) widens the exception for nothing. Write (a) into the rules with a date. The owner is also asked to confirm §3.2 rule 4's definition: a live reply inside a call or chat the customer started, and a labelled summary or description shown only to the business's own people (F-028's descriptions, F-100's paragraph), are not AI writes. *Blocks:* F-022's item 1 (first release). The links Sofía and the chat text (F-199, F-058, S-29). Chain step 5's hold once its detection uses a model (F-133). The chat's updates after filing (F-023, F-036). F-024's memory writes. Machine-created holds (F-051). F-028's descriptions and F-100's paragraph, if the owner reads them as AI writes.

#### 20. Should every assistant say it is an AI, up front? (F-034)

- **Today.** The V1 voice spec lists AI disclosure in the greeting among the demo lessons it ports (spec §3.3), but its implementation plan and the shipped prompt tell Sofía not to volunteer it and to admit it only when asked (`apps/web/src/lib/voice/system-prompt.ts:63`). The chat shares that line and carries no AI label.
- **Options.** Keep "only when asked". Disclose by default on every account, with the owner choosing the phrasing from approved variants but unable to remove it. Disclose only where a pack or a law requires.
- **Recommendation: disclose by default, measured first on one account for four weeks** (booking rate and hang-ups; hypothesis H22). The recommendation rests on trust and on H22's measurement, not on legal pressure: TRAIGA's disclosure duty binds government agencies and health-care providers, which BIS's current segments are not. Going first makes it a trust claim, and one behaviour everywhere is cheaper to test. It is not a revisit of a recorded spec position: it brings the code back to the V1 spec's, reversing a choice the implementation plan made. Counsel reads the wording and names any state rule that binds a client outside Texas. *Blocks:* F-034 (parallel work, now). The statutory lines in F-174's modules. F-127's recording notice.

#### 21. May Sofía hand a call to a person on a rule, rather than on the caller's request? (F-133, F-084; the call-handoff spec)

- **Today.** The handoff spec says "the caller asks. Nothing else". Transfer is off for each company until the agency sets a number. The study goes the other way: its guardrail packs carry "hot-transfer rules" (study §9.6 item 1), and for law firms Sofía "hot-transfers detention, same-week-hearing and ICE-encounter calls to a person" (study §9.5).
- **Options.** Keep the spec: every emergency path becomes an offer the caller accepts ("¿Quiere que le comunique con alguien ahora?"). Or follow the study: rule-based hot transfers inside the guardrail packs, on detected emergencies and fraud.
- **Recommendation: keep the spec, which moves the study's position (decision 34).** An automatic transfer that rings a phone nobody answers is worse than an offer plus an urgent task. The handling for failed transfers (F-035) is not built. Reword F-084's storm mode to "a caller who asks for a person is still transferred". *Blocks:* F-084's wording (parallel work, now). F-133 part 2. F-174's urgency offers. F-035.

#### 22. Rooms as bookable resources, and one calendar per account (F-051, F-183; study decision 4)

- **Today.** Exactly one bookable calendar per company, enforced by the schema, and the database refuses overlapping bookings on it.
- **Options.** Rooms as resources now, reversing one-calendar-per-account before per-staff calendars exist. Rooms after per-staff calendars, as the study orders them (study §11.3 step 7). Never.
- **Recommendation: after per-staff calendars.** F-051 ships the `held` status on today's single calendar, which is all the events receptionist needs. Reversing the constraint twice is the costly path. *Blocks:* Rooms in F-051, F-183 and F-185. S-49.

#### 23. WhatsApp: the next channel after the ledger, or only once measured demand (H7) justifies it? (F-070; study decision 11)

- **Today.** No WhatsApp in the product. Decision 11 recommends it as the next channel after the consent ledger, with the provider researched first.
- **Options.** Keep decision 11's order. Or F-070's order: phase 0 (a `wa.me` link whose clicks measure demand, and a one-week spike) in next; inbound threads later; templates BIS starts only after the ledger. The difference from decision 11 is not the order relative to the ledger (phase 0 runs in next, after the ledger goes live on 1 December 2026) but the demand gate and the horizon: inbound threads wait in later for hypothesis H7.
- **Recommendation: F-070's order.** Phase 0's link costs about a day and its spike about a week (0.5–1 ew), and they produce the demand data decision 11 lacks, while the ledger-first rule for anything BIS starts is kept. Meta becomes a new processor (study decision 2) and would be a fourth meter in M7a's allowances. Meter nothing in phase 1, and list Meta as a subprocessor first. *Needed by:* the January 2027 sitting, before next starts. *Blocks:* F-070's phase 0 (next) and part 2, F-028, F-043, F-193's direct messages, and F-031's WhatsApp leg.

#### 24. What the Monday report may carry (DESIGN.md's weekly-report pattern; F-100)

- **Today.** The pattern fixes four numbers (calls answered, leads captured, bookings, website visitors) and three rules. About twelve features propose a line of their own: F-017, F-018, F-029, F-042, F-078, F-141, F-143, F-154, F-156, F-157, F-162 and F-178.
- **Options.** Keep four fixed numbers. Choose them by plan and pack from one catalogue, under a budget. Let features add lines freely.
- **Recommendation: amend the pattern to "up to four headline numbers and at most two lines, chosen by plan and pack from the metrics catalogue (F-100)".** The three rules stand (a delta in words, omit what was not measured, a quiet week still sends). Recipients stay on the account, and the field stays the switch. One owner and a budget stop the email from accreting, and a CRM-only plan's report should not lead with calls it does not take. *Blocks:* F-100, and through it F-029, F-082 and F-178. Every feature that wants a line.

#### 25. What may higher plans hold besides Sofía and the web chat? (study decision 14's scope; binding constraint 3)

- **Today.** A plan's features accept exactly two keys (the voice receptionist and the web chat), and its allowances exactly three meters. Nothing on the call or chat path reads either yet.
- **Features that propose more.** F-062's Stage 2, F-135's link domains, F-143's footer removal, F-130's AI record and F-164's storefront would all gate on higher plans. The study's §10 puts the portal and per-staff calendars there too.
- **Also here.** One narrow exception is proposed: a tax preparer gets the CRM with the vault's uploads switched off (S-61); until that switch lands, S-53's vetting holds tax preparers (§5.14), so that BIS keeps study decision 18's "stores no tax documents" and the lighter Safeguards Rule and IRC §7216 duties that buys. The alternative is to accept tax documents in the vault, with those added duties; the owner rules. The value judge asks how F-160's generated business page sits beside the websites BIS builds and hosts for clients. Under the strict shape it is a CRM feature on every plan, and the website work stays a separate service.
- **Options.** Gate each as proposed. Or the strict shape: higher plans add Sofía, the web chat and bigger allowances (minutes, chats, storage, staff logins, connected calendars), and nothing else.
- **Recommendation: the strict shape.** Every plan gets every CRM feature, the portal included, and per-staff calendars become an allowance. Constraint 3 reads that way. Each extra gate is a migration, a Stripe price and an enforcement point. And "everything but the receptionist, on every plan" is a sentence an owner can repeat. *Blocks:* S-13's scope (next). F-062, F-143, F-135, F-160, F-164, F-189, the plan line of F-130, and S-61's vault switch.

#### 26. May a test-only tool use the MPL-2.0 licence? (axe-core; F-102, F-103)

- **Today.** The platform spec allows MIT, BSD or Apache libraries only. axe-core, the standard automated accessibility checker, is MPL-2.0.
- **Options.** Allow MPL-2.0 for development dependencies that never ship to customers. Or keep the rule and check accessibility by hand or with a weaker permissive tool.
- **Recommendation: allow it for test-only development dependencies, and write that into the platform spec.** MPL-2.0's obligations attach to modified MPL files that are distributed, and a test runner is not distributed with the product. Without it, automated WCAG checks are much weaker. *Blocks:* The accessibility gates in F-102 part 2 and F-103, and the WCAG amendment in decision 35.

#### 27. Should BIS designate an exclusive opt-out method under the FCC's revised order?

- **Today.** The rule in force forbids designating an exclusive means of revocation (47 CFR 64.1200(a)(10)), and nothing is designated. The draft order released on 9 September 2026, for a vote on 30 September, would let a sender name one or more of three methods (a key-press opt-out, standard text keywords, or a website or number) as the exclusive means of revocation, if the method is disclosed clearly in every call or text. Its keyword method is defined by English words, so an exclusive keyword list would not cover "ALTO" or a sentence in Spanish.
- **Options.** Designate text keywords as the exclusive method. Or keep honouring any reasonable method, in either language.
- **Recommendation: keep honouring any reasonable method.** Valley customers will write "ya no me manden mensajes", not a keyword. Honouring them is the bilingual promise BIS sells (F-065, F-133). And a method disclosed in every text costs segments on every send. Revisit only if counsel finds that the free-text path adds more risk than it removes. *Blocks:* The keyword list and the stop confirmation in the legal chain (step 4), and F-133's scope.

#### 28. May owners edit what Sofía knows? (F-084, F-037)

- **Today.** Every change to Sofía goes through the agency.
- **Options.** Keep it agency-only. The middle option: owners edit the business status and closures now, and facts later, versioned; the greeting changes through a request to BIS until rehearsal exists; guardrails never. Full owner control.
- **Recommendation: the middle option.** The one switch (F-084) in the now horizon needs a narrow owner grant for status and closures, and facts follow in F-037's second part. Guardrails never become owner-editable, because they are what makes law and insurance sales safe. *Blocks:* F-084's owner grant (parallel work, now). F-037 part 2, F-096 part 2, F-040.

#### 29. May owners edit automations? (F-071, F-049, F-072)

- **Today.** Every recipe starts switched off, and only the agency can configure one. The one exception is the booking follow-up email, whose switch and wording sit in the calendar settings a client can already edit.
- **Options.** Keep it agency-only. The middle option: owners toggle, reword (as English and Spanish twins) and re-time transactional instances within bounds the pack sets; marketing instances stay agency-set; nobody composes a new instance in version 1. Full owner control.
- **Recommendation: the middle option.** Reminders and the after-job check-in are the business's own voice. Marketing is where the legal exposure lies (SB 140), so it stays with the agency. The State's position in *Ecommerce Marketers Alliance v. Texas* (W.D. Tex., dismissed in 2025) is that SB 140's registration does not reach consent-based programmes ([Consumer Financial Services Law Monitor](https://www.consumerfinancialserviceslawmonitor.com/2025/11/texas-attorney-general-confirms-opt-in-sms-is-outside-registration-under-sb-140/)), and the Secretary of State's registration FAQ now says a business texting with prior consent need not register ([Secretary of State](https://www.sos.state.tx.us/statdoc/faqs3400.shtml); commentary: [K&L Gates, 14 September 2026](https://www.klgates.com/thought-leadership/Litigation-Minute-Text-Message-Marketing-in-Texas-One-Year-After-SB-140-9-14-2026)). The FAQ is not binding; the Secretary of State requested an Attorney General opinion on 17 December 2025 (RQ-0626-KP), still pending; and no court has decided the question in a contested case, since the November 2025 dismissal order, entered on a joint motion, records the State's position. That lowers the exposure where the ledger proves consent but does not remove it; counsel confirms. *Blocks:* the owner switches, not the features, which ship agency-configured: in F-049's text legs, F-071 and F-072, and the automations section of F-096 part 2.

#### 30. Four trigger primitives instead of a rule builder? (F-071; study decision 12)

- **Today.** Eight fixed recipes. The rule builder is deferred by decision.
- **Options.** Keep deferring everything. Four fixed primitives, declared per pack and never composed by users: a date offset, a stage entered, a document expiring or missing, a visit completed. A rule builder.
- **Recommendation: the four primitives, agency-configured first.** Every pack's value runs on date clocks (events T-30, insurance X-60, law deadlines, child-care expiries), and fixed primitives answer them without a builder's support cost. They revisit decision 12 in part, so the choice is the owner's. *Blocks:* F-071, and through it the pack clocks beyond S-21's (S-40 onward). S-21, the study's own date triggers, goes ahead either way; if the answer is no, S-40 ships its clocks as agency-set recipes on S-21, as the study plans.

#### 31. Test calls to a prospect's own line (F-147; study §5.3)

- **Today.** Sofía is inbound only, and the study's §5.3 says no outbound AI agents yet.
- **Options.** Allow consented AI test calls to a requester's own business line, as a prospect audit and a monthly check for clients. Or keep the study's §5.3 as it stands.
- **Recommendation: keep the study's §5.3.** A person from BIS places prospect audits by hand, with vendors met at the Expo and in sales calls (H21). An automated runner waits for counsel's reading of the TCPA and Texas chapter 302, and for F-173's vetting of the prospect's industry. F-045 (callbacks placed by Sofía) is dropped for the same reason. *Blocks:* F-147 (future).

#### 32. Keep Google's business profile in step with BIS? (F-161; the platform spec's §8a non-adoption of listings)

- **Today.** No listings sync. The Google profile is a manual checklist tick, and the platform spec records online listings as not adopted.
- **Options.** No listings. A narrow revisit: the Google profile's hours and special hours only, from F-084's record, after API approval. Full listings, Apple and Bing included.
- **Recommendation: the narrow revisit.** One holiday prompt that updates Sofía, the booking page and Google is a real benefit to owners. Apple and Bing need new partner routes (study decision 2) for little reach in the Valley. *Blocks:* F-161 (later).

#### 33. Ratify the recorded spec positions this plan changes

- **Needed now:** the M2 client-access spec's "no member sync", because staff and roles (S-01) must populate users and memberships (F-117 too); raising the same spec's five-membership cap for any company that needs a fifth login, as the spec itself allows, until F-117's later part prices logins (§4.3); the same spec's agency-only settings, in part, for the owner's Mis preferencias (F-096 part 1); the booking spec's "reschedule as cancel plus rebook, and no calendar file" (F-048, a rider); the booking spec's fixed reminder timing (F-049 part 1, reminders however late they booked); the call-proposals spec's "no editing before accept" (F-019); phase 6's "fuzzy search deferred" (F-092 part 1) and its "no keyboard-shortcuts help surface" (F-095 part 1's bilingual "?" sheet, Surface 4), and, narrowly, the dedupe spec's "no fuzzy name matching" (F-092 part 1, F-006); automations spec B's "no second scheduler" (F-196).
- **Needed when the feature starts:** the concierge spec's "no booking from the widget" (F-036 part 2); the work-queue spec's "no dismissals table" (F-077 part 2); the SMS spec's exclusion of inbound auto-replies (F-069); M1b's "templates as a non-goal" (F-068 part 2); engine B's single quote follow-up (F-056); the A2P and onboarding specs' "no in-app registration, no number purchase" (F-067); phase 4's saved filters (F-093); the weekly-report spec's "no reporting screen with a date range" (F-100's Números); phase 5's client-facing setup view (F-099 part 2); M7a's out-of-scope annual plans and coupons (F-142, F-145); M1d's "no version history" for blueprints (F-176) and its "no hand-authored JSON" (F-171); engine B's "no text back after YES/NO" (F-049's text legs); engine B21's reply-only opt-out footer (F-065 part 2); the call-handoff spec's exclusion of warm transfer, and the shipped rule that answering-machine detection on a transfer is recorded but never acted on (F-035); the voice-core spec's deferral of recording (F-127), and the V1 voice spec's "outbound calling of any kind" (F-073's bridged calls from the business number); the booking spec's deferral of waitlists (F-050), and its "month-grid calendar UI" (F-183's events month view); phase 6's decision 3, cross-account search deferred (F-136); pricing logins into the plans (F-117's later part), once the cap has been raised by hand where needed; engine B's "no link" in the referral ask, which stays in force because F-018's referral link is cut, and comes back here only if H6 says yes.
- **Kept, not revisited:** the teardown boundary (company deletion stays out of reach of app code; F-121 adds one guarded worker); the platform spec's marketplace (F-148 and F-164 are not one); its affiliate manager (F-143 is an attributed footer, not one); and its website builder (F-160 is a generated page, not an editor).
- **Recommendation: ratify the first group now, in one dated sitting.** Each was deferred for scope, not principle, and the features that need them are small. Decide the second group as each feature starts, because the argument depends on what the first release teaches. *Blocks:* The features listed.

#### 34. Study positions this plan moves (study §6, §7.2, §9.5–9.6, §11.3 and decisions 5, 10 and 15)

- **Moved later, or changed, needed now:** the regulated-tenant mode (S-39, 1–2 ew), which study decision 5 recommends building now and §11.3 step 1 lists with no prerequisites, is placed in later. The argument: no clinic can sign while decision 5 holds, F-173's vetting holds HIPAA verticals at onboarding meanwhile (only adult day care and home health are turned away), and the now horizon has no real room for it: at five a week it is already 7–9 ew over after its cut order (§4.1), and at six a week S-39 would leave as little as 0.2 ew. Google's single sensitive-scope submission (study §6.2 step 3) becomes two reviews, so that Google calendar users are not held in Testing mode until later (§7.1).
- **Changed, needed now:** the study's hot-transfer rules in the guardrail packs (study §9.5–9.6) become offers the caller accepts, because a transfer nobody answers is worse than an offer plus an urgent task (decision 21).
- **Changed, needed now:** the study lets texting run under an interim staff routine until the consent ledger ships (study §9.6). This plan keeps the routine (chain step 0) but lets no account text before the send gate is live on 1 December (§3.2 rule 1), whatever the carrier says, because only the ledger proves consent and a missed revocation is a per-message liability. The cost: a live client whose registration clears in October keeps email-only reminders, and no missed-call text-back, until then.
- **Moved later, when the feature starts:** the studios pilot, from the study's months 9–12 to 2029–2030 (F-191), because home services, law, insurance and events fill later; the offline read of a child's emergency file, part of study decision 10's recommendation, waits for the child-care pack, roles and a legal check (§6.7 row 16); and Sofía for seasonal tax preparers, which the study sells while the foundation is built, starts with the January–April 2028 season (S-61), because MFA per business, the security contract and U.S.-only processing (F-117, F-124, F-134) land in later, so the 2027 season is skipped. Until then, S-53's vetting holds tax preparers, CRM included, because the first release's vault has no per-tenant off switch; the owner may instead pull S-61's switch forward and admit them CRM-only (proposal; §5.14). Its seasonal price rests on F-142's levers, which sit in later's named tail; if they slide, the season is sold on the ordinary Sofía plan. The offer's shape changes too: the study's receptionist-only offer becomes the Sofía plan with the CRM included (binding constraint 3), and its "stores no tax documents" is kept by switching the vault's uploads off for those tenants (decisions 14, 18 and 25).
- **Pulled forward.** HubSpot #22, with study §11.1's NPS: F-072's two-question check-in. Scheduled AI prompts: F-029 and F-082, now inside F-100. monday #14, sequences: F-079's second phase. HubSpot #17 and monday #15, a staff business number: F-073. Multi-currency: F-060, folded to a labelling rule.
- **Recommendation.** Keep S-39 in later unless a clinic asks before decision 5 is ruled, and rule the two-review Google path now; binding constraint 2 is unaffected either way. Rule the hot-transfer change with decision 21. Accept the wait for the send gate. Accept the three later moves, and name the tax season in S-61's row if the prerequisites land sooner. Accept F-072's check-in and F-100's written paragraph, under decision 24's budget, because both are small and extend things owners already receive. Keep sequences behind their own decision when F-079's second phase starts. Cost the staff number in future (F-073, 3–4 ew), not earlier. Take only the US$ and MX$ labels from multi-currency. *Blocks:* S-39, S-22's Google review, F-084's storm wording and F-174's urgency offers (the "needed now" group), F-191, the emergency file and S-61, F-072 and F-100 (later), F-079's second phase, F-073.

#### 35. DESIGN.md amendments, in two sittings (F-101)

- **Today.** DESIGN.md says to stop and flag rather than improvise. Section 6.5 tables the amendments the features need.
- **First sitting, October 2026, for the first release:** new v2 sections for the record page, documents and provenance, each provisional until a real client uses it (row 20); the module contract (row 10); "at most one hero", on which the first record page relies (row 11); bilingual in the definition of done (row 18); the operator's default theme ("dark-first" on paper, light in the code), because F-096 part 1 stores each person's choice (row 1).
- **Second sitting, January 2027, for next:** the phone amendments for F-107 part 2: rule 10 on a phone, blur on the bottom bar, the "+" as chrome, AI presence on a phone, record views on a phone (rows 2 to 6; until then the first release's record page and vault follow today's drawer rule on a phone, and the record page's and vault's phone sheet ships inside F-107 part 2, in next); the sidebar spine for F-089 (row 7); the palette as the one box (row 9); the weekly report (row 13, decision 24).
- **When their features start:** one launch plan replacing the Checklist entry (F-099, row 8); a delta names its window (F-076 and F-100, row 12); WCAG 2.2 AA in the definition of done, and the look it changes (F-103, with decision 26; rows 16 and 17); the booking card and calm customer surfaces (F-102 part 2, rows 14 and 15); "Powered by BIS" (decision 25, row 21); agency sign-in branding (F-138, row 22); the partner line on the signed-out shell (F-145, row 23); the person overrides, larger text and more contrast, when F-096's later part starts, and the lite ground with F-110 (row 19).
- **Recommendation: rule in two dated sittings, October 2026 and January 2027**, so that no feature ships nouns or patterns the contract does not yet allow. Until an amendment is dated, new modules go into today's sidebar groups. Fix the chart that gives the hovered bar the `bar-hot` treatment in code rather than amending the Charts rule: the rule is right, and the code drifted from it. *Blocks:* F-101 (first release), F-107 part 2, F-089, F-088, F-092 part 1, F-095 part 1, F-100, F-099 part 2, F-103, F-102 part 2, F-062 (row 15), F-160 (row 11), F-143 (row 21), F-138 (row 22), F-145 (row 23).

---

## 10. What to validate first

The value judge flagged 26 features FLAG-M: each rests on a Valley pattern nobody has checked, or revisits a recorded decision. The table maps each to a hypothesis, a question, and the people to ask. Features whose flag is really an owner decision point to it instead:
- F-034 (decision 20, and H22 measures it);
- F-062 (decision 25);
- F-089 (decision 35);
- F-142 (study decision 14, and H11);
- F-147 (decision 31, and H21);
- F-161 (decision 32, and H20).

F-032, the last of the 26, is dropped. None of the others is built beyond its cheapest part until its answer is in: F-003's relationship labels and F-018's source question ship now because they cost almost nothing, and F-034's disclosure runs first as a measured one-account trial (H22). **The Expo on 27 September starts H1 to H4, part of H7 and H21; the October and November calls finish them** before any events work is built.

| # | Hypothesis | The question to ask | Whom, and where | What waits on the answer |
|---|---|---|---|---|
| H1 | Padrinos and other sponsors pay the vendor separately | "When a quinceañera has padrinos, who pays you: the family in one payment, or each padrino on their own? How do you keep track of who has paid?" | Salones, planners, photographers, DJs, bakers and dress shops; at the Expo, then 5–10 calls | F-061, F-184, F-183's payments, F-003's "paga por" |
| H2 | Event inquiries arrive through Facebook and Instagram messages more than through forms or calls | "Where did your last ten inquiries reach you: a call, a text, WhatsApp, a Facebook or Instagram message, your website, or in person?" | Event vendors at the Expo | F-193 |
| H3 | Salones take cash and layaway, and give paper receipts | "How did your last five clients pay the deposit and the rest? Do you offer apartado? What receipt do you give?" | Event vendors at the Expo | F-059, F-060 (folded), F-183 |
| H4 | Venues hold a date before a deposit, for a set time | "When someone wants a date, do you hold it? For how long, and what ends the hold?" | Salones and venues at the Expo | F-051, F-183 |
| H5 | A relative often speaks or pays for the customer | "How often does a son or daughter call about a parent's account? Do you need the parent's permission on file? Does anyone pay for someone else?" | Two insurance agencies; an HVAC prospect's office | F-003 parts 2 and 3; F-116's knowledge factor |
| H6 | Most new customers come by word of mouth, and the owner knows who sent them | "Of your last ten new customers, how many were referred? Do you know by whom? Do you thank them?" For trades: "Where did your last ten jobs come from: Google's Local Services ads (the 'Google Verified' ads at the top of Search, once called 'Google Guaranteed'), Angi, Thumbtack, Yelp, or referrals?" | Every discovery call | F-018's referral link (the source question ships now in F-157), F-155 |
| H7 | Spanish-speaking customers prefer WhatsApp to texts | "Do customers ask to WhatsApp you? About what share of your messages are on WhatsApp?" Then count F-070's phase-0 clicks | Every discovery call; the live client | F-070 part 2, F-043, F-028, F-031's WhatsApp leg |
| H8 | Owners want to change what Sofía says themselves, rather than ask BIS | "When your hours or prices change, would you rather change them on your phone, or tell us?" | The live client; receptionist-first prospects | F-037 part 2, F-040, F-096 part 2 |
| H9 | Child-care centres want a Spanish front office beside their management system | "What does your system not do for families who call or write in Spanish? Who answers the phone at 6 pm?" | Three to five centres (study §13) | S-42, S-46, F-185, F-188, F-198, F-050 |
| H10 | Restaurants want a phone front desk for hours, large parties and catering | "How many calls a day are reservations, takeout orders, hours, directions or large parties? Who answers them during the dinner rush?" | A handful of Valley restaurants | F-199, F-186, S-45 |
| H11 | Owners would buy Sofía for the busy season only, or pause and keep their number | "Which months are your busiest? Would you pay for the receptionist only then?" | Tax preparers, HVAC shops, event vendors | F-142, S-61 |
| H12 | Crews work where the phone signal drops | "Where do your technicians lose signal, and what do they do then?" | HVAC prospects' technicians; other trades | F-109's field outbox |
| H13 | AI assistants already call Valley businesses for their customers | No question: count, from the transcripts, calls to the live lines placed by an AI assistant, for one quarter | Call records, not the Expo | F-156, F-164, F-042 |
| H14 | Winter Texans are a large share of some trades' customers | "What share of your customers live here only in winter?" | HVAC and pest-control prospects | F-016 (dropped unless the answer is yes) |
| H15 | Chambers, UTRGV and bookkeepers would refer clients or help set them up | To a chamber: "Would you offer members a discount page?" To UTRGV and bookkeepers: "Would your students or staff help set up a business, for pay?" | Two chambers of commerce, UTRGV, two bookkeepers | F-145, F-137 |
| H16 | Small owners would use a written security programme scaled to their size to gain Texas's safe harbour from exemplary damages (below 20 employees, password rules and staff training within a recognised framework such as the CIS Controls; 20 to 99 employees add CIS IG1) | "Do you have a written policy for customer data? Would you use one we write with you?" | The live client and two prospects, as a content pilot (three clients once there are three) | F-125 |
| H17 | Valley owners keep their calendar in Outlook more than in Google | "Which calendar do you and your staff use: Outlook, Google, the phone's own, or paper?" | Every discovery call | S-22's order (Outlook first is the study's default); S-23. The feed (F-048 part 2) ships regardless; the answer sizes its value, which is highest for owners on the phone's own calendar, Apple's in particular, where it refreshes fastest |
| H18 | New clients arrive with years of paper files they want on the record | "Where are your customers' papers today, and how many are there?" | Child-care centres, insurance agencies, trades | F-197 |
| H19 | Many prospects have no website | "Do you have a website? Who keeps it up to date?" | Every discovery call | F-160 |
| H20 | Valley businesses' Google profiles show wrong hours | No question: compare the live client's and prospects' Google hours with what they tell us | The agency, as desk research | F-161, F-170 |
| H21 | Prospects accept a consented test call to their own line | "May a person from BIS call your line as a customer would, and show you what happened?" | Vendors met at the Expo; prospects on sales calls | F-147 (with decision 31) |
| H22 | Saying up front that Sofía is an AI does not lower bookings | No question: one account, four weeks, booking rate and hang-ups before and after | One consenting live client | F-034 (with decision 20) |
| H23 | Some owners run several businesses, or one business at several locations | "Do you run more than one business, or one business at more than one location? Would you want them under one login?" | Every discovery call | F-086 |

**Coverage.** All 26 FLAG-M features are covered:
- F-003 (H5), F-016 (H14), F-018 (H6), F-028 (H7), F-034 (H22 and decision 20), F-043 (H7);
- F-051 (H4), F-059 (H3), F-060 (H3), F-061 (H1), F-062 (decision 25), F-070 (H7 and decision 23);
- F-089 (decision 35), F-109 (H12), F-125 (H16), F-137 (H15), F-142 (H11 and study decision 14);
- F-147 (H21 and decision 31), F-155 (H6), F-156 (H13), F-160 (H19), F-161 (H20 and decision 32);
- F-183 (H1 to H4), F-184 (H1), F-185 (H9);
- F-032, which is dropped.

**The order to ask them in.**
- The Expo starts H1 to H4, the first half of H7, and H21 with the vendors met there.
- The October and November calls cover H6, H7, H17, H19 and H23 on every call; H5 with the two insurance agencies and an HVAC prospect's office; H8 with the live client and receptionist-first prospects; H9 with the centres; H18 with the centres, the two insurance agencies and the trades; H10 with the restaurants; H11 with tax preparers, HVAC shops and event vendors; H12 and H14 with HVAC prospects and other trades.
- H15 and H16 run as named pilots: two chambers, UTRGV and two bookkeepers for H15, the live client and two prospects for H16.
- H13 and H20 are measurements that can start now. H22 starts when decision 20 allows the trial.
- Record each answer against its hypothesis. A feature whose hypothesis comes back "no" moves to dropped at the next planning pass.

---

## Appendix A. The full feature catalogue

One row per feature, in ID order: the 192 canonical features (F-001 to F-192) and the seven additions (F-193 to F-199).
- **V, F and D** (value, feasibility, differentiation, 1–5, with each judge's flag) and **Skeptic** are copied exactly from the judges' merged scores. The additions have no judged scores; theirs are provisional, marked "prov.".
- **Effort** is the canonical band and figure, or this plan's revision marked with an asterisk (*). "Beyond S-NN" means an increment on the study's own line, and the band describes the increment.
- **Final horizon** lists every horizon the feature touches, first to last. **Disposition** says where its first part lands and how it splits. "—" means folded or dropped.
- The reasons, the effort sums and the dependencies are in section 4.

**Dispositions:** before the first release 16; first release 16; the study's parallel work 7; riders 6; next 13; later 68; future 42; folded 13; dropped 18. That is **199** features, each placed exactly once.

| ID | Feature | Area | Effort | Final horizon | V | F | D | Skeptic | Disposition |
|---|---|---|---|---|---|---|---|---|---|
| F-001 | The record page: one kit, a card registry, and moving between records | Record | L (6.5–8.5 beyond S-03)* | now → later | 5 | 3 · HIGH | 2 | minor | First release (S-03); split: timeline fixes in the defects list, peeks per record type Later |
| F-002 | Clientes: people, families, businesses and places in one list | Record | S–M (2–3)* | later | 4 | 3 · med | 3 | minor | Later |
| F-003 | Family roles and delegates: padrinos, compadres, "habla por" and "paga por" | Record | M (4–6)* | now → later → future | 3 · FLAG-M | 3 · med | 5 · FLAG-M |  | First release (S-02); split: "habla por" Later, customer-invited delegates Future |
| F-004 | See who can see it: visibility marks, masked values, "View as customer" | Record | M (4–6)* | later | 3 · FLAG-L | 2 · HIGH | 3 · FLAG-L | minor | Later |
| F-005 | The document vault, designed | Record | M (2–3 beyond the revised S-07)* | now | 5 | 3 · HIGH | 2 | minor | First release (S-07) |
| F-006 | Duplicates found the Valley way, and a merge that keeps everything | Record | S–M (2–3) | next | 3 | 4 · low | 3 |  | Next |
| F-007 | Terms: one fixed record for anything that renews | Record | M (3–4) | later | 4 · FLAG-L | 3 · med | 2 · FLAG-L |  | Later |
| F-008 | Language on every contact, as observed | Bilingual | S (1–1.5 beyond S-09)* | now | 5 | 4 · low | 4 | minor | First release (S-09) |
| F-009 | Mexican numbers, stored right | Bilingual | S (1.5–2)* | now | 4 | 5 | 4 | minor | Before release (legal-date chain) |
| F-010 | Every edge of the call in the caller's language, and Spanish robocalls caught | Bilingual | S–M (1.5–2 after the greeting defect)* | now | 5 | 4 | 4 · FLAG-M |  | Rider |
| F-011 | The Valley-Spanish kit: twin drafting, a glossary, texts without the double bill | Bilingual | M (3.5–4.5)* | now → later | 4 | 3 · med | 4 |  | First release (S-09); split: twin drafting and glossary Later |
| F-012 | Bilingual parity by construction: a gate, a style sheet, reasons as codes | Bilingual | S (1.5–2) | — | 3 | 5 · low | 2 | minor | Folded into F-013 (the ratchet gate ships with the runtime) |
| F-013 | The Spanish dashboard, in order of daily use | Bilingual | M–L (4.5–7.5)* | now → next | 4 · FLAG-L | 3 · HIGH | 3 | minor | First release (S-01); split: the remaining screens Next with S-10 |
| F-014 | Spanish-ready components | Bilingual | S (1–2)* | now | 3 | 4 | 2 |  | First release (S-01) |
| F-015 | Addresses from both sides of the river | Bilingual | S–M (2–3) | later | 3 | 3 · med | 4 | minor | Later |
| F-016 | Winter Texans: a seasonal-resident profile | Bilingual | S–M (2–3) | — | 2 · FLAG-M | 3 | 3 · FLAG-M |  | Dropped (unvalidated; a "Temporada" tag and two F-071 recipes if a trade client asks) |
| F-017 | The Valley's year: seasons, two-country holidays, "same week last year" | Bilingual | S–M (2–2.5)* | later | 3 | 3 · low | 3 | minor | Later (holiday closures themselves ship now inside F-084) |
| F-018 | "¿Quién le recomendó?": word of mouth, measured | Bilingual | S–M (2–3) | — | 3 · FLAG-M | 3 | 3 · FLAG-M |  | Folded into F-157 (the source question; the report line waits for F-100 and decision 24; the referral link waits on H6) |
| F-019 | One review tray for every AI suggestion | AI | M (4–5 beyond S-14)* | now | 5 | 4 · med | 4 · FLAG-M |  | First release (S-14) |
| F-020 | One door for every model call: gateway, budgets, registry | AI | M (2–3)* | now → next | 3 | 4 · low | 2 | minor | First release (S-15); split: per-plan budgets Next with S-13 |
| F-021 | The report card: a bilingual evaluation harness | AI | M–L (5–7)* | later | 4 | 3 · med | 3 |  | Later |
| F-022 | Provenance: every write says who made it; Sofía's acts visible and reversible | AI | M (2.5–3)* | now | 4 · FLAG-H | 4 | 4 · FLAG-H | **blocker** (item 1 only) | First release (S-14); item 1 waits on decision 19 |
| F-023 | One tool belt for every assistant | AI | M (4–5)* | later | 3 | 4 · low | 1 | minor | Later (the chat's false 'passed on' claim is fixed now in the defects list) |
| F-024 | Customer memory: "What we know", used on the next call | AI | M (3–4) | future | 3 | 3 · med | 4 · FLAG-M |  | Future |
| F-025 | The composer that writes and translates | AI | M (4–5 beyond S-16)* | later | 4 | 3 · med | 3 |  | Later |
| F-026 | Job debrief by voice | AI | M (2–3)* | future | 3 | 3 | 2 |  | Future |
| F-027 | Snap it: data plates and paper read into the record | AI | M (2–3) | future | 3 · FLAG-L | 3 · med | 3 |  | Future |
| F-028 | Photos and voice notes, understood | AI | M (2–3)* | future | 3 · FLAG-M | 3 | 4 · FLAG-M |  | Future (the attachment half folded into F-069) |
| F-029 | A weekly report that reads the week | AI | S (1–2) | — | 3 | 5 | 3 | minor | Folded into F-100 (one report engine) |
| F-030 | Opportunity finder: revenue BIS spots and drafts for approval | AI | M (2–3) | future | 3 · FLAG-L | 2 · med | 2 |  | Future |
| F-031 | Ask BIS off the screen: by text and by WhatsApp voice note | AI | M (3–4) | — | 2 | 2 | 3 · FLAG-M |  | Folded into F-095 (the SMS channel of Ask, with S-18; the WhatsApp leg waits on H7) |
| F-032 | The owner line: call your own number to hear the day and file work | AI | M–L (4–7) | — | 2 · FLAG-M | 2 · HIGH | 3 · FLAG-M | minor | Dropped (voice-clone risk; nobody asked; F-116's rule stands) |
| F-033 | Every call leaves a card: reason, callback number, the caller's words | Sofía | S–M (2–3)* | now | 5 | 5 | 3 |  | Rider |
| F-034 | Honest by design: disclosure, a way to a person, the transcription notice | Sofía | S (1.5–2) | now | 4 · FLAG-M | 5 | 3 · FLAG-M |  | Parallel work (S-47); waits on decision 20 |
| F-035 | Warm handoff: transfers that never fail silently | Sofía | M (3–5)* | later | 4 | 3 · med | 3 |  | Later |
| F-036 | A web chat that closes the loop | Sofía | M (3.5–6)* | now → later → future | 4 · FLAG-L | 3 · HIGH | 2 |  | First release (S-06); split: "Book this time" Later, staff takeover Future |
| F-037 | One source of truth for what the business says | Sofía | L (7–8.5)* | now → later | 5 | 3 · HIGH | 4 |  | Parallel work (S-47); split: owner-edited, versioned facts Later |
| F-038 | Questions Sofía couldn't answer: a weekly list and a bilingual FAQ | Sofía | M (3–4)* | later | 4 | 3 | 3 |  | Later |
| F-039 | Sofía sets herself up from the business's own website | Sofía | S (2) | later | 3 | 4 · low | 2 |  | Later |
| F-040 | Rehearsal: test Sofía before her words go live | Sofía | M (2–3) | future | 3 | 3 · med | 3 |  | Future |
| F-041 | Sofía's one home: calls, website chats, what she knows, how she answers | Sofía | M (2–3)* | future | 3 | 3 | 2 |  | Future |
| F-042 | Shared robocall shield across every BIS line | Sofía | S–M (2–3) | future | 3 | 4 · low | 3 |  | Future |
| F-043 | Sofía answers WhatsApp calls | Sofía | S (1, spike only)* | later | 2 · FLAG-M | 2 · HIGH | 4 · FLAG-M |  | Later (a one-week spike, only if F-070's phase 0 shows demand) |
| F-044 | Sofía interprets: on transfers and at the door | Sofía | L–XL | — | 1 | 1 | 2 · FLAG-M | minor | Dropped (phones will ship live call translation) |
| F-045 | Callbacks the customer asked for, placed by Sofía | Sofía | M (4–5) | — | 2 · FLAG-H | 2 · HIGH | 2 · FLAG-M | minor | Dropped (study §5.3 stands: no outbound AI calls; F-033's callback rows go to people) |
| F-046 | Run the day from the calendar: agenda, staff bookings, a job card | Calendar | M–L (5–7)* | next → later | 5 | 4 · low | 2 | minor | Next; split: the job card Later |
| F-047 | Book the right thing: services, job address, questions, nobody turned away | Calendar | M (3.5–4.5)* | now → later | 5 | 4 | 2 | minor | Before release (phase 1 defects); split: services and durations Later |
| F-048 | Manage my appointment: move in place, cancel with a way back, add to calendar | Calendar | M (3–3.5)* | now → next | 4 | 5 | 2 |  | Rider; split: the owner's calendar feed Next (a proposal of this plan) |
| F-049 | Reminders that reach people: their language, their channel, however late they booked | Calendar | S (1.5)* | now → next | 5 | 4 · low | 3 |  | First release (S-09); split: text legs Next, once A2P clears |
| F-050 | Waitlists that call you back | Calendar | M (3) | future | 3 | 3 | 2 |  | Future |
| F-051 | Holds: a first-class booking state that a person confirms | Calendar | M (3–4)* | later | 4 · FLAG-M | 3 · HIGH | 3 · FLAG-M | minor | Later (rooms wait on decision 22) |
| F-052 | "Va en camino": a live visit page driven by staff taps, not GPS | Calendar | M (3–4) | later | 4 · FLAG-L | 4 · med | 3 |  | Later |
| F-053 | The job-done report the customer keeps | Calendar | M (3–4) | future | 3 | 3 | 3 |  | Future |
| F-054 | One record card in Gmail, Outlook, AI chats and on the lock screen | Calendar | L (6–8) | — | 1 | 2 | 1 · FLAG-M |  | Dropped (no inbox-sync demand; revisit if customers ask) |
| F-055 | The money kit: amounts that cannot be misread | Money | S now (1), M later (3–4) | now → later | 3 | 4 | 2 |  | Before release (the now half, in the defects list); split: money components Later |
| F-056 | A quote you can say yes to | Money | M (4–5) | later | 5 | 2 · med | 2 | minor | Later |
| F-057 | Sign on your phone, and understand it first | Money | M (4–6) | later | 4 | 2 · HIGH | 4 · FLAG-L | minor | Later |
| F-058 | Pay the way the Valley pays | Money | M (3–4) | later | 5 | 2 · med | 2 | minor | Later |
| F-059 | Cash that leaves a trail: receipts, the day's cash, apartado, an 8300 heads-up | Money | S–M (2–3) | later | 3 · FLAG-M | 3 · low | 4 · FLAG-M |  | Later |
| F-060 | Pesos without pretending | Money | M (3) | — | 2 · FLAG-M | 2 | 3 · FLAG-M |  | Folded into F-055 (the US$/MX$ labelling rule; peso presentment dropped) |
| F-061 | Everyone chips in: padrinos and family payers | Money | M (3–4) | later | 3 · FLAG-M | 2 · med | 5 · FLAG-M |  | Later |
| F-062 | Mi Cuenta: one link for everything, with a light version on every plan | Money | M (5–6 beyond S-31)* | later | 4 · FLAG-M | 3 · med | 2 · FLAG-M | minor | Later |
| F-063 | Mi casa: a service record the homeowner keeps and can pass on | Money | L (6–8) | — | 2 | 2 | 3 · FLAG-L |  | Folded into F-062 (a property and equipment view; the transfer flow dropped) |
| F-064 | In your phone's wallet: appointments, events and insurance cards | Money | M (3–4) | — | 1 | 3 · med | 2 |  | Dropped (nobody asked; F-048's calendar file covers appointments) |
| F-065 | The consent ledger: one send gate, evidence for a lawyer, preferences in the customer's hands | Messaging | M (3–4 beyond S-05; 5–7 with it)* | now → later | 5 | 4 · med | 4 | minor | Before release (legal-date chain); split: preference page and certificate Later |
| F-066 | A marketing licence per business: message classes, SB 140, Texas calling hours | Messaging | S–M (2–2.5)* | now → later | 4 | 4 | 3 | **major** | Before release (legal-date chain); split: the SB 140 registration card Later |
| F-067 | Your number and your texting registration, done inside BIS | Messaging | L (8–10)* | later | 5 | 3 · med | 2 | minor | Later (registration is done by hand for the live accounts now) |
| F-068 | An inbox that works like the phone's messages app | Messaging | M (3–4)* | now → later | 4 · FLAG-L | 4 · low | 2 |  | First release (S-06); split: saved replies and thread states Later |
| F-069 | Customers text the way they text family: photos, upload links, click-to-text | Messaging | M (3–4) | later | 4 · FLAG-L | 3 | 2 | minor | Later |
| F-070 | WhatsApp through Telnyx, inbound first | Messaging | M–L (5.5–8)* | next → later | 4 · FLAG-M | 3 · med | 3 · FLAG-M | minor | Next (phase 0); split: inbound WhatsApp Later, if the data and decision 23 say so |
| F-071 | Date and stage clocks: four trigger primitives for messages and team tasks | Messaging | M–L (5–7 beyond S-21; 6–9 with it)* | later | 5 | 3 · HIGH | 3 · FLAG-M | minor | Later |
| F-072 | After the job: a two-question check-in, reviews without gating, replies in their language | Messaging | S–M (2–3) | later | 4 | 4 · low | 2 | minor | Later |
| F-073 | Call customers from the business number on your own phone | Messaging | M (3–4) | future | 3 · FLAG-L | 4 · med | 2 | minor | Future |
| F-074 | RCS: verified, tappable messages | Messaging | M (3–4) | future | 2 | 2 · med | 2 |  | Future (research Telnyx's RCS cost first) |
| F-075 | Branded caller ID for calls out | Messaging | M (2–3) | — | 2 | 2 | 1 |  | Dropped (serves outbound calling, which BIS limits) |
| F-076 | Hoy: one home screen that starts the day | Owner's day | M (3.5–4.5)* | now → later | 4 | 4 | 2 |  | Before release (the hero by plan, in the defects list); split: Hoy Later |
| F-077 | The work queue finishes what it shows: one-tap actions and every loose end | Owner's day | M–L (5–7)* | next → later | 5 | 4 · low | 3 |  | Next; split: the remaining sources Later |
| F-078 | Speed-to-lead clock | Owner's day | S (1.5–2) | future | 3 | 4 | 2 |  | Future |
| F-079 | Follow-ups that never leak | Owner's day | M (4–6) | later | 4 | 3 · HIGH | 3 | minor | Later |
| F-080 | Priority: the queue ranks by what is worth most, and says why | Owner's day | M (2–3) | — | 2 | 4 | 2 |  | Dropped (small owners have few rows to rank) |
| F-081 | One notification router | Owner's day | M (5–6)* | later | 4 | 4 · low | 1 | minor | Later |
| F-082 | The morning brief | Owner's day | S–M (2) | — | 3 | 4 · low | 3 | minor | Folded into F-100 (a daily edition of the one digest, opt-in) |
| F-083 | Quick capture: one "+" for walk-ins, calls, notes, bookings | Owner's day | M (3) | later | 4 | 4 | 2 |  | Later |
| F-084 | One switch: open, closed today, running late, storm | Owner's day | S–M (2)* | now | 4 | 4 · med | 3 | minor | Parallel work (S-47); owns the special-hours record |
| F-085 | Mine, team and unassigned: role-tuned homes and hand-offs | Owner's day | M (2–3)* | now → future | 3 · FLAG-L | 2 · HIGH | 2 | minor | First release (S-01); split: role homes Future |
| F-086 | One login and one Hoy across several businesses | Owner's day | S (1–2)* | future | 2 | 3 · med | 2 · FLAG-M | minor | Future (the company switcher only; a combined Hoy is dropped unless a client asks) |
| F-087 | One map of the product: a surface manifest every menu reads | Navigation | M (2.5–3.5)* | next | 2 | 5 | 1 |  | Next |
| F-088 | Show what the business uses: five surface states and one upgrade page | Navigation | S–M (2–3) | next | 3 | 4 · med | 2 |  | Next |
| F-089 | The 2027 sidebar: a fixed spine, four module slots, a budget of nine | Navigation | S (1.5–2) | next | 3 · FLAG-M | 4 | 2 | **major** | Next (waits on the sidebar amendment, decision 35) |
| F-090 | The module contract | Navigation | S (1) | — | 2 | 5 | 1 |  | Folded into F-101 (a key pattern in DESIGN.md v2) |
| F-091 | Links that land | Navigation | S (1–2) | later | 3 | 5 | 1 |  | Later |
| F-092 | One search that finds García, across every record type | Navigation | M–L (5.5–7)* | next → later | 4 | 4 · med | 3 |  | Next; split: the index across record types Later |
| F-093 | Saved views as navigation | Navigation | M (3–4)* | later | 3 | 4 · low | 1 |  | Later |
| F-094 | Lenses: list, board, calendar and map | Navigation | L (6–8) | — | 2 | 3 | 1 · FLAG-M | minor | Dropped (the events month grid lives in F-183; a map link when a client asks) |
| F-095 | One box: find, go, or ask, in either language | Navigation | M (5–5.5)* | next → later | 3 | 3 · med | 2 · FLAG-M |  | Next; split: Ask Later; voice dropped |
| F-096 | Ajustes for owners: me, the business, what BIS manages | Navigation | M (3.5–5)* | now → later | 3 | 4 · low | 2 |  | First release (S-01); split: Negocio and Equipo Later |
| F-097 | "Pídele a BIS": a request button on everything the owner cannot change | Navigation | S (1.5–2) | later | 3 | 5 | 3 |  | Later |
| F-098 | View as, and marks for BIS-only surfaces | Navigation | S (2) | — | 2 | 4 | 1 |  | Folded into F-087 (audiences in the manifest) |
| F-099 | One launch plan, two views | Navigation | M (3–4) | now → later | 3 | 4 · med | 2 | minor | Before release (CRM-plan steps, in the defects list); split: one launch plan Later |
| F-100 | Números: one catalogue of metrics | Navigation | L (8–11 with F-029, F-082, F-178)* | later | 3 | 4 | 2 | minor | Later (the one report engine; owns the Monday line budget) |
| F-101 | DESIGN.md v2: extend the contract and settle its contradictions | Design | S (1–2)* | now | 1 | 5 | 1 |  | First release (S-03) |
| F-102 | The public pages, one kit: a front door that is accessible, fast and operable by agents | Design | M–L (4.5–6.5)* | now → later | 4 | 3 · med | 2 | minor | Before release (front-door defects); split: the public-page kit Later; agent slice dropped |
| F-103 | WCAG 2.2 AA in the workspace | Design | M (3–4) | later | 3 | 4 · low | 2 | minor | Later |
| F-104 | One token source, many outputs | Design | M (2–3) | future | 1 | 4 | 1 |  | Future |
| F-105 | The contract enforced: design lint, route-state tests, a styleguide with screenshots | Design | S (2)* | later | 1 | 4 · low | 1 |  | Later (the lint rule and route-state tests; nightly screenshots dropped) |
| F-106 | The state grammar: twelve designed states and honest pending actions | Design | M (3–4)* | later | 2 | 4 | 1 |  | Later |
| F-107 | Phone first: a bottom-tab shell and content that fits its container | Design | L (6.5–8)* | now → next | 5 | 4 · med | 2 | minor | Rider; split: the bottom-tab shell Next |
| F-108 | BIS on the home screen, with push alerts that work before A2P | Design | M (3–4) | later | 4 | 4 | 2 |  | Later |
| F-109 | Works without signal: connection states, cached reads and a field outbox | Design | S (1–2 planned; the outbox not costed)* | later → future | 3 · FLAG-M | 2 · HIGH | 2 · FLAG-M |  | Later; split: the field outbox Future |
| F-110 | A performance budget for Valley phones | Design | M (2–3)* | future | 3 | 4 | 1 | minor | Future |
| F-111 | Display settings that follow the person | Design | S (2) | — | 2 | 4 | 1 | minor | Folded into F-096 (display settings in Mis preferencias's one store) |
| F-112 | Brand studio: one logo to every customer surface, previewed | Design | S (1.5–2)* | future | 2 | 4 | 2 |  | Future |
| F-113 | Paper that looks like the business: print and tagged PDF | Design | M (4–5) | later | 3 · FLAG-L | 3 · med | 2 |  | Later |
| F-114 | A 30-day hardening sprint | Trust | M–L (5–6.5)* | now | 5 | 4 · med | 2 |  | Before release (the hardening sprint) |
| F-115 | Evidence-grade records | Trust | M (2–3.5)* | now → next | 3 | 3 · med | 3 |  | Before release; split: history Next with S-04; hash chain dropped |
| F-116 | Caller identity checks scaled to each pack's risk | Trust | M (2.5–3)* | now → later | 5 | 4 | 3 |  | Parallel work (S-47: the verification ladder); split: codes Later |
| F-117 | Sign-in security the owner controls | Trust | M (3.5–4.5)* | now → later | 4 | 3 · med | 2 | minor | Before release; split: owner controls Later |
| F-118 | See when BIS looked: access transparency and an access log | Trust | M (2.5–3.5)* | now → later | 2 · FLAG-L | 3 · med | 4 |  | Before release; split: client panel Later |
| F-119 | Know first, tell fast: monitoring, incidents, bilingual notices | Trust | M (3–3.5)* | now → later | 4 | 4 · low | 2 |  | Before release (the operational floor); split: notices and status page Later |
| F-120 | Backups actually restored, and a phone line that survives an outage | Trust | M (3.5–4)* | now → later | 4 | 4 · low | 3 |  | Before release (the operational floor); split: fallback host Later |
| F-121 | "Descargar todo": the whole business in one file, and a clean exit | Trust | M (5–6) | later → future | 3 | 3 · med | 3 |  | Later; split: the exit wizard and certificate Future |
| F-122 | Honour "delete me" and "what do you have on me" | Trust | M (3–4) | future | 2 · FLAG-L | 3 | 2 |  | Future |
| F-123 | One retention engine | Trust | M (3) | later | 3 · FLAG-L | 4 · low | 2 |  | Later |
| F-124 | The due-diligence pack and a public Trust Center | Trust | M (2–3) | now → later | 4 · FLAG-L | 4 | 4 |  | Parallel work (before law sales); split: Trust Center Later |
| F-125 | A safe-harbour kit for the client's own business (SB 2610) | Trust | S (1–2)* | later | 3 · FLAG-M | 4 · low | 4 · FLAG-M |  | Later (a content pilot with three clients before any kit) |
| F-126 | Children and minors: sensitive by default | Trust | M (2–3) | later | 3 · FLAG-L | 3 | 3 · FLAG-L |  | Later |
| F-127 | Call recording done right | Trust | M (2–3) | future | 3 | 3 · med | 2 | minor | Future |
| F-128 | SOC 2: aligned now, attested when customers pay for it | Trust | M (3–4) | future | 1 | 3 | 2 · FLAG-L |  | Future (only on two written requests) |
| F-129 | Field-level encryption and crypto-shredding | Trust | L (6–8) | future | 2 · FLAG-L | 2 · med | 3 · FLAG-L |  | Future (unless a paying law tenant requires it earlier) |
| F-130 | A TRAIGA-ready AI record and a language-parity report | Trust | S–M (1.5–2) | later | 2 | 4 | **5** | minor | Later |
| F-131 | Verified licence badge | Trust | M (2–3) | future | 3 | 3 | 3 · FLAG-M |  | Future |
| F-132 | A monthly trust note | Trust | S (1–1.5) | — | 1 | 4 | 3 |  | Dropped (a security line in the report only when there is news, under F-100's budget) |
| F-133 | Sentinel: one watcher for stop, fraud, health data and emergencies | Trust | M (2.5–3)* | now → later | 4 | 4 · med | 4 | **major** | Before release (legal-date chain); split: fraud and emergency flags Later |
| F-134 | Privacy tiers for AI | Trust | M (3–4)* | later | 3 · FLAG-L | 2 · med | 3 · FLAG-M | minor | Later (the Protected tier only; the Local tier dropped) |
| F-135 | Messages customers can trust: brand first, official channels, the business's own links | Trust | S–M (2–3)* | future | 3 | 3 | 3 |  | Future |
| F-136 | Agency cockpit and map | Growth | M–L (5–7)* | later | 3 | 4 · low | 2 |  | Later |
| F-137 | Setup partners: scoped seats for certified local helpers | Growth | L (6–8) | future | 2 · FLAG-M | 2 · HIGH | 4 · FLAG-M | minor | Future (a hand-run pilot needs no code) |
| F-138 | Multi-agency white-label, with a three-level brand stack | Growth | XL (14–20) | later → future | 1 · FLAG-H | 1 · HIGH (slice 5) | 2 · FLAG-H |  | Later (the lint slice); split: multi-agency Future |
| F-139 | Sign up in Spanish or English in ten minutes, with vetting at the door | Growth | L (8–10)* | future | 3 | 3 · med | 3 | minor | Future |
| F-140 | Hear your receptionist before you buy | Growth | M (3–4)* | later | 4 | 3 · med | 3 · FLAG-M | minor | Later |
| F-141 | A CRM plan that texts without Sofía and sells its own upgrade | Growth | M (3–4) | now → later | 5 | 4 · med | 3 |  | Rider; split: the missed-call meter and card Later |
| F-142 | Pricing levers inside two or three plans | Growth | M (4–6) | later | 4 · FLAG-M | 3 | 3 · FLAG-M | minor | Later |
| F-143 | Every customer surface recruits | Growth | S (1)* | future | 2 | 4 | 2 | minor | Future (the attributed footer only) |
| F-144 | Scan, text, book: QR codes for the truck door, the flyer and the expo | Growth | S (1)* | later | 4 | 4 | 3 | minor | Later |
| F-145 | A partner programme for chambers, UTRGV and local associations | Growth | S (1)* | later | 2 | 3 | 4 · FLAG-M | minor | Later (a co-branded page once one chamber signs) |
| F-146 | The accountant's desk | Growth | M (4–5) | future | 2 · FLAG-L | 2 | 2 · FLAG-L |  | Future |
| F-147 | Consented test calls to your own line: an audit for prospects, a monthly check for clients | Growth | L (7–9)* | future | 3 · FLAG-M | 2 · HIGH | 4 · FLAG-M | minor | Future (hand-run prospect audits by a person meanwhile) |
| F-148 | Connections: one page to find, connect, see and revoke every integration | Growth | M (2)* | next | 2 | 4 | 1 |  | Next |
| F-149 | Open platform: API keys, signed webhooks, Zapier, Make and n8n | Growth | M (3–4)* | future | 2 | 3 · med | 1 · FLAG-M |  | Future (API keys and signed webhooks for outside tools; the full API dropped) |
| F-150 | Switch kit: move in from GoHighLevel, Jobber or HoneyBook in a day | Growth | M (4.5–6)* | next → future | 3 | 3 · med | 3 |  | Next (a phone-contacts vCard import, a proposal of this plan); split: the switch kit Future |
| F-151 | MCP as a channel | Growth | M (3–4) | — | 2 | 3 | 2 · FLAG-M |  | Dropped (the study's MCP server, S-33, stays; directory listings dropped) |
| F-152 | Reach the systems a business already runs | Growth | L (9–12, = S-46, S-57, S-58)* | later → future | 3 · FLAG-L | 2 | 4 · FLAG-M |  | Later (as S-46); split: law and insurance adapters Future (S-57, S-58) |
| F-153 | Sofía as a partner app inside vertical software | Growth | L–XL (8–14) | — | 1 | 1 | 3 · FLAG-M |  | Dropped (distribution outside the Valley; Jobber and Clio sell their own receptionists) |
| F-154 | Valley benchmarks and the public Pulso del Valle | Growth | M (4–5) | future | 2 | 2 · med | **5** · FLAG-M |  | Future (the industry field and the contract clause ship now with F-173 and the contracts) |
| F-155 | Recomendados: a referral network between Valley businesses | Growth | S (0.5–1 planned; the network not costed)* | future | 2 · FLAG-M | 3 | 4 · FLAG-M | minor | Future (a list Sofía offers first; the cross-account network after density) |
| F-156 | Assistant callers get their own lane | Agentic | S–M (2–3) | future | 3 · FLAG-M | 4 · low | 4 · FLAG-M |  | Future (unless call logs show assistant callers) |
| F-157 | "Found you through ChatGPT": attribution shown, AI assistants as a source | Agentic | S (1.5–2)* | now | 4 | 5 | 2 |  | Rider (F-018's source question folded in) |
| F-158 | "Machines and assistants": one settings section | Agentic | S (1–2) | — | 1 | 4 | 2 |  | Dropped (settings cards arrive with their features) |
| F-159 | Public write paths that tell people, agents and bots apart, and hold likely spam | Agentic | M (2–3)* | later | 3 | 3 · med | 2 |  | Later (spam holds; the agent lanes dropped) |
| F-160 | The business page assistants read | Agentic | M (3–4) | future | 3 · FLAG-M | 3 | 3 · FLAG-M |  | Future |
| F-161 | Keep Google, Apple and Bing telling the truth | Agentic | M (3–4) | later | 3 · FLAG-M | 2 · med | 3 · FLAG-M | minor | Later |
| F-162 | What AI says about you: a monthly bilingual check | Agentic | M (2–3) | future | 2 | 3 | 3 · FLAG-M | minor | Future (an OpenAI-only pilot if clients ask) |
| F-163 | Findable, bookable, payable: the readiness meter | Agentic | S (1–2) | — | 1 | 4 | 2 |  | Folded into F-099 (the launch plan) |
| F-164 | A storefront for consumer agents | Agentic | M–L (5–7) | future | 1 | 2 · med | 2 · FLAG-M | minor | Future (only once F-156 shows real agent traffic) |
| F-165 | "Book online" inside Google | Agentic | L (6–10) | — | 2 | 1 | 1 · FLAG-M |  | Dropped (a Book button on the Google profile that opens BIS's booking page, through Place Action Links in F-161's scope, covers it) |
| F-166 | Menus, packages and price sheets machines can read | Agentic | M (2–3) | — | 2 | 3 | 2 · FLAG-L |  | Folded into F-037 (packages and menus as sections, with the allergen rule) |
| F-167 | Payable by agents: deposits against signed mandates | Agentic | L (6–8) | — | 1 | 1 | 1 · FLAG-M |  | Dropped (agent payment rails belong to Stripe and the card networks, and BIS money is not built) |
| F-168 | "Connect your assistant": customer-delegated agents | Agentic | L (6–8) | — | 1 | 1 | 2 · FLAG-M |  | Dropped (no demand; needs the portal's Stage 2, payments and delegated sign-in) |
| F-169 | Business-to-business agents: work orders from managers' systems | Agentic | L (6–8) | — | 1 | 2 | 2 · FLAG-M |  | Dropped (no demand from Valley property managers; a bet on other companies' systems) |
| F-170 | Is this reviewer a customer? Review authenticity | Agentic | S–M (1.5–2) | future | 2 | 3 | 3 |  | Future |
| F-171 | Pack manifest: the blueprint grows into a bilingual industry pack | Packs | M (4–5 beyond S-38)* | later | 4 | 3 · med | 4 |  | Later |
| F-172 | Starter packs first, plus the five blueprint fixes | Packs | M (2–3)* | later | 4 | 5 | 3 | **major** | Later (home services, insurance and events starters first; no restricted fields; the archived-form fix ships now in §2.3) |
| F-173 | Onboarding picks the pack and vets the tenant | Packs | M (4–5, with S-53) | now → later | 4 | 4 | 3 | minor | Parallel work (S-53); split: pack picking Later |
| F-174 | Sofía industry modules | Packs | M (5–6)* | now → next | 5 | 4 · med | **5** |  | Parallel work (S-47); split: law and home-services modules Next; the child-care module inside F-185 and the catering lines inside F-199, both Later |
| F-175 | Intake schemas: a pack-shaped intake that opens a deal through one proposal | Packs | M (3–4) | next → later | 4 | 4 · low | 3 | **major** | Next; split: law and child-care schemas Later |
| F-176 | Packs with versions and approved updates | Packs | L (8–10) | future | 2 | 3 | 3 |  | Future |
| F-177 | The business's own words: a bilingual pack lexicon | Packs | M (2–3) | later | 3 | 3 · med | 3 |  | Later |
| F-178 | Pack reports: four numbers per industry and a pack-aware hero | Packs | M (2–3) | — | 3 | 4 · low | 3 | **major** | Folded into F-100 (pack numbers from the one catalogue) |
| F-179 | Home services pack | Packs | M (3–4 beyond S-40; 5–6 with it)* | later | 4 | 3 | 3 · FLAG-M |  | Later |
| F-180 | Route services module | Packs | S (0.5–1 beyond S-59)* | later | 3 | 3 | 2 · FLAG-L |  | Later |
| F-181 | Law pack | Packs | L (6–8) | later | 4 | 2 · med | 4 · FLAG-L | minor | Later (the receptionist slice sells from next through F-174's law module) |
| F-182 | Insurance pack (personal property and casualty) | Packs | L (6–8) | later | 4 | 2 · med | 3 · FLAG-M |  | Later (the receptionist slice sells from now through F-174) |
| F-183 | Events pack | Packs | L (7–9) | later | 4 · FLAG-M | 2 · HIGH | **5** · FLAG-M | **major** | Later (the receptionist slice sells from now; rooms wait on decision 22) |
| F-184 | La fiesta: the family's event page | Packs | M (3–4) | future | 3 · FLAG-M | 2 | 4 · FLAG-M |  | Future |
| F-185 | Child-care front office pack | Packs | L (6–8) | later | 3 · FLAG-M | 2 · med | 2 · FLAG-M |  | Later (2028, after 3–5 centres confirm the front-office position) |
| F-186 | Catering module | Packs | S (0.5–1 beyond S-45)* | future | 2 | 2 | 2 · FLAG-L |  | Future (after POS research, and only if a restaurant pays) |
| F-187 | A living Texas rule library | Packs | M (2–3) | later | 4 | 3 | **5** |  | Later |
| F-188 | Regulator-ready packets for every pack | Packs | M (2–3) | later | 3 · FLAG-L | 2 | 3 · FLAG-L |  | Later |
| F-189 | Self-service for policyholders and legal clients, behind an identity check | Packs | M–L (4–6) | future | 3 · FLAG-L | 2 | 3 · FLAG-L | minor | Future |
| F-190 | Immigration and court status lookups, answered only after identity checks | Packs | M (3–5) | future | 2 · FLAG-L | 1 | 3 · FLAG-M |  | Future (research only) |
| F-191 | The next packs from the same parts: studios, freight, grooming, homebuilders | Packs | M per pack (3–4 planned)* | future | 3 · FLAG-L | 3 | 2 · FLAG-L |  | Future (freight is S-60, Later; the studios pilot, then grooming and homebuilders) |
| F-192 | Seat, date and season forecasting per pack | Packs | L (6–8) | — | 1 | 2 | 2 · FLAG-M |  | Dropped (needs a season of data nobody asked for) |
| F-193 | Facebook and Instagram: ad leads and direct messages in the one inbox | Messaging | M (4–6) | later → future | 4 · prov. | 3 · prov. | 3 · prov. |  | Later (lead ads, if the Expo confirms H2); split: direct messages Future |
| F-194 | La prueba en español: a published comparison of receptionists in Spanish | Growth | S (1) | now | 3 · prov. | 5 · prov. | 4 · prov. |  | Before release (the first published run) |
| F-195 | Una persona de BIS: a published local service promise | Growth | S–M (2–3) | later | 4 · prov. | 4 · prov. | 4 · prov. |  | Later (build and measure; publish after 60 days) |
| F-196 | Room to run: background work beyond one 15-minute tick | Growth | M (3–4) | next | 2 · prov. | 4 · prov. | 1 · prov. |  | Next |
| F-197 | La caja de zapatos: bring the paper files in | Record | M (3–4) | later | 4 · prov. | 3 · prov. | 3 · prov. |  | Later |
| F-198 | Team papers: staff licences, certificates and training that expire | Record | S–M (2–3) | later | 3 · prov. | 4 · prov. | 2 · prov. |  | Later |
| F-199 | Restaurants start with Sofía at the front desk; the catering pack comes later | Packs | S–M (2–3) | later | 3 · prov. | 4 · prov. | 2 · prov. |  | Later (the head of Later if restaurants confirm H10) |

---

## Appendix B. The study's foundation items

S-01 to S-62 are the rows of the study's §11.1 table, in table order; where the study wrote two items in one phrase, each has its own row. The last column lists the canonical features whose relation line says they detail or extend that item; "related" names features that depend on the item without detailing it. Effort is as the study gives it; section 4 shows where this plan re-costs an item. In this appendix, § references are to the study.

| S-ID | Item | Track | Effort (ew, as the study gives it) | In the study's first release (11.2)? | Canonical features that detail or extend it (F-IDs) |
|---|---|---|---|---|---|
| S-01 | Staff and roles, with field restriction, assignment, notifications and mentions | Foundation | 3–4 | Yes (item 1: users, enforced roles, a language per user) | F-081, F-085, F-096, F-117, F-129 |
| S-02 | Client record model with backfill, relaxed NOT NULLs, suggested groups | Foundation | 5–6 | Yes (item 2: groups, relationships without the restricted flags, properties and equipment, the `company_name` backfill) | F-001, F-002, F-003, F-004, F-006, F-007, F-015, F-018, F-063, F-155 |
| S-03 | Record page, drawer, last-contact and time-in-stage | Foundation | 2–3 | Yes (item 3) | F-001, F-002, F-087, F-092, F-093, F-106, F-178 |
| S-04 | `record_changes` audit log and trash | Foundation | 2–3 | No | F-115 |
| S-05 | Consent ledger synced with Telnyx | Foundation | 2–3 | Yes (item 4) | F-065 |
| S-06 | Inbound email with sender checks, review queue and web-chat threads in the inbox | Foundation | 3–4 | Yes (item 7) | F-025, F-036, F-068 |
| S-07 | Document vault with scanning, versions, retention, checklist, stage rules, share links, Documents view, quotas, teardown | Foundation | 6–8 | Yes (item 6, with one default storage quota) | F-005, F-053, F-069, F-093, F-102, F-118, F-123, F-129 |
| S-08 | In-house e-signature | Foundation | 3–5 | No | F-056, F-057, F-113 |
| S-09 | Bilingual messages including Sofía's emails and form label twins | Foundation | 3–4 | Yes (item 5, with a language on every contact) | F-008, F-010, F-011, F-012, F-049, F-102 |
| S-10 | Spanish dashboard | Foundation | 3–4 | No | F-012, F-013, F-014, F-096, F-111, F-177 |
| S-11 | Forms with uploads, signatures, logic, pre-fill and booking questions | Foundation | 3–4 | No | F-047, F-165 |
| S-12 | Merge with history | Foundation | 2–3 | No | F-006 |
| S-13 | Entitlements on plans | Foundation | 2–3 | No | F-020, F-041, F-087, F-088, F-096, F-099, F-141, F-146 |
| S-14 | Generalised proposals | AI | 2 | Yes (item 8) | F-019, F-026, F-028, F-175 |
| S-15 | Summary with caching and caps | AI | 1–2 | Yes (item 8, the bilingual record summary) | F-020, F-024 |
| S-16 | Drafting and translation | AI | 1–2 | No | F-011, F-025, F-068 |
| S-17 | Gone-quiet nudges | AI | 1 | No | F-077, F-079 |
| S-18 | Ask BIS with read tools and SMS | AI | 2–3 | No | F-023, F-030, F-031, F-032, F-095 |
| S-19 | Document intake | AI | 2–3 | No | F-027, F-028 |
| S-20 | Notetaker | AI | 1–2 | No | F-026, F-028, F-032 |
| S-21 | Date triggers and repeating tasks | AI | 1–2 | No (the vault's expiry-reminder pass is in item 6; generic date triggers are not) | F-071 |
| S-22 | Owner's calendar on both providers with Meet, Teams and attendee matching | Google and Microsoft | 6–8 | No | none; related by dependency: F-046, F-054, F-148, F-165 |
| S-23 | Per-staff calendars with Sofía's four tools and round-robin | Google and Microsoft | 4–5 | No | none; related by dependency: F-046, F-085, F-094, F-165 |
| S-24 | Send-as-me | Google and Microsoft | 1–2 | No | none |
| S-25 | Drive and OneDrive pickers | Google and Microsoft | 2–3 | No | none; related: F-121 (the copy to the owner's own Drive) |
| S-26 | Contacts sync | Google and Microsoft | 1–2 | No | none |
| S-27 | Verification preparation | Google and Microsoft | 1 | Parallel, in part (Google branding verified and published; Microsoft publisher verification; the sensitive-scope review itself comes later) | none; related: F-161 (Business Profile approval) |
| S-28 | Google and Microsoft sign-in | Google and Microsoft | 0.5–1 | Parallel, in part (Google sign-in, with the project kept in Testing mode; Microsoft sign-in is not named) | none |
| S-29 | Price book, quotes with options, invoices, schedules, recurring, ACH, reminders, payment links from Sofía and the concierge, Stripe Connect | Money and portal | 9–12 | No | F-055, F-056, F-058, F-113, F-167 |
| S-30 | Document templates | Money and portal | 2 | No | F-113 |
| S-31 | Portal on scoped tokens | Money and portal | 4–6 | No | F-004, F-062, F-102, F-112, F-168 |
| S-32 | QuickBooks push | Money and portal | 3–4 | No | F-146 |
| S-33 | MCP server with auth spike | Reach | 3–4 | No (the auth spike has no prerequisite, §11.3 step 1) | F-023, F-054, F-151, F-164 |
| S-34 | Business Profile reviews and AI replies | Reach | 2–3 | No (the API application runs in parallel) | F-072, F-161, F-165, F-170 |
| S-35 | Spreadsheet import with header mapping, `.xlsx` export | Reach | 1–2 | No | none; related: F-121 (`.xlsx` export), F-150 (Spanish headers) |
| S-36 | Importers from HubSpot and monday | Reach | 2–3 | No | F-150 |
| S-37 | Installable web app with offline read | Reach | 2–3 | No | F-108, F-109 |
| S-38 | Blueprint extensions with "describe your business" onboarding | Packs | 3–4 | No | F-039, F-099, F-139, F-171, F-173, F-176, F-177 |
| S-39 | Regulated-tenant mode | Packs | 1–2 | No (decision 5 recommends building it now; this plan places it in later, decision 34) | none; related: F-134, F-173 |
| S-40 | Home services part one | Packs | 2 | No | F-027, F-047, F-053, F-063, F-131, F-179 |
| S-41 | Home services part two, with schedule and map views | Packs | 2–3 | No | F-046, F-052, F-094, F-179 |
| S-42 | Child care | Packs | 4–6 | No | F-050, F-109, F-126, F-185, F-188 |
| S-43 | Broadcasts and segments | Packs | 3–4 | No | F-030, F-066, F-093 |
| S-44 | Sofía knowledge base | Packs | 2–3 | No | F-038 |
| S-45 | Restaurant catering after POS research | Packs | 3–4 | No | F-166, F-186 |
| S-46 | Child-care system integration after research | Packs | 3–4 | No | F-152 |
| S-47 | Guardrail packs, identity checks and price-list grounding | New segments | 3–4 | Parallel (outside the 27–36) | F-003, F-034, F-037, F-038, F-084, F-116, F-174, F-189 |
| S-48 | Regulated-professional baseline beyond the foundation's audit log | New segments | 2–3 | No | F-115, F-117, F-118, F-123, F-124, F-134 |
| S-49 | Rooms and dates with holds | New segments | 2–3 | No | F-050, F-051, F-183 |
| S-50 | Multi-payer schedules with cash | New segments | 2–3 | No | F-059, F-061 |
| S-51 | Contract template library | New segments | 1–2 | No | F-057, F-187 |
| S-52 | Consent-ledger additions | New segments | 1 | No (the Spanish opt-out keywords are configuration, due this week) | F-065, F-066, F-133 |
| S-53 | Tenant vetting | New segments | 0.5–1 | No (§11.3 step 1; this plan runs it with the parallel work) | F-039, F-088, F-099, F-131, F-139, F-173 |
| S-54 | Events pack | New segments | 2–3 | No | F-166, F-183, F-184 |
| S-55 | Law pack | New segments | 2–3 | No | F-124, F-181, F-189 |
| S-56 | Insurance pack | New segments | 2–3 | No | F-182, F-189 |
| S-57 | Law integrations after research | New segments | 3–4 | No | F-152 |
| S-58 | Insurance integrations after research | New segments | 3–4 | No | F-152 |
| S-59 | Route-service templates | New segments | 1 | No | F-180 |
| S-60 | Freight pilot | New segments | 2–3 | No | F-191 |
| S-61 | Seasonal tax receptionist offer | New segments | 1 | No | none; related: F-124, F-173 |
| S-62 | M7a steps 2–4 (estimate) | In flight | 3–4 | Parallel (M7a's remaining steps) | none; depended on by F-020, F-041, F-055, F-056, F-058, F-070, F-076, F-087, F-088, F-096, F-099, F-100, F-136, F-138, F-139, F-141, F-142, F-143, F-167, F-173, F-183 |

**The check.**

| Track | Items | Sum of the rows (ew) | Study's own total (ew) | Match? |
|---|---|---|---|---|
| Foundation | 13 | 39–54 | 39–54 | yes |
| AI | 8 | 11–17 | 11–17 | yes |
| Google and Microsoft | 7 | 15.5–22 | 15.5–22 | yes |
| Money and portal | 4 | 18–24 | 18–24 | yes |
| Reach | 5 | 10–15 | 10–15 | yes |
| Packs | 9 | 23–32 | 23–32 | yes |
| New segments | 15 | 27.5–39 | 27.5–39 | yes |
| In flight | 1 | 3–4 | 3–4 | yes |
| **Total** | **62** | **147–207** | **about 147–207** | **yes** |

- **Every track sums to the study's own total, and so does the whole.** The study's arithmetic holds.
- **The first release also checks.** The nine items marked "Yes" (S-01, S-02, S-03, S-05, S-06, S-07, S-09, S-14 and S-15) sum to exactly 27–36 ew, the figure in §11.2. The parallel work (S-27, S-28, S-47 and S-62, plus the Business Profile API application, which has no effort line) sits outside that figure, as the study says. This plan adds tenant vetting (S-53) and Microsoft sign-in from §11.3 step 1 to it, so section 4 counts five study items there.
- **S-62 is kept as audited.** The study's own note of 2026-09-26 says M7a step 2 shipped in #144, so "steps 2–4" should read "steps 3–4". The study leaves the effort as audited, and so does this table.
- **The figures are optimistic for one engineer.** The study says Appendix D's estimates assume a team of two or three. The feasibility judge re-estimates S-01 at 6–9 ew rather than 3–4. If the judge is right, the Foundation track becomes 42–59 ew and the first release 30–41 ew.
- **Eleven S-items have no canonical feature that details them.** They are the whole Google and Microsoft track (S-22 to S-28, 15.5–22 ew), spreadsheet import (S-35), the regulated-tenant mode (S-39), the seasonal tax offer (S-61) and M7a (S-62). They are costed in the study; section 7 schedules the Google and Microsoft track.

**Not in the total (S-N list).**

The study lists these as outside the 147–207 ew "because each waits on a decision or on research".

| S-N ID | Item | Waits on | Canonical features that touch it |
|---|---|---|---|
| S-N1 | HIPAA mode | Decision 5: an anchor clinic that funds it, in the hardened production project (§11.3 step 12). Binding constraint 2 keeps it there | F-127 (never for held tenants), F-134, F-173 |
| S-N2 | The studios pilot | Months 9–12, after households, recurring billing with the Health Spa Act check, and e-signature (§11.3 step 11) | F-058 (the Health Spa Act check), F-191 |
| S-N3 | Pet grooming and boarding | Research; "later, 12–18 months" (§9.5) | F-191 |
| S-N4 | Homebuilder templates | Home services part two (S-41), which waits on money and per-staff calendars (§9.5) | F-191 |
| S-N5 | The lot-developer and produce-broker research | Research: Texas executory-contract rules before any lot-developer pilot; produce brokers "merit a later look" (§9.5) | none |
| S-N6 | Meta lead ads | API and partner research; "later" (§9.6 item 10) | F-148 (a tile), F-149 (a route in); costed with direct messages in **F-193** |
| S-N7 | A native mobile app | Decision 10: only when Tap to Pay or a larger technician fleet justifies it | F-064, F-108, F-109 |
| S-N8 | WhatsApp | Decision 11: after the consent ledger, with the provider researched first | F-028, F-031, F-043, F-070 (revisits the order) |
| S-N9 | The rule builder | Decision 12: until clients' needs diverge from the recipes; the first pack is the test | F-071 (revisits in part), F-172 (evidence) |
| S-N10 | Full inbox sync | Decision 13, and decision 2 for Nylas; Google's CASA assessment for restricted Gmail scopes. Includes the Gmail add-on and Outlook add-in (§6.2 step 7) | F-054 |
| S-N11 | A staff business number | §7.2 HubSpot #17 and monday #15, "Later" | F-073 (revisits), F-075 |
| S-N12 | Sequences | §7.2 monday #14, "Later", possible once inbound email lands | F-079 (revisits) |
| S-N13 | AI fields | §5.1 item 9, "later"; written only through proposals, so after S-14 | none |
| S-N14 | Meet and Teams transcripts | Decision 7: do meetings happen inside BIS? (§6.3) | none |
| S-N15 | NPS surveys | §7.2 HubSpot #22, "Adopt later" | F-072 (revisits) |
| S-N16 | Multi-currency | §7.2 HubSpot honourable mention, "Later"; M7a is USD-only | F-060 (revisits in part) |

---

## Appendix C. Sources

**The study and its appendices** (on the working branch; landing them on `main` is an operational step in §4.2):
- `docs/research/2026-09-25-crm-feature-research.md`: the CRM study. Sections 1–15; §11 is the plan, §12 the 18 owner decisions, §13 the risks.
- `docs/research/2026-09-25-appendix-a-hubspot.md`
- `docs/research/2026-09-25-appendix-b-monday.md`
- `docs/research/2026-09-25-appendix-c-smb-crm-landscape.md`
- `docs/research/2026-09-25-appendix-d-integrations.md`
- `docs/research/2026-09-25-appendix-e-industry-software.md`
- `docs/research/2026-09-25-appendix-f-market-sizing.md`
- `docs/research/2026-09-25-appendix-g-professional-services.md`
- `docs/research/2026-09-25-appendix-h-consumer-services.md`
- `docs/research/2026-09-21-pricing-and-packaging.md`: the pricing study.

**The design contract:** `DESIGN.md`; the tokens in `apps/web/src/styles/tokens.css`; the reference mockup `docs/design/northern-lights.html`.

**The main specs cited:**
- `docs/superpowers/specs/2026-07-25-bis-platform-design.md` (the platform spec and its §8a tracker)
- `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md` (client billing)
- `docs/superpowers/specs/2026-08-21-booking-design.md` (booking)
- `docs/superpowers/specs/2026-08-24-voice-receptionist-core-design.md` (Sofía)
- `docs/superpowers/specs/2026-09-20-web-concierge-design.md` (the website assistant)
- `docs/superpowers/specs/2026-09-06-automations-design.md` (automations)
- `docs/superpowers/specs/2026-09-07-website-traffic-design.md` (website traffic)
- `docs/superpowers/specs/2026-09-15-meeting-notes-design.md` (meeting notes)
- `docs/superpowers/specs/2026-08-27-onboarding-wizard-calls-design.md` (the setup wizard)
- `docs/superpowers/specs/2026-09-11-contact-dedupe-hardening-design.md` (duplicates)
- The runbooks in `docs/runbooks/` (CI database, Clerk, voice, website, A2P registration).

**Legal texts** (primary sources; commentary is linked where it is cited in §4.2 and §9):
- 47 CFR 64.1200, today's (a)(10) to (a)(12): [eCFR](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200)
- The FCC's draft Report and Order and Further Notice, FCC-CIRC 2609-05, 9 September 2026, with its fact sheet: [DOC-424844A1](https://docs.fcc.gov/public/attachments/DOC-424844A1.pdf)
- The Bureau's order of 6 January 2026, DA 26-12, delaying "revoke all" to 31 January 2027: [FCC](https://www.fcc.gov/document/cgb-extends-effective-date-tcpas-consent-revocation-rule)
- 47 CFR 64.1200(c)(1), the federal calling hours (8 a.m. to 9 p.m. at the called party's location): [eCFR](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200)
- Texas Business and Commerce Code chapter 301, telephone solicitation hours (§301.051): [statutes](https://tcss.legis.texas.gov/resources/bc/htm/bc.301.htm)
- Texas Business and Commerce Code chapter 302, telephone solicitation, as SB 140 amended it: [statutes](https://statutes.capitol.texas.gov/Docs/BC/htm/BC.302.htm); the Attorney General opinion request RQ-0626-KP: [request](https://www.texasattorneygeneral.gov/sites/default/files/request-files/request/2025/RQ0626KP_0.pdf); the Secretary of State's registration FAQ: [FAQ](https://www.sos.state.tx.us/statdoc/faqs3400.shtml), with commentary by [K&L Gates](https://www.klgates.com/thought-leadership/Litigation-Minute-Text-Message-Marketing-in-Texas-One-Year-After-SB-140-9-14-2026)
- Chapter 541, the TDPSA, including §541.002(b)(2): [statutes](https://tcss.legis.texas.gov/resources/bc/htm/bc.541.htm)
- The CAN-SPAM Act, the FTC's compliance guide for business: [FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- Chapter 542, the cybersecurity safe harbour (SB 2610): [statutes](https://tcss.legis.texas.gov/resources/bc/htm/bc.542.htm); [enrolled bill](https://capitol.texas.gov/tlodocs/89R/billtext/html/SB02610F.htm)
- TRAIGA (HB 149), chapters 551–554; the disclosure duty is §552.051: [statutes](https://tcss.legis.texas.gov/resources/bc/htm/bc.552.htm)
- Texas Insurance Code §4001.051, subsections (b) and (d): [statutes](https://tcss.legis.texas.gov/resources/in/htm/in.4001.htm)

**Working files.** The twelve subsystem inventories and their adversarial checks, the ten lens files with their 230 proposals, the canonical list of 192 features, and the four judges' scores were planning material. They are not in the repository; everything this plan relies on from them is stated here, and security-sensitive findings are tracked privately.
