-- M1c forms and embeds. Two tables plus one enum widening, following the
-- M0/M1a/M1b pattern: account_id on every row, RLS via the app.* helpers,
-- events emitted on mutation.
--
-- The public URL is forms.public_id, an opaque token, NOT a slug. A guessable
-- /f/quote-request would let anyone enumerate every client's forms by name and
-- would force a cross-tenant uniqueness fight over common names like "contact".
--
-- The submitted-values column is `answers`: VALUES is a reserved word in
-- PostgreSQL and cannot be used as an unquoted column name.

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  public_id text not null unique,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','published','archived')),
  -- Ordered [{key, kind, label, placeholder, required}]. `kind` is one of
  -- core.first_name | core.last_name | core.email | core.phone |
  -- core.company_name | custom.<field_key> | message | consent.
  fields jsonb not null default '[]'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  success_mode text not null default 'message'
    check (success_mode in ('message','redirect')),
  success_message text,
  redirect_url text,
  notify_emails text[] not null default '{}',
  locale_default text not null default 'en' check (locale_default in ('en','es')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index forms_account_created on public.forms (account_id, created_at desc);

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  -- restrict, not cascade: submissions are leads. Deleting a form must never
  -- be able to destroy them. Forms are archived instead.
  form_id uuid not null references public.forms(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  -- [{key, label, value}] — self-describing on purpose. Storing the label
  -- alongside the value means editing or removing a form field later never
  -- makes an old submission unreadable.
  answers jsonb not null default '[]'::jsonb,
  attribution jsonb not null default '{}'::jsonb,
  -- {given, text, at}. `text` is the exact consent copy displayed: proving
  -- consent later requires knowing what the person agreed to, not just that a
  -- box was ticked.
  consent jsonb,
  locale text,
  -- Hashed, never a raw IP. Rate limiting needs only equality, and visitors'
  -- IP addresses are personal data we have no reason to hold.
  ip_hash text,
  user_agent text,
  answers_hash text,
  spam_reason text check (spam_reason in ('honeypot','too_fast','rate_limited')),
  processing_error text,
  created_at timestamptz not null default now()
);

create index form_submissions_account_form
  on public.form_submissions (account_id, form_id, created_at desc);
-- Rate-limit and duplicate lookups arrive with no tenant context (the account
-- is read from the form row), so this index is not account-scoped.
create index form_submissions_rate
  on public.form_submissions (form_id, ip_hash, created_at desc);
create index form_submissions_contact
  on public.form_submissions (account_id, contact_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['forms','form_submissions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_member_all on public.%I for all to authenticated
         using (app.is_agency() or account_id = app.current_account_id())
         with check (app.is_agency() or account_id = app.current_account_id())', t, t);
  end loop;
end $$;

-- A form submission is the first inbound message this platform can produce.
-- 'note' means "the operator wrote this internally" in the M1b UI, so reusing
-- it would render a contact's own words as an internal note; 'webchat' is
-- reserved for the M4 widget. 0005's own comment sets the precedent that
-- adding an enum value is the cheap direction.
alter table public.messages drop constraint messages_channel_check;
alter table public.messages add constraint messages_channel_check
  check (channel in ('email','sms','webchat','voice','note','form'));

-- unread_count has sat at 0 since 0005 because nothing was ever inbound.
-- PostgREST cannot express `set x = x + 1`, and a read-modify-write from the
-- app would lose increments when two submissions land at once.
create or replace function public.increment_conversation_unread(
  p_account_id uuid, p_conversation_id uuid
) returns void language sql as $$
  update public.conversations
     set unread_count = unread_count + 1, updated_at = now()
   where account_id = p_account_id and id = p_conversation_id;
$$;
