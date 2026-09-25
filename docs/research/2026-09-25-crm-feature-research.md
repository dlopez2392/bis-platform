# BIS Platform — What to Build Next: a CRM for the Valley's Small Businesses

**Date:** 2026-09-25 · **Branch:** `claude/fervent-lamport-74vudn` · **Audited against:** `main` @ `c9f8454`
**Question:** how should BIS improve to serve plumbers, restaurants, child and adult day
care centers and similar small businesses — with one place for everything about a
client, AI throughout, and Google and Microsoft 365 built in?

**Evidence base.** Eight research appendices written for this study, two earlier research
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
| [Appendix F](2026-09-25-appendix-f-market-sizing.md) | Valley business counts and concentration for 50+ industries (Census 2023) |
| [Appendix G](2026-09-25-appendix-g-professional-services.md) | Law, insurance, tax, real estate and freight: software, needs, compliance |
| [Appendix H](2026-09-25-appendix-h-consumer-services.md) | Events and quinceañeras, route services, studios, vets, auto, salons, funeral homes |

**How it was checked — five independent reviews.** Revision 1 went to an independent reviewer told to
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
lapse. Revision 4 then went to a final verification, which confirmed nine of those
eleven fixes and caught one error of fact: Google's 7-day rule applies to publishing the
*branding*, not the app, and publishing the whole project early would have broken the
Testing-mode pilot the plan relies on. Checked against Google's own pages and corrected
here, with four smaller consistency fixes. Revision 5 recorded a decision for every HubSpot
and monday.com idea. **Revision 6** records the owner's decision on adult day care and adds
§9.5–§9.6 — which other Valley businesses to target, from three new appendices (F–H). A fifth
review checked those sections against the appendices and the code; its twelve findings —
among them that the tax offer reduces rather than removes BIS's obligations, and that
selling Sofía to law firms first needs an ethics due-diligence sheet — are addressed. The two integration claims the plan depends on
most were re-verified against Google's and Microsoft's own documentation.

**One limitation, stated plainly.** This work ran in a cloud session that cannot see the
HubSpot and monday.com accounts open in the owner's browser. Appendices A and B are built
from both vendors' published feature tables, knowledge bases and developer documentation
instead — more complete than a walk through one account's screens, but not a view of how
BIS's own accounts are configured. §14 says how to close that gap.

**Owner decisions recorded since the study was delivered.**

- **2026-09-25 — Adult day care is out of scope.** The owner judged it infeasible because of
  HIPAA's compliance burden and cost. The adult day pack, the "front office only" fallback
  and all Medicaid, DAHS and EVV work are dropped; Appendix E §4 is kept as research only.
  Medical offices remain behind the same HIPAA question (§12, decision 5).

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
| 5 | **The document vault**: private storage, scanning, versions, expiry reminders, retention, a required-documents checklist, stage rules, e-signature on everyday documents, forms that accept uploads and signatures | The owner's first ask; child-care files are legally required |
| 6 | **Email that comes back**: an address per business and per record, on the client's own domain where it has one | Replies are never recorded today |
| 7 | **AI on the record**: generalised proposals, a bilingual summary, drafting, intake from photos and PDFs, "gone quiet" nudges, Ask BIS | Summaries and writing are what small businesses actually use AI for |
| 8 | **Google and Outlook**: the owner's calendar first, then per-staff calendars, Meet and Teams links, send-as-me, Drive and OneDrive pickers, contacts sync | The schedule is the business |
| 9 | **Money**: price book, quotes with options, invoices, ACH and card, deposits, recurring billing | Getting paid is a service business's close |
| 10 | **The client portal, the MCP server, and industry packs** | One link for the customer; Claude and ChatGPT for the owner with every AI write landing as a proposal; the industry specifics |

**The full plan is about 147–207 engineer-weeks** in conventional units (§11), with a
first release of roughly 27–36 engineer-weeks that delivers the record page, the vault,
consent, bilingual messages, inbound email and the AI summary. This repository's own pace is the
better guide to calendar time: foundation, CRM, booking, the voice receptionist,
white-labelling, the automation engine and the web concierge all shipped between 25 July
and 22 September.

**Industry packs**, delivered by extending blueprints, in this order (§9, §12 decision 8):
**home services**, with pest, lawn, pool and cleaning as templates inside it; **law firms**
and **insurance agencies**, which need the same vault, e-signature and household features
and are where a Spanish-first receptionist is worth most; **quinceañera and wedding
vendors**, the best-scoring new segment at 21 of 25; **child care** as the front office
beside the center's own software; and **restaurant catering** after POS research. Freight
brokers and studios get pilots; tax preparers get a seasonal receptionist-only offer.
**Adult day care is out of scope** by the owner's decision, because of HIPAA's compliance
burden and cost; medical offices wait on the same HIPAA question.

**Sell Sofía first, the packs second.** Law firms, insurance agencies, event venues and tax
preparers all buy the phone before anything else. With industry guardrails, caller identity
checks and price-list grounding — about 3–4 engineer-weeks — Sofía can be sold into them
while the foundation is built, once law firms have an ethics due-diligence sheet and tax
preparers a security contract (§9.5). Events scores highest but comes third as a pack,
because it waits on money; its receptionist can be sold at once, and its assumptions should
be tested first — the RGV Wedding & Quince Expo in McAllen on 27 September is the place.

**One fix is due this week.** A Spanish-speaking customer who replies "ALTO" or "PARAR" to a
BIS text is probably not opted out today: Telnyx recognises only English stop words unless
Spanish ones are registered on the messaging profile, and nobody has checked the live
profile. Checking and registering them is configuration, not code; staff need an interim
routine for free-text requests until the consent ledger ships (§9.6).

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
  with uploads, staff calendar-connect links, e-signature signing sessions, and quote
  acceptance and payment pages all bypass Clerk, as the portal does. Each uses §8.2's
  pattern: a scoped, expiring, signed token bound to one account and one record, an
  explicit tenant check on every query, and its own isolation tests.
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
2. **Week 1 — Google sign-in, Google branding, Microsoft publisher.** Finish Google sign-in
   (already enabled in Clerk, without production credentials). Sign-in asks only for name,
   email and profile, and Google exempts exactly those scopes from Testing mode's limits:
   any Google user can sign in, with no warning and no 7-day expiry. So sign-in goes live
   **while the project stays in Testing**. Verify the branding (logo and name on the consent
   screen) and press **Publish branding within 7 days** of approval — that button, not the
   app's publishing status, is what Google's 7-day rule refers to. Microsoft publisher
   verification in parallel.
3. **Build the Google sensitive-scope features under Testing mode, then submit once.**
   The review's demo video must show each scope working, so build the calendar, send-as-me,
   pickers and contacts sync first under Testing mode (up to 100 test users, refresh tokens
   that expire every 7 days, so pilot users reconnect weekly), then submit one review.
   **Business Profile stays out of that submission**: its API grants no requests until a
   separate approval with no published lead time, so its demo cannot be recorded until
   then; it gets its own review. Apply for Business Profile API access now — it requires a
   verified profile active 60+ days. Sheet import uses the Picker with `drive.file`, so it
   adds no scope.
   **Move the project to In production only when that review is submitted** — publishing
   earlier would show every new user Google's unverified-app warning and count them against
   a lifetime cap of 100 that cannot be reset. (Google also recommends separate test and
   production projects; either works.)
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
| Google sign-in | **Finish** — already enabled in Clerk, without production credentials yet | Its name-email-profile scopes work for any user while the project stays in Testing mode (§6.2 step 2) |
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

### 9.2 Child day care — fourth, as the front office

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

### 9.3 Restaurant catering — fifth, after research

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

### 9.4 Adult day care is out; medical offices are a HIPAA decision

**Adult day care is out of scope — the owner's decision, 2026-09-25.** The vertical runs on
health information: care plans, medications, physician orders, Medicaid authorisations and
DAHS forms 3050, 3055, 3682 and 3683. Holding that makes BIS a HIPAA business associate at
the cost set out below. The "front office only" fallback earlier revisions offered depended
on a lawyer's opinion and on a care setting never letting a health detail reach BIS, which
is not a rule software can keep. So BIS builds no adult day pack, does not market to adult
day centers or home-health agencies, and onboarding turns them away politely. Appendix E §4
stays as research.

**Medical and dental offices are the question that remains.** The pricing study called the
Valley's appointment-driven healthcare cluster — about 2,376 establishments — the best
ground, and the insights brief recommended a regulated-tenant mode before the next clinic
signs. They describe two different things:

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

**Recommendation for medical offices:** build the regulated-tenant mode now — it is cheap,
and TRAIGA's disclosure applies the moment any healthcare business uses Sofía. Treat HIPAA
mode as a deliberate investment, made only if one anchor clinic will fund most of the floor.
The same cost argument that settled adult day care applies here, so if no such clinic
appears, the consistent conclusion is to leave medical offices out as well. In any case,
never build clinical records, claims submission or EVV.

### 9.5 Other Valley businesses worth targeting

Added on 2026-09-25 at the owner's request. Three sources, each an appendix: local business
counts and concentration from the Census 2023 county files (Appendix F), and segment
research on professional services (Appendix G) and consumer services (Appendix H). Both
segment studies scored candidates 1–5 on the same five measures — fit with BIS, Valley
demand, willingness to pay, incumbent weakness, and compliance cost (5 = cheapest) — but
two researchers did the scoring, so the totals out of 25 are **indicative, not precise**.
Adult day care is excluded by the owner's decision; physicians, dentists, therapists,
chiropractors and medical spas are left out here because they sit under the still-open
HIPAA question (§12, decision 5).

| Segment | Valley businesses with staff | Concentration¹ | Score /25 | Verdict |
|---|---|---|---|---|
| **Quinceañera and wedding vendors** — venues and salones, planners, decor, cakes, dresses | 137 lessors of nonresidential buildings (a venue proxy); 48 bakeries; about 11,900 girls turn 15 each year | 1.59× lessors; 2.08× bakeries | **21** | **Yes** — a new events pack on the catering pipeline; lead with venues; **validate first** |
| **Law firms** — immigration, family, criminal defense | 510; one attorney per about 800 residents, against 1 per 310 statewide | 1.23× | **19** | **Yes**, with the guardrails below |
| **Insurance agencies** — property and casualty, non-standard auto | 524, of which 367 have under five staff — as many as law | 1.57×; 12% of Texas's county-mutual agents | **18**² | **Yes** — property and casualty first |
| Route services — pest, lawn, pool, cleaning | 40 pest, 63 landscaping, 66 janitorial, plus thousands of one-person operators | 1.6–1.8× among one-person firms | 17 | Yes, as templates inside the home-services pack |
| Studios and schools — martial arts, dance, tutoring, driving | about 141 combined | 0.5–1.4× | 17 | Pilot in months 9–12 |
| Pet grooming and boarding | 30 | 0.47× | 17 | Later, 12–18 months |
| Customs brokers and freight forwarders | 218 (Laredo has 663); 1.17 million northbound trucks through Valley ports in 2025 | **3.99×** | 16 | Pilot with two or three design partners |
| Auto repair and tire shops | 147 repair, 64 tire | 0.69× / 1.26× | 16 | No pack; a receptionist-only add-on at most |
| Real estate agents and property managers | 190 / 120 | 0.46× / 0.79× | 14 | No |
| Veterinary clinics | 32 | 0.37× | 14 | No |
| Funeral homes | 46 | 1.21× | 14 | No |
| Salons, barbers, nails, spas | 238 with staff; about 2,950 licensed premises | 0.3–0.8× | 14 | No |
| Tax preparers | 139, plus 631 one-person firms; 36.4% of Valley returns claim the EITC against 15.0% nationally | 1.93× | 13 | **Receptionist only**, seasonal |
| Used-car dealers | 140, plus 1,462 one-person dealers | 2.23× | 13 | No |

¹ Concentration is the location quotient against the US: how much more of the Valley's
business mix this industry is. It is not density per resident — the Valley has fewer
businesses per resident overall, so per-resident density is roughly the quotient × 0.59.
That is why law shows 1.23× while attorneys are scarce per resident.
² Scored for property and casualty plus ACA storefronts; the recommended scope is narrower.

**Where the sources disagreed, and how it was settled.**

- **Tax preparers.** The numbers are the Valley's most distinctive: 319,000 returns a year
  done by paid preparers and $1.8 billion in refunds. But most buyers are one-person firms
  averaging about $39,000 in receipts, and TaxDome and its peers cost under $100 a user and
  already ship a Spanish portal. Storing returns would make BIS a service provider under
  the FTC Safeguards Rule and probably a "tax return preparer" under IRC §7216. The demand
  is real for the **phone** in January to April. So: a seasonal receptionist-only offer
  with no document storage and no Social Security number fields. That **reduces the
  exposure; it does not remove it** — call summaries are still customer information. BIS
  still owes those tenants enforced MFA, encryption, access logging and a security
  contract; U.S.-only processing; the preparer's §7216 notice; and no reuse of the data for
  model training or cross-account analytics.
- **Used-car dealers.** Highly concentrated here, but dealers that finance their own sales
  fall under the Safeguards Rule, which would make BIS a contracted service provider, and
  Texas requires four years of collection-contact logs. Not worth it.
- **Other high-concentration segments from Appendix F's ranking**, each with a verdict:
  - produce wholesalers (15.8×) and installment lenders (8.9×): the software buyer is often
    a chain's head office, and lending brings collection-call law — **no**, though produce
    brokers merit a later look as a CRM-and-documents sale with no receptionist;
  - truckload carriers: reached more easily through the freight brokers who dispatch them
    — **no**, covered by the freight pilot;
  - pawn and title lenders: chain-heavy, little appointment need — **no**;
  - homebuilders: lead intake, estimates and contracts fit — **later**, as a template in
    home services part two;
  - lot developers selling owner-financed colonia lots (38 firms, 3.96×): a strong fit on
    paper, but these sales are governed by Texas's executory-contract rules in the Property
    Code — **research before any pilot**.
- **Veterinary clinics and real estate**, which looked natural, are thin in the Valley: 32
  vet clinics with staff, and real estate at less than half the national share.

**Sell the receptionist first — with its prerequisites.** Law firms, insurance agencies,
event venues and seasonal tax preparers all buy the phone before anything else, and Sofía
already answers it. Before she serves them she needs industry guardrail packs, caller
identity checks and answers grounded in the business's own price list (§9.6 items 1–3,
about 3–4 engineer-weeks). Two segments need more first: **law firms** need the Opinion
680/705 due-diligence sheet stating the AI providers' actual retention terms, which is one
more reason to secure OpenAI's zero-data-retention (§12, decision 6); **tax preparers** need
the security contract and a U.S.-only processor attestation. With those in place, BIS can
sell Sofía into these segments while the foundation is built, and sell the full pack once
the vault, e-signature and money land.

**Why events is third although it scores highest:** its pack waits on money, date holds and
multi-payer schedules, which come after M7a (§11.3 step 9), while law and insurance need
only the vault, e-signature and households. The receptionist can be sold to venues
immediately either way.

#### Quinceañera and wedding vendors — the best new fit

- **Why:** the only segment where every planned piece lines up — phone inquiry, tour,
  package quote, deposit schedule, contract, portal, date-timed reminders. No incumbent
  (HoneyBook, Perfect Venue, Tripleseat, Planning Pod) ships a voice receptionist, and none
  of their pricing pages mentions Spanish. Mothers and grandmothers call in Spanish on
  evenings and weekends while staff are running events.
- **Validate before building.** The appendix's picture of how salones work — Facebook and
  WhatsApp messages, phone calls, paper contracts, cash, padrinos paying separately — is a
  hypothesis. Run five to ten discovery conversations first. **The RGV Wedding & Quince Expo
  is at the McAllen Convention Center on 27 September 2026**, two days after this study,
  and the next is in February.
- **Who first:** venues and full-package sellers, at about $8,000–$20,000 an event
  (secondhand estimate); then decor, cake and dress shops; solo photographers and DJs last,
  where HoneyBook at $29 is hard to beat.
- **New work:** a date and room calendar with **tentative holds that expire**; package
  quotes priced by tier and guest count with add-ons; payment schedules **split across
  several payers** (parents and padrinos) with **cash payments logged**; reminders timed from
  the event date (final headcount 30 days out, balance 14 days out, review two days after);
  bilingual contract templates whose cancellation schedule steps down by time before the
  event — secondhand sources read Texas law as treating a flat 100% forfeiture as a likely
  unenforceable penalty, especially when the venue rebooks the date; vendor insurance
  certificates with expiry; and a parent-signed photo release, because the quinceañera is a
  minor.
- **Sofía** answers date and package questions only from the venue's current price sheet
  and never improvises refund terms (Texas's deceptive-trade-practices law applies).
- **Relationship to the restaurant pack:** the same pipeline without the POS dependency, so
  the events pack can ship before restaurant catering.
- **Do not build:** floor plans, kitchen and banquet production, rental inventory, seating
  charts, RSVP sites, photo galleries. HoneyBook shipped a Claude connector and a ChatGPT
  app in September 2026, so in events BIS's MCP server is parity; the edge is Spanish voice.

#### Law firms — immigration, family, criminal defense

- **Why:** immigration callers are overwhelmingly Spanish-speaking and face shorter hearing
  notices, and the Valley has about a third of the state's attorney density per resident,
  so firms overflow. Clio's Signature tier ($99 a user) includes its intake CRM; its AI
  intake agents sit on the Elite tier ($249) and are reported at $25 per converted lead,
  launched 20 August 2026 with no Spanish support mentioned (secondhand).
- **Sofía's rules, in both languages:** she says she is a virtual assistant and not a
  lawyer; never judges eligibility, promises an outcome, calls herself or the firm a
  "notario", advises on hearings, travel, ICE or forms, or asks for payment "for the
  forms"; hot-transfers detention, same-week-hearing and ICE-encounter calls to a person;
  verifies identity before discussing any existing matter; and is **inbound-only**, because
  Texas Rule 7.03 bars electronic solicitation of non-clients. Required disclaimers go out in
  every language used (Rule 7.01(d)).
- **Tenant policy:** accept immigration tenants only if they are licensed attorneys, with the
  bar number checked, or DOJ-recognized organizations with accredited representatives —
  otherwise BIS risks powering a notario operation (Gov't Code §406.017; 8 CFR 292.1).
- **Paperwork BIS must supply:** a one-page due-diligence sheet answering Texas ethics
  opinions 680 (cloud) and 705 (AI) — whether client data trains any model, the AI
  providers' actual retention terms, encryption, retention, human approval of AI updates —
  and a policy requiring legal process for any government request, since immigration status
  is sensitive data under Texas law.
- **Records:** petitioner, beneficiary, spouse and co-defendant as relationships; required
  documents per case type (passports, I-94s, birth certificates, prior filings).
- **Exclude** firms whose clients are healthcare providers, which makes them HIPAA business
  associates. Personal-injury plaintiff firms are reported not to be covered but hold
  medical records (secondhand); inbound intake only.
- **Integrate** with Clio, MyCase, Docketwise and LawPay once their APIs and partner terms are
  researched; never build practice management.

#### Insurance agencies — property and casualty, non-standard auto

- **Why:** a pool as large as law's, Spanish quote calls all day, and AgencyZoom — the
  leading small-agency CRM — has no native voice agent.
- **But the voice flank is crowded.** Insurance-native AI receptionists — Sonant, Liberate,
  Cara — already advertise Spanish from the first ring (secondhand). BIS's case is the
  combination: CRM, a Spanish receptionist and a consent ledger at around AgencyZoom's price
  ($149–$349 a month for seven seats), not the receptionist alone.
- **Scope:** property and casualty first. Three lines wait for a review because they touch
  health information:
  - **ACA marketplace storefronts** — reported not to be HIPAA covered entities (the
    researcher's analysis), but they handle health-plan applications, and CMS requires
    consent records kept ten years;
  - **burial and final-expense life agents** — the strongest insurance signal in the data
    (the Valley holds 27.6% of Texas's small-face life agents with 4.6% of its population),
    but simplified-issue applications ask health questions;
  - **Medicare and group health** — often bound by business-associate terms with health
    plans (the researcher's analysis): out until HIPAA is decided.
- **Sofía's rules:** capture the quote request and route it to a licensed agent; never quote
  a premium, bind, say "you're covered", interpret coverage or a claim, or advise rejecting
  UM or PIP coverage — discussing policy terms is an agent's act under Texas Insurance Code
  §4001.051(d). Counsel should also review the intake design against §4001.051(b), which
  counts "receiving or transmitting an application" as an agent act. Identity check before
  discussing an existing policy.
- **Records:** drivers and vehicles as relationships and equipment; declarations pages,
  licences, VINs and proof of insurance in the vault; renewals as expiring documents; written
  UM/PIP rejections through e-signature.
- **Compliance:** privacy under Texas Insurance Code ch. 601 and TDI rules, not the FTC
  Safeguards Rule; Texas has not adopted the NAIC insurance data-security model law.
  Outbound AI renewal calls need prior consent.
- **Integrate** with NowCerts or EZLynx first, then AgencyZoom, once their APIs and partner
  terms are researched. Price anchors: AgencyZoom as above; HawkSoft $99 a user.

#### The rest, briefly

- **Route services** become templates in the home-services pack: recurring visits from
  service agreements, route days, treatment and chemistry logs. Jobber sells an AI
  receptionist at $29 a month and Skimmer an AI phone at $99.
- **Customs brokers and freight forwarders:** bilingual calls with Reynosa counterparts and
  carrier packets whose insurance certificates expire fit the vault well, but the core work
  lives in their TMS and customs-filing systems. Pilot with two or three Valley brokers;
  Laredo, with three times as many firms, is the larger prize if it works. Never build a
  TMS.
- **Studios and schools** reuse the households and minors built for child care, but carry a
  trap: under the **Texas Health Spa Act**, a gym that turns on recurring drafts may need
  Secretary of State registration and a $20,000–$50,000 bond, and its contracts need a
  three-business-day cancellation notice; dance and aerobics-only businesses are excluded,
  and martial-arts studios are reported to be covered (secondhand). BIS's recurring-billing
  setup must ask before enabling autopay. Parent-signed waivers generally cannot waive a
  child's injury claim.
- **Not targeting,** with the deciding reason:
  - **Salons:** Booksy's English and Spanish AI receptionist is free for 12 months.
  - **Auto repair:** AutoLeap's Spanish-speaking receptionist costs $99 and works with any
    shop system.
  - **Veterinary clinics:** only 32 in the Valley, and BIS would need to write back into
    each clinic's practice-management system.
  - **Funeral homes:** only 46, and the FTC Funeral Rule means any price answer must match
    the current price list exactly.
  - **Real estate:** brokerages hand agents a CRM for free, and willingness to pay is low.

### 9.6 What the new segments add to the platform

1. **Industry guardrail packs for Sofía** — legal, insurance, events and a seasonal tax
   pack — each with a bilingual virtual-assistant disclosure and hot-transfer rules.
2. **Caller identity verification** before discussing an existing matter, policy, event or
   account.
3. **Answers grounded in the business's own price list**, with a versioned record of what
   Sofía quoted — a trust feature for every tenant, essential for events.
4. **A regulated-professional security baseline**: MFA enforced per business, an exportable
   access log, retention settings up to ten years with disposal and legal hold, a security
   addendum, a published list of data processors with U.S.-only processing, a written
   security-plan support pack, and a government-data-request policy. Much of it builds on
   the foundation's audit log.
5. **Rooms and dates as bookable resources, with tentative holds** that expire.
6. **Payment schedules split across several payers**, with cash payments logged.
7. **Date triggers on any date field**, such as an event date — the same work as the date
   triggers already in the AI track, not an extra item.
8. **A bilingual contract template library** carrying statutory text: the Health Spa Act
   cancellation notice, UM/PIP rejection wording, the Texas kennel notice, event
   cancellation schedules.
9. **Consent-ledger additions**: retention up to ten years; Spanish opt-out words; Texas
   calling hours in the recipient's local time; and free-text revocations such as "ya no me
   manden mensajes". Those must **stop sends the moment they are detected** — reversibly —
   with a proposal for staff to confirm or undo; a proposal alone could leave a revocation
   unhonoured past the ten business days the FCC allows.
10. **Integrations**, each after its API and partner programme are researched: Clio, MyCase,
    Docketwise and LawPay; NowCerts, EZLynx and AgencyZoom; imports from HoneyBook and Perfect
    Venue. Meta lead ads later. The MCP server is a cheap path to some of these.
11. **Tenant vetting at onboarding**: a bar-number check for immigration tenants; a polite no
    to adult day care and home health (the owner's decision); and a hold on medical, dental,
    therapy, chiropractic and medical-spa tenants, and on Medicare and group-health agencies,
    until decision 5 is made.

**One of these is due now.** Telnyx recognises only English stop words by default. BIS
deliberately tells Spanish speakers to reply "STOP", but a customer who replies "ALTO" or
"PARAR" anyway is not opted out, according to the opt-out module's own comment, and since
11 April 2025 the FCC requires revocation by "any reasonable method" to be honoured within
ten business days. This week:

- **Check the live messaging profile** — nobody has looked — and register Spanish opt-out
  keywords on it if they are missing: PARAR, DETENER, ALTO, CANCELAR, BAJA and NO MAS. This is
  configuration, not code, and the module's comment anticipates it.
- **Give staff an interim procedure** until the consent ledger ships: keywords catch only
  exact one-word replies, so staff check text threads daily for free-text stop requests in
  either language and switch the contact's texting off by hand. Emailed "stop" requests stay
  unheard until inbound email lands (§6.2).

---

## 10. Packaging and cost to serve

**The owner's own billing decision governs this.** The M7a client-billing spec, approved
section by section on 24 September, supersedes the pricing study's four tiers of 21
September: **two or three plans** at fixed monthly prices, each with included allowances
and overage; **every plan has the CRM, booking, forms and texting; higher plans add Sofía
and the web chat assistant, and bigger allowances**. The new features fit that shape
without strain, with one exception: the receptionist-only offers §9.5 recommends — seasonal
for tax preparers, an add-on for auto shops — fit neither a fixed monthly plan nor "higher
plans add Sofía". They need a plan shape of their own (§12, decision 14).

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
  checks widened and enforcement points added — an **entitlements** item in §11, after
  M7a's checkout step. Until then, the first release applies one default storage quota to
  every account, the agency sets each account's staff-login limit by hand, and per-staff
  calendars and the portal wait.
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
| **New segments** (§9.5–§9.6) | Guardrail packs, identity checks and price-list grounding (3–4); regulated-professional baseline beyond the foundation's audit log (2–3); rooms and dates with holds (2–3); multi-payer schedules with cash (2–3); contract template library (1–2); consent-ledger additions (1); tenant vetting (0.5–1); events pack (2–3); law pack (2–3); insurance pack (2–3); law integrations after research (3–4); insurance integrations after research (3–4); route-service templates (1); freight pilot (2–3); seasonal tax receptionist offer (1) | **27.5–39** |
| **In flight** | M7a steps 2–4 (estimate) | **3–4** |
| **Total** | | **≈ 147–207** |

**Not in the total, because each waits on a decision or on research:** HIPAA mode; the
studios pilot; pet grooming and boarding; homebuilder templates; the lot-developer and
produce-broker research; Meta lead ads; a native mobile app;
WhatsApp; the rule builder; full inbox sync; a staff business number; sequences; AI fields;
Meet and Teams transcripts; NPS surveys; multi-currency.

That is roughly three to four years for one engineer working conventionally, or a little
over a year for three. **This repository has not moved at conventional
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

In parallel: Google sign-in with its branding verified and published (the project stays in
Testing mode), Microsoft publisher verification, the Business Profile API application,
M7a's remaining steps, and the receptionist-first work of §9.5 — guardrail packs, identity
checks and price-list grounding (3–4 engineer-weeks, outside the first release's 27–36).
**This week:** check the Telnyx profile for Spanish opt-out keywords, register any that are
missing, and start the staff routine for free-text stop requests; talk to vendors at the
RGV Wedding & Quince Expo on 27 September.

### 11.3 Order and dependencies

Tracks run in parallel where they do not depend on each other. Within a track, each item
ships to a real client before the next item on that track starts, as the platform spec
requires, and every UI item passes DESIGN.md's definition of done.

1. **No prerequisites:** staff and roles; the client record model; the consent ledger;
   inbound email and web chat in the inbox; bilingual messages; Google and Microsoft
   sign-in, with Google branding verified and published and Microsoft publisher verification; the
   Business Profile API application; M7a's remaining steps; the regulated-tenant mode;
   spreadsheet import and export; the MCP auth spike; **Spanish opt-out keywords on the
   Telnyx messaging profile and the interim staff routine (this week)**; tenant vetting at
   onboarding; discovery conversations with event vendors; Sofía's guardrail packs,
   identity checks and price-list grounding — then receptionist-first sales to insurance
   agencies and event venues at once, to law firms once the Opinion 680/705 sheet exists,
   and to tax preparers once the security contract and U.S.-only processor attestation
   exist; API and partner research for the law and insurance integrations.
2. **On staff and roles:** restricted relationship flags and gate codes; the Spanish
   dashboard's per-user language; assignment; per-staff calendars.
3. **On the record model:** the record page; the audit log and trash, then the
   regulated-professional baseline built on the audit log; the merge; importers from HubSpot
   and monday (they import companies and relationships); the document vault; the blueprint
   extensions.
4. **On the vault:** in-house e-signature, then forms with uploads and signatures and the
   booking questions; the checklist and stage rules (the "no *Done* without an invoice"
   rule arrives with money); the installable web app's offline read.
5. **On generalised proposals:** the summary's suggested actions; proposals from email,
   texts and documents; document intake (also needs the vault); the notetaker;
   "describe your business" onboarding; the MCP server's writes; free-text revocations
   that stop sends on detection and ask staff to confirm. MCP read tools need only the auth
   spike.
6. **Independent AI items:** drafting and translation, gone-quiet nudges, Ask BIS, date
   triggers on any date field (event dates included).
7. **Calendar:** Outlook first where clients run Microsoft 365; the owner's Google calendar
   under Testing mode → send-as-me, pickers and contacts sync → one Google sensitive-scope
   submission, moving the project to In production at the same time → per-staff calendars
   (needs staff and roles, and entitlements, since it is a higher-plan feature) →
   round-robin → rooms and dates as bookable resources with tentative holds.
8. **Business Profile:** after API approval, its own Google review, then reviews and AI
   replies.
9. **Entitlements, after M7a's checkout step** (which is what writes a plan's features into
   `accounts.permissions`): widen the plan checks and add enforcement for storage, staff
   logins, the portal and per-staff calendars.
   **Then, after M7a and entitlements:** money through Stripe Connect with multi-payer
   schedules and cash logging, then document templates and the bilingual contract library,
   then the portal, then QuickBooks.
10. **On the consent ledger:** broadcasts and segments.
11. **Packs, in recommended order:** home services part one after the vault and blueprint
    extensions, with route-service templates; law and insurance after the vault, checklists,
    e-signature, households, the regulated-professional baseline and identity checks, then
    their integrations; home services part two after money and per-staff calendars;
    quinceañera and wedding vendors after money, date holds and multi-payer schedules;
    child care after money, field-level roles, broadcasts, the installable web app and the
    child-care system integration research; restaurant catering after POS research, money
    and broadcasts; Sofía's knowledge base before the child-care and restaurant
    receptionists. **Pilots:** freight brokers after the vault; studios in months 9–12,
    after households, recurring billing with the Health Spa Act check, and e-signature.
12. **On an anchor clinic:** HIPAA mode, then medical offices. Adult day care is not on the
    plan.

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
5. **HIPAA as an investment, now only for medical offices — including whether clinics may
   buy Sofía before it exists.** *Decided 2026-09-25: adult day care is out of scope because
   of HIPAA's compliance burden and cost.* What remains open is medical and dental offices.
   A clinic's calls put health information in transcripts, summaries and proposals that BIS
   stores and sends to OpenAI. Recommended: build the regulated-tenant mode now; sell Sofía
   and the CRM to clinics only once an anchor clinic funds HIPAA mode, in the hardened
   production project — and if none does, reach the same conclusion as for adult day care.
6. **Health information and AI.** Children's health information already reaches OpenAI
   whenever a parent mentions an allergy or illness on a call with Sofía. The plan adds more
   paths: document intake, proposals from documents and email, per-record addresses that
   receive doctors' notes, and the MCP server's read tools. A child-care center is not a HIPAA covered entity, but this is
   sensitive children's data under Texas's privacy act. Recommended: request OpenAI's
   zero-data-retention or a BAA now; until one is in place, **no document with sensitivity
   `health` or `phi` reaches any model**, whatever path it arrived by.
7. **Do meetings happen inside BIS?** The meeting-notes work is blocked on this, and
   Daily.co video rooms are built but dormant. Recommended: no — use Meet and Teams links from
   the owner's own calendar, retire Daily.co, and keep the in-person notetaker, which does not
   depend on it.
8. **Pack order.** Recommended: home services with route-service templates; law firms and
   insurance agencies; quinceañera and wedding vendors; child care as the front office;
   restaurant catering; then medical offices only if HIPAA is funded. This moves child
   care from second to fourth: its incumbents already hold the child's file and ship their
   own AI intake, while law and insurance need fewer new pieces (no field-level roles, no
   management-system integration before launch) and pay more. Insurance's voice flank is
   crowded, so it wins on the bundle, not the receptionist. Events scores highest but
   waits on money, so its pack is third while its receptionist sells at once. It departs
   from the pricing study's "healthcare is the better ground" only because of §9.4's cost
   of entry. Adult day care is out.
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
    portal placement, view-only seats, AI and MCP on every plan — and a receptionist-only
    plan shape for the seasonal tax offer and the auto-shop add-on.
15. **Sell Sofía before the packs** to law firms, insurance agencies, event venues and
    seasonal tax preparers, once the guardrail packs, identity checks and price-list
    grounding exist. Recommended: yes — insurance and events at once; law firms once the
    Opinion 680/705 sheet states the AI providers' retention terms; tax preparers once the
    security contract and U.S.-only processor attestation exist.
16. **Insurance scope.** Recommended: property and casualty now; ACA marketplace storefronts
    and burial or final-expense life agents only after a review, because both handle health
    information; Medicare and group health never without HIPAA; and counsel's review of
    Sofía's intake against Texas Insurance Code §4001.051(b).
17. **Immigration tenants.** Recommended: accept only licensed attorneys, with the bar
    number checked, and DOJ-recognized organizations with accredited representatives;
    Sofía inbound-only for every law firm.
18. **Tax preparers.** Recommended: a seasonal receptionist-only offer that stores no tax
    documents, rather than a full pack. It reduces BIS's obligations under the Safeguards
    Rule and IRC §7216 but does not remove them: call summaries are still customer
    information, so BIS still owes those tenants MFA, encryption, logging, a security
    contract, U.S.-only processing and no reuse of their data.

---

## 13. Risks

- **Scope.** 147–207 engineer-weeks is a lot of product. Shipping each item to a real client
  before the next matters more, not less.
- **Sensitive data before permissions.** Custody flags, no-contact flags, gate codes and
  pickup IDs wait until roles are enforced. Pickup-person driver's-licence images are
  sensitive personal information under Texas breach law; get a legal check.
- **Paths outside the usual session multiply.** Share links, client upload links, public
  forms with uploads, staff calendar-connect links, e-signature signing sessions, quote
  acceptance and payment pages, and the portal reach tenant data without a Clerk session;
  each follows §8.2's token rule and gets its own isolation tests. Per-record email
  addresses add sender verification. **Ask BIS by text** trusts only the sender's phone
  number, so it answers only the account's verified alert phone and never with sensitive
  data. **The MCP server** is different: it runs on Clerk OAuth tokens under RLS (§6.4), and
  its risk is a token carrying the agency-admin role — which the spike must rule out. Its
  read tools are also a route for health information to reach a model, so decision 6
  covers them.
- **Storage abuse and cost**: quotas, rate limits and a type allowlist on every upload path;
  egress at $0.09 per GB past the allowance; teardown of storage on account deletion.
- **AI cost at scale**: summaries cached and capped per account; model cost tracked per
  feature alongside M7a's meters.
- **Google's Limited Use policy**: Workspace data may power prominent user-facing features
  but may not train models or be aggregated beyond the user.
- **TRAIGA's** AI-disclosure duties apply the moment a clinic or any other healthcare
  business uses Sofía.
- **Children's data is "sensitive" under the Texas Data Privacy and Security Act**: never sold,
  never used for marketing.
- **New infrastructure**: the ClamAV worker needs a host, updates and monitoring.
- **One Stripe account, several projects**: M7a, Connect for businesses and Connect for
  agencies share an account and attention.
- **The allergen guardrail** for restaurants is a safety issue, not a copy issue.
- **Child care is contested by its own software vendors**; the front-office position must be
  tested with real centers before the pack is built.
- **Spanish opt-outs.** Until Spanish keywords are registered on the Telnyx profile — the
  live profile is unchecked — a customer replying "ALTO" is probably not opted out, and
  free-text or emailed stop requests are not honoured by any system. That risks the FCC's
  any-reasonable-method revocation rule, in force since April 2025.
- **An AI receptionist for law firms is an ethics exposure**: legal advice, notario
  language, or outbound contact would breach Texas rules. The guardrail pack and
  inbound-only rule are not optional.
- **An insurance receptionist that discusses policy terms is acting as an unlicensed
  agent** under Texas Insurance Code §4001.051(d), and receiving or transmitting an
  application may be too under §4001.051(b); counsel should review the intake design.
- **Insurance-native Spanish AI receptionists already exist** (Sonant, Liberate, Cara); BIS
  wins there on the bundle or not at all.
- **The events pack rests on unvalidated assumptions** about how salones sell, communicate
  and take payment; test them before building.
- **The Health Spa Act bond** can attach the moment a gym or martial-arts studio turns on
  recurring drafts through BIS.
- **Outbound AI-voiced calls need prior consent** under the FCC's 2024 ruling; any future
  outbound Sofía must check the consent ledger first.

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

Research facts are cited inline in Appendices A–H, the pricing study and the insights brief,
which link vendor pricing pages, knowledge-base articles, developer documentation and primary
Texas and federal regulations. Claims those sources mark secondhand are marked secondhand
here. Two load-bearing integration claims were re-verified against primary sources on
2026-09-25:

- Google Gmail scope classes — <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Microsoft Entra default user-consent policy —
  <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies>

Repository facts were read from `main` @ `c9f8454` on 2026-09-25 and checked twice by
independent reviewers, with file-and-line evidence.
