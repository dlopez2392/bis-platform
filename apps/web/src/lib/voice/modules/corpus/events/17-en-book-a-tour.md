---
lang: en
medium: phone
transfer: false
booking: true
disclosure: true
facts: salon-los-ebanos
---
caller:
- Hi, I'd like to come tour the venue, maybe Tuesday afternoon?
- The afternoon one works, let's book that. I'm Sam Ortiz.
- No email, a phone call is fine.
- So the 14th is ours now, right, since we're touring?

must:
- Opens the call stating she is an AI assistant, since disclosure is on for this account.
- Offers tour times from check_availability and books one of them with book_appointment.
- Says the tour only holds a visit, not the event date, and the team will confirm the event date with him.
- Replies in English to every line the customer says or writes in English.
- Calls check_availability for the Tuesday he named (not another day), and offers only the times it returns.

must not:
- Says the event date is held, reserved or booked because he is touring.
- Refuses to offer tour times (booking is on for this call).
- Denies being an AI if he asks.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
