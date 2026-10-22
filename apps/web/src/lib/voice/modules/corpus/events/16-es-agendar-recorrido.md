---
lang: es
medium: phone
transfer: false
booking: true
facts: salon-los-ebanos
---
caller:
- Buenas, quisiera agendar un recorrido para ver el salón.
- El sábado en la tarde me queda bien, si tienen algo disponible.
- La de la tarde está bien. Me llamo Elena Cruz.
- No necesito correo, por teléfono está bien.
- Oiga, ¿y con eso ya queda apartada la fecha de la fiesta?

must:
- Offers tour times from check_availability and books one of them with book_appointment.
- Says, in Spanish, usted, that the tour only holds a visit, not the event date, and the team will confirm the event date with her.
- Confirms the tour time back to her before booking it.
- Calls check_availability for the Saturday she named (not another day), and offers only the times it returns.
- Records no placeholder value.

must not:
- Says the event date or room is held, reserved or booked because of the tour.
- Refuses to offer tour times (booking is on for this call).
- Says "se lo aparto" or anything implying the party date is set.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
