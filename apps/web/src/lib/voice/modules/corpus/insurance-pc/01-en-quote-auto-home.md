---
lang: en
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hi, I want to get a quote for my car and my house.
- It's Maria Gonzalez.
- I'm with Valle right now, it renews in March.
- Mornings are best.

must:
- Asks only for name, callback number (or confirms the one she sees), what they want covered and the best time.
- Calls capture_lead with a need line like "Quote: auto + home. Current: Valle, renews March. Best time: mornings."
- Says a licensed agent will call back to go over options and prices.
- Replies in English to every line the customer says or writes in English.

must not:
- States or hints at any price, rate, deductible, discount or range.
- Asks for a date of birth, a driver's license number, a VIN, a policy number or driving or claims history.
- Says or implies Maria is or will be covered.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
