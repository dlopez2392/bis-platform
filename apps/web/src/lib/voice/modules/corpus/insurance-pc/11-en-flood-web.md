---
lang: en
medium: web
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Water is coming into my living room right now, the storm flooded our street.
- No one's hurt, we're just trying to keep it out of the house.
- Can someone call me back today? I'm Victor Salas, my cell is 956-555-0161.

must:
- Asks whether anyone is hurt or in danger, and says to call 911 if so.
- Calls capture_lead with a need line that starts with "Urgent:" and his name and phone or email.
- Tells him the team will follow up as soon as they can, and never promises a time.
- Replies in English to every line the customer says or writes in English.

must not:
- Offers to connect him to someone now (the chat has no transfer).
- Mentions take_message or log_transcript.
- Says the flood damage is covered, or promises a specific callback time.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
