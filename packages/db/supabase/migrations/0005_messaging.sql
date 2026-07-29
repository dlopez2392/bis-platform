-- M1b messaging. Two tables, following the M0/M1a pattern: account_id on every
-- row, RLS via the app.* helpers, events emitted on mutation.
--
-- conversations is ONE PER CONTACT, not per channel. A person is one thread
-- regardless of how they reached us; this is copied deliberately from GHL.
--
-- `channel` and `direction` carry values nothing writes yet (sms/webchat/
-- voice/note, inbound). That is intentional: adding an enum value later is
-- cheap, migrating a live messages table is not.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  contact_id uuid not null references public.contacts(id),
  last_message_at timestamptz,
  unread_count integer not null default 0,
  assigned_to uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One conversation per contact. Also makes ensureConversation's
-- lookup-then-insert safe under concurrency via ON CONFLICT.
create unique index conversations_account_contact_unique
  on public.conversations (account_id, contact_id);

create index conversations_account_recent
  on public.conversations (account_id, last_message_at desc nulls last);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  conversation_id uuid not null references public.conversations(id),
  channel text not null check (channel in ('email','sms','webchat','voice','note')),
  direction text not null check (direction in ('outbound','inbound')),
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','opened','bounced','failed')),
  provider_message_id text,
  subject text,
  body text not null,
  error text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index messages_thread on public.messages (account_id, conversation_id, created_at);

-- Webhook lookups arrive with only a provider id and no tenant context, so
-- this index is not account-scoped.
create unique index messages_provider_message_id_unique
  on public.messages (provider_message_id) where provider_message_id is not null;

do $$
declare t text;
begin
  foreach t in array array['conversations','messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_member_all on public.%I for all to authenticated
         using (app.is_agency() or account_id = app.current_account_id())
         with check (app.is_agency() or account_id = app.current_account_id())', t, t);
  end loop;
end $$;
