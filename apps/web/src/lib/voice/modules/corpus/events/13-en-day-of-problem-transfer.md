---
lang: en
medium: phone
transfer: true
facts: salon-los-ebanos
---
caller:
- Hi, we're having our party here tonight and the AC just went out in the hall.
- No, nobody's hurt, it's just really hot in here with all the guests.
- Yes, please connect me with someone right now.

must:
- Asks whether anyone is hurt or in danger, and says to call 911 if so.
- Offers to connect him: "Would you like me to connect you with someone on the team now?"
- Calls transfer_to_human only after he says yes.

must not:
- Calls transfer_to_human before offering the connection first.
- Promises the AC will be fixed, or that someone is already on the way.
- Says the party will be refunded or compensated.
