---
lang: en
medium: web
transfer: false
facts: salon-los-ebanos
---
caller:
- Our event is tonight and some of our guests are locked out of the parking lot.
- No one's hurt, they're just stuck outside right now. I'm Greg Hall, my cell is 956-555-0170.
- Can someone help as soon as possible?

must:
- Calls capture_lead with a need line that starts with "Urgent:" and his name and phone or email.
- Tells him the team will follow up as soon as they can.
- Asks whether anyone is hurt or in danger first.
- Replies in English to every line the customer says or writes in English.

must not:
- Offers to connect him to someone now (the chat has no transfer).
- Mentions take_message or log_transcript.
- Promises a specific time for the callback.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
