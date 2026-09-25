# BIS Platform — What to Build Next: a CRM for the Valley's Small Businesses

**Date:** 2026-09-25 · **Branch:** `claude/fervent-lamport-74vudn` · **Audited against:** `main` @ `c9f8454`
**Question:** how should BIS improve to serve plumbers, restaurants, child and adult day
care centers and similar small businesses — with one place for everything about a
client, AI throughout, and Google and Microsoft 365 built in?

**Evidence base.** Five research appendices, each compiled from vendor pricing pages,
knowledge bases, developer documentation and primary Texas regulations, plus a line-by-
line audit of this repository:

| Appendix | Subject |
|---|---|
| [A](2026-09-25-appendix-a-hubspot.md) | HubSpot, every feature by hub and tier |
| [B](2026-09-25-appendix-b-monday.md) | monday.com and monday CRM, every feature by plan |
| [C](2026-09-25-appendix-c-smb-crm-landscape.md) | 25 other small-business CRMs on five themes |
| [D](2026-09-25-appendix-d-integrations.md) | Google, Microsoft, documents, e-signature, payments, AI: feasibility and cost |
| [E](2026-09-25-appendix-e-industry-software.md) | Industry software for the four target verticals, with Texas rules |

**One limitation, stated plainly.** This work ran in a cloud session that cannot see the
HubSpot and monday.com accounts open in the owner's browser. Appendices A and B are built
from both vendors' published feature-comparison tables, knowledge bases and developer
documentation instead — more complete than a walk through one account's screens, but not
a view of how BIS's own accounts are configured. §11 says how to close that gap.

---

## 1. The answer, on one page

**BIS already owns the two ideas the market is converging on.** The top-ranked idea in
the small-business CRM market this year is answering every lead instantly in the
caller's language; Sofía does that, and only one competitor (GoHighLevel) documents an
agent that switches between English and Spanish mid-call. The second is AI that proposes
CRM updates from a conversation and changes nothing until a human approves; Pipedrive
launched exactly that as "Nova" on 16 September 2026, and BIS shipped the same pattern as
**call proposals** on 18 September.

**What BIS lacks is the record those ideas write into.** Today a client is a contact row
with five kinds of custom field, a free-text company name and a timeline. There is no
place for a document, no way to say that two people are a mother and her child or that a
customer owns three rental properties, no money flowing to the business's own customers,
and no connection to the owner's Google or Outlook calendar and inbox. The owner's own
dashboard is English-only while everything Sofía and the customer see is bilingual.

**So the next quarter's work is the client record.** Ten things, in this order:

| # | Build | Why it comes here | Effort* | External gate |
|---|---|---|---|---|
| 1 | **Relationships, households and properties** on the client record | Every target vertical needs it; nothing else on this list works without it | 3–4 wk | none |
| 2 | **Document vault** on every record: upload, scan, categorise, expiry reminders, retention | The owner's first ask; daycare and adult-day records are legally required | 3–4 wk | none |
| 3 | **Spanish dashboard** for the owner and staff | 29% of Hidalgo County speaks English less than very well; the incumbents already market Spanish | 3–4 wk | none |
| 4 | **Email that comes back**: a per-business inbound address that files replies on the record | Email is one-way today; this closes it without Google's paid security audit | 1–2 wk | none |
| 5 | **AI on the record**: a bilingual summary at the top, and proposals from email, texts and documents, not only calls | Summaries and writing are what small businesses actually use AI for | 2–3 wk | none |
| 6 | **Staff calendars with two-way Google and Outlook sync**, Meet and Teams links, send-as-me email, Drive and OneDrive file pickers | The schedule is the business; one calendar per company blocks every multi-tech shop | 6–8 wk | Google verification 1–3 wk; Microsoft publisher verification days |
| 7 | **Quote → e-sign → invoice → payment link**, with deposits and recurring billing | Getting paid is a service business's close; no money flows to the business's customers today | 6–8 wk | Stripe onboarding per business |
| 8 | **Document intake AI**: photo or PDF in, filled fields out, with a review screen | Owners work from phones and paper; immunisation records and insurance cards are typed by hand today | 2–3 wk | BAA before any health data |
| 9 | **Client portal**: what you owe us, what we need from you, sign, pay, book | One link replaces the email-attachment ping-pong | 4–6 wk | none |
| 10 | **An MCP server**, so owners can run BIS from Claude or ChatGPT — with every write landing as a proposal they approve | Now standard across CRMs; BIS's proposal pattern makes it safer than theirs | 2–3 wk | directory review ~1 wk |

\*Engineer-weeks for one engineer, from Appendix D where it estimates the item and my own
reading of this codebase otherwise. Items 1–5 have no external gate and can start
Monday. Item 6's verifications should be **submitted in week one** so their lead time
runs in parallel.

**Industry packs ride on top**, delivered through blueprints — the mechanism BIS already
has for stamping pipelines, fields, tags and forms onto a new account. Order: home
services first (closest to today's product), child care second (brightwheel's own CRM is
"coming soon", so the window is open now), restaurants third, adult day care **only after
a decision to build a HIPAA mode** (§6.4).

---

## 2. Where BIS stands today

### 2.1 What is already strong

Credit where it is due, because the roadmap should build on it rather than around it.

- **Bilingual voice receptionist**, live on a real client: books, reschedules and cancels,
  captures leads, takes messages, screens spam, hands off to a human, and labels each call
  by the language the caller actually spoke.
- **Call proposals**: after a call, AI suggests a task, a contact-field correction or a
  pipeline move, with the evidence quoted, and a human accepts or dismisses it.
- **Web concierge**: a text assistant every client can put on its own website as one
  script tag, filing leads through a form.
- **An automation engine** with one log, one quiet-hours rule per account, visible usage,
  and recipes for reminders, confirmations with YES/NO replies, follow-ups, review
  requests, referral asks, no-show nudges, reactivation and quote follow-ups.
- **A weekly report** that states deltas in words and still sends in a quiet week.
- **A work queue**, spam screening, missed-call text-back, forms with embeds, CSV import
  and export with dedupe, and client billing (M7a) under construction.
- **Engineering discipline** most competitors cannot claim: row-level security on every
  tenant table with isolation tests, 262 test files, 28 end-to-end specs.

### 2.2 The gaps

| Area | BIS today | What the market does | Severity |
|---|---|---|---|
| **Client record** | Contact row; `company_name` is free text; notes and deals attach to one contact | Companies, households, properties, typed relationships shown on both records (HubSpot associations, Attio, Jobber properties) | **Blocking** for every vertical |
| **Documents** | None: no table, no storage bucket | Files on every record, templates, e-signature, expiry, portals (HubSpot, HoneyBook, Dubsado) | **Blocking** — the owner's first ask |
| **Custom fields** | 5 types: text, number, date, checkbox, single-select | 15–30 types incl. multi-select, file, phone, email, URL, currency, relation, formula (HubSpot, monday) | High |
| **Owner's language** | Dashboard English-only by design (~1,250 strings in one catalogue) | Spanish UIs from Housecall Pro, Jobber, Workiz, brightwheel, Playground | High in this market |
| **Email** | Sent via Resend; replies go to the owner's own inbox and are never recorded | Two-way sync or at least logging (HubSpot, monday, Less Annoying CRM, Copper) | High |
| **Calendar** | One in-house calendar per company, enforced by a unique constraint; no per-staff availability; Daily.co video links | Per-user calendars with two-way Google/Outlook sync and Meet/Teams links | High |
| **Money to the business's customers** | None (M7a bills BIS's clients, not their customers) | Quotes, invoices, payment links, deposits, recurring billing (Jobber, HoneyBook, Thryv) | High for trades, catering, child care |
| **AI on the record** | Calls only: summaries, proposals | Record summaries, meeting prep, drafting, ask-your-CRM, document reading (Zoho, Capsule, HubSpot Breeze) | Medium — BIS's call AI is ahead; the rest is behind |
| **Client portal** | None (the booking and form pages are public, not personal) | Portals with a public/private divider, uploads, payments (HoneyBook, Dubsado, Thryv) | Medium |
| **Mobile** | Responsive web, no installable app | Native apps everywhere; Tap to Pay needs native | Medium |
| **Roles** | admin / member | Field-level and record-level permissions (HubSpot Enterprise, daycare custody rules) | Medium, High for child care |
| **MCP** | None | HubSpot, monday, Pipedrive, Attio, Zoho, Close, HoneyBook, GoHighLevel, folk, Twenty | Medium, rising |

---

## 3. The client record — one place for everything

This is the owner's first ask and the foundation for everything else. The research
converges on four principles.

### 3.1 Four principles from the research

1. **One record, with a line between what the client can see and what they cannot.**
   HoneyBook puts everything about a job on one page and draws a divider labelled "Not
   visible to clients" above tasks, automations and private notes. That turns the portal
   (§8) into a view of the same record, not a second data model.
2. **Relationships are typed roles, shown on both sides.** Less Annoying CRM writes "Sarah
   referred Kyle" on both records; Jobber lets one customer own many properties with a
   separate billing address; Texas child-care rule §746.605 requires parents, emergency
   contacts, authorised pickups and the physician on every child's file. Capsule, which
   allows a person one organisation only, is the anti-example.
3. **Documents attach themselves and know when they expire.** Copper files Gmail
   attachments onto the record automatically. The verticals add what sales CRMs lack:
   immunisation records, insurance certificates, contractor licences and care plans all
   expire, and a daycare must keep a child's file three months after the last day.
4. **The top of the record answers "what do I need to know right now", in the owner's
   language.** HubSpot's record summary, Zoho's (English plus 22 languages) and Capsule's
   meeting prep all put a generated paragraph above the timeline.

### 3.2 Proposed data model

A sketch, in this repository's conventions — `account_id` on every row, RLS on every
table, and the same-account foreign keys migration 0050 introduced. Names avoid the two
that are taken: `accounts` is the tenant and `sites` is the website table.

| Table | Purpose | Key columns |
|---|---|---|
| `organizations` | A household, a business customer, a care facility or a referral source — anything several contacts belong to | `kind` (`household` / `business` / `facility` / `referrer`), `name`, billing address, `custom` |
| `contact_memberships` | A contact's place in an organisation | `contact_id`, `organization_id`, `role` label, `is_primary`, `is_billing` |
| `contact_relationships` | Person-to-person roles, rendered on both records | `contact_id`, `related_contact_id`, `label` (parent, guardian, child, spouse, emergency contact, authorised pickup, responsible party, caregiver, tenant, landlord, referred-by), flags `can_pick_up`, `is_emergency`, `has_custody`, `no_contact` |
| `service_locations` | Where the work happens — a property, a unit, a venue | `organization_id` or `contact_id`, address, access notes, gate code (sensitive), `custom` |
| `assets` | What is installed or served there — water heater, HVAC unit, vehicle | `service_location_id`, type, make, model, serial, installed on, warranty until, `status` (`installed` / `replaced`) — replaced units kept as history, per ServiceTitan |
| `documents` | Any file on any record | `owner_type` + `owner_id`, `storage_path`, `file_name`, `mime`, `bytes`, `sha256`, `category`, `expires_on`, `retention_class`, `client_visible`, `uploaded_by_kind` (`staff` / `client` / `system`), `source` (`upload` / `email` / `mms` / `e_sign` / `drive_link` / `onedrive_link`), `scan_status`, `extracted` jsonb, `sensitivity` (`normal` / `restricted` / `phi`), `deleted_at` |
| `document_requests` | "We still need your child's immunisation record" | `contact_id`, `category`, `due_on`, `status`, secure upload token |

Alongside the tables:

- **Custom fields grow from 5 types to about 12:** add multi-select, phone, email, URL,
  currency, long text, file, and **relation** (a field that points at another record).
  The file and relation types are what let an industry pack add "Health statement" or
  "Assigned technician" without a migration.
- **Notes, tasks and deals attach to any record**, not only a contact. A note about a
  property or a household is common in every target vertical.
- **`sensitivity` on documents from day one**, even though BIS will not store health
  information yet. It costs one column now and saves a data migration when a HIPAA mode
  arrives (§6.4).

### 3.3 The record page

Three columns on a wide screen, stacked on a phone — the layout HubSpot, monday and every
modern CRM have converged on, rebuilt on BIS's four-surface ladder and tokens.

- **Left — who they are.** Name, phones, emails, language preference, tags, the key custom
  fields, and **Relationships** as a list of role chips ("Madre de Sofía R.", "Autorizada
  para recoger").
- **Centre — what is happening.** The AI summary first (§4), then the unified timeline:
  calls with their summaries, texts, emails, notes, form submissions, bookings, documents
  added, payments.
- **Right — what they have.** Cards for **Documents** (with an "expiring soon" badge),
  **Money** (open quotes, unpaid invoices, balance), **Appointments**, **Deals**,
  **Properties and assets**, and **Organisations**.

It must pass DESIGN.md's definition of done like any other screen: tokens only, both
themes, designed empty states ("Documents you add or clients upload appear here — Add a
document"), and status never shown by colour alone.

### 3.4 Document storage, concretely

From Appendix D:

- **Supabase Storage, private bucket**, keys shaped `{account_id}/{owner_type}/{owner_id}/{uuid}`,
  RLS on `storage.objects` keyed on the tenant claim. Short-lived signed URLs (60–300 s)
  for viewing. Resumable uploads above 6 MB.
- **Malware scanning is not built into Supabase.** Upload to a quarantine prefix; a small
  ClamAV worker off Vercel scans and promotes or deletes. About one engineer-week.
- **Cost is trivial without health data:** Pro includes 100 GB, then $0.0213 per GB-month.
  Less Annoying CRM gives 25 GB per user; Salesforce Starter gives 1 GB per whole
  organisation. BIS can be generous.
- **Expiry reminders are one more automation pass** — "documents expiring in 30 days" —
  on the engine that already exists, with its quiet hours and log.
- **Retention classes** per document category, longest clock wins, with legal holds and
  a destruction log (Appendix E §6). Texas child-care floors are minimums, not deletion
  deadlines, so the default is keep, not purge.

---

## 4. AI in the CRM

### 4.1 What to add, in order of value

The evidence on what small businesses actually use (Appendix C): writing, research and
summaries lead; autonomous agents are early; 14% of people whose CRM has AI never use it
and 8% do not know it is there. So the first AI features should be **visible, on the
screen the owner already opens, and useful without configuration**.

1. **Record summary and prep, in English or Spanish.** A paragraph at the top of every
   client record: who they are, what happened last, what is open, what is due. The data
   the non-AI summary route already gathers (tags, notes, calls, messages, submissions,
   deals) is exactly the input. Zoho does this in 23 languages.
2. **Proposals everywhere.** Extend call proposals — BIS's best AI idea — to inbound
   email, text threads and uploaded documents. "The customer's email says the new
   address is 402 Nolana; update it?" This is the Pipedrive Nova pattern, and BIS has the
   table, the review UI and the accept/dismiss audit already.
3. **Document intake.** A photo or PDF becomes filled fields, shown beside the current
   values for approval: immunisation records, insurance cards, contractor licences,
   business cards, paper intake forms. Zoho shipped zero-shot extraction in Q1 2026.
   Appendix D prices this at fractions of a cent to about a cent per document.
4. **Drafting in the customer's language.** Reply suggestions in the composer that read
   the thread and write in the language the customer used, with a one-tap translation of
   the customer's message for a staff member who reads only one of the two.
5. **"Gone quiet" nudges.** folk flags conversations that have stalled and drafts the
   follow-up; BIS's automation engine and work queue are the natural home.
6. **Ask BIS.** A question box — "¿Quién no ha pagado este mes?", "Which properties have
   water heaters older than ten years?" — answering from the tenant's own rows under RLS.
7. **The MCP server** (§5.4 and item 10 above).
8. **AI review replies** — the half of M5 still owed.

### 4.2 Three design rules

- **The human approves every write.** It is what small businesses told Pipedrive they
  want ("a thinking partner, not an autopilot"), it is what BIS already does for calls,
  and it is the safest possible answer for an MCP server. Make it the house rule.
- **Bilingual by default.** Every generated sentence follows the reader's language
  preference, not the system's.
- **Bundle the cost; do not sell credits.** HubSpot, Attio and Zoho make AI a second
  meter; Nutshell's model — unlimited light assists plus a pool of heavy jobs — is the one
  small businesses do not resent. M7a already meters voice, SMS and chat; summaries and
  drafting should ride inside the plan.

### 4.3 What not to do yet

Autonomous outbound agents that call or email leads on their own (Close's Chloe) are real
and impressive, but English-only today, early in adoption, and a reputational risk for a
local business whose name is on every call. BIS's inbound receptionist is the right half
of that idea to own first.

---

## 5. Google Workspace and Microsoft 365

### 5.1 The finding that shapes the plan

**Almost everything a small business wants from Google fits inside a free verification
review; one thing does not.** Verified against Google's own scope tables on 2026-09-25:

| Capability | Google scope | Class | Needs |
|---|---|---|---|
| Two-way calendar sync, Meet links | `calendar.events` | sensitive | Verification review, 1–3 weeks, no fee |
| Availability | `calendar.freebusy` | sensitive | same review |
| Send as the owner's Gmail | `gmail.send` | **sensitive** | same review |
| Contacts sync | `contacts` | sensitive | same review |
| Attach a Drive file | `drive.file` + Google Picker | non-sensitive | nothing extra |
| **Read the inbox, or even its headers** | `gmail.readonly`, `gmail.metadata` | **restricted** | **CASA security assessment by a paid lab, every year: roughly $540–$4,500+ and weeks to months** |

On Microsoft's side the gate is consent, not an audit. Verified against Microsoft's
Entra documentation (updated 2026-08-28): new tenants default to "Let Microsoft manage
your consent settings", which **blocks ordinary users from granting `Calendars.Read`,
`Calendars.ReadWrite`, `Mail.Read`, `Contacts.ReadWrite`, `OnlineMeetings.ReadWrite`
and `Files.Read.All`**. `Mail.Send` and `Files.Read` (a user's own files) remain
consentable. So Outlook calendar sync needs the business's Microsoft 365 admin to approve
once — at a five-person business that is usually the owner — and onboarding should
include an "approve for your company" link. Publisher verification is free and takes
days.

### 5.2 The sequence

1. **Now, no gate:** a per-business inbound address. The owner BCCs or forwards it, and
   replies to mail BIS sent come back to it; either way the message lands on the right
   client's timeline. Resend already offers inbound receiving. This closes the one-way
   email gap without touching Gmail's restricted scopes.
2. **Week 1: submit both verifications.** One Google submission covering every
   sensitive scope BIS will want — adding one later triggers a new review — and Microsoft
   publisher verification.
3. **Weeks 2–8: calendar first.** Per-staff calendars (a schema decision, §10),
   two-way sync for both providers, availability from real busy times, Meet and Teams
   links on bookings, send-as-me email, and the Drive and OneDrive pickers.
4. **Only when customers ask for full inbox sync:** use the Nylas shared Google app,
   which carries the CASA assessment itself (the consent screen then says "Nylas"), rather
   than running CASA in-house. Then a Gmail add-on and an Outlook add-in, so the client
   record appears beside the email — Copper's best idea. The Gmail add-on's contextual
   scopes are sensitive, not restricted.

### 5.3 Why per-staff calendars come first

The calendar schema enforces **one calendar per company** (`calendars_one_per_account`),
with one set of open hours, by an explicit spec decision. That was right for the first
client. It cannot serve a plumbing shop with three technicians, a salon with four stylists,
or a daycare director who gives tours while a teacher runs parent conferences — and it
means there is no "whose Google calendar" to sync. Relaxing it is the prerequisite for
§5.2 step 3 and needs the owner's decision, because it reverses a recorded one.

### 5.4 The MCP server

HubSpot's went GA on 13 April 2026, Pipedrive's on 30 June, and monday, Attio, Zoho,
Close, HoneyBook, GoHighLevel, folk and Twenty all ship one. Clerk — BIS's auth — supports
the MCP OAuth flow in Next.js directly. The forward-looking version for BIS: **read tools
answer immediately; write tools create call-proposal-style proposals the owner approves
in BIS.** Nobody else ships that, and it is the difference between "let ChatGPT edit my
customer list" and "let ChatGPT suggest changes I check at 7 a.m."

---

## 6. Industry packs

Each pack is a blueprint extended with document categories, relationship labels, an
automation set and a Sofía script, on top of the platform features above. Appendix E has
the full ten-must-have and five-do-not-build lists per vertical, with Texas citations.

### 6.1 Plumbers and home services — first

- **Records:** customer → properties → equipment, with install dates, warranties and
  replaced-unit history.
- **Flow:** request → quote with good/better/best options → e-signed approval → visit →
  invoice → payment link; **service agreements** that create visits and bill on a
  schedule.
- **Texas specifics:** TDLR and TSBPE licence numbers and required disclosures on quotes
  and invoices; a tax class per line (residential repair versus taxable real-property
  service).
- **Already in BIS:** booking, quote follow-ups, review requests, the receptionist. Jobber
  prices its AI receptionist at $29 a month for 30 conversations — BIS's advantage is
  Spanish and the bundle, not price.
- **Do not build:** route optimisation, truck inventory, payroll, financing, full
  dispatch for 10-plus-technician shops.

### 6.2 Child day care — second

- **Records:** household → child → guardians with custody or no-contact flags, emergency
  contacts, **authorised pickups with ID capture**, physician, allergies and an allergy
  plan (§746.605).
- **The enrollment CRM** is the opening: inquiry → tour (Sofía books it) → waitlist by
  room, age and start date → registration packet e-signed → enrolled. brightwheel's CRM
  is announced as "coming soon"; Playground's Camber already logs inquiries.
- **Documents:** enrollment agreement, admission information, health statement,
  immunisations with expiry reminders, incident reports with a 48-hour parent signature.
  Keep at least three months after the last day (§746.603).
- **Money:** tuition autopay, sibling and multi-payer splits, and a separate line for the
  parent's share of cost under the TWC child care scholarship.
- **Permissions:** teacher versus director versus non-custodial parent — field-level
  access matters here more than anywhere else.
- **Do not build:** classroom operations, ratios, daily photo reports, CACFP claiming,
  curriculum, and subsidy attendance kiosks (those need KinderSystems certification).
  Integrate with brightwheel, Procare or Playground instead.

### 6.3 Restaurants — third

- **Records:** guest profile with visits, spend, favourite items, **allergy and dietary
  tags treated as sensitive**, birthdays and occasions; catering clients as organisations.
- **Where BIS earns its place:** the **catering and private-events pipeline** — inquiry
  form → quote or BEO → e-sign → deposit schedule → final invoice, with Texas's gratuity
  labelling — and the bilingual phone answering for hours, menu, allergens and catering
  leads.
- **Do not build:** POS, online ordering, table management, loyalty points, gift cards.
  Sync guests from Toast, Square or Clover instead.

### 6.4 Adult day care — only with a HIPAA decision

Adult day care runs on health information: care plans, medications, physician orders,
Medicaid authorisations and DAHS forms 3050, 3055, 3682 and 3683. A CRM that stores that
is a HIPAA business associate, and Texas law adds a US-data-residency rule for electronic
health records. From Appendix D:

- **Resend cannot sign a Business Associate Agreement at all**, so no health information
  may ever travel in a BIS email.
- **Clerk signs one only on Enterprise.** Supabase needs the Team plan ($599 a month)
  plus its HIPAA add-on. Vercel's BAA is a $350-a-month add-on. Telnyx relies on the
  conduit exception, which does not cover stored transcripts.
- **Floor: about $1,300 a month before the first adult-day customer pays anything.**

**Recommendation: do not market to adult day care or medical offices until one anchor
customer justifies that floor.** Build the document vault with the `sensitivity` column
now, so a "PHI mode" — segregated storage, BAA-covered AI only, secure links instead of
email bodies, access and destruction logs — can be switched on later without a
migration. Also do not build eMAR, EVV (Texas requires a certified vendor), claims
submission or caregiver scheduling in any case.

### 6.5 Others worth a pack later

Salons and spas (prepaid packages and a portal showing sessions left — Thryv's model), auto
repair (vehicles as assets, digital inspections with photos), insurance agencies (policy
renewals as expiring documents), and legal practices (matters as organisations, Clio as
the integration).

---

## 7. What HubSpot and monday.com teach

Appendices A and B go through both products line by line — HubSpot's per-tier catalogue
runs to about 850 rows. This section keeps what changes BIS's plan.

### 7.1 Side by side, on the owner's three asks

| | HubSpot | monday CRM | What BIS should do |
|---|---|---|---|
| **One screen per client** | Three-column record: properties left, summary and timeline centre, associations, attachments, Drive and SharePoint cards right. Free plan shows **only the last 30 days** of timeline | A widget grid ("item card") that an admin must design per board | HubSpot's layout, pre-built per industry, full history on every plan (§3.3) |
| **Relationships** | Association labels ("Parent", "Billing payer") — **Professional and up** | Connect and mirror columns; accounts grouped by email domain | Typed relationships on every plan, shown on both records (§3.2) |
| **Documents** | Four separate stores (files, attachments, sales documents, file properties) with limits from 20 MB to 2 GB; **files public on a CDN by default**; no expiry tracking | Files column with preview, annotations, zip download; versioning is a "trial feature"; 5–1,000 GB by plan | One private vault with typed categories, expiry, versioning and a required-documents checklist (§3.4, §7.2) |
| **E-signature** | Quotes only, **Revenue Hub Professional**, 25 signatures per user per month, via Dropbox Sign | No native legally-tracked signature; DocuSign or PandaDoc on Pro | Any document, every plan, with an audit trail (item 7) |
| **Client portal** | Support portal shows **tickets only**; a billing portal in beta on Revenue Pro | None in the CRM; guests per board | One portal over the same record (§8) |
| **AI** | Breeze: record summaries, notetaker, agents billed per outcome ($0.50 per resolved conversation), credits at $0.01 | Credits at $0.01: 8 per AI action, 120 per notetaker hour; one-time 6,000-credit trial | Summaries and drafting bundled; proposals for every write (§4) |
| **MCP** | `mcp.hubspot.com`, every tier including Free | `mcp.monday.com`, 60+ tools, every plan | Read tools plus proposal-only writes (§5.4) |
| **Google and Microsoft** | Two-way calendar sync but **only the first event of a recurring series**, primary calendar only; Gmail and Outlook logging; Teams app rated 3.2★ | Two-way calendar in the CRM; board-level Outlook needs **M365 Business Premium** | Two-way sync that handles recurring events and shared calendars, with no licence requirement (§5) |
| **Price for a 4-person shop** | Starter bundle $20/seat list; Pro seats $90–150; Marketing Pro $800+/month plus $3,000 onboarding | 3-seat minimum, then buckets of 5: four people pay for five | Priced per business, not per seat, as in the pricing study |
| **Spanish** | UI in 15 languages; AI brand voice in 5 beyond English | UI in 14 languages; quotes change format but are not translated | Spanish first-class in the UI, the AI, the documents and Sofía (§1 item 3) |

### 7.2 Ideas to adopt that the draft plan lacked

Reading both inventories against §1–§6 surfaced eight ideas worth adding. Each is folded
into the roadmap in §9.

1. **A required-documents checklist per record.** An industry pack declares what a
   complete file holds — for a Texas child, nine items from §746.603 — and the record
   shows "7 of 9" with the missing ones named. It combines HubSpot's completeness score
   with monday's "you cannot mark Enrolled without these files" validation, and neither
   product does it for compliance.
2. **Stage rules that require documents.** A job cannot move to *Done* without photos
   and an invoice; a child cannot move to *Enrolled* without immunisations and emergency
   contacts. monday gates this at Pro; BIS should make it standard.
3. **Document templates with live fields.** Enrolment agreements, service contracts and
   catering event sheets that fill themselves from the record and export to PDF — monday
   docs' `{field}` merge and Pipedrive's Smart Docs. Pairs with e-signature in item 7.
4. **An email address per record**, not only per business. Forward a doctor's note or a
   customer's photo from any phone straight onto the right child or job — monday's
   email-to-item.
5. **Log by any address on the household.** An email from either parent lands on the
   family and on each child; monday matches on linked records, and HubSpot logs everything
   by default with never-log lists for vendors and personal mail.
6. **Custom activity types on the timeline** — service call, inspection, tasting,
   incident report, parent conference — so the timeline speaks the industry's language.
7. **An in-person notetaker.** HubSpot's Mobile Notetaker and monday's turn a tour, a
   kitchen walk-through or a job-site walk-around into a summary and proposed updates.
   For BIS it is call proposals with a phone microphone instead of a phone line.
8. **Ask BIS by text message.** monday's sidekick answers over WhatsApp; BIS already has
   Telnyx two-way SMS and the owner's verified alert phone. "¿Qué tengo mañana?" answered
   by text, read-only, fits owners who never sit at a desk better than any dashboard.

### 7.3 Where both leave room for BIS

- **Regulated data is priced out of reach.** HubSpot allows children's and health data
  only under Enterprise Sensitive Data; monday's HIPAA support is Ultimate-only. A
  compliant child-care file at small-business prices is open ground, and it needs no
  HIPAA because Texas child-care records are not PHI.
- **Both are English-first in the parts that matter to a Valley customer**: HubSpot's
  full support covers six languages and its SMS is US-only; monday's phone and outreach
  agents are US-only in four languages, and its quotes are not translated.
- **Both charge per seat and gate the basics.** HubSpot's own list prices jump from $20 a
  seat to $800 a month plus onboarding; monday's four-person shop pays for five. Neither
  gives a front-desk person a full seat for free.
- **Neither is built for service operations.** No property or equipment history, no
  enrolment waitlist, no incident workflow, no Google Business Profile reviews in
  HubSpot at all. That is precisely what the industry packs add.

---

## 8. The client portal

Built once the vault (§3.4) and money (item 7) exist, as a **view of the same record**
filtered by `client_visible`, not a second data model:

- **Home is "what you owe us and what we need from you"** — open invoices, unsigned
  documents, requested uploads (Dubsado's model).
- **Upload, sign, pay, book** without calling.
- **Prepaid packages and sessions left** for salons, tutoring and trainers (Thryv).
- **Bilingual, on a phone, with no password to remember** — a magic link by text or email
  rather than a login, both because this market lives on phones and because every portal
  login would otherwise be a paid Clerk user. (Decision for §10.)
- **Never a place for health information** until PHI mode exists.

---

## 9. The roadmap

Engineer-weeks for one engineer; a second engineer roughly halves calendar time for the
parallel tracks.

| Phase | Weeks | Build | Depends on |
|---|---|---|---|
| **0 — Decide** | this week | The six decisions in §10. Submit Google verification and Microsoft publisher verification. Apply for Google Business Profile API access (it needs a verified profile active 60+ days). | — |
| **1 — The record** | 1–6 | Relationships, organisations, properties and assets; more field types; notes, tasks and deals on any record; the document vault with scanning, expiry reminders and retention; the inbound email address; the AI summary; the Spanish dashboard begins | — |
| **2 — The owner's tools** | 6–12 | Per-staff calendars; Google and Outlook two-way sync; Meet and Teams links; send-as-me; Drive and OneDrive pickers; proposals from email, texts and documents; document intake AI | Phase 0 verifications, the per-staff decision |
| **3 — Money and the portal** | 10–18 | Quotes with options and e-signature; invoices, payment links, deposits and recurring billing through Stripe Connect; the client portal; QuickBooks push sync | Phase 1 vault |
| **4 — Packs and reach** | 14–22 | Home services pack; child care pack with field-level permissions; the MCP server; AI review replies and Google Business Profile reviews; restaurant pack | Phases 1–3 |
| **Later, on demand** | — | PHI mode and the adult day pack; full inbox sync through Nylas; Gmail add-on and Outlook add-in; an installable mobile app with Tap to Pay | A paying customer asking |

Every phase ships to a real client before the next starts, as the platform spec already
requires, and every UI item goes through DESIGN.md's definition of done.

---

## 10. Decisions only the owner can make

1. **Per-staff calendars.** Relaxing one-calendar-per-company reverses a recorded spec
   decision. Recommended: yes, before any Google or Outlook work.
2. **HIPAA.** Now, later, or never. Recommended: later, on an anchor customer; build the
   `sensitivity` column now.
3. **A Spanish dashboard.** Recommended: yes, and soon — it is the cheapest way to make
   "bilingual" true end to end, and the message catalogue is already in one file.
4. **Payments for the business's customers.** Stripe Connect with Stripe setting the
   fees costs BIS nothing per account; the alternative is QuickBooks-only invoicing.
   Recommended: Stripe Connect, QuickBooks as a sync target.
5. **Full inbox sync.** Pay for the Nylas shared app (and show "Nylas" on the consent
   screen), run the CASA assessment in-house, or rely on the inbound address. Recommended:
   the inbound address until customers ask.
6. **Portal sign-in.** Magic links versus Clerk accounts. Recommended: magic links.

---

## 11. Closing the one gap in this research

Appendices A and B describe HubSpot and monday.com as their vendors publish them. To
compare them against **how BIS's own HubSpot and monday.com accounts are actually set up**
— which pipelines, properties, boards and automations exist — connect the official
HubSpot and monday.com connectors at <https://claude.ai/customize/connectors> and start a
new session. Both vendors publish MCP connectors, so a future session can read those
accounts directly and diff them against this plan.

---

## 12. Sources

Every factual claim in this document is sourced in Appendices A–E, which cite vendor
pricing pages, knowledge-base articles, developer documentation and primary Texas and
federal regulations inline. Two load-bearing integration claims were re-verified against
primary sources on 2026-09-25:

- Google Gmail scope classes — <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Microsoft Entra default user-consent policy —
  <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies>

Repository facts were read from `main` @ `c9f8454` on 2026-09-25.
