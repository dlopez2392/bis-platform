-- Two writes 0042 left as read-then-write, made atomic. Both were caught in
-- review before anything called them.
--
-- ⚠️ THE FUNCTION-GRANT RULE, learned the hard way in 0043 and repeated here
-- because it is easy to get wrong: revoke from `anon, authenticated` BY NAME,
-- not only from `public`. This project's default privileges grant EXECUTE to
-- those two roles by name on every new function, and a named-role grant is
-- NOT inherited from PUBLIC — so revoking PUBLIC alone reads like it worked
-- and does not.

-- 1. APPENDING TURNS.
--
-- 0042's accessor read the transcript, concatenated in JS, and wrote it back,
-- on the stated grounds that `concierge_claim_turn` had already serialised
-- the turns. THAT CLAIM WAS FALSE for every cap this product will actually
-- run. The claim only refuses at `turn_count >= p_max`; below the cap two
-- concurrent POSTs both succeed (the second blocks on the row lock, re-reads
-- `1 < 24`, and returns 2). Both then read the same transcript and the later
-- write replaces the earlier one — an exchange vanishes, with no error
-- anywhere. The only reason the 0042 test did not catch it is that it used
-- max = 1, the single cap value at which the claim happens to hold.
--
-- The transcript is the lead's record (0042's own header says so). Losing a
-- turn silently is the failure this table exists to prevent.
--
-- Returns the new length, so a caller — and a test — can tell an append from
-- a replace without a second round trip.
create function public.concierge_append_turns(p_conversation_id uuid, p_turns jsonb)
returns int language sql as $fn$
  update public.concierge_conversations
     set transcript = transcript || p_turns
   where id = p_conversation_id
  returning jsonb_array_length(transcript);
$fn$;

revoke all on function public.concierge_append_turns(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.concierge_append_turns(uuid, jsonb) to service_role;

-- 2. MINTING THE PUBLIC ID.
--
-- 0042's accessor read `public_id`, minted one in JS when it was null, then
-- wrote it — and RETURNED ITS OWN MINT rather than what the row ended up
-- holding. Two concurrent enables (a double-clicked toggle) both read null,
-- mint different ids, and both update the same row; each caller is handed its
-- own id while the row keeps only the later one. The snippet rendered from
-- the earlier response then points at a `/c/<publicId>` that resolves to
-- nothing, forever, with no error on any surface. The unique index cannot
-- catch it because both statements target the same row.
--
-- `coalesce` mints only when there is nothing to keep, and `returning`
-- hands back WHAT THE ROW HOLDS — never what the process generated. That is
-- what the spec means by "minted once and kept": every snippet already pasted
-- on a client's website must keep resolving.
--
-- Returns null when the account has no voice_profiles row, which is a real
-- state — an account that has never saved voice settings has no profile — so
-- the caller can say so instead of reporting a success that wrote nothing.
create function public.concierge_enable(
  p_account_id uuid, p_form_id uuid, p_new_public_id text
) returns text language sql as $fn$
  update public.voice_profiles
     set public_id = coalesce(public_id, p_new_public_id),
         concierge_enabled = true,
         concierge_form_id = p_form_id
   where account_id = p_account_id
  returning public_id;
$fn$;

revoke all on function public.concierge_enable(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.concierge_enable(uuid, uuid, text) to service_role;
