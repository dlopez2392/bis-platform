# BIS Platform — What to Build Next: a CRM for the Valley's Small Businesses

**Date:** 2026-09-25 · **Branch:** `claude/fervent-lamport-74vudn` · **Audited against:** `main` @ `c9f8454`
**Question:** how should BIS improve to serve plumbers, restaurants, child and adult day
care centers and similar small businesses — with one place for everything about a
client, AI throughout, and Google and Microsoft 365 built in?

**Evidence base.** Five research appendices written for this study, two earlier research
documents in this folder, and a line-by-line audit of the repository:

| Source | Subject |
|---|---|
| [Appendix A](2026-09-25-appendix-a-hubspot.md) | HubSpot, every feature by hub and tier |
| [Appendix B](2026-09-25-appendix-b-monday.md) | monday.com and monday CRM, every feature by plan |
| [Appendix C](2026-09-25-appendix-c-smb-crm-landscape.md) | 25 other small-business CRMs on five themes |
| [Appendix D](2026-09-25-appendix-d-integrations.md) | Google, Microsoft, documents, e-signature, payments, AI: feasibility and cost |
| [Appendix E](2026-09-25-appendix-e-industry-software.md) | Industry software for the four target verticals, with Texas rules |
| [Pricing study](2026-09-21-pricing-and-packaging.md) | Valley competitors, prices, demographics (21 September) |
| [Insights brief](2026-09-20-insights-content-brief.md) | Texas and federal rule changes affecting small businesses (20 September) |

**How it was checked.** The first draft went to an independent reviewer instructed to
find what was wrong, verify every repository claim against the code, spot-check the
numbers against the appendices, and list every idea the research surfaced that the draft
neither adopted nor rejected. It found three critical errors and several dozen smaller
ones, all corrected here. The two integration claims the plan depends on most were
re-verified against Google's and Microsoft's own documentation.

**One limitation, stated plainly.** This work ran in a cloud session that cannot see the
HubSpot and monday.com accounts open in the owner's browser. Appendices A and B are built
from both vendors' published feature tables, knowledge bases and developer documentation
instead — more complete than a walk through one account's screens, but not a view of how
BIS's own accounts are configured. §13 says how to close that gap.

---

## 1. The answer, on one page

**BIS already holds two of the ideas the market is converging on.** Answering every lead
instantly in the caller's language ranked first among 30 ideas in Appendix C; Sofía does
it. AI that proposes CRM updates from a conversation and changes nothing until a human
approves ranked second; Pipedrive launched it as "Nova" in mid-September 2026 (reported
secondhand), and BIS merged the same pattern as **call proposals** on 19 September.

**What BIS lacks is the record those ideas write into, and a staff model to use it.** A
client today is a contact row with five kinds of custom field, a free-text company name
and a timeline. There is no place for a document; no way to say two people are a mother
and her child, or that a customer owns three rental properties; no money flowing to the
business's own customers; no connection to Google or Outlook. Every client user signs in
as an administrator — there are no staff, no roles and no per-person calendars. And
"bilingual" stops halfway: Sofía, the booking page, forms and the booking confirmation
speak Spanish, but the reminders, review requests, follow-ups and every other automated
message customers receive are English-only, and so is the owner's dashboard.

**So the work is a foundation first, then the features on it.** In order:

| # | Build | Why here |
|---|---|---|
| 1 | **Staff and roles**: real users, roles, a language preference per user | Per-person calendars, field-level privacy and "summary in my language" all need it; restricted fields must not exist before permissions do |
| 2 | **The client record**: households and businesses, typed relationships shown on both sides, properties and equipment, 13 field types | Every target industry needs it |
| 3 | **A consent ledger** for texts, calls and email | The FCC's "revoke all" rule takes effect **31 January 2027**; every industry pack needs it |
| 4 | **Bilingual end to end**: a language on every contact, automated messages in both languages, then the Spanish dashboard | The Valley expects it; four of six local competitors already claim it |
| 5 | **The document vault**: private storage, scanning, categories, expiry reminders, versions, retention, a required-documents checklist per record | The owner's first ask; child-care files are legally required |
| 6 | **Email that comes back**: an address per business and per record that files replies and forwards on the right client | Replies are never recorded today — including "stop" requests |
| 7 | **AI on the record**: a bilingual summary, proposals from email, texts and documents, drafting, "gone quiet" nudges, Ask BIS | Summaries and writing are what small businesses actually use AI for |
| 8 | **Google and Outlook**: the owner's calendar first, then per-staff calendars, Meet and Teams links, send-as-me, Drive and OneDrive pickers, contacts sync | The schedule is the business |
| 9 | **Money**: price book, quotes with options, e-signature on any document, invoices, deposits, recurring billing, payment links | Getting paid is a service business's close |
| 10 | **The client portal and the MCP server** | One link for the customer; Claude and ChatGPT for the owner, with every AI write landing as a proposal |

**This is not a quarter's work.** Summed honestly (§10), the full plan is roughly **84–118
engineer-weeks** in conventional units. This repository's own history is the better
guide to calendar time: foundation, CRM, booking and the voice receptionist all shipped
between 25 July and 20 September. §10 lays the work out as parallel tracks so the owner
can pace it.

**Industry packs ride on the foundation**, delivered by extending blueprints. Order:
**home services** first (the product and its specs are already shaped around trades),
**child care** second (the compliance file is where HubSpot and monday are weakest, and
it needs no HIPAA), **restaurant catering and events** third (after POS integration
research), and **adult day care and medical offices** only after an explicit decision to
invest in a HIPAA mode (§9.4).

---

## 2. Where BIS stands today

### 2.1 What is already strong

- **A bilingual voice receptionist**, live on a real client: books, reschedules and
  cancels, captures leads, takes messages, screens spam, hands off to a human, and labels
  each call by the language the caller actually spoke.
- **Call proposals**: after a call, AI suggests a task, a contact-field correction or a
  pipeline move with the evidence quoted, and a person accepts or dismisses it.
- **A web concierge**: a text assistant every client can put on its website as one script
  tag; it files leads through a chosen form and does not book.
- **An automation engine** with one log, one quiet-hours rule per account, visible usage,
  and recipes for reminders, confirmations with YES/NO replies, follow-ups, review
  requests, referral asks, no-show nudges, reactivation and quote follow-ups.
- **A weekly report** that states deltas in words and still sends in a quiet week; a work
  queue; spam screening; missed-call text-back; forms with embeds; CSV import and export
  with dedupe.
- **Client billing (M7a)** under construction: plans and Stripe catalogue sync shipped;
  usage recording, checkout and webhooks (steps 2–4) are still in flight.
- **Discipline**: row-level security on every tenant table with isolation tests, 360 test
  files and 32 end-to-end specs.

### 2.2 The gaps

| Area | BIS today | What the market does | Severity |
|---|---|---|---|
| **Staff and roles** | Two tiers only: agency admin and client user; every client user is invited as an org admin; `users` and `memberships` are unpopulated and "assignment is dead" | Users, teams, roles, record and field permissions | **Blocking** for calendars and child care |
| **Client record** | Contact row; `company_name` is free text; notes and deals must attach to one contact | Companies, households, properties, typed relationships (HubSpot associations, Attio, Jobber properties) | **Blocking** for every vertical |
| **Documents** | None: no table, no storage bucket | Files on every record, templates, e-signature, expiry, portals | **Blocking** — the owner's first ask |
| **Consent** | Per-submission form consent, carrier STOP handling, a marketing-email opt-out | A per-channel consent and revocation ledger | **Blocking** before 31 January 2027 |
| **Bilingual** | Sofía, booking page, forms, booking confirmation, instant reply and the opt-out line are bilingual. Nine automated-message modules, the booking reminder and the dashboard are English-only; contacts have no language field | Spanish customer surfaces are standard among local and vertical competitors | High |
| **Custom fields** | 5 types, on contacts and deals only | 15–30 types, relation fields, on any object | High |
| **Email** | Sent via Resend. With no reply-to set (every account's default), replies land in BIS's own mailbox; with one set, in the owner's inbox. Neither is ever recorded | Two-way sync or logging (HubSpot, monday, Less Annoying CRM, Copper) | High |
| **Calendar** | One calendar per company, enforced by a unique constraint; Sofía's tools and the booking code assume it; Daily.co video links | Per-user calendars, two-way Google/Outlook sync, Meet and Teams links | High |
| **Money to customers** | None (M7a bills BIS's clients, not their customers) | Quotes, invoices, payment links, deposits, recurring billing | High for trades, catering, child care |
| **AI on the record** | Calls only: summaries and proposals | Record summaries, drafting, ask-your-CRM, document reading, notetakers | Medium — BIS's call AI is ahead; the rest is behind |
| **Client portal** | None (booking and form pages are public, not personal) | Portals with a public/private divider, uploads, payments | Medium |
| **Mobile** | Responsive web; no installable app | Native apps; Tap to Pay needs native | Medium |
| **MCP** | None | HubSpot, monday, Pipedrive, Attio, Zoho, Close, HoneyBook, GoHighLevel, folk, Twenty | Medium, rising |

---

## 3. The client record — one place for everything

### 3.1 Four principles from the research

1. **One record, with a line between what the client can see and what they cannot.**
   HoneyBook puts everything about a job on one page and draws a divider labelled "Not
   visible to clients" above tasks, automations and private notes. That makes the portal
   (§8) a view of the same record, not a second data model.
2. **Relationships are typed roles, shown on both sides.** Less Annoying CRM writes
   "Sarah referred Kyle" on both records; Jobber lets one customer own many properties
   with a separate billing address; Texas rule §746.605 requires parents, emergency
   contacts and people the child may be released to on every child's admission form.
   Capsule, which allows a person one organisation only, is the anti-example. HubSpot
   charges Professional prices for association labels; BIS should include them.
3. **Documents attach themselves and know when they expire.** Copper files Gmail
   attachments onto the record automatically. The verticals add what sales CRMs lack:
   immunisation records, insurance certificates, contractor licences and care plans
   expire, and a Texas child-care center must keep a child's file at least three months
   after the last day.
4. **The top of the record answers "what do I need to know right now", in the reader's
   language.** HubSpot's record summary, Zoho's (23 languages) and Capsule's meeting prep
   all put a generated paragraph above the timeline.

### 3.2 Proposed data model

In this repository's conventions: `account_id` on every row, RLS on every table, and
**composite same-account foreign keys** as migration 0050 introduced — which rules out
polymorphic `owner_type`/`owner_id` columns, because those cannot carry a foreign key.
Where a row can belong to several kinds of record, it gets **one nullable foreign key per
kind and a CHECK that exactly one is set**.

Names avoid everything already taken: `accounts` is the tenant, "organization" is the
Clerk tenant (`org_id` in every RLS policy), the UI calls accounts "Companies", `sites` is
the website table, `memberships` is user-to-account, and `blueprints.assets` is the
blueprint bundle.

| Table | Purpose | Key columns |
|---|---|---|
| `client_groups` | A household, a business customer, a care facility, a referral source | `kind` (`household` / `business` / `facility` / `referrer`), `name`, billing address, `custom`. The UI label comes from the industry pack: *Familia*, *Household*, *Company* |
| `client_group_members` | A contact's place in a group | `client_group_id`, `contact_id`, `role` label, `is_primary`, `is_billing` |
| `contact_relationships` | Person-to-person roles, rendered on both records | `contact_id`, `related_contact_id`, `label` (parent, guardian, child, spouse, emergency contact, authorised pickup, responsible party, caregiver, tenant, landlord, referred by), flags `can_pick_up`, `is_emergency`, `has_custody`, `no_contact` |
| `service_locations` | Where the work happens: a property, a unit, a venue | one of `client_group_id` / `contact_id`; address; access notes; gate code (restricted) |
| `equipment` | What is installed or served there | `service_location_id`, type, make, model, serial, installed on, warranty until, `status` (`installed` / `replaced`) — replaced units kept as history, as in ServiceTitan |
| `documents` | Any file on any record | one of `contact_id` / `client_group_id` / `opportunity_id` / `service_location_id`; `category`; `expires_on`; `retention_class`; `client_visible`; `uploaded_by_kind` (`staff` / `client` / `system`); `source` (`upload` / `email` / `mms` / `e_sign` / `drive_link` / `onedrive_link` / `template`); `scan_status`; `extracted` jsonb; `sensitivity` (`normal` / `restricted` / `health` / `phi`); `legal_hold`; `deleted_at` |
| `document_versions` | Every version of a document, current one flagged | `document_id`, `storage_path`, `bytes`, `sha256`, `uploaded_by`, `created_at` |
| `document_access_log` | Who opened or downloaded what, append-only | `document_id`, `actor`, `action`, `at` |
| `document_requests` | "We still need the immunisation record" | `contact_id`, `category`, `due_on`, `status`, a single-use upload token |
| `document_destruction_log` | What was purged under which retention rule | `document_id`, `retention_class`, `destroyed_at`, `destroyed_by` |
| `consent_events` | The consent and revocation ledger, append-only | `contact_id`, `channel` (`sms` / `voice` / `email`), `purpose` (`transactional` / `marketing`), `action` (`granted` / `revoked`), `source` (form, reply keyword, staff, import), `evidence`, `at` |

Around the tables:

- **Custom fields grow from 5 types to 13**: add multi-select, phone, email, URL,
  currency, long text, file, and **relation** (a field that points at another record),
  and widen `custom_fields.model` beyond `contact` and `opportunity` so groups,
  locations and equipment can carry them too.
- **Notes, tasks and deals attach to any record** by the same one-FK-per-kind rule.
- **Conversations stay one per contact**, with a household view that merges the
  members' threads rather than a new household-level thread.
- **`company_name` moves into `client_groups`** with a backfill (one `business` group per
  distinct name per account), a dual-write period, and changes to the twelve places that
  read it today — cursor paging, CSV import and export, the forms `core.company_name`
  mapping, the drawer and the table.
- **Custom objects are rejected for now.** Attio and Twenty let owners define their own
  objects; for a small team, fixed tables plus industry packs are faster to build, easier
  to secure under RLS and simpler for an owner to understand. Revisit if a pack needs an
  object none of these tables fits.

### 3.3 The record page

DESIGN.md already sets the pattern: **a list click opens a right-side drawer; a deep link
opens the full page.** Keep both. The drawer shows the summary, key facts and the next
three things due. The full page uses three columns on a wide screen, stacked on a phone:

- **Left — who they are.** Name, phones, emails, language, tags, key custom fields, and
  **Relationships** as role chips ("Madre de Sofía R.", "Autorizada para recoger").
- **Centre — what is happening.** The AI summary, then the unified timeline: calls with
  summaries, texts, emails, notes, form submissions, bookings, documents added, payments,
  and **industry activity types** from the pack (service call, inspection, tasting,
  incident report, parent conference).
- **Right — what they have.** **Documents** (with "expiring" and "missing" badges and the
  completeness count), **Money** (open quotes, unpaid invoices, balance), **Appointments**,
  **Deals**, **Properties and equipment**, **Groups**.

Like every screen, it must pass DESIGN.md's definition of done: tokens only, both themes,
designed empty states ("Documents you add or clients upload appear here — Add a
document"), status never by colour alone.

### 3.4 The document vault

- **Storage.** A private Supabase Storage bucket, keys shaped
  `{account_id}/{kind}/{record_id}/{uuid}`, RLS on `storage.objects` keyed on the tenant
  claim, signed URLs of 60–300 seconds, resumable uploads above 6 MB. Supabase Pro
  includes 100 GB and then charges $0.0213 per GB-month. Confirm which Supabase plan
  production runs on before designing limits: the Free plan caps files at 50 MB.
- **Quotas, stated rather than "generous".** Default 25 GB per business; 100 MB per file
  from staff; 25 MB per file and 20 files a day per upload link from clients; a
  content-type allowlist (PDF, images, Office documents). At $0.0213 per GB-month, 25 GB
  costs about 53 cents a month; the caps exist to stop abuse, not to save storage.
- **Scanning.** Supabase has none. Upload to a quarantine prefix; a small ClamAV worker
  scans and then promotes or deletes. ClamAV runs as a separate process, so its GPL
  licence does not reach BIS's code, but it is **new always-on infrastructure** outside
  Vercel and needs an owner and monitoring.
- **Expiry and completeness.** An industry pack declares categories and which are
  required — a Texas child's file lists enrolment agreement, admission information,
  health statement, immunisations and more under §746.603. The record shows "7 of 9" with
  the missing items named. A new automation pass sends "expiring in 30 days" reminders
  under the existing quiet hours and log.
- **Stage rules.** A job cannot move to *Done* without photos and an invoice; a child
  cannot move to *Enrolled* without immunisations and emergency contacts. monday gates
  this at Pro; BIS should make it standard.
- **Retention.** A class per category, longest applicable clock wins, legal holds, and a
  destruction log. Texas child-care periods are floors, so the default is keep, not purge.
- **Teardown.** Storage objects do not cascade when an account is deleted. The account
  teardown and the test-fixture sweep both need to delete the account's prefix.
- **The vault is the system of record; Drive and OneDrive are links.** Pipedrive keeps
  document templates in the owner's own Drive. BIS should not: expiry, retention, access
  logs and required-document rules only work on files BIS holds. Linked Drive and
  OneDrive files are shown as references beside them.
- **Document templates with live fields.** Enrolment agreements, service contracts and
  catering event sheets fill themselves from the record and render to PDF (monday docs'
  `{field}` merge, Pipedrive Smart Docs), then go to e-signature (§8).

---

## 4. Bilingual, end to end

The pricing study found that four of six local competitors already claim Spanish, so
bilingual is table stakes in the Valley, not a premium. BIS's defensible claim is being
bilingual **everywhere**, which today it is not.

1. **A language on every contact** (`contacts.preferred_language`) and on every booking
   (`bookings.locale`, already the recorded follow-up in the booking email code). Set it
   from the call's detected language, the form's locale and staff edits.
2. **Every automated message in both languages**, chosen per contact: the nine copy
   modules (review request, no-show nudge, referral ask, reactivation, quote follow-up,
   appointment confirmation, SMS reminder, marketing footer, instant reply) and the
   booking reminder email. This is the highest-value piece — it is what a Spanish-speaking
   customer actually receives.
3. **The Spanish dashboard.** The catalogue is already one file of about 1,250 strings,
   which makes the plumbing cheap; the cost is translation review against DESIGN.md's
   "landscaper at 7 AM" test in Spanish, and a language setting per user (which needs the
   staff model, §1 item 1).
4. **AI output in the reader's language**: summaries in the staff member's language,
   drafts in the customer's.

The pricing study's census figure — 29.2% of Hidalgo County's population aged five and
over speaks English less than "very well" — describes the population, not business
owners; it argues most strongly for items 1 and 2.

---

## 5. AI in the CRM

### 5.1 What to add, in order

The evidence (Appendix C) is that small businesses use AI mostly for writing, research
and summaries, that autonomous agents are early, and that 14% of CRM users with AI never
use it and 8% do not know it is there. So AI should be **visible on screens the owner
already opens, and useful without configuration**.

1. **Generalise proposals.** `call_proposals` requires a call and allows three kinds; its
   grounding checks evidence against the call transcript. Turn it into a source-typed
   `proposals` table (call, message, document, notetaker, MCP) with grounding per source.
   Everything below that writes to the CRM goes through it.
2. **Record summary and prep**, in the reader's language, from the rows the existing
   non-AI summary route already gathers. Cache per record, regenerate when a new timeline
   event arrives, and cap generations per account per day so cost stays bounded.
3. **Proposals from email, texts and documents.** "The customer's email gives a new
   address, 402 Nolana — update it?" Pipedrive's version draws only on meeting transcripts;
   BIS can cover every channel it records.
4. **Document intake.** A photo or PDF becomes proposed field values shown beside current
   ones: business cards, insurance cards, contractor licences, paper intake forms,
   immunisation records. Appendix D estimates the model cost at up to about a cent per
   document (its own estimate). Children's health records need an owner decision first
   (§11).
5. **Drafting in the customer's language**, with one-tap translation of the customer's
   message for staff who read only one of the two.
6. **"Gone quiet" nudges.** folk flags stalled conversations and drafts the follow-up;
   BIS's work queue is the natural home.
7. **An in-person notetaker.** HubSpot's and monday's turn a tour or a job-site
   walk-through into a summary and proposed updates. For BIS it is call proposals with a
   phone microphone instead of a phone line.
8. **Ask BIS**, answered from a fixed set of read-only query functions running under the
   tenant's RLS — not free-form text-to-SQL. "¿Quién no ha pagado este mes?", "Which
   properties have water heaters older than ten years?" Also answerable **by text
   message** from the owner's verified phone, the way monday's assistant works over
   WhatsApp.
9. **AI review replies**, the half of M5 still owed.

A knowledge base for Sofía — the pgvector piece M4 still owes — is a prerequisite for
two pack features: a receptionist trained on a daycare's handbook, and a restaurant
receptionist that answers menu questions.

### 5.2 Three design rules

- **A person approves every write.** It is what BIS already does for calls and the
  safest answer for an MCP server. Pipedrive's survey of 1,000 sales and marketing
  professionals put it as "a thinking partner, not an autopilot" (reported secondhand).
- **Bilingual by default.** Every generated sentence follows the reader's language.
- **Bundle the cost; do not sell credits.** HubSpot and monday both charge $0.01 credits
  per AI action. M7a will meter voice minutes, SMS and web-chat conversations once its
  steps 2–4 land; summaries and drafting should ride inside the plan with per-account
  caps, as the platform spec's usage-cap guardrail already requires.

### 5.3 What not to do yet

Outbound agents that call or email leads on their own (Close's Chloe, monday's AI Sales
Agent) are English-only or US-only today, early in adoption, and a reputational risk for a
local business whose name is on every call. BIS's inbound receptionist is the right half
of that idea to own first.

---

## 6. Google Workspace and Microsoft 365

### 6.1 What fits inside a free review, and what does not

Verified against Google's and Microsoft's own documentation on 2026-09-25:

| Capability | Google scope | Class | Microsoft permission | User can consent? |
|---|---|---|---|---|
| Two-way calendar, Meet/Teams links | `calendar.events` | sensitive | `Calendars.ReadWrite` | **No — admin approval** |
| Availability | `calendar.freebusy` | sensitive | `Calendars.ReadWrite` | No — admin |
| Choose which calendar | `calendar.calendarlist.readonly` | sensitive | same | No — admin |
| Send as the owner | `gmail.send` | **sensitive** | `Mail.Send` | **Yes** |
| Contacts sync | `contacts` | sensitive | `Contacts.Read` (read) / `Contacts.ReadWrite` | Read yes; write admin |
| Attach a Drive / OneDrive file | `drive.file` + Picker | non-sensitive | `Files.Read` | **Yes** |
| Google Business Profile reviews | `business.manage` | check in console | — | — |
| **Read the inbox** | `gmail.readonly`, `gmail.metadata` | **restricted** | `Mail.Read` | Google: **paid CASA assessment**. Microsoft: admin approval only |
| Browse all of Drive / SharePoint | `drive`, `drive.readonly` | restricted | `Files.Read.All`, `Sites.Read.All` | Google: CASA. Microsoft: admin |

- **Google's sensitive scopes need one verification review, no fee**: a privacy policy,
  a demo video showing each scope in use, and a justification per scope; typically 3–5
  business days and realistically 1–3 weeks. Adding a scope later triggers a new review,
  so one submission should carry every sensitive scope BIS will want — including
  `calendar.calendarlist.readonly` and `business.manage`.
- **Google's restricted scopes need a CASA security assessment by an approved lab every
  year**, reported at roughly $540–$4,500+ and weeks to months (the cost is secondhand).
  That is the price of reading a Gmail inbox.
- **Microsoft blocks users, not apps.** New tenants default to a policy that stops
  ordinary users granting `Calendars.*`, `Mail.Read`, `Contacts.ReadWrite`,
  `OnlineMeetings.*`, `Tasks.*`, `Files.Read.All` and `Sites.Read.All`. `Mail.Send` and
  `Files.Read` stay consentable. So Outlook calendar sync needs the business's Microsoft
  365 admin to approve once — at a five-person business that is usually the owner — and
  onboarding needs an "approve for your company" link. Publisher verification is free
  and takes days.
- **The asymmetry that matters:** a direct Outlook inbox sync needs only admin approval
  (Appendix D: 3–4 weeks of work). A Gmail inbox sync needs CASA, or a vendor that holds
  the assessment (Nylas's shared app, which puts "Nylas" on the consent screen).

### 6.2 The sequence

1. **Now, no gate — email that comes back.** Give each business an address on a BIS
   subdomain, and each record its own (`sofia-r.3fk2@in.<domain>`). Point outbound
   `Reply-To` at the business address, file every reply on the matching contact, and
   forward it to the owner's inbox so nothing changes for them. Forwarding a doctor's
   note or a customer photo to a record's address files it there directly (monday's
   email-to-item). Match household mail by any address on the group. This also lets BIS
   hear a customer who replies "stop" to an email, which today it cannot. The `messages`
   table already allows inbound email rows.
2. **Week 1 — start the clocks that do not need a demo.** Google brand verification and
   Microsoft publisher verification.
3. **Build the owner's calendar first.** Connect one Google or Outlook calendar to the
   company calendar: busy times block Sofía's slots and the booking page, bookings write
   events with Meet or Teams links. This needs no per-staff model and delivers most of
   the value. Pilot under Google's Testing mode (up to 100 test users, 7-day refresh
   tokens) while it is built.
4. **Submit Google's sensitive-scope review when the calendar is demo-ready**, with every
   scope in one submission. The review cannot precede the feature: its demo video must
   show each scope in use.
5. **Then per-staff calendars**, once the staff model exists (§1 item 1). This is more
   than a constraint change: `getCalendarForAccount` and `getOrCreateCalendar` select a
   single row per account and are called by Sofía's booking route, the setup inputs and
   the concierge; migration 0050 and its schema test pin the constraint; Sofía's
   `check_availability` and `book_appointment` tools have no notion of staff. The booking
   spec anticipated this ("a staff dimension can be added later"), and the no-overlap
   rule is already per calendar, so it survives. Each technician connecting their own
   calendar must be a Clerk org member, which touches seat limits.
6. **Send-as-me, the Drive and OneDrive pickers, and contacts sync** (the user picks the
   sync direction, as in Zoho and Pipedrive).
7. **On demand only: full inbox sync** — direct for Outlook, through Nylas's shared app
   for Gmail — and later a Gmail add-on and an Outlook add-in so the client record appears
   beside the email (Copper's best idea). The Gmail add-on's contextual scopes are
   sensitive, not restricted.

**Do better than both incumbents on calendars:** HubSpot syncs only the first event of a
recurring series and only the primary calendar; monday's board-level Outlook sync needs
a Microsoft 365 Business Premium licence. BIS should sync recurring events properly and
need no particular licence.

### 6.3 The rest of Google and Microsoft 365

| App | Stance | Why |
|---|---|---|
| Google Sheets / Excel | **Adopt** direct `.xlsx` export and Sheets/Excel import with AI column mapping (Pipedrive's day-one import assistant) | Owners arrive with spreadsheets; CSV already exists |
| "Sign in with Google / Microsoft" | **Adopt** — Clerk supports it | Cheap, and it is how owners expect to sign in |
| Google Business Profile | **Adopt** reviews and replies (M5); apply for API access early — it needs a verified profile active 60+ days | HubSpot has no native GBP integration at all; reviews are how local businesses get found |
| Meet and Teams recordings/transcripts | **Later**, feeding the notetaker and proposals | HubSpot syncs Teams transcripts since August 2026 |
| Teams notifications | **Later** | Useful for bigger clients; not for a five-person shop |
| Microsoft Bookings | **Reject** | BIS's own booking replaces it |
| Microsoft To Do / Google Tasks | **Later**, one-way push | `Tasks.*` is admin-blocked on Microsoft |
| SharePoint | **Reject** for now; OneDrive picker only | `Sites.Read.All` is admin-blocked and small businesses rarely use it |
| Google Forms / Microsoft Forms | **Reject**; BIS forms replace them | — |
| Google Chat | **Reject** | Little use in this market |

Two gotchas to design for: Microsoft 365 bought through GoDaddy cannot install Integrated
apps or Marketplace add-ins, and personal Outlook.com accounts silently get no Teams links.

### 6.4 The MCP server

HubSpot's went GA on 13 April 2026 and works on every tier; Pipedrive's on 30 June;
monday, Attio, Zoho, Close, HoneyBook, GoHighLevel, folk and Twenty all ship one. Clerk
supports the MCP OAuth flow in Next.js directly. BIS's version: **read tools answer
immediately; every write becomes a proposal the owner approves inside BIS**, with its
evidence. Attio confirms writes before making them (reported secondhand); we found no CRM
whose AI writes land in an in-app review queue.

Two things to prove in a spike before building: that Clerk's MCP access tokens carry the
`org_id` claim every RLS policy reads, and that an agency-admin token cannot reach every
tenant through it.

---

## 7. What HubSpot and monday.com teach

Appendices A and B go through both products line by line — HubSpot's per-tier catalogue
runs to about 850 rows. This section keeps what changes BIS's plan.

### 7.1 Side by side, on the owner's three asks

| | HubSpot | monday CRM | What BIS should do |
|---|---|---|---|
| **One screen per client** | Three-column record: properties left, summary and timeline centre, associations, attachments, Drive and SharePoint cards right. Free plan shows **only the last 30 days** of timeline | A widget grid ("item card") an admin must design per board | HubSpot's layout, pre-built per industry, full history on every plan (§3.3) |
| **Relationships** | Association labels ("Parent", "Billing payer") — **Professional and up** | Connect and mirror columns; accounts grouped by email domain | Typed relationships on every plan, shown on both records (§3.2) |
| **Documents** | Four separate stores (files, attachments, sales documents, file properties) with limits from 20 MB to 2 GB; **files public on a CDN by default**; no expiry tracking | Files column with preview, annotations, zip download; versioning a "trial feature"; 5–1,000 GB by plan | One private vault with categories, expiry, versions and a required-documents checklist (§3.4) |
| **E-signature** | Quotes only, **Revenue Hub Professional**, 25 signatures per user per month, via Dropbox Sign | No native legally-tracked signature; DocuSign or PandaDoc on Pro | Any document, every plan, with an audit trail (§8) |
| **Client portal** | Support portal shows **tickets only**; billing portal in beta on Revenue Pro | None in the CRM; guests per board | One portal over the same record (§8) |
| **AI** | Breeze: summaries, notetaker, agents billed per outcome ($0.50 per resolved conversation), credits at $0.01 | Credits at $0.01: 8 per AI action, 120 per notetaker hour; one-time 6,000-credit trial | Summaries and drafting bundled; proposals for every write (§5) |
| **MCP** | `mcp.hubspot.com`, every tier including Free | `mcp.monday.com`, 60+ tools, every plan | Read tools plus proposal-only writes (§6.4) |
| **Google and Microsoft** | Two-way calendar but **first event of a recurring series only**, primary calendar only; Gmail and Outlook logging; Teams app rated 3.2★ | Two-way calendar in the CRM; board-level Outlook needs **M365 Business Premium** | Recurring events and shared calendars handled, no licence requirement (§6) |
| **Price for a 4-person shop** | Starter bundle $20/seat list; Pro seats $90–150; Marketing Pro $800+/month plus $3,000 onboarding | 3-seat minimum, then buckets of 5: four people pay for five | Priced per business, as in the pricing study |
| **Spanish** | UI in 15 languages; full support in 6; AI brand voice in 5 beyond English; SMS US-only | UI in 14 languages; phone and outreach agents US-only; quotes change format but are not translated | Spanish throughout the UI, messages, documents, AI and Sofía (§4) |

### 7.2 Ideas adopted from the two inventories

Each is folded into the sections above and the plan in §10: a **required-documents
checklist** per record and **stage rules that require documents** (§3.4); **document
templates with live fields** (§3.4); **an email address per record** and **logging by any
address in a household** (§6.2); **industry activity types** on the timeline (§3.3); an
**in-person notetaker** and **Ask BIS by text message** (§5.1); **never-log lists** for
vendor and personal mail, from HubSpot's default "log everything" rule (§6.2); and a
**merge that keeps documents and history**, which monday's merge drops.

### 7.3 Where both leave room for BIS

- **Regulated data is priced out of reach.** HubSpot allows children's and health data
  only under Enterprise Sensitive Data; monday's HIPAA support is Ultimate-only. A
  compliant child-care file at small-business prices is open ground, and it needs no
  HIPAA, because a child-care center is not a HIPAA covered entity.
- **Both are English-first where a Valley customer notices**: HubSpot's full support covers
  six languages and its SMS is US-only; monday's phone and outreach agents are US-only in
  four languages, and its quotes are not translated.
- **Both charge per seat and gate the basics.** HubSpot's own list prices jump from $20 a
  seat to $800 a month plus onboarding; monday's four-person shop pays for five.
- **Neither is built for service operations.** No property or equipment history, no
  enrolment waitlist, no incident workflow, and no Google Business Profile reviews in
  HubSpot. That is what the industry packs add.

---

## 8. Money and the client portal

### 8.1 Money

BIS today bills its own clients (M7a) but gives them no way to bill their customers. The
platform spec recorded payments, invoicing, documents and e-signature as **not adopted,
by decision** — so this section reverses a recorded decision and needs the owner's
agreement (§11).

- **Tables:** `catalog_items` (the price book), `quotes` with `quote_options` (good,
  better, best) and `quote_lines`, `invoices` and `invoice_lines`, `payments`,
  `payment_schedules` (deposits and instalments), `recurring_plans` (service agreements,
  tuition, maintenance), and — for e-signature — `signature_requests` and an append-only
  `signature_events`.
- **Stripe Connect with Stripe setting the fees**: no platform fee to BIS, each business
  its own merchant of record, direct charges, embedded onboarding (Appendix D). It shares
  the Stripe account and the engineer with M7a's remaining steps, so it comes after them.
- **Tips and card-on-file** for trades, **deposits** for catering, **autopay with sibling
  and multi-payer splits** for child care (including a separate line for the parent's
  share of cost under the TWC child care scholarship), and **late fees and year-end
  statements**.
- **In-house e-signature for everyday documents**, meeting the ESIGN Act and Texas UETA:
  an explicit Sign action with the adoption statement shown, a versioned consent to do
  business electronically, a SHA-256 hash binding the signature to the exact PDF, a
  one-time code to the signer, and an append-only audit trail with the signed PDF and a
  certificate page. For anything with health information, embed a BAA-capable vendor
  (BoldSign or SignWell, $0.20–$0.85 an envelope) instead.
- **QuickBooks Online as a push-only sync target** (customers, invoices, payments): writes
  are free and unlimited on Intuit's Builder tier; reads are metered.

### 8.2 The client portal

Built once the vault and money exist, as a **view of the same record** filtered by
`client_visible`:

- **Home is "what you owe us and what we need from you"** — open invoices, unsigned
  documents, requested uploads (Dubsado's model).
- **Upload, sign, pay, book** without calling; **prepaid packages and sessions left** for
  salons, tutoring and trainers (Thryv).
- **Carries the business's own logo and brand colour**, per DESIGN.md rule 9, like every
  client-customer surface.
- **Bilingual, on a phone, with no password**: a magic link by text or email.
- **It sits outside RLS, so it needs its own design.** A magic-link visitor holds no Clerk
  JWT, so the policies that isolate tenants everywhere else do not apply to them, and
  server code running on the service key bypasses RLS. Portal requests need scoped,
  expiring, signed tokens bound to one account and one contact, an explicit tenant check
  on every query, and their own isolation tests.

---

## 9. Industry packs

Each pack extends blueprints, which today stamp pipelines, stages, custom fields, tags and
forms. Packs also need **automations, a Sofía voice profile, document categories and
required-document lists, relationship labels and activity types** — an extension of
blueprints estimated in §10. Appendix E has the full ten-must-have and five-do-not-build
lists per vertical, with Texas citations.

### 9.1 Home services (plumbers, HVAC, electricians, roofers, landscapers) — first

The product is already shaped for trades: the automation engine's quote follow-ups,
completed-job referral ladder and seasonality reasoning are written around plumbing,
roofing and landscaping. The pricing study warns the category is entrenched — Jobber and
Housecall Pro now bundle AI answering, Jobber at $29 a month for 30 conversations — so BIS
competes on Spanish, the bundle and local service, not price.

- **Adopt:** customer → properties → equipment with warranties and replaced-unit history;
  request → quote with good/better/best options → e-signed approval → visit → invoice →
  payment link; service agreements that create visits and bill on schedule; a price book;
  "on my way" texts; a **light schedule board and technician phone view** (photos,
  checklists, notes); TDLR and TSBPE licence numbers and disclosures on quotes and
  invoices; a tax class per line; and an EPA lead-safe (RRP) records set with three-year
  retention for pre-1978 homes.
- **Do not build:** route optimisation and GPS, truck inventory, payroll, financing
  underwriting, job costing beyond the basics, full dispatch for 10-plus-technician shops
  (sync with ServiceTitan or Housecall Pro instead).

### 9.2 Child day care — second

The compliance file is where HubSpot and monday are weakest and where a center's
licensing risk sits. brightwheel has announced its own CRM as "coming soon", which
suggests the window is open but closing.

- **Records:** household → child → guardians with custody and no-contact flags,
  emergency contacts, people the child may be released to, physician, allergies and an
  allergy plan (§746.605); **pickup identity capture** for unfamiliar pickups, kept at
  least three months (§746.4101, §746.4103).
- **Enrolment CRM:** inquiry → tour (Sofía books it) → waitlist by room, age and start
  date → registration packet e-signed → enrolled.
- **Documents:** the §746.603 file with the required-documents checklist and immunisation
  expiry reminders; **incident reports with a 48-hour parent signature and a two-day
  Licensing-notice reminder**; CACFP records kept three years after the final claim,
  even though BIS does not file the claims.
- **Messaging:** bilingual broadcasts to a room or the whole center, and one-to-one
  messages, with **media-consent flags gating any photo**.
- **Permissions:** teacher versus director versus non-custodial parent, at field level —
  which is why the staff and roles model comes first.
- **Inspection packet:** a one-click export of a child's file and the audit log for
  Licensing, plus read access on a phone when the network is down, since records must be
  immediately accessible to caregivers in an emergency.
- **A handbook-trained receptionist** once Sofía has a knowledge base.
- **Do not build:** classroom operations and ratios, daily photo reports, naps and meals,
  curriculum, CACFP claiming, staff payroll, and subsidy attendance kiosks (those need
  KinderSystems certification). Integrate with brightwheel, Procare or Playground.

### 9.3 Restaurant catering and events — third, after research

- **Where BIS earns its place:** the catering and private-events pipeline — inquiry form →
  quote or event sheet → e-sign → deposit schedule → final invoice, with the gratuity
  labelling Texas requires — plus bilingual phone answering for hours and catering
  leads, and segmented campaigns (lapsed, VIP, birthday).
- **Research first:** guest profiles only make sense synced from the POS (Toast, Square,
  Clover), and reservations from OpenTable, Resy or SevenRooms. None of those APIs and
  partner programmes has been researched; do that before committing.
- **An allergen guardrail is mandatory.** Sofía must never tell a caller a dish is safe
  for an allergy. Allergen questions get the restaurant's exact approved wording or a
  handoff to staff. Allergy and dietary tags are sensitive and never used for marketing.
- **Do not build:** POS, online ordering, table management, loyalty points, gift cards.

### 9.4 Adult day care and medical offices — a HIPAA investment decision

This is where the pricing study and this study must be reconciled. The pricing study
called the Valley's appointment-driven healthcare cluster — about 2,376 establishments —
"the better ground", and the insights brief recommended a regulated-tenant mode before the
next clinic signs. Both are right about the size of the prize. This study adds the cost of
entry:

- A CRM holding health information for a covered entity is a HIPAA business associate,
  and Texas's broader medical-privacy law reaches further than HIPAA (Appendix E; the
  data-residency rule is reported secondhand).
- **Resend cannot sign a Business Associate Agreement at all**, so no health information
  may travel in a BIS email. Clerk signs one only on Enterprise (price unpublished).
  Supabase needs its Team plan ($599 a month) plus a HIPAA add-on (about $350, secondhand)
  plus point-in-time recovery and compute. Vercel's BAA is a $350-a-month add-on. Telnyx
  relies on the conduit exception, which does not cover stored transcripts.
- **The floor is at least $1,300 a month, plus recovery and compute, plus a Clerk
  Enterprise contract**, before the first such customer pays anything.
- **It also needs a separate Supabase project.** HIPAA settings apply per project, and
  BIS's production project is shared with the test suites and swept by a fixture cleaner.
  The `sensitivity` column avoids a schema change later; it does not avoid moving data.

**Recommendation:** treat HIPAA mode as a deliberate investment, decided when one anchor
customer — a clinic or an adult day center billing Medicaid — will fund most of the
floor. Until then:

- **Adult day care, front office only**, is possible with a legal check: referral
  pipeline from service coordinators and families, tours booked by Sofía, family
  messaging, private-pay invoicing — with health document categories switched off and a
  hard rule that no health information enters BIS. Private-pay centers that never bill
  electronically are generally not HIPAA covered entities, but Texas law and the
  practicalities of a care setting make this a lawyer's call, not ours.
- **Never build** eMAR, EVV (Texas requires a certified vendor), claim submission or
  caregiver scheduling, in any case.

### 9.5 Others

- **Salons and spas:** prepaid packages and a portal showing sessions left (Thryv's
  model).
- **Auto repair:** vehicles as equipment; digital inspections with photos.
- **Insurance agencies:** policies as expiring documents, renewal pipelines.
- **Legal practices:** matters as client groups; Clio as the integration.
- **Medical and dental front office:** the largest local opportunity, gated by §9.4.

---

## 10. The plan

### 10.1 The sum, honestly

Conventional engineer-weeks for one engineer, from Appendix D where it estimates an item
(its figures assume a 2–3 person team, so they are optimistic for one) and from this
repository otherwise.

| Track | Items | Engineer-weeks |
|---|---|---|
| **Foundation** | Staff and roles (2–3); client record data model with backfill (4–5); record page (2–3); consent ledger (2–3); inbound email (2); document vault with scanning, retention, checklist, stage rules, quotas, teardown (5–6); bilingual messages and Spanish dashboard (4–6) | **21–28** |
| **AI** | Generalised proposals (2); summary with caching and caps (1–2); drafting and translation (1–2); gone-quiet nudges (1); Ask BIS with read tools and SMS (2–3); document intake (2–3); notetaker (1–2) | **10–15** |
| **Google and Microsoft** | Owner's calendar, both providers, Meet and Teams (4–6); per-staff calendars including Sofía's tools (3–4); send-as-me (1–2); Drive and OneDrive pickers (2–3); contacts sync (1–2); verification preparation (1) | **12–18** |
| **Money and portal** | Price book, quotes, invoices, schedules, recurring, Stripe Connect (8–11); in-house e-signature (included); document templates (2); portal with scoped tokens (4–6); QuickBooks push (3–4) | **17–23** |
| **Reach** | MCP server with auth spike (3–4); GBP reviews and AI replies (2–3); spreadsheet import with AI mapping, social sign-in (1–2) | **6–9** |
| **Packs** | Blueprint extensions (2–3); home services (3–4); child care including field permissions, broadcasts, inspection packet (5–7); restaurant catering after POS research (3–4); Sofía knowledge base (2–3) | **15–21** |
| **In flight** | M7a steps 2–4 (estimate) | **3–4** |
| **Total** | | **84–118** |

That is roughly two years for one engineer working conventionally, or one year for two.
**Calendar time here has not been conventional**: this repository shipped its foundation,
the CRM spine, booking with video meetings, the voice receptionist, white-labelling, the
automation engine and the web concierge between 25 July and 20 September. Read the
calendar off that observed pace, not off these units.

### 10.2 Order and dependencies

Tracks run in parallel where they do not depend on each other. Within a track, each item
ships to a real client before the next starts, as the platform spec requires, and every
UI item passes DESIGN.md's definition of done.

1. **Start now, in parallel:** staff and roles; the client record model; the consent
   ledger; inbound email; bilingual automated messages; Google brand verification and
   Microsoft publisher verification; Google Business Profile API application; finish M7a.
2. **On the record model:** the document vault, then the record page, then the
   required-documents checklist and stage rules.
3. **On staff and roles:** the Spanish dashboard's per-user language; the AI summary in
   the reader's language.
4. **On the vault:** document intake, document templates, the home services pack.
5. **Calendar:** the owner's calendar (pilot in Google Testing mode) → submit Google's
   sensitive-scope review with every scope → per-staff calendars (needs staff and roles).
6. **Generalised proposals** before email/text/document proposals, the notetaker and the
   MCP server.
7. **After M7a:** money through Stripe Connect, then the portal, then QuickBooks.
8. **After money and field permissions:** the child care pack.
9. **After POS research:** the restaurant catering pack.
10. **On an anchor customer:** HIPAA mode, then adult day care and medical offices.

The consent ledger must be live before **31 January 2027**, when the FCC's "revoke all"
rule takes effect.

---

## 11. Decisions only the owner can make

1. **Reverse the recorded non-adoption of payments, invoicing, documents and
   e-signature** (platform spec §2). Recommended: yes — the owner's own ask for "all their
   documents" and every industry pack depend on it.
2. **The "no external services for core features" rule.** The plan adds ClamAV (self-
   hosted, but new infrastructure), Stripe Connect, optionally BoldSign or SignWell for
   health documents, and optionally Nylas (about $2 per account per month) for Gmail
   inbox sync. Recommended: accept ClamAV and Stripe; defer the rest.
3. **Per-staff calendars**, reversing one-calendar-per-company. Recommended: yes, after the
   owner's-calendar step proves the sync.
4. **HIPAA as an investment**: now, on an anchor customer, or never. Recommended: on an
   anchor customer; meanwhile adult day care front office only, with a legal check.
5. **Children's health documents and AI.** Immunisation records in a child-care file are
   not HIPAA PHI, but they are sensitive children's data under Texas's privacy act.
   Sending them to a model provider needs a decision: request OpenAI's zero-data-retention
   (sales approval) or a BAA, or exclude health categories from document intake.
   Recommended: exclude them until one of those is in place.
6. **Pack order.** Recommended: home services, child care, restaurant catering, then the
   HIPAA verticals — departing from the pricing study's "healthcare is the better ground"
   only because of §9.4's cost of entry.
7. **Portal sign-in.** Recommended: magic links with scoped tokens, not Clerk accounts.
8. **Full inbox sync.** Recommended: the inbound address first; direct Outlook sync if
   customers ask; Gmail through Nylas's shared app only if they insist.

---

## 12. Risks

- **Scope.** 84–118 engineer-weeks is a lot of product. The discipline that kept BIS
  sharp — ship to a real client before the next item — matters more, not less.
- **Sensitive data before permissions.** Custody flags, no-contact flags, gate codes and
  pickup IDs must not be stored until roles are enforced. Pickup-person driver's-licence
  images are sensitive personal information under Texas breach law; get a legal check.
- **The portal and the MCP server both step outside RLS's usual path.** Each needs its own
  isolation tests before launch.
- **Storage abuse and cost**: quotas, rate limits and a type allowlist on every upload
  path; egress at $0.09 per GB past the allowance; teardown of storage on account
  deletion; confirm the Supabase plan.
- **AI cost at scale**: summaries cached and capped per account; model cost tracked per
  feature alongside M7a's meters.
- **Google's Limited Use policy**: Workspace data may power prominent user-facing features
  but may not train models or be aggregated beyond the user.
- **TRAIGA**, Texas's AI law, adds disclosure duties for AI in healthcare — relevant the
  moment a clinic or adult-day tenant uses Sofía (insights brief).
- **Children's data is "sensitive" under the Texas Data Privacy and Security Act**: never
  sold, never used for marketing.
- **New infrastructure**: the ClamAV worker needs a host, updates and monitoring.
- **One engineer, several Stripe projects**: M7a's remaining steps, Stripe Connect and the
  billing portal share an account and attention; sequence them.
- **The allergen guardrail** for restaurants is a safety issue, not a copy issue.

---

## 13. Closing the one gap in this research

Appendices A and B describe HubSpot and monday.com as their vendors publish them. To
compare them against **how BIS's own HubSpot and monday.com accounts are set up** — which
pipelines, properties, boards and automations exist — connect the official HubSpot and
monday.com connectors at <https://claude.ai/customize/connectors> and start a new session.
Both vendors publish MCP connectors, so a future session can read those accounts directly
and diff them against this plan.

---

## 14. Sources

Research facts are cited inline in Appendices A–E, the pricing study and the insights
brief, which link vendor pricing pages, knowledge-base articles, developer documentation
and primary Texas and federal regulations. Claims those sources mark secondhand are marked
secondhand here. Two load-bearing integration claims were re-verified against primary
sources on 2026-09-25:

- Google Gmail scope classes — <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Microsoft Entra default user-consent policy —
  <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies>

Repository facts were read from `main` @ `c9f8454` on 2026-09-25 and checked a second time
by the independent review.
