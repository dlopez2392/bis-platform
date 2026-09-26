export const m = {
  // The sidebar's mono uppercase group headers (DESIGN.md's grouped-nav
  // pattern). Text-cased in CSS, not here — these strings stay plain so a
  // screen reader announces them as words, not letter-by-letter.
  "nav.group.overview": "Overview",
  "nav.group.crm": "CRM",
  "nav.group.communications": "Communications",
  "nav.group.growth": "Growth",
  "nav.dashboard": "Dashboard",
  "nav.tasks": "To do",
  "nav.website": "Website",
  // "Checklist", not "Activation checklist": every other sidebar entry is one
  // word, and the longer form is byte-identical to the dashboard card's own
  // title link — which made `getByRole("link", {name: "Activation checklist"})`
  // ambiguous and broke blueprints.spec.ts. Renaming here keeps that
  // assertion at full strength instead of scoping the test around the clash.
  "nav.checklist": "Checklist",
  "nav.contacts": "Contacts",
  "nav.opportunities": "Opportunities",
  "nav.conversations": "Conversations",
  "nav.calls": "Calls",
  "nav.calendar": "Calendar",
  "nav.forms": "Forms",
  "nav.settings": "Settings",
  "nav.branding": "Branding",
  "nav.voice": "Voice",
  "nav.automations": "Automations",
  "nav.setup": "Setup",
  "nav.accounts": "Companies",
  "nav.blueprints": "Blueprints",
  "nav.plans": "Plans",
  "nav.billing": "Billing",
  // Work Queue Task 6 — the agency-wide queue, top level beside Companies
  // and Blueprints. "Work queue" rather than reusing "To do" (nav.tasks):
  // that label already names the per-account screen one level down, and the
  // sidebar can show both on screen at once (inside an account, the agency
  // still sees the top-level group's own back-link). "Queue" is the accurate
  // word here in a way it stops being on the per-account screen: nothing at
  // that level is ever pooled across more than one company.
  "nav.work": "Work queue",
  // The agency numbers inventory (/dashboard/numbers), top level beside
  // Companies, Blueprints and the work queue. "Phone numbers" in full rather
  // than "Numbers": at agency scope, alone in a flat list, "Numbers" reads as
  // metrics. It is the same two words the per-account Voice page's own panel
  // uses, which is deliberate — one vocabulary for one thing.
  "nav.numbers": "Phone numbers",

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
  // Reached by a signed-in user who belongs to no company at all — see the
  // note in dashboard/layout.tsx for why a CLIENT never lands here now.
  // "Isn't set up as an agency admin" described the one visitor this is not
  // written for: it told someone who was invited as a client that they had
  // failed to be staff, which is both wrong and unactionable. Say the thing
  // that is actually true of this state and what to do about it.
  "landing.noAccess.title": "No access yet",
  "landing.noAccess.body": "This sign-in isn't connected to a company yet. If you were invited, open the invitation link from your email — it has to be accepted before you can sign in. Otherwise sign out and try the address the invitation was sent to.",

  // The signed-out shell's rail. This is the line that does real work on
  // /sign-in: it answers "whose software is this", which is the question
  // somebody following a weekly bookmark actually has. There is deliberately
  // no tagline under the "Sign in" heading — see the spec, §10.
  "signIn.title": "Sign in",
  "signIn.railCopy": "by Bespoke Intelligent Solutions",

  "clientAccess.off.title": "Access has been turned off",
  "clientAccess.off.body": "Your access to this account has been turned off. Contact your account manager if you think this is a mistake.",
  // Read by the person who was just invited, on their first visit, at the
  // moment it fails. "No account linked" stated a fact about our data model
  // and gave them nothing to do; "contact your account manager" is a title
  // nobody at a small business has. Say what happened and who can fix it.
  "clientAccess.none.title": "Your company isn't set up yet",
  "clientAccess.none.body": "Your invitation worked, but this company hasn't finished being set up on our side. Let the person who invited you know — they can finish it, and your invitation stays valid.",

  // The agency-side half of the same fault. See lib/accounts/orphans.ts.
  "accounts.orphan.title": "Set up in Clerk but not here",
  "accounts.orphan.body": "Anyone invited to these can be sent an invitation, but cannot sign in — there is no company behind them yet. Add the company here with the same name, or delete the organization in Clerk.",
  "accounts.orphan.unavailable": "Could not reach Clerk to check for half-created companies. The list below is unaffected.",

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
  "branding.mailingAddress": "Mailing address",
  "branding.mailingAddressHint": "Printed at the bottom of the emails this company sends to past customers. The law asks for a real postal address on those, so use one where mail actually reaches them.",
  "branding.clientMailingAddressHint": "Printed at the bottom of the emails you send to past customers. The law asks for a real postal address on those, so use one where you actually get mail.",
  "branding.mailingAddressTooLong": "That mailing address is too long. Keep it to 300 characters or fewer.",
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
  "branding.nameRequired": "Customers see this name on every email and text. Give the company a name before saving.",
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
  // The four refusals createClientAccount RETURNS for the create dialog to
  // show, instead of the generic line above — each names what to change.
  "accounts.nameRequired": "Enter a business name.",
  "accounts.timezoneRequired": "Enter the business's timezone.",
  "accounts.timezoneUnusable": "\"{zone}\" is not a timezone we can use. Use a zone name like America/Chicago.",
  "accounts.createRefusedTestOrgId": "Could not create that company. Clerk gave it an id we keep for test data, and those are deleted automatically within the hour. Nothing was saved. Try again, and tell the BIS team if it happens twice.",
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
  // "{name}" is the house {placeholder} convention (see setup.progress) — the
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
  // setup.progress above); the component .replace()s them, and picks "{unit}"
  // itself (call vs calls) the same way shell.presence.idleOne pins its own
  // singular case.
  "dashboard.calls.title": "Calls",
  "dashboard.calls.caption": "Last 14 days",
  "dashboard.calls.axis.weekendsMuted": "Weekends muted",
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
  // The header badge (Task 3): a whole-phrase pick by count, never a plural
  // template reused for one — see setup.progress below for the {placeholder}
  // convention this departs from on purpose. The platform already shipped a
  // "1 people" bug on the Website screen by templating a plural with no
  // singular form; this is the same shape, fixed at the source.
  "contacts.count": "{count} contacts",
  "contacts.countOne": "1 contact",
  // Cursor pager (Task 3): "Newer" always returns to the unpaged head rather
  // than walking back one page at a time — see page.tsx's own comment on
  // newerHref for why a full back-stack isn't worth the state here.
  "contacts.newer": "Newer",
  "contacts.older": "Older",
  "contacts.import": "Import CSV",
  "contacts.export": "Export CSV",
  // Import wizard. Singular twins are not decoration: the Website screen ships
  // a live "1 people" bug from exactly this omission, and every count below can
  // legitimately be 1.
  "contacts.import.title": "Import contacts",
  "contacts.import.drop": "Choose a CSV file",
  "contacts.import.mapTitle": "Match your columns",
  "contacts.import.ignore": "Don't import this column",
  "contacts.import.ignored": "{count} columns won't be imported",
  "contacts.import.ignoredOne": "1 column won't be imported",
  // NOT "will add X and update Y": which rows are new is only knowable against
  // the account's existing contacts, which this screen has not read. The real
  // split is reported in `done`, after the work.
  "contacts.import.preview": "{count} rows ready to import.",
  "contacts.import.previewOne": "1 row ready to import.",
  "contacts.import.errors": "{count} rows have problems and will be skipped.",
  "contacts.import.errorsOne": "1 row has a problem and will be skipped.",
  "contacts.import.downloadErrors": "Download the skipped rows",
  "contacts.import.createTags": "Also create {count} new tags",
  "contacts.import.createTagsOne": "Also create 1 new tag",
  "contacts.import.confirm": "Import",
  "contacts.import.importing": "Importing {done} of {total}...",
  "contacts.import.done": "Added {created}, updated {updated}.",
  // Shown only when the count is non-zero. "Possible" is doing real work: these
  // are pairs where an email and a phone pointed at different contacts, which
  // is usually one person entered twice — but not always, and the product has
  // no merge screen yet, so it must not promise a resolution it cannot offer.
  "contacts.import.flagged": "{flagged} possible duplicates flagged for review.",
  "contacts.import.partial": "Stopped after {done} rows. Nothing after that was imported.",
  "contacts.import.failed": "That import didn't go through. Nothing was changed. Please try again.",
  "contacts.import.tooMany": "That's too many rows at once. Try a smaller file.",
  "contacts.import.empty": "That file has no rows we can read.",
  "contacts.import.back": "Back to contacts",
  // The downloaded file's own name (Task 4) — "{date}" is the house
  // {placeholder} convention (see setup.progress below). yyyy-mm-dd, filled
  // in by the export route itself; see that file's own comment for why it's
  // UTC rather than the account's timezone (a cosmetic export timestamp, not
  // a business date).
  "contacts.export.filename": "contacts-{date}.csv",
  "contacts.search": "Search name, email, phone…",
  "contacts.col.name": "Contact name",
  "contacts.col.phone": "Phone",
  "contacts.col.email": "Email",
  "contacts.col.company": "Business name",
  "contacts.col.created": "Created",
  "contacts.empty.title": "No contacts yet",
  "contacts.empty.body":
    "Contacts show up when Sofía takes a call, a form is submitted, or you add one yourself.",
  "contacts.noMatches.title": "No matches",
  "contacts.noMatches.body": "Try a different name, email, or phone number.",
  "contacts.firstName": "First name",
  "contacts.lastName": "Last name",
  "contacts.email": "Email",
  "contacts.phone": "Phone",
  "contacts.createFailed": "Could not add that contact. Check the details and try again.",

  // The contacts table's bulk-action bar (DESIGN.md rule 4 — checkboxes
  // never render without bulk actions). "{count}"/"{tag}"/"{skipped}" are
  // the house {placeholder} convention (see setup.progress above).
  "bulk.selectPage": "Select all on this page",
  "bulk.selected": "{count} selected",
  "bulk.addTag": "Add tag",
  "bulk.delete": "Delete…",
  "bulk.clear": "Clear selection",
  "bulk.confirmTitle": "Delete {count} contacts?",
  // Singular pair, same house convention as shell.presence.idleOne: the
  // count is always literally 1, so it's spelled into the string rather
  // than carried as a placeholder. Single selection is the common case for
  // a bulk action bar, and "Delete 1 contacts?" / "Tagged 1 contacts" /
  // "Deleted 1 contacts" is broken English on a destructive confirmation.
  "bulk.confirmTitleOne": "Delete 1 contact?",
  "bulk.confirmBody": "This can't be undone. Type {count} to confirm.",
  "bulk.tagged": "Tagged {count} contacts with \"{tag}\"",
  "bulk.taggedOne": "Tagged 1 contact with \"{tag}\"",
  "bulk.deleted": "Deleted {count} contacts",
  "bulk.deletedOne": "Deleted 1 contact",
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

  // The "No marketing emails" switch (drawer + full contact page, migration
  // 0049). Flipped by the operator when a customer replies "stop" to a
  // check-in or a referral ask; those two are the only emails it holds back.
  "contact.marketingOptOut.label": "No marketing emails",
  "contact.marketingOptOut.hint": "Check-ins and referral asks won't be emailed to this contact. Quotes and appointment emails still go.",
  "contact.marketingOptOut.onToast": "Marketing emails turned off for this contact",
  "contact.marketingOptOut.offToast": "Marketing emails turned back on for this contact",
  "contact.marketingOptOut.failed": "Couldn't save that — please try again.",
  // Under the ticked switch: the day the stop was recorded, in the account's
  // zone — the operator's answer to "when did they ask?".
  "contact.marketingOptOut.since": "Off since {date}",
  // The same line when the account's own timezone could not be used and the
  // date is printed in a stand-in zone (`renderZone`'s `guessed`) — so a
  // date that may be a day off says which zone it is in. Not a full zone
  // note: that is one per screen, and this is one line under a checkbox.
  "contact.marketingOptOut.sinceGuessed": "Off since {date} ({zone})",
  // Undo clicked while the last tick is still saving: the toast (and its
  // Undo) is gone once clicked, so the operator is told what to do instead.
  // "{label}" is `contact.marketingOptOut.label` above, .replace()d by
  // `flipMarketingOptOut`, so the box is always named by what it says.
  "contact.marketingOptOut.undoBusy": "Your last change is still saving. Use the “{label}” box to change it back.",

  // The contact drawer's recent-activity feed (Task 2's summary route,
  // Task 6's drawer). "{outcome}"/"{name}"/"{value}" are the house
  // {placeholder} convention (see setup.progress above) — the route
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
  // Screen-reader-only (Radix logs a missing-Description warning without
  // one) — sr-only rather than visible copy, since the header row already
  // carries the avatar, name, and open-full-page link and DESIGN.md's
  // surfaces don't have room for a redundant subtitle.
  "drawer.description": "Contact details, tags, and recent activity.",

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
  // Card title AND the field's accessible name (sr-only Label) share this
  // key on purpose here — unlike sendingIdentity/sendingAddress above, there
  // is only one field on the card, so there is nothing for a second, more
  // precise name to disambiguate from. The Label stays sr-only so the text
  // still renders on screen exactly once.
  "settings.weeklyReport": "Weekly report",
  "settings.weeklyReportHint": "Who gets Monday's numbers. Separate addresses with commas.",
  "settings.weeklyReportSaved": "Saved. The next report goes out Monday morning.",
  "settings.weeklyReportBadEmail": "That doesn't look like an email address: {value}",
  "settings.weeklyReportOff": "Nobody is receiving this yet.",

  // accounts.alert_phone (0035_alert_phone.sql) — agency-write, client-read.
  // Card title and the agency field's sr-only Label share this string, same
  // reason as settings.weeklyReport above: one field, nothing to disambiguate.
  "settings.alertPhone": "Alert texts",
  "settings.alertPhoneHint": "Where a text goes the moment a booking lands or a call finishes. Leave it blank and this account gets no alert texts — that's not a bug, it's off.",
  // A RESERVED fictional number (NANP holds 555-0100..555-0199 for exactly
  // this), not anyone's real line. It was danlo's own mobile until
  // 2026-09-16: harmless while the repo was private, less so once it went
  // public, and it renders to every client on their own Branding page. Keep
  // the local 956 area code so the shape still reads as a Valley number to
  // the landscaper at 7 AM, and keep it clear of the 555 numbers the seeded
  // demo account and the test suites already use.
  "settings.alertPhonePlaceholder": "(956) 555-0142",
  "settings.alertPhoneSaved": "Alert texts updated",
  "settings.alertPhoneBad": "Enter a phone number, like (956) 555-0142.",
  "settings.alertPhoneOff": "No alert texts are going out yet.",
  // Agency-only help — a number is set, but nothing would actually send
  // (A2P not approved, or no live number yet). Never shown to a client:
  // only the agency's own Checklist can act on it. Carries a {checklistLink}
  // slot so the word is an actual link, not a bare mention of a route
  // nobody can click to.
  "settings.alertPhoneNotReady": "Texting isn't turned on for this account yet, so no alert texts will go out until it is. See {checklistLink}.",
  // 0036 made this a REFUSAL, not save-time advice: startAlertPhoneVerificationAction
  // refuses to send a code at all when the claimed number is one of the
  // account's own — a code sent there loops straight back into the inbound
  // webhook and could never reach a human to type back, so there is nothing
  // to save yet when this shows. The copy says so in the present tense, not
  // as a note about a number already stored.
  "settings.alertPhoneSelfWarning": "Can't send a code there — that's this account's own texting number, and a code sent there would loop straight back with nobody to read it. Use a different number.",
  // The client's read-only view (branding page) — honest about the
  // asymmetry rather than silent about it: says where alerts go and who can
  // change it, never implies the field is unfinished.
  "settings.alertPhoneClientOn": "Alert texts go to {value}.",
  // A number IS saved, but resolveSmsSender's own gate isn't clear yet
  // (same predicate the agency's Notice reads) — so this qualifies the claim
  // to the future tense rather than asserting a destination that cannot
  // actually receive anything yet. No carrier or registration language: the
  // client still cannot act on that detail, only the agency's Checklist can.
  "settings.alertPhoneClientNotReady": "Alert texts will go to {value} once texting is turned on for this account.",
  "settings.alertPhoneClientOff": "This account doesn't receive alert texts.",
  "settings.alertPhoneClientBody": "Texts land here the moment a booking comes in or a call finishes. Only your agency can change this number.",

  // The verification flow (0036_alert_phone_verifications.sql) — claiming a
  // NEW alert number now means proving somebody holds it, not just typing
  // it in. Clearing the number stays proof-free (setAlertPhoneAction below
  // keeps doing that directly): nobody needs to prove possession to turn
  // alerts off.
  "settings.alertPhoneNeedsVerification": "A new alert number has to be verified first — request a code below, then enter it to confirm the number.",
  // Same predicate as settings.alertPhoneNotReady (resolveSmsSender's own
  // gate), but phrased as a plain error string for a form action's result
  // rather than a Notice with a link slot: there is nothing to send a code
  // FROM yet.
  "settings.alertPhoneNotClearedToSend": "Texting isn't turned on for this account yet, so no verification code can go out. See the Checklist page.",
  "settings.alertPhoneTooManyCodes": "Too many codes have been requested for this number in the last hour. Try again in about an hour.",
  "settings.alertPhoneSendFailed": "The verification code couldn't be sent. Try again in a moment.",
  "settings.alertPhoneCodeSent": "Code sent — check that phone for a text.",
  // Deliberately does not say the number was right or wrong — only that
  // THIS code was. See verifyAlertPhoneCode's own comment for why "wrong"
  // and "expired" are kept as two different, narrow messages.
  "settings.alertPhoneWrongCode": "That code doesn't match. Check the digits and try again.",
  "settings.alertPhoneCodeExpired": "That code has expired, or none was ever sent for this number. Request a new one.",
  // The agency's idle-phase button: "Save" only ever clears the field
  // (setAlertPhoneAction's one remaining direct write); typing any number,
  // even the one already on the account, always asks for a code instead.
  "settings.alertPhoneSendCode": "Send code",
  "settings.alertPhoneConfirmCode": "Confirm code",
  "settings.alertPhoneCodeLabel": "Verification code",
  "settings.alertPhoneCodePlaceholder": "123456",
  // {value} takes a NumberChip, same pattern as the client sentences above —
  // never raw prose, so the number always reads as a number, not a sentence
  // fragment.
  "settings.alertPhonePendingHint": "We texted a 6-digit code to {value}. Enter it below to confirm the number.",
  "settings.alertPhoneChangeNumber": "Use a different number",
  "settings.alertPhoneResendCode": "Resend code",

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
  "compose.sms": "Text",
  "compose.smsPlaceholder": "Write a text…",
  "compose.smsSent": "Text sent",
  "compose.smsFailed": "Could not send the text",
  // Mirrors compose.sendRejected's shape: a fixed, generic line shown whenever
  // the server refuses the send before anything reached the provider — never
  // the raw internal reason (see send-errors.ts).
  "compose.smsSendRejected": "Could not send that text. Check the contact has a phone number.",
  // Mirrors compose.noEmailOnContact in wording and tone. Covers both an
  // empty phone field and one that couldn't be turned into a number we can
  // actually text (see lib/voice/phone-number.ts's toE164).
  "compose.noPhoneOnContact": "This contact has no phone number.",
  // Says WHO is holding it up and what unblocks it, rather than "unavailable".
  "compose.smsBlockedA2p": "Texting is off until this company's A2P registration is approved",
  "compose.smsBlockedNoNumber": "Texting needs a live phone number on this company",
  // {n} segments — SMS bills per segment, and a single non-GSM character
  // (an accent, a curly apostrophe) drops the whole message to 70 per segment.
  "compose.smsSegments": "{chars} characters · {segments} message(s)",

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
  // The parked minor this change closes: notifyEmails has gone unvalidated
  // since the booking milestone. Same {value} convention and same wording as
  // settings.weeklyReportBadEmail — one bad-address message, not two that can
  // drift apart.
  "forms.invalidNotifyEmail": "That doesn't look like an email address: {value}",

  "conversations.unread": "unread",
  "conversations.channel.form": "Form submission",
  "conversations.channel.email": "Email",
  "conversations.channel.voice": "Call",
  "conversations.channel.sms": "Text",
  // "{channel}" is the house placeholder convention (see shell.presence.idle).
  // Filled from MESSAGE_CHANNEL_LABEL (lib/labels.ts) so the timeline reads
  // "Email sent"/"Text sent"/etc. from the real channel instead of a
  // hardcoded "Email" for every message regardless of how it was sent.
  "contact.activitySent": "{channel} sent",
  "contact.activityReceived": "{channel} received",
  "contact.formSubmission": "Form submission",

  // Every item but form_notify happens outside the platform. The help text
  // must say so plainly — implying the app performs these is a lie it would
  // tell daily.
  "checklist.phone_number.title": "Buy a phone number",
  "checklist.phone_number.help":
    "Done in Telnyx. Calling and SMS arrive in M2 — until then this is a record that the number exists.",
  "checklist.a2p_registration.title": "Register A2P 10DLC brand and campaign",
  // Names where the gather list lives rather than carrying it: this line
  // renders inside a seven-item list, on the account dashboard as well as the
  // checklist page, and nine bullets of carrier paperwork would bury the six
  // other items. Worded as a destination, the way every internal item is,
  // because ChecklistPanel is reusable and must not say "below".
  "checklist.a2p_registration.help":
    "Done with the carriers via Telnyx. Expect days to weeks; start it early because nothing you do here speeds it up. The A2P registration panel on this company's checklist lists what to collect from them first.",
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
  // Not external: this is done in this app, on the Voice page. No href — the
  // catalogue is a static module with no account id in scope, so the help
  // text names the destination, as every internal item does.
  "checklist.concierge_embed.title": "Put the assistant on your website",
  "checklist.concierge_embed.help":
    "Turn on the website assistant from the Voice page, pick where its leads should land, then paste one line of code into your site. It answers questions and takes names around the clock.",

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
  // The dashboard's compact row (checklist-row.tsx), not the full panel — it
  // sits under checklist.title as the row's own count, mirroring
  // setup.progress's "{done} of {total}" shape but in the checklist's own
  // plain voice ("done", not "steps done" — a checklist item isn't always a
  // step, e.g. "Add a step" itself adds an arbitrary custom item).
  "checklist.dashboardProgress": "{done} of {total} done",
  // Shown on the A2P item, which no longer has a working tick. Names what
  // decides it, so the operator is not left clicking a dead box. Worded to
  // stand alone rather than "the registration below" — ChecklistPanel is a
  // reusable component, not guaranteed to render next to A2pPanel.
  "checklist.derivedFromA2p": "Ticks itself once the A2P registration is approved",

  // The A2P item above is no longer a manual tick — it reads from what the
  // operator records here. "With the carriers" rather than "Pending" on
  // purpose: it names who is holding it up, which is the thing the operator
  // actually wants to know, and it matches the item's own help text saying
  // nothing you do here speeds it up.
  "a2p.title": "A2P registration",
  "a2p.body": "What the carriers have approved for this company. Texting stays off until the campaign is approved.",
  "a2p.brandId": "Brand ID",
  "a2p.campaignId": "Campaign ID",
  "a2p.status": "Status",
  "a2p.status.not_started": "Not started",
  "a2p.status.pending": "With the carriers",
  "a2p.status.approved": "Approved",
  "a2p.status.rejected": "Rejected",
  "a2p.saved": "A2P registration updated",
  "a2p.saveFailed": "Could not update A2P registration",
  // Names what is missing rather than "invalid input": approving without the
  // identifiers ticks a checklist item that reads "Register A2P 10DLC brand
  // and campaign" for a company with nothing to send on.
  // "Both … are needed" rather than "Add the brand ID and campaign ID": the
  // guard fires when EITHER is missing, so naming both as things to add is
  // wrong half the time it appears.
  "a2p.approvedNeedsIds": "Both the brand ID and campaign ID are needed before marking this approved",
  "a2p.staleStatus": "That status isn't one of the options — reload the page and try again",
  "a2p.recorded": "Recorded",

  // The gather list, in front of the operator on the checklist page rather
  // than only in docs/runbooks/a2p-registration.md, because the moment anyone
  // needs it is the moment they are standing on this page with an empty Brand
  // ID field and the client on the phone. The runbook keeps the full
  // procedure — the portal clicks, the sole-proprietor OTP flow, the fees;
  // what is duplicated here is only the part that has to be ASKED OF THE
  // CLIENT, because going back a second time is what loses a week.
  //
  // Shown only while the recorded status is not_started or rejected: once a
  // registration is with the carriers the list is noise, and a rejection
  // means collecting it again.
  "a2p.gather.title": "Collect this from the client before you start",
  "a2p.gather.body": "Every submission is charged, so a rejection costs money as well as days. Nothing goes to the carriers until all of it is in hand.",
  "a2p.gather.legalName": "Legal company name, exactly as the EIN was issued",
  "a2p.gather.dba": "DBA or brand name, even when it matches the legal name",
  "a2p.gather.ein": "EIN, their federal tax ID. No EIN means the sole-proprietor path, which is slower and caps them near 1,000 texts a day",
  "a2p.gather.address": "Business address matching the EIN. A PO box or a mailbox service is rejected",
  "a2p.gather.website": "A live website that is clearly the same business",
  "a2p.gather.vertical": "Industry category",
  "a2p.gather.contact": "A contact name, email and phone for someone who will answer",
  "a2p.gather.optIn": "A working opt-in on that website: an SMS checkbox that is optional and separate from email consent, wording on message frequency and rates, and Terms and Privacy Policy as real links, not pop-ups",
  "a2p.gather.link": "Start the brand in Telnyx",

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

  // The public booking page's own strings (`booking.public.*`) moved to
  // `lib/booking/public-strings.ts`, which carries them in both languages —
  // this catalogue is single-locale by design and `/b` is not the dashboard.

  // The cancel-by-link page's strings (`booking.cancel.*`) live beside the
  // booking page's in `lib/booking/public-strings.ts`, in both languages.

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
  "voice.textback.enabled": "Text back callers who didn't book",
  "voice.textback.help": "When someone talks to Sofía and hangs up without booking, send them a text. Off until you turn it on, and only for companies whose A2P registration is approved.",
  "voice.textback.body": "Message",
  // The missed-call text-back's default body, in the language the CALLER
  // actually spoke (detectSpokenLanguage) — this platform serves the Rio
  // Grande Valley, and answering a Spanish caller in English is the whole
  // point of having the column. `{name}` is the house placeholder, filled
  // with the customer-facing brand name; the NoName variants drop the
  // identifying clause entirely rather than inventing a placeholder noun.
  //
  // Every one of these four is ONE SMS segment for a GSM-7 company name, and
  // that is a constraint on the copy, not an observation about it — see
  // textback-body.ts. The Spanish wording is deliberately written with no
  // á/í/ó/ú: those are outside GSM-7 (é/ñ/ü/¿/¡ are inside it), and a single
  // one drops the whole message to UCS-2 at 70 characters per segment, which
  // this sentence does not fit in. "responda aquí" cost two segments for
  // every Spanish caller; "responda este mensaje" costs one and says the
  // same thing. Pinned in textback-body.test.ts.
  // The opt-out disclosure appended to every PROGRAM message (lib/sms/opt-out.ts
  // has the full reasoning, including why the keyword stays "STOP" in Spanish
  // and why there is no accent in the Spanish line). Kept in the catalogue
  // rather than inlined at the append site because it is customer-facing copy
  // like every other string here — and because a carrier reads it.
  "sms.optOut.en": "Reply STOP to opt out.",
  "sms.optOut.es": "Responde STOP para cancelar.",

  "voice.textback.defaultBodyEn": "Hi, this is {name}. Sorry we missed you just now, reply here and we'll help.",
  "voice.textback.defaultBodyNoNameEn": "Sorry we missed you just now, reply here and we'll help.",
  "voice.textback.defaultBodyEs": "Hola, somos {name}. No pudimos contestar su llamada, responda este mensaje y le ayudamos.",
  "voice.textback.defaultBodyNoNameEs": "No pudimos contestar su llamada, responda este mensaje y le ayudamos.",
  // Same class of note as `automations.optOutCounted` (the count above
  // includes a sentence not shown in the textarea/placeholder) but worded
  // WITHOUT quoting the English disclosure verbatim: this card's preview
  // language switches with the operator's `languages` selection
  // (previewLanguage, voice-settings.tsx), and a Spanish preview counts
  // "Responde STOP para cancelar." — a note that named the English sentence
  // there would be describing text nobody is about to receive.
  "voice.textback.optOutCounted": "Every text ends with an opt-out line. That sentence is included in the count above.",
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

  // Transfer to a person. The field IS the switch — blank means Sofía takes a
  // message, which is what she has always done, so the copy never calls it
  // "off" or shows a toggle that could disagree with the number in the box.
  // `ownNumber` names the consequence rather than the rule, because the
  // operator who typed the office line needs to know what the caller would
  // have heard, not which table it collided with.
  "voice.transfer.title": "Transfer to a person",
  "voice.transfer.body": "When a caller asks to speak to someone, Sofía says one moment and rings this number.",
  "voice.transfer.label": "Number to ring",
  "voice.transfer.hint": "Any format — normalized automatically. Leave it blank and Sofía takes a message instead, the way she does today.",
  "voice.transfer.save": "Save transfer number",
  "voice.transfer.saved": "Transfer number saved",
  "voice.transfer.cleared": "Transfer number cleared — Sofía will take a message instead",
  "voice.transfer.badE164": "Enter a real phone number, or leave it blank to keep taking messages.",
  "voice.transfer.ownNumber": "That's this client's own number, so the call would ring straight back to Sofía. Use a number that reaches a person.",
  "voice.transfer.saveFailed": "Could not save the transfer number.",

  // ── Website assistant — the same receptionist, answering on the website
  // instead of the phone. Copy here avoids the internal words for this
  // feature ("concierge", "widget", "embed", "public id") on purpose — this
  // card is read by the agency operator setting it up for a real business,
  // and the checklist item that points here is the same plain sentence a
  // landscaper reads at 7 AM.
  "voice.assistant.title": "Website assistant",
  "voice.assistant.body": "Answers questions on your website and takes names, day and night.",
  "voice.assistant.destinationLabel": "Where should its leads go?",
  "voice.assistant.destinationPlaceholder": "Choose a form",
  "voice.assistant.toggleLabel": "Turn on the website assistant",
  "voice.assistant.lockedNoProfile": "Set up the assistant's name and greeting first.",
  "voice.assistant.lockedBlankGreeting": "Write the greeting visitors will see first.",
  "voice.assistant.greetingBlankOn": "The greeting is blank, so visitors see an empty first message. Write one in the assistant's profile above.",
  "voice.assistant.lockedNoSelection": "Choose a form for its leads first.",
  "voice.assistant.noFormTitle": "No published form yet",
  "voice.assistant.noFormBody": "The website assistant needs a form to send its leads to. Publish one, then come back here to turn it on.",
  "voice.assistant.goToForms": "Go to Forms",
  "voice.assistant.enabledToast": "Website assistant turned on",
  "voice.assistant.disabledToast": "Website assistant turned off",
  "voice.assistant.enableFailed": "Could not turn on the website assistant.",
  "voice.assistant.disableFailed": "Could not turn off the website assistant.",
  "voice.assistant.wrongForm": "That form belongs to a different company, or was just deleted. Pick another one.",
  "voice.assistant.formUnpublished": "The form this sends to is no longer published — leads have nowhere good to land. Publish it again, or turn the assistant off to pick another.",
  "voice.assistant.formUnpublishedOff": "This form is no longer published. Publish it again or pick another one first.",
  "voice.assistant.unpublishedFormOption": "This form (no longer published)",
  "voice.assistant.snippetTitle": "Add it to your website",
  "voice.assistant.snippetHint": "Paste this line into your site, right before </body>.",
  "voice.assistant.copy": "Copy the code",
  "voice.assistant.copied": "Copied",
  "voice.assistant.publicLink": "Direct link",

  // ── The agency numbers inventory (/dashboard/numbers) ──────────────────
  //
  // Status words are NOT redefined here: the four labels come from
  // `voice.numbers.status.*` via NUMBER_STATUS_LABEL, the same vocabulary the
  // Voice page and the setup wizard already use. A fifth word for the same
  // four states is how an operator ends up unsure whether "Released" and
  // "Out of service" are the same thing.
  "numbers.title": "Phone numbers",
  "numbers.subtitle": "Every number we hold, the company on it, and where it can go next.",
  "numbers.inventory": "In the inventory",
  "numbers.empty.title": "No phone numbers yet",
  "numbers.empty.body": "Buy a number at Telnyx, then assign it to a company from that company's Voice page. It shows up here with every other number you hold.",
  "numbers.on": "On {account}",
  // The join to `accounts` came back empty — same wording as the setup
  // wizard's own fallback, for the same reason.
  "numbers.unknownAccount": "an account we couldn't name",
  "numbers.noCarrierId": "No carrier ID",
  "numbers.move": "Move…",
  "numbers.moveTo": "Move to",
  // Accessible name for the destination picker. Every row has one, so without
  // the number in the name a screen reader reads a column of identical
  // "Move to" selects.
  "numbers.moveToLabel": "Company to move {e164} to",
  "numbers.moveSubmit": "Move",
  // Accessible names for the two row buttons. Every row's visible label is
  // the same word, so without the number in the name a screen reader reads a
  // column of identical "Move…" and "Take out of service" controls with no
  // way to tell which line each one touches.
  "numbers.moveLabel": "Move {e164} to another company",
  "numbers.releaseLabel": "Take {e164} out of service",
  "numbers.moveNone": "Every other company already has a number of its own.",
  "numbers.moved": "{e164} now answers as {account} — if it's pointed at BIS at the carrier",
  "numbers.sameAccount": "That number is already on this company.",
  "numbers.notFound": "We couldn't find that number — this page may be out of date.",
  "numbers.destinationMissing": "We couldn't find that company — this page may be out of date.",
  // Archived is the one account state that means "this company is over".
  // Paused is not: pausing is what you do to a client who may come back, and
  // giving them a number again is how they come back.
  "numbers.destinationArchived": "That company is archived. Un-archive it before giving it a phone number.",
  // Taking a number out of service without moving it: the churn case. The
  // number stays on the old company's row, costing line rental and still
  // dialable, but it stops answering — and it stops occupying that company's
  // one active-number slot, which is what frees the company up to be reused.
  "numbers.release": "Take out of service",
  "numbers.releaseConfirm": "Yes, stop answering {e164}",
  "numbers.releaseWarning": "{account} stops answering calls on this number the moment you do this.",
  "numbers.released": "{e164} is out of service",
  "numbers.releaseFailed": "Couldn't take that number out of service. Try again.",
  "numbers.alreadyReleased": "That number is already out of service.",

  // ── The carrier half (Telnyx voice routing) ───────────────────────────
  //
  // Reported per number, because the 2026-09-16 incident was invisible: a
  // number sat in this list looking healthy while the phone company sent its
  // calls somewhere else entirely. "Routed here" is the only state that means
  // a caller dialling this number reaches the company on its row.
  "numbers.routing.routed": "Routed here",
  "numbers.routing.elsewhere": "Goes elsewhere",
  "numbers.routing.unrouted": "No routing",
  "numbers.routing.absent": "Not in Telnyx",
  // NEVER an accusation — this is "we could not ask", not "it is broken".
  "numbers.routing.unchecked": "Not checked",
  "numbers.routing.repair": "Point at BIS",
  "numbers.routing.repairLabel": "Point {e164} at BIS at the carrier",
  "numbers.routing.repairing": "Pointing…",
  "numbers.routing.repaired": "{e164} now comes to BIS",
  "numbers.routing.repairFailed": "Couldn't change that number's routing at Telnyx. Try again.",
  "numbers.routing.checkFailed": "Couldn't reach Telnyx to check that number.",
  "numbers.routing.alreadyRouted": "That number already comes to BIS.",
  "numbers.routing.notAtCarrier": "That number isn't in your Telnyx account, so we can't route it. Check which carrier holds it.",
  "numbers.routing.notConfigured": "Routing isn't wired up yet — set TELNYX_VOICE_CONNECTION_ID to the BIS Platform Voice app's id.",
  // Shown in place of the whole routing column when we could not ask at all,
  // so the blank is explained rather than read as "everything is fine".
  // Three different faults used to produce the same blank column: no API key,
  // no connection id, and a carrier that would not answer. They need
  // different fixes, so they say different things — naming the env var is the
  // point on an agency-only operator screen, and a variable's NAME is not a
  // secret.
  "numbers.routing.missingConfig":
    "Carrier routing isn't being checked: {vars} not set for this environment. A number still has to be pointed at BIS under Voice → Routing in Telnyx before callers reach the company on its row.",
  "numbers.routing.lookupFailed":
    "Couldn't reach Telnyx just now, so routing isn't shown. The numbers below and their companies are unaffected.",
  // Replaces the standing carrier sentence once routing IS checkable: the app
  // can now see and fix where a number points, so the remaining caveat is
  // only about numbers held at another carrier.
  "numbers.routing.seam":
    "A number must say Routed here for callers to reach the company on its row. One held at another carrier can't be checked or fixed from here.",

  // The review request's default body. `{name}` is the house placeholder,
  // filled at send time with the customer-facing brand name (never
  // accounts.name); the NoName variant drops the identifying clause rather
  // than inventing one. Both stay inside GSM-7 on purpose — a curly quote
  // or an accented vowel would flip every SMS to UCS-2 at 70 chars/segment.
  // The trailing colon is where the review link is appended
  // (composeReviewRequestSms); the email template renders it as a button.
  "automations.review.defaultBody": "Thanks for choosing {name}! If you have a minute, we'd love a quick review:",
  "automations.review.defaultBodyNoName": "Thanks for choosing us! If you have a minute, we'd love a quick review:",
  // The no-show nudge's default body. Same rules as the review request's:
  // `{name}` filled at send time with the customer-facing brand name; the
  // NoName variant drops the clause; GSM-7 throughout (straight apostrophe).
  // The trailing colon is where the booking-page link is appended
  // (composeNoShowNudgeSms); the email template renders it as a button.
  // Short on purpose: sent with a real 38-character booking link and the
  // opt-out sentence, it is ONE GSM-7 segment for a company name of up to 36
  // characters (measured in no-show-nudge-copy.test.ts). The longer first
  // draft crossed into a second billed message at 13.
  "automations.noShow.defaultBody": "We missed you at your appointment with {name}. Pick a new time here:",
  "automations.noShow.defaultBodyNoName": "We missed you at your appointment. Pick a new time here:",
  // The text reminder. The LEAD carries the appointment time and is never
  // the operator's to place — `{when}` is formatWhen's output in the
  // booker's zone; the operator's prose (or this default) follows it.
  "automations.smsReminder.lead": "Reminder: your appointment with {name} is {when}.",
  "automations.smsReminder.leadNoName": "Reminder: your appointment is {when}.",
  "automations.smsReminder.defaultBody": "Reply to this text if you need to make a change.",
  // The instant reply to a new web-form lead (Milestone C) — sent the moment
  // a submission with a phone number lands, in the language the form was
  // filled in (the submission's locale), so it matches the receipt email the
  // same person gets in the same minute. TWO defaults per language: `{name}`
  // is the house placeholder, filled with the customer-facing brand name on
  // the settings page ONLY — the send path sends the saved text verbatim and
  // never resolves a name; the NoName variants drop the opening clause rather
  // than invent a noun. Every one of the four is ONE GSM-7 segment for a
  // GSM-7 company name (measured in instant-reply-copy.test.ts); SENT, with
  // the opt-out sentence, the Spanish holds a name of up to 36 characters and
  // the English up to 32 (the Spanish was trimmed for this: its first draft
  // crossed into a second billed message at 13). The Spanish
  // is written with no á/í/ó/ú, the text-back's rule (voice.textback.*), and
  // in the tú form the receipt email uses ("Recibimos tu mensaje…"). No em
  // dash anywhere: it is outside GSM-7.
  "automations.instantReply.defaultBodyEn": "Hi, this is {name}. We got your message and will be in touch shortly. Reply here if you'd like to add anything.",
  "automations.instantReply.defaultBodyNoNameEn": "We got your message and will be in touch shortly. Reply here if you'd like to add anything.",
  "automations.instantReply.defaultBodyEs": "Hola, somos {name}. Recibimos tu mensaje y te contactaremos pronto. Responde si quieres agregar algo.",
  "automations.instantReply.defaultBodyNoNameEs": "Recibimos tu mensaje y te contactaremos pronto. Responde si quieres agregar algo.",
  // Automations page — agency-only, like Voice. Plain admin language; the
  // recipe names are the things a business owner would call them.
  "automations.title": "Automations",
  "automations.agencyOnly": "Only the agency may manage automations.",
  "automations.bodyTooLong": "Keep the message to 1,000 characters at most.",
  "automations.review.title": "Review requests",
  "automations.review.body": "The morning after a job is marked completed, ask the customer for a review. If the follow-up email is on, this waits one more morning so the two never land together. Off until you turn it on.",
  "automations.review.enabled": "Send review requests",
  "automations.review.channel": "Send by",
  "automations.review.channel.email": "Email",
  "automations.review.channel.sms": "Text message",
  "automations.review.url": "Review link",
  "automations.review.urlHint": "Where the customer leaves the review, for example your Google Business review link. It is added to the end of the message.",
  "automations.review.message": "Message",
  "automations.review.messageHint": "Leave blank to send our default message.",
  "automations.review.save": "Save review requests",
  "automations.review.saved": "Review requests saved",
  "automations.review.saveFailed": "Could not save review requests.",
  "automations.review.urlRequired": "Add the review link before turning this on.",
  "automations.review.urlInvalid": "The review link needs to be a full web address, like https://g.page/r/.../review",
  // Shared channel labels for the SMS-capable recipes.
  "automations.channel.email": "Email",
  "automations.channel.sms": "Text message",
  "automations.noShow.title": "No-show follow-ups",
  "automations.noShow.body": "The morning after a booking is marked no-show, invite the customer to pick a new time. Your booking page link is added to the end of the message. Off until you turn it on.",
  "automations.noShow.enabled": "Send no-show follow-ups",
  "automations.noShow.channel": "Send by",
  "automations.noShow.message": "Message",
  "automations.noShow.messageHint": "Leave blank to send our default message.",
  "automations.noShow.linkHint": "Added to the end: {link}",
  "automations.noShow.calendarOff": "Your booking page is off, so there is nowhere to send people yet. Turn it on under Calendar first.",
  "automations.noShow.save": "Save no-show follow-ups",
  "automations.noShow.saved": "No-show follow-ups saved",
  "automations.noShow.saveFailed": "Could not save no-show follow-ups.",
  "automations.smsReminder.title": "Text reminders",
  "automations.smsReminder.body": "About two hours before an appointment, text the customer a reminder with the time, on top of the email reminder the day before. Text only. Off until you turn it on.",
  "automations.smsReminder.enabled": "Send text reminders",
  "automations.smsReminder.message": "Closing line",
  "automations.smsReminder.messageHint": "Comes after the appointment time. Leave blank to send our default.",
  "automations.smsReminder.preview": "Preview",
  "automations.smsReminder.save": "Save text reminders",
  "automations.smsReminder.saved": "Text reminders saved",
  "automations.smsReminder.saveFailed": "Could not save text reminders.",
  "automations.instantReply.title": "Instant reply to new leads",
  "automations.instantReply.body": "The moment someone submits one of your forms with a phone number, text them from your number in the language they used, on top of the email receipt they already get. Off until you turn it on, and only for companies whose A2P registration is approved.",
  "automations.instantReply.enabled": "Send an instant reply",
  "automations.instantReply.messageEn": "English message",
  "automations.instantReply.messageEnHint": "Sent to people who filled the form in English. Sent as written, with the opt-out sentence added at the end.",
  "automations.instantReply.messageEs": "Spanish message",
  "automations.instantReply.messageEsHint": "Sent to people who filled the form in Spanish. Sent as written, with the opt-out sentence added at the end.",
  "automations.instantReply.previewEn": "English preview",
  "automations.instantReply.previewEs": "Spanish preview",
  "automations.instantReply.save": "Save instant reply",
  "automations.instantReply.saved": "Instant reply saved",
  "automations.instantReply.saveFailed": "Could not save the instant reply.",
  "automations.instantReply.bodiesRequired": "Write both the English and the Spanish message before turning this on.",
  // Part B — the appointment confirmation, two days out. The LEAD is fixed
  // copy the operator cannot rearrange: "either way we'll see it" is the
  // whole reason a YES gets no text back (spec decision 6), so it cannot sit
  // in an editable field anyone can delete. `{name}` is the customer-facing
  // brand name, `{when}` is formatWhen's output in the BOOKER's zone; the
  // NoName variant drops the opening clause rather than invent a noun.
  // GSM-7 THROUGHOUT, and the sentence break is a PERIOD, not an em dash:
  // one em dash drops the whole text to UCS-2 at 70 characters a segment
  // (segments.ts), which measured 3 segments against the period's 2 on every
  // confirmation this recipe ever sends. appointment-confirm-copy.test.ts
  // pins the encoding.
  "automations.appointmentConfirm.lead": "Hi, it's {name}. You're booked for {when}. Reply YES to confirm or NO if you need a different time. Either way we'll see it.",
  "automations.appointmentConfirm.leadNoName": "You're booked for {when}. Reply YES to confirm or NO if you need a different time. Either way we'll see it.",
  "automations.appointmentConfirm.title": "Appointment confirmations",
  "automations.appointmentConfirm.body": "Two days before an appointment, text the customer to confirm. They reply YES or NO and you see the answer on the booking. Nothing is cancelled automatically. Text only. Off until you turn it on.",
  "automations.appointmentConfirm.enabled": "Ask customers to confirm",
  "automations.appointmentConfirm.message": "Closing line",
  "automations.appointmentConfirm.messageHint": "Optional. Comes after the confirmation question. Leave blank to send just the question.",
  "automations.appointmentConfirm.preview": "Preview",
  "automations.appointmentConfirm.save": "Save appointment confirmations",
  "automations.appointmentConfirm.saved": "Appointment confirmations saved",
  "automations.appointmentConfirm.saveFailed": "Could not save appointment confirmations.",
  // The answer, on the calendar's bookings list (Task 4's badge reads these).
  "calendar.bookings.confirmed": "Confirmed by text",
  "calendar.bookings.confirmDeclined": "Asked for a different time",

  // Part B — the referral ask, the completed-job ladder's THIRD rung (day
  // one "how did it go?", day two "would you leave a review?", day three
  // this). `{name}` is the customer-facing brand name, filled at send time;
  // the NoName variants drop the identifying clause rather than invent one.
  // It asks for a NAME, never a rating, and carries NO LINK anywhere — the
  // config has no url field, so an operator cannot turn it into a second
  // review request by configuration either. GSM-7 throughout (straight
  // apostrophe, no em dash): one character outside the set drops the whole
  // text to UCS-2 at 70 characters a segment.
  //
  // LENGTH IS A COST, not a style note, and the budget is stated rather than
  // hoped for: `sendAutomationSms` appends " Reply STOP to opt out." (23
  // septets) to every text, GSM-7 holds 160 in one segment, and this template
  // is 110 — so ONE SEGMENT HOLDS A BRAND NAME OF 27 CHARACTERS OR FEWER.
  // "Valley Air Conditioning" (23) and "Rio Grande Valley Roofing" (25) both
  // fit. The first draft of this line was 124 septets, which left 13, and
  // "Sunrise Plumbing" alone pushed every send to two billed segments — so
  // the ask was tightened ("Know anyone who needs the same done? Send their
  // name and number") rather than the promise dropped. A name carrying an
  // accent is UCS-2 and three parts whatever this says, which is why
  // referral-ask-copy.test.ts measures "García Roofing" too and the card
  // renders the real count.
  // Shared by the two part-B cards that count a TEXT (referral ask, quote
  // follow-up). The count they show is of the DISCLOSED body — `withOptOut`,
  // appended by `sendAutomationSms` on every send — and those 23 characters
  // appear nowhere else on the page, because the message box's placeholder
  // shows the undisclosed default. Rendered only beside the segment counter,
  // never on the message hint: the hint shows for the email channel too, and
  // an email has no opt-out sentence appended and no count at all.
  //
  // No quotation marks around the sentence: React escapes `"` to `&quot;` in
  // the rendered markup, so a key carrying one cannot be asserted literally
  // against the HTML, and the guard would end up written around the escaping
  // instead of around the copy.
  "automations.optOutCounted": "Every text ends with Reply STOP to opt out. That sentence is included in the count above.",
  "automations.referral.defaultBody": "Thanks again from {name}. Know anyone who needs the same done? Send their name and number and we'll look after them.",
  "automations.referral.defaultBodyNoName": "Thanks again. Know anyone who needs the same done? Send their name and number and we'll look after them.",
  "automations.referral.emailSubject": "One favor, from {name}",
  "automations.referral.emailSubjectNoName": "One favor",
  "automations.referral.title": "Referral asks",
  "automations.referral.body": "Ask the customer whether they know someone else who needs the same work. It goes the morning after the last message this job sent, and never on the same morning as one. If review requests are on, that one goes first. Off until you turn it on.",
  "automations.referral.enabled": "Ask for referrals",
  "automations.referral.channel": "Send by",
  "automations.referral.message": "Message",
  "automations.referral.messageHint": "Leave blank to send our default message. No link is added — this asks for a name, not a rating.",
  "automations.referral.save": "Save referral asks",
  "automations.referral.saved": "Referral asks saved",
  "automations.referral.saveFailed": "Could not save referral asks.",
  // B21: the referral EMAIL carries the check-in's footer, so it needs the
  // same two things. Saved ON by email → `missing*`; otherwise `beforeOn*`.
  "automations.referral.missingBoth": "Referral asks can't go out by email yet: they need the company's mailing address, printed at the bottom of every one, and a reply-to address, so a customer who replies reaches the company. Add both on the {settingsLink} page.",
  "automations.referral.missingMailingAddress": "Referral asks can't go out by email yet: they need the company's mailing address, printed at the bottom of every one. Add it on the {settingsLink} page.",
  "automations.referral.missingReplyTo": "Referral asks can't go out by email yet: they need a reply-to address, so a customer who replies reaches the company. Add one on the {settingsLink} page.",
  "automations.referral.beforeOnBoth": "Before these go out by email, add the company's mailing address, printed at the bottom of every one, and a reply-to address, so a customer who replies reaches the company. Both are on the {settingsLink} page.",
  "automations.referral.beforeOnMailingAddress": "Before these go out by email, add the company's mailing address, printed at the bottom of every one. It's on the {settingsLink} page.",
  "automations.referral.beforeOnReplyTo": "Before these go out by email, add a reply-to address, so a customer who replies reaches the company. It's on the {settingsLink} page.",

  // Part B — the reactivation check-in (a past customer gone quiet). EMAIL
  // ONLY, so unlike every other recipe's copy in this file there is no GSM-7
  // budget to keep: nothing here is ever measured by `segmentsFor`, because
  // the due-row carries no phone number at all. The two numbers the card
  // restates in words (the month range, the daily limit) cannot be
  // interpolated from a constant, so `reactivation-copy.test.ts` pins each of
  // them against the constant it has to agree with.
  "automations.reactivation.defaultBody": "Hi, it's {name}. It's been a while since we were out at your place. If anything needs looking at before the season, just reply and we'll get you on the schedule.",
  "automations.reactivation.defaultBodyNoName": "Hi. It's been a while since we were out at your place. If anything needs looking at before the season, just reply and we'll get you on the schedule.",
  "automations.reactivation.subject": "A note from {name}",
  "automations.reactivation.subjectNoName": "Checking in",
  "automations.reactivation.title": "Checking in with past customers",
  "automations.reactivation.body": "Email a past customer who hasn't been in touch for a while. Only people whose job you completed, at most five a day, and only once each — ever. Email only. Off until you turn it on.",
  "automations.reactivation.enabled": "Check in with past customers",
  "automations.reactivation.months": "Quiet for at least",
  "automations.reactivation.monthsUnit": "months",
  "automations.reactivation.monthsHint": "Between 6 and 18. Nine is a good default for seasonal work: last spring's customer still knows you.",
  "automations.reactivation.message": "Message",
  "automations.reactivation.messageHint": "Leave blank to send our default message. No discount, no offer — just an open door.",
  "automations.reactivation.limitNote": "At most five a day, oldest first, and never twice to the same person.",
  "automations.reactivation.save": "Save check-ins",
  "automations.reactivation.saved": "Check-ins saved",
  "automations.reactivation.saveFailed": "Could not save check-ins.",
  "automations.reactivation.monthsInvalid": "Choose a number of months between 6 and 18.",
  // Decision A (2026-09-22): the footer every check-in carries — why it came
  // and how to stop it — above the business's postal address. The way out is
  // a REPLY, not a link: the email carries no link of any kind, and one
  // check-in per person, ever, leaves no later message to suppress.
  "automations.reactivation.footerReason": "You're getting this because you've been a customer of {name}. If you'd rather not hear from us, reply and let us know.",
  "automations.reactivation.footerReasonNoName": "You're getting this because you've been a customer of ours. If you'd rather not hear from us, reply and let us know.",
  // What the card and the save say when the email has nothing to stand on.
  // `{settingsLink}` is split out by the card and rendered as a link to the
  // Settings page, where the agency edits branding (this card is agency-only).
  // `missing*` is the amber Notice, shown only while the recipe is saved ON;
  // `beforeOn*` is the muted line shown while it is off or never saved.
  "automations.reactivation.missingBoth": "Check-ins can't go out yet: they need the company's mailing address, printed at the bottom of every one, and a reply-to address, so a customer who replies reaches the company. Add both on the {settingsLink} page.",
  "automations.reactivation.missingMailingAddress": "Check-ins can't go out yet: they need the company's mailing address, printed at the bottom of every one. Add it on the {settingsLink} page.",
  "automations.reactivation.missingReplyTo": "Check-ins can't go out yet: they need a reply-to address, so a customer who replies reaches the company. Add one on the {settingsLink} page.",
  "automations.reactivation.beforeOnBoth": "Before you turn this on, add the company's mailing address, printed at the bottom of every check-in, and a reply-to address, so a customer who replies reaches the company. Both are on the {settingsLink} page.",
  "automations.reactivation.beforeOnMailingAddress": "Before you turn this on, add the company's mailing address, printed at the bottom of every check-in. It's on the {settingsLink} page.",
  "automations.reactivation.beforeOnReplyTo": "Before you turn this on, add a reply-to address, so a customer who replies reaches the company. It's on the {settingsLink} page.",
  "automations.reactivation.needsMailingAddress": "Add the company's mailing address in Settings before turning this on.",
  "automations.reactivation.needsReplyTo": "Add a reply-to address in Settings before turning this on.",

  // Part B — quote follow-ups. NO EM DASH and no character outside GSM-7 in
  // `defaultBody`/`defaultBodyNoName`: this recipe is SMS-capable and one
  // such character drops the whole body to UCS-2 at 70 characters a segment
  // (segments.ts:15-19). The two range sentences restate 1 and 30 in prose
  // because a static catalogue cannot interpolate a constant;
  // quote-followup-copy.test.ts is what keeps them honest against
  // QUOTE_FOLLOWUP_MIN_QUIET_DAYS / QUOTE_FOLLOWUP_MAX_QUIET_DAYS.
  "automations.quoteFollowup.defaultBody": "Hi, it's {name}. Just checking you got the quote we sent. Happy to answer anything or adjust it. Any questions?",
  "automations.quoteFollowup.defaultBodyNoName": "Just checking you got the quote we sent. Happy to answer anything or adjust it. Any questions?",
  "automations.quoteFollowup.emailSubject": "About your quote from {name}",
  "automations.quoteFollowup.emailSubjectNoName": "About your quote",
  "automations.quoteFollowup.title": "Quote follow-ups",
  "automations.quoteFollowup.body": "This watches your pipeline. Deals only get there when you or your team put them there, so nothing happens on its own. Move a deal into the stage you pick, and after a few quiet days with no reply it checks in about the quote. Off until you turn it on.",
  "automations.quoteFollowup.enabled": "Follow up on quiet quotes",
  "automations.quoteFollowup.stage": "Pipeline stage to watch",
  "automations.quoteFollowup.stageHint": "Pick the stage you move a deal to once you've sent the quote.",
  "automations.quoteFollowup.stagePlaceholder": "Choose a stage",
  "automations.quoteFollowup.stageMissing": "The stage this automation watches is gone. Pick another one before this can run again.",
  "automations.quoteFollowup.noStages": "This company has no pipeline stages yet, so there is nothing to watch. Set up the pipeline first.",
  "automations.quoteFollowup.quietDays": "Days with no reply",
  "automations.quoteFollowup.quietDaysHint": "Between 1 and 30. Three is a good default, long enough to not feel pushy.",
  "automations.quoteFollowup.quietDaysInvalid": "Choose a number of days between 1 and 30.",
  "automations.quoteFollowup.stageRequired": "Pick the stage to watch before saving.",
  "automations.quoteFollowup.channel": "Send by",
  "automations.quoteFollowup.message": "Message",
  "automations.quoteFollowup.messageHint": "Leave blank to send our default message. The price and the deal's name are never included.",
  "automations.quoteFollowup.save": "Save quote follow-ups",
  "automations.quoteFollowup.saved": "Quote follow-ups saved",
  "automations.quoteFollowup.saveFailed": "Could not save quote follow-ups.",

  // Part C — the Quiet hours card (agency, on the Automations page).
  "automations.quiet.title": "Quiet hours",
  "automations.quiet.body": "No automated texts or emails go to your customers between these hours. Anything due overnight waits and goes at the end. Your phone and website assistant still answer.",
  "automations.quiet.enabled": "Use quiet hours",
  "automations.quiet.from": "From",
  "automations.quiet.to": "Until",
  "automations.quiet.zone": "Times are in {zone}",
  "automations.quiet.save": "Save quiet hours",
  "automations.quiet.saved": "Quiet hours saved",
  "automations.quiet.saveFailed": "Could not save quiet hours.",
  "automations.quiet.invalidTime": "Enter both times as hours and minutes, like 9:00 PM.",
  "automations.quiet.readFailed": "Couldn't load the current quiet hours. Reload the page before changing them.",
  "automations.activityLink": "See what went out",
  // The page's four group headings, in the order the customer lives it; the
  // last group is the one rule that holds every automation back.
  "automations.group.firstTouch": "When someone gets in touch",
  "automations.group.appointment": "Around the appointment",
  "automations.group.afterJob": "After the job",
  "automations.group.rules": "Rules for every automation",

  // Part C — the Activity page, /dashboard/accounts/<id>/activity. BOTH
  // audiences: this is the record of what the system did on the client's
  // behalf, the first place to look when an automation misfires.
  // The nav label reads "What went out", matching the page's own title
  // (`activity.title` below) rather than "Activity" — that word already
  // names the account dashboard's Activity card (bookings, leads, call
  // outcomes), a different, client-visible surface (cleanup item 2,
  // 2026-09-21). `dashboard.activity.*` and `contact.activity` are that
  // card's own keys and are untouched.
  "nav.activity": "What went out",
  "activity.title": "What went out",
  "activity.usage.title": "This month",
  "activity.usage.texts": "Texts sent",
  "activity.usage.emails": "Emails sent",
  "activity.usage.conversations": "Website chats",
  "activity.usage.calls": "Calls handled",
  "activity.usage.capRecipe": "Most automations: up to {cap} a day",
  "activity.usage.capDay": "Up to {cap} a day",
  "activity.usage.held": "{n} waiting",
  "activity.usage.skipped": "{n} skipped",
  "activity.usage.topReason": "most often: {reason}",
  "activity.usage.error": "Couldn't load this month's numbers. Reload the page to try again.",
  "activity.empty.title": "Nothing has gone out yet",
  "activity.empty.body": "Every text, email and conversation the system handles for this company shows up here the moment a reminder, a review request or the website or phone assistant sends something.",
  "activity.error": "Couldn't load the history. Reload the page to try again.",
  "activity.col.when": "When",
  "activity.col.what": "What",
  "activity.col.who": "Who",
  "activity.col.channel": "How",
  "activity.col.status": "Status",
  "activity.status.sent": "Sent",
  "activity.status.held": "Waiting",
  "activity.status.skipped": "Skipped",
  "activity.status.failed": "Failed",
  "activity.channel.sms": "Text",
  "activity.channel.email": "Email",
  "activity.channel.ai": "Assistant",
  "activity.older": "Older",
  "activity.newer": "Newer",
  "activity.source.reminders": "Booking reminders",
  "activity.source.followups": "Follow-up emails",
  "activity.source.weekly_report": "Weekly report",
  "activity.source.concierge": "Website assistant",
  "activity.source.voice": "Phone assistant",

  // The client-facing Calls log — /dashboard/accounts/<id>/calls. BOTH
  // audiences: this is the client's own business data (who rang, what the
  // receptionist did about it), not agency work about the client, so it is
  // gated by requireAccountAccess like contacts and the calendar are — and
  // it is the one screen where a client SEES what they are paying for.
  //
  // `calls.usage` interpolates like `setup.progress` above: the component
  // .replace()s the placeholders, so a future translation may reorder them.
  "calls.title": "Calls",
  "calls.usage": "{n} of {cap} calls today",
  // The meter's accessible NAME. Deliberately not the sentence above: that is
  // already the bar's `aria-valuetext`, and reusing it would have a screen
  // reader read the same count twice in a row.
  "calls.usageLabel": "Daily call usage",
  "calls.empty.title": "No calls yet",
  "calls.empty.body":
    "When Sofía answers a call, it will appear here with its transcript and outcome.",
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
  // The caller reached a person (0037). One plain word, like its five
  // siblings — "Handed off" and "Escalated" are both things this product
  // would say to itself, not things a business owner says about their own
  // phone ringing.
  "calls.outcome.transferred": "Transferred",

  // The missed-call text-back that never left the building. There is no retry
  // anywhere in that path — one cron, no queue — so saying so on the row the
  // operator is already reading is the entire mitigation.
  //
  // "didn't send", not "failed": the operator needs to know the caller is
  // still sitting there un-texted, and no part of that sentence should make
  // them wonder whether it might yet go out on its own. It won't.
  "calls.textbackFailed": "Text-back didn't send",
  // The detail page only — the list row is a whole-row click target and gets
  // the badge alone (a nested button there would double-fire the row's own
  // navigation and confuse the tab order).
  "calls.textbackResend": "Send it now",
  // The one line under the badge on the detail page, and it says the thing
  // the operator cannot see anywhere else: `failed` means the provider refused
  // and NOTHING was delivered, and there is no queue and no cron that will
  // have another go. If they want this caller texted, it is on them, now.
  //
  // "The text we tried to send", not a bare "nothing" — the badge stays on this
  // call forever now, including after a later text to the same person did go
  // out, and a flat "nothing reached them" would be a lie in exactly that case.
  // The sentence is about THIS call's text-back, which never arrived and never
  // will.
  "calls.textbackFailedBody":
    "The text we tried to send never reached them, and nothing will try again on its own.",
  // Where "Send it now" WOULD have been, once a later text to this person went
  // out fine. The button is withdrawn on purpose — pressing it would text them
  // the same words a second time — but withdrawing it silently left the
  // operator reading "nothing will try again on its own" beside no way to act,
  // and the obvious next move is to pick up their own phone and send exactly
  // the duplicate the withdrawal exists to prevent. So say why it is gone.
  //
  // "A later text", not "your resend": we do not know who sent it or what it
  // said — only that something outbound reached this person after this call's
  // text-back failed. The badge above is untouched either way; that text-back
  // failed, and a later message does not make it un-fail.
  "calls.textbackSuperseded":
    "A later text did go out to them, so there's nothing left to send here.",

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
  // The stepper rail's own accessible name. Distinct from `setup.title`
  // on purpose: that string is the page <h1>, and reusing it here would
  // name two different things identically for a screen reader.
  "setup.railLabel": "Setup steps",
  "setup.backToSetup": "Back to setup",
  "setup.progress": "{done} of {total} steps done",
  "setup.progressLabel": "Setup progress",
  "setup.nextUp": "Next up",
  "setup.state.done": "Done",
  "setup.state.open": "To do",
  // The single step the rail rings and the pane badges "Next up" — distinct
  // from the seven other not-done steps, which stay "To do".
  "setup.state.next": "Current",
  "setup.state.skipped": "Skipped",
  // Never "not done". A read that threw tells us nothing about the step it
  // was going to answer for, and the whole point of this page is that a green
  // tick means the thing is actually true.
  "setup.state.unknown": "Couldn't check — reload to retry",
  // Only ever shown for test_call/go_live (lib/setup/setup-rail.ts's
  // isLockedStep locks exactly those two) — and only for a step whose read
  // actually settled; a step that couldn't be verified stays "Couldn't
  // check", never "Locked".
  "setup.state.locked": "Locked",
  // The two-pane wizard's locked-step banner and rail hint. Reused for BOTH
  // — same data (lockedPrereqKeys mapped through STEP_COPY titles), one
  // string. go_live reuses `setup.goLive.blocked` instead of this one (see
  // setup-rail.tsx's `lockedHint`) — it already exists and already handles
  // the unknown-prerequisite case, so this key is only ever test_call's.
  // WORDED IDENTICALLY to `setup.goLive.blocked` on purpose: the two are
  // one concept ("these steps block this one") shown one rail click apart,
  // and two phrasings for that read as two different rules.
  "setup.locked.blockedBy": "Finish these steps first: {steps}",
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
    "Greeting, business facts, and persona for Sofía.",
  "setup.step.website_assistant.title": "Website assistant",
  "setup.step.website_assistant.help":
    "Put the same receptionist on the website. It answers questions and takes names around the clock, and files them into a form you choose. The last row turns done the first time a visitor uses it from your site.",
  "setup.step.website_assistant.row1.title": "Write the greeting and facts",
  "setup.step.website_assistant.row2.title": "Publish a form for its leads",
  "setup.step.website_assistant.row2.body":
    "It fills in a name, an email or phone, and a message.",
  "setup.step.website_assistant.row3.title": "Turn it on and pick the form",
  "setup.step.website_assistant.row4.title": "Paste the code into the website",
  "setup.step.website_assistant.row4.off": "The line to paste appears here once it is on.",
  "setup.step.website_assistant.row4.pasteHint":
    "Paste it just before </body>. In WordPress, Wix or Squarespace that is the site's footer or custom-code setting.",
  "setup.step.website_assistant.row4.seen": "A visitor has opened it from your site",
  "setup.step.website_assistant.row4.notSeen": "Not seen on your site yet",
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
  "setup.rename.empty": "A company needs a name — this one can't be blank.",
  "setup.rename.failed": "Couldn't rename this company. Try again.",
  "setup.rename.label": "Company name",
  // This copy has answered the audience question wrongly twice. "They never
  // see it" was false while a fresh account had no brand name: the client's
  // sidebar and dashboard greeting are `brandName ?? name` (app-sidebar.tsx,
  // dashboard/page.tsx), so until Branding was filled in the client read
  // THIS label. Then "until you set a brand name … it's what they see" was
  // written for that window — and the window closed with the brand-name
  // resolver (spec 2026-09-07-brand-name-resolver): `createAccount` seeds
  // `brand_name` from this very label, the Branding save refuses to blank it,
  // and `brandDisplayName` (lib/email/templates/shell.ts) takes no account
  // name at all. Through the product that fallback never fires, so this
  // label reaches no client and no customer. The mistake to prevent now is
  // the OPPOSITE one: an operator renaming here and expecting the client's
  // workspace, or their customers' emails, to follow. They do not — the
  // seeded brand name is a copy that drifts the moment either side is edited
  // alone (renameAccountAction's doc comment, setup/actions.ts) — so the copy
  // points at Branding for anything anyone else sees.
  "setup.rename.help":
    "Your own label for this client — only you see it. Their brand name started as a copy of it; change what they and their customers see in Branding.",

  // ── Command palette (DESIGN.md's ⌘K key pattern) ───────────────────────
  "palette.placeholder": "Search contacts, calls, pages…",
  "palette.searchHint": "Search",
  // Two, because the hint has to name the key this machine actually has.
  "palette.shortcut.mac": "⌘K",
  "palette.shortcut.other": "Ctrl K",
  "palette.group.navigation": "Go to",
  "palette.group.settings": "Settings",
  "palette.group.actions": "Actions",
  "palette.group.contacts": "Contacts",
  "palette.group.calls": "Calls",
  "palette.group.conversations": "Conversations",
  "palette.hint": "Keep typing to search your contacts, calls and conversations.",
  "palette.empty": "Nothing matches “{query}”.",
  // Names the failure instead of showing an empty list. An empty list would
  // say "you have no such contact", which is a lie about a broken request.
  "palette.error": "Couldn't search your records just now.",
  "palette.retry": "Try again",
  "palette.action.toggleTheme": "Switch between light and dark",
  "palette.settings.clientAccess": "Client access",
  "palette.settings.sendingAddress": "Sending address",
  "palette.settings.customFields": "Custom fields",
  "palette.settings.customValues": "Custom values",
  "palette.settings.alertPhone": "Alert texts",
  "palette.settings.billing": "Billing",

  // ── /styleguide ────────────────────────────────────────────────────────
  "styleguide.title": "Style guide",
  "styleguide.body":
    "Every component this app draws, in the theme you're looking at right now. Switch themes with the toggle to check both.",
  // ── Website (the traffic section; spec 2026-09-07-website-traffic-design) ──
  "website.title": "Website",
  "website.period.7": "7D",
  "website.period.14": "14D",
  "website.period.30": "30D",
  "website.periodLabel.7": "The last 7 days",
  "website.periodLabel.14": "The last 14 days",
  "website.periodLabel.30": "The last 30 days",
  "website.updated": "Updated this morning",
  "website.updatedOn": "Last updated {date}",
  "website.stale": "We haven't been able to update these numbers since {date}. They're still right up to then.",
  "website.tile.visitors": "Visitors",
  "website.tile.pageviews": "Pageviews",
  "website.tile.fromGoogle": "From Google",
  "website.tile.topPage": "Top page",
  "website.tile.topPageDetail": "{visitors} visitors · {share} of all",
  "website.tile.noTopPage": "No page stood out yet",
  "website.summary.detail": "{visitors} people, {pageviews} pages. Your busiest day was {day}.",
  "website.chart.title": "Visitors by day",
  "website.chart.tooltip": "{visitors} visitors · {pageviews} pageviews",
  "website.chart.series.pageviewsThird": "Pageviews ÷ 3",
  "website.devices.phone": "Phone",
  "website.devices.desktop": "Desktop",
  "website.devices.tablet": "Tablet",
  "website.panel.pages": "Pages people read",
  "website.panel.sources": "Where visitors came from",
  "website.panel.places": "Where they were",
  "website.panel.devices": "Devices",
  "website.panel.empty": "Nothing here yet",
  "website.empty.title": "See who visits your website",
  "website.empty.body": "Where they come from, what they read, and how many there are, every morning.",
  "website.empty.askAgency": "Ask BIS about a website",
  "website.empty.askSubject": "A website for my business",
  "website.empty.link": "Link a site",
  "website.waiting.title": "Your first numbers arrive tomorrow morning",
  "website.waiting.body": "{domain} is connected. We collect a full day before showing anything, so nothing here is a guess.",
  "website.link.title": "Website",
  "website.link.body": "Connect the site BIS built for this client so their traffic shows up here every morning.",
  "website.link.project": "Vercel project",
  "website.link.domain": "Website address",
  "website.link.test": "Test connection",
  "website.link.testOk": "Connected — {visitors} visitors and {pageviews} pageviews in the last 7 days.",
  "website.link.testNotEnabled": "Analytics isn't switched on for that project yet. Run step 2 of the website setup runbook, then test again.",
  "website.link.testFailed": "Couldn't reach that project just now. Check the token in the platform settings and try again.",
  "website.link.projectRequired": "Pick the project this site is deployed from.",
  "website.link.domainRequired": "Enter the address customers use, like rioroofing.com.",
  "website.link.saved": "Site linked — the first numbers arrive tomorrow morning.",
  "website.link.linked": "Linked to {domain}",
  "website.link.noToken": "The platform's Vercel token isn't set, so projects can't be listed yet (runbook step 1).",
  "website.link.alreadyLinked": "That project is already linked to another client. A site belongs to one account — pick a different project, or unlink it there first.",
  "website.link.projectChange": "This client already has a site with traffic on record. Unlink it first (runbook: When something is wrong), then link the new project.",
  "website.link.saveFailed": "Couldn't save the link just now. Try again in a moment.",
  "website.link.unlink": "Unlink site",
  "website.link.unlinkTitle": "Unlink {domain}?",
  "website.link.unlinkBody": "This removes the {days} days of traffic stored for {domain}. The website itself is untouched. Link it again later and the next pull re-fetches the last 30 days from Vercel.",
  "website.link.unlinkBodyOne": "This removes the one day of traffic stored for {domain}. The website itself is untouched. Link it again later and the next pull re-fetches the last 30 days from Vercel.",
  "website.link.unlinkBodyNone": "Nothing has been stored for {domain} yet. The website itself is untouched.",
  "website.link.unlinking": "Unlinking…",
  "website.link.unlinkConfirm": "Unlink",
  "website.link.unlinked": "Site unlinked.",
  "website.link.unlinkFailed": "Couldn't unlink just now. Try again in a moment.",
  "website.link.notLinked": "No site is linked to this client.",

  // The account's "To do" screen (Task 3, read-only) — everything that
  // needs a human: open tasks, contacts owed a reply, and jobs nobody has
  // confirmed happened. `work.call` is deliberately absent: the "call"
  // WorkSource it would have named was specified, found unsatisfiable in
  // review, and withdrawn before implementation (spec §1.2) — an
  // unreturned call now surfaces as its own conversation row instead, via
  // `work.conversation`. The four `work.notNow`/`work.done`/
  // `work.booking.completed`/`work.booking.noShow` keys belong to Task 4's
  // action buttons, added here so this namespace is edited once rather
  // than twice; this read-only screen renders none of them.
  "work.title": "To do",
  "work.empty": "Nothing needs you right now.",
  "work.empty.body":
    "Tasks you create, contacts waiting on a reply, and jobs nobody has confirmed happened will show up here.",
  "work.bucket.overdue": "Overdue",
  "work.bucket.today": "Today",
  "work.bucket.waiting": "Waiting",
  "work.conversation": "Reply to {name}",
  "work.booking": "Did this job happen?",
  "work.notNow": "Not now",
  "work.done": "Done",
  "work.booking.completed": "It happened",
  "work.booking.noShow": "They didn't show",
  // Task 4's toasts for the four buttons above. One shared failure string —
  // every action here fails the same honest way (try again in a moment) —
  // and the booking close-out's OWN failure copy is never used: it passes
  // through whatever `setBookingStatusAction` (the calendar screen's own,
  // reused action) already returns, so the two screens never say two
  // different things about the same write.
  "work.done.toast": "Marked done.",
  "work.notNow.toast": "Moved to tomorrow.",
  // "Not now" on the zone-degrade path creates the task with no due date —
  // nothing actually moved to tomorrow, so that toast would be a lie here.
  "work.notNow.toastNoDate": "Added to your to-do list.",
  // The two close-out buttons are both irreversible and each arms a
  // different outbound message to the customer (a review request on
  // completion, a no-show follow-up on no-show — automations.noShow.title/
  // .body name that same automation for the operator elsewhere) — a shared
  // "Updated." toast made a misclick invisible. Each toast now names the
  // outcome that was actually recorded AND says a message may follow, so a
  // wrong click is caught immediately rather than discovered when the wrong
  // one goes out. Both say "may", never a bare promise: either automation
  // can decline a given row (no phone/email on file, the account's booking
  // page switched off, an unresolvable timezone, a quiet-hours gate, a
  // daily cap — see no-show-nudge.ts's own per-row refusal list), so
  // "will" would overclaim for a row the pass is about to skip.
  "work.booking.completed.toast": "Marked as completed. A review request may go out.",
  "work.booking.noShow.toast": "Marked as a no-show. A follow-up message may go out.",
  "work.actionFailed": "Couldn't update that just now. Try again in a moment.",
  // Task 5's dashboard row — a compact link into /tasks. `work.empty` above
  // (Task 3) already carries the zero-queue sentence, reused rather than
  // duplicated. The two below compose the non-empty count: "{count} things
  // to do" alone, or with " · {count} overdue" appended when the account has
  // any — see work-row.tsx's `workRowText`. `work.row.countOne` is the
  // singular's own whole-phrase twin, the same convention as
  // contacts.count/contacts.countOne above: a plural template reused for a
  // count of one shipped a live "1 people" bug on the Website screen once
  // already, and a count of one is not a corner case here — it is the
  // designed first experience (spec §3: dismissing a row is what first
  // populates `tasks` on an account with none). `work.row.overdue` needs no
  // singular twin of its own: "1 overdue" already reads correctly.
  "work.row.count": "{count} things to do",
  "work.row.countOne": "1 thing to do",
  "work.row.overdue": "{count} overdue",

  // Work Queue Task 6 — the agency-wide queue (/dashboard/work), agency-only
  // by construction (requireAgency, first line, before any read). Same three
  // buckets and the same row language as the per-account screen above, pooled
  // across every account instead of scoped to one, so every row also carries
  // that account's brand name. `work.title`/`work.empty`/`work.bucket.*` are
  // reused verbatim rather than duplicated — same convention work-row.tsx's
  // dashboard card already follows for `work.empty` — only the strings that
  // are genuinely agency-scope-specific get their own key below.
  "work.agency.title": "Everything that needs you",
  "work.agency.subtitle": "Every account, in one queue.",
  // work.empty ("Nothing needs you right now.") is reused as this screen's
  // own empty title; only the body differs, to say "every account" rather
  // than imply the one this reader happens to be looking at.
  "work.agency.empty.body":
    "Tasks, contacts waiting on a reply, and jobs nobody has confirmed happened will show up here, across every account.",
  // The empty state's own action (DESIGN.md rule 5 — the sentence plus the
  // action that causes it) — this screen pools read-only rows derived from
  // every account, so there is no single "create" action; the action is
  // going to the account list to create the work that would show up here.
  "work.agency.empty.action": "Go to Companies",
  // Marks a row whose account has outbound sending suppressed (0032) — a
  // pre-go-live or demo account, MOST often, but Resaca-shaped: the newest
  // account, waiting on carrier registration, with real customers already
  // waiting on a reply. Nothing about actual sending changes; this is a
  // read-only screen and the mark exists so the agency sees the work and
  // knows not to text. Dot + word (rule 3), never color alone.
  "work.agency.suppressed": "Not texting",
  // `listAgencyWork`'s `brandName` has no fallback to `accounts.name` any
  // more (2026-09-15) — see that function's own doc comment in
  // work-queue.ts. A blank result is unreachable through the product today
  // (migration 0028 backfilled every row), but if `brand_name` is ever
  // blank, the row's caption reads this instead of going empty or falling
  // back to the internal label.
  "work.agency.unbranded": "Unnamed account",

  // ── The zone note (2026-09-18) ─────────────────────────────────────────
  // Five screens print dates in the account's zone. Every one of them now
  // NAMES that zone, because the defect was never that UTC appeared — it was
  // that UTC appeared SILENTLY, so whoever read the screen took it for local
  // time. danlo, 2026-09-17: "I do not want to omit the dates so let's find
  // a workaround." Nothing is omitted; nothing is hidden.
  //
  // The zone itself is interpolated as the IANA name ("America/Chicago")
  // rather than a friendly rendering of it. Three reasons, in order: it is
  // stable (a "Central Daylight Time" label renames itself twice a year, so
  // two dates six months apart would claim different zones), it is what the
  // operator actually chose in Settings — which is where the sentence below
  // sends them, so the screen and the field agree on the string — and
  // deriving anything friendlier means inventing a second naming policy on
  // top of `Intl`, which is exactly how the five readers diverged to begin
  // with (see zone-resolution.ts).
  "zone.note": "Times shown in {zone}",

  // Shown ONLY when `guessed` — i.e. the zone printed is not the account's
  // own. DESIGN.md rule 3: this marker is a WORD, a whole sentence of them,
  // never a colour. The tinted ground carries no meaning by itself.
  //
  // Split by SOURCE, not collapsed, because "we guessed" is not actionable
  // while "we used the agency's zone" names which setting is broken.
  "zone.guessed.agency":
    "This company has no timezone of its own, so times use the agency's.",
  "zone.guessed.fallback":
    "Neither this company nor the agency has a usable timezone, so times use UTC.",
  // The fix, for the reader who can actually apply it. Settings is
  // agency-only (`requireAgencyOnlyAccountAccess`), so this link is rendered
  // for the agency and ONLY for the agency — a client following it would be
  // redirected straight back to their dashboard, which is a worse answer
  // than no link at all.
  "zone.guessed.fix": "Set it in Settings",
  // The same fact, for a client, who can see the consequence but cannot
  // reach the setting. Says who to ask rather than offering a dead link, and
  // says "your" rather than "this company" — on their own dashboard, they
  // are not a third party. Does NOT name the zone: the label line above it
  // already does, and the agency/fallback split is about which SETTING to
  // fix, which is not a distinction a client can act on either way.
  // "needs fixing", NOT "isn't set yet". `accounts.timezone` is NOT NULL
  // with a default (migration 0001), so it is always set to something — the
  // reachable failure is that it is set to a value nothing can format. The
  // earlier wording described a state the schema makes impossible.
  "zone.guessed.client":
    "Your timezone needs fixing, so times are shown in another zone. Ask your account manager to sort it out.",

  // ── Screened calls (2026-09-18) ────────────────────────────────────────
  // A refused call used to leave no trace but a log line. These screens are
  // agency-only: a client never sees them, so the voice is an operator's,
  // not a business owner's.
  "nav.screened": "Screened calls",
  "screened.title": "Screened calls",
  // A whole-phrase pick by count, never a plural template reused for one —
  // see contacts.count's own comment above for the "1 people" bug this
  // avoids, and work.linesDown.one/.many just below for the same rule
  // applied to a second count on this same screen.
  "screened.total": "{n} refused calls",
  "screened.totalOne": "1 refused call",
  "screened.col.when": "When",
  "screened.col.account": "Company",
  "screened.col.called": "Number dialled",
  "screened.col.caller": "Caller",
  "screened.col.reason": "Reason",
  // Dot + word, never colour alone (DESIGN.md rule 3). Each says what
  // happened in an operator's language, not the enum's.
  "screened.reason.unknown-number": "Not our number",
  "screened.reason.not-live": "Number not live",
  "screened.reason.no-profile": "No receptionist set up",
  "screened.reason.profile-disabled": "Receptionist turned off",
  "screened.reason.over-cap": "Over the daily cap",
  "screened.reason.repeat-spam": "Repeat spam",
  "screened.unknownCaller": "Withheld",
  "screened.noAccount": "—",
  // DESIGN.md rule 1 — the total never ships alone. `misconfigured` is the
  // one class of the three (CLASS_DOT's own comment, screened-table.tsx)
  // that is our own fault and needs a fix, so it is the breakdown worth a
  // second number beside the total.
  "screened.misconfigured": "{n} misconfigured",
  "screened.misconfiguredOne": "1 misconfigured",
  "screened.empty.title": "Nothing has been turned away",
  "screened.empty.body":
    "When the receptionist refuses a call — a number that isn't live, a repeat spammer, a caller over the daily cap — it lands here with the reason. Nothing to do until then.",
  "screened.older": "Older",

  // The `?class=` filter (2026-09-18): the work-queue banner links here
  // scoped to `misconfigured` rather than to the unfiltered, all-time list —
  // two different axes (24h distinct numbers vs. all-time rows) that must
  // never be allowed to look like the same number. These three say plainly
  // which slice is on screen; the "a genuine cold start" empty copy above is
  // FALSE for a filtered-and-empty result (a filter matching nothing is not
  // "nothing has ever been turned away"), so that gets its own pair too.
  // The misconfigured line is a RECORD, not a present-tense status: this is
  // an all-time list, so a line dead in July and fixed in August still shows
  // up here, and "are turning callers away" would be false about it. Say
  // what happened, not what is happening now.
  "screened.filter.scope.misconfigured": "Showing calls refused because a line wasn't set up.",
  "screened.filter.scope.screened": "Showing calls the system screened on purpose.",
  "screened.filter.scope.unattributed": "Showing calls to numbers this platform doesn't own.",
  "screened.filter.clear": "Show every refused call",
  "screened.empty.filtered.title": "Nothing matches this filter",
  "screened.empty.filtered.body":
    "No refusals of this kind are on record right now. Other kinds may still be — clear the filter to see everything.",

  // The work-queue banner. Counts DISTINCT numbers, because a dialer
  // hammering one dead line is one problem to fix.
  "work.linesDown.one": "1 number is turning callers away",
  "work.linesDown.many": "{n} numbers are turning callers away",
  "work.linesDown.action": "See which",
  // The stale-usage banner (client billing), beside the one above on the
  // agency work queue. Counts CLIENTS, not rows: one client's backlog is one
  // problem to fix. Says what it costs (the usage is not on the bill yet)
  // and that it heals itself once the cause is fixed.
  "work.usageStale.one": "Usage for 1 client hasn't reached Stripe in over a day, so it isn't on their bill yet. We retry every 15 minutes.",
  "work.usageStale.many": "Usage for {n} clients hasn't reached Stripe in over a day, so it isn't on their bills yet. We retry every 15 minutes.",
  "work.usageStale.action": "Check the Stripe connection",

  // Call proposals — a finished call's machine-suggested next step. Nothing
  // in this namespace commits anything until a human accepts it (Task 6's
  // acceptProposal/dismissProposal).
  "proposals.heading": "Suggested next steps",
  "proposals.subhead": "From this call. Nothing happens until you accept.",
  "proposals.evidence": "Because the caller said",
  "proposals.accept": "Accept",
  "proposals.dismiss": "Dismiss",
  "proposals.status.pending": "Suggested",
  "proposals.status.accepted": "Accepted",
  "proposals.status.dismissed": "Dismissed",
  "proposals.accepted.toast": "Added to your to-do list",
  "proposals.dismissed.toast": "Dismissed",
  "proposals.gone": "Someone already answered this one.",
  "proposals.contactFilled":
    "That detail was already filled in, so nothing was changed.",
  "proposals.contactMismatch":
    "That doesn't match the name already on file, so nothing was changed.",
  "proposals.opportunityGone":
    "This opportunity isn't on the board anymore, so nothing was changed.",
  "proposals.stageMoved":
    "This opportunity has moved since the suggestion was made, so nothing was changed.",
  // Distinct from "proposals.stageMoved" on purpose (fix-wave Important 4):
  // a deal a human already marked won or lost did not merely move to
  // another stage — closing it is the fact that changed, and telling the
  // reviewer it "moved" would be false.
  "proposals.opportunityClosed":
    "This opportunity has been closed since the suggestion was made, so nothing was changed.",
  "proposals.failed": "That didn't go through. Try again.",
  // The write itself may have landed before the failure — reverting the
  // proposal here would invite a retry that creates a SECOND record, so it
  // is left accepted and this says so honestly instead of promising a
  // clean retry the way "proposals.failed" does.
  "proposals.maybeFailed": "That may not have gone through. Check before trying again.",
  "proposals.work.heading": "Suggestions",
  // Fix-wave (task-10-brief.md, Minor): the old copy ("Questions about
  // work, not work yet.") restated the engineering invariant instead of
  // telling the agency what to do — this screen has no accept/dismiss of
  // its own, so acting means opening the account, which the old copy never
  // said. "proposals.subhead" (the call-detail page's own sibling copy) is
  // the concrete version this one now matches.
  "proposals.work.body": "Open the account to accept or dismiss. Nothing changes from this screen.",
  // Fix-wave Important 3 (task-11-brief): the per-account "To do" screen's
  // own twin of "proposals.work.body" — a reader here is already INSIDE the
  // account, so "open the account" would be nonsense; the next step is
  // opening the call itself, exactly where every row on this section links.
  "proposals.account.body": "Open the call to accept or dismiss. Nothing changes from this screen.",

  // Per-kind plain-language sentences for the call-detail proposals block
  // (Task 7). "{title}"/"{value}" are the house untrusted-placeholder shape —
  // filled with a `.replace(..., () => x)` call, never the two-argument
  // form, because both originate in a caller's own words read back by the
  // model. "{field}" is filled from this app's own static field labels
  // (contacts.firstName etc.), not the caller — safe either way.
  "proposals.task.label": "Add a task: {title}",
  // Fix-wave Important 1: rendered only for a `task` proposal that survived
  // `generate.ts`'s own forward-window check — a `dueAt` reaching this label
  // is always a real, near-future moment a human can see BEFORE accepting
  // it, in the account's own zone, never the raw UTC instant.
  "proposals.task.due": "Due {date}",
  "proposals.contactField.label": "Add their {field}: {value}",
  // "{from}"/"{to}" are stage NAMES, resolved from the payload's uuids
  // before this ever reaches copy — never the destination alone.
  "proposals.stage.label": "Move from {from} to {to}",
  // No stage is skipped silently: a bypass of even ONE stage speaks up, not
  // just a bypass of two or more — a customer who books on the first call
  // skips exactly one ("Contacted") and is the single most likely case this
  // feature will ever produce. Split singular/plural rather than
  // interpolating a count into a sentence that would read "1 stages".
  "proposals.stage.skip.one": "A stage is skipped in between.",
  "proposals.stage.skip.many": "{n} stages are skipped in between.",
  // Fix-wave (task-10-brief.md, Important 1): the agency work queue's own
  // opportunity_stage proposals resolve `fromStageId`/`toStageId` against a
  // batched read (work/page.tsx) that can come back short for one specific
  // pair — a real fault, or a stage since deleted. Never the raw uuid, never
  // the destination alone (this file's own rule for the kind), but the row
  // still shows: an honest sentence that names no stage, rather than
  // dropping the row and leaving the queue looking clear when it is not.
  // Fix-wave Minor: past tense ("moved") asserted something that had not
  // happened — nothing moves until a human accepts, and every sibling label
  // in this namespace ("Add a task…", "Add their…", "Move from…") is
  // imperative. Rewritten to match, without changing what it is honestly
  // able to say (page.tsx's own batched pipeline_stages read came back short
  // for this one pair). No apostrophe on purpose: several call sites still
  // compare raw `renderToStaticMarkup` output rather than decoded text, and
  // React escapes an apostrophe to `&#x27;` in that output.
  "proposals.stage.unresolved": "Review the stage change on this opportunity.",
  // "proposals.accepted.toast" ("Added to your to-do list") is true only of
  // a `task` proposal — accepting the other two kinds doesn't add anything
  // to a to-do list, and reporting that it did would be exactly the false
  // confirmation copy the "landscaper at 7am" read rules out.
  // "Saved" named nothing — the sibling toast it was modelled on names its
  // own destination. "Moved on the board" used a word this product never
  // uses; the nav item and the screen title both say "Opportunities".
  "proposals.accepted.contactField.toast": "Added to the contact.",
  "proposals.accepted.stage.toast": "Moved in Opportunities",

  // Agency Plans page (/dashboard/plans), client billing rollout step 1.
  // Agency-only screen (requireAgency); the env-var names in the
  // plans.stripe.* lines are for the operator who has to set them, the same
  // way numbers.routing.missingConfig names its own.
  "plans.title": "Plans",
  "plans.subtitle": "What clients pay each month, what's included, and what extra use costs.",
  "plans.new": "New plan",
  "plans.empty.title": "No plans yet",
  "plans.empty.body": "Create your first plan to start billing clients.",
  "plans.status.active": "Active",
  "plans.status.archived": "Archived",
  "plans.perMonth": "{price}/month",
  "plans.allowances": "{voice} minutes · {sms} texts · {chats} chats included",
  "plans.overage": "Extra: {voice}/minute · {sms}/text · {chats}/chat",
  "plans.feature.voice_receptionist": "Phone receptionist",
  "plans.feature.web_concierge": "Website chat assistant",
  "plans.features.none": "No phone or chat assistant",
  "plans.clients.none": "No clients on it yet",
  "plans.clients.one": "1 client",
  "plans.clients.many": "{count} clients",
  "plans.edit": "Edit",
  "plans.archive": "Archive",
  "plans.restore": "Restore",
  "plans.editLabel": "Edit {name}",
  "plans.archiveLabel": "Archive {name}",
  "plans.restoreLabel": "Restore {name}",
  "plans.dialog.createTitle": "New plan",
  "plans.dialog.editTitle": "Edit {name}",
  "plans.dialog.body": "Saving sets up this plan's prices in Stripe. Clients already on a plan keep their current prices until you move them.",
  "plans.field.name": "Plan name",
  "plans.field.monthlyPrice": "Monthly price (USD)",
  "plans.field.meters": "Included each month, and the price of each extra one",
  "plans.field.allowance.voice_minutes": "Phone minutes included",
  "plans.field.allowance.sms": "Texts included",
  "plans.field.allowance.ai_chats": "Website chats included",
  "plans.field.overage.voice_minutes": "Each extra phone minute (USD)",
  "plans.field.overage.sms": "Each extra text (USD)",
  "plans.field.overage.ai_chats": "Each extra website chat (USD)",
  "plans.field.features": "Premium features",
  "plans.save": "Save plan",
  "plans.saved": "Plan saved",
  "plans.archived.toast": "{name} archived — new clients can't be put on it",
  "plans.restored.toast": "{name} restored",
  "plans.error.nameRequired": "Give the plan a name.",
  "plans.error.nameTooLong": "Keep the name to 60 characters or fewer.",
  "plans.error.nameTaken": "Another plan already has that name.",
  "plans.error.monthlyPrice": "Enter a monthly price between $0.50 and $10,000.00.",
  "plans.error.allowance.voice_minutes": "Enter a whole number of phone minutes, up to 1,000,000.",
  "plans.error.allowance.sms": "Enter a whole number of texts, up to 1,000,000.",
  "plans.error.allowance.ai_chats": "Enter a whole number of website chats, up to 1,000,000.",
  "plans.error.overage.voice_minutes": "Enter a price for each extra phone minute, up to $100.00.",
  "plans.error.overage.sms": "Enter a price for each extra text, up to $100.00.",
  "plans.error.overage.ai_chats": "Enter a price for each extra website chat, up to $100.00.",
  "plans.error.stripeNotConnected": "Stripe isn't connected, so plans can't be saved yet.",
  "plans.error.stripeFailed": "Stripe didn't accept this plan, so nothing was saved. Try again later. If it keeps failing, change the plan or check it in Stripe.",
  "plans.error.saveFailed": "The plan couldn't be saved. Try again.",
  "plans.error.stale": "This plan was changed somewhere else. Reload the page and make your edit again.",
  "plans.error.archived": "This plan is archived. Restore it before editing.",
  "plans.error.notFound": "We couldn't find that plan — this page may be out of date.",
  "plans.error.reload": "This page is out of date. Reload it and try again.",
  "plans.error.alreadySaved": "This plan was already saved. Reload the page to see it, then make your change from there.",
  "plans.stripe.missing": "Stripe isn't connected. Add STRIPE_SECRET_KEY to this deployment to create or edit plans.",
  "plans.stripe.live_key_outside_production": "This deployment holds a live Stripe key but isn't production, so plans are switched off here. The live key belongs only on the live site; a copy of the app that uses the test database takes a test key (sk_test_).",
  "plans.stripe.test_key_on_production_data": "This copy of the app uses the live database, so it won't save plans with a Stripe test key (sk_test_). Stripe couldn't bill a plan made that way. Create and edit plans on the live site.",
  "plans.stripe.not_a_secret_key": "STRIPE_SECRET_KEY isn't a Stripe secret key. It should start with sk_test_ (or sk_live_ in production).",
  // Client billing, rollout step 3: the agency's Billing card (account
  // Settings, agency only), the client's Billing page, the payment-failed
  // banner and Checkout's landing page (/billing-done, signed out). The
  // billing.error.noOrigin line names an env var because only the agency
  // ever sees it (the plans.stripe.* precedent).
  "billing.card.title": "Billing",
  "billing.card.empty": "Send a billing link to start charging this client, or mark them complimentary.",
  "billing.card.noPlans": "Create a plan first. Then you can send this client a billing link.",
  "billing.card.error": "Billing couldn't load just now. Refresh to try again.",
  "billing.card.noStripe": "Stripe isn't connected here, so a billing link can't be sent. The Plans page says why.",
  "billing.status.active": "Active",
  "billing.status.payment_failed": "Payment failed",
  "billing.status.paused": "Paused",
  "billing.status.canceled": "Canceled",
  "billing.status.complimentary": "Complimentary",
  "billing.status.link_sent": "Link sent",
  "billing.status.unbilled": "Unbilled",
  "billing.price": "{price}/month",
  "billing.includes": "It includes {list} each month.",
  "billing.includes.minutes": "{n} minutes of calls",
  "billing.includes.sms": "{n} texts",
  "billing.includes.chats": "{n} website chats",
  "billing.includes.none": "This plan doesn't include any calls, texts or website chats up front.",
  "billing.usage.minutes": "{used} of {included} minutes",
  "billing.usage.sms": "{used} of {included} texts",
  "billing.usage.chats": "{used} of {included} website chats",
  "billing.usage.minutes.none": "{used} minutes (none included)",
  "billing.usage.sms.none": "{used} texts (none included)",
  "billing.usage.chats.none": "{used} website chats (none included)",
  "billing.usage.since": "Since {date}",
  "billing.usage.chatsNote": "A website chat counts once Sofía first replies.",
  "billing.nextInvoice": "Next invoice {date}",
  "billing.link.sentTo": "Billing link sent to {email}. It works until {date}.",
  "billing.link.copy": "Copy link",
  "billing.link.copied": "Link copied.",
  "billing.send": "Send billing link",
  "billing.send.title": "Send a billing link",
  "billing.send.body": "They'll get an email with a secure Stripe page to add a card. Their plan starts when they finish.",
  "billing.send.plan": "Plan",
  "billing.send.email": "Send to",
  "billing.send.done": "Billing link sent.",
  "billing.changePlan": "Change plan",
  "billing.changePlan.bodyPaid": "The new plan starts now. Stripe adjusts this month's price on the next invoice.",
  "billing.changePlan.bodyComplimentary": "The new plan's features and allowances apply right away. Nothing is charged.",
  "billing.changePlan.done": "Plan changed.",
  "billing.comp.mark": "Mark complimentary",
  "billing.comp.markBody": "They get the plan's features and allowances and are never charged.",
  "billing.comp.done": "Marked complimentary.",
  "billing.comp.stop": "Stop complimentary",
  "billing.comp.stopped": "No longer complimentary.",
  "billing.error.noStripe": "Stripe isn't connected here, so billing can't change. The Plans page says why.",
  "billing.error.noOrigin": "This deployment doesn't know its own web address (APP_ORIGIN), so no link can be made.",
  "billing.error.plan": "Pick an active plan.",
  "billing.error.email": "Enter one email address.",
  "billing.error.alreadySubscribed": "This client already has a subscription. Use Change plan instead.",
  "billing.error.checkoutFinished": "This client already finished checkout. Their plan shows here within a minute.",
  "billing.error.alreadyBilled": "This client is already on a plan.",
  "billing.error.stripeFailed": "Stripe didn't accept that. Nothing was charged. Try again in a minute.",
  "billing.error.changePlanUnconfirmed": "Stripe didn't confirm the change, and it may still go through. Refresh in a minute and check the plan shown here before you try again.",
  "billing.error.emailFailed": "The link was made, but the email didn't send. Use Copy link to send it yourself.",
  "billing.error.stale": "Something changed. Refresh and try again.",
  "billing.page.title": "Billing",
  "billing.page.subtitle": "Your plan, what you've used, and your next invoice.",
  "billing.page.empty.title": "Billing isn't set up yet",
  "billing.page.empty.body": "When your plan starts, your usage and next invoice show here.",
  "billing.page.usage": "Your usage",
  "billing.page.manage": "Manage billing",
  "billing.page.manageHelp": "Update your card and see your past invoices on our secure payment page.",
  "billing.page.manageHelp.canceled": "See and download your past invoices on our secure payment page.",
  "billing.page.status.processing": "Payment processing",
  "billing.page.complimentary": "Your plan is complimentary. There's nothing to pay.",
  "billing.page.canceled": "Your subscription has ended.",
  "billing.page.portalFailed": "Billing couldn't open just now. Try again in a minute.",
  "billing.banner.client": "Your payment didn't go through. Update your card to keep automations running.",
  "billing.banner.clientAction": "Go to Billing",
  "billing.banner.agency": "This client's last payment didn't go through.",
  "billing.banner.agencyAction": "See billing",
  "billing.done.success.title": "You're all set",
  "billing.done.success.body": "Your plan starts as soon as your payment is confirmed, usually within a minute. You can close this tab.",
  "billing.done.cancelled.title": "Checkout wasn't finished",
  "billing.done.cancelled.body": "Nothing was charged. Use the link you were sent to try again.",
} as const;

export type MessageKey = keyof typeof m;
