# M4c — Client-Editable Branding — Design Spec

## 1. Goal

M3 shipped white-labeling as **agency-controlled**: only an agency admin can set
a client's brand name, logo, colour and the four theme enums, from
`/dashboard/accounts/<id>/settings`. That was the right call for a milestone
whose job was to prove the mechanism; it leaves danlo as the person who uploads
every client's logo.

M4c hands that to the client. After it, a company signed into their own
workspace can change what their staff see and what their customers see, without
asking anyone.

## 2. Decisions settled with danlo — do NOT re-litigate

1. **Clients get the full set** — brand name, logo, colour, and all four theme
   controls (neutral, corners, typeface, mode). Not a reduced subset. The
   guardrails that make this safe already exist and were built for exactly
   this: M4a/M4b *derive* every token and lift for contrast, so an illegible
   result is not reachable by picking values, and the logo upload already
   passes a magic-byte allowlist proven in production against an SVG carrying
   `<script>alert(document.domain)</script>`.
2. **A new client-visible route with its own nav item**, not an opened-up
   Settings page. Settings also carries custom-field definitions, blueprints
   and the client-access switch; making it role-aware means every panel and
   every query on it becomes conditional, and one missed condition leaks
   agency data. That is the exact shape of the M2 near-miss, where
   `dashboard/layout.tsx` held the only guard on three agency-wide
   `serviceDb()` reads.
3. **No notification.** `account.branding_updated` already records actor and
   timestamp. An email per change becomes noise that gets filtered, which is
   worse than no alert because then it is unread rather than absent.
4. **The logo upload stays on the service client.** See §5.3 — recorded as a
   known single-layer path rather than glossed over.

**No agency lock.** Considered and rejected: a per-account freeze is a control
that has to be built, tested and remembered, for a problem nobody has had. If a
client makes a mess, the agency can still fix it from Settings, which is not
going away.

## 3. What each role can do afterwards

| | Agency admin | Client user |
| --- | --- | --- |
| Brand name, logo, colour, 4 theme controls | yes, from Settings | **yes, from Branding (new)** |
| Account `name` (the agency's internal label) | yes | **no** |
| `client_access_enabled` | yes | **no** |
| Blueprints, custom fields, invitations | yes | no |

## 4. Surface

New route **`/dashboard/accounts/<accountId>/branding`**, guarded by the
existing `requireAccountAccess(accountId)` — which already redirects a client
asking for someone else's account to their own rather than 403ing, because a
403 confirms the account exists.

`AppSidebar` gains a **Branding** item. It is the client's 7th; the agency does
not get it (their door is Settings, which still holds the panel beside the
things only they can do). A client still has no sidebar footer.

The page loads **branding and nothing else** — no blueprints, no custom fields,
no Clerk member list. That is the property that makes this route safe to expose,
and it is a property of what the file fetches, not of a conditional.

## 5. The security model

### 5.1 What changes, and why it has to

Today `setBrandingAction` runs the write as **service role** (`serviceDb()`)
behind `requireAgencyOnlyAccountAccess`. The service client bypasses RLS
entirely, so that app-layer guard is the *only* thing between a caller and any
account's branding. Acceptable while only the agency could reach it.

Letting clients in makes that guard load-bearing against untrusted callers.
This project has already shipped that exact mistake once: M1a's review found
`accountId` arriving as a **client-controlled hidden input** feeding a
service-role client — twelve latent IDORs, harmless only until a non-agency
role existed. M4c creates that role.

So the branding write moves to the **RLS-enforced** client, `dbForRequest()`,
and the boundary is enforced twice.

### 5.2 Migration `0013_client_branding.sql`

**Row scope.** A client may update only their own account's row, and only while
their access is on:

```sql
create policy accounts_member_update on public.accounts
  for update to authenticated
  using      (clerk_org_id = app.jwt()->>'org_id' and client_access_enabled)
  with check (clerk_org_id = app.jwt()->>'org_id' and client_access_enabled);
```

Both `using` and `with check`: `using` decides which rows are visible to the
update, `with check` decides what the row may become. Without the second, a
client could move their row to another org.

The agency path is untouched — `accounts_agency_all` (0001) is
`app.is_agency()` alone, so one action serves both roles and each is covered by
its own policy.

**Column scope.** 🔴 **An UPDATE policy is row-scoped, not column-scoped.** The
policy above, alone, lets a client rewrite *every* column on their own row —
including `client_access_enabled`, which would let them re-enable access the
agency had just switched off, and `name`, the agency's internal label. Postgres
column privileges are the correct tool and they cost nothing:

```sql
revoke update on public.accounts from authenticated;
grant update (brand_name, brand_logo_path, brand_color,
              brand_neutral, brand_corners, brand_type, brand_mode)
  on public.accounts to authenticated;
```

Safe for the agency: every existing account write (`createAccount`,
`setClientAccess`, and today's `setBranding` caller) runs as **service role**,
which is not subject to column grants or RLS. Verified by reading every
`from("accounts")` write in `packages/db/src`, not assumed.

### 5.3 The one asymmetry, stated plainly

`uploadBrandLogo` keeps using `serviceDb()`. Moving it means writing RLS
policies for `storage.objects`, a materially larger piece of work that M4c does
not need to carry.

It is contained rather than unguarded: the object path is
`<accountId>/logo-<sha256[0:16]>.<ext>` where `accountId` comes from the
**guard-verified** value, never from the form, and the uuid column type rejects
a traversal attempt before Storage is reached. The byte sniff still runs.

**But it is one layer, not two, and this spec does not claim otherwise.** If a
future milestone adds Storage RLS, this is the path to fix first.

## 6. No second implementation

The agency's Settings card and the client's new page render the **same**
`BrandingPanel` and post to the **same** action. M1c shipped duplicated form
logic twice and paid for it both times; two branding forms would drift the day
someone adds a field to one.

The action's guard widens from `requireAgencyOnlyAccountAccess` to
`requireAccountAccess`, and it stops choosing a database client by role — the
**row write** always uses `dbForRequest()`, letting the two policies decide.

Precisely: the service client leaves the `accounts` **UPDATE**. It remains on
two reads-and-writes inside the same action, both deliberate and both named
here so a later reader does not "tidy" one away — the Storage upload (§5.3),
and the `getBranding` read that fetches the previous logo path so the old
object can be swept after the new one is recorded.

⚠️ **`getBranding` for the *public form* keeps using `serviceDb()`** and must:
that reader serves anonymous strangers who have no session at all.

## 7. Testing

**The M2 lesson governs.** Every assertion in that milestone's client spec was
absence-based, and all five passed while the client's entire CRM was a 404.
Absence proves nothing on its own.

**Positive, DB-level proof** — the strongest evidence M2 produced, reused here.
Mint a real Clerk token for the client fixture and drive PostgREST directly:

1. updating its OWN branding columns succeeds and the values read back;
2. updating ANOTHER account's branding returns **zero rows** (not an error —
   RLS filters, it does not throw);
3. updating **`client_access_enabled` on its own row** is refused by the column
   grant, which is the escalation §5.2 exists to prevent;
4. updating `name` on its own row is refused for the same reason.

Each mutation-checked: drop the column grant and (3) and (4) must go red; drop
the policy and (1) must go red.

**e2e**: a client signs in, changes their brand colour, and sees it applied —
then the agency sees the same value in Settings. Painted values, never a custom
property (M4a/M4b).

**Unit**: the action's guard change, and that it never constructs a service
client on the branding write path.

## 8. Out of scope

- **Storage RLS** (§5.3).
- **An agency lock / approval flow.** §2.
- **Client-editable account `name`.** That is the agency's label for their own
  list; `brand_name` is the client-facing one and already exists.
- **Per-client favicon**, email branding, custom domains — M4d and later.
- **Undo/history.** The events log records what changed; rendering a timeline
  is its own feature.

## 9. Risks

- A client sets a brand colour their own staff dislike. **Accepted** — it is
  their brand, contrast is guaranteed by derivation, and the agency can still
  edit it.
- The column grant is invisible in application code: nothing in TypeScript
  says a client cannot write `name`. Mitigated by tests (3) and (4), which fail
  loudly if the grant is ever dropped or a column is added to it carelessly.
- **Adding a branding column later requires updating the grant**, or the new
  field silently fails to save for clients while working for the agency. A
  comment in the migration says so; the cross-role e2e would catch it.
