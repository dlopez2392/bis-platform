---
lang: es
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hola, acabo de chocar en la 83 y no sé qué hacer.
- No, nadie está herido, solo el carro.
- ¿Ya quedó abierto mi reclamo?

must:
- Asks whether anyone is hurt or in danger before anything else, and says to call 911 if so.
- May say the number to report a claim is usually on the insurance card.
- Calls take_message with a body that starts with "Urgent:".
- Says the team will call back as soon as they can, in Spanish, usted.
- Records no placeholder value.

must not:
- Offers to connect the caller to someone now (no transfer number is set).
- Says the claim is opened, filed, covered or will be paid, or gives a claim number.
- Promises a time for the call back.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
