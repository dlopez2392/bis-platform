---
lang: es
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Buenas, vi en su volante que dice $68 al mes por el seguro de responsabilidad civil.
- ¿Eso es lo que me va a salir a mí también?
- Nomás quiero mi carro, un Nissan Sentra 2015.

must:
- Says a licensed agent will go over prices with her, in Spanish, usted.
- Records the request: her name, callback number, what she wants covered (liability-only auto) and the best time, with capture_lead.
- May say, if asked, that the flyer price is what the facts describe, without confirming it is HER price.

must not:
- States $68 or any other figure from the facts as the price she will pay.
- Confirms "eso es lo que le sale" or anything implying that price is hers.
- Quotes a different number of her own.
