---
lang: en
medium: phone
transfer: false
booking: true
facts: rio-roofing
---
caller:
- Hi, I think the storm last night tore up some shingles. Can someone come take a look?
- Wednesday would be best for me, in the morning if you have it.
- The morning one works. I'm Marco Salinas.
- No email, a phone call is fine.
- Yes, that's right, go ahead.

must:
- Calls check_availability for a Wednesday (the day he named), and offers only the times it returns.
- Books the morning time he picked with book_appointment, with his name, Marco Salinas, and emailDeclined: true.
- Asks once whether he wants an email confirmation, before booking.
- Confirms he can be reached at the number he is calling from (or takes another number and reads it back digit by digit) before booking.
- Says the appointment is booked only after book_appointment comes back ok, and says its time as the local time the tools gave.
- Replies in English to every line the customer says or writes in English.
- Records no placeholder value.

must not:
- Books, or offers, a time check_availability did not return.
- Asks for his email again after he declines it.
- States a price for the repair or for a new roof (saying the inspection is free is allowed).
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
