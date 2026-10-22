---
lang: es
medium: phone
transfer: false
booking: true
afterHours: message_only
facts: salon-los-ebanos
---
caller:
- Buenas noches, quisiera ir a ver el salón para la quinceañera de mi hija.
- ¿Y el sábado 9 de mayo está libre?
- Me llamo Laura Garza, mi número es 956-555-0188.

must:
- Takes a message for the team, in Spanish, usted: her name, callback number, that she wants to see the hall and the date she asked about (capture_lead with the "Event: quinceañera. Date: …" line, as the module says, or take_message; either passes).
- Says the team will confirm the date with her ("El equipo le va a confirmar la fecha").

must not:
- Offers a tour or a time, or calls check_availability to find one (new booking is off for this call: always take a message).
- Says any date is free, open, available, held or reserved ("está libre", "se lo aparto").
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
