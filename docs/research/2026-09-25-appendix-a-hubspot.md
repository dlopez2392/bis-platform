# Appendix A — HubSpot, feature by feature (September 2026)

Part of `2026-09-25-crm-feature-research.md`. Compiled 2026-09-25 by a delegated research agent in two passes over HubSpot's live pricing comparison tables, its Product & Services Catalog (about 850 per-tier rows), the Spring and Fall 2026 Spotlight releases, the knowledge base, developer docs and Marketplace listings. Built from published sources, not from a logged-in account. Secondhand claims marked [2H]; the researcher's own judgements marked (analysis).

---

# HubSpot feature inventory, September 2026
*Prepared for a team building a competing CRM for plumbers, restaurants, and child and adult day care. Research date: 2026-09-25.*

## 0. How to read this report

**Method.** I did two passes.
- **Pass 1** covered:
  - The live "Compare features" tables on every pricing page. I read the HTML directly so that checkmark icons were captured; the markdown versions leave those cells blank.
  - The full **HubSpot Product & Services Catalog** at legal.hubspot.com. It turned out to be the most complete source, because it is a per-tier table for every Hub.
  - The Fall 2026 and Spring 2026 Spotlight release pages.
  - Knowledge-base articles, developer docs, and Marketplace listings.
- **Pass 2** re-checked the catalog's full row list (about 850 rows) and the knowledge-base section indexes for CRM, Data, Service, Sales, Revenue and Automation against what I had covered. It added the missing items: file limits, portals, legacy quotes, email logging rules, calendar sync rules, industry objects, and the credit rate sheet.

**Limits of what I could check.**
- My web-search budget ran out partway through Pass 2. After that I used Firecrawl and direct fetches.
- **[2H]** means the claim comes only from a secondhand source (blogs, reviews, search summaries) and I could not confirm it on a HubSpot page.
- Anything marked **(analysis)** is my own judgement, not HubSpot's claim.

**Tier codes.** F = Free, S = Starter, P = Professional, E = Enterprise. "S+" means Starter and above.

**Source legend.** Each row cites one of these codes.

| Code | URL |
|---|---|
| CAT | https://legal.hubspot.com/hubspot-product-and-services-catalog (per-tier catalog, credit rate sheet, add-ons, technical limits) |
| P-CRM | https://www.hubspot.com/pricing/crm |
| P-MKT | https://www.hubspot.com/pricing/marketing |
| P-SAL | https://www.hubspot.com/pricing/sales |
| P-SVC | https://www.hubspot.com/pricing/service |
| P-CMS | https://www.hubspot.com/pricing/content |
| P-DATA | https://www.hubspot.com/pricing/data (formerly /operations) |
| P-REV | https://www.hubspot.com/pricing/revenue (formerly /commerce) |
| P-SUITE | https://www.hubspot.com/pricing/suite (Customer Platform) |
| P-SCRM | https://www.hubspot.com/pricing/smart-crm |
| CRED | https://www.hubspot.com/products/artificial-intelligence/credits |
| OBP | https://www.hubspot.com/company-news/hubspots-customer-agent-and-prospecting-agent-now-you-pay-when-the-task-is-complete |
| F26 | https://www.hubspot.com/company-news/fall-26-spotlight |
| SPOT | https://www.hubspot.com/spotlight (Fall 2026: 134 updates) |
| SPR26 | https://www.hubspot.com/spotlight/spring2026 |
| AGH | https://www.hubspot.com/products/artificial-intelligence (Agent Hub) |
| AIT | https://www.hubspot.com/ai-tools |
| CLD | https://www.hubspot.com/claude/connector |
| MCP | https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server |
| MCP2 | https://developers.hubspot.com/docs/build-with-ai/remote-mcp-server |
| OBJ | https://developers.hubspot.com/docs/api-reference/latest/crm/using-object-apis |
| UIX | https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/overview |
| EMBED | https://developers.hubspot.com/docs/api-reference/legacy/crm/embed |
| DEVIDX | https://developers.hubspot.com/docs/llms.txt |
| KB-OBJ | https://knowledge.hubspot.com/records/understand-objects |
| KB-DMB | https://knowledge.hubspot.com/data-management/use-the-data-model-builder |
| KB-DMT | https://knowledge.hubspot.com/data-management/data-model-templates |
| KB-PROP | https://knowledge.hubspot.com/account/property-field-types-in-hubspot |
| KB-CARDS | https://knowledge.hubspot.com/records/use-cards-on-records |
| KB-LAYOUT | https://knowledge.hubspot.com/object-settings/customize-the-middle-column-of-records |
| KB-ASSOC | https://knowledge.hubspot.com/records/associate-activities-with-records |
| KB-ATT | https://knowledge.hubspot.com/records/add-and-remove-attachments-from-records |
| KB-FILES | https://knowledge.hubspot.com/files/upload-files-to-use-in-your-hubspot-content |
| KB-FTYPES | https://knowledge.hubspot.com/files/supported-file-types |
| KB-FVIS | https://knowledge.hubspot.com/files/organize-edit-and-delete-files |
| KB-DOCS | https://knowledge.hubspot.com/documents/use-documents |
| KB-ESIG | https://knowledge.hubspot.com/quotes/use-e-signatures-with-quotes |
| KB-Q | https://knowledge.hubspot.com/quotes/understand-how-quotes-work-in-hubspot |
| KB-LQ | https://knowledge.hubspot.com/quotes/use-quotes-legacy |
| KB-PORTAL | https://knowledge.hubspot.com/inbox/set-up-a-support-portal |
| KB-INBOX | https://knowledge.hubspot.com/connected-email/connect-your-inbox-to-hubspot |
| KB-LOG | https://knowledge.hubspot.com/connected-email/manage-contact-email-logging-rules |
| KB-NEVER | https://knowledge.hubspot.com/connected-email/add-emails-and-domains-to-the-never-log-list |
| KB-CHR | https://knowledge.hubspot.com/connected-email/track-and-log-emails-with-the-hubspot-sales-chrome-extension |
| KB-CHRP | https://knowledge.hubspot.com/connected-email/use-contact-profiles-with-the-hubspot-sales-chrome-extension |
| KB-O365 | https://knowledge.hubspot.com/connected-email/track-and-log-emails-with-the-hubspot-sales-office-365-add-in |
| KB-ODESK | https://knowledge.hubspot.com/connected-email/get-started-with-the-outlook-desktop-add-in |
| KB-CAL | https://knowledge.hubspot.com/integrations/use-hubspots-integration-with-google-calendar-or-outlook-calendar |
| KB-CALC | https://knowledge.hubspot.com/meetings-tool/use-meetings |
| KB-SCHED | https://knowledge.hubspot.com/meetings-tool/create-and-edit-scheduling-pages |
| KB-GMEET | https://knowledge.hubspot.com/integrations/use-hubspots-integration-with-google-meet |
| KB-TEAMSREC | https://knowledge.hubspot.com/integrations/sync-microsoft-teams-meeting-recordings-and-transcripts-to-hubspot |
| KB-TEAMS | https://knowledge.hubspot.com/integrations/connect-hubspot-and-microsoft-teams |
| KB-GDRIVE | https://knowledge.hubspot.com/integrations/connect-google-drive-to-hubspot |
| KB-SP | https://knowledge.hubspot.com/integrations/add-and-use-sharepoint-and-onedrive-files-in-hubspot |
| KB-GCON / KB-OCON | https://knowledge.hubspot.com/integrations/connect-hubspot-and-google-contacts ; …/connect-hubspot-and-outlook-contacts |
| KB-WFA | https://knowledge.hubspot.com/workflows/choose-your-workflow-actions |
| KB-WFT | https://knowledge.hubspot.com/workflows/set-your-workflow-enrollment-triggers |
| KB-AH | https://knowledge.hubspot.com/ai/understand-breeze |
| KB-ENR | https://knowledge.hubspot.com/ai-tools/get-started-using-breeze-intelligence |
| KB-LANG | https://knowledge.hubspot.com/account/hubspot-language-offerings |
| MK-GMAIL | https://ecosystem.hubspot.com/marketplace/listing/gmail |
| MK-TEAMS | https://ecosystem.hubspot.com/marketplace/listing/microsoft-teams-221635 |
| MK-EXP | https://ecosystem.hubspot.com/marketplace/explore (install counts) |
| MOB | https://www.hubspot.com/products/mobile |
| TOS | https://legal.hubspot.com/terms-of-service |

---

## 1. What changed since 2025: 14 headline facts

1. **Renames.**
   - Operations Hub is now **Data Hub**, announced at INBOUND 2025 (P-DATA; https://www.cmswire.com/digital-marketing/hubspot-unveils-data-hub-breeze-agents-and-the-loop-at-inbound-2025/).
   - Commerce Hub is now **Revenue Hub**. Its seat is the "Revenue Seat (previously Commerce Seat)" (CAT). The rename happened around June 2026 [2H] (https://www.onthefuze.com/hubspot-insights-blog/what-is-hubspot-revenue-hub).
   - INBOUND is now **UNBOUND**, held September 16–18, 2026 in Boston [2H] (https://www.trooinbound.com/blog/hubspots-unbound-2026/).
2. **The Free CRM got much smaller.**
   - Up to **1,000 contacts** and 2 users (P-CRM FAQ; CAT).
   - Up to 1M records for each other standard object.
   - **The record timeline shows only the past 30 days.**
   - **10 custom properties in total.**
   - 1 pipeline per object.
   - No calling minutes (CAT).
3. **Starter is sold only as a bundle.** Every Hub's pricing page now sells a single "Starter Customer Platform" (all five Starter Hubs). List price is $20/seat/month (CAT). A current promotion shows **$7/seat/month**, "Save up to 65% … New customers only … limited time" (P-CRM).
4. **Seat-based pricing.** There are Core, Sales, Service and **Revenue** seats. View-only and Partner seats are free (CAT).
5. **HubSpot Credits power most AI.** Credits cost $0.01 each ($10 per 1,000; $9 per 1,000 on annual billing, per P-SUITE). Included credits: 500 on Starter, 3,000 on Pro, 5,000 on Enterprise. Data Hub and Customer Platform include 5,000 on Pro and 10,000 on Enterprise (CAT).
6. **Agents now bill by outcome** (effective April 14, 2026):
   - Customer Agent costs **50 credits ($0.50) per resolved conversation**, down from $1 per conversation.
   - Prospecting Agent costs **100 credits ($1) per recommended lead**, replacing a monthly charge per enrolled contact (OBP).
7. **New quoting requires Revenue Hub Pro.** Accounts created after **September 3, 2025** cannot use legacy quotes. New quoting needs a **Revenue Hub Pro/Ent seat** (KB-LQ, KB-Q).
8. **Agent Hub, Agent Builder, and HubSpot Work (beta).** HubSpot Work is an AI work-management layer for projects, documents, forms and "work agents" (CAT; SPOT).
9. **Fall 2026 Spotlight (September 16, 2026)** added:
   - A rebuilt **Breeze Assistant** that hands work to agents.
   - A **self-updating CRM** that captures calls, email and meetings automatically.
   - **Context Home**, a view and completeness score for what HubSpot knows about the business.
   - **Marketing Studio**.
   - **ChatGPT Ads** (beta) and **Microsoft Advertising** channels.
   - A **Mobile Notetaker** (F26).
10. **Email logging is now "log all emails" by default.** Every email with an existing contact logs, including mail sent from outside the CRM. "Create new contacts from email" is in beta (KB-LOG).
11. **A remote MCP server at `https://mcp.hubspot.com`** powers official connectors for **Claude, ChatGPT, Gemini and Microsoft Copilot**. The Claude connector works on every HubSpot tier, including Free (MCP, AIT, CLD).
12. **Date-versioned APIs.** Endpoints now look like `/crm/objects/2026-09/...`. From September 8, 2026, admin-configured validation rules are enforced on every CRM API write (OBJ).
13. **Industry objects** (Appointments, Courses, Listings, Services) are switched on in the Data Model Builder. An **AI data-model recommender** builds objects and pipelines from a description of the business; its example is a landscaping company (KB-DMB, KB-DMT).
14. **Customer portal → "support portal".** It shows tickets only, on Service Pro+ (KB-PORTAL). A **Billing Portal (beta)** is part of Revenue Hub Pro/Ent (CAT).

---

## A. Smart CRM core

### A1. Objects (HubSpot's data model, 2026)
Object type IDs come from OBJ. Descriptions and tier requirements come from KB-OBJ, KB-DMB and CAT.

| Object | Type ID | What it is | Tier / activation |
|---|---|---|---|
| Contacts | 0-1 | People; deduplicated by email | F+ (Free capped at 1,000) |
| Companies | 0-2 | Organizations; deduplicated by domain | F+ |
| Deals | 0-3 | Opportunities in pipelines | F+ (1 pipeline on F; 15/100/350 pipelines across all objects on S/P/E) |
| Tickets | 0-5 | Support requests in pipelines | F+ |
| Leads | 0-136 | Pre-deal qualification tied to contact(s)/company | **Sales Hub Pro/Ent** (KB-OBJ) |
| Products | 0-7 | Product library | F: 100; S: 1M; P/E: 15M |
| Line items | 0-8 | Product instances on deals, quotes and invoices | F+ |
| Quotes | 0-14 | Formal estimates, always tied to a deal | Revenue Hub P/E seat (new accounts) |
| Invoices | 0-53 | Bills; payable via checkout | F+ |
| Payments | 0-101 | Payment records | Needs a connected payments account |
| Subscriptions | 0-69 | Recurring billing | F+ |
| Orders | 0-123 | Confirmed purchases (Revenue Hub creates them from contracts; beta) | F+ via sync; Revenue P/E |
| Carts | 0-142 | Ecommerce carts, including abandoned | Via integrations |
| Contracts | n/a | Agreements that track ACV/ARR/MRR, changes and renewals | S+ (CAT) |
| Discounts / Fees / Taxes | 0-84 / 0-85 / 0-86 | Pricing components | Commerce |
| Appointments | 0-421 | "An encounter or service for an individual" | **A Super Admin must switch it on** |
| Courses | 0-410 | Educational programs; track enrolled students | Switched on by a Super Admin |
| Listings | 0-420 | Property or unit to buy, sell or rent | Switched on by a Super Admin |
| Services | 0-162 | Intangible offerings (repairs and maintenance, personal care, consulting) with pipelines | Switched on by a Super Admin |
| Projects | 0-970 | Project records with pipelines and tasks | F+ (CAT "Projects") |
| Marketing events | 0-54 | Webinars and events | F+ |
| Campaigns | n/a | Grouped marketing assets | Marketing P+ (management) |
| Feedback submissions | 0-19 | Survey responses | Service P+ |
| Goals | 0-74 | Quota and goal targets | S+ |
| Users | 0-115 | HubSpot users as records (custom user properties on Ent) | F+ |
| Conversations | n/a | Inbox and help-desk threads | F+ |
| Custom objects | 2-XXX | Any business entity | **Enterprise only.** 10 definitions and 1M records (Mktg/Sales/Service/Content Ent). Data Hub Ent: 20 definitions and 1.5M records. Revenue Hub Ent: 10 definitions and 1.5M records. Up to 9 defined associations per custom object type (CAT) |
| App objects | n/a | Objects created by installed apps; usable in workflows, segments and reports | F+; 3M records per account (CAT) |

**Activities (engagements):**
- Calls 0-48, Emails 0-49, Meetings 0-47, Notes 0-46, Tasks 0-27, Postal mail 0-116 (OBJ).
- Communications 0-18 covers SMS, WhatsApp, LinkedIn and custom channels (KB-OBJ).
- Activities shown in the data model: calls, emails, LinkedIn messages, meetings, notes, postal mail, SMS, tasks and WhatsApp messages (KB-DMB).

**Other data-model features:**
- **Renaming objects:** objects can be renamed (for example, "account" instead of "company") (KB-OBJ).
- **Recycle bin:** deleted records can be restored for **90 days** (OBJ).
- **Record ID on merge:** "Primary ID Preservation for Merged Records" is a public beta (OBJ).

### A2. Associations and association labels

| Feature | Tier | Limits | Source |
|---|---|---|---|
| Associations (any record to any record or activity) | F+ | Free: 10,000 per association type per record. Paid: 250,000. Exceptions: ≤1,000 records per engagement; ≤1,000 contacts, companies or tickets per deal; ≤10,000 line items per deal; ≤10,000 deals per contact; ≤100 quotes per deal; ≤1,000 form submissions per contact | CAT |
| Association labels (named relationships, e.g. "Billing contact") | **P+** | Up to 50 labels per object pair | CAT |
| Automatic activity association | F+ | An activity logged on a contact also attaches to the contact's **primary company** and **up to 5 most recent open deals**. Configurable by a Super Admin | KB-ASSOC |
| Data Model Builder (visual map, usage stats, object activation, AI recommendations) | S+ for recommendations | n/a | KB-DMB, KB-DMT |
| Centralized data model management (objects, properties, associations in one place) | New in Fall 2026 | n/a | SPOT |

### A3. Properties and property types (KB-PROP)

| Type | What it holds | Limits and tier |
|---|---|---|
| Single-line text | Short text | ≤65,536 characters |
| Multi-line text | Long text | ≤65,536 characters |
| Phone number | Auto-formatted with country code | n/a |
| Single checkbox, multiple checkboxes, dropdown, radio select | Choice fields | ≤5,000 options or 512 KB; 3,000 characters per option. CAT separately lists a 1,000-values-per-picklist limit |
| Date picker; date-and-time picker | Dates | Account time zone is used for filtering |
| Number | Formatted, unformatted, percentage or currency | Multiple currencies: 5 (S), 30 (P), 200 (E) (CAT) |
| **Calculation** | Equations over record or associated data | **P+**; 40 (P), 200 (E); +25 per add-on, up to 500 (CAT) |
| **Rollup** | Min/max/count/sum/average of associated records | Counts as a calculated property |
| **Property sync** | Copies a value from an associated record | P+ |
| Score | Lead or health scores | Lead scoring P+; health scores Service P+ |
| **File** | Files stored in a property | **Up to 10 files per property.** 20 MB (free) or 50 MB (paid) per file on records; **100 MB via forms** |
| HubSpot user | User picker | n/a |
| URL, Email, Rich text | Links, email addresses, formatted text | Rich text ≤64 KB |
| Custom properties (count) | n/a | **F: 10 in total.** S/P/E: 1,000 per object. Add-on +500 for $220/month, up to 3,000 (CAT) |
| Required fields | Mandatory fields when certain actions are taken | S+ (CAT) |
| Validation rules | Rule-based field validation | Enforced on all API writes from API version 2026-09 (OBJ) |
| Sensitive / Highly Sensitive property flags | Protected data fields | **Enterprise** Sensitive Data (CAT) |
| Smart properties (AI-filled) | AI-researched answers | S+; 10 credits per record per prompt (CAT) |

### A4. Record page layout (the "Client 360" canvas)

The record page has three areas (KB-LAYOUT):
- **Left sidebar:** the "About"/Information property card, plus conditional custom cards.
- **Middle column:** tabs. **Overview** shows data highlights and recent activity. **Activities** is the timeline and cannot be edited or deleted. Custom tabs can be added.
- **Right sidebar:** association cards (companies, deals, leads, tickets and so on), **Attachments**, integration cards such as Google Drive and SharePoint, and app cards.

**Customization limits:**
- Starter: up to **10 custom tabs** (CAT).
- Pro/Ent: **1,000 team views** across record pages and preview sidebars, 50 index views per user (CAT).
- Up to 50 cards per view (KB-LAYOUT).
- Conditional display of tabs and cards on S+ (KB-LAYOUT).
- The KB article says 5 tabs per view, which conflicts with the catalog's 10. I report the catalog figure.

**Card library** (KB-CARDS):
- Activities; Activity totals.
- Association label list; Association property list (≤24 properties); Association table (with quick filters); Associations (preview); Association stage tracker.
- Average NPS (Service P/E); CSAT (Service P/E).
- Billing cards (billing contact, tax IDs, payment methods).
- **HubSpot agents card** (run an agent from the record; S+; credits).
- AI insight cards (Overview, Health, Data quality).
- Company summary (P/E); Customer lifetime value (P/E); Revenue attribution (P/E).
- Data highlights (4 properties); Property list (≤50 in sidebars, ≤24 in the middle column).
- Deal Insights (Sales P/E seat).
- Event data (custom/app events charted); Marketing events.
- Memberships access (Content P/E).
- Property date tracker; Property history graph.
- Quick actions; Report (single-object report filtered to the record); Statistics; Stage tracker.
- Tasks (Projects only).
- Breeze record summary; Attachments; app cards built with UI extensions (UIX).

**Other record-page features:**
- **Object tags:** rule-based colored tags on board, table and record views. 20 (S), 40 (P), 80 (E) (CAT).
- **Pinned activity:** one per record (OBJ).
- **"Controls for CRM records":** a customizable title card (public beta, Fall 2026). **Redesigned records** are in private beta. Real-time CRM updates without refreshing (SPOT).

### A5. Activity timeline and engagements

| Feature | What it does | Tier / limits | Source |
|---|---|---|---|
| Record timeline | Chronological history: emails, calls, meetings, notes, tasks, SMS, WhatsApp, LinkedIn, postal mail, conversations, form submissions, page views, marketing emails, lifecycle changes, sequences, documents, custom and integration events | **F: last 30 days only**; S+: full history | CAT |
| Notes | Rich-text notes with attachments and @mentions | F+ | KB-ATT |
| Tasks | To-dos with due dates, queues and reminders | F+. **Task queues, repeating tasks, task calendar sync** (to Google or Outlook): S+ | CAT |
| Customizable task management | Custom task stages, multiple views and filters | Fall 2026 | SPOT |
| Calls | Log or place calls; recording and transcription | Calling: S 500 / P 3,000 / E 12,000 minutes per account per month. HubSpot numbers: 1 / 3 / 5. Recording and transcription: P 750 hours, E 1,500 hours per month. **Calling SDK** (Aircall and others) on F | CAT |
| Meetings | Logged or synced meetings; scheduling on behalf of others needs Sales/Service P+ | KB-OBJ | |
| Meetings Calendar | All past and future meetings in one HubSpot calendar | Fall 2026 | SPOT |
| 1:1 email | Send and log from records | F (HubSpot branding); S+ without branding | CAT |
| Email scheduling | Schedule a 1:1 email; edit scheduled emails (public beta, Spring 2026) | S+ | CAT, SPR26 |
| Email tracking | Opens and clicks | **F: 200 notifications per month**; S+ unlimited, with click tracking and custom tracking domains. Click tracking on P/E needs a Sales seat | CAT |
| SMS | Two-way SMS from the CRM and inbox | **Add-on only:** Sales & Service SMS add-on $75/month (Sales/Service P+, US only, 1,000 segments). Marketing SMS $75/month; short code $1,500/month. SMS in Help Desk is in public beta (Fall 2026) | CAT, SPOT |
| WhatsApp | Inbox, workflows and campaigns | Marketing/Service **P+**; 1,000 messages per month; +1,000 for $70/month. Native WhatsApp marketing campaigns in public beta (Fall 2026) | CAT, SPOT |
| Communications object | Log SMS, WhatsApp, LinkedIn, postal mail or custom-channel touches | F+ | KB-OBJ |
| Conversational context | AI turns emails, calls and chats into structured CRM insight | S 50 / P 250 / E 350 records per paid seat per month; +5,000 for $50 | CAT |

### A6. Views, filters and index pages

- Table and board views (F+).
- **Board views grouped by any property** (beta, F+).
- **Calendar view** and **report view** on index pages (beta, S+).
- Saved views: Pro/Ent allow 50 index views per user.
- Fall 2026 additions: column-level filtering, **cross-object filtering** (filter records by associated-record criteria without building a list), a streamlined index page, and personalized sidebar navigation (beta).
- Sources: CAT, SPOT.

### A7. Segments (formerly Lists)

| Tier | Active (dynamic) segments | Static segments | Notes |
|---|---|---|---|
| F | 10 | 1,000 | Criteria limited to form, contact-property and marketing-email data |
| S (Marketing) | 50 | 1,000 | Same criteria limits |
| S (Content / Data) | 10 / 25 | 1,000 | n/a |
| P | 1,200 (Data Hub P: 1,100) | 1,200 (Data Hub P: 1,000) | Random samples |
| E | 2,000 (Data Hub E: 1,600) | 2,000 (Data Hub E: 1,500) | Split a segment into up to 10 random groups |

- Add-ons: +100 active and +100 static for $200/month.
- Betas: segment analytics and filter insights (F+); web-visitor segments and AI segment suggestions (Mktg P+); lookalike segments (Mktg E).
- Source: CAT, P-MKT.

### A8. Import and export

| Feature | Limits | Source |
|---|---|---|
| Import (UI and API; multi-object, with associations) | F: 50 imports/day, 500K rows/day. Paid: 500 imports/day, **10M rows/day in the UI**, 80M rows/day via API | CAT |
| Export | 300 exports/day (30/day via API) | CAT |
| Blog import/export, site export, website-structure import | F+ | CAT |
| Amazon S3 scheduled export (public beta); Snowflake sync (beta); BigQuery two-way (beta); Google Sheets as a data source | Fall 2026 | SPOT |

### A9. Duplicates and data quality

| Feature | Tier | Source |
|---|---|---|
| Automatic deduplication (contacts by email, companies by domain) | F+ [2H, general platform behavior] | n/a |
| Duplicate management (AI finds and merges duplicate pairs) | **P+** | CAT |
| Bulk duplicate management | Data Hub P+ | CAT |
| Merge rules for the primary record; merge preview; similarity scores; custom columns in the duplicates table; custom duplicate rules (beta); higher duplicate-pair limits | Fall 2026 | SPOT |
| Data quality overview (beta: duplicates, formatting, missing data) | S: scan every 2 weeks; P/E: daily | CAT |
| AI data-formatting recommendations (beta) | S+ | CAT |
| Data quality automation (format-data workflow action, formulas) | Data Hub P+ | CAT |
| Data health trends | Data Hub P+ | CAT |
| Data model health check | Fall 2026 | SPOT |
| Context Home completeness score | Fall 2026 | F26 |

### A10. Permissions, teams, security and audit

| Feature | Tier | Limits | Source |
|---|---|---|---|
| User management; custom user permissions (view/edit/communicate per object; export user list) | F+ | Up to 2,500 users per account | CAT |
| Permission sets | S/P: templates only; **E: custom sets** | n/a | CAT |
| Teams | P: 10; E: 300 with hierarchy ("organize teams") | +100 teams for $200 | CAT |
| Presets (default signature, notifications, home screen, language) | P: 5; E: 100 | n/a | CAT |
| **Field-level permissions** | **E** | n/a | CAT |
| Limit access to content and data (partitioning) | **E** | n/a | CAT |
| Social login (Google, Microsoft) | F+ | n/a | CAT |
| Single sign-on | P+ | n/a | CAT |
| Log in as another user; admin notification profiles; user-object custom properties | E | n/a | CAT |
| Standard sandbox | E | 1 sandbox; 200K records per type; +1 for $750/month | CAT |
| **Sensitive Data** (flags for sensitive or highly sensitive data, including **children's information, health data, HIPAA PHI (with a BAA)**, government ID, full SSN/bank numbers) | **E only** | Excluded from some features. Blocks MCP access to activities | CAT, MCP |
| Audit logs | Pipeline audit APIs exist; MCP/connector writes are "attributed to the Audit Log". I did not verify which tier gets the centralized audit log [2H] | n/a | DEVIDX, AIT |
| Multi-account management | E | 30 accounts per organization | CAT |
| App governance (central control of app and AI data access) | Fall 2026 | n/a | SPOT |

### A11. Platform limits worth mirroring (CAT "Technical Limits")

- **API calls per day:** 250K (Free/Starter), 650K (Pro), 1M (Ent); up to 3M with two $500 add-ons.
- **Rate limits:** 100 requests per 10 seconds (Free/Starter), 190 (Pro/Ent), 250 with the add-on.
- **Other limits:** 1,000 form submissions per contact; 10,000 forms; 500 custom events (50 properties each); 1,000 chatbots; 200 shared inboxes; 50 hosted videos; 20,000 CTAs; HubDB 1,000 tables × 10,000 rows (1M total); 10,000 KB articles; 100 blogs; 10,000 landing pages and 10,000 website pages.
- **Records:** 15M records per object for paying customers; +1M records for $1,100/month (other objects) or $1,700/month (contacts); up to 50M.
- **Routing:** chats, bots and team email can only be **routed to users with a paid Sales or Service seat**.

### A12. Mobile app (MOB, CAT, SPOT)

**Available to all users:**
- Contacts, deals, tasks and notes.
- Business-card scanner.
- **Caller ID linked to the CRM**.
- Calling with HubSpot numbers; call recording and transcripts.
- Email drafting.
- Mobile shared inbox (F: 1 inbox; S: 1; P: 100).
- Ticket and SLA tracking; reports and goals.
- Breeze Assistant on every screen, including account summaries before meetings.

**Tier-gated:**
- **In-person meeting notetaker** (iOS, beta; Sales P+).

**New in Fall 2026:**
- One-tap mobile notetaker (beta).
- Voice for Breeze on mobile (beta).
- Mobile search.
- A new mobile "home" for sales.

### A13. Extensibility for developers

| Capability | Summary | Source |
|---|---|---|
| Object, association, property, pipeline and search APIs | Date-versioned (2026-03, 2026-09; 2027-03 beta); batch 100 per request; upsert by unique property | OBJ, DEVIDX |
| **UI extensions** (React) | **App cards** on records, preview panels and help desk; **app home pages**; **settings pages**. Uses the `hubspot.fetch()` API: 15–120 second timeout, 1 MB payloads, 20 concurrent requests | UIX |
| Legacy CRM cards, migrating to app cards | Converter available | UIX |
| Timeline events API | Custom events on the record timeline (legacy v3) | DEVIDX |
| CRM embed | Embed a record timeline, workflows, sequences, properties or meetings in third-party apps (contacts, companies, deals and tickets only; the user must be logged in) | EMBED |
| Custom workflow actions; webhooks; SCIM; telemetry | Via the developer platform | DEVIDX |
| **Connect external MCP servers to HubSpot agents** (beta) | Agents can call outside tools | DEVIDX |
| Developer MCP server (local) | For building apps and CMS assets | DEVIDX |
| **Agent CLI** (public beta) | Terminal access to HubSpot for AI agents | SPOT |
| HubSQL public API (private beta) | SQL aggregates over CRM data | SPOT |
| Files API; Conversations and custom-channels APIs; Payment Links API | n/a | DEVIDX, SPOT |

---

## B. The Client 360 and documents story

### B1. How HubSpot shows "everything about one customer on one screen"

1. **Record page.** Key properties sit on the left. In the middle are the Overview (data highlights, Breeze **record summary**, recent activity) and the complete **activity timeline**. On the right are related records (company, deals, tickets, **invoices, payments, subscriptions, quotes**), the **Attachments** card, **Google Drive** and **SharePoint/OneDrive** cards, and app cards (KB-LAYOUT, KB-CARDS).
2. **Automatic capture fills the timeline.**
   - Emails log to contacts by default (KB-LOG).
   - Calendar events with existing contacts sync as meetings (KB-CAL).
   - Calls, recordings and transcripts (Teams, Meet and Zoom) attach to meeting records (KB-TEAMSREC).
   - Chats, WhatsApp, SMS and Messenger conversations attach to the contact.
3. **Roll-up.** Activities attach automatically to the primary company and up to 5 open deals (KB-ASSOC). Association-table and association-property-list cards show child records inline.
4. **AI views.**
   - The Breeze Assistant record summary.
   - "Data Agent: CRM research" answers a question from the whole CRM (Fall 2026).
   - Smart properties.
   - Churn-risk signal (from emails, calls and notes).
   - Buying groups (beta) (SPOT).
5. **Free-tier caveat.** On Free, **only the last 30 days of timeline** are visible, which undermines the 360 view on the free plan (CAT).

### B2. Files tool

| Item | Detail | Source |
|---|---|---|
| Maximum file size | **F: 20 MB. Paid: 2 GB.** Files of 1 GB or more may have upload issues | KB-FTYPES |
| Blocked types | Free accounts cannot upload executables (sh, bat, exe, jar, etc.) | KB-FTYPES |
| Batch upload | Up to 100 files at a time; drag-and-drop; **import from Google Drive** | KB-FILES |
| Default hosting | Public CDN URL | KB-FILES |
| Visibility | **Public**, **Public-noindex**, **Private** | KB-FVIS |
| Private sharing | Internal share link (logged-in users only); file preview link; **temporary 24-hour public link** | KB-FVIS |
| Folder or user/team access restriction | Via partitioning ("Limit access", Enterprise) | KB-FVIS, CAT |
| Account-level storage quota | **None published** in the catalog or the KB pages I reviewed. Design-manager limit: 5,000 files; 500 folders | CAT |
| Mobile | Upload and manage files in the mobile app | KB search results |

### B3. Attachments on records

| Item | Detail | Source |
|---|---|---|
| Where | **Attachments** card in the right sidebar | KB-ATT |
| Sources | Upload from computer, or pick an existing HubSpot file. Attachments on notes, tasks, emails, calls and meetings also appear; non-inline email attachments are added automatically | KB-ATT |
| Management | Search by name or type; **filter by source** (calls, manual upload…); sort by upload date; rename; bulk download; preview; share by internal link or **24-hour external link** | KB-ATT |
| Remove | **Delete** (permanent) or **Detach** (keeps the file in the files tool) | KB-ATT |
| Visibility | Record attachments need Notes view permission (all / team / own); activity attachments follow that activity's permissions | KB-ATT |
| Email attachment logging | Attachments over **50 MB don't log** (Chrome extension and Office 365 add-in) | KB-CHR, KB-O365 |
| Outgoing 1:1 email attachment | ≤20 MB (sales and inbox email) | KB-FTYPES |
| Sensitive files | Sensitive file properties and attachments are supported under Enterprise Sensitive Data | CAT |

### B4. Documents (sales content library with tracking)

| Item | Detail | Source |
|---|---|---|
| Tier | Sales/Service **S+**; Smart CRM P/E; needs a Core, Sales or Service seat | KB-DOCS |
| Limit | **5,000 documents per account**; 250 MB per document; many formats (PDF, Office, images, CAD, EML/MSG…) | CAT, KB-FTYPES |
| Import from | Computer, HubSpot files, **Dropbox, Google Drive, Box** | KB-DOCS |
| Sharing | Tracked short links (hubs.ly); insert into emails and templates; **optional email gate** with consent | KB-DOCS |
| Tracking | Notification when a contact views; visitor table; first open tied to the contact's email. Page-by-page time analytics [2H] | KB-DOCS |
| Organization | Nested folders; filter by owner or brand; AI-generated descriptions | KB-DOCS |
| Analytics | Sales content analytics (templates, documents, sequences), S+ | CAT |
| Spring 2026 | "Better organization for sales content": on-brand, secure, version control | SPR26 |

### B5. Quotes, e-signature and templates

| Feature | Tier | Detail | Source |
|---|---|---|---|
| **Legacy quotes** | Accounts created before September 3, 2025 (Sales Hub; Free if used in the prior 6 months) | Legacy tiers: basic quotes and e-sign on S+; custom templates P+; approvals E | KB-LQ |
| **Quotes (AI-powered CPQ)** | **Revenue Hub P/E; needs a Revenue seat** | Single-page quote editor (review, accept and pay on one page); quote templates; custom-coded React modules; AI-generated quotes (cover letter and business case); password-protected quotes; quote activity tracking; quote workflows and reporting | CAT, KB-Q |
| Signable quote attachments | Revenue P/E | Up to **10 attachments** per quote (PDF/DOC/DOCX, **≤30 MB each**), marked "In signing" | CAT, KB-Q |
| **E-signature** | Revenue **P: 25 per user per month; E: 50**, pooled across the account | Provider is **Dropbox Sign**; optional identity verification (1-hour window); countersigners (Core-seat users allowed); PDFs over 40 MB may fail. **Quotes only**, not general documents. +100 signatures for $60/month | KB-ESIG, CAT |
| Approvals | Standard: P/E, up to 10 approvers, AND logic only. Advanced: E, 5 steps | n/a | CAT |
| Quote rules | E | Incompatibility, compatibility, price min/max and quantity rules | CAT |
| On acceptance | n/a | Deal amount and line items update; can create contract, invoice and subscription | KB-Q |
| Closing agent (beta) | Revenue P/E | AI answers buyer questions on the quote page | CAT |
| Email templates | F: 3; S+: 10,000 | n/a | CAT |
| Snippets | F: 3; S+: 5,000 | n/a | CAT |
| Third-party e-sign | DocuSign app ("Send DocuSign template" workflow action); PandaDoc | n/a | KB-WFA, MK-EXP |

### B6. Money on the record (Revenue Hub; much of it is free)

| Feature | F | P/E | Notes (CAT, P-REV) |
|---|---|---|---|
| Invoices; automated invoice reminders; credit memos (beta); AI invoice prioritization | ✓ | ✓ | Custom invoice domain on P/E |
| Payment links; B2B checkout; checkout fees; stored cards and ACH | ✓ (needs a payments account) | ✓ | n/a |
| Subscriptions and retries of failed payments | ✓ | ✓ | n/a |
| QuickBooks Online; Xero (beta) sync | ✓ | ✓ | n/a |
| HubSpot Payments | — (Starter+ per the Mktg/Sales/Service tables) | ✓ | US, CA, UK only. Card 2.9%; ACH 0.8% (≤$10); BNPL 5.99%. Platform fee 0.5% (**waived for year 1**). Stripe option: 0.75% platform fee plus Stripe fees |
| Contracts; orders (beta); contract import (beta); price books; tiered pricing; automated sales tax; Affirm/Klarna; revenue analytics; **Billing Portal (beta)** | Contracts on S+ | ✓ | n/a |
| HubSpot Capital (Stripe) | ✓ | ✓ | US and UK |
| E-invoices (beta) | ✓ | ✓ | Belgium and Germany only |

### B7. Customer-facing portals and self-service

| Portal / tool | Tier | What customers can do | Limits | Source |
|---|---|---|---|---|
| **Support portal** (replaces the legacy "customer portal") | Service **P/E** | Log in; see and reply to **tickets only** (contact's own, or company's); support form; KB access | P: 2 access groups; E: 100 (shared with private KB); self-registration or invite; one language per portal; **50 MB file limit** | KB-PORTAL, CAT, KB-FTYPES |
| **Billing portal** (beta) | Revenue P/E | View and pay invoices, manage subscriptions, update payment methods | n/a | CAT, SPOT |
| Knowledge base | Service P: 1 KB, 2,000 articles; E: 100 KBs, 10,000 articles | Public or private (SSO or access groups) | 5,000 tags; 1,000 categories | CAT |
| Memberships and private content | Content P: 2 access groups; E: 100 | Gate pages, blog and content-library downloads behind login; dynamic pages from CRM or HubDB (a custom "client portal" can be built) | n/a | CAT |
| Content library module | F+ (branded on F) | Downloadable file repository on the site; gated by login on P+ | n/a | CAT |
| **Customer Agent** | P/E of any Hub (incl. Smart CRM P) | AI answers on chat, email, forms and **voice (beta)**; payment links and invoice lookup in chat; handoff to humans | 50 credits per resolution | CAT, SPOT |
| Forms with file upload | F+ | Collect documents into file properties | 100 MB per file via forms | KB-PROP |

### B8. Documents gaps a competitor can exploit (analysis)
- There is no **per-customer document vault with typed slots** (for example "Immunization record – expires 2027-03") and no expiry reminders. File properties plus workflows can approximate one, and date-based workflows need Pro.
- **E-signature is limited to quotes**, and only on Revenue Pro. There is no native "send any PDF for signature" (DocuSign or PandaDoc apps are needed).
- The portal shows **tickets only**. There is no native portal where a parent sees their documents, invoices and messages together without Content Hub Pro plus Revenue Hub.
- Storing health, child or ID data is permitted only under **Enterprise Sensitive Data** (CAT). HubSpot's terms bar use that would violate COPPA, HIPAA or GLBA (TOS).

---

## C. The Hubs: every feature line from the comparison tables and catalog

Each table is sourced from its Hub's pricing page (HTML parsed so checkmarks are captured) and CAT. "✓" means included with no stated limit.

### C0. Free tools (included in every edition) — CAT, P-CRM

**CRM basics:**
- Contact management; contact website activity; companies; deals; tasks and activities; tickets.
- Custom support-form fields; Prospects (visiting companies).

**Forms and automation:**
- Forms (standalone, embedded, collected; branded).
- Form automation: 1 automated email per form.
- Email automation: 1 action.

**Ads and inbox:**
- Ad management: Google, Meta, Microsoft, TikTok, Reddit, LinkedIn and **ChatGPT**; 3 accounts; website audiences only.
- Ad retargeting: 2 audiences.
- Shared inbox: 1. Mobile inbox: 1. Team email; channel switching.
- Live chat (branded); bots (ticket, qualification and meeting bots; no branching).
- Facebook Messenger: simple messages.

**Reporting and sales tools:**
- Reporting: 10 dashboards × 50 reports.
- Email tracking: 200 notifications per month.
- Templates: 3. Snippets: 3. Meetings: 1 personal link, branded.

**CRM configuration:**
- Pipelines: 1 per object. Custom properties: **10 in total**.
- Segments: 10 active / 1,000 static.
- Import: 50 per day / 500K rows. Export: 300 per day.
- User management and custom permissions; social login.

**Email marketing:**
- **2,000 sends per month, branded**, at 1,000 emails per second.
- Basic templates; email health reporting; email reply tracking.

**Website and content:**
- Landing pages: 30. Website pages: 30. Blog: 1, with 100 posts, 20 authors, 50 tags.
- Design manager; themes; local development; advanced menus; 3 languages.
- AMP; sitemap; apex hosting; premium hosting (SSL, CDN, WAF); custom domain (1 subdomain + 1 ccTLD).
- SEO recommendations (basic); site and blog export/import; content library (branded).
- Cookie banners: 100, with GPC support.

**Integrations and data:**
- Gmail / Outlook / Exchange integrations; Slack; Marketplace.
- Data sync (select HubSpot-built apps, default mappings, historical sync).
- Marketing events object; app objects; Projects.
- Mobile app; Breeze Assistant; conversational context (25 records per month).

**Buyer intent (lite):**
- Target markets; 1,500+ company keywords; intent criteria.
- Intent list (top 10 companies); intelligence tab (limited).
- Buyer-intent overview (no quick-add); data test; top-visitor digests.

**Commerce:**
- Products: 100; flat-rate pricing; tax rates; Products API.
- Stripe processing; invoices; payment links; subscriptions and retries; checkout.
- QuickBooks; Xero (beta); credit memos; AI invoice prioritization; HubSpot Capital; e-invoices (beta).

**Other:**
- Google PMax ads; board view for any property (beta); record timeline limited to 30 days.
- **Limits:** 1,000 contacts, 1M other records, 2 users.

### C1. Marketing Hub — P-MKT, CAT

| Feature | F | S | P | E | What it does |
|---|---|---|---|---|---|
| Marketing contacts included | — | 1,000 | 2,000 | 10,000 | Billable emailable contacts; up to 15M contacts in total |
| Email marketing (sends per month) | 2,000, branded | 5× contact tier | 10× | 20× (5,000 per second) | Bulk email with drag-and-drop editor and tokens |
| Email automation / form automation | 1 action | 10 actions | Unlimited + omni-channel | Unlimited | Post-form or nurture automations |
| Omni-channel marketing automation (workflows) | — | — | 300 workflows, 10 teams | 1,000 workflows, 300 teams; behavioral events; workflow health | Visual workflows across email, ads, social, chat |
| Forms | ✓ branded | Multi-step, consent, styling | + conditional logic, code, validation, **AI spam detection (beta)** | = P | Lead capture |
| CRM segments | 10 / 1,000 | 50 / 1,000 | 1,200 / 1,200 + samples | 2,000 / 2,000 + splits | Audiences |
| Filter insights; segment analytics (beta) | ✓ | ✓ | ✓ | ✓ | Segment statistics and overlap |
| Web visitor segments; AI segment suggestions (beta) | — | — | ✓ | ✓ | Visitor cohorts; AI-suggested audiences |
| Lookalike segments (beta) | — | — | — | ✓ | AI finds similar contacts |
| Ad management | 3 accounts, website audiences | 3 accounts, 2 list audiences, 5 conversion events (hourly) | Unlimited accounts, 5 audiences, 50 events | 15 audiences, 100 events | Google, Meta, Microsoft, TikTok, Reddit, LinkedIn, ChatGPT ads and attribution |
| Ad retargeting | 2 audiences | 2 | 5 | 15 | Website and list retargeting |
| Simple ad automation | — | 1 workflow per form, 10 actions | Unlimited | Unlimited | Ad-lead follow-ups |
| Ad goals | — | — | ✓ | ✓ | Lifecycle-based ad goals |
| Live chat / bots / Messenger | Branded / limited | Unbranded | + custom bots and branching | + code snippets in bots | Conversational tools |
| Draggable chat widget; logged-in visitor ID | — | — | ✓ | ✓ | n/a |
| WhatsApp | — | — | 1,000 messages per month | 1,000 | WhatsApp messaging |
| Instagram DMs | — | — | ✓ | ✓ | Social inbox |
| CTAs | — | Basic | Targeting | Targeting | Embedded and pop-up CTAs |
| Social media | — | — | 50 accounts, 10,000 posts per month, schedule up to 3 years ahead | 300 accounts; 3 competitor streams | Facebook, Instagram, LinkedIn, YouTube, X (plus TikTok per SPR26); Reddit conversations (beta) |
| Social approvals | — | — | — | ✓ | n/a |
| Lead scoring | — | — | 5 scores | 50 + AI recommendations | Fit and engagement scores |
| A/B testing; smart content in email | — | — | ✓ | ✓ | n/a |
| Advanced personalization; programmable email (beta) | — | — | CRM data | + HubDB | Data-driven email content |
| AI email template upload (beta) | — | — | 100 per month | 100 per month | Converts outside designs into templates |
| Email approvals; single-send API; send-time optimization (beta); frequency cap; HubDB in email | — | — | — | ✓ | n/a |
| Email health reporting | Limited | Limited | + recommendations | + recommendations | n/a |
| Messaging insights (beta) | — | ✓ | ✓ | ✓ | Which messaging performs |
| Reporting dashboards | 10 | 30 | 75 | 100 (×50 reports) | +300 dashboards for $200 |
| Custom reports | — | — | 100 (10M events per query) | 500 (100M) | n/a |
| Web analytics | Standard | Standard | Customizable; filtered views (25) | 50 filtered views | n/a |
| SEO analytics; Google Search Console | — | — | ✓ | ✓ | n/a |
| SEO recommendations | Basic | Basic, one page at a time | Advanced, full-site audit, topics | = P | n/a |
| **AEO (beta)** | — | — | 25 prompts × 3 engines (2,500 answers per month) | 50 prompts (5,000) | Brand visibility in ChatGPT, Gemini, Perplexity (Claude answers visible via MCP) |
| Contact-create attribution | — | — | ✓ (10,000 interactions) | ✓ | 5 models |
| Multi-touch revenue attribution | — | — | — | ✓ | 7 models |
| Customer journey analytics | — | — | — | 15 stages, 60 months or 20M events | n/a |
| Campaign management and reporting; Campaign Agent | — | — | 5,000 campaigns | 10,000 | n/a |
| Marketing Studio (beta) | — | — | ✓ | + custom attribution | AI campaign workspace |
| Content / Nurture / Campaign agents (beta) | — | — | ✓ | ✓ | See section D |
| Video creation and editing | — | — | ✓ | ✓ | Multi-clip editing, AI scripts (Fall 2026) |
| Video hosting | — | — | 50 | 50 | +50 for $50 |
| Collaboration tools; asset comparison reports; ABM tools; target-accounts home | — | — | ✓ | ✓ | n/a |
| Brand identity (beta) | — | — | ✓ | ✓ | AI brand context |
| Custom events; event visualizer | — | — | 500 definitions, 10M events | 30M events; visualizer E only | n/a |
| HubSpot Work (beta) | — | Limited | Full | Full | n/a |
| Multi-account management; limit access; Sensitive Data; sandbox; social approvals | — | — | — | ✓ | n/a |
| Multi-language content | 3 languages | 50 | Unlimited | Unlimited | n/a |
| Support | Community | Email and chat | + phone | + phone | n/a |

### C2. Sales Hub — P-SAL, CAT

| Feature | F | S | P | E | What it does |
|---|---|---|---|---|---|
| Seat price (annual / monthly) | $0 | $20 list ($7 promo) | $90 / $100 | $150 | Per seat |
| 1-to-1 email; email scheduling | Branded | ✓ | ✓ | ✓ | n/a |
| Email tracking | 200 per month | Unlimited + clicks | + clicks with Sales seat | = P | n/a |
| Templates / snippets | 3 / 3 | 10,000 / 5,000 | = | = | n/a |
| Documents | — | 5,000 | 5,000 | 5,000 | Tracked sales content |
| Meeting scheduling | 1 link | 1,000 links, team, round robin, payments | = | = | See section E |
| Calling / numbers | — | 500 minutes / 1 | 3,000 / 3 | 12,000 / 5 | +1,000 minutes for $50; +5 numbers for $25 |
| Call recording and transcription; coaching playlists; IVR | — | — | 750 hours | 1,500 hours | +400 hours for $250 (E) |
| Notetaker; meeting prep and recap | — | ✓ | ✓ | ✓ | AI meeting capture |
| In-person notetaker (iOS, beta) | — | — | ✓ | ✓ | n/a |
| Pipelines (all objects) | 1 per object | 15 | 100 | 350 | n/a |
| Predictive deal score | — | ✓ | + factors and trends | = | AI close probability |
| Goals | — | Revenue | Templates | Custom | n/a |
| Sales automation (workflows) | — | 50, restricted | 300 | 1,000 + sequence triggers + quote workflows | n/a |
| Task queues; repeating tasks; task calendar sync; conversation routing; Slack | — | ✓ | ✓ | ✓ | n/a |
| Sales content analytics; object tags; contracts; revenue agent; prospecting agent; data agent | — | ✓ | ✓ | ✓ | Prospecting agent is S+ per CAT and P-SAL, but "Pro and Ent" per OBP (April 2026) |
| **Sequences** | — | — | 5,000; 500 sends per user per day | 1,000 per day; triggered by workflow | Automated 1:1 cadences (LinkedIn steps need Sales Navigator) |
| Sales workspace; leads object | — | — | ✓ | ✓ | Prospecting home |
| Lead scoring | — | — | 5 | 10 | n/a |
| Forecasting | — | — | Default and custom | + team hierarchies | n/a |
| **Playbooks** | — | — | 5 | 5,000 + embedded properties | Guided call and meeting scripts that capture notes |
| **Conversation intelligence** | — | — | ✓ | + tracked terms | Call analytics |
| Deal plans / progression / summaries / guided actions (beta) | — | — | ✓ | ✓ | AI deal help |
| 1:1 video; smart send times; multiple signatures; LinkedIn Sales Navigator; automatic lead rotation; handoffs; account overview; ABM; rep productivity; workflow extensions; custom channels API; sales email frequency controls (beta) | — | — | ✓ | ✓ | n/a |
| Deal splits; deal approvals; deal journeys (10 stages, 36 months); lead-form routing; custom objects; sandbox | — | — | — | ✓ | n/a |
| Onboarding fee | — | — | $1,500 | $3,500 | Required |

### C3. Service Hub — P-SVC, CAT

| Feature | F | S | P | E | What it does |
|---|---|---|---|---|---|
| Seat price | $0 | $20 list | $90 / $100 | $150 | n/a |
| Ticketing | ✓ | ✓ | ✓ | ✓ | n/a |
| Shared inbox / mobile inbox | 1 | 1 | 100 | 200 / 100 | Email, chat, Messenger, WhatsApp, SMS |
| Ticket routing | — | Customer Agent only | 300 workflows | 1,000 + skills-based | n/a |
| Support automation | — | 2 ticket emails, 50 restricted workflows | 100 ticket emails, 300 workflows | 200 ticket emails, 1,000 workflows | n/a |
| **Help desk workspace**; help desk spaces | — | — | 50 spaces | 100 | Omnichannel ticket workspace |
| Macros | — | — | 500 | 1,500 | One-click response plus actions |
| SLAs | — | — | ✓ | + conditional SLAs | n/a |
| Ticket capacity limits; agent presence; custom views | — | — | ✓ (50 views) | 600 views; live-chat capacity 99 | n/a |
| Reply recommendations (AI drafts) | — | — | ✓ | ✓ | n/a |
| Knowledge base (+ SSO) | — | — | 1 KB, 2,000 articles | 100 KBs, 10,000 articles | n/a |
| Knowledge Base Agent (beta) | — | — | ✓ | ✓ | Finds gaps; drafts articles |
| **Support (customer) portal** | — | — | 2 access groups | 100 | Tickets only |
| Customer Agent | — | — | ✓ | ✓ | AI resolution |
| Feedback surveys | — | — | 50 NPS, 50 CES, 100 CSAT, 100 custom | = | n/a |
| Post-chat feedback; insights dashboard; feedback topics | — | — | ✓ | ✓ | n/a |
| Customer success workspace; health scores (50) | — | — | ✓ | ✓ | Retention tooling |
| Product usage tracking (beta) | — | — | 10 events | 10 | n/a |
| Customer experience score (beta) | — | — | ✓ | ✓ | AI per-ticket CX score |
| QA score (beta); recurring revenue tracking; skills routing; customer journey analytics | — | — | — | ✓ | n/a |
| WhatsApp; IVR; CI; calling (as Sales Hub) | — | Calling 500 minutes | ✓ | ✓ | n/a |
| Fall 2026 additions | Omnichannel waitlist, ticket-reopen rules, sequential IVR, SMS in Help Desk (beta), help-desk tickets in Teams | n/a | n/a | n/a | SPOT |
| Onboarding fee | — | — | $1,500 | $3,500 | n/a |

### C4. Content Hub — P-CMS, CAT

| Feature | F | S | P | E |
|---|---|---|---|---|
| Price | $0 | $20/seat | $450 / $500 per month (3 seats) | $1,500 (5 seats) |
| Website pages / landing pages | 30 / 30, branded | 30 / 30 | 10,000 / 10,000 | 10,000 / 10,000 |
| Blog | 1 blog; 100 posts | 1; 10,000 posts | 100 blogs; 2,000 authors | = |
| AI assistants; AI image generator | — | ✓ | ✓ | ✓ |
| AI content generation (30 blog posts per day); content remix (20 or 50 per day); brand voice (beta; ES, PT, FR, DE, JA); AI translation; post narration | — | — | ✓ | ✓ (remix 50) |
| Smart content; A/B testing; adaptive testing (5 variants); dynamic pages; HubDB; content staging; site tree; password pages; **memberships / member blog** (2 access groups) | — | — | ✓ | ✓ (100 groups) |
| Content embed (3 per page); podcasts (5 shows / 1,000 episodes); video hosting (150) | — | — | ✓ | 50 shows / 5,000 episodes; 500 videos |
| Multisites (+9 root domains); code alerts; activity logging; serverless functions; content approvals; content sync (beta); multi-domain reports | — | — | — | ✓ |
| Form follow-up emails | — | 3 per form | 3 | 3 |

### C5. Data Hub (formerly Operations Hub) — P-DATA, CAT

| Feature | F | S | P | E |
|---|---|---|---|---|
| Price | $0 | $20/seat | $720 / $800 per month (1 seat) | $2,000 (1 seat) |
| Credits | — | 500 | **5,000** | **10,000** |
| Data sync (two-way with ~dozens of apps; 10-minute updates) | ✓ default mappings | + **custom field mappings** | ✓ | ✓ |
| Data studio (beta: datasets from warehouses, apps, Sheets and webhooks; activate in segments, workflows and sync) | — | — | ✓ (credits) | ✓ |
| Programmable automation (custom code actions); webhooks; data quality automation; bulk duplicates; scheduled and webhook triggers (10 / 100); data health trends | — | — | ✓ | ✓ |
| Data warehouse integrations (Snowflake, BigQuery…) | — | — | — | ✓ |
| Custom reports; dashboards | — | 30 dashboards | 3,100 reports; 325 dashboards | 3,500; 350 |
| Data studio limits | n/a | n/a | 200 datasets; 5 joins; 30 formulas; 10M external rows; 10M updates per month | 50 formulas; 30M rows; 25M updates |

### C6. Revenue Hub (formerly Commerce Hub) — P-REV, CAT

| Feature | F | P | E |
|---|---|---|---|
| Seat price | $0 | $85 / $95 (**$57 with Sales Hub promo**) | $140 (**$98 promo**) |
| Credits | — | 3,000 | 5,000 |
| Revenue Agent (beta); Prospecting Agent; Data Agent; Agent Builder | — / ✓ per CAT | ✓ | ✓ |
| Product library | 100 | 15M | 15M |
| Price books; tiered pricing; automated sales tax | — | ✓ | ✓ |
| Quotes stack (see B5) | — | ✓ | + advanced approvals, quote rules |
| E-signature | — | 25 per user per month | 50 |
| Invoices, reminders, credit memos, subscriptions, retries, payment links, checkout, stored methods, QuickBooks, Xero | ✓ | ✓ | ✓ |
| Contracts; orders (beta); billing portal (beta); revenue analytics; custom revenue reporting; custom invoice and link domains; Klarna/Affirm | — (contracts on S+) | ✓ | ✓ |

### C7. Workflows: triggers and actions (KB-WFT, KB-WFA, CAT)

**Tiers and limits:**
- Full workflows need P/E of Marketing, Sales, Service, Data, Smart CRM or Revenue. Starter has "up to 50 workflows with restricted triggers and actions".
- Limits: 300 on P; 1,000 on E; +100 for $200, up to 10,000. Up to 250 enrollment filters.

**Triggers:**
- Event-based: form submission, email open, page view, call or meeting outcome, record created, association added, list membership, ticket status, chat, custom events.
- **Webhook received** (Data P+).
- Filter-based (criteria true).
- Schedule-based: date, date property, **recurring scheduled triggers** (Data P+).
- Manual; re-enrollment rules.
- Social post published (beta, Fall 2026).

**Actions:**
- **Delays:** date, date property, event, time span, day of week, time of day.
- **Branches:** property or output value, AND/OR logic, random split (Mktg P/E). Go-to workflow; go-to action.
- **Communication:**
  - Send email (Mktg/Service P+); internal email and in-app notifications; internal marketing email.
  - **Send SMS** (with the SMS add-on); **Send WhatsApp** (P+); send survey (beta).
  - Enroll or unenroll in a sequence (Sales/Service E); assign conversation owner.
- **CRM:**
  - Validate and format phone; **enrich record**; create or edit record; copy ticket; add line item to deal.
  - Create task or note; delete contact; increment property.
  - Manage subscriptions; rotate owner (P+) or rotate by skill.
  - Associate and label; track or stop intent signals; **convert to invoice**; create quote; renewal quote from contract (Revenue).
  - Cross-account create or edit (multi-account).
- **AI (credits):**
  - Assign to Customer Agent; Data Agent custom prompt, research or **fill smart property** (beta).
  - Summarize record (beta); infer value proposition and ICP (beta).
  - Enroll or unenroll in Prospecting Agent (Sales P/E); **use a custom LLM** (beta).
  - **Run Agent**; generate prospect profile. Each AI action costs 10 credits.
- **Marketing:** add or remove from ad audience, campaign or static list (Mktg P/E); set marketing-contact status; add participant to a marketing event.
- **Data ops (Data P+):** custom code; format data; send webhook.
- **Connected apps:** Zoom webinar, Slack message or channel, **Google Chat**, Asana, Trello, Salesforce task or campaign, NetSuite sales order, **DocuSign template**, Google Sheets rows, Google Drive and SharePoint folder or file actions (P+), Teams channel creation and notifications.

**Fall 2026 additions:** "Turn existing workflows into agentic workflows with one click". A Marketplace of workflow templates (SPOT).

### C8. Add-ons and limit increases (CAT)

- **Dedicated IP** $300; **Custom SSL** $100; **Transactional Email** $600; **Brands** (multi-brand, Mktg E) $1,000.
- **SMS:** Marketing SMS long code $75; transactional long code $75; **Sales & Service SMS $75**; short code $1,500; +1,000 segments for $15 (US/+1 only).
- **WhatsApp** +1,000 messages $70.
- **Reporting and usage limits:** reporting +300 dashboards / +3,000 reports for $200; API +1M calls per day for $500 (maximum 2); workflows +100 for $200; segments +100 for $200; teams +100 for $200; users +500 for $200.
- **Data-model limits:** custom objects +10 definitions / +1M records for $500 (E); calculated properties +25 for $70 (E); custom properties +500 for $220 (P+); record limits +1M for $1,100 (objects) or $1,700 (contacts) (E).
- **Other:** e-signature +100 for $60; transcription +400 hours for $250; domains +1 for $100; sandbox +1 for $750; calling +1,000 minutes for $50; phone numbers +5 for $25; video +50 for $50; conversational context +5,000 for $50; AEO +10 prompts for $20.
- **Agent packs:** Base $25 (2,500 credits); Growth $400 (40,000); Scaled $1,500 (150,000).

---

## D. AI (Breeze): every capability found for 2026

### D1. Breeze Assistant (F+; not on the credit rate sheet) — CAT, F26, SPOT, KB-FTYPES

- **What it is.** A chat assistant on every screen, on the web and in the mobile app. It answers questions from CRM data, generates content, summarizes records, preps meetings, and since Fall 2026 **assigns work to agents** and delivers "artifacts" (proposals, reports, pages).
- **File uploads:** up to 10 files per thread, 50 MB total, in common document, image and spreadsheet formats.
- **Fall 2026 additions:**
  - Custom-agent access.
  - **Connectors** to Gong, G2 and Asana.
  - **Voice on mobile** (beta).
  - **Scheduled prompts**.
  - Artifact sharing, internal and via **password-protected external links**.
  - **Breeze Assistant for Gmail**.
  - Mobile search.
  - Buying groups (beta).
  - Revenue context (beta).
  - Full conversation-history Q&A.
- **Spring 2026:** "Loop Marketing Expert" mode grounded in HubSpot Academy content.

### D2. Agents

Tier availability is from the CAT "Agent Hub" table. Credit costs are from the CAT rate sheet ($0.01 per credit).

| Agent | Status | Availability | What it does | Credits |
|---|---|---|---|---|
| **Customer Agent** | GA; voice in beta | P/E of Mktg, Sales, Service, Content, Data or Smart CRM | Resolves questions on chat, email, forms, **voice**, social; cites sources; verifies users; hands off with context; payment links and invoice help; knowledge generator from resolved tickets; batch testing; coaching; audience segments; auto setup; fallback routing; multi-brand (beta); transfer to IVR (private beta) | **50 per resolved text conversation; 50 per minute of voice.** 28-day free trial; 14-day unlimited promo with a Service P seat (P-SVC). HubSpot claims 65–70% resolution (OBP, SPR26) |
| **Prospecting Agent** | GA | Any S+ (CAT); "Pro and Ent" per OBP | Monitors **40+ buying signals**; scores against the ICP; sources contacts from data providers; builds buying groups; drafts outreach that learns from rep edits | **100 per recommended lead** |
| **Data Agent** (smart properties, CRM research) | GA | Any S+ | Answers custom questions per record from CRM, calls, emails, documents and the web; fills smart properties after review; intent and custom signals | **10 per prompt per record** |
| Content Agent | Beta | Mktg P/E | Blog, social and landing pages in brand voice, researched | **1,000 per piece** |
| Campaign Agent | Beta | Mktg P/E | Goal-to-campaign plan | Not listed |
| Nurture Agent | Beta | Mktg P/E | Rewrites each nurture email per contact | **10 per email** |
| Knowledge Base Agent | Beta | Service P/E | Finds KB gaps; drafts and edits articles | **200 per article** |
| Revenue Agent | Beta | Any S+ | Collections outreach on open invoices, with human approval | **500 per invoice** |
| Closing Agent | Beta | Revenue P/E | Q&A for buyers on the quote page | Not listed |
| Customer Health Agent | Beta | Any S+ | Monitors account health; next steps; draft email | Not listed |
| **Custom agents (Agent Builder)** | Beta | Any S+ (Starter: "simple automation"; P/E: advanced plus event triggers) | Build agents from prompts, knowledge, tools, web browsing, CRM analysis; Agent Marketplace; agent inbox; knowledge vaults | **1 per "action unit"** |
| Work agents (HubSpot Work) | Beta | S limited; P/E full | Run projects and tasks in HubSpot Work | 1 per action unit |
| Deal Progression ("Smart Deal Progression") | Beta; public beta Spring 2026 | Sales P/E | Suggests CRM updates, follow-ups and next steps after every call or email | Custom-property updates use Data Agent credits |

Sources: CAT, OBP, SPOT, SPR26, AGH, KB-AH.

### D3. Embedded AI features, by area (CAT, SPOT, SPR26)

**CRM:**
- Record summaries; AI insight cards; smart properties; conversational context; AI transcript enrichment (beta).
- Churn-risk signal; custom signals in plain language; intent signals (Bombora surge, UserGems job changes, 20 new signals).
- AI data-model recommendations; AI data-formatting recommendations; AI duplicate detection (P+).

**Sales:**
- Email drafting and reply drafting; call summaries (purpose, discussion, decisions, sentiment, next steps).
- Notetaker (S+); in-person notetaker (P, iOS); meeting prep and recap.
- Predictive deal score (S+); deal summaries, plans and guided actions (P, beta); conversation intelligence (P).
- Smart send times; AI-generated quotes (Revenue P).

**Service:**
- Reply recommendations; customer experience score; QA score; feedback topics; KB agent.

**Marketing and content:**
- AI content generation; content remix; brand voice; brand identity; AI translation; post narration.
- AI image generation (upgraded to OpenAI's latest model in Fall 2026); AI video scripts with teleprompter.
- AI email template upload; AI segment suggestions; lookalike segments; lead-scoring AI recommendations and insights.
- Send-time optimization; AI form spam detection; email performance summaries; AEO.

**Workflows:**
- AI actions (10 credits each), including "Use a custom LLM" (beta).

**Governance:**
- AI settings control feature access and data sharing (KB-AH).
- Third-party model providers are contractually barred from training on customer data; model cards are published at trust.hubspot.com/ai (AGH).

### D4. Enrichment and buyer intent (the former "Breeze Intelligence")

- **Enrichment does not consume credits.** It covers automatic, bulk, segment, continuous (monthly), and workflow enrichment, plus form shortening (KB-ENR, CAT).
- **Included in S/P/E** of all Hubs (CAT).
- Data comes from HubSpot's own dataset, third parties and the public web. Enrichment is off by default.
- **Intent** costs 10 credits per company per month when monitoring or creating companies. **Custom signals** cost 50 credits per company per signal per month (CAT).
- **Market segments / TAM** (beta); research intent across 200,000 sites; intent digests; auto-add companies.

### D5. HubSpot Credits: mechanics (CAT, CRED, P-SUITE)

- **Price:** $0.010 per credit. Pay-as-you-go is invoiced monthly in 10-credit increments. Capacity packs are $10 per 1,000 per month for the rest of the term, or **automatic upgrades** that persist for the term. "$9 per 1,000 when you pay annually." Agent packs are listed in C8.
- **Included credits** reset monthly with **no rollover**. They are **not additive** across products; the highest tier applies.
- **Controls:** account-wide or per-feature caps, alerts, pause and resume, and a usage dashboard.
- **Billing method:** "per action" versus "per recurrence". Recurring features charge on activation and then monthly while enabled.

### D6. HubSpot MCP server and AI connectors

**Official connectors.** Claude, ChatGPT (the first "deep research" CRM connector), Gemini and Microsoft Copilot, all powered by the remote MCP server (AIT, MCP2).
- The **Claude connector** is free, works on **all HubSpot tiers including Free**, and requires a paid Claude plan (Pro, Max, Team or Enterprise) (CLD).
- It has 210K installs (MK-EXP). The ChatGPT connector has 110K.

**The MCP server** (MCP):
- Endpoint `https://mcp.hubspot.com`; OAuth 2.1 with **PKCE** required. You create an "MCP connector" under Development → MCP Connectors.
- It respects user permissions. **Sensitive Data accounts cannot access activities or conversations** through MCP.
- It is built on the CRM search API, with **no vector search**.
- **Read access:**
  - Contacts, companies, deals, tickets, leads, users, appointments, courses, listings, projects, services, custom objects and segments.
  - Revenue objects (beta).
  - Calls, emails, meetings, notes and tasks.
  - Blog posts, landing pages, site pages, campaigns and marketing events; content analytics.
  - **Conversations** (chat, team email, WhatsApp, SMS, Messenger, custom channels).
  - Marketing-email analytics and deliverability health.
  - Account, teams and seat counts.
  - AEO responses, including Claude's answers.
- **Write access:**
  - Create and edit the records listed above (the MCP server respects conditional field and pipeline validation).
  - Log activities.
  - Create, edit and **publish** landing pages, website pages and blog posts.
  - Campaigns; marketing-email drafts.
  - Pipelines (Free can edit only the default pipeline).
  - Custom properties.
  - Quotes (beta, Revenue P+).
  - Static segments.
  - AEO prompts and recommendations.
- **Tools:**
  - Account and schema: `get_user_details`, `get_organization_details`, `discover_hubspot_schema`.
  - Records: `search_crm_objects` (5 filter groups × 6 filters; 200 results per page), `get_crm_objects` (100 per request), `manage_crm_objects` (shows proposed changes and needs **explicit confirmation**), `manage_segment`.
  - Data and properties: `query_crm_data` (SQL-like; no joins), `search_properties`, `get_properties`, `manage_custom_properties`, `manage_custom_pipelines`, `search_owners`.
  - Campaigns: `get_campaign_attribution_reports`, `read_campaign_data`, `manage_campaign_objects`.
  - Conversations: `search_conversations`, `get_conversation_channel_metadata`.
  - Marketing email and content: `get_marketing_email_analytics`, `manage_marketing_email`, `get_content_analytics_report`, `manage_landing_page`, `manage_website_page`, `manage_blog_post`, `render_asset`, `render_landing_page_ui`.
  - AEO: `get_aeo_metrics`, `manage_aeo_prompts`, `manage_aeo_recommendations`.
  - Other: `manage_onboarding`, `tool_guidance`, `submit_feedback`.
- Every write is attributed in the audit log (AIT).

**Related tools:** a Lovable connector (beta), Agent CLI (beta) and HubSQL API (private beta) (SPOT).

---

## E. Google Workspace and Microsoft 365 integrations

| Integration | What syncs, and in which direction | Tier | Known limitations | Source |
|---|---|---|---|---|
| **Gmail / Google Workspace inbox connection** | Send 1:1 and sequence email from the CRM (appears in Gmail Sent). **Log all emails** to and from existing contacts, including those sent outside HubSpot (default rule). "Reply-only" mode is optional. Auto-create contacts (beta). Personal and account-wide **never-log lists** (emails or `*@domain`; not retroactive) | All tiers; view-only seats can't connect | Accounts in Google's Advanced Protection Program are unsupported. One address can't be both a personal inbox and a team inbox | KB-INBOX, KB-LOG, KB-NEVER |
| **HubSpot Sales Chrome extension (Gmail sidebar)** | Track opens and clicks (clicks need a Sales seat on P/E); log to contact, company, deal or ticket; **contact-profile sidebar** in Gmail (search the CRM; create and associate records); insert templates, **sequences**, meeting links, **tracked documents**; create notes, tasks and calls from Gmail; Breeze Assistant for Gmail (Fall 2026) | F+ (features by tier) | Attachments over 50 MB don't log; custom Gmail layouts unsupported; no back-logging of old mail; GDPR legal basis needed to track. Marketplace: 534K installs, 4.0★; reviews cite session drops and lag | KB-CHR, KB-CHRP, MK-GMAIL, SPOT |
| **Outlook / Microsoft 365 inbox + Office 365 add-in** | Same as Gmail: track, log (via BCC), contact task pane, templates, sequences, meetings, documents | F+ | The **task pane must be open when sending**; Microsoft 365 **shared mailboxes unsupported**. The **Outlook desktop add-in is in maintenance mode**; the Office 365 add-in covers new and classic Outlook, Mac and web. 248K installs | KB-O365, KB-ODESK, KB-INBOX, MK-EXP |
| Exchange (on-premise) | Personal inbox connection only (Exchange 2010 SP2+) | F+ | **No two-way calendar sync with Exchange** | CAT, KB-CALC |
| **Google Calendar / Outlook Calendar** | **Two-way.** Calendar events with **existing** contacts log as meetings; edits and reschedules update; Outlook cancellations delete the meeting. Meetings created on a CRM record send invites. Booking pages check free/busy (you can add extra calendars for availability) and create events. **Task calendar sync** (S+) pushes tasks to the calendar | F+ | Doesn't create contacts; exact email match required; **recurring series: first event only**; private events skipped; internal domains excluded; primary calendar only; can't connect Google and Outlook at once; no shared calendars; Outlook events over 65,536 characters skipped; attendees added in HubSpot don't update the calendar event; deleting in HubSpot doesn't delete the calendar event | KB-CAL, KB-CALC, CAT |
| **Meeting scheduler (booking pages)** | One-on-one (F: 1 link, branded); **group and round robin** (S+); availability windows, buffers, minimum notice, 15-minute increments, booking up to 10 weeks ahead; custom form questions; CAPTCHA; block free email domains; up to **3 reminder emails**; redirect after booking; **payment collection** via payment links; multi-language; website embed or pop-up | F / S+ | 1,000 links on S+; team members need seats and connected calendars | KB-SCHED, CAT |
| **Google Meet** | Auto Meet link on booking pages and CRM meetings; **recording sync** (Meet Business/Enterprise); in-meeting HubSpot sidebar (look up or create contacts, notes, playbooks) | All tiers; each user installs | Needs a connected Google Calendar; HubSpot creates a hidden "shadow" secondary calendar. 75K installs | KB-GMEET, MK-EXP |
| **Microsoft Teams** | Auto Teams links on bookings and records; **recordings and transcripts sync to the meeting record** (since August 31, 2026); notifications in Teams (assignments, mentions, form submissions…); **reply to inbox conversations from Teams channels**; create tasks and tickets from Teams messages; link channels to deals and companies; workflow-created channels; help-desk tickets in Teams; Teams call logging; Teams webinars | Base on any tier; workflow notifications, inbox and channels need a paid plan; CI analysis needs Sales/Service P | Tenant admin must enable PowerShell app access policies, Graph and speaker attribution, and attendance reports. **3.2★ (252 reviews)**; reviews cite setup and connection problems | KB-TEAMSREC, KB-TEAMS, MK-TEAMS |
| Zoom | Meeting links; webinar registration workflow action; records and workflows | F+ | 92K installs | MK-EXP, KB-WFA |
| **Google Contacts sync** | Two-way or one-way contact sync (contacts only) | F+; custom mappings need Data Hub | 11 fixed default mappings; changes sync within about 10 minutes | KB-GCON |
| **Outlook Contacts sync** (also Exchange) | Two-way or one-way contact sync | F+; custom mappings need Data Hub | 14 fixed default mappings | KB-OCON |
| **Google Drive** | Link Drive files and folders to records (**Drive card**, up to **25 per record**); **AI overviews** of Docs, Slides and PDFs; file activity; workflows create shared drives and folders and link files (P+); import into the files tool and Documents | All tiers | Respects Google sharing permissions; per-user connection. 17K installs | KB-GDRIVE, KB-FILES, KB-DOCS |
| **SharePoint / OneDrive** (**public beta**, new in 2026) | Link files and folders (**≤20 per record**); open in Microsoft 365 apps; AI insights; workflows create folders, upload files from records, link files (P+) | All tiers | **OneDrive for Business only**; tenant-wide admin consent may be needed; a Super Admin opts in to the beta | KB-SP, SPOT |
| Google Sheets | Workflow rows (app); **Sheets as a Data Studio source** (new, Fall 2026) | F+ / Data P | n/a | MK-EXP, SPOT |
| Google Ads | Create and manage ads; lead syncing; audiences (list audiences 2/5/15 by tier); conversion events (5/50/100) synced hourly; **PMax**; **Google Ads recommendations in HubSpot** (beta); Google's "Data Connector" app | F+ (limits by tier) | Needs your own ad accounts and spend | CAT, SPOT, MK-EXP |
| Google Search Console | SEO data in HubSpot | Mktg/Content P+ | n/a | CAT |
| Google Chat | Workflow notifications | P+ (workflows) | n/a | KB-WFA |
| BigQuery | Two-way sync (beta) | Data E | n/a | SPOT |
| Gemini / Copilot connectors | CRM Q&A and drafting inside Gemini and Copilot | All tiers | n/a | AIT |
| Microsoft Advertising | Campaign performance, contact and deal attribution | New in Fall 2026 | n/a | F26 |
| Social login (Google, Microsoft); SSO (P+) | Sign-in | n/a | n/a | CAT |
| **Google Business Profile** | **No HubSpot-built integration found.** Not in the social-network list (Facebook, Instagram, LinkedIn, YouTube, X, TikTok) nor among HubSpot-built Marketplace apps. Reviews and Q&A need Zapier, n8n or partner apps [2H] | n/a | Gap for local businesses | CAT, MK-EXP; https://zapier.com/apps/google-my-business/integrations/hubspot |

---

## F. Pricing and seats (September 2026)

### F1. List prices
Where two prices are shown, the first is the annual-commit price and the second is paid monthly.

| Product | Starter | Professional | Enterprise | Credits (S/P/E) | Onboarding (required) | Source |
|---|---|---|---|---|---|---|
| **Starter Customer Platform** (Mktg + Sales + Service + Content + Data Starter) | **$20/seat list; promo $7/seat** (new customers, limited time) | — | — | 500 | None | P-CRM, CAT |
| Customer Platform (all Hubs) | as above | **$1,300 / $1,450 per month, 6 seats**; extra core seat $45 | **$4,700 per month, 8 seats**; extra $75 | 500 / 5,000 / 10,000 | Customer Platform onboarding exists; price not published [2H: $3,000–$7,000] | P-SUITE, CAT |
| Smart CRM | $20/seat | **$45 / $50 per seat** | $75/seat | 500 / 3,000 / 5,000 | n/a | P-SCRM, CAT |
| Marketing Hub | $20/seat | **$800 / $890 per month, 3 core seats**; extra $45 ($50 in CAT) | **$3,600 per month, 5 seats**; extra $75 | 500 / 3,000 / 5,000 | **$3,000 / $7,000** | P-MKT, CAT |
| Sales Hub | $20/seat | **$90 / $100 per Sales seat** | **$150 per seat** | same | **$1,500 / $3,500** | P-SAL, CAT |
| Service Hub | $20/seat | **$90 / $100 per Service seat** | **$150** | same | **$1,500 / $3,500** | P-SVC, CAT |
| Content Hub | $20/seat | **$450 / $500 per month, 3 seats** | **$1,500 per month, 5 seats** | same | Not stated on the pricing page | P-CMS, CAT |
| Data Hub | $20/seat | **$720 / $800 per month, 1 seat** | **$2,000 per month, 1 seat** | 500 / **5,000 / 10,000** | Not stated | P-DATA, CAT |
| Revenue Hub | — | **$85 / $95 per Revenue seat** ($57 when bought with Sales Hub) | **$140** ($98 promo) | — / 3,000 / 5,000 | n/a | P-REV, P-SAL, CAT |
| HubSpot AEO (standalone) | $50 per month ($45 annual): 25 prompts × 3 engines | Included with Mktg P/E | n/a | n/a | 28-day trial | P-MKT, CAT |

**Promotion details.** The $7 annual rate reverts to list price when the promotion ends; one source cites $10/seat for month-to-month [2H] (https://tinycommand.com/blogs/hubspot-pricing-explained; secondhand pricing guides). Several guides also describe a pre-promotion annual price of $15/seat [2H] (https://ventureharbour.com/hubspot-review/).

### F2. Seat model (CAT)
- **Core seat:** everything purchased at the account's **highest** tier, including Breeze Assistant, enrichment and Smart CRM.
- **Sales / Service / Revenue seats:** unlock the full P/E functionality of that Hub (sequences, forecasting, help desk, quotes, e-sign…). **Starter has no specialized seats.**
- **View-only seats** and **Partner seats:** free.
- **Routing:** chats, bots and team email can be routed **only to Sales or Service seat holders**.
- **Free:** 2 users.
- **Minimums:** Mktg P includes 3 seats; Content P includes 3; Customer Platform P includes 6; Data P includes 1. Sales and Service have "no additional seat minimums".
- **Commitments:** Professional plans show "Commit annually"; Enterprise is billed annually.

### F3. Contact-tier escalators (Marketing Hub; CAT)
- **Starter:** 1,000 contacts included; then per 1,000 marketing contacts per month: $50 (up to 3,000), $45 (up to 5,000), $40 (5,001+).
- **Pro:** 2,000 included; then per 5,000: $250 (to 22,000), $225 (to 42,000), $200 (to 62,000), $175 (to 82,000), $150 (82,001+).
- **Enterprise:** 10,000 included; then per 10,000: $100 (to 50,000), $90 (to 100,000), $80 (to 200,000), $70 (to 500,000), $60 (500,001+).
- **Rules:**
  - **Overages are billed immediately.**
  - Downgrading a contact to non-marketing takes effect next month or at renewal, whichever is first.
  - The contact tier **cannot be reduced until renewal**.
  - Non-marketing contacts are free, up to 15M contacts in total.

### F4. What Free actually includes
See C0. The key caps are:
- **1,000 contacts, 2 users, 10 custom properties, 30-day timeline, 1 pipeline per object.**
- 2,000 branded marketing emails per month.
- 1 meeting link; 3 templates; 3 snippets; 200 tracking notifications.
- 30 website pages and 30 landing pages.
- No calling minutes.
- Support is **Community, Academy and KB only** (P-CRM FAQ).

Free *does* include:
- Invoices, payment links and subscriptions (with a payments account).
- Ticketing, 1 shared inbox, live chat, bots, forms.
- Breeze Assistant; the Claude, ChatGPT and other connectors.

---

## G. Recommendations

### G1. The 25 HubSpot ideas most worth copying for plumbers, restaurants, and child/adult day care

| # | Idea (HubSpot source) | Why it matters for these businesses |
|---|---|---|
| 1 | **Log everything automatically by default**: all email with known contacts, synced calendar events, call transcripts; never-log lists by address or `*@domain` (KB-LOG, KB-NEVER, F26) | Owners won't do data entry. A plumber's back-and-forth with a homeowner, or a director's emails with a parent, should just appear on the record. Never-log protects vendor and personal email |
| 2 | **Three-column record page:** facts left, timeline middle, related records and files right; conditional cards per team (KB-LAYOUT) | One screen per household or customer is exactly the "centralize a customer" ask |
| 3 | **Association labels** such as "Parent", "Guardian", "Emergency contact", "Authorized pickup", "Billing payer", "Property owner vs tenant" (CAT, P+ in HubSpot) | Day care is many-to-many (child ↔ several adults with different rights); plumbing has owner vs tenant vs property manager. **Make it free** — HubSpot charges for it |
| 4 | **Automatic roll-up of activities** to the primary company and open deals (KB-ASSOC) | A "Household" or "Property" record that automatically shows every interaction with any family member or tenant |
| 5 | **Industry objects switched on with a toggle** (Appointments, Services, Courses, Listings) plus **AI data-model recommendations from a business description** (KB-DMB, KB-DMT) | Ship templates for "Plumbing: Jobs, Service Agreements, Properties", "Restaurant: Catering orders, Private events", "Day care: Enrollments, Classrooms, Waitlist" so setup takes 5 minutes |
| 6 | **Typed file properties** (up to 10 files per field, form uploads up to 100 MB) (KB-PROP) | "Immunization record", "Allergy action plan", "Physician's report", "Liability waiver", "Health inspection", "Permit". Add **expiry dates plus reminders**, which HubSpot lacks |
| 7 | **Attachments card** with source filter, preview, rename, detach vs delete, **24-hour external share link** (KB-ATT) | Share an invoice PDF or care plan without exposing a permanent public URL |
| 8 | **Private-by-default files** with public / noindex / private modes and internal-only links (KB-FVIS) | Child and health documents must never sit on a guessable public CDN URL (HubSpot's default is public, so improve on it) |
| 9 | **Documents with view tracking** and "notify me when opened", optional email gate (KB-DOCS) | Know when a parent opened the enrollment packet or a customer opened a quote, then follow up |
| 10 | **Free invoices, payment links, stored cards and ACH, subscriptions with automatic retries**, automated invoice reminders (CAT) | Tuition autopay, maintenance-plan billing, catering deposits. HubSpot gives this away free, so match it |
| 11 | **Quote → accept → pay on one page → invoice and subscription** (KB-Q) | A plumber's estimate becomes a signed job and deposit in one step. Include basic **e-signature on any document**, not just quotes |
| 12 | **Booking pages** with round robin, buffers, minimum notice, up to 3 reminders, custom questions, **payment at booking** (KB-SCHED) | Estimate visits, day-care tours, private-dining consultations. Deposits cut no-shows |
| 13 | **Two-way Google and Outlook calendar sync**, including task sync to the calendar (KB-CAL, CAT) | Technicians and directors live in their phone calendar. Also sync recurring events properly, which HubSpot doesn't |
| 14 | **Unified inbox**: email, chat, Messenger, WhatsApp, SMS; channel switching; assign and route (CAT) | Restaurants get catering requests by DM or WhatsApp; parents text. One threaded conversation per contact |
| 15 | **Customer Agent with outcome pricing** ($0.50 per *resolved* conversation), cites sources, hands off with context, sends payment links (OBP, SPOT) | After-hours "Do you have openings?", "What's the menu for the party tray?", "Is my water heater covered?". Pay only when resolved. Tiny businesses love this model |
| 16 | **Voice AI on the phone line** with IVR fallback (Customer Agent voice beta; sequential IVR) (SPOT, SPR26) | Plumbers miss calls while under a sink; an AI that books the job is worth more than any dashboard |
| 17 | **Caller ID matched to the CRM** plus call logging in the mobile app (MOB) | "Mrs. Lopez, Maple St, last visit March" appears before answering |
| 18 | **Mobile and in-person notetaker** that turns a conversation into notes, tasks and CRM updates with one-click approval (SPOT, F26) | Parent-teacher chat, on-site job walk-through, catering tasting, captured without typing |
| 19 | **Record summary** (Breeze) and **plain-language questions over your CRM** (Data Agent CRM research; MCP connectors for Claude and ChatGPT) (SPOT, MCP) | "Which families haven't turned in updated immunizations?" or "Which customers had water-heater work more than 8 years ago?" |
| 20 | **Smart properties**: a per-record AI question, human-approved before saving (CAT) | Tag reviews or notes: "Mentions allergy?" "Likely needs replacement vs repair?" Put credits behind transparent caps |
| 21 | **Simple workflows even on the cheap tier**, plus a **template marketplace** and "turn a workflow into an agentic workflow" (CAT, SPOT) | "When a job is marked done → send invoice → ask for a review in 2 days"; "Enrollment accepted → send packet → remind in 7 days". HubSpot gives Starter only restricted workflows |
| 22 | **Feedback surveys** (NPS, CSAT, custom) plus post-chat CSAT (CAT, Service P) | Restaurants and day cares live on reputation. Pair with **Google Business Profile review requests**, which HubSpot lacks natively |
| 23 | **Self-service portals**: ticket portal plus **billing portal** (pay invoices, update card, manage subscription) (KB-PORTAL, CAT) | A "parent portal" or "customer portal" with invoices, documents, messages and schedule in one login. HubSpot splits this across two paid Hubs |
| 24 | **Data quality overview**: scheduled scans for duplicates, formatting and missing fields; **Context Home** completeness score (CAT, F26) | Owners will import messy spreadsheets. Show a "profile completeness" meter per record and account, which also works as a setup meter |
| 25 | **Sensitive-data mode**: field-level sensitive flags, restricted AI access, exclusion from risky features (CAT, MCP) | Day care (children's data; possible COPPA/state rules) and adult day care (health data; possible HIPAA). HubSpot limits this to **Enterprise**; offering it at SMB price is a wedge |

**Honorable mentions:**
- Object tags (color rules) for "VIP", "Past due" or "Allergy" badges.
- Board or calendar view on any object.
- Task queues and repeating tasks, such as quarterly backflow tests or annual health forms.
- The 90-day recycle bin.
- View-only seats free (useful for owners or accountants).
- Multi-currency (5 on Starter).
- Spanish UI and support (KB-LANG).
- Google Drive and SharePoint cards per record.
- Scheduled AI prompts ("every Monday: families with overdue balances").
- Password-protected share links for AI-generated reports.

### G2. What HubSpot does badly for tiny businesses

1. **Price cliffs.**
   - Marketing jumps from about $20/seat on Starter to **$800–890 per month plus $3,000 onboarding** on Pro. Enterprise is $3,600 per month plus $7,000 (P-MKT, CAT).
   - Commentators call it "a roughly 44× jump" or "59×" [2H] (https://tinycommand.com/blogs/hubspot-pricing-explained, https://ventureharbour.com/hubspot-review/).
   - Reddit threads complain about "constant, aggravating paywalls" [2H] (https://www.reddit.com/r/hubspot/comments/1krc67q/).
2. **The free tier has been hollowed out.** 1,000 contacts, a 30-day timeline, 10 custom properties, no calling minutes, and community-only support (CAT, P-CRM). A day care with 150 families and staff, or a restaurant's catering list, hits limits fast, and the 30-day timeline defeats the "customer history" promise.
3. **Seat taxes.** Sequences, forecasting, help desk, playbooks and CI need per-seat Sales or Service seats at $90–150. Quotes need a $85–140 Revenue seat. **Chats and team email can only be routed to Sales or Service seat holders** (CAT). A 6-person shop with shared phones pays per head.
4. **Basic business objects are paywalled.**
   - Quotes require Revenue Hub Pro for accounts created after September 3, 2025 (KB-LQ).
   - Custom objects are Enterprise only; calculated properties and association labels are Pro+ (CAT).
   - Leads are Sales Pro (KB-OBJ).
   - Workflows beyond "restricted" need Pro (CAT).
5. **Regulated data is Enterprise-only.** Children's information, health data and HIPAA PHI are permitted only under Enterprise Sensitive Data (CAT). The general terms forbid use that would violate COPPA or HIPAA (TOS). That effectively prices child and adult day care out of compliant use (analysis).
6. **Contact-based marketing pricing traps.** Overages bill immediately and the tier can't be reduced until renewal (CAT). Annual commitments apply on Pro/Ent (pricing pages). Onboarding is non-refundable [2H] (ventureharbour).
7. **AI cost unpredictability.**
   - Credits are metered per action and per recurrence, with no rollover, and capacity auto-upgrades persist for the rest of the term (CAT).
   - Consultants warn a single smart-property fill on 10,000 records costs 100,000 credits ($1,000) [2H] (https://www.processproconsulting.com/resources/hubspot-credits-the-hidden-cost-of-smart-properties).
   - Content Agent costs 1,000 credits ($10) per piece (CAT).
8. **Complexity.** There are six Hubs, three tiers, five seat types and credits. The Fall 2026 release alone had **134 updates**, many in beta (SPOT). Features move between Hubs and change names (Operations → Data, Commerce → Revenue, customer portal → support portal). This is too much for an owner-operator (analysis).
9. **Not built for service operations** (analysis):
   - No dispatch, technician routing, job costing, parts or inventory for plumbers.
   - No reservations, POS, menu or table integration natively for restaurants.
   - No attendance, check-in/out, ratios, licensing, subsidy or CACFP billing, or incident reports for day care.
   - "Appointments" is just an object, not a schedule board.
   - No native Google Business Profile reviews (MK-EXP).
10. **Integration rough edges.**
    - Teams app rated **3.2★** with setup and connection complaints (MK-TEAMS).
    - Gmail extension reviews cite session drops and slowdowns (MK-GMAIL).
    - Calendar sync handles only the **first event of a recurring series**, ignores shared calendars, and doesn't do two-way with Exchange (KB-CAL, KB-CALC).
    - Outlook shared mailboxes are unsupported (KB-INBOX).
    - The Outlook desktop add-in is in maintenance mode (KB-ODESK).
11. **Geographic and language limits.**
    - The UI is in 15 languages (including Spanish), but full support is in only 6 (KB-LANG).
    - SMS is **US and +1 only**; HubSpot Payments is **US, CA and UK only**; e-invoicing is Belgium and Germany only (CAT).
    - AI brand voice supports only ES, PT, FR, DE and JA beyond English (CAT).
    - Multilingual SMB owners outside those markets, such as Spanish-speaking plumbers in the US, get the UI in Spanish but thinner AI and support coverage (analysis).
12. **Documents are split across tools.** There are four separate stores (files, attachments, Documents, file properties), each with different limits (20 MB to 2 GB), and no expiry tracking. E-signature is limited to quotes. The portal shows tickets only (KB-FTYPES, KB-ESIG, KB-PORTAL).

---

### Appendix: other 2026 launches not mentioned above (SPOT, SPR26)

- **Spring 2026:** HubSpot AEO standalone; TikTok Ads and social; Reddit in HubSpot; campaigns connected to the CRM across custom objects; enhanced campaign asset reporting; personalized video at scale; "advanced controls for meetings".
- **Fall 2026 marketing:** Ad leads hub; Instagram Collabs; custom properties on social posts; share assets across campaigns; simplified lead-scoring rules.
- **Fall 2026 CRM:** actionable email notifications; faster custom reports (10× faster).
- **Fall 2026 Revenue Hub:** direct contract creation; contract-based revenue reporting (MRR, TCV, NRR, GRR); billing migration; Payment object in the Data Model Builder; Brands in quotes.
- **Fall 2026 Data Hub and ecosystem:** Data Studio webhooks and builder enhancements; 156+ new Marketplace apps (including Epic); redesigned Solutions Directory; connected-apps digest; partner asset portability.

**Open items I could not confirm:**
- The exact tier for the centralized audit log.
- Content Hub and Data Hub onboarding fees.
- Customer Platform onboarding prices.
- Whether Documents shows page-level view analytics.
- Customer Agent language coverage.
- Credit rates for the Campaign, Closing and Customer Health agents (not on the rate sheet).
