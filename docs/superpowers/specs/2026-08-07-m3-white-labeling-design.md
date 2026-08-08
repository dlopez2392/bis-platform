# M3 White-Labeling — Design

**Goal:** A client company's users, and their own customers, see that company's name and logo instead of BIS's.

**Status:** Decisions approved 2026-08-07. Not yet planned or executed.

---

## 1. Why

M2 gave client companies a scoped view of the CRM. Live QA immediately surfaced the gap: a client signs in and the only branding on screen reads **"BIS"** — the agency's name, on their client's screen. A patch (PR #8) now shows the account name in the sidebar, so a client can at least tell where they are, but the brand mark is still the agency's.

More importantly, the **public lead form** at `/f/<publicId>` is filled in by the client's *own customers*. That page carrying BIS branding is the most out-of-place instance of this, and the one with the widest reach.

## 2. Decisions

| Question | Decision | Reasoning |
|---|---|---|
| Who controls branding | **The agency, per account** | Branding lives in the account's Settings, which is already agency-only (`requireAgencyOnlyAccountAccess`). No client-facing write path, no client-facing file upload, no arbitrary client images entering the platform. The agency onboards each client by hand anyway. |
| Which surfaces | **The client's in-app view + the public form** | The sidebar brand slot a client's staff see, and `/f/<publicId>`, which their customers see. **Outbound email stays BIS-branded** — per-client email branding drags in sending domains and DKIM, which is a separate project and already an activation-checklist item done outside the app. |
| Name model | **A separate `brand_name`** | `accounts.name` stays the agency's internal label (what shows in Companies), `brand_name` is what clients and their customers see. Lets the agency keep working names like "Rio Roofing — trial" without a lead ever seeing one. |

## 3. Data

```sql
alter table public.accounts
  add column brand_name text,
  add column brand_logo_path text;
```

Both nullable. Null means "not branded" and everything falls back (§5), so shipping this changes nothing for existing accounts.

`brand_logo_path` stores the object path within the bucket, not a full URL — URLs change with project or CDN configuration, paths don't.

## 4. Logo storage — the milestone's principal unknown

**No Supabase Storage bucket exists in this project yet.** Nothing in `apps/` or `packages/` calls `.storage`. Creating and configuring one is new infrastructure, and like M2's Clerk↔Supabase JWT integration it should be **task one, proven end to end before anything is built on it**.

Requirements:

- A **public** bucket. Logos appear on `/f/<publicId>`, which is served to anonymous visitors; signed URLs would expire and add a request per render for no benefit.
- Upload happens **server-side only**, from an agency-guarded server action using the service-role client. No browser-to-Storage upload, no client-supplied path.
- Path derived server-side from the account id — never from user input.

**Raster formats only: PNG, JPEG, WebP. SVG must be rejected.** An SVG is an XML document that can carry `<script>`, and this file is served to the client's customers on a public page. Accepting SVG would turn the logo upload into a stored-XSS vector on the one surface with the widest and least-trusted audience. This is not a preference; it is the reason the format list is a constraint rather than a suggestion.

Also enforce: a maximum file size, and validation of the actual decoded content type rather than trusting the filename extension or the browser-supplied MIME type.

## 5. Fallbacks

Nothing may render blank when branding is unset.

| Surface | Branded | Not branded |
|---|---|---|
| Client sidebar brand slot | logo, else `brand_name` | the account name (PR #8's behavior, unchanged) |
| Agency sidebar | — | always `m["shell.brand"]` ("BIS"). The agency's own chrome never wears a client's brand. |
| Public form `/f/<publicId>` | logo + `brand_name` | whatever it renders today — **the implementer must locate the current header; a grep for `form.name` / `<h1>` found nothing, so its structure is not what one would assume.** |

## 6. Out of scope

- Client-editable branding. The agency sets it; a client-facing write path is a separate decision with its own risk surface.
- Colors, fonts, and full theming. Name and logo only. Forms already carry a `theme` field — do not extend it here.
- Outbound email branding, and per-client sending domains.
- Custom domains per client.
- Favicon and page `<title>` per client.

## 7. Open questions for planning

- Where exactly the public form renders its heading, and whether a logo fits its existing layout without a redesign.
- Whether the agency's Companies list should show `brand_name` anywhere, or stay purely internal. Default: stay internal.
- Whether a logo needs a delete path in v0, or whether re-uploading to replace is sufficient. Default: replace only.
