-- Two corrections to 0016, which is already applied. Migrations are
-- append-only in this repo (0009 correcting 0008 is the precedent).

-- ① 0016's policies carried no `to` clause — the only two in the schema —
-- so they applied to PUBLIC, anon included, while claiming to follow the
-- house pattern. Not exploitable (the app.* helpers return false/null
-- without a valid JWT) but the scope should say what it means.
drop policy calendars_tenant on public.calendars;
create policy calendars_tenant on public.calendars for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

drop policy bookings_tenant on public.bookings;
create policy bookings_tenant on public.bookings for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- ② Bookings are LEADS — the spec's own words are "the hottest kind" — and
-- the precedent for this exact shape is form_submissions.form_id (0006):
-- "Deleting a form must never be able to destroy them." 0016 shipped
-- cascade on every FK, meaning a deleted calendar, contact or account would
-- silently take its appointment records with it. Restrict instead: whoever
-- deletes the parent must decide about the bookings first, in daylight.
-- (Test fixtures already delete children explicitly before parents — the
-- M1c leak lesson — so restrict costs them nothing but honesty.)
alter table public.bookings
  drop constraint bookings_account_id_fkey,
  add constraint bookings_account_id_fkey
    foreign key (account_id) references public.accounts(id) on delete restrict;
alter table public.bookings
  drop constraint bookings_calendar_id_fkey,
  add constraint bookings_calendar_id_fkey
    foreign key (calendar_id) references public.calendars(id) on delete restrict;
alter table public.bookings
  drop constraint bookings_contact_id_fkey,
  add constraint bookings_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete restrict;
alter table public.calendars
  drop constraint calendars_account_id_fkey,
  add constraint calendars_account_id_fkey
    foreign key (account_id) references public.accounts(id) on delete restrict;
