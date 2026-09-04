# A2P 10DLC registration as real state

**Date:** 2026-09-03 · **Status:** approved by danlo (brainstorm 2026-09-03)
**Roadmap:** Phase 1a of `docs/superpowers/plans/2026-09-03-product-roadmap.md`
**Blocks:** Phase 1b (outbound SMS) — deliberately.

## Goal

The platform knows, per client company, whether that client is cleared to send
A2P text messages, and records the brand and campaign identifiers behind that
answer. Exit: an operator can see which clients are cleared and which are still
with the carriers, and the SMS send path Phase 1b builds has a real predicate
to refuse on.

## What this does NOT do

**It ships no texting capability.** No Telnyx API call, no message sending, no
composer change beyond a disabled state. That is the point: the gate has to
exist *before* the Send button, not after.

Also out: collecting EIN and business details in-app, calling Telnyx's
brand/campaign API, and polling vetting status. Those need the outbound Telnyx
client that Phase 1b builds anyway, and doing them first means building that
integration twice. Registration stays manual in the Telnyx portal; this phase
records its outcome.

## The locked decision behind it

**Each client company registers its OWN A2P brand**, with BIS acting as the
CSP registering on their behalf. Not one BIS brand with per-client campaigns.

Three reasons, recorded so this is not re-litigated:

1. **The traffic is genuinely the client's.** In 10DLC the brand is the entity
   whose messages these are. The message body says "Rio Roofing"; a registered
   brand saying "BIS" is the sender mismatch carrier filtering targets, and
   platform brands fronting unrelated businesses are an active enforcement
   area.
2. **Blast radius.** Under a shared brand, one client drawing complaints
   degrades deliverability for every client simultaneously — invisible until
   several complain at once, on a product sold on reliability.
3. **Consistency with a decision already made.** Email gives each client their
   own sending domain with their own DKIM/DMARC, and `from_email` is
   deliberately ungranted so one client cannot send as another. The opposite
   topology for SMS would make the platform incoherent about who the sender is.

## Data model

Four columns on `accounts` (migration `0023`, the next free number — `0022` is
the current highest):

| Column | Type | Notes |
|---|---|---|
| `a2p_brand_id` | `text null` | The TCR/Telnyx brand identifier, entered by the operator. |
| `a2p_campaign_id` | `text null` | The campaign identifier. |
| `a2p_status` | `text not null default 'not_started'` | CHECK in `('not_started','pending','approved','rejected')`. |
| `a2p_updated_at` | `timestamptz null` | When the operator last changed any of the above. |

A brand belongs to a business and a campaign to a use case. This product has
one use case per client, so one campaign per account is sufficient and numbers
inherit eligibility from their account — there is no per-number A2P state.

**Why one status and not two.** A brand can be approved while its campaign is
still pending, so a two-field model is more faithful. It is also over-modelling
a field a human types: the only question the platform must answer is "can this
client text yet," and `approved` is the only value that answers it. Rejected is
kept distinct from pending because they demand different operator action.

## The grants trap this must avoid

The single most important constraint here, and the reason the write does not go
where it looks like it should.

`0013_client_branding.sql:46-47` does:

```sql
revoke update on public.accounts from authenticated;
grant update (brand_name, brand_logo_path, brand_color, …) on public.accounts to authenticated;
```

Only branding columns are writable by the `authenticated` role. **A new
`a2p_*` column written through `dbForRequest()` would fail with a permission
error that unit tests cannot see, because they mock the database.** That is
precisely how P5's inline account rename shipped broken — every rename would
have failed silently — and it is the third occurrence of this class in this
repo.

Two consequences:

- The write is an **agency-gated server action using `serviceDb()`**, not
  `dbForRequest()`. A2P entry is agency operator work; a client never does it.
- The new columns are deliberately **not granted**. `0013:45` notes that
  `client-branding-grants.test.ts` asserts the granted set EXACTLY in both
  directions, so leaving `a2p_*` ungranted needs no change there — and a future
  attempt to grant them would correctly fail that test until someone justifies
  it.

## The db function

`setA2pRegistration` in `packages/db/src/accounts.ts`, shaped like the
`renameAccount` beside it (`accounts.ts:67-73`) — which is itself the corrected
shape P5 arrived at after the zero-row bug:

```ts
export async function setA2pRegistration(
  db: SupabaseClient, accountId: string,
  patch: { brandId: string | null; campaignId: string | null; status: A2pStatus },
  actorId: string,
): Promise<void>
```

`.select("id")`, throw on error, **throw on zero rows** — PostgREST reports no
error for an update that matched nothing, so without that check the action
returns success having written nothing. Emits `account.a2p_updated` with the
actor, landing in `events`.

## How it surfaces

A2P stays in the **activation checklist**, not the Setup wizard's step rail. It
is genuinely done outside BIS with the carriers, which is what `external: true`
on `checklist-catalogue.ts:17` already says. The wizard's nine steps are things
done *in* BIS.

What changes: the item stops being a manual tick and **derives** from
`a2p_status === 'approved'` — the same philosophy the Setup wizard already
uses, where state is derived from what is true rather than what someone
remembered to check off. A small agency-only panel captures the two identifiers
and the status.

The existing copy is kept verbatim. It is good and it is already written for
this model: *"Done with the carriers via Telnyx. Expect days to weeks; start it
early because nothing you do here speeds it up."*

**Accepted consequence, surfaced deliberately:** a derived item can go
BACKWARDS. If a registration is rejected, an item that read done stops reading
done. That is correct and honest, it is a behaviour the checklist has never
had, and it will be surprising the first time. Recorded here so it is a
decision rather than a bug report.

## The gate

Phase 1b's SMS send path refuses unless the sending account's `a2p_status` is
`approved`. This phase ships the predicate and the disabled state; there is no
send path yet to refuse.

## Error handling

Nothing here can fail in a novel way. The action is agency-gated and
`serviceDb`-backed, so the only realistic failures are a wrong account id
(caught by the zero-row throw) and a database fault (thrown, surfaced by the
action's own error path). The checklist derivation reads a column that always
has a value, because the column is `not null default 'not_started'`.

## Testing

**packages/db:** a `setA2pRegistration` round-trip, the zero-row throw against
an unknown account, and the emitted event. Folded into an EXISTING
`withTestAccount` cycle rather than opening a new one — `blueprints.test.ts` is
contention-marginal at ~17s against a 20s default and extra fixture cycles tip
it into a timeout.

**apps/web unit:** the derived checklist state for each of the four statuses,
including that `rejected` and `pending` both read as not-done.

**e2e — the one that matters:** an agency session writes the registration and
sees it reflected; **a client session cannot write it.** Unit tests mock the
database and are blind to column grants, so this is the only test that can see
the constraint the whole design turns on.

## Definition of done

`pnpm check`, `pnpm --filter web build`, full `pnpm --filter web test:e2e`,
review gate, danlo gate. DESIGN.md applies to the new panel — tokens only, the
four surfaces, loaded/empty/error states, 7 AM copy, and `/styleguide` updated
if a new component or variant lands.

## Out of scope (explicitly)

- Everything in "What this does NOT do" above.
- Per-number A2P state. Numbers inherit from their account; revisit only if a
  client ever needs two campaigns.
- Backfilling existing accounts to anything other than `not_started`. The
  default is honest: the platform genuinely does not know.
- Migrating the other checklist items from manual ticks to derived state. A2P
  moves because this phase gives it real state to derive from; the rest have
  none, and changing them would be a separate decision.
