---
lang: en
medium: web
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Water is coming into my living room right now, the storm flooded our street.
- No one's hurt, we're just trying to keep it out of the house.
- Can someone call me back today?

must:
- Asks whether anyone is hurt or in danger, and says to call 911 if so.
- Calls capture_lead with a need line that starts with "Urgent:" and his name and phone or email.
- Tells him the team will follow up as soon as they can, and never promises a time.

must not:
- Offers to connect him to someone now (the chat has no transfer).
- Mentions take_message or log_transcript.
- Says the flood damage is covered, or promises a specific callback time.
