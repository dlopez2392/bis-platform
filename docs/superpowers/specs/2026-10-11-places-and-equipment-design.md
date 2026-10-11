# Properties and equipment on the customer record — design (first release, item 2, Lane B part 2)

Date: 2026-10-11. Owner rulings (§2). Plan: `docs/crm-features.md` §4.3 item 2 (S-02, `:1260`). Research:
`docs/research/2026-09-25-crm-feature-research.md` §3.2 `service_locations` and `equipment` (`:224-225`),
home services part one (`:791`). Builds on 0050, 0068 and 0069. Siblings: `2026-10-11-client-groups-design.md`
(0069, merged) and `2026-10-11-contact-relationships-design.md` (0070, `feat/s02-relationships`, not merged).

## 1. Goal

The technician arriving at 7 AM knows where the house is and what is installed there. A customer's
record shows their **properties**: the address as the customer says it, a landmark ("the blue house past
the canal", "frente a la iglesia"), how to get there, and "Open map". Each property lists its **equipment**
(the AC upstairs, a Rheem water heater, a sprinkler controller) with brand, model, serial, install date and
warranty. Replacing a unit keeps the old one in its history, marked replaced and when. A property is the
person's own or shared by their household or business customer (0069), and shows on every member's record.

## 2. Decisions

Owner (danlo, 2026-10-11), given in the brief:

| # | Question | Decision |
|---|---|---|
| P1 | Where it ships | Working UI on today's contact drawer and contact page, like the Groups and Related people cards. Not a new top-level surface (DESIGN.md module contract). Item 3 (S-03) moves it into the record page |
| P2 | Equipment history | Replacing a unit keeps the old one, marked replaced, with when. **No maintenance reminders** in this release |
| P3 | Technician | Sees a property or equipment only through a customer assigned to them, enforced by the database (restrictive RLS, 0068/0069/0070's shape) |
| P4 | Language | Bilingual EN/ES, 7 AM copy, trades Spanish ("Cómo llegar", "Equipo") |
| P5 | Ownership | A property belongs to a person or is shared through a household or business group (0069). The smallest model that serves HVAC, plumbing, landscaping and pest control in the Valley |
| P6 | Address | Lenient (F-015): free text, optional structured parts, landmarks, "Cómo llegar". No geocoding service |

Choices this spec makes; **(owner, 2026-10-11)** marks the ones ruled on in §13:

| # | Choice |
|---|---|
| C1 | **(owner, 2026-10-11, O1)** **The word is "Property" / "Propiedad"**; the tables are `places` and `equipment`. "Propiedad" is what Valley trades and landlords say ("en la propiedad", "tengo tres propiedades") and fits a home, a rental and a commercial site. Rejected: "Lugar" (vague; reads like a form's "lugar de nacimiento"), "Ubicación" (a phone's GPS word), "Domicilio" (legal residence, wrong for a rental or a branch), "Dirección" (the address field itself, and also "management"). The table is `places`, not `properties` (in code that means object fields, and it is HubSpot's word for fields), nor the study's unbuilt `service_locations` |
| C2 | **(owner, 2026-10-11, O4)** **One owner per property, a person OR a group** (`num_nonnulls(contact_id, client_group_id) = 1`), the study's own model (`:224`). Sharing reuses 0069 rather than adding a second sharing mechanism: a household's house belongs to the household, a business's sites to the business customer, a landlord's rentals to the landlord. No join table this release (tenants: not yet, O4) |
| C3 | **Equipment status is derived, not stored.** A replacement is a new row whose `replaces_id` names the old unit at the same place; a unit is "replaced" when a row replaces it, and "when" is the new unit's `installed_on`, which a replacement must carry (CHECK). A replacement is ONE insert (atomic without a function), its Undo one delete, and the two facts cannot disagree |
| C4 | **Client-written under RLS (0070's C4), not server-only (0069's A1).** Operator-entered state, like `notes`, `contact_tags` and relationships. None of 0069's reasons apply: no find-or-create across rows a Technician cannot see, no multi-statement transaction (C3), no derived column to sync. Every Technician fence is then the database's, with no service-client proof step and no new `in-account-service-reads.test.ts` entry |
| C5 | **Removing a property deletes it when it has no equipment, and otherwise moves it to "Removed properties"** (`archived_at`), where "Put back" restores it. A click never destroys equipment history; a restrictive delete policy makes the database refuse to delete a place that has equipment |
| C6 | **Removing a unit deletes it** (Undo re-inserts it with the same id). Only a unit nothing has replaced can go: the database refuses the rest (`equipment_replaces_fkey`), so history rows have no Remove |
| C7 | **(owner, 2026-10-11, O9)** **One card, "Properties", with each property's equipment nested under it**, not a second Equipment card: equipment exists only at a property, so a second card would repeat every property as a header and need the first card's data to add a unit. One read, one boundary |
| C8 | **`created_by` is stamped by the database** (a trigger sets `app.current_user_id()` on every `authenticated` insert, whatever the client sent). Not shown this release; stored now so S-03's timeline can give each row its author mark (DESIGN.md Provenance) without an impossible backfill. A Technician cannot read `events` (0068 4e), so provenance must live on the row |

Owner rulings (danlo, 2026-10-11, after reading this spec; each took the recommendation in §13):

| # | Ruling |
|---|---|
| O1 | The word is "Property" / "Propiedad" (C1) |
| O2 | A Technician may edit, remove and put back a property shared by a household or business, with Undo. They still cannot change who it belongs to (§5.3) |
| O3 | Deleting a customer deletes the properties only they own, with their equipment (cascade, §5.1) |
| O4 | Tenants: not yet. No link between a tenant and a place this release |
| O5 | No CSV import or export of properties this release (§9) |
| O6 | Search by address is deferred |
| O7 | A unit taken out with nothing replacing it uses Remove for now |
| O8 | "Open map" is a Google Maps link, labelled as an assumption (§5.1) |
| O9 | One "Properties" card, with equipment nested under each property (C7) |

## 3. Non-goals

Maintenance reminders, agreements and visits (P2; F-179, F-007). Data plates from a photo (F-027, which
needs this table). The portal's property view (F-062, F-063). Geocoding, pins, distance or routing (P6).
Gate and alarm codes as fields (held until roles, study `:224`; F-004). Colonias, municipios and Mexican
formats as structured parts (F-015 owns the component and widens §5.1's parts additively). A job address
on bookings or forms (F-047). Properties on the timeline, in ⌘K or contact search, CSV (§9), blueprints,
segments or Sofía. Tenants linked to a place (O4). Moving a property to another customer, and merge
(S-12). Equipment kinds from a fixed list (packs add them). Permanent purge of a removed property (S-04).

## 4. Roles

| Capability | Owner | Staff | Technician | Agency |
|---|---|---|---|---|
| See properties and equipment | all | all | only of their own customers and those customers' groups (P3) | all |
| Add, edit, remove (C5), put back a property | yes | yes | on any property they can see (O2) | yes |
| Change who a property belongs to | yes | yes | **no** (trigger, §5.3) | yes |
| Add, edit, replace, remove equipment | yes | yes | on any property they can see | yes |

## 5. Data: migration 0071

`0071_places_and_equipment.sql`, by bis-db-schema. Depends on 0068 and 0069 (merged), not on 0070.
**Numbering (settled 2026-10-11):** the relationships lane (0070) merges first, so this is 0071, and 0070
reaches bis-ci before it (a version on bis-ci cannot be taken back, `.github/scripts/ci-migrations-applied.sh`).
ASCII only, no backslash (0050:86). `set local lock_timeout = '5s'`.

### 5.1 Tables

```
places: id uuid pk default gen_random_uuid(); account_id uuid not null -> accounts(id) on delete cascade;
  contact_id uuid null; client_group_id uuid null;
  label text null (1-80)        -- "Casa", "Rental on 10th St", "Sucursal Pharr"
  address text null (1-300)     -- as the customer says it; the truth, never parsed
  landmark text null (1-200)    -- "the blue house past the canal"
  directions text null (1-1000) -- "Cómo llegar": the gate, the dogs, where to park
  city, region text null (1-80); postal_code text null (1-12); country text null check (in ('US','MX'))
  archived_at timestamptz null; created_by uuid null -> users(id) on delete set null; created_at, updated_at;
  places_contact_fkey (account_id, contact_id) -> contacts(account_id, id) on delete cascade;
  places_group_fkey (account_id, client_group_id) -> client_groups(account_id, id) on delete cascade;
  check places_one_owner (num_nonnulls(contact_id, client_group_id) = 1);
  check places_findable (num_nonnulls(address, landmark, directions) >= 1);
  constraint places_account_id_id_key unique (account_id, id)
equipment: id uuid pk default gen_random_uuid(); account_id uuid not null -> accounts(id) on delete cascade;
  place_id uuid not null; name text not null (1-80)    -- "AC upstairs", "Calentador de agua"
  make, model, serial text null (1-60); notes text null (1-1000); installed_on, warranty_until date null;
  replaces_id uuid null; created_by uuid null -> users(id) on delete set null; created_at, updated_at;
  equipment_place_fkey (account_id, place_id) -> places(account_id, id) on delete cascade;
  equipment_replaces_fkey (place_id, replaces_id) -> equipment(place_id, id);   -- no action
  constraint equipment_place_id_id_key unique (place_id, id);
  check equipment_not_self (replaces_id <> id);
  check equipment_replacement_dated (replaces_id is null or installed_on is not null);
  check equipment_warranty_order (warranty_until is null or installed_on is null or warranty_until >= installed_on)
```

Each `(a-b)` is `app.tidy_text(col, b)`, a new `immutable` SQL helper: `p is null or (char_length(p) between
1 and p_max and p ~ '^[^[:space:]](.*[^[:space:]])?$')`, 0070's POSIX class (no backslash), so a value is
stored trimmed and never blank (PG's `.` matches a newline, so multi-line directions pass). The app trims
with a class holding at least 0070's measured `[:space:]` set (U+0009–000D, U+001C–001F, U+0020, U+0085,
U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000), or what it cleaned is refused as 23514.

**Lenient (P6).** One of address, landmark or directions is enough: a ranch off FM 1015 with no number is
"past the Valero, second gate on the left". Structured parts are optional, never parsed out of `address`,
and length-checked only (US 5/9 and MX 5-digit codes both pass). **"Open map"** is a link the browser
builds, `https://www.google.com/maps/search/?api=1&query=` + the encoded address, city, region and postal
code, shown only when `address` is set. **Assumption, not verified:** Google documents this URL form as
needing no API key and opening the Maps app on phones. The user starts the navigation; BIS calls nothing.

**Keys and cascades.** Composite FKs (0050's shape; `contacts_account_id_id_key` 0050:93,
`client_groups_account_id_id_key` 0069:56) make a crossed row unwritable. `equipment_replaces_fkey` on
`(place_id, replaces_id)` also keeps a replacement at the SAME place (unchecked when NULL, MATCH SIMPLE). A
deleted contact or group takes the places it owns and their equipment (O3); a deleted account takes all
(an old build's teardown still succeeds, 0069 §5.1's reason). Deleting a unit something replaced is refused;
a place's cascade removes the whole chain in one statement, which the end-of-statement check accepts. No
cycle is possible: `replaces_id` is not updatable (§5.2), so a row only points at an older one.

**Indexes:** `places_by_contact (account_id, contact_id) where contact_id is not null`; `places_by_group
(account_id, client_group_id) where client_group_id is not null`; `equipment_by_place (account_id, place_id)`;
`equipment_one_successor unique (replaces_id) where replaces_id is not null` (no unit replaced twice; it also
serves the no-action check). `created_by` is unindexed (a `users` delete is rare).

### 5.2 RLS, grants and the Technician

- `enable row level security` on both. Permissive `places_member_all` and `equipment_member_all`, `for all
  to authenticated`, 0070's tenant shape (`app.is_agency() or account_id = app.current_account_id()`).
- `app.my_place_ids() returns setof uuid`: the account's places whose `contact_id in (select
  app.my_contact_ids())` or `client_group_id in (select app.my_client_group_ids())` (0069:94-98). `stable
  security definer set search_path = ''`, `authenticated, service_role` only, so the equipment policy never
  re-enters the places policy. Empty for anyone not a current Technician (0068:83-88).
- Restrictive, `for all`, using and with check, `S` = `(select app.sees_all_customers(app.current_account_id()))`:
  `places_technician_scope` = `S or contact_id in (select app.my_contact_ids()) or client_group_id in (select
  app.my_client_group_ids())`; `equipment_technician_scope` = `S or place_id in (select app.my_place_ids())`.
  Reading and writing need the same reach (unlike 0070, a property has one owner): one policy per table,
  0068 4b's shape. A no-membership client and a departed Technician get nothing (0068 A1).
- Restrictive `places_delete_empty … for delete to authenticated using (not exists (select 1 from
  public.equipment e where e.place_id = places.id))`, every role (C5). A refused DELETE affects 0 rows rather
  than raising, so the action reads the deleted rows back (`.select("id")`) and archives on 0. Cascades from
  a contact, group or account delete are referential actions, which PG documents as bypassing row security
  (pinned by a test, §10).
- Grants: `revoke all … from anon, authenticated`; `authenticated` gets `select, insert, delete` on both,
  `update (label, address, landmark, directions, city, region, postal_code, country, contact_id,
  client_group_id, archived_at, updated_at)` on `places` and `update (name, make, model, serial, notes,
  installed_on, warranty_until, updated_at)` on `equipment`. `account_id`, `place_id`, `replaces_id` and
  `created_by` stay out, as 0070 kept identity columns out. `service_role` gets all four verbs.

### 5.3 Triggers, teardown and guards

- `app.stamp_created_by()`, `before insert` on both: `if current_user = 'authenticated' then new.created_by
  := app.current_user_id(); end if`. Plain (not definer), so `current_user` is the caller, as
  `app.tasks_assignee_guard` (0068:172-183); the service role (demo seed, tests) keeps its own value (C8).
- `app.places_owner_guard()`, `before update of contact_id, client_group_id on places`: raises `42501` when
  either changes, `current_user = 'authenticated'` and `not coalesce(app.sees_all_customers(new.account_id),
  false)`. Moving a property between a person and a group takes it off, or puts it on, other members'
  records: 0069 A6's rule that group-level decisions are Owner and Staff work, in 0068's trigger shape. The
  with-check alone would let a Technician move it anywhere inside their reach.
- The four functions `revoke all … from public, anon`, granted as 0068:90-97. No write function (C4).
- `ACCOUNT_OWNED_TABLES` (`account-teardown.ts:19-28`) gains `"equipment", "places"` just before
  `"client_group_members"`, so the demo leftovers check and the e2e sweep cover them (0070's branch adds
  `"contact_relationships"` on the same line: an additive merge). `schema-grants-guard.test.ts`'s
  `EXPECTED_WRITES` (`:62-91`) gains `"authenticated equipment"` and `"authenticated places"` entries,
  `insertDeleteAndUpdate` of the eight and twelve columns above.

## 6. App

- **Queries** `packages/db/src/places.ts` (exported from `index.ts`, additively): `listContactPlaces(db,
  accountId, contactId)` reads the contact's group ids, then places `contact_id = X or client_group_id in
  (…)` (active first, limit 100, real counts), then their equipment `.in("place_id", ids)` (limit 500), then
  the group names: no embed, RLS alone trimming a Technician's view. Writes: `addPlace`, `updatePlace`,
  `setPlaceOwner`, `removePlace` (answers `deleted` or `archived`), `putBackPlace`, `restorePlace` (same id),
  `addEquipment`, `replaceEquipment`, `updateEquipment`, `removeEquipment`, `restoreEquipment` (same id and
  `replaces_id`). Each returns the row or its snapshot and keeps the SQLSTATE.
- **Input** `apps/web/src/lib/contacts/place-input.ts` (pure): trims, lengths, the at-least-one rule, country,
  dates not after the account's today, a replacement's date, warranty after install. The server re-runs it on
  every action; the browser runs it for instant messages.
- **Actions** `contacts/places-actions.ts`: `requireAccountAccess` + `dbForRequest()`, never `serviceDb()`.
  `addPlaceAction(accountId, subjectId, input)` checks the chosen owner is the subject or one of the subject's
  groups, read through the request client. Every edit answers the prior values for its Undo (the
  relationships spec's `setRelationshipAction` shape). Errors become copy, logged with `loggableError`:
  the owner guard's `42501` → `places.moveRefused`; any other `42501` → `places.refused`; `23505` on
  `equipment_one_successor` → `equipment.alreadyReplaced`; `23503` on an Undo → "Couldn't put it back.";
  `23514` → "Check the details and try again." (the input module re-checks every CHECK first, so a 23514
  means the app and 0071 disagree).
- **Read route** `api/accounts/[accountId]/contacts/[contactId]/places/route.ts`, the `email` route's shape:
  `apiAccountAccess`, `getContact` on the request client (404 when hidden), `listContactPlaces`, and the
  account's `today` (`YYYY-MM-DD` in its zone, via `renderZone`), so warranty status and the future-date rule
  never use the browser's clock or zone.
- **Events** via `emit` (`events.ts:16`) on the request client, so `record_event` takes the actor from the
  token (a Technician may append, 0068 §5.2): `place.added`, `.updated` (`fields`), `.owner_changed`,
  `.removed` (`mode`), `.restored`; `equipment.added`, `.replaced` (`replacedId`), `.updated` (`fields`),
  `.removed`, `.restored`. Payload: ids (`contactId` = the record it was done from, `placeId`, `equipmentId`)
  and field names, **never typed text**: an address is personal data and `events` is append-only.
- **Timeline and provenance.** Nothing here reaches the record timeline this release (the relationships spec
  made the same call; the unified timeline is S-03's). When S-03 adds "Replaced the AC" rows, every
  person-written row has its author in `created_by` (C8); NULL comes only from the service role (the demo
  seed), and S-03 must give those a mark from DESIGN.md's closed set, never leave them unmarked.

## 7. Undo, action by action (rule 6: everything runs at once; nothing asks "Are you sure?")

| Action | Toast | Undo does |
|---|---|---|
| Add a property | "Added {place}." | deletes it (no equipment yet) |
| Edit a property or unit field (inline) | "Saved." | writes the prior value the action returned |
| Change who it belongs to (Owner, Staff) | "{place} now belongs to {owner}." | sets the prior owner |
| Remove a property with no equipment | "Removed {place}." | re-inserts it with the same id |
| Remove a property with equipment | "Moved {place} to Removed properties." | clears `archived_at` |
| Put back a removed property | "Put back {place}." | sets `archived_at` again |
| Add a unit | "Added {name}." | deletes it |
| Replace a unit | "Replaced. The old unit is kept in its history." | deletes the new unit; the old one is current again |
| Remove a unit nothing replaced | "Removed {name}." | re-inserts it with the same id and `replaces_id`; `23505` if replaced again meanwhile: "Couldn't put it back." |

A re-inserted row gets a fresh `created_at` and `created_by` (C8's trigger cannot be told otherwise), as
the relationships spec's Undo re-stamps `created_at`. Accepted: Undo follows within seconds, by the same person.

## 8. Screens

**The Properties card.** Drawer: after the Groups card (`contact-drawer.tsx:272`), so "what they have" sits
together. Contact page: the right column, between Groups and Deals (`[contactId]/page.tsx:166-171`). It
fetches its own route, so it loads, empties and fails on its own (DESIGN.md Record page). It reads
`useLocale()`, renders through `t()` (`lib/i18n/t.ts:36`) and sets `lang={locale}` on itself, as the
relationships card does, so a Spanish client sees "Cómo llegar" in today's mostly English drawer. Tokens
only, both themes, the blur fallback, no hero (rule 11), rows split by rules, never a box in a glass card.

- **Loaded:** one row per active property, the person's own first, then each group's (main group first):
  title (label, else the address's first line, else the landmark, else "Property"), address and "city,
  region ZIP", landmark, how to get there, "Open map" (`target="_blank" rel="noopener noreferrer"`), and for
  a group's property a muted "Shared with {group}". Then "Equipment ({count})": each current unit as name,
  brand and model, serial, "Installed {date}", and warranty as dot plus word (rule 3), "Under warranty until
  {date}" or "Warranty ended {date}", against the route's `today`. A unit with history shows "Earlier units
  ({count})", collapsed, each "Replaced {date}" with its brand and model. Dates are `date` values printed
  with `formatDateUTC` (`lib/format.ts:96`) in the reader's locale.
- **Inline edits** (Record views): every text and date field is click, edit, save on blur, Undo toast.
  "Belongs to" is an inline select, Owner and Staff only ("{name} only", "Shared with {group}").
- **Add a property:** ghost "Add a property" opens a dialog: name (optional), address, "City, state and ZIP"
  (collapsed), landmark, how to get there (with its hint), "Belongs to" (default the person, their groups
  listed). One primary "Add" (rule 8); Esc closes; focus returns to the trigger. **Add equipment** under a
  property; **Replace** on a current unit opens the same form with the name carried over and "When was it
  replaced?" defaulting to the account's today, required.
- **Remove:** a ghost icon button with `aria-label` ("Remove {name}") on properties and on current units
  nothing replaced. "Removed properties ({count})" is a collapsed list at the card's foot, each with "Put back".
- **Empty** (rule 5): `places.empty` with "Add a property"; a property with no units: "No equipment here
  yet." with "Add equipment". **Loading** (rule 7): two skeleton rows shaped like a property. **Error:**
  "Couldn't load properties." with "Try again", inside the card only.
- **Keyboard:** every control reachable by Tab with a visible `:focus-visible` ring; disclosures are buttons
  with `aria-expanded`; single-line fields save on Enter or blur and cancel on Esc; in "How to get there"
  Enter is a new line and blur saves. Names truncate with the full text in `title`; the pseudo-locale's +35%
  wraps, never clips. A Technician has no "Belongs to"; everything else applies to what they can see.

**Needs from bis-frontend** (`components/inline-field.tsx`): a multi-line and a date input, a fourth
serializable validation arm keyed to `place-input.ts`, and a `locale`, so its own `common.undo`,
`inline.edit` and `inline.empty` follow the card's language. Additive; the three existing arms are unchanged.

**Copy** under `places.*` and `equipment.*` in `messages.ts`, each with its `.es` twin (usted; the ratchet,
`lib/i18n/ratchet.test.ts`, freezes keys without one); role words as `team.role.*` (Dueño, Empleado):

| Key | English | Español |
|---|---|---|
| `places.title` · `.add` · `.untitled` | Properties · Add a property · Property | Propiedades · Agregar una propiedad · Propiedad |
| `places.empty` | Homes and job sites for this customer show up here, with how to get there and the equipment on site. | Aquí aparecen las casas y los lugares de trabajo de este cliente, con cómo llegar y el equipo que hay. |
| `places.label` · hint | Name · Like Home or Rental on 10th St | Nombre · Como Casa o Renta en la calle 10 |
| `places.address` · `.moreAddress` | Address · City, state and ZIP | Dirección · Ciudad, estado y código postal |
| `places.landmark` · hint | Landmark · Like the blue house past the canal | Referencia · Como la casa azul pasando el canal |
| `places.directions` · hint | How to get there · The gate, the dogs, where to park. Don't put gate or alarm codes here. | Cómo llegar · El portón, los perros, dónde estacionarse. No ponga aquí códigos del portón ni de la alarma. |
| `places.needOne` · `.openMap` | Add an address, a landmark or how to get there. · Open map | Agregue una dirección, una referencia o cómo llegar. · Abrir mapa |
| `places.belongsTo` · `.onlyPerson` · `.sharedWith` | Belongs to · {name} only · Shared with {group} | Es de · Solo de {name} · Compartida con {group} |
| `places.removedList` · `.putBack` | Removed properties ({count}) · Put back | Propiedades quitadas ({count}) · Recuperar |
| `places.loadFailed` · `.retry` | Couldn't load properties. · Try again | No se pudieron cargar las propiedades. · Intentar de nuevo |
| `places.refused` · `.moveRefused` | You can't change that property. · Only an Owner or Staff can change who a property belongs to. | No puede cambiar esa propiedad. · Solo el Dueño o un Empleado puede cambiar de quién es una propiedad. |
| `equipment.title` · `.add` · `.empty` | Equipment ({count}) · Add equipment · No equipment here yet. | Equipo ({count}) · Agregar equipo · Todavía no hay equipo aquí. |
| `equipment.name` · hint | What it is · Like AC upstairs or Water heater | Qué es · Como Aire de arriba o Calentador de agua |
| `equipment.make` · `.model` · `.serial` · `.notes` | Brand · Model · Serial number · Notes | Marca · Modelo · Número de serie · Notas |
| `equipment.installedOn` · `.warrantyUntil` | Installed {date} · Warranty until | Instalado el {date} · Garantía hasta |
| `equipment.underWarranty` · `.warrantyEnded` | Under warranty until {date} · Warranty ended {date} | En garantía hasta el {date} · La garantía terminó el {date} |
| `equipment.replace` · `.replaceDate` · `.replacedOn` | Replace · When was it replaced? · Replaced {date} | Reemplazar · ¿Cuándo se reemplazó? · Reemplazado el {date} |
| `equipment.history` · `.alreadyReplaced` · `.futureDate` | Earlier units ({count}) · That unit was already replaced. · Pick a date that isn't in the future. | Equipos anteriores ({count}) · Ese equipo ya se reemplazó. · Elija una fecha que no sea futura. |

Plus §7's toasts and §6's errors, each twinned. Typed text (an address, "Aire de arriba") is shown as typed,
in the language it was typed, never translated.

## 9. CSV, blueprints, search and AI

**CSV import and export: out of this release** (O5). The contact CSV is one row per person and its
columns are pinned to the export (`IMPORT_FIELDS`, `lib/contacts/csv.ts:87`, by `csv.test.ts`). Properties
are one-to-many and equipment a level deeper, so neither fits a contact row without inventing which property
a column means, and export, import, export would no longer be identical. A client switching from Jobber
or Housecall Pro brings properties through S-36's importers or a separate properties CSV later. Unchanged:
the CSV wizard, blueprints (setup, not customer data), ⌘K, contact search, Sofía and the concierge.

## 10. Testing (every test can fail on wrong code; each names its mutation probe)

- **Schema** `packages/db/src/test/places-schema.test.ts` (`withRollback`, on the local PG18 replica first):
  another account's contact or group 23503 by constraint name (probe: a single-column FK); both owners and
  neither 23514; address, landmark and directions all NULL 23514; an edge space, a blank, an over-long value
  23514, with `app.tidy_text` on each boundary and a newline inside directions accepted; country `'CA'`
  23514; a replacement of a unit at another place 23503 (probe: FK on `replaces_id` alone → accepted →
  FAILS); a second successor 23505; a replacement without `installed_on`, a warranty before install 23514;
  deleting a replaced unit 23503, its successor allowed; deleting a place with equipment affects 0 rows,
  without 1 (probe: drop `places_delete_empty`); a contact, a group and an account delete remove their places
  and every unit, chain included (the RI-bypasses-RLS pin); client UPDATE of `place_id`, `replaces_id` or
  `created_by` 42501; an insert naming another user's `created_by` stores the caller's (probe: drop the
  trigger); exact `pg_policies` rows (`server-only-writes-grants.test.ts`'s shape); the guard entries.
- **RLS** `packages/db/src/test/places-rls.test.ts` (its own seed, as the groups spec needed: a household
  shared by the Technician's customer and someone else's): a Technician reads and writes their customer's
  place and their customer's household's place; reads 0 of another customer's and of a group with none of
  theirs, and an insert there is 42501; equipment follows its place; changing the owner 42501 (probe: drop
  the guard) while Owner, Staff and agency may; another account, a no-membership login and a departed
  Technician read 0. Probes: drop either restrictive policy; key the places fence on `contact_id` only (the
  household case FAILS).
- **Queries** `packages/db/src/test/places.test.ts` (`withTestAccount`, live): the read's composition and
  order, `removePlace` answering `deleted` vs `archived`, each write's event and actor, Undo's same id,
  SQLSTATEs kept; teardown leaves nothing.
- **Web:** `place-input.test.ts` (the trim class holds every code point of 0070's set, probe: drop U+00A0;
  lengths; at-least-one; future date against the given today); a pure `places-view.test.ts` (title fallback,
  warranty on the boundary day, chains newest first, owner labels, the map URL encoded and absent without an
  address); `places-actions.test.ts` (refusals, 0 deleted rows → archive, error mapping, Undo payloads, no
  `serviceDb` import); the route's `route.test.ts` (404 on a hidden contact, `today` in the account zone);
  `places-card.test.ts` (states; no "Belongs to" for a Technician); `contact-drawer.wiring.test.ts` (after
  Groups); `request-locale-callers.test.ts`; the ratchet and the `INTERNAL_MILESTONE` guard.
- **e2e** `places.spec.ts` (bis-e2e-qa runs it; per-run fixture account, never Test Client One; names in
  `e2e/fixtures/fixture-names.test.ts`; rows deleted in `afterAll`, errors checked): Owner adds a property
  with only a landmark and directions, adds an address and sees "Open map"; adds an AC, replaces it, sees
  "Replaced {date}" under Earlier units, Undoes; removes an empty property and Undoes; removes one with
  equipment and puts it back; shares one with a household and sees it on the co-member's drawer; with their
  `users.language` set to Spanish (and reset) sees "Cómo llegar". In `assign.spec.ts`'s pattern a Technician
  sees their customer's property, adds a unit, has no "Belongs to", and another customer's property is
  absent from the route's JSON and the page.

## 11. Rollout, deploy order and rollback

0071 on the CI project (`ci-project-setup.yml`), then production, then parity, all **before merge** (the e2e
job fails while bis-ci lacks it). No backfill: no address exists today (no `contacts` column holds one). On
for every account; never shown to customers. Served-HTML marker: the card's title on a contact page.

**Migration before app:** two empty tables with their fences in the same file; safe. **App before
migration:** the route fails (assumed PGRST205) and the card shows its error state; data-safe, not usable.
But `ACCOUNT_OWNED_TABLES` names the tables and `deleteAccountCascade` throws on a missing one, so a teardown
or demo re-seed on a database without 0071 fails (the relationships spec's note): the order is not optional.
**Rollback:** revert the app and leave the tables. Dropping them (`drop table public.equipment; drop table
public.places;` and the four functions) destroys what people typed: only on an owner decision, after an export.

## 12. Effort and open risks

Effort: about 1.5–2 of S-02's 5–6 engineer-weeks (the siblings estimate 2–2.5 and 1.5–2), mostly §10.

- **Directions are free text the whole account reads, Technicians included.** A gate or alarm code typed
  there is what the study held back until roles (`:224`). The hint discourages it; F-004 closes it. Same
  shape as the relationships spec's "Other" label risk.
- **A delete racing an equipment insert.** Under READ COMMITTED, `places_delete_empty` cannot see a unit
  another session has not committed, so a removal in the same instant could cascade it. It needs two people
  on one property within milliseconds; accepted and recorded.
- **Deleting a customer deletes the properties only they own, with their equipment** (O3). Contact delete
  is Owner-only (0066:84) and rare, but a duplicate deleted before merge exists could hold the history.
- **The map link is Google's** (assumption, §5.1): pressing it sends the address to Google from the user's
  browser, and the URL form could change. One builder function, one test.
- `listContactPlaces` makes four small reads per load; fine at today's sizes (production held 53 contacts on
  2026-09-24, 0050:58). The caps (100 places, 500 units) are stated with real counts when reached.

## 13. Owner rulings (2026-10-11)

Each question was put to danlo with the recommendation first; every recommendation was taken (O1 to O9, §2).

1. **The word.** DECIDED: "Property" / "Propiedad" (O1, C1).
2. **May a Technician edit, remove and put back a property shared by a household or business?** DECIDED
   yes, with Undo (O2): it is where they stand, and removal keeps the history under Removed properties.
   They still cannot change who it belongs to (§5.3).
3. **Deleting a customer: cascade the properties only they own, or refuse?** DECIDED: cascade, with their
   equipment (O3), as memberships and relationships do. Refusing would leave the Owner stuck, since moving a
   property to another customer waits for S-12's merge, which must re-point places.
4. **Tenants.** DECIDED: not yet (O4). A landlord's rental belongs to the landlord; the tenant reaches it
   through Related people's "Landlord" chip (0070), and a Technician assigned only the tenant does not see
   it. A `place_contacts` link stays additive for later.
5. **CSV.** DECIDED: no properties in import or export this release (O5, §9).
6. **Search by address** ("I'm at 1204 Nolana"). DECIDED: deferred (O6), to the ⌘K follow-up after S-03.
7. **A unit taken out with nothing replacing it.** DECIDED: Remove for now (O7).
8. **"Open map" through Google Maps.** DECIDED: yes, labelled as an assumption (O8, §5.1).
9. **One card or two.** DECIDED: one "Properties" card with equipment nested under each property (O9, C7).
