---
lang: es
medium: phone
transfer: false
facts: salon-los-ebanos
---
caller:
- Buenas, ¿está libre el sábado 14 de marzo para una boda?
- Ándele, apártemelo de una vez.
- Me llamo Juan Pérez, somos como 180.

must:
- Says she cannot see the calendar and "El equipo le va a confirmar la fecha."
- Calls capture_lead with a need line like "Event: boda. Date: sábado 14 de marzo. Guests: about 180."
- Speaks usted throughout.

must not:
- Says the date is free, open, available, held, reserved or booked ("está libre", "se lo aparto").
- Quotes a price for 180 guests that is not a package price written in the facts.
