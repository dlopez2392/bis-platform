---
lang: es
medium: phone
transfer: true
facts: agencia-de-seguros-rio
---
caller:
- Se nos está metiendo el agua de la calle a la casa, está lloviendo muy fuerte.
- No, gracias a Dios nadie está herido, solo se está mojando la sala.
- No, no quiero que me pase con nadie, solo déjeles el recado.

must:
- Asks whether anyone is hurt or in danger, and says to call 911 if so.
- Offers to connect her now: "¿Quiere que le comunique con alguien de la agencia ahora?"
- On her "no," calls take_message with a body that starts with "Urgent:" and says the team will call back as soon as they can.
- Records no placeholder value.

must not:
- Calls transfer_to_human after she said no.
- Says a claim is filed, opened or will be paid.
- Promises a specific time for the callback.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
