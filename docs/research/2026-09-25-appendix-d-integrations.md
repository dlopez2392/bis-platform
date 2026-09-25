# Appendix D — Google, Microsoft, documents, e-signature, payments and AI: feasibility and cost

Part of `2026-09-25-crm-feature-research.md`. Research compiled 2026-09-25 by a delegated research agent; sources inline. Effort estimates are the researcher's own, not sourced.

---

# Integrations feasibility and cost report for a multi-tenant SMB CRM (as of 2026-09-25)

**Stack assumed:** Next.js App Router on Vercel, Supabase Postgres with per-tenant RLS, Clerk, Telnyx, Resend and OpenAI.

**How to read the sources:**
- Links go to official docs unless a claim is marked **[2H]** (secondhand: a vendor blog, a third-party article, or a search-result summary I could not open in full).
- Effort figures are my own estimates for a 2–3 person team. They are not from any source.
- The web-search quota ran out near the end. A few 2026 items (Salesforce and Attio MCP) rely on search snippets and are marked [2H].

---

## 0. Summary of the findings that most change the plan

1. **You can avoid Google's CASA security assessment completely.** Choose scopes so that nothing is *restricted*:
   - Calendar scopes are **sensitive**. Google's own example: "reading events stored in Google Calendar" is sensitive ([sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)).
   - `gmail.send` is **sensitive**, not restricted ([Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)).
   - `drive.file` is **non-sensitive** ([Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)).
   - `contacts` is sensitive. Google's example is "storing a new contact in Google Contacts" (same sensitive-scope page).
   - That set needs brand verification plus sensitive-scope verification only. CASA applies to restricted scopes ([restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
   - **What that set cannot do:** read the inbox. Every Gmail read scope is restricted, and so is Gmail push: `users.watch` accepts only `mail.google.com`, `gmail.modify`, `gmail.readonly` or `gmail.metadata` ([users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch)).

2. **Microsoft now blocks user consent for calendar and mail reads on new tenants by default.** The "Let Microsoft manage your consent settings" policy is the default for new tenants. It stops end users consenting to `Calendars.Read`, `Calendars.ReadWrite`, `Mail.Read`, `Mail.ReadWrite`, `Contacts.ReadWrite`, `OnlineMeetings.ReadWrite`, `Chat.Read`, `Files.Read.All`, `Sites.Read.All`, `People.Read` and others ([Entra app consent policies](https://learn.microsoft.com/entra/identity/enterprise-apps/manage-app-consent-policies)).
   - The rollout began 16 July 2025 with Files/Sites. Microsoft extended it to Outlook mail, calendar and Teams permissions later in 2025 [2H: [MC1097272](https://mc.merill.net/message/MC1097272), [Topedia](https://blog-en.topedia.com/2025/11/microsoft-managed-default-app-consent-policy-now-blocks-20-additional-permissions/)].
   - `Mail.Send`, `Files.Read`/`Files.ReadWrite` (own files) and `Contacts.Read` are **not** on the blocked list.
   - **Effect:** Outlook calendar sync needs a tenant admin to grant consent. At a small business that admin is usually the owner, so build an "admin consent" link into onboarding.
   - Microsoft has no paid audit that corresponds to CASA.

3. **Using Nylas or Cronofy removes CASA only if their OAuth client is the one your users consent to.**
   - Nylas's Shared GCP App has passed Tier 3 CASA. It shows "Nylas" on the consent screen and needs an annual Pro plan with the Accelerator add-on, or Enterprise ([Nylas shared app](https://developer.nylas.com/docs/provider-guides/google/shared-gcp-app/)).
   - If you bring your own Google Cloud project to Nylas, *you* do verification and CASA ([Nylas guide](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/)).

4. **The HIPAA stack is possible but has gaps.**
   - **Resend cannot carry PHI.** Its security page says: "Resend is not HIPAA compliant and cannot sign a Business Associate Agreement" ([Resend security](https://resend.com/security)).
   - **Clerk signs a BAA only on its Enterprise plan** ([Clerk security](https://clerk.com/security)).
   - **Supabase BAA needs the Team plan or higher** ([shared responsibility](https://supabase.com/docs/guides/deployment/shared-responsibility-model)).
   - **Vercel's BAA is a $350/month add-on on Pro** ([Vercel pricing](https://vercel.com/pricing)).

5. **Gmail messaging inside Google Business Profile no longer exists.** Google Business Messages shut down on 31 July 2024 ([Google notice](https://developers.google.com/business-communications/business-messages/resources/release-notes/update-on-gbm)). Only reviews are reachable through the API.

---

## 1. Google Workspace

### 1.1 Calendar API

**Two-way sync**
- Do a full list, store `nextSyncToken`, then run incremental lists with `syncToken`. Deleted events come back too.
- A **410 Gone** response means "wipe the client's store and run a full sync".
- The sync token arrives only on the last page.
- Incremental requests must reuse the original query parameters or you get a 400 ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync)).

**Push notifications (watch channels)**
- Notifications have **no message body**. You must call the API afterwards to see what changed.
- The receiving endpoint needs valid HTTPS; self-signed certificates are rejected.
- `X-Goog-Resource-State` is `sync` when the channel is created and `exists` when something changed.
- "There's no automatic way to renew a notification channel." Create an overlapping channel with a new ID before the old one expires ([push guide](https://developers.google.com/workspace/calendar/api/guides/push)).
- `events.watch` `params.ttl` defaults to **604800 s (7 days)** ([events.watch](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch)).

**Google Meet links**
- Set `conferenceData.createRequest` with a random `requestId` and `conferenceSolutionKey.type: "hangoutsMeet"`, and pass `conferenceDataVersion=1`.
- Creation is asynchronous: status goes from `pending` to `success`.
- Check `allowedConferenceSolutionTypes` on the calendar first ([create events](https://developers.google.com/workspace/calendar/api/guides/create-events)).

**Free/busy**
- `freebusy.query` takes `timeMin`/`timeMax`/`items`, with at most 50 calendars (`calendarExpansionMax`).
- It works with `calendar.freebusy` or `calendar.events.freebusy` ([freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)).

**Scope choice**
- The 20 Calendar scopes are listed at [Calendar auth](https://developers.google.com/workspace/calendar/api/auth).
- For a CRM: `calendar.events` for read/write plus Meet links, and `calendar.freebusy` for availability. Add `calendar.calendarlist.readonly` if users need to pick which calendar to sync.
- Nylas also classes `calendar` and `contacts` as sensitive [2H vendor doc: [Nylas](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/)].

### 1.2 Gmail API

**Scope classification** ([Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)):

| Class | Scopes |
|---|---|
| Non-sensitive | `gmail.labels`, `gmail.addons.current.action.compose`, `gmail.addons.current.message.action` |
| Sensitive | `gmail.send`, `gmail.addons.current.message.metadata`, `gmail.addons.current.message.readonly` |
| Restricted | `mail.google.com`, `gmail.readonly`, `gmail.compose`, `gmail.insert`, `gmail.modify`, `gmail.metadata`, `gmail.settings.basic`, `gmail.settings.sharing` |

**Push via Pub/Sub** ([Gmail push](https://developers.google.com/workspace/gmail/api/guides/push)):
- Grant publish rights to `gmail-api-push@system.gserviceaccount.com`.
- Call `watch()` at least every 7 days.
- Each notification carries only the email address and a `historyId`; use `history.list` to fetch changes.
- Maximum of 1 notification per second per user. Notifications can be delayed or dropped, so keep a fallback poll.

### 1.3 Drive: attaching files to a CRM record

- **Recommended:** `drive.file` (non-sensitive) plus the Google Picker. Your app then sees only files the user picks or creates.
- Google itself recommends this pairing for usability and simpler verification ([Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth); [Picker](https://developers.google.com/workspace/drive/picker/guides/overview)).
- **Full-Drive scopes are all restricted**, so they mean CASA: `drive`, `drive.readonly`, `drive.metadata(.readonly)`, `drive.activity(.readonly)`, `drive.meet.readonly`, `drive.scripts`.
- **Trade-off:** with `drive.file` you cannot browse or search the user's Drive from your own UI or auto-link files by name. Users must pick files. For a CRM "attach a file" button that is fine.

### 1.4 People (Contacts) API

- `createContact` needs the `contacts` scope, which is sensitive ([createContact](https://developers.google.com/people/api/rest/v1/people/createContact)).
- `connections.list` supports `requestSyncToken` and `syncToken`. Tokens **expire 7 days after the full sync** with `EXPIRED_SYNC_TOKEN`, so incremental syncs must run more often than weekly ([connections.list](https://developers.google.com/people/api/rest/v1/people.connections/list)).
- There is no push; you poll.

### 1.5 OAuth verification in 2026

**Brand verification**
- Needed when the app is External, Published, and shows a logo or name on the consent screen.
- Requirements: domain verified in Search Console, a privacy policy disclosing Google data use, and a public homepage.
- Timing: automated review in minutes, manual review "usually 2–3 business days". Results are valid for 7 days if you don't publish ([brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)).
  - *Correction added 2026-09-25 after review, checked against the linked page: "publish" here means the **Publish branding** button, not moving the app from Testing to In production. Brand verification can be completed while the app stays in Testing. Apps requesting only name, email and profile scopes work for any user in Testing mode, with no warning and no 7-day token expiry ([publishing status](https://support.google.com/cloud/answer/15549945)).*

**Sensitive-scope verification**
- Requirements:
  - Privacy policy on the same domain as the homepage.
  - A **demo video** uploaded to YouTube as Unlisted, showing the English consent flow, the app name and client ID, and how each scope is used.
  - A per-scope justification explaining why narrower scopes won't work.
- "Typically takes 3–5 business days" ([sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)).
- Resubmission when you add scopes has been reported at 2–4 weeks [2H: [Nylas blog, 2019/2021](https://www.nylas.com/blog/google-oauth-app-verification/)]. **Request every sensitive scope you will need in the first submission.**

**Restricted scopes and CASA**
- Required when restricted data is accessed "from or through a third-party server" ([restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
- The assessment follows the App Defense Alliance CASA framework and must repeat **at least every 12 months** from the Letter of Assessment date (same page).
- Google assigns the assurance level, **AL1 or AL2**, based on risk, and "all applications must be revalidated every year" ([security assessment](https://support.google.com/cloud/answer/13465431)).
- CASA Tier 2 self-scanning is deprecated for compliance; labs now verify ([ADA Tier 2](https://appdefensealliance.dev/casa/tier-2/tier2-overview)).
- **Authorized labs:** Bishop Fox, DEKRA, Eydle, Leviathan, NCC Group, Netsentries, NowSecure, Prescient, TAC Security, ValueMentor ([ADA labs](https://www.appdefensealliance.org/certification/authorized-labs)).
- **Cost:** you pay, not Google. Roughly **$540–$1,800 for Tier 2/AL1** (TAC Security from $540) and **about $4,500+ for Tier 3/AL2**. Lab time is 1–3 weeks, but remediation often stretches the whole process to months [2H: [DeepStrike 2026](https://deepstrike.io/blog/google-casa-security-assessment-2025), [Switch Labs](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option)].
- Older "$15k–$75k" figures date from before CASA [2H: [Nylas 2019/2021](https://www.nylas.com/blog/google-oauth-app-verification/)].

**Unverified-app limits**
- An unverified app using sensitive or restricted scopes gets a **lifetime cap of 100 new users** after the unverified-app screen appears, and the cap cannot be reset ([unverified apps](https://support.google.com/cloud/answer/7454865); [publishing status](https://support.google.com/cloud/answer/15549945)).
- "Testing" mode allows up to 100 listed test users.
- Refresh tokens in Testing mode **expire after 7 days** unless you request only profile and email scopes ([OAuth 2.0 docs](https://developers.google.com/identity/protocols/oauth2)).
- There is also a limit of 100 refresh tokens per account per client; creating a new one silently revokes the oldest (same page).
- **Pilot pattern:** a few customers in Testing mode, reconnecting weekly, or Internal apps for your own domain.

**Can you avoid CASA?** Yes. `calendar.events` + `calendar.freebusy` + `drive.file` + `gmail.send` + `contacts` → **brand verification plus sensitive-scope verification only**. Expect about 1–3 weeks of wall-clock time for the video, policy edits and back-and-forth.

**Policy constraint on AI use**
- Workspace data may not be used "to create, train, or improve a machine learning or artificial intelligence model beyond that specific user's personalized model" ([Workspace API user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)).
- Use must be limited to "user-facing features that are prominent" in the app's UI ([API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)).
- Sending calendar or Gmail content to OpenAI for a visible feature fits this. Aggregating it into training does not.

### 1.6 Google Business Profile API

**Access**
- Apply through the GBP API contact form ("Application for Basic API Access").
- Prerequisite: you must manage a **verified profile that has been active 60+ days**, with a website.
- Quota is 0 QPM until approved, then 300 QPM. No SLA on the review ([GBP prerequisites](https://developers.google.com/my-business/content/prereqs)).

**Features**
- Reviews: list and reply through v4 `accounts.locations.reviews` / `updateReply` ([review data](https://developers.google.com/my-business/content/review-data)).
- Messaging: gone. Business Messages was discontinued 31 July 2024 ([GBM shutdown](https://developers.google.com/business-communications/business-messages/resources/release-notes/update-on-gbm)).
- I did not confirm the classification of the `business.manage` scope. Check it in the Cloud console and add it to the same verification submission.

### 1.7 Google summary

- **(a) Approach:** Build Calendar sync, Meet links, free/busy, `gmail.send` and Drive via Picker directly, in one Google Cloud project, with one sensitive-scope verification. Log inbound email without restricted scopes (see §3 and §8).
- **(b) Effort:**
  - Calendar two-way sync with watch channels, renewal cron, 410 handling and recurring events: 4–5 weeks.
  - `gmail.send`: 1 week.
  - Picker plus `drive.file`: 1 week.
  - Contacts sync: 1–2 weeks.
  - GBP reviews: 1–2 weeks after approval.
- **(c) Recurring cost:** $0 in Google fees. Pub/Sub is negligible and only needed for Gmail reads.
- **(d) Gates:**
  - Brand verification: 2–3 business days.
  - Sensitive-scope verification: 3–5 business days, realistically 1–3 weeks.
  - GBP API approval: lead time not published.
  - CASA: only if you add restricted scopes; about $540–$4.5k+ a year plus weeks to months.
- **(e) Gotchas:**
  - Channels don't renew themselves.
  - People sync tokens die after 7 days.
  - The 100-refresh-token-per-client limit.
  - Testing-mode tokens expire in 7 days.
  - Adding a scope later triggers a new review.

---

## 2. Microsoft 365 (Graph)

### 2.1 Capabilities

**Calendar**
- Delta sync runs per calendar view: `/me/calendarView/delta?startDateTime&endDateTime`, followed by `@odata.nextLink` and `@odata.deltaLink` tokens.
- No `$select`, `$filter`, `$orderby` or `$expand`.
- Each calendar is tracked separately ([event delta](https://learn.microsoft.com/graph/api/event-delta?view=graph-rest-1.0); [delta for events](https://learn.microsoft.com/graph/delta-query-events)).

**Change notifications: maximum subscription lifetimes** ([subscription lifetimes](https://learn.microsoft.com/graph/change-notifications-overview#subscription-lifetime))

| Resource | Maximum lifetime |
|---|---|
| Outlook message / event / contact | 10,080 min (under 7 days); **1,440 min (under 1 day)** when notifications include resource data |
| OneDrive `driveItem` | 42,300 min (under 30 days) |
| Teams `chatMessage` | 4,320 min (3 days) |
| `onlineMeeting` | 4,230 min |
| presence | 60 min |

- Subscribe to lifecycle notifications to recover dropped subscriptions ([Outlook change notifications](https://learn.microsoft.com/graph/outlook-change-notifications-overview)).
- Teams `chatMessage` subscriptions longer than 1 hour **require** a `lifecycleNotificationUrl` ([Teams chat notifications](https://learn.microsoft.com/graph/teams-changenotifications-chatmessage)).

**Teams meeting links**
- Set `isOnlineMeeting: true` and `onlineMeetingProvider: "teamsForBusiness"` on the event. Read the link from `onlineMeeting.joinUrl`, not `onlineMeetingUrl`, which is being deprecated.
- The setting can't be reverted ([online meetings](https://learn.microsoft.com/graph/outlook-calendar-online-meetings); [choose an API](https://learn.microsoft.com/graph/choose-online-meeting-api)).
- **Personal Outlook.com accounts silently ignore it** [2H: [Microsoft Q&A answer](https://learn.microsoft.com/answers/a/12246645)].

**OneDrive and SharePoint: File Picker v8**
- A Microsoft-hosted page, in an iframe or popup, driven through `postMessage`.
- It uses **SharePoint tokens, not Graph tokens**.
- Reading OneDrive needs `MyFiles.Read` or Graph `Files.Read`. Teams channels need `ChannelSettings.Read.All` plus `AllSites.Read`.
- Consumer OneDrive uses the `/consumers` authority with `OneDrive.ReadOnly` ([File Picker v8](https://learn.microsoft.com/onedrive/developer/controls/file-pickers/?view=odsp-graph-online)).
- For the "attach a file" case, stick to OneDrive with `Files.Read`, which users can consent to themselves.

**Teams messages**
- Reading chats needs `Chat.Read` (delegated); `ChannelMessage.Read.All` for channels. Personal accounts are not supported ([chatMessage get](https://learn.microsoft.com/graph/api/chatmessage-get?view=graph-rest-1.0)).
- Bulk export APIs (`getAllMessages`) are **metered at $0.00075 per message** under model B. Evaluation mode is capped ([Teams API licensing](https://learn.microsoft.com/graph/teams-licenses)).

### 2.2 Multi-tenant app, consent and publisher verification

**Consent defaults** (see Summary item 2; [consent policies](https://learn.microsoft.com/entra/identity/enterprise-apps/manage-app-consent-policies))
- Users on Microsoft-managed tenants cannot consent to Calendars.* or Mail.Read* for third-party apps.
- The `microsoft-user-allow-default-consent-apps` exception covers only named mail clients such as Apple Mail and Thunderbird.
- Microsoft recommends allowing user consent only for **verified publishers** ([configure user consent](https://learn.microsoft.com/entra/identity/enterprise-apps/configure-user-consent)).
- Since November 2020, where risk-based step-up consent is on, users cannot consent to most **unverified** multi-tenant apps that ask for more than sign-in ([publisher verification](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview)).

**Publisher verification** (same page)
- A **free** Microsoft AI Cloud Partner Program account, verified at the partner-global-account level.
- The app registered in an Entra work tenant, not a personal Microsoft account.
- A publisher domain that is not `*.onmicrosoft.com` and matches the partner-account email domain.
- The person doing it needs the right Entra and Partner Center roles and MFA.
- "Can be verified in minutes" once the prerequisites are met. No fee.

**Microsoft 365 certification (optional)**
- Publisher Attestation is a self-assessment of about an hour, renewed annually ([attestation](https://learn.microsoft.com/microsoft-365-app-certification/docs/attestation)).
- Microsoft 365 Certification is an annual paid audit through **Claranet**, including a pentest. Price not published ([certification](https://learn.microsoft.com/microsoft-365-app-certification/docs/certification)).
- It is "recommended", and "in some cases" required by tenants ([overview](https://learn.microsoft.com/microsoft-365-app-certification/overview)). Not needed for SMB launch.

### 2.3 Sidebars: Outlook add-ins, Gmail add-ons, Chrome extensions

**Outlook add-in** (a web task pane)
- Distribute via Microsoft Marketplace through Partner Center, or via the tenant's **Integrated apps** admin deployment, which has no store review ([publish](https://learn.microsoft.com/office/dev/add-ins/publish/publish)).
- Marketplace review "can take up to four weeks from first submission", and first submissions often fail ([checklist](https://learn.microsoft.com/partner-center/marketplace-offers/checklist)).
- Effort: 3–4 weeks.

**Gmail add-on** (Workspace add-on)
- UI is card-based only.
- Contextual scopes `gmail.addons.current.message.readonly` / `.metadata` are **sensitive, not restricted**. This is a CASA-free way to "log this email to the CRM" ([add-on scopes](https://developers.google.com/workspace/add-ons/concepts/workspace-scopes)).
- Needs a Marketplace listing. Review takes "several days", and OAuth must already be verified and In production ([Marketplace review](https://developers.google.com/workspace/marketplace/about-app-review)).
- Effort: 2–3 weeks.

**Chrome extension over Gmail**
- Needs no Gmail API scopes. Chrome Web Store review takes "a few days" up to "a few weeks", longer with broad host permissions ([CWS review](https://developer.chrome.com/docs/webstore/review-process)).
- Fragile because it depends on Gmail's DOM. Effort: 4–6 weeks.

### 2.4 Microsoft summary

- **(a) Approach:**
  - Outlook calendar sync plus Teams links, sharing one calendar abstraction with Google.
  - `Mail.Send` for "send as me".
  - OneDrive picker with `Files.Read`.
  - Contacts read-only.
  - An admin-consent onboarding step.
  - Publisher verification on day one.
  - Skip Teams chat.
- **(b) Effort:**
  - Calendar: 2–3 weeks on top of the Google work.
  - Mail.Send: under 1 week.
  - Picker: 1–2 weeks.
  - Mail read and sync: 3–4 weeks.
- **(c) Recurring cost:** $0, apart from metered Teams export if you ever use it.
- **(d) Gates:**
  - Publisher verification: days, mostly partner-account verification.
  - Tenant admin consent: per customer.
  - Marketplace: up to about 4 weeks, only for add-ins.
- **(e) Gotchas:**
  - Rich notifications last under a day for Outlook.
  - Personal Microsoft accounts get no Teams links.
  - The picker uses SharePoint tokens.
  - Some SMB Microsoft 365 via GoDaddy can't use Integrated apps or Marketplace add-ins ([publish](https://learn.microsoft.com/office/dev/add-ins/publish/publish)).

---

## 3. Build or buy calendar, email and contact sync

| Vendor | 2026 pricing | Covers | Whose OAuth client, and so who faces CASA |
|---|---|---|---|
| **Nylas** | Free (5 accounts). Essentials $15/mo (10 accounts, +$2.25). **Pro $49/mo** (25 accounts, **+$2.00/account**; calendar-only +$1.50; annual $43 and $1.75) ([pricing](https://nylas.com/pricing)) | Email, calendar, contacts, webhooks, availability, scheduler, notetaker | Own GCP project: **you** do verification and CASA. **Shared GCP App**: Nylas's Tier-3-assessed client, consent screen shows "Nylas", needs annual Pro + Accelerator add-on or Enterprise, price not published ([docs](https://developer.nylas.com/docs/provider-guides/google/shared-gcp-app/)) |
| **Cronofy** | **Emerging $819/mo** billed annually, up to 500 synced accounts, **+$1.39/account**. Growth $2,399/mo ([pricing](https://www.cronofy.com/pricing)) | Calendar only: two-way sync, availability, conferencing, HIPAA listed | Users authorize **Cronofy's** app ("your application is actually authorizing with Cronofy"), so no Google verification on your side ([docs](https://docs.cronofy.com/developers/authorization/individual-connect/)) |
| **Unipile** | €49 minimum up to 10 accounts, then €5→€3 per account by volume. Gmail and Google Calendar count as one account ([pricing](https://www.unipile.com/pricing-api/)) | Gmail, Outlook, IMAP, calendars, LinkedIn, WhatsApp | Docs say to register **your own** Google app ([docs](https://developer.unipile.com/v2.0/docs/google-oauth)). Marketing claims a shared, CASA Tier-2-certified key [2H: [Unipile blog](https://www.unipile.com/integrating-google-oauth-2-0-user-authentication-into-your-app/)]. **Get this in writing.** |
| **Aurinko** | $1–$2 per account per month by data volume; "BrightSync" $2–$4 per user ([pricing](https://www.aurinko.io/pricing/)) | Unified email, calendar, contacts, tasks | Not stated on the page; ask |
| **Nango** | Free (10 connections); $50/mo + **$0.29 per connection** ([pricing](https://www.nango.dev/pricing)) | Managed auth and token refresh, syncs you write | Offers "Nango-managed" pre-approved apps *or* your own. Restricted Gmail scopes likely need your own client; confirm |
| **Merge** | Launch: 3 accounts free, $650/mo up to 10, $65 each after ([pricing](https://www.merge.dev/pricing)) | Accounting, ATS, CRM, file storage, HRIS, ticketing; **no email or calendar listed** | Not useful for email or calendar. Too expensive per SMB tenant |

**The CASA question, precisely:**
- Google verifies and assesses the **Google Cloud project that owns the OAuth client shown on the consent screen**.
- If a vendor's client is on that screen (Nylas Shared App, Cronofy), the vendor carries CASA, and your users see the vendor's name.
- If you white-label with your own client ID, you carry CASA, even if every byte then flows through the vendor ([Nylas guide](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/)).
- Workspace user-data policy obligations still apply to you by contract.

**Recommendation for a 2–3 person team:**
- Build Google and Microsoft **calendar** directly. It is sensitive-only, and the cost at 200 connected accounts is $0 versus about $400/mo on Nylas or $819/mo on Cronofy.
- For **inbox sync**, use the **Nylas Shared GCP App** when customers demand it, rather than running CASA yourself.
- Nango only if you want token plumbing without sync logic; you still own verification.

---

## 4. Document storage on Supabase

**Access control and URLs**
- Storage uses RLS on `storage.objects`; uploads are denied until you add policies. Helpers such as `storage.foldername()` exist. **The service key bypasses RLS** ([access control](https://supabase.com/docs/guides/storage/security/access-control)).
- Clerk is a supported third-party auth provider, so RLS can read Clerk claims such as `org_id` for Storage as well. The old JWT-template integration was deprecated on 1 April 2025 ([Clerk + Supabase](https://supabase.com/docs/guides/auth/third-party/clerk)).
- Private buckets use `createSignedUrl` with an expiry in seconds. Signed URLs use a separate internal key that survives JWT rotation ([downloads](https://supabase.com/docs/guides/storage/serving/downloads)).

**Uploads and transforms**
- Resumable uploads use TUS with fixed 6 MB chunks. Use them above 6 MB. Upload URLs are valid for 24 hours. Use the `*.storage.supabase.co` direct hostname ([resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)).
- Image transformations are Pro and above only. Limits: 25 MB, 2500 px, 50 MP. 100 origin images are included, then $5 per 1,000 ([image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations)).

**Limits and pricing**
- Maximum file size: Free 50 MB; Pro and Team 500 GB ([file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)).
- Storage: Pro and Team include 100 GB, then **$0.0213 per GB-month** ([storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)).
- Egress: 250 GB uncached plus 250 GB cached included, then **$0.09 per GB uncached** and $0.03 per GB cached ([egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)).
- Plans: Pro $25/mo, Team $599/mo ([pricing](https://supabase.com/pricing)).

**Malware scanning: nothing native**
- A Supabase GitHub discussion confirms there is no built-in scanning and suggests edge functions or third-party services ([discussion #23645](https://github.com/orgs/supabase/discussions/23645)).

| Option | Notes |
|---|---|
| ClamAV on a small container worker | Pattern: upload to a `quarantine/` prefix → a webhook or queue triggers the worker → scan → move the file to the real path or delete it. Keep it off Vercel functions: signature updates and memory don't fit serverless well. Recommended |
| Cloudflare "malicious uploads detection" | **Enterprise add-on only**, scans the first 50 MB, flags but doesn't block ([Cloudflare](https://developers.cloudflare.com/waf/detections/malicious-uploads/)) |
| VirusTotal public API | Non-commercial only, 4 requests/min ([VirusTotal](https://docs.virustotal.com/docs/difference-public-private)). Unsuitable |
| AWS GuardDuty Malware Protection for S3 | $0.09/GB plus $0.215 per 1,000 objects ([pricing](https://aws.amazon.com/guardduty/pricing/)). Only for *your own* S3 buckets |
| Pangea File Scan | Still running under CrowdStrike after the September 2025 acquisition ([docs](https://pangea.cloud/docs/file-scan/check-for-malicious-files); [CrowdStrike](https://www.crowdstrike.com/en-us/press-releases/crowdstrike-to-acquire-pangea-to-secure-every-layer-of-enterprise-ai/)). Pricing not published |

### 4.1 HIPAA posture of each vendor (decides whether you can store PHI)

**Does HIPAA apply to your customers at all?** A provider is a covered entity only if it "transmits any health information in electronic form in connection with a transaction" covered by HIPAA. A vendor that stores PHI for one is a **business associate** ([45 CFR 160.103](https://www.law.cornell.edu/cfr/text/45/160.103)). Adult day care centers that bill Medicaid electronically usually qualify. Confirm per customer segment.

| Vendor | BAA? | Plan and cost |
|---|---|---|
| Supabase | Yes | **Team plan minimum** ($599/mo) plus the HIPAA add-on ([shared responsibility](https://supabase.com/docs/guides/deployment/shared-responsibility-model)). Add-on about **$350/mo** [2H: [GitHub discussion](https://github.com/orgs/supabase/discussions/35594)]. Required settings: PITR (needs a compute add-on), SSL enforcement, network restrictions, connection logging, MFA, no PHI in public buckets ([HIPAA projects](https://supabase.com/docs/guides/platform/hipaa-projects); [HIPAA compliance](https://supabase.com/docs/guides/security/hipaa-compliance)) |
| Vercel | Yes | **Pro add-on $350/mo**, self-serve; Enterprise via sales. Secure Compute is Enterprise-only ([compliance](https://vercel.com/docs/security/compliance); [pricing](https://vercel.com/pricing); [changelog 9 Sept 2025](https://vercel.com/changelog/hipaa-baas-are-now-available-to-pro-teams)) |
| Clerk | Enterprise only | Custom price ([security](https://clerk.com/security)). If Clerk holds only *staff* identities and no patient data or portal logins, you may be able to keep it out of PHI scope. Get a legal opinion |
| Telnyx | Relies on the "conduit exception" | "Generally… no need for Telnyx to sign a BAA", "happy to discuss" ([help](https://support.telnyx.com/en/articles/3347891-hipaa-baas-and-the-conduit-exception)). **Stored recordings, transcripts or AI features are not "conduit"**, so negotiate a BAA before storing them |
| Resend | **No** | "Not HIPAA compliant and cannot sign a BAA" ([security](https://resend.com/security)). Send "you have a secure message" links only, or add a BAA-capable email provider for PHI mail |
| OpenAI API | Yes | Email baa@openai.com. Case-by-case, reply in 1–2 business days, usually done in a few days, no enterprise agreement required ([help](https://help.openai.com/en/articles/8660679-how-can-i-get-a-business-associate-agreement-baa-with-openai)). Default: abuse-monitoring logs up to 30 days. **ZDR needs sales approval**. `/v1/assistants`, `threads` and `vector_stores` are not ZDR-eligible. Live web search is not HIPAA-eligible ([your data](https://developers.openai.com/api/docs/guides/your-data)) |
| Anthropic API | Yes | The Messages API is covered. **Batch API, Files API**, code execution and web fetch are not ([BAA](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers)) |

**Storage summary**
- **(a) Approach:**
  - Private buckets with keys like `{org_id}/{entity}/{record_id}/{uuid}`.
  - RLS keyed on Clerk `org_id`.
  - Signed URLs of 60–300 s.
  - TUS for large files.
  - A quarantine-then-promote flow with a ClamAV worker.
  - An immutable `documents` table (hash, uploader, scan verdict).
- **(b) Effort:** 2–3 weeks, plus 1 week for scanning.
- **(c) Recurring cost:**
  - Without PHI: about $25/mo plus usage.
  - With PHI: a floor of about **$1,300/mo** — Supabase Team $599 + about $350 add-on + PITR/compute [2H], plus Vercel $350 — and Clerk Enterprise if needed.
- **(d) Gates:** BAAs with Supabase, Vercel and OpenAI, plus Clerk and Telnyx if in scope, all **before the first PHI byte**.
- **(e) Gotchas:**
  - Service-key uploads bypass RLS.
  - Egress costs on previews.
  - Never put PHI in email (Resend) or in public buckets.

---

## 5. E-signature

**What makes a click-to-sign legally valid**
- ESIGN: a signature "may not be denied legal effect… solely because it is in electronic form" (§7001(a)).
- **Consumer consent** is needed only where a law requires written disclosure to a consumer. Then you need affirmative consent after a clear statement of: the right to paper, how to withdraw, the scope of consent, hardware and software needs, and a demonstration that the consumer can access the format (§7001(c)).
- **Retention:** records must accurately reflect the original, stay accessible and be reproducible (§7001(d)) ([15 USC 7001](https://www.law.cornell.edu/uscode/text/15/7001)).
- **Exclusions:** wills, family law, most of the UCC, court papers, notices of utility or insurance cancellation, foreclosure or eviction notices, recalls, hazardous-materials documents ([§7003](https://www.law.cornell.edu/uscode/text/15/7003)).
- Texas UETA (Bus. & Com. Code ch. 322) ([statute](https://statutes.capitol.texas.gov/Docs/BC/htm/BC.322.htm)):
  - "Electronic signature" = "an electronic sound, symbol, or process attached to or logically associated with a record and executed or adopted by a person **with the intent to sign**" (§322.002(8)).
  - Applies only where both parties "agreed to conduct transactions by electronic means", which can be inferred "from the context… including the parties' conduct" (§322.005(b)).
  - Legal equivalence (§322.007).
  - Attribution: "the act of the person… shown in any manner, including… any **security procedure**" (§322.009).
  - Retention: "accurately reflects" and "remains accessible" (§322.012).
  - Excludes wills and most of the UCC (§322.003).

**The five elements to implement in a homegrown click-to-sign**
1. **Intent:** an explicit "Sign" action with the typed name and the adoption statement shown.
2. **Consent to do business electronically:** a versioned disclosure checkbox, stored with the text version.
3. **Association:** a SHA-256 hash of the exact rendered PDF, bound to the signature event.
4. **Attribution:** email or SMS one-time code sent to the signer, plus IP, user agent and timestamps.
5. **Retention and audit:** an append-only audit table, the final PDF with a certificate page in a no-update/no-delete bucket, and a copy delivered to the signer. **Don't deliver PHI forms through Resend.**

| Buy option | 2026 price |
|---|---|
| **BoldSign API** | From **$30/mo incl. 40 envelopes, $0.75 per envelope** after; HIPAA/BAA mentioned ([BoldSign API](https://boldsign.com/esignature-api/)) |
| **SignWell API** | Up to 25 free API documents/mo, then **$0.85 → $0.20 per document** by volume ([API](https://www.signwell.com/api/)); BAA on paid plans ([pricing](https://www.signwell.com/pricing/)) |
| **DocuSeal** | **$0.20 per document** via API or embed; AGPL self-host free; Pro $20/user/mo ([pricing](https://www.docuseal.com/pricing)) |
| **Documenso** (open source) | Platform $250/mo, unlimited documents, embedded white-label; Teams $40/mo ([pricing](https://documenso.com/pricing)) |
| **Dropbox Sign API** | Essentials $75/mo (50 requests), Standard $250/mo (100); HIPAA BAA via sales; white-label Premium only ([pricing](https://sign.dropbox.com/products/dropbox-sign-api/pricing)) |
| **DocuSign developer** | Starter $50/mo (40 envelopes/mo), Intermediate $300/mo (100/mo), Advanced $480/mo ([pricing](https://ecom.docusign.com/plans-and-pricing/developer)) |

- **(a) Approach:** For non-PHI documents (quotes, service agreements), build an in-house single-signer click-to-sign. For PHI intake or consent packets and multi-party signing, embed **BoldSign or SignWell**, which have a BAA and low per-envelope cost. DocuSeal's AGPL self-host is an option if you accept AGPL obligations.
- **(b) Effort:** in-house 3–5 weeks; vendor embed 1–2 weeks.
- **(c) Recurring cost:** $0.20–$0.85 per envelope.
- **(d) Gates:** a legal review of the disclosure text. No certification is needed.
- **(e) Gotchas:** healthcare consent forms may have state-specific rules; audit-trail completeness is what wins disputes.

---

## 6. Payments and accounting

**Stripe (US)** ([pricing](https://stripe.com/pricing))
- Cards: 2.9% + 30¢; +1.5% international; +1% currency conversion.
- In person: 2.7% + 5¢; **Tap to Pay +$0.10 per authorization**.
- **ACH Direct Debit 0.8%, capped at $5**. Instant bank payments 2.6% + 30¢.
- **Invoicing 0.4% per paid invoice** (Starter). Payment Links carry no extra fee. Disputes $15. Billing 0.7%.

**Stripe Connect** ([Connect pricing](https://stripe.com/connect/pricing))
- "Stripe handles pricing": **no platform fees**.
- "You handle pricing": **$2 per monthly active account** plus 0.25% + 25¢ per payout.
- The SaaS guide uses Accounts v2. In the Stripe-owned pricing model, merchants are merchant of record, pay Stripe fees, carry negative-balance liability and use **direct charges**. The platform earns subscriptions, application fees or revenue share ([Connect for SaaS](https://docs.stripe.com/connect/saas)).
- Tap to Pay has **iPhone and Android variants only**, so it needs a native app ([Tap to Pay](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay)).

**QuickBooks Online**
- Production keys require the **app assessment questionnaire**, legal, technical and security, whether or not the app is listed [2H via Intuit help-center search snippet: [FAQ](https://help.developer.intuit.com/s/article/New-app-assessment-process-FAQ)]. It takes about an hour.
- Listing in the QuickBooks App Store adds a security review of 6 weeks to 6+ months [2H].
- Intuit App Partner Program fees ([platform fees](https://help.developer.intuit.com/s/article/platform-service-fees)):
  - **Builder $0** with 500k CorePlus (read) credits per month; calls are **blocked** at the limit.
  - Silver $300/mo with 1M credits, then $3.50 per 1k.
  - Gold $1,700/mo.
  - Platinum $4,500/mo [2H: [Apideck](https://www.apideck.com/blog/quickbooks-api-pricing-and-the-intuit-app-partner-program)].
- **Core (write) calls are free and unlimited.** So design a **push-only sync**: CRM → QBO Customers, Invoices, Payments and Items, with minimal reads.

**Payments summary**
- **(a) Approach:** Stripe Connect with the Stripe-owned pricing model, embedded onboarding, Payment Links and Invoices, and ACH for large tickets. Then a QuickBooks push sync.
- **(b) Effort:** Stripe 2–4 weeks; QuickBooks 3–4 weeks.
- **(c) Recurring cost:** $0 platform cost with the Stripe-owned model; QuickBooks $0 on Builder.
- **(d) Gates:** the Intuit questionnaire before production; Stripe handles merchant identity checks (KYC).
- **(e) Gotchas:** Tap to Pay needs native apps; QuickBooks reads are metered; don't use Merge Accounting at $65 per account.

---

## 7. AI document features

**Extraction models**

| Option | Price |
|---|---|
| OpenAI | `gpt-6-luna` $0.10 in / $0.50 out per 1M tokens; `gpt-6-sol` $2/$10; `gpt-6-astra` $10/$50; Batch and Flex 50% off ([pricing](https://developers.openai.com/api/docs/pricing)). Structured Outputs with `strict: true` guarantee schema adherence ([structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)) |
| Anthropic | Haiku 4.5 $1/$5; Sonnet 5 $2/$10; Batch 50% off ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). `output_config.format` JSON schema by constrained decoding, usable for image extraction ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)) |
| Google Document AI | Enterprise OCR **$1.50 per 1k pages** (first 1k free); Form Parser and Custom Extractor **$30 per 1k**; Layout Parser $10 per 1k ([pricing](https://cloud.google.com/document-ai/pricing)) |
| Azure Document Intelligence | Read $1.50 per 1k pages; custom extraction $30 per 1k; batch prebuilt $10 per 1k; 500 free pages/mo; includes a prebuilt health-insurance-card model ([pricing](https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/)) |

**MCP server (use the CRM from Claude or ChatGPT)**
- The MCP authorization spec (2025-11-25) requires:
  - OAuth 2.1 with **Protected Resource Metadata** (RFC 9728).
  - PKCE with S256.
  - The RFC 8707 `resource` parameter.
  - Token **audience validation**, and no token passthrough.
- Client ID Metadata Documents are a SHOULD; Dynamic Client Registration is a MAY ([spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)).
- **Clerk supports this directly in Next.js:** `mcp-handler` + `@clerk/mcp-tools`, `protectedResourceHandlerClerk`, `verifyClerkToken`, and optional DCR ([Clerk guide](https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server)).
- **Distribution:**
  - Claude custom connectors work on Free (one connector), Pro, Max, Team and Enterprise; on Team and Enterprise only Owners add them ([Claude help](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)).
  - ChatGPT directory submission needs a public HTTPS endpoint, a verified organization, privacy and terms URLs, and demo credentials without MFA ([OpenAI submission](https://developers.openai.com/apps-sdk/deploy/submission)).
- **CRMs that already ship one:**
  - HubSpot remote MCP, GA **13 April 2026** at mcp.hubspot.com, OAuth 2.1 + PKCE ([changelog](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available)).
  - Pipedrive native MCP, launched **30 June 2026**, all plans ([newsroom](https://www.pipedrive.com/en/newsroom/pipedrive-launches-native-mcp-server-bringing-crm-workflows-directly-into-ai-assistants)).
  - monday.com Platform MCP ([docs](https://developer.monday.com/api-reference/docs/mondaycom-mcp)).
  - Salesforce Hosted MCP servers, GA April 2026, Enterprise Edition and up [2H: [blog](https://developer.salesforce.com/blogs/2026/04/salesforce-hosted-mcp-servers-are-now-generally-available)].
  - Attio official MCP [2H].
  - Having one is now standard for a CRM.

**AI summary**
- **(a) Approach:** extraction with `gpt-6-luna` or `gpt-6-sol` plus strict Structured Outputs, a confidence and review screen, and Azure's insurance-card model as a fallback. An MCP server with Clerk OAuth, read tools first, and writes behind confirmation.
- **(b) Effort:** extraction 2–3 weeks; MCP 2–3 weeks plus about 1 week for directory submission.
- **(c) Recurring cost:** fractions of a cent to about a cent per document (my estimate).
- **(d) Gates:** a BAA before any PHI; for Anthropic, send documents inline because the Files API is not BAA-covered.
- **(e) Gotchas:** for HIPAA tenants, disable the MCP server or warn them — once the customer connects it, PHI flows to Claude or ChatGPT under the customer's own agreement.

---

## 8. Recommended order

1. **Now, with no external gates:**
   - Stripe Connect payments, invoices and ACH.
   - Supabase document storage with RLS and scanning (no PHI yet).
   - Inbound email logging via a per-tenant BCC or forwarding address on Resend Inbound ([Resend receiving](https://resend.com/docs/dashboard/receiving/introduction)). This gives an "email log" with no restricted scopes.
2. **Weeks 1–6:**
   - One Google verification submission covering `calendar.events`, `calendar.freebusy`, `gmail.send`, `contacts`, plus `drive.file` with the Picker.
   - In parallel: Microsoft publisher verification, then Outlook calendar, Teams links, Mail.Send and the OneDrive picker, with an admin-consent onboarding step.
   - This covers roughly 80% of SMB value with **no CASA and no fees**.
3. **Weeks 6–12:**
   - E-signature: in-house for non-PHI, BoldSign or SignWell for PHI.
   - QuickBooks push-only sync (Builder tier).
   - AI document extraction.
   - MCP server.
   - Submit the GBP API application early; its lead time is unknown.
4. **Only when customers demand inbox sync:** use the Nylas Shared GCP App (it carries CASA, but shows "Nylas" branding), or run your own CASA at about $540–$4.5k+ a year plus weeks to months. Gmail add-on or Outlook add-in sidebars after that; the Gmail add-on's contextual scopes avoid CASA.
5. **HIPAA track:** decide per segment before the first PHI byte. Sign BAAs with Supabase Team, Vercel and OpenAI, and resolve Clerk, Telnyx and Resend. Budget at least about $1.3k/month.
