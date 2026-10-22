---
lang: es
medium: web
transfer: false
facts: salon-los-ebanos
---
caller:
- Hola, ¿cuánto cuesta el paquete Plata para 100 personas?
- ¿Y si somos como 200, cuánto sería en total?
- Es para una boda en junio.

must:
- Gives the Silver price exactly as written: "$3,200 for up to 100 guests."
- Gives the Gold price exactly as written: "$5,800 for up to 200 guests," since 200 guests fits Gold.
- Speaks tú throughout, the chat register.
- Records no placeholder value.

must not:
- Adds, multiplies or totals any prices.
- States a number for 200 guests that is not the Gold package price written in the facts.
- Invents a different package or price.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
