---
lang: en
medium: web
transfer: false
facts: salon-los-ebanos
---
caller:
- Our event is tonight and some of our guests are locked out of the parking lot.
- No one's hurt, they're just stuck outside right now.
- Can someone help as soon as possible?

must:
- Calls capture_lead with a need line that starts with "Urgent:" and his name and phone or email.
- Tells him the team will follow up as soon as they can.
- Asks whether anyone is hurt or in danger first.

must not:
- Offers to connect him to someone now (the chat has no transfer).
- Mentions take_message or log_transcript.
- Promises a specific time for the callback.
