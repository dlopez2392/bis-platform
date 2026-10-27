# S-53 — Tenant vetting (the F-173 vetting slice)

Date: 2026-10-27 · Status: owner-approved design (brainstorm 2026-10-27), spec awaiting owner review
Plan sources: `docs/crm-features.md` §3.1 binding constraints 1–2, §5.14 (the holds), S-53 / F-173 rows.

## 1. Purpose

Every company BIS takes on has a recorded trade, and the trade decides whether BIS may serve it and how
far. Today the agency's Add company form records no trade, so the plan's holds (adult day care and home
health turned away; HIPAA verticals and tax preparers held; restaurants and child care CRM-only) live
only in prose. This slice makes them real.

## 2. Owner decisions (2026-10-27)

| # | Question | Decision |
|---|---|---|
| V1 | How firm is vetting? | **Enforced.** Add company requires a trade; turned-away and held trades cannot be created; CRM-only trades are created but Sofía and the web chat cannot be switched on. |
| V2 | A business that fits no listed trade | **Other, with a required one-line description**, kept on the company. |
| V3 | In-app override of a held or turned-away trade | **None.** A verdict changes only by a dated decision plus a code change and migration. |
| V4 | Architecture | **A:** a `trade` on each company; verdicts in one code module; the database accepts only creatable trades. |

## 3. The trade list and verdicts

One module, `apps/web/src/lib/vetting/trades.ts`, is the single source. Each entry: `key`, `group`,
`label: { en, es }`, `verdict`, and for held/turned-away entries a `reason: { en, es }`.

Verdicts:
- `allowed` — created; every product available (subject to plan/billing as today).
- `crm_only` — created; Sofía (voice) and the web chat cannot be switched on.
- `held` — not created; reason states what must happen first.
- `turned_away` — not created; a polite sentence the agency can pass on.

| Group | Key | English | Spanish | Verdict |
|---|---|---|---|---|
| Home services | `hvac` | Heating and air conditioning | Aire acondicionado y calefacción | allowed |
| Home services | `plumbing` | Plumbing | Plomería | allowed |
| Home services | `electrical` | Electrical | Electricidad | allowed |
| Home services | `roofing` | Roofing | Techos | allowed |
| Home services | `landscaping` | Landscaping and lawn care | Jardinería y paisajismo | allowed |
| Home services | `pool` | Pools and spas | Albercas y spas | allowed |
| Home services | `pest_control` | Pest control | Control de plagas | allowed |
| Home services | `cleaning` | Cleaning | Limpieza | allowed |
| Home services | `painting` | Painting | Pintura | allowed |
| Home services | `remodeling` | Construction and remodeling | Construcción y remodelación | allowed |
| Home services | `woodworking` | Woodworking and cabinets | Carpintería y muebles | allowed |
| Home services | `handyman` | Handyman and repairs | Reparaciones generales | allowed |
| Auto | `auto` | Auto repair and detailing | Taller mecánico y detallado | allowed |
| Personal care | `beauty` | Salons, barbers and spas | Salones, barberías y spas | allowed |
| Personal care | `fitness` | Gyms and trainers | Gimnasios y entrenadores | allowed |
| Professional | `insurance` | Insurance | Seguros | allowed |
| Professional | `real_estate` | Real estate | Bienes raíces | allowed |
| Professional | `events` | Events and venues | Eventos y salones de fiestas | allowed |
| Professional | `law` | Law firm | Despacho de abogados | held — "Law firms open once our Texas cloud-storage sheet for lawyers (Opinions 680 and 705) is ready." |
| Professional | `tax` | Tax preparation | Preparación de impuestos | held — "Tax preparers aren't open yet; planned for the 2028 tax season." |
| Food and care | `restaurant` | Restaurant | Restaurante | crm_only |
| Food and care | `child_care` | Child care | Guardería | crm_only |
| Health | `medical` | Medical clinic | Clínica médica | held — "Health-care businesses aren't open yet: they need protections for patient information that BIS doesn't have today." |
| Health | `dental` | Dental | Dental | held (same reason) |
| Health | `therapy` | Therapy and mental health | Terapia y salud mental | held (same reason) |
| Health | `chiropractic` | Chiropractic and physical therapy | Quiropráctica y fisioterapia | held (same reason) |
| Health | `other_health` | Other health care | Otros servicios de salud | held (same reason) |
| Care at home | `adult_day_care` | Adult day care | Guardería para adultos | turned_away — "BIS doesn't serve adult day care or home health, so we can't take this business on." |
| Care at home | `home_health` | Home health | Salud en el hogar | turned_away (same sentence) |
| — | `other` | Other (describe it) | Otro (descríbalo) | allowed, with the required description |

The Spanish reasons are written at implementation in the same register as the app (usted), reviewed in
the final review. `law` is held because the plan admits law firms "once the 680/705 sheet exists"; the
owner flips it to `allowed` (CRM) when that sheet is done (V3: a code change and migration).

**Creatable trades** = every `allowed` and `crm_only` key, including `other`.

## 4. Data — migration 0101 (`0101_account_trade.sql`)

- `accounts.trade text` — nullable (existing companies have none until set).
- `accounts.trade_other text` — the description for `other`.
- `check (trade is null or trade in (<creatable keys>))` — held and turned-away keys are rejected by the
  database itself.
- `check (trade is distinct from 'other' or length(btrim(trade_other)) between 1 and 120)` — Other needs
  a description;
- `check (trade_other is null or trade = 'other')` — a description exists only for Other.
- Writes stay server-only: the agency's actions write through the service client; a client session's
  grants on `accounts` must not gain `trade` / `trade_other` (pin in the grants suite; digest unchanged
  if accounts' client UPDATE is already column-limited, otherwise state the exact grant).
- Apply order as usual: bis-ci (dry run, push), production (MCP, once), parity, then merge. Additive and
  safe under the running build.

A unit test reads the migration's check list and asserts it equals the module's creatable keys, so the
code list and the database cannot drift.

## 5. Behaviour

### 5.1 Add company (agency only, `accounts/actions.ts` `createClientAccount`)
- Required **Trade** select, grouped as in §3, beside name, brand name and time zone. Choosing **Other**
  reveals a required "What does the business do?" field (≤120 characters).
- Server action validates: missing trade → refused; `held` / `turned_away` → refused with the entry's
  reason, nothing created (no Clerk org, no row); `other` without a description → refused.
- `crm_only` → created; the success state notes "Sofía and the web chat aren't available for this trade yet."
- The refusal is a form message, not a toast; the agency reads it and passes it on.

### 5.2 The company's trade on Settings (agency only)
- A **Trade** field in the agency's company settings with the same picker and Other description, saved by
  a new server action with the same validation.
- Changing to a `crm_only` trade while Sofía is answering or the web chat is on is refused:
  "Turn off Sofía and the web chat first."
- Clients never see the trade or any vetting text.

### 5.3 Switching Sofía or the web chat on
Enforced in the server actions that turn them on (the voice number assignment/activation that makes Sofía
answer, and `enableConciergeAction`), not only in the UI:
- `crm_only` trade → refused with "Sofía and the web chat aren't available for <trade> yet."
- no trade set → refused with "Set this company's trade first." (links to Settings).
- Anything already on stays on; turning off is never blocked.
- The UI disables the switch with the reason beside it.

### 5.4 Existing companies
Production has three: Bespoke Intelligent Solutions → `other` ("Marketing and AI receptionist agency"),
956 Woodworks → `woodworking`, Resaca Air Conditioning & Heating → `hvac`. Set through the app after
deploy with the owner's OK (not hard-coded in the migration; bis-ci has different accounts).

## 6. Out of scope
Licence checks (F-131); picking a pack or blueprint from the trade (F-173 later); showing the trade to
clients; self-serve sign-up vetting (F-139); regulated-tenant mode (S-39).

## 7. Testing
- Module: every key has en/es labels; every held/turned_away entry has en/es reasons; creatable list
  correct; Other requires a description.
- DB (local replica + CI): held/turned-away keys rejected; `other` without description rejected;
  description without `other` rejected; null allowed; client role cannot write the columns.
- Actions: each guard (create refuses held/turned_away/missing; set-trade refuses crm_only while on;
  Sofía/web-chat switch-on refuses crm_only and null) fails its test when removed (mutation probes).
- e2e (per-run fixture account only): Add company refuses a held trade with its reason; a CRM-only
  company's Sofía and web-chat switches are disabled with the reason.
- Bilingual DoD for the new agency UI (en/es, pseudo +35%, `lang`).

## 8. Tiers
HIGH: migration 0101 and the server-side enforcement (create, set trade, Sofía/web-chat switch-on).
LOW: the picker UI, copy, styleguide entry if a new variant appears, e2e.
