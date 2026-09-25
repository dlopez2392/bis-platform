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

**How it was checked — three independent reviews.** Revision 1 went to an independent reviewer told to
find what was wrong: verify every repository claim against the code, spot-check numbers
against the appendices, and list every researched idea the draft neither adopted nor
rejected. It found three critical errors and several dozen smaller ones. Revision 2
corrected them and went to a second reviewer, who confirmed the fixes, checked the
HubSpot and monday.com section line by line, and found about forty further issues —
chief among them that only eight of the fifty HubSpot and monday.com ideas had an
explicit decision. Revision 3 addressed those and went to a third reviewer for a
convergence check, which found no critical problems and eleven important ones — among
them Sofía's own English-only emails, a packaging section that ignored the owner's
approved billing plan, and a Google sequence that would have let brand verification
lapse. This is revision 4: every finding from all three rounds is addressed, and §7.2
records a decision for every HubSpot and monday.com idea. The two integration claims the plan depends on
most were re-verified against Google's and Microsoft's own documentation.

**One limitation, stated plainly.** This work ran in a cloud session that cannot see the
HubSpot and monday.com accounts open in the owner's browser. Appendices A and B are built
from both vendors' published feature tables, knowledge bases and developer documentation
instead — more complete than a walk through one account's screens, but not a view of how
BIS's own accounts are configured. §14 says how to close that gap.

---

## 1. The answer, on one page

**BIS already holds two of the ideas the market is converging on.** Answering every lead
instantly in the caller's language ranked first among 30 ideas in Appendix C; Sofía does
it. AI that proposes CRM updates from a conversation and changes nothing until a person
approves ranked second; Pipedrive launched it as "Nova" in mid-September 2026 (reported
secondhand), and BIS merged the same pattern as **call proposals** on 19 September.

**What BIS lacks is the record those ideas write into, and the staff to use it.** A client
today is a contact row with five kinds of custom field, a free-text company name and a
timeline. There is no place for a document; no way to say two people are a mother and her
child, or that a customer owns three rental properties; no money flowing to the business's
own customers; no connection to Google or Outlook. Every client user signs in as an
administrator — there are no staff, no roles and no per-person calendars. And "bilingual"
stops partway: Sofía's voice, the booking page and its own confirmation, the forms'
buttons and system text, the web concierge, the missed-call text, the lead receipt and
the instant reply speak Spanish. But eight automated-message modules, the booking
reminder and follow-up emails, the confirmation and reschedule emails Sofía herself
sends after a call, every form's own labels, and the owner's dashboard are English-only.

**So the work is a foundation first, then the features on it:**

| # | Build | Why here |
|---|---|---|
| 1 | **Staff and roles**: real users, roles, field-level restriction, assignment, a language per user | Per-person calendars, private fields and "summary in my language" all need it; restricted fields must not exist before permissions do |
| 2 | **The client record**: households and business customers, typed relationships on both sides, properties and equipment, 13 field types, an audit log with before and after values, a trash | Every target industry needs it |
| 3 | **A consent ledger** for texts, calls and email, synced with Telnyx's opt-out list | The FCC's "revoke all" rule takes effect **31 January 2027**; every industry pack needs it |
| 4 | **Bilingual end to end**: a language on every contact, every automated message in both languages, then the Spanish dashboard | Four of six local competitors already claim Spanish; BIS's edge is being bilingual everywhere |
| 5 | **The document vault**: private storage, scanning, versions, expiry reminders, retention, a required-documents checklist, stage rules, forms that accept uploads and signatures | The owner's first ask; child-care files are legally required |
| 6 | **Email that comes back**: an address per business and per record, on the client's own domain where it has one | Replies are never recorded today |
| 7 | **AI on the record**: generalised proposals, a bilingual summary, drafting, intake from photos and PDFs, "gone quiet" nudges, Ask BIS | Summaries and writing are what small businesses actually use AI for |
| 8 | **Google and Outlook**: the owner's calendar first, then per-staff calendars, Meet and Teams links, send-as-me, Drive and OneDrive pickers, contacts sync | The schedule is the business |
| 9 | **Money**: price book, quotes with options, e-signature, invoices, ACH and card, deposits, recurring billing | Getting paid is a service business's close |
| 10 | **The client portal, the MCP server, and industry packs** | One link for the customer; Claude and ChatGPT for the owner with every AI write landing as a proposal; the industry specifics |

**The full plan is about 120–168 engineer-weeks** in conventional units (§11), with a
first release of roughly 27–36 engineer-weeks that delivers the record page, the vault,
consent, bilingual messages, inbound email and the AI summary. This repository's own pace is the
better guide to calendar time: foundation, CRM, booking, the voice receptionist,
white-labelling, the automation engine and the web concierge all shipped between 25 July
and 22 September.

**Industry packs**, delivered by extending blueprints, in this order: **home services**
(the product and its specs are already shaped around trades), **child care** positioned as
the center's front office beside its child-care management system, **restaurant catering
and events** after POS research, and **adult day care and medical offices** only after an
explicit decision to invest in HIPAA.

**One go-to-market consequence the owner should see first.** The pricing study named the
Valley's healthcare cluster the best ground for Sofía. But a clinic's calls put health
information into Sofía's transcripts, summaries and proposals, which BIS stores and sends
to its AI provider. Selling Sofía to clinics is therefore part of the HIPAA decision, not
separate from it (§12, decision 5).

---

## 2. Where BIS stands today

### 2.1 What is already strong

- **A bilingual voice receptionist**, live on a real client: books, reschedules and
  cancels, captures leads, takes messages, screens spam, hands off to a human, and labels
  each call by the language the caller actually spoke.
- **Call proposals**: after a call, AI suggests a task, a contact-field correction or a
  pipeline move with the evidence quoted, and a person accepts or dismisses it.
- **A web concierge**: a bilingual text assistant every client can put on its website as
  one script tag; it files leads through a chosen form and does not book.
- **An automation engine** with one log, one quiet-hours rule per account, visible usage,
  and recipes for reminders, confirmations with YES/NO replies, follow-ups, review
  requests, referral asks, no-show nudges, reactivation, quote follow-ups and a bilingual
  instant reply.
- **A weekly report** that states deltas in words and still sends in a quiet week; a work
  queue; spam screening; missed-call text-back; forms with embeds; CSV import and export
  with dedupe; per-client sending domains and branding.
- **Client billing (M7a)** under construction: plans and the Stripe catalogue sync have
  shipped; usage recording, then checkout with webhooks and the Billing page, then the
  non-payment pause are still in flight.
- **Discipline**: row-level security on every tenant table with isolation tests, 360 test
  files and 32 end-to-end specs, and a separate CI database that local and CI runs use
  instead of production.

### 2.2 The gaps

| Area | BIS today | What the market does | Severity |
|---|---|---|---|
| **Staff and roles** | Two tiers only: agency admin and client user; every client user is invited as an org admin; `users` and `memberships` are unpopulated and "assignment is dead" | Users, teams, roles, record and field permissions | **Blocking** for calendars and child care |
| **Client record** | Contact row; `company_name` is free text; notes and deals must attach to one contact; `events` records only the names of changed fields | Companies, households, properties, typed relationships, field history | **Blocking** for every vertical |
| **Documents** | None: no table, no storage bucket; forms accept no files or signatures | Files on every record, templates, e-signature, expiry, portals | **Blocking** — the owner's first ask |
| **Consent** | Per-submission form consent; Telnyx handles STOP by design; a marketing-email opt-out | A per-channel consent and revocation ledger | **Blocking** before 31 January 2027 |
| **Bilingual** | Bilingual: Sofía's voice, the booking page and its own confirmation email, form buttons and system text, the concierge, missed-call text, lead receipt, instant reply, opt-out line. English-only: eight automated-message modules; the booking reminder and follow-up emails; **the confirmation and reschedule emails Sofía sends after booking by phone** (and their cancel links open an English page); subjects and buttons hard-coded in several email templates; every operator-written recipe body except the instant reply's; each form's labels and success text (one operator-written string per field); and the dashboard. Contacts have no language field | Spanish customer surfaces are standard among local and vertical competitors | High |
| **Custom fields** | 5 types, on contacts and deals only | 15–30 types, relation fields, on any object | High |
| **Email** | Sent via Resend. With neither a reply-to nor a client sending domain set, replies land in BIS's own mailbox; otherwise in the client's. Neither is ever recorded, so an emailed "stop" goes unheard | Two-way sync or logging (HubSpot, monday, Less Annoying CRM, Copper) | High |
| **Calendar** | One calendar per company, enforced by a unique constraint; Sofía's tools and the booking code assume it | Per-user calendars, two-way Google/Outlook sync, Meet and Teams links | High |
| **Meetings** | Video rooms via Daily.co are built but dormant (no API key in any environment); the meeting-notes work is blocked on "do meetings happen inside this product?" | Notetakers and Meet/Teams transcript sync | Decision needed |
| **Money to customers** | None (M7a bills BIS's clients, not their customers) | Quotes, invoices, payment links, deposits, recurring billing | High for trades, catering, child care |
| **AI on the record** | Calls only: summaries and proposals | Record summaries, drafting, ask-your-CRM, document reading, notetakers | Medium — BIS's call AI is ahead; the rest is behind |
| **Client portal** | None; public booking cancel links, form tokens and web-voice sessions are the only token-scoped public surfaces | Portals with a public/private divider, uploads, payments | Medium |
| **Mobile** | Responsive web; no installable app | Native apps; offline modes; Tap to Pay needs native | Decision needed |
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
   HubSpot charges Professional prices for association labels; BIS should include them.
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
| `client_groups` | A household, a business customer, a care facility, a referral source | `kind` (`household` / `business` / `facility` / `referrer`), `name`, billing address, `custom`. UI labels are per reader language: *Household* / *Familia*, *Business customer* / *Cliente comercial* — never "Company", which already names the tenant |
| `client_group_members` | A contact's place in a group | `client_group_id`, `contact_id`, `role` label, `is_primary`, `is_billing` |
| `contact_relationships` | Person-to-person roles, rendered on both records | `contact_id`, `related_contact_id`, `label` (parent, guardian, child, spouse, emergency contact, authorised pickup, responsible party, caregiver, tenant, landlord, referred by), flags `can_pick_up`, `is_emergency` — and, **only once roles are enforced**, the restricted flags `has_custody` and `no_contact` |
| `service_locations` | Where the work happens: a property, a unit, a venue | one of `client_group_id` / `contact_id`; address; access notes; a gate code only once roles are enforced |
| `equipment` | What is installed or served there | `service_location_id`, type, make, model, serial, installed on, warranty until, `status` (`installed` / `replaced`) — replaced units kept as history, as in ServiceTitan |
| `documents` | Any file on any record | one of `contact_id` / `client_group_id` / `opportunity_id` / `service_location_id`; `category`; `expires_on`; `retention_class`; `client_visible`; `uploaded_by_kind` (`staff` / `client` / `system`); `source` (`upload` / `email` / `mms` / `form` / `e_sign` / `drive_link` / `onedrive_link` / `template`); `scan_status`; `extracted` jsonb; `sensitivity` (`normal` / `restricted` / `health` / `phi`); `legal_hold`; `deleted_at` |
| `document_versions` | Every version, current one flagged | `document_id`, `storage_path`, `bytes`, `sha256`, `uploaded_by`, `created_at` |
| `document_access_log` | Who opened, downloaded or shared what, append-only | `document_id`, `actor`, `action`, `at` |
| `document_requests` | "We still need the immunisation record" | `contact_id`, `category`, `due_on`, `status`, a single-use upload token |
| `document_destruction_log` | What was purged under which retention rule | `document_id`, `retention_class`, `destroyed_at`, `destroyed_by` |
| `consent_events` | The consent and revocation ledger, append-only | `contact_id`, **`address`** (the phone number or email itself — consent belongs to the address, not only the person), `channel`, `purpose` (`transactional` / `marketing`), `action` (`granted` / `revoked`), `source` (form, staff, import, **Telnyx opt-out sync**, email reply), `evidence`, `at` |
| `record_changes` | Field history with before and after values, append-only | table, record id, field, old value, new value, actor, at. Today's `events` records only which fields changed |

Around the tables:

- **Custom fields grow from 5 types to 13**: add multi-select, phone, email, URL,
  currency, long text, file, and **relation** (a field that points at another record).
  Widen `custom_fields.model` beyond `contact` and `opportunity` — which also changes the
  blueprint bundle's `customFields.model`.
- **Notes, tasks and deals attach to any record** by the same one-FK-per-kind rule. That
  relaxes `notes.contact_id` and `opportunities.contact_id` from NOT NULL; `opportunities`
  is read in about 25 files, including the quote follow-up recipe, so it is real work.
- **Conversations stay one per contact**, with a household view that merges the members'
  threads.
- **`company_name` moves into `client_groups`**: a backfill (one `business` group per
  distinct name per account), a dual-write period, and changes to the twelve places that
  read it — cursor paging, CSV import and export, the forms `core.company_name` mapping,
  the drawer and the table. **Suggested groups** — contacts sharing an email domain, a
  phone number, a surname and address — arrive as proposals to accept, not automatic
  merges (monday groups by domain; BIS can do better).
- **A merge that keeps everything.** BIS flags duplicates but cannot merge them. A merge
  must carry documents, conversations, consent and history across; monday's drops files
  and email.
- **A trash.** Deleted records and documents sit in a 30-day trash before they are gone,
  alongside the undo toasts DESIGN.md rule 6 already requires.
- **Custom objects are rejected for now.** Attio and Twenty let owners define their own;
  fixed tables plus industry packs are faster to build, easier to secure under RLS and
  simpler for an owner to understand. Revisit if a pack needs an object none of these
  tables fits.

### 3.3 The record page

DESIGN.md sets the pattern: **a list click opens a right-side drawer; a deep link opens the
full page.** Keep both. The drawer shows the summary, key facts and the next three things
due. The full page uses three columns on a wide screen, stacked on a phone:

- **Left — who they are.** Name, phones, emails, language, tags, key custom fields, and
  **Relationships** as role chips ("Madre de Sofía R.", "Autorizada para recoger").
- **Centre — what is happening.** The AI summary, then the unified timeline: calls with
  summaries, texts, emails, notes, form submissions, bookings, documents, payments, and
  **industry activity types** from the pack (service call, inspection, tasting, incident
  report, parent conference). Activity on a household or an open deal rolls up here.
- **Right — what they have.** **Documents** (with "expiring" and "missing" badges and the
  completeness count), **Money** (open quotes, unpaid invoices, balance), **Appointments**,
  **Deals** with time in stage, **Properties and equipment**, **Groups**.

On the contact list: a **last contact** column and a "no contact in 30 days" filter
(monday's recency cue). On the pipeline board: **time in stage** (`stage_changed_at`
already exists) and one-click reopen. New areas are registered in the command palette, as
DESIGN.md requires. Like every screen, the record page must pass DESIGN.md's definition
of done: tokens only, both themes, designed empty states ("Documents you add or clients
upload appear here — Add a document"), status never by colour alone.

### 3.4 The document vault

- **Storage.** A private Supabase Storage bucket, keys shaped
  `{account_id}/{kind}/{record_id}/{uuid}`, RLS on `storage.objects` keyed on the tenant
  claim, signed URLs of 60–300 seconds, resumable uploads above 6 MB. Production runs in
  Supabase's paid organisation; confirm whether that is Pro or Team. Pro includes 100 GB,
  then $0.0213 per GB-month.
- **Quotas.** Storage per business by plan (§10); 100 MB per file from staff; 25 MB per
  file and 20 files a day per client upload link; a content-type allowlist (PDF, images,
  Office documents). The caps exist to stop abuse, not to save storage: 25 GB costs about
  53 cents a month.
- **Scanning.** Supabase has none. Upload to a quarantine prefix; a small ClamAV worker
  scans and promotes or deletes. ClamAV runs as a separate process, so its GPL licence does
  not reach BIS's code, but it is **new always-on infrastructure** outside Vercel and needs
  an owner and monitoring.
- **What the owner sees.** Preview in the app, versions, rename, "remove from this record"
  versus "delete", a filter by source, a zip download of a record's files, and a **share
  link that expires in 24 hours** instead of a permanent public URL — HubSpot's default is a
  public CDN link, which is wrong for a child's file. **View tracking** tells the owner when a
  parent opened the enrolment packet or a customer opened a quote. An **account-wide
  Documents view** answers "every certificate expiring this month" without opening records.
- **Completeness and stage rules.** An industry pack declares categories and which are
  required — a Texas child's file lists enrolment agreement, admission information, health
  statement, immunisations and more under §746.603. The record shows "7 of 9" with the
  missing items named. A job cannot move to *Done* without photos and an invoice; a child
  cannot move to *Enrolled* without immunisations and emergency contacts. The completeness
  meter also counts required **fields**, not only documents (HubSpot's completeness score).
- **Expiry.** A new automation pass sends "expiring in 30 days" reminders under the
  existing quiet hours and log. The same machinery gives **generic date triggers** ("date
  arrives", "N days after") and **repeating tasks** such as an annual backflow test.
- **Forms that collect documents.** Today a form field can be a core contact field, a
  custom field, a message or a consent box. Add **file upload, signature, conditional
  logic and URL pre-fill**, so an enrolment packet or a service request with photos can be
  filled online (monday's WorkForms). The same field kinds become **custom questions on
  the booking page** ("¿Qué necesita reparar?"). A signature field uses the e-signature
  machinery of §8.1, so it ships after that, not before.
- **Every public link follows one rule.** Share links, client upload links, public forms
  with uploads and staff calendar-connect links all bypass Clerk, as the portal does. Each
  uses §8.2's pattern: a scoped, expiring, signed token bound to one account and one
  record, an explicit tenant check on every query, and its own isolation tests.
- **Retention.** A class per category, longest applicable clock wins, legal holds, and a
  destruction log. Texas child-care periods are floors, so the default is keep, not purge.
- **Teardown.** Storage objects do not cascade when an account is deleted. The account
  teardown and the test-fixture sweep both need to delete the account's prefix.
- **The vault is the system of record; Drive and OneDrive are links.** Pipedrive keeps
  document templates in the owner's own Drive. BIS should not: expiry, retention, access
  logs and required-document rules only work on files BIS holds. Linked Drive and OneDrive
  files appear as references beside them.
- **Document templates with live fields.** Enrolment agreements, service contracts and
  catering event sheets fill themselves from the record and render to PDF (monday docs'
  `{field}` merge, Pipedrive Smart Docs), then go to e-signature (§8).

---

## 4. Bilingual, end to end

The pricing study found four of six local competitors already claim Spanish, so bilingual
is table stakes in the Valley. BIS's defensible claim is being bilingual **everywhere**.

1. **A language on every contact** (`contacts.preferred_language`) and on every booking
   (`bookings.locale`, already the recorded follow-up in the booking email code). Set it
   from the call's detected language, the form's locale and staff edits.
2. **Every automated message in both languages**, chosen per contact:
   - the eight English-only copy modules — review request, no-show nudge, referral ask,
     reactivation, quote follow-up, appointment confirmation, SMS reminder, marketing
     footer;
   - the booking reminder and follow-up emails, and the subjects and buttons hard-coded in
     the review-request and no-show email templates;
   - **the confirmation and reschedule emails Sofía sends after a phone booking**, in the
     language the call was detected in, with a cancel link that opens the cancel page in
     that language;
   - **Spanish twins for form labels, help text and success messages**, so one form
     serves both languages instead of one form per language;
   - **a Spanish twin for every operator-written body**, following the precedent the
     instant reply already sets with `bodyEs` (the follow-up body on the calendar
     included).

   This is the highest-value piece — it is what a Spanish-speaking customer actually
   receives.
3. **The Spanish dashboard.** The catalogue is already one file of about 1,250 strings,
   which makes the plumbing cheap; the cost is translation review against DESIGN.md's
   "landscaper at 7 AM" test in Spanish, and a language setting per user from the staff
   model.
4. **AI output in the reader's language**: summaries in the staff member's language, drafts
   in the customer's.

The pricing study's census figure — 29.2% of Hidalgo County's population aged five and
over speaks English less than "very well" — describes the population, not business owners;
it argues most strongly for items 1 and 2.

---

## 5. AI in the CRM

### 5.1 What to add, in order

Small businesses use AI mostly for writing, research and summaries; autonomous agents are
early; 14% of CRM users with AI never use it and 8% do not know it is there (Appendix C).
So AI should be **visible on screens the owner already opens, and useful without
configuration**.

1. **Generalise proposals.** `call_proposals` requires a call and allows three kinds; its
   grounding checks evidence against the call transcript. Turn it into a source-typed
   `proposals` table (call, message, document, notetaker, MCP, suggested group) with
   grounding per source. Everything below that writes to the CRM goes through it.
2. **Record summary and prep**, in the reader's language, from the rows the existing
   non-AI summary route already gathers. Cache per record, regenerate when a new timeline
   event arrives, and cap generations per account per day.
3. **Proposals from email, texts and documents.** "The customer's email gives a new
   address, 402 Nolana — update it?" Pipedrive's version draws only on meeting transcripts;
   BIS can cover every channel it records.
4. **Document intake.** A photo or PDF becomes proposed field values shown beside current
   ones: business cards, insurance cards, contractor licences, paper intake forms. Appendix
   D estimates model cost at up to about a cent per document (its own estimate). Health
   documents wait on decision 6 (§12).
5. **Drafting in the customer's language**, with one-tap translation of the customer's
   message for staff who read only one of the two.
6. **"Gone quiet" nudges.** folk flags stalled conversations and drafts the follow-up;
   BIS's work queue is the natural home.
7. **An in-person notetaker.** HubSpot's and monday's turn a tour or a job-site
   walk-through into a summary and proposed updates. For BIS it is call proposals with a
   phone microphone instead of a phone line. It is independent of the video-meeting
   decision.
8. **Ask BIS**, answered from a fixed set of read-only query functions running under the
   tenant's RLS — not free-form text-to-SQL. "¿Quién no ha pagado este mes?", "Which
   properties have water heaters older than ten years?" Also answerable **by text message**
   to the owner's verified alert phone, the way monday's assistant works over WhatsApp —
   with two limits: answers never include sensitive categories (a link to the app instead),
   and the texts must fall within the account's registered 10DLC campaign use case.
9. **AI fields** (HubSpot's "smart properties", later): a per-record question such as
   "likely repair or replace?", answered by AI and written only through a proposal.
10. **AI review replies**, the half of M5 still owed.

A knowledge base for Sofía — the pgvector piece M4 still owes — is a prerequisite for a
receptionist trained on a daycare's handbook and one that answers menu questions.

### 5.2 Three design rules

- **A person approves every write.** It is what BIS already does for calls and the safest
  answer for an MCP server. Pipedrive's survey of 1,000 sales and marketing professionals
  put it as "a thinking partner, not an autopilot" (reported secondhand).
- **Bilingual by default.** Every generated sentence follows the reader's language.
- **Bundle the cost; do not sell credits.** HubSpot and monday sell credits at $0.01 each
  and spend 8 to 10 of them per AI action, so every action costs $0.08–$0.10 and owners
  cannot predict the bill. M7a will meter voice minutes, SMS and web-chat conversations
  once its remaining steps land; summaries and drafting should ride inside the plan with
  per-account caps, as the platform spec's usage-cap guardrail already requires.

### 5.3 What not to do yet

Outbound agents that call or email leads on their own (Close's Chloe, monday's AI Sales
Agent) are early in adoption and a reputational risk for a local business whose name is on
every call. BIS's inbound receptionist is the right half of that idea to own first.

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
| Contacts sync | `contacts` | sensitive | `Contacts.Read` / `Contacts.ReadWrite` | Read yes; write admin |
| Attach a Drive or OneDrive file, import a Sheet | `drive.file` + Picker | non-sensitive | `Files.Read` | **Yes** |
| Google Business Profile reviews | `business.manage` | check in console; separate API approval | — | — |
| **Read the inbox** | `gmail.readonly`, `gmail.metadata` | **restricted** | `Mail.Read` | Google: **paid CASA assessment**. Microsoft: admin approval only |
| Browse all of Drive / SharePoint | `drive`, `drive.readonly` | restricted | `Files.Read.All`, `Sites.Read.All` | Google: CASA. Microsoft: admin |

- **Google's sensitive scopes need one verification review, no fee**: a privacy policy, a
  demo video showing each scope in use, and a justification per scope; typically 3–5
  business days, realistically 1–3 weeks. Adding a scope later triggers a new review
  (reported at 2–4 weeks).
- **Google's restricted scopes need a CASA security assessment by an approved lab every
  year**, reported at roughly $540–$4,500+ and weeks to months (the cost is secondhand).
- **Microsoft blocks users, not apps.** New tenants default to a policy that stops ordinary
  users granting `Calendars.*`, `Mail.Read`, `Contacts.ReadWrite`, `OnlineMeetings.*`,
  `Tasks.*`, `Files.Read.All` and `Sites.Read.All`. `Mail.Send` and `Files.Read` stay
  consentable. Outlook calendar sync therefore needs the business's Microsoft 365 admin to
  approve once — at a five-person business usually the owner — so onboarding needs an
  "approve for your company" link. Publisher verification is free and takes days.
- **The asymmetry that matters:** a direct Outlook inbox sync needs only admin approval
  (Appendix D: 3–4 weeks). A Gmail inbox sync needs CASA, or a vendor that holds the
  assessment — Nylas's shared app, whose price for that route is unpublished and which
  puts "Nylas" on the consent screen.

### 6.2 The sequence

1. **Now, no gate — email that comes back.**
   - **Where it lives.** When a client has its own sending domain (M4d), the inbound
     address sits on a subdomain of it (for example `reply.<client-domain>`, with MX
     records added in the same DNS step as the sending domain), so white-labelling holds.
     Only clients without a domain use a BIS subdomain. The account's `reply_to_email`
     becomes the forwarding destination rather than the Reply-To.
   - **Per record.** Each record also gets an address with an **opaque token**, never the
     customer's name, so a doctor's note or a customer's photo can be forwarded straight
     onto the right child or job (monday's email-to-item).
   - **Who may file.** Mail is filed automatically only when it comes from an address
     already on the record or its household and passes SPF, DKIM and DMARC. Everything
     else goes to a review queue — monday's own help centre warns that anyone holding such
     an address can post to it.
   - **Forwarding to the owner** rewrites the envelope so DMARC does not fail.
   - **Matching.** Household mail matches on any member's address; a thread keeps
     following when its recipients change (monday's rule); **never-log lists** exclude
     vendor and personal addresses (HubSpot's default "log everything" rule).
   - The `messages` table already allows inbound email rows, and an emailed "stop" becomes
     audible for the first time.
   - **This captures replies and forwards, not everything.** Mail a customer writes
     straight to the owner's own Gmail or Outlook reaches BIS only with inbox sync (step 7).
   - **The web concierge's conversations join the inbox in the same change.**
     `messages.channel` already allows `webchat`; nothing writes it yet.
2. **Week 1 — publish the Google project and verify the publisher.** Finish Google sign-in
   (already enabled in Clerk, without production credentials) in the same Google Cloud
   project the calendar will use, and publish it: sign-in needs only profile and email
   scopes, so publishing triggers brand verification alone and keeps it from lapsing —
   Google's brand verification expires after 7 days on an unpublished app. Microsoft
   publisher verification in parallel.
3. **Build the Google sensitive-scope features under Testing mode, then submit once.**
   The review's demo video must show each scope working, so build the calendar, send-as-me,
   pickers and contacts sync first under Testing mode (up to 100 test users, refresh tokens
   that expire every 7 days, so pilot users reconnect weekly), then submit one review.
   **Business Profile stays out of that submission**: its API grants no requests until a
   separate approval with no published lead time, so its demo cannot be recorded until
   then; it gets its own review. Apply for Business Profile API access now — it requires a
   verified profile active 60+ days. Sheet import uses the Picker with `drive.file`, so it
   adds no scope.
   **Where a client runs Microsoft 365, ship Outlook first**: publisher verification takes
   days and admin approval is one click, so Outlook can reach real clients while Google is
   still in Testing mode.
4. **The owner's calendar first.** Connect one Google or Outlook calendar to the company
   calendar: busy times block Sofía's slots and the booking page; bookings write events
   with Meet or Teams links; events whose attendees include a known client attach to that
   client's timeline. No per-staff model needed, and most of the value.
5. **Then per-staff calendars**, once the staff model exists. This is more than dropping a
   constraint (`calendars_one_per_account`, from migration 0016, pinned by 0050's schema
   test):
   - `getCalendarForAccount` and `getOrCreateCalendar` select one row per account and are
     called from Sofía's call route (`voice/incoming`) and web-voice session route, the
     setup inputs, the dashboard, the calendar and automations pages, and the demo seed
     (the web concierge deliberately does not call them);
   - Sofía's `check_availability`, `book_appointment`, `reschedule_appointment` and
     `cancel_appointment` tools have no notion of staff;
   - the booking spec anticipated this ("a staff dimension can be added later"), and the
     no-overlap rule is already per calendar, so it survives;
   - staff can connect their own calendars through a tokenised link without a full login,
     which keeps Clerk membership limits and the pricing study's staff-login packaging out
     of the way;
   - **round-robin** assignment that respects who is free today comes with it.
6. **Send-as-me, the Drive and OneDrive pickers, contacts sync** (the user picks the sync
   direction, as in Zoho and Pipedrive) — inside the same Google submission.
7. **On demand only: full inbox sync** — direct for Outlook, through Nylas's shared app
   for Gmail — then a Gmail add-on and an Outlook add-in so the client record appears beside
   the email (Copper's best idea). The Gmail add-on's contextual scopes are sensitive, not
   restricted.

**Do better than both incumbents on calendars:** HubSpot syncs only the first event of a
recurring series and only the primary calendar; monday's board-level Outlook sync needs a
Microsoft 365 Business Premium licence. BIS should sync recurring events properly and need
no particular licence.

### 6.3 The rest of Google and Microsoft 365

| App | Stance | Why |
|---|---|---|
| Google Sheets / Excel | **Adopt** direct `.xlsx` export and Sheets/Excel import, with AI suggesting the column mapping from **headers only** | Owners arrive with spreadsheets. DESIGN.md requires the file to be parsed in the browser and never uploaded; headers alone can go to the model |
| Google sign-in | **Finish** — already enabled in Clerk, without production credentials yet — in the calendar's Google Cloud project | Publishing it early keeps brand verification from lapsing (§6.2 step 2) |
| Microsoft sign-in | **Adopt** through Clerk | How Microsoft 365 owners expect to sign in |
| Google Business Profile | **Adopt** reviews and replies (M5) | We found no HubSpot-built GBP integration; reviews are how local businesses get found |
| Meet and Teams recordings and transcripts | **Later**, after the meetings decision (§12) | HubSpot syncs Teams transcripts since August 2026 |
| Teams notifications | **Later** | Useful for bigger clients, not a five-person shop |
| Microsoft Bookings | **Reject** | BIS's own booking replaces it |
| Microsoft To Do / Google Tasks | **Later**, one-way push | `Tasks.*` is admin-blocked on Microsoft |
| SharePoint | **Reject** for now; OneDrive picker only | `Sites.Read.All` is admin-blocked; small businesses rarely use it |
| Google Forms / Microsoft Forms | **Reject** | BIS forms replace them |
| Google Chat | **Reject** | Little use in this market |

Two gotchas: some Microsoft 365 subscriptions bought through GoDaddy cannot install
Integrated apps or Marketplace add-ins, and personal Outlook.com accounts reportedly get no
Teams links (secondhand).

### 6.4 The MCP server

HubSpot's went GA on 13 April 2026 and works on every tier; Pipedrive's on 30 June; monday,
Attio, Zoho, Close, HoneyBook, GoHighLevel, folk and Twenty all ship one. Clerk supports the
MCP OAuth flow in Next.js directly. BIS's version: **read tools answer immediately; every
write becomes a proposal the owner approves inside BIS**, with its evidence. Attio confirms
writes before making them (reported secondhand); we found no CRM whose AI writes land in an
in-app review queue.

Prove two things in a spike before building. First, that Clerk's MCP access tokens carry
the `org_id` claim every RLS policy reads. Second, that those tokens can never carry
`app_role = agency_admin` — today's RLS deliberately lets an agency admin read every tenant,
so MCP tokens must be scoped to exactly one client organisation.

---

## 7. What HubSpot and monday.com teach

Appendices A and B go through both products line by line — HubSpot's per-tier catalogue
runs to about 850 rows.

### 7.1 Side by side, on the owner's three asks

| | HubSpot | monday CRM | What BIS should do |
|---|---|---|---|
| **One screen per client** | Three-column record: properties left, summary and timeline centre, associations, attachments, Drive and SharePoint cards right. Free plan shows **only the last 30 days** of timeline | A widget grid ("item card") an admin must design per board | HubSpot's layout, pre-built per industry, full history on every plan (§3.3) |
| **Relationships** | Association labels (HubSpot's example: "Billing contact") — **Professional and up** | Connect and mirror columns; accounts grouped by email domain | Typed relationships on every plan, shown on both records (§3.2) |
| **Documents** | Four separate stores (files, attachments, sales documents, file properties) with limits from 20 MB to 2 GB; **files public on a CDN by default**; no expiry tracking | Files column with preview, annotations, zip download; versioning a "trial feature"; 5–1,000 GB by plan | One private vault with categories, expiry, versions and a required-documents checklist (§3.4) |
| **E-signature** | Quotes only, **Revenue Hub Professional**, 25 signatures per user per month, via Dropbox Sign | Unclear by monday's own sources: marketing says "collect signatures", the help centre says countersigned documents cannot yet be stored; DocuSign is Pro+ on the new plan matrix (Standard+ on the old) and needs a DocuSign Business Pro admin | Any everyday document, every plan, with an audit trail (§8) |
| **Client portal** | Support portal shows **tickets only**; billing portal in beta on Revenue Pro | None in the CRM; guests per board | One portal over the same record (§8) |
| **AI** | Breeze: summaries, notetaker, agents billed per outcome ($0.50 per resolved conversation); credits at $0.01, 10 per workflow AI action | Credits at $0.01: 8 per AI action, 120 per notetaker hour; one-time 6,000-credit trial | Summaries and drafting bundled; proposals for every write (§5) |
| **MCP** | `mcp.hubspot.com`, every tier including Free | `mcp.monday.com`, 60+ tools, every plan | Read tools plus proposal-only writes (§6.4) |
| **Google and Microsoft** | Two-way calendar but **first event of a recurring series only**, primary calendar only; Gmail and Outlook logging; Teams app rated 3.2★ | Two-way calendar in the CRM; board-level Outlook needs **M365 Business Premium** | Recurring events and shared calendars handled, no licence requirement (§6) |
| **Price for a four-person shop** | Starter: 4 × $20 = **$80/month** list ($28 on the current new-customer promotion). Sales or Service Pro: $90–100 per seat plus a **$1,500** onboarding fee (Enterprise $150). Marketing Pro $800+/month plus $3,000 onboarding | 3-seat minimum then buckets of 5, so four people pay for five: Basic 5 × $12 = **$60/month**, Pro 5 × $28 = **$140/month** (annual) | Priced per business, as in the pricing study (§10) |
| **Spanish** | UI in 15 languages, full support in 6, AI brand voice in 5 beyond English | UI in 14 languages; quotes change number formats but are not translated | Spanish throughout the UI, messages, documents, AI and Sofía (§4) |

### 7.2 Every HubSpot and monday.com idea, and what BIS does with it

The owner asked for both products to be combed. Appendix A §G1 and Appendix B §H each rank
25 ideas worth copying plus honourable mentions. Every one has a decision here: **Adopt**
(with where it is designed), **Later** (sound, not yet), **Have** (BIS already does it) or
**Reject** (with the reason).

**HubSpot (Appendix A §G1)**

| # | Idea | Decision | Where |
|---|---|---|---|
| 1 | Log everything automatically; never-log lists; calendar events with known contacts on the timeline | Adopt in part: replies, forwards, never-log lists and calendar events now; mail written straight to the owner's own inbox only with inbox sync (§12 decision 13) | §6.2 steps 1, 4, 7 |
| 2 | Three-column record page | Adopt | §3.3 |
| 3 | Association labels, free | Adopt | §3.2 |
| 4 | Activity rolls up to the household and to open deals | Adopt | §3.3 |
| 5 | Industry objects by toggle; AI builds the data model from a description of the business | Adopt as industry packs; "describe your business" picks a pack and proposes its pipeline and fields | §9 introduction |
| 6 | Typed file fields with expiry | Adopt | §3.2 file field type, §3.4 |
| 7 | Attachments card: source filter, preview, detach vs delete, 24-hour share link | Adopt | §3.4 |
| 8 | Private files by default | Adopt | §3.4 |
| 9 | Document view tracking and "notify me when opened" | Adopt. Email-gated content: **Reject** — marketing downloads are not this market's need | §3.4 |
| 10 | Free invoices, payment links, stored cards, ACH, subscriptions with retries, automated invoice reminders | Adopt | §8.1 |
| 11 | Quote → accept → pay on one page; e-signature on any document | Adopt | §8.1 |
| 12 | Booking pages with round-robin, custom questions, several reminders, payment at booking | Have two reminders (an email about a day before, a text about two hours before). Adopt: custom questions with the form upgrade; round-robin with per-staff calendars; deposits after money | §3.4, §6.2 step 5, §8.1 |
| 13 | Two-way calendar sync; tasks pushed to the calendar | Adopt calendar; task push Later | §6.2, §6.3 |
| 14 | One inbox for email, chat, Messenger, WhatsApp, SMS; assignment and routing | Have SMS and email. Adopt: web-chat conversations in the inbox, and assignment to staff (`conversations.assigned_to` exists, unused). WhatsApp Later (§12 decision 11); Messenger and Instagram Later | §6.2 step 1, §1 item 1 |
| 15 | Customer Agent priced per outcome; payment links sent in chat | Adopt payment links from Sofía and the concierge after money. Outcome pricing: Reject — M7a meters voice minutes and chats, which owners can predict | §8.1, §10 |
| 16 | Voice AI on the phone line | Have — Sofía | §2.1 |
| 17 | Caller ID matched to the CRM; logging staff calls from their own phones | Later — a masked business number for staff (also monday #15) | §7.2 |
| 18 | Mobile and in-person notetaker | Adopt | §5.1 item 7 |
| 19 | Record summary; plain-language questions; MCP connectors | Adopt | §5.1, §6.4 |
| 20 | Smart properties | Later, as AI fields written through proposals | §5.1 item 9 |
| 21 | Workflows on every tier; template library; agentic workflows | Have catalogue recipes; packs are the templates. Rule builder: Later, per the platform spec, until clients' needs diverge — the first pack is the test (§12 decision 12) | §9, §12 |
| 22 | NPS and CSAT surveys, paired with review requests | Have review requests. Adopt later: a one-question post-job text | §7.2 |
| 23 | Self-service portal with billing | Adopt; no tickets | §8.2 |
| 24 | Data-quality scans; completeness score | Have duplicate flags. Adopt a per-record completeness meter over required fields and documents | §3.4 |
| 25 | Sensitive-data mode at small-business prices | Adopt restricted fields behind roles and the `sensitivity` column; HIPAA separately | §3.2, §9.4 |
| HM | Rule-coloured tags | Later | — |
| HM | Board or calendar view on any object | Have the pipeline board. Adopt a schedule view of jobs and visits in home services part two | §9.1 |
| HM | Task queues and repeating tasks | Have the work queue. Adopt repeating tasks | §3.4 |
| HM | Recycle bin | Adopt a 30-day trash | §3.2 |
| HM | Free view-only seats | Packaging decision | §10 |
| HM | Multi-currency | Later — pesos matter for cross-border customers; M7a is USD-only | — |
| HM | Scheduled AI prompts ("every Monday: families with overdue balances") | Later, as a section of the weekly report | — |
| HM | Password-protected share links | Reject — expiring links cover it | §3.4 |
| HM | Spanish UI and support | Adopt: the Spanish dashboard, and bilingual support as a local service | §4 item 3 |
| HM | Google Drive and SharePoint cards on the record | Adopt Drive and OneDrive links on the record; SharePoint Reject | §3.4, §6.2 step 6, §6.3 |

**monday.com (Appendix B §H)**

| # | Idea | Decision | Where |
|---|---|---|---|
| 1 | One record page from widgets, opinionated per industry | Adopt — packs choose the cards | §3.3 |
| 2 | Timeline with custom activity types | Adopt | §3.3 |
| 3 | Auto-log email by any address on the record or linked records; keep following a thread | Adopt in part: replies and forwards now; mail sent straight to the owner's inbox only with inbox sync | §6.2 steps 1, 7 |
| 4 | One-click AI timeline summary, free | Adopt | §5.1 item 2 |
| 5 | Household or company grouping by domain, phone, last name, address | Adopt as suggested groups through proposals | §3.2 |
| 6 | File preview, annotations, versions, zip download | Adopt preview, versions, zip. Annotations Later | §3.4 |
| 7 | A files gallery across all clients | Adopt the account-wide Documents view | §3.4 |
| 8 | Doc templates with live record fields | Adopt | §3.4 |
| 9 | Intake forms with file upload, signature, conditional logic, URL pre-fill, translation | Adopt file upload, signature, logic and pre-fill. Translation: Adopt English–Spanish twins for labels and messages; Reject monday's 50 languages, which this market does not need | §3.4, §4 item 2 |
| 10 | Email-to-record address | Adopt, with sender verification | §6.2 step 1 |
| 11 | Quotes and invoices from a catalogue, with PDF | Adopt, with real payments and e-signature | §8.1 |
| 12 | Deal value built from line items | Adopt | §8.1 |
| 13 | Round-robin that respects who is available | Adopt with per-staff calendars | §6.2 step 5 |
| 14 | Sequences with call-task steps that stop when the customer replies | Later — possible once inbound email lands; the quote follow-up recipe covers the common case | — |
| 15 | A business number for staff, calls recorded and logged | Later (with HubSpot #17) | — |
| 16 | One-tap mobile notetaker | Adopt | §5.1 item 7 |
| 17 | "Last contact" recency on the list | Adopt | §3.3 |
| 18 | Time in stage; one-click reopen | Adopt | §3.3 |
| 19 | Import with a duplicate policy; a merge that keeps history | Have the import policy. Adopt the merge | §3.2 |
| 20 | Required fields and validation on stage changes | Adopt, on every plan | §3.4 |
| 21 | Date-based reminders: date arrives, after N days, recurring | Adopt generic date triggers | §3.4 |
| 22 | Calendar events auto-attach to the client when they attend | Adopt | §6.2 step 4 |
| 23 | Map view of addresses | Adopt in home services part two | §9.1 |
| 24 | An AI column that reads a document or photo into fields | Adopt as document intake | §5.1 item 4 |
| 25 | An owner's assistant over WhatsApp; scheduled PDF dashboards | Adopt Ask BIS by text message; WhatsApp Later. Scheduled PDFs: Reject — the weekly report already arrives by email | §5.1 item 8 |
| HM | Offline mode | Part of the mobile decision | §12 decision 10 |
| HM | A per-record audit log with before and after values | Adopt | §3.2 `record_changes` |
| HM | Trash plus undo | Adopt the trash; undo toasts already required by DESIGN.md | §3.2 |
| HM | A read-only public link to a record or document | Adopt as the expiring share link | §3.4 |
| HM | Guest access per client as a mini-portal, without seat charges | Adopt as the portal | §8.2 |

### 7.3 Where both leave room for BIS

- **Regulated data is priced out of reach.** HubSpot allows children's and health data only
  under Enterprise Sensitive Data; monday's HIPAA support is Ultimate-only. A compliant
  child-care file at small-business prices is open ground against these two — though not
  against the child-care software that already holds that file (§9.2).
- **Both treat Spanish as a UI translation.** HubSpot's full support covers six languages
  and its AI brand voice five beyond English; monday's quotes are not translated. Neither
  sends a Spanish-speaking customer their reminders in Spanish by default.
- **Both charge per seat and gate the basics.** HubSpot's list prices jump from $20 a seat
  to $800 a month plus onboarding; monday's four-person shop pays for five.
- **Neither is built for service operations.** No property or equipment history, no
  enrolment waitlist, no incident workflow, and no HubSpot-built Google Business Profile
  integration. That is what the industry packs add.

---

## 8. Money and the client portal

### 8.1 Money

BIS bills its own clients (M7a) but gives them no way to bill their customers. The platform
spec recorded payments, invoicing, documents and e-signature as **not adopted, by
decision** — so this section reverses a recorded decision (§12, decision 1).

- **Tables:** `catalog_items` (the price book), `quotes` with `quote_options` (good, better,
  best) and `quote_lines` (deal value comes from the lines), `invoices` and `invoice_lines`,
  `payments`, `payment_schedules` (deposits and instalments), `recurring_plans` (service
  agreements, tuition, maintenance), and for e-signature `signature_requests` and an
  append-only `signature_events`.
- **Stripe Connect with Stripe setting the fees**: each business its own merchant of record,
  direct charges, embedded onboarding, no platform fee to BIS unless BIS chooses one
  (§10). Two conflicts to design around: it shares the Stripe account and the engineer with
  M7a's remaining steps, so it comes after them; and the M7 roadmap already reserves Stripe
  Connect for sub-project #3, multi-agency white-label billing. Businesses taking customer
  payments and agencies reselling BIS cannot both be connected accounts of one platform
  without a deliberate design (§12, decision 3).
- **Payment links from Sofía and the concierge.** "I can text you a link for the $75
  deposit" — the receptionist and the website assistant send a payment link on the call or
  in the chat, as HubSpot's Customer Agent does.
- **What each industry needs:** tips and card-on-file for trades; deposits for catering;
  **ACH** (0.8% capped at $5, which matters for tuition), autopay, retries of failed
  payments, automated invoice reminders, sibling and multi-payer splits, a separate line
  for the parent's share of cost under the TWC child care scholarship, late fees and
  year-end statements for child care.
- **In-house e-signature for everyday single-signer documents**, meeting the ESIGN Act and
  Texas UETA: an explicit Sign action with the adoption statement shown, a versioned consent
  to do business electronically, a SHA-256 hash binding the signature to the exact PDF, a
  one-time code to the signer, an append-only audit trail, the signed PDF with a certificate
  page. Appendix D estimates 3–5 weeks. For multi-party signing or anything with health
  information, embed a BAA-capable vendor (BoldSign or SignWell, $0.20–$0.85 an envelope).
- **QuickBooks Online as a push-only sync target** (customers, invoices, payments): writes are
  free and unlimited on Intuit's Builder tier; reads are metered.

### 8.2 The client portal

Built once the vault and money exist, as a **view of the same record** filtered by
`client_visible`:

- **Home is "what you owe us and what we need from you"** — open invoices, unsigned documents,
  requested uploads (Dubsado's model).
- **Upload, sign, pay, book** without calling; **prepaid packages and sessions left** for
  salons, tutoring and trainers (Thryv).
- **The business's own logo and brand colour**, per DESIGN.md rule 9, like every
  client-customer surface.
- **Bilingual, on a phone, with no password**: a magic link by text or email.
- **Outside RLS, so it needs its own design.** A magic-link visitor holds no Clerk JWT, so
  the policies that isolate tenants elsewhere do not apply, and server code on the service
  key bypasses RLS. BIS already has three precedents to extend — booking cancel tokens, form
  render tokens and the web-voice session table: scoped, expiring, signed tokens bound to
  one account and one contact, an explicit tenant check on every query, and their own
  isolation tests.

---

## 9. Industry packs

Each pack extends blueprints, which today stamp pipelines, stages, custom fields, custom
values, tags and forms. Packs also need **automations, a Sofía voice profile, document
categories and required-document lists, relationship labels and activity types**.
Appendix E has the full ten-must-have and five-do-not-build lists per vertical, with Texas
citations.

**Onboarding picks the pack.** The owner describes the business in a sentence — "somos
una guardería con 60 niños en Weslaco" — and BIS proposes the matching pack, its pipeline
stages and its fields for the owner to accept or adjust (HubSpot's AI data-model
recommender, Capsule's pipeline generator). It is a proposal like any other, so nothing is
created without approval.

### 9.1 Home services (plumbers, HVAC, electricians, roofers, landscapers) — first

The product is already shaped for trades: the automation engine's quote follow-ups,
completed-job referral ladder and seasonality reasoning are written around plumbing, roofing
and landscaping. The pricing study warns the category is entrenched — Jobber and Housecall
Pro now bundle AI answering, Jobber at $29 a month for 30 conversations — so BIS competes on
Spanish, the bundle and local service, not price.

- **Part one, on the record and the vault:** customer → properties → equipment with
  warranties and replaced-unit history; industry activity types; TDLR and TSBPE licence
  numbers and required disclosures; an EPA lead-safe (RRP) records set with three-year
  retention for pre-1978 homes; required job photos before *Done*.
- **Part two, on money and staff:** request → quote with good/better/best options →
  e-signed approval → visit → invoice → payment link; service agreements that create visits
  and bill on schedule; a price book; "on my way" texts; a light schedule board and a
  technician phone view (photos, checklists, notes); a map view; a tax class per line
  (residential repair versus taxable real-property service).
- **Do not build:** route optimisation and GPS, truck inventory, payroll, financing
  underwriting, job costing beyond the basics, full dispatch for 10-plus-technician shops
  (sync with ServiceTitan or Housecall Pro instead).

### 9.2 Child day care — second, as the front office

HubSpot and monday price compliant children's data out of reach, but the real incumbents are
child-care management systems — brightwheel, Procare and Playground already hold the child
file, and Playground's Camber already answers calls, is trained on handbooks and licensing
rules, and logs inquiries. Playground's parent app is available in Spanish; whether Camber
answers in Spanish is unverified. brightwheel has announced its own CRM. So BIS
should not try to replace a center's system; it should be the **front office beside it**:

- **What BIS holds:** the enrolment pipeline (inquiry → tour booked by Sofía → waitlist by
  room, age and start date → registration packet e-signed → enrolled); the household graph
  with guardians, emergency contacts, people the child may be released to, allergies and an
  allergy plan (§746.605); **pickup identity capture** for unfamiliar pickups, kept at least
  three months (§746.4101, §746.4103); the documents BIS collects, with the
  required-documents checklist and immunisation expiry; **incident reports with a 48-hour
  parent signature and a two-day Licensing-notice reminder**; bilingual broadcasts and
  one-to-one family messages with **media-consent flags gating any photo**; CACFP records
  kept three years after the final claim.
- **What stays in the center's system:** daily arrival and departure, medication
  administration, ratios, daily reports, naps and meals — and so the parts of the §746.603
  file that come from them. BIS's **inspection packet** combines the documents BIS holds with
  an export from that system; it cannot be complete on its own.
- **Money:** tuition billing through BIS only for centers without such a system; otherwise
  sync with its billing.
- **Who it suits best:** smaller centers without a management system, and centers where a
  Spanish-first phone line and family communication are the gap.
- **Permissions:** teacher, director and non-custodial parent differ at field level — part of
  the staff and roles foundation, not an add-on.
- **Also:** read access on a phone when the network is down (records must be immediately
  accessible to caregivers in an emergency — part of the mobile decision), and a
  handbook-trained receptionist once Sofía has a knowledge base.
- **Do not build:** classroom operations, curriculum, CACFP claiming, staff payroll, and
  subsidy attendance kiosks (those need KinderSystems certification). Integrate with
  brightwheel, Procare or Playground; that integration needs its own research and estimate.

### 9.3 Restaurant catering and events — third, after research

- **Where BIS earns its place:** the catering and private-events pipeline — inquiry form →
  quote or event sheet → e-sign → deposit schedule → final invoice, with the gratuity
  labelling Texas requires — plus bilingual phone answering for hours and catering leads,
  and segmented campaigns (lapsed, VIP, birthday) with the consent ledger behind them.
- **Research first:** guest profiles only make sense synced from the POS (Toast, Square,
  Clover), and reservations from OpenTable, Resy or SevenRooms. None of those APIs and
  partner programmes has been researched.
- **An allergen guardrail is mandatory.** Sofía must never tell a caller a dish is safe for
  an allergy. Allergen questions get the restaurant's exact approved wording or a handoff to
  staff. Allergy and dietary tags are sensitive and never used for marketing.
- **Do not build:** POS, online ordering, table management, loyalty points, gift cards.

### 9.4 Adult day care and medical offices — two modes, one investment decision

This reconciles the pricing study, which called the Valley's appointment-driven healthcare
cluster — about 2,376 establishments — the best ground, and the insights brief, which
recommended a regulated-tenant mode before the next clinic signs. They describe two
different things:

- **A regulated-tenant mode** — cheap, and worth building before any clinic signs: the Texas
  AI-disclosure line in Sofía's greeting (TRAIGA), a recorded disclosure time, health
  document categories switched off, and a listed set of data processors.
- **A HIPAA mode** — expensive. A CRM holding health information for a covered entity is a
  HIPAA business associate, and Texas's broader medical-privacy law reaches further
  (Appendix E; the data-residency rule is reported secondhand). **Resend cannot sign a
  Business Associate Agreement at all**, so no health information may travel in a BIS
  email. Supabase needs its Team plan ($599 a month) plus a HIPAA add-on (about $350,
  secondhand) plus point-in-time recovery and compute. Vercel's BAA is a $350-a-month add-on.
  Clerk signs one only on Enterprise, and may be needed only if patients or families sign in
  through it — the magic-link portal avoids that. Telnyx relies on the conduit exception,
  which does not cover stored transcripts. **Floor: at least $1,300 a month plus recovery and
  compute, possibly a Clerk Enterprise contract**, before the first such customer pays.
- **Where the health data lives is a real choice.** HIPAA settings apply per Supabase
  project, and nothing in Appendix D rules out making the production project itself the
  HIPAA project. The two options cost the same floor:
  - **Harden the one production project** — every tenant inherits the stricter settings,
    no data moves, and the agency roll-up, work queue and dashboards keep working because
    they already assume one database. **Recommended**, unless a lawyer requires isolation.
  - **A separate HIPAA project** — isolation, but it breaks the one-database assumption
    those features rely on, which makes it an architectural project rather than a switch.

  Either way, the `sensitivity` column means no schema change later.

**Recommendation:** build the regulated-tenant mode now. Treat HIPAA mode as a deliberate
investment, decided when one anchor customer — a clinic, or an adult day center billing
Medicaid — will fund most of the floor. Until then, adult day care **front office only** is
possible with a legal check: referrals from service coordinators and families, tours booked
by Sofía, family messaging, private-pay invoicing, with health categories off and a hard
rule that no health information enters BIS. Private-pay centers that never bill
electronically are generally not HIPAA covered entities, but Texas law and a care setting's
practicalities make that a lawyer's call. **Never build** eMAR, EVV (Texas requires a
certified vendor), claim submission or caregiver scheduling.

### 9.5 Others

- **Salons and spas:** prepaid packages and a portal showing sessions left (Thryv's model).
- **Auto repair:** vehicles as equipment; digital inspections with photos.
- **Insurance agencies:** policies as expiring documents, renewal pipelines.
- **Legal practices:** matters as client groups; Clio as the integration.
- **Medical and dental front office:** the largest local opportunity, gated by §9.4.

---

## 10. Packaging and cost to serve

**The owner's own billing decision governs this.** The M7a client-billing spec, approved
section by section on 24 September, supersedes the pricing study's four tiers of 21
September: **two or three plans** at fixed monthly prices, each with included allowances
and overage; **every plan has the CRM, booking, forms and texting; higher plans add Sofía
and the web chat assistant, and bigger allowances**. The new features fit that shape
without strain.

| Feature | Every plan | Higher plans |
|---|---|---|
| Client record, relationships, consent, inbound email, bilingual messages, Spanish dashboard | ✓ | ✓ |
| Document vault, e-signature, document templates | ✓ (smaller storage allowance) | ✓ (larger) |
| AI summary, drafting, proposals, intake, Ask BIS | ✓ | ✓ |
| Money: quotes, invoices, payments | ✓ | ✓ |
| MCP server; industry pack | ✓ | ✓ |
| Staff logins | a small number | more, or unlimited |
| Google and Outlook calendar | the owner's calendar | per-staff calendars and round-robin |
| Client portal | — | ✓ |
| Sofía and the web concierge (M7a's premium features) | — | ✓ |

- **This departs from the pricing study in two places, deliberately.** The pricing study put
  call proposals, custom fields and CSV import on its third tier and above. M7a's shape puts
  the CRM on every plan, and this study routes all AI writes through proposals, so proposals
  and custom fields move to every plan. It also gave staff logins only to its top two tiers;
  here the staff model exists for every plan and the **number** of logins is the lever.
  Staff who only connect a calendar by link need no login.
- **AI and MCP on every plan**, because HubSpot, monday and Pipedrive all put MCP on every
  tier, and AI locked behind top tiers is an anti-pattern owners complain about.
- **Free view-only seats** (HubSpot's model, for an accountant or a co-owner): recommended —
  a view-only login costs BIS almost nothing.
- **Outcome-based AI pricing** (HubSpot's $0.50 per resolved conversation): not
  recommended; M7a's metered voice minutes and chats are easier for an owner to predict.
- **Plans cannot yet hold any of this.** `plans.features` accepts exactly two keys
  (`voice_receptionist`, `web_concierge`) and `plans.allowances` exactly three meters.
  Storage allowances, staff-login counts, the portal and per-staff calendars need those
  checks widened and enforcement points added — an **entitlements** item in §11. Until
  then, the first release applies one default storage quota to every account.
- **New cost-to-serve lines** to add to the pricing study's margins: storage (about $0.02 per
  GB-month), the ClamAV host (a few dollars a month in total), AI summaries and drafting
  (cached, capped, expected well under a dollar per account per month — to be measured),
  document intake (about a cent per document), and Nylas only if Gmail inbox sync is ever
  bought.
- **Payments revenue** is a decision: with Stripe setting the fees, BIS earns nothing on
  customer payments. HubSpot charges a 0.5–0.75% platform fee. A small application fee, or
  none as a selling point, is the owner's call (§12, decision 3).

---

## 11. The plan

### 11.1 The sum, honestly

Conventional engineer-weeks for one engineer, from Appendix D where it estimates an item —
its figures assume a 2–3 person team, so they are optimistic for one — and from this
repository otherwise.

| Track | Items (engineer-weeks) | Total |
|---|---|---|
| **Foundation** | Staff and roles, with field restriction, assignment, notifications and mentions (3–4); client record model with backfill, relaxed NOT NULLs, suggested groups (5–6); record page, drawer, last-contact and time-in-stage (2–3); `record_changes` audit log and trash (2–3); consent ledger synced with Telnyx (2–3); inbound email with sender checks, review queue and web-chat threads in the inbox (3–4); document vault with scanning, versions, retention, checklist, stage rules, share links, Documents view, quotas, teardown (6–8); in-house e-signature (3–5); bilingual messages including Sofía's emails and form label twins (3–4); Spanish dashboard (3–4); forms with uploads, signatures, logic, pre-fill and booking questions (3–4); merge with history (2–3); entitlements on plans (2–3) | **39–54** |
| **AI** | Generalised proposals (2); summary with caching and caps (1–2); drafting and translation (1–2); gone-quiet nudges (1); Ask BIS with read tools and SMS (2–3); document intake (2–3); notetaker (1–2); date triggers and repeating tasks (1–2) | **11–17** |
| **Google and Microsoft** | Owner's calendar on both providers with Meet, Teams and attendee matching (6–8); per-staff calendars with Sofía's four tools and round-robin (4–5); send-as-me (1–2); Drive and OneDrive pickers (2–3); contacts sync (1–2); verification preparation (1); Google and Microsoft sign-in (0.5–1) | **15.5–22** |
| **Money and portal** | Price book, quotes with options, invoices, schedules, recurring, ACH, reminders, payment links from Sofía and the concierge, Stripe Connect (9–12); document templates (2); portal on scoped tokens (4–6); QuickBooks push (3–4) | **18–24** |
| **Reach** | MCP server with auth spike (3–4); Business Profile reviews and AI replies (2–3); spreadsheet import with header mapping, `.xlsx` export (1–2); importers from HubSpot and monday (2–3); installable web app with offline read (2–3) | **10–15** |
| **Packs** | Blueprint extensions with "describe your business" onboarding (3–4); regulated-tenant mode (1–2); home services parts one (2) and two, with schedule and map views (2–3); child care (4–6); broadcasts and segments (3–4); Sofía knowledge base (2–3); restaurant catering after POS research (3–4); child-care system integration after research (3–4) | **23–32** |
| **In flight** | M7a steps 2–4 (estimate) | **3–4** |
| **Total** | | **≈ 120–168** |

**Not in the total, because each waits on a decision:** HIPAA mode; a native mobile app;
WhatsApp; the rule builder; full inbox sync; a staff business number; sequences; AI fields;
Meet and Teams transcripts; NPS surveys; multi-currency.

That is roughly two and a half to three and a half years for one engineer working
conventionally, or about a year for three. **This repository has not moved at conventional
speed**: its foundation, CRM spine, booking, voice receptionist, white-labelling, automation
engine and web concierge shipped between 25 July and 22 September. Read calendar time off
that observed pace, not these units.

### 11.2 The first release

Roughly 27–36 engineer-weeks, chosen for value to every industry at once. It has no
external gate, but it does need **decisions 1 and 2** (§12) first, because the vault is the
documents feature the platform spec excluded and its scanner is a new external service.

1. Staff and roles: users, roles enforced, a language per user.
2. Client groups and relationships (the restricted flags wait for roles), properties and
   equipment, the `company_name` backfill.
3. The record page and drawer, with the summary, relationships, groups and documents.
4. The consent ledger.
5. Bilingual automated messages, Sofía's emails included, and a language on every contact.
6. The document vault: upload, scanning, categories, versions, expiry reminders, the
   checklist, share links — with one default storage quota.
7. Inbound email on the client's own domain, and web-chat threads in the inbox.
8. Generalised proposals and the bilingual record summary.

In parallel: publishing Google sign-in (which carries brand verification), Microsoft
publisher verification, the Business Profile API application, and M7a's remaining steps.

### 11.3 Order and dependencies

Tracks run in parallel where they do not depend on each other. Within a track, each item
ships to a real client before the next item on that track starts, as the platform spec
requires, and every UI item passes DESIGN.md's definition of done.

1. **No prerequisites:** staff and roles; the client record model; the consent ledger;
   inbound email and web chat in the inbox; bilingual messages; Google and Microsoft
   sign-in, with Google brand verification and Microsoft publisher verification; the
   Business Profile API application; M7a's remaining steps; the regulated-tenant mode;
   spreadsheet import and export; the MCP auth spike.
2. **On staff and roles:** restricted relationship flags and gate codes; the Spanish
   dashboard's per-user language; assignment; per-staff calendars.
3. **On the record model:** the record page; the audit log and trash; the merge; importers
   from HubSpot and monday (they import companies and relationships); the document vault;
   the blueprint extensions.
4. **On the vault:** in-house e-signature, then forms with uploads and signatures and the
   booking questions; the checklist and stage rules (the "no *Done* without an invoice"
   rule arrives with money); the installable web app's offline read.
5. **On generalised proposals:** the summary's suggested actions; proposals from email,
   texts and documents; document intake (also needs the vault); the notetaker;
   "describe your business" onboarding; the MCP server's writes. MCP read tools need only
   the auth spike.
6. **Independent AI items:** drafting and translation, gone-quiet nudges, Ask BIS, date
   triggers.
7. **Calendar:** Outlook first where clients run Microsoft 365; the owner's Google calendar
   under Testing mode → send-as-me, pickers and contacts sync → one Google sensitive-scope
   submission → per-staff calendars (needs staff and roles) → round-robin.
8. **Business Profile:** after API approval, its own Google review, then reviews and AI
   replies.
9. **After M7a and entitlements:** money through Stripe Connect, then document templates,
   then the portal, then QuickBooks.
10. **On the consent ledger:** broadcasts and segments.
11. **Packs:** home services part one after the vault and blueprint extensions; part two
    after money and per-staff calendars; child care after money, field-level roles,
    broadcasts, the installable web app and the child-care system integration research;
    restaurant catering after POS research, money and broadcasts; Sofía's knowledge base
    before the child-care and restaurant receptionists.
12. **On an anchor customer:** HIPAA mode, then adult day care and medical offices.

The consent ledger must be live before **31 January 2027**, when the FCC's "revoke all" rule
takes effect.

---

## 12. Decisions only the owner can make

**Needed before the first release:** decisions 1 and 2.

1. **Reverse the recorded non-adoption of payments, invoicing, documents and e-signature**
   (platform spec §2). Recommended: yes — "all their documents" and every industry pack
   depend on it.
2. **The "no external services for core features" rule.** The plan adds a ClamAV host,
   Stripe Connect, optionally BoldSign or SignWell for health documents, and optionally
   Nylas for Gmail inbox sync. Recommended: accept ClamAV and Stripe; defer the rest.
3. **Stripe Connect for businesses versus M7 #3's Connect for agencies**, and whether BIS
   takes an application fee on customer payments. Recommended: design both uses before
   building either; a small or zero fee is a selling decision.
4. **Per-staff calendars**, reversing one-calendar-per-company. Recommended: yes, once the
   owner's-calendar step has run with real clients — on Outlook, or on Google after its
   review passes, since a Google pilot in Testing mode means reconnecting every week.
5. **HIPAA as an investment — including whether clinics may buy Sofía before it exists.**
   A clinic's calls put health information in transcripts, summaries and proposals that BIS
   stores and sends to OpenAI. Recommended: build the regulated-tenant mode now; sell Sofía
   and the CRM to clinics and to adult day centers billing Medicaid only once an anchor
   customer funds HIPAA mode, in the hardened production project; offer adult day care front
   office only, with a legal check.
6. **Health information and AI.** Children's health information already reaches OpenAI
   whenever a parent mentions an allergy or illness on a call with Sofía. The plan adds more
   paths: document intake, proposals from documents and email, and per-record addresses that
   receive doctors' notes. A child-care center is not a HIPAA covered entity, but this is
   sensitive children's data under Texas's privacy act. Recommended: request OpenAI's
   zero-data-retention or a BAA now; until one is in place, **no document with sensitivity
   `health` or `phi` reaches any model**, whatever path it arrived by.
7. **Do meetings happen inside BIS?** The meeting-notes work is blocked on this, and
   Daily.co video rooms are built but dormant. Recommended: no — use Meet and Teams links from
   the owner's own calendar, retire Daily.co, and keep the in-person notetaker, which does not
   depend on it.
8. **Pack order.** Recommended: home services, child care as the front office, restaurant
   catering, then the HIPAA verticals — departing from the pricing study's "healthcare is the
   better ground" only because of §9.4's cost of entry.
9. **Portal sign-in.** Recommended: magic links on scoped tokens, not Clerk accounts.
10. **Mobile.** Recommended: an installable web app first — home-screen install, push
    notifications, offline read of today's jobs and a child's emergency file — and a native
    app only when Tap to Pay or a larger technician fleet justifies it.
11. **WhatsApp.** It recurs across three appendices as the default channel for
    Spanish-speaking customers, and BIS does not have it. Recommended: the next channel after
    the consent ledger; research the provider (Telnyx or Meta's Cloud API) first — not yet
    done.
12. **The rule builder** M3 still owes. Recommended: keep deferring, as the platform spec
    says, until clients' needs diverge from the recipe catalogue; the first industry pack is
    the test.
13. **Full inbox sync.** Recommended: replies and forwards first; direct Outlook sync if
    customers ask; Gmail through Nylas only if they insist.
14. **Packaging** (§10): how many plans M7a ships, staff-login counts, storage per plan,
    portal placement, view-only seats, AI and MCP on every plan.

---

## 13. Risks

- **Scope.** 120–168 engineer-weeks is a lot of product. Shipping each item to a real client
  before the next matters more, not less.
- **Sensitive data before permissions.** Custody flags, no-contact flags, gate codes and
  pickup IDs wait until roles are enforced. Pickup-person driver's-licence images are
  sensitive personal information under Texas breach law; get a legal check.
- **Paths around RLS multiply.** Share links, client upload links, public forms with
  uploads, staff calendar-connect links, the portal, the MCP server and per-record email
  addresses each reach tenant data without a Clerk session. Every one follows §8.2's token
  rule and gets its own isolation tests; email adds sender verification.
- **Storage abuse and cost**: quotas, rate limits and a type allowlist on every upload path;
  egress at $0.09 per GB past the allowance; teardown of storage on account deletion.
- **AI cost at scale**: summaries cached and capped per account; model cost tracked per
  feature alongside M7a's meters.
- **Google's Limited Use policy**: Workspace data may power prominent user-facing features
  but may not train models or be aggregated beyond the user.
- **TRAIGA's** AI-disclosure duties apply the moment a clinic or adult-day tenant uses Sofía.
- **Children's data is "sensitive" under the Texas Data Privacy and Security Act**: never sold,
  never used for marketing.
- **New infrastructure**: the ClamAV worker needs a host, updates and monitoring.
- **One Stripe account, several projects**: M7a, Connect for businesses and Connect for
  agencies share an account and attention.
- **The allergen guardrail** for restaurants is a safety issue, not a copy issue.
- **Child care is contested by its own software vendors**; the front-office position must be
  tested with real centers before the pack is built.

---

## 14. Closing the one gap in this research

Appendices A and B describe HubSpot and monday.com as their vendors publish them. To compare
them against **how BIS's own HubSpot and monday.com accounts are set up** — which pipelines,
properties, boards and automations exist — connect the official HubSpot and monday.com
connectors at <https://claude.ai/customize/connectors> and start a new session. Both vendors
publish MCP connectors, so a future session can read those accounts directly and diff them
against this plan. A HubSpot and monday importer (§11.1, Reach) would then have real data to
be built against.

---

## 15. Sources

Research facts are cited inline in Appendices A–E, the pricing study and the insights brief,
which link vendor pricing pages, knowledge-base articles, developer documentation and primary
Texas and federal regulations. Claims those sources mark secondhand are marked secondhand
here. Two load-bearing integration claims were re-verified against primary sources on
2026-09-25:

- Google Gmail scope classes — <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Microsoft Entra default user-consent policy —
  <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies>

Repository facts were read from `main` @ `c9f8454` on 2026-09-25 and checked twice by
independent reviewers, with file-and-line evidence.
