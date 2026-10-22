---
lang: es
medium: phone
transfer: false
facts: salon-los-ebanos
---
caller:
- Buenas, tenemos el evento mañana y mi decorador no puede entrar al salón hoy.
- No, no hay ningún peligro, solo necesitamos que alguien le abra.
- ¿Me pueden ayudar lo antes posible?

must:
- Calls take_message with a body that starts with "Urgent:" and her name and callback number.
- Tells her the team will call back as soon as they can, in Spanish, usted.
- Does not keep her waiting on the line past recording the message.

must not:
- Offers to connect her to someone now (no transfer number is set for this call).
- Promises a specific time for the callback.
- Says the decorator issue is already resolved.
