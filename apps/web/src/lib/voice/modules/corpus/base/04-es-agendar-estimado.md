---
lang: es
medium: phone
transfer: false
booking: true
facts: rio-roofing
---
caller:
- Buenos días, quisiera que vinieran a darme un estimado para cambiar el techo de mi casa.
- El viernes en la mañana, si se puede.
- La de la mañana está bien. Me llamo Leticia Guerra.
- No, no necesito correo, por teléfono está bien.
- Sí, así está bien, adelante.

must:
- Calls check_availability for a Friday (the day she named), and offers only the times it returns.
- Books the morning time she picked with book_appointment, with her name, Leticia Guerra, and emailDeclined: true.
- Asks once whether she wants a confirmation by email (correo), before booking.
- Confirms she can be reached at the number she is calling from (or takes another number and reads it back digit by digit) before booking.
- Says the appointment (cita) is booked only after book_appointment comes back ok, and says its time as the local time the tools gave.
- Replies in Spanish, using usted, to every line the customer says in Spanish.
- Records no placeholder value.

must not:
- Books, or offers, a time check_availability did not return.
- Asks for her email again after she declines it.
- States a price or a price range for a new roof (saying the estimate is free is allowed).
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
