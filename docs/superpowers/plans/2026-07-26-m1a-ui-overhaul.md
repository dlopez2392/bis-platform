# M1a CRM UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stock `create-next-app` styling across all seven M1a screens with a BIS-branded shadcn/ui design system, a two-level agency/account app shell, and a drag-and-drop pipeline board with inline opportunity editing.

**Architecture:** Tokens as CSS custom properties in `globals.css`, mapped into Tailwind v4 via `@theme inline`. shadcn/ui components copied into `apps/web/src/components/ui`. Server Components and server actions stay exactly as they are; only the pipeline board and opportunity drawer become client components, fed serialized props from server parents and mutating through server actions with `useOptimistic`.

**Tech Stack:** Next 16.2.11 (App Router), React 19.2.4, Tailwind v4, shadcn/ui + Radix, lucide-react, dnd-kit, next-themes, Clerk, Supabase, Vitest, Playwright.

## Global Constraints

- Package manager is **pnpm 10.13.1**; Node **>= 22**. Never use npm or yarn.
- `pnpm check` (typecheck + all package tests) must pass before every commit.
- The 18 existing tests in `packages/db/src/test/` must stay green. A break means unintended behavior change, not a test to update. The single sanctioned exception is Task 9's addition to `opportunities.test.ts`.
- `packages/db` tests need `SUPABASE_DB_URL` reachable (read from `packages/db/.env`). If tests error on connection, stop and report — do not skip them.
- Primary light `#7c3aed`, primary dark `#8b5cf6`, accent light `#0891b2`, accent dark `#22d3ee`. Copy these values exactly.
- Dark mode is a `.dark` class on `<html>`, never `prefers-color-scheme`.
- **No hardcoded user-facing strings in components.** Every visible string is a key in `src/lib/messages.ts`. This is enforced by review, not by tooling.
- Sidebar is dark slate in *both* themes. It does not invert.
- Do not add features. If it does not exist in M1a today, it is not in this plan.
- Do not create a `packages/ui` workspace package.
- Commit after every task using the exact message given in the task.

## Spec Deviations

Two corrections to `docs/superpowers/specs/2026-07-26-bis-platform-ui-overhaul-design.md`, both recorded here and amended in the spec:

1. **Opportunity drawer edits name, value, and status only — not owner.** `opportunities.assigned_to` exists in `0003_crm_core.sql:85` and references `public.users(id)`, but `@bis/db` exposes no user accessor and no screen creates users. An owner picker would require building user management, which §3 lists as a non-goal. Owner editing moves to M1b alongside real user records.
2. **`listBoard` gains a `stage.position` passthrough.** It already selects `position` (`opportunities.ts:11`) but the board needs it client-side to color columns by index. No query change, only a wider return type.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `apps/web/components.json` | shadcn CLI config |
| `apps/web/src/lib/utils.ts` | `cn()` class merger |
| `apps/web/src/lib/messages.ts` | All user-facing strings, one flat object |
| `apps/web/src/lib/format.ts` | `formatCurrency`, `formatDate`, `formatDateTime`, `contactDisplayName` |
| `apps/web/src/components/ui/*` | shadcn primitives (CLI-generated) |
| `apps/web/src/components/theme-provider.tsx` | `next-themes` wrapper |
| `apps/web/src/components/app-sidebar.tsx` | Sidebar chrome, nav, collapse |
| `apps/web/src/components/account-switcher.tsx` | Account list + navigation |
| `apps/web/src/components/topbar.tsx` | Clerk org switcher + user button |
| `apps/web/src/components/page-header.tsx` | Three-row header pattern |
| `apps/web/src/components/stat-tile.tsx` | Label / value / delta tile |
| `apps/web/src/components/empty-state.tsx` | Icon + title + body + optional action |
| `apps/web/src/components/tag-chips.tsx` | Tag badges with `+N` overflow |
| `apps/web/src/app/dashboard/accounts/create-account-dialog.tsx` | Account create form in a dialog |
| `apps/web/src/app/dashboard/accounts/[accountId]/contacts/contacts-table.tsx` | Sortable, paginated contacts table |
| `apps/web/src/app/dashboard/accounts/[accountId]/contacts/add-contact-dialog.tsx` | Contact create form in a dialog |
| `apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.tsx` | Left pane: fields + tags |
| `apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.tsx` | Center pane: notes/tasks/opps merged |
| `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/pipeline-board.tsx` | dnd-kit board, optimistic moves |
| `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/opportunity-drawer.tsx` | Inline edit drawer |
| `apps/web/playwright.config.ts` | Playwright config |
| `apps/web/e2e/{shell,contacts,pipeline}.spec.ts` | UI smoke specs |

**Modified**

| Path | Change |
|---|---|
| `apps/web/src/app/globals.css` | Full rewrite: token set, delete `color-scheme` block at `:29-50` |
| `apps/web/src/app/layout.tsx` | Add `ThemeProvider`, make Clerk theme mode-aware |
| `apps/web/src/app/dashboard/layout.tsx` | Sidebar + topbar shell, replacing the `max-w-5xl` container |
| `apps/web/src/app/dashboard/page.tsx` | Agency dashboard |
| `apps/web/src/app/dashboard/accounts/page.tsx` | Account cards grid |
| `apps/web/src/app/dashboard/accounts/[accountId]/layout.tsx` | Account-scoped nav context |
| `.../contacts/page.tsx` | `PageHeader` + `ContactsTable` |
| `.../contacts/[contactId]/page.tsx` | Three-pane layout |
| `.../pipeline/page.tsx` | Server shell for `PipelineBoard` |
| `.../pipeline/actions.ts` | `moveOppAction` takes `toStageId`; add `updateOpportunityAction` |
| `.../settings/page.tsx` | Sectioned cards |
| `packages/db/src/opportunities.ts` | Add `moveOpportunityToStage`, `updateOpportunity`; widen `listBoard` return |
| `packages/db/src/index.ts` | Export the two new functions |
| `packages/db/src/test/opportunities.test.ts` | Tests for the two new functions |
| `apps/web/package.json` | New dependencies + `test:e2e` script |

**Deleted**

- The `SubmitButton` usage in every screen is replaced by shadcn `Button` with `useFormStatus`. `apps/web/src/app/dashboard/accounts/submit-button.tsx` is kept — it already does the right thing — but is re-exported from `components/` in Task 3 so screens stop importing it through `../../../`.

---

## Task 1: Design tokens and theme infrastructure

**Files:**
- Modify: `apps/web/src/app/globals.css` (full rewrite, 45 lines → token set)
- Modify: `apps/web/src/app/layout.tsx:28-36`
- Create: `apps/web/src/components/theme-provider.tsx`
- Create: `apps/web/src/lib/utils.ts`

**Interfaces:**
- Consumes: nothing
- Produces: CSS variables `--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --success --warning --border --input --ring --radius --sidebar --sidebar-foreground --sidebar-accent --sidebar-border --stage-1 … --stage-6`; `cn(...inputs: ClassValue[]): string`; `<ThemeProvider>`.

- [ ] **Step 1: Install dependencies**

```bash
cd C:/Users/danlo/bis-platform
pnpm --filter web add class-variance-authority clsx tailwind-merge lucide-react next-themes
```

- [ ] **Step 2: Create `cn` helper**

Create `apps/web/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Rewrite `globals.css`**

Replace the entire contents of `apps/web/src/app/globals.css`. This deletes the `color-scheme` block at lines 29-50, which exists only because the app followed the OS theme.

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;

  --background: #f8f8fb;
  --foreground: #18181b;
  --card: #ffffff;
  --card-foreground: #18181b;
  --popover: #ffffff;
  --popover-foreground: #18181b;

  --primary: #7c3aed;
  --primary-foreground: #ffffff;
  --secondary: #f1f1f5;
  --secondary-foreground: #27272a;
  --muted: #f1f1f5;
  --muted-foreground: #6b7280;
  --accent: #0891b2;
  --accent-foreground: #ffffff;

  --destructive: #dc2626;
  --success: #16a34a;
  --warning: #d97706;

  --border: #e4e4e7;
  --input: #e4e4e7;
  --ring: #7c3aed;

  /* Sidebar is dark in both themes — it does not invert. */
  --sidebar: #1e1b2e;
  --sidebar-foreground: #d4d4d8;
  --sidebar-accent: #8b5cf6;
  --sidebar-border: #2e2a42;

  --stage-1: #8b5cf6;
  --stage-2: #0891b2;
  --stage-3: #2563eb;
  --stage-4: #0d9488;
  --stage-5: #16a34a;
  --stage-6: #d97706;
}

.dark {
  --background: #0f0f14;
  --foreground: #ededed;
  --card: #17171f;
  --card-foreground: #ededed;
  --popover: #17171f;
  --popover-foreground: #ededed;

  --primary: #8b5cf6;
  --primary-foreground: #ffffff;
  --secondary: #232330;
  --secondary-foreground: #ededed;
  --muted: #232330;
  --muted-foreground: #a1a1aa;
  --accent: #22d3ee;
  --accent-foreground: #0f0f14;

  --destructive: #ef4444;
  --success: #22c55e;
  --warning: #f59e0b;

  --border: #2a2a37;
  --input: #2a2a37;
  --ring: #8b5cf6;

  --sidebar: #131120;
  --sidebar-foreground: #d4d4d8;
  --sidebar-accent: #a78bfa;
  --sidebar-border: #262238;

  --stage-1: #a78bfa;
  --stage-2: #22d3ee;
  --stage-3: #60a5fa;
  --stage-4: #2dd4bf;
  --stage-5: #4ade80;
  --stage-6: #fbbf24;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-border: var(--sidebar-border);
  --color-stage-1: var(--stage-1);
  --color-stage-2: var(--stage-2);
  --color-stage-3: var(--stage-3);
  --color-stage-4: var(--stage-4);
  --color-stage-5: var(--stage-5);
  --color-stage-6: var(--stage-6);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), system-ui, sans-serif;
}
```

- [ ] **Step 4: Create the theme provider**

Create `apps/web/src/components/theme-provider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

`enableSystem={false}` is deliberate: light is the default per the spec, and the OS preference must not override it.

- [ ] **Step 5: Wire the provider into the root layout**

In `apps/web/src/app/layout.tsx`, replace the component body (lines 22-37). Note `suppressHydrationWarning` moves to `<html>` — `next-themes` writes the class there before React hydrates.

```tsx
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body suppressHydrationWarning className="min-h-full flex flex-col">
          <ThemeProvider>{children}</ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
```

Add the import at the top and remove the now-unused `dark` import from `@clerk/themes`:

```tsx
import { ThemeProvider } from "@/components/theme-provider";
```

Delete line 4 (`import { dark } from "@clerk/themes";`). Clerk re-themes in Task 3.

- [ ] **Step 6: Verify the app builds and renders light**

```bash
pnpm --filter web build
```

Expected: build succeeds, no TypeScript errors. Then:

```bash
pnpm --filter web dev
```

Open `http://localhost:3000/dashboard`. Expected: page renders on the near-white `#f8f8fb` canvas, not the old dark `#0a0a0a`. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/layout.tsx apps/web/src/components/theme-provider.tsx apps/web/src/lib/utils.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): BIS design tokens, light-first theme, class-based dark mode"
```

---

## Task 2: shadcn/ui base components

**Files:**
- Create: `apps/web/components.json`
- Create: `apps/web/src/components/ui/*.tsx` (CLI-generated)

**Interfaces:**
- Consumes: `cn()` from Task 1
- Produces: `Button`, `Input`, `Label`, `Select`, `Dialog`, `Sheet`, `DropdownMenu`, `Popover`, `Tabs`, `Table`, `Badge`, `Avatar`, `Card`, `Separator`, `Tooltip`, `Skeleton`, `Toaster`/`toast`, `Checkbox`, `Command` — all from `@/components/ui/<name>`.

- [ ] **Step 1: Initialize shadcn**

```bash
cd C:/Users/danlo/bis-platform/apps/web
pnpm dlx shadcn@latest init
```

Answer: style **new-york**, base color **neutral**, CSS variables **yes**. When it offers to overwrite `globals.css`, **decline** — Task 1's tokens are authoritative. If the CLI cannot skip it, let it write, then `git checkout apps/web/src/app/globals.css` and re-verify the file matches Task 1 exactly.

- [ ] **Step 2: Add the component set**

```bash
pnpm dlx shadcn@latest add button input label select dialog sheet dropdown-menu popover tabs table badge avatar card separator tooltip skeleton sonner checkbox command
```

- [ ] **Step 3: Typecheck**

```bash
cd C:/Users/danlo/bis-platform
pnpm --filter web exec tsc --noEmit
```

Expected: no errors. If a component fails against React 19 (most likely a `forwardRef` or `ElementRef` signature), fix it in place in `src/components/ui/` — these are your files now, not vendor code. Record any fix in the commit body.

- [ ] **Step 4: Mount the toaster**

In `apps/web/src/app/layout.tsx`, inside `<ThemeProvider>`, after `{children}`:

```tsx
<Toaster richColors position="bottom-right" />
```

Import: `import { Toaster } from "@/components/ui/sonner";`

- [ ] **Step 5: Verify build**

```bash
pnpm --filter web build
```

Expected: success.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components.json apps/web/src/components/ui apps/web/src/app/layout.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): add shadcn/ui base component set"
```

---

## Task 3: Strings, formatters, and shared primitives

**Files:**
- Create: `apps/web/src/lib/messages.ts`
- Create: `apps/web/src/lib/format.ts`
- Create: `apps/web/src/components/empty-state.tsx`
- Create: `apps/web/src/components/stat-tile.tsx`
- Create: `apps/web/src/components/tag-chips.tsx`
- Create: `apps/web/src/components/page-header.tsx`

**Interfaces:**
- Consumes: `cn()`, shadcn `Badge`/`Card`/`Button`/`Tabs`
- Produces:
  - `m: Record<string, string>` — the string catalog
  - `formatCurrency(n: number): string`, `formatDate(iso: string): string`, `formatDateTime(iso: string): string`, `contactDisplayName(c: { first_name: string | null; last_name: string | null }): string`
  - `<EmptyState icon title body action? />`
  - `<StatTile label value delta? />`
  - `<TagChips tags={{id,name}[]} max?={number} />`
  - `<PageHeader title tabs? selector? count? actions? filters? search? />`

- [ ] **Step 1: Create the string catalog**

Create `apps/web/src/lib/messages.ts`. One flat object, keys grouped by prefix. Add keys as later tasks need them; these are the ones the shell and shared components require.

```ts
export const m = {
  "nav.dashboard": "Dashboard",
  "nav.contacts": "Contacts",
  "nav.opportunities": "Opportunities",
  "nav.conversations": "Conversations",
  "nav.calendar": "Calendar",
  "nav.settings": "Settings",
  "nav.accounts": "Companies",

  "shell.switchAccount": "Switch company",
  "shell.searchAccounts": "Search companies…",
  "shell.noAccounts": "No companies yet",
  "shell.search": "Search",
  "shell.collapse": "Collapse sidebar",
  "shell.expand": "Expand sidebar",

  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.add": "Add",
  "common.import": "Import",
  "common.filters": "Filters",
  "common.sort": "Sort",
  "common.none": "—",
  "common.saving": "Saving…",

  "empty.conversations.title": "Conversations are coming in M1b",
  "empty.conversations.body": "Unified SMS and email threads will land here.",
  "empty.calendar.title": "Calendar is coming in M1b",
  "empty.calendar.body": "Booking and appointment management will land here.",
} as const;

export type MessageKey = keyof typeof m;
```

- [ ] **Step 2: Create formatters**

Create `apps/web/src/lib/format.ts`:

```ts
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCurrency(n: number): string {
  return currency.format(n);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function contactDisplayName(c: {
  first_name: string | null;
  last_name: string | null;
}): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
}
```

Fixed `en-US` locale is deliberate — it keeps SSR and client renders identical. Locale-aware formatting arrives with Spanish.

- [ ] **Step 3: Create `EmptyState`**

Create `apps/web/src/components/empty-state.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium text-foreground">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}
```

- [ ] **Step 4: Create `StatTile`**

Create `apps/web/src/components/stat-tile.tsx`:

```tsx
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down" };
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-card-foreground">{value}</p>
      {delta ? (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            delta.direction === "up" ? "text-success" : "text-destructive",
          )}
        >
          {delta.value}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Create `TagChips`**

Create `apps/web/src/components/tag-chips.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

export function TagChips({
  tags,
  max = 2,
}: {
  tags: { id: string; name: string }[];
  max?: number;
}) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <Badge key={t.id} variant="secondary" className="font-normal">
          {t.name}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="outline" className="font-normal">
          +{rest}
        </Badge>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Create `PageHeader`**

Create `apps/web/src/components/page-header.tsx`. This is the component every screen depends on — get the three-row structure exactly right.

```tsx
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  tabs,
  selector,
  count,
  actions,
  filters,
  search,
  className,
}: {
  title: string;
  tabs?: React.ReactNode;
  selector?: React.ReactNode;
  count?: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  search?: React.ReactNode;
  className?: string;
}) {
  const hasRow2 = Boolean(selector || count || actions);
  const hasRow3 = Boolean(filters || search);
  return (
    <div className={cn("border-b border-border bg-card", className)}>
      <div className="flex items-center gap-6 px-6 pt-5">
        <h1 className="text-xl font-semibold tracking-tight text-card-foreground">{title}</h1>
        {tabs}
      </div>

      {hasRow2 ? (
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          {selector}
          {count ? (
            <Badge variant="secondary" className="font-normal">
              {count}
            </Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      ) : (
        <div className="h-5" />
      )}

      {hasRow3 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
          {filters}
          <div className="ml-auto">{search}</div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/lib/format.ts apps/web/src/components/empty-state.tsx apps/web/src/components/stat-tile.tsx apps/web/src/components/tag-chips.tsx apps/web/src/components/page-header.tsx
git commit -m "feat(ui): string catalog, formatters, and shared primitives"
```

---

## Task 4: App shell — sidebar, account switcher, topbar

**Files:**
- Create: `apps/web/src/components/account-switcher.tsx`
- Create: `apps/web/src/components/app-sidebar.tsx`
- Create: `apps/web/src/components/topbar.tsx`
- Modify: `apps/web/src/app/dashboard/layout.tsx` (full rewrite, 21 lines)

**Interfaces:**
- Consumes: `m`, `initials()`, shadcn `Command`/`Popover`/`Avatar`/`Button`/`Tooltip`, `listAccounts` from `@bis/db`
- Produces:
  - `type AccountOption = { id: string; name: string; timezone: string }`
  - `<AccountSwitcher accounts activeAccountId? collapsed />`
  - `<AppSidebar accounts activeAccountId? collapsed />`
  - `<Topbar />`

- [ ] **Step 1: Create the account switcher**

Create `apps/web/src/components/account-switcher.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

export type AccountOption = { id: string; name: string; timezone: string };

export function AccountSwitcher({
  accounts,
  activeAccountId,
  collapsed,
}: {
  accounts: AccountOption[];
  activeAccountId?: string;
  collapsed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const active = accounts.find((a) => a.id === activeAccountId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={m["shell.switchAccount"]}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-sidebar-border px-2 py-2 text-left text-sidebar-foreground transition-colors hover:bg-white/5",
          collapsed && "justify-center px-0",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded bg-sidebar-accent/20 text-sidebar-accent">
          <Building2 className="size-4" aria-hidden />
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {active?.name ?? m["shell.switchAccount"]}
              </span>
              <span className="block truncate text-xs text-sidebar-foreground/60">
                {active?.timezone ?? ""}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={m["shell.searchAccounts"]} />
          <CommandList>
            <CommandEmpty>{m["shell.noAccounts"]}</CommandEmpty>
            <CommandGroup>
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={a.name}
                  onSelect={() => {
                    setOpen(false);
                    router.push(`/dashboard/accounts/${a.id}/contacts`);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      a.id === activeAccountId ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{a.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Create the sidebar**

Create `apps/web/src/components/app-sidebar.tsx`. Collapse state is a cookie so the server render matches — `localStorage` would flash.

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  MessagesSquare,
  Calendar,
  Settings,
  Building2,
  PanelLeftClose,
  PanelLeft,
  type LucideIcon,
} from "lucide-react";
import { AccountSwitcher, type AccountOption } from "@/components/account-switcher";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

type NavItem = { href: string; label: string; icon: LucideIcon };

export function AppSidebar({
  accounts,
  activeAccountId,
  defaultCollapsed,
}: {
  accounts: AccountOption[];
  activeAccountId?: string;
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const pathname = usePathname();

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sidebar_collapsed=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const base = activeAccountId ? `/dashboard/accounts/${activeAccountId}` : null;
  const items: NavItem[] = base
    ? [
        { href: `${base}/dashboard`, label: m["nav.dashboard"], icon: LayoutDashboard },
        { href: `${base}/contacts`, label: m["nav.contacts"], icon: Users },
        { href: `${base}/pipeline`, label: m["nav.opportunities"], icon: KanbanSquare },
        { href: `${base}/conversations`, label: m["nav.conversations"], icon: MessagesSquare },
        { href: `${base}/calendar`, label: m["nav.calendar"], icon: Calendar },
      ]
    : [{ href: "/dashboard/accounts", label: m["nav.accounts"], icon: Building2 }];

  const footer: NavItem = base
    ? { href: `${base}/settings`, label: m["nav.settings"], icon: Settings }
    : { href: "/dashboard", label: m["nav.dashboard"], icon: LayoutDashboard };

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col gap-3 bg-sidebar p-3 text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
        {collapsed ? null : (
          <Link href="/dashboard" className="px-1 text-sm font-semibold text-white">
            BIS
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? m["shell.expand"] : m["shell.collapse"]}
          className="rounded p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-white/5 hover:text-sidebar-foreground"
        >
          {collapsed ? (
            <PanelLeft className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </button>
      </div>

      <AccountSwitcher
        accounts={accounts}
        activeAccountId={activeAccountId}
        collapsed={collapsed}
      />

      <nav className="flex flex-1 flex-col gap-0.5">
        {items.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            active={pathname.startsWith(item.href)}
          />
        ))}
      </nav>

      <div className="border-t border-sidebar-border pt-2">
        <SidebarLink
          item={footer}
          collapsed={collapsed}
          active={pathname.startsWith(footer.href)}
        />
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-white/10 font-medium text-white"
          : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-sidebar-foreground",
      )}
    >
      {active ? (
        <span
          className="absolute left-0 h-5 w-0.5 rounded-r bg-sidebar-accent"
          aria-hidden
        />
      ) : null}
      <Icon className="size-4 shrink-0" aria-hidden />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}
```

- [ ] **Step 3: Create the topbar**

Create `apps/web/src/components/topbar.tsx`:

```tsx
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

export function Topbar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-card px-6">
      <OrganizationSwitcher hidePersonal />
      <UserButton />
    </header>
  );
}
```

- [ ] **Step 4: Rewrite the dashboard layout**

Replace `apps/web/src/app/dashboard/layout.tsx` entirely. The `max-w-5xl` container is gone — the shell is full-bleed.

```tsx
import { cookies } from "next/headers";
import { serviceDb, listAccounts } from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAgency();
  const [accounts, cookieStore] = await Promise.all([
    listAccounts(serviceDb()),
    cookies(),
  ]);
  const collapsed = cookieStore.get("sidebar_collapsed")?.value === "true";

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, timezone: a.timezone }))}
        defaultCollapsed={collapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
```

The account-scoped sidebar variant (which knows `activeAccountId`) arrives in Task 8; until then the sidebar shows the agency nav on every dashboard route.

- [ ] **Step 5: Verify**

```bash
pnpm --filter web build
pnpm --filter web dev
```

Open `http://localhost:3000/dashboard/accounts`. Expected: dark slate sidebar on the left with a BIS mark, an account switcher listing your accounts, a topbar with the Clerk controls. Click the collapse button, reload — it stays collapsed. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/account-switcher.tsx apps/web/src/components/app-sidebar.tsx apps/web/src/components/topbar.tsx apps/web/src/app/dashboard/layout.tsx
git commit -m "feat(ui): two-level app shell with sidebar, account switcher, and topbar"
```

---

## Task 5: Accounts list

**Files:**
- Modify: `apps/web/src/app/dashboard/accounts/page.tsx` (full rewrite, 41 lines)
- Create: `apps/web/src/app/dashboard/accounts/create-account-dialog.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `EmptyState`, `formatDate`, `createClientAccount` from `./actions`, `listAccounts`
- Produces: nothing consumed downstream

- [ ] **Step 1: Add strings**

Append to `apps/web/src/lib/messages.ts` inside the object:

```ts
  "accounts.title": "Companies",
  "accounts.add": "Add company",
  "accounts.name": "Business name",
  "accounts.timezone": "Timezone",
  "accounts.empty.title": "No companies yet",
  "accounts.empty.body": "Add your first company to start tracking contacts and deals.",
  "accounts.created": "Added {date}",
```

- [ ] **Step 2: Create the dialog**

Create `apps/web/src/app/dashboard/accounts/create-account-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { m } from "@/lib/messages";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : m["common.save"]}
    </Button>
  );
}

export function CreateAccountDialog({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          {m["accounts.add"]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m["accounts.add"]}</DialogTitle>
        </DialogHeader>
        <form
          action={async (formData) => {
            await action(formData);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">{m["accounts.name"]}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">{m["accounts.timezone"]}</Label>
            <Input id="timezone" name="timezone" defaultValue="America/Chicago" />
          </div>
          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Rewrite the page**

Replace `apps/web/src/app/dashboard/accounts/page.tsx`:

```tsx
import Link from "next/link";
import { Building2 } from "lucide-react";
import { serviceDb, listAccounts } from "@bis/db";
import { createClientAccount } from "./actions";
import { CreateAccountDialog } from "./create-account-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await listAccounts(serviceDb());
  return (
    <>
      <PageHeader
        title={m["accounts.title"]}
        count={`${accounts.length}`}
        actions={<CreateAccountDialog action={createClientAccount} />}
      />
      <div className="p-6">
        {accounts.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={m["accounts.empty.title"]}
            body={m["accounts.empty.body"]}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/dashboard/accounts/${a.id}/contacts`}
                  className="block rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Building2 className="size-4" aria-hidden />
                    </span>
                    <Badge variant={a.status === "active" ? "secondary" : "outline"}>
                      {a.status}
                    </Badge>
                  </div>
                  <p className="mt-4 truncate font-medium text-card-foreground">{a.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{a.timezone}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {m["accounts.created"].replace("{date}", formatDate(a.created_at))}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Verify**

```bash
pnpm --filter web build
```

Expected: success. Run `pnpm --filter web dev`, open `/dashboard/accounts`. Expected: company cards in a grid, "Add company" opens a dialog, creating one closes the dialog and the card appears.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/accounts/page.tsx apps/web/src/app/dashboard/accounts/create-account-dialog.tsx apps/web/src/lib/messages.ts
git commit -m "feat(ui): rebuild accounts list as company cards"
```

---

## Task 6: Agency dashboard

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx` (8 lines → full page)

**Interfaces:**
- Consumes: `PageHeader`, `StatTile`, `formatCurrency`, `listAccounts`, `serviceDb`
- Produces: nothing consumed downstream

- [ ] **Step 1: Add strings**

Append to `apps/web/src/lib/messages.ts`:

```ts
  "dashboard.title": "Dashboard",
  "dashboard.companies": "Companies",
  "dashboard.contacts": "Contacts",
  "dashboard.openOpps": "Open opportunities",
  "dashboard.pipelineValue": "Pipeline value",
```

- [ ] **Step 2: Rewrite the page**

Replace `apps/web/src/app/dashboard/page.tsx`. The counts come from direct aggregate queries — there is no cross-account helper in `@bis/db` and adding one is out of scope.

```tsx
import { serviceDb, listAccounts } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = serviceDb();
  const [accounts, contactCount, openOpps] = await Promise.all([
    listAccounts(db),
    db.from("contacts").select("id", { count: "exact", head: true }),
    db.from("opportunities").select("monetary_value").eq("status", "open"),
  ]);

  const opps = openOpps.data ?? [];
  const pipelineValue = opps.reduce((sum, o) => sum + Number(o.monetary_value), 0);

  return (
    <>
      <PageHeader title={m["dashboard.title"]} />
      <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={m["dashboard.companies"]} value={String(accounts.length)} />
        <StatTile label={m["dashboard.contacts"]} value={String(contactCount.count ?? 0)} />
        <StatTile label={m["dashboard.openOpps"]} value={String(opps.length)} />
        <StatTile label={m["dashboard.pipelineValue"]} value={formatCurrency(pipelineValue)} />
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify**

```bash
pnpm --filter web build
```

Expected: success. In dev, `/dashboard` shows four tiles with real numbers.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx apps/web/src/lib/messages.ts
git commit -m "feat(ui): agency dashboard with cross-account stat tiles"
```

---

## Task 7: Account workspace layout and placeholder routes

**Files:**
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/layout.tsx` (full rewrite, 28 lines)
- Modify: `apps/web/src/app/dashboard/layout.tsx` (pass `activeAccountId`)
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/conversations/page.tsx`
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/calendar/page.tsx`
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/dashboard/page.tsx`

**Interfaces:**
- Consumes: `EmptyState`, `PageHeader`, `StatTile`, `requireAgency`, `serviceDb`
- Produces: the account-scoped sidebar state — every account route now renders the six-item nav

- [ ] **Step 1: Derive `activeAccountId` in the dashboard layout**

The sidebar is a client component and already has `usePathname`. Rather than threading a prop through the server layout, derive it there. In `apps/web/src/components/app-sidebar.tsx`, replace the `base` derivation:

```tsx
  const match = pathname.match(/^\/dashboard\/accounts\/([^/]+)/);
  const activeAccountId = match?.[1];
  const base = activeAccountId ? `/dashboard/accounts/${activeAccountId}` : null;
```

Then remove `activeAccountId` from `AppSidebar`'s props and pass the derived value to `AccountSwitcher`. The prop stays on `AccountSwitcher`.

Updated `AppSidebar` signature:

```tsx
export function AppSidebar({
  accounts,
  defaultCollapsed,
}: {
  accounts: AccountOption[];
  defaultCollapsed: boolean;
}) {
```

No change is needed in `dashboard/layout.tsx` — it never passed `activeAccountId`.

- [ ] **Step 2: Rewrite the account layout**

Replace `apps/web/src/app/dashboard/accounts/[accountId]/layout.tsx`. The nav moved to the sidebar, so this layout only guards access and supplies the account name.

```tsx
import { notFound } from "next/navigation";
import { serviceDb } from "@bis/db";
import { requireAgency } from "@/lib/auth";

export default async function AccountWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  await requireAgency();
  const { accountId } = await params;
  const { data: account } = await serviceDb()
    .from("accounts")
    .select("id, name")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) notFound();
  return <>{children}</>;
}
```

- [ ] **Step 3: Add strings**

Append to `apps/web/src/lib/messages.ts`:

```ts
  "account.dashboard.title": "Dashboard",
  "account.contacts": "Contacts",
  "account.openOpps": "Open opportunities",
  "account.pipelineValue": "Pipeline value",
```

- [ ] **Step 4: Create the Conversations placeholder**

Create `apps/web/src/app/dashboard/accounts/[accountId]/conversations/page.tsx`:

```tsx
import { MessagesSquare } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { m } from "@/lib/messages";

export default function ConversationsPage() {
  return (
    <>
      <PageHeader title={m["nav.conversations"]} />
      <div className="p-6">
        <EmptyState
          icon={MessagesSquare}
          title={m["empty.conversations.title"]}
          body={m["empty.conversations.body"]}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Create the Calendar placeholder**

Create `apps/web/src/app/dashboard/accounts/[accountId]/calendar/page.tsx`:

```tsx
import { Calendar } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { m } from "@/lib/messages";

export default function CalendarPage() {
  return (
    <>
      <PageHeader title={m["nav.calendar"]} />
      <div className="p-6">
        <EmptyState
          icon={Calendar}
          title={m["empty.calendar.title"]}
          body={m["empty.calendar.body"]}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 6: Create the account dashboard**

Create `apps/web/src/app/dashboard/accounts/[accountId]/dashboard/page.tsx`. Account-scoped figures only — never agency-wide, per spec §2.

```tsx
import { serviceDb } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function AccountDashboardPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const db = serviceDb();
  const [contacts, opps] = await Promise.all([
    db.from("contacts").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    db
      .from("opportunities")
      .select("monetary_value")
      .eq("account_id", accountId)
      .eq("status", "open"),
  ]);

  const open = opps.data ?? [];
  const value = open.reduce((sum, o) => sum + Number(o.monetary_value), 0);

  return (
    <>
      <PageHeader title={m["account.dashboard.title"]} />
      <div className="grid gap-4 p-6 sm:grid-cols-3">
        <StatTile label={m["account.contacts"]} value={String(contacts.count ?? 0)} />
        <StatTile label={m["account.openOpps"]} value={String(open.length)} />
        <StatTile label={m["account.pipelineValue"]} value={formatCurrency(value)} />
      </div>
    </>
  );
}
```

- [ ] **Step 7: Verify**

```bash
pnpm --filter web build
```

Expected: success. In dev, navigate into a company. Expected: sidebar switches to the six-item account nav, Conversations and Calendar show empty states, the account dashboard shows three tiles.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/dashboard/accounts/[accountId]/layout.tsx" "apps/web/src/app/dashboard/accounts/[accountId]/conversations" "apps/web/src/app/dashboard/accounts/[accountId]/calendar" "apps/web/src/app/dashboard/accounts/[accountId]/dashboard" apps/web/src/components/app-sidebar.tsx apps/web/src/lib/messages.ts
git commit -m "feat(ui): account workspace shell, dashboard, and M1b placeholders"
```

---

## Task 8: Contacts list

**Files:**
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/contacts/page.tsx` (full rewrite, 55 lines)
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/contacts/contacts-table.tsx`
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/contacts/add-contact-dialog.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `EmptyState`, `TagChips`, `formatDate`, `contactDisplayName`, `initials`, `listContacts`, `createContactAction`
- Produces: `type ContactRow` — the serialized contact shape the table renders

- [ ] **Step 1: Add strings**

Append to `apps/web/src/lib/messages.ts`:

```ts
  "contacts.title": "Contacts",
  "contacts.add": "Add contact",
  "contacts.search": "Search name, email, phone…",
  "contacts.col.name": "Contact name",
  "contacts.col.phone": "Phone",
  "contacts.col.email": "Email",
  "contacts.col.company": "Business name",
  "contacts.col.created": "Created",
  "contacts.empty.title": "No contacts yet",
  "contacts.empty.body": "Add a contact or import a list to get started.",
  "contacts.noMatches.title": "No matches",
  "contacts.noMatches.body": "Try a different name, email, or phone number.",
  "contacts.firstName": "First name",
  "contacts.lastName": "Last name",
  "contacts.email": "Email",
  "contacts.phone": "Phone",
```

- [ ] **Step 2: Create the add-contact dialog**

Create `apps/web/src/app/dashboard/accounts/[accountId]/contacts/add-contact-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { m } from "@/lib/messages";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : m["common.save"]}
    </Button>
  );
}

export function AddContactDialog({
  accountId,
  action,
}: {
  accountId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          {m["contacts.add"]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m["contacts.add"]}</DialogTitle>
        </DialogHeader>
        <form
          action={async (formData) => {
            await action(formData);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="accountId" value={accountId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">{m["contacts.firstName"]}</Label>
              <Input id="firstName" name="firstName" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">{m["contacts.lastName"]}</Label>
              <Input id="lastName" name="lastName" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{m["contacts.email"]}</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{m["contacts.phone"]}</Label>
            <Input id="phone" name="phone" />
          </div>
          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create the contacts table**

Create `apps/web/src/app/dashboard/accounts/[accountId]/contacts/contacts-table.tsx`. Sorting and pagination are client-side over the already-fetched rows; `listContacts` caps at 100 and adding server-side paging is a data-layer change this plan does not make.

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpDown, Mail, Phone } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { contactDisplayName, formatDate, initials } from "@/lib/format";
import { m } from "@/lib/messages";

export type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  created_at: string;
};

type SortKey = "name" | "company" | "created";

const PAGE_SIZE = 20;

export function ContactsTable({ rows, base }: { rows: ContactRow[]; base: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created", dir: -1 });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const value = (r: ContactRow) =>
      sort.key === "name"
        ? contactDisplayName(r).toLowerCase()
        : sort.key === "company"
          ? (r.company_name ?? "").toLowerCase()
          : r.created_at;
    return [...rows].sort((a, b) => (value(a) < value(b) ? -sort.dir : value(a) > value(b) ? sort.dir : 0));
  }, [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>
              <SortButton label={m["contacts.col.name"]} onClick={() => toggleSort("name")} />
            </TableHead>
            <TableHead>{m["contacts.col.phone"]}</TableHead>
            <TableHead>{m["contacts.col.email"]}</TableHead>
            <TableHead>
              <SortButton label={m["contacts.col.company"]} onClick={() => toggleSort("company")} />
            </TableHead>
            <TableHead>
              <SortButton label={m["contacts.col.created"]} onClick={() => toggleSort("created")} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((c) => {
            const name = contactDisplayName(c);
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggleRow(c.id)}
                    aria-label={name}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`${base}/${c.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                      {initials(name)}
                    </span>
                    <span className="truncate">{name}</span>
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {c.phone ? (
                    <span className="flex items-center gap-1.5">
                      <Phone className="size-3.5" aria-hidden />
                      {c.phone}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {c.email ? (
                    <span className="flex items-center gap-1.5">
                      <Mail className="size-3.5" aria-hidden />
                      <span className="truncate">{c.email}</span>
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{c.company_name}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(c.created_at)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <span>
          Page {current + 1} of {pageCount}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function SortButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 font-medium hover:text-foreground"
    >
      {label}
      <ArrowUpDown className="size-3" aria-hidden />
    </button>
  );
}
```

The pagination strings "Page X of Y", "Prev", "Next" are the one sanctioned exception to the no-hardcoded-strings rule in this task — add them to `messages.ts` as `contacts.page`, `common.prev`, `common.next` and reference them instead. Do this before committing.

- [ ] **Step 4: Rewrite the page**

Replace `apps/web/src/app/dashboard/accounts/[accountId]/contacts/page.tsx`:

```tsx
import { Users } from "lucide-react";
import { serviceDb, listContacts } from "@bis/db";
import { createContactAction } from "./actions";
import { ContactsTable } from "./contacts-table";
import { AddContactDialog } from "./add-contact-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { accountId } = await params;
  const { q } = await searchParams;
  const contacts = await listContacts(serviceDb(), accountId, { search: q });
  const base = `/dashboard/accounts/${accountId}/contacts`;

  return (
    <>
      <PageHeader
        title={m["contacts.title"]}
        count={`${contacts.length}`}
        actions={<AddContactDialog accountId={accountId} action={createContactAction} />}
        search={
          <form action={base}>
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder={m["contacts.search"]}
              className="w-72"
            />
          </form>
        }
      />
      <div className="p-6">
        {contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? m["contacts.noMatches.title"] : m["contacts.empty.title"]}
            body={q ? m["contacts.noMatches.body"] : m["contacts.empty.body"]}
          />
        ) : (
          <ContactsTable rows={contacts} base={base} />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter web build
```

Expected: success. In dev, `/dashboard/accounts/<id>/contacts` shows a bordered table with avatars, icon-prefixed phone/email, sortable headers, and a pagination footer. Search still works. Adding a contact closes the dialog and the row appears.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/dashboard/accounts/[accountId]/contacts" apps/web/src/lib/messages.ts
git commit -m "feat(ui): rebuild contacts list as a sortable data table"
```

---

## Task 9: Data layer — stage-targeted moves and opportunity updates

**Files:**
- Modify: `packages/db/src/opportunities.ts:33-51` (add two functions, widen `listBoard`)
- Modify: `packages/db/src/index.ts:9-10`
- Modify: `packages/db/src/test/opportunities.test.ts`

**Interfaces:**
- Consumes: existing `emit`, `stagesOf` helpers in `opportunities.ts`
- Produces:
  - `moveOpportunityToStage(db, accountId, oppId, toStageId, actorId): Promise<void>`
  - `updateOpportunity(db, accountId, oppId, input: { name?: string; value?: number; status?: "open" | "won" | "lost" }, actorId): Promise<void>`
  - `listBoard` return item gains `stage.position: number` (already selected, now typed)

`moveOpportunityStage` (direction-based) stays exported — nothing else calls it after Task 10, but removing a public export is a breaking change this plan does not need to make.

- [ ] **Step 1: Write the failing tests**

Read `packages/db/src/test/opportunities.test.ts` first to match its existing fixture style. Append these two tests, adapting the fixture calls to whatever the file already uses:

```ts
it("moves an opportunity to an explicit stage", async () => {
  await withRollback(async (c) => {
    const { accountId, contactId, pipelineId, stages, userId } = await seedPipeline(c);
    const db = clientFor(c);
    const { id } = await createOpportunity(
      db, accountId, { contactId, pipelineId, name: "Deal", value: 100 }, userId,
    );

    await moveOpportunityToStage(db, accountId, id, stages[2]!.id, userId);

    const { rows } = await c.query(
      "select stage_id from opportunities where id = $1", [id],
    );
    expect(rows[0].stage_id).toBe(stages[2]!.id);
  });
});

it("updates name, value, and status together", async () => {
  await withRollback(async (c) => {
    const { accountId, contactId, pipelineId, userId } = await seedPipeline(c);
    const db = clientFor(c);
    const { id } = await createOpportunity(
      db, accountId, { contactId, pipelineId, name: "Old", value: 100 }, userId,
    );

    await updateOpportunity(
      db, accountId, id, { name: "New", value: 250, status: "won" }, userId,
    );

    const { rows } = await c.query(
      "select name, monetary_value, status from opportunities where id = $1", [id],
    );
    expect(rows[0].name).toBe("New");
    expect(Number(rows[0].monetary_value)).toBe(250);
    expect(rows[0].status).toBe("won");
  });
});
```

Add `moveOpportunityToStage` and `updateOpportunity` to the file's import from `../opportunities`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd C:/Users/danlo/bis-platform
pnpm --filter @bis/db test
```

Expected: FAIL — `moveOpportunityToStage is not a function` and `updateOpportunity is not a function`. If instead it fails on a database connection error, stop: `SUPABASE_DB_URL` in `packages/db/.env` is not reachable.

- [ ] **Step 3: Implement both functions**

Append to `packages/db/src/opportunities.ts`:

```ts
export async function moveOpportunityToStage(
  db: SupabaseClient, accountId: string, oppId: string,
  toStageId: string, actorId: string,
): Promise<void> {
  const { data: opp, error } = await db.from("opportunities")
    .select("id, pipeline_id, stage_id").eq("account_id", accountId).eq("id", oppId).single();
  if (error || !opp) throw new Error(`opportunity not found: ${error?.message}`);
  if (opp.stage_id === toStageId) return;
  const stages = await stagesOf(db, accountId, opp.pipeline_id);
  if (!stages.some(s => s.id === toStageId)) throw new Error("stage not in pipeline");
  const { error: uErr } = await db.from("opportunities")
    .update({ stage_id: toStageId, stage_changed_at: new Date().toISOString(),
              updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", oppId);
  if (uErr) throw new Error(uErr.message);
  await emit(db, accountId, "opportunity.stage_changed", actorId,
    { opportunityId: oppId, from: opp.stage_id, to: toStageId });
}

export async function updateOpportunity(
  db: SupabaseClient, accountId: string, oppId: string,
  input: { name?: string; value?: number; status?: "open" | "won" | "lost" },
  actorId: string,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) row.name = input.name;
  if (input.value !== undefined) row.monetary_value = input.value;
  if (input.status !== undefined) {
    row.status = input.status;
    row.status_changed_at = new Date().toISOString();
  }
  const { error } = await db.from("opportunities")
    .update(row).eq("account_id", accountId).eq("id", oppId);
  if (error) throw new Error(error.message);
  await emit(db, accountId, "opportunity.updated", actorId,
    { opportunityId: oppId, fields: Object.keys(input) });
}
```

The `stage not in pipeline` guard matters: `toStageId` arrives from a client drag and must not be trusted to belong to this account's pipeline.

- [ ] **Step 4: Export them**

In `packages/db/src/index.ts`, replace lines 9-10:

```ts
export { createOpportunity, moveOpportunityStage, moveOpportunityToStage,
         updateOpportunity, setOpportunityStatus,
         listBoard, listContactOpportunities } from "./opportunities";
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @bis/db test
```

Expected: PASS — 20 tests (18 existing + 2 new), zero failures.

- [ ] **Step 6: Run the full check**

```bash
pnpm check
```

Expected: typecheck clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/opportunities.ts packages/db/src/index.ts packages/db/src/test/opportunities.test.ts
git commit -m "feat(db): stage-targeted opportunity moves and field updates"
```

---

## Task 10: Pipeline board with drag-and-drop

**Files:**
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/actions.ts:25-31`
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/page.tsx` (full rewrite, 82 lines)
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/pipeline-board.tsx`

**Interfaces:**
- Consumes: `moveOpportunityToStage`, `listBoard`, `ensureDefaultPipeline`, `listContacts`, `PageHeader`, `formatCurrency`, `contactDisplayName`
- Produces:
  - `moveOppToStageAction(formData: FormData): Promise<void>` — expects `accountId`, `oppId`, `toStageId`
  - `type BoardColumn = { stage: { id: string; name: string; position: number }; totalValue: number; opportunities: BoardOpportunity[] }`
  - `type BoardOpportunity = { id: string; name: string; monetary_value: number; status: string; contact: { id: string; first_name: string | null; last_name: string | null } }`

- [ ] **Step 1: Install dnd-kit**

```bash
cd C:/Users/danlo/bis-platform
pnpm --filter web add @dnd-kit/core @dnd-kit/sortable
```

- [ ] **Step 2: Replace `moveOppAction`**

In `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/actions.ts`, replace lines 25-31 with a stage-targeted action. Update the import on line 5 to pull `moveOpportunityToStage` and `updateOpportunity` instead of `moveOpportunityStage`.

```ts
export async function moveOppToStageAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, path } = base(formData);
  const oppId = String(formData.get("oppId") ?? "");
  const toStageId = String(formData.get("toStageId") ?? "");
  if (!oppId || !toStageId) throw new Error("oppId and toStageId required");
  await moveOpportunityToStage(serviceDb(), accountId, oppId, toStageId, userId);
  revalidatePath(path);
}

export async function updateOpportunityAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, path } = base(formData);
  const oppId = String(formData.get("oppId") ?? "");
  if (!oppId) throw new Error("oppId required");
  const status = String(formData.get("status") ?? "");
  if (status && status !== "open" && status !== "won" && status !== "lost") {
    throw new Error("bad status");
  }
  const rawValue = formData.get("value");
  await updateOpportunity(
    serviceDb(),
    accountId,
    oppId,
    {
      name: String(formData.get("name") ?? "").trim() || undefined,
      value: rawValue === null || rawValue === "" ? undefined : Number(rawValue),
      status: (status || undefined) as "open" | "won" | "lost" | undefined,
    },
    userId,
  );
  revalidatePath(path);
}
```

Delete `setOppStatusAction` — the drawer replaces it and nothing else calls it.

- [ ] **Step 3: Create the board**

Create `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/pipeline-board.tsx`:

```tsx
"use client";

import { useOptimistic, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency, contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";

export type BoardOpportunity = {
  id: string;
  name: string;
  monetary_value: number;
  status: string;
  contact: { id: string; first_name: string | null; last_name: string | null };
};

export type BoardColumn = {
  stage: { id: string; name: string; position: number };
  totalValue: number;
  opportunities: BoardOpportunity[];
};

const STAGE_BAR = [
  "bg-stage-1",
  "bg-stage-2",
  "bg-stage-3",
  "bg-stage-4",
  "bg-stage-5",
  "bg-stage-6",
];

export function PipelineBoard({
  board,
  accountId,
  moveAction,
  onOpen,
}: {
  board: BoardColumn[];
  accountId: string;
  moveAction: (formData: FormData) => Promise<void>;
  onOpen?: (opp: BoardOpportunity) => void;
}) {
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<BoardOpportunity | null>(null);

  const [optimistic, applyMove] = useOptimistic(
    board,
    (state: BoardColumn[], move: { oppId: string; toStageId: string }) => {
      let moved: BoardOpportunity | undefined;
      const stripped = state.map((col) => {
        const found = col.opportunities.find((o) => o.id === move.oppId);
        if (!found) return col;
        moved = found;
        const rest = col.opportunities.filter((o) => o.id !== move.oppId);
        return {
          ...col,
          opportunities: rest,
          totalValue: rest.reduce((s, o) => s + o.monetary_value, 0),
        };
      });
      if (!moved) return state;
      return stripped.map((col) => {
        if (col.stage.id !== move.toStageId) return col;
        const next = [moved!, ...col.opportunities];
        return {
          ...col,
          opportunities: next,
          totalValue: next.reduce((s, o) => s + o.monetary_value, 0),
        };
      });
    },
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const oppId = String(event.active.id);
    const toStageId = event.over ? String(event.over.id) : null;
    if (!toStageId) return;
    const from = optimistic.find((c) => c.opportunities.some((o) => o.id === oppId));
    if (!from || from.stage.id === toStageId) return;

    startTransition(async () => {
      applyMove({ oppId, toStageId });
      const formData = new FormData();
      formData.set("accountId", accountId);
      formData.set("oppId", oppId);
      formData.set("toStageId", toStageId);
      try {
        await moveAction(formData);
      } catch {
        toast.error(m["pipeline.moveFailed"]);
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => {
        const id = String(e.active.id);
        const found = optimistic.flatMap((c) => c.opportunities).find((o) => o.id === id);
        setDragging(found ?? null);
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {optimistic.map((col, i) => (
          <Column key={col.stage.id} column={col} index={i} onOpen={onOpen} />
        ))}
      </div>
      <DragOverlay>
        {dragging ? <CardBody opp={dragging} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column,
  index,
  onOpen,
}: {
  column: BoardColumn;
  index: number;
  onOpen?: (opp: BoardOpportunity) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className={cn("h-1", STAGE_BAR[index % STAGE_BAR.length])} aria-hidden />
        <div className="px-4 py-3">
          <p className="font-medium text-card-foreground">{column.stage.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {column.opportunities.length} · {formatCurrency(column.totalValue)}
          </p>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-32 flex-col gap-2 rounded-lg p-1 transition-colors",
          isOver && "bg-primary/5 ring-1 ring-primary/30",
        )}
      >
        {column.opportunities.map((opp) => (
          <DraggableCard key={opp.id} opp={opp} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({
  opp,
  onOpen,
}: {
  opp: BoardOpportunity;
  onOpen?: (opp: BoardOpportunity) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: opp.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen?.(opp)}
      className={cn("cursor-grab text-left", isDragging && "opacity-40")}
      data-testid={`opp-${opp.id}`}
    >
      <CardBody opp={opp} />
    </div>
  );
}

function CardBody({ opp, dragging }: { opp: BoardOpportunity; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        dragging && "shadow-lg ring-1 ring-primary/40",
      )}
    >
      <p className="truncate font-medium text-card-foreground">{opp.name}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {contactDisplayName(opp.contact)}
      </p>
      <p className="mt-2 text-sm font-medium text-foreground">
        {formatCurrency(opp.monetary_value)}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Add strings**

Append to `apps/web/src/lib/messages.ts`:

```ts
  "pipeline.title": "Opportunities",
  "pipeline.add": "Add opportunity",
  "pipeline.moveFailed": "Could not move that opportunity. Refresh and try again.",
  "pipeline.empty.title": "No opportunities yet",
  "pipeline.empty.body": "Add your first deal to start tracking the pipeline.",
  "pipeline.name": "Opportunity name",
  "pipeline.value": "Value",
  "pipeline.contact": "Contact",
  "pipeline.status": "Status",
```

- [ ] **Step 5: Rewrite the page**

Replace `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/page.tsx`. The drawer wiring lands in Task 11; this task renders the board and proves drag works.

```tsx
import { serviceDb, ensureDefaultPipeline, listBoard } from "@bis/db";
import { moveOppToStageAction } from "./actions";
import { PipelineBoard } from "./pipeline-board";
import { PageHeader } from "@/components/page-header";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const db = serviceDb();
  const { pipelineId } = await ensureDefaultPipeline(db, accountId);
  const board = await listBoard(db, accountId, pipelineId);

  const total = board.reduce((s, c) => s + c.totalValue, 0);
  const count = board.reduce((s, c) => s + c.opportunities.length, 0);

  return (
    <>
      <PageHeader title={m["pipeline.title"]} count={`${count} · ${formatCurrency(total)}`} />
      <div className="p-6">
        <PipelineBoard board={board} accountId={accountId} moveAction={moveOppToStageAction} />
      </div>
    </>
  );
}
```

The create-opportunity form is dropped from this task and returns in Task 11's drawer work. Do not leave the screen without a way to add opportunities across both tasks — Task 11 restores it.

- [ ] **Step 6: Verify**

```bash
pnpm --filter web build
```

Expected: success. In dev, open the pipeline. Drag a card to another column — it moves immediately. Reload — it is still in the new column. This is the behavior Task 12's Playwright spec asserts.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/dashboard/accounts/[accountId]/pipeline" apps/web/src/lib/messages.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): drag-and-drop pipeline board with optimistic moves"
```

---

## Task 11: Opportunity drawer and create form

**Files:**
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/opportunity-drawer.tsx`
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/page.tsx`
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/pipeline-board.tsx` (wire `onOpen`)

**Interfaces:**
- Consumes: `updateOpportunityAction`, `createOpportunityAction`, `BoardOpportunity`, shadcn `Sheet`
- Produces: `<OpportunityDrawer accountId action />` with an imperative `open(opp)` exposed through a board-owned state hook

- [ ] **Step 1: Create the drawer**

Create `apps/web/src/app/dashboard/accounts/[accountId]/pipeline/opportunity-drawer.tsx`:

```tsx
"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BoardOpportunity } from "./pipeline-board";
import { m } from "@/lib/messages";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : m["common.save"]}
    </Button>
  );
}

export function OpportunityDrawer({
  accountId,
  opportunity,
  onClose,
  action,
}: {
  accountId: string;
  opportunity: BoardOpportunity | null;
  onClose: () => void;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <Sheet open={opportunity !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex flex-col gap-6">
        <SheetHeader>
          <SheetTitle>{opportunity?.name ?? ""}</SheetTitle>
        </SheetHeader>
        {opportunity ? (
          <form
            action={async (formData) => {
              await action(formData);
              onClose();
            }}
            className="flex flex-1 flex-col gap-4"
          >
            <input type="hidden" name="accountId" value={accountId} />
            <input type="hidden" name="oppId" value={opportunity.id} />
            <div className="space-y-2">
              <Label htmlFor="name">{m["pipeline.name"]}</Label>
              <Input id="name" name="name" defaultValue={opportunity.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">{m["pipeline.value"]}</Label>
              <Input
                id="value"
                name="value"
                type="number"
                step="0.01"
                defaultValue={opportunity.monetary_value}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">{m["pipeline.status"]}</Label>
              <Select name="status" defaultValue={opportunity.status}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">open</SelectItem>
                  <SelectItem value="won">won</SelectItem>
                  <SelectItem value="lost">lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SheetFooter className="mt-auto">
              <Submit />
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Own drawer state in the board**

In `pipeline-board.tsx`, add a `updateAction` prop and internal drawer state, replacing the `onOpen` prop:

```tsx
export function PipelineBoard({
  board,
  accountId,
  moveAction,
  updateAction,
}: {
  board: BoardColumn[];
  accountId: string;
  moveAction: (formData: FormData) => Promise<void>;
  updateAction: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState<BoardOpportunity | null>(null);
```

Pass `onOpen={setEditing}` down to `Column` and `DraggableCard` exactly as they already accept it, and render the drawer after `</DndContext>`:

```tsx
      <OpportunityDrawer
        accountId={accountId}
        opportunity={editing}
        onClose={() => setEditing(null)}
        action={updateAction}
      />
```

Wrap the `DndContext` and the drawer in a fragment. Import `OpportunityDrawer` at the top.

A card click fires `onOpen` only when the pointer did not travel — the `PointerSensor` `distance: 6` activation constraint already separates click from drag, so no extra guard is needed.

- [ ] **Step 3: Restore the create form**

In `pipeline/page.tsx`, add the create-opportunity dialog back to the header actions. Reuse the existing `createOpportunityAction`, which needs `accountId`, `pipelineId`, `contactId`, `name`, `value`. Fetch contacts for the picker:

```tsx
  const [board, contacts] = await Promise.all([
    listBoard(db, accountId, pipelineId),
    listContacts(db, accountId, { limit: 200 }),
  ]);
```

Add to `PageHeader`:

```tsx
        actions={
          <AddOpportunityDialog
            accountId={accountId}
            pipelineId={pipelineId}
            contacts={contacts.map((c) => ({ id: c.id, name: contactDisplayName(c) }))}
            action={createOpportunityAction}
          />
        }
```

Create `AddOpportunityDialog` in the same file pattern as `AddContactDialog` from Task 8 — a client component in `pipeline/add-opportunity-dialog.tsx` with fields for contact (Select), name (Input), and value (number Input), submitting `createOpportunityAction`. Include the `accountId` and `pipelineId` hidden inputs.

- [ ] **Step 4: Pass `updateAction` from the page**

```tsx
        <PipelineBoard
          board={board}
          accountId={accountId}
          moveAction={moveOppToStageAction}
          updateAction={updateOpportunityAction}
        />
```

Import `updateOpportunityAction` and `createOpportunityAction` from `./actions`, and `listContacts`, `contactDisplayName`.

- [ ] **Step 5: Verify**

```bash
pnpm --filter web build
```

Expected: success. In dev: clicking a card opens a right-side drawer; changing the value and saving closes it and the card shows the new amount; dragging still works and does not open the drawer.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/dashboard/accounts/[accountId]/pipeline"
git commit -m "feat(ui): opportunity drawer for inline editing and restored create flow"
```

---

## Task 12: Contact detail three-pane

**Files:**
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx` (full rewrite, 137 lines)
- Create: `.../[contactId]/contact-fields-panel.tsx`
- Create: `.../[contactId]/activity-timeline.tsx`

**Interfaces:**
- Consumes: every action already in `[contactId]/actions.ts` (`updateContactAction`, `addTagAction`, `removeTagAction`, `addNoteAction`, `addTaskAction`, `completeTaskAction`), `getContact`, `listContactTags`, `listNotes`, `listContactTasks`, `listCustomFields`, `listContactOpportunities`
- Produces: nothing consumed downstream

**Behavior must not change.** Every action, field, and custom-field data type handled by the current 137-line page must still work. This is a layout and styling change only.

- [ ] **Step 1: Add strings**

Append to `apps/web/src/lib/messages.ts`:

```ts
  "contact.details": "Contact Details",
  "contact.tags": "Tags",
  "contact.addTag": "add tag",
  "contact.opportunities": "Opportunities",
  "contact.activity": "Activity",
  "contact.notes": "Notes",
  "contact.tasks": "Tasks",
  "contact.addNote": "Add a note…",
  "contact.addTask": "New task…",
  "contact.done": "done",
  "contact.company": "Company",
  "contact.noActivity": "No activity yet",
  "contact.noActivityBody": "Notes, tasks, and deals will appear here.",
  "contact.noOpportunities": "None yet.",
```

- [ ] **Step 2: Create the fields panel**

Create `.../[contactId]/contact-fields-panel.tsx` as a server component. Move the existing edit form (current page lines 35-61) and the tags block (lines 62-80) into it verbatim, restyled: wrap in `Card`, replace raw `<input>` with shadcn `Input`, raw `<select>` with shadcn `Select`, and the tag remove buttons with `Badge`-styled buttons carrying an `X` icon. Preserve every `name` attribute exactly — the server actions read them by name, and renaming one silently breaks the save.

Props: `{ accountId, contactId, contact, tags, fieldDefs }`.

- [ ] **Step 3: Create the activity timeline**

Create `.../[contactId]/activity-timeline.tsx`. Merge notes, tasks, and opportunities into one time-ordered list, each with its own icon and a day separator, then pin the note composer to the bottom. Keep the task-complete and note-add forms intact with their existing field names.

Props: `{ accountId, contactId, notes, tasks, opportunities }`.

Merge shape:

```tsx
type TimelineItem =
  | { kind: "note"; id: string; at: string; body: string }
  | { kind: "task"; id: string; at: string; title: string; dueAt: string | null; completedAt: string | null }
  | { kind: "opportunity"; id: string; at: string; name: string; value: number; status: string };
```

Sort descending by `at`. Render an `EmptyState` with `contact.noActivity` when the merged list is empty.

- [ ] **Step 4: Rewrite the page as three panes**

Replace `.../[contactId]/page.tsx`. Keep the identical data fetching (current lines 13-24) and pass it down.

```tsx
  return (
    <>
      <PageHeader title={contactDisplayName(contact)} />
      <div className="grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)_280px]">
        <ContactFieldsPanel
          accountId={accountId}
          contactId={contactId}
          contact={contact}
          tags={tags}
          fieldDefs={fieldDefs}
        />
        <ActivityTimeline
          accountId={accountId}
          contactId={contactId}
          notes={notes}
          tasks={tasks}
          opportunities={opps}
        />
        <aside className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 text-sm font-medium text-card-foreground">
            {m["contact.opportunities"]}
          </p>
          {opps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m["contact.noOpportunities"]}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {opps.map((o) => (
                <li key={o.id} className="rounded-md border border-border p-2">
                  <p className="truncate font-medium">{o.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(Number(o.monetary_value))} · {o.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
```

Below `lg` the grid collapses to one column in source order: fields, timeline, opportunities.

- [ ] **Step 5: Verify behavior is unchanged**

```bash
pnpm --filter web build
```

Then in dev, on a contact with custom fields defined, confirm each of these still works: edit and save a standard field; edit and save a custom field of each type (text, number, date, checkbox, single_select); add a tag; remove a tag; add a note; add a task with a due date; complete a task. Any regression here means a `name` attribute was changed — fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]" apps/web/src/lib/messages.ts
git commit -m "feat(ui): contact detail three-pane layout"
```

---

## Task 13: CRM settings

**Files:**
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/settings/page.tsx` (full rewrite, 71 lines)

**Interfaces:**
- Consumes: `createFieldAction`, `upsertValueAction`, `listCustomFields`, `listCustomValues`, `PageHeader`, `EmptyState`
- Produces: nothing consumed downstream

- [ ] **Step 1: Add strings**

Append to `apps/web/src/lib/messages.ts`:

```ts
  "settings.title": "Settings",
  "settings.customFields": "Custom fields",
  "settings.customFieldsBody": "Extra fields captured on every contact.",
  "settings.customValues": "Custom values",
  "settings.customValuesBody": "Template variables, referenced as {{custom_values.key}} from M1c on.",
  "settings.fieldName": "Field name",
  "settings.fieldKey": "field_key",
  "settings.dataType": "Type",
  "settings.options": "Options, comma, separated",
  "settings.addField": "Add field",
  "settings.valueName": "Name",
  "settings.valueKey": "value_key",
  "settings.value": "Value",
  "settings.saveValue": "Save value",
  "settings.noFields": "No custom fields yet",
  "settings.noValues": "No custom values yet",
```

- [ ] **Step 2: Rewrite the page**

Replace the page with two `Card` sections in a two-column grid at `lg`. Keep both forms' field names exactly as they are (`name`, `fieldKey`, `dataType`, `options`, `valueKey`, `value`, and the `accountId` hidden input) — the actions read them by name. Replace raw inputs with shadcn `Input`/`Select`/`Button`, keep the `pattern="[a-z0-9_]+"` validation on both key fields, and render the existing lists as bordered rows with the key in a `<code>` styled with `font-mono text-xs text-muted-foreground`. Use `EmptyState` with `settings.noFields` / `settings.noValues` when a list is empty.

Header: `<PageHeader title={m["settings.title"]} />`.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web build
```

In dev, add a custom field of type `single_select` with options and confirm it appears on the contact detail form. Add a custom value and confirm it lists.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/dashboard/accounts/[accountId]/settings/page.tsx" apps/web/src/lib/messages.ts
git commit -m "feat(ui): sectioned CRM settings screen"
```

---

## Task 14: Playwright smoke specs

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/shell.spec.ts`
- Create: `apps/web/e2e/contacts.spec.ts`
- Create: `apps/web/e2e/pipeline.spec.ts`
- Modify: `apps/web/package.json` (add `test:e2e` script)

**Interfaces:**
- Consumes: the running app
- Produces: `pnpm --filter web test:e2e`

These specs require an authenticated session. Clerk sign-in is not scriptable without a test user and `CLERK_SECRET_KEY` testing tokens. Set that up with `@clerk/testing`'s `clerkSetup` and a storage-state file; if it cannot be configured in this environment, **stop and report** rather than deleting the assertions.

- [ ] **Step 1: Install Playwright**

```bash
cd C:/Users/danlo/bis-platform
pnpm --filter web add -D @playwright/test @clerk/testing
pnpm --filter web exec playwright install chromium
```

- [ ] **Step 2: Create the config**

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    storageState: "e2e/.auth/state.json",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

Add `apps/web/e2e/.auth/` to `.gitignore`.

- [ ] **Step 3: Write the shell spec**

Create `apps/web/e2e/shell.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("sidebar collapse persists across reload", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
});

test("account switcher navigates into a company", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("button", { name: "Switch company" }).click();
  const first = page.getByRole("option").first();
  await first.click();
  await expect(page).toHaveURL(/\/dashboard\/accounts\/[^/]+\/contacts/);
});
```

- [ ] **Step 4: Write the contacts spec**

Create `apps/web/e2e/contacts.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("contacts table renders and sorts", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link").filter({ hasText: /./ }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  const table = page.getByRole("table");
  await expect(table).toBeVisible();

  await page.getByRole("button", { name: /Contact name/ }).click();
  await expect(table).toBeVisible();
});
```

- [ ] **Step 5: Write the pipeline spec — the important one**

Create `apps/web/e2e/pipeline.spec.ts`. This is the test that catches an optimistic UI showing a move that never reached the database.

```ts
import { test, expect } from "@playwright/test";

test("dragging an opportunity persists after reload", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link").filter({ hasText: /./ }).first().click();
  await page.getByRole("link", { name: "Opportunities" }).click();
  await expect(page).toHaveURL(/\/pipeline$/);

  const card = page.locator('[data-testid^="opp-"]').first();
  await expect(card).toBeVisible();
  const cardId = await card.getAttribute("data-testid");

  const columns = page.locator("div.w-72");
  const targetColumn = columns.nth(1);

  await card.hover();
  await page.mouse.down();
  await targetColumn.hover();
  await page.mouse.up();

  await expect(targetColumn.locator(`[data-testid="${cardId}"]`)).toBeVisible();

  await page.reload();
  await expect(
    page.locator("div.w-72").nth(1).locator(`[data-testid="${cardId}"]`),
  ).toBeVisible();
});
```

- [ ] **Step 6: Add the script**

In `apps/web/package.json`, add to `scripts`:

```json
    "test:e2e": "playwright test"
```

- [ ] **Step 7: Run the specs**

```bash
pnpm --filter web test:e2e
```

Expected: 4 passed. If the drag test fails because dnd-kit needs intermediate pointer movement, add a `await page.mouse.move(x, y, { steps: 10 })` between `down()` and the target hover — dnd-kit's `PointerSensor` requires movement past the 6px activation distance before it registers a drag.

- [ ] **Step 8: Run the full check**

```bash
pnpm check
```

Expected: typecheck clean, 20 db tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/web/package.json apps/web/.gitignore pnpm-lock.yaml
git commit -m "test(ui): Playwright smoke specs for shell, contacts, and pipeline persistence"
```

---

## Task 15: Final sweep

**Files:**
- Modify: `apps/web/src/app/dashboard/accounts/submit-button.tsx` (delete if unreferenced)
- Modify: any file still importing it

- [ ] **Step 1: Find remaining references**

```bash
cd C:/Users/danlo/bis-platform
grep -rn "submit-button\|SubmitButton" apps/web/src
```

Expected after Tasks 5-13: no matches, because every form now uses shadcn `Button` with `useFormStatus`. If matches remain, replace them.

- [ ] **Step 2: Delete the orphan**

```bash
git rm apps/web/src/app/dashboard/accounts/submit-button.tsx
```

Only if Step 1 returned no matches.

- [ ] **Step 3: Scan for hardcoded strings**

```bash
grep -rnE '>[A-Z][a-z]+ [a-z]+' apps/web/src/app apps/web/src/components --include=*.tsx | grep -v "m\[" | grep -v "components/ui/"
```

Review each hit. Anything user-facing moves to `messages.ts`. Hits inside `components/ui/` are shadcn internals and are out of scope.

- [ ] **Step 4: Verify both themes**

Run `pnpm --filter web dev`. In the browser console, run `document.documentElement.classList.add('dark')` and walk all seven screens. Expected: sidebar stays dark slate, cards flip to `#17171f`, text stays legible, stage bars stay distinguishable. Then `document.documentElement.classList.remove('dark')` and confirm light is intact.

- [ ] **Step 5: Full check and build**

```bash
pnpm check
pnpm --filter web build
pnpm --filter web test:e2e
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(ui): remove orphaned SubmitButton and finish string extraction"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §4 Design tokens | 1 |
| §4 Delete `color-scheme` block | 1 |
| §5 Sidebar, account switcher, topbar | 4 |
| §5 `PageHeader` | 3 |
| §6.1 Agency dashboard | 6 |
| §6.2 Accounts list | 5 |
| §6.3 Account workspace layout | 7 |
| §6.4 Contacts list | 8 |
| §6.5 Contact detail three-pane | 12 |
| §6.6 Pipeline drag-and-drop | 9, 10 |
| §6.6 Inline card editing | 11 |
| §6.7 Settings | 13 |
| §7 Component inventory | 2, 3 |
| §8 `moveOppAction` target stage | 9, 10 |
| §9 i18n structural | 3, plus every screen task |
| §10 Dependencies | 1, 2, 10, 14 |
| §11 Testing | 9, 14 |
| Conversations/Calendar empty states | 7 |

Two spec items are deliberately not covered and are recorded in **Spec Deviations** above: owner editing in the drawer, and the `listBoard` return-type note.

**Type consistency checked:** `BoardColumn` / `BoardOpportunity` are defined in Task 10's `pipeline-board.tsx` and imported by Task 11's drawer. `AccountOption` is defined in Task 4's `account-switcher.tsx` and imported by `app-sidebar.tsx`. `ContactRow` is defined in Task 8's `contacts-table.tsx`. `moveOpportunityToStage` and `updateOpportunity` keep identical signatures across Tasks 9, 10, and 11. `m` keys referenced in later tasks are all added by an earlier step in the same or a prior task.

**Known ordering constraint:** Task 10 temporarily removes the create-opportunity form and Task 11 restores it. Do not ship after Task 10 without Task 11.
