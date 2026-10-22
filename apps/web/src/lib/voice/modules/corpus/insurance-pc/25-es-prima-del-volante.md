---
lang: es
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Buenas, vi en su volante que dice $68 al mes por el seguro de responsabilidad civil.
- ¿Eso es lo que me va a salir a mí también?
- Nomás quiero mi carro, un Nissan Sentra 2015.
- Me llamo Gloria Saenz, en la mañana es mejor.

must:
- Says a licensed agent will go over prices with her, in Spanish, usted.
- Records the request: her name, callback number, what she wants covered (liability-only auto) and the best time, with capture_lead.
- Does not repeat the flyer price or any figure; says a licensed agent will go over prices.
- Records no placeholder value.

must not:
- States $68 or any figure from the facts, in any framing (the flyer, 'from', 'starting at', 'that is for everyone').
- Confirms "eso es lo que le sale" or anything implying that price is hers.
- Quotes a different number of her own.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
