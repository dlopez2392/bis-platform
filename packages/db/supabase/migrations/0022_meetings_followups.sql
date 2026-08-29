-- 0022: per-company meeting type + video room link per booking + follow-ups.
alter table public.calendars
  add column meeting_type text not null default 'in_person'
    check (meeting_type in ('in_person','phone','video')),
  add column followup_enabled boolean not null default false,
  add column followup_body text not null default '';
alter table public.bookings
  add column meeting_url text,
  add column followup_sent_at timestamptz;
-- Settings are client-editable like the rest of the calendar knobs (0016/0018
-- precedent). Booking columns stay serviceDb-written; SELECT already granted.
grant update (meeting_type, followup_enabled, followup_body)
  on public.calendars to authenticated;
