# Relationships between customers — design (first release, item 2, Lane B part 1)

Date: 2026-10-11. Owner decisions (§2). Plan: `docs/crm-features.md` §4.3 item 2 (S-02, `:1260`; F-003
part, `:1262`). Research: `docs/research/2026-09-25-crm-feature-research.md` §3.1 principle 2
(`:192`), §3.2 `contact_relationships` (`:223`). Builds on 0050 (same-account keys) and 0068 (Technician).

## 1. Goal

A customer's record shows the people in their life who are also customers: Ana is Sofía's mother, Don
Beto her padrino, the neighbour can pick her up. Typed once, a relationship reads correctly on **both**
records, in English and Spanish, with the right word for a woman or a man, plus two flags: who may
pick the customer up, and who to call in an emergency.

## 2. Decisions

Owner (danlo, 2026-10-11):

| # | Question | Decision |
|---|---|---|
| R1 | How S-02 is cut | 3 specs, 2 lanes. Lane A (in parallel): client groups and the `company_name` backfill, migration 0069. Lane B: this spec (0070), then properties and equipment (0071, a later spec) |
| R2 | Where it ships | A WORKING card on today's contact drawer and contact detail page. No new top-level page; item 3 (S-03) moves the card into the record page |
| R3 | Labels | A FIXED bilingual list of pairs that read correctly from both sides, gendered Spanish where needed, plus "Other" with a typed label shown as-is on both sides (§4) |
| R4 | Who the other person is | Always a contact: found by search, or created inline (name, optional phone) as a new contact, assigned by F-085's hand-added rule |
| R5 | Flags | `can_pick_up` and `is_emergency` now. `has_custody` and `no_contact` wait for F-004 (non-goal) |
| R6 | Technician | Sees a relationship only on a customer who is theirs; the other person's name only if that person is theirs too. Write rules: §5.3 |
| R7 | One label twice for the same two people (2026-10-11, at Task 1's review) | **Support labels are DIRECTIONAL**: `emergency_contact`, `authorized_pickup`, `responsible_party`, `caregiver` (§7's four) and `landlord` (in this spec, "support label" means these five where uniqueness is concerned) allow one row per direction, so Ana can be Sofía's emergency contact AND Sofía Ana's (unique on `contact_id, related_contact_id, label_key`). **Family and symmetric labels stay one row per unordered pair**: `parent`, `godparent`, `spouse`, `sibling`, `compadre`, `referred`, `other` ("A is B's parent" refuses "B is A's parent"; "Other" compares its text case-insensitively). The two sets are `UNDIRECTED_KEYS` and `DIRECTIONAL_KEYS` (§4.1), carried by two partial unique indexes (§5.1) |

Choices this spec makes:

| # | Choice |
|---|---|
| C1 | **Spanish gender: a per-relationship word form for each side**, `contact_form` and `related_form`, each `'f'`, `'m'` or NULL (neutral). Chosen in the add dialog, editable inline, defaulting to neutral (§4.2) |
| C2 | **Flags belong to a side**, like the word forms: four booleans, `contact_can_pick_up`, `contact_is_emergency`, `related_can_pick_up`, `related_is_emergency`. Each says what the NAMED person may do for the other (§5.1) |
| C3 | **Labels live in a typed code registry**; the database holds only the key, pinned by a CHECK and a parity test (§4.1) |
| C4 | **Client-written under RLS**, like `notes` and `contact_tags`, not server-only (§5.4) |
| C5 | **(owner, 2026-10-11)** A Technician sees a hidden person's chip WITHOUT the name, "Mother: someone not on your list" / "Madre: alguien que no está en su lista", not hidden; and may add, edit or remove a relationship only when BOTH people are theirs (§5.3, §11.1) |
| C7 | **(owner, 2026-10-11)** Neutral Spanish uses the "X o Y" form: "Madre o padre", "Hijo o hija", never "Madre/padre" (§4.2, §11.2) |
| C6 | The label is not edited in place. To change "Godparent" to "Parent", remove (with Undo) and add again; the word forms and flags are inline edits |

## 3. Non-goals

`has_custody`, `no_contact` and any restricted label (F-004; `crm-features.md:941`). F-003's later parts,
"habla por" and customer-invited delegates (`:1475`, `:1657`). Client groups (Lane A). Merge (S-12).
Relationships on the timeline, in CSV import/export, blueprints, ⌘K or segments, or shown to the
customer. A per-contact gender or title field. Editing a label in place (C6).

## 4. The label model

### 4.1 A code registry, the key in the database

`packages/db/src/relationship-keys.ts` (dependency-free, imported as `@bis/db/relationship-keys` so a
client component never pulls supabase-js into the browser) exports `RELATIONSHIP_KEYS` (the 12 keys
below, `as const`), the row type, and R7's two uniqueness sets, `UNDIRECTED_KEYS` and
`DIRECTIONAL_KEYS`, which split the 12 with nothing left over; `relationships.ts` (the queries, §6)
imports them from there. The words live in `apps/web/src/lib/contacts/relationship-labels.ts`, typed `Record<RelationshipKey,
LabelEntry>`, so a key without words is a type error. `label_key` carries a CHECK of the same keys,
compared to `RELATIONSHIP_KEYS` by a db test through `pg_get_constraintdef`; a new label is a migration
plus an entry. Not a table: nobody edits these words in a screen. Not `messages.ts`: about 150 strings
would bury it, and the `.es` ratchet reads only `messages.ts` (`lib/i18n/ratchet.test.ts:9-11`), so
the registry has its own gate (§9). The card's chrome copy does go in `messages.ts` (§7). **"Other"**
stores `custom_label` (trimmed with an explicit whitespace class, 1–60 characters), shown exactly as
typed on both records in both languages. The database refuses an edge space or a blank label too
(`contact_relationships_custom_trimmed`, §5.1); the app's class must strip at least everything the
database's `[:space:]` holds, or a label the app cleaned is refused as 23514.

### 4.2 Direction, sides and the gender form

A row is (`contact_id` = A, `related_contact_id` = B, `label_key` = K), read "A is B's K". A chip names
the OTHER person: on **B's** record it names A with side `a`'s words in A's form (`contact_form`); on
**A's** record it names B with side `b`'s words in B's form (`related_form`).

**The rule: a word takes the form of the person it describes.** For every label but one, that is the
person the chip names. The exception is `referred` in Spanish, where "Referida por Ana" describes the
record's own customer; that side carries `agreesWith: "subject"`. A missing form uses the neutral
word, which is never wrong; a chosen form makes it natural.

**Why this gender model (C1).** Spanish needs BOTH people's: "Madre" names Ana, "Hija" names Sofía. A
per-contact gender field is a new personal attribute on every customer (reaching CSV, AI prompts and
segments); guessing from names is too often wrong; neutral-only reads like a government form for the
very words this feature exists for. Two nullable columns are the smallest thing that reads right:
display grammar for one relationship, never exported, never sent to a model, never filtered on.

A `LabelEntry` holds `symmetric`, `a` and `b` (identical when symmetric); each side holds a `{name}`
template per language and form (`n` always, `f` and `m` where the word changes) and the dialog's
short phrase. The list (neutral / f / m; "—" means one word for everyone):

| Key | A is B's… | On B's record, naming A: EN · ES | On A's record, naming B: EN · ES |
|---|---|---|---|
| `parent` | parent | Parent / Mother / Father: {name} · Madre o padre / Madre / Padre: {name} | Child / Daughter / Son: {name} · Hijo o hija / Hija / Hijo: {name} |
| `spouse` | spouse (sym.) | Spouse / Wife / Husband: {name} · Esposo o esposa / Esposa / Esposo: {name} | same |
| `sibling` | sibling (sym.) | Sibling / Sister / Brother: {name} · Hermano o hermana / Hermana / Hermano: {name} | same |
| `godparent` | padrino or madrina | Godparent / Godmother / Godfather: {name} · Padrino o madrina / Madrina / Padrino: {name} | Godchild / Goddaughter / Godson: {name} · Ahijado o ahijada / Ahijada / Ahijado: {name} |
| `compadre` | compadre or comadre (sym.) | Compadre or comadre / Comadre / Compadre: {name} · Compadre o comadre / Comadre / Compadre: {name} | same |
| `emergency_contact` | emergency contact | Emergency contact: {name} · Contacto de emergencia: {name} (—) | Emergency contact for {name} · Contacto de emergencia de {name} (—) |
| `authorized_pickup` | may pick B up | Authorized pickup: {name} · Puede recoger: {name} (—) | Authorized to pick up {name} · Puede recoger a {name} (—) |
| `responsible_party` | responsible for B | Responsible party: {name} · Responsable: {name} (—) | Responsible for {name} · Responsable de {name} (—) |
| `caregiver` | cares for B | Caregiver: {name} (—) · Cuidador o cuidadora / Cuidadora / Cuidador: {name} | Cares for {name} · Cuida a {name} (—) |
| `landlord` | landlord | Landlord: {name} (—) · Arrendador o arrendadora / Arrendadora / Arrendador: {name} | Tenant: {name} (—) · Inquilino o inquilina / Inquilina / Inquilino: {name} |
| `referred` | referred B | Referred by {name} (—) · Recomendación de / Referida por / Referido por {name} (**agrees with B**) | Referred {name} · Refirió a {name} (—) |
| `other` | typed | {custom_label}: {name}, both languages | same |

English keeps "Compadre"/"Comadre" (no English word; the Valley's English speakers use them); US
"Authorized" is the owner's "authorised pickup". Example, row `(Ana, Sofía, parent, 'f', 'f')`: Sofía's
record says **"Mother: Ana Ramírez"** / **"Madre: Ana Ramírez"**; Ana's says **"Daughter: Sofía
Ramírez"** / **"Hija: Sofía Ramírez"**. Forms unset: "Parent: Ana Ramírez" / "Madre o padre: Ana Ramírez".

### 4.3 The reader's language

The account layout resolves it with `requestLocale({ account, isOperator: isAgency, userLanguage })`
(`accounts/[accountId]/layout.tsx:65`; rule at `lib/i18n/request-locale.ts:6-16`) and provides it
through `LocaleProvider` (`:72`). The card reads `useLocale()`, renders chips through the registry
and chrome through `t()` (`lib/i18n/t.ts:36`), and sets `lang={locale}` on itself (decision D,
`layout.tsx:67-70`). The rest of the drawer and detail page read `m["…"]` in English
(`contact-drawer.tsx:193-334`; 0068 spec §9), so a Spanish client sees a Spanish card in a mostly
English drawer, as the sidebar already is. Deliberate: Spanish family words are the point of F-003.

## 5. Data: migration 0070

`0070_contact_relationships.sql`, by bis-db-schema. **Numbering:** 0069 is assumed to be Lane A's; the
files are independent. If Lane A lands second the numbers swap; either way the number is settled
BEFORE the CI-project apply, since the e2e check compares versions (`.github/scripts/ci-migrations-applied.sh`)
and a version on bis-ci cannot be taken back. ASCII only, no backslash (0050:86); `lock_timeout` 5s (0050:91).

### 5.1 The table

```
id uuid pk default gen_random_uuid(); account_id uuid not null references accounts(id) on delete cascade
contact_id uuid not null; related_contact_id uuid not null
label_key text not null check (label_key in (<the 12 keys>)); custom_label text
contact_form, related_form text check (in ('f','m'))                      -- null = neutral
contact_can_pick_up, contact_is_emergency, related_can_pick_up, related_is_emergency bool not null default false
created_at, updated_at timestamptz not null default now()
contact_relationships_contact_fkey (account_id, contact_id)         -> contacts (account_id, id) on delete cascade
contact_relationships_related_fkey (account_id, related_contact_id) -> contacts (account_id, id) on delete cascade
check contact_relationships_not_self (contact_id <> related_contact_id)
check contact_relationships_custom ((label_key = 'other') = (custom_label is not null), 1-60 chars)
check contact_relationships_custom_trimmed (custom_label ~ '^[^[:space:]](.*[^[:space:]])?$')
check contact_relationships_emergency (label_key <> 'emergency_contact' or contact_is_emergency)
check contact_relationships_pickup (label_key <> 'authorized_pickup' or contact_can_pick_up)
```

The composite keys reference `contacts_account_id_id_key` (0050:93-94), so both people belong to the
row's account, as 0050 made true for bookings and deals (0050:5-17). **Cascade** on either contact:
a relationship with a deleted customer means nothing; `deleteContacts` (`contacts.ts:1012`) is unchanged.

**Why four flags (C2).** Pickup and emergency go one way, and the helper is not always side A: an
adult son picks his father up from day care while the row says the father is the parent, and a
symmetric row has no direction at all. So each side has its own two flags, as it has its own word
form, and a chip shows the named person's flags. The last two CHECKs make those two labels set side
A's flag, so "who can pick Sofía up" is always a flag read.

**Uniqueness depends on the label (R7), two partial unique indexes:**
`contact_relationships_pair` on `(account_id, least(contact_id, related_contact_id),
greatest(contact_id, related_contact_id), label_key, lower(coalesce(custom_label, '')))` WHERE
`label_key` is in `UNDIRECTED_KEYS`. It refuses a family or symmetric label twice for a pair either way
round ("A is B's parent" beside "B is A's parent") and the same "Other" text in another case. Being
order-free, it needs no ordering CHECK like 0033's `contact_a < contact_b` (0033:62).
`contact_relationships_directed` on `(account_id, contact_id, related_contact_id, label_key)` WHERE
`label_key` is in `DIRECTIONAL_KEYS`: a support label is refused only twice in the SAME direction, so
Ana→Sofía and Sofía→Ana `emergency_contact` both stand. Different labels for one pair are allowed under
both. The two predicates together cover every key in the `label_key` CHECK; the db test compares each
predicate to its TypeScript set and checks the sets split `RELATIONSHIP_KEYS`, so a new key that lands
in neither (and would be unique under nothing) fails a test.

**Edge spaces in "Other".** `contact_relationships_custom_trimmed` uses a POSIX class because the
migration carries no backslash (0050:86). Its members depend on the server's locale; measured on
2026-10-11 on production and bis-ci (both PG 17.6, ICU `en_US.UTF-8`), `[:space:]` is U+0009–000D,
U+001C–001F, U+0020, U+0085, U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000. The
app trims before it writes (§6), with a class that must contain all of these. **Lookups:** `(account_id, contact_id)` and `(account_id, related_contact_id)` serve the
read `account_id = $1 and (contact_id = $2 or related_contact_id = $2)` (a BitmapOr) and both
cascades. **Two FKs to `contacts`** make an unhinted embed ambiguous (0050:39-46, PostgREST's
documented behaviour, not measured), so the queries never embed: relationships, then the people by
`.in("id", ids)`, two plain reads as `readPersonId` does (`assignment.ts:42-49`). Under RLS a hidden
person simply does not come back.

### 5.2 Row level security

Permissive `contact_relationships_member_all`, `for all to authenticated`, the tenant shape of
`0003_crm_core.sql:126-128` and `0033:78-81` (`app.is_agency() or account_id = app.current_account_id()`,
using and with check). Then 0068's RESTRICTIVE fences (0068:103-121), with `S` =
`(select app.sees_all_customers(app.current_account_id()))` and `M(x)` = `x in (select app.my_contact_ids())`:
`…_technician_read` (select) `S or M(contact_id) or M(related_contact_id)`; `…_technician_insert`,
`…_update` and `…_delete` `S or (M(contact_id) and M(related_contact_id))`. `sees_all_customers` is
coalesced (0068:75-78) and `my_contact_ids()` is empty for anyone not a current Technician
(0068:83-88), so a client with no membership and a departed Technician read nothing (0068 A1).

### 5.3 The Technician (R6)

- **Reading.** A row is visible when either person is theirs; they open only their own customers'
  records (`getContact` under RLS 404s the rest, `summary/route.ts:63-64`), so a chip appears
  exactly when the record it sits on is theirs.
- **The other person's name** shows only when that person is theirs too. Otherwise: "Mother: someone
  not on your list" / "Madre: alguien que no está en su lista", not a link, and the hidden id never
  reaches the browser. Not hidden outright, because an emergency contact or pickup flag is exactly
  what a person at the door needs to know exists; the fix is to assign that person to them.
- **Writing needs both people.** Any write changes what the OTHER record says, which they cannot
  see (0068 M4: the database refuses writes to anyone else's customer). Their picker searches with
  their own token and an inline-created person is theirs at once (§6), so adding just works. A
  hidden-person chip has no controls: "Ask your team to change this." / "Pídale a su equipo que lo cambie."

### 5.4 Grants (C4)

`revoke all … from anon, authenticated`; grant `authenticated` `select, insert, delete` and `update
(contact_form, related_form, contact_can_pick_up, contact_is_emergency, related_can_pick_up,
related_is_emergency, updated_at)`. Identity columns stay out, as 0053 did for contacts (0053:18-20).
Not 0053's server-only writes: those are tables "that record what happened" (0053:3-5); this is
operator-entered state, like notes and tags (`schema-grants-guard.test.ts:73-84`), and §5.3 binds
only a request-client write.

### 5.5 Teardown and guards

`"contact_relationships"` joins `ACCOUNT_OWNED_TABLES` just before `"contacts"`
(`account-teardown.ts:19-28`): the cascade would clear it anyway, but listing it keeps the order
explicit and needs no new paragraph in the exceptions comment (`:30-84`). `schema-grants-guard.test.ts`
gains `"authenticated contact_relationships": insertDeleteAndUpdate([the seven columns])`. The new
db test pins the policy list (`policyname, permissive, cmd`), as `server-only-writes-grants.test.ts:76-110` does.

## 6. App

- **Queries** (`packages/db/src/relationships.ts`, exported from `index.ts`):
  `listContactRelationships` (limit 100) plus the people read, `addRelationship`,
  `setRelationshipSides` (forms, flags), `removeRelationship` (returns the row) and
  `restoreRelationship` (same id, for Undo). Each emits `contact.relationship_added` / `_updated` /
  `_removed` via `emit` (`events.ts:16`) on the request client, so `record_event` takes the actor
  from the token (a Technician may append, 0068 §5.2). Payload: ids and `labelKey`, never typed text.
- **Display:** a pure `chipFor(row, subjectId, people, locale)` picks the side, the form (the
  subject's for `agreesWith`), the flags and the hidden-person text. Names use `contactDisplayName`
  (`lib/format.ts:119`), whose English "no name" fallback this card localises.
- **Actions** (`contacts/relationship-actions.ts`, `requireAccountAccess` + `dbForRequest()`):
  `addRelationshipAction(accountId, subjectId, { otherId | newPerson: { name, phone? }, labelKey,
  side, customLabel?, otherForm?, subjectForm? })` re-validates everything (key, side, custom label,
  forms, not self). **Inline create (R4)** extracts `createContactAction`'s block (`contacts/actions.ts:64-88`)
  into one shared helper: `readPersonId(db, accountId, userId)` (`assignment.ts:51`) as `assignedTo`,
  and for a caller who does not see the whole account (`lib/auth-role.ts:15`) the service client as
  `flagDb` plus `flagMatchesOf`. An `existing` answer (`contacts.ts:418`) relates that contact. Also
  `setRelationshipSidesAction`, `removeRelationshipAction` (Undo snapshot), `undoRemoveRelationshipAction`.
- **Errors** become copy (logged, `loggableError`): `23505` "That relationship is already there." is
  a duplicate under R7: the same family or symmetric label for these two people written EITHER way
  round (`contact_relationships_pair`, "Sofía is Ana's mother" when "Ana is Sofía's mother" exists,
  which is a contradiction, not a second fact), or the same support label in the SAME direction
  (`contact_relationships_directed`). The reverse of a support label is NOT a duplicate and succeeds,
  so neither the dialog nor the action pre-checks a pair; the database decides, and the copy names no
  direction, so it holds for both indexes;
  `42501` "You can't change that customer." (0068's), `23503` on Undo "Couldn't put it back.", `23514` "Pick someone else."
- **Read route** `api/accounts/[accountId]/contacts/[contactId]/relationships/route.ts`, the texts
  route's shape: `apiAccountAccess`, `getContact` on the request client (404 if hidden), the two reads,
  never `serviceDb` (0068 §7.2's guard test is unaffected).

## 7. Screens

**One card, two surfaces (R2).** `RelationshipsCard` fetches the route itself, so it loads, empties and
fails on its own (DESIGN.md Record page: rule 5 per card). Drawer: after "Assigned to"
(`contact-drawer.tsx:308`), before Recent (`:331`); its paired-fetch state needs a starting value of
its own shape (`:109-112`). Detail page: under the fields panel. Item 3 moves the same component.

- **Loaded:** a chip per relationship: label, name (links to that record), the named person's flags
  as dot-plus-word pills ("Can pick up", "Emergency contact"; rule 3), a remove button with
  `aria-label`. Names truncate (full name in `title`); the pseudo-locale's +35% wraps, never clips.
- **Inline (Record views, rule 6):** a pill toggles at once with Undo; the word form ("Mother · Father
  · Parent") is an inline select; remove is immediate, "Removed Ana Ramírez." with Undo. No confirms.
- **Add:** ghost "Add a person" opens a dialog: search customers (`listContacts` with `search`, limit
  8, this customer excluded) or "New person" (name, optional phone); "Who is {name} to {customer}?"
  in the reader's language (both directions of the asymmetric labels, the helper side of the four
  support labels, "Other" with the hint "Don't put custody or court details here."); a "Words" row per
  gendered side, neutral preselected; a live preview of both chips; one primary "Add" (rule 8); Esc closes.
- **Empty:** "No related people yet. Add a parent, a spouse, a padrino or an emergency contact, and it
  shows on both records." **Loading:** two skeleton chips (rule 7). **Error:** "Couldn't load related
  people." with Retry (`common.retry`). Tokens only, both themes, blur fallback, no hero (rule 11).

Copy under `relationships.*` in `messages.ts`, each key with a `.es` twin (usted): "Related people" /
"Personas relacionadas"; "Add a person" / "Agregar a una persona"; empty / "Todavía no hay personas
relacionadas. Agregue a la mamá o el papá, al esposo o la esposa, a un padrino o un contacto de
emergencia, y aparecerá en los dos registros."; error / "No se pudieron cargar las personas
relacionadas."; "Can pick up" / "Puede recoger"; "Emergency contact" / "Contacto de emergencia";
"Removed {name}." / "Se quitó a {name}."; §6's errors; §5.3's two lines.

## 8. Duplicates, delete and merge

`contact_duplicate_flags` (0033:52-66) is untouched. Deleting a contact (Owner-only, 0066:84) cascades
its relationships off the other records, with no event. **Merge (S-12, deferred)** must re-point the
loser's relationships to the winner and drop rows that would collide with either unique index (R7:
order-free for family labels, per direction for support labels) or turn into self-relationships (the two duplicates related to each other); its spec must say so.

## 9. Testing (every test can fail on wrong code; each names its mutation probe)

- **DB schema** `packages/db/src/test/contact-relationships-schema.test.ts` (`withRollback`, seeded as
  `technician-scope.test.ts:1-50`, runs on a local replica): another tenant reads 0; crossed-account
  insert 23503 on each side, by constraint name (probe: single-column FK on either side); self 23514; a
  family or symmetric label reversed, or "Other" in another case, 23505 on `_pair` (probe: drop
  `least/greatest` or `lower`); a support label reversed succeeds and the same direction twice is 23505
  on `_directed` (probes: one order-free index over every key; drop `_directed`); each index predicate
  equals its TypeScript set and the sets split `RELATIONSHIP_KEYS`; edge-space or blank "Other" 23514;
  both flag CHECKs; a bad form on either side 23514; client UPDATE of `label_key` 42501; either
  contact's delete removes the row; CHECK keys equal `RELATIONSHIP_KEYS`. **Technician:** reads a row
  with one side theirs, not neither; inserts, updates and deletes only with both, whichever side theirs
  is on (probes: write fences with the read expression, or on `related_contact_id` only → FAILS); Owner,
  Staff, agency unchanged; no-membership client 0; policies pinned. Plus the `schema-grants-guard.test.ts` entry (§5.5).
- **DB queries** `packages/db/src/test/relationships.test.ts` (`withTestAccount`, live): the reads, the
  writes and their events, Undo's same id, SQLSTATEs kept; teardown leaves nothing.
- **Registry** (`apps/web/src/lib/contacts/relationship-labels.test.ts`, with `chipFor`; input checks in
  `relationship-input.test.ts`, the inline-edit state in `relationship-view.test.ts`): every key has `a`/`b` × `en`/`es` with an `n` form and `{name}` once; `f` implies `m`;
  symmetric sides equal; no `{{` or milestone codes (probe: delete one `es.b` → fails naming the key).
  `chipFor`: both orientations, forms, `referred`'s subject agreement, hidden person, flag side.
- **Actions and route** (`contacts/relationship-actions.test.ts`, the route's `route.test.ts`, the card's
  `relationships-load.test.ts` and `relationships-card.test.ts`, as the plan names them): refusals; inline create assigns `readPersonId`'s person, narrow path for a
  Technician, `existing` reused; error mapping; Undo keeps the id; events carry the actor; the route
  404s an invisible contact and drops a hidden id; `request-locale-callers.test.ts`; drawer wiring test.
- **e2e** `relationships.spec.ts` (bis-e2e-qa runs it), per-run fixture account only, never Test Client
  One, names in `e2e/fixtures/fixture-names.test.ts`: inline-create a mother; both chips right; toggle
  "Can pick up"; remove and Undo; `?locale=es` (QA override, `request-locale.ts:31-32`) shows "Madre:".

## 10. Rollout and deploy order

0070 on the CI project (`ci-project-setup.yml`), then production, then parity, all **before merge**
(the e2e job fails while bis-ci lacks it). No backfill; on for every account; never shown to
customers. Served-HTML marker: the card's title on a contact detail page.

**Migration before app:** an empty table nobody reads; safe, and the fences ship in the same file, so
the table never exists without them. **App before migration:** reads and writes hit a missing table
(assumed PGRST205), so the card shows its error state; nothing is exposed, so **data-safe** but not
usable. **Rollback:** revert the app and leave the table; dropping it destroys what operators typed.

## 11. Effort, open risks and owner questions

Effort: about 1.5–2 of S-02's 5–6 engineer-weeks, mostly §9's tests and the dialog. Risks: a typed "Other" label can carry what R5 holds back ("no contact, court order"), visible to
all, Technicians included; the hint discourages it, F-004 closes it. §9's registry test is its only
`.es` gate. One person's word form can differ across relationships (a contact default could come later).

Owner rulings (danlo, 2026-10-11, after reading this spec):

1. **A Technician's chip for a person not on their list:** DECIDED, shown without the name ("Mother:
   someone not on your list" / "Madre: alguien que no está en su lista"), not hidden (C5).
2. **Spanish neutral wording:** DECIDED, the "X o Y" form, "Madre o padre" (C7): it reads aloud and a
   screen reader says it right.
