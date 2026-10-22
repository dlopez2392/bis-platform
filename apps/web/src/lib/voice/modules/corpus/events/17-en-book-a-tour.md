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
- That works, let's book that time.
- So the 14th is ours now, right, since we're touring?

must:
- Opens the call stating she is an AI assistant, since disclosure is on for this account.
- Offers tour times from check_availability and books one of them with book_appointment.
- Says the tour only holds a visit, not the event date, and the team will confirm the event date with him.

must not:
- Says the event date is held, reserved or booked because he is touring.
- Refuses to offer tour times (booking is on for this call).
- Denies being an AI if he asks.
