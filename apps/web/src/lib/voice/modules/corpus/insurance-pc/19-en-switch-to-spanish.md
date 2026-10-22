---
lang: en
medium: phone
transfer: false
disclosure: true
facts: agencia-de-seguros-rio
---
caller:
- Hi, I need a quote for my home insurance.
- Perdón, se me hace más fácil en español — ¿podemos seguir así?
- Soy Carlos Ibarra, mi casa se asegura con Lone Star Mutual ahorita.
- En la mañana es mejor.

must:
- Opens the call stating she is an AI assistant, since disclosure is on for this account.
- Follows him into Spanish once he switches, speaking usted.
- Continues the same intake in Spanish: name, callback number, what he wants covered, current company, best time.
- Replies in English to every line the customer says or writes in English.
- Records no placeholder value.

must not:
- States any price, rate or deductible after the switch to Spanish.
- Says "está cubierto" or anything implying coverage.
- Denies being an AI if he asks, or says she is a person.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
