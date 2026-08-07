# BIS Platform — M1d Blueprints v0 & Activation Checklist

**Date:** 2026-07-31
**Status:** Approved design, pending implementation plan
**Scope:** Capture an account's configuration as a reusable blueprint, apply it idempotently to a new account, and track the setup steps that cannot be cloned.

---

## 1. Why

M0 through M1c built a CRM a client can use. Nothing built so far makes it fast to *start* a client. Today every new account is configured by hand — pipeline stages, custom fields, tags, a lead form — from memory, and the steps that live outside the platform (a phone number, A2P registration, DKIM records) are tracked nowhere at all.

M1d closes the roadmap's M1 "CRM spine" with the two pieces that turn a signed contract into a live client: **blueprints** for everything that can be cloned, and an **activation checklist** for everything that cannot. Missed-call text-back, the last M1 line item, stays blocked on A2P 10DLC carrier registration and is not in scope.

**Both halves ship together.** They are independent subsystems joined by one flow — create account → apply blueprint → work the checklist — and that flow is the deliverable. Shipping either alone leaves the onboarding story half-told.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Authoring | **Capture from an existing account** | You configure one account the way you want it and press "Save as blueprint". Blueprints get authored by doing normal work rather than by editing JSON, which is the only version of this that survives contact with a ~15-minute onboarding target. Rejected: hand-authored JSON in the repo — every change becomes a developer task. Rejected for now: an editable JSON view — real power, but it is also a way to save a malformed blueprint that then fails on apply. |
| Apply safety | **Idempotent apply now, three-way merge deferred** | Applying twice must create nothing twice; that kills GHL's duplicate-on-reload flaw, which is reachable today by double-clicking. Re-pushing an updated blueprint to an already-live client is **not** built: it needs per-field modification tracking, and with one client there is nothing to push to. `origin` and `blueprint_key` columns ship now so the merge needs no migration later. |
| Checklist items | **Fixed catalogue in code + free-text additions** | The non-cloneables are the same for every client. Defining them in code lets each carry real help text and links, and means a new item appears for every account with no backfill. A free-text item covers anything client-specific. Rejected: per-blueprint checklists — configuration for a variation that does not exist yet. |
| Cloned form identity | **Fresh `public_id`, blanked `notify_emails`** | See §4. This is the one exclusion that fails silently if it is got wrong. |
| Applied form status | **`draft`, never `published`** | Auto-publishing would put a live, publicly reachable URL into the world because someone picked a blueprint from a dropdown. Publishing stays a deliberate act. |
| Apply failure model | **Per-asset report, not all-or-nothing** | PostgREST offers no cross-table transaction. Apply returns created / skipped / failed per asset and continues past a failure. This is only safe *because* apply is idempotent — the remedy for a partial apply is to apply again. A truthful report beats atomicity we cannot actually provide. |

### Non-goals

- Three-way merge / re-pushing a blueprint to a live client.
- Blueprint export or import as a file, and any cross-agency sharing.
- A raw JSON editor for a stored bundle.
- Per-blueprint checklists.
- Automating any external step. The checklist is a tracker; §6 says so in the copy.
- Version history. Recapture bumps a version number; superseded bundles are not retained.

---

## 3. Data model

Migration `0007` adds two tables and provenance columns, following the house pattern: RLS via the `app.*` helpers, events emitted on mutation.

**One RLS departure worth stating, because copying the existing pattern here would be wrong.** Every table so far is account-scoped and its policy reads `app.is_agency() or account_id = app.current_account_id()`. `blueprints` has no `account_id` — it belongs to the agency — so its policy is `app.is_agency()` alone. `checklist_items` is account-scoped and uses the standard policy unchanged.

**`blueprints`** — agency-level, not account-level. A blueprint belongs to the agency and is applied *to* accounts.

- `id`, `agency_id`
- `name`, `version` int — recapture replaces `assets` and bumps `version`
- `source_account_id` — informational; which account it was captured from
- `assets` jsonb — the bundle (§4)
- `created_at`, `updated_at`
- unique `(agency_id, name)`

**`checklist_items`** — **state only. The catalogue itself lives in code.**

- `id`, `account_id`
- `item_key` text — a catalogue key (`phone_number`) or `custom:<uuid>`
- `title` text — null for catalogue items, whose title comes from code; set for custom items
- `done_at`, `done_by`, `note`, `position`
- unique `(account_id, item_key)`

A catalogue item has **no row** until someone ticks it or writes a note; reading merges the code catalogue with whatever rows exist. Two consequences worth stating: a new catalogue item appears for every existing account with no backfill, and a custom item's title survives because it is stored rather than derived.

**Provenance columns** on the five cloneable tables — `pipelines`, `pipeline_stages`, `custom_fields`, `tags`, `forms`:

- `blueprint_key` text — the stable key from the bundle
- `origin` text default `'user'`, check `('user','blueprint')`
- partial unique index on `(account_id, blueprint_key) where blueprint_key is not null`

**That partial unique index is the idempotency mechanism.** Apply upserts against it. `origin` is written but read by nothing in v0; it exists so the deferred merge does not need a migration.

---

## 4. What a blueprint contains

`assets` is a jsonb bundle:

`schemaVersion` describes the **shape of the bundle** and is bumped only when this format changes. It is deliberately distinct from `blueprints.version`, which counts recaptures of a particular blueprint's contents — conflating the two would make "version 3" ambiguous between "captured three times" and "third bundle format".

```
{
  "schemaVersion": 1,
  "pipelines":    [{ key, name, stages: [{ key, name, position }] }],
  "customFields": [{ key, model, fieldKey, name, dataType, options, position }],
  "tags":         [{ key, name }],
  "customValues": [{ key, valueKey, name }],
  "forms":        [{ key, name, fields, theme, successMode, successMessage,
                     redirectUrl, localeDefault }]
}
```

### Deliberately excluded

| Excluded | Why |
|---|---|
| contacts, opportunities, conversations, messages, notes, tasks, form_submissions, events | Live data, not configuration. The platform spec's line and GHL's. |
| `forms.public_id` | **Regenerated on every apply.** Cloning it collides on the global unique index — and if it somehow did not, one client's form URL would serve another client's form. |
| `forms.notify_emails` | **Blanked.** Cloning it quietly routes a new client's leads to the previous client's inbox. There is no error, no warning, and no way to notice from inside the app until someone complains about missing leads. A checklist item covers setting it. |
| `forms.successMode` / `forms.successMessage` / `forms.redirectUrl` | **Captured, but forced to a safe default on apply** (`success_mode='message'`, `success_message=null`, `redirect_url=null`) — this deviates from the bundle shape shown above, which still includes all three, deliberately, to avoid a `BUNDLE_SCHEMA_VERSION` bump for a smaller change. Cloning either verbatim fails exactly as silently as `notify_emails`: a redirect sends every lead on the applied form to the SOURCE tenant's website, and a success message can name the SOURCE tenant by name. Owner-approved deviation from this spec, decided during the M1d fix wave. |
| `custom_values.value` | Keys and names clone; **values are blanked**. `{{business_name}}` exists precisely so applied config re-points itself per tenant; carrying the previous tenant's value defeats the primitive. |
| API keys, tokens, phone numbers, domains | Credentials and non-cloneables. |

---

## 5. Capture and apply

**Capture** reads the source account's configuration, derives a stable `blueprint_key` per asset from its name or key, strips the excluded fields above, and writes the bundle. Recapturing an existing name replaces `assets` and bumps `version`.

**Apply** runs in dependency order, because a form's fields reference custom fields by `custom.<field_key>`:

1. `custom_fields`
2. `tags`
3. `custom_values` — values blank
4. `pipelines` + `pipeline_stages`
5. `forms` — fresh `public_id`, empty `notify_emails`, `status='draft'`

Every write is an upsert keyed on `(account_id, blueprint_key)`, with `origin='blueprint'`. On completion, emit `blueprint.applied` carrying the blueprint id and version.

Apply returns a per-asset report: **created**, **skipped** (already present from an earlier apply), or **failed** with the error. A failure does not abort the remaining assets.

---

## 6. Surfaces

- **`/dashboard/blueprints`** (agency level) — each blueprint's name, version, capture date, and how many accounts it has been applied to.
- **"Save as blueprint"** on an account's Settings screen. This is the authoring path.
- **Create-account dialog** gains an optional *Apply blueprint* select, and on success redirects to the new account's checklist — the onboarding path end to end.
- **The activation checklist renders as a panel on the account Dashboard**, with a deep-linkable route. Deliberately **not** an eighth sidebar item: it is something you finish once, not a place you work. The sidebar stays at seven.

**Catalogue** (in code, each with help text and a link where one exists):

| Key | Item | Note |
|---|---|---|
| `phone_number` | Buy a phone number | External; needs M2 |
| `a2p_registration` | Register A2P 10DLC brand + campaign | External; days-to-weeks carrier queue |
| `email_domain` | Add a sending subdomain + DKIM in Resend | External |
| `form_notify` | Set the notification address on each form | Blueprint-applied forms always start empty |
| `gbp_connect` | Connect Google Business Profile | External; needs M5 |
| `invite_owner` | Invite the business owner | |

**The copy must say these are things you do elsewhere.** Items marked `external` are setup the platform cannot perform, and implying otherwise would be a lie the UI tells daily.

Two items are *not* external. `form_notify` gets one live touch: the panel shows a real count of forms with an empty notify address. And **as of M2, `invite_owner` is no longer external** — inviting the business owner is done in that company's Settings under Client access, not in the Clerk dashboard, so it kept a "Done outside BIS" badge that had become false.

---

## 7. Testing

- **`@bis/db`**, against the real database via the existing `withTestAccount` harness: capture → apply → **apply again** produces no duplicates; excluded fields are genuinely absent (no contacts cloned, `public_id` differs from source, `notify_emails` and custom values blank); applied forms are `draft`; dependency order holds so a form referencing a custom field resolves; `blueprint.applied` carries the version; cross-tenant isolation on `blueprints` with forged claims.
- **`apps/web` unit:** the checklist merge — catalogue plus stored rows, including a catalogue item with no row, a custom item, and a stored row whose catalogue key no longer exists.
- **Playwright:** create an account with a blueprint selected → the cloned config appears on the account → the checklist renders → ticking an item persists across a reload.
- All five gates green before every commit: typecheck, lint, unit, build, e2e. Run each separately — piping through `grep` swallows the exit code.

---

## 8. Risks

**A partial apply leaving an account half-configured.** Mitigated by idempotency: pressing apply again is safe and is the documented remedy. The report makes the partial state visible rather than silent.

**Cloning something tenant-specific.** The `notify_emails` case is the dangerous one because it fails silently and routes real leads to the wrong business. §4 is the enumerated exclusion list and §7 asserts each one.

**Blueprint capture drifting from the schema.** Every future asset type — calendars in M2, automations in M3 — must be added to both capture and apply or it silently will not clone. The bundle carries a `version` so a stale bundle is detectable.

**Checklist theatre.** A checklist of items the platform cannot perform is only useful if it is honest about that. The copy requirement in §6 is a real requirement, not a nicety.

---

## 9. Success criteria

- Configuring an account, saving it as a blueprint, and applying it to a brand-new account reproduces the pipelines, stages, custom fields, tags, custom values and forms.
- Applying the same blueprint twice changes nothing the second time.
- An applied form has a different `public_id` from its source, an empty notify list, and `draft` status.
- Applied custom values carry their keys and names with blank values.
- No contact, opportunity, conversation, message or submission is ever cloned.
- A new account shows the full activation checklist; ticking an item persists; a free-text item can be added.
- A partial apply reports exactly which assets failed, and re-applying completes it.
- All five gates green.
