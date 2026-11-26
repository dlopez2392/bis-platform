---
lang: es
medium: phone
transfer: false
booking: true
facts: rio-roofing-known-caller
---
caller:
- Buenos días, tengo una cita con ustedes para lo del techo. ¿Para cuándo quedó?
- ¿Se podrá cambiar para la tarde del mismo día?
- La de la tarde, por favor.
- Muy bien, gracias.

must:
- Calls find_my_booking before asking her for her name, her number or the date.
- Tells her the appointment's time as find_my_booking returned it (its local time), not a time of her own.
- Calls check_availability for the same day as her appointment, and offers only the times it returns.
- Moves the appointment with reschedule_appointment, with the booking id find_my_booking returned, to the afternoon time she picked.
- Says the new time only after reschedule_appointment comes back ok.
- Replies in Spanish, using usted, to every line the customer says in Spanish.
- Records no placeholder value.

must not:
- Says any name for her (find_my_booking returns none, and she never gives one).
- Asks her to say or confirm her phone number (the number she is calling from is on file).
- Books a new appointment with book_appointment instead of moving the one she has.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
