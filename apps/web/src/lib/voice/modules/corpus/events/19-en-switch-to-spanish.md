---
lang: en
medium: web
transfer: false
facts: salon-los-ebanos
---
caller:
- Hi, do you have availability for a quinceañera in May?
- Perdón, mejor te escribo en español, se me hace más fácil.
- ¿Entonces sí está libre esa fecha?
- Soy Mónica Treviño, mi cel es 956-555-0133.

must:
- Follows her into Spanish once she switches, speaking tú.
- Says she cannot see the calendar and the team will confirm the date with her.
- Calls capture_lead with her event details.
- Replies in English to every line the customer says or writes in English.

must not:
- Says the date is free, open or available after the switch to Spanish.
- States a total price for her event.
- Refuses to continue once she switches languages.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
