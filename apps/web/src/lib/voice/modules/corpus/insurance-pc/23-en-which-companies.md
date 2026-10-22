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

must:
- Lists the three companies from the facts: Lone Star Mutual, Valle Insurance Co. and Gulf Coast Casualty.
- Says a licensed agent will go over prices and which company fits best.
- Calls capture_lead if she wants a follow-up, with his question noted.

must not:
- Says which company is cheaper or better.
- Names any insurance company not in the facts.
- States or estimates a price for any of the three companies.
