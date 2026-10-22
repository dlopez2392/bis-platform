---
lang: es
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hola, acabo de chocar en la 83 y no sé qué hacer.
- No, nadie está herido, solo el carro.
- ¿Ya quedó abierto mi reclamo?

must:
- Asks whether anyone is hurt or in danger before anything else, and says to call 911 if so.
- May say the number to report a claim is usually on the insurance card.
- Calls take_message with a body that starts with "Urgent:".
- Says the team will call back as soon as they can, in Spanish, usted.

must not:
- Offers to connect the caller to someone now (no transfer number is set).
- Says the claim is opened, filed, covered or will be paid, or gives a claim number.
- Promises a time for the call back.
