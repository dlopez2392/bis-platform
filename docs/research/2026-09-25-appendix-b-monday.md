# Appendix B — monday.com and monday CRM, feature by feature (September 2026)

Part of `2026-09-25-crm-feature-research.md`. Compiled 2026-09-25 by a delegated research agent from monday's live help-centre articles (read through its public API), the monday CRM and work-platform pricing pages including the feature matrix extracted from the page's own JavaScript bundle, and developer docs. Built from published sources, not from a logged-in account. Secondhand claims marked [2H]; conflicts between monday's own sources marked [CONFLICT].

---

# monday.com and monday CRM: feature inventory as of 2026-09-25, for a competing small-business CRM

## How to read this report

**Sources.**
- **KB-NNN** means the monday.com help-centre article at `https://support.monday.com/hc/en-us/articles/NNN`. I read these through Zendesk's public help-centre API, so every KB claim below comes from the live article text. Most were updated between June and September 2026.
- **PRC** is `https://monday.com/crm/pricing`. The plan cards were scraped live. The "Complete feature list" matrix is not in the page HTML (it loads with JavaScript), so I pulled it out of the page's own JavaScript bundle (`/nhp/_next/static/chunks/4413-*.js`) and matched it to the page's text strings. The bundle holds a newer `newFeaturesList` and an older `featuresList`; I say which one a claim comes from.
- **PWM** is `https://monday.com/pricing`, the work-management page, now called the "AI work platform".
- **DEV** means `https://developer.monday.com/api-reference/docs/…` or `/reference/…` (the `.md` versions).

**Markers.**
- **[2H]** — secondhand (third-party review or vendor blog).
- **[CONFLICT]** — monday's own sources disagree.
- **[inference]** — my own reasoning from the numbers.

**Plan names.**
- monday CRM: Basic / Standard / Pro / **Ultimate**. PRC says "Ultimate is a new name for our Enterprise tier". Some KB pages still say "Enterprise".
- Work management was renamed **"monday AI work platform"**. Its plans are Free / Basic / Standard / Pro / Enterprise (KB-4405633151634).
- The Free plan exists only on the AI work platform. The CRM cannot be installed on Free (KB-360010487220).

---

## Summary

1. **Price.** CRM costs **$12 / $17 / $28 per seat per month billed yearly**, or **$18 / $25 / $41 monthly**. Ultimate is priced by quote. There is a **3-seat minimum**, then seats come in groups of 5, so 4 people pay for 5 and 6 people pay for 10. The real entry price is **$36/month ($432/year) on Basic**, or $54/month if paid monthly. (PRC; KB-4405633151634)
2. **Basic CRM is almost unusable for a real business:**
   - 5 columns per board;
   - 1,000 contacts and deals;
   - 1 workspace and 1 dashboard;
   - no email sync (Emails & Activities starts at Standard);
   - no guests;
   - 20 quotes/invoices a month.

   Pro is the real CRM: mass email, sequences, email templates and tracking, forecasting, formula column, private boards, unlimited guests. (PRC)
3. **The customer record is a configurable item page.** It opens on an Overview tab of widgets — fields, Emails & Activities timeline, linked records, files gallery, subitems, embedded doc, deal stages, quotes — next to an Updates/timeline pane. It is powerful but has to be built by an admin. (KB-360017143959, KB-4409464697618)
4. **Documents are handled well, but not as a document product.**
   - A Files column with preview, annotations and versions ("trial feature, may require payment").
   - A Files Gallery view.
   - A monday doc per item, with templates and live fields pulled from the record.
   - Storage of 5 / 20 / 100 / 1,000 GB by plan; 500 MB maximum per file.
   - **No native legally-tracked e-signature.** Quotes & Invoices cannot yet store countersigned documents, so signing goes through DocuSign, PandaDoc or marketplace apps. A WorkForms "Signature" question does capture a drawn signature. (KB-360000597900, KB-21050405375762, KB-22630036771986)
5. **AI is now sold in credits at $0.01 each.**
   - AI blocks cost 8 credits per action.
   - AI Notetaker costs 120 credits per hour.
   - Smart Call costs 5 credits per connected minute.
   - The AI Sales Agent costs 150 credits per call of up to 5 minutes.
   - The AI Lead Agent costs 10 credits per lead.

   CRM accounts get a **one-time 6,000-credit trial (12,000 on Ultimate)**. Since 2026-05-06 the AI work platform requires 1,000 / 2,000 / 3,000 credits a month by tier. (KB-24047211522194, KB-35277848309394, KB-25760992782226)
6. **Agents shipped in CRM in 2026:**
   - Lead sourcer (Lead Agent);
   - Outreach caller (AI Sales Agent: US only, voice plus SMS);
   - Meeting Prep Agent;
   - Pipeline Health Agent ("Piper");
   - a custom agent builder;
   - "Bring Your Own Agent" for agents built on Claude, Copilot Studio, OpenAI and others;
   - monday vibe (app builder), monday magic (workspace from a prompt), and sidekick (assistant that also works over WhatsApp and Telegram).
7. **The monday MCP server** is hosted at `https://mcp.monday.com/mcp`.
   - It has 60+ tools and works on every plan.
   - It costs no AI credits but counts against the daily API-call limit: 1,000 calls/day on Free, Basic and Standard; 10,000 on Pro; 25,000 on Enterprise.
   - Claude, ChatGPT, Cursor, Copilot, Gemini CLI and others can connect. (DEV mondaycom-mcp, rate-limits; KB-35696101067154)
8. **Microsoft limitations.**
   - The board-level Outlook integrations require the connecting user to hold a **Microsoft 365 Business Premium licence** and use online Exchange.
   - CRM Emails & Activities connects Outlook separately through OAuth; a Microsoft tenant admin may have to approve the connection.
   - Google Calendar sync in the CRM is Pro+ on the pricing page. Outlook Calendar sync is Standard+. (KB-360011895179, KB-4404712396562, PRC)

---

## A. Data model (the Work OS layer the CRM inherits)

### A1. Hierarchy and structural limits

| Object | What it is | Plan | Limits | Source |
|---|---|---|---|---|
| Account | Tenant. Its data region is fixed by where the first user signs up. | All | US, EU or APAC region. EU is available on Enterprise and on Standard/Pro accounts created on or after 2023-01-23. Japan accounts are hosted in the US. The region cannot be changed without a new account. | KB-4404392703250 |
| Workspace | Container for boards, docs, dashboards and folders. Kinds: open, closed, template. | CRM: Basic 1, Standard 3, Pro 15, Ultimate unlimited. Closed/private workspaces are Enterprise only. | "Workspaces 2.0" (beta, AI work platform) adds a workspace agent, free while in beta. | PRC; DEV workspaces; KB-37543977016978 |
| Folder | Nesting inside a workspace | All | — | DEV llms index |
| Board | Table of items. Kinds: **main** (visible to all members), **shareable** (guests; Standard+), **private** (Pro+). | Unlimited boards on Basic+; Free has 3 | 10,000 items per board (Enterprise 100,000). CRM Pro may have up to 5 boards of 100,000 items each. CRM Enterprise can reach 1M items per board (beta). | KB-115005311105, KB-4404058746642 |
| Data Set | A table built for up to 10M items | Enterprise; only admins create them | No subitems | KB-35919014991634 |
| Group | Coloured section of a board | All | — | KB board-elements section |
| Item | A row (record) | Free: 200 items per account, up to 1,000 with referrals. Unlimited on Basic+. | Trash keeps deleted items 30 days; archive keeps them indefinitely; undo from the activity log for 7 days | KB-360010487220, KB-115005312729, KB-360011810600 |
| Subitem | Child row with its own columns | All | Multi-level boards reach **4 levels of hierarchy**, on newly created boards only | KB-360011905480, KB-29810815287570 |
| Column | Typed field. CRM columns per board: **Basic 5, Standard 15, Pro 75, Ultimate unlimited**. | Varies | — | PRC |
| Doc (workdoc) | Block-based document. Can live in a workspace, a Doc column, the Files column, or an item's description. | Free: 3 docs; Basic+ unlimited | Version history | PWM; KB-360021702939 |
| Dashboard | Widgets fed by connected boards | Boards per dashboard: Free/Basic 1, Standard 5, Pro 20, Enterprise 50. CRM dashboard count: Basic 1, Standard 5, Pro 50, Ultimate unlimited. | 30 widgets per dashboard (text widgets not counted); 20,000 items across connected boards | KB-360002187819, PRC |

### A2. Column types

Column Center categories are listed in KB-115005310285. API enum names are in DEV column-types-reference.

| Column | What it does | Plan / limits | Source |
|---|---|---|---|
| Status (also Label, Priority) | Coloured single-select labels | Up to 40 labels | KB-360001269685 |
| People | Assign users or teams; can be capped at 1, 2, 3 or unlimited | AI auto-assign is Pro+ | KB-360002281539 |
| Date | Date, optional time | Weekends setting | KB board-elements |
| Timeline | Date range | Standard+ for the Timeline view | KB-115005333969 |
| Timeline + Numeric (Duration), Date + Status, Timeline + Status | "Combo" columns | — | KB-115005310285 |
| Numbers | Numeric value with unit or currency | — | — |
| Text / Long text | Free text. AI "Refine text" costs nothing. | — | KB-24047211522194 |
| Dropdown | Multi-select | — | KB-360004162179 |
| Checkbox, Rating, Vote, Color picker, Hour, Week, World clock, Country | Utility columns | — | KB-115005310285 |
| Email | Clickable email. It is the **key Emails & Activities uses to log mail.** | — | KB-12428852177810 |
| Phone | Phone number with country flag. Smart Call dials it from mobile. | — | KB-360001151249, KB-35893698534674 |
| Location | Address or geocode that drives the Map view | Map view Standard+ | KB-360001144325 |
| Link | URL | — | — |
| Files | File attachments (see section C) | Not on Free per KB-360010487220 | KB-360000597900 |
| monday Doc | One doc per cell. It inherits the board's permissions. | — | KB-360021702939 |
| Connect boards | Relation to items on other boards | Boards connectable per board: Basic 1, Standard 5, Pro 20, Enterprise 200 (60 per column). Up to **60 connect columns per board**. 10,000 linked items per board (Enterprise and CRM Pro 100,000). **750 links per cell.** | KB-360021743500, KB-360000635139 |
| Mirror | Shows (and can edit) a field of the connected item. Can combine several boards. Respects the source board's permissions. | Read-only via the API | KB-4403442212498, DEV |
| Formula | Calculated field, with a free AI formula builder | **Pro+**; 10,000-character formula limit | KB-360001235445 |
| Dependency | Predecessor links between items | **Pro+**. Batch dependencies up to 50 tasks. Lead/lag is AI work platform only, not CRM. | KB-360007402599 |
| Time tracking | Start/stop timer | **Pro+** | KB-360001143809 |
| Button | Clickable trigger for automations | — | KB-360015690319 |
| Progress tracking | Weighted progress across status columns | Not on Free | KB-360001150365 |
| Auto number | Sequential numbering | Not populated on boards over 20,000 items | KB-360001017529 |
| Creation log, Last updated, Item ID | System metadata (read-only) | — | DEV |
| Tags | Tags shared across the whole account | Listed under Pro | KB-25760992782226 |
| Subitems | Container column for child rows | — | DEV |
| Managed column | Centrally governed status/dropdown labels | Pro: 3 per account; Enterprise: 200 | KB-23053834284690 |
| Column templates | Reusable column configurations | Enterprise | KB-4405213200018 |
| **AI-powered columns** | Translate, Summarize, Assign Labels, Custom AI Prompt, Sentiment, Extract from File, Generate Docs, Improve Text, Write with AI, Extract Info, Summarize Updates, Prioritize with AI, Assign People | 8 credits per action. KB-18640208769682 says Pro/Enterprise; CRM article says Standard+ **[CONFLICT]**. | KB-115005310285, KB-18640208769682, KB-25548698480914 |
| CRM-specific columns | Activities timeline, Quotes & Invoices, Enrolled sequences, "Create a contact" (Move to contacts button), Integration column | See section B | KB-25070276400658 |

**Data-quality controls on columns:**
- Required columns: Pro+, up to 100 per board. KB-27560733058706 lists AI work platform, dev and service.
- Data validations: Pro+, all products including CRM, up to 50 rules per board.
- Item default values.
- Conditional status changes: CRM Ultimate only; **being retired from the end of June 2026** in favour of data validations.

Sources: KB-27560733058706, KB-29863034416786, KB-4409205384338, KB-16157142497810.

### A3. The item page / item card

- **Where it lives.** It opens beside the board and holds the Updates, Activity Log and Item Views tabs. In CRM it adds an Overview tab and the Emails & Activities timeline. The layout is shared by every item on the board; only board owners and admins can edit it. (KB-360017143959, KB-8675571451282)
- **Widgets that read the item's own columns:** Information, Connected boards (being replaced by the Table widget in CRM/dev), Subitems (editable), Emails & Activities (CRM only), Updates, Files Gallery, Item description, Text, Cross-account boards. (KB-360017143959)
- **Widgets that read linked items (via a Connect boards column):** Table, Chart, Battery, Numbers, Calendar, Gantt, Timeline, Workload, Cards, Map, Pivot, Embed Everything. The Connected-boards widget returns at most 100 items. (same article)
- **Item description.** An embedded mini-doc that stays with the item even when moved or converted to a subitem. It cannot embed a board or widget. (KB-17653444316562)
- **App item views.** DocuSign, Quotes & Invoices, vibe apps and others can be added as tabs. (KB-7488210967442, KB-28451758349842)
- **Limitation.** Viewers cannot load the Item Card, because it pulls data through the GraphQL API. (KB-360017143959)

### A4. Updates section (per-item conversation)

- @mentions of people or teams, reactions, "Seen by", GIFs and images, file uploads (from computer, Google Drive, Dropbox, Box, OneDrive, SharePoint), checklists, reminders on an update, scheduled updates, pin to top, bookmark.
- Icon turns grey after 7 days without activity.
- AI summarise-update / summarise-thread and "Write with AI", both free of credits.
- 46,000 characters per update. Deleted updates cannot be recovered.
- Board Discussions for board-level conversation.
- Sources: KB-115005900249, KB-24047211522194.
- **Email to board / item:** every board has a unique email address, and an email can land as a new item or as an update on an existing item. Anyone who has the address, including outsiders, can post to it, and the address embeds the user's API key. (KB-115005339645)

### A5. Activity log

- Board, item and subitem logs record who changed what, when, and the before → after value. They also cover automation-made and AI-made changes (separate "AI Powered" tab), permission changes, and a "Last viewed" log.
- **Retention: Basic 1 week, Standard 6 months, Pro 1 year, Enterprise 5 years.**
- Full log filter (time, group, column) is Pro+; lower plans filter by person only.
- Exports to Excel (column value changes only).
- Updates (comments) are **not** in the activity log.
- Sources: KB-115005310745; PRC matrix.

### A6. Board views

- Up to 100 views per board. Views can be locked (Pro+), pinned, the main table hidden, views shared publicly by link or embed, and PDF exports scheduled. (KB-360001267945)

| View | Plan | Notes | Source |
|---|---|---|---|
| Table (main) | All | Exports to Excel, up to 100,000 items | KB-26989749858578 |
| Kanban | All | CRM "Sales Pipeline view" is a Kanban variant with stage totals | KB-360000661379, KB-8675571451282 |
| Files Gallery | All | Grid, list, table or split mode; zip download | KB-360001264249 |
| Form (WorkForms) | All | See B4 | KB-360000358700 |
| Cards | — | — | KB-4405723870994 |
| Doc view | All | A doc as a board tab | KB-24108289323282 |
| Calendar | Standard+ | Day, week or month | PRC; KB-25760992782226 |
| Timeline | Standard+ | — | PRC |
| Gantt (view and widget) | Standard+ | Milestones, critical path and baseline are Pro+ | KB-360015643840 |
| Map | Standard+ | Uses Location/Country columns | PRC; KB-360001263689 |
| Chart | Pro+ | Stacked charts, benchmark lines, cumulative | PRC; KB-360013939400 |
| Workload | Pro+ | Count or effort mode, weekly capacity | PRC |
| Pivot board | Enterprise/Ultimate | — | KB-360012808539 |
| Forecasting (CRM Deals board) | CRM Pro/Ultimate | See B6 | KB-35252007254930 |
| Dashboard-as-view, AI-built views | Pro/Enterprise with AI enabled | Sidekick or AI prompt; free of credits | KB-360001267945 |
| Marketplace and vibe app views | — | — | KB-28451758349842 |

### A7. Dashboards and widgets

- **Widgets in the knowledge base:** Activity tracker, Board Updates, Embedded Airtable, Products, Sales Gauge, Embed Everything, I Was Mentioned, Battery, Bookmarks, Calendar (now supports start–end ranges), Chart, Countdown, Data Over Time, Deal Insights, Deal Stages, Gantt, Goal, Leaderboard, List View, Llama Farm, Numbers, Overview, Playlist, Quote of the Day, Table, Text, Time Tracking, Timeline, Todo List, Workload, YouTube. CRM also has the Funnel Chart. (KB help-centre search; KB-8675571451282)
- **Enterprise extras:** work-performance insights, dashboard email notifications, pivot analysis. (PRC matrix)
- Dashboards can be public or private. Filters, presentation mode and export are available. (KB-360002187819)

### A8. People, permissions and sharing

| Feature | What it does | Plan / limits | Source |
|---|---|---|---|
| Admin, Member | Full / editing users | Paid seats | KB-360002144900 |
| Viewer | Read-only, can export to Excel, cannot use the API or MCP | **Free and unlimited** on Basic+ | KB-360002144900, KB-35696101067154 |
| Guest | External user on shareable boards; can create items, edit, comment and download files | **Standard: 3 free, then every 4 guests = 1 billed seat.** Pro and Enterprise: unlimited. Basic and Free: none. Guest must use a different email domain from the account. | KB-360000305419, KB-115005340405 |
| Product non-member | Has a seat on one product, viewer rights elsewhere | — | KB-360002144900 |
| Board permissions and board admins | Who can edit content or structure | Board admins Pro+; granular roles Enterprise | PRC; KB-115005315809 |
| Column permissions | Restrict who can edit or view a column | Pro+ | KB-360011926640 |
| Custom roles, content directory, audit log, SCIM, SAML SSO, IP restrictions, session control, panic mode | Governance | Enterprise/Ultimate | KB-25760992782226 |
| Google authentication | Sign in with Google | Pro+ | PRC |
| 2FA, SOC 2 | Security | All | PRC |
| Search Everything | Searches items, updates and file names (not file contents) across the account | Standard+ | KB-115005334069 |
| Public view link / embed | Read-only web publish of a board view | Board owner. **Files-column files are hidden** in shared views. Disabled when HIPAA mode is on. | KB-360009695080 |

### A9. API and platform objects (for data-model parity)

- **GraphQL API objects** include: account, activity logs, aggregate, assets (files), audit logs, boards, board views, columns (typed values), complexity, dashboards and widgets, docs and blocks, favourites, folders, forms, groups, items and `items_page` (cursor paging), managed columns, notetaker, notifications, object relations and schemas, portfolio, replies, search, **sequences** (API 2026-04+), subitems, tags, teams, templates, updates, users, validations, webhooks, workspaces, bulk import (`ingest_items` / `backfill_items`), and for CRM **Custom activity** and **Timeline item** (the Emails & Activities timeline). (DEV llms.txt index)
- **Files:** assets have an ID, URL and name, with scope `assets:read`. Files attach to a Files column or to updates. (DEV reference/assets-1)
- **Idempotency-Key header** for safe retries. **Models API** resells OpenAI and Anthropic models through monday. (DEV index)

---

## B. monday CRM specifically

### B1. Entity boards and how they connect

| Element | What it does | Plan | Source |
|---|---|---|---|
| Entity boards: Leads, Contacts, Accounts, Deals, Activities (plus Quotes & Invoices, products catalog, Sequences) | Pre-built connected boards. **Core boards and columns cannot be deleted or duplicated.** | All; lead/contact/deal templates on Basic+ | KB-4409464697618, KB-25770383733266 |
| Leads board | 15 default columns: Owner, Status (New Lead, Attempted, Contacted, Qualified, Unqualified), Indications, Company, **Lead score**, Email, Title, Role, Region, Phone, Location, Est. employees, Est. licences, Last update, Comments. Groups: New / Qualified / Disqualified. | All | KB-360008648359 |
| Lead → contact conversion | "Move to contacts" button in the "Create a contact" column, or an automation with column mapping | All | KB-4409464697618, KB-115005311909 |
| Account association | Contact email domain matches an Accounts item, or a new account is created. Works only when the email is typed or edited (and from forms, automations and the API). On by default except for Ultimate accounts created before April 2025. | Admin setting | KB-23048348706450 |
| Deals board | Deal value (choice of currency), expected close date, close probability, Forecast value formula = value × probability; Pipeline (Kanban) view | Pro+ for the formula column | KB-360013348719 |
| Activities board | Created automatically with the first activity. Logs calls, call summaries and meetings — **not emails or notes**. Can be synced to a calendar. | Standard+ | KB-4409766475666 |
| Item creation form | Pop-up form when a record is added by hand: choose fields, order and required ones. Board-owner controlled. | All CRM plans | KB-35985764384402 |
| Timeline Overview | Per-record Emails & Activities pane with unread count and colour showing which records have new activity | CRM | KB-25770383733266 |
| Activities timeline column | Colour-coded visual of recent engagement, shown on the board itself | Standard+ | KB-25070276400658 |
| Unlimited pipelines, unlimited boards, unlimited free viewers | — | Basic+ | PRC |
| Active contacts and deals cap | Basic 1,000; Standard 10,000; **Pro 100,000** (older KB says "unlimited" **[CONFLICT]**); Ultimate unlimited | — | PRC, KB-25760992782226 |

### B2. Emails & Activities (the CRM communication hub)

Emails & Activities is available on Standard, Pro and Ultimate, and only to members — guests and viewers cannot use it. (KB-360019213180)

| Feature | What it does | Plan / limits | Source |
|---|---|---|---|
| Two-way Gmail/Outlook sync | OAuth-connected mailbox. Send, receive and reply inside the record. Logs every email involving an address in any **Email column of the item or of a connected item**, and keeps following the thread even if recipients change. | Standard+. **One mailbox connects to only one monday account.** Emails from before setup are not imported. An address used in more than 250 Email columns is not logged. | KB-12428852177810, KB-360019213180 |
| Logging controls | "Log only BCC'd outgoing mail", admin "Never log" list, remove or delete a connection | — | KB-11870581086354 |
| Shared inbox | Share a connected mailbox as view-only, read & write, or cannot-view, per person or team | Read & write is Pro/Ultimate | KB-11870485693202 |
| Attachments | From computer or from the item's Files column | **15 MB**; monday docs cannot be attached | KB-360019213180 |
| Email signature | Simple or HTML; one per user | Pro+ per PRC | KB-11870581086354 |
| "Powered by monday.com" footer | Removable | Pro/Enterprise | KB-11870581086354 |
| Email templates | Personal or shared. Only CRM members can share; admins can edit shared templates. | PRC: Pro+. KB-11870759495314: "all plans". **[CONFLICT]** | PRC, KB-11870759495314 |
| Email tracking | Open pixel and link-click counts; only the sender sees them. Emails sent directly from Gmail/Outlook are not tracked. | Pro+ ("Email tracking & automations") | KB-12428852177810, PRC |
| Automation: email or activity → date column | Stamps "last contacted" | Pro/Ultimate | KB-360019213180 |
| Activities | Built-in Meeting, Call summary and Note. **Custom activity types** with icon and colour. Scheduling. @mentions in internal notes. Timeline filters. | Standard+ | KB-4409766475666 |
| Manual timeline association | Choose which records an email, note or activity links to; links stay fixed | Pro/Ultimate | KB-35433150651154 |
| AI email composer | Draft or edit email with AI | Standard+; no credits | KB-20487462433554, KB-24047211522194 |
| AI timeline summary | One-click summary of all emails, calls, meetings and notes, which can be saved to the timeline | Standard+; no credits | KB-21998050250386 |
| Create contacts automatically | New recipient becomes a Contact (board and email column chosen by admin) | CRM | KB-11737162217490 |
| Chrome extension | Add or update contacts, accounts and deals and log activity from inside Gmail | CRM | KB-24450209205010 |
| Mobile quick actions | Dictate or write notes, call summaries and meeting recaps from the mobile home screen | Standard+ | KB-33603304668050 |
| vibe on E&A data | Build custom apps and views from communication data | — | KB-33902206305810 |

### B3. Outbound email: mass email, sequences, campaigns

| Feature | What it does | Plan / limits | Source |
|---|---|---|---|
| Mass email | Tick rows and send. Each recipient gets their own thread; personalised with `{column}` fields in the body and subject; test send; scheduled send; HTML editor. | Pro/Ultimate. **500 per send, 2,000 per day.** Gmail caps: paid Workspace 2,000/day, trial 500/day. | KB-10989655392914, KB-13093369125778 |
| Mass email tracking | Dashboard of sent, scheduled, delivered %, unique opens % and failures with reasons | Pro+. **No export.** | KB-13093369125778 |
| Sequences (V2) | Multi-step outreach. Steps: wait N days, automatic email, manual email task, general task, call task. Features: conditional runs; pause until a manual step is done; thread or new-email option; attachments (15 MB); time zone and weekday send windows; removal rules (reply, open, bounce, click, auto-reply beta), each able to set a status; per-sequence unsubscribe plus a **global unsubscribe list**; rep notifications; enrolment by hand, via sidekick, or by automation (status change, button, item created, person assigned); Enrolled-sequences column; API. | Pro/Ultimate. **No email templates or HTML inside sequences.** Enrolment can take up to 15 minutes to start. | KB-20666311273874, KB-28312543636370, DEV sequences |
| monday campaigns (separate product) | Marketing email: drag-and-drop builder, segments, analytics, UTM, BIMI, dedicated IP, workflows, subscription groups, calendar invite in email | Pro: 2,000 marketing contacts, 10 sends per contact per month, up to 52,000 contacts, 5 workflows. Enterprise: 10,000 contacts, 15× sends, up to 100,000 contacts, 250 workflows, dedicated IP. Price not captured. | KB-25793455464338 |

### B4. Lead capture, qualification, scoring

| Feature | What it does | Plan / limits | Source |
|---|---|---|---|
| WorkForms (web forms) | Branded form → new item. Question types map to columns: text, long text, number, single select → status, multi select → dropdown, date, date range → timeline, hour, phone, email, location, country, **upload file → Files**, link, rating, true/false, **signature → Files**, people, subitems. Also: conditional logic, save as draft, reCAPTCHA, response limit, close date, submitter can view/PDF their response, 50-language AI translation, AI-built forms, submission analytics and AI highlights, embed or link. | All plans. Hide branding Pro+. **URL-parameter pre-fill Pro+; account pre-fill Enterprise.** AI brand styling Enterprise. PWM matrix lists custom-branded forms as Pro, conditional-logic forms as Enterprise **[CONFLICT with KB, which gates neither]**. | KB-360000358700, KB-22630036771986, KB-27989721912722, KB-11040473466258, KB-26808283008146, KB-28135496780562, PWM |
| Meta/Facebook Lead Ads, LinkedIn, Typeform, Jotform, SurveyMonkey, HubSpot, Pipedrive | Ad and form sources flowing into Leads | Facebook Ads and HubSpot integrations Pro+ | PRC; KB integrations section |
| Excel/CSV import | Map columns. **Duplicate behaviour: add as new / skip / update, matched on a chosen column.** | Under 50 columns and 8,000 rows per file; 100 files per hour | KB-14244473062290 |
| Google Sheets import | — | 3,000 rows, 20 columns | KB-360010415539 |
| AI Lead Agent ("Lead sourcer") | Builds an ideal-customer profile from board data, searches public sources on a schedule, enriches and maps fields, drops results into a "…leads to review" group | Beta. KB: Standard/Pro/Enterprise. 10 credits per lead; 10 leads per user per day. | KB-31594331572370, KB-24047211522194 |
| Lead scoring | Ultimate template: scoring columns (score, source, company size) plus region-based assignment and an "Indications" formula flagging new / duplicate / existing account | **Ultimate** | PRC; KB-360013494979 |
| Round-robin assignment | Assigns only to *available* team members (profile working status); rotation resets every 30 days; 10 pre-built recipes plus custom automations | Standard+; round-robin as a workflow block is Ultimate only | KB-29191074306706 |

### B5. Duplicates and data hygiene

| Feature | What it does | Plan | Source |
|---|---|---|---|
| Manage duplicates / merge | Pick a column (text, email, link, name, number, country, status…). Pick the survivor; others are archived and their updates copied over. **Files-column files and app data (Emails & Activities, Q&I) are not carried over.** Undo = unarchive by hand. | KB: Standard+. New PRC matrix: Pro+. **[CONFLICT]** | KB-4402803033490, PRC |
| Duplicate warning | Alerts on entering a duplicate lead or an existing account | Ultimate | PRC |
| Mandatory fields / conditional status | Required fields before a status change | Ultimate; retiring June 2026 → data validations (Pro+) | KB-16157142497810 |

### B6. Forecasting and sales analytics

| Feature | What it does | Plan | Source |
|---|---|---|---|
| Forecasting view | Wizard maps stage, value, close date and owner. Targets by period with monthly or quarterly split and per-rep sub-targets. Stacked bars by stage or forecast category (Commit / Best Case / Pipeline) with a target line; drill-down. Not available as a dashboard widget. | Pro/Ultimate (gradual rollout) | KB-35252007254930 |
| Sales analytics / forecasting | Real-time dashboard; Sales Dashboard ships built in | Pro+ | PRC; KB-4409464697618 |
| Funnel chart, Deal stages (time in stage, reopen a deal), Leaderboard, Sales gauge, Goal | CRM widgets | Various; Sales gauge on all CRM tiers | KB-8675571451282, KB-26237371345170 |
| Activity tracker widget | Managers see reps' emails and activities | Pro/Ultimate, beta | KB-23905013458450 |
| Deal Insights widget | AI flags at-risk deals using positive and negative signals (engagement, next step booked, multi-threading…); signals can be muted by status | Pro/Ultimate, beta; no credits | KB-28180465521682 |
| Revenue Intelligence | Next-best-action list, AI-drafted follow-ups, meeting prep, AI-suggested field updates, Calls hub with transcripts | Pro/Ultimate; beta, free during beta | KB-34081281988626 |
| Pipeline Health Agent ("Piper") | Scheduled coverage, stage-distribution and velocity analysis; delivered as a Doc report plus Slack/Teams notice; drafts rep nudges that need approval before sending | Gradual release | KB-36620581749394 |
| Team goals / Sales Teams & Attainment board | Quotas and attainment | Ultimate | KB-360013494979 |

### B7. Quotes, invoices, products, payments

| Feature | What it does | Plan / limits | Source |
|---|---|---|---|
| Quotes & Invoices (new version) | Build from the main Q&I page, a column, or an item view. Linked to deal, contact and product catalog. Adjustments for discounts, tax and fees. Logo, signature image, footer terms. Settings for serial-number format, locale (formats only, **no translation**), currency and date format. Toggleable sections including "Signature collection". Live PDF preview; create and download PDF. Locked tracking board with custom columns and automations; reporting. | **Basic 20 / Standard 50 / Pro 250 per month / Ultimate unlimited.** Templates are Pro/Ultimate. **Payment button is just an external URL (PayPal, Shopify…). Cannot yet collect or store countersigned documents** — KB advises uploading the signed PDF to a Files column. **[CONFLICT:** CRM features page says "collect signatures"**]** | KB-21050405375762, KB-20984170988178, KB-33137220581778, https://monday.com/crm/features |
| Products catalog + Products widget | Deal board acts as a live pricing calculator, synced with Q&I | All CRM plans | KB-27719880788114 |
| QuickBooks integration | Syncs customers, items and invoices | **Ultimate only** | KB-25274611229330 |
| Stripe integration | Charges and invoices → items. Workflow actions: create customer, create invoice, find customer, get invoice. | Actions quota | KB-360010322320, KB-14709375878674 |

### B8. Enrichment

- **Crunchbase data enrichment:** enter the company URL and it fills Description, # employees, Industry, HQ and Profile. Beta, limited accounts, Standard/Pro/Ultimate. (KB-15541177212818)
- **Clearbit** and **ZoomInfo** integrations. (KB-360005113800, KB-36309277179794)
- An AI custom block with **web search** is available. (KB-18433811274386)

### B9. Calling and meetings

| Feature | What it does | Plan / limits | Source |
|---|---|---|---|
| **monday Smart Call** | Built-in business number with inbound and outbound calls **from the mobile app only** (it can be triggered from desktop). Auto recording, transcript, AI summary, logged to the record. Verified caller ID. Admin hub. | All CRM plans; needs a paid seat with an assigned number. **5 AI credits ($0.05) per connected minute**, no per-number fee. **Numbers: US, Canada, Puerto Rico, Israel only.** 5 numbers per account. No porting, no browser calling. Disclosure announcement on by default. **Does not check Do-Not-Call lists.** | KB-35893698534674, KB-38017810762770, KB-35893343464850 |
| AI Sales Agent ("Outreach caller") | Voice calls plus SMS follow-ups from a prompt-built playbook; call summary, transcript and outcome on the timeline; ElevenLabs voices; triggered by automation | Beta, **US only**, 4 languages (EN/ES/DE/FR). 10 agents per user, 20 concurrent calls, 1,000 calls per user per day, 20-minute call cap. **150 credits per successful call of up to 5 minutes; 30 per SMS.** Calls under 15 seconds are free. | KB-31002308457234, KB-24047211522194 |
| Aircall app, Twilio (SMS and voice recipes) | Third-party telephony | Aircall is Pro+ in the new PRC matrix. Twilio SMS outside the US needs Twilio geo settings. | PRC, KB-5734277062930, KB-360001310940 |
| Zoom → timeline | Past and scheduled Zoom meetings the user hosted, participants, duration, recording link, transcript | Standard+ | KB-19273496497042 |
| AI Notetaker | Joins Zoom, Teams or Meet; transcript, speaker identification, summary, action items, searchable video; post-meeting chat; can bring agents into the meeting; mobile one-tap recording | All plans; **120 credits per meeting hour**. KB-25548698480914 calls it an "add-on for Pro/Ultimate" **[CONFLICT]**. | KB-28017211500434 |
| Meeting Prep Agent | Scans the calendar; 24–48 hours before a meeting with a matched contact writes a 6-part brief (relationship history, attendee profiles including LinkedIn, open items, forecast update written back to the CRM…). Delivered in-app, via WhatsApp or push, or Slack. On demand: "prep me for…". | Gradual release | KB-36620722582802 |

### B10. Post-sale, account management, sales ops

These are templates, mostly Ultimate:
- account management — client onboarding and renewals;
- client projects — billable hours, quotes;
- collection tracking — Invoices & Collections board;
- headcount planning, sales team onboarding, sales collateral, "Documents for sales" library, legal and security requests.

Won-deal automations fill actual value and close date, create an onboarding item and create an invoice item. (PRC matrix; KB-360013494979, KB-7262038540178)

### B11. Mobile

- The CRM mobile experience covers the **4 core boards only** (Leads, Deals, Accounts, Contacts). Emails & Activities works on mobile; data validations are enforced; the card list view is Android only. (KB-7085413771666)
- Offline mode handles about 70% of board actions but **not Emails & Activities**. (KB-360017712819)
- iOS, Android, Windows and Mac apps exist. (KB-115005317225)
- Standard CRM plan card lists "iOS & Android apps … even offline". (PRC)

### B12. Client portal and external access in the CRM

- **The CRM has no customer portal.** External access is through guests on shareable boards (billing as in A8), public read-only view links (files hidden), workdoc public links, and forms.
- monday's portal product is the **monday service Customer Portal**: open access with email verification and captcha, announcements, docs, "My tickets". (KB-19588196914066, https://monday.com/crm/whats-new)
- A **monday vibe homepage** can be built as a "branded portal" landing page for the team. (whats-new, May 2026)

### B13. Deprecated or retired CRM items

- monday mansion virtual events: deprecated from March 2026. (KB-26036168782354)
- Conditional status changes: June 2026. (KB-16157142497810)
- Sequences V1 → V2. (KB-28312543636370)
- Old Quotes & Invoices is being deprecated. (KB-21050405375762)
- The "Item related activities" filter was removed in December 2025. (KB-4409766475666)

---

## C. The client 360 and documents story

### C1. How "everything about one customer" shows on one page

| Layer | What appears | Plan | Source |
|---|---|---|---|
| Overview tab (item card) | Configurable widget grid, set once per board by owner or admin: Information (all columns), Emails & Activities timeline, Table/Connected boards (for example, a contact's deals, an account's contacts), Subitems, Files Gallery, Item description (doc), Updates, Deal stages, Deal insights, Products, Quotes & Invoices view, DocuSign view, vibe item apps, Embed Everything | All (Emails & Activities widget Standard+) | KB-360017143959, KB-4409464697618 |
| Timeline | Emails, meetings, calls, notes, custom activities, Zoom meetings, calendar events, Smart Call and AI Sales Agent calls, sequence tasks, AI summaries. Filterable. | Standard+ | KB-4409766475666 |
| Account roll-up | Opening an account shows account details plus a combined timeline of email and activity across its contacts | CRM with account association | KB-23048348706450 |
| Timeline Overview and Activities-timeline column | Unread counts and a colour-coded recency cue on the list | CRM (column Standard+) | KB-25770383733266, KB-25070276400658 |
| Updates and activity log tabs | Internal chat thread and field history (previous → new) | Retention by plan (A5) | KB-115005310745 |
| Mirror / Connect columns | Pull a related record's fields (for example, account tier onto a contact) | Connect limits per plan | KB-4403442212498 |

### C2. Files

| Capability | Details | Plan / limits | Source |
|---|---|---|---|
| Files column | Upload from computer, link, Google Drive (no Shared/Team Drives; not in Edge), Dropbox, Box, OneDrive, SharePoint, or create a new monday doc. Hover preview, full-screen preview, delete, **download all of an item's files as a zip**. **500 MB per file.** | Not on Free. All user types including guests and viewers can download. | KB-360000597900, KB-115005339505 |
| File types | Office, OpenOffice, MP3/WAV, GIF/PNG/JPG/BMP/TIFF/WEBP/PSD/SVG/AI, MP4/MOV, ZIP, PDF, RTF, TXT, CSV | — | KB-360000597900 |
| File annotations | Comment and tag people on regions of a file (Files column or gallery) | — | KB-4411048904082 |
| File versioning | "Versions" on a file preview: add version, promote an old version, delete (deleting the current version deletes all versions). **"Trial feature… may require payment in the future."** Only for files uploaded straight to a Files column. | Trial | KB-360021698980 |
| Files Gallery (view and dashboard widget) | Every file on a board, from chosen Files columns and/or updates; grid, list, table or split; zip download. **Cloud-linked files (Drive, Dropbox, docs) are not shown.** | All | KB-360001264249 |
| Files in updates and status labels | Attachments on updates, replies and status boxes | All | KB-115005339505 |
| Storage | **Free 500 MB, Basic 5 GB, Standard 20 GB, Pro 100 GB, Enterprise/Ultimate 1,000 GB** per account | — | PRC matrix; KB-115005320209 |
| Email-to-item | Forward documents into a record's updates | All | KB-115005339645 |
| AI "Extract from file" / "Extract information" | Pulls structured fields from PDFs and, since May 2026, PNG, JPG, WEBP and scanned PDFs (for example, vendor, totals, line items) into columns | 8 credits per action | KB-115005310285, whats-new |
| Limits to know | Files are **not visible in public shared views**. Merge does **not** keep Files-column files. Emails & Activities attachments are capped at 15 MB. Gmail-integration emails are capped at 256 KB and send files as links only viewable by logged-in members. Sidekick email attachments are capped at 5 MB. | — | KB-360009695080, KB-4402803033490, KB-360002427060, KB-26701503726610 |

### C3. Docs attached to customers

- **Doc column.** One monday doc per item, inheriting the board's permissions (a private board means a private doc). Docs made from the Files column live only on that board. (KB-360021702939, KB-360000597900)
- **Templates.** Quick starters, template gallery, "Save as template" (not available for docs on the Files column), Enterprise managed templates. (KB-4499184558610)
- **Dynamic values.** Typing `{` in a doc inserts live column values from the connected item. Templates therefore produce per-record letters, contracts or invoices that stay current. Docs can also embed boards and widgets and turn highlighted text into items. (KB-24108289323282)
- **Sharing and export.** Read-only public link, refreshed about every 30 minutes, not on trial accounts; admins can disable it. PDF export and present mode. Private, shareable (guests) and main docs. Version history with restore. (KB-8563692121746, KB-8563666503954, KB-4478148304146)
- **AI in docs.** Docs assistant and "start doc with AI" are free; the "Generate Docs with AI" column costs 8 credits. (KB-24047211522194)

### C4. E-signature options

| Option | Type | Notes | Plan | Source |
|---|---|---|---|---|
| WorkForms "Signature" question | Native, drawn signature | Saved as an image or file in a Files column; no certificate or audit trail stated. Draft-save does not keep signatures. | All | KB-22630036771986, KB-360000358700 |
| Quotes & Invoices signature | Native (partial) | Uploads *your* signature image. A "Signature collection" section toggle exists, but the KB says countersigned documents cannot yet be collected or stored **[CONFLICT with marketing]** | Basic+ | KB-21050405375762 |
| DocuSign app | Marketplace app | Item-view tab for envelopes; adds Latest Envelope Status / Last Updated / File / Email columns; recipe returns signed PDFs to the Files column. **Needs a DocuSign Business Pro+ admin (or Advanced API).** | PRC new matrix: Pro+ (legacy matrix Standard+) | KB-7488210967442, PRC |
| PandaDoc | Integration (API bridge) | Create, send and track documents from CRM boards | PRC: Pro+ | PRC; https://www.pandadoc.com/integrations/crm/mondaydotcom/ |
| GetSign, DocuGen (+ DocuGen Sign) | Native marketplace apps [2H] | GetSign: generate from board data, sign, collect Stripe payment. Free tier 20 docs and 15 signatures a month; $25 and $70/month tiers. | — | https://getsign.io/best-docusign-alternatives-for-monday-com-users/ [2H, vendor-authored] |
| Adobe Acrobat Sign, SignNow | No native integration [2H] | — | — | same [2H] |
| Dropbox Sign, SignWell | Via Zapier only [2H] | — | — | same [2H] |

### C5. Sharing files with the client

- **Guests on a shareable board** — for example, one board per client or family. They see only that board, can upload, comment and download. Standard: 3 free guests, then 4 guests per billed seat. Pro+: unlimited. (KB-360000305419)
- **Public view link.** Read-only; **files hidden**. (KB-360009695080)
- **Workdoc public link.** Read-only, PDF export. (KB-8563692121746)
- **WorkForms upload-file question.** For the client to send documents in; the submitter can view or export their own response. (KB-11040473466258)
- **Emails & Activities.** Attach from the Files column when emailing. (KB-360019213180)
- **Not in the CRM:** a secure, branded client portal with per-client document vaults. monday's closest equivalents are the monday service Customer Portal or a self-built vibe "portal".

---

## D. Automations and integrations

### D1. Automation recipe builder

| Item | Details | Source |
|---|---|---|
| Structure | "When [trigger] and only if [condition(s)], then [action(s)]", with several actions per recipe; save as account template; duplicate; importance labels; run history; **Autopilot hub** view of every automation and workflow in the account | KB-360012254440, KB-360001222900, whats-new (Nov 2025) |
| Triggers (seen in KB) | Status changes (to X / from X to Y), column changes, item created, item moved to group or board, **date arrives** (with offsets), **every time period** (recurring), button clicked, person assigned, subitem created, form submitted, email received (Gmail/Outlook), CRM email/call/activity logged, "after a set number of days", Emails & Activities workflow triggers (May 2026) | KB-360011528299, KB-360000227739, KB-360000221159, KB-36118127125778, whats-new |
| Actions (seen in KB) | Notify person, team or subscribers; set or change status; set date to today, today+N or push by N; assign person / round robin; create item or subitem or update; move, duplicate, archive or delete; cross-board create and connect; start/stop time tracking; send email (Gmail/Outlook, one recipient per action in workflows); SMS or call (Twilio); enrol in Sequence; DocuSign envelope; AI block actions; Generate-with-AI (new builder) | same, plus KB-20666311273874, KB-360001310940 |
| New builder (closed beta) | Plain-language automation from a prompt of up to 500 characters in any language; **AI Smart Condition**; items and subitems everywhere; HTML email body; flexible date logic | KB-31585338491922 |
| Columns not usable in automations or mapping | Tags, Mirror, Dropdown, Time tracking, Dependency, Link-to-item, Location, World clock, Phone, File, Week, Link, Country, Team | KB-360001222900 |
| Monthly action quotas | **Automations and integrations are separate pools: Standard 250 + 250; Pro 25,000 + 25,000; Enterprise 250,000 + 250,000.** Basic and Free have none. CRM Ultimate is "enterprise-scale". | KB-360002826680, PRC |
| How actions are counted | Notifying 6 subscribers = 6 actions. Creating an item with mapped status, people, dropdown or update = 1 + each mapped field. Any custom recipe (even integration-only) counts against the automation pool. Condition steps in workflows count. Alerts to admins at 50/75/100%. The KB warns that 250 actions a month "is typically exhausted within days". | KB-360017556179, KB-360002826680 |
| Workflow builder (AI Workflows) | Canvas with blocks: delay, conditions and branching, **AI Smart condition**, **Loop** (subitems, items, connected items), update item/subitem, **human-in-the-loop approval** (Aug 2026), **MCP block** (any third-party MCP server; costs AI credits), HTTP request block | Pro+. Active workflows: AI work platform Standard 3 / Pro 20 / Enterprise 250; **CRM Pro 5**, Enterprise 250; more can be bought. | KB-20598895919122, KB-11381357489810, whats-new |

### D2. Integrations centre

- About **200+ integrations** are claimed, plus API and MCP. (https://monday.com/crm/features)
- **Native recipe integrations:** Gmail, Outlook, Google Calendar, Outlook Calendar, Slack, Microsoft Teams, Zoom, Salesforce (Ultimate; two-way sync app), HubSpot, Pipedrive, Copper, Mailchimp, Meta Ads, LinkedIn, Typeform, Jotform, SurveyMonkey, Stripe, Twilio, Zendesk, Jira (Cloud/DC two-way apps), GitHub, GitLab, Asana, Trello, Basecamp, Eventbrite, Harvest, Toggl, Calendly, Box, Google Drive, Intercom, PagerDuty, Pingdom, Todoist, Resend, Clearbit, ZoomInfo, Webhook, Zapier. (KB integrations section, KB-14709375878674)
- **Integration actions available in the workflow builder:**
  - Google Drive: upload, share, delete file.
  - Box: collaborator, folder, file details.
  - Calendly: cancel, create one-off, find or get events.
  - Google/Outlook Calendar: create, update, get, delete event.
  - Twilio: send SMS, make call.
  - Stripe: create customer, create invoice, find customer, get invoice.
  - Zoom: create, update, get, delete meeting.
  - Resend: create contact, send email.

  (KB-14709375878674)
- **Premium integrations** are Enterprise. **Integration permissions** are Enterprise. (PWM/PRC matrices)
- **API daily call limits:** 1,000 on Free/Basic/Standard; 10,000 on Pro; 25,000 on Enterprise. Complexity is capped at 5M per query. (DEV rate-limits)

---

## E. AI in 2026

### E1. Credits and how they are charged

| Item | Detail | Source |
|---|---|---|
| Unit price | **1 credit = US$0.01** (also listed in EUR, GBP, CAD, AUD, MXN, BRL, INR, JPY, ILS) | KB-24047211522194 |
| AI work platform (new customers from 2026-05-06) | Credits must be bought with seats: **Basic 1,000, Standard 2,000, Pro 3,000 per month**; Enterprise by quote. The pricing page shows them as $10/$20/$30 at 10 seats, offset by a "special monthly discount". Upgrade buckets are available; alerts at 80% and 100%. | KB-35277848309394, PWM |
| CRM | One-time trial of **6,000 credits (Ultimate 12,000)**, then an AI-credit add-on. New PRC matrix: add-on **not available on Basic**; Standard+ "eligible". The pricing cards say "Standard AI / Pro AI: AI credits included". **[inference]** Every "up to" figure on the cards equals 6,000 credits spent on that one feature (for example 600 leads × 10 = 6,000; 200 call minutes × 30 = 6,000; 750 AI runs × 8 = 6,000), so they are alternatives, not separate allowances. | KB-25760992782226, PRC |
| Governance | AI governance dashboard with usage by feature and user, per-user limits (Mar 2026), AI Admin Usage dashboard with export (May 2026). Enterprise: role-level AI permissions. AI can be switched off account-wide. | KB-29544502265746, whats-new |
| Data use | AES-256 at rest, TLS 1.3 in transit. monday says it does not train on customer data. Agent Factory uses Azure OpenAI, Anthropic via AWS Bedrock, and Vapi voice. | KB-31594331572370, KB-29545836087570 |

### E2. Capability catalog

| Capability | What it does | Plan | Credit cost | Source |
|---|---|---|---|---|
| AI blocks (columns, automations, workflows) | Assign labels, assign people, suggest action items, sentiment, detect language, improve text, prioritise, summarise, write, extract (text, files, images), generate docs, translate, custom prompt, **custom block with web search** | AI-enabled paid plans (column gating varies, see A2) | **8 per action**. The same item within 24 hours counts once; subitems count separately. | KB-18433811274386, KB-24047211522194 |
| CRM AI columns | Autofill with AI on text, date, number, dropdown, status and people columns; starred actions can read Emails & Activities history | Standard+ (CRM) | 8 per action | KB-25548698480914 |
| Free built-in AI | Updates assistant, text-to-filters, column suggestions, **AI formula builder**, docs assistant, start doc with AI, build and translate WorkForms, board views with AI, refine text, prompt-to-board, AI templates. CRM: **timeline summary, AI email assistant, Deal insights, "CRM Ask Anything" (alpha)**. monday service: triage, auto-reply and more. | AI enabled | **0** | KB-24047211522194 |
| monday sidekick (assistant) | Chat at account, board and item level (up to 10 items at once). It can: act (update boards, send Slack, email with HTML and attachments of 5 MB or less); analyse boards and historical trends; do web research and browse sites; generate docs, images, charts, maps and interactive web pages; fill forms; enrol leads in sequences; build views and dashboards; answer from the help centre. Also: voice mode, **WhatsApp/Telegram access**, memory and custom guidelines, importing preferences from ChatGPT/Gemini/Claude, skills marketplace, MCP/API tools, mobile app. | Legacy CRM matrix: 5 messages/user/day (Standard, Pro), 100 (Ultimate). New matrix: "up to 600 messages" Basic–Pro, 1,200 Ultimate. AI work platform: 100 / 200 / 300 messages (Basic / Standard / Pro). | ~10–30 simple … 150+ extra-complex per message | KB-26701503726610, PRC, PWM, KB-29544502265746 |
| AI Notetaker | See B9 | All plans | 120 per hour | KB-28017211500434 |
| AI agents (builder) | Agent chat builder. **Brain** tab: instructions, knowledge (boards plus uploaded PDF, DOC, TXT, Excel, CSV), tools (Gmail, Outlook, Slack, Drive, calendars, CRMs, **custom MCP**, Tools-on-Demand), skills, choice of LLM. **Jobs** tab: per-task triggers. **Channels** tab: WhatsApp, Telegram. **Activity** tab: run log with credits. Guardrails; write tools start inactive; org-shared agents; agents can join meetings. | "Available on monday AI platform; all products coming soon". CRM cards list "Build your own agent" (up to 120 / 240 tasks). | ~10–50 simple … 250+ extra-complex per run | KB-33347027353746, KB-38411699315346 |
| Expert CRM agents | Lead sourcer, Outreach caller, Meeting prep, Pipeline monitor (see B4/B6/B9) | CRM | Lead 10/lead; caller 150 per call ≤5 min, 30 per SMS | KB-24047211522194 |
| Bring Your Own Agent (beta) | Connect external agents: Anthropic Claude Managed Agents, Microsoft Copilot Studio, OpenAI, ElevenLabs, Cursor, Mistral, Azure AI Foundry, Google Gemini, custom | Admin permission | — | KB-36885999990930 |
| Agent Factory | Standalone agent product. Skills: monday, Gmail, Google Calendar, Slack, SMS. Knowledge: PDF/CSV. Triggers: schedule, embedded widget, dedicated website. Per-minute phone billing. | Own tiered plans | Agent credits | KB-29545836087570 |
| AI workflows | See D1 | Pro+ | By run complexity; building by prompt also costs credits | KB-11381357489810 |
| monday vibe | Prompt-to-app builder (board, item-view and homepage apps). Features: voice prompts, image generation, **barcode/QR scanning**, Office export (Word/PPT/Excel), true-to-screen PDF export, Notetaker access, historical board data, custom board widgets, E&A apps, model picker. Publishing needs a paid **vibe app package**; trial accounts can build but not publish. | Paid accounts | Gemini Flash ~10–20, **Claude Sonnet ~30–50 (default)**, Claude Opus ~50–500 per prompt; published apps using AI cost per run | KB-28451758349842, KB-32833842348178, KB-36207944364434, whats-new |
| monday magic | Prompt → full workspace solution (boards with AI columns, dashboards, forms) plus a how-to video and solution-overview doc | Free; AI work platform; no usage limits stated | 0 | KB-27740074397842 |
| Revenue Intelligence, Deal insights, Pipeline Health, Meeting Prep | See B6/B9 | Pro/Ultimate (betas) | Mostly free during beta | — |
| AI in Smart Call | Transcripts and summaries | CRM | 5 per connected minute | KB-38017810762770 |

### E3. monday MCP server

- **What it is.** Hosted at `https://mcp.monday.com/mcp`. Installed on every account by default. Connection options: OAuth, a personal API token, your own OAuth app, or dynamic client registration.
- **Access control.** Admins can turn external AI access off entirely or restrict MCP to specific workspaces. Members and admins can use MCP on all tiers; guests only if an Enterprise admin enables it; **viewers never**.
- **Cost.** **No AI credits**, but every tool call counts against the daily API limit.
- **Clients:** Claude (connector directory on Pro/Max/Team/Enterprise), ChatGPT (including monday UI components in chat), Cursor, Codex, Copilot Studio, M365 Copilot agent, Gemini CLI and Gemini Enterprise, Perplexity, Mistral Le Chat, Figma Make, Glean, Lovable, n8n, Notion, Replit, Windsurf and others.
- Sources: DEV mondaycom-mcp, compatible-mcp-clients; KB-35696101067154, KB-28515704603666; https://monday.com/w/mcp.

**Tools (60+, from DEV platform-mcp-tools):**
- Boards and items: create board, board info, items page, board activity, **board insights (aggregations)**, create group, create column, column-type schema, create item/subitem/duplicate, change column values.
- Workspaces and folders: create, update, list, info, move object.
- Docs: create (in a workspace or attached to an item), update, read with version history.
- Dashboards and widgets: create dashboard, create widget, widget schema.
- Views: create and update views and table views.
- Forms: create form, get form, update form (including password), question editor for 23 question types, submit.
- Users and teams: user context, list users and teams.
- Updates and notifications: create update, get updates, create notification (bell and email).
- Search and assets: search, get assets, presigned upload, finalize upload to a Files column.
- Automations and workflows: list, manage, create from natural language; plan, create, update, publish workflow.
- Agents: manage agent, triggers, skills, knowledge, catalog.
- Notetaker: get meetings, transcripts, action items.
- monday dev sprint tools.
- Raw GraphQL (`all_monday_api`), schema and type introspection.
- UI renderers: show_table, show_chart, show_battery, show_assign.
- A separate **Apps MCP** exists for app development.

---

## F. Google Workspace and Microsoft 365

| Integration | Direction / what syncs | Plan | Limitations | Source |
|---|---|---|---|---|
| Gmail via CRM Emails & Activities | **Two-way**: send and receive in the record; auto-log by Email-column match; thread continuity; tracking; templates; mass email; sequences | CRM Standard+ (tracking, templates, mass email and sequences Pro+) | One mailbox per monday account; no back-fill of old mail; Google send caps 2,000/day (paid) or 500/day (trial) | KB-360019213180, KB-12428852177810, KB-360016398039 |
| Gmail integration (board recipes and workflow blocks) | Email → item/update (by label), send email from board, search, download attachments to a column | Standard+ (uses integration actions) | 256 KB per email; files sent as monday links; one recipient per workflow send; "not a marketing tool" | KB-360002427060, KB-14709375878674 |
| Outlook via Emails & Activities | Two-way, as Gmail | CRM Standard+ | Microsoft tenant admin approval may be required | KB-360019213180 |
| Outlook integration (recipes) | Email → item; send email | Standard+ | **Connecting user needs Microsoft 365 Business Premium**; online Exchange only; no files; no back-fill | KB-360011895179 |
| Google Calendar via CRM | **Two-way**: schedule meetings from the record with invites; events where the contact is creator or attendee auto-appear on the timeline; past recurring events only | PRC: Pro+. KB header Pro/Ultimate, KB prerequisites Standard+ **[CONFLICT]** | Deleted events or removed attendees drop off | KB-17637788493202, PRC |
| Google Meet | Meet link added through the Google Meet integration when scheduling; Notetaker joins Meet | — | Zoom links pasted into the location field | KB-17637788493202, KB-28017211500434 |
| Google Calendar integration (boards) | **Two-way** with 2 recipes (item ↔ event). Google → monday: title, status, location, start, end, attendees, description, creator. monday → Google: title, start, … Also **one-way ICS sync** of date/timeline columns ("my items" or all). | Standard+ (actions) | Needs times on date columns; each item change uses an action | KB-4404712420754, KB-360001362725 |
| Outlook Calendar via CRM | **Two-way**; reminders; contact events on the timeline | CRM Standard+ | — | KB-20068993691538 |
| Outlook Calendar integration (boards) | Two-way recipes, or one-way ICS "Subscribe from web" | Standard+ | **M365 Business Premium**; ICS refresh can take more than 24 hours; Apple Calendar via ICS | KB-4404712396562, KB-360001362725 |
| Google Drive | File picker in the Files column and updates (stored as links); workflow actions upload, share, delete | All (actions quota for workflows) | No Shared/Team Drives; not in Edge; not shown in Files Gallery | KB-360000597900, KB-14709375878674 |
| OneDrive, SharePoint | File picker in the Files column and updates | All | Linked, not copied | KB-115005339505 |
| Google Sheets | Import only (3,000 rows, 20 columns). **Gemini in Workspace connector (alpha, read-only)** pulls monday data into Sheets, Docs, Gmail and Slides. | — | No live two-way Sheets sync found in the KB | KB-360010415539, KB-38693033636370 |
| Excel | Import (CRM: under 50 columns, 8,000 rows, dedupe add/skip/update); export (up to 100,000 items, with updates and subitems, can be emailed; Enterprise can block exports); activity-log export | All | Only table views export | KB-14244473062290, KB-26989749858578 |
| Microsoft Teams | Integration: notify channels (Office 365 global admin must connect; channels only). **Teams & Copilot 365 app**: boards as channel tabs, bot notifications, turn messages into items (not on AU servers; not for viewers). Workflow blocks: message-received trigger, notify users/channels, search messages. | Standard+ (actions) | — | KB-360010359819, KB-360013288540, KB-14709375878674 |
| Microsoft 365 Copilot | monday agent inside Copilot in Teams, Word, Excel, PowerPoint and Outlook: read, create and update boards within the user's permissions | Requires Copilot tenant plus admin toggle | — | KB-31677811514642 |
| Zoom | CRM timeline sync (Standard+). Board recipes: meeting → item (**US servers only**, Standard+, meetings you host only, no webinars). | — | — | KB-19273496497042, KB-360010331019 |
| Contacts import | CSV, Excel or Sheets; HubSpot, Pipedrive or Salesforce integrations; Chrome extension from Gmail; auto-create from sent email | — | **No native Google Contacts or Outlook People sync found in the KB** | KB-4736759024146, KB-11737162217490 |
| Sign-in | Google authentication (Pro+); SAML SSO (Okta, OneLogin, ADFS/Entra) and SCIM (Enterprise); email one-time-password login (May 2026) | — | — | PRC, KB-360000460605, whats-new |

---

## G. Pricing and seats (live 2026-09-25, USD, excluding tax)

| monday CRM | Yearly (per seat/month) | Monthly | Key limits |
|---|---|---|---|
| **Basic** | **$12** | $18 | 1 workspace, 1 dashboard, 1,000 contacts and deals, **5 columns per board**, 20 quotes/invoices a month, 5 GB, 1-week activity log |
| **Standard** | **$17** | $25 | 3 workspaces, 5 dashboards, 10,000 records, 15 columns, 50 quotes, 250 automations a month, Emails & Activities, Outlook calendar, guests (4 = 1 seat), timeline/calendar/map/Gantt views, 20 GB, 6-month log, 1,000 API calls a day |
| **Pro** ("Most popular") | **$28** | $41 | 15 workspaces, 50 dashboards, 100,000 records, 75 columns, 250 quotes, 25,000 automations and 25,000 integrations, mass email, sequences, templates, tracking, Google Calendar sync, forecasting, formula and time tracking, private boards, unlimited guests, 100 GB, 1-year log, 10,000 API calls |
| **Ultimate** (formerly Enterprise) | Quote | — | Unlimited records, columns, dashboards and quotes; enterprise-scale automations; 25,000 API calls; lead scoring; team goals; post-sale templates; QuickBooks; Salesforce; HIPAA; SSO/SCIM; 1 TB; 5-year log; "Advanced log rules" (coming soon) |

- **Seats.** "Pricing works per group of seats… minimum of 3 seats, then ascend in multiples of 5". A team of 4 buys 5; a team of 6 buys 10. You cannot drop below your number of active users. (KB-4405633151634)
- **Large teams.** CRM FAQ: "Plans start from 3 users… more than 40 users, request a quote." Ultimate was described as for 40+ users [2H, tech.co].
- **Real minimum.** Basic yearly = 3 × $12 = **$36/month billed $432 upfront**. Basic monthly = $54/month. Pro yearly = $84/month ($1,008/year). Secondhand reviews give the same $36 minimum. [2H saascrmreview, tech.co]
- **Yearly vs monthly.** The CRM toggle reads "Yearly SAVE 33%" (it matches $18 → $12). The FAQ and KB still say 18%. **[CONFLICT]** Yearly is paid upfront, with a prorated refund within 30 days. Payment by card (no debit cards) or PayPal; invoices for Enterprise. Price depends on billing country. (PRC; KB-4405633151634)
- **Bundles.** Products can differ in plan and seats but must share one billing cycle. Enterprise bundles must be all-Enterprise, with a 12-month minimum. (KB-4405633151634)
- **Free tier.** **The CRM has no free plan**: a 14-day Pro trial that cannot be extended, with unlimited users and guests during the trial. The Free plan exists only on the AI work platform: 2 seats, 3 boards, 3 docs, 200 items (up to 1,000 via referrals; the pricing matrix says up to 1,000), 500 MB, no automations or integrations, no guests or viewers, 1 board per dashboard, no formula, time tracking, progress or Files columns. The pricing page says "8 column types". **CRM and dev cannot be installed on Free.** (PRC FAQ; KB-360010487220; KB-360010594079; PWM)
- **AI work platform prices** (for comparison; seats plus required AI credits since 2026-05-06): Free $0 (2 seats); Basic **$9**; Standard **$12** (≈$14 monthly); Pro **$19** (≈$22 monthly); Enterprise by quote. Credits: 1,000 / 2,000 / 3,000 per month. Workflows 3 / 20 / 250. API 1,000 / 10,000 / 25,000 a day. Monthly figures derived from the page's 10-seat struck-through totals of $140 and $220. (PWM, KB-35277848309394)
- **Nonprofits.** **10 free Pro seats** on AI work platform, CRM, Service and Dev; 70% off extra seats; 33% off Enterprise. (KB-115005321269)
- **Other paid add-ons:** AI credit buckets; sidekick add-on; Notetaker add-on; vibe app packages; extra active workflows; Smart Call minutes (credits); monday campaigns (contact-based).

---

## H. The 25 monday.com ideas most worth copying for a CRM serving plumbers, restaurants, and child and adult day care

1. **One record page built from widgets (item card Overview).** A plumber's customer, a catering client or an enrolled child each needs contacts, history, files, jobs, invoices and notes on one screen. Ship *opinionated per-industry layouts* instead of monday's "build it yourself". (KB-360017143959)
2. **Unified timeline with custom activity types.** "Service call", "Inspection", "Tasting", "Incident report", "Parent conference" and "Medication given" become first-class entries next to emails and calls. (KB-4409766475666)
3. **Auto-logging email by matching any address on the record or linked records.** A parent's email lands on every child in the family; a GC's email lands on each job site. No BCC habits needed. Copy monday's "keep following the thread" rule too. (KB-12428852177810)
4. **One-click AI timeline summary (free).** "What's happened with the Garcia family this year?" before a conference; "what did we promise this restaurant?" before a quote. (KB-21998050250386)
5. **Household/company grouping by email domain, extended to phone and last name.** monday's account association keyed on domain; for these businesses, group by household or business, then roll every contact's timeline up to one parent record. (KB-23048348706450)
6. **Files column with preview, annotations, versions and zip download.** Before/after job photos, permits, health inspections, immunisation and allergy records, signed waivers. Annotations let staff circle a leak in a photo. Make versioning core, not a "trial feature". (KB-360000597900, KB-360021698980)
7. **A files gallery across all clients.** Answers "show me every expiring certificate or every photo from last week" without opening records. (KB-360001264249)
8. **Doc templates with live record fields (`{field}`).** Enrolment agreements, service contracts and catering event sheets that pre-fill from the record and export to PDF. It removes retyping, the biggest time sink in tiny offices. (KB-24108289323282)
9. **Intake forms that create records, with file-upload and signature questions, conditional logic, URL pre-fill and 50-language translation.** Online enrolment packets, emergency-service request forms, catering inquiries. Translation matters for Spanish-speaking families and crews. (KB-22630036771986, KB-360000358700)
10. **Email-to-record inbox address.** Forward a supplier invoice, a doctor's note or a customer photo straight into the right record from any phone. (KB-115005339645)
11. **Quotes and invoices generated from the record plus a product/service catalog, with tax, discount and fee adjustments and a PDF.** Plumbing estimates, catering quotes, tuition invoices. Beat monday by adding **real payments and legally valid e-signature with an audit trail**, which monday lacks natively. (KB-21050405375762)
12. **Live pricing calculator on the deal (Products widget).** Build a catering package or a plumbing job from line items on the phone with the customer. (KB-27719880788114)
13. **Round-robin assignment that respects who is available today.** Dispatch the next emergency call to the on-shift tech; assign tours to whichever director is in. (KB-29191074306706)
14. **Sequences with manual call-task steps and "stop when they reply" rules.** Follow up on unaccepted estimates, tour no-shows and catering leads without nagging people who already answered. Include the global unsubscribe list. (KB-20666311273874)
15. **Business phone number in the app with auto-recorded, transcribed, summarised calls logged to the record, billed per minute.** Techs and aides call from their own phone without exposing their number, and the owner sees what was promised. Cover more countries than monday's US/CA/PR/IL. (KB-35893698534674)
16. **One-tap mobile notetaker for in-person conversations.** Parent tours, kitchen walk-throughs and job-site walk-arounds turn into summaries and action items on the record. (KB-28017211500434)
17. **"Last contact" recency on the list (Activities-timeline column and unread counts).** "Which families haven't heard from us in 30 days?" and "which restaurant clients went quiet?" at a glance. (KB-25070276400658, KB-25770383733266)
18. **Pipeline stages with time-in-stage and one-click reopen (Deal stages widget).** Job flow estimate → scheduled → done → invoiced → paid, and enrolment inquiry → tour → waitlist → enrolled. Time in stage exposes stuck jobs and stalled waitlists. (KB-6872457398162)
19. **CSV import with a duplicate policy (add / skip / update matched on email or phone) plus a merge tool that keeps history.** Tiny businesses arrive with messy spreadsheets. Improve on monday by also keeping files and communications through the merge. (KB-14244473062290, KB-4402803033490)
20. **Required fields and validation rules on stage changes.** You cannot mark a job "Done" without photos and an invoice, or "Enrolled" without immunisation and emergency-contact files. monday gates this at Pro and Ultimate; make it standard. (KB-29863034416786)
21. **Date-based reminders ("date arrives", "after N days", recurring).** Annual water-heater service, grease-trap cleaning, licence and certificate renewals, re-enrolment, immunisation expiry, health-permit renewal. (KB-360000227739, KB-36118127125778)
22. **Two-way Google and Outlook calendar sync that auto-attaches events to the client when they're an attendee.** Appointments and tours stay in the tools owners already live in. Avoid monday's Microsoft 365 Business Premium licence requirement. (KB-17637788493202)
23. **Map view from the address field.** Cluster plumbing jobs by neighbourhood for routing; see where day-care families live for transport planning. (KB-360001263689)
24. **An AI column that reads a document or photo and fills fields.** Scan an immunisation card, permit, supplier invoice or insurance card into structured data. monday charges 8 credits per extraction. (KB-18433811274386)
25. **Owner's assistant reachable from WhatsApp (sidekick-style) plus scheduled PDF dashboard emails.** Owners who never sit at a desk can ask "who hasn't paid?" or "what's tomorrow?" by text and get a Monday-morning PDF. (KB-26701503726610, KB-360001267945)

**Honourable mentions:**
- Mobile offline mode for basements and walk-in coolers. (KB-360017712819)
- A per-item audit log with before → after values, for day-care compliance. (KB-115005310745)
- 30-day trash plus 7-day undo. (KB-115005312729)
- A read-only public link for a record or doc to share an event plan with a client. (KB-8563692121746)
- Guest access on a per-client board as a mini-portal — do it without seat charges. (KB-360000305419)

---

## What monday does badly for tiny businesses

1. **Seat minimum and bucket pricing.**
   - Minimum 3 seats; then multiples of 5, so a 4-person shop pays for 5. Real floor: $36/month billed yearly upfront ($432), or $54 month-to-month.
   - Viewers are free but read-only; most front-desk staff need editing seats.
   - Sources: KB-4405633151634, PRC; [2H] saascrmreview, tech.co.
2. **Basic tier is a demo.** 5 columns per board, 1,000 records, no email sync, no automations, no guests, 1 dashboard. A plumber's customer record needs more than 5 fields. (PRC)
3. **Essentials gated to Pro or Ultimate:**
   - Pro: email templates and tracking, mass email, sequences, Google Calendar sync, formula column, time tracking, private boards, required columns and data validations, chart and workload views.
   - Ultimate only: **QuickBooks**, **HIPAA** (adult day care handling health data needs it), lead scoring, duplicate warning, pivot, SSO.
   - Sources: PRC, KB-25274611229330, KB-360006506699.
4. **Tiny automation quotas.** Standard has 250 actions a month; notifying 6 people uses 6. monday itself warns this "is typically exhausted within days". (KB-360002826680, KB-360017556179)
5. **Work-management first, CRM second.**
   - Everything is boards, columns, groups, connect/mirror columns and widget layouts an admin must design.
   - Core CRM boards cannot be deleted.
   - Record pages, dashboards and forms are all build-it-yourself.
   - Secondhand reviews call admin setup "medium to high" effort and overwhelming as boards grow [2H saascrmreview].
   - Many overlapping surfaces (automations vs workflows vs agents vs vibe vs magic; old vs new Quotes & Invoices; Sequences V1/V2) plus frequent deprecations.
6. **No client portal in the CRM.**
   - Guests are per board, must use a different email domain, and are billed 4:1 on Standard.
   - Public view links hide files.
   - The real portal lives in a different product (monday service).
   - Sources: KB-360000305419, KB-360009695080.
7. **Documents and signatures are half-built.**
   - File versioning is a "trial feature".
   - Quotes & Invoices cannot collect or store countersigned documents, and the payment button is just a link.
   - E-signature needs DocuSign Business Pro, PandaDoc (Pro+) or third-party apps.
   - Merging duplicates drops Files-column files and email history.
   - Sources: KB-360021698980, KB-21050405375762, KB-7488210967442, KB-4402803033490.
8. **US/English-centric extras.**
   - Smart Call numbers: US, Canada, Puerto Rico, Israel; mobile only; no porting.
   - AI Sales Agent: US only, 4 languages.
   - Board-level Zoom integration: US servers only.
   - Quote "locale" changes formats but does not translate the document.
   - Smart Call does not screen Do-Not-Call lists.
   - The UI itself is multilingual (the site lists 14 languages); WorkForms translate to 50 languages.
   - Sources: KB-35893698534674, KB-31002308457234, KB-360010331019, KB-21050405375762.
9. **Microsoft friction.** Board-level Outlook email and calendar integrations need an M365 Business Premium licence and online Exchange; Teams integration needs the Office 365 global admin. (KB-360011895179, KB-4404712396562, KB-360010359819)
10. **Opaque, fragmented AI pricing.**
    - Different units per feature: credits per action, per minute, per message by model, per lead, per call.
    - CRM gets a one-time 6,000-credit trial, then paid add-ons (not on Basic).
    - "Up to" allowances on the pricing page are alternative uses of the same credits [inference].
    - Plan pages contradict each other.
    - Sources: KB-24047211522194, PRC.
11. **Email limits.** 500 recipients per mass send and 2,000 a day; Gmail caps apply; mass-email tracking cannot be exported; no templates or HTML inside sequences. (KB-13093369125778, KB-20666311273874)
12. **Mobile CRM is partial.** Only the 4 core boards; the card list view is Android only; offline mode excludes the email and activity timeline; Smart Call works only on mobile. (KB-7085413771666, KB-360017712819)
13. **Support.** No phone support on any plan [2H tech.co]. Migration-support complaints [2H saascrmreview].
14. **Data region fixed at sign-up.** Set by the first user's location; changing it needs a new account. (KB-4404392703250)

---

## Appendix: conflicts found in monday's own sources

| Topic | Source 1 | Source 2 |
|---|---|---|
| CRM Pro record cap | PRC: 100,000 | KB-25760992782226 (Feb 2026): unlimited |
| Standard: merge duplicates, integrations, DocuSign/Aircall/PandaDoc | KB-4402803033490, KB-25760992782226: included | New PRC matrix: Pro+ (legacy matrix: Standard+) |
| CRM Google Calendar sync | PRC: Pro+ | KB-17637788493202: header Pro/Ultimate, prerequisites Standard+ |
| Email templates | PRC: Pro+ | KB-11870759495314: all plans |
| Yearly discount | CRM toggle: 33% | FAQ and KB: 18% |
| AI-powered columns | KB-18640208769682: Pro/Enterprise | KB-25548698480914 (CRM): Standard+ |
| AI Notetaker | KB-28017211500434: all plans | KB-25548698480914: add-on for Pro/Ultimate |
| Sidekick in CRM | Legacy matrix: 5 messages/user/day (100 on Ultimate) | New matrix: "up to 600 / 1,200 messages" |
| Quotes & Invoices signatures | Marketing (https://monday.com/crm/features): "collect signatures" | KB-21050405375762: cannot yet collect or store countersigned documents |
| Free-plan items and columns | KB-360010487220: 200 items (1,000 with referrals); most columns except formula, time tracking, progress, files | PWM: "8 column types"; pricing matrix: "up to 1,000" items |

**Coverage and method.** Two full passes: (1) the live pricing pages plus the feature matrix pulled from their JavaScript bundle; (2) every article in the monday CRM help-centre category (~75 articles, listed through the Zendesk API) and the Board elements, Views, Dashboards, Automations, Integrations, WorkForms, Workdocs and File-management sections, cross-checked against the developer docs. My web-search allowance ran out partway through, so the e-signature marketplace survey and the "tiny business" complaints rest on a few secondhand sources, all marked [2H]. The monday campaigns price and the full automation trigger/action catalogue were not captured.
