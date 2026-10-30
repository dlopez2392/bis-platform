export const m = {
  // The sidebar's mono uppercase group headers (DESIGN.md's grouped-nav
  // pattern). Text-cased in CSS, not here — these strings stay plain so a
  // screen reader announces them as words, not letter-by-letter.
  // .es twins (Task 6, Spanish-runtime lane): the sidebar's own labelKey →
  // copy lookup now runs through t() (app-sidebar.tsx), which is the first
  // place any of these become reachable. Nav labels are rendered with
  // `truncate` + a `title` tooltip (SidebarLink in app-sidebar.tsx), the
  // SAME overflow handling an unusually long English label already relies
  // on, so a long Spanish word degrades the same way rather than breaking —
  // flagged below wherever a translation runs noticeably longer than its
  // English twin.
  "nav.group.overview": "Overview",
  "nav.group.overview.es": "Resumen",
  "nav.group.crm": "CRM",
  "nav.group.crm.es": "CRM",
  "nav.group.communications": "Communications",
  "nav.group.communications.es": "Comunicaciones",
  "nav.group.growth": "Growth",
  "nav.group.growth.es": "Crecimiento",
  "nav.dashboard": "Dashboard",
  "nav.dashboard.es": "Panel",
  "nav.tasks": "To do",
  "nav.tasks.es": "Pendientes",
  "nav.website": "Website",
  "nav.website.es": "Sitio web",
  // "Checklist", not "Activation checklist": every other sidebar entry is one
  // word, and the longer form is byte-identical to the dashboard card's own
  // title link — which made `getByRole("link", {name: "Activation checklist"})`
  // ambiguous and broke blueprints.spec.ts. Renaming here keeps that
  // assertion at full strength instead of scoping the test around the clash.
  "nav.checklist": "Checklist",
  // M4 review: not "Lista de tareas", which read as the same thing as
  // "Pendientes" (nav.tasks.es — tareas ARE to-dos). The longest nav.* label
  // in either language (21 chars vs 9); truncate+title (above) is the
  // fallback. Agency-only today, and operators stay English, so no live
  // session renders it yet.
  "nav.checklist.es": "Lista de verificación",
  "nav.contacts": "Contacts",
  "nav.contacts.es": "Contactos",
  "nav.documents": "Documents",
  "nav.documents.es": "Documentos",
  "nav.opportunities": "Opportunities",
  "nav.opportunities.es": "Oportunidades",
  "nav.conversations": "Conversations",
  "nav.conversations.es": "Conversaciones",
  "nav.calls": "Calls",
  "nav.calls.es": "Llamadas",
  "nav.calendar": "Calendar",
  "nav.calendar.es": "Calendario",
  "nav.forms": "Forms",
  "nav.forms.es": "Formularios",
  "nav.settings": "Settings",
  "nav.settings.es": "Ajustes",
  "nav.branding": "Branding",
  "nav.branding.es": "Marca",
  "nav.voice": "Voice",
  "nav.voice.es": "Voz",
  "nav.automations": "Automations",
  // Longer than its English twin (16 chars vs 11) — same truncate+title
  // fallback; still clears the expanded-sidebar label column.
  "nav.automations.es": "Automatizaciones",
  "nav.setup": "Setup",
  "nav.setup.es": "Configuración",
  "nav.accounts": "Companies",
  "nav.accounts.es": "Empresas",
  "nav.blueprints": "Blueprints",
  "nav.blueprints.es": "Plantillas",
  "nav.plans": "Plans",
  "nav.plans.es": "Planes",
  "nav.billing": "Billing",
  "nav.billing.es": "Facturación",
  // Staff and roles (Task 8): a client Owner's sidebar footer link and its
  // own nav:team palette entry — never a scrolling nav row (nav-groups.ts's
  // own "never includes a Team item" test), and never shown to Staff.
  "nav.team": "Team",
  "nav.team.es": "Equipo",
  // Work Queue Task 6 — the agency-wide queue, top level beside Companies
  // and Blueprints. "Work queue" rather than reusing "To do" (nav.tasks):
  // that label already names the per-account screen one level down, and the
  // sidebar can show both on screen at once (inside an account, the agency
  // still sees the top-level group's own back-link). "Queue" is the accurate
  // word here in a way it stops being on the per-account screen: nothing at
  // that level is ever pooled across more than one company.
  "nav.work": "Work queue",
  // Longer than its English twin (15 chars vs 10) — same truncate+title
  // fallback as nav.checklist.es above.
  "nav.work.es": "Cola de trabajo",
  // The agency numbers inventory (/dashboard/numbers), top level beside
  // Companies, Blueprints and the work queue. "Phone numbers" in full rather
  // than "Numbers": at agency scope, alone in a flat list, "Numbers" reads as
  // metrics. It is the same two words the per-account Voice page's own panel
  // uses, which is deliberate — one vocabulary for one thing.
  "nav.numbers": "Phone numbers",
  // The longest nav.* label a live session can render in Spanish (19
  // chars; nav.checklist.es is longer but agency-only, and operators stay
  // English) — same truncate+title fallback as nav.checklist.es/nav.work.es
  // above; this is the one worth the sidebar's narrowest-expanded-width
  // check (236px), since every other client-visible translation clears it
  // with more room to spare.
  "nav.numbers.es": "Números de teléfono",

  "shell.brand": "BIS",
  // Task 6 fix round 1: unchanged across locales (a proper noun/brand name,
  // same reason brandDisplayName is never translated) — routed through
  // t() anyway at the call site for consistency with every other shell.*
  // label, not because this string itself differs.
  "shell.brand.es": "BIS",
  "shell.switchAccount": "Switch company",
  "shell.searchAccounts": "Search companies…",
  "shell.noAccounts": "No companies yet",
  "shell.search": "Search",
  "shell.collapse": "Collapse sidebar",
  "shell.collapse.es": "Contraer panel lateral",
  "shell.expand": "Expand sidebar",
  "shell.expand.es": "Expandir panel lateral",
  "shell.backToAgency": "Back to companies",
  "shell.backToAgency.es": "Volver a las empresas",
  // Topbar's AI presence indicator (DESIGN.md "AI presence" key pattern).
  // The dot itself is a separate aria-hidden element (topbar-presence.tsx);
  // this string carries the meaning on its own per DESIGN.md's status rule
  // ("never color alone — dot + word"). "{count}" is the house {placeholder}
  // convention (see setup.progress above) — the ✓ ships as plain text, not a
  // separate icon element, since idle carries no color-only signal to back up.
  // "{name}" (D-063 follow-up): the account's own configured receptionist
  // persona (voice_profiles.persona_name), never a hard-coded "Sofía" — some
  // clients rename theirs. The caller falls back to "Sofía" only when the
  // persona name is missing or blank.
  "shell.presence.onCall": "{name} · on a call",
  // "the last 7 days", not "this week" (2026-10-26): the count is the
  // dashboard tile's own rolling window (lib/voice/presence.ts).
  "shell.presence.idle": "✓ {count} calls handled in the last 7 days",
  "shell.presence.idle.es": "✓ {count} llamadas atendidas en los últimos 7 días",
  // Singular pair: "✓ 1 calls" is a real state for exactly the young voice
  // accounts that get demoed. "handled" restores DESIGN.md's own wording.
  "shell.presence.idleOne": "✓ 1 call handled in the last 7 days",
  "shell.presence.idleOne.es": "✓ 1 llamada atendida en los últimos 7 días",
  // F-107 r4 review (item 1): below `sm` the full phrases ("{name} · on a
  // call", "✓ {count} calls handled in the last 7 days") are too wide for the
  // topbar next to the icon-only search trigger, ThemeToggle,
  // OrganizationSwitcher (avatar-only there, same review round) and
  // UserButton — collapsed to "dot + short word" (rule 3: never a bare
  // dot). The name/count are dropped, not hidden behind a tap, at phone
  // width; the full phrase is one tap away on the account's own dashboard
  // (the KPI row's own "Calls answered"). `.es` written out now per this
  // lane's bilingual rule — no operator locale reads it yet.
  // Renamed from "...onCallShort.en" (Task 6, Spanish-runtime lane): t()'s
  // own lookup convention is bare key + "{key}.es" twin (see lib/i18n/t.ts),
  // not two parallel ".en"/".es" suffixes — the old shape made the .es twin
  // below unreachable through t(), since `t(m, "...onCallShort.en", "es")`
  // would look for a "...onCallShort.en.es" key that never existed. No
  // caller outside this file read the old key name (confirmed by a repo-wide
  // grep before the rename).
  "shell.presence.onCallShort": "On call",
  "shell.presence.onCallShort.es": "En llamada",
  // F-107 r5 review (item 2): "{count} this week" didn't say what was
  // counted — "calls" restores that, matching the full phrase's own noun.
  // Singular pair, same shape as idle/idleOne above ("1 calls" is wrong).
  // Renamed from "...idleShort.en"/"...idleShortOne.en" — same reason as
  // onCallShort just above.
  "shell.presence.idleShort": "{count} calls",
  "shell.presence.idleShort.es": "{count} llamadas",
  "shell.presence.idleShortOne": "1 call",
  "shell.presence.idleShortOne.es": "1 llamada",

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

  // True whether access was switched off or never turned on: an adopted
  // half-created company starts with it off (review of D-087). Still its own
  // page, apart from "none" below (the invitation case, D-001).
  "clientAccess.off.title": "Access isn't turned on",
  "clientAccess.off.body": "Access to this account isn't turned on right now. Ask the person who invited you to turn it on.",
  // Read by the person who was just invited, on their first visit, at the
  // moment it fails. "No account linked" stated a fact about our data model
  // and gave them nothing to do; "contact your account manager" is a title
  // nobody at a small business has. Say what happened and who can fix it.
  "clientAccess.none.title": "Your company isn't set up yet",
  "clientAccess.none.body": "Your invitation worked, but this company hasn't finished being set up on our side. Let the person who invited you know — they can finish it, and your invitation stays valid.",

  // The agency-side half of the same fault. See lib/accounts/orphans.ts.
  "accounts.orphan.title": "Set up in Clerk but not here",
  // D-087: the first remedy used to be "add the company here with the same
  // name", which made a SECOND Clerk organisation and left everyone already
  // invited in this one. "Add as a company" adopts THIS organisation.
  "accounts.orphan.body": "Anyone invited to these can be sent an invitation, but cannot sign in — there is no company behind them yet. Choose \"Add as a company\" to finish one (everyone already invited keeps their invitation), or delete the organization in Clerk.",
  "accounts.orphan.adopt": "Add as a company",
  "accounts.orphan.adoptTitle": "Add \"{name}\" as a company",
  "accounts.orphan.adoptHint": "Finishes the company Clerk already has, keeping its name. Anyone already invited can sign in once you turn on Client access in its Settings, which opens next.",
  "accounts.orphan.adoptGone": "That organization is no longer in Clerk. Reload the page.",
  "accounts.orphan.adoptClerkDown": "Couldn't reach Clerk to check that organization. Nothing was saved. Try again in a minute.",
  "accounts.orphan.adoptNoName": "That organization has no name in Clerk. Give it one there, then try again.",
  "accounts.orphan.adoptFailed": "Could not add that company. It may already have been added: reload the page and check the list.",
  "accounts.orphan.unavailable": "Could not reach Clerk to check for half-created companies. The list below is unaffected.",

  "clientAccess.title": "Client access",
  "clientAccess.body": "When on, invited users at this company can sign in and see this account only.",
  "clientAccess.enable": "Turn on",
  "clientAccess.disable": "Turn off",
  // D-002: the switch's own state, as the word beside its dot (rule 3), and
  // the toasts that carry its Undo (rule 6).
  "clientAccess.statusOn": "On",
  "clientAccess.statusOff": "Off",
  "clientAccess.turnedOn": "Client access is on. Invited people at this company can sign in.",
  "clientAccess.turnedOff": "Client access is off. Nobody at this company can sign in until you turn it back on.",

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
  "branding.clientNameHint": "What your own customers see — on your lead forms, your booking page, website chat, emails and texts, and in this workspace.",
  "branding.clientColorHint": "Used for buttons and highlights on your lead forms, booking page, website chat and emails, and in this sidebar. Leave blank for the default.",
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
  "branding.nameHint": "What this company's own customers see — on their lead forms, booking page, website chat, emails and texts, and in their sidebar. Your internal name for them stays private.",
  "branding.logo": "Logo",
  "branding.logoHint": "PNG, JPEG or WebP, up to 512 KB.",
  "branding.upload": "Upload",
  "branding.saved": "Branding updated",
  "branding.saveFailed": "Could not update branding",
  "branding.badFormat": "That file isn't a PNG, JPEG or WebP.",
  "branding.tooLarge": "That file is larger than 512 KB.",
  "branding.noLogo": "No logo set",
  "branding.currentLogo": "Current logo",
  "branding.removeLogo": "Remove logo",
  "branding.logoRemoved": "Logo removed",
  "branding.noLogoToRemove": "There's no logo to remove.",
  "branding.logoGone": "That logo can't be brought back. Upload it again.",
  "branding.color": "Brand color",
  "branding.colorHint": "Used for buttons and highlights on their lead forms, booking page, website chat and emails, and in their sidebar. Leave blank for the default.",
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
  "common.save.es": "Guardar",
  "common.cancel": "Cancel",
  "common.cancel.es": "Cancelar",
  "common.undo": "Undo",
  "common.undo.es": "Deshacer",
  "common.retry": "Retry",
  "common.retry.es": "Intentar de nuevo",
  "common.add": "Add",
  "common.add.es": "Agregar",
  "common.import": "Import",
  "common.filters": "Filters",
  "common.sort": "Sort",
  "common.none": "—",
  "common.none.es": "—",
  "common.saving": "Saving…",
  "common.saving.es": "Guardando…",
  // A dialog's X button, for screen readers (DialogContent's closeLabel).
  "common.close": "Close",
  "common.close.es": "Cerrar",
  "common.actionCrashed":"That didn't go through — this page may be out of date. Reload it and try again.",
  // Twin added by mis preferencias (F-096, Task 6): the Preferences page
  // speaks the person's own locale, including this house sentence.
  "common.actionCrashed.es": "Eso no se completó: puede que esta página esté desactualizada. Recárgala e inténtalo de nuevo.",
  "common.unavailable": "—",
  // The period caption on a StatTile (Task 4) when the metric covers the
  // whole account history rather than a rolling window — shared verbatim
  // across the agency and in-account dashboards, so one key, not two.
  "common.allTime": "All time",
  // Task 7 (Spanish-runtime lane). "Desde siempre" (literally "since
  // forever") is how a Spanish-speaking business owner reads an all-time
  // total — more natural here than a literal "Todo el tiempo".
  "common.allTime.es": "Desde siempre",

  // StatTile's delta chip (Task 4, DESIGN.md rule 1: every metric ships
  // with context). The visible chip is glyph + `delta.label` ("▲ 12%");
  // this is the chip's `aria-label`, spelling the direction out in words
  // so the glyph is never the only carrier of the up/down/flat meaning.
  // "{value}" is the house {placeholder} convention (see setup.progress
  // above) — `deltaVsPrior`'s own `label` field (a percent or a raw count).
  // .es twins (I7): read through t() in the tile's locale — the dashboard
  // KPI row passes the resolved one, every other tile stays English.
  "stat.delta.up": "up {value} vs the prior period",
  "stat.delta.up.es": "subió {value} frente al periodo anterior",
  "stat.delta.down": "down {value} vs the prior period",
  "stat.delta.down.es": "bajó {value} frente al periodo anterior",
  "stat.delta.flat": "flat vs the prior period",
  "stat.delta.flat.es": "sin cambios frente al periodo anterior",

  // InlineField component (Task 4): click-to-edit for contact fields.
  // "{label}" is the field name (e.g., "Email"); the component .replace()s it.
  // .es twins (S-02 B2): the component's own chrome follows its `locale` prop.
  "inline.saved": "{label} saved",
  "inline.saved.es": "Guardado: {label}",
  "inline.edit": "Edit {label}",
  "inline.edit.es": "Editar {label}",
  "inline.empty": "Add…",
  "inline.empty.es": "Agregar…",
  "inline.crashed": "Save didn't go through — the page may be out of date. Reload and try again.",
  "inline.crashed.es": "No se guardó; puede que la página esté desactualizada. Vuelva a cargarla e intente de nuevo.",
  // The `options` arm's own rejection (validateEnumValue) — a value typed or
  // posted that is not one of the <select>'s own <option>s, e.g. a forged
  // form post past the Language field below.
  "inline.invalidOption": "Choose one of the options shown.",
  "inline.invalidOption.es": "Elija una de las opciones mostradas.",
  // The `rule` arm's own rejections (lib/inline-rule.ts's validateInlineRule);
  // the server action behind a rule field runs the same check, so both say the same.
  "inline.rule.required": "This can't be empty.",
  "inline.rule.required.es": "Esto no puede quedar vacío.",
  "inline.rule.tooLong": "Keep it to {max} characters.",
  "inline.rule.tooLong.es": "Use {max} caracteres como máximo.",
  "inline.rule.badDate": "Pick a real date.",
  "inline.rule.badDate.es": "Elija una fecha válida.",
  "inline.rule.future": "Pick a date that isn't in the future.",
  "inline.rule.future.es": "Elija una fecha que no sea futura.",

  "accounts.title": "Companies",
  "accounts.add": "Add company",
  "accounts.name": "Business name",
  // Owner decision 2026-10-09: the name customers see is its own field, so
  // the business name above stays the agency's private label (it used to be
  // copied into brand_name and reach the client's sidebar, emails and texts).
  "accounts.brandName": "Name their customers see",
  "accounts.brandNameHint": "Shown on their emails, texts, booking page and sidebar. The business name above stays private to you.",
  "accounts.brandNameRequired": "Enter the name their customers see.",
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
  // D-086: "later" used to name no place, because there was none. Settings
  // now carries an "Apply a blueprint" dialog (apply-blueprint-dialog.tsx).
  "accounts.blueprintHint": "Copies configuration into the new company. You can also apply one later, from the company's Settings.",
  "accounts.blueprintPartial": "The company was created, but some blueprint items did not apply. Check its Settings and add anything missing by hand.",

  "dashboard.title": "Dashboard",
  "dashboard.companies": "Companies",
  "dashboard.contacts": "Contacts",
  "dashboard.openOpps": "Open opportunities",
  "dashboard.pipelineValue": "Pipeline value",

  "account.contacts": "Contacts",
  // Task 7 (Spanish-runtime lane). Usted register throughout, same as every
  // other .es twin in this catalogue.
  "account.contacts.es": "Contactos",
  "account.openOpps": "Open opportunities",
  "account.openOpps.es": "Oportunidades abiertas",
  "account.pipelineValue": "Pipeline value",
  "account.pipelineValue.es": "Valor del embudo",

  // The in-account dashboard's greeting header (Task 5), both audiences.
  // "{name}" is the house {placeholder} convention (see setup.progress) — the
  // component .replace()s it with the account's own name. Time-of-day comes
  // from `greetingPeriod` (lib/dashboard/greeting.ts), read from the
  // ACCOUNT's timezone, never the viewer's.
  "dashboard.greeting.morning": "Good morning, {name}",
  "dashboard.greeting.afternoon": "Good afternoon, {name}",
  "dashboard.greeting.evening": "Good evening, {name}",
  // D-072: an unbranded client's greeting must never fall back to
  // `accounts.name` (the agency's own private label) — brandDisplayName's
  // own rule, extended here. The case this covers is effectively
  // unreachable once Branding is set (every account's `brand_name` is
  // seeded at creation and go-live requires the step), but "effectively"
  // is not "never", so the nameless greeting below is real, written copy —
  // never a dangling ", {name}".
  "dashboard.greeting.morningNoName": "Good morning",
  "dashboard.greeting.afternoonNoName": "Good afternoon",
  "dashboard.greeting.eveningNoName": "Good evening",
  // Sub-line, appended only when the account has an ENABLED voice profile —
  // never a blanket claim about what the receptionist did (that isn't
  // honestly derivable this phase; see the task brief). "{name}" (D-063
  // follow-up): this account's own configured persona
  // (voice_profiles.persona_name), not a hard-coded "Sofía" — page.tsx falls
  // back to "Sofía" only when the persona name is missing or blank.
  "dashboard.sub.voice": "{name} is answering your calls.",

  // The KPI row (Task 5): rolling 7-local-day metrics, each with a delta vs
  // the prior 7 days and a sparkline over that SAME 7 days (D-077: three of
  // the four used to spark a 14-day trend beside a 7-day number — a lie by
  // omission about which span the picture showed).
  "dashboard.kpi.callsAnswered": "Calls answered",
  // Task 7 (Spanish-runtime lane).
  "dashboard.kpi.callsAnswered.es": "Llamadas atendidas",
  // F-076 (now slice): the hero on a CRM-only account (no enabled voice
  // profile) — "Calls answered" is structurally always 0 with no
  // receptionist taking calls, so it is never the right headline there
  // (crm-features.md §2.3, §6.3). Owner decision: this is the SAME "leads
  // captured" the Monday weekly report sends (lib/reports/weekly-metrics.ts
  // — a real submission or a lead-outcome call), not "every new contact";
  // the weekly report's own email copy (lib/email/templates/weekly-report.ts)
  // spells it lowercase inline rather than through a messages.ts key, so
  // there was no existing key to reuse here.
  "dashboard.kpi.leadsCaptured": "Leads captured",
  "dashboard.kpi.leadsCaptured.es": "Clientes potenciales captados",
  "dashboard.kpi.appointmentsBooked": "Appointments booked",
  "dashboard.kpi.appointmentsBooked.es": "Citas agendadas",
  "dashboard.kpi.afterHoursCaptured": "After-hours captured",
  "dashboard.kpi.afterHoursCaptured.es": "Atendidas fuera de horario",
  "dashboard.kpi.pipelineAdded": "Pipeline added",
  "dashboard.kpi.pipelineAdded.es": "Nuevo valor del embudo",
  // D-077, design review follow-up: ONE caption for the whole KPI row
  // (page.tsx, rendered with StatTile's own exported `LABEL_ROLE` class
  // string), not a suffix on each of the four labels above — a suffix
  // wrapped in the xl tile width and misaligned the row, and the mockup
  // never puts a period in a tile label (northern-lights.html:85-95).
  "dashboard.kpi.last7Days": "Last 7 days",
  "dashboard.kpi.last7Days.es": "Últimos 7 días",

  // The 14-day calls chart card (Task 6) — CSS bars, hover tooltip on every
  // mark (DESIGN.md's chart section), a recent-calls mini table beneath it.
  // "{date}"/"{count}"/"{unit}" are the house {placeholder} convention (see
  // setup.progress above); the component .replace()s them, and picks "{unit}"
  // itself (call vs calls) the same way shell.presence.idleOne pins its own
  // singular case. The bars are ANSWERED calls (the hero's own read, since
  // 2026-10-06), and the title says so: under a bare "Calls" beside a table
  // of every recent call, a robocall-free bar would read as a missing call.
  "dashboard.calls.title": "Calls answered",
  "dashboard.calls.caption": "Last 14 days",
  "dashboard.calls.axis.weekendsMuted": "Weekends muted",
  "dashboard.calls.tooltip": "{date} · {count} {unit}",
  "dashboard.calls.tooltipSr": "{date}, {count} {unit}",
  "dashboard.calls.unit.call": "call",
  "dashboard.calls.unit.calls": "calls",
  // Rule 5 (designed empty states): one sentence, verbatim from the brief.
  "dashboard.calls.empty": "When {name} answers, every call lands here with its outcome.",
  "dashboard.calls.emptySetupVoice": "Set up your voice receptionist",
  "dashboard.calls.emptyViewCalls": "View all calls",
  // The "screened, not empty" state (#182 follow-up): the window had calls,
  // just none that counted as answered. Review fix: the lead sentence used
  // to claim "No customer calls" — more than this card measures. Spam is a
  // GUESS from what was (or wasn't) said, not a confirmed fact about who
  // called, so the lead sentence states only what was actually measured —
  // zero ANSWERED calls — and the two outcomes that follow are named as
  // what they are, never conflated. Three variants: spam alone, abandoned
  // alone, and both in the SAME window (named together, so a real caller
  // who hung up is never hidden behind the spam line). All three take
  // "{count}"/"{unit}" (the "both" variant takes two of each, spam first),
  // the same replace-by-hand convention as the tooltip strings above.
  "dashboard.calls.screenedSpam": "No calls answered in the last 14 days. {name} flagged {count} {unit} as likely spam.",
  "dashboard.calls.screenedAbandoned": "No calls answered in the last 14 days. {count} {unit} hung up before {name} could help.",
  "dashboard.calls.screenedBoth": "No calls answered in the last 14 days. {name} flagged {spamCount} {spamUnit} as likely spam, and {otherCount} {otherUnit} hung up before {name} could help.",
  "dashboard.calls.unit.caller": "caller",
  "dashboard.calls.unit.callers": "callers",

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
  // D-036: the Calendar page's Undo on a Cancel (status_changed → booked).
  "dashboard.activity.bookingRestored": "An appointment that was cancelled is back on.",
  "dashboard.activity.formSubmitted": "A new lead came in through your form.",
  "dashboard.activity.callRecorded": "Call outcome: {outcome}.",
  "dashboard.activity.forwardOn": "Calls started going straight to your transfer number instead of {name}.",
  "dashboard.activity.forwardOff": "{name} started answering calls again.",
  // Rule 5 (designed empty states): one sentence, verbatim from the brief.
  // No action link — the brief pins this one deliberately link-less.
  "dashboard.activity.empty": "Bookings, form leads, and call outcomes appear here as they happen.",

  "contacts.title": "Contacts",
  "contacts.title.es": "Contactos",
  "contacts.add": "Add contact",
  "contacts.add.es": "Agregar contacto",
  // The header badge (Task 3): a whole-phrase pick by count, never a plural
  // template reused for one — see setup.progress below for the {placeholder}
  // convention this departs from on purpose. The platform already shipped a
  // "1 people" bug on the Website screen by templating a plural with no
  // singular form; this is the same shape, fixed at the source.
  "contacts.count": "{count} contacts",
  "contacts.count.es": "{count} contactos",
  "contacts.countOne": "1 contact",
  "contacts.countOne.es": "1 contacto",
  // Cursor pager (Task 3): "Newer" always returns to the unpaged head rather
  // than walking back one page at a time — see page.tsx's own comment on
  // newerHref for why a full back-stack isn't worth the state here.
  // .es twins reuse timeline.older.es/timeline.newer.es's own words — the
  // same pager, the same two words, never reworded per screen.
  "contacts.newer": "Newer",
  "contacts.newer.es": "Más recientes",
  "contacts.older": "Older",
  "contacts.older.es": "Anteriores",
  "contacts.import": "Import CSV",
  "contacts.import.es": "Importar CSV",
  "contacts.export": "Export CSV",
  "contacts.export.es": "Exportar CSV",
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
  // Shown on the done screen only when they happened (final review I-C), summed
  // across every batch. The contacts themselves were saved either way.
  "contacts.import.businessTooLong": "{count} business names were too long to save (120 characters max).",
  "contacts.import.businessTooLong.es": "{count} nombres de negocio eran demasiado largos para guardarse (máximo 120 caracteres).",
  "contacts.import.businessTooLongOne": "1 business name was too long to save (120 characters max).",
  "contacts.import.businessTooLongOne.es": "1 nombre de negocio era demasiado largo para guardarse (máximo 120 caracteres).",
  "contacts.import.businessLinkFailed": "Business names didn't save for some rows — import again to retry.",
  "contacts.import.businessLinkFailed.es": "Los nombres de negocio no se guardaron en algunas filas. Vuelva a importar para intentarlo de nuevo.",
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
  // Short in Spanish: the longer line truncated in the box at phone width.
  "contacts.search.es": "Buscar contactos",
  "contacts.col.name": "Contact name",
  // "Nombre" and "Negocio", not "Nombre del contacto" / "Nombre del negocio":
  // the long pair pushed the Spanish table past its panel at 1280px.
  "contacts.col.name.es": "Nombre",
  "contacts.col.phone": "Phone",
  "contacts.col.phone.es": "Teléfono",
  "contacts.col.email": "Email",
  "contacts.col.email.es": "Correo",
  "contacts.col.company": "Business name",
  "contacts.col.company.es": "Negocio",
  "contacts.col.created": "Created",
  "contacts.col.created.es": "Creado",
  "contacts.empty.title": "No contacts yet",
  "contacts.empty.title.es": "Todavía no hay contactos",
  "contacts.empty.body":
    "Contacts show up when Sofía takes a call, a form is submitted, or you add one yourself.",
  "contacts.empty.body.es":
    "Los contactos aparecen cuando Sofía atiende una llamada, se envía un formulario o usted agrega uno.",
  "contacts.noMatches.title": "No matches",
  "contacts.noMatches.title.es": "Sin coincidencias",
  "contacts.noMatches.body": "Try a different name, email, or phone number.",
  "contacts.noMatches.body.es": "Pruebe con otro nombre, correo o número de teléfono.",
  "contacts.firstName": "First name",
  "contacts.firstName.es": "Nombre",
  "contacts.lastName": "Last name",
  "contacts.lastName.es": "Apellido",
  "contacts.email": "Email",
  "contacts.email.es": "Correo",
  "contacts.phone": "Phone",
  "contacts.phone.es": "Teléfono",
  "contacts.createFailed": "Could not add that contact. Check the details and try again.",
  "contacts.createFailed.es": "No se pudo agregar ese contacto. Revise los datos e intente de nuevo.",
  "contacts.add.blank": "Add a name, email, or phone number.",
  "contacts.add.blank.es": "Agregue un nombre, un correo electrónico o un número de teléfono.",
  // 2026-10-28: Add contact's two shape refusals, named so the dialog words
  // them in the reader's language. The English is normalizeFieldInput's own
  // (lib/contacts/field-input.ts), which inline editing still shows as-is.
  "contacts.add.badEmail": "That doesn't look like an email address.",
  "contacts.add.badEmail.es": "Eso no parece una dirección de correo electrónico.",
  "contacts.add.badPhone": "That doesn't look like a phone number.",
  "contacts.add.badPhone.es": "Eso no parece un número de teléfono.",
  "contacts.add.existing": "This person is already in your contacts.",
  "contacts.add.existing.es": "Esta persona ya está en sus contactos.",
  "contacts.add.viewContact": "View contact",
  "contacts.add.viewContact.es": "Ver contacto",

  // The contacts table's bulk-action bar (DESIGN.md rule 4 — checkboxes
  // never render without bulk actions). "{count}"/"{tag}"/"{skipped}" are
  // the house {placeholder} convention (see setup.progress above).
  "bulk.selectPage": "Select all on this page",
  "bulk.selectPage.es": "Seleccionar todo en esta página",
  "bulk.selected": "{count} selected",
  "bulk.selected.es": "{count} seleccionados",
  // The singular, picked by plural() like contacts.countOne: never "1 seleccionados".
  "bulk.selectedOne": "1 selected",
  "bulk.selectedOne.es": "1 seleccionado",
  "bulk.addTag": "Add tag",
  "bulk.addTag.es": "Agregar etiqueta",
  // Contact archive (plan Task 3, spec §6): Archive sits on the list's own
  // bulk bar; Restore replaces it on the Archived view's (Owners, Staff and
  // the agency only — Technicians never see either, DESIGN.md rule 4).
  "bulk.archive": "Archive",
  "bulk.archive.es": "Archivar",
  "bulk.restore": "Restore",
  "bulk.restore.es": "Restaurar",
  "bulk.delete": "Delete…",
  "bulk.delete.es": "Borrar…",
  // Never "Borrar selección" — this clears the checkboxes, it does not
  // delete anything, and bulk.delete above already owns "Borrar…".
  "bulk.clear": "Clear selection",
  "bulk.clear.es": "Quitar selección",
  "bulk.confirmTitle": "Delete {count} contacts?",
  "bulk.confirmTitle.es": "¿Borrar {count} contactos?",
  // Singular pair, same house convention as shell.presence.idleOne: the
  // count is always literally 1, so it's spelled into the string rather
  // than carried as a placeholder. Single selection is the common case for
  // a bulk action bar, and "Delete 1 contacts?" / "Tagged 1 contacts" /
  // "Deleted 1 contacts" is broken English on a destructive confirmation.
  "bulk.confirmTitleOne": "Delete 1 contact?",
  "bulk.confirmTitleOne.es": "¿Borrar 1 contacto?",
  "bulk.confirmBody": "This can't be undone. Type {count} to confirm.",
  "bulk.confirmBody.es": "Esto no se puede deshacer. Escriba {count} para confirmar.",
  "bulk.tagged": "Tagged {count} contacts with \"{tag}\"",
  "bulk.tagged.es": "Se aplicó la etiqueta “{tag}” a {count} contactos",
  "bulk.taggedOne": "Tagged 1 contact with \"{tag}\"",
  "bulk.taggedOne.es": "Se aplicó la etiqueta “{tag}” a 1 contacto",
  "bulk.deleted": "Deleted {count} contacts",
  "bulk.deleted.es": "Se borraron {count} contactos",
  "bulk.deletedOne": "Deleted 1 contact",
  "bulk.deletedOne.es": "Se borró 1 contacto",
  // Contact archive (plan Task 3, spec §6): the toasts for a bulk Archive / Restore.
  "bulk.archived": "Archived {count} contacts",
  "bulk.archived.es": "Se archivaron {count} contactos",
  "bulk.archivedOne": "Archived 1 contact",
  "bulk.archivedOne.es": "Se archivó 1 contacto",
  "bulk.restored": "Moved {count} contacts back to your list",
  "bulk.restored.es": "Se devolvieron {count} contactos a su lista",
  "bulk.restoredOne": "Moved 1 contact back to your list",
  "bulk.restoredOne.es": "Se devolvió 1 contacto a su lista",
  // Each count follows a colon, so the words agree at any count, one included
  // ("Se borraron 1 · se conservaron 1" did not). Review I5/M8 (plan Task 3):
  // this used to list WHICH kinds of history blocked the delete ("linked to
  // bookings, deals, or conversations") — a reason list reads as a form and
  // goes stale as the delete-blocker set (spec §5.1) grows, so it names none
  // and offers Archive as the next step instead.
  "bulk.deletedSkipped": "Deleted {count} · kept {skipped} that have a history with you. You can archive those instead.",
  "bulk.deletedSkipped.es": "Contactos borrados: {count} · conservados porque tienen un historial con usted: {skipped}. Puede archivarlos.",
  // Task 10 review (count of one): picked by plural() on the KEPT count, so one kept reads in the singular.
  "bulk.deletedSkippedOne": "Deleted {count} · kept 1 that has a history with you. You can archive it instead.",
  "bulk.deletedSkippedOne.es": "Contactos borrados: {count} · conservado porque tiene un historial con usted: 1. Puede archivarlo.",
  // The same line in the Archived view, where the kept ones are already archived: no offer to archive them.
  "bulk.deletedSkippedArchived": "Deleted {count} · kept {skipped} that have a history with you. They stay archived.",
  "bulk.deletedSkippedArchived.es": "Contactos borrados: {count} · conservados porque tienen un historial con usted: {skipped}. Siguen archivados.",
  "bulk.deletedSkippedArchivedOne": "Deleted {count} · kept 1 that has a history with you. It stays archived.",
  "bulk.deletedSkippedArchivedOne.es": "Contactos borrados: {count} · conservado porque tiene un historial con usted: 1. Sigue archivado.",
  "bulk.archiveKept": "Archive them",
  "bulk.archiveKept.es": "Archivarlos",

  "pipeline.title": "Opportunities",
  // The header badge used to read "N · $X" — the same shape the per-column
  // subtotals use, which count every status (open+won+lost). Saying "open"
  // plainly tells the two apart instead of relying on the reader to notice
  // this one number landed above the columns rather than inside one.
  // "{count}"/"{value}" are the house {placeholder} convention (see
  // setup.progress above); the page .replace()s them.
  "pipeline.openTotal": "{count} open · {value}",
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
  "pipeline.status.open.es": "Abierta",
  "pipeline.status.won": "Won",
  "pipeline.status.won.es": "Ganada",
  "pipeline.status.lost": "Lost",
  "pipeline.status.lost.es": "Perdida",

  "contact.details": "Contact Details",
  "contact.details.es": "Datos de contacto",
  "contact.tags": "Tags",
  "contact.tags.es": "Etiquetas",
  "contact.addTag": "add tag",
  "contact.addTag.es": "agregar etiqueta",
  "contact.clearField": "—",
  "contact.clearField.es": "—",
  "contact.removeTag": "Remove {name}",
  "contact.removeTag.es": "Quitar {name}",
  "contact.opportunities": "Opportunities",
  "contact.opportunities.es": "Oportunidades",
  "contact.activity": "Activity",
  "contact.notes": "Notes",
  "contact.tasks": "Tasks",
  "contact.tasks.es": "Pendientes",
  "contact.addNote": "Add a note…",
  "contact.addNote.es": "Escriba una nota…",
  "contact.addTask": "New task…",
  "contact.addTask.es": "Nuevo pendiente…",
  "contact.done": "done",
  "contact.done.es": "listo",
  "contact.company": "Business name",
  "contact.company.es": "Nombre del negocio",
  "contact.business.tooLong": "Business names can be up to 120 characters.",
  "contact.business.tooLong.es": "El nombre del negocio puede tener hasta 120 caracteres.",
  // I3: a Business name save that changed nothing because the business is
  // already on the list under another spelling says so, instead of "saved".
  "contact.business.alreadyAs": "Already on your list as “{name}”.",
  "contact.business.alreadyAs.es": "Ya está en su lista como “{name}”.",
  // F-157's drawer line (docs/crm-features.md §4.3 rider 6): the owner's own
  // free-text note on where this lead came from ("contact.source.label",
  // inline-editable like the fields above) plus the auto-detected hint next
  // to it — never guessed, so a contact with nothing captured says so in
  // plain words rather than showing a blank that looks identical to "nobody
  // filled this in". The Spanish lines wait for an operator locale (common
  // rule; precedent `todo.consent.*`, messages.ts:628-642 on origin/main).
  "contact.source.label": "Source",
  "contact.source.label.es": "Origen",
  "contact.source.unknown": "Source unknown",
  "contact.source.unknown.es": "Origen desconocido",
  "contact.source.foundThrough": "Found through {channel}",
  "contact.source.foundThrough.es": "Llegó a través de {channel}",
  "contact.source.referredBy": "Referred by {name}",
  "contact.source.referredBy.es": "Recomendado por {name}",
  // Review round 1, m3: a humanized caption for the raw machine values
  // `source` stores at creation ("voice", "booking", "form: X") — shown
  // ONLY for those exact recognized shapes; an owner's own typed note
  // (anything else) gets no caption, since there is nothing machine-made to
  // translate. Review round 2, item 1: "form: {name}" is NOT only a typed
  // web form — enrich.ts writes it for every intake that calls enrich(),
  // which also includes a web-chat lead (lib/concierge/lead.ts) and the
  // retired shared-secret machine intake, both filed against the owner's
  // destination form. "They filled out the form" is false for a chat
  // lead. Review round 3, item 4: "Came in through your form" (round 2's
  // own fix) still names an entry path — walking through a door — a chat
  // visitor never used either. "Saved to" names the one fact shared by
  // all three intakes (the answers landed in that form's records)
  // without claiming HOW they got there. Usted register in the .es
  // twin — this line is read by the OWNER, not the customer.
  "contact.source.machine.voice": "They called in",
  "contact.source.machine.voice.es": "Llamaron por teléfono",
  "contact.source.machine.booking": "They booked online",
  "contact.source.machine.booking.es": "Reservaron en línea",
  "contact.source.machine.form": "Saved to your “{name}” form",
  "contact.source.machine.form.es": "Guardado en su formulario “{name}”",
  // S-09 (a language on every customer): the record's and the drawer's Language line. Spec §15.2's
  // words, plus `.choose` (plan deviation 10). `.notSetAccount` ("…, the account's language.") and
  // `.notSetUnknown` ("Not set.") are live from PR 2, which is what makes that clause true: messages
  // now go out in the account's language to a customer whose own is not yet known. "their", never
  // "her": BIS stores no gender.
  // {value} is the endonym; {language} the in-sentence name (language.name.*).
  "contact.language.label": "Language",
  "contact.language.label.es": "Idioma",
  "contact.language.notSet": "Not set. Messages go out in {language}.",
  "contact.language.notSet.es": "Sin definir. Los mensajes salen en {language}.",
  "contact.language.notSetAccount": "Not set. Messages go out in {language}, the account's language.",
  "contact.language.notSetAccount.es": "Sin definir. Los mensajes salen en {language}, el idioma de la cuenta.",
  "contact.language.notSetUnknown": "Not set.",
  "contact.language.notSetUnknown.es": "Sin definir.",
  "contact.language.choose": "Choose",
  "contact.language.choose.es": "Elegir",
  "contact.language.from.booking": "from their booking ({date})",
  "contact.language.from.booking.es": "por su cita ({date})",
  "contact.language.from.form": "from a form they filled in ({date})",
  "contact.language.from.form.es": "por un formulario que llenó ({date})",
  "contact.language.from.call": "from a call ({date})",
  "contact.language.from.call.es": "por una llamada ({date})",
  "contact.language.from.staff": "set by your team ({date})",
  "contact.language.from.staff.es": "lo eligió su equipo ({date})",
  "contact.language.hint.call": "Spoke {language} on the last call. Switch to {language}?",
  "contact.language.hint.call.es": "En la última llamada habló {language}. ¿Cambiar a {language}?",
  "contact.language.hint.booking": "Booked in {language} last time. Switch to {language}?",
  "contact.language.hint.booking.es": "La última vez hizo su cita en {language}. ¿Cambiar a {language}?",
  "contact.language.hint.form": "Filled in a form in {language} last time. Switch to {language}?",
  "contact.language.hint.form.es": "La última vez llenó un formulario en {language}. ¿Cambiar a {language}?",
  "contact.language.switch": "Switch",
  "contact.language.switch.es": "Cambiar",
  "contact.language.keep": "Keep",
  "contact.language.keep.es": "Dejarlo así",
  "contact.language.setToast": "Language set to {value}.",
  "contact.language.setToast.es": "Idioma cambiado a {value}.",
  "contact.language.keptToast": "We'll ask again if a newer call, booking or form says otherwise.",
  "contact.language.keptToast.es": "Le volveremos a preguntar si otra llamada, cita o formulario dice otra cosa.",
  "contact.language.saveFailed": "Couldn't change the language. Try again.",
  "contact.language.saveFailed.es": "No se pudo cambiar el idioma. Intente de nuevo.",
  "contact.language.changed": "This customer's language changed since then. Nothing was undone.",
  "contact.language.changed.es": "El idioma de este cliente cambió desde entonces. No se deshizo nada.",
  "language.name.en": "English",
  "language.name.en.es": "inglés",
  "language.name.es": "Spanish",
  "language.name.es.es": "español",
  "contact.noActivity": "No activity yet",
  "contact.noActivityBody": "Notes, tasks, and deals will appear here.",
  "contact.noOpportunities": "None yet.",
  "contact.noOpportunities.es": "Todavía no hay ninguna.",
  "contact.noName": "(no name)",
  "contact.noName.es": "(sin nombre)",

  // The contact's "Messages" block (consent chain spec §6). PR-1 ships only
  // the Texts row's Check number state (F-009); the rest lands in PR-2/PR-3.
  // "line", "mx" and "us" are the spec's words, verbatim.
  "contact.messages.title": "Messages",
  "contact.messages.title.es": "Mensajes",
  "contact.messages.texts": "Texts",
  "contact.messages.texts.es": "Textos",
  // Consent chain PR-3: the Email row (spec §6; plan G14). "Stop emails" /
  // "Resume emails…" mirror the Texts row's words.
  "contact.messages.email": "Email",
  "contact.messages.email.es": "Correo",
  "contact.email.allowed": "Allowed",
  "contact.email.allowed.es": "Permitido",
  "contact.email.stopped": "Stopped",
  "contact.email.stopped.es": "Detenido",
  "contact.email.since": "Since {date}",
  "contact.email.since.es": "Desde el {date}",
  "contact.email.how.unsubscribeLink": "unsubscribe link",
  "contact.email.how.unsubscribeLink.es": "enlace para darse de baja",
  "contact.email.how.staff": "you recorded it",
  "contact.email.how.staff.es": "usted lo registró",
  "contact.email.how.backfill0049": "you marked them “No marketing emails”",
  "contact.email.how.backfill0049.es": "usted lo marcó como “Sin correos de promociones”",
  // D-016 item 4: a hard bounce or a complaint is the PROVIDER's fact about
  // the address, never a choice staff or the customer made through a link —
  // its own short "how" (for the "Since {date} · {how}" line) and its own
  // longer explanation in place of "They can resubscribe from the
  // unsubscribe link…", which is simply false once an address is suppressed
  // (no more emails go out carrying that link).
  "contact.email.how.bounced": "it bounced",
  "contact.email.how.bounced.es": "rebotó",
  "contact.email.how.complained": "they marked it as spam",
  "contact.email.how.complained.es": "lo marcó como spam",
  "contact.email.bouncedExplain": "This address bounced — emails to it won't send. Fix the address to start again.",
  "contact.email.bouncedExplain.es": "Esta dirección rebotó: los correos no se envían. Corrija la dirección para empezar de nuevo.",
  // Review item 7(i): Resend's OWN suppression list is shared across our
  // WHOLE team, every tenant (resend.com/docs/dashboard/emails/email-
  // suppressions) and a resubscribe here lifts only OUR OWN tracking of
  // consent, never Resend's — so this says what WE do (stop trying), never
  // a guarantee that a resubscribe alone restores delivery, which would not
  // always be true.
  "contact.email.complainedExplain": "They marked an email as spam — we won't email them again unless they resubscribe.",
  "contact.email.complainedExplain.es": "Marcó un correo como spam: no le volveremos a escribir a menos que se vuelva a suscribir.",
  "contact.email.stopEmails": "Stop emails",
  "contact.email.stopEmails.es": "Detener correos",
  "contact.email.stoppedToast": "Emails stopped.",
  "contact.email.stoppedToast.es": "Se detuvieron los correos.",
  "contact.email.resume": "Resume emails…",
  "contact.email.resume.es": "Reanudar correos…",
  "contact.email.resumeNoteLabel": "What did they ask for? (required)",
  "contact.email.resumeNoteLabel.es": "¿Qué pidió? (obligatorio)",
  "contact.email.resumeSubmit": "Resume emails",
  "contact.email.resumeSubmit.es": "Reanudar correos",
  "contact.email.resumeCancel": "Cancel",
  "contact.email.resumeCancel.es": "Cancelar",
  "contact.email.resumeNoteRequired": "Write what they asked for before you turn emails back on.",
  "contact.email.resumedToast": "Emails are back on. To stop them again, use Stop emails.",
  "contact.email.resumedToast.es": "Los correos se reanudaron. Para detenerlos otra vez, use Detener correos.",
  "contact.email.customerOnly": "They can resubscribe from the unsubscribe link in any email from you.",
  "contact.email.customerOnly.es": "Puede volver a suscribirse desde el enlace para darse de baja en cualquier correo que usted le mande.",
  "contact.email.loadFailed": "Couldn't load their email settings. Try again.",
  "contact.email.loadFailed.es": "No se pudo cargar la configuración de correo. Intente de nuevo.",
  "contact.email.changed": "Their emails changed while you were looking. This is where they stand now.",
  "contact.email.failed": "Couldn't save that — please try again.",
  "contact.email.noEmail": "They have no email address.",
  "contact.email.undoBusy": "Your last change is still saving. Try again in a moment.",
  "contact.email.undoBusy.es": "Su último cambio todavía se está guardando. Intente de nuevo en un momento.",
  "contact.email.undoExpired": "That can no longer be undone here. Use Stop emails or Resume emails instead.",
  "contact.phoneCountry.word": "Check number",
  "contact.phoneCountry.line": "This number could be Mexican or US.",
  "contact.phoneCountry.line.es": "Este número puede ser de México o de EE. UU.",
  "contact.phoneCountry.mx": "Mexico (+52)",
  "contact.phoneCountry.mx.es": "México (+52)",
  "contact.phoneCountry.us": "US (+1)",
  "contact.phoneCountry.us.es": "EE. UU. (+1)",
  "contact.phoneCountry.mxToast": "Saved as a Mexican number",
  "contact.phoneCountry.usToast": "Saved as a US number",
  "contact.phoneCountry.failed": "Couldn't save that — please try again.",
  "contact.phoneCountry.changed": "Their number changed while you were choosing. Reload to see it.",
  "contact.phoneCountry.unreadable": "That number can't be read as a US or Mexican number. Edit it instead.",
  "contact.phoneCountry.undoBusy": "Your last change is still saving. Edit the number itself to change it back.",
  "contact.phoneCountry.inlineChanged": "Their number changed since your edit. Reload to see it.",
  // The rest of the Texts row (consent chain PR-2, spec §6). Status words are
  // a dot + word (rule 3). "{date}" is a calendar day in the account's zone;
  // "{word}" is the keyword as staff read it (keywordDisplay); "{excerpt}" is
  // what the customer wrote, cut at 60 characters; "{name}" is the staff
  // member's first name (plan G14).
  "contact.texts.allowed": "Allowed",
  "contact.texts.allowed.es": "Permitido",
  "contact.texts.stopped": "Stopped",
  "contact.texts.stopped.es": "Detenido",
  "contact.texts.held": "On hold",
  "contact.texts.held.es": "En pausa",
  "contact.texts.since": "Since {date}",
  "contact.texts.since.es": "Desde el {date}",
  "contact.texts.how.keyword": "they texted {word}",
  "contact.texts.how.keyword.es": "mandó {word} por texto",
  "contact.texts.how.freeTextBy": "they wrote “{excerpt}”, confirmed by {name}",
  "contact.texts.how.freeTextBy.es": "escribió “{excerpt}”, confirmado por {name}",
  "contact.texts.how.freeText": "they wrote “{excerpt}”, confirmed by your team",
  "contact.texts.how.freeText.es": "escribió “{excerpt}”, confirmado por su equipo",
  "contact.texts.how.staff": "you recorded it",
  "contact.texts.how.staff.es": "usted lo registró",
  "contact.texts.how.carrier": "the carrier blocked it",
  "contact.texts.how.carrier.es": "la compañía telefónica lo bloqueó",
  "contact.texts.how.unsubscribeLink": "unsubscribe link",
  "contact.texts.how.unsubscribeLink.es": "enlace para darse de baja",
  "contact.texts.stopTexts": "Stop texts",
  "contact.texts.stopTexts.es": "Detener textos",
  "contact.texts.stoppedToast": "Texts stopped.",
  "contact.texts.stoppedToast.es": "Se detuvieron los textos.",
  "contact.texts.resume": "Resume texts…",
  "contact.texts.resume.es": "Reanudar textos…",
  "contact.texts.resumeNoteLabel": "What did they ask for? (required)",
  "contact.texts.resumeNoteLabel.es": "¿Qué pidió? (obligatorio)",
  "contact.texts.resumeSubmit": "Resume texts",
  "contact.texts.resumeSubmit.es": "Reanudar textos",
  "contact.texts.resumeCancel": "Cancel",
  "contact.texts.resumeCancel.es": "Cancelar",
  "contact.texts.resumeNoteRequired": "Write what they asked for before you turn texts back on.",
  "contact.texts.resumedToast": "Texts are back on. To stop them again, use Stop texts.",
  "contact.texts.resumedToast.es": "Los textos se reanudaron. Para detenerlos otra vez, use Detener textos.",
  "contact.texts.customerOnly": "They can text START to get texts again.",
  "contact.texts.customerOnly.es": "Puede mandar START por texto para volver a recibir textos.",
  "contact.texts.heldLine": "They wrote “{excerpt}”. Texts are on hold.",
  "contact.texts.heldLine.es": "Escribió “{excerpt}”. Los textos están en pausa.",
  "contact.texts.confirmStop": "Confirm stop",
  "contact.texts.confirmStop.es": "Confirmar que pidió parar",
  "contact.texts.notAStop": "Not a stop",
  "contact.texts.notAStop.es": "No pidió parar",
  "contact.texts.confirmedToast": "Stop confirmed. Texts to them are stopped.",
  "contact.texts.confirmedToast.es": "Confirmado. Ya no se le mandan textos.",
  "contact.texts.releasedToast": "Hold lifted. Texts to them are back on.",
  "contact.texts.releasedToast.es": "Se quitó la pausa. Se le vuelven a mandar textos.",
  "contact.texts.loadFailed": "Couldn't load their message settings. Try again.",
  "contact.texts.loadFailed.es": "No se pudo cargar la configuración de mensajes. Intente de nuevo.",
  "contact.texts.changed": "Their texts changed while you were looking. This is where they stand now.",
  "contact.texts.failed": "Couldn't save that — please try again.",
  "contact.texts.noNumber": "They have no number to text.",
  "contact.texts.undoBusy": "Your last change is still saving. Try again in a moment.",
  "contact.texts.undoBusy.es": "Su último cambio todavía se está guardando. Intente de nuevo en un momento.",
  "contact.texts.undoExpired": "That can no longer be undone here. Use Stop texts or Resume texts instead.",
  // The consent To-do rows (spec §6). The English line is written into
  // tasks.title when the To-do is made (plan G8); the Spanish lines wait for an
  // operator locale. "{date}" is the appointment's calendar day in the account's zone.
  "todo.consent.hold.en": "{name} may have asked to stop texts: “{excerpt}”. Texts to them are on hold.",
  "todo.consent.hold.es": "{name} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes están en pausa.",
  "todo.consent.hold.confirm.es": "Confirmar",
  "todo.consent.hold.notStop.es": "No era eso",
  "todo.consent.cancel.en": "{name} texted {word}, so their texts are stopped. Check whether they also meant their appointment on {date}.",
  "todo.consent.cancel.es": "{name} envió {word} y sus mensajes quedaron suspendidos. Revise si también quería cancelar su cita del {date}.",
  "todo.consent.decided": "This one was already decided. Open the contact to see where their texts stand.",
  "todo.consent.decideFirst": "Decide this one with Confirm stop or Not a stop.",
  // Names the two buttons by their own Spanish words (contact.texts.confirmStop.es / notAStop.es).
  "todo.consent.decideFirst.es": "Decídalo con “Confirmar que pidió parar” o “No pidió parar”.",
  // The contact timeline's line in place of Done for an open To-do whose
  // number is still on hold (review R3-N1). It points at the To do page, the
  // one place that can always close it: after a phone correction the Texts
  // row no longer shows the old number's hold (review M3), and a CANCEL
  // To-do the fail-closed read marks keeps its Done there (review M4).
  "todo.consent.timelineHint": "Close this one from the To do page.",
  "todo.consent.timelineHint.es": "Ciérrelo desde la página de Pendientes.",
  "todo.consent.failed": "Couldn't save that — please try again.",
  "todo.consent.failed.es": "No se guardó. Vuelva a intentarlo.",

  // The contact list's drawer (S-03 part 3): the record's quick look.
  "drawer.recent": "Recent",
  "drawer.recent.es": "Lo más reciente",
  "drawer.seeAll": "See all activity",
  "drawer.seeAll.es": "Ver toda la actividad",
  "drawer.moreOnRecord": "Groups, properties and related people are on the full record.",
  "drawer.moreOnRecord.es": "Los grupos, las propiedades y las personas relacionadas están en la ficha completa.",
  // The whole drawer's error only; a section's failure says its own words.
  "drawer.loadFailed": "Couldn't load this customer. Try again, or open the full record.",
  "drawer.loadFailed.es": "No se pudo cargar este cliente. Intente de nuevo o abra la ficha completa.",
  "drawer.openFull": "Open full record",
  "drawer.openFull.es": "Abrir la ficha completa",
  // The Sheet's close button, read by a screen reader (plan deviation 3).
  "drawer.close": "Close",
  "drawer.close.es": "Cerrar",
  // Screen-reader-only (Radix logs a missing-Description warning without one).
  "drawer.description": "A quick look at this customer: how to reach them, what's next and what happened lately.",
  "drawer.description.es": "Un vistazo a este cliente: cómo comunicarse, lo que sigue y lo más reciente.",

  "settings.title": "Settings",
  // Spanish-runtime Task 5 (owner decision 4, 2026-10-10): the one inline
  // Language field on the agency Settings page, writing accounts.language.
  // "English"/"Español" named literally in BOTH language versions, the same
  // choice calendar.cancelDialog.languageEnglish/languageSpanish already
  // make for naming a language by name regardless of which one is reading.
  "settings.language.label": "Language",
  "settings.language.label.es": "Idioma",
  // The Language card's one line (M4 review): what the setting changes and
  // who it leaves alone. Agency staff stay English (owner decision 1); the
  // alert texts follow it too (owner decision B).
  "settings.language.description": "Changes the language your client sees when they sign in and their alert texts, and the language automatic messages go out in to customers whose language we don't know yet. Agency staff stay in English.",
  "settings.language.description.es": "Cambia el idioma que ve su cliente al iniciar sesión y sus mensajes de aviso, y el idioma de los mensajes automáticos a los clientes de quienes todavía no sabemos el idioma. El personal de la agencia sigue en inglés.",
  "settings.language.invalid": "Choose English or Español.",
  "settings.language.invalid.es": "Elija inglés o español.",
  "settings.customFields": "Custom fields",
  "settings.customFieldsBody": "Extra fields captured on every contact.",
  "settings.customValues": "Custom values",
  "settings.customValuesBody": "Details about this business — like its service area or license number — that messages and pages can fill in automatically.",
  "settings.fieldName": "Field name",
  "settings.fieldKey": "field_key",
  // Review round 1, m4: "referred_by" is reserved — F-157's source
  // question writes it directly (lib/contacts/lead-source.ts), and a
  // custom field reusing that exact key would merge two unrelated facts
  // into one stored value. Review round 2, minor 3: a browser-side
  // refusal (the field-key Input's own `pattern`, settings/page.tsx) is
  // the PRIMARY UX. Review round 3, item 1 correction: a browser shows an
  // Input's `title` for ANY pattern mismatch, not only the reserved-key
  // one — "Gate Code"/"gateCode"/"gate-code" all fail the shape half of
  // the pattern too, and `title` is also a plain hover tooltip shown on
  // an EMPTY field. This string now names the WHOLE pattern
  // (settings.fieldKeyFormat, below) and is the Input's `title`; this key
  // stays for the one thing it is actually true for — the SERVER-SIDE
  // throw in createFieldAction (the backstop for a bypassed or scripted
  // submit, which has no result-returning wiring to show it at all: it
  // lands, plainly, on the dashboard's generic error page).
  // Post-merge review of #228 (owner decision): the "source question" is
  // the form editor's "Who recommended you?" field
  // (forms.kind.core.referral_source), and these four strings now name it
  // that way — the owner never sees the words "source question" anywhere.
  // Pinned in messages.test.ts against that key's own text, per language.
  "settings.fieldKeyReserved": "\"referred_by\" is reserved for the \"Who recommended you?\" question — pick a different field key.",
  "settings.fieldKeyReserved.es": "\"referred_by\" está reservado para la pregunta \"¿Quién le recomendó?\" — elija otra clave de campo.",
  "settings.fieldKeyFormat": "Lowercase letters, numbers and underscores only. \"referred_by\" is reserved for the \"Who recommended you?\" question.",
  "settings.fieldKeyFormat.es": "Solo letras minúsculas, números y guiones bajos. \"referred_by\" está reservado para la pregunta \"¿Quién le recomendó?\".",
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
  // F-196: {max} is WEEKLY_REPORT_MAX_RECIPIENTS (lib/automations/caps.ts), filled by the card.
  "settings.weeklyReportHint": "Who gets Monday's numbers. Separate addresses with commas. Up to {max} addresses.",
  "settings.weeklyReportHint.es": "Quién recibe los números del lunes. Separa las direcciones con comas. Hasta {max} direcciones.",
  "settings.weeklyReportSaved": "Saved. The next report goes out Monday morning.",
  "settings.weeklyReportBadEmail": "That doesn't look like an email address: {value}",
  // F-196: the weekly report goes to at most WEEKLY_REPORT_MAX_RECIPIENTS
  // addresses (lib/automations/caps.ts says why). {max} is that number.
  "settings.weeklyReportTooMany": "The weekly report can go to {max} addresses at most.",
  "settings.weeklyReportTooMany.es": "El informe semanal puede ir a {max} direcciones como máximo.",
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
  // The alert phone's country (consent chain PR-1, F-009): never ambiguous.
  "settings.alertPhoneCountry": "Country of this number",
  "settings.alertPhoneCountryUs": "US (+1)",
  "settings.alertPhoneCountryMx": "Mexico (+52)",
  // A number typed WITH a country code that is not the country picked
  // (review R3-M4): never texted, never silently re-coded.
  "settings.alertPhoneCountryMismatch": "That number starts with a different country code than the one picked. Pick the matching country, or type just the ten digits.",
  // Spec §6, verbatim: the code could not go because that phone texted STOP.
  "settings.alertPhoneStopped": "This number has stopped texts from your business line. Text START to it from that phone to turn them back on.",
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

  "settings.requiredDocuments.title": "Required documents",
  "settings.requiredDocuments.title.es": "Documentos requeridos",
  "settings.requiredDocuments.body": "Each customer's Documents card will show which of these they're missing.",
  "settings.requiredDocuments.body.es": "La tarjeta de Documentos de cada cliente mostrará cuáles de estos le faltan.",
  "settings.requiredDocuments.off": "Nothing is required yet, so the list is off.",
  "settings.requiredDocuments.off.es": "Todavía no se requiere nada, así que la lista está apagada.",
  "settings.requiredDocuments.saved": "Saved. Each customer's Documents card shows the list.",
  "settings.requiredDocuments.saved.es": "Guardado. La tarjeta de Documentos de cada cliente muestra la lista.",
  "settings.requiredDocuments.savedOff": "Saved. The list is off.",
  "settings.requiredDocuments.savedOff.es": "Guardado. La lista está apagada.",
  "settings.requiredDocuments.role": "Only an Owner can change this list.",
  "settings.requiredDocuments.role.es": "Solo un dueño puede cambiar esta lista.",
  "settings.requiredDocuments.failed": "Couldn't save the list. Try again.",
  "settings.requiredDocuments.failed.es": "No se pudo guardar la lista. Intente de nuevo.",

  "error.title": "Something went wrong",
  "error.body": "We couldn't complete that action. Your changes may not have been saved.",
  "error.retry": "Try again",

  "notFound.title": "Page not found",
  "notFound.body": "That page doesn't exist or may have moved.",
  "notFound.back": "Back to dashboard",

  "theme.toggle": "Toggle light and dark mode",
  // Mis preferencias (F-096, D5): the toggle applies the new mode at once and
  // saves it in the background; this is shown only if that background save
  // fails, so the chosen mode keeps working this visit but may not survive a
  // reload.
  "theme.saveFailed": "Couldn't save your theme. It may switch back when the page reloads.",
  "theme.saveFailed.es": "No se pudo guardar tu tema. Puede volver al anterior al recargar la página.",

  // Mis preferencias (F-096, Task 6): the Preferences page, its user-menu
  // item and its ⌘K entry. A person's own page, so every key has a Spanish
  // twin; rendered through t(m, key, locale) in the person's own locale.
  // Language NAMES inside a sentence are in that sentence's language
  // (prefs.languageName.*); the radios themselves keep LANGUAGE_OPTIONS'
  // own-language labels ("English", "Español"), the word a reader looks for.
  "prefs.title": "Your preferences",
  "prefs.title.es": "Tus preferencias",
  "prefs.intro": "These are just for you. Nobody else on your team sees them change.",
  "prefs.intro.es": "Solo son para ti. Nadie más de tu equipo ve el cambio.",
  "prefs.language.legend": "Language",
  "prefs.language.legend.es": "Idioma",
  "prefs.language.account": "Follow the account",
  "prefs.language.account.es": "Seguir el idioma de la cuenta",
  "prefs.language.accountHint": "The account's language right now is {language}.",
  "prefs.language.accountHint.es": "Ahora mismo el idioma de la cuenta es {language}.",
  "prefs.language.agencyEmpty": "You'll see English until you pick one.",
  "prefs.language.agencyEmpty.es": "Verás inglés hasta que elijas uno.",
  "prefs.languageName.english": "English",
  "prefs.languageName.english.es": "inglés",
  "prefs.languageName.spanish": "Spanish",
  "prefs.languageName.spanish.es": "español",
  "prefs.theme.legend": "Theme",
  "prefs.theme.legend.es": "Tema",
  "prefs.theme.light": "Light",
  "prefs.theme.light.es": "Claro",
  "prefs.theme.dark": "Dark",
  "prefs.theme.dark.es": "Oscuro",
  "prefs.theme.system": "Follow my device",
  "prefs.theme.system.es": "Seguir mi dispositivo",
  "prefs.theme.empty": "You haven't picked one yet, so you're seeing the {mode} look.",
  "prefs.theme.empty.es": "Aún no has elegido, así que ves el tema {mode}.",
  "prefs.theme.emptyDevice": "You haven't picked one yet, so the look follows your device.",
  "prefs.theme.emptyDevice.es": "Aún no has elegido, así que el tema sigue tu dispositivo.",
  "prefs.mode.light": "light",
  "prefs.mode.light.es": "claro",
  "prefs.mode.dark": "dark",
  "prefs.mode.dark.es": "oscuro",
  "prefs.saved.language": "Language set to {language}.",
  "prefs.saved.language.es": "Idioma cambiado a {language}.",
  "prefs.saved.languageAccount": "You'll see the account's language, {language}.",
  "prefs.saved.languageAccount.es": "Verás el idioma de la cuenta: {language}.",
  "prefs.saved.theme.light": "Light theme on.",
  "prefs.saved.theme.light.es": "Tema claro activado.",
  "prefs.saved.theme.dark": "Dark theme on.",
  "prefs.saved.theme.dark.es": "Tema oscuro activado.",
  "prefs.saved.theme.system": "The theme now follows your device.",
  "prefs.saved.theme.system.es": "El tema ahora sigue tu dispositivo.",
  "prefs.saved.theme.none": "Back to the default theme for your login.",
  "prefs.saved.theme.none.es": "Volviste al tema predeterminado.",
  "prefs.undo": "Undo",
  "prefs.undo.es": "Deshacer",
  "prefs.undone": "Changed back.",
  "prefs.undone.es": "Se deshizo el cambio.",
  "prefs.error.failed": "That didn't save. Try again in a moment.",
  "prefs.error.failed.es": "No se guardó. Inténtalo de nuevo en un momento.",
  "prefs.error.load": "We couldn't load your preferences. Reload the page.",
  "prefs.error.load.es": "No pudimos cargar tus preferencias. Recarga la página.",
  "prefs.reload": "Reload",
  "prefs.reload.es": "Recargar",
  "prefs.menuItem": "Preferences",
  "prefs.menuItem.es": "Preferencias",
  "prefs.palette": "Preferences: language and theme",
  "prefs.palette.es": "Preferencias: idioma y tema",
  "pipeline.dropHere": "Drop an opportunity here",

  "compose.note": "Note",
  "compose.note.es": "Nota",
  "compose.email": "Email",
  "compose.email.es": "Correo",
  "compose.subject": "Subject",
  "compose.subject.es": "Asunto",
  "compose.emailPlaceholder": "Write an email…",
  "compose.emailPlaceholder.es": "Escriba un correo…",
  "compose.send": "Send",
  "compose.send.es": "Enviar",
  "compose.sending": "Sending…",
  "compose.sending.es": "Enviando…",
  "compose.sent": "Email sent.",
  "compose.sent.es": "Correo enviado.",
  "compose.sendFailed": "Could not send that email. It is saved as failed in the thread.",
  "compose.sendFailed.es": "No se pudo enviar ese correo. Quedó guardado como fallido en la conversación.",
  "compose.sendRejected": "Could not send that email. Check the contact has an email address.",
  "compose.sendRejected.es": "No se pudo enviar ese correo. Revise que el contacto tenga correo.",
  "compose.noteFailed": "Could not save that note. Try again.",
  "compose.noteFailed.es": "No se pudo guardar esa nota. Intente de nuevo.",
  "compose.noEmailOnContact": "This contact has no email address.",
  "compose.noEmailOnContact.es": "Este contacto no tiene correo.",
  "compose.sms": "Text",
  "compose.sms.es": "Texto",
  "compose.smsPlaceholder": "Write a text…",
  "compose.smsPlaceholder.es": "Escriba un texto…",
  "compose.smsSent": "Text sent",
  "compose.smsSent.es": "Texto enviado",
  "compose.smsFailed": "Could not send the text",
  "compose.smsFailed.es": "No se pudo enviar el texto",
  // Mirrors compose.sendRejected's shape: a fixed, generic line shown whenever
  // the server refuses the send before anything reached the provider — never
  // the raw internal reason (see send-errors.ts).
  "compose.smsSendRejected": "Could not send that text. Check the contact has a phone number.",
  "compose.smsSendRejected.es": "No se pudo enviar ese texto. Revise que el contacto tenga número de teléfono.",
  // Mirrors compose.noEmailOnContact in wording and tone. Covers both an
  // empty phone field and one that couldn't be turned into a number we can
  // actually text (see lib/voice/phone-number.ts's toE164).
  "compose.noPhoneOnContact": "This contact has no phone number.",
  "compose.noPhoneOnContact.es": "Este contacto no tiene número de teléfono.",
  // Says WHO is holding it up and what unblocks it, rather than "unavailable".
  "compose.smsBlockedA2p": "Texting is off until this company's A2P registration is approved",
  "compose.smsBlockedA2p.es": "Los textos están apagados hasta que se apruebe el registro de mensajes de esta empresa",
  "compose.smsBlockedNoNumber": "Texting needs a live phone number on this company",
  "compose.smsBlockedNoNumber.es": "Para mandar textos, esta empresa necesita un número de teléfono activo",
  // M7a PR-4: the staff composer's own refusal while an account is paused
  // for billing (G7a's last line — non-automation sends are refused with a
  // sentence, not held).
  "compose.smsBlockedPaused": "Texts are stopped while this account is paused.",
  "compose.smsBlockedPaused.es": "Los mensajes están detenidos mientras la cuenta está en pausa.",
  // The consent gate (lib/consent/composer-state.ts): the one line the text
  // composer shows in place of its form, and the toast a refused send gives.
  "compose.smsStopped": "They stopped texts on {date}. You can't text this number until they text START.",
  "compose.smsStopped.es": "Dejó de recibir textos el {date}. No puede mandarle textos a este número hasta que mande START.",
  "compose.smsStoppedUndated": "They stopped texts from you. You can't text this number until they text START.",
  "compose.smsStoppedUndated.es": "Dejó de recibir sus textos. No puede mandarle textos a este número hasta que mande START.",
  "compose.smsHeld": "Texts to them are on hold while you check whether they asked to stop.",
  "compose.smsHeld.es": "Los textos a esta persona están en pausa mientras revisa si pidió que se detuvieran.",
  "compose.smsCheckNumber": "This number could be Mexican or US. Pick its country on their contact before you text it.",
  "compose.smsCheckNumber.es": "Este número podría ser de México o de EE. UU. Elija su país en el contacto antes de mandarle un texto.",
  "compose.smsStateUnknown": "Couldn't check whether they can get texts. Reload the page to try again.",
  "compose.smsStateUnknown.es": "No se pudo revisar si puede recibir textos. Vuelva a cargar la página para intentar de nuevo.",
  // Consent chain PR-3 (spec §6, choice 22; plan G15): the email composer
  // stays usable and says why the operator should keep it to their matter.
  "compose.emailUnsubscribed": "They unsubscribed from your emails on {date}. Write only about something they asked you for.",
  "compose.emailUnsubscribed.es": "Se dio de baja de sus correos el {date}. Escríbale solo sobre algo que le haya pedido.",
  "compose.emailStoppedByYou": "You stopped emails to them on {date}. Write only about something they asked you for.",
  "compose.emailStoppedByYou.es": "Usted detuvo los correos a esta persona el {date}. Escríbale solo sobre algo que le haya pedido.",
  // D-016 item 4: the provider's own facts about the address (a hard bounce,
  // a complaint) read differently to the composer than a stop anyone CHOSE —
  // the one line still fits the same "on {date}" shape as the two above, so
  // the undated fallback (composer-state.ts's catch branch) keeps working.
  "compose.emailBounced": "This address bounced on {date} — emails to it won't send. Fix the address to start again.",
  "compose.emailBounced.es": "Este correo rebotó el {date}: los correos a esta dirección no se enviarán. Corrija la dirección para empezar de nuevo.",
  // Review item 7(i): same caveat as contact.email.complainedExplain —
  // Resend's own TEAM-wide suppression list is a separate thing we don't
  // control, so this states OUR policy, never a delivery guarantee.
  "compose.emailComplained": "This person marked an email as spam on {date} — we won't email them again unless they resubscribe.",
  "compose.emailComplained.es": "Esta persona marcó un correo como spam el {date}; no le volveremos a escribir a menos que se vuelva a suscribir.",
  "compose.emailStateUnknown": "Couldn't check whether they unsubscribed. Write only about something they asked you for.",
  "compose.emailStateUnknown.es": "No se pudo revisar si se dio de baja. Escríbale solo sobre algo que le haya pedido.",
  // {n} segments — SMS bills per segment, and a single non-GSM character
  // (an accent, a curly apostrophe) drops the whole message to 70 per segment.
  "compose.smsSegments": "{chars} characters · {segments} message(s)",
  "compose.smsSegments.es": "{chars} caracteres · {segments} mensaje(s)",

  "conversations.empty.title": "No conversations yet",
  "conversations.empty.title.es": "Todavía no hay conversaciones",
  // Named against every real ensureConversation() caller: voice
  // (finish-call.ts, textback.ts, tools/registry.ts), sms/inbound's route,
  // bookings and cancellations (b/[publicId]'s actions), and forms/enrich.ts
  // — web chat (c/[publicId]) creates none. Rule 5: what appears + the
  // action that causes it.
  "conversations.empty.body": "Calls, texts, emails, bookings and form submissions with a contact show up here.",
  "conversations.empty.body.es": "Las llamadas, mensajes de texto, correos, citas y formularios enviados por un contacto aparecen aquí.",
  "conversations.pickThread": "Select a conversation to read it.",
  "conversations.pickThread.es": "Seleccione una conversación para leerla.",
  "conversations.status.queued": "Queued",
  "conversations.status.queued.es": "En cola",
  "conversations.status.sent": "Sent",
  "conversations.status.sent.es": "Enviado",
  "conversations.status.delivered": "Delivered",
  "conversations.status.delivered.es": "Entregado",
  "conversations.status.opened": "Opened",
  "conversations.status.opened.es": "Abierto",
  "conversations.status.bounced": "Bounced",
  "conversations.status.bounced.es": "Rebotó",
  "conversations.status.failed": "Failed",
  "conversations.status.failed.es": "No se envió",
  // D-019's pager (DESIGN.md "Paged lists"): exactly one, Older/Newer,
  // carrying `?before=`. .es twins reuse timeline.older.es/timeline.newer.es's
  // own words — the same pager, the same two words, never reworded per screen.
  "conversations.older": "Older",
  "conversations.older.es": "Anteriores",
  "conversations.newer": "Newer",
  "conversations.newer.es": "Más recientes",
  "conversations.pagesLabel": "Pages",
  "conversations.pagesLabel.es": "Páginas",
  // D-017: the plain-language reason shown next to a bounced/failed
  // message, never the provider's own words (DESIGN.md's "no provider
  // jargon/codes" rule) — see lib/email/failure-reason.ts, the one place
  // that reads messages.error and chooses between these.
  // Says only what IS true today: the complaint is recorded, nothing yet
  // stops a later send to this address (suppression is deferred — see
  // failure-reason.ts's own doc comment for what it needs). A promise this
  // code does not keep would be a worse defect than the one D-016 fixed.
  "conversations.failureReason.complained": "They marked this email as spam.",
  "conversations.failureReason.complained.es": "Marcó este correo como spam.",
  "conversations.failureReason.bounced": "This address couldn't be reached.",
  "conversations.failureReason.bounced.es": "No se pudo llegar a esta dirección.",
  "conversations.failureReason.failed": "This didn't go through.",
  "conversations.failureReason.failed.es": "Esto no se envió.",
  // D-016 review item 4: the gate refused to even try — this address
  // already bounced or was marked as spam on an earlier message.
  "conversations.failureReason.suppressed": "Already bounced or marked as spam — nothing was sent.",
  "conversations.failureReason.suppressed.es": "Ya rebotó o lo marcaron como spam; no se envió nada.",
  // F-048 follow-up: a Calendar-page cancel's customer notice that the cron
  // reached too late (its own process died in the Undo window). Never sent.
  "conversations.failureReason.noticeTooLateStarted": "Not sent: the appointment time had passed, so it was too late to tell the customer. Let them know yourself.",
  "conversations.failureReason.noticeTooLateStarted.es": "No se envió: la hora de la cita ya había pasado y era tarde para avisarle al cliente. Avísele usted.",
  "conversations.failureReason.noticeTooLateDayOld": "Not sent: a day had passed since the cancel, so it was too late to tell the customer. Let them know yourself.",
  "conversations.failureReason.noticeTooLateDayOld.es": "No se envió: había pasado un día desde la cancelación y era tarde para avisarle al cliente. Avísele usted.",

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
  // Fix round 1 review (minor): the old wording ("each needs a key, kind,
  // label, and required flag") exposed this form's own internal field
  // shape — jargon with no translation for an operator, who never typed
  // anything to cause this (it only fires on a tampered hidden input).
  // Plain words, and the same "reload and try again" shape inline.crashed
  // already uses for the same class of problem.
  "forms.invalidFields": "Something went wrong with this form's fields. Reload the page and try again.",
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
  "forms.kind.core.company_name": "Business name",
  "forms.kind.core.company_name.es": "Nombre del negocio",
  // F-018, folded into F-157 (docs/crm-features.md §4.3 rider 6): the source
  // question — one optional field a form can add. This exact string doubles
  // as the field's default customer-facing label (form-editor.tsx's
  // `addField`, same as every kind above it), so it is written for the
  // VISITOR. Review round 1 correction: the `.es` twin is NOT waiting for an
  // operator locale (there is none here) — it is seeded as the default label
  // the moment `form.locale_default === "es"`, because the FORM already
  // carries its own locale and the visitor reads whichever one the form was
  // built in. Usted register, matching the plan's own wording.
  "forms.kind.core.referral_source": "Who recommended you?",
  "forms.kind.core.referral_source.es": "¿Quién le recomendó?",
  "forms.kind.message": "Message (starts a conversation)",
  "forms.kind.consent": "Consent checkbox",
  "forms.invalidRedirectUrl": "Redirect URL must start with http:// or https://.",
  // The parked minor this change closes: notifyEmails has gone unvalidated
  // since the booking milestone. Same {value} convention and same wording as
  // settings.weeklyReportBadEmail — one bad-address message, not two that can
  // drift apart.
  "forms.invalidNotifyEmail": "That doesn't look like an email address: {value}",
  // Owner context (forms tracker batch 4): shown inline, BEFORE Save, while
  // the operator is still choosing a non-published status for a form a
  // website assistant files its leads into — see shouldWarnOnUnpublish's
  // own comment. "until you set Status back to Published" names the actual
  // control (forms.status) and its actual option (forms.status.published)
  // rather than the vaguer "republish" (fix round 1 review, minor).
  "forms.unpublishWarning":
    "{assistant} files its leads into this form — it will stop filing new leads here until you set Status back to Published.",
  // The success toast AFTER that save has gone through. Distinct from
  // forms.unpublishWarning (fix round 1 review, minor: the toast must say
  // the save itself succeeded, not only name the consequence) — this one
  // is never shown before a save, so it is the only copy of the two
  // allowed to say "Saved."
  "forms.unpublishedToast":
    "Saved. {assistant} files its leads into this form — it will stop filing new leads here until you set Status back to Published.",
  "forms.republishFailed": "Could not republish the form.",
  // Fix round 1 review item 2: a stale Undo click — the form's status
  // changed again, through some other save, since this toast was shown.
  "forms.undoStale": "This form's status already changed since then — there's nothing to undo.",

  "conversations.unread": "unread",
  "conversations.unread.es": "sin leer",
  "conversations.channel.form": "Form submission",
  "conversations.channel.form.es": "Formulario",
  "conversations.channel.email": "Email",
  "conversations.channel.email.es": "Correo",
  "conversations.channel.voice": "Call",
  "conversations.channel.voice.es": "Llamada",
  "conversations.channel.sms": "Text",
  "conversations.channel.sms.es": "Texto",
  "conversations.channel.webchat": "Web chat",
  "conversations.channel.webchat.es": "Chat web",
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
    "Done in Telnyx. Calling and texting are both built and work once the rest of this checklist is done.",
  "checklist.a2p_registration.title": "Register A2P 10DLC brand and campaign",
  // Names where the gather list lives rather than carrying it: this line
  // renders inside a seven-item list, on the account dashboard as well as the
  // checklist page, and nine bullets of carrier paperwork would bury the six
  // other items. Worded as a destination, the way every internal item is,
  // because ChecklistPanel is reusable and must not say "below".
  "checklist.a2p_registration.help":
    "Done with the carriers via Telnyx. Expect days to weeks; start it early because nothing you do here speeds it up. The A2P registration panel on this company's checklist lists what to collect from them first.",
  // The three steps learned setting up BIS's own texting (2026-09-29): a
  // messaging profile is per BUSINESS (a STOP blocks every number on the
  // profile, and a profile has one reply text), so one company's rename or
  // one company's opt-out must never touch another's.
  "checklist.messaging_profile.title": "Give the number its own messaging profile",
  "checklist.messaging_profile.help":
    "Done in Telnyx. Every company needs its own messaging profile — a STOP blocks every number on a profile, so a shared one would block a company's number over another company's opt-out. Set the inbound webhook to https://app.bis-rgv.com/api/sms/inbound on API v2, put only this company's number on it, turn AI/opt-out detection off, and under Keywords → Global set the STOP, START and HELP replies signed with the company's name exactly as it's set on their account — renaming the company later means redoing these replies. Then paste the profile's ID into the Messaging profile ID field on the A2P registration card below.",
  "checklist.campaign_numbers.title": "Assign the number to the approved campaign",
  "checklist.campaign_numbers.help":
    "Done in Telnyx, after the carriers approve the campaign. Open the campaign and use Assign numbers to put this company's number on it — skipping this step means carriers quietly filter the texts even though everything else reads approved.",
  "checklist.sms_live_check.title": "Test STOP, START and HELP from a phone",
  "checklist.sms_live_check.help":
    "From a real phone that isn't this account's alert phone, text STOP, then START, then HELP to the company's number. Check each reply arrives and the contact's Texts row changes (Stopped → Texting on) before telling the client texting is live.",
  "checklist.email_domain.title": "Add a sending subdomain, DKIM and DMARC",
  "checklist.email_domain.help":
    "Done in Resend, then the DNS records at the domain host. DKIM alone is not enough — without a DMARC record the receiving server accepts the mail and may discard it, and every system here will still say delivered. Check the domain's Insights in Resend before the client sends anything real. A subdomain keeps this client's sending reputation separate. Once the domain is verified, set it as the Sending address in this company's Settings — until you do, their mail still goes out from the platform address.",
  "checklist.form_notify.title": "Set the notification address on each form",
  "checklist.form_notify.help":
    "Done here. Forms applied from a blueprint deliberately start with an empty notify list so leads cannot reach the previous client.",
  "checklist.gbp_connect.title": "Connect Google Business Profile",
  "checklist.gbp_connect.help": "Done in Google. Review management isn't built yet — for now this is just a record that the profile is connected.",
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
  // The A2P row's link to its own card further down this same page — added
  // because the card sits below the whole checklist and was hard to find by
  // scrolling. Distinct copy from checklist.open (which always leaves the
  // app) so a keyboard/screen-reader user isn't told "Open" twice for two
  // different destinations on the same row.
  "checklist.goToA2pCard": "Go to the A2P card",
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
  // Plan Task 7: the business's own Telnyx messaging profile (spec §5).
  "a2p.messagingProfileId": "Messaging profile ID",
  "a2p.messagingProfileIdHint": "In Telnyx, open Messaging, then Profiles. Every company needs its own, with its stop words and replies set up, before it can text.",
  "a2p.approvedNeedsProfile": "This company's own messaging profile ID is needed before marking this approved",
  "a2p.profileMalformed": "That doesn't look like a messaging profile ID. Copy it from Telnyx.",
  "a2p.profileTaken": "Another company already uses that messaging profile. Every company needs its own.",
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
  // The LAST capture (D-090), so it agrees with the version beside it.
  "blueprints.captured": "Last captured",
  "blueprints.applied": "Applied to",
  // Distinct companies, not applications (D-090, listBlueprints).
  "blueprints.appliedCount": "accounts",
  "blueprints.appliedCountOne": "account",
  "blueprints.save": "Save as blueprint",
  "blueprints.saveHint": "Copies this account's pipelines, custom fields, tags, custom values and forms. Never contacts, conversations, or anything with a credential in it.",
  "blueprints.name": "Blueprint name",
  "blueprints.saved": "Blueprint saved",
  "blueprints.saveFailed": "Could not save the blueprint.",
  // D-086: applying a blueprint to a company that already exists, from its
  // Settings. Additive and idempotent (applyBlueprint): nothing is removed and
  // a second apply skips what the first added.
  "blueprints.apply.label": "Blueprint",
  "blueprints.apply.hint": "Adds this blueprint's pipelines, custom fields, tags, custom values and forms to this company. Anything already here stays as it is, and nothing is removed. Forms arrive as drafts with nobody to notify yet.",
  "blueprints.apply.submit": "Apply",
  "blueprints.apply.pick": "Choose a blueprint to apply.",
  "blueprints.apply.done": "Blueprint applied: {added} new, {already} already in place.",
  "blueprints.apply.partial": "Some items in this blueprint didn't apply. Apply it again: anything already added is skipped.",
  "blueprints.apply.failed": "Couldn't apply that blueprint. Try again.",
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
  // D-034: only what is actually sent. The reminder pass mails the customer,
  // never these addresses, so "an appointment is coming up" was an alert that
  // did not exist. The senders that DO read them are listed in the action's
  // test (calendar/actions.test.ts). No persona name: clients rename Sofía.
  "calendar.settings.notifyEmailsHint": "Separate addresses with commas or put each on its own line. We email them when a customer books, cancels or moves an appointment, and when a caller leaves a message or their details.",
  "calendar.settings.notifyEmailsInvalid": "That doesn't look like an email address: {value}",
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

  // Not "Upcoming": since D-030 the list (listCalendarBookings) also carries appointments that are
  // over and still waiting for "Mark completed" or "No-show".
  "calendar.bookings.title": "Bookings",
  "calendar.bookings.empty": "Nothing here yet. Bookings from your booking page and phone calls show up here and stay until you mark them completed or no-show.",
  "calendar.bookings.note": "Note",
  "calendar.bookings.join": "Join",
  "calendar.bookings.join.es": "Unirse",
  "calendar.bookings.cancel": "Cancel",
  "calendar.bookings.cancel.es": "Cancelar",
  "calendar.bookings.markCompleted": "Mark completed",
  "calendar.bookings.markCompleted.es": "Marcar como terminado",
  "calendar.bookings.markNoShow": "No-show",
  "calendar.bookings.markNoShow.es": "No llegó",
  "calendar.bookings.statusUpdated": "Booking updated",
  "calendar.bookings.statusUpdated.es": "Cita actualizada",
  "calendar.bookings.statusUpdateFailed": "Could not update this booking.",
  // The To do list (Spanish since F-085) shows this when a close-out fails.
  "calendar.bookings.statusUpdateFailed.es": "No se pudo actualizar esta cita.",
  // D-036: Cancel runs at once with Undo (rule 6). It emails nobody, so the
  // toast says the customer has not heard, rather than letting the operator
  // assume they have.
  "calendar.bookings.cancelledToast": "Appointment cancelled. We haven't told the customer, so let them know.",
  "calendar.bookings.cancelledToast.es": "Cita cancelada. No le avisamos al cliente, así que avísele usted.",
  "calendar.bookings.restored": "Appointment is back on.",
  "calendar.bookings.restored.es": "La cita sigue en pie.",
  "calendar.bookings.restoreSlotTaken": "Someone else booked that time after you cancelled, so this appointment can't be put back.",
  "calendar.bookings.restoreSlotTaken.es": "Alguien más agendó ese horario después de que la canceló, así que esta cita no se puede restaurar.",
  "calendar.bookings.restoreRescheduled": "This appointment was moved to a new time, so the old one can't be put back.",
  "calendar.bookings.restoreRescheduled.es": "Esta cita se cambió a otro horario, así que la anterior no se puede restaurar.",
  "calendar.bookings.restoreNotOurs": "The customer cancelled this one themselves, by link or on a call, so it can't be put back from here.",
  "calendar.bookings.restoreNotOurs.es": "El cliente la canceló, por enlace o en una llamada, así que no se puede restaurar desde aquí.",
  "calendar.bookings.notStartedYet": "This appointment hasn't started yet. Mark it completed or no-show once it has.",
  "calendar.bookings.notStartedYet.es": "Esta cita todavía no ha empezado. Cuando haya empezado, podrá marcar si se realizó o si no llegó.",
  // F-048: when an email can reach the customer, Cancel opens a dialog
  // showing it; the owner can change its words and language, or not send it.
  // Otherwise Cancel cancels at once and the toast says why nobody was told.
  // Either way it runs at once with Undo, and the email goes only once the
  // Undo has closed.
  // "{name}" is the customer's name. Each ".es" line is the Spanish twin,
  // written out for when the dashboard speaks Spanish (usted, as the other
  // operator-facing twins).
  "calendar.bookings.cancelledToastNotice": "Appointment cancelled. We'll email the customer when this closes, unless you undo.",
  "calendar.bookings.cancelledToastNotice.es": "Cita cancelada. Le enviaremos un correo al cliente cuando se cierre este aviso, a menos que deshaga el cambio.",
  "calendar.bookings.restoreCustomerTold": "The customer has already been emailed that it's cancelled, so it can't be put back from here.",
  "calendar.bookings.restoreCustomerTold.es": "Ya se le envió un correo al cliente avisando que se canceló, así que no se puede restaurar desde aquí.",
  // The Undo came too late and the email did NOT go (the send failed or was
  // refused): say so, so the owner tells the customer themselves.
  "calendar.bookings.restoreNoticeFailed": "It's too late to undo this here, and our email to the customer didn't go through. Let them know it's cancelled.",
  "calendar.bookings.restoreNoticeFailed.es": "Ya es tarde para deshacerlo aquí, y nuestro correo al cliente no llegó a enviarse. Avísele que se canceló.",
  // Too late, and whether the email went is not known yet (still sending, or
  // stuck): never claim it went.
  "calendar.bookings.restoreNoticeUnknown": "It's too late to undo this here. Check the customer's messages to see whether our email went.",
  "calendar.bookings.restoreNoticeUnknown.es": "Ya es tarde para deshacerlo aquí. Revise los mensajes del cliente para ver si nuestro correo salió.",
  // The cancel this Undo names was replaced by a newer change (another tab).
  "calendar.bookings.restoreChanged": "This appointment changed after you cancelled it, so it can't be put back from here.",
  "calendar.bookings.restoreChanged.es": "Esta cita cambió después de que la canceló, así que no se puede restaurar desde aquí.",
  // Cancelled at once, no dialog: the customer's address has hard-bounced or
  // complained, so no email can reach them (D-016).
  "calendar.bookings.cancelledToastAddressBlocked": "Appointment cancelled. The customer's email address can't receive our emails, so we haven't told them. Call or text them.",
  "calendar.bookings.cancelledToastAddressBlocked.es": "Cita cancelada. El correo del cliente no puede recibir nuestros mensajes, así que no le avisamos. Llámele o mándele un mensaje.",
  "calendar.cancelDialog.title": "Cancel {name}'s appointment",
  "calendar.cancelDialog.title.es": "Cancelar la cita de {name}",
  "calendar.cancelDialog.notify": "Email {name} that it's cancelled",
  "calendar.cancelDialog.notify.es": "Avisarle a {name} por correo que se canceló",
  "calendar.cancelDialog.language": "Write it in",
  "calendar.cancelDialog.language.es": "Escribirlo en",
  "calendar.cancelDialog.languageEnglish": "English",
  "calendar.cancelDialog.languageEnglish.es": "Inglés",
  "calendar.cancelDialog.languageSpanish": "Spanish",
  "calendar.cancelDialog.languageSpanish.es": "Español",
  "calendar.cancelDialog.message": "Your message",
  "calendar.cancelDialog.message.es": "Su mensaje",
  "calendar.cancelDialog.messageHint": "We add the time and a link to book again. The email goes out once Undo closes.",
  "calendar.cancelDialog.messageHint.es": "Agregamos la hora y un enlace para volver a agendar. El correo sale cuando se cierra Deshacer.",
  "calendar.cancelDialog.messageTooLong": "That message is too long. Keep it under 2,000 characters.",
  "calendar.cancelDialog.messageTooLong.es": "Ese mensaje es demasiado largo. Use menos de 2,000 caracteres.",
  "calendar.cancelDialog.confirm": "Cancel appointment",
  "calendar.cancelDialog.confirm.es": "Cancelar cita",
  "calendar.cancelDialog.keep": "Keep it",
  "calendar.cancelDialog.keep.es": "Mantenerla",
  "calendar.bookings.status.booked": "Booked",
  "calendar.bookings.status.booked.es": "Agendada",
  "calendar.bookings.status.cancelled": "Cancelled",
  "calendar.bookings.status.cancelled.es": "Cancelada",
  "calendar.bookings.status.completed": "Completed",
  "calendar.bookings.status.completed.es": "Terminada",
  "calendar.bookings.status.no_show": "No-show",
  "calendar.bookings.status.no_show.es": "No llegó",

  // F-046 part 1: the Calendar page's agenda (Day/Week), the Add job / Move sheet and the job
  // drawer. Each ".es" line is the Spanish twin (usted). "{first}" is the customer's first name;
  // "{persona}" is the voice agent's name, filled in at render, never written into the copy.
  "calendar.agenda.title": "Schedule",
  "calendar.agenda.title.es": "Agenda",
  "calendar.agenda.day": "Day",
  "calendar.agenda.day.es": "Día",
  "calendar.agenda.week": "Week",
  "calendar.agenda.week.es": "Semana",
  "calendar.agenda.viewLabel": "Schedule view",
  "calendar.agenda.viewLabel.es": "Vista de la agenda",
  "calendar.agenda.back": "Back",
  "calendar.agenda.back.es": "Anterior",
  "calendar.agenda.today": "Today",
  "calendar.agenda.today.es": "Hoy",
  "calendar.agenda.next": "Next",
  "calendar.agenda.next.es": "Siguiente",
  "calendar.agenda.daysLabel": "Days of this week",
  "calendar.agenda.daysLabel.es": "Días de esta semana",
  "calendar.agenda.addJob": "Add job",
  "calendar.agenda.addJob.es": "Agregar trabajo",
  "calendar.agenda.addAt": "Add job at {time}",
  "calendar.agenda.addAt.es": "Agregar trabajo a las {time}",
  "calendar.agenda.emptyTitle": "Nothing booked on {day}.",
  "calendar.agenda.emptyTitle.es": "No hay nada agendado para el {day}.",
  "calendar.agenda.emptyBody": "Jobs you add and bookings customers make show here. Add the first one.",
  "calendar.agenda.emptyBody.es": "Aquí aparecen los trabajos que usted agrega y las citas que hacen sus clientes. Agregue el primero.",
  "calendar.agenda.emptyTechnician": "None of your customers have a job on {day}.",
  "calendar.agenda.emptyTechnician.es": "Ninguno de sus clientes tiene trabajo el {day}.",
  "calendar.agenda.error": "Couldn't load your schedule.",
  "calendar.agenda.error.es": "No se pudo cargar su agenda.",
  "calendar.agenda.retry": "Try again",
  "calendar.agenda.retry.es": "Intentar de nuevo",
  "calendar.agenda.closed": "Closed · {reason}",
  "calendar.agenda.closed.es": "Cerrado · {reason}",
  "calendar.agenda.closedPlain": "Closed",
  "calendar.agenda.closedPlain.es": "Cerrado",
  "calendar.agenda.outsideHours": "Outside open hours",
  "calendar.agenda.outsideHours.es": "Fuera del horario",
  "calendar.agenda.overlaps": "Overlaps",
  "calendar.agenda.overlaps.es": "Se empalma",
  "calendar.agenda.addedBy": "Added by {name}",
  "calendar.agenda.addedBy.es": "Agregado por {name}",
  "calendar.agenda.addedByYou": "Added by you",
  "calendar.agenda.addedByYou.es": "Agregado por usted",
  "calendar.agenda.bookedOnline": "Booked online",
  "calendar.agenda.bookedOnline.es": "Reservada en línea",
  "calendar.agenda.bookedBy": "Booked by {persona}",
  "calendar.agenda.bookedBy.es": "Agendada por {persona}",
  "calendar.agenda.pastOpen": "{count} past jobs still need Completed or No-show · To do",
  "calendar.agenda.pastOpen.es": "{count} trabajos pasados aún necesitan Terminado o No llegó · Pendientes",
  "calendar.agenda.pastOpenOne": "1 past job still needs Completed or No-show · To do",
  "calendar.agenda.pastOpenOne.es": "1 trabajo pasado aún necesita Terminado o No llegó · Pendientes",
  "calendar.agenda.truncated": "Only the first {cap} jobs are shown here. Open a single day to see them all.",
  "calendar.agenda.truncated.es": "Aquí solo se muestran los primeros {cap} trabajos. Abra un solo día para verlos todos.",
  "calendar.job.titleAdd": "Add a job",
  "calendar.job.titleAdd.es": "Agregar un trabajo",
  "calendar.job.titleMove": "Move this job",
  "calendar.job.titleMove.es": "Cambiar el horario de este trabajo",
  "calendar.job.customer": "Customer",
  "calendar.job.customer.es": "Cliente",
  "calendar.job.search": "Search by name or phone",
  "calendar.job.search.es": "Busque por nombre o teléfono",
  "calendar.job.newCustomer": "New customer",
  "calendar.job.newCustomer.es": "Cliente nuevo",
  "calendar.job.name": "Name",
  "calendar.job.name.es": "Nombre",
  "calendar.job.phone": "Phone",
  "calendar.job.phone.es": "Teléfono",
  "calendar.job.phoneOwner": "{name} already has this number. Use {first}?",
  "calendar.job.phoneOwner.es": "{name} ya tiene este número. ¿Usar a {first}?",
  "calendar.job.useExisting": "Use {first}",
  "calendar.job.useExisting.es": "Usar a {first}",
  "calendar.job.addAsNew": "Add as new",
  "calendar.job.addAsNew.es": "Agregar como nuevo",
  "calendar.job.customerFallback": "the customer",
  "calendar.job.customerFallback.es": "el cliente",
  "calendar.job.date": "Date",
  "calendar.job.date.es": "Fecha",
  "calendar.job.start": "Starts",
  "calendar.job.start.es": "Empieza",
  "calendar.job.length": "How long",
  "calendar.job.length.es": "Duración",
  "calendar.job.minutes": "{minutes} min",
  "calendar.job.minutes.es": "{minutes} min",
  "calendar.job.what": "What's the job?",
  "calendar.job.what.es": "¿Qué trabajo es?",
  "calendar.job.whatHint": "Fix a leaking water heater",
  "calendar.job.whatHint.es": "Arreglar un calentador que gotea",
  "calendar.job.address": "Address",
  "calendar.job.address.es": "Dirección",
  "calendar.job.noAddress": "No address",
  "calendar.job.noAddress.es": "Sin dirección",
  "calendar.job.newAddress": "New address",
  "calendar.job.newAddress.es": "Dirección nueva",
  "calendar.job.meet": "How you'll meet",
  "calendar.job.meet.es": "Cómo se verán",
  "calendar.job.inPerson": "In person",
  "calendar.job.inPerson.es": "En persona",
  "calendar.job.byPhone": "Phone",
  "calendar.job.byPhone.es": "Por teléfono",
  "calendar.job.byVideo": "Video",
  "calendar.job.byVideo.es": "Por video",
  "calendar.job.sendConfirmation": "Send {first} a confirmation",
  "calendar.job.sendConfirmation.es": "Enviarle una confirmación a {first}",
  "calendar.job.sendMoved": "Email {first} the new time",
  "calendar.job.sendMoved.es": "Enviarle a {first} el nuevo horario por correo",
  "calendar.job.noEmail": "{first} has no email on file, so we can't send one.",
  "calendar.job.noEmail.es": "{first} no tiene correo registrado, así que no podemos enviarle uno.",
  "calendar.job.emailBlocked": "{first}'s email can't receive our emails.",
  "calendar.job.emailBlocked.es": "El correo de {first} no puede recibir nuestros mensajes.",
  "calendar.job.checkFirst": "Check before you save:",
  "calendar.job.checkFirst.es": "Revise antes de guardar:",
  "calendar.job.warn.outsideHours": "Outside your open hours",
  "calendar.job.warn.outsideHours.es": "Fuera de su horario",
  "calendar.job.warn.notice": "Sooner than your usual notice",
  "calendar.job.warn.notice.es": "Antes de su aviso habitual",
  "calendar.job.warn.closed": "You're closed that day",
  "calendar.job.warn.closed.es": "Ese día está cerrado",
  "calendar.job.warn.overlaps": "Overlaps {count} jobs",
  "calendar.job.warn.overlaps.es": "Se empalma con {count} trabajos",
  "calendar.job.warn.overlapsOne": "Overlaps a job at {time}",
  "calendar.job.warn.overlapsOne.es": "Se empalma con un trabajo a las {time}",
  "calendar.job.warn.noVideo": "Video calls aren't set up, so this job won't have a link.",
  "calendar.job.warn.noVideo.es": "Las videollamadas no están configuradas, así que este trabajo no tendrá enlace.",
  "calendar.job.past": "That time has already passed. Pick a time from now on.",
  "calendar.job.past.es": "Esa hora ya pasó. Elija una hora de ahora en adelante.",
  "calendar.job.noSuchTime": "That time doesn't exist that day because the clocks change. Pick another.",
  "calendar.job.noSuchTime.es": "Esa hora no existe ese día porque cambia el horario. Elija otra.",
  "calendar.job.changed": "Something changed while you were looking. Check the notes and save again.",
  "calendar.job.changed.es": "Algo cambió mientras revisaba. Revise los avisos y guarde de nuevo.",
  "calendar.job.save": "Add job",
  "calendar.job.save.es": "Agregar trabajo",
  "calendar.job.saveMove": "Save new time",
  "calendar.job.saveMove.es": "Guardar nuevo horario",
  "calendar.job.saveAnyway": "Add it anyway",
  "calendar.job.saveAnyway.es": "Agregarlo de todos modos",
  "calendar.job.moveAnyway": "Move it anyway",
  "calendar.job.moveAnyway.es": "Cambiarlo de todos modos",
  "calendar.job.saveFailed": "Couldn't save this job. Nothing changed. Try again.",
  "calendar.job.saveFailed.es": "No se pudo guardar este trabajo. No cambió nada. Intente de nuevo.",
  "calendar.job.added": "Job added for {first}, {when}. We'll email the confirmation when this closes.",
  "calendar.job.added.es": "Trabajo agregado para {first}, {when}. Le enviaremos la confirmación cuando se cierre este aviso.",
  "calendar.job.addedQuiet": "Job added for {first}, {when}.",
  "calendar.job.addedQuiet.es": "Trabajo agregado para {first}, {when}.",
  "calendar.job.undo": "Undo",
  "calendar.job.undo.es": "Deshacer",
  "calendar.job.undone": "Job removed. {first} wasn't told.",
  "calendar.job.undone.es": "Trabajo eliminado. No se le avisó a {first}.",
  "calendar.job.undoTooLate": "Too late to undo: the confirmation already went to {first}. Cancel the job instead.",
  "calendar.job.undoTooLate.es": "Ya es tarde para deshacer: la confirmación ya le llegó a {first}. Mejor cancele el trabajo.",
  "calendar.job.undoMovedSince": "This job was moved since, so it can't be undone from here.",
  "calendar.job.undoMovedSince.es": "Este trabajo se cambió de horario después, así que no se puede deshacer desde aquí.",
  "calendar.job.moved": "Moved to {when}. We'll email {first} when this closes.",
  "calendar.job.moved.es": "Se cambió a {when}. Le enviaremos un correo a {first} cuando se cierre este aviso.",
  "calendar.job.movedQuiet": "Moved to {when}.",
  "calendar.job.movedQuiet.es": "Se cambió a {when}.",
  "calendar.job.edited": "Job updated.",
  "calendar.job.edited.es": "Trabajo actualizado.",
  "calendar.job.moveUndone": "Back at {when}.",
  "calendar.job.moveUndone.es": "De vuelta: {when}.",
  "calendar.job.moveUndoTaken": "Another job took the old time, so it can't go back.",
  "calendar.job.moveUndoTaken.es": "Otro trabajo ocupó el horario anterior, así que no puede regresar.",
  "calendar.job.emailSent": "Confirmation emailed {time}",
  "calendar.job.emailSent.es": "Confirmación enviada {time}",
  "calendar.job.emailPending": "We'll email the confirmation in a few seconds",
  "calendar.job.emailPending.es": "Enviaremos la confirmación en unos segundos",
  "calendar.job.emailFailed": "Couldn't email the confirmation",
  "calendar.job.emailFailed.es": "No se pudo enviar la confirmación",
  "calendar.job.movedEmailSent": "New time emailed {time}",
  "calendar.job.movedEmailSent.es": "Nuevo horario enviado {time}",
  "calendar.job.movedEmailPending": "We'll email the new time in a few seconds",
  "calendar.job.movedEmailPending.es": "Enviaremos el nuevo horario en unos segundos",
  "calendar.job.movedEmailFailed": "Couldn't email the new time",
  "calendar.job.movedEmailFailed.es": "No se pudo enviar el nuevo horario",
  "calendar.job.openRecord": "Open record",
  "calendar.job.openRecord.es": "Abrir ficha",
  "calendar.job.gone": "This job isn't on the calendar any more.",
  "calendar.job.gone.es": "Este trabajo ya no está en la agenda.",

  "calendar.embed.title": "Embed",
  "calendar.embed.hint": "Paste this where the booking widget should appear.",
  "calendar.embed.disabledHint": "Turn on \"Accept bookings\" above to get the embed snippet.",
  "calendar.embed.copy": "Copy",
  "calendar.embed.copied": "Copied",
  "calendar.embed.publicLink": "Direct link",

  // F-048 part 2: the Calendar page's "Bookings on your phone" card (owner decisions D1–D3).
  "calendar.feed.title": "Bookings on your phone",
  "calendar.feed.title.es": "Sus citas en el teléfono",
  "calendar.feed.empty": "Put every booking on your phone's calendar: iPhone, Google or Outlook. You get your own private link.",
  "calendar.feed.empty.es": "Ponga cada cita en el calendario de su teléfono: iPhone, Google u Outlook. Tiene su propio enlace privado.",
  "calendar.feed.make": "Make my link",
  "calendar.feed.make.es": "Crear mi enlace",
  "calendar.feed.linkLabel": "Your private link",
  "calendar.feed.linkLabel.es": "Su enlace privado",
  "calendar.feed.copy": "Copy link",
  "calendar.feed.copy.es": "Copiar enlace",
  "calendar.feed.copied": "Link copied.",
  "calendar.feed.copied.es": "Enlace copiado.",
  "calendar.feed.addIphone": "Add to iPhone",
  "calendar.feed.addIphone.es": "Agregar al iPhone",
  "calendar.feed.replace": "Make a new link",
  "calendar.feed.replace.es": "Crear un enlace nuevo",
  "calendar.feed.turnOff": "Turn off",
  "calendar.feed.turnOff.es": "Desactivar",
  "calendar.feed.private": "Anyone with this link can see your booking times and your customers' first names. Don't share it.",
  "calendar.feed.private.es": "Quien tenga este enlace puede ver las horas de sus citas y el nombre de sus clientes. No lo comparta.",
  "calendar.feed.window": "Shows the last 30 days and the next six months.",
  "calendar.feed.window.es": "Muestra los últimos 30 días y los próximos seis meses.",
  "calendar.feed.technician": "Your link shows bookings for the customers assigned to you.",
  "calendar.feed.technician.es": "Su enlace muestra las citas de los clientes asignados a usted.",
  "calendar.feed.lastChecked": "Your calendar last asked for your bookings {when}.",
  "calendar.feed.lastChecked.es": "Su calendario pidió sus citas por última vez {when}.",
  "calendar.feed.neverChecked": "No calendar has used this link yet. Google can take up to a day.",
  "calendar.feed.neverChecked.es": "Ningún calendario ha usado este enlace todavía. Google puede tardar hasta un día.",
  "calendar.feed.stale": "Your link needs to be made again. The old one keeps working until you do.",
  "calendar.feed.stale.es": "Su enlace se tiene que crear de nuevo. El anterior sigue funcionando hasta que lo haga.",
  "calendar.feed.agency": "Each person on the business's team makes their own link here.",
  "calendar.feed.agency.es": "Cada persona del equipo del negocio crea aquí su propio enlace.",
  "calendar.feed.unavailable": "Phone calendars aren't available yet.",
  "calendar.feed.unavailable.es": "Los calendarios del teléfono aún no están disponibles.",
  "calendar.feed.loadError": "We couldn't load your link. Try again.",
  "calendar.feed.loadError.es": "No pudimos cargar su enlace. Inténtelo de nuevo.",
  "calendar.feed.retry": "Try again",
  "calendar.feed.retry.es": "Reintentar",
  "calendar.feed.howTo": "How to add it",
  "calendar.feed.howTo.es": "Cómo agregarlo",
  "calendar.feed.iphone.title": "iPhone",
  "calendar.feed.iphone.title.es": "iPhone",
  "calendar.feed.iphone.steps": "1. On your iPhone, open this page and tap Add to iPhone. 2. Tap Subscribe, then Done. To see new bookings sooner: in Settings, open Calendar, then Fetch New Data.",
  "calendar.feed.iphone.steps.es": "1. En su iPhone, abra esta página y toque Agregar al iPhone. 2. Toque Suscribirse y luego OK. Para ver antes las citas nuevas: en Ajustes, abra Calendario y luego Obtener datos.",
  "calendar.feed.google.title": "Google Calendar",
  "calendar.feed.google.title.es": "Google Calendar",
  "calendar.feed.google.steps": "1. On a computer, go to calendar.google.com. The phone app can't add it. 2. Next to Other calendars, click +, then From URL. 3. Paste your link and click Add calendar. It shows up on your phone by itself.",
  "calendar.feed.google.steps.es": "1. En una computadora, entre a calendar.google.com. La app del teléfono no puede agregarlo. 2. Junto a Otros calendarios, haga clic en + y luego en Desde URL. 3. Pegue su enlace y haga clic en Agregar calendario. Aparece solo en su teléfono.",
  "calendar.feed.outlook.title": "Outlook",
  "calendar.feed.outlook.title.es": "Outlook",
  "calendar.feed.outlook.steps": "1. Go to outlook.com and open Calendar. 2. Click Add calendar, then Subscribe from web. 3. Paste your link, give it a name and click Import.",
  "calendar.feed.outlook.steps.es": "1. Entre a outlook.com y abra Calendario. 2. Haga clic en Agregar calendario y luego en Suscribirse desde la web. 3. Pegue su enlace, póngale un nombre y haga clic en Importar.",
  "calendar.feed.slow": "New bookings can take a few hours to show up on Google and Outlook, sometimes a day. The email for each booking still comes right away.",
  "calendar.feed.slow.es": "Las citas nuevas pueden tardar unas horas en aparecer en Google y Outlook, a veces un día. El correo de cada cita sigue llegando al momento.",
  "calendar.feed.toast.replaced": "New link made. Your old link stopped working.",
  "calendar.feed.toast.replaced.es": "Enlace nuevo creado. El anterior dejó de funcionar.",
  "calendar.feed.toast.turnedOff": "Link turned off.",
  "calendar.feed.toast.turnedOff.es": "Enlace desactivado.",
  "calendar.feed.toast.restored": "Your link is back.",
  "calendar.feed.toast.restored.es": "Su enlace volvió.",
  "calendar.feed.undo": "Undo",
  "calendar.feed.undo.es": "Deshacer",
  "calendar.feed.error.failed": "That didn't save. Try again.",
  "calendar.feed.error.failed.es": "No se guardó. Inténtelo de nuevo.",
  "calendar.feed.error.notMember": "Only people on the business's team can have a link.",
  "calendar.feed.error.notMember.es": "Solo las personas del equipo del negocio pueden tener un enlace.",
  "calendar.feed.error.unavailable": "Phone calendars aren't available yet.",
  "calendar.feed.error.unavailable.es": "Los calendarios del teléfono aún no están disponibles.",
  "calendar.feed.error.undoLate": "Too late to undo. Make a new link instead.",
  "calendar.feed.error.undoLate.es": "Ya no se puede deshacer. Cree un enlace nuevo.",

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
  "voice.profile.factsHint": "Policies and anything else a caller might ask about. Hours and prices go in their own cards below.",
  "voice.profile.factsHintInsurance": "Policies and anything else a caller might ask about. Hours go in their own card below. Prices are never given on insurance accounts.",
  "voice.profile.factsHintInsurance.es": "Pólizas y cualquier otra cosa que pregunte quien llama. El horario va en su propia tarjeta abajo. En cuentas de seguros nunca se dan precios.",
  "voice.profile.services": "Services",
  "voice.profile.language": "Language",
  "voice.profile.language.en": "English only",
  "voice.profile.language.es": "Spanish only",
  "voice.profile.language.both": "English and Spanish",
  "voice.profile.bookingEnabled": "Allow booking appointments on the call",
  "voice.profile.afterHours": "After hours",
  "voice.profile.afterHours.hoursThenMessage": "Follow business hours, then take a message",
  "voice.profile.afterHours.messageOnly": "Always take a message",
  // D-040: the second option now means what it says, open or closed, and it
  // turns booking off on calls whatever the box below says.
  "voice.profile.afterHoursHint": "Always take a message means no booking on calls, even during business hours.",
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
  // The consent replies: the ONE stop confirmation, the start/opt-in
  // confirmation and the help reply. Rewritten 2026-10-05 after TCR rejected
  // BIS's own 10DLC campaign (MNO_REJECTED, reason 611): the opt-in
  // confirmation must carry the brand, message classes, "frequency varies"
  // and "rates may apply" disclosures, HELP and STOP; the opt-out message
  // must say explicitly that no further messages follow and how to
  // resubscribe; the help reply must name a real support contact (email,
  // phone or website), not just "this number". Kept under sms.* on purpose:
  // a "consent.…" string in a gate-importing file reads as a message kind to
  // scan 2 (scans.test.ts). No á, í, ó or ú (UCS-2 would double every one,
  // and this codebase already spells "numero"/"mas" without the accent for
  // the same reason — see opt-out.ts); replies.test.ts measures each at up
  // to two GSM-7 segments, compliance now costing more than the one segment
  // it used to fit. "{Business}" is brandDisplayName; a blank name uses the
  // noName line, the text-back's rule (textback-body.ts) — carriers still
  // require a brand name on every one of these, so an account with no brand
  // name set is not carrier-compliant yet; see replies.ts's comment on why
  // this does not fall back to `accounts.name` (DESIGN.md rule 8). "{Contact}"
  // is the help reply's support-contact phrase (replies.ts's
  // `helpContactPhrase`): the account's own `reply_to_email` when the client
  // has set one, else BIS's own hello@bis-rgv.com / bis-rgv.com — never BIS's
  // domain on a client's own text once the client has a contact of its own.
  "sms.consentReply.stop.en": "{Business}: You will receive no further messages. Reply START to resubscribe.",
  "sms.consentReply.stop.es": "{Business}: Ya no le enviaremos mas mensajes. Responda START para volver a recibirlos.",
  "sms.consentReply.stop.noName.en": "You will receive no further messages. Reply START to resubscribe.",
  "sms.consentReply.stop.noName.es": "Ya no le enviaremos mas mensajes. Responda START para volver a recibirlos.",
  "sms.consentReply.start.en": "{Business}: You're opted in to receive texts about your appointments and service. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  "sms.consentReply.start.es": "{Business}: Usted acepta recibir mensajes de citas y servicio. La frecuencia de mensajes puede variar. Pueden aplicar tarifas de mensajes y datos. Responda AYUDA para ayuda, PARAR para cancelar.",
  "sms.consentReply.start.noName.en": "You're opted in to receive texts about your appointments and service. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  "sms.consentReply.start.noName.es": "Usted acepta recibir mensajes de citas y servicio. La frecuencia de mensajes puede variar. Pueden aplicar tarifas de mensajes y datos. Responda AYUDA para ayuda, PARAR para cancelar.",
  "sms.consentReply.help.en": "{Business}: For help, {Contact}. Msg & data rates may apply. Reply STOP to opt out.",
  "sms.consentReply.help.es": "{Business}: Para ayuda, {Contact}. Pueden aplicar tarifas de mensajes y datos. Responda PARAR para cancelar.",
  "sms.consentReply.help.noName.en": "For help, {Contact}. Msg & data rates may apply. Reply STOP to opt out.",
  "sms.consentReply.help.noName.es": "Para ayuda, {Contact}. Pueden aplicar tarifas de mensajes y datos. Responda PARAR para cancelar.",
  // The help reply's support-contact phrase (see replies.ts's
  // `helpContactPhrase`): BIS's own fallback when an account has not set its
  // own reply-to email. Not under sms.consentReply.* because it is not a full
  // reply — it is substituted into "{Contact}" above.
  "sms.consentReply.help.contact.fallback.en": "email hello@bis-rgv.com or visit bis-rgv.com",
  "sms.consentReply.help.contact.fallback.es": "escriba a hello@bis-rgv.com o visite bis-rgv.com",

  // Staff-facing alert SMS (lib/sms/alerts.ts's composeBookingAlertSms and
  // composeCallAlertSms). The reader is the business owner/staff, so this is
  // keyed off `accounts.language`, not the customer's own locale. Owner
  // decision B (2026-10-10): the Spanish lines carry NO accents at all (not
  // only the á/í/ó/ú GSM-7 lacks — every mark, ñ included), so the text
  // stays GSM-7 and one segment; alerts.test.ts checks each `.es` line.
  // Phrased so dropping an accent never changes the meaning ("agendaron",
  // not "agendó" → "agendo", which reads as "I schedule").
  "sms.alert.booking.newBookingWithName": "New booking: {when} - {name}.",
  "sms.alert.booking.newBookingWithName.es": "Nueva cita: {when} - {name}.",
  "sms.alert.booking.newBooking": "New booking: {when}.",
  "sms.alert.booking.newBooking.es": "Nueva cita: {when}.",
  "sms.alert.call.booked": "New call: booked a meeting.",
  "sms.alert.call.booked.es": "Nueva llamada: agendaron una cita.",
  "sms.alert.call.lead": "New call: a lead came in.",
  "sms.alert.call.lead.es": "Nueva llamada: nuevo cliente potencial.",
  "sms.alert.call.message": "New call: left a message.",
  "sms.alert.call.message.es": "Nueva llamada: dejaron un mensaje.",
  // ONE phrase for "the rest is in your inbox", shared by both composers.
  "sms.alert.emailHint": " Check email for details.",
  "sms.alert.emailHint.es": " Revise su correo para mas detalles.",

  "voice.textback.defaultBodyEn": "Hi, this is {name}. Sorry we missed you just now, reply here and we'll help.",
  "voice.textback.defaultBodyNoNameEn": "Sorry we missed you just now, reply here and we'll help.",
  // A text-back HELD overnight and sent at 08:00 (consent chain PR-1, danlo
  // 2026-09-26): "just now" would be false the next morning. Spanish needs no
  // variant; its default never said "just now".
  "voice.textback.defaultBodyHeldEn": "Hi, this is {name}. Sorry we missed your call, reply here and we'll help.",
  "voice.textback.defaultBodyHeldNoNameEn": "Sorry we missed your call, reply here and we'll help.",
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
  // D-042: one active number per account.
  "voice.numbers.anotherActive": "This client has another active number. A client can have only one, so release the other one first.",
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

  // Send calls straight to a person (operational-floor spec §3): the agency's
  // lever for taking the phones back from Sofía. It rings the SAME number as
  // the transfer above — there is no second number to keep in step — so the
  // copy shows that number rather than asking for one. `needsTransfer` names
  // where to fix it, `noTransferOn` says what callers get meanwhile.
  "voice.forward.title": "Send calls straight to a person",
  "voice.forward.body": "Sofía steps aside and the calls she would have answered ring your transfer number instead. Numbers already marked as spam are still turned away.",
  "voice.forward.toggleLabel": "Send calls straight to a person",
  "voice.forward.rings": "When this is on, calls ring {number}.",
  "voice.forward.needsTransfer": "Add a transfer number above first. That's the number calls will ring.",
  "voice.forward.noProfile": "Set up Sofía first. This switch hands her calls to a person, so she needs to be set up.",
  "voice.forward.noTransferOn": "There's no transfer number, so Sofía is answering calls until you add one.",
  "voice.forward.onToast": "Calls now ring {number} instead of Sofía",
  "voice.forward.offToast": "Sofía is answering calls again",
  "voice.forward.saveFailed": "Could not change where calls go. Nothing was changed.",

  // ── AI disclosure (S-47a, F-034, decision 20, migration 0093) ──────────
  // Off / Trial / On decides whether {persona} says, right after the
  // greeting, that she is an AI and the call is transcribed. On Trial a fair
  // coin per call decides; the results card below compares the two halves
  // without declaring a winner. "flag/stamp/coin/trial arm/variant" are
  // plumbing words and stay out of every string here (global constraints).
  "voice.disclosure.legend": "Tell callers {persona} is an AI",
  "voice.disclosure.legend.es": "Decir a quien llama que {persona} es una IA",
  "voice.disclosure.off": "Off",
  "voice.disclosure.off.es": "Desactivado",
  "voice.disclosure.offHint": "{persona} says it's an AI only when someone asks.",
  "voice.disclosure.offHint.es": "{persona} dice que es una IA solo cuando se lo preguntan.",
  "voice.disclosure.trial": "Trial",
  "voice.disclosure.trial.es": "Prueba",
  "voice.disclosure.trialHint": "Half the calls, picked at random, hear it right after the greeting, so the two halves can be compared below. The website chat always says it.",
  "voice.disclosure.trialHint.es": "La mitad de las llamadas, elegidas al azar, lo escuchan justo después del saludo, para comparar las dos mitades abajo. El chat del sitio web siempre lo dice.",
  "voice.disclosure.on": "On",
  "voice.disclosure.on.es": "Activado",
  "voice.disclosure.onHint": "Every call hears it right after the greeting, and the website chat says it too.",
  "voice.disclosure.onHint.es": "Todas las llamadas lo escuchan justo después del saludo, y el chat del sitio web también lo dice.",
  "voice.disclosure.nextCall": "Changes apply from the next call. Calls already made keep what they heard.",
  "voice.disclosure.nextCall.es": "Los cambios aplican desde la siguiente llamada. Las llamadas ya hechas conservan lo que escucharon.",
  "voice.disclosure.results.title": "Saying it's an AI: how calls went",
  "voice.disclosure.results.title.es": "Decir que es una IA: cómo fueron las llamadas",
  "voice.disclosure.results.period": "Every finished call made while this line was on Trial.",
  "voice.disclosure.results.period.es": "Todas las llamadas terminadas mientras esta línea estuvo en Prueba.",
  "voice.disclosure.results.said": "Said it was AI",
  "voice.disclosure.results.said.es": "Dijo que era IA",
  "voice.disclosure.results.didnt": "Didn't",
  "voice.disclosure.results.didnt.es": "No lo dijo",
  "voice.disclosure.results.counted": "Calls counted",
  "voice.disclosure.results.counted.es": "Llamadas contadas",
  "voice.disclosure.results.booked": "Booked",
  "voice.disclosure.results.booked.es": "Agendaron",
  "voice.disclosure.results.hungUp": "Hung up early",
  "voice.disclosure.results.hungUp.es": "Colgaron antes",
  "voice.disclosure.results.askedPerson": "Asked for a person",
  "voice.disclosure.results.askedPerson.es": "Pidieron hablar con una persona",
  "voice.disclosure.results.percent": "{percent}%",
  "voice.disclosure.results.percent.es": "{percent} %",
  "voice.disclosure.results.noneYet": "No calls yet",
  "voice.disclosure.results.noneYet.es": "Aún no hay llamadas",
  "voice.disclosure.results.notEnough": "Not enough calls yet to tell.",
  "voice.disclosure.results.notEnough.es": "Todavía no hay suficientes llamadas para saberlo.",
  // Plural pair, the contacts.count/contacts.countOne shape: "{count} calls
  // not counted" vs "1 call not counted", never a template reused for one.
  "voice.disclosure.results.notCounted": "{count} calls not counted (spam, or outside the trial)",
  "voice.disclosure.results.notCounted.es": "{count} llamadas no contadas (spam, o fuera de la prueba)",
  "voice.disclosure.results.notCountedOne": "1 call not counted (spam, or outside the trial)",
  "voice.disclosure.results.notCountedOne.es": "1 llamada no contada (spam, o fuera de la prueba)",
  "voice.disclosure.results.empty": "No calls since the trial started.",
  "voice.disclosure.results.empty.es": "No hay llamadas desde que empezó la prueba.",
  "voice.disclosure.results.emptyAction": "Each Trial call is counted here once it ends.",
  "voice.disclosure.results.emptyAction.es": "Cada llamada de Prueba se cuenta aquí cuando termina.",
  "voice.disclosure.results.emptyIdle": "Once a trial runs, how calls went with and without saying it's an AI shows here.",
  "voice.disclosure.results.emptyIdle.es": "Cuando haga una prueba, aquí verá cómo fueron las llamadas al decir que es una IA y al no decirlo.",
  "voice.disclosure.results.emptyIdleAction": "Choose Trial above and save.",
  "voice.disclosure.results.emptyIdleAction.es": "Elija Prueba arriba y guarde.",
  "voice.disclosure.results.error": "Couldn't load how calls went.",
  "voice.disclosure.results.error.es": "No se pudo cargar cómo fueron las llamadas.",
  // S-47b: the Voice page's Trade rules group and the call page's line (agency only). Usted.
  "voice.tradeRules.legend": "Trade rules",
  "voice.tradeRules.legend.es": "Reglas del giro",
  "voice.tradeRules.none": "None — general rules only",
  "voice.tradeRules.none.es": "Ninguna — solo las reglas generales",
  "voice.tradeRules.noneHint": "{persona} follows only the rules every account has.",
  "voice.tradeRules.noneHint.es": "{persona} sigue solo las reglas que tiene toda cuenta.",
  "voice.tradeRules.insurance_pc": "Insurance (property & casualty)",
  "voice.tradeRules.insurance_pc.es": "Seguros de daños (auto, casa y negocio)",
  "voice.tradeRules.insurance_pcHint": "{persona} takes quote requests for a licensed agent to call back, and never gives prices, says anyone is covered or discusses a policy. Before reading, moving or cancelling an appointment, {persona} asks for the full name and the email on file.",
  "voice.tradeRules.insurance_pcHint.es": "{persona} toma solicitudes de cotización para que un agente con licencia devuelva la llamada, y nunca da precios, ni dice que alguien está cubierto, ni habla de una póliza. Antes de consultar, cambiar o cancelar una cita, {persona} pide el nombre completo y el correo electrónico registrado.",
  "voice.tradeRules.events": "Events and venues",
  "voice.tradeRules.events.es": "Eventos y salones",
  "voice.tradeRules.eventsHint": "{persona} takes event details for the team to confirm, never says a date is free, and gives prices only word for word from Services & prices, or from Facts when there is no list.",
  "voice.tradeRules.eventsHint.es": "{persona} toma los datos del evento para que el equipo los confirme, nunca dice que una fecha está libre y da precios solo palabra por palabra de Servicios y precios, o de los datos del negocio cuando no hay lista.",
  "voice.tradeRules.nextCall": "Changes apply from the next call or chat. Calls and chats already under way keep the rules they started with.",
  "voice.tradeRules.nextCall.es": "Los cambios aplican desde la siguiente llamada o chat. Las llamadas y los chats ya en curso conservan las reglas con las que empezaron.",
  "calls.detail.tradeRules": "{module} · v{version}",
  "calls.detail.tradeRules.es": "{module} · v{version}",
  "calls.detail.tradeModule.insurance_pc": "Insurance",
  "calls.detail.tradeModule.insurance_pc.es": "Seguros",
  "calls.detail.tradeModule.events": "Events",
  "calls.detail.tradeModule.events.es": "Eventos",
  // S-47c: Business hours, Services & prices, the Facts flags, the call page's Knowledge link and the knowledge page (agency only). Usted.
  "voice.hours.title": "Business hours",
  "voice.hours.title.es": "Horario del negocio",
  "voice.hours.body": "{persona} tells callers whether you're open right now from these hours. Bookable times still come from the calendar.",
  "voice.hours.body.es": "{persona} les dice a quienes llaman si está abierto en este momento según este horario. Los horarios para citas siguen saliendo del calendario.",
  "voice.hours.zone": "Times are in {zone}.",
  "voice.hours.zone.es": "Las horas están en {zone}.",
  "voice.hours.day.mon": "Monday",
  "voice.hours.day.mon.es": "Lunes",
  "voice.hours.day.tue": "Tuesday",
  "voice.hours.day.tue.es": "Martes",
  "voice.hours.day.wed": "Wednesday",
  "voice.hours.day.wed.es": "Miércoles",
  "voice.hours.day.thu": "Thursday",
  "voice.hours.day.thu.es": "Jueves",
  "voice.hours.day.fri": "Friday",
  "voice.hours.day.fri.es": "Viernes",
  "voice.hours.day.sat": "Saturday",
  "voice.hours.day.sat.es": "Sábado",
  "voice.hours.day.sun": "Sunday",
  "voice.hours.day.sun.es": "Domingo",
  "voice.hours.open": "Open",
  "voice.hours.open.es": "Abierto",
  "voice.hours.from": "Opens on {day}",
  "voice.hours.from.es": "{day}: abre",
  "voice.hours.to": "Closes on {day}",
  "voice.hours.to.es": "{day}: cierra",
  "voice.hours.toWord": "to",
  "voice.hours.toWord.es": "a",
  "voice.hours.openOn": "Open on {day}",
  "voice.hours.openOn.es": "{day}: abierto",
  "voice.hours.addSpan": "Add another time",
  "voice.hours.addSpan.es": "Agregar otro horario",
  "voice.hours.addSpanOn": "Add another time on {day}",
  "voice.hours.addSpanOn.es": "{day}: agregar otro horario",
  "voice.hours.removeSpan": "Remove these hours on {day}",
  "voice.hours.removeSpan.es": "{day}: quitar estas horas",
  "voice.hours.midnightHint": "To close at midnight, set the closing time to 12:00 AM (00:00).",
  "voice.hours.midnightHint.es": "Para cerrar a medianoche, ponga la hora de cierre en 12:00 a. m. (00:00).",
  "voice.hours.copyFromCalendar": "Copy from calendar",
  "voice.hours.copyFromCalendar.es": "Copiar del calendario",
  "voice.hours.copyFromCalendarNone": "The calendar has no hours to copy yet.",
  "voice.hours.copyFromCalendarNone.es": "El calendario todavía no tiene horas para copiar.",
  "voice.hours.copyFromCalendarFailed": "Couldn't read the calendar's hours. Reload the page to try again.",
  "voice.hours.copyFromCalendarFailed.es": "No se pudieron leer las horas del calendario. Recargue la página para intentar de nuevo.",
  "voice.hours.clear": "Clear hours",
  "voice.hours.clear.es": "Quitar el horario",
  "voice.hours.save": "Save hours",
  "voice.hours.save.es": "Guardar horario",
  "voice.hours.saved": "Business hours saved",
  "voice.hours.saved.es": "Horario guardado",
  "voice.hours.cleared": "Business hours cleared",
  "voice.hours.cleared.es": "Horario quitado",
  "voice.hours.empty": "Add your hours so {persona} can tell callers whether you're open right now.",
  "voice.hours.empty.es": "Agregue su horario para que {persona} pueda decirles a quienes llaman si está abierto en este momento.",
  "voice.hours.setHours": "Set hours",
  "voice.hours.setHours.es": "Poner horario",
  "voice.hours.error.blank": "{day}: fill in both times, or remove those hours.",
  "voice.hours.error.blank.es": "{day}: llene las dos horas, o quite esas horas.",
  "voice.hours.error.endBeforeStart": "{day}: each closing time must be after its opening time.",
  "voice.hours.error.endBeforeStart.es": "{day}: cada hora de cierre debe ser después de la de apertura.",
  "voice.hours.error.overlap": "{day}: these hours overlap.",
  "voice.hours.error.overlap.es": "{day}: estas horas se cruzan.",
  "voice.hours.error.noDay": "Mark at least one day open, or clear the hours.",
  "voice.hours.error.noDay.es": "Marque al menos un día abierto, o quite el horario.",
  "voice.hours.saveFailed": "Couldn't save the hours. Try again.",
  "voice.hours.saveFailed.es": "No se pudo guardar el horario. Intente de nuevo.",
  "voice.services.title": "Services & prices",
  "voice.services.title.es": "Servicios y precios",
  "voice.services.titleInsurance": "Services",
  "voice.services.titleInsurance.es": "Servicios",
  "voice.services.body": "{persona} says these prices exactly as written below, and no others.",
  "voice.services.body.es": "{persona} dice estos precios tal como están escritos abajo, y ningún otro.",
  "voice.services.insuranceNotice": "On insurance accounts {persona} names these services but never gives a price.",
  "voice.services.insuranceNotice.es": "En cuentas de seguros, {persona} nombra estos servicios pero nunca da un precio.",
  "voice.services.empty": "List your services and prices so {persona} quotes them exactly.",
  "voice.services.empty.es": "Anote sus servicios y precios para que {persona} los diga exactamente.",
  "voice.services.add": "Add a service",
  "voice.services.add.es": "Agregar un servicio",
  "voice.services.max": "You can list up to 50 services.",
  "voice.services.max.es": "Puede anotar hasta 50 servicios.",
  "voice.services.moveUp": "Move {name} up",
  "voice.services.moveUp.es": "Subir {name}",
  "voice.services.moveDown": "Move {name} down",
  "voice.services.moveDown.es": "Bajar {name}",
  "voice.services.editNamed": "Edit {name}",
  "voice.services.editNamed.es": "Editar {name}",
  "voice.services.removeNamed": "Remove {name}",
  "voice.services.removeNamed.es": "Quitar {name}",
  "voice.services.keepNamed": "Keep {name}",
  "voice.services.keepNamed.es": "Conservar {name}",
  "voice.services.unnamed": "New service",
  "voice.services.unnamed.es": "Servicio nuevo",
  "voice.services.kindPlaceholder": "Choose one",
  "voice.services.kindPlaceholder.es": "Elija una opción",
  "voice.services.renameDropsPrice": "Renaming this service removes the price stored for it.",
  "voice.services.renameDropsPrice.es": "Al cambiar el nombre de este servicio se quita el precio guardado.",
  "voice.services.edit": "Edit",
  "voice.services.edit.es": "Editar",
  "voice.services.done": "Done",
  "voice.services.done.es": "Listo",
  "voice.services.remove": "Remove",
  "voice.services.remove.es": "Quitar",
  "voice.services.removing": "Removed when you save",
  "voice.services.removing.es": "Se quita al guardar",
  "voice.services.keep": "Keep",
  "voice.services.keep.es": "Conservar",
  "voice.services.nameEn": "Name in English",
  "voice.services.nameEn.es": "Nombre en inglés",
  "voice.services.nameEs": "Name in Spanish (optional)",
  "voice.services.nameEs.es": "Nombre en español (opcional)",
  "voice.services.descriptionEn": "Description in English (optional)",
  "voice.services.descriptionEn.es": "Descripción en inglés (opcional)",
  "voice.services.descriptionEs": "Description in Spanish (optional)",
  "voice.services.descriptionEs.es": "Descripción en español (opcional)",
  "voice.services.kind": "How it's priced",
  "voice.services.kind.es": "Cómo se cobra",
  "voice.services.kind.fixed": "Fixed price",
  "voice.services.kind.fixed.es": "Precio fijo",
  "voice.services.kind.from": "Starting price",
  "voice.services.kind.from.es": "Precio desde",
  "voice.services.kind.range": "Price range",
  "voice.services.kind.range.es": "Rango de precio",
  "voice.services.kind.per_unit": "Price per unit",
  "voice.services.kind.per_unit.es": "Precio por unidad",
  "voice.services.kind.free": "Free",
  "voice.services.kind.free.es": "Sin costo",
  "voice.services.kind.after_visit": "Priced after a visit",
  "voice.services.kind.after_visit.es": "Precio después de una visita",
  "voice.services.amount": "Price in dollars",
  "voice.services.amount.es": "Precio en dólares",
  "voice.services.amountMin": "Lowest price in dollars",
  "voice.services.amountMin.es": "Precio más bajo en dólares",
  "voice.services.amountMax": "Highest price in dollars",
  "voice.services.amountMax.es": "Precio más alto en dólares",
  "voice.services.unitEn": "Unit in English (for example, guest)",
  "voice.services.unitEn.es": "Unidad en inglés (por ejemplo, guest)",
  "voice.services.unitEs": "Unit in Spanish (for example, invitado)",
  "voice.services.unitEs.es": "Unidad en español (por ejemplo, invitado)",
  "voice.services.previewEn": "What {persona} says in English",
  "voice.services.previewEn.es": "Lo que {persona} dice en inglés",
  "voice.services.previewEs": "What {persona} says in Spanish",
  "voice.services.previewEs.es": "Lo que {persona} dice en español",
  "voice.services.save": "Save services",
  "voice.services.save.es": "Guardar servicios",
  "voice.services.saved": "Services saved",
  "voice.services.saved.es": "Servicios guardados",
  "voice.services.saveFailed": "Couldn't save the services. Try again.",
  "voice.services.saveFailed.es": "No se pudieron guardar los servicios. Intente de nuevo.",
  "voice.services.loadFailed": "Couldn't load the services. Reload the page to try again.",
  "voice.services.loadFailed.es": "No se pudieron cargar los servicios. Recargue la página para intentar de nuevo.",
  "voice.services.error.name": "Give every service a name in English.",
  "voice.services.error.name.es": "Póngale a cada servicio un nombre en inglés.",
  "voice.services.error.amount": "Add the price for {name}.",
  "voice.services.error.amount.es": "Agregue el precio de {name}.",
  "voice.services.error.range": "For {name}, the highest price must be more than the lowest.",
  "voice.services.error.range.es": "En {name}, el precio más alto debe ser mayor que el más bajo.",
  "voice.services.error.units": "Add the unit in English and in Spanish for {name}.",
  "voice.services.error.units.es": "Agregue la unidad en inglés y en español para {name}.",
  "voice.services.error.tooLong": "{name}: use at most 80 characters for a name, 300 for a description and 30 for a unit.",
  "voice.services.error.tooLong.es": "{name}: use como máximo 80 caracteres para un nombre, 300 para una descripción y 30 para una unidad.",
  "voice.services.summary.range": "{min} to {max}",
  "voice.services.summary.range.es": "{min} a {max}",
  "voice.services.summary.perUnit": "{amount} per {unit}",
  "voice.services.summary.perUnit.es": "{amount} por {unit}",
  "voice.knowledge.stale": "Someone else just saved this. Reload to see their change.",
  "voice.knowledge.stale.es": "Alguien más acaba de guardar esto. Recargue la página para ver su cambio.",
  "voice.knowledge.noProfile": "Save the voice profile above first.",
  "voice.knowledge.noProfile.es": "Primero guarde el perfil de voz de arriba.",
  "voice.knowledge.invalid": "Something in this card couldn't be saved. Check it and try again.",
  "voice.knowledge.invalid.es": "Algo en esta tarjeta no se pudo guardar. Revíselo e intente de nuevo.",
  "voice.facts.hoursNotice": "Facts mentions hours. {persona} uses Business hours below, so take regular hours out of Facts. A closure on a specific date can stay.",
  "voice.facts.hoursNotice.es": "Los datos mencionan horarios. {persona} usa el Horario del negocio de abajo, así que quite el horario normal de los datos. Un cierre en una fecha específica puede quedarse.",
  "voice.facts.hoursHint": "Add Business hours below so {persona} can tell callers whether you are open right now.",
  "voice.facts.hoursHint.es": "Agregue el Horario del negocio abajo para que {persona} pueda decirles a quienes llaman si está abierto en este momento.",
  "voice.facts.amountsNotice": "{persona} gives prices only from Services & prices, so these amounts in the Facts or Services box will not be said: {amounts}. Add each amount {persona} should say as its own row (a deposit or a fee too), or take it out. Refund and cancellation terms without an amount can stay.",
  "voice.facts.amountsNotice.es": "{persona} da precios solo de Servicios y precios, así que no dirá estos montos del cuadro de datos o de servicios: {amounts}. Agregue como su propia fila cada monto que {persona} deba decir (también un depósito o una cuota), o quítelo. Los términos de reembolso y cancelación sin monto pueden quedarse.",
  "voice.facts.amountsNoticeInsurance": "{persona} never gives prices on insurance accounts, so these amounts in the Facts or Services box will not be said: {amounts}. You can take them out.",
  "voice.facts.amountsNoticeInsurance.es": "{persona} nunca da precios en cuentas de seguros, así que no dirá estos montos del cuadro de datos o de servicios: {amounts}. Puede quitarlos.",
  // S-47c follow-up (design review): an amount typed into a row's OWN name or description (not its
  // price fields) IS read to the caller, as written — LIST_PRICE_LINE makes her say the rendered price
  // sentence word for word, and `priceSentence` (price-sentence.ts) builds that sentence from the name
  // verbatim, so a name's amount travels straight into it; a description's amount is read as its own
  // "About it" line (prompt-blocks.ts's servicesBlock), which the price rule never touches either. Off
  // insurance this contradicts the HARD LIMITS line (no amount outside the price sentence); on
  // insurance (the other key below) no price is ever given at all. Never blocks Save.
  "voice.services.amountsNotice": "{persona} reads names and descriptions as written, so these amounts would be said aloud: {amounts}. Put the price in the price fields instead.",
  "voice.services.amountsNotice.es": "{persona} lee los nombres y las descripciones tal como están escritos, así que diría estos montos: {amounts}. Ponga el precio en los campos de precio.",
  "voice.services.amountsNoticeInsurance": "{persona} never gives prices on insurance accounts, so take these amounts out of the names and descriptions: {amounts}.",
  "voice.services.amountsNoticeInsurance.es": "{persona} nunca da precios en cuentas de seguros, así que quite estos montos de los nombres y las descripciones: {amounts}.",
  "calls.detail.knowledge": "Knowledge",
  "calls.detail.knowledge.es": "Conocimiento",
  "calls.detail.knowledgeLink": "What {persona} knew (#{version})",
  "calls.detail.knowledgeLink.es": "Lo que {persona} sabía (#{version})",
  "voice.knowledge.title": "What {persona} knew",
  "voice.knowledge.title.es": "Lo que {persona} sabía",
  "voice.knowledge.version": "Version {version}",
  "voice.knowledge.version.es": "Versión {version}",
  "voice.knowledge.savedBy": "Saved {date} by {person}",
  "voice.knowledge.savedBy.es": "Guardada el {date} por {person}",
  "voice.knowledge.recordedAutomatically": "Recorded automatically {date}",
  "voice.knowledge.recordedAutomatically.es": "Registrada automáticamente el {date}",
  "voice.knowledge.facts": "Facts",
  "voice.knowledge.facts.es": "Datos",
  "voice.knowledge.servicesText": "Services (free text)",
  "voice.knowledge.servicesText.es": "Servicios (texto libre)",
  "voice.knowledge.hours": "Business hours",
  "voice.knowledge.hours.es": "Horario del negocio",
  "voice.knowledge.prices": "Services & prices",
  "voice.knowledge.prices.es": "Servicios y precios",
  "voice.knowledge.nameEs": "Name in Spanish",
  "voice.knowledge.nameEs.es": "Nombre en español",
  "voice.knowledge.aboutEn": "About it, in English",
  "voice.knowledge.aboutEn.es": "Sobre el servicio, en inglés",
  "voice.knowledge.aboutEs": "About it, in Spanish",
  "voice.knowledge.aboutEs.es": "Sobre el servicio, en español",
  "voice.knowledge.inEnglish": "Price, in English",
  "voice.knowledge.inEnglish.es": "Precio, en inglés",
  "voice.knowledge.inSpanish": "Price, in Spanish",
  "voice.knowledge.inSpanish.es": "Precio, en español",
  "voice.knowledge.nothing": "Nothing was written here.",
  "voice.knowledge.nothing.es": "No había nada escrito aquí.",
  "voice.knowledge.noHours": "No business hours were set.",
  "voice.knowledge.noHours.es": "No había horario del negocio.",
  "voice.knowledge.noPrices": "No services were listed.",
  "voice.knowledge.noPrices.es": "No había servicios en la lista.",
  // S-47c follow-up (spec 5.4, C13): the call this page was reached from ran under the insurance
  // module, which never gave a price sentence, so the sentences below are hidden and this says why.
  "voice.knowledge.insuranceCallNote": "On this call the insurance rules applied, so {persona} was given the service names and descriptions, never a price.",
  "voice.knowledge.insuranceCallNote.es": "En esta llamada se aplicaron las reglas de seguros, así que a {persona} solo se le dieron los nombres y las descripciones de los servicios, nunca un precio.",
  "voice.knowledge.older": "Older",
  "voice.knowledge.older.es": "Anterior",
  "voice.knowledge.newer": "Newer",
  "voice.knowledge.newer.es": "Más reciente",
  "voice.knowledge.back": "Back to Voice",
  "voice.knowledge.back.es": "Volver a Voz",
  "voice.knowledge.notFound": "This account has no version {version}.",
  "voice.knowledge.notFound.es": "Esta cuenta no tiene la versión {version}.",
  "voice.knowledge.loadFailed": "Couldn't load this version. Reload the page to try again.",
  "voice.knowledge.loadFailed.es": "No se pudo cargar esta versión. Recargue la página para intentar de nuevo.",
  "voice.knowledge.notFoundGeneric": "This version doesn't exist.",
  "voice.knowledge.notFoundGeneric.es": "Esta versión no existe.",
  "voice.knowledge.loading": "Loading this version",
  "voice.knowledge.loading.es": "Cargando esta versión",
  // S-47d: the one switch, closed days, the closure To-do and hold reasons, the call-page status line. Usted.
  "business.state.open": "Open",
  "business.state.open.es": "Abierto",
  "business.state.closedToday": "Closed today",
  "business.state.closedToday.es": "Cerrado hoy",
  "business.state.runningLate": "Running late",
  "business.state.runningLate.es": "Con retraso",
  "business.state.storm": "Closed for a storm",
  "business.state.storm.es": "Cerrado por tormenta",
  "business.menu.trigger": "Change today's status",
  "business.menu.trigger.es": "Cambiar el estado de hoy",
  "business.menu.open": "Open",
  "business.menu.open.es": "Abierto",
  "business.menu.closedToday": "Closed today",
  "business.menu.closedToday.es": "Cerrado hoy",
  "business.menu.runningLate": "Running late",
  "business.menu.runningLate.es": "Con retraso",
  "business.menu.late15": "About 15 minutes",
  "business.menu.late15.es": "Unos 15 minutos",
  "business.menu.late30": "About 30 minutes",
  "business.menu.late30.es": "Unos 30 minutos",
  "business.menu.late60": "About an hour",
  "business.menu.late60.es": "Como una hora",
  "business.menu.late120": "More than an hour",
  "business.menu.late120.es": "Más de una hora",
  "business.menu.storm": "Storm",
  "business.menu.storm.es": "Tormenta",
  "business.menu.stormOpenEnded": "Until further notice",
  "business.menu.stormOpenEnded.es": "Hasta nuevo aviso",
  "business.menu.stormBackOn": "Back on a date…",
  "business.menu.stormBackOn.es": "Reabrimos el…",
  "business.menu.changeClosedDays": "Change closed days",
  "business.menu.changeClosedDays.es": "Cambiar días cerrados",
  "business.storm.title": "Closed for a storm",
  "business.storm.title.es": "Cerrado por tormenta",
  // Fix round D4: the dialog asks the one question its date field answers.
  "business.storm.description": "When do you reopen?",
  "business.storm.description.es": "¿Cuándo vuelve a abrir?",
  "business.storm.date": "Back on",
  "business.storm.date.es": "Reabrimos el",
  "business.storm.submit": "Close until then",
  "business.storm.submit.es": "Cerrar hasta entonces",
  "business.storm.dateError": "Pick a date from tomorrow to 92 days from now.",
  "business.storm.dateError.es": "Elija una fecha entre mañana y dentro de 92 días.",
  "business.opens.time": "opens {time}",
  "business.opens.time.es": "abre a las {time}",
  "business.opens.tomorrow": "opens tomorrow",
  "business.opens.tomorrow.es": "abre mañana",
  "business.opens.dayTime": "opens {day} {time}",
  "business.opens.dayTime.es": "abre el {day} a las {time}",
  "business.opens.day": "opens {day}",
  "business.opens.day.es": "abre el {day}",
  "business.opens.date": "opens {date}",
  "business.opens.date.es": "abre el {date}",
  "business.topbar.closedToday": "Closed today · {opens}",
  "business.topbar.closedToday.es": "Cerrado hoy · {opens}",
  "business.topbar.storm": "Closed for a storm",
  "business.topbar.storm.es": "Cerrado por tormenta",
  "business.topbar.stormDated": "Closed for a storm · {opens}",
  "business.topbar.stormDated.es": "Cerrado por tormenta · {opens}",
  "business.topbar.late15": "Running about 15 min late",
  "business.topbar.late15.es": "Con unos 15 min de retraso",
  "business.topbar.late30": "Running about 30 min late",
  "business.topbar.late30.es": "Con unos 30 min de retraso",
  "business.topbar.late60": "Running about an hour late",
  "business.topbar.late60.es": "Con alrededor de una hora de retraso",
  "business.topbar.late120": "Running over an hour late",
  "business.topbar.late120.es": "Con más de una hora de retraso",
  "business.topbar.short.closedToday": "Closed today",
  "business.topbar.short.closedToday.es": "Cerrado hoy",
  "business.topbar.short.storm": "Storm",
  "business.topbar.short.storm.es": "Tormenta",
  "business.topbar.short.late15": "15 min late",
  "business.topbar.short.late15.es": "15 min tarde",
  "business.topbar.short.late30": "30 min late",
  "business.topbar.short.late30.es": "30 min tarde",
  "business.topbar.short.late60": "1 hr late",
  "business.topbar.short.late60.es": "1 h tarde",
  "business.topbar.short.late120": "1+ hr late",
  "business.topbar.short.late120.es": "1+ h tarde",
  "business.topbar.open": "Open",
  "business.topbar.open.es": "Abierto",
  "business.toast.closedToday": "Closed for today. Your booking page now says so.",
  "business.toast.closedToday.es": "Cerrado por hoy. Su página de citas ya lo dice.",
  "business.toast.storm": "Closed for a storm. Your booking page now says so.",
  "business.toast.storm.es": "Cerrado por tormenta. Su página de citas ya lo dice.",
  "business.toast.late": "Running late today. Booking stays open.",
  "business.toast.late.es": "Con retraso hoy. Se siguen aceptando citas.",
  "business.toast.open": "Open again. Your booking page takes bookings as usual.",
  "business.toast.open.es": "Abierto de nuevo. Su página de citas acepta reservas como siempre.",
  "business.toast.persona": "{persona} says so too.",
  "business.toast.persona.es": "{persona} también lo dice.",
  "business.toast.todo": "A To-do lists the {n} affected appointments.",
  "business.toast.todo.es": "Una tarea en Pendientes lista las {n} citas afectadas.",
  "business.toast.todoOne": "A To-do lists the affected appointment.",
  "business.toast.todoOne.es": "Una tarea en Pendientes lista la cita afectada.",
  "business.toast.undone": "Change undone.",
  "business.toast.undone.es": "Cambio deshecho.",
  "business.toast.changedSince": "Someone changed this since, so nothing was undone.",
  "business.toast.changedSince.es": "Alguien lo cambió mientras tanto, así que no se deshizo nada.",
  "business.toast.failed": "Couldn't change today's status. Try again.",
  "business.toast.failed.es": "No se pudo cambiar el estado de hoy. Intente de nuevo.",
  "business.refuse.role": "Only an Owner can change this.",
  "business.refuse.role.es": "Solo un dueño puede cambiar esto.",
  "business.refuse.closeOrReopen": "Only an Owner can close the business or reopen it.",
  "business.refuse.closeOrReopen.es": "Solo un dueño puede cerrar el negocio o volver a abrirlo.",
  // Fix round C5: Keep is refused only to whoever cannot see the whole account (a Technician); Staff may.
  "business.refuse.keep": "Only an Owner or Staff can keep an appointment.",
  "business.refuse.keep.es": "Solo un dueño o un empleado puede mantener una cita.",
  "business.card.title": "Today",
  "business.card.title.es": "Hoy",
  "business.card.change": "Change",
  "business.card.change.es": "Cambiar",
  "business.card.openToday": "Open today",
  "business.card.openToday.es": "Abierto hoy",
  "business.card.nextClosedDay": "Next closed day: {date}",
  "business.card.nextClosedDay.es": "Próximo día cerrado: {date}",
  "business.card.nextClosedDayReason": "Next closed day: {date} ({reason})",
  "business.card.nextClosedDayReason.es": "Próximo día cerrado: {date} ({reason})",
  "business.card.opensAgain.tomorrow": "Opens again tomorrow at {time}",
  "business.card.opensAgain.tomorrow.es": "Abre de nuevo mañana a las {time}",
  "business.card.opensAgain.day": "Opens again on {day} at {time}",
  "business.card.opensAgain.day.es": "Abre de nuevo el {day} a las {time}",
  "business.card.opensAgain.date": "Opens again on {date} at {time}",
  "business.card.opensAgain.date.es": "Abre de nuevo el {date} a las {time}",
  "business.card.opensAgain.tomorrowNoTime": "Opens again tomorrow",
  "business.card.opensAgain.tomorrowNoTime.es": "Abre de nuevo mañana",
  "business.card.opensAgain.dayNoTime": "Opens again on {day}",
  "business.card.opensAgain.dayNoTime.es": "Abre de nuevo el {day}",
  "business.card.opensAgain.dateNoTime": "Opens again on {date}",
  "business.card.opensAgain.dateNoTime.es": "Abre de nuevo el {date}",
  "business.card.untilReopen": "Until you reopen",
  "business.card.untilReopen.es": "Hasta que vuelva a abrir",
  "business.card.endsMidnight": "Ends at midnight",
  "business.card.endsMidnight.es": "Termina a medianoche",
  "business.card.lateHidden": "Booking stays open; times in the next {minutes} minutes are hidden.",
  "business.card.lateHidden.es": "Se siguen aceptando citas; se ocultan los horarios de los próximos {minutes} minutos.",
  "business.card.lateHidden120": "Booking stays open; times in the next 2 hours are hidden.",
  "business.card.lateHidden120.es": "Se siguen aceptando citas; se ocultan los horarios de las próximas 2 horas.",
  "business.card.affectedAppointments": "Affected appointments",
  "business.card.affectedAppointments.es": "Citas afectadas",
  "business.card.waiting": "{n} messages waiting",
  "business.card.waiting.es": "{n} mensajes en espera",
  "business.card.waitingOne": "1 message waiting",
  "business.card.waitingOne.es": "1 mensaje en espera",
  "business.card.keep": "Keep",
  "business.card.keep.es": "Mantener",
  "business.card.kept": "Kept",
  "business.card.kept.es": "Se mantiene",
  "business.card.keptToast": "Kept. Its reminders go out as usual.",
  "business.card.keptToast.es": "Se mantiene. Sus recordatorios salen como siempre.",
  // Fix round D5: a failed Keep says what failed.
  "business.card.keepFailed": "Couldn't keep this appointment. Try again.",
  "business.card.keepFailed.es": "No se pudo mantener esta cita. Intente de nuevo.",
  "business.card.cancelOnCalendar": "Cancel on the calendar",
  "business.card.cancelOnCalendar.es": "Cancelar en el calendario",
  "business.card.moreLater": "More appointments after {date} are on the calendar.",
  "business.card.moreLater.es": "Hay más citas después del {date} en el calendario.",
  "business.card.noneAffected": "No appointments are affected.",
  "business.card.noneAffected.es": "Ninguna cita se ve afectada.",
  "business.card.error": "Couldn't load today's status.",
  "business.card.error.es": "No se pudo cargar el estado de hoy.",
  "business.card.retry": "Retry",
  "business.card.retry.es": "Reintentar",
  "business.reason.holiday": "Holiday",
  "business.reason.holiday.es": "Día festivo",
  "business.reason.vacation": "Vacation",
  "business.reason.vacation.es": "Vacaciones",
  "business.reason.other": "Other",
  "business.reason.other.es": "Otro",
  "business.reason.none": "None",
  "business.reason.none.es": "Ninguno",
  "closedDays.title": "Closed days",
  "closedDays.title.es": "Días cerrados",
  "closedDays.from": "From",
  "closedDays.from.es": "Desde",
  "closedDays.to": "To (optional)",
  "closedDays.to.es": "Hasta (opcional)",
  "closedDays.reason": "Reason",
  "closedDays.reason.es": "Motivo",
  "closedDays.add": "Add closed days",
  "closedDays.add.es": "Agregar días cerrados",
  "closedDays.remove": "Remove",
  "closedDays.remove.es": "Quitar",
  "closedDays.count": "{n} appointments",
  "closedDays.count.es": "{n} citas",
  "closedDays.countOne": "1 appointment",
  "closedDays.countOne.es": "1 cita",
  // Fix round (sonnet review): the dashboard status card's own "more later" caveat
  // (business.card.moreLater), worded for this card instead — the shared read cap orders across every
  // listed range, so there is no one range's own date to name the way that key does.
  "closedDays.moreAppointments": "There may be more appointments than shown.",
  "closedDays.moreAppointments.es": "Puede haber más citas de las que se muestran.",
  "closedDays.added": "Closed days added.",
  "closedDays.added.es": "Días cerrados agregados.",
  "closedDays.addedTodo": "{n} appointments are on these days. A To-do lists them.",
  "closedDays.addedTodo.es": "Hay {n} citas en estos días. Una tarea en Pendientes las lista.",
  "closedDays.addedTodoOne": "1 appointment is on these days. A To-do lists it.",
  "closedDays.addedTodoOne.es": "Hay 1 cita en estos días. Una tarea en Pendientes la lista.",
  "closedDays.removed": "Closed days removed.",
  "closedDays.removed.es": "Días cerrados quitados.",
  "closedDays.empty": "No closed days planned. Add a holiday or a vacation, and your booking page and {persona} will know you're closed.",
  "closedDays.empty.es": "No hay días cerrados planeados. Agregue un día festivo o unas vacaciones, y su página de citas y {persona} sabrán que está cerrado.",
  // Fix round D3 (SD19): an account with no voice profile has no persona to name.
  "closedDays.emptyNoPersona": "No closed days planned. Add a holiday or a vacation, and your booking page will know you're closed.",
  "closedDays.emptyNoPersona.es": "No hay días cerrados planeados. Agregue un día festivo o unas vacaciones, y su página de citas sabrá que está cerrado.",
  "closedDays.error": "Couldn't load closed days.",
  "closedDays.error.es": "No se pudieron cargar los días cerrados.",
  "closedDays.saveFailed": "Couldn't save the closed days. Try again.",
  "closedDays.saveFailed.es": "No se pudieron guardar los días cerrados. Intente de nuevo.",
  "closedDays.role": "Only an Owner can change closed days.",
  "closedDays.role.es": "Solo un dueño puede cambiar los días cerrados.",
  "closedDays.error.past": "The first day can't be in the past.",
  "closedDays.error.past.es": "El primer día no puede ser en el pasado.",
  "closedDays.error.endBeforeStart": "The last day must be on or after the first.",
  "closedDays.error.endBeforeStart.es": "El último día debe ser igual o posterior al primero.",
  "closedDays.error.tooLong": "Closed days can cover at most 92 days at a time.",
  "closedDays.error.tooLong.es": "Los días cerrados pueden cubrir como máximo 92 días a la vez.",
  "closedDays.error.tooFar": "Closed days must end within the next 12 months.",
  "closedDays.error.tooFar.es": "Los días cerrados deben terminar dentro de los próximos 12 meses.",
  "closedDays.error.overlap": "These days overlap {range}, already listed.",
  "closedDays.error.overlap.es": "Estos días se cruzan con {range}, que ya está en la lista.",
  "business.todo.status": "Contact customers affected by the closure",
  "business.todo.status.es": "Comuníquese con los clientes afectados por el cierre",
  "business.todo.closedDay": "Contact customers booked on {dates}",
  "business.todo.closedDay.es": "Comuníquese con los clientes con cita el {dates}",
  "automations.reason.heldClosedToday": "Held: the business is closed today",
  "automations.reason.heldClosedToday.es": "En espera: el negocio está cerrado hoy",
  "automations.reason.heldStorm": "Held: closed for a storm",
  "automations.reason.heldStorm.es": "En espera: cerrado por tormenta",
  "automations.reason.heldClosedDay": "Held: the business is closed that day",
  "automations.reason.heldClosedDay.es": "En espera: el negocio está cerrado ese día",
  "automations.reason.heldClosureUnknown": "Held: couldn't check whether the business is open",
  "automations.reason.heldClosureUnknown.es": "En espera: no se pudo comprobar si el negocio está abierto",
  "automations.reason.skippedClosed": "Not sent: the business was closed for this appointment",
  "automations.reason.skippedClosed.es": "No se envió: el negocio estaba cerrado para esta cita",
  // M7a PR-4 (G7a): a due automation held, not dropped, while the account is
  // paused for billing; if it is still stale once the pause lifts, it is
  // skipped instead of sent (held-or-send's closure-hold shape).
  "automations.reason.heldBillingPaused": "Held: the account is paused until a payment goes through",
  "automations.reason.heldBillingPaused.es": "En espera: la cuenta está en pausa hasta que se reciba un pago",
  "automations.reason.skippedBillingPaused": "Not sent: too late, the account was paused",
  "automations.reason.skippedBillingPaused.es": "No se envió: demasiado tarde, la cuenta estaba en pausa",
  // M7a PR-4 (review item 2): a send a person asked for (the document request) refused while paused; an
  // automation never reads it, holdOrSend holds those first.
  "automations.reason.billingPaused": "Not sent: the account is paused",
  "automations.reason.billingPaused.es": "No se envió: la cuenta está en pausa",
  "calls.detail.businessStatus": "Status at the start",
  "calls.detail.businessStatus.es": "Estado al empezar",
  "calls.detail.businessStatus.open": "Open",
  "calls.detail.businessStatus.open.es": "Abierto",
  "calls.detail.businessStatus.closed_today": "Closed today",
  "calls.detail.businessStatus.closed_today.es": "Cerrado hoy",
  "calls.detail.businessStatus.running_late_15": "Running about 15 minutes late",
  "calls.detail.businessStatus.running_late_15.es": "Con unos 15 minutos de retraso",
  "calls.detail.businessStatus.running_late_30": "Running about 30 minutes late",
  "calls.detail.businessStatus.running_late_30.es": "Con unos 30 minutos de retraso",
  "calls.detail.businessStatus.running_late_60": "Running about an hour late",
  "calls.detail.businessStatus.running_late_60.es": "Con alrededor de una hora de retraso",
  "calls.detail.businessStatus.running_late_120": "Running more than an hour late",
  "calls.detail.businessStatus.running_late_120.es": "Con más de una hora de retraso",
  "calls.detail.businessStatus.storm": "Closed for a storm",
  "calls.detail.businessStatus.storm.es": "Cerrado por tormenta",
  "calls.detail.businessStatus.closed_day": "Closed (closed day)",
  "calls.detail.businessStatus.closed_day.es": "Cerrado (día cerrado)",
  "voice.knowledge.closedDays": "Closed days",
  "voice.knowledge.closedDays.es": "Días cerrados",
  "voice.knowledge.noClosedDays": "No closed days were planned.",
  "voice.knowledge.noClosedDays.es": "No había días cerrados planeados.",
  "voice.knowledge.noClosedDaysRecorded": "No closed days were recorded in this version.",
  "voice.knowledge.noClosedDaysRecorded.es": "En esta versión no se registraron días cerrados.",
  // S-47e: identity checks (the To-do), the shared number's holding thread (label, Notice, Move, the call page) and its two To-dos. Usted.
  "voice.todo.identity": "Someone asked about an appointment and couldn't confirm who they are",
  "voice.todo.identity.es": "Alguien preguntó por una cita y no pudo confirmar quién es",
  "contact.holding.label": "Shared number {number}",
  "contact.holding.label.es": "Número compartido {number}",
  "conversation.holding.notice": "These texts came from {number}, a phone more than one customer uses, so they aren't filed under anyone yet. Move them to the right person.",
  "conversation.holding.notice.es": "Estos mensajes llegaron desde el {number}, un teléfono que usa más de un cliente, así que todavía no están en el registro de ningún cliente. Muévalos a la persona correcta.",
  "conversation.holding.move": "Move to…",
  "conversation.holding.move.es": "Mover a…",
  "conversation.holding.moveOther": "Find another customer",
  "conversation.holding.moveOther.es": "Buscar otro cliente",
  "conversation.holding.moved": "Moved to {name}.",
  "conversation.holding.moved.es": "Los mensajes se movieron a {name}.",
  "conversation.holding.movedBack": "Moved back.",
  "conversation.holding.movedBack.es": "Los mensajes se regresaron.",
  "conversation.holding.moveFailed": "That conversation couldn't be moved. Try again.",
  "conversation.holding.moveFailed.es": "No se pudo mover la conversación. Inténtelo de nuevo.",
  "conversation.holding.moveEmpty": "These texts were already moved.",
  "conversation.holding.moveEmpty.es": "Estos mensajes ya se movieron.",
  "call.holding.openTexts": "Open the texts",
  "call.holding.openTexts.es": "Abrir los mensajes",
  "conversation.holding.findLabel": "Search customers by name or phone",
  "conversation.holding.findLabel.es": "Buscar clientes por nombre o teléfono",
  "conversation.holding.findNone": "No one found. Add them on Contacts first, then move these texts.",
  "conversation.holding.findNone.es": "No se encontró a nadie. Agréguelo primero en Contactos y luego mueva estos mensajes.",
  "conversation.holding.findHint": "Pick who these texts belong to. They move as soon as you choose, and you can undo.",
  "conversation.holding.findHint.es": "Elija a quién pertenecen estos mensajes. Se mueven en cuanto elige, y puede deshacerlo.",
  "conversation.holding.findCustomer": "Find a customer",
  "conversation.holding.findCustomer.es": "Buscar un cliente",
  "conversation.holding.findFailed": "Couldn't search customers. Try again.",
  "conversation.holding.findFailed.es": "No se pudo buscar clientes. Inténtelo de nuevo.",
  "conversation.holding.moveRole": "Only an Owner or Staff can move these texts.",
  "conversation.holding.moveRole.es": "Solo un dueño o un empleado puede mover estos mensajes.",
  "todo.sharedNumber.reply": "A reply from a shared number couldn't be matched to one appointment",
  "todo.sharedNumber.reply.es": "Una respuesta de un número compartido no se pudo asociar con una sola cita",
  "todo.sharedNumber.hold": "A text from the shared number {number} may have asked to stop texts: “{excerpt}”. Texts to that number are on hold.",
  "todo.sharedNumber.hold.es": "Un mensaje del número compartido {number} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes a ese número están en pausa.",
  // concierge.aiLabel (Task 5): the website chat's AI label, header and first
  // message. Lives here, not lib/concierge/strings.ts (spec §6; ambiguity D).
  // Spanish is tú, the chat's own register — the one exception the global
  // constraints name, alongside the spoken phone sentence (D3, usted).
  "concierge.aiLabel": "{persona} · AI assistant",
  "concierge.aiLabel.es": "{persona} · asistente de IA",
  // concierge.aiIntro: the chat's first message on Trial or On, spoken in the
  // chat's own tú register like aiLabel above.
  "concierge.aiIntro": "I'm {persona}, an AI assistant. This chat is saved so the team can follow up.",
  "concierge.aiIntro.es": "Soy {persona}, una asistente de inteligencia artificial. Este chat se guarda para que el equipo te dé seguimiento.",

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
  // D-108: the facts are the only thing the assistant answers from, so the
  // switch needs them too (Setup's profile row always did).
  // A bilingual line with the English greeting written and the Spanish one
  // blank: say WHICH greeting, not "the greeting" about one already written.
  "voice.assistant.lockedBlankSpanishGreeting": "Write the Spanish greeting first. This line answers in English and Spanish, so it needs both.",
  "voice.assistant.spanishGreetingBlankOn": "The Spanish greeting is blank. This line answers in English and Spanish, so write one in the assistant's profile above.",
  "voice.assistant.lockedBlankFacts": "Write what the assistant should know about the business first.",
  "voice.assistant.factsBlankOn": "Nothing is written about the business, so the assistant has nothing to answer questions from. Add it in the assistant's profile above.",
  "voice.assistant.lockedNoSelection": "Choose a form for its leads first.",
  "voice.assistant.noFormTitle": "No published form yet",
  "voice.assistant.noFormBody": "The website assistant needs a form to send its leads to. Publish one, then come back here to turn it on.",
  "voice.assistant.goToForms": "Go to Forms",
  "voice.assistant.enabledToast": "Website assistant turned on",
  "voice.assistant.disabledToast": "Website assistant turned off",
  "voice.assistant.enableFailed": "Could not turn on the website assistant.",
  "voice.assistant.disableFailed": "Could not turn off the website assistant.",
  "voice.assistant.wrongForm": "That form belongs to a different company, or was just deleted. Pick another one.",
  // D-048: an unpublished destination now takes the chat down (a chat that
  // cannot file a lead is not opened), so this says what visitors see.
  "voice.assistant.formUnpublished": "The form this sends to is no longer published, so the assistant is not answering on your website. Publish it again, or turn the assistant off to pick another.",
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
  "automations.review.defaultBody.es": "¡Gracias por elegir a {name}! Si tiene un minuto, nos ayuda mucho que nos deje una reseña:",
  "automations.review.defaultBodyNoName": "Thanks for choosing us! If you have a minute, we'd love a quick review:",
  "automations.review.defaultBodyNoName.es": "¡Gracias por elegirnos! Si tiene un minuto, nos ayuda mucho que nos deje una reseña:",
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
  "automations.noShow.defaultBody.es": "Le estuvimos esperando en su cita con {name}. Escoja otro horario en este enlace:",
  "automations.noShow.defaultBodyNoName": "We missed you at your appointment. Pick a new time here:",
  "automations.noShow.defaultBodyNoName.es": "Le estuvimos esperando en su cita. Escoja otro horario en este enlace:",
  // The text reminder. The LEAD carries the appointment time and is never
  // the operator's to place — `{when}` is formatWhen's output in the
  // booker's zone; the operator's prose (or this default) follows it.
  "automations.smsReminder.lead": "Reminder: your appointment with {name} is {when}.",
  "automations.smsReminder.lead.es": "Recordatorio: su cita con {name} es el {when}.",
  "automations.smsReminder.leadNoName": "Reminder: your appointment is {when}.",
  "automations.smsReminder.leadNoName.es": "Recordatorio: su cita es el {when}.",
  "automations.smsReminder.defaultBody": "Reply to this text if you need to make a change.",
  "automations.smsReminder.defaultBody.es": "Si necesita hacer un cambio, responda a este mensaje.",
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
  "automations.appointmentConfirm.lead.es": "Hola, le escribe {name}. Tiene cita el {when}. Responda SI para confirmar o NO si necesita otro horario. Sea cual sea su respuesta, la vamos a ver.",
  "automations.appointmentConfirm.leadNoName": "You're booked for {when}. Reply YES to confirm or NO if you need a different time. Either way we'll see it.",
  "automations.appointmentConfirm.leadNoName.es": "Tiene cita el {when}. Responda SI para confirmar o NO si necesita otro horario. Sea cual sea su respuesta, la vamos a ver.",
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
  "calendar.bookings.confirmed.es": "Confirmó por mensaje",
  "calendar.bookings.confirmDeclined": "Asked for a different time",
  "calendar.bookings.confirmDeclined.es": "Pidió otro horario",
  // F-048: the line a customer's own move writes into their thread (the
  // public move page, `move/[token]/actions.ts`). The English line is what
  // is written today; the Spanish waits for an operator locale (the
  // `todo.consent.*` precedent). "{was}"/"{now}" are the two times in the
  // account's zone.
  "calendar.move.thread.subject.en": "Booking moved",
  "calendar.move.thread.subject.es": "Cita cambiada",
  "calendar.move.thread.body.en": "Moved their booking from {was} to {now}",
  "calendar.move.thread.body.es": "Cambió su cita del {was} al {now}",

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
  "automations.referral.defaultBody.es": "Gracias otra vez de parte de {name}. ¿Conoce a alguien que necesite el mismo trabajo? Denos su nombre y su cel y nosotros nos encargamos.",
  "automations.referral.defaultBodyNoName": "Thanks again. Know anyone who needs the same done? Send their name and number and we'll look after them.",
  "automations.referral.defaultBodyNoName.es": "Gracias otra vez. ¿Conoce a alguien que necesite el mismo trabajo? Denos su nombre y su cel y nosotros nos encargamos.",
  "automations.referral.emailSubject": "One favor, from {name}",
  "automations.referral.emailSubject.es": "Un favor, de parte de {name}",
  "automations.referral.emailSubjectNoName": "One favor",
  "automations.referral.emailSubjectNoName.es": "Un favor",
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
  "automations.reactivation.defaultBody.es": "Hola, le saluda {name}. Ya hace tiempo que no pasamos por su casa. Si algo necesita revisión antes de la temporada, responda este correo y le damos una cita.",
  "automations.reactivation.defaultBodyNoName": "Hi. It's been a while since we were out at your place. If anything needs looking at before the season, just reply and we'll get you on the schedule.",
  "automations.reactivation.defaultBodyNoName.es": "Hola. Ya hace tiempo que no pasamos por su casa. Si algo necesita revisión antes de la temporada, responda este correo y le damos una cita.",
  "automations.reactivation.subject": "A note from {name}",
  "automations.reactivation.subject.es": "Un saludo de {name}",
  "automations.reactivation.subjectNoName": "Checking in",
  "automations.reactivation.subjectNoName.es": "Pasamos a saludar",
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
  "automations.reactivation.footerReason.es": "Le llega este correo porque ha sido cliente de {name}. Si prefiere no recibir más mensajes, responda y avísenos.",
  "automations.reactivation.footerReasonNoName": "You're getting this because you've been a customer of ours. If you'd rather not hear from us, reply and let us know.",
  "automations.reactivation.footerReasonNoName.es": "Le llega este correo porque ha sido nuestro cliente. Si prefiere no recibir más mensajes, responda y avísenos.",
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
  "automations.quoteFollowup.defaultBody.es": "Hola, le escribe {name}. ¿Ya pudo ver el estimado que le mandamos? Con gusto le contestamos cualquier pregunta o lo ajustamos.",
  "automations.quoteFollowup.defaultBodyNoName": "Just checking you got the quote we sent. Happy to answer anything or adjust it. Any questions?",
  "automations.quoteFollowup.defaultBodyNoName.es": "¿Ya pudo ver el estimado que le mandamos? Con gusto le contestamos cualquier pregunta o lo ajustamos.",
  "automations.quoteFollowup.emailSubject": "About your quote from {name}",
  "automations.quoteFollowup.emailSubject.es": "Sobre su estimado de {name}",
  "automations.quoteFollowup.emailSubjectNoName": "About your quote",
  "automations.quoteFollowup.emailSubjectNoName.es": "Sobre su estimado",

  // S-09 PR 2: what scheduled customer emails say in each language (spec §15.1). Customer-facing.
  "email.reminder.subject": "Reminder: your upcoming booking",
  "email.reminder.subject.es": "Recordatorio: su próxima cita",
  "email.reminder.intro": "This is a reminder for your upcoming booking.",
  "email.reminder.intro.es": "Le recordamos su próxima cita.",
  "email.reminder.join": "Join your video meeting",
  "email.reminder.join.es": "Entrar a la videollamada",
  "email.reminder.cancel": "Cancel this booking",
  "email.reminder.cancel.es": "Cancelar esta cita",
  "email.followup.defaultBody": "Thanks for coming in! If you have any questions or want to book again, just reply to this email.",
  "email.followup.defaultBody.es": "¡Gracias por su visita! Si tiene alguna pregunta o quiere hacer otra cita, solo responda a este correo.",
  "email.followup.subject": "Thanks from {name}",
  "email.followup.subject.es": "Gracias de parte de {name}",
  "email.review.subject": "Would you leave {name} a review?",
  "email.review.subject.es": "¿Le gustaría dejarle una reseña a {name}?",
  "email.review.button": "Leave a review",
  "email.review.button.es": "Dejar una reseña",
  "email.noShow.subject": "Want to pick a new time with {name}?",
  "email.noShow.subject.es": "¿Quiere escoger otro horario con {name}?",
  "email.noShow.button": "Pick a new time",
  "email.noShow.button.es": "Escoger otro horario",
  // S-09 PR 2: the Spanish box on every editable message (spec §15.3). Agency chrome renders English; twinned for the ratchet.
  "automations.bodyEn.label": "English message",
  "automations.bodyEn.label.es": "Mensaje en inglés",
  "automations.bodyEs.label": "Spanish message",
  "automations.bodyEs.label.es": "Mensaje en español",
  "automations.bodyEs.hint": "Sent to customers whose language is Spanish. It starts as our Spanish; change it to say what your English says.",
  "automations.bodyEs.hint.es": "Se manda a los clientes que hablan español. Empieza con nuestro mensaje en español; cámbielo para que diga lo mismo que su mensaje en inglés.",
  "automations.bodyEs.stale": "The Spanish still says the old message. Update it to match your English.",
  "automations.bodyEs.stale.es": "El mensaje en español todavía dice lo de antes. Actualícelo para que diga lo mismo que el de inglés.",
  "automations.bodyEs.stillMatches": "The Spanish still matches",
  "automations.bodyEs.stillMatches.es": "El español todavía coincide",
  "automations.bodyEs.emptied": "Customers whose language is Spanish will get the English message.",
  "automations.bodyEs.emptied.es": "Los clientes que hablan español recibirán el mensaje en inglés.",
  "automations.bodyEs.useOurs": "Use our Spanish",
  "automations.bodyEs.useOurs.es": "Usar nuestro español",
  "automations.bodyEs.accentCost": "Accents on á, í, ó or ú make this text cost {n} parts instead of {m}.",
  "automations.bodyEs.accentCost.es": "Los acentos en á, í, ó o ú hacen que este texto cueste {n} partes en vez de {m}.",
  "automations.previewEs": "Spanish preview",
  "automations.previewEs.es": "Vista previa en español",
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
  // Spec §6, verbatim: the fixed sending hours, read-only (decision 4).
  "automations.quiet.fixed": "Automated texts and emails go out between 8 a.m. and 9 p.m. in your time zone ({zone}). Marketing texts wait until 9 a.m., and on Sundays until noon. Anything due overnight goes out when the window opens, unless it's a reminder that would arrive after the appointment.",
  // Consent chain PR-1: the Activity page's reasons this PR adds. REASONS in
  // lib/automations/hold-or-send.ts points at these; its older lines stay
  // there (the automation engine's precedent, Global Constraints).
  "automations.reason.ledgerRetry": "Waiting a few minutes: couldn't check whether they can get texts",
  "automations.reason.emailLedgerRetry": "Waiting a few minutes: couldn't check whether they can get emails",
  "automations.reason.emailSetupRetry": "Waiting a few minutes: the unsubscribe link couldn't be added",
  "automations.reason.textsStopped": "They stopped texts from this business",
  "automations.reason.textsHeld": "Texts to them are on hold",
  "automations.reason.numberUnconfirmed": "Their number could be Mexican or US. Pick its country on their contact",
  // The re-hold age cap (orchestrator, 2026-09-26): an outage never produces
  // "Sorry we missed your call" days later.
  "automations.reason.tooLongAfterCall": "Not sent: too long after the call",
  "automations.reason.tooLongAfterWriteIn": "Not sent: too long after they wrote in",
  // D-061: accounts.outbound_suppressed (0032) — a demo account, or any
  // account the agency has otherwise marked not real. Not "pre-go-live":
  // go-live's own migration (0063) never reads or writes this column, so
  // an account can go live while still suppressed or stay suppressed well
  // after. Every scheduled pass skips this silently through
  // loadSendableRows; this string only ever surfaces if a RELEASED instant
  // reply finds the flag set, since the inline send itself stays silent
  // (same posture as "disabled" — logging it would be noise on a seeded
  // demo account, not a signal).
  "automations.reason.accountSuppressed": "This account isn't sending yet",
  "automations.reason.accountSuppressed.es": "Esta cuenta aún no está enviando",
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
  // Task 6 (Spanish-runtime lane). Deliberately NOT "Actividad" — the
  // comment right above explains why the English label avoids "Activity":
  // that word already names the account dashboard's own Activity card
  // (dashboard.activity.title), a different surface. The same collision
  // risk applies in Spanish the moment that card gets its own .es twin, so
  // this stays a literal translation of "What went out" instead.
  "nav.activity.es": "Lo que se envió",
  "activity.title": "What went out",
  "activity.usage.title": "This month",
  "activity.usage.texts": "Texts sent",
  "activity.usage.emails": "Emails sent",
  "activity.usage.conversations": "Website chats",
  "activity.usage.calls": "Calls handled",
  "activity.usage.capRecipe": "Most automations: up to {cap} a day",
  "activity.usage.capDay": "Up to {cap} a day",
  // D-066: "Emails sent" used to mix in the agency's own weekly report (not
  // a customer send, and not capped by the recipe limit above) and never
  // said when a send failed outright. Zero is a number here too — this
  // always renders, the same convention "0 waiting"/"0 skipped" already
  // follow below.
  "activity.usage.emailsFailed": "{n} failed to send",
  "activity.usage.held": "{n} waiting",
  "activity.usage.skipped": "{n} skipped",
  "activity.usage.topReason": "most often: {reason}",
  "activity.usage.error": "Couldn't load this month's numbers. Reload the page to try again.",
  "activity.empty.title": "Nothing has gone out yet",
  "activity.empty.body": "Every text, email and conversation the system handles for this company shows up here the moment a reminder, a review request or the website or phone assistant sends something.",
  // The same sentence, second person: this page is BOTH audiences (its own
  // top comment), and a client reading about THEIR OWN business should
  // never read "this company" the way an agency describing a client does.
  "activity.empty.clientBody": "Every text, email and conversation the system handles for your business shows up here the moment a reminder, a review request or the website or phone assistant sends something.",
  "activity.empty.action": "Set up automations",
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
  "activity.source.textback": "Missed-call text-back",
  "activity.source.documentRequest": "Document request",
  "activity.source.documentRequest.es": "Pedido de documentos",

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
  "calls.outcome.booked.es": "Agendó",
  "calls.outcome.lead": "Lead",
  "calls.outcome.lead.es": "Cliente potencial",
  "calls.outcome.message": "Message",
  "calls.outcome.message.es": "Mensaje",
  "calls.outcome.abandoned": "Abandoned",
  "calls.outcome.abandoned.es": "Colgó",
  "calls.outcome.spam": "Spam",
  "calls.outcome.spam.es": "Spam",
  // The caller reached a person (0037). One plain word, like its five
  // siblings — "Handed off" and "Escalated" are both things this product
  // would say to itself, not things a business owner says about their own
  // phone ringing.
  "calls.outcome.transferred": "Transferred",
  "calls.outcome.transferred.es": "Transferida",

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
  // The call card: who called, why, the number to call back and the caller's
  // own words, readable in three seconds. Each line the screen renders has a
  // written-out `.es` twin that waits for an operator locale (the
  // `todo.consent.*` precedent); the screen renders the English today.
  "calls.card.heading": "At a glance",
  "calls.card.heading.es": "De un vistazo",
  "calls.card.who": "Who called",
  "calls.card.who.es": "Quién llamó",
  "calls.card.reason": "Why they called",
  "calls.card.reason.es": "Por qué llamó",
  "calls.card.reasonUnknown": "Not recorded",
  "calls.card.reasonUnknown.es": "No quedó registrado",
  "calls.card.callback": "Call back at",
  "calls.card.callback.es": "Devolver la llamada al",
  "calls.card.callbackUnknown": "No number. Their caller ID was hidden and they didn't give one.",
  "calls.card.callbackUnknown.es": "Sin número. Su identificador de llamadas estaba oculto y no dejó uno.",
  "calls.card.words": "In their words",
  "calls.card.words.es": "En sus palabras",
  // The author mark on anything the receptionist wrote (DESIGN.md,
  // Provenance: "Sofía · AI"). "{name}" is the account's own persona
  // (voice_profiles.persona_name), "Sofía" when the screen has none to hand.
  "provenance.ai": "{name} · AI",
  "provenance.ai.es": "{name} · IA",
  // The record timeline's author marks (S-03 1b, spec §6, §10.2): one closed set of five.
  "provenance.customer": "Customer",
  "provenance.customer.es": "Cliente",
  "provenance.automation": "Automation",
  "provenance.automation.es": "Automatización",
  "provenance.import": "Import",
  "provenance.import.es": "Importación",
  "provenance.you": "You",
  "provenance.you.es": "Usted",
  // The callback To do a call leaves when the caller wants a person to call
  // them back. The English line is written into tasks.title when the To do is
  // made (the `todo.consent.*` precedent); the Spanish waits for an operator
  // locale. "{number}" is the number as the caller said it, or their caller
  // ID; "{reason}" is what they called about. The bare line is for a call
  // with no reason recorded.
  "todo.callback.en": "Call back at {number}: {reason}",
  "todo.callback.es": "Devuelva la llamada al {number}: {reason}",
  "todo.callback.bare.en": "Call back at {number}",
  "todo.callback.bare.es": "Devuelva la llamada al {number}",

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
    "A text assistant for the website. It answers questions and takes names around the clock, and files them into a form you choose. The last row turns done the first time a visitor uses it from your site.",
  "setup.step.website_assistant.row1.title": "Write the greeting and facts",
  // Shown under the profile row (and on the voice-profile step) when the one
  // thing missing is a bilingual line's Spanish greeting.
  "setup.profile.spanishGreetingMissing": "The Spanish greeting is still blank. This line answers in English and Spanish, so it needs both.",
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
  // D-091: only an answered call (booked, lead, message, transferred) turns
  // the step green, so the help says what to do on the call.
  "setup.step.test_call.help":
    "Call the assigned number and leave a message or book a time. That call turns this step green — a hang-up or a robocall doesn't count.",
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
  "setup.rename.empty.es": "Una empresa necesita un nombre; este no puede quedar vacío.",
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
  // (2026-10-09: Add company now asks for the customer-facing name as its
  // own field, so the brand name no longer starts as a copy of this label
  // and the help no longer says it does.) The mistake to prevent now is
  // the OPPOSITE one: an operator renaming here and expecting the client's
  // workspace, or their customers' emails, to follow. They do not — the
  // seeded brand name is a copy that drifts the moment either side is edited
  // alone (renameAccountAction's doc comment, setup/actions.ts) — so the copy
  // points at Branding for anything anyone else sees.
  "setup.rename.help":
    "Your own label for this client — only you see it. Change what they and their customers see in Branding.",

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
  // Staff and roles (Task 8): the agency's own ⌘K entry point into this
  // client's team management (registry.ts's own comment on why this is a
  // plain navigation entry, not a SETTINGS_SECTIONS anchor).
  "palette.settings.team": "Team",
  "palette.settings.team.es": "Equipo",
  "palette.settings.clientAccess": "Client access",
  "palette.settings.sendingAddress": "Sending address",
  "palette.settings.customFields": "Custom fields",
  "palette.settings.customValues": "Custom values",
  "palette.settings.alertPhone": "Alert texts",
  "palette.settings.billing": "Billing",
  "palette.settings.branding": "Branding",
  "palette.settings.weeklyReport": "Weekly report",
  "palette.settings.website": "Website",
  "palette.settings.requiredDocuments": "Required documents",
  "palette.settings.requiredDocuments.es": "Documentos requeridos",

  // ── /styleguide ────────────────────────────────────────────────────────
  "styleguide.title": "Style guide",
  "styleguide.body":
    "Every component this app draws, in the theme you're looking at right now. Switch themes with the toggle to check both.",
  // Mis preferencias (F-096, Task 6): the choice-tiles demo section title.
  "styleguide.choiceTiles": "Choice tiles",
  "styleguide.choiceTiles.es": "Opciones en mosaico",
  "styleguide.toasts": "Toasts",
  "styleguide.toasts.es": "Avisos emergentes",
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
  "website.link.testing": "Testing…",
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
  "website.link.unlinkType": "Type {domain} to confirm.",
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
  "work.title.es": "Pendientes",
  "work.empty": "Nothing needs you right now.",
  "work.empty.es": "No hay nada que necesite su atención en este momento.",
  "work.empty.body":
    "Tasks you create, contacts waiting on a reply, and jobs nobody has confirmed happened will show up here.",
  "work.empty.body.es":
    "Las tareas que usted cree, los contactos que esperan una respuesta y los trabajos que nadie ha confirmado aparecerán aquí.",
  "work.bucket.overdue": "Overdue",
  "work.bucket.overdue.es": "Atrasado",
  "work.bucket.today": "Today",
  "work.bucket.today.es": "Hoy",
  "work.bucket.waiting": "Waiting",
  "work.bucket.waiting.es": "En espera",
  "work.conversation": "Reply to {name}",
  "work.conversation.es": "Responder a {name}",
  "work.booking": "Did this job happen?",
  "work.booking.es": "¿Se realizó este trabajo?",
  "work.notNow": "Not now",
  "work.notNow.es": "Ahora no",
  "work.done": "Done",
  "work.done.es": "Hecho",
  "work.booking.completed": "It happened",
  "work.booking.completed.es": "Se realizó",
  "work.booking.noShow": "They didn't show",
  // The Calendar's own status word for the same write (calendar.bookings.status.no_show.es),
  // so the two screens never word one outcome two ways. "Se realizó" above stays: it answers
  // the row's own question, "¿Se realizó este trabajo?".
  "work.booking.noShow.es": "No llegó",
  // Task 4's toasts for the four buttons above. One shared failure string —
  // every action here fails the same honest way (try again in a moment) —
  // and the booking close-out's OWN failure copy is never used: it passes
  // through whatever `setBookingStatusAction` (the calendar screen's own,
  // reused action) already returns, so the two screens never say two
  // different things about the same write.
  "work.done.toast": "Marked done.",
  "work.done.toast.es": "Marcado como hecho.",
  "work.notNow.toast": "Moved to tomorrow.",
  "work.notNow.toast.es": "Lo pasamos a mañana.",
  // "Not now" on the zone-degrade path creates the task with no due date —
  // nothing actually moved to tomorrow, so that toast would be a lie here.
  "work.notNow.toastNoDate": "Added to your to-do list.",
  "work.notNow.toastNoDate.es": "Agregado a su lista de pendientes.",
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
  // Each names the status the Calendar then shows (calendar.bookings.status.*.es), in its own words.
  "work.booking.completed.toast.es": "La cita quedó como “Terminada”. Es posible que se envíe una solicitud de reseña.",
  "work.booking.noShow.toast": "Marked as a no-show. A follow-up message may go out.",
  "work.booking.noShow.toast.es": "La cita quedó como “No llegó”. Es posible que se envíe un mensaje de seguimiento.",
  "work.actionFailed": "Couldn't update that just now. Try again in a moment.",
  // The To do's actions return this by key (errorKey); the client renders it in the reader's language.
  "work.actionFailed.es": "No se pudo actualizar ahora. Vuelva a intentarlo en un momento.",
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
  // F-006 plan Task 2: the dashboard's own row into the duplicates list (contacts.duplicates.*,
  // below), same compact-link convention as work.row.* above.
  "work.duplicates": "{count} possible duplicate customers to check",
  "work.duplicates.es": "{count} posibles clientes duplicados por revisar",
  "work.duplicatesOne": "1 possible duplicate customer to check",
  "work.duplicatesOne.es": "1 posible cliente duplicado por revisar",

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
  // Item 8b-2 (design review minor 6): the agency section's account heading, inside its lang="es".
  "work.agency.unbranded.es": "Cuenta sin nombre",

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
  // Only the To do page passes a locale today (F-085 follow-ups); the
  // zone.guessed.* sentences below have Spanish twins since 2026-10-28.
  "zone.note.es": "Las horas se muestran en {zone}",

  // Shown ONLY when `guessed` — i.e. the zone printed is not the account's
  // own. DESIGN.md rule 3: this marker is a WORD, a whole sentence of them,
  // never a colour. The tinted ground carries no meaning by itself.
  //
  // Split by SOURCE, not collapsed, because "we guessed" is not actionable
  // while "we used the agency's zone" names which setting is broken.
  "zone.guessed.agency":
    "This company has no timezone of its own, so times use the agency's.",
  "zone.guessed.agency.es":
    "Esta empresa no tiene zona horaria propia, así que las horas usan la de la agencia.",
  "zone.guessed.fallback":
    "Neither this company nor the agency has a usable timezone, so times use UTC.",
  "zone.guessed.fallback.es":
    "Ni esta empresa ni la agencia tienen una zona horaria válida, así que las horas usan UTC.",
  // D-076: this used to be a Link to Settings ("Set it in Settings"),
  // agency-only (`requireAgencyOnlyAccountAccess`) so a client following it
  // would have been redirected straight back to their own dashboard — but
  // Settings has no timezone field at all, and never has: the only zone
  // input anywhere in the product is the "Add company" dialog, and only at
  // creation. A dead link to a page with nothing to fix is worse than no
  // link, the same reasoning that already kept the CLIENT reader off one —
  // this string just hadn't caught up to its own sibling's rule. Plain
  // text now, naming the real constraint instead of a destination.
  "zone.guessed.fix": "There's no Settings field for this yet — a company's timezone is set only when its account is created.",
  "zone.guessed.fix.es": "Todavía no hay un campo para esto en Ajustes: la zona horaria de una empresa solo se fija al crear su cuenta.",
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
  "zone.guessed.client.es":
    "Su zona horaria necesita corregirse, así que las horas se muestran en otra zona. Pídale a la persona que administra su cuenta que lo corrija.",
  // Review of #225 (blueprints): an ACCOUNT-LESS screen's `renderZone(undefined)`
  // always answers `source: "agency"` when the agency's own zone is usable —
  // that is the EXPECTED source there, not a degraded one, so `ZoneNote`'s
  // `accountless` prop never shows `zone.guessed.agency` ("this company has
  // no timezone of its own") for it; there is no company on the screen to
  // make that sentence true. This one sentence covers the one case that is
  // still worth a warning on such a screen: even the agency's own zone was
  // unusable. Never "this company" (there is none here).
  "zone.guessed.accountless.fallback":
    "The agency has no usable timezone either, so times use UTC.",
  "zone.guessed.accountless.fallback.es":
    "La agencia tampoco tiene una zona horaria válida, así que las horas usan UTC.",

  // ── Screened calls (2026-09-18) ────────────────────────────────────────
  // A refused call used to leave no trace but a log line. These screens are
  // agency-only: a client never sees them, so the voice is an operator's,
  // not a business owner's.
  "nav.screened": "Screened calls",
  // Task 6 (Spanish-runtime lane). Agency-only (comment above) — under the
  // owner's operator-stays-English rule (DESIGN.md, 2026-10-06) this never
  // actually renders today, since every caller who can see this item is an
  // operator. Added anyway for catalogue completeness, matching every
  // other nav.* key.
  "nav.screened.es": "Llamadas filtradas",
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
  "screened.reason.billing-paused": "Account paused (billing)",
  "screened.reason.plan-no-voice": "Plan has no receptionist",
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
  "billing.card.noStripe": "Stripe isn't connected on this site, so billing can't change here. The Plans page says why.",
  "billing.card.noWebhook": "Stripe's webhook isn't set up on this site yet, so billing links are off. The Stripe billing runbook says how to set it up.",
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
  "billing.link.copyFailed": "Your browser didn't let us copy it. Here's the link to copy yourself:",
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
  "billing.comp.stoppedLinkOpen": "No longer complimentary. The billing link you sent is still open, so they can still pay with it.",
  "billing.error.noStripe": "Stripe isn't connected here, so billing can't change. The Plans page says why.",
  "billing.error.noWebhook": "Stripe's webhook isn't set up on this site yet, so billing links can't be sent. The Stripe billing runbook says how to set it up.",
  "billing.error.noOrigin": "This deployment doesn't know its own web address (APP_ORIGIN), so no link can be made.",
  "billing.error.plan": "Pick an active plan.",
  "billing.error.email": "Enter one email address.",
  "billing.error.alreadySubscribed": "This client already has a subscription. Use Change plan instead.",
  "billing.error.checkoutFinished": "This client already finished checkout. Their plan shows here within a minute.",
  "billing.error.alreadyBilled": "This client is already on a plan.",
  "billing.error.stripeFailed": "Stripe didn't accept that. Nothing was charged. Try again in a minute.",
  "billing.error.subscriptionEdited": "This client's subscription was changed in Stripe directly, so the plan can't be switched here.",
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
  "billing.banner.client.es": "Su pago no se completó. Actualice su tarjeta para que las automatizaciones sigan funcionando.",
  "billing.banner.clientAction": "Go to Billing",
  "billing.banner.clientAction.es": "Ir a Facturación",
  "billing.banner.agency": "This client's last payment didn't go through.",
  "billing.banner.agency.es": "El último pago de este cliente no se completó.",
  "billing.banner.agencyAction": "See billing",
  "billing.banner.agencyAction.es": "Ver facturación",
  // M7a PR-4: the non-payment pause. The client banner (every page, Owner/
  // Staff/Technician), the client Billing page's own line, the agency's
  // Billing card (pause state + Lift pause + the nightly reconciliation
  // result) and the agency's own work-queue banner lines. The banner's
  // sentence never names a phone or promises a forward (M3): it stays true
  // whether or not the account has a transfer number, and on every day of
  // the pause, because forwarding itself stops after 30 days (I7).
  "billing.paused.client.payment": "Your account is paused because a payment didn't go through. Your receptionist isn't answering calls, texts to your customers are stopped, automations are waiting, and nothing here can be changed until it's paid.",
  "billing.paused.client.payment.es": "Su cuenta está en pausa porque un pago no se completó. Su recepcionista no está contestando llamadas, los mensajes a sus clientes están detenidos, las automatizaciones están en espera y aquí no se puede cambiar nada hasta que se pague.",
  "billing.paused.client.ended": "Your plan has ended, so your account is paused. Your receptionist isn't answering calls, texts to your customers are stopped, automations are waiting, and nothing here can be changed.",
  "billing.paused.client.ended.es": "Su plan terminó, así que su cuenta está en pausa. Su recepcionista no está contestando llamadas, los mensajes a sus clientes están detenidos, las automatizaciones están en espera y aquí no se puede cambiar nada.",
  "billing.paused.client.action": "Go to Billing",
  "billing.paused.client.action.es": "Ir a Facturación",
  "billing.paused.client.staff": "The account owner can turn everything back on from the Billing page.",
  "billing.paused.client.staff.es": "El dueño de la cuenta puede volver a activar todo desde la página de Facturación.",
  "billing.paused.agency": "This client is paused: the receptionist isn't answering, texts to their customers are stopped, automations are waiting, and their dashboard is read-only.",
  "billing.paused.agency.es": "Este cliente está en pausa: la recepcionista no está contestando, los mensajes a sus clientes están detenidos, las automatizaciones están en espera y su panel es de solo lectura.",
  "billing.paused.agencyAction": "See billing",
  "billing.paused.agencyAction.es": "Ver facturación",
  "billing.page.paused.payment": "Your account is paused until the payment goes through. Update your card with the button below to turn everything back on.",
  "billing.page.paused.payment.es": "Su cuenta está en pausa hasta que se complete el pago. Actualice su tarjeta con el botón de abajo para volver a activar todo.",
  "billing.page.paused.ended": "Your plan has ended, so your account is paused. To start again, email {email}.",
  "billing.page.paused.ended.es": "Su plan terminó, así que su cuenta está en pausa. Para volver a empezar, escriba a {email}.",
  "billing.page.paused.endedNoContact": "Your plan has ended, so your account is paused. To start again, contact the team that set up your account.",
  "billing.page.paused.endedNoContact.es": "Su plan terminó, así que su cuenta está en pausa. Para volver a empezar, comuníquese con el equipo que configuró su cuenta.",
  "billing.card.pausedPayment": "Paused since {date}: the payment failed on {failed}.",
  "billing.card.pausedPayment.es": "En pausa desde el {date}: el pago falló el {failed}.",
  "billing.card.pausedEnded": "Paused since {date}: the plan ended.",
  "billing.card.pausedEnded.es": "En pausa desde el {date}: el plan terminó.",
  "billing.card.noForward": "Calls are no longer forwarded: the account has been paused for over 30 days.",
  "billing.card.noForward.es": "Las llamadas ya no se desvían: la cuenta lleva más de 30 días en pausa.",
  "billing.card.pauseOff": "Pausing is switched off for this app, so this pause changes nothing.",
  "billing.card.pauseOff.es": "La pausa está desactivada en esta aplicación, así que esta pausa no cambia nada.",
  "billing.card.lifted": "Pause lifted {date}.",
  "billing.card.lifted.es": "Pausa quitada el {date}.",
  "billing.card.liftPause": "Lift pause",
  "billing.card.liftPause.es": "Quitar la pausa",
  "billing.card.liftPauseHelp": "Turns calls, texts and automations back on now. It stays lifted until they pay or another payment fails.",
  "billing.card.liftPauseHelp.es": "Vuelve a activar llamadas, mensajes y automatizaciones ahora. Sigue así hasta que paguen o falle otro pago.",
  "billing.card.liftedToast": "Pause lifted.",
  "billing.card.liftedToast.es": "Pausa quitada.",
  "billing.card.repausedToast": "Paused again.",
  "billing.card.repausedToast.es": "En pausa de nuevo.",
  "billing.card.reconcile.title": "Usage doesn't match Stripe",
  "billing.card.reconcile.title.es": "El uso no coincide con Stripe",
  "billing.card.reconcile.line": "{meter}: Stripe counts {stripe}, BIS counts {bis}. Checked {when}.",
  "billing.card.reconcile.line.es": "{meter}: Stripe cuenta {stripe}, BIS cuenta {bis}. Revisado el {when}.",
  "billing.card.reconcile.help": "Check this client's invoice in Stripe before it's finalized. The billing runbook says how.",
  "billing.card.reconcile.help.es": "Revise la factura de este cliente en Stripe antes de que se cierre. La guía de facturación explica cómo.",
  "billing.card.reconcile.meter.voice_minutes": "Call minutes",
  "billing.card.reconcile.meter.voice_minutes.es": "Minutos de llamadas",
  "billing.card.reconcile.meter.sms": "Texts",
  "billing.card.reconcile.meter.sms.es": "Mensajes de texto",
  "billing.card.reconcile.meter.ai_chats": "Website chats",
  "billing.card.reconcile.meter.ai_chats.es": "Chats del sitio web",
  // The reconciliation read failed (design review I2): said in place of the
  // mismatch block. An agency surface, but billing.* is not an agency-only
  // prefix, so the catalogue parity gate needs its twin.
  "billing.card.reconcile.unavailable": "Couldn't check usage against Stripe just now.",
  "billing.card.reconcile.unavailable.es": "No se pudo comparar el uso con Stripe en este momento.",
  "billing.error.notPaused": "This account isn't paused any more. Refresh to see its billing.",
  "billing.error.notPaused.es": "Esta cuenta ya no está en pausa. Actualice la página para ver su facturación.",
  "billing.error.cannotRepause": "This account's billing changed, so it can't be paused again from here. Refresh to see it.",
  "billing.error.cannotRepause.es": "La facturación de esta cuenta cambió, así que no se puede volver a pausar desde aquí. Actualice la página para verla.",
  // Agency-only (work.agency. prefix): the work-queue billing banner lines
  // (G13). English only — no Spanish twin required (ratchet-scan.ts's
  // AGENCY_ONLY_KEY_PREFIXES).
  "work.agency.billing.paymentFailed": "Payment failed:",
  "work.agency.billing.paused": "Paused:",
  "work.agency.billing.pausedNoForward": "Paused 30+ days, calls are no longer forwarded:",
  "work.agency.billing.mismatch": "Usage doesn't match Stripe:",
  "work.agency.billing.more": "and {n} more",
  "work.agency.billing.unchecked": "Couldn't check usage against Stripe just now.",
  "billing.done.success.title": "You're all set",
  "billing.done.success.body": "Your plan starts as soon as your payment is confirmed, usually within a minute. You can close this tab.",
  "billing.done.cancelled.title": "Checkout wasn't finished",
  "billing.done.cancelled.body": "Nothing was charged. Use the link you were sent to try again.",

  // Consent chain PR-3: the footer every customer email carries (spec §4.3),
  // in the email's language. The link text is the second key.
  "email.unsubscribe.lead.en": "Don't want these emails?",
  "email.unsubscribe.link.en": "Unsubscribe",
  "email.unsubscribe.lead.es": "¿No quiere recibir estos correos?",
  "email.unsubscribe.link.es": "Cancelar suscripción",
  // The public /u/[token] page (spec §6). English and Spanish stacked: the
  // token carries no language. {Business} is the brand name, or the
  // business/el negocio when it is blank (always, for a bad link: a token
  // that does not open names no business). Decision Q1: the page asks, and
  // its one primary button records; decision P2: the button says "Stop
  // emails", as the title asks.
  "unsubscribe.pageTitle": "Email preferences",
  "unsubscribe.confirm.en": "Stop emails from {Business}?",
  "unsubscribe.confirm.es": "¿Dejar de recibir correos de {Business}?",
  "unsubscribe.confirmBody.en": "{Business} will stop sending you automated emails. You'll still get a confirmation when you book or ask for something.",
  "unsubscribe.confirmBody.es": "{Business} dejará de enviarle correos automáticos. Si reserva o pide algo, sí recibirá la confirmación.",
  "unsubscribe.button": "Stop emails / Dejar de recibir correos",
  "unsubscribe.done.en": "You're unsubscribed. {Business} won't send you any more automated emails. You'll still get a confirmation when you book or ask for something.",
  "unsubscribe.done.es": "Listo. {Business} ya no le enviará correos automáticos. Si reserva o pide algo, sí recibirá la confirmación.",
  "unsubscribe.resubscribe": "Resubscribe / Volver a suscribirme",
  "unsubscribe.resubscribed.en": "You'll get emails from {Business} again.",
  "unsubscribe.resubscribed.es": "Volverá a recibir correos de {Business}.",
  "unsubscribe.badLink.en": "This unsubscribe link doesn't work. Contact {Business} directly and ask them to stop.",
  "unsubscribe.badLink.es": "Este enlace no funciona. Comuníquese directamente con {Business} y pida que dejen de escribirle.",
  "unsubscribe.failed.en": "Something went wrong on our side. Try the link again in a few minutes.",
  "unsubscribe.failed.es": "Algo falló de nuestro lado. Vuelva a abrir el enlace en unos minutos.",
  "unsubscribe.business.en": "the business",
  "unsubscribe.business.es": "el negocio",
  "unsubscribe.poweredBy": "Powered by BIS",

  // Staff and roles (spec §8): the Team card, on the client Owner's /team
  // page and under the agency's Client access switch. Every key has its
  // ".es" twin, usted register. The error keys (team.full ... team.revoke.failed)
  // ARE the codes team/actions.ts returns, so a code is its own message key;
  // team-card.test.ts reads the TeamError union from actions.ts and fails on
  // a code with no sentence or no twin. Role words: Dueño / Empleado.
  "team.title": "Team",
  "team.title.es": "Equipo",
  "team.body": "The people who can sign in to this company's account.",
  "team.body.es": "Las personas que pueden entrar a la cuenta de esta empresa.",
  // The /team route's loading skeleton, read by a screen reader while the
  // page streams (team/loading.tsx). Through the catalogue for the i18n
  // ratchet (merge with main, #234): a raw aria-label there counted 1 > 0.
  "team.loading": "Loading the team",
  "team.loading.es": "Cargando el equipo",
  "team.page.subtitle": "Invite the people who work with you, and choose what each one can do.",
  "team.page.subtitle.es": "Invite a las personas que trabajan con usted y elija qué puede hacer cada una.",
  // The honest limit (spec §4): hiding Export is friction, not a wall.
  "team.ownerHelp": "Staff can see every contact so they can do their work. Exporting and deleting contacts is for Owners only. Anyone who can see a contact can still write it down, so invite only people you trust with your customer list.",
  "team.ownerHelp.es": "Los empleados pueden ver todos los contactos para hacer su trabajo. Solo los dueños pueden exportar o borrar contactos. Quien puede ver un contacto también puede anotarlo, así que invite solo a personas de confianza.",
  "team.role.owner": "Owner",
  "team.role.owner.es": "Dueño",
  "team.role.staff": "Staff",
  "team.role.staff.es": "Empleado",
  "team.role.technician": "Technician",
  "team.role.technician.es": "Técnico",
  "team.roleHelp.technician": "Sees only the customers you assign to them.",
  "team.roleHelp.technician.es": "Solo ve los clientes que usted le asigne.",
  "team.status.active": "Active",
  "team.status.active.es": "Activo",
  "team.status.invited": "Invited",
  "team.status.invited.es": "Invitado",
  // A language is named in its own language in both catalogues, the way
  // every language picker does it.
  "team.languageName.english": "English",
  "team.languageName.english.es": "English",
  "team.languageName.spanish": "Español",
  "team.languageName.spanish.es": "Español",
  "team.roleFor": "Role for {name}",
  "team.roleFor.es": "Rol de {name}",
  "team.languageFor": "Language for {name}",
  "team.languageFor.es": "Idioma de {name}",
  "team.remove": "Remove",
  "team.remove.es": "Quitar",
  "team.removeName": "Remove {name}",
  "team.removeName.es": "Quitar a {name}",
  "team.revoke": "Cancel invitation",
  "team.revoke.es": "Cancelar invitación",
  "team.revokeFor": "Cancel the invitation for {email}",
  "team.revokeFor.es": "Cancelar la invitación de {email}",
  "team.invite": "Invite someone",
  "team.invite.es": "Invitar a alguien",
  "team.invite.title": "Invite someone to the team",
  "team.invite.title.es": "Invitar a alguien al equipo",
  "team.invite.body": "They'll get an email with a link to sign in.",
  "team.invite.body.es": "Le llegará un correo con un enlace para entrar.",
  "team.invite.email": "Email address",
  "team.invite.email.es": "Correo electrónico",
  "team.invite.role": "Role",
  "team.invite.role.es": "Rol",
  "team.invite.language": "Language",
  "team.invite.language.es": "Idioma",
  "team.invite.send": "Send invitation",
  "team.invite.send.es": "Enviar invitación",
  "team.invite.sending": "Sending…",
  "team.invite.sending.es": "Enviando…",
  "team.invite.sent": "Invitation sent to {email}.",
  "team.invite.sent.es": "Invitación enviada a {email}.",
  "team.room.many": "Room for {count} more people",
  "team.room.many.es": "Hay espacio para {count} personas más",
  "team.room.one": "Room for 1 more person",
  "team.room.one.es": "Hay espacio para 1 persona más",
  "team.empty": "Just you so far. Invite the people who answer your phones and run your jobs.",
  "team.empty.es": "Por ahora solo está usted. Invite a las personas que contestan sus llamadas y hacen sus trabajos.",
  // The agency is never on the list, so "just you" would be false for it.
  "team.empty.agency": "Nobody at this company can sign in yet. Invite the people who answer their phones and run their jobs.",
  "team.empty.agency.es": "Nadie de esta empresa puede entrar todavía. Invite a las personas que contestan sus llamadas y hacen sus trabajos.",
  "team.clerkUnavailable": "We couldn't reach the sign-in service, so invitations aren't shown. Your team list is below.",
  "team.clerkUnavailable.es": "No pudimos comunicarnos con el servicio de inicio de sesión, así que no se muestran las invitaciones. Su lista de equipo está abajo.",
  // The agency on /team while client access is off (spec §8). Only the agency
  // can land there, and Settings is where the switch lives.
  "team.accessOffNote": "Client access is off for this company, so nobody can sign in and nobody can be invited. Turn it on in Settings to manage the team.",
  "team.accessOffNote.es": "El acceso del cliente está desactivado para esta empresa, así que nadie puede entrar ni recibir una invitación. Actívelo en Ajustes para administrar el equipo.",
  "team.loadFailed": "We couldn't load the team just now. Refresh the page to try again.",
  "team.loadFailed.es": "No pudimos cargar el equipo en este momento. Actualice la página para intentarlo de nuevo.",
  "team.role.changed": "{name} is now {role}.",
  "team.role.changed.es": "Nuevo rol de {name}: {role}.",
  "team.language.changed": "{name}'s language is now {language}.",
  "team.language.changed.es": "El idioma de {name} ahora es {language}.",
  "team.removed": "{name} was removed from the team.",
  "team.removed.es": "Se quitó a {name} del equipo.",
  "team.revoked": "The invitation for {email} was cancelled.",
  "team.revoked.es": "Se canceló la invitación de {email}.",
  "team.undone.remove": "{name} is back on the team.",
  "team.undone.remove.es": "{name} volvió al equipo.",
  "team.undone.revoke": "Invitation sent again to {email}. They'll get a new email.",
  "team.undone.revoke.es": "Invitación enviada de nuevo a {email}. Le llegará un correo nuevo.",
  // The error codes team/actions.ts returns.
  "team.full": "Your team is full. Ask BIS to make room.",
  "team.full.es": "Su equipo está completo. Pídale a BIS que haga espacio.",
  // The agency raises the cap by hand (decision 33), so it is never told to ask itself.
  "team.full.agency": "This team is full. Raise the company's login limit to make room.",
  "team.full.agency.es": "Este equipo está completo. Suba el límite de usuarios de la empresa para hacer espacio.",
  "team.accessOff": "Turn client access on before inviting anyone.",
  "team.accessOff.es": "Active el acceso del cliente antes de invitar a alguien.",
  "team.lastOwner": "Every team needs at least one Owner. Make someone else an Owner first.",
  "team.lastOwner.es": "Todo equipo necesita al menos un dueño. Primero haga dueño a otra persona.",
  "team.changed": "The team changed since this page opened. Refresh and try again.",
  "team.changed.es": "El equipo cambió desde que abrió esta página. Actualice la página e intente de nuevo.",
  "team.invite.badEmail": "That email address doesn't look right. Check it and try again.",
  "team.invite.badEmail.es": "Ese correo no parece correcto. Revíselo e intente de nuevo.",
  "team.invite.alreadyInvited": "That person already has an invitation waiting.",
  "team.invite.alreadyInvited.es": "Esa persona ya tiene una invitación pendiente.",
  "team.invite.alreadyMember": "That person is already on the team.",
  "team.invite.alreadyMember.es": "Esa persona ya está en el equipo.",
  "team.invite.failed": "The invitation didn't go out. Try again in a minute.",
  "team.invite.failed.es": "La invitación no se envió. Intente de nuevo en un minuto.",
  "team.role.failed": "The role didn't change. Try again in a minute.",
  "team.role.failed.es": "El rol no cambió. Intente de nuevo en un minuto.",
  "team.remove.failed": "That person wasn't removed. Try again in a minute.",
  "team.remove.failed.es": "No se pudo quitar a esa persona. Intente de nuevo en un minuto.",
  "team.undo.failed": "We couldn't undo that. Invite them again if you need them back.",
  "team.undo.failed.es": "No pudimos deshacerlo. Si necesita que regrese, vuelva a enviarle una invitación.",
  "team.undo.expired": "It's too late to undo that. Invite them again if you need them back.",
  "team.undo.expired.es": "Ya es tarde para deshacerlo. Si necesita que regrese, vuelva a enviarle una invitación.",
  "team.revoke.failed": "The invitation wasn't cancelled. Try again in a minute.",
  "team.revoke.failed.es": "No se pudo cancelar la invitación. Intente de nuevo en un minuto.",
  // ── assign.* — Mine / Unassigned and the "Assigned to" field (F-085 part 1,
  // spec §9). The AssignError codes (contacts/actions.ts) are keys here.
  "assign.filter.label": "Show",
  "assign.filter.label.es": "Mostrar",
  "assign.filter.all": "All",
  "assign.filter.all.es": "Todo",
  "assign.filter.mine": "Mine",
  "assign.filter.mine.es": "A mi cargo",
  "assign.unassigned": "Unassigned",
  "assign.unassigned.es": "Sin asignar",
  "assign.field.label": "Assigned to",
  "assign.field.label.es": "Responsable",
  // A Technician's own customer, read-only: RLS (0068) shows them only the
  // customers that are theirs, and their page reads no team to name them by.
  "assign.you": "You",
  "assign.you.es": "Usted",
  // A holder the team read does not list (removed since the page loaded).
  "assign.someone": "Someone on the team",
  "assign.someone.es": "Alguien del equipo",
  "assign.done": "Assigned to {name}.",
  "assign.done.es": "Asignado a {name}.",
  "assign.doneUnassigned": "Now unassigned.",
  "assign.doneUnassigned.es": "Ahora sin asignar.",
  "assign.undo": "Undo",
  "assign.undo.es": "Deshacer",
  "assign.bulk": "Assign to…",
  "assign.bulk.es": "Asignar a…",
  "assign.bulkDone": "{count} customers assigned to {name}.",
  "assign.bulkDone.es": "{count} clientes asignados a {name}.",
  "assign.bulkDoneOne": "1 customer assigned to {name}.",
  "assign.bulkDoneOne.es": "1 cliente asignado a {name}.",
  "assign.bulkUnassigned": "{count} customers are now unassigned.",
  "assign.bulkUnassigned.es": "{count} clientes ahora están sin asignar.",
  "assign.bulkUnassignedOne": "1 customer is now unassigned.",
  "assign.bulkUnassignedOne.es": "1 cliente ahora está sin asignar.",
  "assign.refused": "You can't change that customer.",
  "assign.refused.es": "No puede cambiar ese cliente.",
  "assign.failed": "That didn't save. Try again in a minute.",
  "assign.failed.es": "No se guardó. Intente de nuevo en un minuto.",
  "assign.customerFirst": "Assign the customer to them first.",
  "assign.customerFirst.es": "Primero asígnele el cliente.",
  // An Undo that found the task already handed on by someone else (final review M7).
  "assign.changed": "Someone else changed this since. Their change stands.",
  "assign.changed.es": "Alguien más lo cambió después. Se mantiene su cambio.",
  "assign.empty.mine": "Nothing assigned to you yet.",
  "assign.empty.mine.es": "Todavía no tiene nada asignado.",
  "assign.empty.unassigned": "Every customer has someone. New leads from calls, forms and chat land here first.",
  "assign.empty.unassigned.es": "Cada cliente tiene a alguien. Los clientes nuevos de llamadas, formularios y chat llegan aquí primero.",
  // To do's Unassigned mixes to-dos (their own holder) with calls and
  // bookings (the customer's), so "every customer has someone" would not fit.
  "assign.empty.unassignedWork": "Everything on this list has someone. Work for a customer nobody has yet lands here first.",
  "assign.empty.unassignedWork.es": "Todo en esta lista tiene a alguien. El trabajo de un cliente sin responsable llega aquí primero.",
  "assign.empty.technician": "No customers yet. When your team gives you a customer, they show up here.",
  "assign.empty.technician.es": "Todavía no tiene clientes. Cuando su equipo le asigne uno, aparecerá aquí.",
  // Relationships between customers (relationships spec §6): what a refused write says.
  "relationships.error.duplicate": "That relationship is already there.",
  "relationships.error.duplicate.es": "Esa relación ya está registrada.",
  "relationships.error.refused": "You can't change that customer.",
  "relationships.error.refused.es": "No puede cambiar ese cliente.",
  "relationships.error.self": "Pick someone else.",
  "relationships.error.self.es": "Elija a otra persona.",
  "relationships.error.gone": "Someone changed or removed this. Reload the page to see it.",
  "relationships.error.gone.es": "Alguien cambió o quitó esto. Vuelva a cargar la página para verlo.",
  "relationships.error.restore": "Couldn't put it back.",
  "relationships.error.restore.es": "No se pudo deshacer.",
  "relationships.error.invalid": "That doesn't look right. Check it and try again.",
  "relationships.error.invalid.es": "Algo no está bien. Revíselo e intente de nuevo.",
  "relationships.error.failed": "Couldn't save that. Try again.",
  "relationships.error.failed.es": "No se pudo guardar. Intente de nuevo.",
  // Relationships card and dialog (relationships spec §7).
  "relationships.title": "Related people",
  "relationships.title.es": "Personas relacionadas",
  "relationships.add": "Add a person",
  "relationships.add.es": "Agregar a una persona",
  "relationships.empty": "No related people yet. Add a parent, a spouse, a padrino or an emergency contact, and it shows on both records.",
  "relationships.empty.es": "Todavía no hay personas relacionadas. Agregue a la mamá o el papá, al esposo o la esposa, a un padrino o un contacto de emergencia, y aparecerá en los dos registros.",
  "relationships.loadFailed": "Couldn't load related people.",
  "relationships.loadFailed.es": "No se pudieron cargar las personas relacionadas.",
  "relationships.retry": "Try again",
  "relationships.retry.es": "Intentar de nuevo",
  "relationships.undo": "Undo",
  "relationships.undo.es": "Deshacer",
  "relationships.saved": "Saved.",
  "relationships.saved.es": "Guardado.",
  "relationships.removed": "Removed {name}.",
  "relationships.removed.es": "Se quitó a {name}.",
  "relationships.remove": "Remove {name}",
  "relationships.remove.es": "Quitar a {name}",
  "relationships.hiddenPerson": "someone not on your list",
  "relationships.hiddenPerson.es": "alguien que no está en su lista",
  "relationships.askTeam": "Ask your team to change this.",
  "relationships.askTeam.es": "Pídale a su equipo que lo cambie.",
  "relationships.noName": "(no name)",
  "relationships.noName.es": "(sin nombre)",
  "relationships.flag.canPickUp": "Can pick up",
  "relationships.flag.canPickUp.es": "Puede recoger",
  "relationships.flag.isEmergency": "Emergency contact",
  "relationships.flag.isEmergency.es": "Contacto de emergencia",
  "relationships.wordFor": "Word for {name}",
  "relationships.wordFor.es": "Palabra para {name}",
  "relationships.dialog.search": "Search your customers",
  "relationships.dialog.search.es": "Buscar entre sus clientes",
  "relationships.dialog.searchEmpty": "No one found. Add them as a new person.",
  "relationships.dialog.searchEmpty.es": "No se encontró a nadie. Agréguelo como persona nueva.",
  "relationships.dialog.searchFailed": "Search didn't work. Try again.",
  "relationships.dialog.searchFailed.es": "La búsqueda no funcionó. Intente de nuevo.",
  "relationships.dialog.newPerson": "New person",
  "relationships.dialog.newPerson.es": "Persona nueva",
  "relationships.dialog.findPerson": "Find a customer",
  "relationships.dialog.findPerson.es": "Buscar un cliente",
  "relationships.dialog.firstName": "First name",
  "relationships.dialog.firstName.es": "Nombre",
  "relationships.dialog.lastName": "Last name",
  "relationships.dialog.lastName.es": "Apellido",
  "relationships.dialog.phone": "Phone (optional)",
  "relationships.dialog.phone.es": "Teléfono (opcional)",
  "relationships.dialog.question": "Who is {name} to {customer}?",
  "relationships.dialog.question.es": "¿Quién es {name} para {customer}?",
  "relationships.dialog.thisPerson": "this person",
  "relationships.dialog.thisPerson.es": "esta persona",
  "relationships.dialog.pick": "Pick one",
  "relationships.dialog.pick.es": "Elija una",
  "relationships.dialog.otherLabel": "What are they?",
  "relationships.dialog.otherLabel.es": "¿Qué relación tienen?",
  "relationships.dialog.otherHint": "Don't put custody or court details here.",
  "relationships.dialog.otherHint.es": "No escriba aquí datos de custodia ni de juzgado.",
  "relationships.dialog.wordsFor": "{name} is",
  "relationships.dialog.wordsFor.es": "{name} es",
  "relationships.dialog.preview": "On {name}'s record",
  "relationships.dialog.preview.es": "En el registro de {name}",
  "relationships.dialog.submit": "Add",
  "relationships.dialog.submit.es": "Agregar",
  "relationships.dialog.cancel": "Cancel",
  "relationships.dialog.cancel.es": "Cancelar",
  // Task 4 review, finding 5: the two people already have a row, so the flag on it says the same thing.
  "relationships.dialog.flagOnRow": "Already on this record as “{row}”. Turn on “{flag}” there instead.",
  "relationships.dialog.flagOnRow.es": "Ya está en este registro como “{row}”. En vez de agregar otra relación, active “{flag}” ahí.",
  "relationships.dialog.flagAlreadyOn": "Already on this record as “{row}”, with “{flag}” on.",
  "relationships.dialog.flagAlreadyOn.es": "Ya está en este registro como “{row}”, con “{flag}” activado.",
  // After a "New person" add failed but the person was saved (final review item 7): only when
  // this add created them, never when it matched someone already saved.
  "relationships.dialog.personSaved": "{name} is saved as a customer. The relationship isn't added yet.",
  "relationships.dialog.personSaved.es": "Se guardó a {name} como cliente. La relación todavía no se agregó.",
  // Client groups (S-02 part 1): the Groups card on the drawer and the
  // contact page. NEVER "Company" (G4): that word names the BIS client. The
  // drawer and the page read m["…"] today; the twins are written anyway
  // (spec §8). The four error keys are the ones groups-actions.ts returns.
  "groups.title": "Groups",
  "groups.title.es": "Grupos",
  "groups.kind.household": "Household",
  "groups.kind.household.es": "Familia",
  "groups.kind.business": "Business customer",
  "groups.kind.business.es": "Cliente comercial",
  "groups.primary": "Main group",
  "groups.primary.es": "Grupo principal",
  "groups.makePrimary": "Make main",
  "groups.makePrimary.es": "Hacer principal",
  "groups.billing": "Pays the bills",
  "groups.billing.es": "Paga las cuentas",
  "groups.role": "Role",
  "groups.role.es": "Papel",
  "groups.rolePlaceholder": "Role, like Madre or Dueño",
  "groups.rolePlaceholder.es": "Papel, como Madre o Dueño",
  "groups.name": "Group name",
  "groups.name.es": "Nombre del grupo",
  // A blank rename, refused in the card. Not InlineField's `required` rule:
  // its message is the account rename's, which says "company" (G4).
  "groups.nameEmpty": "A group needs a name.",
  "groups.nameEmpty.es": "Un grupo necesita un nombre.",
  "groups.billingAddress": "Billing address",
  "groups.billingAddress.es": "Dirección de cobro",
  "groups.add": "Add to a group",
  "groups.add.es": "Agregar a un grupo",
  "groups.searchPlaceholder": "Search households and businesses",
  "groups.searchPlaceholder.es": "Buscar familias y negocios",
  // The search's own error line, inside the add box (it never crashes the card).
  "groups.searchFailed": "Couldn't search right now. You can still create one below.",
  "groups.searchFailed.es": "No se pudo buscar ahora. Todavía puede crear uno abajo.",
  "groups.createHousehold": "Create household “{name}”",
  "groups.createHousehold.es": "Crear familia “{name}”",
  "groups.createBusiness": "Create business customer “{name}”",
  "groups.createBusiness.es": "Crear cliente comercial “{name}”",
  "groups.added": "Added to {name}.",
  "groups.added.es": "Se agregó a {name}.",
  "groups.addedExisting": "Added to {name}, which was already on your list.",
  "groups.addedExisting.es": "Se agregó a {name}, que ya estaba en su lista.",
  "groups.remove": "Remove from this group",
  "groups.remove.es": "Quitar de este grupo",
  "groups.removed": "Removed from {name}.",
  "groups.removed.es": "Se quitó de {name}.",
  "groups.saved": "Saved.",
  "groups.saved.es": "Guardado.",
  "groups.empty": "Households and businesses this person belongs to show up here.",
  "groups.empty.es": "Las familias y negocios a los que pertenece esta persona aparecen aquí.",
  "groups.loadFailed": "Couldn't load groups.",
  "groups.loadFailed.es": "No se pudieron cargar los grupos.",
  "groups.retry": "Try again",
  "groups.retry.es": "Intentar de nuevo",
  "groups.refused": "You can't change that group.",
  "groups.refused.es": "No puede cambiar ese grupo.",
  "groups.failed": "That didn't save. Try again.",
  "groups.failed.es": "No se guardó. Intente de nuevo.",
  "groups.nameTaken": "There's already a business customer with that name.",
  "groups.nameTaken.es": "Ya hay un cliente comercial con ese nombre.",
  "groups.tooLong": "That's too long.",
  "groups.tooLong.es": "Es demasiado largo.",
  "groups.others": "Also in this group",
  "groups.others.es": "También en este grupo",
  // After the names the card shows, when a group has more members than it lists.
  "groups.othersMore": "and {count} more",
  "groups.othersMore.es": "y {count} más",
  // Properties and equipment (S-02 part B2): errors
  "places.refused": "You can't change that property.",
  "places.refused.es": "No puede cambiar esa propiedad.",
  "places.moveRefused": "Only an Owner or Staff can change who a property belongs to.",
  "places.moveRefused.es": "Solo el Dueño o un Empleado puede cambiar de quién es una propiedad.",
  "places.needOne": "Add an address, a landmark or how to get there.",
  "places.needOne.es": "Agregue una dirección, una referencia o cómo llegar.",
  "equipment.alreadyReplaced": "That unit was already replaced.",
  "equipment.alreadyReplaced.es": "Ese equipo ya se reemplazó.",
  "equipment.warrantyBeforeInstall": "The warranty can't end before the install date.",
  "equipment.warrantyBeforeInstall.es": "La garantía no puede terminar antes de la fecha de instalación.",
  "places.error.undoFailed": "Couldn't put it back.",
  "places.error.undoFailed.es": "No se pudo deshacer.",
  "places.error.invalid": "Check the details and try again.",
  "places.error.invalid.es": "Revise los datos e intente de nuevo.",
  "places.error.failed": "Couldn't save that. Try again.",
  "places.error.failed.es": "No se pudo guardar. Intente de nuevo.",
  // Properties (S-02 part B2): the words place-view.ts falls back to (spec §8's copy table).
  "places.untitled": "Property",
  "places.untitled.es": "Propiedad",
  "places.onlyPerson": "{name} only",
  "places.onlyPerson.es": "Solo de {name}",
  "places.sharedWith": "Shared with {group}",
  "places.sharedWith.es": "Compartida con {group}",
  // Properties (S-02 part B2): the card, its dialogs and its toasts (spec §7, §8).
  "places.title": "Properties",
  "places.title.es": "Propiedades",
  // The document vault, part 1 (S-07 + F-005; spec 2026-10-13-document-vault-design.md). Usted (Q5).
  "documents.title": "Documents",
  "documents.title.es": "Documentos",
  "documents.count": "{count} files",
  "documents.count.es": "{count} archivos",
  "documents.countOne": "{count} file",
  "documents.countOne.es": "{count} archivo",
  "documents.capped": "Showing the newest 200.",
  "documents.capped.es": "Se muestran los 200 más recientes.",
  "documents.upload": "Upload",
  "documents.upload.es": "Subir",
  "documents.takePhoto": "Take photo",
  "documents.takePhoto.es": "Tomar foto",
  "documents.empty.contact": "Contracts, IDs, photos and receipts for this customer are kept here. Upload a file or take a photo.",
  "documents.empty.contact.es": "Aquí se guardan los contratos, identificaciones, fotos y recibos de este cliente. Suba un archivo o tome una foto.",
  "documents.empty.household": "Contracts, IDs, photos and receipts for this household are kept here. Upload a file or take a photo.",
  "documents.empty.household.es": "Aquí se guardan los contratos, identificaciones, fotos y recibos de este hogar. Suba un archivo o tome una foto.",
  "documents.empty.business": "Contracts, IDs, photos and receipts for this business are kept here. Upload a file or take a photo.",
  "documents.empty.business.es": "Aquí se guardan los contratos, identificaciones, fotos y recibos de este negocio. Suba un archivo o tome una foto.",
  "documents.loadFailed": "Couldn't load documents.",
  "documents.loadFailed.es": "No se pudieron cargar los documentos.",
  "documents.category.id": "ID",
  "documents.category.id.es": "Identificación",
  "documents.category.contract": "Contract",
  "documents.category.contract.es": "Contrato",
  "documents.category.estimate": "Estimate or quote",
  "documents.category.estimate.es": "Presupuesto",
  "documents.category.invoice": "Invoice or receipt",
  "documents.category.invoice.es": "Factura o recibo",
  "documents.category.photo": "Photo",
  "documents.category.photo.es": "Foto",
  "documents.category.permit": "Permit or license",
  "documents.category.permit.es": "Permiso o licencia",
  "documents.category.insurance": "Insurance",
  "documents.category.insurance.es": "Seguro",
  "documents.category.warranty": "Warranty",
  "documents.category.warranty.es": "Garantía",
  "documents.category.other": "Other",
  "documents.category.other.es": "Otro",
  "documents.addedBy": "Added by {name} · {when}",
  "documents.addedBy.es": "Agregado por {name} · {when}",
  "documents.photoBy": "Photo taken by {name} · {when}",
  "documents.photoBy.es": "Foto tomada por {name} · {when}",
  "documents.expires.in": "Expires in {count} days",
  "documents.expires.in.es": "Vence en {count} días",
  "documents.expires.inOne": "Expires in {count} day",
  "documents.expires.inOne.es": "Vence en {count} día",
  "documents.expires.today": "Expires today",
  "documents.expires.today.es": "Vence hoy",
  "documents.expires.ago": "Expired {count} days ago",
  "documents.expires.ago.es": "Venció hace {count} días",
  "documents.expires.agoOne": "Expired {count} day ago",
  "documents.expires.agoOne.es": "Venció hace {count} día",
  "documents.ownersOnly": "Owners only",
  "documents.ownersOnly.es": "Solo dueños",
  "documents.menu": "More for {title}",
  "documents.menu.es": "Más opciones para {title}",
  "documents.open": "Open {title}",
  "documents.open.es": "Abrir {title}",
  "documents.field.title": "Name",
  "documents.field.title.es": "Nombre",
  "documents.field.category": "Category",
  "documents.field.category.es": "Categoría",
  "documents.field.expires": "Expires on",
  "documents.field.expires.es": "Vence el",
  "documents.makeOwnersOnly": "Make Owners only",
  "documents.makeOwnersOnly.es": "Hacer solo para dueños",
  "documents.makeTeam": "Let the team see it",
  "documents.makeTeam.es": "Dejar que el equipo lo vea",
  "documents.madeOwnersOnly": "{title} is now Owners only.",
  "documents.madeOwnersOnly.es": "{title} ahora es solo para dueños.",
  "documents.madeTeam": "The team can see {title} again.",
  "documents.madeTeam.es": "El equipo puede ver {title} de nuevo.",
  "documents.edit": "Edit details",
  "documents.edit.es": "Editar los datos",
  "documents.download": "Download",
  "documents.download.es": "Descargar",
  "documents.trash": "Move to trash",
  "documents.trash.es": "Mover a la papelera",
  "documents.trashed": "{title} moved to the trash.",
  "documents.trashed.es": "{title} se movió a la papelera.",
  "documents.restore": "Restore",
  "documents.restore.es": "Restaurar",
  "documents.restored": "{title} is back.",
  "documents.restored.es": "{title} se restauró.",
  "documents.trashList": "Trash ({count})",
  "documents.trashList.es": "Papelera ({count})",
  "documents.purgeIn": "Deleted for good in {count} days",
  "documents.purgeIn.es": "Se borra para siempre en {count} días",
  "documents.purgeInOne": "Deleted for good in {count} day",
  "documents.purgeInOne.es": "Se borra para siempre en {count} día",
  "documents.purgeToday": "Deleted for good today",
  "documents.purgeToday.es": "Se borra para siempre hoy",
  "documents.status.trashed": "In the trash",
  "documents.status.trashed.es": "En la papelera",
  "documents.undoChanged": "Someone changed it after you, so nothing was undone.",
  "documents.undoChanged.es": "Alguien lo cambió después de usted, así que no se deshizo nada.",
  "documents.error.failed": "Couldn't save that. Try again.",
  "documents.error.failed.es": "No se pudo guardar. Intente de nuevo.",
  "documents.error.refused": "You can't change that file.",
  "documents.error.refused.es": "No puede cambiar ese archivo.",
  "documents.error.ownersOnlyRole": "Only an Owner can choose who sees a file.",
  "documents.error.ownersOnlyRole.es": "Solo un dueño puede elegir quién ve un archivo.",
  "documents.error.tooLarge": "Too large: {size}. The limit is 25 MB.",
  "documents.error.tooLarge.es": "Demasiado grande: {size}. El límite es de 25 MB.",
  "documents.error.badType": "This kind of file can't be kept here. Use PDF, JPG, PNG, WebP, Word or Excel.",
  "documents.error.badType.es": "Este tipo de archivo no se puede guardar aquí. Use PDF, JPG, PNG, WebP, Word o Excel.",
  "documents.error.quota": "Your account's 5 GB is full. Delete files you no longer need, or contact BIS.",
  "documents.error.quota.es": "Los 5 GB de su cuenta están llenos. Borre los archivos que ya no necesite o comuníquese con BIS.",
  "documents.error.upload": "Couldn't upload. Try again.",
  "documents.error.upload.es": "No se pudo subir. Intente de nuevo.",
  "documents.error.tooMany": "Choose up to 10 files at a time.",
  "documents.error.tooMany.es": "Elija hasta 10 archivos a la vez.",
  "documents.error.busy": "Wait for these files to finish uploading, then add more.",
  "documents.error.busy.es": "Espere a que terminen de subir estos archivos y luego agregue más.",
  "documents.error.open": "Couldn't open this file. Try again.",
  "documents.error.open.es": "No se pudo abrir este archivo. Intente de nuevo.",
  "documents.progress.uploading": "Uploading {percent}%",
  "documents.progress.uploading.es": "Subiendo {percent}%",
  "documents.progress.checking": "Checking",
  "documents.progress.checking.es": "Revisando",
  "documents.retry": "Retry",
  "documents.retry.es": "Reintentar",
  "documents.cancel": "Cancel",
  "documents.cancel.es": "Cancelar",
  "documents.removeFile": "Remove {name} from the list",
  "documents.removeFile.es": "Quitar {name} de la lista",
  "documents.panel.ownersOnly": "Owners only: only Owners can see these files",
  "documents.panel.ownersOnly.es": "Solo dueños: solo los dueños pueden ver estos archivos",
  "documents.panel.expires": "Expires on (optional)",
  "documents.panel.expires.es": "Vence el (opcional)",
  "documents.viewer.noPreview": "This file opens in Word or Excel. Download it to see it.",
  "documents.viewer.noPreview.es": "Este archivo se abre en Word o Excel. Descárguelo para verlo.",
  "documents.you": "you",
  "documents.you.es": "usted",
  "documents.error.notFound": "We can't find this record anymore. Reload the page.",
  "documents.error.notFound.es": "Ya no encontramos este registro. Vuelva a cargar la página.",
  "documents.untitled": "Untitled file",
  "documents.untitled.es": "Archivo sin nombre",
  // S-07 part 1b: versions, Delete forever by typed name, the space-used line (plan 2026-10-14).
  "documents.error.fileNotFound": "We can't find this file anymore. Reload the page.",
  "documents.error.fileNotFound.es": "Ya no encontramos este archivo. Vuelva a cargar la página.",
  "documents.error.trashed": "This file is in the trash. Restore it first.",
  "documents.error.trashed.es": "Este archivo está en la papelera. Restáurelo primero.",
  "documents.newVersion": "Upload new version",
  "documents.newVersion.es": "Subir una versión nueva",
  "documents.versionAdded": "New version of {title} added.",
  "documents.versionAdded.es": "Se agregó una versión nueva de {title}.",
  "documents.version": "Version {n}",
  "documents.version.es": "Versión {n}",
  "documents.versions": "Versions",
  "documents.versions.es": "Versiones",
  "documents.versionLine": "Version {n} · {when}",
  "documents.versionLine.es": "Versión {n} · {when}",
  "documents.versionCurrent": "Current",
  "documents.versionCurrent.es": "Actual",
  "documents.downloadVersion": "Download version {n}",
  "documents.downloadVersion.es": "Descargar la versión {n}",
  "documents.deleteForever": "Delete forever",
  "documents.deleteForever.es": "Borrar para siempre",
  "documents.purge.body": "This deletes {title} and all of its versions for good. It can't be undone.",
  "documents.purge.body.es": "Esto borra {title} y todas sus versiones para siempre. No se puede deshacer.",
  "documents.purge.bodyOne": "This deletes {title} for good. It can't be undone.",
  "documents.purge.bodyOne.es": "Esto borra {title} para siempre. No se puede deshacer.",
  "documents.purge.label": "Type the file's name to confirm",
  "documents.purge.label.es": "Escriba el nombre del archivo para confirmar",
  "documents.purge.mismatch": "The name doesn't match. Type it exactly as shown.",
  "documents.purge.mismatch.es": "El nombre no coincide. Escríbalo tal como aparece.",
  "documents.purged": "{title} was deleted for good.",
  "documents.purged.es": "{title} se borró para siempre.",
  "documents.error.purgeUploading": "A new version of this file is still uploading. Try again later.",
  "documents.error.purgeUploading.es": "Todavía se está subiendo una versión nueva de este archivo. Intente de nuevo más tarde.",
  "documents.error.purgeRole": "Only an Owner can delete a file forever.",
  "documents.error.purgeRole.es": "Solo un dueño puede borrar un archivo para siempre.",
  "documents.error.purgeChanged": "Someone changed this file first, so it was not deleted.",
  "documents.error.purgeChanged.es": "Alguien cambió este archivo primero, así que no se borró.",
  "documents.error.purge": "Couldn't delete that file. Try again.",
  "documents.error.purge.es": "No se pudo borrar ese archivo. Intente de nuevo.",
  "documents.spaceUsed": "{used} of {quota} GB used",
  "documents.spaceUsed.es": "{used} de {quota} GB usados",
  "timeline.documentVersion": "uploaded a new version of {title}",
  "timeline.documentVersion.es": "subió una nueva versión de {title}",
  "documents.status.purging": "Being deleted",
  "documents.status.purging.es": "Se está borrando",
  // S-07 part 2a: virus scanning (plan 2026-10-15). Rule 3: each state is drawn as a dot AND these words.
  "documents.status.scanning": "Checking",
  "documents.status.scanning.es": "Revisando",
  "documents.status.scanSlow": "Taking longer than usual",
  "documents.status.scanSlow.es": "Tarda más de lo normal",
  "documents.status.virusRemoved": "Removed: it had a virus",
  "documents.status.virusRemoved.es": "Quitado: tenía un virus",
  "documents.status.unscannable": "Couldn't check this file",
  "documents.status.unscannable.es": "No se pudo revisar este archivo",
  "documents.viewer.scanning": "This file opens once it has been checked for viruses. That usually takes a few seconds.",
  "documents.viewer.scanning.es": "Este archivo se abre cuando termine la revisión de virus. Normalmente tarda unos segundos.",
  "documents.viewer.virusRemoved": "This file had a virus, so it was removed. Move it to the trash, or upload a new version.",
  "documents.viewer.virusRemoved.es": "Este archivo tenía un virus, así que se quitó. Muévalo a la papelera o suba una versión nueva.",
  "documents.viewer.unscannable": "We couldn't check this file for viruses, so it was removed. Upload it again.",
  "documents.viewer.unscannable.es": "No pudimos revisar este archivo, así que se quitó. Vuelva a subirlo.",
  "documents.error.scanning": "This file is still being checked. Try again in a moment.",
  "documents.error.scanning.es": "Este archivo todavía se está revisando. Intente de nuevo en un momento.",
  "documents.error.removed": "This file was removed and can't be opened.",
  "documents.error.removed.es": "Este archivo se quitó y no se puede abrir.",
  "timeline.documentRemoved": "removed {title}: it had a virus",
  "timeline.documentRemoved.es": "quitó {title}: tenía un virus",
  "timeline.documentUnscannable": "removed {title}: it couldn't be checked",
  "timeline.documentUnscannable.es": "quitó {title}: no se pudo revisar",
  // Owner ruling 2026-10-15: a password-protected file is removed AND the note says why.
  "documents.status.passwordRemoved": "Password-protected: remove the password and upload it again",
  "documents.status.passwordRemoved.es": "Tiene contraseña: quítela y vuelva a subirlo",
  "documents.viewer.passwordRemoved": "This file has a password, so we couldn't check it for viruses and it was removed. Remove the password and upload it again.",
  "documents.viewer.passwordRemoved.es": "Este archivo tiene contraseña, así que no pudimos revisarlo y se quitó. Quítele la contraseña y vuelva a subirlo.",
  // S-07 part 2b: customer upload links (plan 2026-10-15). Ask the customer for documents.
  "documents.request.open": "Ask the customer",
  "documents.request.open.es": "Pedir al cliente",
  "documents.request.title": "Ask {name} for documents",
  "documents.request.title.es": "Pedir documentos a {name}",
  "documents.request.what": "What do you need?",
  "documents.request.what.es": "¿Qué necesita?",
  "documents.request.otherNote": "What is it?",
  "documents.request.otherNote.es": "¿Qué es?",
  "documents.request.how": "How should it go?",
  "documents.request.how.es": "¿Cómo se lo enviamos?",
  "documents.request.channel.text": "Text",
  "documents.request.channel.text.es": "Mensaje de texto",
  "documents.request.channel.email": "Email",
  "documents.request.channel.email.es": "Correo",
  "documents.request.channel.link": "Copy link",
  "documents.request.channel.link.es": "Copiar enlace",
  "documents.request.textOff": "Texting isn't available for this customer.",
  "documents.request.textOff.es": "No se le pueden enviar mensajes de texto a este cliente.",
  "documents.request.emailOff": "There's no email address on file.",
  "documents.request.emailOff.es": "No hay un correo en el expediente.",
  "documents.request.send": "Send request",
  "documents.request.send.es": "Enviar pedido",
  "documents.request.createLink": "Create link",
  "documents.request.createLink.es": "Crear enlace",
  "documents.request.cancel": "Cancel",
  "documents.request.cancel.es": "Cancelar",
  "documents.request.pickOne": "Pick at least one document.",
  "documents.request.pickOne.es": "Elija al menos un documento.",
  "documents.request.noteNeeded": "Say what you need under Other.",
  "documents.request.noteNeeded.es": "Diga qué necesita en Otro.",
  "documents.request.sentText": "Request sent by text.",
  "documents.request.sentText.es": "Pedido enviado por mensaje de texto.",
  "documents.request.sentEmail": "Request sent by email.",
  "documents.request.sentEmail.es": "Pedido enviado por correo.",
  "documents.request.held": "Request saved. It goes out at {time}, after quiet hours.",
  "documents.request.held.es": "Pedido guardado. Sale a las {time}, después del horario de descanso.",
  "documents.request.linkCopied": "Link copied. It works for 7 days.",
  "documents.request.linkCopied.es": "Enlace copiado. Funciona por 7 días.",
  "documents.request.copyFailed": "Your browser didn't let us copy it. Here's the link to copy yourself:",
  "documents.request.copyFailed.es": "Su navegador no nos dejó copiarlo. Este es el enlace para copiarlo usted:",
  "documents.request.notSent": "Request saved, but not sent: {reason}. Copy the link instead.",
  "documents.request.notSent.es": "Pedido guardado, pero no se envió: {reason}. Copie el enlace en su lugar.",
  "documents.request.failed": "Couldn't create the request. Try again.",
  "documents.request.failed.es": "No se pudo crear el pedido. Intente de nuevo.",
  "documents.request.refused": "You can't change that request.",
  "documents.request.refused.es": "No puede cambiar ese pedido.",
  "documents.request.notOpen": "This request is no longer open.",
  "documents.request.notOpen.es": "Este pedido ya no está abierto.",
  "documents.request.reason.textsStopped": "they asked not to get texts",
  "documents.request.reason.textsStopped.es": "pidió no recibir mensajes de texto",
  "documents.request.reason.textsHeld": "texts to them are on hold while you check whether they asked to stop",
  "documents.request.reason.textsHeld.es": "los textos a esta persona están en pausa mientras revisa si pidió que se detuvieran",
  "documents.request.reason.noPhone": "there's no number we can text",
  "documents.request.reason.noPhone.es": "no hay un número para mensajes de texto",
  "documents.request.reason.textSetup": "texting isn't set up yet",
  "documents.request.reason.textSetup.es": "los mensajes de texto aún no están configurados",
  "documents.request.reason.noEmail": "there's no email address",
  "documents.request.reason.noEmail.es": "no hay un correo",
  "documents.request.reason.emailStopped": "they asked not to get these emails",
  "documents.request.reason.emailStopped.es": "pidió no recibir estos correos",
  "documents.request.reason.emailHeld": "emails to them are on hold while you check whether they asked to stop",
  "documents.request.reason.emailHeld.es": "los correos a esta persona están en pausa mientras revisa si pidió que se detuvieran",
  "documents.request.reason.bounced": "this email address bounced",
  "documents.request.reason.bounced.es": "este correo rebotó",
  "documents.request.reason.failed": "it couldn't be delivered",
  "documents.request.reason.failed.es": "no se pudo entregar",
  "documents.request.reason.accountPaused": "texts to customers are stopped while this account is paused",
  "documents.request.reason.accountPaused.es": "los mensajes de texto a clientes están detenidos mientras esta cuenta está en pausa",
  "documents.request.task.received": "{name} sent documents · Review",
  "documents.request.task.received.es": "{name} mandó documentos · Revisar",
  "documents.request.task.receivedNoName": "A customer sent documents · Review",
  "documents.request.task.receivedNoName.es": "Un cliente mandó documentos · Revisar",
  "documents.request.task.storageFull": "{name} couldn't send documents: your storage is full",
  "documents.request.task.storageFull.es": "{name} no pudo mandar documentos: su espacio está lleno",
  "documents.request.task.storageFullNoName": "A customer couldn't send documents: your storage is full",
  "documents.request.task.storageFullNoName.es": "Un cliente no pudo mandar documentos: su espacio está lleno",
  // S-07 3a: the account-wide Documents page (spec 3.1).
  "documents.page.title": "Documents",
  "documents.page.title.es": "Documentos",
  "documents.page.show.label": "Show",
  "documents.page.show.label.es": "Mostrar",
  "documents.page.show.expiring": "Expiring soon",
  "documents.page.show.expiring.es": "Vencen pronto",
  "documents.page.show.expired": "Expired",
  "documents.page.show.expired.es": "Vencidos",
  "documents.page.show.all": "All",
  "documents.page.show.all.es": "Todos",
  "documents.page.category.label": "Type",
  "documents.page.category.label.es": "Tipo",
  "documents.page.category.any": "Any type",
  "documents.page.category.any.es": "Cualquier tipo",
  "documents.page.openRecord": "Open {name}",
  "documents.page.openRecord.es": "Abrir {name}",
  "documents.page.noName": "No name",
  "documents.page.noName.es": "Sin nombre",
  "documents.page.next": "Next",
  "documents.page.next.es": "Siguiente",
  "documents.page.first": "Back to the start",
  "documents.page.first.es": "Volver al principio",
  "documents.page.empty.all": "Files you upload to a customer or household show up here.",
  "documents.page.empty.all.es": "Los archivos que suba a un cliente o a un hogar aparecen aquí.",
  "documents.page.empty.allBody": "Open a customer and use Documents to add one.",
  "documents.page.empty.allBody.es": "Abra un cliente y use Documentos para agregar uno.",
  "documents.page.empty.expiring": "Nothing expires in the next 30 days.",
  "documents.page.empty.expiring.es": "Nada vence en los próximos 30 días.",
  "documents.page.empty.expiringBody": "Files with an expiry date show up here a month before.",
  "documents.page.empty.expiringBody.es": "Los archivos con fecha de vencimiento aparecen aquí un mes antes.",
  "documents.page.empty.expired": "Nothing has expired.",
  "documents.page.empty.expired.es": "Nada ha vencido.",
  "documents.page.empty.category": "Nothing of this type here.",
  "documents.page.empty.category.es": "No hay nada de este tipo aquí.",
  "documents.page.empty.categoryAction": "Choose Any type to see every file.",
  "documents.page.empty.categoryAction.es": "Elija Cualquier tipo para ver todos los archivos.",
  "documents.page.loadFailed": "Couldn't load the documents list. Check your connection, then try again.",
  "documents.page.loadFailed.es": "No se pudo cargar la lista de documentos. Revise su conexión e intente de nuevo.",
  // S-07 3a: the expiry To-do's title, in the ACCOUNT's language (spec 3.2). {name} is the customer or the household.
  "documents.expiryTask.noName": "A customer",
  "documents.expiryTask.noName.es": "un cliente",
  "documents.expiryTask.id": "{name}'s ID expires on {date}",
  "documents.expiryTask.id.es": "La identificación de {name} vence el {date}",
  "documents.expiryTask.contract": "{name}'s contract expires on {date}",
  "documents.expiryTask.contract.es": "El contrato de {name} vence el {date}",
  "documents.expiryTask.estimate": "{name}'s estimate expires on {date}",
  "documents.expiryTask.estimate.es": "El presupuesto de {name} vence el {date}",
  "documents.expiryTask.invoice": "{name}'s invoice expires on {date}",
  "documents.expiryTask.invoice.es": "La factura de {name} vence el {date}",
  "documents.expiryTask.photo": "{name}'s photo expires on {date}",
  "documents.expiryTask.photo.es": "La foto de {name} vence el {date}",
  "documents.expiryTask.permit": "{name}'s permit expires on {date}",
  "documents.expiryTask.permit.es": "El permiso de {name} vence el {date}",
  "documents.expiryTask.insurance": "{name}'s insurance expires on {date}",
  "documents.expiryTask.insurance.es": "El seguro de {name} vence el {date}",
  "documents.expiryTask.warranty": "{name}'s warranty expires on {date}",
  "documents.expiryTask.warranty.es": "La garantía de {name} vence el {date}",
  "documents.expiryTask.other": "{name}'s \"{title}\" expires on {date}",
  "documents.expiryTask.other.es": "\"{title}\" de {name} vence el {date}",
  // S-07 3a: the Owner's Required documents card on the Documents page (spec 3.3).
  "documents.required.summary": "Required for every customer: {list} ({count})",
  "documents.required.summary.es": "Requeridos para cada cliente: {list} ({count})",
  "documents.required.summaryOff": "Nothing is required for every customer yet.",
  "documents.required.summaryOff.es": "Todavía no se requiere nada para cada cliente.",
  "documents.required.loadFailed": "Couldn't load the required list.",
  "documents.required.loadFailed.es": "No se pudo cargar la lista de requeridos.",
  "documents.required.restored": "Put back the list you had.",
  "documents.required.restored.es": "Se restauró la lista que tenía.",
  "documents.required.changed": "Someone changed the list since. Reload the page to see it.",
  "documents.required.changed.es": "Alguien cambió la lista. Vuelva a cargar la página para verla.",
  "documents.required.failed": "Couldn't save the list. Try again.",
  "documents.required.failed.es": "No se pudo guardar la lista. Intente de nuevo.",
  "documents.required.role": "Only an Owner can change this list.",
  "documents.required.role.es": "Solo un dueño puede cambiar esta lista.",
  "documents.required.crashed": "That didn't finish. This page may be out of date: reload it and try again.",
  "documents.required.crashed.es": "Eso no se completó. Puede que esta página esté desactualizada: vuelva a cargarla e intente de nuevo.",
  "documents.requests.label": "Asked for",
  "documents.requests.label.es": "Pedido",
  "documents.requests.expires": "expires in {count} days",
  "documents.requests.expires.es": "vence en {count} días",
  "documents.requests.expiresOne": "expires in 1 day",
  "documents.requests.expiresOne.es": "vence en 1 día",
  "documents.requests.expiresToday": "expires today",
  "documents.requests.expiresToday.es": "vence hoy",
  "documents.requests.received": "Received",
  "documents.requests.received.es": "Recibido",
  "documents.requests.waiting": "Waiting",
  "documents.requests.waiting.es": "Pendiente",
  "documents.requests.copy": "Copy link",
  "documents.requests.copy.es": "Copiar enlace",
  "documents.requests.revoke": "Revoke",
  "documents.requests.revoke.es": "Anular",
  "documents.requests.revoked": "Request revoked.",
  "documents.requests.revoked.es": "Pedido anulado.",
  "documents.requests.loadFailed": "Couldn't load the requests.",
  "documents.requests.loadFailed.es": "No se pudieron cargar los pedidos.",
  "documents.addedByCustomer": "Sent by the customer · {when}",
  "documents.addedByCustomer.es": "Enviado por el cliente · {when}",
  "documents.checklist.label": "Required",
  "documents.checklist.label.es": "Requeridos",
  "documents.checklist.meter": "{met} of {required}",
  "documents.checklist.meter.es": "{met} de {required}",
  "documents.checklist.complete": "Complete",
  "documents.checklist.complete.es": "Completo",
  "documents.checklist.missing": "Missing: {category}",
  "documents.checklist.missing.es": "Falta: {category}",
  "documents.checklist.expired": "Expired: {category}",
  "documents.checklist.expired.es": "Vencido: {category}",
  "documents.checklist.checking": "Checking: {category}",
  "documents.checklist.checking.es": "Revisando: {category}",
  "documents.checklist.notNeeded": "{category} · Not needed",
  "documents.checklist.notNeeded.es": "{category} · No hace falta",
  "documents.checklist.skip": "Not needed",
  "documents.checklist.skip.es": "No hace falta",
  "documents.checklist.unskip": "Needed again",
  "documents.checklist.unskip.es": "Hace falta otra vez",
  "documents.checklist.skipped": "{category} isn't needed for this customer.",
  "documents.checklist.skipped.es": "{category} no hace falta para este cliente.",
  "documents.checklist.unskipped": "{category} is needed again.",
  "documents.checklist.unskipped.es": "{category} hace falta otra vez.",
  "documents.checklist.loadFailed": "Couldn't load the list.",
  "documents.checklist.loadFailed.es": "No se pudo cargar la lista.",
  "documents.checklist.skipRole": "Only an Owner or Staff can change a customer's list.",
  "documents.checklist.skipRole.es": "Solo un dueño o un empleado puede cambiar la lista de un cliente.",
  "documents.checklist.changed": "Someone changed this first. Reload to see it.",
  "documents.checklist.changed.es": "Alguien lo cambió primero. Vuelva a cargar para verlo.",
  // The Undo window (DOCUMENT_REQUIREMENT_UNDO_MS) has closed: this is never "changed", it's just late.
  "documents.checklist.undoExpiredSkip": "It's too late to undo this. Use Needed again instead.",
  "documents.checklist.undoExpiredSkip.es": "Ya es tarde para deshacer esto. Use Hace falta otra vez.",
  "documents.checklist.undoExpiredUnskip": "It's too late to undo this. Use Not needed instead.",
  "documents.checklist.undoExpiredUnskip.es": "Ya es tarde para deshacer esto. Use No hace falta.",
  "documents.checklist.notRequired": "That document isn't on the list anymore.",
  "documents.checklist.notRequired.es": "Ese documento ya no está en la lista.",
  // M2: the skip actions' own refusal (a malformed id, an unknown or Other category), never 2b's documents.request.refused.
  "documents.checklist.refused": "We couldn't change that. Reload the page.",
  "documents.checklist.refused.es": "No pudimos cambiar eso. Vuelva a cargar la página.",
  // M9: the checklist's own crash sentence, in usted; common.actionCrashed.es is in tú (messages.ts:312).
  "documents.checklist.crashed": "That didn't go through. This page may be out of date: reload it and try again.",
  "documents.checklist.crashed.es": "Eso no se completó. Puede que esta página esté desactualizada: vuelva a cargarla e intente de nuevo.",
  "documentRequest.sms": "{business}: please send us {items}. Upload them here:",
  "documentRequest.sms.es": "{business}: por favor envíenos {items}. Súbalos aquí:",
  // S-07 2b fix round 2: an account with no brand name gets a whole sentence, never "the business" filled in.
  // The Spanish keeps to GSM-7 (no í/á/ó/ú), as every Spanish text default does (spanish-sms-gsm.test.ts).
  "documentRequest.smsNoName": "Please send us {items}. Upload them here:",
  "documentRequest.smsNoName.es": "Le pedimos {items}. Puede subirlos en este enlace:",
  "documentRequest.email.subject": "{business} needs a few documents",
  "documentRequest.email.subject.es": "{business} necesita unos documentos",
  "documentRequest.email.subjectNoName": "We need a few documents from you",
  "documentRequest.email.subjectNoName.es": "Le pedimos unos documentos",
  "documentRequest.email.body": "Please send us: {items}. The link works for 7 days, and you don't need an account.",
  "documentRequest.email.body.es": "Por favor envíenos: {items}. El enlace funciona por 7 días y no necesita una cuenta.",
  "documentRequest.email.button": "Upload documents",
  "documentRequest.email.button.es": "Subir documentos",
  "customerDocs.pageTitle": "Send documents",
  "customerDocs.pageTitle.es": "Enviar documentos",
  "customerDocs.heading": "{business} asks for these documents",
  "customerDocs.heading.es": "{business} le pide estos documentos",
  "customerDocs.intro": "Upload each one below. Only {business} will see them.",
  "customerDocs.intro.es": "Suba cada uno abajo. Solo {business} los verá.",
  "customerDocs.headingNoName": "The business asks for these documents",
  "customerDocs.headingNoName.es": "El negocio le pide estos documentos",
  "customerDocs.introNoName": "Upload each one below. Only the business will see them.",
  "customerDocs.introNoName.es": "Suba cada uno abajo. Solo el negocio los verá.",
  "customerDocs.upload": "Upload",
  "customerDocs.upload.es": "Subir",
  "customerDocs.takePhoto": "Take photo",
  "customerDocs.takePhoto.es": "Tomar foto",
  "customerDocs.uploading": "Uploading {percent} %",
  "customerDocs.uploading.es": "Subiendo {percent} %",
  "customerDocs.checking": "Checking",
  "customerDocs.checking.es": "Revisando",
  "customerDocs.received": "Received",
  "customerDocs.received.es": "Recibido",
  "customerDocs.refused": "We couldn't accept this file",
  "customerDocs.refused.es": "No pudimos aceptar este archivo",
  "customerDocs.why.type": "Use a PDF, a photo, or a Word or Excel file.",
  "customerDocs.why.type.es": "Use un PDF, una foto o un archivo de Word o Excel.",
  "customerDocs.why.size": "It's over 25 MB.",
  "customerDocs.why.size.es": "Pesa más de 25 MB.",
  "customerDocs.why.virus": "It had a virus.",
  "customerDocs.why.virus.es": "Tenía un virus.",
  "customerDocs.why.password": "It has a password: remove it and upload it again.",
  "customerDocs.why.password.es": "Tiene contraseña: quítela y vuelva a subirlo.",
  "customerDocs.why.unscannable": "We couldn't check it. Try another copy.",
  "customerDocs.why.unscannable.es": "No pudimos revisarlo. Pruebe con otra copia.",
  "customerDocs.why.full": "Please call {business} at {phone}.",
  "customerDocs.why.full.es": "Por favor llame a {business} al {phone}.",
  "customerDocs.why.fullNoPhone": "Please call {business}.",
  "customerDocs.why.fullNoPhone.es": "Por favor llame a {business}.",
  "customerDocs.why.fullNoName": "Please call the business at {phone}.",
  "customerDocs.why.fullNoName.es": "Por favor llame al negocio al {phone}.",
  "customerDocs.why.fullNoPhoneNoName": "Please call the business.",
  "customerDocs.why.fullNoPhoneNoName.es": "Por favor llame al negocio.",
  "customerDocs.why.limit": "That's a lot of files for one day. Try again tomorrow.",
  "customerDocs.why.limit.es": "Son muchos archivos para un día. Intente mañana.",
  "customerDocs.failed": "Didn't upload. Try again.",
  "customerDocs.failed.es": "No se subió. Intente de nuevo.",
  "customerDocs.done": "Thank you. {business} has everything it asked for.",
  "customerDocs.done.es": "Gracias. {business} ya tiene todo lo que pidió.",
  "customerDocs.doneNoName": "Thank you. The business has everything it asked for.",
  "customerDocs.doneNoName.es": "Gracias. El negocio ya tiene todo lo que pidió.",
  "customerDocs.expired": "This link has expired.",
  "customerDocs.expired.es": "Este enlace venció.",
  "customerDocs.revoked": "This link is no longer active.",
  "customerDocs.revoked.es": "Este enlace ya no está activo.",
  "customerDocs.notFound": "This link doesn't work.",
  "customerDocs.notFound.es": "Este enlace no funciona.",
  "customerDocs.ask": "Ask {business} for a new link.",
  "customerDocs.ask.es": "Pida a {business} un enlace nuevo.",
  "customerDocs.call": "Questions? Call {business} at {phone}.",
  "customerDocs.call.es": "¿Preguntas? Llame a {business} al {phone}.",
  "customerDocs.callNoPhone": "Questions? Contact {business}.",
  "customerDocs.callNoPhone.es": "¿Preguntas? Comuníquese con {business}.",
  "customerDocs.askNoName": "Ask the business for a new link.",
  "customerDocs.askNoName.es": "Pida al negocio un enlace nuevo.",
  "customerDocs.callNoName": "Questions? Call the business at {phone}.",
  "customerDocs.callNoName.es": "¿Preguntas? Llame al negocio al {phone}.",
  "customerDocs.callNoPhoneNoName": "Questions? Contact the business.",
  "customerDocs.callNoPhoneNoName.es": "¿Preguntas? Comuníquese con el negocio.",
  "customerDocs.business": "the business",
  "customerDocs.business.es": "el negocio",
  "customerDocs.poweredBy": "Powered by BIS",
  "customerDocs.poweredBy.es": "Con tecnología de BIS",
  "customerDocs.error.title": "Something went wrong on our side.",
  "customerDocs.error.title.es": "Algo salió mal de nuestro lado.",
  "customerDocs.error.body": "Please try again in a moment.",
  "customerDocs.error.body.es": "Por favor intente de nuevo en un momento.",
  "customerDocs.error.retry": "Try again",
  "customerDocs.error.retry.es": "Intentar de nuevo",
  "timeline.documentPassword": "removed {title}: it has a password",
  "timeline.documentPassword.es": "quitó {title}: tiene contraseña",
  "timeline.document": "added a file: {title}",
  "timeline.document.es": "agregó un archivo: {title}",
  "timeline.documentPhoto": "took a photo: {title}",
  "timeline.documentPhoto.es": "tomó una foto: {title}",
  "timeline.documentRequest": "asked for {count} documents",
  "timeline.documentRequest.es": "pidió {count} documentos",
  "timeline.documentRequestOne": "asked for 1 document",
  "timeline.documentRequestOne.es": "pidió 1 documento",
  "timeline.documentCustomer": "sent {title}",
  "timeline.documentCustomer.es": "mandó {title}",
  "timeline.documentSkip": "marked {category} as not needed",
  "timeline.documentSkip.es": "marcó que {category} no hace falta",
  "timeline.documentUnskip": "marked {category} as needed again",
  "timeline.documentUnskip.es": "marcó que {category} hace falta otra vez",
  "timeline.what.documents": "documents",
  "timeline.what.documents.es": "documentos",
  // Owner ruling 2026-10-13: deleting a customer deletes their files; the dialog says how many.
  "contacts.delete.alsoFiles": "This also deletes {count} files.",
  "contacts.delete.alsoFiles.es": "También se borrarán {count} archivos.",
  "contacts.delete.alsoFilesOne": "This also deletes {count} file.",
  "contacts.delete.alsoFilesOne.es": "También se borrará {count} archivo.",
  "contacts.delete.filesFailed": "Couldn't check for files. Close this and try again.",
  "contacts.delete.filesFailed.es": "No se pudo revisar si hay archivos. Cierre esto e intente de nuevo.",
  "contacts.delete.keptFiles": "Deleted {count} · kept {kept} whose files couldn't be deleted. Try again.",
  "contacts.delete.keptFiles.es": "Se borraron {count} · se conservaron {kept} cuyos archivos no se pudieron borrar. Intente de nuevo.",
  "contacts.delete.filesGoneKept": "The files were deleted, but the customers were kept. Try again.",
  "contacts.delete.filesGoneKept.es": "Los archivos se borraron, pero los clientes se conservaron. Intente de nuevo.",
  // Contact archive (plan Task 3, spec §6): the Archived view, its own list-page shell.
  "contacts.archived.link": "Archived",
  "contacts.archived.link.es": "Archivados",
  "contacts.archived.title": "Archived contacts",
  "contacts.archived.title.es": "Contactos archivados",
  "contacts.archived.count": "{count} archived",
  "contacts.archived.count.es": "{count} archivados",
  "contacts.archived.countOne": "1 archived",
  "contacts.archived.countOne.es": "1 archivado",
  "contacts.archived.back": "Back to contacts",
  "contacts.archived.back.es": "Volver a contactos",
  "contacts.archived.emptyTitle": "Nothing archived",
  "contacts.archived.emptyTitle.es": "No hay contactos archivados",
  "contacts.archived.emptyBody": "Contacts you archive wait here, off your list, with every call and text kept. Archive one from your list when you no longer need to see it.",
  "contacts.archived.emptyBody.es": "Aquí quedan los contactos que archive: fuera de su lista y con todas sus llamadas y mensajes guardados. Archive uno desde su lista cuando ya no necesite verlo.",
  "contacts.archived.mark": "Archived",
  "contacts.archived.mark.es": "Archivado",
  // F-006 plan Task 2: possible-duplicate pairs (phone/email/name) and the merge dialog that
  // folds two records into one. Owner rulings this copy reflects: a name-only match is labelled
  // "Same name" (contacts.duplicates.reason.sameName), dismissing a pair reads "Not the same
  // person", the merge's Undo runs for 30 days (the toast's own button is common.undo; after the
  // toast is gone, timeline.undoMerge is the merge row's own link), and the record kept by
  // default is the older one, with "Keep this one instead" to swap.
  "contacts.duplicates.title": "Possible duplicates",
  "contacts.duplicates.title.es": "Posibles duplicados",
  "contacts.duplicates.link": "Possible duplicates",
  "contacts.duplicates.link.es": "Posibles duplicados",
  "contacts.duplicates.count": "{count} possible duplicates",
  "contacts.duplicates.count.es": "{count} posibles duplicados",
  "contacts.duplicates.countOne": "1 possible duplicate",
  "contacts.duplicates.countOne.es": "1 posible duplicado",
  "contacts.duplicates.banner": "May be the same person as {name} · {reason}",
  "contacts.duplicates.banner.es": "Puede ser la misma persona que {name} · {reason}",
  "contacts.duplicates.bannerMore": "and {count} more",
  "contacts.duplicates.bannerMore.es": "y {count} más",
  "contacts.duplicates.bannerMoreOne": "and 1 more",
  "contacts.duplicates.bannerMoreOne.es": "y 1 más",
  "contacts.duplicates.compare": "Compare",
  "contacts.duplicates.compare.es": "Comparar",
  "contacts.duplicates.reason.samePhone": "same phone number",
  "contacts.duplicates.reason.samePhone.es": "mismo número de teléfono",
  "contacts.duplicates.reason.sameDigits": "same phone digits, saved as a US and a Mexican number",
  "contacts.duplicates.reason.sameDigits.es": "mismos dígitos, guardados como número de EE. UU. y de México",
  "contacts.duplicates.reason.sameEmail": "same email",
  "contacts.duplicates.reason.sameEmail.es": "mismo correo",
  "contacts.duplicates.reason.sameName": "same name",
  "contacts.duplicates.reason.sameName.es": "mismo nombre",
  "contacts.duplicates.reason.other": "found when a record was saved",
  "contacts.duplicates.reason.other.es": "se detectó al guardar un registro",
  "contacts.duplicates.foundOn": "Found {date}",
  "contacts.duplicates.foundOn.es": "Detectado el {date}",
  "contacts.duplicates.emptyTitle": "No possible duplicates",
  "contacts.duplicates.emptyTitle.es": "No hay posibles duplicados",
  "contacts.duplicates.emptyBody": "When two records look like the same customer (same phone, email or name), they show up here so you can merge them.",
  "contacts.duplicates.emptyBody.es": "Cuando dos registros parecen ser el mismo cliente (mismo teléfono, correo o nombre), aparecen aquí para que los una.",
  "contacts.duplicates.listFailed": "Couldn't load possible duplicates. Try again.",
  "contacts.duplicates.listFailed.es": "No se pudieron cargar los posibles duplicados. Intente de nuevo.",
  "contacts.duplicates.notSame": "Not the same person",
  "contacts.duplicates.notSame.es": "No es la misma persona",
  "contacts.duplicates.dismissed": "Got it. We won't suggest these two again.",
  "contacts.duplicates.dismissed.es": "Entendido. No volveremos a sugerir estos dos.",
  "contacts.duplicates.dismissFailed": "Couldn't save that. Nothing changed. Try again.",
  "contacts.duplicates.dismissFailed.es": "No se pudo guardar. No cambió nada. Intente de nuevo.",
  "contacts.duplicates.next": "Next",
  "contacts.duplicates.next.es": "Siguiente",
  "contacts.duplicates.first": "Back to the start",
  "contacts.duplicates.first.es": "Volver al principio",
  "contacts.merge.title": "Merge two records",
  "contacts.merge.title.es": "Unir dos registros",
  "contacts.merge.keep": "Keep this one",
  "contacts.merge.keep.es": "Conservar este",
  "contacts.merge.swap": "Keep this one instead",
  "contacts.merge.swap.es": "Mejor conservar este",
  "contacts.merge.joins": "Joins the one you keep",
  "contacts.merge.joins.es": "Se une al que conserva",
  "contacts.merge.pick": "The two records don't agree on the {field}. Which one do we keep?",
  "contacts.merge.pick.es": "Los dos registros no coinciden en {field}. ¿Cuál conservamos?",
  "contacts.merge.field.firstName": "first name",
  "contacts.merge.field.firstName.es": "el nombre",
  "contacts.merge.field.lastName": "last name",
  "contacts.merge.field.lastName.es": "el apellido",
  "contacts.merge.field.email": "email",
  "contacts.merge.field.email.es": "el correo",
  "contacts.merge.field.phone": "phone number",
  "contacts.merge.field.phone.es": "el teléfono",
  "contacts.merge.field.assignedTo": "person it's assigned to",
  "contacts.merge.field.assignedTo.es": "la persona asignada",
  "contacts.merge.field.language": "language",
  "contacts.merge.field.language.es": "el idioma",
  "contacts.merge.field.custom": "“{label}” field",
  "contacts.merge.field.custom.es": "campo “{label}”",
  // Fix round, carry-in 8: the rest of 0106's app.merge_fields_of groups, named in words — never shown
  // as the raw snake_case key a merge's own Undo can report in keptEdits.
  "contacts.merge.field.languageHint": "the language hint",
  "contacts.merge.field.languageHint.es": "el aviso de idioma",
  "contacts.merge.field.customFields": "the custom fields",
  "contacts.merge.field.customFields.es": "los campos personalizados",
  "contacts.merge.field.archived": "archived status",
  "contacts.merge.field.archived.es": "el estado de archivado",
  "contacts.merge.field.other": "another detail",
  "contacts.merge.field.other.es": "otro dato",
  "contacts.merge.alsoKeeps": "Also keeps: {list}",
  "contacts.merge.alsoKeeps.es": "También conserva: {list}",
  "contacts.merge.otherNumber": "Calls and texts from {phone} will still reach {name}.",
  "contacts.merge.otherNumber.es": "Las llamadas y los mensajes de {phone} seguirán llegando a {name}.",
  "contacts.merge.otherEmail": "Email from {email} will still reach {name}.",
  "contacts.merge.otherEmail.es": "Los correos de {email} seguirán llegando a {name}.",
  "contacts.merge.moves": "Moves to {name}: {list}",
  "contacts.merge.moves.es": "Pasan a {name}: {list}",
  "contacts.merge.nothingMoves": "{name} has no history to move.",
  "contacts.merge.nothingMoves.es": "{name} no tiene historial que pasar.",
  "contacts.merge.count.messages": "{count} messages",
  "contacts.merge.count.messages.es": "{count} mensajes",
  "contacts.merge.count.messagesOne": "1 message",
  "contacts.merge.count.messagesOne.es": "1 mensaje",
  "contacts.merge.count.calls": "{count} calls",
  "contacts.merge.count.calls.es": "{count} llamadas",
  "contacts.merge.count.callsOne": "1 call",
  "contacts.merge.count.callsOne.es": "1 llamada",
  "contacts.merge.count.bookings": "{count} appointments",
  "contacts.merge.count.bookings.es": "{count} citas",
  "contacts.merge.count.bookingsOne": "1 appointment",
  "contacts.merge.count.bookingsOne.es": "1 cita",
  "contacts.merge.count.documents": "{count} files",
  "contacts.merge.count.documents.es": "{count} archivos",
  "contacts.merge.count.documentsOne": "1 file",
  "contacts.merge.count.documentsOne.es": "1 archivo",
  "contacts.merge.count.opportunities": "{count} deals",
  "contacts.merge.count.opportunities.es": "{count} oportunidades",
  "contacts.merge.count.opportunitiesOne": "1 deal",
  "contacts.merge.count.opportunitiesOne.es": "1 oportunidad",
  "contacts.merge.count.notes": "{count} notes",
  "contacts.merge.count.notes.es": "{count} notas",
  "contacts.merge.count.notesOne": "1 note",
  "contacts.merge.count.notesOne.es": "1 nota",
  "contacts.merge.count.tasks": "{count} to-dos",
  "contacts.merge.count.tasks.es": "{count} pendientes",
  "contacts.merge.count.tasksOne": "1 to-do",
  "contacts.merge.count.tasksOne.es": "1 pendiente",
  "contacts.merge.count.form_submissions": "{count} form answers",
  "contacts.merge.count.form_submissions.es": "{count} respuestas de formulario",
  "contacts.merge.count.form_submissionsOne": "1 form answer",
  "contacts.merge.count.form_submissionsOne.es": "1 respuesta de formulario",
  "contacts.merge.action": "Merge",
  "contacts.merge.action.es": "Unir",
  "contacts.merge.done": "Merged into {name}",
  "contacts.merge.done.es": "Se unió con {name}",
  "contacts.merge.stale": "One of these records changed while you were looking. Here it is again with the new details.",
  "contacts.merge.stale.es": "Uno de estos registros cambió mientras lo revisaba. Aquí está de nuevo con los datos nuevos.",
  "contacts.merge.failed": "Couldn't merge. Nothing changed. Try again.",
  "contacts.merge.failed.es": "No se pudo unir. No cambió nada. Intente de nuevo.",
  "contacts.merge.loadFailed": "Couldn't load these two records. Try again.",
  "contacts.merge.loadFailed.es": "No se pudieron cargar estos dos registros. Intente de nuevo.",
  "contacts.merge.undone": "Merge undone. {name} is back as their own record.",
  "contacts.merge.undone.es": "Se deshizo la unión. {name} volvió a tener su propio registro.",
  "contacts.merge.undoneKept": "{count} things that arrived after the merge stay with {name}.",
  "contacts.merge.undoneKept.es": "{count} cosas que llegaron después de la unión se quedan con {name}.",
  "contacts.merge.undoneKeptOne": "1 thing that arrived after the merge stays with {name}.",
  "contacts.merge.undoneKeptOne.es": "1 cosa que llegó después de la unión se queda con {name}.",
  "contacts.merge.undoneEdits": "Kept what was changed after the merge: {list}.",
  "contacts.merge.undoneEdits.es": "Se conservó lo que se cambió después de la unión: {list}.",
  "contacts.merge.undoExpired": "This merge is more than 30 days old and can't be undone.",
  "contacts.merge.undoExpired.es": "Esta unión tiene más de 30 días y ya no se puede deshacer.",
  "contacts.merge.undoLater": "This merge can't be undone yet: {name} was merged again since. Undo the newer merge first.",
  "contacts.merge.undoLater.es": "Esta unión todavía no se puede deshacer: {name} se volvió a unir después. Deshaga primero la unión más reciente.",
  "contacts.merge.undoFailed": "Couldn't undo the merge. Nothing changed. Try again.",
  "contacts.merge.undoFailed.es": "No se pudo deshacer la unión. No cambió nada. Intente de nuevo.",
  // Fix round, carry-in 5: a tag, group or customer the merge re-inserted on Undo was itself deleted
  // since — a foreign-key error (23503), never the generic "try again" (nothing to retry: the missing
  // thing is gone).
  "contacts.merge.undoBlocked": "Can't undo: a tag, group or customer from before the merge was deleted since.",
  "contacts.merge.undoBlocked.es": "No se puede deshacer: se eliminó una etiqueta, un grupo o un cliente de antes de la unión.",
  "contacts.archive.failed": "Couldn't archive. Nothing changed. Try again.",
  "contacts.archive.failed.es": "No se pudo archivar. No cambió nada. Intente de nuevo.",
  "contacts.restore.failed": "Couldn't restore. Nothing changed. Try again.",
  "contacts.restore.failed.es": "No se pudo restaurar. No cambió nada. Intente de nuevo.",
  // Task 10 review: a big selection goes in several calls, and one can fail after others went. The
  // success toast counts what changed (with its Undo); this second line says the rest did not. No
  // number: which of the rest would have changed is not knowable once a call fails.
  "contacts.archive.partial": "Some of them couldn't be archived. Try again.",
  "contacts.archive.partial.es": "Algunos no se pudieron archivar. Intente de nuevo.",
  "contacts.restore.partial": "Some of them couldn't be restored. Try again.",
  "contacts.restore.partial.es": "Algunos no se pudieron restaurar. Intente de nuevo.",
  "contacts.archive.keepsAppointment": "They still have an appointment on {date}. Its reminders still go.",
  "contacts.archive.keepsAppointment.es": "Todavía tiene una cita el {date}. Sus recordatorios se siguen enviando.",
  "contacts.archive.keepsAppointments": "{count} of them still have appointments. Their reminders still go.",
  "contacts.archive.keepsAppointments.es": "{count} de ellos todavía tienen citas. Sus recordatorios se siguen enviando.",
  "contacts.archive.keepsAppointmentsOne": "1 of them still has an appointment. Its reminders still go.",
  "contacts.archive.keepsAppointmentsOne.es": "1 de ellos todavía tiene una cita. Sus recordatorios se siguen enviando.",
  // Review I5/M8 (plan Task 3): a permanent delete never lists WHICH history
  // blocked it — a reason list reads as a form and goes stale as the
  // delete-blocker set (spec §5.1) grows.
  "contacts.delete.archiveOnly": "{name} can't be deleted because they have a history with you, and we keep it. Archive them instead: they leave your list and nothing is lost.",
  "contacts.delete.archiveOnly.es": "No se puede borrar a {name} porque tiene un historial con usted, y lo conservamos. Mejor archive este contacto: sale de su lista y no se pierde nada.",
  "contacts.delete.someKept": "{kept} of these have a history with you and will be kept.",
  "contacts.delete.someKept.es": "{kept} de estos tienen un historial con usted y se conservarán.",
  "contacts.delete.someKeptOne": "1 of these has a history with you and will be kept.",
  "contacts.delete.someKeptOne.es": "1 de estos tiene un historial con usted y se conservará.",
  // Task 10 review: when nothing in the selection can go, the dialog is not titled "Delete 3 contacts?".
  // Final review M3: a paused account refuses every delete, so both delete dialogs say so and keep Delete off.
  "contacts.delete.paused": "Nothing can be deleted while this account is paused.",
  "contacts.delete.paused.es": "No se puede borrar nada mientras la cuenta está en pausa.",
  "contacts.delete.noneTitle": "These can't be deleted",
  "contacts.delete.noneTitle.es": "No se pueden borrar",
  "contacts.delete.noneTitleOne": "This contact can't be deleted",
  "contacts.delete.noneTitleOne.es": "Este contacto no se puede borrar",
  "contacts.delete.noneDeletable": "None of these can be deleted: they all have a history with you. Archive them instead.",
  "contacts.delete.noneDeletable.es": "Ninguno se puede borrar porque todos tienen un historial con usted. Mejor archívelos.",
  "contacts.delete.noneDeletableOne": "They have a history with you, so they can't be deleted. Archive them instead.",
  "contacts.delete.noneDeletableOne.es": "Tiene un historial con usted, así que no se puede borrar. Mejor archívelo.",
  // The Archived view's twins: these contacts are already archived, so nothing offers to archive them.
  "contacts.delete.noneDeletableArchived": "None of these can be deleted: they all have a history with you, so they stay archived.",
  "contacts.delete.noneDeletableArchived.es": "Ninguno se puede borrar porque todos tienen un historial con usted, así que siguen archivados.",
  "contacts.delete.noneDeletableArchivedOne": "They have a history with you, so they can't be deleted. They stay archived.",
  "contacts.delete.noneDeletableArchivedOne.es": "Tiene un historial con usted, así que no se puede borrar. Sigue archivado.",
  "contacts.delete.archiveInstead": "Archive instead",
  "contacts.delete.archiveInstead.es": "Archivar",
  "contacts.delete.blockersFailed": "Couldn't check which of these can be deleted. Close this and try again.",
  "contacts.delete.blockersFailed.es": "No se pudo revisar cuáles se pueden borrar. Cierre esto e intente de nuevo.",
  "contacts.delete.oneTitle": "Delete {name} for good?",
  "contacts.delete.oneTitle.es": "¿Borrar a {name} para siempre?",
  "contacts.delete.oneBody": "This removes them with their notes, tasks and files. It can't be undone. Type {name} to confirm.",
  "contacts.delete.oneBody.es": "Esto borra el contacto con sus notas, tareas y archivos. No se puede deshacer. Escriba {name} para confirmar.",
  "contacts.delete.oneBodyNoName": "This contact has no name. Type the last four digits of their phone, {digits}, to confirm.",
  "contacts.delete.oneBodyNoName.es": "Este contacto no tiene nombre. Escriba los últimos cuatro dígitos de su teléfono, {digits}, para confirmar.",
  "places.add": "Add a property",
  "places.add.es": "Agregar una propiedad",
  "places.empty": "Homes and job sites for this customer show up here, with how to get there and the equipment on site.",
  "places.empty.es": "Aquí aparecen las casas y los lugares de trabajo de este cliente, con cómo llegar y el equipo que hay.",
  "places.label": "Name",
  "places.label.es": "Nombre",
  "places.labelHint": "Like Home or Rental on 10th St",
  "places.labelHint.es": "Como Casa o Renta en la calle 10",
  "places.address": "Address",
  "places.address.es": "Dirección",
  "places.moreAddress": "City, state and ZIP",
  "places.moreAddress.es": "Ciudad, estado y código postal",
  "places.city": "City",
  "places.city.es": "Ciudad",
  "places.region": "State",
  "places.region.es": "Estado",
  "places.postalCode": "ZIP",
  "places.postalCode.es": "Código postal",
  "places.country": "Country",
  "places.country.es": "País",
  "places.country.none": "Not set",
  "places.country.none.es": "Sin indicar",
  "places.country.US": "United States",
  "places.country.US.es": "Estados Unidos",
  "places.country.MX": "Mexico",
  "places.country.MX.es": "México",
  "places.landmark": "Landmark",
  "places.landmark.es": "Referencia",
  "places.landmarkHint": "Like the blue house past the canal",
  "places.landmarkHint.es": "Como la casa azul pasando el canal",
  "places.directions": "How to get there",
  "places.directions.es": "Cómo llegar",
  "places.directionsHint": "The gate, the dogs, where to park. Don't put gate or alarm codes here.",
  "places.directionsHint.es": "El portón, los perros, dónde estacionarse. No ponga aquí códigos del portón ni de la alarma.",
  "places.openMap": "Open map",
  "places.openMap.es": "Abrir mapa",
  "places.belongsTo": "Belongs to",
  "places.belongsTo.es": "Es de",
  // The owner option's name when the customer has none on file.
  "places.thisCustomer": "This customer",
  "places.thisCustomer.es": "Este cliente",
  "places.removedList": "Removed properties ({count})",
  "places.removedList.es": "Propiedades quitadas ({count})",
  "places.putBack": "Put back",
  "places.putBack.es": "Recuperar",
  "places.loadFailed": "Couldn't load properties.",
  "places.loadFailed.es": "No se pudieron cargar las propiedades.",
  "places.retry": "Try again",
  "places.retry.es": "Intentar de nuevo",
  "places.removeAria": "Remove {name}",
  "places.removeAria.es": "Quitar {name}",
  "places.dialog.add": "Add",
  "places.dialog.add.es": "Agregar",
  "places.dialog.cancel": "Cancel",
  "places.dialog.cancel.es": "Cancelar",
  "places.added": "Added {place}.",
  "places.added.es": "Se agregó {place}.",
  "places.ownerChanged": "{place} now belongs to {owner}.",
  "places.ownerChanged.es": "{place} ahora es de {owner}.",
  "places.removed": "Removed {place}.",
  "places.removed.es": "Se quitó {place}.",
  "places.archived": "Moved {place} to Removed properties.",
  "places.archived.es": "Se movió {place} a Propiedades quitadas.",
  "places.putBackDone": "Put back {place}.",
  "places.putBackDone.es": "Se recuperó {place}.",
  "equipment.title": "Equipment ({count})",
  "equipment.title.es": "Equipo ({count})",
  "equipment.add": "Add equipment",
  "equipment.add.es": "Agregar equipo",
  "equipment.empty": "No equipment here yet.",
  "equipment.empty.es": "Todavía no hay equipo aquí.",
  "equipment.name": "What it is",
  "equipment.name.es": "Qué es",
  "equipment.nameHint": "Like AC upstairs or Water heater",
  "equipment.nameHint.es": "Como Aire de arriba o Calentador de agua",
  "equipment.make": "Brand",
  "equipment.make.es": "Marca",
  "equipment.model": "Model",
  "equipment.model.es": "Modelo",
  "equipment.serial": "Serial number",
  "equipment.serial.es": "Número de serie",
  "equipment.notes": "Notes",
  "equipment.notes.es": "Notas",
  "equipment.installedOn": "Installed {date}",
  "equipment.installedOn.es": "Instalado el {date}",
  // The install date's field label (the card's inline field and the add form).
  "equipment.installDate": "Install date",
  "equipment.installDate.es": "Fecha de instalación",
  "equipment.warrantyUntil": "Warranty until",
  "equipment.warrantyUntil.es": "Garantía hasta",
  "equipment.underWarranty": "Under warranty until {date}",
  "equipment.underWarranty.es": "En garantía hasta el {date}",
  "equipment.warrantyEnded": "Warranty ended {date}",
  "equipment.warrantyEnded.es": "La garantía terminó el {date}",
  "equipment.replace": "Replace",
  "equipment.replace.es": "Reemplazar",
  "equipment.replaceTitle": "Replace {name}",
  "equipment.replaceTitle.es": "Reemplazar {name}",
  "equipment.replaceDate": "When was it replaced?",
  "equipment.replaceDate.es": "¿Cuándo se reemplazó?",
  "equipment.replacedOn": "Replaced {date}",
  "equipment.replacedOn.es": "Reemplazado el {date}",
  "equipment.history": "Earlier units ({count})",
  "equipment.history.es": "Equipos anteriores ({count})",
  "equipment.removeAria": "Remove {name}",
  "equipment.removeAria.es": "Quitar {name}",
  "equipment.added": "Added {name}.",
  "equipment.added.es": "Se agregó {name}.",
  "equipment.replaced": "Replaced. The old unit is kept in its history.",
  "equipment.replaced.es": "Reemplazado. El equipo anterior queda en su historial.",
  "equipment.removed": "Removed {name}.",
  "equipment.removed.es": "Se quitó {name}.",
  // S-03 part 1 (1a): the contact record page (spec §10.1). Usted, trades Spanish. This first block
  // is the kit's own words and what the styleguide demo shows; plan Task 5 appends the rest.
  // record.card.failed is added to the spec's table: a card with no failure sentence of its own
  // (plan Task 4, decision 2). The open-deal keys carry the count only: the amount is its own
  // segment, left out at zero or past the cap (plan Task 5).
  "record.skipToDetails": "Skip to details",
  "record.skipToDetails.es": "Ir a los datos",
  "record.card.retry": "Try again",
  "record.card.retry.es": "Intentar de nuevo",
  "record.card.show": "Show {title}",
  "record.card.show.es": "Mostrar {title}",
  "record.card.failed": "Couldn't load {title}.",
  "record.card.failed.es": "No se pudo cargar: {title}.",
  "record.back": "Contacts",
  "record.back.es": "Contactos",
  "record.group.household": "{group} · Household",
  "record.group.household.es": "{group} · Familia",
  "record.group.business": "{group} · Business customer",
  "record.group.business.es": "{group} · Cliente comercial",
  "record.action.call": "Call",
  "record.action.call.es": "Llamar",
  "record.action.callAria": "Call {name}",
  "record.action.callAria.es": "Llamar a {name}",
  "record.action.text": "Text",
  "record.action.text.es": "Mandar texto",
  "record.action.email": "Email",
  "record.action.email.es": "Mandar correo",
  "record.action.directions": "Directions",
  "record.action.directions.es": "Cómo llegar",
  // Contact archive (plan Task 3, spec §6): the record header's own Archive/Restore
  // and the Delete… that opens the typed-name confirm (DESIGN.md rule 8 — Call
  // stays the header's one primary; these are ghost actions beside it).
  "record.archive": "Archive",
  "record.archive.es": "Archivar",
  "record.restore": "Restore",
  "record.restore.es": "Restaurar",
  "record.delete": "Delete…",
  "record.delete.es": "Borrar…",
  "record.archivedBanner": "Archived {date} by {name}. Their calls and texts are kept.",
  "record.archivedBanner.es": "Archivado el {date} por {name}. Sus llamadas y mensajes se conservan.",
  "record.archivedBannerShort": "Archived {date}. Their calls and texts are kept.",
  "record.archivedBannerShort.es": "Archivado el {date}. Sus llamadas y mensajes se conservan.",
  "record.archivedToast": "{name} archived",
  "record.archivedToast.es": "{name} se archivó",
  "record.restoredToast": "{name} is back on your list",
  "record.restoredToast.es": "{name} volvió a su lista",
  "record.card.summary": "Summary",
  "record.card.summary.es": "Resumen",
  "record.card.nextUp": "Next up",
  "record.card.nextUp.es": "Lo que sigue",
  "record.card.activity": "Activity",
  "record.card.activity.es": "Actividad",
  "record.card.deals": "Deals",
  "record.card.deals.es": "Oportunidades",
  "record.facts.openDeals": "{count} open deals",
  "record.facts.openDeals.es": "{count} oportunidades abiertas",
  "record.facts.openDealsOne": "1 open deal",
  "record.facts.openDealsOne.es": "1 oportunidad abierta",
  "styleguide.recordKit": "Record kit",
  "styleguide.recordKit.es": "Ficha del cliente",
  "styleguide.contactArchive": "Contact archive",
  "styleguide.contactArchive.es": "Archivo de contactos",
  // F-006 part 1 (plan Task 11): the duplicate line and the merge/mergeUndone timeline row.
  "styleguide.duplicates": "Possible duplicates and merge",
  "styleguide.duplicates.es": "Posibles duplicados y unión",
  // S-03 part 1 (1a), continued (spec §10.1). record.nextUp.booking stands in for the calendar
  // name the schema has not got (plan Task 1).
  "record.activity.failed": "Couldn't load the activity.",
  "record.activity.failed.es": "No se pudo cargar la actividad.",
  "record.facts.since": "On your list since {month}",
  "record.facts.since.es": "En su lista desde {month}",
  "record.facts.booked": "Booked {count} times",
  "record.facts.booked.es": "Agendó {count} veces",
  "record.facts.bookedOne": "Booked once",
  "record.facts.bookedOne.es": "Agendó una vez",
  "record.facts.lastTalked": "Last talked {when} ({channel})",
  "record.facts.lastTalked.es": "Última conversación {when} ({channel})",
  "record.facts.channel.text": "text",
  "record.facts.channel.text.es": "texto",
  "record.facts.channel.email": "email",
  "record.facts.channel.email.es": "correo",
  "record.facts.channel.call": "call",
  "record.facts.channel.call.es": "llamada",
  "record.facts.couldntCount": "Couldn't count {what}.",
  "record.facts.couldntCount.es": "No se pudo contar: {what}.",
  "record.facts.what.bookings": "bookings",
  "record.facts.what.bookings.es": "las citas",
  "record.facts.what.talked": "the last conversation",
  "record.facts.what.talked.es": "la última conversación",
  "record.facts.what.deals": "open deals",
  "record.facts.what.deals.es": "las oportunidades abiertas",
  "record.summary.failed": "Couldn't load the summary.",
  "record.summary.failed.es": "No se pudo cargar el resumen.",
  "record.nextUp.booking": "Appointment · {when}",
  "record.nextUp.booking.es": "Cita · {when}",
  "record.nextUp.due": "Due {date}",
  "record.nextUp.due.es": "Vence el {date}",
  "record.nextUp.dueToday": "Due today",
  "record.nextUp.dueToday.es": "Vence hoy",
  "record.nextUp.overdue": "Overdue · was due {date}",
  "record.nextUp.overdue.es": "Atrasado · vencía el {date}",
  "record.nextUp.undated": "{count} more To-dos have no date.",
  "record.nextUp.undated.es": "{count} pendientes más no tienen fecha.",
  "record.nextUp.undatedOne": "1 more To-do has no date.",
  "record.nextUp.undatedOne.es": "1 pendiente más no tiene fecha.",
  // The same count with nothing listed above it, so it cannot say "more" (review round 1).
  "record.nextUp.undatedOnly": "{count} To-dos have no date.",
  "record.nextUp.undatedOnly.es": "{count} pendientes no tienen fecha.",
  "record.nextUp.undatedOnlyOne": "1 To-do has no date.",
  "record.nextUp.undatedOnlyOne.es": "1 pendiente no tiene fecha.",
  "record.nextUp.empty": "Nothing coming up. Bookings ahead and To-dos with a due date show here.",
  "record.nextUp.empty.es": "No hay nada próximo. Aquí aparecen las citas que vienen y los pendientes con fecha.",
  "record.nextUp.addTodo": "Add a To-do",
  "record.nextUp.addTodo.es": "Agregar un pendiente",
  "record.nextUp.failed": "Couldn't load what's next.",
  "record.nextUp.failed.es": "No se pudo cargar lo que sigue.",
  // S-03 part 1, 1b (spec §10.2): the record timeline's rows, notices and pager.
  "timeline.note": "added a note",
  "timeline.note.es": "agregó una nota",
  // Contact archive (plan Task 3, spec §6): the archive/restore rows and a
  // customer's own sign bringing them back. Verbs stay lower-case: the row
  // draws "{mark} {verb}" (see above). timeline.chat (the "submission" case
  // in timeline-rows.ts:129-130) takes no {persona} placeholder, so "Sofía"
  // below is literal too, not {persona}.
  "timeline.archived": "archived this contact",
  "timeline.archived.es": "archivó este contacto",
  "timeline.restored": "moved this contact back to the list",
  "timeline.restored.es": "devolvió este contacto a la lista",
  "timeline.cameBack.text": "came back: sent you a text",
  "timeline.cameBack.text.es": "volvió: le envió un mensaje",
  "timeline.cameBack.email": "came back: sent you an email",
  "timeline.cameBack.email.es": "volvió: le envió un correo",
  "timeline.cameBack.call": "came back: called and talked with {persona}",
  "timeline.cameBack.call.es": "volvió: llamó y habló con {persona}",
  "timeline.cameBack.booking": "came back: booked an appointment",
  "timeline.cameBack.booking.es": "volvió: hizo una cita",
  "timeline.cameBack.form": "came back: filled out your form",
  "timeline.cameBack.form.es": "volvió: llenó su formulario",
  "timeline.cameBack.chat": "came back: wrote in your website chat",
  "timeline.cameBack.chat.es": "volvió: escribió en el chat de su sitio web",
  "timeline.what.archive": "archive history",
  "timeline.what.archive.es": "historial de archivo",
  // F-006 plan Task 2: a merge's own timeline rows, on both the kept record (what moved here)
  // and, while its Undo window is open, the merge row's own "Undo merge" link.
  "timeline.merged": "merged {name} into this record: {list} moved here",
  "timeline.merged.es": "unió a {name} con este registro: {list} pasaron aquí",
  "timeline.mergedEmpty": "merged {name} into this record",
  "timeline.mergedEmpty.es": "unió a {name} con este registro",
  "timeline.mergeUndone": "undid the merge with {name}",
  "timeline.mergeUndone.es": "deshizo la unión con {name}",
  "timeline.undoMerge": "Undo merge",
  "timeline.undoMerge.es": "Deshacer unión",
  "timeline.mergeOtherHidden": "another record",
  "timeline.mergeOtherHidden.es": "otro registro",
  "timeline.what.merge": "merge history",
  "timeline.what.merge.es": "historial de uniones",
  "timeline.todo": "added a To-do",
  "timeline.todo.es": "agregó un pendiente",
  "timeline.callbackTodo": "left a callback To-do",
  "timeline.callbackTodo.es": "dejó un pendiente para devolver la llamada",
  "timeline.deal": "added a deal: {name}",
  "timeline.deal.es": "agregó una oportunidad: {name}",
  "timeline.form": "sent the {form} form",
  "timeline.form.es": "envió el formulario {form}",
  "timeline.chat": "took a request in the website chat",
  "timeline.chat.es": "tomó una solicitud en el chat del sitio web",
  "timeline.texted": "texted",
  "timeline.texted.es": "mandó un texto",
  "timeline.emailed": "emailed",
  "timeline.emailed.es": "mandó un correo",
  "timeline.booked": "booked an appointment for {when}",
  "timeline.booked.es": "agendó una cita para {when}",
  "timeline.movedFrom": "Moved from {when}",
  "timeline.movedFrom.es": "Se movió del {when}",
  "timeline.answeredCall": "answered a call",
  "timeline.answeredCall.es": "contestó una llamada",
  "timeline.openCall": "Open call",
  "timeline.openCall.es": "Ver llamada",
  "timeline.minutes": "{count} min",
  "timeline.minutes.es": "{count} min",
  "timeline.empty": "Texts, calls, bookings, notes and To-dos with this customer show up here.",
  "timeline.empty.es": "Aquí aparecen los textos, llamadas, citas, notas y pendientes con este cliente.",
  "timeline.someFailed": "Couldn't load {what}.",
  "timeline.someFailed.es": "No se pudo cargar: {what}.",
  "timeline.what.calls": "calls",
  "timeline.what.calls.es": "llamadas",
  "timeline.what.bookings": "bookings",
  "timeline.what.bookings.es": "citas",
  "timeline.what.messages": "texts and emails",
  "timeline.what.messages.es": "textos y correos",
  "timeline.what.notes": "notes",
  "timeline.what.notes.es": "notas",
  "timeline.what.todos": "To-dos",
  "timeline.what.todos.es": "pendientes",
  "timeline.what.deals": "deals",
  "timeline.what.deals.es": "oportunidades",
  "timeline.what.forms": "forms",
  "timeline.what.forms.es": "formularios",
  // Item 8b-2: an accepted or edited suggestion as a timeline row, with the
  // decision-maker's person mark (author-mark.ts) carrying the verb.
  "timeline.suggestion": "accepted {persona}'s suggestion: {change}",
  "timeline.suggestion.es": "aceptó la sugerencia de {persona}: {change}",
  "timeline.suggestionEdited": "accepted {persona}'s suggestion with changes: {change}",
  "timeline.suggestionEdited.es": "aceptó la sugerencia de {persona} con cambios: {change}",
  "timeline.suggestion.original": "Suggested: {change}",
  "timeline.suggestion.original.es": "Se sugirió: {change}",
  "timeline.what.suggestions": "accepted suggestions",
  "timeline.what.suggestions.es": "sugerencias aceptadas",
  "timeline.older": "Older",
  "timeline.older.es": "Anteriores",
  "timeline.newer": "Newer",
  "timeline.newer.es": "Más recientes",
  "timeline.pages": "Pages",
  "timeline.pages.es": "Páginas",

  // S-03 part 2 (PR 2a): the household and business record page. Words verbatim from the spec's §9.1.
  "groupPage.action.call": "Call {name}",
  "groupPage.action.call.es": "Llamar a {name}",
  "groupPage.action.text": "Text {name}",
  "groupPage.action.text.es": "Mandar texto a {name}",
  "groupPage.action.email": "Email {name}",
  "groupPage.action.email.es": "Mandar correo a {name}",
  "groupPage.card.people": "People",
  "groupPage.card.people.es": "Personas",
  "groupPage.card.details": "Details",
  "groupPage.card.details.es": "Datos",
  "groupPage.details.type": "Type",
  "groupPage.details.type.es": "Tipo",
  "groupPage.people.primaryContact": "Primary contact",
  "groupPage.people.primaryContact.es": "Contacto principal",
  "groupPage.people.makePrimaryContact": "Make primary contact",
  "groupPage.people.makePrimaryContact.es": "Hacer contacto principal",
  "groupPage.people.primaryContactSet": "{name} is now the primary contact.",
  "groupPage.people.primaryContactSet.es": "{name} ahora es el contacto principal.",
  "groupPage.people.choosePrimary": "Choose who we call first.",
  "groupPage.people.choosePrimary.es": "Elija a quién llamamos primero.",
  "groupPage.people.removed": "Removed {name} from this group.",
  "groupPage.people.removed.es": "Se quitó a {name} de este grupo.",
  "groupPage.people.emptyHousehold": "No one in this household yet. Add someone from their own page.",
  "groupPage.people.emptyHousehold.es": "Todavía no hay nadie en esta familia. Agregue a alguien desde su propia página.",
  "groupPage.people.emptyBusiness": "No one at this business yet. Add someone from their own page.",
  "groupPage.people.emptyBusiness.es": "Todavía no hay nadie en este negocio. Agregue a alguien desde su propia página.",
  "groupPage.people.more": "More people",
  "groupPage.people.more.es": "Más personas",
  "groupPage.people.first": "Back to the start",
  "groupPage.people.first.es": "Volver al inicio",
  "groupPage.people.pages": "People pages",
  "groupPage.people.pages.es": "Páginas de personas",
  "groupPage.places.emptyHousehold": "Homes this household shares show up here, with how to get there and the equipment on site.",
  "groupPage.places.emptyHousehold.es": "Aquí aparecen las casas que comparte esta familia, con cómo llegar y el equipo que hay.",
  "groupPage.places.emptyBusiness": "Job sites of this business show up here, with how to get there and the equipment on site.",
  "groupPage.places.emptyBusiness.es": "Aquí aparecen los lugares de trabajo de este negocio, con cómo llegar y el equipo que hay.",
  "groupPage.deals.empty": "No open deals with these people. Deals added on a person's page show here.",
  "groupPage.deals.empty.es": "No hay oportunidades abiertas con estas personas. Aquí aparecen las que se agregan en la página de una persona.",
  "groupPage.deals.more": "Showing {shown} of {count} open deals.",
  "groupPage.deals.more.es": "Se muestran {shown} de {count} oportunidades abiertas.",
  // S-03 part 2b: the Groups card's way to the household's or business's own page.
  "groups.open": "Open",
  "groups.open.es": "Abrir",
  "groups.openAria": "Open {name}",
  "groups.openAria.es": "Abrir {name}",
  // S-03 part 2b: the household and business page's middle column.
  "groupPage.facts.people": "{count} people",
  "groupPage.facts.people.es": "{count} personas",
  "groupPage.facts.peopleOne": "1 person",
  "groupPage.facts.peopleOne.es": "1 persona",
  "groupPage.facts.peopleVisible": "{count} people you can see",
  "groupPage.facts.peopleVisible.es": "{count} personas que usted puede ver",
  "groupPage.facts.peopleVisibleOne": "1 person you can see",
  "groupPage.facts.peopleVisibleOne.es": "1 persona que usted puede ver",
  "groupPage.facts.lastTalked": "Last talked {when} with {name} ({channel})",
  "groupPage.facts.lastTalked.es": "Última conversación {when} con {name} ({channel})",
  "groupPage.facts.what.people": "the people in this group",
  "groupPage.facts.what.people.es": "las personas de este grupo",
  "groupPage.capped": "Showing activity for {shown} of {total} people. Open a person to see theirs.",
  "groupPage.capped.es": "Se muestra la actividad de {shown} de {total} personas. Abra a una persona para ver la suya.",
  "groupPage.cappedVisible": "Showing activity for {shown} of the {total} people you can see. Open a person to see theirs.",
  "groupPage.cappedVisible.es": "Se muestra la actividad de {shown} de las {total} personas que usted puede ver. Abra a una persona para ver la suya.",
  "groupPage.nextUp.empty": "Nothing coming up for these people. Bookings ahead and To-dos with a due date show here.",
  "groupPage.nextUp.empty.es": "No hay nada próximo para estas personas. Aquí aparecen las citas que vienen y los pendientes con fecha.",
  "groupPage.timeline.empty": "Texts, calls, bookings, notes and To-dos with these people show up here. Open a person to start one.",
  "groupPage.timeline.empty.es": "Aquí aparecen los textos, llamadas, citas, notas y pendientes con estas personas. Abra a una persona para empezar uno.",
  // S-03 part 2b (review of Task 16): the cap line when the exact count could not be read.
  "groupPage.cap.unknownTotal": "Showing activity for {shown} people. Open a person to see theirs.",
  "groupPage.cap.unknownTotal.es": "Se muestra la actividad de {shown} personas. Abra a una persona para ver la suya.",
  "groupPage.cap.unknownTotalVisible": "Showing activity for {shown} people you can see. Open a person to see theirs.",
  "groupPage.cap.unknownTotalVisible.es": "Se muestra la actividad de {shown} personas que usted puede ver. Abra a una persona para ver la suya.",
  // S-06 part 1: inbound email — the held queue, reply composer, settings and the forwarded-email template.
  "conversations.held.filter": "Needs a look",
  "conversations.held.filter.es": "Por revisar",
  "conversations.held.filterCount": "Needs a look · {count}",
  "conversations.held.filterCount.es": "Por revisar · {count}",
  "conversations.held.title": "Emails that need a look",
  "conversations.held.title.es": "Correos por revisar",
  "conversations.held.empty": "Emails we couldn't match to a customer wait here for you to file.",
  "conversations.held.empty.es": "Aquí esperan los correos que no pudimos vincular con un cliente, para que usted los archive.",
  "conversations.held.loadFailed": "We couldn't load these emails. Reload the page to try again.",
  "conversations.held.loadFailed.es": "No pudimos cargar estos correos. Vuelva a cargar la página para intentarlo de nuevo.",
  "conversations.held.reason.notOnRecord": "Not on this customer's record",
  "conversations.held.reason.notOnRecord.es": "No está en el registro de este cliente",
  "conversations.held.reason.unverified": "Couldn't confirm who sent it",
  "conversations.held.reason.unverified.es": "No pudimos confirmar quién lo envió",
  "conversations.held.suggestion": "A reply to an email sent to {name}",
  "conversations.held.suggestion.es": "Respuesta a un correo enviado a {name}",
  "conversations.held.noSubject": "(no subject)",
  "conversations.held.noSubject.es": "(sin asunto)",
  "conversations.held.fileOn": "File on {name}",
  "conversations.held.fileOn.es": "Archivar con {name}",
  "conversations.held.choose": "Choose a record",
  "conversations.held.choose.es": "Elegir un registro",
  "conversations.held.searchLabel": "Find a customer",
  "conversations.held.searchLabel.es": "Buscar un cliente",
  "conversations.held.searchEmpty": "No customer matches that.",
  "conversations.held.searchEmpty.es": "Ningún cliente coincide con eso.",
  // Addition 2 (coordinator, 2026-10-16): the search call itself failing,
  // distinct from searchEmpty (a real, empty result).
  "conversations.held.searchFailed": "Couldn't search right now. Try again.",
  "conversations.held.searchFailed.es": "No se pudo buscar en este momento. Inténtelo de nuevo.",
  "conversations.held.notCustomer": "Not a customer",
  "conversations.held.notCustomer.es": "No es un cliente",
  "conversations.held.filed": "Filed on {name}.",
  "conversations.held.filed.es": "Archivado con {name}.",
  "conversations.held.dismissed": "Marked as not a customer.",
  "conversations.held.dismissed.es": "Marcado como que no es un cliente.",
  "conversations.held.undone": "Back in Needs a look.",
  "conversations.held.undone.es": "De vuelta en Por revisar.",
  // Addition 2 (coordinator, 2026-10-16): Undo of a File succeeded, but the
  // customer's own emailed stop couldn't be lifted along with it.
  "conversations.held.undoneStopped": "Back in Needs a look, but their emails are still stopped. Open their record to turn them back on.",
  "conversations.held.undoneStopped.es": "De vuelta en Por revisar, pero sus correos siguen detenidos. Abra su ficha para volver a activarlos.",
  "conversations.held.changed": "Someone already handled this email. Reload to see where it is.",
  "conversations.held.changed.es": "Alguien ya atendió este correo. Vuelva a cargar para ver dónde está.",
  "conversations.held.failed": "That didn't save. Try again.",
  "conversations.held.failed.es": "No se guardó. Inténtelo de nuevo.",
  "conversations.reply.fromMember": "from {name}",
  "conversations.reply.fromMember.es": "de {name}",
  "conversations.reply.attachments": "{count} attachments — not saved yet",
  "conversations.reply.attachments.es": "{count} archivos adjuntos — aún no se guardan",
  "conversations.reply.attachmentsOne": "1 attachment — not saved yet",
  "conversations.reply.attachmentsOne.es": "1 archivo adjunto — aún no se guarda",
  "conversations.reply.stopped": "Stopped marketing emails · from their reply",
  "conversations.reply.stopped.es": "Se detuvieron los correos de promoción · por su respuesta",
  "conversations.reply.stopUndone": "Marketing emails are on again.",
  "conversations.reply.stopUndone.es": "Los correos de promoción están activos otra vez.",
  "conversations.reply.maybeStop": "May want to stop",
  "conversations.reply.maybeStop.es": "Quizás quiere dejar de recibirlos",
  "conversations.reply.stopDone": "Emails stopped.",
  "conversations.reply.stopDone.es": "Correos detenidos.",
  // Addition 1 (owner ruling, danlo 2026-10-16): staff can Undo this stop only
  // within 7 days; past that, only the customer can turn emails back on.
  "conversations.reply.stopExpired": "Only the customer can turn these emails back on.",
  "conversations.reply.stopExpired.es": "Solo el cliente puede volver a activar estos correos.",
  "work.heldEmails": "{count} emails need a look",
  "work.heldEmails.es": "{count} correos por revisar",
  "work.heldEmailsOne": "1 email needs a look",
  "work.heldEmailsOne.es": "1 correo por revisar",
  "contact.email.how.reply": "they asked in a reply",
  "contact.email.how.reply.es": "lo pidió en una respuesta",
  // Addition 1 (owner ruling, danlo 2026-10-16): the Email row's own explain
  // line once the automatic reply-stop is past the 7-day Undo window.
  "contact.email.replyExpiredExplain": "Stopped by their reply more than 7 days ago. Only the customer can turn emails back on.",
  "contact.email.replyExpiredExplain.es": "Se detuvo por su respuesta hace más de 7 días. Solo el cliente puede volver a activar los correos.",
  "settings.replies.label": "Replies",
  "settings.replies.label.es": "Respuestas",
  "settings.replies.off": "Off",
  "settings.replies.off.es": "Apagado",
  "settings.replies.bis": "BIS address",
  "settings.replies.bis.es": "Dirección de BIS",
  "settings.replies.own": "Own domain",
  "settings.replies.own.es": "Dominio propio",
  "settings.replies.offBody": "Customers' replies go to the reply-to address on Branding.",
  "settings.replies.offBody.es": "Las respuestas de los clientes van a la dirección de respuesta de Marca.",
  "settings.replies.bisBody": "Customers reply to an address at reply.bis-rgv.com, and the reply lands on their thread here.",
  "settings.replies.bisBody.es": "Los clientes responden a una dirección en reply.bis-rgv.com, y la respuesta llega a su conversación aquí.",
  "settings.replies.ownBody": "Customers reply to an address at {domain}, and the reply lands on their thread here.",
  "settings.replies.ownBody.es": "Los clientes responden a una dirección en {domain}, y la respuesta llega a su conversación aquí.",
  "settings.replies.domainLabel": "Reply domain",
  "settings.replies.domainLabel.es": "Dominio de respuesta",
  "settings.replies.domainPlaceholder": "reply.example.com",
  "settings.replies.domainPlaceholder.es": "reply.ejemplo.com",
  "settings.replies.checkDns": "Check DNS",
  "settings.replies.checkDns.es": "Revisar DNS",
  "settings.replies.dnsOk": "The MX record points at Resend. You can use this domain.",
  "settings.replies.dnsOk.es": "El registro MX apunta a Resend. Puede usar este dominio.",
  "settings.replies.dnsMissing": "No MX record on {domain} points at Resend yet. Add it, then check again.",
  "settings.replies.dnsMissing.es": "Aún no hay un registro MX en {domain} que apunte a Resend. Agréguelo y vuelva a revisar.",
  "settings.replies.dnsFailed": "We couldn't look up {domain}. Check the spelling and try again.",
  "settings.replies.dnsFailed.es": "No pudimos consultar {domain}. Revise cómo está escrito e inténtelo de nuevo.",
  "settings.replies.invalidDomain": "Enter a domain like reply.example.com.",
  "settings.replies.invalidDomain.es": "Escriba un dominio como reply.example.com.",
  "settings.replies.domainTaken": "Another account already uses that domain.",
  "settings.replies.domainTaken.es": "Otra cuenta ya usa ese dominio.",
  "settings.replies.saved": "Replies: {mode}.",
  "settings.replies.saved.es": "Respuestas: {mode}.",
  "settings.replies.undone": "Replies are back to {mode}.",
  "settings.replies.undone.es": "Las respuestas volvieron a {mode}.",
  "branding.replies.agency": "Customer replies come back into BIS at {domain}; the reply-to address above gets a copy.",
  "branding.replies.agency.es": "Las respuestas de los clientes regresan a BIS en {domain}; la dirección de respuesta de arriba recibe una copia.",
  "branding.replies.client": "Your customers' replies come back into BIS at {domain}, and a copy goes to the reply-to address above.",
  "branding.replies.client.es": "Las respuestas de sus clientes regresan a BIS en {domain}, y una copia llega a la dirección de respuesta de arriba.",
  "email.replyForward.fromName": "{customer} via {business}",
  "email.replyForward.fromName.es": "{customer} vía {business}",
  "email.replyForward.answer": "Answer in BIS",
  "email.replyForward.answer.es": "Responder en BIS",
  "email.replyForward.attachments": "This email had {count} attachments. They are not saved in BIS yet.",
  "email.replyForward.attachments.es": "Este correo traía {count} archivos adjuntos. Aún no se guardan en BIS.",
  "email.replyForward.attachmentsOne": "This email had 1 attachment. It is not saved in BIS yet.",
  "email.replyForward.attachmentsOne.es": "Este correo traía 1 archivo adjunto. Aún no se guarda en BIS.",
  "contact.forwarding.label": "Forwarding address",
  "contact.forwarding.label.es": "Dirección para reenviar",
  "contact.forwarding.hint": "Forward an email here to save it on this customer.",
  "contact.forwarding.hint.es": "Reenvíe un correo a esta dirección para guardarlo con este cliente.",
  "contact.forwarding.copy": "Copy",
  "contact.forwarding.copy.es": "Copiar",
  "contact.forwarding.copyLabel": "Copy the forwarding address",
  "contact.forwarding.copyLabel.es": "Copiar la dirección para reenviar",
  "contact.forwarding.copied": "Copied",
  "contact.forwarding.copied.es": "Copiado",
  "contact.forwarding.copyFailed": "Couldn't copy. Select the address and copy it by hand.",
  "contact.forwarding.copyFailed.es": "No se pudo copiar. Seleccione la dirección y cópiela a mano.",
  "contact.forwarding.turnOn": "Turn on Replies in Settings to get a forwarding address",
  "contact.forwarding.turnOn.es": "Active Respuestas en Ajustes para obtener una dirección para reenviar",
  "contact.forwarding.get": "Get forwarding address",
  "contact.forwarding.get.es": "Obtener dirección para reenviar",
  "contact.forwarding.getFailed": "We couldn't make the forwarding address. Try again.",
  "contact.forwarding.getFailed.es": "No pudimos crear la dirección para reenviar. Inténtelo de nuevo.",
  "contact.forwarding.failed": "We couldn't load the forwarding address. Reload the page to try again.",
  "contact.forwarding.failed.es": "No pudimos cargar la dirección para reenviar. Vuelva a cargar la página para intentarlo de nuevo.",
  "conversations.forward.by": "Forwarded by {name} · team",
  "conversations.forward.by.es": "Reenviado por {name} · equipo",
  "conversations.forward.bySomeone": "Forwarded by someone on the team",
  "conversations.forward.bySomeone.es": "Reenviado por alguien del equipo",
  "neverLog.title": "Never record",
  "neverLog.title.es": "No registrar nunca",
  "neverLog.body": "Mail from these addresses or domains is dropped and never saved, even when it comes from a customer.",
  "neverLog.body.es": "El correo de estas direcciones o dominios se descarta y nunca se guarda, aunque venga de un cliente.",
  "neverLog.empty": "Mail from addresses or domains you add here is never saved.",
  "neverLog.empty.es": "El correo de las direcciones o dominios que agregue aquí nunca se guarda.",
  "neverLog.loadFailed": "We couldn't load this list. Reload the page to try again.",
  "neverLog.loadFailed.es": "No pudimos cargar esta lista. Vuelva a cargar la página para intentarlo de nuevo.",
  "neverLog.inputLabel": "Address or domain",
  "neverLog.inputLabel.es": "Dirección o dominio",
  "neverLog.placeholder": "billing@supplier.com or supplier.com",
  "neverLog.placeholder.es": "facturas@proveedor.com o proveedor.com",
  "neverLog.add": "Add",
  "neverLog.add.es": "Agregar",
  "neverLog.remove": "Remove",
  "neverLog.remove.es": "Quitar",
  "neverLog.removeLabel": "Remove {pattern}",
  "neverLog.removeLabel.es": "Quitar {pattern}",
  "neverLog.kind.address": "Address",
  "neverLog.kind.address.es": "Dirección",
  "neverLog.kind.domain": "Whole domain",
  "neverLog.kind.domain.es": "Todo el dominio",
  "neverLog.added": "Mail from {pattern} will never be saved.",
  "neverLog.added.es": "El correo de {pattern} nunca se guardará.",
  "neverLog.removed": "{pattern} is off the list.",
  "neverLog.removed.es": "{pattern} ya no está en la lista.",
  "neverLog.undone": "Back as it was.",
  "neverLog.undone.es": "Quedó como estaba.",
  "neverLog.duplicate": "Already on the list.",
  "neverLog.duplicate.es": "Ya está en la lista.",
  "neverLog.invalid": "Enter an address like name@example.com or a domain like example.com.",
  "neverLog.invalid.es": "Escriba una dirección como nombre@ejemplo.com o un dominio como ejemplo.com.",
  "neverLog.full": "The list is full (200). Remove one to add another.",
  "neverLog.full.es": "La lista está llena (200). Quite una para agregar otra.",
  "neverLog.failed": "That didn't save. Try again.",
  "neverLog.failed.es": "No se guardó. Inténtelo de nuevo.",

  // S-06 part 3: web chat in the inbox and on the record (plan Task 1).
  "conversations.compose.via": "Reply by",
  "conversations.compose.via.es": "Responder por",
  "conversations.webchat.unconfirmed": "Matched by the phone or email they typed; not confirmed.",
  "conversations.webchat.unconfirmed.es": "Lo relacionamos por el teléfono o el correo que escribió; no está confirmado.",
  "timeline.webchat": "chatted with {name} on your website",
  "timeline.webchat.es": "conversó con {name} en su sitio web",
  "timeline.webchatCount": "{count} messages",
  "timeline.webchatCount.es": "{count} mensajes",
  "timeline.webchatCountOne": "1 message",
  "timeline.webchatCountOne.es": "1 mensaje",
  "timeline.what.chats": "website chats",
  "timeline.what.chats.es": "chats del sitio web",
  "timeline.openChat": "Open chat",
  "timeline.openChat.es": "Ver chat",
  "record.facts.channel.chat": "website chat",
  "record.facts.channel.chat.es": "chat del sitio web",

  // S-07 3b: share links (plan 2026-10-18-document-vault-pr3b.md).
  "documents.share": "Copy share link",
  "documents.share.es": "Copiar enlace para compartir",
  "documents.share.copied": "Link copied. It works for 24 hours.",
  "documents.share.copied.es": "Enlace copiado. Funciona por 24 horas.",
  "documents.share.live": "Shared · expires in {hours} h",
  "documents.share.live.es": "Compartido · vence en {hours} h",
  "documents.share.stop": "Stop sharing",
  "documents.share.stop.es": "Dejar de compartir",
  "documents.share.stopped": "Stopped sharing {title}.",
  "documents.share.stopped.es": "Ya no se comparte {title}.",
  "documents.share.failed": "Couldn't make a link. Try again.",
  "documents.share.failed.es": "No se pudo crear el enlace. Intente de nuevo.",
  "documents.share.ownersOnlyRole": "Only an Owner can share a file marked Owners only.",
  "documents.share.ownersOnlyRole.es": "Solo un dueño puede compartir un archivo marcado Solo dueños.",
  "documents.share.notShared": "This file has no link to stop.",
  "documents.share.notShared.es": "Este archivo no tiene un enlace que detener.",
  "documents.share.ended": "That link has already ended, so nothing was undone.",
  "documents.share.ended.es": "Ese enlace ya terminó, así que no se deshizo nada.",
  "documents.share.refused": "You can't share that file.",
  "documents.share.refused.es": "No puede compartir ese archivo.",
  "timeline.documentShared": "shared {title}",
  "timeline.documentShared.es": "compartió {title}",
  "timeline.documentShareOpened": "opened {title}",
  "timeline.documentShareOpened.es": "abrió {title}",
  "provenance.linkRecipient": "The link's recipient",
  "provenance.linkRecipient.es": "Quien recibió el enlace",
  "sharePage.pageTitle": "A file from {business}",
  "sharePage.pageTitle.es": "Un archivo de {business}",
  "sharePage.pageTitleNoName": "A shared file",
  "sharePage.pageTitleNoName.es": "Un archivo compartido",
  "sharePage.heading": "{business} shared a file with you",
  "sharePage.heading.es": "{business} compartió un archivo con usted",
  "sharePage.headingNoName": "A file was shared with you",
  "sharePage.headingNoName.es": "Se compartió un archivo con usted",
  "sharePage.details": "{type} file · {size}",
  "sharePage.details.es": "Archivo {type} · {size}",
  "sharePage.download": "Download",
  "sharePage.download.es": "Descargar",
  "sharePage.limit": "Too many downloads from here. Try again in a few minutes.",
  "sharePage.limit.es": "Demasiadas descargas desde aquí. Intente de nuevo en unos minutos.",
  "sharePage.failed": "The download didn't start. Try again.",
  "sharePage.failed.es": "La descarga no empezó. Intente de nuevo.",
  "sharePage.revoked": "This link was turned off.",
  "sharePage.revoked.es": "Este enlace se desactivó.",
  "sharePage.trashed": "This file isn't available any more.",
  "sharePage.trashed.es": "Este archivo ya no está disponible.",
  "sharePage.removed": "This file was removed for safety.",
  "sharePage.removed.es": "Este archivo se quitó por seguridad.",
  "sharePage.ask": "Ask {business} to send it again.",
  "sharePage.ask.es": "Pida a {business} que se lo envíe de nuevo.",
  "sharePage.askNoName": "Ask the business that sent it to send it again.",
  "sharePage.askNoName.es": "Pida al negocio que se lo envió que lo mande de nuevo.",

  // Item 8a-1: the agency's AI card on the account's Settings (spec 3.6). Agency-only; no vendor words.
  "aiSettings.title": "AI",
  "aiSettings.title.es": "IA",
  "aiSettings.description": "What the summaries, cards and suggestions below cost this account, and the switches that turn them off. Sofía's phone calls and the website chat use AI too, but have their own switches, on the Voice page.",
  "aiSettings.description.es": "Lo que cuestan los resúmenes, las tarjetas y las sugerencias de abajo en esta cuenta, y los interruptores que los apagan. Las llamadas telefónicas de Sofía y el chat del sitio también usan IA, pero tienen sus propios interruptores, en la página de Voz.",
  "aiSettings.account.label": "AI for this account",
  "aiSettings.account.label.es": "IA para esta cuenta",
  "aiSettings.account.help": "Off: no written call summary, no \"why they called\" card, and no suggestions — just what Sofía recorded live. Customer pages show no written summary either. Sofía still answers calls and the website chat still runs; those have their own switches, on the Voice page.",
  "aiSettings.account.help.es": "Apagada: sin resumen de llamada, sin tarjeta de \"por qué llamó\" y sin sugerencias — solo lo que Sofía registró en vivo. Las páginas de clientes tampoco muestran un resumen escrito. Sofía sigue atendiendo llamadas y el chat del sitio sigue funcionando; esos tienen sus propios interruptores, en la página de Voz.",
  "aiSettings.budget.label": "Monthly AI budget",
  "aiSettings.budget.label.es": "Presupuesto mensual de IA",
  "aiSettings.budget.help": "In whole dollars, from $0 to $1,000. Summaries, cards and suggestions pause for this account when this month's estimated spend reaches it.",
  "aiSettings.budget.help.es": "En dólares enteros, de $0 a $1,000. Los resúmenes, las tarjetas y las sugerencias se pausan en esta cuenta cuando el gasto estimado del mes lo alcanza.",
  "aiSettings.spend": "{spent} of {budget} this month, estimated",
  "aiSettings.spend.es": "{spent} de {budget} este mes, estimado",
  "aiSettings.empty": "No AI use yet this month.",
  "aiSettings.empty.es": "Todavía no hay uso de IA este mes.",
  "aiSettings.reached": "Budget reached on {date}. Summaries, cards and suggestions are paused for this account until {resume}.",
  "aiSettings.reached.es": "Presupuesto alcanzado el {date}. Los resúmenes, las tarjetas y las sugerencias están en pausa en esta cuenta hasta el {resume}.",
  "aiSettings.reachedNoDate": "Budget reached. Summaries, cards and suggestions are paused for this account until {resume}.",
  "aiSettings.reachedNoDate.es": "Presupuesto alcanzado. Los resúmenes, las tarjetas y las sugerencias están en pausa en esta cuenta hasta el {resume}.",
  "aiSettings.zeroBudget": "Budget is $0. Summaries, cards and suggestions are off for this account until the budget is raised.",
  "aiSettings.zeroBudget.es": "El presupuesto es $0. Los resúmenes, las tarjetas y las sugerencias están apagados en esta cuenta hasta que se suba el presupuesto.",
  "aiSettings.skipped": "Summaries, cards and suggestions were skipped {count} times this month because this account's AI was off or over budget.",
  "aiSettings.skipped.es": "Los resúmenes, las tarjetas y las sugerencias se omitieron {count} veces este mes porque la IA de esta cuenta estaba apagada o sin presupuesto.",
  "aiSettings.skippedOne": "Summaries, cards and suggestions were skipped once this month because this account's AI was off or over budget.",
  "aiSettings.skippedOne.es": "Los resúmenes, las tarjetas y las sugerencias se omitieron una vez este mes porque la IA de esta cuenta estaba apagada o sin presupuesto.",
  "aiSettings.save": "Save",
  "aiSettings.save.es": "Guardar",
  "aiSettings.saved": "Saved. This account's AI settings are updated.",
  "aiSettings.saved.es": "Guardado. La configuración de IA de esta cuenta está actualizada.",
  "aiSettings.undone": "Put back the earlier AI settings.",
  "aiSettings.undone.es": "Se restauró la configuración de IA anterior.",
  "aiSettings.error.budget": "Enter a whole-dollar amount from $0 to $1,000.",
  "aiSettings.error.budget.es": "Escriba una cantidad en dólares enteros de $0 a $1,000.",
  "aiSettings.error.failed": "Couldn't save the AI settings. Try again.",
  "aiSettings.error.failed.es": "No se pudo guardar la configuración de IA. Inténtelo de nuevo.",
  "aiSettings.crashed": "Something went wrong. Reload the page and try again.",
  "aiSettings.crashed.es": "Algo salió mal. Vuelva a cargar la página e inténtelo de nuevo.",
  "aiSettings.loadError": "The AI settings couldn't load right now. The rest of Settings still works.",
  "aiSettings.loadError.es": "La configuración de IA no se pudo cargar ahora. El resto de la configuración sigue funcionando.",
  "aiSettings.global.label": "AI for every account",
  "aiSettings.global.label.es": "IA para todas las cuentas",
  "aiSettings.global.onHelp": "On. Turning it off stops summaries, cards and suggestions in every account at once. Sofía's calls and every account's website chat keep running; those switches are on each account's Voice page.",
  "aiSettings.global.onHelp.es": "Encendida. Al apagarla, se detienen los resúmenes, las tarjetas y las sugerencias en todas las cuentas a la vez. Las llamadas de Sofía y el chat del sitio de cada cuenta siguen funcionando; esos interruptores están en la página de Voz de cada cuenta.",
  "aiSettings.global.offHelp": "Off in every account: no summaries, cards or suggestions until you turn it back on. Sofía still answers calls, and every account's website chat still runs.",
  "aiSettings.global.offHelp.es": "Apagada en todas las cuentas: sin resúmenes, tarjetas ni sugerencias hasta que la vuelva a encender. Sofía sigue atendiendo llamadas, y el chat del sitio de cada cuenta sigue funcionando.",
  "aiSettings.global.turnOff": "Turn off everywhere",
  "aiSettings.global.turnOff.es": "Apagar en todas",
  "aiSettings.global.turnOn": "Turn on everywhere",
  "aiSettings.global.turnOn.es": "Encender en todas",
  "aiSettings.global.confirmTitle": "Turn off summaries, cards and suggestions everywhere",
  "aiSettings.global.confirmTitle.es": "Apagar los resúmenes, las tarjetas y las sugerencias en todas las cuentas",
  "aiSettings.global.confirmBody": "Every account loses call summaries, call cards, suggestions and customer summaries until this is turned back on. Sofía's calls and the website chat are not affected. Type {word} to confirm.",
  "aiSettings.global.confirmBody.es": "Todas las cuentas pierden los resúmenes de llamada, las tarjetas de llamada, las sugerencias y los resúmenes de clientes hasta que esto se vuelva a encender. Las llamadas de Sofía y el chat del sitio no se ven afectados. Escriba {word} para confirmar.",
  "aiSettings.global.confirmWord": "OFF",
  "aiSettings.global.confirmWord.es": "APAGAR",
  "aiSettings.global.confirmLabel": "Type the word",
  "aiSettings.global.confirmLabel.es": "Escriba la palabra",
  "aiSettings.global.cancel": "Cancel",
  "aiSettings.global.cancel.es": "Cancelar",
  "aiSettings.global.turnedOff": "Summaries, cards and suggestions are off in every account.",
  "aiSettings.global.turnedOff.es": "Los resúmenes, las tarjetas y las sugerencias están apagados en todas las cuentas.",
  "aiSettings.global.turnedOn": "Summaries, cards and suggestions are back on in every account.",
  "aiSettings.global.turnedOn.es": "Los resúmenes, las tarjetas y las sugerencias volvieron a encenderse en todas las cuentas.",
  "aiSettings.global.wrongWord": "Type {word} to turn off summaries, cards and suggestions everywhere.",
  "aiSettings.global.wrongWord.es": "Escriba {word} para apagar los resúmenes, las tarjetas y las sugerencias en todas las cuentas.",
  "palette.settings.ai": "AI",
  "palette.settings.ai.es": "IA",

  // Item 8a-2: the record page's AI summary (spec 4.6, 4.8) and the AI card's day line (spec 3.6). No vendor words.
  "record.ai.label": "Generated by AI · {time}",
  "record.ai.label.es": "Generado por IA · {time}",
  "record.ai.regenerate": "Regenerate",
  "record.ai.regenerate.es": "Volver a generar",
  "record.ai.capped": "AI summaries are paused until tomorrow.",
  "record.ai.capped.es": "Los resúmenes con IA vuelven mañana.",
  "record.ai.failed": "Couldn't write the summary just now.",
  "record.ai.failed.es": "No se pudo escribir el resumen ahora.",
  "record.ai.writing": "Writing the summary…",
  "record.ai.writing.es": "Escribiendo el resumen…",
  "aiSettings.summariesToday": "{count} of {cap} customer summaries written today",
  "aiSettings.summariesToday.es": "{count} de {cap} resúmenes de clientes escritos hoy",

  // Item 8b-1: the suggestion card, the tray and every answer a decision gives (spec 4.5, 4.7, 7).
  "suggestions.heading": "Suggestions",
  "suggestions.heading.es": "Sugerencias",
  "suggestions.subhead": "From {persona}. Nothing changes until you accept.",
  "suggestions.subhead.es": "De {persona}. Nada cambia hasta que usted acepte.",
  "suggestions.cap": "Showing the newest {n}.",
  "suggestions.cap.es": "Se muestran las {n} más recientes.",
  "suggestions.loadFailed": "Couldn't load suggestions.",
  "suggestions.loadFailed.es": "No se pudieron cargar las sugerencias.",
  "suggestions.loading": "Loading suggestions…",
  "suggestions.loading.es": "Cargando sugerencias…",
  "suggestions.source.call": "From the call on {date} · {caller}",
  "suggestions.source.call.es": "De la llamada del {date} · {caller}",
  "suggestions.source.callNoName": "From the call on {date}",
  "suggestions.source.callNoName.es": "De la llamada del {date}",
  "suggestions.evidence": "Because the caller said",
  "suggestions.evidence.es": "Porque quien llamó dijo",
  "suggestions.status.pending": "Suggested",
  "suggestions.status.pending.es": "Sugerida",
  "suggestions.status.accepted": "Accepted",
  "suggestions.status.accepted.es": "Aceptada",
  "suggestions.status.edited": "Edited",
  "suggestions.status.edited.es": "Editada",
  "suggestions.status.dismissed": "Discarded",
  "suggestions.status.dismissed.es": "Descartada",
  "suggestions.status.expired": "Out of date",
  "suggestions.status.expired.es": "Ya no aplica",
  "suggestions.decided.accepted": "Accepted by {name} · {time}",
  "suggestions.decided.accepted.es": "Aceptada por {name} · {time}",
  "suggestions.decided.edited": "Edited by {name} · {time}",
  "suggestions.decided.edited.es": "Editada por {name} · {time}",
  "suggestions.decided.dismissed": "Discarded by {name} · {time}",
  "suggestions.decided.dismissed.es": "Descartada por {name} · {time}",
  "suggestions.decided.expired": "Marked out of date · {time}",
  "suggestions.decided.expired.es": "Se marcó que ya no aplica · {time}",
  // The unnamed decider inside a decided line ("Discarded by someone on the team"): lowercase, because
  // it is mid-sentence. The standalone author mark keeps assign.someone's capital (DESIGN.md, Provenance).
  "suggestions.decided.someone": "someone on the team",
  "suggestions.decided.someone.es": "alguien del equipo",
  "suggestions.decided.acceptedByYou": "Accepted by you · {time}",
  "suggestions.decided.acceptedByYou.es": "Aceptada por usted · {time}",
  "suggestions.decided.editedByYou": "Edited by you · {time}",
  "suggestions.decided.editedByYou.es": "Editada por usted · {time}",
  "suggestions.decided.dismissedByYou": "Discarded by you · {time}",
  "suggestions.decided.dismissedByYou.es": "Descartada por usted · {time}",
  "suggestions.accept": "Accept",
  "suggestions.accept.es": "Aceptar",
  "suggestions.editAccept": "Edit and accept",
  "suggestions.editAccept.es": "Editar y aceptar",
  "suggestions.discard": "Discard",
  "suggestions.discard.es": "Descartar",
  "suggestions.saveAccept": "Save and accept",
  "suggestions.saveAccept.es": "Guardar y aceptar",
  "suggestions.cancel": "Cancel",
  "suggestions.cancel.es": "Cancelar",
  "suggestions.task": "Add a to-do: {title}",
  "suggestions.task.es": "Agregar un pendiente: {title}",
  "suggestions.due": "Due {date}",
  "suggestions.due.es": "Vence el {date}",
  "suggestions.wasDue": "Was due {date}",
  "suggestions.wasDue.es": "Vencía el {date}",
  "suggestions.field": "{field}: (empty) → {value}",
  "suggestions.field.es": "{field}: (vacío) → {value}",
  // What a screen reader hears in place of the drawn arrow in "{field}: (empty) → {value}".
  "suggestions.field.arrow": "to",
  "suggestions.field.arrow.es": "a",
  "suggestions.field.firstName": "First name",
  "suggestions.field.firstName.es": "Nombre",
  "suggestions.field.lastName": "Last name",
  "suggestions.field.lastName.es": "Apellido",
  "suggestions.field.email": "Email",
  "suggestions.field.email.es": "Correo",
  "suggestions.field.phone": "Phone",
  "suggestions.field.phone.es": "Teléfono",
  "suggestions.stage": "Move from {from} to {to}",
  "suggestions.stage.es": "Mover de {from} a {to}",
  "suggestions.stage.skipped": "{count} stages are skipped in between.",
  "suggestions.stage.skipped.es": "Se saltan {count} etapas.",
  "suggestions.stage.skippedOne": "A stage is skipped in between.",
  "suggestions.stage.skippedOne.es": "Se salta una etapa.",
  "suggestions.stage.unresolved": "Review the stage change on this deal.",
  "suggestions.stage.unresolved.es": "Revise el cambio de etapa de esta oportunidad.",
  "suggestions.toast.task": "Added to your to-do list",
  "suggestions.toast.task.es": "Agregado a sus pendientes",
  "suggestions.toast.field": "{field} saved",
  "suggestions.toast.field.es": "{field} guardado",
  "suggestions.toast.stage": "Moved to {stage}",
  "suggestions.toast.stage.es": "Movido a {stage}",
  "suggestions.toast.dismissed": "Discarded",
  "suggestions.toast.dismissed.es": "Descartada",
  "suggestions.undone": "Undone.",
  "suggestions.undone.es": "Se deshizo.",
  "suggestions.undoneDuplicate": "Undone. The possible duplicate it found is still in Duplicates.",
  "suggestions.undoneDuplicate.es": "Se deshizo. El posible duplicado que encontró sigue en Duplicados.",
  "suggestions.answer.unavailable": "This suggestion isn't available.",
  "suggestions.answer.unavailable.es": "Esta sugerencia no está disponible.",
  "suggestions.answer.answeredBy": "{name} already answered this one.",
  "suggestions.answer.answeredBy.es": "{name} ya respondió esta.",
  "suggestions.answer.answeredBySomeone": "Someone on the team already answered this one.",
  "suggestions.answer.answeredBySomeone.es": "Alguien del equipo ya respondió esta.",
  "suggestions.answer.pastDue": "Its due date has passed. Use Edit and accept to pick a new one.",
  "suggestions.answer.pastDue.es": "Su fecha ya pasó. Use Editar y aceptar para elegir otra.",
  "suggestions.answer.maybeFailed": "That may not have gone through. Check before trying again.",
  "suggestions.answer.maybeFailed.es": "Puede que no se haya guardado. Revise antes de intentarlo otra vez.",
  "suggestions.answer.failed": "That didn't go through. Try again.",
  "suggestions.answer.failed.es": "No se guardó. Inténtelo otra vez.",
  "suggestions.answer.tooLate": "Too late to undo here. Change it by hand.",
  "suggestions.answer.tooLate.es": "Ya no se puede deshacer aquí. Cámbielo a mano.",
  "suggestions.answer.changed": "It has changed since. Change it by hand.",
  "suggestions.answer.changed.es": "Cambió desde entonces. Cámbielo a mano.",
  "suggestions.answer.undoStranded": "The change was undone, but this suggestion didn't update. Refresh before doing anything else.",
  "suggestions.answer.undoStranded.es": "El cambio se deshizo, pero esta sugerencia no se actualizó. Actualice la página antes de hacer otra cosa.",
  "suggestions.out.field_filled": "Out of date: the {field} was filled in since.",
  "suggestions.out.field_filled.es": "Ya no aplica: el {field} se llenó después.",
  "suggestions.out.name_mismatch": "Out of date: the name on file doesn't match this caller.",
  "suggestions.out.name_mismatch.es": "Ya no aplica: el nombre registrado no coincide con quien llamó.",
  "suggestions.out.deal_moved": "Out of date: this deal has moved since.",
  "suggestions.out.deal_moved.es": "Ya no aplica: esta oportunidad cambió de etapa.",
  "suggestions.out.deal_closed": "Out of date: this deal has been closed.",
  "suggestions.out.deal_closed.es": "Ya no aplica: esta oportunidad se cerró.",
  "suggestions.out.deal_gone": "Out of date: this deal was deleted.",
  "suggestions.out.deal_gone.es": "Ya no aplica: esta oportunidad se eliminó.",
  "suggestions.out.aged": "Out of date: this suggestion is more than 30 days old.",
  "suggestions.out.aged.es": "Ya no aplica: esta sugerencia tiene más de 30 días.",
  "suggestions.out.superseded": "Out of date: another suggestion covered this.",
  "suggestions.out.superseded.es": "Ya no aplica: otra sugerencia ya lo cubrió.",
  "suggestions.reason.field_filled": "The {field} was filled in since.",
  "suggestions.reason.field_filled.es": "El {field} se llenó después.",
  "suggestions.reason.name_mismatch": "The name on file doesn't match this caller.",
  "suggestions.reason.name_mismatch.es": "El nombre registrado no coincide con quien llamó.",
  "suggestions.reason.deal_moved": "This deal has moved since.",
  "suggestions.reason.deal_moved.es": "Esta oportunidad cambió de etapa.",
  "suggestions.reason.deal_closed": "This deal has been closed.",
  "suggestions.reason.deal_closed.es": "Esta oportunidad se cerró.",
  "suggestions.reason.deal_gone": "This deal was deleted.",
  "suggestions.reason.deal_gone.es": "Esta oportunidad se eliminó.",
  "suggestions.reason.aged": "More than 30 days old.",
  "suggestions.reason.aged.es": "Tiene más de 30 días.",
  "suggestions.reason.superseded": "Another suggestion covered this.",
  "suggestions.reason.superseded.es": "Otra sugerencia ya lo cubrió.",
  "suggestions.edit.title": "Title",
  "suggestions.edit.title.es": "Título",
  "suggestions.edit.due": "Due date",
  "suggestions.edit.due.es": "Fecha",
  "suggestions.edit.stage": "Stage",
  "suggestions.edit.stage.es": "Etapa",
  "suggestions.edit.titleRequired": "Write a title.",
  "suggestions.edit.titleRequired.es": "Escriba un título.",
  "suggestions.edit.titleTooLong": "Keep the title under 200 characters.",
  "suggestions.edit.titleTooLong.es": "Use menos de 200 caracteres en el título.",
  "suggestions.edit.dueInvalid": "Pick a date from today to a year from now.",
  "suggestions.edit.dueInvalid.es": "Elija una fecha entre hoy y dentro de un año.",
  "suggestions.edit.valueRequired": "Write a value.",
  "suggestions.edit.valueRequired.es": "Escriba un valor.",
  "suggestions.edit.phoneInvalid": "That doesn't look like a phone number.",
  "suggestions.edit.phoneInvalid.es": "Eso no parece un número de teléfono.",
  "suggestions.edit.emailInvalid": "That doesn't look like an email address.",
  "suggestions.edit.emailInvalid.es": "Eso no parece un correo electrónico.",
  "suggestions.edit.stageInvalid": "Pick a later stage that isn't the last one.",
  "suggestions.edit.stageInvalid.es": "Elija una etapa posterior que no sea la última.",
  // Item 8b-2, the tray everywhere: groups in the To do tray and on the
  // agency Work page, the record's flat "Waiting for you" section, the
  // transcript deep link and the client-side unreachable/reload answer.
  "suggestions.group.call": "{name} · from the call on {date}",
  "suggestions.group.call.es": "{name} · de la llamada del {date}",
  "suggestions.group.noCustomer": "No customer yet",
  "suggestions.group.noCustomer.es": "Sin cliente todavía",
  "suggestions.capAccount": "Showing the newest {n} for this account.",
  "suggestions.capAccount.es": "Se muestran las {n} más recientes de esta cuenta.",
  "suggestions.waiting.heading": "Waiting for you",
  "suggestions.waiting.heading.es": "Esperan su respuesta",
  "suggestions.waiting.seeAll": "Edit or see all in To do",
  "suggestions.waiting.seeAll.es": "Editar o ver todas en Pendientes",
  "suggestions.transcript": "See it in the transcript · {time}",
  "suggestions.transcript.es": "Ver en la transcripción · {time}",
  "suggestions.transcript.noTime": "See it in the transcript",
  "suggestions.transcript.noTime.es": "Ver en la transcripción",
  "suggestions.answer.unreachable": "That didn't reach us. Reload the page, then check before trying again.",
  "suggestions.answer.unreachable.es": "No nos llegó. Recargue la página y revise antes de intentarlo otra vez.",
  "suggestions.reload": "Reload",
  "suggestions.reload.es": "Recargar",

  // Sofía's live acts, visible and reversible (item 8c). The timeline row
  // itself, its ghost Undo while still safe, the reason once it is not, the
  // "Undone by …" mark, the booking-undo customer notice, and the created-by
  // fact on a contact. Reuses common.undo, common.cancel and provenance.ai
  // rather than duplicating them — see messages.test.ts's Task 2 describe.
  "timeline.what.aiActs": "the assistant's actions",
  "timeline.what.aiActs.es": "las acciones de la asistente",
  "aiActs.verb.booked": "booked {when}",
  "aiActs.verb.booked.es": "reservó {when}",
  "aiActs.verb.rescheduled": "moved a booking to {when}",
  "aiActs.verb.rescheduled.es": "movió una cita al {when}",
  "aiActs.detail.movedFrom": "From {when}",
  "aiActs.detail.movedFrom.es": "Antes: {when}",
  "aiActs.verb.cancelled": "cancelled the booking on {when}",
  "aiActs.verb.cancelled.es": "canceló la cita del {when}",
  "aiActs.verb.contactCreated": "added this customer",
  "aiActs.verb.contactCreated.es": "agregó a este cliente",
  "aiActs.verb.fieldFilled": "filled in the {field}: {value}",
  "aiActs.verb.fieldFilled.es": "completó {field}: {value}",
  "aiActs.field.firstName": "first name",
  "aiActs.field.firstName.es": "el nombre",
  "aiActs.field.lastName": "last name",
  "aiActs.field.lastName.es": "el apellido",
  "aiActs.field.email": "email",
  "aiActs.field.email.es": "el correo",
  "aiActs.field.phone": "phone number",
  "aiActs.field.phone.es": "el teléfono",
  "aiActs.source.call": "From the call on {date}",
  "aiActs.source.call.es": "De la llamada del {date}",
  "aiActs.source.webchat": "From the website chat",
  "aiActs.source.webchat.es": "Del chat del sitio web",
  "aiActs.reason.alreadyCancelled": "Already cancelled",
  "aiActs.reason.alreadyCancelled.es": "Ya se canceló",
  "aiActs.reason.alreadyHappened": "Already happened",
  "aiActs.reason.alreadyHappened.es": "Ya pasó",
  "aiActs.reason.rebooked": "Already re-booked",
  "aiActs.reason.rebooked.es": "Ya se volvió a reservar",
  "aiActs.reason.timePassed": "The time has passed",
  "aiActs.reason.timePassed.es": "La hora ya pasó",
  "aiActs.reason.timeTaken": "That time is taken now",
  "aiActs.reason.timeTaken.es": "Esa hora ya está ocupada",
  "aiActs.reason.oldTimeTaken": "The old time is taken",
  "aiActs.reason.oldTimeTaken.es": "La hora anterior ya está ocupada",
  "aiActs.reason.changed": "Changed since then",
  "aiActs.reason.changed.es": "Cambió desde entonces",
  "aiActs.reason.changedBy": "Changed by {name} since",
  "aiActs.reason.changedBy.es": "{name} lo cambió después",
  "aiActs.reason.hasActivity": "They've had other activity since",
  "aiActs.reason.hasActivity.es": "Ha tenido otra actividad desde entonces",
  "aiActs.reason.hasBooking": "They have a booking, so they stay",
  "aiActs.reason.hasBooking.es": "Tiene una cita, así que se queda",
  "aiActs.reason.otherBooking": "They booked another time since",
  "aiActs.reason.otherBooking.es": "Reservó otra hora desde entonces",
  "aiActs.reason.ownerOnly": "Only an Owner can remove a customer",
  "aiActs.reason.ownerOnly.es": "Solo el Dueño puede quitar a un cliente",
  "aiActs.undoneBy": "Undone by {name} · {date}",
  "aiActs.undoneBy.es": "Deshecho por {name} · {date}",
  "aiActs.notify.label": "Let {name} know by email",
  "aiActs.notify.label.es": "Avisarle a {name} por correo",
  "aiActs.notify.noEmail": "{name} has no email on file, so they won't be told. Call them if they need to know.",
  "aiActs.notify.noEmail.es": "Este cliente no tiene correo registrado, así que no se le avisará. Llámele si {name} necesita saberlo.",
  "aiActs.toast.fieldUndone": "Put back the earlier {field}.",
  "aiActs.toast.fieldUndone.es": "Se restauró {field} anterior.",
  "aiActs.toast.fieldRedone": "{persona}'s {field} is back.",
  "aiActs.toast.fieldRedone.es": "Volvió {field} que puso {persona}.",
  "aiActs.toast.bookingUndone": "Booking undone.",
  "aiActs.toast.bookingUndone.es": "Se deshizo la cita.",
  "aiActs.toast.bookingUndoneTold": "Booking undone. {name} was emailed.",
  "aiActs.toast.bookingUndoneTold.es": "Se deshizo la cita. Se le envió un correo a {name}.",
  "aiActs.toast.bookingUndoneNotTold": "Booking undone. The email to {name} didn't go out.",
  "aiActs.toast.bookingUndoneNotTold.es": "Se deshizo la cita. El correo a {name} no se envió.",
  "aiActs.toast.contactRemoved": "Customer removed. The call stays in Calls.",
  "aiActs.toast.contactRemoved.es": "Se quitó al cliente. La llamada sigue en Llamadas.",
  "aiActs.toast.notAvailable": "This can't be undone any more: {reason}.",
  "aiActs.toast.notAvailable.es": "Ya no se puede deshacer: {reason}.",
  "aiActs.toast.failed": "That didn't work. Reload the page, then try again.",
  "aiActs.toast.failed.es": "No funcionó. Recargue la página e inténtelo otra vez.",
  "aiActs.contactDialog.title": "Remove {name}?",
  "aiActs.contactDialog.title.es": "¿Quitar a {name}?",
  "aiActs.contactDialog.body": "{persona} added this customer, and nothing else has happened since. Removing them can't be undone; the call stays in Calls.",
  "aiActs.contactDialog.body.es": "{persona} agregó a este cliente y no ha pasado nada más desde entonces. Quitarlo no se puede deshacer; la llamada sigue en Llamadas.",
  "aiActs.contactDialog.confirm": "Remove customer",
  "aiActs.contactDialog.confirm.es": "Quitar cliente",
  // item 8c, Task 5 review fixes (orchestrator ruling): I-1's sentence in the move-undo notice, and M-4's two refusals.
  "aiActs.notice.calendarFix": "If you added the new time to your calendar, please change it back to this one.",
  "aiActs.notice.calendarFix.es": "Si agregaste la nueva hora a tu calendario, cámbiala de nuevo a esta, por favor.",
  "aiActs.toast.typedNameMismatch": "The name didn't match. Type it exactly as shown.",
  "aiActs.toast.typedNameMismatch.es": "El nombre no coincide. Escríbalo tal como aparece.",
  "aiActs.reason.gone": "It was already undone or removed",
  "aiActs.reason.gone.es": "Ya se deshizo o ya no existe",
  // item 8c, Task 9 fix round. Design I-4: "Added by" is one sentence per author kind (the mark's own label
  // stays for marks). Design I-5: the field toasts name the field, and say "removed" when the field was blank
  // before. Final review M-a: the web chat's own words for removing a customer it added. Design M-2: the
  // typed-name label and its near-miss hint, as DocumentPurgeForm's. Design I-8: the styleguide's title.
  "record.facts.addedBy.person": "Added by {name}",
  "record.facts.addedBy.person.es": "Agregado por {name}",
  "record.facts.addedBy.you": "Added by you",
  "record.facts.addedBy.you.es": "Agregado por usted",
  "record.facts.addedBy.someone": "Added by someone on the team",
  "record.facts.addedBy.someone.es": "Agregado por alguien del equipo",
  "record.facts.addedBy.ai": "Added by {name} (AI)",
  "record.facts.addedBy.ai.es": "Agregado por {name} (IA)",
  "record.facts.addedBy.customer": "Added by the customer",
  "record.facts.addedBy.customer.es": "Agregado por el cliente",
  "record.facts.addedBy.import": "Added by an import",
  "record.facts.addedBy.import.es": "Agregado por una importación",
  "record.facts.addedBy.automation": "Added by an automation",
  "record.facts.addedBy.automation.es": "Agregado por una automatización",
  "aiActs.toast.fieldRemoved": "Removed the {field} {persona} filled in.",
  "aiActs.toast.fieldRemoved.es": "Se quitó {field} que completó {persona}.",
  "aiActs.toast.contactRemovedChat": "Customer removed. The chat's form entry stays in Forms.",
  "aiActs.toast.contactRemovedChat.es": "Se quitó al cliente. La entrada del chat sigue en Formularios.",
  "aiActs.contactDialog.bodyChat": "{persona} added this customer from the website chat, and nothing else has happened since. Removing them can't be undone; the chat's form entry stays in Forms.",
  "aiActs.contactDialog.bodyChat.es": "{persona} agregó a este cliente desde el chat del sitio web y no ha pasado nada más desde entonces. Quitarlo no se puede deshacer; la entrada del chat sigue en Formularios.",
  "aiActs.contactDialog.label": "Type {name} to confirm",
  "aiActs.contactDialog.label.es": "Escriba {name} para confirmar",
  "aiActs.contactDialog.mismatch": "The name doesn't match. Type it exactly as shown.",
  "aiActs.contactDialog.mismatch.es": "El nombre no coincide. Escríbalo tal como aparece.",
  "styleguide.aiActs": "The assistant's actions and Undo",
  "styleguide.aiActs.es": "Las acciones de la asistente y Deshacer",
  // S-53 tenant vetting (docs/superpowers/specs/2026-10-27-tenant-vetting-design.md). Agency-only
  // surfaces (Add company, Add as a company, Settings' Trade card, the Voice page's locked switches,
  // Setup's notice). Bilingual where the surface reads in the operator's own language (the dialogs'
  // trade fields, the Trade card, the Voice page's lock sentences). Setup's notice reads only the
  // English keys: the Setup page is English, so it renders vetting.crmOnlyCreated, vetting.sofia.noTrade
  // and vetting.sofia.noTradeLink as they are (setup-vetting-notice.tsx). The trades' own labels and reasons live in
  // lib/vetting/trades.ts. Never shown to a client (spec 5.2).
  "vetting.trade.label": "Trade",
  "vetting.trade.label.es": "Giro",
  "vetting.trade.placeholder": "Choose the business's trade",
  "vetting.trade.placeholder.es": "Elija el giro del negocio",
  "vetting.trade.hint": "Decides whether BIS can take this business on, and whether Sofía and the web chat can be switched on.",
  "vetting.trade.hint.es": "Decide si BIS puede aceptar este negocio y si se pueden activar Sofía y el chat del sitio web.",
  "vetting.other.label": "What does the business do?",
  "vetting.other.label.es": "¿A qué se dedica el negocio?",
  "vetting.other.hint": "One line, up to 120 characters.",
  "vetting.other.hint.es": "Una línea, hasta 120 caracteres.",
  "vetting.error.missing": "Choose the business's trade.",
  "vetting.error.missing.es": "Elija el giro del negocio.",
  "vetting.error.otherDescription": "Say what the business does, in one line of up to 120 characters.",
  "vetting.error.otherDescription.es": "Diga a qué se dedica el negocio, en una línea de hasta 120 caracteres.",
  "vetting.crmOnlyCreated": "Sofía and the web chat aren't available for this trade yet.",
  "vetting.crmOnlyCreated.es": "Sofía y el chat del sitio web aún no están disponibles para este giro.",
  "vetting.sofia.crmOnly": "Sofía and the web chat aren't available for {trade} businesses yet.",
  "vetting.sofia.crmOnly.es": "Sofía y el chat del sitio web aún no están disponibles para el giro {trade}.",
  "vetting.sofia.noTrade": "Set this company's trade first.",
  "vetting.sofia.noTrade.es": "Primero indique el giro de esta empresa.",
  "vetting.sofia.noTradeLink": "Set the trade",
  "vetting.sofia.noTradeLink.es": "Indicar el giro",
  "vetting.turnOffFirst": "Turn off Sofía and the web chat first.",
  "vetting.turnOffFirst.es": "Primero apague a Sofía y el chat del sitio web.",
  "vetting.readFailed": "We couldn't check this company's trade. Try again.",
  "vetting.readFailed.es": "No pudimos revisar el giro de esta empresa. Inténtelo de nuevo.",
  "vetting.saveFailed": "The trade wasn't saved. Try again.",
  "vetting.saveFailed.es": "No se guardó el giro. Inténtelo de nuevo.",
  "vetting.saved": "Trade saved.",
  "vetting.saved.es": "Giro guardado.",
  "vetting.card.description": "What this business does. It decides whether Sofía and the web chat can be switched on. The company never sees it.",
  "vetting.card.description.es": "A qué se dedica este negocio. Decide si se pueden activar Sofía y el chat del sitio web. La empresa nunca lo ve.",
  "vetting.card.empty": "No trade yet. Sofía and the web chat can't be switched on until you set one.",
  "vetting.card.empty.es": "Aún no tiene giro. Sofía y el chat del sitio web no se pueden activar hasta que indique uno.",
  // The card's title, apart from its field's "Trade" label (design check M6: both read "Trade"/"Giro").
  "vetting.card.title": "Business trade",
  "vetting.card.title.es": "Giro del negocio",
  // The Trade card's crash toast. common.actionCrashed.es is in tú; this card speaks usted (final review M7).
  "vetting.crashed": "That didn't go through — this page may be out of date. Reload it and try again.",
  "vetting.crashed.es": "Eso no se completó: puede que esta página esté desactualizada. Vuelva a cargarla e inténtelo de nuevo.",
  // Beside a phone-number status the trade will not let Sofía answer on (design check M1): a word, not opacity alone.
  "vetting.numberStatusLocked": "not available",
  "vetting.numberStatusLocked.es": "no disponible",
  // The Trade card's own title (vetting.card.title): the palette names a section by its title.
  "palette.settings.trade": "Business trade",
  "palette.settings.trade.es": "Giro del negocio",
  // F-118 part 1: the reason chooser and the Owner's BIS access section.
  "accessLog.title": "BIS access",
  "accessLog.title.es": "Acceso de BIS",
  "accessLog.intro": "Each time someone at BIS opens your account, they must choose why first. Every customer, call, conversation and file they open is listed here. These entries can't be changed or deleted from BIS or from your account.",
  "accessLog.intro.es": "Cada vez que alguien de BIS abre su cuenta, primero tiene que elegir por qué. Aquí aparece cada cliente, llamada, conversación y archivo que abre. Estas entradas no se pueden cambiar ni borrar desde BIS ni desde su cuenta.",
  "accessLog.note.automatic": "This list shows people at BIS. Automatic work, like Sofía answering a call or a reminder going out, isn't a person looking and isn't listed.",
  "accessLog.note.automatic.es": "Esta lista muestra a personas de BIS. El trabajo automático, como Sofía al contestar una llamada o el envío de un recordatorio, no es una persona mirando y no aparece aquí.",
  "accessLog.note.lists": "Lists inside your account, like your customers, inbox and calls, are part of the visit and aren't listed one by one.",
  "accessLog.note.lists.es": "Las listas dentro de su cuenta, como sus clientes, la bandeja de entrada y las llamadas, forman parte de la visita y no aparecen una por una.",
  "accessLog.note.agencyLists": "BIS also has a few lists that show every business at once: open work, screened calls and phone numbers. Looking at those lists, or deciding one of Sofía's suggestions from the work list, doesn't open your account, so it isn't listed here. Opening a customer, call or conversation from them is.",
  "accessLog.note.agencyLists.es": "BIS también tiene algunas listas que muestran todos los negocios a la vez: el trabajo pendiente, las llamadas filtradas y los números de teléfono. Ver esas listas, o decidir una sugerencia de Sofía desde la lista de trabajo, no abre su cuenta, así que no aparece aquí. Abrir desde ellas un cliente, una llamada o una conversación sí aparece.",
  "accessLog.empty": "BIS hasn't opened your account yet. When someone does, you'll see who, when, why and what they opened.",
  "accessLog.empty.es": "BIS todavía no ha abierto su cuenta. Cuando alguien lo haga, verá quién, cuándo, por qué y qué abrió.",
  "accessLog.error": "We couldn't load BIS's visits. Try again.",
  "accessLog.error.es": "No pudimos cargar las visitas de BIS. Inténtelo de nuevo.",
  "accessLog.retry": "Try again",
  "accessLog.retry.es": "Reintentar",
  "accessLog.loading": "Loading BIS's visits",
  "accessLog.loading.es": "Cargando las visitas de BIS",
  "accessLog.total": "{count} visits",
  "accessLog.total.es": "{count} visitas",
  "accessLog.totalOne": "1 visit",
  "accessLog.totalOne.es": "1 visita",
  "accessLog.pager.older": "Older",
  "accessLog.pager.older.es": "Anteriores",
  "accessLog.pager.newer": "Newer",
  "accessLog.pager.newer.es": "Recientes",
  "accessLog.pager.label": "BIS access pages",
  "accessLog.pager.label.es": "Páginas de acceso de BIS",
  "accessLog.someone": "Someone at BIS",
  "accessLog.someone.es": "Alguien de BIS",
  "accessLog.show": "Show what was opened",
  "accessLog.show.es": "Mostrar lo que se abrió",
  "accessLog.hide": "Hide what was opened",
  "accessLog.hide.es": "Ocultar lo que se abrió",
  "accessLog.summary.opened": "Opened {list}.",
  "accessLog.summary.opened.es": "Abrió {list}.",
  "accessLog.summary.and": "and",
  "accessLog.summary.and.es": "y",
  "accessLog.summary.downloads": "Downloaded your customer list {count} times.",
  "accessLog.summary.downloads.es": "Descargó su lista de clientes {count} veces.",
  "accessLog.summary.downloadsOne": "Downloaded your customer list.",
  "accessLog.summary.downloadsOne.es": "Descargó su lista de clientes.",
  "accessLog.summary.nothing": "Didn't open any customer, call, conversation or file.",
  "accessLog.summary.nothing.es": "No abrió ningún cliente, llamada, conversación ni archivo.",
  "accessLog.count.customers": "{count} customers",
  "accessLog.count.customers.es": "{count} clientes",
  "accessLog.count.customersOne": "1 customer",
  "accessLog.count.customersOne.es": "1 cliente",
  "accessLog.count.groups": "{count} households or businesses",
  "accessLog.count.groups.es": "{count} hogares o negocios",
  "accessLog.count.groupsOne": "1 household or business",
  "accessLog.count.groupsOne.es": "1 hogar o negocio",
  "accessLog.count.calls": "{count} calls",
  "accessLog.count.calls.es": "{count} llamadas",
  "accessLog.count.callsOne": "1 call",
  "accessLog.count.callsOne.es": "1 llamada",
  "accessLog.count.conversations": "{count} conversations",
  "accessLog.count.conversations.es": "{count} conversaciones",
  "accessLog.count.conversationsOne": "1 conversation",
  "accessLog.count.conversationsOne.es": "1 conversación",
  "accessLog.count.files": "{count} files",
  "accessLog.count.files.es": "{count} archivos",
  "accessLog.count.filesOne": "1 file",
  "accessLog.count.filesOne.es": "1 archivo",
  "accessLog.count.forms": "the answers to {count} forms",
  "accessLog.count.forms.es": "las respuestas de {count} formularios",
  "accessLog.count.formsOne": "the answers to 1 form",
  "accessLog.count.formsOne.es": "las respuestas de 1 formulario",
  "accessLog.item.customer": "Customer · {name}",
  "accessLog.item.customer.es": "Cliente · {name}",
  "accessLog.item.household": "Household · {name}",
  "accessLog.item.household.es": "Hogar · {name}",
  "accessLog.item.business": "Business · {name}",
  "accessLog.item.business.es": "Negocio · {name}",
  "accessLog.item.call": "Call · {name} · {when}",
  "accessLog.item.call.es": "Llamada · {name} · {when}",
  "accessLog.item.callNoName": "Call · {when}",
  "accessLog.item.callNoName.es": "Llamada · {when}",
  "accessLog.item.conversation": "Conversation · {name}",
  "accessLog.item.conversation.es": "Conversación · {name}",
  "accessLog.item.conversationNoName": "Conversation",
  "accessLog.item.conversationNoName.es": "Conversación",
  "accessLog.item.fileViewed": "File · {title} · viewed",
  "accessLog.item.fileViewed.es": "Archivo · {title} · visto",
  "accessLog.item.fileDownloaded": "File · {title} · downloaded",
  "accessLog.item.fileDownloaded.es": "Archivo · {title} · descargado",
  "accessLog.item.fileShared": "File · {title} · shared",
  "accessLog.item.fileShared.es": "Archivo · {title} · compartido",
  "accessLog.item.form": "Form answers · {name}",
  "accessLog.item.form.es": "Respuestas del formulario · {name}",
  "accessLog.item.export": "Downloaded your customer list ({count} customers)",
  "accessLog.item.export.es": "Descargó su lista de clientes ({count} clientes)",
  "accessLog.item.exportOne": "Downloaded your customer list (1 customer)",
  "accessLog.item.exportOne.es": "Descargó su lista de clientes (1 cliente)",
  "accessLog.name.archived": "{name} (archived)",
  "accessLog.name.archived.es": "{name} (archivado)",
  "accessLog.name.trashed": "{title} (in the trash)",
  "accessLog.name.trashed.es": "{title} (en la papelera)",
  "accessLog.gone.customer": "A customer who was later deleted",
  "accessLog.gone.customer.es": "Un cliente que se eliminó después",
  "accessLog.gone.group": "A household or business that was later deleted",
  "accessLog.gone.group.es": "Un hogar o negocio que se eliminó después",
  "accessLog.gone.file": "A file that was later deleted for good",
  "accessLog.gone.file.es": "Un archivo que se eliminó para siempre después",
  "accessLog.gone.other": "A record that was later deleted",
  "accessLog.gone.other.es": "Un registro que se eliminó después",
  "accessLog.more": "and {count} more",
  "accessLog.more.es": "y {count} más",
  "accessLog.exportEnded": "Your visit to this account has ended, so nothing was downloaded. Open the account again, choose why, then download the list.",
  "accessLog.exportEnded.es": "Su visita a esta cuenta terminó, así que no se descargó nada. Vuelva a abrir la cuenta, elija por qué y luego descargue la lista.",
  "accessLog.enter.heading": "Why are you opening {name}?",
  "accessLog.enter.heading.es": "¿Por qué abre {name}?",
  "accessLog.enter.legend": "Choose a reason",
  "accessLog.enter.legend.es": "Elija un motivo",
  "accessLog.enter.notice": "The business's Owners can see each visit, its reason and everything you open.",
  "accessLog.enter.notice.es": "Los dueños del negocio pueden ver cada visita, su motivo y todo lo que abra.",
  "accessLog.enter.back": "Back to accounts",
  "accessLog.enter.back.es": "Volver a las cuentas",
  "accessLog.enter.ended": "Your last visit here ended after 2 hours.",
  "accessLog.enter.ended.es": "Su última visita aquí terminó al cabo de 2 horas.",
  "accessLog.reason.setup": "Setup",
  "accessLog.reason.setup.es": "Configuración",
  "accessLog.reason.support": "Support request",
  "accessLog.reason.support.es": "Solicitud de ayuda",
  "accessLog.reason.fix": "Fixing a problem",
  "accessLog.reason.fix.es": "Arreglar un problema",
  "accessLog.reason.billing": "Billing",
  "accessLog.reason.billing.es": "Facturación",
} as const;

export type MessageKey = keyof typeof m;
