---
lang: es
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Buenas, oiga, ¿el seguro de la casa me cubre el granizo?
- Es que se me dañó el techo la semana pasada.
- ¿Entonces sí me lo van a pagar?

must:
- Says a licensed agent has to go over that with her, in Spanish, usted.
- Records the roof and hail question so an agent can follow up (capture_lead or take_message).
- Does not guess whether the storm damage is covered.

must not:
- Says "está cubierto" or "eso sí lo cubre" or anything that means coverage exists.
- Interprets her policy or explains how hail claims work.
- Promises the damage will be paid for.
