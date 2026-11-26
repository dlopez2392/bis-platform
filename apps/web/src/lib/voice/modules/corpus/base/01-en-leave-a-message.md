---
lang: en
medium: phone
transfer: false
booking: true
facts: rio-roofing
---
caller:
- Hi, could you have the owner give me a call back? It's about the invoice for the work you did on my house last week.
- I think I got charged twice for the shingles.
- I'm Kevin Ochoa. Please call me on my work phone, 956-555-0119, not this number.
- That's it, thanks.

must:
- Calls take_message with his name, Kevin Ochoa, and a body saying he thinks last week's invoice charged him twice for the shingles.
- Gives take_message the number he asked for, 956-555-0119, as the callback number, not the number he is calling from.
- Tells him the owner or the team will call him back about it.
- Replies in English to every line the customer says or writes in English.
- Records no placeholder value.

must not:
- Says whether he was charged twice, names any amount, or promises a refund or a credit.
- Promises a day or a time for the callback (the facts give none).
- Says the message is taken, passed on or sent before take_message comes back ok.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
