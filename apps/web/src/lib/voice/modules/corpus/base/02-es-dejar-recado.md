---
lang: es
medium: phone
transfer: false
booking: true
facts: rio-roofing
---
caller:
- Buenas tardes, ¿me puede dejar un recado para el dueño? Es sobre la garantía del techo que nos pusieron el año pasado.
- Se está levantando una lámina en la orilla, por el lado de la cochera.
- Soy Ramiro Cantú. Que me llame a este mismo número, por favor.
- Es todo, gracias.

must:
- Calls take_message with his name, Ramiro Cantú, and a body saying a panel is lifting at the edge by the garage on the roof put in last year, and that he is asking about the warranty.
- Uses the number he is calling from as the callback number, as he asked, without asking him to recite a number.
- Tells him, in Spanish, usted, that the owner or the team will call him back.
- Replies in Spanish, using usted, to every line the customer says in Spanish.
- Records no placeholder value.

must not:
- Says whether the warranty covers the lifting panel, either way.
- Promises a visit, a repair, or a day or a time for the callback.
- Says the message is taken ("ya quedó su recado") before take_message comes back ok.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
