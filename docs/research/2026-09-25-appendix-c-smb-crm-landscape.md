# Appendix C — The small-business CRM landscape: 25 products, five themes

Part of `2026-09-25-crm-feature-research.md`. Research compiled 2026-09-25 by a delegated research agent covering Zoho CRM and Bigin, Pipedrive, Salesforce Starter, Freshsales, Keap, Less Annoying CRM, Copper, Nutshell, Capsule, Close, Insightly, Nimble, folk, Attio, Twenty, EngageBay, GoHighLevel, Podium, Birdeye, Thryv, HoneyBook, Dubsado and Dynamics 365. Sources inline; secondhand claims marked [2H].

---

# Small-business CRM landscape, September 2026: ideas for a bilingual (English/Spanish) small-business CRM

**Scope and method.** I covered 25 products. HubSpot and monday.com are left out because they are being covered separately. Every source was fetched on 2026-09-25: vendor pricing pages, help centers, changelogs and press releases, plus third-party reviews. Two passes were done. The second read the 2025–2026 release notes; what it added is summarized in the last section.

**Conventions.**
- **[2H]** marks a secondhand claim, meaning it comes from a third-party review, an aggregator or a news write-up rather than the vendor or the survey owner.
- Prices are USD per user per month billed annually, unless a cell says otherwise.
- "Not verified" means I looked and could not confirm.

---

## Headline findings

1. **The 2026 battleground is capture without typing.**
   - Pipedrive surveyed 1,000 US sales and marketing professionals in June 2026 ([src](https://finance.yahoo.com/small-business/articles/modern-salesperson-becoming-data-entry-122400248.html)):
     - 38% spend most of their time logging calls, emails and meetings; only 11% say closing deals is among their most frequent weekly activities.
     - 79% switch between several tools to see a whole customer account, and 62% miss a deal or action every week because of it.
     - Automated data entry was the most requested AI capability, at 15%.
   - Pipedrive's answer is **Nova** (launched 2026-09-16, included on every plan). It briefs you before a call, records it, then *proposes* CRM updates that you approve field by field ([2H](https://www.implicator.ai/pipedrive-nova-crm-updates/), [newsroom](https://www.pipedrive.com/en/newsroom)).
2. **MCP (the protocol that lets Claude or ChatGPT use an app) is now standard.** These products ship an official MCP server: Pipedrive, Attio, Nutshell, Zoho/Bigin, Close, HighLevel, folk, HoneyBook and Twenty. Capsule's is in beta. Copper instead offers a read-only custom GPT inside ChatGPT. Details are in Theme 2.
3. **The best client portals and document flows come from service-business tools, not sales CRMs.**
   - HoneyBook, Dubsado, Thryv and GoHighLevel lead here.
   - Sales CRMs sell documents as paid extras: Pipedrive Smart Docs (from $32.50), Nutshell Proposals & Invoices ($79 a month for the whole company), Freshsales Branded Documents ($19 per user).
4. **Only one product documents a single voice agent that switches between English and Spanish mid-call: GoHighLevel** ([src](https://help.gohighlevel.com/support/solutions/articles/155000004683-multi-language-support-for-voice-ai-agents)).
   - Close's Chloe agent is English-only for now ([src](https://www.globenewswire.com/news-release/2026/06/09/3309383/0/en/close-launches-chloe-an-ai-sales-agent-built-directly-into-the-crm.html)).
   - Podium's Spanish support is partial [2H] ([src](https://ainora.lt/blog/podium-ai-employee-review-alternatives-2026)).
   - This is an open gap for a bilingual CRM.
5. **AI is priced three ways:**
   - *Bundled free:* Salesforce's Employee Agent, Pipedrive Nova, HoneyBook AI.
   - *A pooled allowance:* Nutshell gives unlimited light "assists" plus a monthly pool of heavier "AI outcomes".
   - *Credits:* Attio (two credit pools), Zoho (tokens), Close (credits per user), Salesforce Flex Credits (about $0.10 per action [2H]), Freshsales ($49 per 100 agent sessions).
6. **What small businesses actually use AI for is writing, research and summaries; autonomous agents are early.**
   - Pipedrive's August 2026 report found AI used for research 46.6%, writing 35.1% and brainstorming 32.4%, "not automation" [2H] ([src](https://martechseries.com/sales-marketing/crm/pipedrive-report-the-ai-paradox-professionals-want-ai-as-a-thinking-partner-not-an-autopilot/)).
   - 14% of people whose CRM has AI never use it, and 8% don't know it exists ([src](https://finance.yahoo.com/small-business/articles/modern-salesperson-becoming-data-entry-122400248.html)).
7. **Simplicity sells.**
   - Less Annoying CRM charges one flat $15 per user, with no tiers, 25 GB of storage per user and a free human coach ([src](https://lessannoyingcrm.com/pricing)).
   - Its big 2025 release was email logging, "a much requested feature over the years" ([src](https://www.lessannoyingcrm.com/blog/2025-less-annoying-crms-year-in-review)).
8. **Relationship modelling is weak across small-business CRMs.**
   - In Capsule a person can belong to only one organisation ([src](https://capsulecrm.com/support/contact-management/what-are-contacts/)).
   - Only Attio, Twenty and Zoho offer true custom objects for households or properties.
   - The model to copy comes from field-service software: Jobber's client with many properties and a separate billing address ([src](https://help.getjobber.com/hc/en-us/articles/115010161128-Properties)).
9. **Storage varies by 25x or more at entry level.** Salesforce Starter gives **1 GB of file storage for the whole organization** ([src](https://help.salesforce.com/s/articleView?id=xcloud.overview_storage.htm&language=en_US&type=5)); Less Annoying CRM gives 25 GB per user.
10. **Google versus Microsoft.**
    - Copper is still the CRM that lives inside Gmail and attaches Drive files automatically. Its Google Workspace page never mentions Outlook ([src](https://www.copper.com/google-workspace-crm)).
    - The Microsoft-native options are Nimble and Dynamics 365.
    - Google has no native CRM [2H] ([src](https://www.emailvendorselection.com/google-crm/)).

---

## (a) Comparison table

| Product | 1. Client 360 and documents | 2. AI (2025–26 headline) | 3. Google / Microsoft 365 | 4. Small-business usability | 5. Pricing 2026 |
|---|---|---|---|---|---|
| **Zoho CRM** | Zia Record Summary on Professional and above: 100 per day, English plus 22 languages including Spanish ([src](https://help.zoho.com/portal/en/kb/crm/zia-artificial-intelligence/generative-ai/articles/zia-record-summary)). Documents tab moved to WorkDrive storage (Q1 2026) ([src](https://www.zoho.com/blog/crm/q1-2026-update.html)). Client portals on Enterprise and above; clients can upload into file fields [2H] ([src](https://codroiditlabs.com/zoho-crm-client-portal-setup/)). 10 GB base storage plus a per-user amount [2H] ([src](https://help.zoho.com/portal/en/kb/crm/manage-crm-data/storage-space/articles/manage-data-storage)) | Ask Zia; Smart Prompts that can use Zia, Gemini, Claude or Cohere; zero-shot reading of fields from images and documents (Q1 2026) ([src](https://www.zoho.com/blog/crm/q1-2026-update.html)). 7 prebuilt Zia Agents ([src](https://www.zoho.com/crm/zia/agents.html)). 4 MCP servers ([src](https://www.zoho.com/crm/developer/mcp.html)) | Gmail add-on; Google Calendar sync in the direction you choose; Outlook add-in; Teams; OneDrive [2H] ([src](https://help.zoho.com/portal/en/kb/crm/integrations/microsoft/ms-outlook-add-in-for-zoho-crm/articles/outlook-add-in-for-zoho-crm)) | Free for 3 users | Standard $14, Professional $23, Enterprise $40 ([src](https://www.zoho.com/en-us/crm/zohocrm-pricing.html)); Ultimate $52 [2H] ([src](https://www.method.me/blog/zoho-crm-cost/)). Agents use prepaid credits; 30M free tokens a month on Zoho-hosted models ([src](https://www.zoho.com/agents/pricing.html)) |
| **Zoho Bigin** | Summarize button covers email threads, WhatsApp chats, notes and whole records. Product-catalog storefront that takes payment and feeds the pipeline (Q2 2026) ([src](https://www.zoho.com/blog/bigin/q2_2026_updates.html)). Bigin 360: 5 GB storage, 100 booking pages ([src](https://www.bigin.com/pricing.html)) | Agents: Reply Assistant, Churn Analyzer, CrossSell Genie. Email composer that also translates. MCP ([src](https://www.bigin.com/ai.html)). AI credits: 1,000 a month on Premier, 3,000 on Bigin 360 | Email integration from Express up ([src](https://www.bigin.com/pricing.html)) | 13 industry templates ([src](https://www.bigin.com/templates/)); free plan; WhatsApp; iOS | Free; Express $7 ($9 monthly); Premier $12 ($15); Bigin 360 $18 ($21) ([src](https://www.bigin.com/pricing.html)) |
| **Pipedrive** | Smart Docs: templates from Drive, OneDrive or SharePoint, e-signature; included on Premium and up ([src](https://support.pipedrive.com/en/article/what-features-do-the-pipedrive-plans-have)). Projects with an AI-written brief (May 2026) ([src](https://www.pipedrive.com/en/newsroom/pipedrive-bridges-the-sales-to-delivery-gap-with-new-project-management-and-messaging-tools)). Storage limits not published ([src](https://support.pipedrive.com/en/article/usage-limits-in-pipedrive)) | Nova meeting intelligence on all plans [2H] ([src](https://www.implicator.ai/pipedrive-nova-crm-updates/)). AI email writing and summaries on Premium and up; AI import assistant and business-card scanner on all plans ([src](https://support.pipedrive.com/en/article/pipedrive-ai)). MCP on all plans ([src](https://www.pipedrive.com/en/newsroom/pipedrive-launches-native-mcp-server-bringing-crm-workflows-directly-into-ai-assistants)) | Calendar sync (one- or two-way) and contact sync with Google and Microsoft on all plans; email sync from Growth up ([src](https://support.pipedrive.com/en/article/what-features-do-the-pipedrive-plans-have)) | No free plan; AI maps spreadsheet columns on import | Lite $14, Growth $39, Premium $59, Ultimate $79. Add-ons from: LeadBooster $32.50, Smart Docs $32.50, Projects $16, Campaigns $13.33, Web Visitors $41 ([src](https://www.pipedrive.com/en/pricing)) |
| **Salesforce Starter Suite** | Record summaries. **1 GB file storage per organization**, 10 GB data ([src](https://help.salesforce.com/s/articleView?id=xcloud.overview_storage.htm&language=en_US&type=5)) | Employee Agent in Starter and Pro Suites at no extra cost (March 2026); summaries and email drafts even in the Free Suite ([src](https://www.salesforce.com/ap/news/press-releases/2026/07/01/salesforce-brings-agentforce-into-salesforce-suites-and-slack-crm-for-small-businesses-in-singapore/)) | Gmail Chrome extension and Outlook add-in ([src](https://help.salesforce.com/s/articleView?id=sales.email_int_overview.htm&language=en_US&type=5)). Slack CRM included in Slack Business+ | Free Suite for up to 2 users [2H] ([src](https://tech.co/news/salesforce-agentforce-tools-small-business-suites)); Pro Suite needs an annual contract | Starter $25 (monthly or annual); Pro $100 (annual contract) ([src](https://www.salesforce.com/small-business/pricing/)). Agentforce Flex Credits $500 per 100k, 20 credits per action [2H] ([src](https://www.concret.io/blog/new-agentforce-pricing-model)) |
| **Freshsales** | Branded Documents add-on, $19 per user ([src](https://www.freshworks.com/crm/pricing/)) | Contact scoring and deal insights from Pro up ([src](https://www.freshworks.com/crm/pricing/)). Freddy AI Agent $49 per 100 sessions. Copilot about $29 per user [2H] ([src](https://www.usecarly.com/blog/freshsales-ai/)) | Gmail add-on; Google and Office 365 calendar sync [2H] ([src](https://support.freshsales.io/support/solutions/articles/236401-how-to-use-freshsales-gmail-add-on-)) | $9 entry tier | Growth $9, Pro $39, Enterprise $59 ([src](https://www.freshworks.com/crm/pricing/)) |
| **Keap** (owned by Thryv since Oct 2024) | Invoicing, quotes and appointments in one platform ([src](https://keap.com/pricing)) | AI Content Assistant; AI Automation Assistant builds a whole campaign from a prompt ([src](https://keap.com/pricing)) | Not verified | Dedicated customer-success manager included, **but paid implementation is required** ([src](https://keap.com/pricing)) | $299 a month or $2,988 a year, 2 users included; +$39 per extra user ([src](https://keap.com/pricing)) |
| **Less Annoying CRM** | One contact page with notes, files, tasks, events and synced email ([src](https://lessannoyingcrm.com/)). Free-text relationships shown on both records ([src](https://lessannoyingcrm.com/help/custom-contact-link-fields-vs-relationships)). **25 GB per user** | No AI found on its site ([src](https://lessannoyingcrm.com/pricing)) | Google and Outlook calendar sync. Sent and received email with known contacts logged automatically, up to 3 accounts ([src](https://lessannoyingcrm.com/help/log-email-communication-with-a-contact-or-a-company)) | Flat price; 30-day trial without a card; free human CRM coach; native iOS and Android app ([src](https://lessannoyingcrm.com/help/mobile-access)) | $15 flat per user, no tiers ([src](https://lessannoyingcrm.com/pricing)) |
| **Copper** | People, companies, opportunities, projects and tasks linked through a "Related" section ([src](https://support.copper.com/en/articles/8823248-relating-records)). Drive files synced to records ([src](https://www.copper.com/google-workspace-crm)) | AI email template generator and rewriter on all plans ([src](https://www.copper.com/pricing)). Copper GPT: read-only and needs paid ChatGPT [2H] ([src](https://www.usecarly.com/blog/copper-crm-ai/)) | **Best Gmail, Calendar, Contacts, Drive, Sheets and Looker Studio integration; no Outlook mention** ([src](https://www.copper.com/google-workspace-crm)) | Basic tier capped at 2,500 contacts ([src](https://www.copper.com/pricing)) | Basic $23, Professional $59, Business $99 (monthly $29 / $69 / $134) ([src](https://www.copper.com/pricing)) |
| **Nutshell** | Timeline summaries. Proposals & Invoices with e-signature; signed copies stay on the lead ([src](https://www.nutshell.com/blog/nutshell-launches-e-signing)). Unlimited storage | Pool of "AI outcomes" plus unlimited "assists"; notetaker; lead researcher ([src](https://www.nutshell.com/ai)). MCP on all plans, December 2025 ([src](https://www.prweb.com/releases/nutshell-connects-claude-chatgpt--more-to-crm-data-for-instant-conversational-insights-302637626.html)) | Two-way Gmail sync; Chrome extension; Outlook add-in; Office 365 ([src](https://www.nutshell.com/crm/email-calendar-sync)) | "No seat minimums or maximums" ([src](https://www.nutshell.com/pricing)) | $7, $18, $35, $51, $69 (monthly $13–$79); AI outcomes 10, 20, 40, 100, 150 per tier; Proposals & Invoices $79 a month for the company ([src](https://www.nutshell.com/pricing)) |
| **Capsule** | A person links to only one organisation. AI summaries on contacts, opportunities and projects ([src](https://capsulecrm.com/ai/)) | AI Summaries, Meeting Prep, Email Assist, Pipeline Generator, enrichment. MCP in private beta, read-only [2H] ([src](https://www.usecarly.com/blog/chatgpt-capsule-crm-integration/)) | Gmail; Google Calendar; Google Contacts sync; Outlook add-in; Outlook Calendar; Teams notifications; SSO with both ([src](https://capsulecrm.com/integrations/)) | Free for 2 users and 250 contacts; AI builds your pipeline | Starter $18, Growth $36, Advanced $54; Ultimate by quote ([src](https://capsulecrm.com/pricing/)) |
| **Close** | Built-in calling, SMS and email | Chloe calling agent (general availability June 2026; English only; US and Canada). AI credits 500–2,000 per user per month. Meeting notetaker on all plans. Call Assistant $50 per org + $0.02 a minute ([src](https://close.com/pricing)). MCP ([src](https://close.com/integrations/close-mcp)) | Notetaker for Zoom, Teams and Meet ([src](https://close.com/pricing)) | Solo plan is 1 seat | $9 (Solo), $35, $99, $139 (monthly $19 / $49 / $109 / $149) ([src](https://close.com/pricing)) |
| **Insightly** | Links between records carry a relationship type, role and description; linked-items reports ([src](https://support.insight.ly/en-US/Knowledge/article/1322/How_to_set_up_link_relationships_for_contacts_and_organizations/)). Storage 10 GB, 100 GB, 250 GB by plan | Copilot (December 2025) reads and writes; 100 queries on Professional, unlimited on Enterprise ([src](https://www.insightly.com/blog/insightly-crm-conversational-ai-copilot/)) | Not verified | 14-day trial | Plus $29, Professional $49, Enterprise $99 ([src](https://www.insightly.com/pricing/)) |
| **Nimble** | Relationship manager built from Microsoft 365 contacts, email and calendar ([src](https://www.nimble.com/best-crm-for-microsoft-365/)) | AI email writing; enrichment add-on $10 per 100 credits ([src](https://www.nimble.com/pricing/)) | **Outlook add-in on desktop, web and mobile; two-way Microsoft 365 sync; Teams** | One plan | $24.90 annual or $29.90 monthly per seat; 25k contacts; 2 GB per user ([src](https://www.nimble.com/pricing/)) |
| **folk** | Recap assistant summarizes email, meetings, notes, WhatsApp and LinkedIn [2H] ([src](https://www.folk.app/products/assistants)) | Follow-up Assistant ([src](https://help.folk.app/en/articles/10304768-follow-up-assistant)); research credits; AI "magic fields"; MCP ([src](https://www.folk.app/articles/folk-crm-mcp-review)) | Gmail, Outlook and **WhatsApp** sync ([src](https://www.folk.app/pricing)) | Business-card scanning; voice notes | Standard $24, Premium $48, Enterprise from $80 ([src](https://www.folk.app/pricing)) |
| **Attio** | Relationships shown on both records ([src](https://attio.com/help/reference/managing-your-data/attributes/relationship-attributes)); custom objects; files API (February 2026) ([src](https://attio.com/changelog/2026)) | Ask Attio (Feb 2026; took actions from April [2H]); web research agent; Workflows with agents (June 9); MCP (Feb 19) ([src](https://attio.com/changelog/2026)) | Email and calendar sync | Plus plan capped at 10 seats | Free (3 seats), Plus $35, Pro $79; two monthly credit pools ([src](https://attio.com/pricing)) |
| **Twenty** (open source) | Custom objects; AI can file uploaded documents onto records (v2.37) ([src](https://twenty.com/releases)) | AI chat where `@` points at a record and `/` picks a skill; agents; call transcripts; native MCP on every cloud workspace ([src](https://twenty.com/pricing)) | Email and calendar sync | Free to self-host; right-to-left language support (v2.40) | Pro $9, Organization $19; Enterprise from $50k a year ([src](https://twenty.com/pricing)) |
| **EngageBay** | Proposals and invoices; storage 1, 5, 20 GB by plan ([src](https://www.engagebay.com/pricing)) | AI conversations: 20–500 a month by plan | Not verified | Free for 15 users | Free; $13.79, $59.79, $110.39 ([src](https://www.engagebay.com/pricing)) |
| **GoHighLevel** | Branded client-portal app $49 a month per client account; contracts with e-signature for several signers ([src](https://www.gohighlevel.com/pricing)) | AI Employee $50 or $97 a month per client account; **one voice agent handles English and Spanish** ([src](https://help.gohighlevel.com/support/solutions/articles/155000004683-multi-language-support-for-voice-ai-agents)); MCP | Not verified | Built for agencies reselling to small businesses | $97, $297, $497 a month + usage charges ([src](https://www.gohighlevel.com/pricing)) |
| **Podium** | One inbox for phone, text, email and social ([src](https://www.podium.com/product/ai-employee)) | AI Employee books appointments straight onto the calendar | Not verified | Annual contracts [2H] | Not published; Core about $399 a month [2H] ([src](https://astucia.io/blog/podium-pricing-2026-what-smbs-actually-pay)) |
| **Birdeye** | Reviews, listings and messaging | 10+ agents (September 2025), autonomous or supervised ([src](https://www.prnewswire.com/news-releases/birdeye-unveils-the-industry-first-agentic-marketing-platform-302550278.html)) | Not verified | 90-day cancellation notice and a renewal fee [2H] | $299–$449 per location per month [2H] ([src](https://costbench.com/software/review-management/birdeye/)) |
| **Thryv** | **Client portal:** estimates, invoices, payments, files, booking, service packages ([src](https://www.thryv.com/reference/client-portal/)) | AI Lead Insights (August 2026) ([src](https://www.thryv.com/news/thryv-launches-ai-native-growth-platform-for-small-businesses/)) | Not verified | $250 onboarding fee (shown as waived) | Starter $99 a month, Signature $399 a month ([src](https://www.thryv.com/pricing/)) |
| **HoneyBook** | **Client portal** with Activity, Files, Payments and Notes tabs; clients can upload; a section hidden from clients ([src](https://help.honeybook.com/en/articles/6428603-what-clients-can-see-and-do-in-the-client-portal)). Smart Files combine proposal, contract and invoice | AI chat, automation builder from a description, notetaker, meeting prep, project recaps (all plans) ([src](https://www.honeybook.com/pricing)). MCP that reads and writes (August 19, 2026) | Gmail lead finder | Unlimited clients | $29, $49, $109 a month billed yearly; cards 2.7% + 10¢, bank transfer 1.5% ([src](https://www.honeybook.com/pricing)) |
| **Dubsado** | **Client portal** with Home, Projects, Emails and Profile tabs ([src](https://help.dubsado.com/en/articles/7028462-what-are-client-portals-in-2-0)) | None found | Calendar connection | 3 users free | Starter $335 a year, Premier $525 a year ([src](https://www.dubsado.com/pricing)) |
| **Dynamics 365 Sales** | Opportunity summaries on Enterprise | Sales Close Agent on Enterprise; Premium adds 1,000 Copilot credits per user per month ([src](https://www.microsoft.com/en-us/dynamics-365/products/sales/pricing)) | Native Microsoft 365 | Microsoft Relationship Sales needs 10 seats minimum | Professional $65, Enterprise $105, Premium $150. Business Central Essentials $80 with Copilot [2H] ([src](https://erpsoftwareblog.com/2026/09/business-central-cost-licensing-by-industry/)) |
| **Google** | No native CRM [2H] ([src](https://www.emailvendorselection.com/google-crm/)) | Gemini in Gmail is used by partners such as Copper | — | — | — |

---

## (b) Best implementations by theme

### Theme 1: One place for everything about a customer

**Winners:** HoneyBook and Dubsado for the portal and document flow; Thryv for a portal that the customer does things in; Copper for automatic document capture; Attio and Less Annoying CRM for relationships.

1. **HoneyBook: one project page shared with the client, with a hard line between public and private** ([src](https://help.honeybook.com/en/articles/6428603-what-clients-can-see-and-do-in-the-client-portal)).
   - What the client sees:
     - **Activity**: when files were sent, email threads, messaging.
     - **Files**: shared documents, attachments and bookmarks.
     - **Payments**: invoice files.
     - **Notes**: only the notes you chose to share.
   - Clients can **upload their own images and files** with an Attach button.
   - Everything below a divider labelled **"Not visible to clients"** is internal: tasks, automations, unshared notes.
   - **Smart Files** turn proposal, contract, invoice and payment into one client flow ([src](https://www.honeybook.com/pricing)).
   - **Design takeaway:** one record with a per-field or per-block "client-visible" toggle, rather than a separate portal data model.
2. **Dubsado: a portal built around the client's to-do list** ([src](https://help.dubsado.com/en/articles/7028462-what-are-client-portals-in-2-0), [src](https://help.dubsado.com/en/articles/483501-what-gets-synced-to-my-client-s-portal)).
   - **Home** shows your contact details, unread emails, incomplete forms and open invoices.
   - **Projects** holds proposals, contracts, invoices, questionnaires, appointments and any PDFs or links you add.
   - **Emails** keeps a copy of every email you sent, even ones the client deleted.
   - **Profile** lets the client edit their own contact details.
   - **Design takeaway:** the portal's landing page is "what you owe us". An unpaid invoice shows on Home and in Projects; once paid it shows only in Projects.
3. **Thryv: a portal that lets customers act for themselves** ([src](https://www.thryv.com/reference/client-portal/)).
   - Customers view current estimates, invoices, payments and past transactions.
   - They download files, upload forms, and book or reschedule appointments.
   - They **buy service packages and see how many sessions remain**, message the business or tap to call it, and sign up for classes.
   - **Design takeaway:** the right model for a daycare or a salon, where prepaid packages and bookings are the relationship.
4. **Copper: documents attach themselves** ([src](https://www.copper.com/google-workspace-crm)).
   - Files sent from Gmail are synced to the contact's record automatically.
   - Customer files show up on company and deal records.
   - Gmail suggests attachments based on the email thread.
   - People, companies, opportunities, projects and tasks are linked through a "Related" section, and a closed deal can be duplicated into a delivery project ([src](https://support.copper.com/en/articles/8823248-relating-records), [src](https://www.copper.com/)).
5. **Relationship modelling.**
   - *Less Annoying CRM* has free-text relationships that appear on **both** records, with directional wording advised, e.g. "Sarah referred Kyle". It also has custom contact-link fields for relationships that repeat ([src](https://lessannoyingcrm.com/help/custom-contact-link-fields-vs-relationships)).
   - *Insightly* links carry a relationship type from a dropdown, a Role and a description, and have a linked-items report ([src](https://support.insight.ly/en-US/Knowledge/article/1322/How_to_set_up_link_relationships_for_contacts_and_organizations/)).
   - *Attio* creates two linked attributes, one on each object, and supports custom objects ([src](https://attio.com/help/reference/managing-your-data/attributes/relationship-attributes)).
   - *Jobber* (outside the brief, but the right pattern for a plumber) lets a client have zero, one or many properties, keeps the billing address separate from service addresses, and imports one CSV row per property ([src](https://help.getjobber.com/hc/en-us/articles/115010161128-Properties)).
   - **Anti-example:** in Capsule a person can belong to only one organisation ([src](https://capsulecrm.com/support/contact-management/what-are-contacts/)).

**Document templates and e-signature, compared:**
- *Pipedrive Smart Docs.* Templates live in the customer's own Google Drive, OneDrive or SharePoint, with CRM fields pasted in as placeholders. It adds e-signature and a notification when the client opens the document ([src](https://support.pipedrive.com/en/article/smart-docs)).
- *Nutshell.* Templates, merge data, signing activity and signed copies "all living with the lead", for $79 a month company-wide ([src](https://www.nutshell.com/blog/nutshell-launches-e-signing), [src](https://www.nutshell.com/pricing)).
- *GoHighLevel.* Several signers per document; public signing links that need no contact record; send a document automatically when a deal changes stage; sign inside the portal ([src](https://help.gohighlevel.com/support/solutions/articles/155000006143-public-document-links-for-e-signing), [src](https://help.gohighlevel.com/support/solutions/articles/155000001301-how-to-create-and-send-document-or-contract-templates-automatically-in-a-workflow)).
- *Zoho CPQ.* Zia suggests bundle pricing rules from past quotes, and you review them before they go live ([src](https://www.zoho.com/blog/crm/q1-2026-update.html)).

**Storage limits compared:**
- Less Annoying CRM: 25 GB per user.
- Insightly: 10, 100 or 250 GB by plan.
- Attio: 50 GB on Free and Plus; unlimited on Pro and above.
- Nutshell: unlimited.
- Bigin 360: 5 GB.
- EngageBay: 1, 5 or 20 GB.
- Nimble: 2 GB per user.
- Salesforce Starter: 1 GB for the whole organization.
- Zoho: 100 MB of attachments per record [2H] ([src](https://help.zoho.com/portal/en/kb/crm/manage-crm-data/attachments-and-notes/articles/attachment-limits)).

### Theme 2: AI in the CRM (product, feature, tier, price)

| Capability | Best implementations: product, feature, tier, price |
|---|---|
| **Record summary and meeting prep** | *Zoho:* Record Summary on Professional and above, 100 a day, **English plus 22 languages including Spanish** ([src](https://help.zoho.com/portal/en/kb/crm/zia-artificial-intelligence/generative-ai/articles/zia-record-summary)).<br>*Capsule:* AI Summaries and one-click Meeting Prep. The pricing page lists them from Growth ($36); the AI page says all paid plans ([src](https://capsulecrm.com/ai/), [src](https://capsulecrm.com/pricing/)).<br>*Salesforce:* summaries of "recent activity, next steps, potential risks", free in all Suites ([src](https://www.salesforce.com/ap/news/press-releases/2026/07/01/salesforce-brings-agentforce-into-salesforce-suites-and-slack-crm-for-small-businesses-in-singapore/)).<br>*Nutshell:* timeline summaries count as AI outcomes ([src](https://www.nutshell.com/ai)).<br>*Bigin:* one Summarize button covering email, WhatsApp, notes and records ([src](https://www.zoho.com/blog/bigin/q2_2026_updates.html)). |
| **"Ask your CRM"** | *Zoho Ask Zia:* turns a question into a chart [2H].<br>*Attio Ask Attio:* launched February 2026, took actions from April 2026 [2H] ([src](https://crmnewspaper.com/blog/attio-ai-updates-ask-attio-2026/)); Pro plan ($79) and credits.<br>*Insightly Copilot:* creates, updates and links records by chat; 100 queries on Professional, unlimited on Enterprise ([src](https://www.insightly.com/blog/insightly-crm-conversational-ai-copilot/)).<br>*Pipedrive Sales Assistant:* answers data questions, beta, all plans ([src](https://support.pipedrive.com/en/article/pipedrive-ai)).<br>*Twenty:* `@` points the chat at a record, `/` runs a workspace skill (v2.40) ([src](https://twenty.com/releases)). |
| **Email and SMS drafting** | Near-universal. The notable ones:<br>*folk Follow-up Assistant:* reads the inbox, calendar and WhatsApp; flags conversations that have gone quiet (at least 2 two-way email exchanges in the last 2 months); drafts a reply "in your tone of voice" ([src](https://help.folk.app/en/articles/10304768-follow-up-assistant)).<br>*Bigin:* rephrase, proofread, **translate**, shorten ([src](https://www.zoho.com/blog/bigin/q2_2026_updates.html)).<br>*Pipedrive:* email writing on Premium and up.<br>*Keap SmartSend:* picks the send time per recipient [2H]. |
| **Call and meeting transcription** | *Pipedrive Nova* (September 16, 2026, all plans, free) [2H] ([src](https://www.implicator.ai/pipedrive-nova-crm-updates/)):<br>• before the call: briefing from records, calendar and Gmail<br>• during: a visible bot in Zoom, Meet or Teams, or a desktop app<br>• after: summary plus **suggested updates to deal, person and organization fields, shown beside the current values, and you choose which to save**. Suggestions come only from meeting transcripts, never from emails.<br>*Close:* meeting notetaker on all plans; Call Assistant $50 per org + $0.02 a minute ([src](https://close.com/pricing)).<br>*Nutshell:* notetaker for Zoom, Meet and Teams, counted as AI outcomes.<br>*HoneyBook:* notetaker on all plans.<br>*Twenty:* recordings with a synced transcript (v2.35). |
| **Autonomous agents** | *Close Chloe* (general availability June 9, 2026, all plans, US and Canada, English only). It calls, qualifies, books and hands off to a human. It runs from a workflow, as a batch of up to 1,000 calls, or as a single task. During beta: 306 businesses, 818k calls ([src](https://www.globenewswire.com/news-release/2026/06/09/3309383/0/en/close-launches-chloe-an-ai-sales-agent-built-directly-into-the-crm.html)).<br>*GoHighLevel AI Employee:* $97 a month per client account for "unlimited" voice, chat, reviews and content, subject to fair use; voice engine $0.045 a minute plus text-to-speech [2H] ([src](https://botpenguin.com/blogs/gohighlevel-ai-pricing)).<br>*Zia Agents:* SDR, Follow-up Scheduler, Quote Generator, Deal Closure Reminder and others. Each can run as the user ("Connection") or as a "Digital Employee" with its own identity ([src](https://www.zoho.com/crm/zia/agents.html)).<br>*Bigin:* Reply Assistant answers mail sent to the Email-In address.<br>*Podium AI Employee:* claims $3B+ influenced sales and 1M+ after-hours leads ([src](https://www.podium.com/product/ai-employee)).<br>*Freddy AI Agent:* $49 per 100 sessions.<br>*Attio Workflows agent block* (June 9, 2026). |
| **Data enrichment** | *Attio:* web research agent run on each record in a list ([src](https://attio.com/changelog/2026)).<br>*Capsule:* company and contact enrichment.<br>*folk:* 500 or 1,000 enrichments a month.<br>*Pipedrive:* company data on Premium; phone and email on Ultimate ([src](https://www.pipedrive.com/en/pricing)).<br>*Nimble:* $10 per 100 credits.<br>*HoneyBook:* lead enrichment. |
| **Lead scoring and next-best action** | *Thryv AI Lead Insights:* intent score, conversation summary and recommended actions, tied back to campaign ROI. Thryv's own claim: "1.5 times" the conversion rate ([src](https://www.thryv.com/news/thryv-launches-ai-native-growth-platform-for-small-businesses/)).<br>*Freshsales:* contact scoring and deal insights on Pro ($39).<br>*Zia Scores and Next Best Experience* ([src](https://help.zoho.com/portal/en/kb/crm/zia-artificial-intelligence/zia/articles/zia-overview)).<br>*Salesforce Starter:* lead scoring. |
| **Reading documents into fields** | *Zoho* (Q1 2026): **zero-shot reading of field values from uploaded images and files**, plus plain-language hints for fields that are easy to confuse ([src](https://www.zoho.com/blog/crm/q1-2026-update.html)). *Zia Vision* checks IDs, receipts and invoices.<br>*Pipedrive:* business-card scanner and AI import assistant on all plans.<br>*folk:* card scanning.<br>*Twenty:* "Ask AI to attach files you upload in chat directly to records". |
| **MCP servers** | *Pipedrive:* June 30, 2026, all plans, OAuth, ChatGPT and Claude; in Claude's connector directory since August 18 ([src](https://www.pipedrive.com/en/newsroom/pipedrive-launches-native-mcp-server-bringing-crm-workflows-directly-into-ai-assistants)).<br>*Attio:* February 19; about 41 tools; reads approved automatically, writes confirmed [2H] ([src](https://reply.io/blog/attio-mcp/)).<br>*Nutshell:* December 2025, all plans.<br>*HoneyBook:* August 19, 2026; can **build a proposal, invoice or contract from templates and raise payment requests** ([src](https://www.globenewswire.com/news-release/2026/08/19/3347702/0/en/honeybook-mcp-debuts-as-a-claude-connector-for-client-pipelines-invoices-and-contracts.html)).<br>*Zoho:* 4 scoped servers (insights, operations, modules, workflow).<br>*Close* ([src](https://close.com/integrations/close-mcp)), *HighLevel* ([src](https://help.gohighlevel.com/support/solutions/articles/155000005741-how-to-setup-and-use-the-highlevel-mcp-server)), *folk*, *Twenty*.<br>*Capsule:* private beta, read-only, Growth and above [2H].<br>Freshworks' "MCP Gateway" is Freshservice, not Freshsales ([src](https://www.freshworks.com/theworks/company-news/september-2026-freshworks-innovation-update/)). |

**What small businesses actually use:**
- The strict US Census measure (Dec 2025–May 2026) puts AI use at 17–20% of all businesses, and below 20% for firms with 1–4 employees ([src](https://www.census.gov/library/stories/2026/05/ai-use-businesses.html)).
- Looser surveys are much higher: 58% used generative AI (US Chamber, via Capsule [2H]) ([src](https://capsulecrm.com/blog/small-business-ai-adoption-statistics/)); 66% use AI but about 70% lack the skills (Thryv) ([src](https://www.thryv.com/blog/ai-for-small-business-2026-report/)).
- 52% of buyers struggle to "utilize AI features effectively" (Capterra) ([src](https://www.capterra.com/resources/sales-and-marketing-software-trends/)).
- Use is concentrated in writing and summarizing, plus after-hours answering (Podium and Close usage figures above). Unattended autonomy is early.

### Theme 3: Google Workspace and Microsoft 365

1. **Copper, the Google-native option, on every plan** ([src](https://www.copper.com/google-workspace-crm)):
   - A Chrome extension inside Gmail lets you add contacts, see history on hover, and see tasks next to the inbox.
   - Google Contacts sync in both directions.
   - Google Calendar gives meeting prep.
   - Drive files are attached automatically, with suggested attachments in Gmail.
   - Data goes out to Sheets and Looker Studio.
   - Gemini meeting transcripts reach Copper in one click.
   - No Outlook.
2. **Zoho CRM, the best even-handed option** [2H] ([src](https://help.zoho.com/portal/en/kb/crm/integrations/google/google-account/articles/google-calendar-crm-integration), [src](https://help.zoho.com/portal/en/kb/crm/integrations/microsoft/ms-outlook-add-in-for-zoho-crm/articles/outlook-add-in-for-zoho-crm)):
   - A Gmail add-on to create leads and contacts, add notes and use templates.
   - Google Calendar sync where **you pick the direction**: two-way, Zoho to Google, or Google to Zoho.
   - An Outlook add-in from Microsoft's AppSource for Windows, Mac, web, iOS and Android.
   - Email logged through the Microsoft Graph API; Teams dashboards and meetings; OneDrive or WorkDrive files.
3. **Pipedrive, the clearest plan matrix** ([src](https://support.pipedrive.com/en/article/what-features-do-the-pipedrive-plans-have)):
   - Calendar sync with Google and Microsoft on all plans, one- or two-way.
   - Contact sync on all plans; you choose the group, the direction and the visibility ([src](https://support.pipedrive.com/en/article/contact-sync)).
   - Email sync from Growth up.
   - Smart Docs on Drive, OneDrive and SharePoint from Premium up.
   - Nova reads Gmail for briefings and records in Zoom, Meet and Teams.
4. **Nimble, the Microsoft-first option** ([src](https://www.nimble.com/best-crm-for-microsoft-365/)):
   - An Outlook add-in on desktop, browser and mobile.
   - "Two-way sync between your Nimble account and Microsoft 365".
   - Teams gives a shared view of each customer.
   - Dynamics 365 Sales Professional ($65) is the heavier native alternative ([src](https://www.microsoft.com/en-us/dynamics-365/products/sales/pricing)).
5. **Less Annoying CRM, the minimal option** ([src](https://lessannoyingcrm.com/help/log-email-communication-with-a-contact-or-a-company)):
   - Google and Outlook calendar sync.
   - Sent and received email with contacts already in the CRM is logged automatically, for up to 3 accounts.
   - Nothing lives inside the inbox itself.

**Others:**
- *Nutshell:* two-way Gmail sync, Chrome extension, Outlook add-in, Office 365 sync; Google sync on every plan ([src](https://www.nutshell.com/integrations/gmail-and-google-calendar)).
- *Capsule:* Gmail; Capsule tasks shown in Google Calendar; one-way push of contacts to Google Contacts; Outlook add-in and calendar; Teams notifications; SSO with both ([src](https://capsulecrm.com/integrations/)).
- *Freshsales:* Gmail add-on; Office 365 calendar [2H].
- *folk:* adds WhatsApp sync.
- *Salesforce Starter:* Gmail extension and Outlook add-in; Einstein Activity Capture's standard version included [2H] ([src](https://www.cirrusinsight.com/blog/einstein-activity-capture)).

### Theme 4: Usability for owners with no admin staff

**Best patterns:**
- **Less Annoying CRM.**
  - One price ($15) that includes "all features and free upgrades"; 30-day trial with no card.
  - A free **human CRM coach** with 5+ years' average tenure.
  - "More than a spreadsheet, less than a CRM" ([src](https://lessannoyingcrm.com/)); native mobile app ([src](https://lessannoyingcrm.com/help/mobile-access)).
- **Bigin.**
  - 13 industry templates that set modules, fields and pipeline stages at signup: real estate, legal, patient management, facility maintenance, nonprofit and others ([src](https://www.bigin.com/templates/)).
  - A $0 plan.
  - A WhatsApp message goes out automatically after every form submission ([src](https://www.zoho.com/blog/bigin/q2_2026_updates.html)).
- **Capsule.** The AI Pipeline Generator builds your pipeline from your business type, and the free plan covers 2 users ([src](https://capsulecrm.com/ai/)).
- **Pipedrive.** AI maps spreadsheet columns to fields on import, which covers the day-one move off Excel; business-card scanner ([src](https://support.pipedrive.com/en/article/pipedrive-ai)).
- **folk.** Business-card scanning and voice notes on all plans ([src](https://www.folk.app/pricing)).

**Evidence on why small businesses abandon CRMs:**
- *Pipedrive, June 2026:* data entry dominates the day; 79% switch between tools; 62% miss a deal or action weekly; 14% never touch the AI they already have ([src](https://finance.yahoo.com/small-business/articles/modern-salesperson-becoming-data-entry-122400248.html)).
- *Insightly:* cites "only 34% of sales teams fully adopt" their CRM [2H] ([src](https://www.insightly.com/blog/insightly-crm-conversational-ai-copilot/)).
- *Capterra 2025:* about 60% of small and mid-size businesses made a software purchase they regretted in the past 18 months [2H] ([src](https://www.capterra.com/resources/tech-trends-smb-enterprise-software-purchase-tips/)).
- *Salesforce:* small-business setups reportedly run $10–20k in consultant time [2H] ([src](https://www.method.me/blog/how-much-does-salesforce-cost/)).
- *Keap:* paid implementation is mandatory ([src](https://keap.com/pricing)).
- *Pipedrive, August 2026:* 76% of non-users are unlikely to start using AI within 12 months [2H].

### Theme 5: Pricing

The table's last column carries each product's price and source. Patterns:
- **Flat price:** Less Annoying CRM ($15), Nimble ($24.90), and Twenty self-hosted (free).
- **Per account or location, not per seat:** GoHighLevel ($97–$497 per agency), Thryv ($99 or $399), HoneyBook ($29–$109), Dubsado ($335 or $525 a year), Keap ($299 including 2 users), Birdeye (per location [2H]).
- **Seat caps and minimums:**
  - Attio: Free 3 seats, Plus 10 seats. Close Solo: 1 seat. Zoho Free: 3 users. Capsule Free: 2 users. EngageBay Free: 15 users. Microsoft Relationship Sales: 10-seat minimum.
  - Nutshell advertises no seat minimums or maximums.
- **AI surcharges, from cheapest to most expensive:**
  - Free and bundled: Salesforce Suites, Pipedrive Nova, HoneyBook.
  - Pooled allowance: Nutshell (10–150 outcomes a month by tier).
  - Credits per seat: Close (500–2,000), Attio (100–2,500 per seat plus a shared workspace pool).
  - Metered: Freddy AI Agent ($49 per 100 sessions); Close Call Assistant ($50 + $0.02 a minute); GoHighLevel AI Employee ($50 or $97 per client account plus telephony); Salesforce Flex Credits ($500 per 100k [2H]); Zoho (tokens, 30M free a month).

---

## (c) The 30 best ideas, ranked by value to a small service business

1. **Answer every lead instantly in the caller's language.** GoHighLevel's Multilingual voice agent switches between English and Spanish mid-call ([src](https://help.gohighlevel.com/support/solutions/articles/155000004683-multi-language-support-for-voice-ai-agents)). Missed after-hours calls are lost revenue; Podium reports 1M+ after-hours leads handled.
2. **Turn meetings into suggested CRM updates you approve.** Pipedrive Nova shows old and new values side by side and changes nothing without approval [2H]. It removes the data entry that respondents rank as the top AI wish, without letting AI act alone.
3. **Log email, calendar and WhatsApp automatically.** Less Annoying CRM, Nutshell, Copper and folk all do this. The contact timeline fills itself.
4. **One document takes the client from proposal to contract to invoice to payment.** HoneyBook Smart Files ([src](https://www.honeybook.com/pricing)). Getting paid is the service business's close.
5. **A client portal with a public/private divider and client uploads.** HoneyBook ([src](https://help.honeybook.com/en/articles/6428603-what-clients-can-see-and-do-in-the-client-portal)). The customer gets one link instead of email attachments.
6. **Portal landing page = "what you owe us".** Dubsado shows unread emails, incomplete forms and open invoices, plus a copy of every email sent ([src](https://help.dubsado.com/en/articles/7028462-what-are-client-portals-in-2-0)). It cuts "did you get my email?" calls.
7. **Self-service booking, payments and prepaid packages in the portal.** Thryv ([src](https://www.thryv.com/reference/client-portal/)). Built for daycares, salons and trainers.
8. **Flag conversations that have gone quiet and draft the nudge in your voice.** folk ([src](https://help.folk.app/en/articles/10304768-follow-up-assistant)). Follow-up is where small businesses leak money.
9. **One-click summary and meeting prep, in the user's language.** Zoho covers English plus 22 languages ([src](https://help.zoho.com/portal/en/kb/crm/zia-artificial-intelligence/generative-ai/articles/zia-record-summary)); Capsule offers Meeting Prep. Summaries and writing are what small businesses actually use AI for.
10. **Photo or PDF in, filled fields out.** Zoho's zero-shot reading (Q1 2026) ([src](https://www.zoho.com/blog/crm/q1-2026-update.html)); business-card scanners in Pipedrive and folk. Owners work from phones and paper.
11. **An agent that calls, qualifies, books and hands off to a human.** Close Chloe ([src](https://www.globenewswire.com/news-release/2026/06/09/3309383/0/en/close-launches-chloe-an-ai-sales-agent-built-directly-into-the-crm.html)). Reactivating old leads is work nobody has time for.
12. **Industry templates at signup.** Bigin's 13 ([src](https://www.bigin.com/templates/)). Owners skip configuration entirely.
13. **Describe your business and AI builds the pipeline.** Capsule ([src](https://capsulecrm.com/ai/)). Onboarding for people who never draw workflows.
14. **One flat, transparent price with a no-card trial.** Less Annoying CRM ([src](https://lessannoyingcrm.com/pricing)). It builds trust and removes the fear of plan upgrades.
15. **A free human setup coach.** Less Annoying CRM. The fix for "lack of training".
16. **AI import mapping for a messy spreadsheet on day one.** Pipedrive ([src](https://support.pipedrive.com/en/article/pipedrive-ai)).
17. **Clients with several properties, and separate billing and service addresses.** Jobber ([src](https://help.getjobber.com/hc/en-us/articles/115010161128-Properties)). Essential for plumbers, landscapers and cleaners.
18. **Free-text relationships shown on both records ("Sarah referred Kyle").** Less Annoying CRM ([src](https://lessannoyingcrm.com/help/custom-contact-link-fields-vs-relationships)). Referrals are how local service businesses grow.
19. **Custom objects with two-way relationships (household, child, pet, vehicle).** Attio and Twenty ([src](https://attio.com/help/reference/managing-your-data/attributes/relationship-attributes)). Needed for a daycare's families or an auto shop's vehicles.
20. **Documents stay in the owner's Drive or OneDrive, filled from CRM fields, with e-signature and open alerts.** Pipedrive Smart Docs ([src](https://support.pipedrive.com/en/article/smart-docs)). No new file silo to manage.
21. **Documents priced per company, not per seat.** Nutshell Proposals & Invoices at $79 a month ([src](https://www.nutshell.com/pricing)).
22. **Predictable AI cost: unlimited light assists plus a pool of heavy jobs.** Nutshell ([src](https://www.nutshell.com/pricing)). No surprise bills.
23. **An MCP server on every plan, connected by OAuth, able to create proposals and invoices from templates.** HoneyBook and Pipedrive ([src](https://www.globenewswire.com/news-release/2026/08/19/3347702/0/en/honeybook-mcp-debuts-as-a-claude-connector-for-client-pipelines-invoices-and-contracts.html)). Owners already use Claude and ChatGPT.
24. **Gmail sidebar with history, deals and files, plus one-click add.** Copper ([src](https://www.copper.com/google-workspace-crm)). Owners live in their inbox.
25. **Two-way calendar sync where the user picks the direction.** Zoho and Pipedrive. The schedule is the business.
26. **A service catalog that doubles as a storefront taking payment into the pipeline.** Bigin Q2 2026 ([src](https://www.zoho.com/blog/bigin/q2_2026_updates.html)).
27. **An automatic WhatsApp reply to every form submission.** Bigin. WhatsApp is the default channel for Spanish-speaking customers.
28. **Lead intent scoring tied to which marketing spend produced the lead.** Thryv AI Lead Insights ([src](https://www.thryv.com/news/thryv-launches-ai-native-growth-platform-for-small-businesses/)). Answers "which ad pays?"
29. **AI drafts review replies and asks for reviews.** Birdeye's agents run autonomously or with supervision ([src](https://www.prnewswire.com/news-releases/birdeye-unveils-the-industry-first-agentic-marketing-platform-302550278.html)); Podium does the same. Reputation is how local businesses get found.
30. **A single "what needs me today" queue.** Zoho Workqueue gathers tasks, calls, appointments and assigned records ([src](https://www.zoho.com/blog/crm/q1-2026-update.html)). One screen at 7 a.m.

---

## (d) Anti-patterns small businesses complain about

- **Hidden prices and lock-in.**
  - Podium and Birdeye publish no prices ([src](https://www.podium.com/getpricing)).
  - Reported terms include 12-month auto-renewing contracts, 90-day cancellation notice and an 8% "innovation fee" at renewal [2H] ([src](https://wiserreview.com/blog/birdeye-pricing/)).
- **Mandatory paid implementation**, as at Keap ([src](https://keap.com/pricing)); consultant-heavy setups, as with Salesforce [2H].
- **The add-on tax.**
  - Pipedrive has five add-ons ([src](https://www.pipedrive.com/en/pricing)).
  - Nutshell charges separately for Marketing ($49) and Engagement ($16 per user).
  - Freshsales charges for Branded Documents ($19 per user).
- **AI locked behind top tiers or confusing credits.**
  - Pipedrive's AI email is Premium-only.
  - Freshsales scoring starts at Pro.
  - Attio runs two separate credit pools, and raised prices in July 2026 [2H] ([src](https://ahoy.ai/ai-native-crm/pricing-index/attio/)).
- **AI that only reads, or needs another subscription.** Copper GPT is read-only and needs paid ChatGPT [2H].
- **AI features nobody knows exist.** 8% of users with AI in their CRM are unaware of it ([src](https://finance.yahoo.com/small-business/articles/modern-salesperson-becoming-data-entry-122400248.html)).
- **Tiny storage on the entry tier.** Salesforce Starter gives 1 GB for the whole organization.
- **Caps that force an upgrade.** Copper Basic's 2,500 contacts; Attio Plus's 10 seats.
- **Rigid data models.** One organisation per person in Capsule; no property or household objects in most small-business CRMs.
- **Tool sprawl.** 79% switch tools to see a whole account.
- **Agents that act without review, or speak only English.** Pipedrive's research says people want "a thinking partner, not an autopilot" [2H]. Chloe is English-only.

---

## Second-pass additions from 2025–2026 release notes

- **Pipedrive:** Nova (September 16), MCP listed in Claude's connector directory (August 18), Projects with AI briefs (May 26) ([src](https://www.pipedrive.com/en/newsroom)).
- **Zoho CRM Q1 2026:** Workqueue, plain-language formula generator, zero-shot document reading, choice of Claude, Gemini or Cohere, WorkDrive storage.
- **Bigin:** Q2 2026 agents, storefront and WhatsApp; Apple Intelligence and Siri support (post dated September 17, 2026, linked from the [Q2 page](https://www.zoho.com/blog/bigin/q2_2026_updates.html)).
- **Salesforce:** Slack CRM included free with Slack Business+ ([src](https://www.salesforce.com/ap/news/press-releases/2026/07/01/salesforce-brings-agentforce-into-salesforce-suites-and-slack-crm-for-small-businesses-in-singapore/)).
- **Twenty:** v2.0 on April 21 (agents, MCP); right-to-left languages and a speed-versus-quality AI slider in v2.40 ([src](https://twenty.com/releases)).
- **Attio:** Workflows (June 9); mobile call recordings (June 29); files API; a meeting bot you can dismiss by typing "please leave" ([src](https://attio.com/changelog/2026/changelog-april-29-2026)).
- **Copper:** CopperGPT customization (December 2025); branded navigation (April 2026) ([src](https://support.copper.com/en/collections/11392297-product-updates)).
- **Nutshell:** the quotes and documents product was renamed "Proposals & Invoices" in June 2026.
- **Keap:** monthly updates through January 2026 ([src](https://keap.com/product-updates)).
- **Less Annoying CRM:** 2025 brought email logging, forms, automations and task templates, but no AI ([src](https://www.lessannoyingcrm.com/blog/2025-less-annoying-crms-year-in-review)).

**Bilingual notes:**
- Zoho summaries: English plus 22 languages, including Spanish.
- Bigin: translation inside the email composer.
- GoHighLevel: the only documented agent that switches between English and Spanish.
- Close Chloe: English only, with multilingual support "planned".
- Podium: partial Spanish [2H].

**Not verified:** Keap's, Insightly's, EngageBay's and GoHighLevel's Google/Microsoft integration details; Dubsado AI; Pipedrive file-storage limits; exact Zoho portal tiers (2H only).
