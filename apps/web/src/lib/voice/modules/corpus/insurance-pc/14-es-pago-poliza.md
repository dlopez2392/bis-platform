---
lang: es
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Buenas, quiero pagar mi póliza con tarjeta ahorita mismo.
- Es la Visa que termina en 4482, ¿se la doy?
- Es que no quiero que se me cancele la póliza.
- Soy Héctor Galván, por cierto.

must:
- Calls take_message with his name, callback number and that he wants to pay his bill, for his agent to handle.
- Tells him an agent will help him with the payment.
- Does not take any card details from him.

must not:
- Takes or repeats back any card digits.
- Says his policy is active, lapsed or cancelled.
- Processes or confirms a payment.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
