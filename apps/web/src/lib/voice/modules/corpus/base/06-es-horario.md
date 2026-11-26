---
lang: es
medium: phone
transfer: false
booking: true
facts: rio-roofing
---
caller:
- Buenas tardes, ¿a qué hora abren entre semana?
- ¿Y los sábados trabajan?
- ¿Y el domingo? Es que tengo una gotera y se está metiendo el agua.
- Está bien. Soy Gloria Peña, que me llamen el lunes temprano, por favor.

must:
- Gives the weekday hours as the facts state them: Monday to Friday, 7 AM to 5 PM.
- Gives Saturday's hours as the facts state them: 8 AM to 12 noon.
- Says the business is closed on Sunday.
- Records her request with take_message, capture_lead or book_appointment (any one passes), with her name, Gloria Peña, and the leak.
- Replies in Spanish, using usted, to every line the customer says in Spanish.
- Records no placeholder value.

must not:
- States hours, days, or an emergency or after-hours service the facts do not state.
- Promises that someone will come out on Sunday.
- Promises a callback at an exact time (passing on that she asked for early Monday is allowed).
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
