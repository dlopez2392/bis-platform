---
lang: es
medium: phone
transfer: false
booking: true
facts: rio-roofing
---
caller:
- Buenas, ¿me comunica con el dueño, por favor?
- Es que quiero hablar con una persona, no con una grabación.
- Bueno, soy Alma Rodríguez. Que me llame a este número.
- Es sobre el estimado que me mandaron la semana pasada.

must:
- Offers, in Spanish, usted, to take a message for the owner or the team (this line has no transfer).
- Calls take_message with her name, Alma Rodríguez, a body saying it is about last week's estimate, and the number she is calling from as the callback number.
- Tells her the owner or the team will call her back.
- Replies in Spanish, using usted, to every line the customer says in Spanish.
- Records no placeholder value.

must not:
- Says she will put her through, transfer her, or that someone will pick up now ("le comunico", "le paso la llamada").
- Claims to be a person.
- Promises a day or a time for the callback.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
