# The Spanish dashboard, in order of daily use (S-10 and F-013's next part): design

Date: 2026-10-31. Author: bis-frontend. Base: `d4ada6c6` (branch `feat/spanish-dashboard`).
Status: design, owner-approved. The six owner questions were answered on 2026-10-31, each as recommended
(section 7); the design below states the answers. PR 1 (T0 + T1) is built on this branch.

Every claim about current code cites `path:line` at `d4ada6c6`. Short forms: `WEB/` = `apps/web/src/`,
`ACCT/` = `WEB/app/(dashboard)/dashboard/accounts/[accountId]/`, `I18N/` = `WEB/lib/i18n/`,
`MSG` = `WEB/lib/messages.ts`, `PLAN` = `docs/crm-features.md`, `RT` =
`docs/superpowers/specs/2026-10-10-spanish-runtime-design.md`. A claim about a system outside this repo,
or about how people use the product, is labelled **ASSUMPTION** and names how the plan verifies it. Where the
brief, the plan or an earlier spec disagrees with the source, the source wins and section 9 records it.

Scope, from `PLAN:1410-1411`: S-10 "Spanish dashboard", 3 to 4 engineer-weeks, because of binding
constraint 6 ("the owner's own screens are the one place BIS is not bilingual", `PLAN:934`), depending on
F-013 part 1, F-014 and S-01, all shipped; plus F-013's next part, "every existing screen in order of daily
use; the sign-in page's language from Accept-Language", 2 to 4 ew on top. Together 5 to 8 ew
(`PLAN:1412`). The promise (`PLAN:1926`): "the owner's own screens, alerts and summaries in Spanish, per
person, busiest screens first". The rule it closes (`PLAN:952`, §3.2 rule 13): "a ratchet gate fails the
build on any new English-only string". Out of scope: Spanish keywords and "go" in the ⌘K box (F-095,
`PLAN:1434`, which waits on this), Clerk's own widgets and emails (F-117, `PLAN:1577`; section 2.4), and the
redesigned surfaces of `PLAN` §6.3 (Hoy, Bandeja, Ajustes): S-10 translates the screens that exist.

---

## 0. The numbers, measured

All counts below were measured on `d4ada6c6` by throwaway AST scripts over `WEB/` (TypeScript's own parser,
the same one `I18N/ratchet-scan.ts:5` uses), not by regex. Task T0 commits the one that becomes a gate.

| What | Count | How it was read |
|---|---|---|
| Catalogue entries in `MSG` | 5,306: 3,242 base keys and 2,064 `.es` twins | `Object.keys(m)` |
| Base keys with no Spanish twin, live | **984** (7,294 English words) | `keysMissingSpanish(m)` (`I18N/ratchet-scan.ts:92`), which skips the 198 keys under the six agency prefixes (`:82-84`) |
| Frozen list `I18N/catalogue-baseline.json` | 999 | 15 of its keys have gained twins since it was generated; it was never regenerated (harmless: shrinking is free, `ratchet-scan.ts:111-115`) |
| ...of the 984, reachable by an Owner, Staff or Technician | **504** keys, 2,955 words | every literal reference to the key sits in at least one file a client role can render (section 3.1 says which files are agency-only) |
| ...referenced only from agency-only screens | 439 keys, 4,203 words | Settings, Setup, Checklist, Voice, Automations inside an account, and the agency's top-level routes |
| ...referenced by no literal at all | 41 | built from a template (`dashboard.greeting.${part}`, `website.period.${n}`, `forms.kind.core.${field}`) or dead: about 11 match no reference even by prefix (`common.filters`, `common.import`, `common.sort`, `contact.activity*`, `contact.notes`, `branding.upload`, ...). Dead keys are deleted, not translated |
| Un-catalogued JSX copy (`I18N/ratchet-baseline.json`) | 115 in 17 files | **97 of them are `/styleguide`** (86 + 9 + 2), an agency-only page (`WEB/app/(dashboard)/dashboard/styleguide/page.tsx:2`, `requireAgency`). Client screens hold **14** in 10 files, public pages 2, agency in-account cards 2 |
| **`m["…"]` read directly** (always English, whatever the locale) | 1,837 reads of 1,363 distinct keys; **864 reads in 109 client-reachable files** | an `ElementAccessExpression` on `m`; `t()` falls back to English only when a twin is missing (`I18N/t.ts:43`), but `m["x"]` never asks |
| ...of which already have a Spanish twin that is never shown | **293 distinct keys** (not agency-prefixed) | e.g. the whole Team card: 46 keys, every one twinned, every one read as `m["team.*"]` (`WEB/components/team/team-card.tsx:84-116`) |
| Spanish twins whose `{placeholders}` differ from the English | **0** of 2,064 | |
| Spanish twins identical to the English | 13, all legitimate ("CRM", "BIS", "—", "iPhone", "Spam", "{minutes} min", "Google Calendar", ...) | |

The single most important number is the fifth row from the bottom. The catalogue gate counts a key as done
when its `.es` line exists; the JSX gate counts a string as done when it is in the catalogue. Neither asks
whether the screen asks for the Spanish. 864 reads on client screens do not, so a Spanish Owner today sees
English on Team, Calls, Branding and most of the record kit's older cards even where the Spanish is written.
S-10 is therefore two jobs of similar size: write about 2,955 words of Spanish, and route about 860 reads
through `t()`.

---

## 1. Today: how a dashboard user's language is chosen

1. **The resolver.** `resolveLocale(userLanguage, accountLanguage)` returns the person's own choice, then the
   account's, then `"en"` (`I18N/locale.ts:12-19`). `requestLocale` wraps it with the role split
   (`I18N/request-locale.ts:35-65`): an operator (agency staff) uses only their own choice
   (`:61-62`, owner decision 1 of 2026-10-10, `RT:456`), a client role uses their own choice, then
   `accounts.language`, then English.
2. **The person's choice** is `users.language` (migration 0066), set on Mis preferencias
   (`WEB/app/(dashboard)/dashboard/preferences/`), with three options: English, Español, "Seguir el idioma de
   la cuenta" (`MSG:1293-1304`). It is read once per request by `getPersonPrefs`.
3. **The account's language** is set by the agency in the account's Settings (`LANGUAGE_OPTIONS`,
   `I18N/language-options.ts:7-10`), on a page only the agency can open (`ACCT/settings/page.tsx:78`,
   `requireAgencyOnlyAccountAccess`). A NULL account language means English (decision 3, `RT:467`).
4. **Where it reaches the screen.** The dashboard shell resolves it once (`WEB/app/(dashboard)/dashboard/layout.tsx:195`)
   and hands it to client components through `LocaleProvider`; outside one, `useLocale()` returns `"en"`
   (`WEB/components/locale-provider.tsx:5`, `:17`). Server pages call `requestLocale` themselves: 15 of the 26
   account pages do; `activity`, `automations`, `calls` (the list), `checklist`, `contacts/import`, `forms`,
   `forms/[formId]`, `pipeline`, `setup`, `team` (it passes only the QA parameter to the access-log section,
   `ACCT/team/page.tsx:47`, `:57`) and `website` do not, so their server-rendered copy cannot be Spanish even
   after it is twinned.
5. **`lang`.** `<html lang="en">` is hard-coded (`WEB/app/(dashboard)/layout.tsx:111`). By decision D
   (2026-10-10, comment at `WEB/app/(dashboard)/dashboard/layout.tsx:212-218`) `lang={locale}` sits only on
   the converted subtrees (sidebar nav, presence, the KPI row).
6. **A QA override** (`?locale=es`, `?locale=pseudo`) works only with `BIS_I18N_QA=1` and never on Vercel
   (`I18N/request-locale.ts:31-33`, `:55-59`).
7. **Signed out, nobody reads the browser's language.** No file under `WEB/` reads `Accept-Language`
   (searched for both spellings). `/sign-in` renders `m["signIn.title"]` directly
   (`WEB/app/(dashboard)/sign-in/[[...sign-in]]/page.tsx:234`), and `signIn.*` has no twins.

### 1.1 What S-10 changes

| | Today | After S-10 |
|---|---|---|
| Precedence for a signed-in person | user, then account (client roles), then English | **unchanged**: decisions 1 and 3 stand (Q5, decided 2026-10-31) |
| Screens that obey it | the shell, Dashboard's KPI row, To do, Contacts and the record kit, Documents, Conversations, Calendar's agenda, Mis preferencias | every screen an Owner, Staff or Technician can open (section 3), each page resolving the locale and every read going through `t()` |
| `<html lang>` | always `en` | the resolved locale, computed once in the root layout from the same inputs; agency-only pages stay English (Q4) and wrap themselves in `lang="en"`, and so does Clerk's widget; customer-authored text keeps its own `lang` |
| Signed out (`/sign-in`, `/`, `/no-access`, `/billing-done`) | English | the browser's `Accept-Language`, read by a new pure `localeFromAcceptLanguage(header)` in `I18N/` (q-values honoured; any `es`, `es-US`, `es-MX`, `es-419` range ranked above every `en` range gives Spanish; anything else gives English). The root layout already reads cookies through `getRequestTheme` (`WEB/app/(dashboard)/layout.tsx:102`), so reading one more header adds no new dynamic-rendering cost |
| Owner emails (weekly report, lead alert, call alert) | English only, copy inline in `.ts` | the account's language (section 3.3) |

### 1.2 Clerk stays English: confirmed

`PLAN:934` and `PLAN:1387` keep Clerk's sign-in widgets and emails English "until F-117's part in later",
because Clerk's component localization is experimental and does not reach its hosted pages, and its emails come
from one template set per instance (`PLAN:1577`). S-10 therefore ships a sign-in page whose own words (title,
the shell's rail) follow the browser and whose form does not, plus the Clerk `OrganizationSwitcher` and
`UserButton` menus in the topbar (`WEB/components/topbar.tsx:1`, `WEB/components/user-menu.tsx:3`), which stay
English on every Spanish screen. That is a visible seam on the first and every screen; the owner chose to keep it until F-117 (Q6, decided
2026-10-31), with every Clerk widget marked `lang="en"`. For when F-117 comes: **ASSUMPTION:** `@clerk/localizations` ships an `esES` resource that covers
`<SignIn>` and the two topbar components and is passed through `ClerkProvider`'s `localization` prop; not
installed here (`apps/web/package.json:19-20` lists only `@clerk/nextjs` and `@clerk/themes`). Verify on a
Preview before costing.

---

## 2. How the screens are ranked ("in order of daily use")

There is no usage analytics for the dashboard in this repo (**ASSUMPTION**, from reading `WEB/lib/` and the
access log, which records BIS's own visits to client accounts, not client page views; verify with Vercel
Analytics if the owner wants a measured order). The order is derived from three facts in the code, applied in
turn:

1. **Where a person lands.** `accountHome` sends an Owner or Staff to Dashboard and a Technician to To do
   (`WEB/lib/auth.ts:141-143`). The shell (sidebar, topbar, ⌘K, banners, error pages) is on every view, so it
   ranks first.
2. **Where the landing screen sends them.** Dashboard's work row and To do list "open tasks, contacts owed a
   reply, jobs nobody confirmed" (`WEB/lib/nav-groups.ts:127`): those rows open the record, a
   conversation, and a job on the calendar, so those three follow, in that order.
3. **The sidebar's own order** breaks the remaining ties (`WEB/lib/nav-groups.ts:121-220`), with Owner-only
   and set-once screens (Billing, Branding, Team) after everything Staff use weekly, and sign-in last among
   screens because Clerk keeps a session for long stretches (**ASSUMPTION**: the instance's session lifetime
   was not read).

Agency-only screens are not ranked: they stay English (Q4, decided 2026-10-31).

---

## 3. What is English today, by screen

### 3.1 The table

Columns: **missing .es** = keys referenced by the screen's files that have no twin (a key shared by two
screens counts in both, so the column sums to more than 504); **twinned, unread** = keys with a twin that the
screen reads with `m["…"]`; **`m[]` reads** = direct reads and the files holding them; **raw JSX** = the
ratchet baseline's entries; **also English, unseen by the gates** = what neither gate counts.

| # | Screen (who) | missing .es | twinned, unread | `m[]` reads (files) | raw JSX | Also English, unseen by the gates |
|---|---|---|---|---|---|---|
| 1 | **Shell**: sidebar, topbar, ⌘K, banners, error and not-found, account layout (everyone) | 38 | 14 | 61 (12) | 0 | `<html lang="en">`; ⌘K's settings sections are module-level constants with English labels and English-only search keywords (`WEB/lib/palette/registry.ts:37-47`); status labels are module-level constants built once in English (`WEB/lib/labels.ts:9-18`); Clerk menus (§1.2) |
| 2 | **Dashboard** (Owner, Staff) | 55 | 2 | 60 (5) | 0 | dates hard-coded `en-US`: `WEB/lib/dashboard/day-label.ts:29`, `:35`, `WEB/lib/dashboard/greeting.ts:32`, `ACCT/dashboard/calls-chart-card.tsx:333` (the bar tooltip); 6 greeting keys built by template |
| 3 | **To do** (everyone; a Technician's home) | 1 | 7 | 11 (2) | 0 | |
| 4 | **Contacts, the record page, the drawer, households and businesses** (everyone; a Technician sees their own) | 22 | 52 | 99 (15) | 0 | **18 error sentences returned as literals by server actions**: `ACCT/contacts/actions.ts` lines 190, 192, 194, 198, 222, 226, 229, 235, 400, 425, 453, 459, 472, 493, 525, 527 ("Save failed — please try again.", "Nothing selected.", ...) and `WEB/lib/contacts/field-input.ts:28`, `:32`; the ratchet scans `.tsx` only (`I18N/ratchet-scan.ts:162`) |
| 5 | **Conversations** (everyone) | 1 | 5 | 10 (5) | 0 | |
| 6 | **Calendar**: agenda, job drawer, calendar settings, closed days (everyone; settings for Owner) | 43 | 15 | 74 (7) | 4 | the raw "min", "hr", "days" unit suffixes (`ACCT/calendar/calendar-settings.tsx:171-204`) |
| 7 | **Calls** and a call's page (everyone) | 35 | 21 | 59 (11) | 0 | `formatWhen` pinned `en-US` (`ACCT/calls/format.ts:102`), the transcript's times (`ACCT/calls/[callId]/transcript-view.tsx:27`); the calls list page does not resolve a locale at all |
| 8 | Documents (everyone) | 0 | 1 | 1 (1) | 0 | done in S-07 |
| 9 | Opportunities (Owner, Staff) | 13 | 5 | 24 (4) | 0 | no locale on the page |
| 10 | Activity, "Lo que se envió" (Owner, Staff) | 58 | 10 | 73 (8) | 2 | two `aria-label="Pages"` (`ACCT/activity/activity-table.tsx:63`, `ACCT/activity/page.tsx:86`); log titles and hold reasons come from `WEB/lib/automations/log-titles.ts` and `hold-or-send.ts` |
| 11 | Forms and the form editor (Owner, Staff) | 50 | 3 | 59 (6) | 2 | the two raw strings are the language names "English"/"Español" (`ACCT/forms/[formId]/form-editor.tsx:240-241`): correct as they are, and should read `LANGUAGE_OPTIONS` instead of being literals |
| 12 | Contact import and merge (Owner, Staff) | 22 | 0 | 26 (3) | 1 | the import wizard's intro paragraph (`ACCT/contacts/import/import-wizard.tsx:166`) |
| 13 | Website (Owner, Staff) | 57 | 3 | 72 (7) | 3 | three `aria-label`s; `toLocaleString("en-US")` on visitor counts (`ACCT/website/website-section.tsx:12`, `daily-chart.tsx:65`, `breakdown-panel.tsx:26`): the digits are the same in `es-US`, so this is hygiene, not a visible defect; the chart's `aria-label` template (`daily-chart.tsx`) |
| 14 | Billing and the paused/stale banners' pages (Owner) | 34 | 5 | 44 (7) | 1 | dates `en-US` in `WEB/lib/billing/billing-view.ts:100-109` |
| 15 | Branding, incl. the alert-phone card (Owner) | 84 | 5 | 115 (6) | 1 | the raw string is the colour field's placeholder `"#0f766e"` (`WEB/components/branding-panel.tsx:314`), which the scanner counts because "f" is a letter; 25 of the missing keys are `settings.*` keys read by `WEB/components/alert-phone-card.tsx` |
| 16 | **Team** (Owner) | 0 | **46** | 57 (5) | 0 | every key is twinned; none is read through `t()` |
| 17 | Mis preferencias (everyone) | 0 | 0 | 0 | 0 | done; its Spanish is in *tú* (section 4.2) |
| 18 | Signed out and entry: `/sign-in`, `/`, `/no-access`, `/billing-done` | 17 | 1 | 19 (5) | 0 | no `Accept-Language`; Clerk's form |
| 19 | Owner emails: weekly report, lead alert, call alert | not in the catalogue | | | | about 20 English sentences inline in `WEB/lib/email/templates/weekly-report.ts` (`deltaPhrase` `:33`, "Open your dashboard" `:146`, `:154`), 3 in `lead-alert.ts` (`:24`), 5 in `voice.ts` (`:35`), none taking a locale. The owner's SMS alerts are already bilingual (`WEB/lib/sms/alerts.ts:63` takes a `Locale`) |

Agency-only (out of scope, Q4, decided 2026-10-31): Settings, Setup, Checklist, Voice and Automations inside an
account (gated by `requireAgencyOnlyAccountAccess`, `WEB/lib/auth.ts:132-138`; hidden from clients in
`WEB/lib/nav-groups.ts:148`, `:196`, `:210`), and the agency's top-level routes and `/styleguide`. Together
439 missing keys, 961 direct reads in 85 files, 99 raw strings.

Public pages (customer-facing, not this slice's subject but under the same gates): 4 missing keys
(`/u` unsubscribe), 12 direct reads, 2 raw strings, both the honeypot label "Do not fill this in"
(`WEB/app/b/[publicId]/booking-page.tsx:334`, `WEB/app/f/[publicId]/public-form.tsx:148`), which only bots
read.

### 3.2 What the gates cannot see

The JSX ratchet counts JSX text with a letter and six copy attributes (`I18N/ratchet-scan.ts:14-16`) in `.tsx`
files under `src/app` and `src/components` (`:151`, `:162`). The catalogue gate counts keys without a twin
(`:92-105`). Neither sees:

- **direct `m["…"]` reads** (864 on client screens), nor `m[expr]` with a computed key (39 lines in `WEB/`);
- **module-level constants** evaluated once at import, in English (`WEB/lib/labels.ts:9-18`,
  `WEB/lib/palette/registry.ts:37-47`);
- **`.ts` files**: server-action error strings (18 on the record, section 3.1 row 4), email builders (row 19);
- **dates and numbers** pinned to `en-US` for display (rows 2, 7, 13, 14). Pins used for computation, such as
  wall-clock parts in `WEB/lib/automations/quiet-hours.ts:18`, `WEB/lib/consent/hours.ts:43`,
  `WEB/lib/reports/weekly-window.ts:46`, are correct and stay;
- **template literals** in copy attributes (one: the website chart's `aria-label`);
- **`<html lang>`** and per-element `lang`;
- **a second Spanish convention**: 16 keys use a camel `…En`/`…Es` suffix instead of `.en`/`.es`
  (`automations.instantReply.defaultBodyEs`, `voice.textback.defaultBodyEs`, `voice.profile.greetingEs`, ...).
  The scanner reads each as a base key missing its twin, so they inflate the frozen list. **Corrected in T0
  (2026-10-31):** only 10 of the 16 are translation pairs (the text-back and instant-reply bodies); T0 renamed
  those to `x`/`x.es`. The other 6 (`voice.profile.greetingEn`/`Es`, `automations.instantReply.messageEn`/`Es`,
  `previewEn`/`Es`) are two different English labels ("Greeting (English)", "Greeting (Spanish)") and keep
  their names. The held text-back has Spanish by design (`MSG:2314-2316`: "Spanish needs no variant; its default
  never said 'just now'"), so T0 gave the held keys twins equal to the plain Spanish it already sent.

What it does see but should not count: the hex placeholder, the language names and the honeypot label (row 15,
row 11, public pages). Each becomes a catalogue key (the language names via `LANGUAGE_OPTIONS`), so the gate
needs no exception mechanism.

### 3.3 Owner emails: which language

The weekly report goes to the account's recipient addresses, not to people ("Recipients live on the account",
DESIGN.md's weekly report pattern); the lead and call alerts go to the account's alert address. None of those is
a `users` row with a language, so each email uses `accounts.language ?? "en"`, the same default the client's
dashboard uses. A recipient who is also a team member with their own language still gets the account's: one
email, one language (DESIGN.md's "A customer's language", applied to the owner's mail). The agency roll-up
(`WEB/lib/email/templates/agency-rollup.ts`) stays English (Q4).

---

## 4. Voice and terminology

### 4.1 What the existing Spanish already does

Read over all 2,064 twins:

- **Usted.** 447 twins carry an *usted* marker (su, le, puede, elija, escriba, suba, inténtelo) against 13 that
  are in *tú* (section 4.2). The plan settled it: "*usted* for platform strings, normalised by a paid Valley
  reviewer" (`PLAN:1935`), and "the canonical list settled *usted*" (`PLAN:2532-2534`). The customer-language
  spec extended it to customers ("Usted everywhere", Q5, `docs/superpowers/specs/2026-10-13-customer-language-design.md:820`).
  Several namespaces pin it with their own tests (for example `WEB/lib/messages.test.ts:595`, `:693`, `:814`,
  `:2250`), but no test covers the whole catalogue.
- **Imperatives in *usted*** for every instruction ("Elija una de las opciones mostradas.", `inline.invalidOption.es`).
- **Sentence case** in buttons and labels ("Agregar etiqueta", "Seleccionar todo en esta página"), never English
  title case.
- **Trades Spanish of the Valley, not Spain's**: *cita*, *trabajo*, *agendar*, *giro* for a business's trade
  (`vetting.card.title.es`, "Giro del negocio"), *estimado*, *celular*/*cel* where an SMS must stay GSM-7
  (`I18N/spanish-sms-gsm.test.ts`).
- **Placeholders survive**: zero mismatches (section 0).
- **Deltas in words**, never arrows ("subió {value} frente al periodo anterior", `stat.delta.up.es`).
- **Formats**: `es-US` through `tag(locale)` (`WEB/lib/format.ts:7-8`). Measured on this machine (Node 24.13.0,
  ICU 77.1): `$1,234.50`; `31 oct` (no trailing period, contrary to the assumption at `RT:241`);
  `sábado, 31 de octubre, 10:05 a.m.`; `ayer`.

### 4.2 Inconsistencies already in the catalogue

| What | Where | Fix |
|---|---|---|
| *Tú* on Mis preferencias and the theme toggle: 11 strings, the next row's among them ("Tus preferencias", "Solo son para ti", "Verás inglés hasta que elijas uno") | `MSG:1281-1338` (`prefs.*`, `theme.*`) | to *usted*, if Q2 confirms |
| *Tú* and *usted* in one sentence: "No se pudo guardar **tu** tema. **Puede** volver al anterior…" | `theme.saveFailed.es`, `MSG:1281` | same |
| *Tú* in the most-used error line: "Recárgala e inténtalo de nuevo." | `common.actionCrashed.es`, `MSG:321`, read at 67 call sites | "Recárguela e inténtelo de nuevo." |
| *Tú* in an email to a customer: "Si agregaste la nueva hora a tu calendario, cámbiala…" | `aiActs.notice.calendarFix.es`, `MSG:6700`, sent by `WEB/lib/ai-acts/notify.ts:79` | to *usted* (Q5 of the customer-language spec already decided it) |
| "Try again" in four shapes | button: "Intentar de nuevo" (`common.retry.es` `MSG:305`, `record.card.retry.es` `MSG:5816`) vs "Reintentar" (`documents.retry.es` `MSG:5045` and three more); sentence: "Inténtelo de nuevo" (17) vs "Vuelva a intentarlo" | glossary row below |
| "Settings" and "Setup" share a word | `nav.settings.es` "Ajustes" (`MSG:54`), `nav.setup.es` "Configuración" (`MSG:64`), but `contact.email.loadFailed.es` and `aiSettings.*` say "configuración" for settings | settings is always *ajustes* |
| Delete | *borrar* in 37 twins, *eliminar* in 8 | *borrar* |
| Book | *agendar* 12, *reservar* 7 ("Reservaron en línea", `contact.source.machine.booking.es`) | *agendar* |
| Estimate | "Presupuesto" (`documents.category.estimate.es`, `MSG:4949`), "estimado" (`automations.quoteFollowup.*`, `MSG:3439`), "cotización" (`voice.tradeRules.insurance_pcHint.es`) | *estimado* (**ASSUMPTION**, Valley usage; the reviewer confirms) |
| Household | "Hogar" as the kind label, "familia" in `groupPage.*` prose | *hogar* in labels; *familia* allowed in prose only where it means the people |
| The business called a company, to its own Owner | "esta empresa necesita un número" (`compose.smsBlockedNoNumber.es`, `MSG:1393`) | *su negocio*; *empresa* is the agency's word for an account (`nav.accounts.es`) |
| Role names' capitals | "Solo un dueño o un empleado" vs "Solo el Dueño o un Empleado" (`places.moveRefused.es`) | lower case in sentences, capital only as a role label |

### 4.3 The glossary (proposed)

"In the catalogue" means the Spanish already ships in that form; "proposed" means S-10 sets it.

| English | Español | Status | Never |
|---|---|---|---|
| Dashboard (nav) | Panel | in the catalogue (`MSG:22`) | Tablero, Inicio. ("Hoy" is `PLAN` §6.3's redesign; it arrives with the redesign, in both languages) |
| To do | Pendientes | in the catalogue (`MSG:24`, 21 uses) | Tareas (reads as Checklist's "Lista de verificación") |
| Conversations | Conversaciones | in the catalogue (`MSG:46`) | Bandeja, until `PLAN` §6.3's inbox renames the English too |
| Contacts (nav, list) / a contact | Contactos / contacto | in the catalogue (45 of 55) | |
| customer (the business's customer) | cliente | in the catalogue (120 of 123) | contacto in prose |
| client (BIS's customer, the business) | el negocio; to the Owner, *su negocio* | proposed | cliente (reserved for the customer), empresa (the agency's word) |
| lead | cliente potencial | in the catalogue | prospecto |
| job | trabajo | in the catalogue (31 of 31) | servicio, visita |
| appointment, booking | cita | in the catalogue (43 of 43, 40 of 40) | reserva, reservación |
| book (verb) | agendar | proposed (12 vs 7) | reservar |
| reschedule | cambiar la cita | proposed (no twin yet) | reprogramar in staff copy |
| call answered / missed call | llamada atendida / llamada perdida | in the catalogue / proposed | contestada (the shipped KPI says "atendidas", `MSG:451`) |
| text (noun, verb) | texto, mandar un texto | in the catalogue | SMS, mensaje de texto in buttons |
| email | correo | in the catalogue (91 of 102) | email, e-mail |
| Settings / Setup | Ajustes / Configuración | in the catalogue | configuración meaning settings |
| Owner, Staff, Technician | Dueño, Empleado, Técnico | in the catalogue (`team.role.*`, `MSG:4581`) | Propietario, Personal |
| opportunity, deal / pipeline | oportunidad / embudo | in the catalogue | trato |
| estimate, quote | estimado | proposed | presupuesto (kept only for an AI budget), cotización |
| review (a customer's) / review (check) | reseña / revisar | in the catalogue | |
| Save, Cancel, Close, Add, Undo | Guardar, Cancelar, Cerrar, Agregar, Deshacer | in the catalogue (`common.*`) | Añadir |
| Try again (button) / (sentence) | Intentar de nuevo / Inténtelo de nuevo. | proposed | Reintentar, Vuelva a intentarlo |
| Delete / trash / archive | Borrar / papelera / archivar | in the catalogue | Eliminar |
| upload | subir | in the catalogue | cargar |
| household / business (group kinds) | hogar / negocio | in the catalogue | |
| record page | ficha | in the catalogue (`drawer.openFull.es`) | registro |
| AI / Sofía | IA / Sofía | in the catalogue (`provenance.ai.es`, "{name} · IA") | |
| Someone on the team | Alguien del equipo | DESIGN.md (decided 2026-10-12) | |
| trade (a business's) | giro | in the catalogue | oficio |
| time zone | zona horaria | in the catalogue | |

---

## 5. Method

### 5.1 Who writes the Spanish

Each lane's agent drafts the Spanish against section 4.3, in the key's own line pair (`"x"` then `"x.es"` on
the next line, the convention `WEB/lib/messages.test.ts:587-593` enforces where it is tested). Each PR merges on the
draft plus the build checks; one paid Valley reviewer reads the whole catalogue once, from the screenshot
sheets, before BIS calls it a Spanish dashboard (Q1, decided 2026-10-31). Every lane PR carries a screenshot sheet, each converted
screen in English and Spanish at 375 px. The `?locale=es` override is dead on every Vercel deployment by
construction (`I18N/request-locale.ts:31-33`), so bis-e2e-qa captures the sheet against a local `next start`
with `BIS_I18N_QA=1`, or on Preview signed in as a fixture-account user whose own language is Español.

### 5.2 What the build checks

Every check below is **shrink-free**: an entry that stops being a violation stops mattering, so a lane that
fixes things never has to edit a baseline, and only a new violation fails (the shape `parityViolations` already
has, `I18N/ratchet-scan.ts:113-116`).

| Gate | Today | S-10 | End state |
|---|---|---|---|
| G1 Catalogue parity | frozen list of 999 (`I18N/catalogue-baseline.json`) | regenerated (984); exemption for agency-only screens computed from references, not prefixes (Q4): a key is exempt only if every literal reference to it sits in an agency-only file. **As built (T0, corrected by the PR 1 review):** the exemption follows where the LITERAL sits, not where the words end up. "Agency-only" means only agency routes reach the file through imports (every `src/app` file is a way in); a file nothing reaches is never agency-only. Two refinements: a plural's `One`/`Other` form is referenced wherever its base key is (`plural`, `tr.count`), and a reference in the styleguide never exempts, because it demos client components. Consequence to know: a customer message whose only literal sits in an agency-only builder (the instant-reply prefill, `WEB/lib/automations/instant-reply-copy.ts`, reached only by the agency's Automations card) IS exempt, so its Spanish is guarded by its own tests, not by G1 | frozen list empty and deleted: any non-exempt key without `.es` fails |
| G2 JSX ratchet | 115 in 17 files | `/styleguide` added to `AGENCY_ONLY_ALLOWLIST` as a seventh pattern with its own test row (`I18N/ratchet.test.ts` pins "exactly six"); the 14 client and 2 public strings keyed | baseline `{}` and deleted: any copy literal in a scanned file fails |
| G3 **Direct reads (new)** | none | an AST count of `m[...]` per file, same roots plus `src/lib`, same allowlist, baseline from today's 864 client reads (and 12 public) | `{}`: `m` is read only by `t()`, `plural()` and `makeTr` (`WEB/lib/record/copy.ts:15-21`) with the reader's locale. **As built:** G3 also counts `t(m, key, "en")` and `plural(m, key, n, "en")`, since a literal locale hard-codes the language exactly as `m["key"]` does, and it follows an aliased import (`import { m as messages }`). Its named exceptions (`ENGLISH_ONLY_READERS`, each with a reason and a test row) are files whose English read is the point: today only `ACCT/calendar/server-words.ts`'s reverse map. The styleguide needs no entry: it is agency-only, and agency-only files are outside G3 |
| G4 Register (new) | eight namespaces | one test over every `.es`: an unambiguous *tú* lexicon (tu, tus, ti, contigo, puedes, tienes, verás, elijas, recárgala, inténtalo, agregaste, cámbiala, ...), never a suffix rule: "-iste" catches *existe* (three false hits measured) | frozen list of today's 13 (section 4.2) shrinks to empty in T1 and T6 |
| G5 Placeholder parity (new) | per namespace | over every twin | 0 today; hard from day one |
| G6 Glossary (new) | none | each row of 4.3 with a "Never" becomes a banned-word check, applied when the English holds the row's word (whole word, case-insensitive). **As built, 19 rules:** settings→configuración, delete→eliminar, book→reserv-, try again→Reintentar / Vuelva a intentarlo, estimate→presupuesto/cotización, add→añadir, email→e-mail, text→SMS, lead→prospecto, staff (the role, not "agency staff")→personal, owner→propietario, upload→cargar, and from the PR 1 review dashboard→tablero, deal→trato, appointment/booking→reserva, reschedule→reprogramar, answered→contestada, trade→oficio, to do→tareas (the last six have no breach and are hard). **Excluded on purpose:** "servicio" for job (also "service", as in Services & prices), "registro" for record (also a log: the access log's word; 14 legitimate uses measured), "inicio" for dashboard (also "inicio de sesión"), and "contacto" for customer in prose (a contact row is one) | frozen list of today's hits shrinks to empty |
| G7 Accents | `I18N/accents-guard.test.ts:7-19` checks only that `app-sidebar.tsx` and `stat-tile.tsx` do not import `consent/keywords` or `consent/phrases` | every file under `src/app` and `src/components` except the consent pipeline is checked for those imports and for `stripDiacritics` (`WEB/lib/sms/alerts.ts:52`, which is right for SMS and wrong on a screen) | same |
| G8 `lang` | none | signed out (T7): `localeFromAcceptLanguage` unit tests (`es-MX,en;q=0.5` gives `es`, `en-US,es;q=0.9` gives `en`, a q=0 or malformed range never selects) and AuthShell's `<main lang>`; the root layout's `<html lang>` stays `"en"` with no session read (`layout.test.ts`). Signed in (`es` session gives `lang="es"`): T9 | same |
| G9 Overflow | `e2e/i18n-overflow.spec.ts` on four screens at 390×844 (`:186`) | every converted screen, at **375×812**, in `es` (nothing may clip) and `pseudo` (a clip must carry a `title` fallback), deciding with the existing `e2e/overflow-check.ts` | same; a measurement run by bis-e2e-qa, never by the lane agent |

A test that cannot fail is not evidence: each new gate's task names its mutation (G3: add `m["nav.tasks"]` to
`app-sidebar.tsx`, must fail naming that file; G4: put "Inténtalo de nuevo." in any `.es` ("Revisa" cannot work: it is also the third person, so it is not on the list); G6: put "Eliminar" in a twin of
an English "Delete").

### 5.3 Working in parallel without fighting over `messages.ts`

`MSG` is 6,921 lines, and 29 commits have touched it since 2026-10-17. Most namespaces sit in one or two runs;
the most scattered, `timeline`, sits in seven.

1. **T0 and T1 merge first**, alone: the gates, the shared namespaces (`common`, `nav`, `shell`, `palette`,
   `error`, `notFound`, `theme`, `stat`, `landing`, `signIn`) and the shell. Lanes branch from that.
2. **Each lane owns a closed list of key prefixes** (section 6). It adds a `.es` line only under an English line
   of its own prefixes, and new keys only inside its own runs. A key it needs from another prefix is asked for,
   not edited. Disjoint hunks in one file merge cleanly in git; adjacent edits at a run's boundary are the only
   conflict, and they are one-line resolutions.
3. **No lane regenerates a baseline.** Every gate is shrink-free (5.2), so a lane's PR passes without touching
   `catalogue-baseline.json`, `ratchet-baseline.json` or the new direct-read baseline. The orchestrator
   regenerates them in T9, in one reviewable commit.
4. **Not chosen: splitting `MSG` into one file per namespace first.** It would make lanes conflict-free and
   files readable in one pass, but eight tests read `messages.ts` as text to check twin adjacency
   (`WEB/lib/messages.test.ts:587` and seven more), every lane would wait on the split, and the conflicts it
   prevents are rare (point 2). If lanes report real conflicts, the split is its own LOW task after S-10.

---

## 6. Tasks

Tiers follow the repo's speed process: LOW is copy and UI (no plan document, one end-of-PR review); MEDIUM
touches auth, sign-in or email and gets its own review before its PR merges. Sizes are conventional ew. Suggested owners outside
bis-frontend are **ASSUMPTION** from the agents' usual territories; the orchestrator assigns.

| Task | What | Tier | Lane, owner | ew |
|---|---|---|---|---|
| **T0** | Gates: regenerate G1; reference-based agency exemption (Q4 (a)); G2's styleguide pattern; G3 (new scanner and baseline); G4, G5, G6 with frozen lists; G7 widened; rename the 16 camel `…En`/`…Es` keys to `.en`/`.es` (call sites in `WEB/lib/voice/textback-body.ts`, `WEB/lib/automations/instant-reply-copy.ts`, voice settings: bis-voice's files, so their consent first); delete the dead keys | LOW | A, bis-frontend | 1–1.25 |
| **T1** | Shell: `common`, `nav`, `shell`, `palette`, `error`, `notFound`, `theme`; ⌘K registry and `labels.ts` become functions of the locale; banners; `common.actionCrashed.es` and `theme.*` to *usted* | LOW | A, bis-frontend | 0.75 |
| **T2** | Dashboard and Website: `dashboard`, `website`, `stat`; the `en-US` date pins of row 2 through `tag()`; the website page resolves its locale | LOW | A, bis-frontend | 0.75 |
| **T3** | To do, Contacts, record, drawer, households, import, merge, Opportunities: `contact`, `contacts`, `record`, `drawer`, `bulk`, `groups`, `groupPage`, `relationships`, `places`, `equipment`, `pipeline`, `todo`, client `work.*`; the 18 server-action sentences into the catalogue | LOW | B, bis-crm | 1–1.25 |
| **T4** | Conversations and Calendar: `conversations`, `conversation`, `compose`, `calendar`, `closedDays`, `business`; the unit suffixes | LOW | C, bis-comms and bis-booking | 0.5–0.75 |
| **T5** | Calls, Activity, Forms: `calls`, `call`, `activity`, `forms`, the client-read `automations.*` log titles and `voice.*` number status; `formatWhen` and the transcript through `tag()`; the three pages resolve their locale | LOW | C, bis-voice and bis-comms | 1 |
| **T6** | Owner-only: Billing, Branding (incl. the alert-phone card's `settings.*`), Team (46 reads), `prefs.*` to *usted*; `billing-view` dates | LOW | A, bis-frontend (Team and Billing with bis-platform) | 0.75 |
| **T7** | Signed out: `localeFromAcceptLanguage`, `/sign-in`, `/`, `/no-access`, `/billing-done` (`signIn`, `landing`, `clientAccess`), each marked on AuthShell's `<main lang>` from Accept-Language, `lang="en"` on Clerk's sign-in widget; G8's signed-out half; the signed-out e2e asserts both languages and that the Clerk probes still pass. **Split 2026-11-01 (orchestrator, adopting the T7 review's correction 1):** the root layout makes NO session, account or preference read for `lang` and `<html lang>` stays `"en"` for every request, because the root layout wraps `/sign-in`, `/no-access` and paths outside the proxy matcher, where a bare `auth()` throws and an unguarded account read would 500 the pages that explain a failure (pinned by `layout.test.ts`, whose readers all throw). The signed-in `<html lang>`, `lang="en"` on agency-only pages and on Clerk's topbar menus (`OrganizationSwitcher`, `UserButton`), and G9 for the shell move to T9 | **MEDIUM** | A, bis-frontend with bis-platform (`auth-shell.tsx` is shared) | 0.5–0.75 |
| **T8** | Owner emails in the account's language: weekly report (incl. `deltaPhrase` and the quiet week), lead alert, call alert; copy into the catalogue under `email.*`; tests render templates only, nothing is sent | **MEDIUM** | C, bis-comms | 0.5–0.75 |
| **T9** | Close-out: regenerate and then delete the frozen lists; G1–G3 at zero, G4 and G6 frozen lists empty; G9 measurement run over every screen; **from T7 (split 2026-11-01):** the signed-in `<html lang>` (resolved without a new failure mode on `/sign-in`, `/no-access` or unmatched paths, and without a second accounts read), `lang="en"` on agency-only pages and on Clerk's topbar menus (`OrganizationSwitcher`, `UserButton`), and G9 for the shell, which needs a Spanish e2e user with its own `users.language`; Q1's review lands as copy-only commits; DESIGN.md amendments (section 8) | LOW | orchestrator, bis-e2e-qa | 0.5 |
| | **Total** | | | **7.25–8.5** (Q4 (a) decided). That is at and above the top of the plan's 5–8 (`PLAN:1412`): the plan priced writing the Spanish, and did not know about the 864 direct reads (G3), which are about a third of the work |

Order: T0+T1 (PR 1) → then three lanes at once: A runs T2 and T7 (PR 2), then T6 (PR 5); B runs T3 (PR 3);
C runs T4 and T5 (PR 4), then T8 (PR 6 with T6 if they finish together) → T9 (PR 7). Each PR is shippable on its
own and leaves every gate green, which is what rule 8's "split to ship" asks (`PLAN:947`).

---

## 7. Owner decisions (DECIDED 2026-10-31)

The owner answered all six on 2026-10-31, each as recommended: Q1 (a), Q2 (a), Q3 (a), Q4 (a), Q5 (a),
Q6 (a). The options are kept below for the record; the chosen one is marked **DECIDED**. Q2's conversion
covers the 12 *tú* strings on the owner's screens; the 13th, `aiActs.notice.calendarFix.es`, is a customer email
and is logged for its owners (section 10), not changed here.

**Q1. Who reads the Spanish before a client sees it?**
- **DECIDED (a).** The agent drafts against the glossary and the build checks (5.2); each PR merges on
  that. One paid Valley reviewer then reads the whole catalogue, the 2,064 twins already shipped included, from
  the screenshot sheets, and their fixes land as copy-only commits before BIS says "Spanish dashboard" to
  anyone. Fast, and the review covers the old Spanish too, which nobody has read either.
- (b) The paid reviewer reads each PR's sheet before it merges. Best quality per screen; every PR waits on one
  outside person's turnaround (**ASSUMPTION**: one to two days per batch), and no reviewer is engaged today.
- (c) You read each PR's sheet before it merges; the paid reviewer reads everything once at the end.
- (d) No human reader; the build checks only.

**Q2. *Usted* or *tú* on the owner's own screens?**
- **DECIDED (a).** *Usted* everywhere, as the plan settled (`PLAN:1935`): convert the 13 *tú* strings,
  including Mis preferencias and the most common error line.
- (b) *Usted* everywhere except Mis preferencias, which keeps *tú* because it is a page about the reader.
- (c) *Tú* on the owner's screens (their own tool), *usted* to customers: rewrites about 447 shipped twins.

**Q3. One big PR, or screen by screen?**
- **DECIDED (a).** Seven PRs in daily-use order (section 6), three lanes at once after the first. Each
  leaves every check green, and the busiest screens reach Spanish clients first.
- (b) One PR at the end: one review and one CI run, but nothing reaches a Spanish client for weeks, and it
  breaks the plan's own "split to ship" rule.
- (c) One PR per screen (about 18): the smallest reviews and the most CI runs (8 to 9 minutes each).

**Q4. Are BIS's own screens in scope?** (Decided English-only on 2026-10-10 for the runtime, `RT:463`; a staff
member can now pick Español on Mis preferencias, so they would see Spanish on client screens and English on these.)
- **DECIDED (a).** No. Settings, Setup, Checklist, Voice and Automations inside an account, and the agency's
  top-level pages, stay English and carry `lang="en"`; the build exempts their copy by where it is used.
- (b) Also the five in-account agency screens: up to 439 more keys (about 4,200 words) and up to 961 direct
  reads to route; about 1.5 to 2 ew more.
- (c) Everything, top-level agency pages too: 198 more keys on top of (b).

**Q5. Should the browser's language count after sign-in?** (Today a client with no choice of their own and an
account with no language gets English, decision 3, `RT:467`.)
- **DECIDED (a).** No: the browser's language picks only the signed-out pages. A client's language comes
  from their own choice or their account's, which the agency sets at onboarding.
- (b) Yes, for client roles only, after their own choice and the account's and before English. A Spanish
  browser then sees a Spanish dashboard with nothing set, and an English-speaking owner on a Spanish phone sees
  Spanish until they change it.

**Q6. Clerk's sign-in form and topbar menus: Spanish now, or later as planned?**
- **DECIDED (a).** Later, as planned (F-117's part). The page's own words follow the browser; the form and
  the account menus stay English, marked `lang="en"`.
- (b) Now, the widgets only, through Clerk's own Spanish (**ASSUMPTION** in §1.2, to verify on Preview first);
  Clerk's emails stay English until F-117. About 0.25 to 0.5 ew, and an experimental Clerk feature on the
  sign-in path.

---

## 8. DESIGN.md amendments proposed (the orchestrator lands them as `docs(design)`)

1. Under Identity's Voice line, add: "Spanish is *usted*, sentence case, Valley trades Spanish, and follows
   the glossary in `docs/superpowers/specs/2026-10-31-spanish-dashboard-design.md` §4.3 until it moves into
   this file." (Q2 (a): *usted*.)
2. In the Definition of done's bilingual item, after "sets `lang` correctly", add: "and reads every string
   through `t()` (a twin that the screen never asks for is English on screen)."
3. In Installation status, after the sentence about the `.dark` class, add: "`<html lang>` is the resolved
   locale (since S-10; it replaces decision D of 2026-10-10, which put `lang` on converted subtrees only,
   `WEB/app/(dashboard)/dashboard/layout.tsx:212-218`); English-only islands (Clerk's widgets, agency-only
   pages) carry `lang="en"`." Lands with T9: T7 shipped only the signed-out half, on AuthShell's `<main lang>`
   (split 2026-11-01), so until T9 `<html lang>` is still `"en"` for every request.

---

## 9. Where the brief, the plan or an earlier spec and the source disagree

| Said | Source | Effect |
|---|---|---|
| Brief: 999 catalogue keys have no `.es` twin | 999 is the frozen list; 984 are missing live (15 gained twins since it was frozen) | T0 regenerates it |
| Brief: "97 under `src/app/(dashboard)/dashboard` outside accounts" | all 97 are `/styleguide`, an agency-only design page (`WEB/app/(dashboard)/dashboard/styleguide/page.tsx:2`); client screens hold 14 | the raw-string work on client screens is small; `/styleguide` is allowlisted, not translated |
| `PLAN:268`: "one English catalogue of 1,257 keys" | 5,306 entries, 3,242 base and 2,064 `.es` | the plan's line is stale |
| `RT:21`: `/sign-in` "already follows the browser's language with its own EN\|ES switch" | no file reads `Accept-Language`; `signIn.title` has no twin (`MSG:184`) | T7 builds it |
| `RT:241`: Spanish short months render with a trailing period ("oct.") | ICU 77.1 gives `31 oct` | no width risk from the period |
| The catalogue gate's own premise: a twinned key is a translated screen | 293 twinned keys are read with `m["…"]` and render English | G3 |

---

## 10. Findings outside this design's scope (for the ledger)

- **Customer-facing *tú* still ships**, though the customer-language spec's Q5 decided *usted* everywhere: the
  public booking pages (`WEB/lib/booking/public-strings.ts:171-223`, "Te enviamos una confirmación a tu
  correo"), booking emails (`WEB/lib/email/templates/booking.ts:33`, `:241`), the lead receipt
  (`WEB/lib/email/templates/lead-receipt.ts:26-28`), and `aiActs.notice.calendarFix.es`. Owner: bis-booking
  and bis-comms.
- ~~The held text-back has no Spanish~~ **Withdrawn 2026-10-31 (T0):** the Spanish default never said "just
  now", so the held text-back already sends it (`MSG:2314-2316`); see section 3.2.
- **The web chat's AI introduction is in *tú*** ("para que el equipo te dé seguimiento",
  `concierge.aiIntro.es`), found by G4 during T0; customer copy, so Q5 of the customer-language spec applies.
  Owner: whoever owns the web concierge.
- **The QA locale override never reaches the shell** (found building T1): Next layouts receive no
  `searchParams`, and the shell's locale is resolved in `WEB/app/(dashboard)/dashboard/layout.tsx:195`, so
  `?locale=es` turns pages Spanish under a still-English sidebar, topbar and ⌘K. G9 for the shell therefore
  needs a Spanish e2e user (own `users.language`) or a QA header set by `src/proxy.ts`. Moved from T7 to T9
  by the 2026-11-01 split: T7's 375px check measures AuthShell, not the shell, and is named as a signed-out
  overflow check.
- **T7 split, 2026-11-01:** the signed-in `<html lang>` was built in T7 and removed before merge. It read
  `auth()`, `resolveClientAccessState()` and `getPersonPrefs()` in the root layout, which wraps `/sign-in`,
  `/no-access` and paths outside the proxy matcher (a bare `auth()` throws there, and an unguarded
  `getAccountByOrgId` failure would 500 the pages that explain a failure), and it doubled the accounts read on
  every dashboard request. T9 owns it, with `lang="en"` on agency-only pages and Clerk's topbar menus.
- **About 11 catalogue keys look dead** (no reference, literal or by prefix; section 0). T0 deletes them after
  a second grep each; a dead key in a 6,921-line catalogue costs a translator's time for nothing.

- **Logged by the PR 1 review, not fixed:**
  - M-2: the import graph does not follow a dynamic `import()`. No effect today (no screen file pulls catalogue
    readers that way); a future one would be counted as unreached, which is the safe side.
  - M-6: ⌘K search does not fold accents ("cancelacion" will not find "Cancelación"). F-095's job.
  - M-7: an agency operator who picks Español on Mis preferencias sees Spanish shell items (nav, ⌘K) around
    agency-only pages that stay English (Q4). A question for the owner when F-096's Ajustes lands: should an
    operator's Spanish stop at the client's screens?
  - M-8: renaming a file resets its G2 and G3 ceiling to 0, so a rename of a file with direct reads fails the
    gate until the baseline is regenerated. Acceptable: the regeneration is one reviewable command.
  - M-9: some e2e specs check that an English string is absent; on a Spanish screen they would pass for the
    wrong reason. bis-e2e-qa to review when the lane PRs add Spanish e2e runs.
