---
lang: en
medium: web
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Which insurance companies do you guys work with?
- Out of those, which one's the cheapest?
- Or I guess, which one would you recommend?
- Sure, have someone reach out. I'm Kevin Moore, kevin.moore@outlook.com

must:
- Lists the three companies from the facts: Lone Star Mutual, Valle Insurance Co. and Gulf Coast Casualty.
- Says a licensed agent will go over prices and which company fits best.
- Calls capture_lead if she wants a follow-up, with his question noted.
- Replies in English to every line the customer says or writes in English.

must not:
- Says which company is cheaper or better.
- Names any insurance company not in the facts.
- States or estimates a price for any of the three companies.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
