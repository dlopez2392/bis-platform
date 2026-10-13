# The contacts list drawer on the record kit — design (first release, item 3, S-03 part 3)

Date: 2026-10-13. Owner decisions P1–P3 (danlo, 2026-10-13, given in the brief; §2 records them as D-rows).
Parents: `docs/superpowers/specs/2026-10-12-record-page-design.md` (part 1: the kit, the header, facts, Next up,
the timeline; cited as "part 1 §n") and `docs/superpowers/specs/2026-10-13-group-record-page-design.md` (part 2;
cited as "part 2 §n"). Plan: `docs/crm-features.md` §4.3 item 3, "The record page and drawer" (`:1264-1267`).
Design contract: DESIGN.md rules 3, 5, 7, 8 (`DESIGN.md:105`, `:111`, `:115`, `:116-129`), "Record views"
(`:164-166`), "Record page" (`:232-244`), Provenance, and the definition of done (`:324`).

**Delivery: one PR, no migration** (D9). Everything below ships together.

**What is verified and what is not.** Every function name, line and count below was read off the worktree at
`619a9b75` (branch `feat/s03-drawer`). Anything not read is labelled **Assumption**.

## 1. Goal

The drawer is a **quick look**: a business owner clicks a row on the contact list and, without leaving the list,
sees who this is and how to reach them, the checked facts, what is coming up, the last five things that happened
(each saying who did it), and the few fields they most often fix on the spot. Everything else (their household or
business, their properties, their related people, the whole timeline, the composer) is on the full record, one
link away. The drawer is built from the same kit and the same loaders as the record page, so the two can no longer
say different things about the same customer. That closes part 1's open risk "The drawer and the page now differ"
(`2026-10-12-record-page-design.md:606-607`).

## 2. Decisions

Owner (danlo, 2026-10-13), given in the brief:

| # | Question | Decision |
|---|---|---|
| D1 | The drawer's job | **A quick look, not the whole record** (P1). Top to bottom: header, facts line, Next up, Recent, who they are |
| D2 | Header | On the kit's `RecordHeader` (`components/record/record-header.tsx`): the name; the household or business line linking to its group page, as the record page does (`[contactId]/page.tsx:161-164`, `:274-276`); actions **Call** (`tel:`, the ONE primary), **Text**, **Email**, **Directions** from `headerActions` (`lib/record/header-actions.ts:40-51`) with `composeHref` = the full record's URL, so Text and Email open the record page at `#compose-sms` / `#compose-email`. An action with nothing behind it is hidden. The ↗ "Open full record" link stays. **No back link** in the drawer |
| D3 | Facts | The record page's checked facts: the same loader (`loadSummary`, `lib/record/loaders.ts:20-29`) and the same view (`factsView`, `lib/record/record-facts.ts`) |
| D4 | Next up | `loadNextUp` (`loaders.ts:32-39`) and `nextUpView`, **without "Add a To-do"** (no composer in the drawer) |
| D5 | Recent | The newest **5** rows of the page's merged timeline (`listContactTimelinePage`, `packages/db/src/record.ts:367-373`), drawn with `TimelineItem` + `AuthorMark`, read-only (no To-do checkbox, no inline actions). The inbox's `form`/`voice` copies are therefore gone (part 1 C4, D15). A "See all activity" link to the record page's timeline |
| D6 | Who they are | The inline fields (`FIELDS`, `contact-drawer.tsx:68-73`), Business name, the Texts and Email consent rows, Source, Assigned to, Tags. **Behaviour unchanged** |
| D7 | What leaves | **Groups, Properties and Related people leave the drawer** (`contact-drawer.tsx:274-284`, `:357`). The ↗ link and a bottom "Open full record" cover them |
| D8 | Text and Email | Open the record page's composer on that channel (P2): messages keep going from the business number or address, through the consent and quiet-hours gates, and land on the timeline. **Verified** the record page opens the channel on arrival, not just scrolls (§8.2) |
| D9 | Sections, data, scope (P3) | Flat sections inside the Sheet (mono label + `--row-line` rules), **not** nested glass `RecordCard`s; each keeps the kit's skeleton, empty and error states. The `/summary` route is rewritten to return the kit's view models, each section its own `{status}`. `/texts` and `/email` are unchanged. Keep the Sheet, `?peek=` deep links, the Esc rule, the stale-closure guards, Technician scope through RLS. No migration. One PR |
| D10 | Language (part 1 D12, carried here) | The "who they are" panels (Details with the Texts and Email rows, Source, Assigned to; Tags) become bilingual in **one pass covering the record page and the drawer**; the page's `lang="en"` wrappers on Details and Tags come off (`[contactId]/page.tsx:241-251`). The Groups card's `lang="en"` wrapper (`:235`) **stays**; a follow-up (§16) |
| D11 | Old shapes | The old `recent` shape and the `drawer.recent.*` keys are deleted |
| D12 | Testing | Unit: the route's per-section failure, the header's compose links, recent capped at 5 with no `form`/`voice` copies, the drawer wiring test updated. e2e: open the drawer; actions shown and hidden; Email lands on the record with the composer open (§12.2 says why not Text); a marked recent row; a Spanish drawer; Esc closes. Mutating specs on the per-run fixture account only |
| D13 | Ownership | bis-crm: the drawer, the route, the loaders, the translations. bis-frontend: any kit variant and its `/styleguide` entry. bis-e2e-qa: the e2e |

Choices this spec makes:

| # | Choice |
|---|---|
| C1 | **Locale: resolved ONCE, on the server, by the route** (§7.3). The route calls `requestLocale` with the same three inputs the account layout uses (`[accountId]/layout.tsx:65`) and builds every string of the four read-only sections in that locale, as the page builds `timelineView` with `tr` (`[contactId]/page.tsx:125`, `:166-171`). It returns `locale`, and the drawer wraps its body in `LocaleProvider locale={body.locale}` with `lang={body.locale}`, so the who-they-are client components (which read `useLocale()`) speak the same language as the route's strings. Rejected: building the rows in the browser with `useLocale()` + `t()`. `timelineRows` needs the people's names and the persona, which are server reads, and it would ship whole `TimelineEntry` rows (call summaries, form answers) to the browser only to throw most of them away |
| C2 | **One fetch, five sections, each with its own status.** The body is parsed per section (§7.4): a section that fails to load or to parse is that section's error, and the rest still render. Only a 404, a 500 or a body that is not JSON is the whole drawer's error (today's `drawer.loadFailed` state, `contact-drawer.tsx:292-310`) |
| C3 | **A section's Try again re-reads the route without blanking the others.** It bumps the existing `retryNonce` and keeps the current body on screen until the answer lands (today a nonce bump already keeps `fetched` while the same contact refetches, `contact-drawer.tsx:110-111`). Today's whole-drawer Retry, which drops the body (`:303-304`), stays only on the whole-drawer error |
| C4 | **`RecordSection`, a flat variant of the card chrome** (bis-frontend's): a mono 10px label (DESIGN.md's Label role), `--row-line` rules, and the SAME `RecordCardSkeleton`, `RecordCardError` and `RecordCardBoundary` the card uses (`record-card.tsx:18-46`, `:95-100`), with `onRetry` required, never `router.refresh()` (the card's default, `:32`, would refresh the list behind the drawer, not the drawer) |
| C5 | **The facts line has no label.** It continues the header, as a subtitle would. Next up, Recent and Details have labels. A failed facts read still says what it is: `record.summary.failed` ("Couldn't load the summary.") |
| C6 | **Recent rows are a compact, JSON-only view** built on the server from `timelineRows` (`lib/record/timeline-rows.ts:99-114`): key, kind, mark, verb, status (dot and word), detail, time, `dateTime`, and at most a two-line excerpt (§9.4). No day separators (five rows), no per-row links, no "Open call", no Done. The record page's row keeps all of those |
| C7 | **Text's gate is the page's gate**: `canTextFrom({ phone, smsGate, smsBlockedLine })` (`header-actions.ts:22-24`), with `softSmsGate` (`loaders.ts:128-135`) and `composerStateLine(smsRecipientState(ledger, …))` as on the page (`[contactId]/page.tsx:96`, `:100`, `:159`, `:178`). The ledger client is built only after `getContact` on the request client proved the contact (`:85-89`'s rule, kept by today's `/texts` route, `texts/route.ts:22-35`). Email: the contact has an email. The page also hides Text and Email when its own timeline card failed (`composerShown`, `:172-178`); the drawer cannot know that about a page it has not loaded (§15) |
| C8 | **The header labels have one home.** The page's `ACTION_KEY` map (`[contactId]/page.tsx:54-56`) moves to `lib/record/header-actions.ts` as `headerActionLabels(actions, tr, name)`, used by the page and the route, so "Call" can never read one way on the page and another in the drawer |
| C9 | **The QA locale reaches the route by forwarding.** The list page reads no `?locale=` (its layout passes none, `layout.tsx:65`), so the drawer appends the list URL's `?locale=` to its fetch ONLY when present, and the route hands it to `requestLocale` and `requestPseudoMode`, which ignore it unless `BIS_I18N_QA=1` outside Vercel (`lib/i18n/request-locale.ts:31-33`). With no `?locale=` the fetch URL is today's exact path, so `contacts-drawer.spec.ts:488`'s route glob (`**/contacts/${id}/summary`) still matches |
| C10 | **The test hooks that the e2e suite leans on are kept on purpose**: `data-testid="drawer-scroll"` on the scroller, `"drawer-skeleton"` on every section skeleton, `"drawer-recent-item"` on each recent row. New: `data-drawer-section="<id>"` with `data-state` on each section, which the e2e waits on instead of the "Recent" text (§12.2) |

## 3. Non-goals

A composer, a To-do field or a Done box in the drawer (D1, D4). Groups, Properties, Related people and Deals in
the drawer (D7). Day separators and paging in Recent (C6). Changing the `/texts` or `/email` routes, `?peek=`,
`usePeek`, `peekRow`, the Sheet's width, or the Esc rule (D9). Translating the Groups card (D10, a follow-up).
Translating the error strings server actions return to the who-they-are fields (§15). The household drawer (a
group has no list, part 2 D1). Any database change.

## 4. Roles

| What | Owner | Staff | Technician | Agency |
|---|---|---|---|---|
| Open a customer's drawer | any | any | only their own customer; anyone else's is a 404 from the route (`getContact` under `contacts_technician_scope`, `0068_mine_unassigned_technician.sql:103-107`), which is today's whole-drawer error | any |
| Header actions | all that apply | all that apply | all that apply to their customer (the same gates) | all that apply |
| Facts, Next up, Recent | yes | yes | yes, the same as an Owner's for a customer they can see (part 1 §4: every source is fenced by `contact_id`) | yes |
| Names on person marks | team members (`users_member_read`) | same | same (part 1 §4) | everyone |
| Assigned to | picker | picker | read-only (`canAssign` false, as today, `contact-drawer.tsx:343`) | picker |

Every read is on the request client (`dbForRequest`), as today (`summary/route.ts:62`); the ledger client is the
only other client and only after the proof (C7). Nothing new is read on the service client. **No RLS change.**

## 5. Data

**No migration.** Every read already exists:

| Section | Read | Where |
|---|---|---|
| Authorisation | `apiAccountAccess`, then `getContact` on the request client; null is a 404 before any other read | `summary/route.ts:60-64` (kept) |
| Header | `loadHeaderPlaces` (the group line and Directions, soft); `softSmsGate`; `smsRecipientState` on the ledger client (never throws) | `loaders.ts:118-135`; `[contactId]/page.tsx:100` |
| Facts | `loadSummary` | `loaders.ts:20-29` |
| Next up | `loadNextUp` | `loaders.ts:32-39` |
| Recent | **new `loadRecent`** (§6) over `listContactTimelinePage(…, { limit: 5 })` | `record.ts:367-373` |
| Who they are | `getContact`'s `source`, `custom`, `attribution`, `assigned_to` (as today, `summary/route.ts:127-131`); `loadTags` | `loaders.ts:98-105` |
| Locale and zone | one `accounts` row (`timezone, language`), `renderZone`, `getPersonPrefs` | as the page, `[contactId]/page.tsx:92`, `:98`, `:121-124` |

**The timeline source already takes a limit.** `listTimelinePage` reads `opts.limit ?? TIMELINE_PAGE_SIZE`
(`record.ts:315`, `:320`), each source reading `limit + 1` past the cursor (`:321`), and keeps `limit`
(`:361`); `listContactTimelinePage` passes `opts` through (`:369-372`). So "the newest 5" is
`listContactTimelinePage(db, accountId, contactId, undefined, { limit: 5, onError })`: seven sources, six rows each,
merged and cut to five. **No additive option is needed**, and `packages/db` does not change.

**What the drawer stops reading.** Today's route reads five sources unpaged (`summary/route.ts:66-74`); after
this change nothing in the app calls `listContactSubmissions` or `listContactMessages` without a page (grep: their
only callers are that route and `record.ts:340`, `:352`), and `listContactCalls`' "single-id, no-cursor path (the
drawer …, the summary route)" (`packages/db/src/voice.ts:949-955`) keeps only `contactFacts`. Those paths are left
in place (two of the three files are other agents'); §16 files them.

**Reads per open** go from 7 (`summary/route.ts:66-74`) to about 20: the facts' three, Next up's three, the
timeline's seven, the names and the persona, the places, the gate, the ledger's SMS state, the person's
preferences and the account row. Each is bounded (`LIMIT 6` on the timeline sources, head counts, one-row reads).
**Assumption:** the drawer's open time stays under the record page's, which makes the same reads plus the 30-row
timeline; the plan measures it on the replica.

## 6. Loaders and view builders (bis-crm)

- **`loadRecent(db, accountId, contactId)`** in `lib/record/loaders.ts`, beside `loadTimeline` (`:51-82`):
  `listContactTimelinePage(db, accountId, contactId, undefined, { limit: DRAWER_RECENT, onError })` with
  `DRAWER_RECENT = 5`; then `listPeopleNames` and `getVoiceProfile`'s persona, each soft exactly as
  `loadTimeline`'s (`:72-79`). **No hold read and no ledger**: the hold read exists to stand in for Done
  (`:66-71`), and the drawer has no Done. All seven sources failed is `{status: "error"}`, as `:63`. Never throws.
- **`recentRowsView(rows: TimelineRow[]): RecentRowView[]`** in `lib/record/recent-rows.ts`, pure: §9.4's
  excerpt rules, mirroring the group timeline's per-kind body (`groups/[groupId]/group-timeline.tsx:92-172`).
- **`headerActionLabels`** (C8), moved from the page.
- **The parser** `parseDrawerSummary(json)` in `lib/contacts/drawer-summary.ts` replaces `parseContactSummary`
  (`lib/contacts/summary.ts:80`) and keeps its reason for existing: the body is checked, not cast, so a server
  older or newer than the tab's bundle gets an error state, not a throw during render (`contact-drawer.tsx:36-44`).
  It parses each section on its own (C2). `summaryLoadFrom`'s shape (`summary.ts:131-147`) is kept, renamed
  `drawerLoadFrom`.

## 7. The route

`app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts`, rewritten. **Who calls it** (grep for
`/summary` and `ContactSummary` over `apps` and `packages`): one runtime caller, the drawer's fetch
(`contact-drawer.tsx:96`); the type is imported by `lib/contacts/summary.ts:1` and `summary.test.ts:2` only; the
e2e reads it directly at `contacts-drawer.spec.ts:650` (`body.tags`) and intercepts it at `:488`. Nothing else.

### 7.1 Order

1. `apiAccountAccess` (404 without), `dbForRequest`, `getContact` (404 when null). **Nothing else starts before
   this** (today's rule, `:60-64`).
2. Then in parallel: `getPersonPrefs`, the `accounts` row, `loadSummary`, `loadNextUp`, `loadRecent`, `loadTags`,
   `loadHeaderPlaces`, `softSmsGate`, and, on `ledgerDb()` built only now, `smsRecipientState`.
3. `renderZone`, `requestLocale`, `makeTr`; then each section's view in its own guard (the page's `viewOf`,
   `[contactId]/page.tsx:149-156`), so a malformed row costs its section, never the route.

### 7.2 Body

```ts
export type DrawerSummary = {
  locale: Locale;
  header: { name: string; subtitle: string | null; subtitleHref: string | null; actions: RecordHeaderAction[] };
  facts: { status: "ready"; view: FactsView } | { status: "error"; text: string };
  nextUp: { status: "ready"; view: NextUpView; emptyText: string } | { status: "error"; text: string };
  recent:
    | { status: "ready"; rows: RecentRowView[]; failedText: string | null; emptyText: string | null; seeAllHref: string }
    | { status: "error"; text: string };
  who: {
    source: string | null; sourceHint: string | null; assignedTo: string | null;
    tags: { status: "ready"; tags: { id: string; name: string }[] } | { status: "error" };
  };
};
```

- **header** is always present on a 200: its soft reads fail to hidden actions and no group line, never to an
  error (part 1 §7's rule). `actions` = `headerActions({ phone, email, canText, directionsUrl, composeHref })` with
  `composeHref = /dashboard/accounts/{a}/contacts/{c}` (`header-actions.ts:40-51`), labelled by C8, Call's
  `ariaLabel` "Call {name}" (`record.action.callAria`).
- **facts** is `factsView({ createdAt: contact.created_at, facts }, { zone, now, tr })`, the page's call
  (`[contactId]/page.tsx:186-188`).
- **nextUp** is `nextUpView(data, { zone, now, tr })` (`:189`) plus `record.nextUp.empty`.
- **recent** is `recentRowsView(timelineRows(page.items, { zone, tr, author: { viewerId: access.userId, names,
  personaName, tr } }))`, the page's row call (`:166-171`) with `apiAccountAccess`'s `userId`
  (`lib/auth.ts:178-190`), the same Clerk id the page passes. `failedText` = `timelineFailedText(page.failed, tr)`
  (`timeline-rows.ts:117-122`); `emptyText` = `timeline.empty` only when there are no rows and nothing failed (the
  page's rule, `[contactId]/page.tsx:223`); `seeAllHref` = the record's URL + `#record-timeline`
  (`TIMELINE_ANCHOR`, `lib/record/timeline-pager.ts:5`).
- **who** keeps today's three fields and their meanings (`summary/route.ts:127-131`), `sourceHint` now in the
  locale (`contactSourceHint` gains a `locale` parameter, §10.3), and `tags` its own status.
- **Deleted from the body**: `recent` (today's shape, `:20-24`), `phone_country_unconfirmed`, `phone` and `zone`
  (`:30-39`). The drawer reads none of the last three today (grep for `load.summary.` in `contact-drawer.tsx`:
  `source`, `sourceHint`, `assignedTo`, `tags`, `recent` only); the Texts row takes its phone and zone from its own
  `/texts` read (`texts/route.ts:14`), which `contact-drawer.wiring.test.ts:376` already pins.

### 7.3 Locale

`requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale })`
with `accountLanguage` a NAMED variable: `request-locale-callers.test.ts` scans every `requestLocale({…})` under
`app/` by its braces (`:12-21`) and a nested literal would cut its match short (the page's own warning,
`[contactId]/page.tsx:122`). The route joins that scan automatically; it does not keep a list. `isOperator` is
`apiAccountAccess`'s `isAgency`, the same split the layout and the page draw. Pseudo mode from
`requestPseudoMode({ locale })` into `makeTr` (`lib/record/copy.ts`).

### 7.4 Parsing in the drawer

`parseDrawerSummary` returns `null` (the whole drawer's error) only when `locale` or `header` is missing or
malformed: without the header there is nothing to title the drawer with. Every other section that fails to parse
becomes `{ status: "error" }` with the drawer's own fallback text (`record.card.failed` with the section's label,
read in `body.locale`), and the rest render. Unknown extra keys are dropped. A recent row of an unknown `kind` is
dropped, as today's parser drops an unknown recent kind (`summary.test.ts:123-154`).

## 8. The header

### 8.1 The kit variant (bis-frontend)

`RecordHeader` today requires `back` (`record-header.tsx:15`) and renders the name as the page's `<h1>` (`:24`).
The drawer needs three things, through optional props so the page and the group page do not change:

1. **No back link**: `back` becomes optional; absent, nothing renders where `:19-23` draws it.
2. **The name is the Sheet's title**: Radix needs a `Dialog.Title` (today's `SheetTitle`,
   `contact-drawer.tsx:188-203`; `components/ui/sheet.tsx:114-125`), and a dialog over a page with its own `<h1>`
   should not hold a second one. The heading renders as an `<h2>` wrapped by `SheetTitle asChild`, so the dialog's
   accessible name is the customer's name. The exact prop shape is bis-frontend's call (a `headingLevel` plus a
   heading wrapper, or a `titleSlot`).
3. **The ↗ beside the name**: an optional trailing node on the name line, for the "Open full record" icon link
   (`aria-label` `drawer.openFull`), keeping today's `mr-8` clearance from the Sheet's absolutely placed close
   button (`contact-drawer.tsx:195-198`, `sheet.tsx:84`).

`/styleguide`: `RecordHeader` in its drawer form (no back, an `<h2>`, the trailing link), inside a Sheet.

### 8.2 Text and Email land on the composer, verified

The drawer's Text links to `/dashboard/accounts/{a}/contacts/{c}#compose-sms`, Email to `…#compose-email`
(`header-actions.ts:45-48`). `RecordHeader` draws them as plain `<a href>` (`record-header.tsx:37`), so the click is
a full document load of the record page with the hash in place. On that page `MessageComposer` reads the hash
**after hydration** (`window.setTimeout(onHash, 0)`, `message-composer.tsx:108`), maps it with
`composeModeFromHash` (`:22-26`), **switches the tab** (`setMode(target)`, `:96`) and **focuses the body**
(`setFocusNonce`, `:99`, then `bodyRef.current?.focus()`, `:117`). So it opens the channel, not only scrolls to the anchor (`:157-158`). **No fix is
needed.** `record-page.spec.ts:196-206` already pins both: Email lands on the email composer with its body
focused, and a cold load of `#compose-sms` opens the Text tab. The composer's document click listener matches only
`a[href^='#compose-']` (`:103`), so the drawer's absolute links never trigger it on the list page. Back from the
record returns to `?peek=`, which reopens the drawer (`lib/contacts/use-peek.ts:21-29`).

### 8.3 What shows

| Action | Shown when | Label (en · es) | Target |
|---|---|---|---|
| Call (primary, `default` variant) | `telHref(phone)` resolves (`header-actions.ts:10-16`) | Call · Llamar | `tel:` |
| Text (ghost) | C7's gate passes | Text · Mandar texto | record `#compose-sms` |
| Email (ghost) | the contact has an email | Email · Mandar correo | record `#compose-email` |
| Directions (ghost) | the first addressed property in the Properties card's order (part 1 D13, `firstMapUrl`, `:27-33`) | Directions · Cómo llegar | the map, new tab |

Under the name, muted, the main group's words (`record.group.household` / `.business`) as a link to
`/dashboard/accounts/{a}/groups/{id}`, chosen as the page chooses (`[contactId]/page.tsx:161`). While the route
loads, the header shows the list row's name (`contactDisplayName(row)`, today's `:192`) and one skeleton line where
the actions go.

## 9. The sections (flat, on `RecordSection`)

Order on every width, one column: header, facts, Next up, Recent, Details (who they are), then the bottom link.
Each section is a `RecordSection` (C4) with `data-drawer-section` and `data-state`. Sections are separated by a
`--line` rule; rows inside by `--row-line`. **No glass card inside the glass Sheet** (D9): the Sheet is already
`glass-overlay` (`sheet.tsx:69`).

### 9.1 Facts (no label)

**Loaded:** `SummaryBody`'s line (`[contactId]/summary-card.tsx:5-16`), which gains an `onRetry` prop handed to its
`RecordCardRetry` (today it has none, `:12`, so its Try again would `router.refresh()` the list). **Missing a
fact:** "Couldn't count {what}." with Try again (part 1 §9.2). **Error:** `record.summary.failed` with Try again.
**Loading:** one skeleton line.

### 9.2 Next up (`record.card.nextUp`)

**Loaded:** `NextUpBody` with `addTodoLabel={null}` (`next-up-card.tsx:15`, `:22`), so no "Add a To-do"; rows as
the page. **Empty:** `record.nextUp.empty` ("Nothing coming up. Bookings ahead and To-dos with a due date show
here."); the action that causes it is on the record, one link away (§15, Q2). **Error:** `record.nextUp.failed`.
**Loading:** three skeleton rows.

### 9.3 Recent (`drawer.recent`)

**Loaded:** at most five rows, newest first, each a `TimelineItem` (`components/record/timeline-item.tsx:36-70`)
with its `AuthorMark` and `data-testid="drawer-recent-item"`; status as dot and word (rule 3, `:53-60`); time in
the account's zone. Under them, "See all activity" (ghost link, `drawer.seeAll`) to `seeAllHref`. **Some sources
failed:** `timeline.someFailed` ("Couldn't load {what}.") with Try again, and the rows that loaded stay.
**Empty:** `timeline.empty` ("Texts, calls, bookings, notes and To-dos with this customer show up here."). **Error
(all failed):** `record.activity.failed`. **Loading:** five skeleton rows.

### 9.4 Recent rows: what each shows

| Kind | Verb (part 1 §10.2 keys) | Excerpt (≤2 lines, `line-clamp-2`) |
|---|---|---|
| note | added a note | the note, `lang=""` |
| task | added a To-do / left a callback To-do | the title, `lang=""`; struck through when done (no checkbox) |
| deal | added a deal: {name} | none |
| submission | sent the {form} form / took a request in the website chat | none (the form's name is in the verb) |
| message | texted / emailed | the subject, else the body, `lang=""` |
| booking | booked an appointment for {when} | the booking's note, `lang=""` |
| call | answered a call | the reason as typed (`lang=""`), else the summary's prose (`lang="en"`), nothing when the summary carries a mismatch warning: the group timeline's rule (`group-timeline.tsx:154-170`) |

No "Open call" in the drawer (C6, Q3): the whole call is one click away on the record.

### 9.5 Details (`contact.details`): who they are

Unchanged behaviour (D6), in today's order: First name, Last name, Email, Phone (`FIELDS`, still fed by the list
row, with the phone's save and Undo bumping `retryNonce`, `contact-drawer.tsx:212-246`), Business name
(`BusinessInlineField`, `:247-250`), the Texts row and the Email row (their own reads, `:253-267`), Source
(`:319-326`), Assigned to (`:333-348`), Tags (`TagsRow`, `:350-355`, `:413-466`). Every row still keyed by the
contact id (`:213-217`, `:314-318`). Source, Assigned to and Tags now come from the `who` section; while it loads,
those three rows show skeleton lines and the fields above them are already editable (they never waited on the
summary). **Tags error:** "Couldn't load Tags." (`record.card.failed` with `contact.tags`) and Try again; the
other rows stay. The header (name, the dialog's accessible name, Call's aria label, the Email action) is fed
by the route, and is also unchanged behaviour in the sense that it still only re-reads on a successful save:
a phone save or Undo bumps `retryNonce` as it always has, and a successful save of first_name, last_name or
email now bumps it too (final review, item 2), so the header follows a name or email edit instead of staying
stale until the drawer is reopened.

### 9.6 The bottom

One line, `drawer.moreOnRecord` ("Groups, properties and related people are on the full record."), and a ghost
link "Open full record" (`drawer.openFull`). It replaces the three cards that left (D7).

### 9.7 Phone width, the pseudo-locale, keyboard

- **Width.** The drawer keeps `className="w-full sm:max-w-md"` (`contact-drawer.tsx:162`), overriding the Sheet's
  `w-3/4 … sm:max-w-sm` (`sheet.tsx:71`): full width under 640px, 448px above.
- **Header actions wrap, never clip.** `RecordHeader` lays them out `flex flex-wrap gap-2`, each `min-h-11`
  (44px) (`record-header.tsx:34-36`). At 390px in Spanish ("Llamar", "Mandar texto", "Mandar correo", "Cómo
  llegar") under the pseudo-locale's +35% they take two rows; Call stays first. The name truncates with `title`
  (`:24`), and the trailing ↗ never shrinks.
- **The facts line** wraps anywhere (`[overflow-wrap:anywhere]`, `summary-card.tsx:8`). Recent rows wrap their
  head (`flex-wrap`, `timeline-item.tsx:41`) and clamp their excerpt. The 92px label column of the who-they-are
  rows (`contact-drawer.tsx:218`) holds "Asignado a" and "Apellido" at +35% on two lines; **Assumption** until the
  overflow e2e measures it (§12.2).
- **Keyboard.** Tab order is DOM order: the ↗, the actions, Next up, Recent's "See all activity", the fields, the
  bottom link, the close button. Every link has a visible `:focus-visible` ring. **Esc** keeps today's rule
  (`contact-drawer.tsx:163-183`): it cancels a field being edited and closes the drawer otherwise.
- **Motion and theme.** Tokens only; dark and light; the blur fallback is the Sheet's own. Nothing animates on
  scroll.

## 10. Bilingual "who they are" (D10): one pass, the page and the drawer

### 10.1 What converts

Client components read `useLocale()` and `t()`; view builders take a `locale`. The drawer's body sits inside
`LocaleProvider locale={body.locale}` (C1); the page's cards already sit inside the page's (`[contactId]/page.tsx:270`).

| File | Owner | Change |
|---|---|---|
| `contacts/[contactId]/contact-fields-panel.tsx` | bis-crm | `m[…]` → `t(m, …, locale)` (`:76`, `:79`, `:92`, `:106`, `:163`, `:166`, `:192`, `:215`, `:226-227`); `InlineField` gets `locale` |
| `contacts/contact-drawer.tsx` | bis-crm | the same for `FIELDS`' labels, Business name, the tags row; `InlineField` gets `locale` |
| `contacts/texts-row.tsx`, `contacts/email-row.tsx` | bis-crm | their `m[…]` reads; the Retry |
| `lib/consent/texts-row.ts`, `lib/consent/email-row.ts` | consent chain (§14) | the view builders take a `locale`: status words, "how" phrases and "Since {date}" (the date in the locale) |
| `contacts/source-field.tsx`, `lib/contacts/lead-source.ts` | bis-crm | the label; `contactSourceHint` takes a `locale` |
| `components/assign/assignee-field.tsx` | bis-frontend | `m[…]` (`:16`, `:25-26`, `:97`, `:101`, `:121`) → `t()`; `assign.*` already have twins |
| `components/inline-field.tsx` | bis-frontend | none: it already takes `locale` (`:102`, `:128`) and reads `t()` |

### 10.2 The page

`[contactId]/page.tsx:241-251` loses the `<div lang="en">` around Details and Tags. **The Groups card keeps its
wrapper** (`:235`; D10). The test that pins the wrappers (`[contactId]/page.test.ts:749-757`) changes to: Details
and Tags carry no `lang="en"` and read Spanish on a Spanish page; Groups still does.

### 10.3 The keys that gain a Spanish twin

63 keys these components read have no `.es` twin today (each is on the frozen list,
`lib/i18n/catalogue-baseline.json`; `ratchet.test.ts:184`'s parity check admits only those). Read off
`messages.ts` by key; the Spanish is usted, trades Spanish, as part 1 and part 2.

| Key | English | Español |
|---|---|---|
| `contacts.firstName` · `.lastName` · `.email` · `.phone` | First name · Last name · Email · Phone | Nombre · Apellido · Correo · Teléfono |
| `contact.addTag` · `contact.removeTag` | add tag · Remove {name} | agregar etiqueta · Quitar {name} |
| `common.retry` · `common.save` · `common.none` · `contact.clearField` | Retry · Save · — · — | Intentar de nuevo · Guardar · — · — |
| `contact.messages.title` · `.texts` · `.email` | Messages · Texts · Email | Mensajes · Textos · Correo |
| `contact.texts.allowed` · `.stopped` · `.held` | Allowed · Stopped · On hold | Permitido · Detenido · En espera |
| `contact.texts.since` · `contact.email.since` | Since {date} | Desde el {date} |
| `contact.texts.how.keyword` | they texted {word} | mandó {word} por texto |
| `contact.texts.how.freeText` | they wrote “{excerpt}”, confirmed by your team | escribió “{excerpt}”, confirmado por su equipo |
| `contact.texts.how.freeTextBy` | they wrote “{excerpt}”, confirmed by {name} | escribió “{excerpt}”, confirmado por {name} |
| `contact.texts.how.staff` · `contact.email.how.staff` | you recorded it | usted lo registró |
| `contact.texts.how.carrier` | the carrier blocked it | la compañía telefónica lo bloqueó |
| `contact.texts.how.unsubscribeLink` · `contact.email.how.unsubscribeLink` | unsubscribe link | enlace para darse de baja |
| `contact.texts.stopTexts` · `.stoppedToast` | Stop texts · Texts stopped. | Detener textos · Se detuvieron los textos. |
| `contact.texts.resume` · `.resumeSubmit` · `.resumeCancel` | Resume texts… · Resume texts · Cancel | Reanudar textos… · Reanudar textos · Cancelar |
| `contact.texts.resumeNoteLabel` · `contact.email.resumeNoteLabel` | What did they ask for? (required) | ¿Qué pidió? (obligatorio) |
| `contact.texts.resumedToast` | Texts are back on. To stop them again, use Stop texts. | Los textos se reanudaron. Para detenerlos otra vez, use Detener textos. |
| `contact.texts.customerOnly` | They can text START to get texts again. | Puede mandar START por texto para volver a recibir textos. |
| `contact.texts.heldLine` | They wrote “{excerpt}”. Texts are on hold. | Escribió “{excerpt}”. Los textos están en espera. |
| `contact.texts.confirmStop` · `.notAStop` | Confirm stop · Not a stop | Confirmar que pidió parar · No pidió parar |
| `contact.texts.confirmedToast` | Stop confirmed. Texts to them are stopped. | Confirmado. Ya no se le mandan textos. |
| `contact.texts.releasedToast` | Hold lifted. Texts to them are back on. | Se quitó la espera. Se le vuelven a mandar textos. |
| `contact.texts.loadFailed` | Couldn't load their message settings. Try again. | No se pudo cargar la configuración de mensajes. Intente de nuevo. |
| `contact.texts.undoBusy` · `contact.email.undoBusy` | Your last change is still saving. Try again in a moment. | Su último cambio todavía se está guardando. Intente de nuevo en un momento. |
| `compose.smsHeld` | Texts to them are on hold while you check whether they asked to stop. | Los textos a esta persona están en espera mientras usted revisa si pidió que se detuvieran. |
| `contact.phoneCountry.line` · `.mx` · `.us` | This number could be Mexican or US. · Mexico (+52) · US (+1) | Este número puede ser de México o de EE. UU. · México (+52) · EE. UU. (+1) |
| `contact.email.allowed` · `.stopped` | Allowed · Stopped | Permitido · Detenido |
| `contact.email.how.bounced` · `.complained` | it bounced · they marked it as spam | rebotó · lo marcó como spam |
| `contact.email.how.backfill0049` | you marked them “No marketing emails” | usted lo marcó como “Sin correos de promociones” |
| `contact.email.bouncedExplain` | This address bounced — emails to it won't send. Fix the address to start again. | Esta dirección rebotó: los correos no se envían. Corrija la dirección para empezar de nuevo. |
| `contact.email.complainedExplain` | They marked an email as spam — we won't email them again unless they resubscribe. | Marcó un correo como spam: no le volveremos a escribir a menos que se vuelva a suscribir. |
| `contact.email.customerOnly` | They can resubscribe from the unsubscribe link in any email from you. | Puede volver a suscribirse desde el enlace para darse de baja en cualquier correo que usted le mande. |
| `contact.email.stopEmails` · `.stoppedToast` | Stop emails · Emails stopped. | Detener correos · Se detuvieron los correos. |
| `contact.email.resume` · `.resumeSubmit` · `.resumeCancel` | Resume emails… · Resume emails · Cancel | Reanudar correos… · Reanudar correos · Cancelar |
| `contact.email.resumedToast` | Emails are back on. To stop them again, use Stop emails. | Los correos se reanudaron. Para detenerlos otra vez, use Detener correos. |
| `contact.email.loadFailed` | Couldn't load their email settings. Try again. | No se pudo cargar la configuración de correo. Intente de nuevo. |
| `setup.rename.empty` (InlineField's required-empty line) | A company needs a name — this one can't be blank. | Una empresa necesita un nombre; este no puede quedar vacío. |

`START` stays the keyword (it is what the carrier acts on). After the pass, the catalogue baseline is regenerated
with its one command (`ratchet.test.ts:1-11`) as its own reviewable change: the twinned keys and the deleted
`drawer.*` keys leave the frozen list, nothing joins it.

## 11. Copy: the drawer's own keys

Every new or changed key has its `.es` twin (the ratchet admits no new key without one).

| Key | English | Español | Status |
|---|---|---|---|
| `drawer.openFull` | Open full record | Abrir la ficha completa | English changed (was "Open full page", `messages.ts:850`); twin added. The e2e reads it by key (`contact-detail.spec.ts:47`, `messaging.spec.ts:57`, `contacts-drawer.spec.ts:626`) |
| `drawer.description` (sr-only) | A quick look at this customer: how to reach them, what's next and what happened lately. | Un vistazo a este cliente: cómo comunicarse, lo que sigue y lo más reciente. | Changed (`:855`) |
| `drawer.loadFailed` | Couldn't load this customer. Try again, or open the full record. | No se pudo cargar este cliente. Intente de nuevo o abra la ficha completa. | Changed (`:849`): now the whole drawer's error only |
| `drawer.recent` | Recent | Lo más reciente | Kept (`:847`); twin added |
| `drawer.seeAll` | See all activity | Ver toda la actividad | New |
| `drawer.moreOnRecord` | Groups, properties and related people are on the full record. | Los grupos, las propiedades y las personas relacionadas están en la ficha completa. | New |
| `drawer.recent.call` · `.note` · `.submission` · `.message` · `.opportunity` | — | — | **Deleted** (`messages.ts:839-843`; route `:94-113` is their only reader) |
| `drawer.recentEmpty` | — | — | **Deleted** (`:848`); `timeline.empty` replaces it |

Reused with their twins: `record.action.*`, `record.group.*`, `record.card.nextUp`, `.retry`, `.failed`,
`record.summary.failed`, `record.facts.*`, `record.nextUp.*`, `record.activity.failed`, `timeline.*`,
`provenance.*`, `assign.*`, `contact.details`, `contact.tags`, `contact.company`. `INTERNAL_MILESTONE` and the
accents guard run over every key above. Typed text (a note, a text, a tag, a name) shows as typed.

## 12. Testing (every test can fail on wrong code; each names its probe)

### 12.1 Unit

- **The route** `summary/route.test.ts`, rewritten (its `phone_country_unconfirmed`, `phone` and `zone` cases at
  `:100-168` go with the fields): a missing contact is a 404 and **none** of `loadSummary`, `loadNextUp`,
  `listContactTimelinePage`, `loadTags`, `listContactPlaces`, `resolveSmsSender`, `getPersonPrefs` or `ledgerDb`
  ran (probe: start the parallel block before `getContact` → FAILS); **each section fails alone**: facts, Next up,
  Recent and Tags each rejecting in turn gives that section `{status: "error"}` and the other three ready (probe:
  one `Promise.all` without per-section loads → the route 500s → FAILS); **Recent is capped at 5**: the timeline
  read receives `{ limit: 5 }` (probe: drop the option → 30 → FAILS) and, given a source returning a `form`-channel
  inbox copy beside a real submission, Recent holds the submission once (probe: re-add today's direct
  `listContactMessages` read → the copy appears → FAILS; the channel filter itself is `record.test.ts`'s pin, part
  1 §12.2); `ledgerDb` is built only after `getContact` returned (probe: build it first → FAILS); a Spanish
  person's body has `locale: "es"` and "Llamar" (probe: pass `isOperator: true` for a client → FAILS); `who` keeps
  `source`, `sourceHint` and `assignedTo` exactly as today's cases `:199-240`.
- **Header actions** `header-actions.test.ts` (extended) and the route test: Text's href is
  `/dashboard/accounts/a1/contacts/c1#compose-sms` and Email's `…#compose-email` (probe: omit `composeHref` → a
  bare `#compose-sms`, which on the list page goes nowhere → FAILS); Call is the only `primary` (probe: make Text
  primary → FAILS); no phone hides Call, no email hides Email, a closed gate hides Text, and none renders disabled.
  `headerActionLabels` gives the page and the route the same words (probe: a drawer-only map with "Phone" →
  FAILS).
- **Recent rows** `recent-rows.test.ts`: every row keeps its mark (probe: drop the mark for `customer` → FAILS); a
  call's reason is `lang=""` and its summary `lang="en"`, and a mismatch summary shows nothing (probe: show the
  summary anyway → FAILS); a deal and a submission have no excerpt.
- **The parser** `drawer-summary.test.ts` (replacing `summary.test.ts`): a good body parses to itself; a body with
  a malformed `recent` is ready everywhere else with `recent` in error (probe: return `null` for the whole body
  on any bad section → FAILS); a missing `header` is the whole drawer's error; an unknown recent `kind` is dropped.
- **The drawer** `contact-drawer.wiring.test.ts`, updated: the parsed-body cases (`:111-145`) move to the new
  shape; the stale-closure cases (`:147-204`) and the Texts and Email effects (`:206-305`) stay; the phone Undo,
  Source, Assigned to cases (`:307-459`) stay, Source and Assigned to now reading `who`; **the Related people,
  Groups and Properties blocks (`:461-566`) are replaced** by one case: the drawer imports none of
  `GroupsCard`, `PlacesCard`, `RelationshipsCard` (probe: keep one → FAILS). New: Next up gets
  `addTodoLabel={null}` (probe: pass the label → FAILS); a section's Try again bumps `retryNonce` and does not
  `setFetched(null)` (probe: drop the body → FAILS); the fetch carries `?locale=` only when the list URL has one
  (probe: always append → `contacts-drawer.spec.ts:488`'s glob stops matching; here: the no-param URL is the bare
  path → FAILS); the body is wrapped in `LocaleProvider` with `body.locale`.
- **The page** `[contactId]/page.test.ts:749-757` changes as §10.2 (probe: leave the Details wrapper → FAILS;
  remove the Groups wrapper → FAILS). New render cases: Details and Tags on a Spanish page read "Nombre" and
  "agregar etiqueta"; the Texts row's status reads "Permitido" (probe: the builder ignores its locale → FAILS).
- **The allowlist**: the route joins `in-account-service-reads.test.ts` as `proven-target`, beside `/texts` and
  `/email` (`:105-106`), because it now names `ledgerDb`. **The ratchet**, the accents guard and
  `INTERNAL_MILESTONE` over every key in §10.3 and §11. **The kit** (bis-frontend): `record-header.test.ts`
  covers the drawer form (no back link; an `<h2>`; the trailing node), `RecordSection` its four states and that its
  Try again calls `onRetry`, never the router.

### 12.2 e2e (bis-e2e-qa runs it; the per-run fixture account, never `Test Client One`)

**New, in `contacts-drawer.spec.ts`:** a contact seeded with a random phone, an email and an addressed property,
plus a booking made by the booking page; opened from the list:
- the header shows the name, Call (`tel:`) as the ONLY `default`-variant action, Email, Directions; **no Text**
  (the fixture account has no approved A2P registration, `record-page.spec.ts:190`); a second contact with no
  email and no address shows only Call;
- **Email lands on the record**: clicking it loads `/contacts/{id}#compose-email` with the email tab selected and
  its body focused. **Why not Text** (D12 asked for Text): Text is hidden on the fixture account, so it cannot be
  clicked; its target is pinned by the unit test above, and a cold load of that exact URL opening the Text tab is
  already `record-page.spec.ts:206`;
- Recent shows the booking as a marked row ("Customer · booked an appointment for …", `data-author-mark`), and
  "See all activity" opens the record at `#record-timeline`;
- **Spanish**: the fixture Owner's `users.language` set to `es` and restored in `finally`, in the client session
  (the pattern of `places.spec.ts:385-400`): the drawer has `lang="es"`, reads "Llamar", "Lo que sigue", a row
  "Cliente", and the Details labels "Nombre", "Apellido";
- **Esc** closes it (kept: `:345-378`).

**Changed specs** (they lean on what leaves or changes):
- `contacts-drawer.spec.ts:526`, `:778`, `:836` and `consent-phone-country.spec.ts:113`, `:128` wait on the exact
  text "Recent" as the sign the summary loaded. The label now renders while loading, so they wait on
  `[data-drawer-section="recent"][data-state="ready"]` (or `"who"` where the Texts row is what they read).
- `contacts-drawer.spec.ts:650` reads `body.tags`: it reads `body.who.tags.tags`.
- `contacts-drawer.spec.ts:771-821` (the scroll check) keeps its hooks (C10); its seeded wall of tags still
  overflows a taller drawer.
- `places.spec.ts:373-381` asserts the shared place **in the drawer's** Properties card, which leaves: it moves to
  the second member's record page (`recordPage(page)`), where the card is.
- `contacts-drawer.spec.ts:513` (the drawer retry test): the whole-drawer error button's word changed from
  "Retry" (`common.retry`) to "Try again" (`record.card.retry`) — `contact-drawer.tsx`'s `RecordCardRetry`
  always renders the latter; the locator now targets `m["record.card.retry"]` with `exact: true`.
- `contact-detail.spec.ts:47` / `messaging.spec.ts:57` / `contacts-drawer.spec.ts:626` target
  `[data-drawer-open-full]`, not `drawer.openFull` by key: the drawer carries TWO links named "Open full
  record" (the header's ↗ and the bottom link), and only the bottom one carries this attribute, so the
  locator stays unambiguous under strict mode (both `contact-detail.spec.ts` and `messaging.spec.ts` stay
  read-only on `Test Client One`).
- `i18n-overflow.spec.ts` gains the drawer: the list at `?locale=pseudo&peek=<id>` (C9), measuring
  `[data-record-action]` and `[data-record-facts]` inside the dialog for clipping, as its record-page case does
  (`:137-164`).

The `forms.spec` unread-badge flake is unrelated and unchanged.

## 13. Rollout and rollback

**An ordinary merge.** No migration, no backfill, nothing applied to bis-ci or production. The drawer and its
route ship in the same deploy, so a tab open across the deploy holds the old bundle against the new body: the old
parser refuses it (no `recent`, the case `summary.test.ts:90` pins) and shows today's "Couldn't load" with Retry and Open full
page; a reload fixes it. Rollback: revert the PR. Served marker: a `data-drawer-section` attribute in the opened
drawer. On for every account; never shown to customers.

## 14. Agent ownership and needs (through the orchestrator)

- **bis-crm** (this spec): `contact-drawer.tsx`, the route, `lib/record/loaders.ts` (`loadRecent`),
  `lib/record/recent-rows.ts`, `lib/record/header-actions.ts` (`headerActionLabels`), `lib/contacts/
  drawer-summary.ts`, `summary-card.tsx`'s `onRetry`, the who-they-are components under `contacts/**`,
  `lib/contacts/lead-source.ts`, the `[contactId]/page.tsx` wrappers, every key in §10.3 and §11, the unit tests.
- **bis-frontend**: `RecordHeader`'s drawer form (§8.1) and `RecordSection` (C4) in `components/record/*` (ruled
  theirs, part 1 §15), their `/styleguide` entries; `assignee-field.tsx`'s `t()` (§10.1); a `closeLabel` prop on
  `SheetContent` so the close button's screen-reader "Close" (`sheet.tsx:86`, the ratchet's one count for that
  file) reads "Cerrar" in a Spanish drawer.
- **bis-comms** (review only): the Spanish of the consent copy in §10.3 (`contact.texts.*`, `contact.email.*`,
  `compose.smsHeld`) and the locale parameter on `lib/consent/texts-row.ts` / `email-row.ts`. Those two files
  carry no owner in either agent's list (the consent chain wrote them); **the orchestrator names who lands that
  edit**.
- **bis-e2e-qa**: §12.2.
- **Orchestrator**: land the DESIGN.md sentences (§17) in this PR; file §16's follow-ups in the ledger.

## 15. Effort and open risks

About 1–1.5 engineer-weeks inside item 3's 6–9 (`crm-features.md:1264-1267`): the route, loaders, parser and
drawer about 0.5; the bilingual pass over five components and 63 twins about 0.25–0.5; the kit variant about a
day (bis-frontend); unit tests and the e2e changes the rest.

- **Text and Email can land on a page whose timeline failed.** The page then hides its own Text and Email and the
  composer is not there (`[contactId]/page.tsx:172-178`); the person sees the timeline card's error with Try
  again. The drawer cannot know beforehand (C7). Accepted.
- **A deep link to a contact not on the list page** gets the blank stub row (`contacts-table.tsx:36-46`,
  `peekRow`, `:59-63`). Today the whole drawer reads blank; after this change the header shows the route's real
  name above blank fields, which makes the stub more visible (Q1).
- **Server action errors stay English.** The who-they-are labels and states convert; the error strings the
  actions return to `InlineField` (`updateContactFieldAction` and the consent actions) are `m[…]` on the server
  and are not in this pass (§16).
- **"(no name)" stays English** until `contactDisplayName` takes a locale (part 2 §16.2's follow-up); the drawer's
  header uses it.
- **More reads per open** (§5): about 20 instead of 7. Bounded; measured in the plan.
- **The layout's locale and the route's** come from the same function with the same inputs, so they agree, except
  under the QA override (which only the route sees) or when a person changes language in another tab between the
  list's render and the drawer's fetch. Both are harmless: the drawer's body follows the route (C1).

## 16. Follow-ups (for the ledger, not this PR)

- The Groups card in Spanish (its `lang="en"` wrapper, `[contactId]/page.tsx:235`; groups spec §8 kept it English).
- Server-action error strings for the who-they-are fields, in the caller's language.
- The unpaged single-contact paths of `listContactSubmissions` (`forms.ts:519-530`, bis-crm) and
  `listContactMessages` (`messaging.ts:749-775`, bis-comms) have no caller after this PR; `record.ts`'s comment
  naming "the record-summary route, which never passes a page" (`:346`) and `voice.ts:949-955`'s naming the
  drawer go stale. Remove or reword in the owners' next pass.
- `lib/dashboard/relative-time.ts:26` names `contact-drawer.tsx` as a caller; after this PR only
  `dashboard/activity-card.tsx` is.

## 17. DESIGN.md (D9; proposed, landed by the orchestrator in this PR)

The "Record views" line (`DESIGN.md:164-166`, "list click opens a right-side drawer over the list (Esc closes,
deep link opens full page)") stays true and needs no edit. Two additive sentences:

- **Record page, appended after "…not a new top-level surface." (`:242-244`):** "The list's drawer is the
  record's quick look on the same kit (decided 2026-10-13): the record's header with Call as its one primary,
  the checked facts, what is next, the five newest timeline rows and who they are, in flat sections (a mono
  label and row rules, never a glass card inside the glass sheet); everything else is on the full record, one
  link away."
- **Rule 8, appended after "…the cards below keep their own." (`:127-129`):** "The drawer's header is the same
  view: Call is its one primary, and an inline form inside the drawer keeps its own."

Rules 3, 5 and 7 need no change: Recent's statuses are dot and word, every section has its loaded, empty and
error states, and every section loads as a skeleton.

## 18. Open questions (for the owner)

| # | Question | Recommendation |
|---|---|---|
| Q1 | A `?peek=` deep link to a contact not on this list page shows the real name in the header above blank fields (the stub row) | Feed `FIELDS` from the route's contact when the row is the stub (`created_at === ""`, `missingRow`); a few lines in bis-crm's files |
| Q2 | Next up's empty state has no action in the drawer (rule 5 wants "the action that causes it") | Keep the sentence; the bottom "Open full record" is one click to "Add a To-do". Alternative: a ghost "Add a To-do" linking to the record's To-do field, which would need the record page to focus it from a hash |
| Q3 | No "Open call" on a call row in the drawer | Keep it out (no per-row links, C6); "See all activity" is one click to it |
| Q4 | The D12 e2e asked for Text landing on the composer; the fixture account cannot show Text | Accept the substitution (§12.2): Email clicked end to end, Text's URL unit-pinned, its cold load already pinned |
| Q5 | The consent copy's Spanish (§10.3) speaks for the business on a legal-adjacent subject | bis-comms reviews it before merge; the owner reads the six status and toast lines |

**Decided 2026-10-13 (owner):** Q1–Q5 all as recommended above. Orchestrator rulings: `lib/consent/texts-row.ts`
and `email-row.ts` locale changes are bis-crm's; bis-frontend adds the Sheet's `closeLabel`; the two §17 DESIGN.md
sentences land in this PR; server-action error strings stay English (follow-up, §16); the read count (~7 → ~20)
is measured in the plan, not assumed.
