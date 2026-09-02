export const m = {
  // The sidebar's mono uppercase group headers (DESIGN.md's grouped-nav
  // pattern). Text-cased in CSS, not here — these strings stay plain so a
  // screen reader announces them as words, not letter-by-letter.
  "nav.group.overview": "Overview",
  "nav.group.crm": "CRM",
  "nav.group.communications": "Communications",
  "nav.group.growth": "Growth",
  "nav.dashboard": "Dashboard",
  "nav.contacts": "Contacts",
  "nav.opportunities": "Opportunities",
  "nav.conversations": "Conversations",
  "nav.calls": "Calls",
  "nav.calendar": "Calendar",
  "nav.forms": "Forms",
  "nav.settings": "Settings",
  "nav.branding": "Branding",
  "nav.voice": "Voice",
  "nav.setup": "Setup",
  "nav.accounts": "Companies",
  "nav.blueprints": "Blueprints",

  "shell.brand": "BIS",
  "shell.switchAccount": "Switch company",
  "shell.searchAccounts": "Search companies…",
  "shell.noAccounts": "No companies yet",
  "shell.search": "Search",
  "shell.collapse": "Collapse sidebar",
  "shell.expand": "Expand sidebar",
  "shell.backToAgency": "Back to companies",
  // Topbar's AI presence indicator (DESIGN.md "AI presence" key pattern).
  // The dot itself is a separate aria-hidden element (topbar-presence.tsx);
  // this string carries the meaning on its own per DESIGN.md's status rule
  // ("never color alone — dot + word"). "{count}" is the house {placeholder}
  // convention (see setup.progress above) — the ✓ ships as plain text, not a
  // separate icon element, since idle carries no color-only signal to back up.
  "shell.presence.onCall": "Sofía · on a call",
  "shell.presence.idle": "✓ {count} calls handled this week",
  // Singular pair: "✓ 1 calls" is a real state for exactly the young voice
  // accounts that get demoed. "handled" restores DESIGN.md's own wording.
  "shell.presence.idleOne": "✓ 1 call handled this week",

  "landing.title": "BIS Platform",
  "landing.tagline": "The all-in-one client platform by Bespoke Intelligent Solutions.",
  "landing.signIn": "Sign in",
  "landing.goToDashboard": "Go to dashboard",
  "landing.signOut": "Sign out",
  "landing.noAccess.title": "No access yet",
  "landing.noAccess.body": "This account isn't set up as an agency admin. Sign out to try a different account, or contact your BIS administrator.",

  "clientAccess.off.title": "Access has been turned off",
  "clientAccess.off.body": "Your access to this account has been turned off. Contact your account manager if you think this is a mistake.",
  "clientAccess.none.title": "No account linked",
  "clientAccess.none.body": "Your sign-in isn't linked to a company account yet. Contact your account manager.",

  "clientAccess.title": "Client access",
  "clientAccess.body": "When on, invited users at this company can sign in and see this account only.",
  "clientAccess.enable": "Turn on",
  "clientAccess.disable": "Turn off",
  "clientAccess.members": "Members",
  "clientAccess.invite": "Invite",
  "clientAccess.inviteEmail": "Email address",
  "clientAccess.inviteSent": "Invitation sent",
  "clientAccess.invitePending": "Invited",
  "clientAccess.inviteFailed": "Could not send the invitation",
  "clientAccess.disabledHint": "Turn client access on before inviting anyone.",
  "clientAccess.membersUnavailable": "Member list unavailable right now — the switch above still works.",

  "branding.title": "Branding",
  // The client-facing SET. Every string the panel shows that names whose
  // brand it is needs one of these, not just the heading and body: the agency
  // wording is written for someone looking at a company that is not theirs
  // ("this company's users", "their sidebar"), which reads wrong — and in the
  // case of nameHint discloses a concept only the agency has — on the
  // company's own page. Pair them in panel-copy.ts; a hint added to one
  // audience and forgotten on the other is a failing test there.
  "branding.clientTitle": "Your branding",
  "branding.clientBody": "What your team sees in this workspace, and what your customers see on your lead forms.",
  "branding.clientNameHint": "What your own customers see on your lead forms and in this workspace.",
  "branding.clientColorHint": "Used for buttons and highlights on your lead forms and in this sidebar. Leave blank for the default.",
  "branding.clientNeutralHint": "The greys behind your content. Warm leans beige, cool leans blue, slate is neutral.",
  "branding.clientModeHint": "What your team sees on a first visit. Each person can still switch it.",
  "branding.clientModeFollow": "Follow the device",
  "branding.replyTo": "Reply-to address",
  "branding.replyToHint": "Where replies land when this company emails a contact, and when they reply to one of their own lead alerts. Leave blank and those replies come to the BIS mailbox instead.",
  "branding.clientReplyToHint": "Where replies land when you email a contact, and when you reply to one of your lead alerts. Leave blank and those replies come to us instead of you.",
  "branding.badReplyTo": "Enter an email address, like hello@yourcompany.com.",
  "checklist.reply_to.title": "Set a reply-to address",
  "checklist.reply_to.help": "In this company's Branding, add the address their replies should reach, and do it before setting a sending address. Until it is set, a reply lands wherever the mail came from: the BIS mailbox while they still send from the platform address, and their own sending domain once one is set — which for the send-only subdomain recommended above usually has no mailbox at all, so the reply bounces or vanishes.",
  "branding.body": "Shown to this company's users in place of the BIS name and mark, and on their public lead forms.",
  "branding.name": "Display name",
  "branding.nameHint": "What this company's own customers see. Your internal name for them stays private.",
  "branding.logo": "Logo",
  "branding.logoHint": "PNG, JPEG or WebP, up to 512 KB.",
  "branding.upload": "Upload",
  "branding.saved": "Branding updated",
  "branding.saveFailed": "Could not update branding",
  "branding.badFormat": "That file isn't a PNG, JPEG or WebP.",
  "branding.tooLarge": "That file is larger than 512 KB.",
  "branding.noLogo": "No logo set",
  "branding.currentLogo": "Current logo",
  "branding.color": "Brand color",
  "branding.colorHint": "Used for buttons and highlights on their lead forms and in their sidebar. Leave blank for the default.",
  "branding.badColor": "Enter a color as a hex code, like #0f766e.",
  "branding.colorPreview": "Preview",
  "branding.previewSubmit": "Submit",
  "branding.previewSidebar": "Sidebar",
  "branding.neutral": "Surfaces",
  "branding.neutralHint": "The greys behind their content. Warm leans beige, cool leans blue, slate is neutral.",
  "branding.neutralWarm": "Warm",
  "branding.neutralCool": "Cool",
  "branding.neutralSlate": "Slate",
  "branding.corners": "Corners",
  "branding.cornersSharp": "Sharp",
  "branding.cornersSoft": "Soft",
  "branding.cornersRound": "Round",
  "branding.type": "Typeface",
  "branding.typeGeist": "Geist",
  "branding.typeInter": "Inter",
  "branding.typeSerif": "Serif",
  "branding.mode": "Default appearance",
  "branding.modeHint": "What their staff see on a first visit. They can still switch it themselves.",
  "branding.modeLight": "Light",
  "branding.modeDark": "Dark",
  "branding.modeFollow": "Follow their device",
  "branding.badTheme": "Pick one of the offered options.",
  "branding.themeDefault": "Default",
  "branding.previewHeading": "Recent activity",
  "branding.previewBody": "Maria Garcia · updated 2 hours ago",
  "branding.previewLight": "Light",
  "branding.previewDark": "Dark",

  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.undo": "Undo",
  "common.retry": "Retry",
  "common.add": "Add",
  "common.import": "Import",
  "common.filters": "Filters",
  "common.sort": "Sort",
  "common.none": "—",
  "common.saving": "Saving…",
  "common.actionCrashed": "That didn't go through — this page may be out of date. Reload it and try again.",
  "common.unavailable": "—",
  // The period caption on a StatTile (Task 4) when the metric covers the
  // whole account history rather than a rolling window — shared verbatim
  // across the agency and in-account dashboards, so one key, not two.
  "common.allTime": "All time",

  // StatTile's delta chip (Task 4, DESIGN.md rule 1: every metric ships
  // with context). The visible chip is glyph + `delta.label` ("▲ 12%");
  // this is the chip's `aria-label`, spelling the direction out in words
  // so the glyph is never the only carrier of the up/down/flat meaning.
  // "{value}" is the house {placeholder} convention (see setup.progress
  // above) — `deltaVsPrior`'s own `label` field (a percent or a raw count).
  "stat.delta.up": "up {value} vs the prior period",
  "stat.delta.down": "down {value} vs the prior period",
  "stat.delta.flat": "flat vs the prior period",

  // InlineField component (Task 4): click-to-edit for contact fields.
  // "{label}" is the field name (e.g., "Email"); the component .replace()s it.
  "inline.saved": "{label} saved",
  "inline.edit": "Edit {label}",
  "inline.empty": "Add…",
  "inline.crashed": "Save didn't go through — the page may be out of date. Reload and try again.",

  "accounts.title": "Companies",
  "accounts.add": "Add company",
  "accounts.name": "Business name",
  "accounts.timezone": "Timezone",
  "accounts.empty.title": "No companies yet",
  "accounts.empty.body": "Add your first company to start tracking contacts and deals.",
  "accounts.created": "Added {date}",
  "accounts.createFailed": "Could not create that company. Check the name and try again.",
  "accounts.status.active": "Active",
  "accounts.status.paused": "Paused",
  "accounts.status.archived": "Archived",
  "accounts.blueprint": "Apply a blueprint",
  "accounts.blueprintNone": "Don't apply one",
  "accounts.blueprintHint": "Copies configuration into the new company. You can apply one later instead.",
  "accounts.blueprintPartial": "The company was created, but some blueprint items did not apply. Check its Settings and add anything missing by hand.",

  "dashboard.title": "Dashboard",
  "dashboard.companies": "Companies",
  "dashboard.contacts": "Contacts",
  "dashboard.openOpps": "Open opportunities",
  "dashboard.pipelineValue": "Pipeline value",

  "account.contacts": "Contacts",
  "account.openOpps": "Open opportunities",
  "account.pipelineValue": "Pipeline value",

  // The in-account dashboard's greeting header (Task 5), both audiences.
  // "{name}" is the house {placeholder} convention (see contacts.page) — the
  // component .replace()s it with the account's own name. Time-of-day comes
  // from `greetingPeriod` (lib/dashboard/greeting.ts), read from the
  // ACCOUNT's timezone, never the viewer's.
  "dashboard.greeting.morning": "Good morning, {name}",
  "dashboard.greeting.afternoon": "Good afternoon, {name}",
  "dashboard.greeting.evening": "Good evening, {name}",
  // Sub-line, appended only when the account has an ENABLED voice profile —
  // never a blanket claim about what the receptionist did (that isn't
  // honestly derivable this phase; see the task brief).
  "dashboard.sub.voice": "Sofía is answering your calls.",

  // The KPI row (Task 5): rolling 7-local-day metrics, each with a delta vs
  // the prior 7 days and (except after-hours) a 14-day sparkline — DESIGN.md
  // rule 1's context requirement, carried by the delta/spark themselves, so
  // none of these four need a `period` caption the way the "All time" row
  // below them does.
  "dashboard.kpi.callsAnswered": "Calls answered",
  "dashboard.kpi.appointmentsBooked": "Appointments booked",
  "dashboard.kpi.afterHoursCaptured": "After-hours captured",
  "dashboard.kpi.pipelineAdded": "Pipeline added",

  // The 14-day calls chart card (Task 6) — CSS bars, hover tooltip on every
  // mark (DESIGN.md's chart section), a recent-calls mini table beneath it.
  // "{date}"/"{count}"/"{unit}" are the house {placeholder} convention (see
  // contacts.page above); the component .replace()s them, and picks "{unit}"
  // itself (call vs calls) the same way shell.presence.idleOne pins its own
  // singular case.
  "dashboard.calls.title": "Calls",
  "dashboard.calls.caption": "Last 14 days",
  "dashboard.calls.axis.weekendsMuted": "Weekends muted",
  "dashboard.calls.axis.today": "Today",
  "dashboard.calls.tooltip": "{date} · {count} {unit}",
  "dashboard.calls.tooltipSr": "{date}, {count} {unit}",
  "dashboard.calls.unit.call": "call",
  "dashboard.calls.unit.calls": "calls",
  // Rule 5 (designed empty states): one sentence, verbatim from the brief.
  "dashboard.calls.empty": "When Sofía answers, every call lands here with its outcome.",
  "dashboard.calls.emptySetupVoice": "Set up your voice receptionist",
  "dashboard.calls.emptyViewCalls": "View all calls",

  // The activity feed card (Task 7) — the events ledger's first READ
  // consumer. Each `dashboard.activity.*` line is a CURATED, generic
  // summary for a small set of known `events.type` values (never the raw
  // type string — DESIGN.md's "never expose internal codes"); see
  // activity-card.tsx's own curation-map comment for the grep-verified
  // inventory of what a real account can emit and why everything else is
  // skipped silently. "{outcome}" is the house {placeholder} convention,
  // filled from `OUTCOMES[outcome].label` (calls/format.ts) — itself
  // already m[]-sourced, so no raw enum value ever reaches this string.
  "dashboard.activity.title": "Activity",
  "dashboard.activity.caption": "Recent",
  "dashboard.activity.bookingCreated": "A new appointment was booked.",
  "dashboard.activity.bookingCancelled": "An appointment was cancelled.",
  "dashboard.activity.bookingCompleted": "An appointment was completed.",
  "dashboard.activity.bookingNoShow": "An appointment was marked as a no-show.",
  "dashboard.activity.formSubmitted": "A new lead came in through your form.",
  "dashboard.activity.callRecorded": "Call outcome: {outcome}.",
  // Rule 5 (designed empty states): one sentence, verbatim from the brief.
  // No action link — the brief pins this one deliberately link-less.
  "dashboard.activity.empty": "Bookings, form leads, and call outcomes appear here as they happen.",

  "contacts.title": "Contacts",
  "contacts.add": "Add contact",
  "contacts.search": "Search name, email, phone…",
  "contacts.col.name": "Contact name",
  "contacts.col.phone": "Phone",
  "contacts.col.email": "Email",
  "contacts.col.company": "Business name",
  "contacts.col.created": "Created",
  "contacts.empty.title": "No contacts yet",
  "contacts.empty.body": "Add a contact or import a list to get started.",
  "contacts.noMatches.title": "No matches",
  "contacts.noMatches.body": "Try a different name, email, or phone number.",
  "contacts.firstName": "First name",
  "contacts.lastName": "Last name",
  "contacts.email": "Email",
  "contacts.phone": "Phone",
  "contacts.page": "Page {current} of {total}",
  "contacts.createFailed": "Could not add that contact. Check the details and try again.",
  "common.prev": "Prev",
  "common.next": "Next",

  // The contacts table's bulk-action bar (DESIGN.md rule 4 — checkboxes
  // never render without bulk actions). "{count}"/"{tag}"/"{skipped}" are
  // the house {placeholder} convention (see contacts.page above).
  "bulk.selectPage": "Select all on this page",
  "bulk.selected": "{count} selected",
  "bulk.addTag": "Add tag",
  "bulk.delete": "Delete…",
  "bulk.clear": "Clear selection",
  "bulk.confirmTitle": "Delete {count} contacts?",
  "bulk.confirmBody": "This can't be undone. Type {count} to confirm.",
  "bulk.tagged": "Tagged {count} contacts with \"{tag}\"",
  "bulk.deleted": "Deleted {count} contacts",
  "bulk.deletedSkipped": "Deleted {count} · skipped {skipped} linked to bookings, deals, or conversations",

  "pipeline.title": "Opportunities",
  "pipeline.add": "Add opportunity",
  "pipeline.moveFailed": "Could not move that opportunity. Refresh and try again.",
  "pipeline.updateFailed": "Could not save that opportunity. Try again.",
  "pipeline.createFailed": "Could not add that opportunity. Check the details and try again.",
  "pipeline.empty.title": "No opportunities yet",
  "pipeline.empty.body": "Add your first deal to start tracking the pipeline.",
  "pipeline.name": "Opportunity name",
  "pipeline.value": "Value",
  "pipeline.contact": "Contact",
  "pipeline.status": "Status",
  "pipeline.status.open": "Open",
  "pipeline.status.won": "Won",
  "pipeline.status.lost": "Lost",

  "contact.details": "Contact Details",
  "contact.tags": "Tags",
  "contact.addTag": "add tag",
  "contact.clearField": "—",
  "contact.removeTag": "Remove {name}",
  "contact.opportunities": "Opportunities",
  "contact.activity": "Activity",
  "contact.notes": "Notes",
  "contact.tasks": "Tasks",
  "contact.addNote": "Add a note…",
  "contact.addTask": "New task…",
  "contact.done": "done",
  "contact.company": "Company",
  "contact.noActivity": "No activity yet",
  "contact.noActivityBody": "Notes, tasks, and deals will appear here.",
  "contact.noOpportunities": "None yet.",
  "contact.noName": "(no name)",

  // The contact drawer's recent-activity feed (Task 2's summary route,
  // Task 6's drawer). "{outcome}"/"{name}"/"{value}" are the house
  // {placeholder} convention (see contacts.page above) — the route
  // .replace()s them before the string ever reaches the client.
  "drawer.recent.call": "Call — {outcome}",
  "drawer.recent.note": "Note added",
  "drawer.recent.submission": "Form submitted",
  "drawer.recent.message": "Message",
  "drawer.recent.opportunity": "Opportunity: {name} ({value})",

  // The drawer's own chrome (Task 6): skeleton/error states and the
  // recent-activity section heading/empty copy.
  "drawer.recent": "Recent",
  "drawer.recentEmpty": "Nothing here yet — calls, notes, and form submissions for this contact will show up here.",
  "drawer.loadFailed": "Couldn't load this contact's activity.",
  "drawer.openFull": "Open full page",

  "settings.title": "Settings",
  "settings.customFields": "Custom fields",
  "settings.customFieldsBody": "Extra fields captured on every contact.",
  "settings.customValues": "Custom values",
  "settings.customValuesBody": "Template variables, referenced as {{custom_values.key}} from M1c on.",
  "settings.fieldName": "Field name",
  "settings.fieldKey": "field_key",
  "settings.dataType": "Type",
  "settings.dataType.text": "Text",
  "settings.dataType.number": "Number",
  "settings.dataType.date": "Date",
  "settings.dataType.checkbox": "Checkbox",
  "settings.dataType.singleSelect": "Single select",
  "settings.options": "Options, comma, separated",
  "settings.addField": "Add field",
  "settings.valueName": "Name",
  "settings.valueKey": "value_key",
  "settings.value": "Value",
  "settings.saveValue": "Save value",
  "settings.noFields": "No custom fields yet",
  "settings.noValues": "No custom values yet",
  // The CARD's heading, deliberately not the field's. Both used to read
  // "Sending address", which put the same words on screen twice, stacked —
  // the duplication branding-panel.tsx was changed to avoid. The field keeps
  // the precise name (two e2e specs address it by that accessible label);
  // the card gets the broader one.
  "settings.sendingIdentity": "Outgoing email",
  "settings.sendingAddress": "Sending address",
  "settings.sendingAddressBody": "The address this company's email to their customers goes out from. Verify the domain in Resend and add its DNS records first — setting an address sends a test message and fails if the domain is not verified. Clearing it has no such check. Set the reply-to address in Branding first: without one, a customer's reply goes to this sending address, and a send-only subdomain usually cannot receive mail.",
  "settings.sendingAddressPlaceholder": "leads@theircompany.com",
  "settings.sendingAddressDefault": "Using the platform address (crm@bis-rgv.com).",
  "settings.sendingAddressSaved": "Sending address updated",
  "settings.sendingAddressBad": "Enter an email address, like leads@theircompany.com.",
  // Last resort only. The whole point of the card's error path is that the
  // provider's own wording reaches the operator — this covers a throw that
  // carried no message at all.
  "settings.sendingAddressSaveFailed": "Could not save the sending address. Try again.",

  "error.title": "Something went wrong",
  "error.body": "We couldn't complete that action. Your changes may not have been saved.",
  "error.retry": "Try again",

  "notFound.title": "Page not found",
  "notFound.body": "That page doesn't exist or may have moved.",
  "notFound.back": "Back to dashboard",

  "theme.toggle": "Toggle light and dark mode",
  "pipeline.dropHere": "Drop an opportunity here",

  "compose.note": "Note",
  "compose.email": "Email",
  "compose.subject": "Subject",
  "compose.emailPlaceholder": "Write an email…",
  "compose.send": "Send",
  "compose.sending": "Sending…",
  "compose.sent": "Email sent.",
  "compose.sendFailed": "Could not send that email. It is saved as failed in the thread.",
  "compose.sendRejected": "Could not send that email. Check the contact has an email address.",
  "compose.noteFailed": "Could not save that note. Try again.",
  "compose.noEmailOnContact": "This contact has no email address.",

  "conversations.empty.title": "No conversations yet",
  "conversations.empty.body": "Email a contact from their timeline and the thread will appear here.",
  "conversations.pickThread": "Select a conversation to read it.",
  "conversations.status.queued": "Queued",
  "conversations.status.sent": "Sent",
  "conversations.status.delivered": "Delivered",
  "conversations.status.opened": "Opened",
  "conversations.status.bounced": "Bounced",
  "conversations.status.failed": "Failed",

  "forms.title": "Forms",
  "forms.add": "New form",
  "forms.name": "Form name",
  "forms.empty.title": "No forms yet",
  // "your website", not "the client's": Forms is one of the six items in a
  // CLIENT's own sidebar, so the agency's word for them was being read by
  // them. Second person is already this shell's in-account voice — see
  // "pipeline.empty.body" ("your first deal"), which the agency also reads
  // from inside a company's workspace.
  "forms.empty.body": "Build a form, embed it on your website, and leads land here automatically.",
  "forms.submissions": "Submissions",
  "forms.status.draft": "Draft",
  "forms.status.published": "Published",
  "forms.status.archived": "Archived",
  "forms.fields": "Fields",
  "forms.addField": "Add field",
  "forms.fieldLabel": "Label",
  "forms.fieldRequired": "Required",
  "forms.moveUp": "Move up",
  "forms.moveDown": "Move down",
  "forms.removeField": "Remove field",
  "forms.noFields": "Add at least one field before publishing.",
  "forms.settings": "Settings",
  "forms.locale": "Language",
  "forms.notifyEmails": "Notify these addresses",
  "forms.notifyHint": "Comma-separated. Leave blank for no email notification.",
  "forms.successMode": "After submitting",
  "forms.successModeMessage": "Show a message",
  "forms.successModeRedirect": "Redirect to a URL",
  "forms.successMessage": "Success message",
  "forms.redirectUrl": "Redirect URL",
  "forms.transparent": "Transparent background",
  "forms.status": "Status",
  "forms.duplicateFieldKey": "A field with this key already exists on the form.",
  "forms.invalidFields": "Fields must be valid: each needs a key, kind, label, and required flag.",
  "forms.embed": "Embed",
  "forms.embedHint": "Paste this where the form should appear. Published forms only.",
  "forms.embedNotPublished": "Publish the form to get its embed snippet.",
  "forms.copy": "Copy",
  "forms.copied": "Copied",
  "forms.publicLink": "Direct link",
  "forms.saved": "Saved",
  "forms.saveFailed": "Could not save the form.",
  "forms.noSubmissions": "No submissions yet.",
  // Deliberately NOT "Blocked": rate-limit hoisting means one recorded marker
  // suppresses further markers for the rest of the window, so a count of these
  // rows is a count of events recorded, not attempts made — a burst of 10,000
  // requests from one IP can surface as ~6 rows. Never present this as a total
  // of blocked attempts; that would understate spam volume to the operator.
  "forms.blocked": "Blocked event",
  "forms.spamReason.honeypot": "Hidden field was filled in — a sign of an automated submission.",
  // The stored enum value is "too_fast", but the same reason is also recorded
  // for a missing, malformed, or forged render token (see submitFormAction in
  // apps/web/src/app/f/[publicId]/actions.ts) — a real person just filling
  // the form quickly is only one of the three causes, so the copy has to
  // cover all of them honestly rather than naming only the first.
  "forms.spamReason.too_fast": "Submitted too quickly, or with a missing or invalid form token, to have been filled out by a person.",
  "forms.spamReason.rate_limited": "Too many submissions from this source in a short time.",
  "forms.needsAttention": "Needs attention",
  // Every submission stores the exact consent copy so it can be proved later.
  // That is only true if somebody can read it back — see submissions-table.tsx.
  "forms.consentGiven": "Agreed",
  "forms.consentNotGiven": "Not agreed",
  "forms.contact": "Contact",
  "forms.kind.core.first_name": "First name",
  "forms.kind.core.last_name": "Last name",
  "forms.kind.core.email": "Email",
  "forms.kind.core.phone": "Phone",
  "forms.kind.core.company_name": "Company",
  "forms.kind.message": "Message (starts a conversation)",
  "forms.kind.consent": "Consent checkbox",
  "forms.invalidRedirectUrl": "Redirect URL must start with http:// or https://.",

  "conversations.unread": "unread",
  "conversations.channel.form": "Form submission",
  "conversations.channel.email": "Email",
  "conversations.channel.note": "Note",
  "contact.emailSent": "Email sent",
  "contact.emailReceived": "Email received",
  "contact.formSubmission": "Form submission",

  // Every item but form_notify happens outside the platform. The help text
  // must say so plainly — implying the app performs these is a lie it would
  // tell daily.
  "checklist.phone_number.title": "Buy a phone number",
  "checklist.phone_number.help":
    "Done in Telnyx. Calling and SMS arrive in M2 — until then this is a record that the number exists.",
  "checklist.a2p_registration.title": "Register A2P 10DLC brand and campaign",
  "checklist.a2p_registration.help":
    "Done with the carriers via Telnyx. Expect days to weeks; start it early because nothing you do here speeds it up.",
  "checklist.email_domain.title": "Add a sending subdomain, DKIM and DMARC",
  "checklist.email_domain.help":
    "Done in Resend, then the DNS records at the domain host. DKIM alone is not enough — without a DMARC record the receiving server accepts the mail and may discard it, and every system here will still say delivered. Check the domain's Insights in Resend before the client sends anything real. A subdomain keeps this client's sending reputation separate. Once the domain is verified, set it as the Sending address in this company's Settings — until you do, their mail still goes out from the platform address.",
  "checklist.form_notify.title": "Set the notification address on each form",
  "checklist.form_notify.help":
    "Done here. Forms applied from a blueprint deliberately start with an empty notify list so leads cannot reach the previous client.",
  "checklist.gbp_connect.title": "Connect Google Business Profile",
  "checklist.gbp_connect.help": "Done in Google. Review management arrives in M5.",
  "checklist.invite_owner.title": "Invite the business owner",
  "checklist.invite_owner.help": "Done in this company's Settings, under Client access. Turn access on, then invite them by email.",

  "checklist.title": "Activation checklist",
  "checklist.body": "What's left before this company is live.",
  "checklist.external": "Done outside BIS",
  "checklist.formNotify": "forms still have no notification address",
  "checklist.addItem": "Add a step",
  "checklist.addPlaceholder": "Something else this client needs…",
  "checklist.complete": "Everything on the checklist is done.",
  "checklist.remaining": "remaining",
  "checklist.open": "Open",
  "checklist.reviewLink": "Checklist complete — review",

  "blueprints.title": "Blueprints",
  "blueprints.empty.title": "No blueprints yet",
  "blueprints.empty.body": "Set an account up the way you like it, then save its configuration here to reuse on the next client.",
  "blueprints.version": "Version",
  "blueprints.captured": "Captured",
  "blueprints.applied": "Applied to",
  "blueprints.appliedCount": "accounts",
  "blueprints.save": "Save as blueprint",
  "blueprints.saveHint": "Copies this account's pipelines, custom fields, tags, custom values and forms. Never contacts, conversations, or anything with a credential in it.",
  "blueprints.name": "Blueprint name",
  "blueprints.saved": "Blueprint saved",
  "blueprints.saveFailed": "Could not save the blueprint.",
  "blueprints.overwriteWarning": "\"{name}\" already exists (version {version}). Saving will replace it — there is no version history and no undo.",

  // The public booking page — a stranger's own screen, reached at /b/<publicId>
  // with no account context at all. Same audience as forms.* above: no
  // internal roadmap label, ever (messages.test.ts enforces it repo-wide).
  "booking.public.noSlots": "No times available this day.",
  "booking.public.timezoneLabel": "Times shown in {zone}",
  "booking.public.previousWeek": "Previous week",
  "booking.public.nextWeek": "Next week",
  "booking.public.firstName": "First name",
  "booking.public.lastName": "Last name",
  "booking.public.email": "Email",
  "booking.public.phone": "Phone",
  "booking.public.note": "Note",
  "booking.public.optional": "optional",
  "booking.public.required": "This field is required.",
  "booking.public.invalidEmail": "Enter a valid email address.",
  "booking.public.invalidPhone": "Enter a valid phone number.",
  // Same deliberate carve-out `f/[publicId]/actions.ts`'s `tokenExpired`
  // draws: a real visitor who left the tab open, not a spam signal, so this
  // is the one render-token failure that gets its own honest message instead
  // of the shared fake success.
  "booking.public.tokenExpired": "This page has been open a while — please refresh and pick your time again.",
  "booking.public.submit": "Confirm booking",
  "booking.public.submitting": "Booking…",
  "booking.public.changeTime": "Choose a different time",
  "booking.public.slotTaken": "That time was just booked. Pick another below.",
  "booking.public.genericError": "Something went wrong. Please try again.",
  "booking.public.successTitle": "You're booked in.",
  "booking.public.successBody": "We've sent a confirmation to your email.",
  "booking.public.cancelHint": "Need to cancel or reschedule? Use the link in your confirmation email.",

  // The cancel-by-link page — `/b/<publicId>/cancel/<token>`, reached from
  // the confirmation and reminder emails. Same audience/rule as booking.public.*
  // above: no internal roadmap label, ever.
  "booking.cancel.confirmTitle": "Cancel this booking?",
  "booking.cancel.confirmButton": "Cancel booking",
  // Deliberately the SAME copy for a booking this action just cancelled and
  // one a second click on the same link finds already cancelled — a replay
  // is a state, not an error, and the two are indistinguishable to a visitor
  // by design (see `cancelBookingByToken`'s own doc comment).
  "booking.cancel.alreadyCancelledTitle": "This booking has already been cancelled.",
  "booking.cancel.pastTitle": "This booking has already happened.",
  "booking.cancel.genericError": "Something went wrong. Please try again.",

  // The operator Calendar page — /dashboard/accounts/<id>/calendar. Reachable
  // by BOTH audiences (calendar is the client's own business data, same as
  // contacts), so every string that names WHOSE calendar it is has to carry
  // the right voice, same mechanism panel-copy.ts pins for branding: the
  // agency reads "this company's", the client reads "your".
  "calendar.title": "Calendar",
  "calendar.settings.title": "Booking settings",
  "calendar.settings.clientTitle": "Your booking settings",
  "calendar.settings.body": "Controls how this company's public booking page behaves.",
  "calendar.settings.clientBody": "Controls how your public booking page behaves.",
  "calendar.settings.enabled": "Accept bookings",
  "calendar.settings.hours": "Hours",
  "calendar.settings.hoursHint": "Set an open and close time for each day. Leave both blank to close that day.",
  "calendar.settings.day.mon": "Monday",
  "calendar.settings.day.tue": "Tuesday",
  "calendar.settings.day.wed": "Wednesday",
  "calendar.settings.day.thu": "Thursday",
  "calendar.settings.day.fri": "Friday",
  "calendar.settings.day.sat": "Saturday",
  "calendar.settings.day.sun": "Sunday",
  "calendar.settings.from": "From",
  "calendar.settings.to": "To",
  "calendar.settings.duration": "Appointment length",
  "calendar.settings.buffer": "Buffer between appointments",
  "calendar.settings.minNotice": "Minimum notice",
  "calendar.settings.maxAdvance": "How far ahead people can book",
  "calendar.settings.notifyEmails": "Notify these addresses",
  "calendar.settings.notifyEmailsHint": "One address per line. Sent whenever someone books, cancels, or an appointment is coming up.",
  // The inline warning the checklist's form_notify concern mirrors: an
  // account that is accepting bookings with nobody listed to hear about them
  // is a silent failure mode, not a valid configuration to save quietly.
  "calendar.settings.notifyEmailsWarning": "Booking is on, but no address is listed above — nobody will be notified when someone books.",
  "calendar.settings.meetingType": "Meeting type",
  "calendar.settings.meetingType.inPerson": "In person",
  "calendar.settings.meetingType.phone": "Phone",
  "calendar.settings.meetingType.video": "Video",
  "calendar.settings.followup": "Follow-up email",
  "calendar.settings.followupHint": "Sent the morning after an appointment ends. Leave blank to send our default message.",
  "calendar.settings.followupEnabled": "Send a follow-up email after appointments",
  "calendar.settings.followupBody": "Follow-up message",
  "calendar.settings.saved": "Booking settings saved",
  "calendar.settings.saveFailed": "Could not save booking settings.",
  "calendar.settings.saveCrashed": "Could not save — this page may be out of date. Reload it and try again.",

  "calendar.bookings.title": "Upcoming bookings",
  "calendar.bookings.empty": "No upcoming bookings.",
  "calendar.bookings.note": "Note",
  "calendar.bookings.join": "Join",
  "calendar.bookings.cancel": "Cancel",
  "calendar.bookings.markCompleted": "Mark completed",
  "calendar.bookings.markNoShow": "No-show",
  "calendar.bookings.statusUpdated": "Booking updated",
  "calendar.bookings.statusUpdateFailed": "Could not update this booking.",
  "calendar.bookings.status.booked": "Booked",
  "calendar.bookings.status.cancelled": "Cancelled",
  "calendar.bookings.status.completed": "Completed",
  "calendar.bookings.status.no_show": "No-show",

  "calendar.embed.title": "Embed",
  "calendar.embed.hint": "Paste this where the booking widget should appear.",
  "calendar.embed.disabledHint": "Turn on \"Accept bookings\" above to get the embed snippet.",
  "calendar.embed.copy": "Copy",
  "calendar.embed.copied": "Copied",
  "calendar.embed.publicLink": "Direct link",

  // The agency's Voice settings page — /dashboard/accounts/<id>/voice.
  // Agency-only: requireAccountAccess's isAgency check gates every write,
  // the nav item is hidden from clients the same way branding is hidden
  // from the agency, and the page itself gates the read. This is the manual
  // path that gets the first client's receptionist live before the setup
  // wizard automates it — plain admin language throughout, no roadmap labels.
  "voice.title": "Voice Receptionist",
  "voice.agencyOnly": "Only the agency may manage voice settings.",

  "voice.profile.title": "Voice profile",
  "voice.profile.body": "What the receptionist says and knows on every call.",
  "voice.profile.personaName": "Persona name",
  "voice.profile.greetingEn": "Greeting (English)",
  "voice.profile.greetingEs": "Greeting (Spanish)",
  "voice.profile.facts": "Facts",
  "voice.profile.factsHint": "Hours, pricing, policies — anything a caller might ask about.",
  "voice.profile.services": "Services",
  "voice.profile.language": "Language",
  "voice.profile.language.en": "English only",
  "voice.profile.language.es": "Spanish only",
  "voice.profile.language.both": "English and Spanish",
  "voice.profile.bookingEnabled": "Allow booking appointments on the call",
  "voice.profile.afterHours": "After hours",
  "voice.profile.afterHours.hoursThenMessage": "Follow business hours, then take a message",
  "voice.profile.afterHours.messageOnly": "Always take a message",
  "voice.profile.enabled": "Receptionist enabled",
  "voice.profile.save": "Save voice profile",
  "voice.profile.saved": "Voice profile saved",
  "voice.profile.saveFailed": "Could not save the voice profile.",

  "voice.numbers.title": "Phone numbers",
  "voice.numbers.body": "Assign a number and move it live once the profile is ready.",
  "voice.numbers.assign": "Assign number",
  "voice.numbers.e164": "Phone number",
  "voice.numbers.e164Hint": "Any format — normalized automatically.",
  "voice.numbers.telnyxId": "Telnyx ID (optional)",
  "voice.numbers.assigned": "Number assigned",
  "voice.numbers.assignFailed": "Could not assign this number.",
  "voice.numbers.badE164": "Enter a valid phone number.",
  "voice.numbers.empty": "No phone numbers assigned yet.",
  "voice.numbers.status": "Status",
  "voice.numbers.status.provisioned": "Provisioned",
  "voice.numbers.status.testing": "Testing",
  "voice.numbers.status.live": "Live",
  "voice.numbers.status.released": "Released",
  "voice.numbers.statusUpdated": "Status updated",
  "voice.numbers.statusUpdateFailed": "Could not update this number's status.",
  "voice.numbers.goLiveNeedsProfile": "Fill in the voice profile before going live",
  "voice.moveFailed": "Couldn't move that number — check it isn't in use and try again.",
  // Server-side twin of the page's own precondition (setup/page.tsx only
  // offers the move list when `assignedNumber === null`): a tampered or
  // stale submission must not be able to give an account a second active
  // number just because the render it came from went stale.
  "voice.moveDestinationOccupied": "This client already has a phone number. Release or move it before bringing in another one.",

  // The client-facing Calls log — /dashboard/accounts/<id>/calls. BOTH
  // audiences: this is the client's own business data (who rang, what the
  // receptionist did about it), not agency work about the client, so it is
  // gated by requireAccountAccess like contacts and the calendar are — and
  // it is the one screen where a client SEES what they are paying for.
  //
  // `calls.usage` interpolates like `contacts.page` above: the component
  // .replace()s the placeholders, so a future translation may reorder them.
  "calls.title": "Calls",
  "calls.usage": "{n} of {cap} calls today",
  // The meter's accessible NAME. Deliberately not the sentence above: that is
  // already the bar's `aria-valuetext`, and reusing it would have a screen
  // reader read the same count twice in a row.
  "calls.usageLabel": "Daily call usage",
  "calls.empty.title": "No calls yet",
  "calls.empty.body":
    "When your AI receptionist answers a call, it will appear here with its transcript and outcome.",
  "calls.col.when": "When",
  "calls.col.caller": "Caller",
  "calls.col.duration": "Duration",
  "calls.col.outcome": "Outcome",
  "calls.col.language": "Language",
  "calls.older": "Older calls",
  "calls.unknownCaller": "Unknown caller",
  "calls.outcome.booked": "Booked",
  "calls.outcome.lead": "Lead",
  "calls.outcome.message": "Message",
  "calls.outcome.abandoned": "Abandoned",
  "calls.outcome.spam": "Spam",

  // A single call — /dashboard/accounts/<id>/calls/<callId>. The transcript
  // surface: the one place a client can read what their receptionist actually
  // said, rather than take our word for what it did.
  //
  // `calls.detail.caller` / `.assistant` label the two sides of the
  // conversation. "Assistant" rather than a product name or the voice's
  // own persona: the client's staff need to read the log knowing which turns
  // were the machine's, and a friendly name blurs exactly that line.
  "calls.detail.title": "Call",
  "calls.detail.summary": "Summary",
  "calls.detail.transcript": "Transcript",
  "calls.detail.viewContact": "View contact",
  "calls.detail.viewConversation": "View conversation",
  "calls.detail.viewBooking": "View booking",
  "calls.detail.assistant": "Assistant",
  "calls.detail.caller": "Caller",
  "calls.detail.noTranscript": "No transcript was recorded for this call.",

  "setup.title": "Client setup",
  "setup.backToSetup": "Back to setup",
  "setup.progress": "{done} of {total} steps done",
  "setup.progressLabel": "Setup progress",
  "setup.nextUp": "Next up",
  "setup.state.done": "Done",
  "setup.state.open": "To do",
  "setup.state.skipped": "Skipped",
  // Never "not done". A read that threw tells us nothing about the step it
  // was going to answer for, and the whole point of this page is that a green
  // tick means the thing is actually true.
  "setup.state.unknown": "Couldn't check — reload to retry",
  "setup.step.account.title": "Create the account",
  "setup.step.account.help": "This company exists — you're looking at it.",
  "setup.step.branding.title": "Branding",
  "setup.step.branding.help":
    "Set the brand name your client's customers will see on every email and page.",
  "setup.step.hours.title": "Business hours",
  "setup.step.hours.help":
    "Enable the calendar and set open hours — without them, callers hear \"no availability\" for every day.",
  "setup.step.voice_profile.title": "Voice profile",
  "setup.step.voice_profile.help":
    "Greeting, business facts, and persona for the AI receptionist.",
  "setup.step.number.title": "Phone number",
  "setup.step.number.help":
    "Assign a BIS number to this client. Buy numbers in the Telnyx dashboard, then assign here.",
  "setup.step.email.title": "Email identity",
  "setup.step.email.help":
    "Send from the client's own domain. Optional — until it's set, mail sends from the platform address.",
  "setup.step.email.skip": "Skip for now",
  "setup.step.email.unskip": "Un-skip",
  "setup.step.forwarding.title": "Call forwarding",
  "setup.step.forwarding.help":
    "The client forwards their business line to the number below at their carrier. Tick when confirmed.",
  "setup.step.forwarding.tick": "Forwarding is set up",
  "setup.step.forwarding.untick": "Not set up yet",
  "setup.step.forwarding.noNumber": "Assign a number first — there is nothing to forward to yet.",
  "setup.step.forwarding.unknownNumber": "Couldn't check the assigned number — reload to retry.",
  "setup.step.test_call.title": "Test call",
  "setup.step.test_call.help":
    "Call the assigned number. The call will appear on the Calls page and turn this step green.",
  // Shown only for a `provisioned` number — assigned but not yet answering
  // anything. The button below fixes exactly this.
  "setup.testCall.provisionedNote":
    "This number isn't answering calls yet. Enable test calls to have it start answering immediately — no need to go live first.",
  // Shown once the button above has been pressed. "works the moment you
  // pressed it" is deliberate, not "works after a delay": `testing` answers
  // regardless of the receptionist toggle (see the accept-gate predicate),
  // so there is nothing else this number is waiting on.
  "setup.testCall.testingNote":
    "This number is answering calls now, for testing — it works even before you go live. Go live makes it permanent.",
  // Shown for a `provisioned` number with no saved voice profile (button
  // stays disabled) AND for a `testing` number with no saved voice profile
  // (already flipped, but not actually answering — `callAnswerable` declines
  // every call to a number with no profile row, regardless of status).
  "setup.testCall.needsProfileNote":
    "This number needs a saved voice profile before it can answer calls. Save one on step 04, Voice profile, then come back here.",
  "setup.testCall.enable": "Enable test calls",
  "setup.testCall.enabling": "Enabling…",
  "setup.step.go_live.title": "Go live",
  "setup.step.go_live.help":
    "Enables the receptionist and marks the number live. Callers get real answers from here on.",
  "setup.number.moveTitle": "Or move a number from another client",
  "setup.number.moveHere": "Move here",
  // Accessible name. Every row's visible label is the same two words, so
  // without this a screen reader reads a list of identical buttons with no
  // way to tell which number each one takes.
  "setup.number.moveHereLabel": "Move {e164} to this client",
  "setup.number.moving": "Moving…",
  // The destructive-confirm step's button and warning (setup-move-number-
  // button.tsx), shown only for a `testing`/`live` source number — the ones
  // where a move takes another client's answering line down. The button
  // names the consequence, not just the mechanics: "move it" alone reads
  // like relabeling a row, not shutting off calls for someone paying for
  // this platform right now.
  "setup.number.moveConfirm": "Yes, take {e164} out of service and move it",
  "setup.number.moveConfirmWarning":
    "{account} stops answering calls on this number the moment you move it.",
  "setup.number.currentlyOn": "currently on {account}",
  // The join to `accounts` came back empty for this row. Says "we don't know
  // whose it is" rather than implying the number belongs to nobody.
  "setup.number.unknownAccount": "an account we couldn't name",
  "setup.goLive.button": "Go live",
  "setup.goLive.pending": "Going live…",
  "setup.goLive.blocked": "Finish these steps first: {steps}",
  "setup.goLive.denied": "Only the agency can take a client live.",
  "setup.goLive.notReady": "Not everything is ready — finish the open steps above.",
  // Deliberately NOT "not ready": that sentence blames the client's setup,
  // and this one covers a read or a write that failed on our side. Telling an
  // operator to go fix hours that are already fine is the worse error.
  "setup.goLive.failed": "Couldn't take this client live just now. Reload and try again.",
  "setup.viewCalls": "View calls",
  "setup.openStep": "Open",
  "setup.tickFailed": "Could not save that. Reload and try again.",
} as const;

export type MessageKey = keyof typeof m;
