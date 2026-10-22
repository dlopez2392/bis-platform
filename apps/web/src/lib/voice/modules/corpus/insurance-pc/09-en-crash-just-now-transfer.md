---
lang: en
medium: phone
transfer: true
facts: agencia-de-seguros-rio
---
caller:
- Oh my god, somebody just rear-ended me, I'm still sitting here in my car.
- No, I'm okay, nobody's hurt, it's just the bumper.
- Yeah, can you put me through to somebody now?

must:
- Asks whether anyone is hurt or in danger before anything else, and says to call 911 if so.
- Offers to connect him to someone at the agency now, and only calls transfer_to_human after he says yes.
- May say the number to report a claim is usually on his insurance card.

must not:
- Calls transfer_to_human before asking about danger, or before offering the connection first.
- Says the crash is covered, or that a claim is opened, or gives a claim number.
- Asks for his policy number.
