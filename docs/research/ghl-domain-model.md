# GoHighLevel — Reverse-Engineered Feature Inventory & Domain Model
Research date: 2026-07-25/26. Public sources only. Primary artifact: GHL's public OpenAPI corpus
(github.com/GoHighLevel/highlevel-api-docs — 48 v3 specs, 627 operations, ~1,900 schemas; local clone
in this scratchpad under `ghl-docs/`). API base: services.leadconnectorhq.com, `Version: 2021-07-28` header.

## A) ENTITY MODEL

### A.0 Two-level tenancy spine
```
Company (Agency)  1──*  Location (Sub-Account)  1──*  <everything else>
        ├── Snapshot (library)   ├── User (account-scoped)
        ├── SaaSPlan             ├── Business (branch inside a location)
        ├── User (agency-scoped) └── Contact ── Opportunity, Conversation, Appointment…
        └── CustomMenu
```
Everything not explicitly agency-level carries `locationId`. Ownership is a hard column, not a join.

### A.1 Agency level
**Company**: id, name, email, logoUrl, phone, website, domain, spareDomain, subdomain, privacy/terms,
address fields, timezone, relationshipNumber (agency-to-agency id for snapshot sharing), plan, currency,
customerType, status, locationCount, isReselling, upgradeEnabledForClients, cancelEnabledForClients,
autoSuspendEnabled, saasSettings, stripeConnectId, isEnterpriseAccount, isSandboxAccount,
twilioTrialMode, twilioFreeCredits (Twilio leaks into Company schema), termsOfServiceVersion triplets,
businessNiche/Category, onboardingInfo{...snapshotId, planId...} (agency onboarding itself snapshot-driven).

**Snapshot**: {id, name, type: own|imported}; ShareLink {snapshot_id, share_type: link|permanent_link|
agency_link|location_link, relationship_number, share_location_id}; SnapshotStatus {id, locationId, status,
dateAdded}; SnapshotStatusWithAssets {completed[], pending[]} — async job with per-asset progress.
API is read+share only — apply happens via POST /locations/ (snapshotId) or PUT /locations/{id}
(snapshot: {id, override}).

**SaaSPlan**: planId, companyId, title, description, saasProducts[], addOns[] (feature gating), planLevel,
categoryId (plans in category share currency + upgrade path), trialPeriod, setupFee, userLimit, contactLimit,
prices[], productId, snapshotId (auto-applied on purchase), providerLocationId (V2 billing system-of-record),
isSaaSV2.

**LocationSubscription** {locationId, companyId, isSaaSV2, saasMode, subscriptionId, customerId, productId,
priceId, saasPlanId, subscriptionStatus}; **LocationWallet** {walletId, balance, complimentaryCredits};
**RebillingConfig** {product: contentAI|workflow_premium_actions|workflow_ai|conversationAI|EmailNotification|
whatsApp|reviewsAI|VERIFIED_CALLER_ID, locationIds[], config{enabled, markup, price}};
**CustomMenu** {icon, title, url, order, showOnCompany/Location, locations[], openMode: iframe|new_tab|
current_tab, userRole, allowCamera/Microphone} — agency nav items injected into sub-account UI
(white-label extension point).

### A.2 Location (Sub-Account) — the tenant boundary
**Location**: id, companyId, name, domain, address fields, website, timezone, contact person, logoUrl,
business{}, social{fb, gplus, linkedIn, twitter, yelp, instagram, youtube, pinterest, blogRss,
googlePlacesId}, settings{allowDuplicateContact, allowDuplicateOpportunity, allowFacebookNameMerge,
disableContactTimezone}, prospectInfo, twilio{sid, authToken} (BYO), mailgun{apiKey, domain} (BYO),
snapshotId on create / snapshot{id, override} on update, reseller.
DELETE /locations/{id}?deleteTwilioAccount= cascades to Twilio subaccount. Create/delete = Agency Pro $497 gated.
**Business** (branch/department inside location): {id, locationId, name, phone, email, website, address...}.
Contacts carry businessId.

### A.3 CRM core (all locationId-scoped)
**Contact**: id, locationId, businessId, name fields + lowercase-normalized copies, email, phone, companyName,
address, timezone, dateOfBirth, ssn, gender, type, source, keyword, assignedTo, tags[],
customFields[{id,value}], dnd + dndSettings per channel {call,email,sms,whatsApp,gmb,fb}
each {status: active|inactive|permanent, message, code}, inboundDndSettings,
attributionSource/lastAttributionSource {url, campaign, utm*, referrer, fbclid, gclid, msclikid, dclid,
fbc, fbp, fbEventId, userAgent, ip, medium}, visitorId, lastActivity, followers[].
POST /contacts/upsert (dedupe-on-write), GET /contacts/search/duplicate, POST /contacts/search
(ES-backed, searchAfter[] cursor).

**Opportunity**: id, locationId, contactId, pipelineId, pipelineStageId, name,
status: open|won|lost|abandoned, monetaryValue, source, assignedTo, lostReasonId, followers[],
customFields[], forecast* fields (expectedCloseDate, probability, slippage counts),
lastStatusChangeAt, lastStageChangeAt, externalObjectId (link to Custom Object record),
denormalized notes[]/tasks[]/calendarEvents[]/contact{} on search.
**Pipeline** {id, locationId, name, stages[], showInFunnel, showInPieChart, useOpportunityProbability,
colorRenderMode}; **LostReason** first-class entity. Stage aggregation returns {totalCount, totalValue,
weightedValue, openValue, openWeightedValue, wonValue}.

**Tag** {id, locationId, name} (location vocabulary; contacts store denormalized names).
**Task** {id, contactId, title, body, dueDate, completed, assignedTo} + RecurringTask {rruleOptions...}.
**Note** {id, contactId, userId, body, title, color, pinned}. **Follower** = M2M User↔(Contact|Opportunity|Record).

### A.4 Schema-as-data (extensibility layer)
**CustomField**: {id, locationId, objectKey, name, fieldKey, dataType: TEXT|LARGE_TEXT|NUMERICAL|PHONE|
MONETORY|CHECKBOX|SINGLE_OPTIONS|MULTIPLE_OPTIONS|FILE_UPLOAD|DATE|TEXTBOX_LIST|RADIO, options[],
showInForms, acceptedFormats[], maxFileLimit, parentId (folder), model: contact|opportunity}.
**CustomValue**: {id, locationId, name, fieldKey, value} — merge tags / account-level template variables.
KEY snapshot-portability primitive: templates reference {{custom_values.x}} so cloned config re-points
to new tenant's data without editing assets.
**CustomObject** {id, key, standard, labels, locationId, primaryDisplayProperty, searchableProperties[]};
**Record** {id, objectId, objectKey, locationId, owner[], followers[], properties};
**Association** {key, firstObjectKey, secondObjectKey} + **Relation** {associationId, firstRecordId,
secondRecordId} — generic typed graph edges.

### A.5 Conversations
**Conversation**: {id, locationId, contactId, assignedTo, lastMessageBody/Date/Type, unreadCount, inbox,
starred, type: TYPE_PHONE|TYPE_EMAIL|TYPE_FB_MESSENGER|TYPE_REVIEW|TYPE_GROUP_SMS} —
ONE conversation per contact, not per channel.
**Message**: {id, conversationId, contactId, locationId, messageType: TYPE_CALL|TYPE_SMS|TYPE_RCS|TYPE_EMAIL|
TYPE_WEBCHAT|TYPE_SMS_REVIEW_REQUEST|TYPE_SMS_NO_SHOW_REQUEST|TYPE_CAMPAIGN_*, direction,
status: pending|scheduled|sent|delivered|read|undelivered|connected|failed|opened|clicked, body,
contentType, attachments[], meta{callDuration, callStatus, email}, source: workflow|bulk_actions|campaign|
api|app, conversationProviderId, chatWidgetId}.
**EmailMessage** extra: {threadId, subject, from/to/cc/bcc, replyToMessageId, provider}.
Send channels: SMS|RCS|Email|WhatsApp|IG|FB|GMB|Custom|Live_Chat|TIKTOK|WebChat.
**ConversationProvider** {_id, name, type, default} — pluggable transport (marketplace app can replace carrier).
**ChatWidget**: themable, cloneable, liveChat|emailChat modes, settings incl. showAgencyBranding, locale.

### A.6 Calendars (fattest entity ~50 fields)
**Calendar**: calendarType: round_robin|event|class_booking|collective|service_booking|personal;
eventType RoundRobin_OptimizeForAvailability|EqualDistribution; teamMembers[{userId, priority 0|0.5|1,
isPrimary, meetingLocationType, locationConfigurations[]}]; slotDuration/Interval/Buffer/preBuffer + units;
appoinmentPerSlot/PerDay; allowBookingAfter/For; openHours[]; availabilities[]; enableRecurring +
recurring{freq, count, bookingOption: skip|continue|book_next}; formId, formSubmitType; stickyContact;
isLivePaymentMode; autoConfirm; allowReschedule/Cancellation; shouldAssignContactToTeamMember;
alertEmail; googleInvitationEmails; guestType; pixelId; notifications[].
**Appointment**: {calendarId, locationId, contactId, title, startTime, endTime, appointmentStatus:
new|confirmed|cancelled|showed|noshow|invalid|completed|active, assignedUserId, assignedResources[],
meetingLocationType: custom|zoom|gmeet|phone|address|ms_teams|google, isRecurring, rrule, masterEventId}.
**CalendarNotification**: {receiverType: contact|guest|assignedUser|emails|phoneNumbers|business,
channel: email|inApp|sms|whatsapp, notificationType: booked|confirmation|cancellation|reminder|followup|
reschedule, beforeTime[], afterTime[], templateId...}.
**Schedule** (availability): rules[{type: wday|date, day, date, intervals[]}].
**CalendarResource**: equipments|rooms, quantity, capacity. Service catalog sub-model under /calendars/services/*.

### A.7 Users & permissions
**User**: {id, companyId, name fields, email, phone, extension, profilePhoto, platformLanguage,
lcPhone, twilioPhone, permissions{}, scopes[], scopesAssignedToOnly[], roles{}}.
**Role**: {type: agency|account, role: admin|user, locationIds[], restrictSubAccount} —
THE ENTIRE MULTI-TENANT AUTHZ MODEL IN FOUR FIELDS.
**Permissions**: flat bag of ~40 booleans (campaignsEnabled, contactsEnabled, workflowsEnabled,
opportunitiesEnabled, appointmentsEnabled, reviewsEnabled, conversationsEnabled, assignedDataOnly,
membershipEnabled, paymentsEnabled, socialPlanner, bloggingEnabled, invoiceEnabled, contentAiEnabled,
communitiesEnabled, ...). Same bag at LOCATION level; location caps user ("a user can never have more
permissions than the sub-account allows"). SaaS plan feature list DERIVES the location bag = feature gating.

### A.8 Content/marketing entities (thin in API — builder-owned)
Workflow {id, locationId, name, status, version} READ-ONLY list; Campaign (legacy drip) read-only;
Funnel + FunnelPage read-only; Redirect full CRUD; Form/Survey read-only + submissions (submission carries
eventData{fbc, fbp, page, utm, fingerprint, contactSessionIds}); TriggerLink CRUD;
EmailTemplate {editorType: html|builder|text, ...} CRUD + import from mailchimp/active_campaign;
EmailCampaign/Schedule; SMS/Email location templates; Blog (Post/Author/Category/Site) CRUD;
Media File/Folder {altId, altType: location, isPrivate, appFolder}; SocialPost (36 endpoints, category
queues w/ slots); Course (Product→Category→SubCategory→Post→PostMaterial) import only;
KnowledgeBase {kbMetadata{faqs, urls, richText, files, webSearches, tables}} + FAQ + crawler;
BrandBoard/BrandVoice.

### A.9 Commerce
Product/Price (one_time|recurring, trials, setupFee, membershipOffers, variants, sku, inventory,
digitalDelivery), Collection, ProductReview, Order {contactSnapshot, source{type: funnel|website|invoice|
calendar|text2Pay|document_contracts}}, Subscription {subscriptionSnapshot, paymentProviderType},
Transaction, Coupon, Invoice {status: draft|sent|payment_processing|paid|void|partially_paid,
businessDetails, tipsConfiguration, lateFeesConfiguration, paymentSchedule} + InvoiceTemplate +
recurring InvoiceSchedule + Estimate (+convert), text2pay, ShippingZone/Rate/Carrier,
Affiliate/Payout/Commission, Proposal/Document {fillableFields[], recipients[], links[]} + DocumentTemplate.

### A.10 AI entities
**ConversationAI Agent** actions: triggerWorkflow|updateContactField|appointmentBooking|stopBot|
humanHandOver|advancedFollowup|transferBot; stopBot{detectionType: Goodbye|Custom, examples[],
sleepTime, finalMessage, tags[]}; followupSettings{dynamicChannelSwitching, followUpHours, workingHours[],
timezoneToUse: contact|business}.
**VoiceAI Agent**: {locationId, agentName, businessName, welcomeMessage, agentPrompt, voiceId, language,
patienceLevel, maxCallDuration, sendUserIdleReminders, inboundNumber, numberPoolId, callEndWorkflowIds[],
sendPostCallNotificationTo{...}, agentWorkingHours[], translation}.
**VoiceAI Action**: CALL_TRANSFER|DATA_EXTRACTION|IN_CALL_DATA_EXTRACTION|WORKFLOW_TRIGGER|SMS|
APPOINTMENT_BOOKING|CUSTOM_ACTION|KNOWLEDGE_BASE; DataExtraction{contactFieldId, description, examples[],
overwriteExistingValue}; CustomAction{triggerPrompt, apiDetails{url, method, headers, parameters},
selectedPaths[]}.
**CallLog**: {contactId, agentId, fromNumber, duration, executedCallActions[], summary, transcript,
translation, extractedData, messageId}.
**Agent Studio Agent**: {locationId, agencyId, name, status, versions[], nodes[], edges[],
globalVariables[], inputVariables[], runtimeVariables[]} — versioned publishable node/edge graph;
execute returns {executionId, response, nextExpectedInput, goalCompletion, executionStatus, flowSwitch,
generativeOutputs[]}.

### A.11 Phone infra
**PhoneNumber**: {phoneNumber, friendlyName, sid, addressSid, bundleSid (literal Twilio primitives),
capabilities{voice,sms,mms,fax}, isDefaultNumber, linkedUser, linkedRingAllUsers[], inboundCallService,
forwardingNumber, isGroupConversationEnabled}; NumberPool; RcsSenderId.

## B) FEATURE MAP (module → what it does)
CRM/Contacts; Opportunities/Pipelines (weighted forecasting, lost reasons, stage aggregates);
Custom Objects/Associations; Conversations unified inbox (one thread per contact across 11 channels,
pluggable providers); Chat Widget; Automation (workflows: triggers→conditions→actions, premium/AI actions
metered per execution); Campaigns (legacy drip); Sites/Funnels/Websites (drag-drop builder, order forms,
upsells, redirects, blogs, WP hosting); Forms/Surveys/Quizzes; Calendars (6 types, resources, buffers,
recurrence, notification matrix, paid bookings); Reputation (review requests, AI replies, widgets);
Online Listings (resold Yext/Uberall); Payments/Invoicing; Store/Ecommerce; Memberships/Courses/Communities;
Documents & Contracts (e-sign); Social Planner (category queues, CSV import); Ad Manager (Meta/Google/
LinkedIn: 76 endpoints); Reporting/Dashboards (custom metrics/reports); Conversation AI; Voice AI;
Agent Studio (node/edge agent graphs); Content AI; Knowledge Base (crawler → AI corpus); LC Phone
(numbers, pools, A2P 10DLC, RCS); LC Email (dedicated domain/IP, templates, campaigns, validation);
Affiliate Manager; Media Library; Marketplace/Apps (OAuth, custom pages/menus/JS, custom conversation +
payment providers, usage-based rebilling); Snapshots; SaaS Mode; White-label.

## C) PROVISIONING STORY

### C.1 Manual onboarding path
1. Create sub-account ("client's account" vs "my own account" = Agency Sub-Account flag). API: POST /locations/
   with snapshotId — Agency Pro gated.
2. Apply snapshot (inline at creation, or later "Load Snapshot"). Only ONE snapshot at creation.
3. Phone: per-sub-account number purchase (never shared). Persona KYC possible; A2P 10DLC separate gate.
4. Email: shared domain OOB; dedicated sending SUBDOMAIN per sub-account for deliverability
   (sub-account without own domain = shared even if agency has one).
5. Domains: funnels/sites arrive as DRAFTS until domain connected + published.
   Root A 162.159.140.166 / CNAME sites.leadconnectorhq.com. Separate API/branded-links domain rewrites
   all system-generated links (forms/calendars/trigger/review links), settable agency AND sub-account level.
6. Integrations (Google/Outlook cal, ads, Stripe, GBP) — per sub-account, NONE carry over in snapshot.
7. Invite client user: User Type Account, locations, role, permission toggles. One user ↔ many locations.
8. Optional rebilling: client adds own card.

### C.2 SaaS Mode automated path
Payment confirmed → sub-account created + linked to customer → snapshot applied (if attached to plan) →
onboarding email (login URL + password setup) → account Active/Trialing. Optional "pause new sub-accounts
pending approval" gate.

### C.3 Snapshots — full treatment
Definition: reusable template capturing SELECTED config assets from a source sub-account. You never author
a snapshot directly — build a source sub-account, then capture.
Lifecycle: Create · Load · Create-New-Sub-Account-From · Share · Import · Refresh · Push Updates ·
View Assets · Manage Linked Assets.

CAPTURES: Ad campaign templates; Agent Studio/Brand Voice/Conversation AI/Voice AI agents/Workflows/Triggers;
Calendars + groups + services + resources; Custom Fields/Objects/Values, Pipelines, Tags, Trigger Links;
Blogs, Campaigns, Email templates, Forms, Funnels & Websites, Quizzes, Section templates, Social Planner,
Surveys, Text & Email templates; Custom Metrics/Reports/Dashboards; Certificates, Membership offers/products,
Webinars; Brand colors, Design kit; Documents & Contracts, Folders, Knowledge Bases; Review SETTINGS;
WhatsApp templates; WordPress site; associations (when both objects selected).

DOES NOT CAPTURE: Contacts · Appointments · Conversations/Messages · reputation DATA · live activity ·
Stripe connections · ALL third-party integrations · phone numbers (incl. VoiceAI-assigned) · LinkedIn
lead forms · private dashboards · WP licenses · contact-to-contact associations · Assets-Protected assets.
Implied also: domains, users, A2P registration, billing.
Post-load work: WhatsApp needs Meta approval; Voice AI needs number; funnels need domain+publish.

Refresh/Push sharp edges:
- Snapshots NEVER auto-update; manual per-asset Refresh, failures retryable.
- Push rules: created-by-snapshot → overwritten; manually-edited-in-subaccount → REVERTED;
  user-duplicated → untouched; Custom Values → never touched; Users → not modified;
  external agencies can't receive pushes (re-import new link).
- Load ≠ Push: Load is additive, never deletes — LOADING TWICE DUPLICATES EVERYTHING.
  Per-conflict Override vs Skip + typed `confirm`. Override irreversible. Async + email.
- A snapshot cannot be "unloaded" — manual element-by-element removal.
- Version History shows Added/Removed/Synced. Bulk: first 100 immediate, then 100 per 10 min.
- Top user complaints (open ideas/bugs): duplicate-on-reload; overwrite-instead-of-merge (want
  map/merge of custom fields/values/tags on import); custom-value folders missing from snapshots.

Sharing: permanent_link | one-time link | email | agency_link (relationship_number) |
location_link (share_location_id) | marketplace. Shared snapshots are FROZEN CLONES (refresh → new URL
invalidates old). "Assets Protected" blocks re-sharing. Daily import digest. Import ≠ Load (import → agency
library; load → into a sub-account).

## D) MULTI-TENANCY + WHITE-LABEL

### D.1 API scoping
- OAuth 2.0 auth-code only; choose-location consent page (white-label host marketplace.leadconnectorhq.com).
- Token exchange takes userType: Company | Location — THE tenancy switch. Response carries
  {locationId, companyId, approvedLocations[], installToFutureLocations, approveAllLocations, planId, userId}.
- Agency token → location token: POST /oauth/location-token {companyId, locationId} = downscoping/
  impersonation primitive. GET /oauth/installed-locations enumerates installs.
- Access tokens 1 day; refresh 1 year rolling.
- Rate limits: 100 req/10s burst + 200k/day PER APP PER RESOURCE (Location OR Company) — limits multiply
  per tenant, don't pool.
- Scopes: 90 total, only 5 agency-level (locations.write, oauth.readonly, oauth.write, saas/location.write,
  snapshots.readonly); ~81 sub-account-only. Cross-tenant power = deliberately tiny surface.
- Webhooks app-scoped, ~70 events, HMAC-signed; LocationCreate only for Agency-level apps.
- App billing: internal or external (redirect w/ {clientId, installType, locationId, companyId});
  usage charges POST /marketplace/billing/charges {meterId, eventId, units, price} + /has-funds precheck.
- Commerce entities use altId + altType: location (polymorphic owner escape hatch).

### D.2 Permission model (3 layers)
1. User type: agency (all locations) vs account (locationIds[], restrictSubAccount).
2. Role: admin vs user.
3. Permission bag ~40 booleans at user AND location level; location = ceiling; SaaS plan derives location bag.
Broader agency permissions always win. "Login As" = separate agency permission.

### D.3 White-label surfaces
- App domain: CNAME app.youragency.com → whitelabel.ludicrous.cloud (subdomain only, no apex;
  Let's Encrypt auto-SSL; Cloudflare proxy must be OFF).
- API/branded-links domain (agency + sub-account): rewrites forms/surveys/calendars/trigger/short/review links.
- Sites domain: A 162.159.140.166 / CNAME sites.leadconnectorhq.com, per funnel/site.
- Email sending domain: dedicated subdomain + DNS; dedicated IP $59/mo; sub-account overrides agency.
- Client Portal domain (communities/courses/affiliate).
- Branding: logo on login/header/emails/widgets/form footers; custom JS + CSS at agency level; no agency favicon.
- Custom Menus: agency-defined nav (iframe|new_tab|current), role-filtered, per-location.
- Branded mobile apps: (a) Client Portal app $79/mo/location; (b) full white-label CRM app $497/mo.
- Domain Connect auto-DNS for Google/Cloudflare/GoDaddy; else manual.

### D.4 SaaS Mode / billing topology
- $497 Agency Pro only. V1 = Stripe-only agency-level; V2 = per sub-account vs an Agency Sub-Account as
  billing system-of-record; providers Stripe/NMI/Square/Authorize/Adyen/MercadoPago + custom. V2 lacks
  prorations, coupon deflections, self-serve reactivation.
- Plan Category required first; category shares currency + upgrade path; moving plans within category
  requires disable→re-enable SaaS WHICH DESTROYS THE WALLET. Max 99 plans.
- 9-step plan wizard: Details → Category → Pricing → Features & Snapshot → Add-ons → Marketplace Apps →
  Trial & Credits → Usage Billing → Save.
- Wallet model: Agency Wallet auto-recharges from agency card; LC usage debits it; with markup, system
  charges Sub-Account Wallet at marked-up price topped from AGENCY's Stripe (two-hop money flow).
  $297 tier: rebill w/o markup, fixed 1.05×; $497: arbitrary markup + bulk configurator.
  Disabling SaaS cancels subscription and PERMANENTLY DELETES WALLET. No 3DS-only cards for auto-recharge.

## E) TECH VENDOR MAP (confidence in parens)
GCP + AWS hosting, US-only infra (CONFIRMED). Cloudflare CDN/WAF/DNS + Cloudflare-for-SaaS-style custom
hostnames via ludicrous.cloud (CONFIRMED). MongoDB Atlas (LIKELY-CONFIRMED: _id everywhere, mongodb TXT).
Elasticsearch-class search (searchAfter cursors) (LIKELY). Vue SPA frontend (CONFIRMED).
LC Phone = Twilio (CONFIRMED: SIDs in API, ISV program, Twilio-parity pricing, deleteTwilioAccount param);
Sinch secondary (LIKELY). LC Email = Mailgun (CONFIRMED: docs verbatim, BAA, SPF); SendGrid secondary.
Payments: Stripe platform + Connect, + PayPal/NMI/Authorize/Square/Adyen/Razorpay/MercadoPago + custom
providers (CONFIRMED). Chargebacks911, Tipalti (affiliate payouts), FirstPromoter, Persona KYC (CONFIRMED).
LLMs: OpenAI (Conversation AI is OpenAI-only), Gemini Flash, Claude Sonnet/Haiku (CONFIRMED, published
per-model rate tables). TTS: OpenAI $0.015/min, Cartesia $0.015, ElevenLabs $0.035–0.17 (CONFIRMED).
Voice orchestration: RetellAI, Synthflow, BotPress sub-processors; "Voice Engine $0.045/min"; status page
has "AI Wrapper" component (CONFIRMED as sub-processors). ASR vendor UNKNOWN. Tavily web search $0.01.
DALL·E 3 + Veo3. Listings: Yext + Uberall. SEO: Search Atlas $79. Ads: Meta/Google/LinkedIn APIs.
Calendar: Google/Teams/Zoom. Freshdesk support, Better Stack status, Pendo/ChartMogul analytics, Zapier.
Domains: gohighlevel.com (marketing), leadconnectorhq.com (backend + white-label host), msgsndr.com
(short links/media), filesafe.space (CDN), ludicrous.cloud (edge).

## F) PLAN TIERS
Starter $97 (3 sub-accounts, unlimited contacts/users). Unlimited $297 (unlimited accounts, rebill w/o
markup 1.05×, basic API, branded desktop app). Agency Pro $497 (SaaS Mode, automated sub-account creation
API, snapshots API, markup rebilling, advanced API). Enterprise custom (raised limits, HIPAA, WL mobile app).
Add-ons: AI Employee $50–97/sub-account · client portal app $49 · dedicated IP $59 · HIPAA $297 ·
listings $30 · WhatsApp $10+usage · WL mobile app $497 · WordPress from $10.
Usage: email $0.675/1k; SMS/voice at Twilio parity; validation $2.50/1k; workflow premium actions
$0.01/exec; Voice Engine $0.045/min + TTS + LLM + phone.

## G) DESIGN TAKEAWAYS FOR CLEAN-ROOM BUILD
1. Two-level tenancy IS the architecture: Company → Location, locationId on every row, 4-field role
   (type/role/locationIds[]/restrictSubAccount). Location permission bag capping user bag makes per-plan
   feature gating fall out for free.
2. Custom Values make cloning work — build account-level template variables BEFORE templating.
3. Snapshot = selective config export/import, per-asset async job, override/skip conflict resolution,
   provenance flag (created-by-snapshot drives overwrite-vs-preserve on push). GHL's biggest unfixed
   complaints: duplicate-on-reload + overwrite-instead-of-merge. Solve with stable idempotency keys +
   real merge strategy → beat them on their core mechanic.
4. Never put credentials/live data/connected accounts in the template (their exclusion list = anything
   with an OAuth token, phone number, domain, or customer record).
5. Agency-token → scoped-location-token mint is the cleanest cross-tenant primitive; copy it.
6. Config-heavy entities dwarf CRM entities (Calendar ~50 fields). Budget for that.
7. GHL keeps builder-owned assets (workflows, funnels, forms, snapshots) READ-ONLY in the API —
   decide whether to inherit that limitation or differentiate with full API CRUD.
8. Rate-limit per tenant, not per app.
9. Wrap, don't build: Twilio (subaccount-per-tenant), Mailgun (domain-per-tenant), Stripe Connect,
   Cloudflare for SaaS (custom hostnames + auto-SSL). That's the whole infra story.
