# F-095 part 1 — palette v2: Spanish keywords and "go" (design spec)

> Scope: `docs/crm-features.md:1434` — "F-095 (part: palette v2 with Spanish
> keywords and 'go') | One box: find, go, or ask, in either language | 1.5 |
> Ships with the Spanish dashboard | S-10, F-092 (part 1), decision 35 (the
> one box)". This spec is that row only. No code in this change — the spec
> is the deliverable.

## 0. Summary for the owner

The ⌘K palette already has a live "find" half (F-092 part 1: accent-folded
contact/call/conversation search) and a static "go" half (nav + settings +
one action, derived from `buildNavGroups`). The static half's Spanish
support is **partial and asymmetric**: a Spanish-reading user typing the
English word for a thing usually finds it; an English-reading bilingual
user typing the Spanish word for a thing usually does **not**, because the
keyword lists that make that possible are missing entries for most
destinations, and the one mechanism that adds a cross-language word
(`registry.ts:118-121`) only fires in one direction. Separately, the
matching itself (`filterEntries`, `registry.ts:264-272`) is a plain
case-insensitive substring test with **no accent folding**, so "citas"
(unaccented, correct) finds nothing accented, and "configuracion" (typed
without the accent, as most phone keyboards default to) does not find
"Configuración" even where that keyword already exists.

This spec: (1) names the gap precisely, with file:line; (2) fixes the
matcher to fold accents both ways, reusing the fold the contact search
already ships; (3) fills in Spanish keywords for every nav/settings/action
entry, with a test that keeps that fill complete as entries are added;
(4) corrects one brief example against the shipped glossary (below); (5)
resolves what "go" means — it already exists, it is not a prefix to design.
No typed verb, no new UI surface, no new copy strings, no migration.

**One correction to the brief, source wins (working rule 1):** the brief's
own example — "'configuración'/'configuracion'→Settings" — is wrong against
this repo's shipped glossary. `nav.settings.es` is **"Ajustes"**
(`messages.ts:54`) and `nav.setup.es` is **"Configuración"**
(`messages.ts:64`); the Spanish-dashboard glossary's G6 gate bans
"configuración" as a stand-in for Settings outright
(`i18n/spanish-style.ts:63`: `{ id: "settings", en: /\bsettings\b/i, never:
/\bconfiguraci[oó]n\b/i, use: "ajustes" }`, pinned in
`i18n/spanish-style.test.ts:75`). "Configuración"/"configuracion" must find
**Setup** (`nav:setup`), not Settings. This spec's keyword tables below use
the corrected mapping; §7 "What the brief got wrong" explains it is not a
deviation I am choosing, it is what the source requires.

---

## 1. What exists today (file:line) and the gap

### 1.1 The static index: `apps/web/src/lib/palette/registry.ts`

- `PaletteEntry` (`:13-27`): `{ id, label, group, agencyOnly, keywords }` plus
  an `href` or `actionId`. `keywords: string[]` is free text, matched as
  substrings against the current locale's rendered `label` joined with
  `keywords` (`filterEntries`, `:264-272`).
- `SETTINGS_SECTIONS` (`:38-57`): 11 settings-card entries, each with a
  hand-written `keywords` array. Of the 11, 4 already carry at least one
  Spanish word (`required-documents` has "documentos"/"requeridos"; `ai` has
  "ia"/"presupuesto"; `trade` has "giro"). The other 7 — `client-access`,
  `sending-address`, `custom-fields`, `custom-values`, `alert-phone`,
  `billing`, `branding`, `weekly-report`, `website` — carry **English only**.
- `NAV_KEYWORDS` (`:61-94`): one array per href suffix. Several already carry
  Spanish ("documentos", "días cerrados", "feriado", "vacaciones",
  "calendario del teléfono", "suscribirse", "agenda", "trabajo", "agregar
  trabajo", "acceso", "registro", "visitas" — all added piecemeal by later
  features, not systematically). Several carry **none**: `/dashboard` (home),
  `/contacts`, `/pipeline`, `/conversations`, `/calls`, `/forms`, `/branding`,
  `/dashboard/accounts`, `/dashboard/blueprints`, `/dashboard/numbers`,
  `/dashboard/screened`, `/dashboard/plans`, `/billing`. **`/calendar`
  (`:78-81`) has no "citas"** — the brief's own worked example — despite
  having 20+ other keywords.
- `words()` (`:118-121`):
  ```
  const words = (key: MessageKey, keywords: string[]) =>
    locale === "en" ? keywords : [...keywords, m[key].toLowerCase()];
  ```
  This appends the **English** label as a keyword only when the reader's
  locale **is** `"es"` — so a Spanish-reading owner who half-remembers the
  English word ("contacts") still finds "Contactos". There is no symmetric
  branch: when locale **is** `"en"`, the Spanish label (`m[`${key}.es`]`) is
  never appended, so an English-UI bilingual operator typing "contactos"
  finds nothing unless "contactos" happens to be hand-authored into
  `NAV_KEYWORDS["/contacts"]` (`:63`, it is not — that array is
  `["people", "customers", "leads"]`).
- `nav:setup` (`:201-209`) and the toggle-theme action (`:243-251`) carry
  English-only keywords.
- `buildPaletteEntries(base, isAgency, isOwner, isTechnician, locale)`
  (`:112-254`) derives navigation entries from `buildNavGroups`
  (`apps/web/src/lib/nav-groups.ts`) so a nav destination cannot exist
  without a palette entry (`registry.test.ts:50`'s parity rule) — role
  filtering is therefore inherited for free; this spec does not touch it.

### 1.2 The matcher: `filterEntries` (`registry.ts:264-272`)

```
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const terms = q.split(/\s+/);
  return entries.filter((entry) => {
    const haystack = [entry.label, ...entry.keywords].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
```

Lower-cases only — no accent fold. `"configuracion".includes` against a
haystack containing `"configuración"` is `false` (the `ó`/`o` bytes differ).
Confirmed by reading `registry.test.ts:330` ("matches case-insensitively on
the label") — there is no sibling "matches accent-insensitively" test,
and `registry.test.ts:352` ("returns nothing for a query that matches
nothing") does not probe an accented/unaccented pair either. The repo
already ships the exact fold this needs, for a sibling surface:
`foldChar`/`nameFold` (`packages/db/src/dedupe-keys.ts:52,61`), consumed by
`apps/web/src/lib/contacts/search-highlight.ts:1` under the **subpath**
import `@bis/db/dedupe-keys` — the same discipline
`command-palette.tsx:17-19` already documents for `@bis/db/search-term`
("the SUBPATH, not `@bis/db`: that barrel pulls in `@supabase/supabase-js`,
and this is a client component").

### 1.3 "Go" already exists — it is not a prefix to design

The brief asks me to design "a typed 'go …'/'ir a …' verb or prefix if the
plan implies one." It does not. "Go to" / "Ir a" is **already shipped** as
the **navigation group's own heading**:

- `messages.ts:4544-4545`: `"palette.group.navigation": "Go to"` /
  `"palette.group.navigation.es": "Ir a"`.
- `command-palette.tsx:259`: `{ key: "navigation", heading: t(m,
  "palette.group.navigation", locale), items: entries.filter((e) => e.group
  === "navigation") }`.

So typing "settings" already surfaces a **"Go to" / "Ir a"** section
containing the Settings entries, visually distinct from "Actions" and from
the live "Contacts"/"Calls"/"Conversations" groups below. Reading
`docs/crm-features.md:2670-2691` (Surface 4) confirms the roadmap's "go" is
this group concept — navigation as one of three MODES (find live records,
go to a destination, ask a question later) — not a typed command syntax.
§8 Owner decision 3 below asks whether to ALSO add an optional typed prefix
as a convenience; my recommendation is no.

### 1.4 The gap, in plain words

Today, typing a Spanish word into ⌘K finds a destination only when someone
happened to add that exact word to its keyword list already, which is most
of the time nobody has. An English-reading bilingual staff member (the
majority of this app's operators, per the Spanish-dashboard design's own
numbers) gets no benefit from Spanish at all in the box they reach for
first. And even where a Spanish word IS present, typing it without its
accent — the common case on an English keyboard or a phone's autocorrect —
still fails, because nothing folds accents before comparing.

---

## 2. Scope: part 1 vs later

**In scope (this part, ~1.5 ew per the roadmap row):**
- Accent-insensitive, bidirectional matching in `filterEntries` for the
  static (nav/settings/action) half only.
- A complete, test-enforced Spanish keyword set for every nav destination,
  every settings section, and the one action (`toggle-theme`), reachable
  **regardless of the reader's own locale** (fixing the one-way `words()`
  asymmetry, §1.1).
- A small, deterministic ranking so a label match outranks a keyword-only
  match (§4.3) — needed because folding will make more entries match a
  short query than before, and a user who typed "ajustes" wants Settings
  first, not whichever entry happens to come first in registration order.
- The completeness test (§4.4).

**Explicitly later / not this part:**
- **Ask** (read-only Q&A, filter chips, "Guardar como vista") — F-095's
  second part, per `docs/crm-features.md:1557,2679-2691`. Nothing in this
  spec adds a query path to the database beyond what F-092 already ships.
- **Voice input** — dropped outright (`docs/crm-features.md:1784,2908`:
  "Speaking into the box (F-095 item 5) ... Drop").
- **Typo tolerance** (edit-distance / fuzzy matching) for the static index.
  Surface 4's "today" framing (`docs/crm-features.md:2686`: "Accent-folded
  and typo-tolerant") describes the FINISHED one-box, built across F-092
  (live search, which already has its own multi-tier plan,
  `contact-search.ts`) and F-095's two parts together — not a part-1
  requirement on its own. The brief's own worked design list asks only for
  "accent-insensitive matching both ways," not fuzzy matching, and 1.5 ew
  does not cover building and tuning an edit-distance matcher and its test
  suite for ~70 static entries. §8 Owner decision 1 flags this explicitly
  rather than silently narrowing it.
- **Nicknames** (Chuy → Jesús) — belongs to contact search (F-092/Ask), not
  destination keywords.
- **A "?" bilingual shortcuts sheet** — named in Surface 4's "States" line
  (`docs/crm-features.md:2688`) but absent from the brief's own design list
  and from the roadmap row's 1.5 ew. It is a new overlay with its own
  keyboard-map content in two languages; out of part 1, flagged in §8.
- **Re-architecting the live-search ranking or the three-group layout** —
  unchanged. Only the STATIC entries' internal order changes (§4.3).
- Settings/Setup/Voice/Automations PAGE content staying English
  (`docs/superpowers/specs/2026-10-31-spanish-dashboard-design.md:402-403`,
  Q4 DECIDED (a)) is unaffected: this spec only makes the **palette's own
  labels and keywords** for those destinations bilingual, which the shell
  (`palette`) is already in scope for under that same design's T1
  (`:353`: "Shell: ... `palette`; ⌘K registry and `labels.ts` become
  functions of the locale"). Clicking through still lands on an English
  page, same as today.

---

## 3. Role filtering

No change. `buildPaletteEntries`'s existing parameters (`isAgency`,
`isOwner`, `isTechnician`) already gate every entry this spec touches, and
entries are derived from `buildNavGroups` so a Technician's narrowed route
set (`nav-groups.ts`) is inherited automatically (`registry.test.ts:425`,
"registers every Technician nav destination"). Spanish keywords are added
to the SAME entries that already exist for each role — nothing new becomes
reachable by a role that could not reach it in English. The one role-shaped
risk: `SETTINGS_SECTIONS` entries are agency-only by construction
(`registry.ts:191`, `entries.push(... if (base && isAgency)`), so their new
Spanish keywords benefit only a bilingual STAFF member who has set their own
`users.language` to Español on Mis preferencias — which the Spanish-dashboard
design already anticipates (`2026-10-31-spanish-dashboard-design.md:401`:
"a staff member can now pick Español on Mis preferencias, so they would see
Spanish on client screens and English on these"). The destination PAGE still
renders in English per that design's Q4; only the palette's own row is
bilingual. This is consistent with today's shipped behavior for the 4
sections that already carry Spanish keywords (`ai`, `trade`,
`required-documents`) — not a new category of exposure.

---

## 4. Design

### 4.1 Accent-insensitive matching, both ways

Add a fold step to `filterEntries`, reusing the existing fold rather than
inventing a second one:

```
import { nameFold } from "@bis/db/dedupe-keys";

function foldWords(text: string): string {
  // nameFold already lower-cases and strips the 24 upper/lower accented
  // Spanish/Portuguese letters per dedupe-keys.ts:36 — reused here
  // unchanged, not reimplemented.
  return nameFold(text);
}

export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = foldWords(query.trim());
  if (!q) return entries;
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = entries
    .map((entry) => ({ entry, tier: matchTier(entry, terms) }))
    .filter((row) => row.tier !== null);
  scored.sort((a, b) => a.tier! - b.tier!); // stable: Array#sort preserves relative order within a tier
  return scored.map((row) => row.entry);
}
```

`nameFold` is exported already (`dedupe-keys.ts:52`) and is pure (no I/O, no
Supabase import in its own module — confirmed by its existing client-side
use from `search-highlight.ts:1`), so importing it from
`apps/web/src/lib/palette/registry.ts` carries no new runtime weight and no
new dependency edge beyond one this surface's own sibling already crossed.

**Display is never folded.** `entry.label` — what the user SEES and what
`t()` produced — is untouched; folding happens only inside the matcher's own
`haystack`/`terms` construction, exactly as `contactSearchPlan` does for the
live half and `search-highlight.ts` does for marking matched ranges. This
keeps `i18n/accents-guard.test.ts` (G7: "no screen file reaches an
accent-stripping helper") honest — that guard already sweeps every file
under `src/app` and `src/components` (`accents-guard.test.ts:28-38`,
`54-59`) for `stripDiacritics`/`consent/keywords`/`consent/phrases`; it does
not list `nameFold` as a banned import because `nameFold` is the CORRECT
tool for matching (the same reasoning `search-highlight.ts` already relies
on), so no edit to that guard is needed — but the task that lands this
MUST confirm `nameFold` stays absent from that banned list before merging,
since the guard's whole point is that a screen's DISPLAYED text is never
run through a stripper, and `command-palette.tsx`'s render path must keep
reading `entry.label` directly, never `foldWords(entry.label)`.

### 4.2 Spanish keywords: the corrected, complete tables

Every destination below gets at least one genuine Spanish word, using the
shipped glossary (`2026-10-31-spanish-dashboard-design.md:255-285`) so no
new entry collides with a banned word (G6, `i18n/spanish-style.ts:63` and
its 18 siblings). New keywords are ADDITIVE to each existing array — nothing
listed below is removed.

| Destination (href suffix / anchor) | New Spanish keywords | Why this word, not another |
|---|---|---|
| `/dashboard` | inicio, panel | "inicio" also means "sign-in" per the glossary's own exclusion note (`:314`, "'inicio' for dashboard (also 'inicio de sesión')") — kept anyway since it is still the right word for THIS destination and the exclusion is about banning it as a MUST-NOT for something else, not about banning its use here |
| `/contacts` | contactos, clientes, prospectos | "cliente" per glossary (customer), "cliente potencial" is wordy for a keyword so "prospectos" stands in even though glossary's formal term is "cliente potencial" — kept short on purpose, keywords are not shown, only matched |
| `/calendar` | **citas** (the brief's own example), horario, disponibilidad | "cita" is the glossary's word for appointment/booking (`:265`); "reserva"/"reservación" are banned for this meaning — not added |
| `/pipeline` | oportunidades, embudo | glossary (`:273`): "oportunidad"/"embudo"; "trato" is explicitly banned |
| `/conversations` | conversaciones, mensajes, bandeja | "conversaciones" is already the rendered label in Spanish; added as an explicit keyword too so an English-locale reader typing it still finds this entry (§4.1's symmetry fix alone would also cover this — both land the same outcome, kept as belt-and-braces matching this file's existing style, e.g. `registry.ts:65`'s redundant bilingual pairs) |
| `/calls` | llamadas, teléfono | glossary: "llamada atendida"/"llamada perdida"; "teléfono" already used as a NAV_KEYWORDS word elsewhere in the file's comments but not here |
| `/forms` | formularios | already the Spanish label |
| `/branding` | marca, logotipo, colores | "marca" is the rendered label; "logotipo" and "colores" are real synonyms an owner might type |
| `nav:setup` | **configuración, configuracion** (both, with and without the accent — the fold handles this too, but an explicit second keyword costs nothing and documents intent for the next reader of this file) | corrected mapping, §0 and §7 |
| `settings:client-access` | acceso, invitación, portal | |
| `settings:sending-address` | correo, dominio, remitente | glossary: email → correo |
| `settings:custom-fields` | campo, crm | |
| `settings:custom-values` | valor, variable | |
| `settings:alert-phone` | texto, alerta, aviso | |
| `settings:billing` | plan, suscripción, factura, pago | |
| `settings:branding` | logotipo, colores, marca | |
| `settings:weekly-report` | reporte, lunes, destinatarios | |
| `settings:website` | tráfico, análisis, dominio | |
| `action:toggle-theme` | oscuro, claro, apariencia, tema | |

The 4 destinations that already carry Spanish keywords
(`required-documents`, `ai`, `trade`, and the six `/calendar` entries added
across S-47c/d and F-046/F-048) are unchanged by this table — they are
already correct, per the existing mutation-named tests that pin them
(`registry.test.ts:179,188,197,216,226,131,142`).

### 4.3 Ranking: `matchTier`

```
type Tier = 0 | 1 | 2; // lower is better

function matchTier(entry: PaletteEntry, terms: string[]): Tier | null {
  const foldedLabel = foldWords(entry.label);
  const foldedKeywords = foldWords(entry.keywords.join(" "));
  const haystack = `${foldedLabel} ${foldedKeywords}`;
  if (!terms.every((term) => haystack.includes(term))) return null;
  if (terms.every((term) => foldedLabel.startsWith(term))) return 0; // single-term queries only reach this branch meaningfully; see note below
  if (terms.every((term) => foldedLabel.includes(term))) return 1;
  return 2; // matched only via a keyword
}
```

This is a deliberately small change: it does not re-score the LIVE groups
(contacts/calls/conversations keep their own server-decided order,
untouched — `command-palette.tsx:264-268`), and it does not change which
groups render or their fixed order (navigation → settings → actions,
`command-palette.tsx:258-262`) — only the order of entries WITHIN each of
those three static groups, since `command-palette.tsx`'s own
`group.items.length === 0 ? null : ...` logic (`:335`) iterates whatever
array it is given. "Go to Settings" (typed "ajustes") now ranks the
`nav.settings` entry itself (tier 0, label match) ahead of any settings-card
entry whose own keyword happens to contain "ajustes" as a substring,
without having to special-case that collision by hand.

### 4.4 How the index stays complete

A new test, modeled directly on the existing parity pattern
(`registry.test.ts:50`'s "registers EVERY nav destination" and its
mutation-named siblings), walking every entry `buildPaletteEntries` can
produce across all four roles (agency, client Owner, client Staff,
Technician) and asserting, for EACH entry, that its folded haystack (label
+ keywords, §4.1's fold) contains at least one folded, ≥4-letter word drawn
from the catalogue's OWN `.es` twin of that entry's `labelKey` — **run with
locale forced to `"en"`**, which is exactly the case the current asymmetric
`words()` (`registry.ts:120-121`) fails today. This proves the Spanish label
itself is always findable without relying on an explicit keyword, AND a
second, named-per-destination set of tests (one per row in §4.2's table,
each shaped like the existing "`mutation: drop X → FAILS`" style) proves
the curated ALIASES ("citas" for Calendar, which is not a substring of
either "Calendar" or "Calendario") are present too — folded-label coverage
alone cannot catch a missing alias, since an alias is by definition a word
NOT in the label.

```
function significantWords(label: string): string[] {
  return nameFold(label).split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
}

describe("every entry's own Spanish label is findable from an English session (mutation: revert words() to its one-way form → every multi-word label entry FAILS)", () => {
  it.each(ALL_ROLE_COMBINATIONS)("role=%o", (role) => {
    for (const entry of buildPaletteEntries(role.base, role.isAgency, role.isOwner, role.isTechnician, "en")) {
      const esLabel = t(m, entry.labelKey /* threaded alongside PaletteEntry for the test only, see note */, "es");
      const need = significantWords(esLabel);
      if (need.length === 0) continue; // a one-word label's own English render may already equal its Spanish one (e.g. "CRM")
      const haystack = nameFold([entry.label, ...entry.keywords].join(" "));
      expect(need.some((w) => haystack.includes(w)), `${entry.id} (${entry.label}) has no reachable Spanish word for "${esLabel}"`).toBe(true);
    }
  });
});
```

Note: `PaletteEntry` does not carry its own `labelKey` today (only the
rendered `label` string, `registry.ts:14`) — the test above needs it to
look up the Spanish twin independently of whichever locale built the entry.
**This is the one shape change this spec asks for**: add an optional
`labelKey?: MessageKey` field to `PaletteEntry`, set wherever `label:
label(key)` is already called (every `entries.push` site already has `key`
in scope, so this is a one-line addition per site, not a second source of
truth) — additive, so nothing that reads `PaletteEntry` today breaks.

### 4.5 Empty / no-match / loading states

No change to the EXISTING static-half UI states — there is no "loading"
state for the static half (it is synchronous, pure, in-memory); the
relevant states are:
- **No match at all** (`nothingAtAll`, `command-palette.tsx:271-272,402-406`):
  unchanged condition, but now TRUE less often, because folding and the
  completeness fill mean more real queries succeed. No copy change needed —
  `palette.empty` (`messages.ts:4558-4559`) already reads `No hay resultados
  para "{query}".` in Spanish and interpolates the RAW, unfolded query the
  user typed (never the folded form), so "configuracion" still echoes back
  exactly what was typed if it somehow still matches nothing.
- **Below the 2-character floor** (`command-palette.tsx:398-400`,
  `palette.hint`): unchanged; this gate is about the LIVE half's round trip
  cost, not the static half, which has no floor and already searches on one
  character.
- **The live half's loading/error states** (`:353-362,366-377`): untouched —
  this spec does not touch F-092's search route or its states.

### 4.6 Keyboard

No change. ⌘K / Ctrl+K toggling (`command-palette.tsx:187-204`), arrow-key
row navigation and Esc-to-close are all `cmdk`'s own behavior via
`CommandDialog`/`CommandList` (`ui/command.tsx`), untouched by a change
confined to `filterEntries` and the keyword tables. The one thing this spec
must NOT break: `shouldFilter={false}` (`:326`) stays — cmdk must keep
trusting `filterEntries`'s own order (§4.3) rather than re-filtering with
its own fuzzy matcher, which would silently undo the ranking this spec
adds.

### 4.7 Phone width

No change. The icon-only trigger below `sm` (`command-palette.tsx:283-293`,
F-107 r1) and the dialog itself are unaffected by a matching/keyword-only
change — the dialog's content area already wraps the same `CommandList`
regardless of viewport. Per the Spanish-dashboard design's own G9 note
(`2026-10-31-spanish-dashboard-design.md:317`), the shell (palette included)
has no `?locale=` override to drive an automated overflow check — "there is
no QA override to wire, and the shell's own G9 proof instead needs a real
Spanish e2e session" — so verifying the palette renders without clipping at
375×812 in Spanish is a MEASUREMENT task for bis-e2e-qa against a real
fixture-account session with `users.language = 'es'`, not a unit test this
spec's task list can satisfy alone (named in §6's test plan).

---

## 5. Copy: EN + usted ES for every new string

**None.** This part adds no new user-visible strings. Every string a reader
sees — group headings ("Go to"/"Ir a", "Settings"/"Ajustes",
"Actions"/"Acciones"), the placeholder, the empty/error/hint copy — already
exists in `messages.ts` (`:4535-4565`) and is already *usted*-register
Spanish (confirmed against the Q2 DECIDED ruling,
`2026-10-31-spanish-dashboard-design.md:388-389`: *usted* everywhere on the
owner's own screens, `palette.*` is part of T1's `shell` namespace which
that ruling covers). What this part adds is **matching data** (keyword
arrays, a `labelKey` field) and a **matching/ranking function** — no new
`m[...]` keys, so G1/G2/G3/G4/G5/G6 (the Spanish-dashboard build gates,
`2026-10-31-spanish-dashboard-design.md:307-317`) have nothing new to check
beyond G6's glossary rules, which §4.2's table already obeys by
construction (every new keyword is drawn from the glossary's own "use"
column or is the already-shipped label word).

---

## 6. Tier, risks, test plan, task list

### 6.1 Tier

**LOW**, per this repo's speed process (no plan doc beyond this spec, one
end-of-PR review): the change touches no auth, no sign-in, no email, and no
schema. All four files below are inside `bis-frontend`'s own ownership
(`apps/web/src/lib/palette/**`, `apps/web/src/components/command-palette*`).

### 6.2 No migration

**None expected.** Nothing here reads or writes Supabase; `buildPaletteEntries`
and `filterEntries` are pure, in-process functions over data already in the
client bundle (nav structure, settings anchors, the message catalogue). The
one reused import, `@bis/db/dedupe-keys`'s `nameFold`, is an existing pure
TypeScript function with no database dependency (confirmed: it is already
imported by a CLIENT component, `search-highlight.ts:1`, which could not
import it if it touched Supabase).

### 6.3 Risks

1. **The `words()` symmetry fix changes what matches, for every existing
   query, in both locales** (not additive-only): today, locale `"en"` never
   gets the Spanish-label bonus word; after the fix it always does. A query
   that today returns exactly one entry could return two if an unrelated
   entry's Spanish label happens to share a ≥4-letter word. Mitigation: the
   completeness test (§4.4) runs over EVERY existing entry combination before
   merge, and any existing test asserting an exact result SET (not just "this
   one entry is present") must be re-run and, if newly ambiguous, tightened
   with a second term rather than loosened — `filterEntries`'s own
   multi-term AND semantics (`registry.ts:267`, unchanged) is the intended
   way to disambiguate, same as today.
2. **Ranking (§4.3) reorders existing test expectations that read `entries[0]`
   or similar positional assertions.** Grep `registry.test.ts` for
   `entries[0]`/`.at(0)` before landing; none were seen in the headings read
   for this spec (`registry.test.ts:1-473`'s test NAMES, not full bodies —
   the implementing task must re-grep the BODIES, this spec read only the
   `describe`/`it` lines) but the risk is real enough to name rather than
   assume away.
3. **A keyword collision with the glossary's "Never" column** — mitigated by
   §4.2's table being built FROM the glossary, but the task must re-check
   `glossaryViolations`-style reasoning by hand for anything added beyond
   this table, since `glossaryViolations` itself (`spanish-style.ts:92`)
   does not scan `registry.ts` (confirmed: it takes a `Catalogue` —
   `messages.ts`'s shape — as its only input, `spanish-style.ts:92`'s
   signature), so a bad keyword here is NOT caught by the existing CI gate.
4. **`PaletteEntry.labelKey` (§4.4) becomes a second source of truth with
   `label`** if a future call site sets one without the other. Mitigated by
   making it required-in-practice via the SAME `entries.push` call sites
   that already compute `label(key)` — one review pass over `registry.ts`'s
   dozen `entries.push` calls at review time catches a missed site; a
   stronger guard (TypeScript requiring `labelKey` alongside `kind`) is
   available if the implementing task prefers it over "additive and
   optional."

### 6.4 Test plan (named mutations, per working rule 2)

All in `apps/web/src/lib/palette/registry.test.ts` unless noted; run via
`pnpm --filter web exec vitest run src/lib/palette`.

1. **Accent fold, both directions** — "finds Calendar typing 'citas' with no
   accent (mutation: revert `filterEntries` to plain `.toLowerCase()` →
   FAILS, because 'citas' has no accent to begin with, so this test alone
   cannot distinguish the fold; the REAL fold test is next)."
2. **Accent fold proves itself** — "finds Setup typing 'configuracion'
   (no accent) when the keyword is stored as 'configuración' (mutation:
   replace `nameFold` with `.toLowerCase()` in `filterEntries` → FAILS,
   because 'configuracion'.includes('configuración') is false without the
   fold)." This is the mutation that can actually fail, per working rule 2's
   own warning about a mutation that cannot (`.trim()` example) — unlike
   test 1, this one depends on the accent genuinely being present in the
   stored keyword.
3. **Reverse accent fold** — "finds Setup typing 'configuración' (WITH the
   accent) when some keyword or the stored word omits it — proves the fold
   runs on BOTH the query and the haystack, not just one (mutation: fold
   only the query, not the haystack → FAILS if any stored keyword is
   unaccented ASCII, which 'configuracion' — the second, redundant keyword
   in §4.2's table — deliberately is, so this mutation has something to
   catch)."
4. **The brief's corrected mapping** — "'configuración' and 'configuracion'
   find Setup and do NOT find Settings (mutation: attach the keyword to
   `nav:settings` instead of `nav:setup` → the 'does NOT find Settings' half
   FAILS)" — directly encodes §0/§7's correction so it cannot regress back
   to the brief's wrong example.
5. **Symmetry fix** — "an English-locale session still finds every
   destination by its OWN Spanish label's significant words (mutation:
   revert `words()` to `locale === "en" ? keywords : [...]` → every entry
   whose English and Spanish labels differ by a whole word FAILS, named per
   entry in the assertion message)" — the §4.4 completeness test itself,
   run for all four roles.
6. **Per-destination aliases**, one test per §4.2 table row that adds a
   real alias (not just the label's own translation), each shaped
   "(mutation: drop the keyword → FAILS)" exactly like the existing
   `registry.test.ts:87,94,105,110,115,120,131,142` style. At minimum:
   citas→Calendar, oportunidades/embudo→Pipeline, correo→sending-address,
   oscuro/claro→toggle-theme.
7. **Ranking** — "typing 'ajustes' ranks the Settings nav entry ahead of a
   settings-card entry whose keyword merely contains 'ajustes' as a
   substring (mutation: remove the tier sort, return filter order only →
   the settings-card entry FAILS to come second when it was first by
   registration order)."
8. **No regression to existing exact-result-set tests** — re-run
   `registry.test.ts` and `command-palette.test.ts` in full
   (`pnpm --filter web exec vitest run src/lib/palette src/components/command-palette.test.ts`)
   and fix any test whose result SET (not just presence) changed per risk
   6.3.1, per test, by name.
9. **Display never folded** — "PaletteHitContent's and CommandItem's
   rendered text is never passed through `nameFold`/`foldWords` (mutation:
   render `foldWords(entry.label)` instead of `entry.label` in
   `command-palette.tsx` → a snapshot/string-contains assertion on an
   accented label FAILS)," in `command-palette.test.ts`.
10. **G7 still holds** — re-run
    `pnpm --filter web exec vitest run src/lib/i18n/accents-guard.test.ts`
    unchanged (no new entry needed in its banned-import list, since
    `nameFold` is the sanctioned matcher, not a stripper) and confirm the
    exit code with `> /tmp/.../g7.log; echo $? >> ...` per working rule 4
    (capture to a file, nothing trailing in the same block).

### 6.5 PR-sized task list

One PR, LOW tier (§6.1), suggested split into two commits if the diff runs
long:

1. **`packages/db/src/dedupe-keys.ts`** — no change; read-only dependency,
   confirm `nameFold` is exported from the `@bis/db/dedupe-keys` subpath
   (it already is, `:52`) before the next step imports it.
2. **`apps/web/src/lib/palette/registry.ts`** —
   - add `labelKey?: MessageKey` to `PaletteEntry` (§4.4) and set it at
     every `entries.push` call site;
   - fix `words()` to always append the OTHER language's label, dropping
     the `locale === "en"` branch;
   - fill in §4.2's keyword tables into `NAV_KEYWORDS` and
     `SETTINGS_SECTIONS`, plus the `nav:setup` and `action:toggle-theme`
     entries;
   - rewrite `filterEntries` to fold via `nameFold` and rank via
     `matchTier` (§4.1, §4.3), both as named, exported, pure functions so
     they are independently testable.
3. **`apps/web/src/lib/palette/registry.test.ts`** — the test plan in §6.4,
   items 1–8.
4. **`apps/web/src/components/command-palette.test.ts`** — §6.4 item 9.
5. **No change expected** to `command-palette.tsx` itself (it already
   trusts `filterEntries`'s order via `shouldFilter={false}`) — if the
   implementing task finds it DOES need a change, that is a deviation from
   this spec to call out in that PR's own report, not a silent addition.
6. **Ask bis-e2e-qa** (not this task) for §4.7's phone-width Spanish
   measurement on a real fixture session, per
   `2026-10-31-spanish-dashboard-design.md:317`'s own precedent for the
   shell.

---

## 7. What the brief got wrong (source wins, working rule 1)

Only one item, already stated in §0 and threaded through §4.2/§6.4: the
brief's worked example **"'configuración'/'configuracion'→Settings"**
contradicts two independent, already-shipped sources — `messages.ts:53-54,
63-64` (Settings is "Ajustes", Setup is "Configuración") and the glossary's
own banned-word gate (`i18n/spanish-style.ts:63`, pinned in
`spanish-style.test.ts:75,92`). I designed §4.2's table and §6.4's test 4
around the CORRECTED mapping (configuración → Setup) rather than the
brief's. Nothing else in the brief conflicted with a source I could find.

---

## 8. Owner decisions

**1. Typo tolerance for the static (nav/settings) index: build it now, defer
it, or explicitly never?**
- **(a) Defer — recommended.** Ship accent-folding and the complete keyword
  fill now (this spec); revisit fuzzy/edit-distance matching for the static
  half only if a measured need shows up (e.g., a support ticket about
  "sttings" finding nothing) once the keyword fill is live. Cheapest, and
  the roadmap's own 1.5 ew for this row does not price fuzzy matching.
- (b) Build a small edit-distance fallback (e.g., Damerau-Levenshtein
  distance 1) now, scoped to label-only matches. Closer to Surface 4's full
  "typo-tolerant" framing in one pass, but adds real tuning risk (false
  positives on short labels like "Voz"/"Voice") and is not what the brief's
  own design checklist asked for.
- (c) Never, on the static half — keyword coverage is the typo fix (a
  common misspelling becomes its own keyword, same pattern as
  `registry.ts:69-72`'s own "activity"/"what went out" precedent). Cheapest
  long-run but asks future contributors to anticipate typos by hand.

**2. `PaletteEntry.labelKey`: additive-optional field, or a stronger
type-level requirement?**
- **(a) Additive-optional (`labelKey?: MessageKey`) — recommended.** Keeps
  every existing `entries.push` call site compiling unchanged; one review
  pass (§6.3.4) catches a missed site before merge. Matches this file's own
  existing style of additive fields.
- (b) Make it required wherever `kind: "href"`, enforced by a discriminated
  union variant. Stronger guarantee against a future silent miss, at the
  cost of touching every existing call site's type signature in the same PR
  — a wider diff for a LOW-tier task.

**3. An optional typed prefix ("go ", "ir a ") that narrows results to
navigation entries only — add it, or leave "Go to"/"Ir a" as a passive
group heading?**
- **(a) Leave it as a passive heading — recommended.** It already exists
  (§1.3) and already visually separates navigation from settings/actions/live
  results; a query already narrows to the right group without typing a
  prefix (typing "settings" already surfaces mostly Settings entries). A
  typed prefix adds a small parsing surface (strip the prefix before
  matching, decide what happens if someone types "ir a citas" meaning
  "go to Calendar" vs. a literal search for the words "ir a citas") for a
  convenience that duplicates what grouping already shows.
- (b) Add it as a convenience filter: typing "go " or "ir a " (and nothing
  before it) restricts the static result list to the "navigation" group
  only, stripping the prefix before matching. Useful mainly as a power-user
  shortcut once the index is large; adds a small, testable prefix-strip
  step to `filterEntries`.

---

## 9. Where the brief, the plan, or an earlier spec disagreed with the source

Covered fully in §0 and §7 (the Settings/Setup Spanish-word mapping). No
other disagreement found between the brief, `docs/crm-features.md`,
DESIGN.md, and the shipped code read for this spec.

## 10. Findings outside this spec's scope (for the ledger)

- `docs/crm-features.md:2860` (decision 35 row 9, "The palette becomes the
  one box") is still **"Proposed — needs the owner's dated decision"** as of
  this reading. This spec does not need that amendment decided — it only
  completes the "go" half of the box DESIGN.md already describes
  ("Command palette (⌘K): finds contacts/calls/conversations, jumps to any
  settings section by name, runs actions") — but F-095's SECOND part
  ("Ask") does need row 9 ruled before it can add filter chips and
  "Guardar como vista" as a new palette behavior, since that is new ground
  DESIGN.md's current wording does not cover.
- `registry.ts:191-241`'s `SETTINGS_SECTIONS` entries render Spanish LABELS
  for an agency staff member who chose Español, even though
  `2026-10-31-spanish-dashboard-design.md`'s Q4 keeps the destination PAGE
  itself English. This is pre-existing (not introduced by this spec) and
  consistent with that design's own T1 scope note
  (`palette`/`labels.ts` become functions of the locale) — flagged here only
  because §4.2 extends it to seven MORE sections, widening a pattern that
  was never itself put to the owner as its own decision.
