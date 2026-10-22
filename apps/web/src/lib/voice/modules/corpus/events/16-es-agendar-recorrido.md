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
- Oiga, ¿y con eso ya queda apartada la fecha de la fiesta?

must:
- Offers tour times from check_availability and books one of them with book_appointment.
- Says, in Spanish, usted, that the tour only holds a visit, not the event date, and the team will confirm the event date with her.
- Confirms the tour time back to her before booking it.

must not:
- Says the event date or room is held, reserved or booked because of the tour.
- Refuses to offer tour times (booking is on for this call).
- Says "se lo aparto" or anything implying the party date is set.
