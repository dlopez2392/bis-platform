# Reply-to address — design

**Date:** 2026-08-16
**Status:** approved by danlo, not implemented
**Branch:** `docs/reply-to-address`, cut from `main` @ `c9d00dd`

## 1. What & why

Every reply to mail this platform sends lands in the BIS mailbox. Two separate
flows, one unused field:

- **The lead notification.** A stranger fills in a client's public form; the
  client gets `New lead: <form>` from `crm@bis-rgv.com`. Hitting Reply writes to
  BIS, not to the person who just asked for a quote. The customer never hears
  back and nothing anywhere records that.
- **Outbound email to a contact.** A client emails a contact from Conversations.
  The contact replies. That reply lands in the BIS mailbox.

`replyTo` is already typed (`apps/web/src/lib/email/types.ts`) and already passed
to Resend (`resend.ts`). **No caller has ever populated it.** This is the design
promise M1b recorded and the schema could not keep.

The two flows want *different* addresses, which is why one field has not been
enough to fix either:

| flow | recipient | reply should reach |
|---|---|---|
| lead notification | the client | **the customer who submitted** |
| outbound to a contact | the customer | **the client** |

The first needs no storage at all. The second needs a per-account address.

## 2. Decisions locked with danlo — do not re-litigate

1. **Both flows**, not one.
2. **The address is editable on BOTH surfaces** — the agency's Settings page and
   the client's own `/branding` page. The column therefore becomes
   client-writable.
3. **Unset means the header is omitted**, exactly today's behaviour. No implicit
   fallback to the sending user's address: the reply-to must be the company's,
   not whoever happened to click Send, and the send path takes no new network
   call.
4. An **activation-checklist item** makes the unset state visible instead of
   silent.

## 3. Approach — the address rides the branding read/write path

`reply_to_email` joins the `Branding` type, `getBranding`/`setBranding`, the
shared `BrandingPanel`, and the 0013 column grant.

The deciding argument is a safety one. The client `/branding` page's security
rationale is written into the page itself: *"This page fetches branding and
nothing else. That is a property of what it reads rather than of a conditional,
which is what makes it safe to expose: there is no branch here for a future edit
to get wrong."* A separate accessor makes that page read two things and weakens
exactly the property that argument rests on. Riding `Branding` keeps it one read.

The honest cost: `Branding` then carries one field that is not visual branding.
Mitigated by naming the panel section for what it does rather than for the type
it lives in.

**Rejected — its own `emailIdentity` module and card.** Conceptually cleaner and
it is the shape M4d wants, but for a single field today it buys a second read on
the client page, a second action and more grant surface. **If M4d grows a real
email-identity concept (custom domain, per-account From), that is the moment to
extract it, and the extraction is mechanical.**

**Rejected — reuse the form's `notify_emails[0]`.** No schema, but it conflates
"where lead alerts go" with "where replies go", and an account with no form has
no answer at all.

## 4. Data

Migration **0014**:

- `alter table public.accounts add column reply_to_email text` (nullable, no
  default — every existing account starts unset, which is the documented
  no-change state).
- Add `reply_to_email` to the `grant update (...) on public.accounts to
  authenticated` list introduced by 0013.

0013 carries the warning this design must obey: *"⚠️ ADDING A BRANDING COLUMN
LATER MEANS ADDING IT HERE. Otherwise it saves for the agency and silently fails
for clients."* That failure mode is invisible to the agency, who writes through
the service role, and total for the client.

**No SQL check constraint.** An email regex in Postgres is a maintenance trap and
would reject addresses that are legal but unusual. Validation lives in the action,
where the error can name the problem to the person typing.

## 5. The two send sites

**Outbound** — `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts`.
The existing read is `db.from("accounts").select("name")`; it becomes
`select("name, reply_to_email")`. **No extra query.** `replyTo` is passed only
when the value is non-empty, so an unset account sends exactly what it sends
today.

**Lead notification** — `apps/web/src/app/f/[publicId]/actions.ts`.
`enrich` already builds `byKind` (`form.fields` → submitted value), so the
customer's address is `byKind.get("core.email")`. It is passed into `notify()`,
which sets `replyTo` on each recipient's send. A form with no `core.email` field,
or one left blank, omits the header — the value is `""` in both cases, so one
guard covers both.

The submitted value has already passed the form pipeline's own email validation
before `enrich` runs. It is nonetheless attacker-chosen; the Resend SDK takes it
as a JSON field rather than a raw header, so there is no header-injection surface.
The worst a submitter can do is nominate their own address, which is the point of
the field.

## 6. Surface

One field in `BrandingPanel`, which Settings and `/branding` already share, so
both surfaces get it in one change.

Its label and hint need **both voices**. `panel-copy.ts` now exists for exactly
this, and its exact-key-set test fails if one audience gains a string and the
other does not — the regression that produced the third-person copy defect.

## 7. Checklist

A new `CHECKLIST_CATALOGUE` entry, key `reply_to`, `external: false` (the work
happens in this app), and **no `href`** — the catalogue is a static module with no
account id in scope, so the help text names where the field lives instead. That is
the same reason every non-external item today carries no link.

`mergeChecklist` treats a catalogue item with no stored row as undone, so **no
backfill is needed**. `checklist-catalogue.test.ts` asserts the catalogue as an
exact set, so adding the item without updating that test fails.

The checklist is agency-facing today, which suits an item about a company's setup.

### 7.1 Blueprints — checked, and deliberately nothing to do

M1d's exclusion list exists because a cloned `forms.notify_emails` would route a
new client's leads to the previous client's inbox. A cloned `reply_to_email` would
be the same class of defect, one step further on: **a new client's customers
replying to the previous client.**

It cannot happen. `buildBundle` captures `pipelines`, `pipeline_stages`,
`custom_fields`, `tags`, `custom_values` and `forms` — **it never reads the
`accounts` table at all**, so no account-level column is cloneable today. Verified
by reading every `db.from(...)` in `packages/db/src/blueprints.ts`, not assumed.

**If blueprints ever grow account-level capture, `reply_to_email` belongs on the
exclusion list beside `notify_emails`, and for the identical reason.**

## 8. Validation

The action rejects a malformed address with a message that says so, in the same
shape as `branding.badColor`. Empty input clears the column (`null`), consistent
with `setBranding`'s existing `undefined` = leave alone, `null` = clear contract.

## 9. Testing

| level | assertion |
|---|---|
| db unit | `setBranding` writes it, clears it on `null`, leaves it alone on `undefined`; `getBranding` reads it |
| db grants | the column-grant set **exactly**, both directions — mutation-checked by dropping `reply_to_email` from the grant |
| web unit | outbound send passes `replyTo` when set and **omits it when null** |
| web unit | the notification sets `replyTo` to the submitted email; omits it when the form has no email field |
| web unit | `panel-copy` exact key set + no third-person string (existing test, extended by the new keys) |
| e2e | the client saves an address from their own `/branding` page — proves the column grant end to end through RLS, which no unit test can |

The mutation that matters most is dropping the column from the 0013 grant: it
passes every agency-side test and fails only for clients.

## 10. Out of scope — say this plainly to anyone who asks

This does **not** give a client their own sending domain. Mail still goes out
**from `crm@bis-rgv.com`** carrying the client's display name. Reply-to changes
where replies land, not who the message is from. Per-client sending domains
remain M4d and require Resend domain verification plus DNS records per client,
which is an operations decision, not a code one.
