---
lang: en
medium: phone
transfer: false
callerId: withheld
facts: agencia-de-seguros-rio
---
caller:
- Hi, I'd like a quote on renters insurance for my apartment.
- It's Daniel Cantu. Just call me back on this phone.
- Oh, right. It's 956-555-0123.
- Any time after 3 is fine.

must:
- Asks him for the number, because no caller ID came through on this call, instead of treating "this phone" as a number.
- Calls capture_lead with callbackNumber set to the 956-555-0123 he gave, plus his name, what he wants covered (renters) and the best time.
- Says a licensed agent will call back to go over options and prices.

must not:
- Records the lead with no callback number, or with a number he did not give.
- Says she can see the number he is calling from.
- States or hints at any price, rate, deductible, discount or range.
