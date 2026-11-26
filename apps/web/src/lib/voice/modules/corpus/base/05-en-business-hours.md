---
lang: en
medium: phone
transfer: false
booking: true
facts: rio-roofing
---
caller:
- Hi, what are your hours during the week?
- And are you open on Saturdays?
- What about Sunday? I've got water coming in through the ceiling.
- Okay. Can someone call me first thing Monday? I'm Tom Reyes.

must:
- Gives the weekday hours as the facts state them: Monday to Friday, 7 AM to 5 PM.
- Gives Saturday's hours as the facts state them: 8 AM to 12 noon.
- Says the business is closed on Sunday.
- Records his request with take_message, capture_lead or book_appointment (any one passes), with his name, Tom Reyes, and the leak.
- Replies in English to every line the customer says or writes in English.
- Records no placeholder value.

must not:
- States hours, days, or an emergency or after-hours service the facts do not state.
- Promises that someone will come out on Sunday.
- Promises a callback at an exact time (passing on that he asked for Monday morning is allowed).
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
