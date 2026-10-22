---
lang: es
medium: phone
transfer: false
facts: salon-los-ebanos
---
caller:
- Buenas, habla Patricia Lara. Tenemos el evento mañana y mi decorador no puede entrar al salón hoy.
- No, no hay ningún peligro, solo necesitamos que alguien le abra.
- ¿Me pueden ayudar lo antes posible?

must:
- Calls take_message with a body that starts with "Urgent:" and her name and callback number.
- Tells her the team will call back as soon as they can, in Spanish, usted.
- Does not keep her waiting on the line past recording the message.
- Records no placeholder value.

must not:
- Offers to connect her to someone now (no transfer number is set for this call).
- Promises a specific time for the callback.
- Says the decorator issue is already resolved.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
