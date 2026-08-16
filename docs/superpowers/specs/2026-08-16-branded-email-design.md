# Branded email — design

**Date:** 2026-08-16
**Status:** approved by danlo, not implemented
**Branch:** `docs/branded-email`, cut from `main` @ `3a08f6c`

## 1. What & why

Every email this platform sends is **bare plain text**. `resend.ts:23` sets `text:`
and nothing else; there is no HTML path anywhere in the codebase. A client's
customer receives an unstyled message whose only sign of whose business it is
comes from the display name in the From header.

Two emails exist, and they are different animals:

| email | goes to | today |
|---|---|---|
| lead alert (`f/[publicId]/actions.ts`) | the **client** | plain text, and its dashboard link is broken (below) |
| outbound message (`conversations/actions.ts`) | the **customer** | plain text, operator's typed body |

🔴 **The lead alert's link is not a link.** Its body ends with:

```
Contact: /dashboard/accounts/<accountId>/contacts/<contactId>
```

A bare path in an email is not clickable in any client, and useless from a
phone. The code comment beside `notify()` says a failure there means the email
still goes out "just without a dashboard link to click" — so a link was
intended; there has never been one. **Fixing this is worth more than the
branding**, and it is why the alert gets structure rather than decoration.

## 2. Decisions locked with danlo — do not re-litigate

1. **Both emails**, weighted differently, not uniformly branded.
2. **The alert gets full structure**: heading, answers as a table, logo + brand
   name, and a real button to the contact. It goes to the client's own inbox,
   so there is no deliverability cost to spend.
3. **The outbound email stays restrained**: the operator's body verbatim, a
   small logo and brand name above it, brand colour on links only. **No footer,
   no campaign chrome.** A heavily branded 1:1 email from a contractor to a
   customer reads as marketing, which costs both trust and inbox placement.
4. **The logo stays** (the alternative — name and colour only — was offered and
   declined).

## 3. Approach — pure template modules

`apps/web/src/lib/email/templates/` gains one module per email, each a **pure
function** taking structured input plus `Branding` and returning
`{ subject, html, text }`.

No new dependency. Email HTML is its own dialect (tables, inline styles) but a
small one at two templates, and being pure is what makes them testable **at
all** here: this workspace's vitest includes `src/**/*.test.ts` only, so a
`.tsx` component template could not be unit-tested without changing the config.

**Rejected — react-email.** Better authoring and previews, at the cost of a real
dependency tree, a render step, `.tsx` files this test config ignores, and a
second colour path that would drift from the resolver below. Revisit if the
number of templates grows past a handful.

**Rejected — structure only, stay plain text.** Best deliverability and it still
fixes the link, but danlo asked for branded.

## 4. Colour comes from the resolver that already exists

The accent is `publicFormTheme(branding, false).formAccent`, which is
`{ accent, accentForeground }` — a brand colour **lifted until it carries a
legible label**, plus the text colour to put on it.

This is not a convenience. M4b's contrast sweep found two AA defects that were
**live in production**, and that resolver is the fix. An email button painted
with the raw hex would reintroduce exactly those defects on a surface nobody is
sweeping. It also lifts against white, which is the surface an email card sits
on, so `transparent: false` is the semantically correct call.

**An unbranded account** gets the same structure with no logo and the default
accent — the same rule the public form follows, where a brand colour alone never
engages the theme.

### 4.1 Where each send site gets the branding

Both already read the `accounts` row for the display name, so both **widen that
existing select rather than adding a query** — the same move the reply-to work
made, and for the same reason:

- **alert** — `notify()` reads `select("name")`; it becomes the name plus the
  branding columns.
- **outbound** — `conversations/actions.ts` reads `select("name, reply_to_email")`;
  same widening.

⚠️ **Do not reach for `getBranding()` at these two sites.** It is a second round
trip to a row the action is already holding, on a path where a provider call is
already the slow part.

The logo needs a URL, not the stored path: `brandLogoUrl()` from `@bis/db`, which
is safe here because both send sites are server-side. (It must never reach a
client component — that is why `BrandingPanel` takes a resolved `logoUrl` prop.)

**Subjects are unchanged.** The alert stays `New lead: <form name>`; the outbound
email keeps the operator's subject. This work changes the body, not the envelope.

## 5. Both parts, every send

`SendEmailInput` gains an optional `html`. When it is absent the provider sends
`text` alone and behaves exactly as today, so nothing that does not opt in
changes.

A plain-text alternative is not optional in practice: it is what keeps a
branded message out of the spam bucket and readable in a text client. **The
text part is never derived by stripping tags** — each template composes both
deliberately, so the text version stays the one a human would write.

## 6. The absolute URL, with no new configuration

The link needs an origin. There is **no base-URL env var anywhere in this repo**
(no `NEXT_PUBLIC_APP_URL`, no `VERCEL_URL` usage — checked, not assumed).

It does not need one. `submitFormAction` already holds the request headers
(`actions.ts:121`, `const h = await headers()`), and the submission arrives at
the same origin the app is served from — so the Host header yields a correct
absolute base on any domain, including a custom one later. Zero config, and
correct by construction rather than by a value someone has to remember to set.

⚠️ The outbound email needs no links of its own, so this applies to the alert
only.

## 7. Images are blocked by default

Most clients block remote images until the reader allows them. The brand **name
is always text** beside the logo and never an image, and the logo's `alt`
carries the name, so a blocked image costs recognition but never identification.

The logo is already a public Storage URL, so no attachment or CID embedding is
needed.

## 8. Testing

Pure functions make all of this cheap and none of it ceremonial:

| assertion | why it exists |
|---|---|
| the alert's link is **absolute** and contains the account and contact ids | the defect this fixes; a relative path must never come back |
| every submitted answer appears in the table | the alert's whole job |
| a **dark** brand colour yields the lifted accent, not the raw hex | pins the M4b resolver as the source, so no second colour path can appear |
| an unbranded account emits **no `<img>`** | the fallback path, which is every account today |
| the text part is non-empty and carries the **same link** as the html | a branded email with an empty text part is a spam-filter magnet |
| the outbound body appears **verbatim** in the text part | the operator typed it; nothing may rewrite it |

The mutation that matters: painting the button with the raw brand colour instead
of the resolved accent must fail the dark-brand test.

## 9. Out of scope

- **Sending domains.** Mail still goes out from `crm@bis-rgv.com` with the
  client's display name. This changes what the message looks like, not who it is
  from.
- **Dark-mode email clients.** A real rabbit hole with poor cross-client
  support; the templates use light surfaces and adequate contrast either way.
- **Localisation.** The dashboard string catalogue is English-only today; the
  public form's locale handling does not extend to these emails.
