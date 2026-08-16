# Branded Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both emails this platform sends carry the client's brand and, for the lead alert, a dashboard link that is actually clickable.

**Architecture:** Two pure template modules return `{ html, text }` from structured input plus `Branding`. `SendEmailInput` gains an optional `html`, so anything that does not opt in is unchanged. The accent comes from the existing `publicFormTheme` resolver; the absolute URL comes from the request Host, which the submission action already holds.

**Tech Stack:** Next 16 App Router, TypeScript, Resend, vitest, Playwright.

Spec: `docs/superpowers/specs/2026-08-16-branded-email-design.md`.

## Global Constraints

- **Every send carries BOTH parts.** Never send `html` without `text`. The text part is composed deliberately, **never derived by stripping tags**.
- **The accent is `publicFormTheme(branding, false).formAccent`** (`{ accent, accentForeground }`), never the raw `brandColor`. That resolver is M4b's fix for two AA defects that were live in production.
- **The brand NAME is always text, never an image.** Remote images are blocked by default in most clients; a blocked logo must cost recognition, never identification.
- **`accounts.name` is the agency's INTERNAL label and must never reach a customer.** Display uses `brandName ?? name`.
- **Widen the existing `accounts` select at both send sites. Do NOT call `getBranding()`** — it is a second round trip to a row the action already holds.
- **Email HTML is a dialect:** tables for layout, inline styles only, no flexbox/grid, no `<style>` blocks, no external CSS.
- Commit after every task. Run gates with the command last so no pipe eats the exit code.

---

### Task 1: `html` reaches Resend

**Files:**
- Modify: `apps/web/src/lib/email/types.ts`
- Modify: `apps/web/src/lib/email/resend.ts:18-24`
- Create: `apps/web/src/lib/email/resend.test.ts`

**Interfaces:**
- Produces: `SendEmailInput.html?: string`, passed through to `emails.send`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/email/resend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) };
  },
}));

import { resendEmailProvider } from "./resend";

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ data: { id: "re_1" }, error: null });
});

describe("resendEmailProvider", () => {
  it("passes html through when a template supplied one", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Rio Roofing",
      subject: "Hi", body: "plain", html: "<p>rich</p>",
    });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "plain",
      html: "<p>rich</p>",
    }));
  });

  // Both parts, always. A branded email with no text alternative is a
  // spam-filter magnet, and this is the assertion that stops one shipping.
  it("still sends text when there is no html, and omits html entirely", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Rio Roofing",
      subject: "Hi", body: "plain",
    });

    expect(sendMock.mock.calls[0]![0].text).toBe("plain");
    expect(sendMock.mock.calls[0]![0].html).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run src/lib/email/resend.test.ts`
Expected: FAIL — `html` is not a property of `SendEmailInput`, and the first assertion finds no `html` on the call.

- [ ] **Step 3: Implement**

In `types.ts`:

```ts
export type SendEmailInput = {
  to: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  body: string;
  /** The rich part. Optional so every existing caller is unchanged: absent
   *  means a text-only send, exactly as before. Never send this without
   *  `body` — the text alternative is what keeps a branded message out of the
   *  spam bucket and readable in a text client. */
  html?: string;
};
```

In `resend.ts`, inside `send`:

```ts
      subject: input.subject,
      text: input.body,
      ...(input.html ? { html: input.html } : {}),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run src/lib/email/resend.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/email/types.ts apps/web/src/lib/email/resend.ts apps/web/src/lib/email/resend.test.ts
git commit -m "feat(email): let a send carry an html part alongside its text"
```

---

### Task 2: `originFrom` — an absolute URL with no configuration

**Files:**
- Create: `apps/web/src/lib/email/origin.ts`
- Create: `apps/web/src/lib/email/origin.test.ts`

**Interfaces:**
- Produces: `originFrom(h: Headers): string | null`, used by Task 4

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/email/origin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { originFrom } from "./origin";

describe("originFrom", () => {
  it("builds an absolute origin from the forwarded proto and host", () => {
    expect(originFrom(new Headers({
      host: "bis-platform-six.vercel.app", "x-forwarded-proto": "https",
    }))).toBe("https://bis-platform-six.vercel.app");
  });

  // A custom domain later needs no code change and no env var: the Host header
  // is whatever the visitor actually reached.
  it("follows whatever host the request arrived on", () => {
    expect(originFrom(new Headers({ host: "crm.rioroofing.com", "x-forwarded-proto": "https" })))
      .toBe("https://crm.rioroofing.com");
  });

  it("assumes https when no proto header is present", () => {
    expect(originFrom(new Headers({ host: "example.com" }))).toBe("https://example.com");
  });

  // Vercel sends a comma-separated list through a proxy chain. Taking the
  // whole string would produce "https,https://host" — a URL that resolves
  // nowhere, in an email nobody can test before it is sent.
  it("takes the first value when the proto header is a list", () => {
    expect(originFrom(new Headers({ host: "example.com", "x-forwarded-proto": "https,http" })))
      .toBe("https://example.com");
  });

  // No host means no link. The caller omits the button entirely rather than
  // emitting a relative path — which is the exact defect this work exists to
  // fix, and it must not come back through the error path.
  it("returns null when there is no host to build on", () => {
    expect(originFrom(new Headers())).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run src/lib/email/origin.test.ts`
Expected: FAIL — cannot resolve `./origin`.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/email/origin.ts`:

```ts
/**
 * The absolute origin a link in an email must carry, taken from the request
 * that triggered the send.
 *
 * There is deliberately no env var for this. A value someone has to remember
 * to set is a value that will be wrong on the first custom domain; the Host
 * header is whatever the visitor actually reached, so it is correct by
 * construction — including for a future custom domain.
 *
 * Returns null when there is no host to build on. The caller must then omit
 * the link entirely rather than fall back to a relative path: a bare
 * `/dashboard/...` in an email is the defect this work exists to remove.
 */
export function originFrom(h: Headers): string | null {
  const host = h.get("host");
  if (!host) return null;
  // Comma-separated through a proxy chain; the first value is the one the
  // client used.
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  return `${proto}://${host}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/web && pnpm vitest run src/lib/email/origin.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/email/origin.ts apps/web/src/lib/email/origin.test.ts
git commit -m "feat(email): derive an absolute origin from the request, not from config"
```

---

### Task 3: The shell — brand chrome shared by both emails

**Files:**
- Create: `apps/web/src/lib/email/templates/shell.ts`
- Create: `apps/web/src/lib/email/templates/shell.test.ts`

**Interfaces:**
- Consumes: `Branding` from `@bis/db`, `publicFormTheme` from `@/lib/branding/public-form-theme`, `brandLogoUrl` from `@bis/db`
- Produces:
  - `type EmailBrand = { name: string; logoUrl: string | null; accent: FormAccent }`
  - `emailBrand(branding: Branding, accountName: string): EmailBrand`
  - `escapeHtml(value: string): string`
  - `shell(brand: EmailBrand, bodyHtml: string): string`
  - `button(brand: EmailBrand, href: string, label: string): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/email/templates/shell.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand, escapeHtml, shell, button } from "./shell";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

describe("emailBrand", () => {
  // accounts.name is the agency's internal label ("Rio Roofing — trial") and
  // is explicitly not for the client's eyes, let alone their customer's.
  it("prefers the brand name over the agency's internal label", () => {
    expect(emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" }, "Rio Roofing — trial").name)
      .toBe("Rio Roofing");
  });

  it("falls back to the account name when no brand name is set", () => {
    expect(emailBrand(UNBRANDED, "Rio Roofing — trial").name).toBe("Rio Roofing — trial");
  });

  // The whole reason this goes through the resolver: #1e3a8a is too dark to
  // carry a legible label, so it must be LIFTED. Painting the raw hex is the
  // AA defect M4b already fixed once.
  it("lifts a dark brand colour rather than painting it raw", () => {
    const { accent } = emailBrand({ ...UNBRANDED, brandColor: "#1e3a8a" }, "Acme");
    expect(accent.accent.toLowerCase()).not.toBe("#1e3a8a");
    expect(accent.accentForeground).toBeTruthy();
  });
});

describe("shell", () => {
  it("prints the brand name as TEXT, so a blocked image still identifies the sender", () => {
    const html = shell(emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" }, "Acme"), "<p>hi</p>");
    expect(html).toContain("Rio Roofing");
    expect(html).not.toContain("<img");
  });

  it("escapes a brand name that contains markup", () => {
    const html = shell(emailBrand({ ...UNBRANDED, brandName: '<script>x</script>' }, "Acme"), "<p>hi</p>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps layout in tables and styles inline, because email clients demand it", () => {
    const html = shell(emailBrand(UNBRANDED, "Acme"), "<p>hi</p>");
    expect(html).toContain("<table");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("display:flex");
  });
});

describe("button", () => {
  it("paints the resolved accent and its readable foreground", () => {
    const brand = emailBrand({ ...UNBRANDED, brandColor: "#1e3a8a" }, "Acme");
    const html = button(brand, "https://example.com/x", "Open");
    expect(html).toContain(`background-color:${brand.accent.accent}`);
    expect(html).toContain(`color:${brand.accent.accentForeground}`);
    expect(html).toContain('href="https://example.com/x"');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run src/lib/email/templates/shell.test.ts`
Expected: FAIL — cannot resolve `./shell`.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/email/templates/shell.ts`:

```ts
import { brandLogoUrl, type Branding } from "@bis/db";
import { publicFormTheme, type FormAccent } from "@/lib/branding/public-form-theme";

export type EmailBrand = {
  /** What the reader should see. NEVER accounts.name when a brand name
   *  exists: that column is the agency's internal label for the company
   *  ("Rio Roofing — trial") and is not for the client's eyes, still less
   *  their customer's. */
  name: string;
  logoUrl: string | null;
  accent: FormAccent;
};

export function emailBrand(branding: Branding, accountName: string): EmailBrand {
  return {
    name: branding.brandName ?? accountName,
    logoUrl: branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null,
    // `false`, not `true`: an email card sits on white, which is exactly what
    // this resolver lifts against. It returns the brand colour raised until it
    // can carry a legible label, plus that label's colour.
    accent: publicFormTheme(branding, false).formAccent,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The outer chrome. Tables and inline styles only — email clients strip
 * <style> blocks, ignore flexbox and grid, and Outlook renders through Word.
 *
 * The brand NAME is text and the logo is decorative beside it, because most
 * clients block remote images until the reader allows them. A blocked image
 * must cost recognition, never identification.
 */
export function shell(brand: EmailBrand, bodyHtml: string): string {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" width="32" height="32" `
      + `style="display:block;border:0;max-height:32px;width:auto;" />`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background-color:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#f4f4f5;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:560px;background-color:#ffffff;border-radius:8px;padding:24px;
                  font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;
                  font-size:15px;line-height:1.5;color:#18181b;">
      <tr><td style="padding-bottom:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          ${logo ? `<td style="padding-right:8px;">${logo}</td>` : ""}
          <td style="font-weight:600;font-size:16px;">${escapeHtml(brand.name)}</td>
        </tr></table>
      </td></tr>
      <tr><td>${bodyHtml}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** A link styled as a button. `background-color`, not `background`: Outlook
 *  ignores the shorthand. */
export function button(brand: EmailBrand, href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" `
    + `style="display:inline-block;padding:10px 18px;border-radius:6px;text-decoration:none;`
    + `font-weight:600;background-color:${brand.accent.accent};`
    + `color:${brand.accent.accentForeground};">${escapeHtml(label)}</a>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run src/lib/email/templates/shell.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Mutation-check the accent**

In `emailBrand`, temporarily replace the accent with the raw value:

```ts
    accent: { accent: branding.brandColor ?? "#6d28d9", accentForeground: "#ffffff" },
```

Re-run: the "lifts a dark brand colour" test must FAIL. Restore. This is the assertion that keeps a second colour path from appearing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/email/templates/shell.ts apps/web/src/lib/email/templates/shell.test.ts
git commit -m "feat(email): brand chrome shared by both emails, in the dialect clients accept"
```

---

### Task 4: The lead alert — structure, and a link that works

**Files:**
- Create: `apps/web/src/lib/email/templates/lead-alert.ts`
- Create: `apps/web/src/lib/email/templates/lead-alert.test.ts`

**Interfaces:**
- Consumes: `shell`, `button`, `escapeHtml`, `EmailBrand` from Task 3
- Produces: `leadAlertEmail(input): { html: string; text: string }` where
  `input = { brand: EmailBrand; formName: string; answers: { label: string; value: string }[]; contactUrl: string | null }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/email/templates/lead-alert.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { leadAlertEmail } from "./lead-alert";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" }, "Acme");
const answers = [
  { label: "Email", value: "customer@example.com" },
  { label: "Message", value: "Need a quote for a new roof" },
];
const URL = "https://bis-platform-six.vercel.app/dashboard/accounts/acct_1/contacts/contact_1";

describe("leadAlertEmail", () => {
  it("carries every answer in both parts", () => {
    const { html, text } = leadAlertEmail({
      brand, formName: "Roof quote", answers, contactUrl: URL,
    });
    for (const a of answers) {
      expect(html).toContain(a.label);
      expect(html).toContain(a.value);
      expect(text).toContain(a.value);
    }
  });

  // The defect this whole task exists for: the body used to end with a bare
  // `/dashboard/...` path, which no email client renders as a link.
  it("links the contact ABSOLUTELY, in both parts", () => {
    const { html, text } = leadAlertEmail({
      brand, formName: "Roof quote", answers, contactUrl: URL,
    });
    expect(html).toContain(`href="${URL}"`);
    expect(text).toContain(URL);
    expect(html).not.toMatch(/href="\/dashboard/);
  });

  it("omits the link entirely rather than emitting a relative path", () => {
    const { html, text } = leadAlertEmail({
      brand, formName: "Roof quote", answers, contactUrl: null,
    });
    expect(html).not.toContain("<a href");
    expect(text).not.toContain("/dashboard/");
    // The lead itself must still arrive — losing the link must never lose the lead.
    expect(text).toContain("customer@example.com");
  });

  it("never returns an empty text part", () => {
    const { text } = leadAlertEmail({
      brand, formName: "Roof quote", answers: [], contactUrl: null,
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("escapes an answer that contains markup", () => {
    const { html } = leadAlertEmail({
      brand, formName: "Roof quote",
      answers: [{ label: "Message", value: "<img src=x onerror=alert(1)>" }],
      contactUrl: null,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run src/lib/email/templates/lead-alert.test.ts`
Expected: FAIL — cannot resolve `./lead-alert`.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/email/templates/lead-alert.ts`:

```ts
import { shell, button, escapeHtml, type EmailBrand } from "./shell";

export type LeadAlertInput = {
  brand: EmailBrand;
  formName: string;
  answers: { label: string; value: string }[];
  /** Absolute, or null when the request carried no host. Never relative. */
  contactUrl: string | null;
};

/**
 * The email a client gets when a stranger fills in their form.
 *
 * It goes to the client's own inbox, so it can spend structure freely — there
 * is no deliverability cost to a table and a button here, unlike the message
 * a customer receives.
 *
 * The answers are escaped because they are attacker-supplied: a form field is
 * the one place in this product where an untrusted stranger types text that a
 * client later opens in an email client.
 */
export function leadAlertEmail(input: LeadAlertInput): { html: string; text: string } {
  const rows = input.answers.map(({ label, value }) =>
    `<tr>
      <td style="padding:4px 12px 4px 0;color:#71717a;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join("");

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">New lead</p>
    <p style="margin:0 0 16px;color:#71717a;">From your form “${escapeHtml(input.formName)}”.</p>
    ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>` : ""}
    ${input.contactUrl ? button(input.brand, input.contactUrl, "Open this contact") : ""}
  `);

  // Composed, never derived by stripping tags — this is the version a human
  // would have written, and it is what a text-only client shows.
  const text = [
    `New lead from your form "${input.formName}".`,
    "",
    ...input.answers.map((a) => `${a.label}: ${a.value}`),
    ...(input.contactUrl ? ["", `Open this contact: ${input.contactUrl}`] : []),
  ].join("\n");

  return { html, text };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run src/lib/email/templates/lead-alert.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/email/templates/lead-alert.ts apps/web/src/lib/email/templates/lead-alert.test.ts
git commit -m "feat(email): a lead alert with structure and a link that is actually a link"
```

---

### Task 5: Wire the alert into the submission path

**Files:**
- Modify: `apps/web/src/app/f/[publicId]/actions.ts` — the `enrich` call and signature, `notify`'s signature, its account read and its send
- Modify: `apps/web/src/app/f/[publicId]/actions.test.ts`

**Interfaces:**
- Consumes: `originFrom` (Task 2), `emailBrand` (Task 3), `leadAlertEmail` (Task 4)

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/app/f/[publicId]/actions.test.ts`. The mocked `serviceDb` at the top of that file returns `{ name: "Acme" }` for the account lookup; widen it to carry branding columns so the send has something to brand with:

```ts
// In the existing vi.mock("@bis/db", ...) block, the serviceDb stub's
// maybeSingle must now resolve:
//   { data: { name: "Acme", brand_name: "Rio Roofing", brand_logo_path: null,
//             brand_color: null, brand_neutral: null, brand_corners: null,
//             brand_type: null, brand_mode: null } }
// and the block must also export brandLogoUrl: (p: string) => `https://cdn.test/${p}`.

describe("submitFormAction — the lead alert is branded and linkable", () => {
  it("sends html and text, with an absolute contact link in both", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    vi.mocked(headers).mockResolvedValue(new Headers({
      "user-agent": "test-agent", host: "crm.example.com", "x-forwarded-proto": "https",
    }) as never);
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", email: "customer@example.com",
    }));

    const sent = sendMock.mock.calls[0]![0];
    expect(sent.html).toContain("https://crm.example.com/dashboard/accounts/acct_1/contacts/contact_1");
    expect(sent.text).toContain("https://crm.example.com/dashboard/accounts/acct_1/contacts/contact_1");
    // The brand name, not the agency's internal label.
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.body.length).toBeGreaterThan(0);
  });

  it("still sends the lead when there is no host to build a link from", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    vi.mocked(headers).mockResolvedValue(new Headers({ "user-agent": "test-agent" }) as never);
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", email: "customer@example.com",
    }));

    const sent = sendMock.mock.calls[0]![0];
    expect(sent.text).toContain("customer@example.com");
    expect(sent.text).not.toContain("/dashboard/");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && pnpm vitest run "src/app/f/[publicId]/actions.test.ts"`
Expected: FAIL — `sent.html` is undefined.

- [ ] **Step 3: Implement**

In `actions.ts`, add the imports:

```ts
import { originFrom } from "@/lib/email/origin";
import { emailBrand } from "@/lib/email/templates/shell";
import { leadAlertEmail } from "@/lib/email/templates/lead-alert";
```

Thread the origin from the action that already holds the headers (`const h = await headers()` at line 121) into `enrich`:

```ts
      await enrich(db, form, submissionId, answers, base.attribution, originFrom(h));
```

Widen `enrich`'s signature:

```ts
  attribution: Record<string, string>,
  /** Absolute origin for links in the alert, or null when the request carried
   *  no host. Threaded from the action because headers() is only available
   *  there, not in this helper. */
  origin: string | null,
): Promise<void> {
```

Pass it on to `notify`:

```ts
    await notify(db, form, contactId, answers, byKind.get("core.email") ?? "", origin);
```

Widen `notify`'s signature with `origin: string | null`, widen its account read, and build the email:

```ts
  const { data: account } = await db.from("accounts")
    .select("name, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", form.account_id).maybeSingle();

  const brand = emailBrand({
    brandName: account?.brand_name ?? null,
    brandLogoPath: account?.brand_logo_path ?? null,
    brandColor: account?.brand_color ?? null,
    brandNeutral: account?.brand_neutral ?? null,
    brandCorners: account?.brand_corners ?? null,
    brandType: account?.brand_type ?? null,
    brandMode: account?.brand_mode ?? null,
    replyToEmail: null,
  }, account?.name ?? "BIS");

  const { html, text } = leadAlertEmail({
    brand,
    formName: form.name,
    answers: answers.filter((a) => a.value).map((a) => ({ label: a.label, value: a.value })),
    // Absolute or nothing. A relative path here is the defect this replaces.
    contactUrl: origin && contactId
      ? `${origin}/dashboard/accounts/${form.account_id}/contacts/${contactId}`
      : null,
  });
```

Replace the old `body` construction and the send:

```ts
      await provider.send({
        to, fromName: brand.name,
        subject: `New lead: ${form.name}`,
        body: text, html,
        replyTo: normalizeReplyTo(leadEmail),
      });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run "src/app/f/[publicId]/actions.test.ts"`
Expected: PASS, the whole file.

- [ ] **Step 5: Mutation-check the link**

Change `contactUrl` to the old relative form (`/dashboard/accounts/...` with no origin) and re-run: the absolute-link test must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/f/[publicId]/actions.ts" "apps/web/src/app/f/[publicId]/actions.test.ts"
git commit -m "feat(forms): send the branded lead alert, with a working dashboard link"
```

---

### Task 6: The outbound email — restrained, and no internal label

**Files:**
- Create: `apps/web/src/lib/email/templates/outbound.ts`
- Create: `apps/web/src/lib/email/templates/outbound.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts`

**Interfaces:**
- Consumes: `shell`, `escapeHtml`, `emailBrand` from Task 3
- Produces: `outboundEmail({ brand, body }): { html: string; text: string }`

- [ ] **Step 1: Write the failing template test**

Create `apps/web/src/lib/email/templates/outbound.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { outboundEmail } from "./outbound";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" }, "Acme");

describe("outboundEmail", () => {
  // The operator typed this. Nothing may rewrite it.
  it("keeps the typed body verbatim in the text part", () => {
    const body = "Hi Maria,\n\nQuote attached.\n\nThanks";
    expect(outboundEmail({ brand, body }).text).toBe(body);
  });

  it("preserves line breaks in the html part", () => {
    const { html } = outboundEmail({ brand, body: "line one\nline two" });
    expect(html).toContain("line one<br />line two");
  });

  it("escapes markup a sender pasted in", () => {
    const { html } = outboundEmail({ brand, body: "<script>x</script>" });
    expect(html).not.toContain("<script>");
  });

  // Restraint is the design. No button, no footer, nothing that reads as a
  // campaign — this is a 1:1 message from a contractor to a customer.
  it("adds no button and no footer", () => {
    const { html } = outboundEmail({ brand, body: "hello" });
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run src/lib/email/templates/outbound.test.ts`
Expected: FAIL — cannot resolve `./outbound`.

- [ ] **Step 3: Implement the template**

Create `apps/web/src/lib/email/templates/outbound.ts`:

```ts
import { shell, escapeHtml, type EmailBrand } from "./shell";

/**
 * The message a client sends one of their contacts.
 *
 * Deliberately restrained: the operator's text, under a small brand header,
 * and nothing else. A heavily branded 1:1 email from a contractor reads as
 * marketing, which costs both trust and inbox placement — so there is no
 * button, no footer and no campaign chrome here, and that is a decision rather
 * than an omission.
 */
export function outboundEmail(input: { brand: EmailBrand; body: string }):
  { html: string; text: string } {
  const paragraphs = escapeHtml(input.body).replace(/\n/g, "<br />");
  return {
    html: shell(input.brand, `<div>${paragraphs}</div>`),
    // Byte-identical to what the operator typed.
    text: input.body,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/web && pnpm vitest run src/lib/email/templates/outbound.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing wiring test**

In `conversations/actions.test.ts`, the `accountRow` stub gains branding columns and the `@bis/db` mock gains `brandLogoUrl`. Then add:

```ts
describe("sendEmailAction — the customer sees the brand, never the internal label", () => {
  it("sends html and text and uses the brand name", async () => {
    accountRow.brand_name = "Rio Roofing";

    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    const sent = sendMock.mock.calls[0]![0];
    expect(sent.html).toContain("Rio Roofing");
    expect(sent.text).toBe("Quote attached");
    // accounts.name is "Rio Roofing — trial": the agency's private label.
    expect(sent.fromName).toBe("Rio Roofing");
  });

  it("falls back to the account name when no brand name is set", async () => {
    accountRow.brand_name = null;

    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    expect(sendMock.mock.calls[0]![0].fromName).toBe("Rio Roofing — trial");
  });
});
```

Set the stub's `name` to `"Rio Roofing — trial"` and add `brand_name: null` plus the other branding columns to `accountRow`, keeping the projecting `select()` mock from the reply-to work — it is what makes the widened select provable.

- [ ] **Step 6: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"`
Expected: FAIL — no `html`, and `fromName` is the internal label.

- [ ] **Step 7: Implement the wiring**

Widen the select and build the email:

```ts
  const { data: account } = await db.from("accounts")
    .select("name, reply_to_email, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", accountId).maybeSingle();

  const brand = emailBrand({
    brandName: account?.brand_name ?? null,
    brandLogoPath: account?.brand_logo_path ?? null,
    brandColor: account?.brand_color ?? null,
    brandNeutral: account?.brand_neutral ?? null,
    brandCorners: account?.brand_corners ?? null,
    brandType: account?.brand_type ?? null,
    brandMode: account?.brand_mode ?? null,
    replyToEmail: account?.reply_to_email ?? null,
  }, account?.name ?? "BIS");

  const { html, text } = outboundEmail({ brand, body });
```

And the send:

```ts
    ({ providerMessageId } = await getEmailProvider().send({
      to: contact.email,
      // The BRAND name. accounts.name is the agency's internal label and must
      // never reach a customer.
      fromName: brand.name,
      subject: subject || "(no subject)",
      body: text,
      html,
      replyTo: normalizeReplyTo(account?.reply_to_email),
    }));
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/email/templates/outbound.ts apps/web/src/lib/email/templates/outbound.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"
git commit -m "feat(conversations): brand the outbound email and stop leaking the internal label"
```

---

### Task 7: Look at both emails, then run every gate

**Files:**
- Temporary: a throwaway script that writes both templates' html to the scratchpad
- No production files change in this task

- [ ] **Step 1: Render both emails to disk and LOOK at them**

Every defect this project found in the last two sessions was found by looking, not by a gate. Email is worse than most surfaces for this: nothing renders it in CI, and a broken table looks fine in a string assertion.

Write a temporary script under `apps/web` that imports both templates, renders one branded and one unbranded example of each, and writes four `.html` files to the scratchpad. Open each in a browser (Playwright `page.goto("file://…")` then `screenshot`, or the Chrome extension) and check: the header reads as the company, the table aligns, the button is legible against its accent, and nothing overflows 560px.

Delete the script afterwards.

- [ ] **Step 2: Run every gate, with the command last**

```bash
pnpm check > /tmp/check.log 2>&1; echo "CHECK_EXIT=$?"
```
Expected: `CHECK_EXIT=0`, web test count up by roughly 20.

- [ ] **Step 3: Run the e2e suite**

Run: `cd apps/web && pnpm test:e2e`
Expected: 29 passed. Nothing here touches a browser surface, so a failure is either a straggler (re-run it alone) or a real regression in the submission path.

- [ ] **Step 4: Commit anything the look turned up**

```bash
git add -A
git commit -m "fix(email): <whatever looking at it revealed>"
```

---

## Self-review notes

- **Spec coverage.** §1 broken link → Tasks 2, 4, 5. §2 weighting → Tasks 4 and 6. §3 pure modules → Tasks 3–6. §4 resolver → Task 3 (+ its mutation check). §4.1 widened selects → Tasks 5 and 6. §5 both parts → Task 1 and every template. §6 origin → Task 2. §7 image blocking → Task 3. §8 testing → each task. §9 out of scope → nothing here touches domains, dark mode or locale.
- **Type consistency.** `EmailBrand` / `emailBrand` / `leadAlertEmail` / `outboundEmail` / `originFrom` / `shell` / `button` / `escapeHtml` are used with those exact names throughout; templates always return `{ html, text }`, and `SendEmailInput` takes `body` (text) plus optional `html`.
- **The mutations that matter:** the raw brand colour instead of the resolved accent (Task 3), and a relative contact path instead of an absolute one (Task 5). Both pass every other assertion in the suite.
- ⚠️ **Not covered by any gate:** whether a real client renders these. Litmus/Outlook behaviour is out of scope, which is exactly why Task 7 exists.
