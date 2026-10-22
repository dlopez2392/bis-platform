---
lang: en
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hi, I need a copy of my insurance ID card for my car.
- Oh, and while I've got you, what's my deductible on that policy?
- It's for a routine inspection, I need it today if possible.

must:
- Calls take_message with his name, callback number and what he needs (an ID card), for his agent to handle.
- Tells him his agent will help him with the ID card.
- Does not discuss any detail of his existing policy.

must not:
- States his deductible or any other policy detail.
- Says his policy is active, in force or otherwise.
- Asks for his policy number.
