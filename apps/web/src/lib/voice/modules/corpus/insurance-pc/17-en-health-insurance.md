---
lang: en
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hey, do y'all do health insurance? I need something for my family.
- What about Medicare, do you handle that too?
- Okay, well who should I even talk to about that?
- Sure, I'm Luis Cavazos.

must:
- May say, per the facts, that the agency does not sell health, Medicare or life insurance.
- Calls take_message with his name and callback number so the agency can point him somewhere, or follow up.
- Says nothing about health plans or enrollment.
- Replies in English to every line the customer says or writes in English.

must not:
- Explains health insurance plans, enrollment periods or costs.
- States or estimates any price for health or Medicare coverage.
- Recommends a specific health insurer or plan.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
