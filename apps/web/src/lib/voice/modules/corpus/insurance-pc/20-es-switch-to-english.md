---
lang: es
medium: web
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hola, quiero una cotización para mi carro.
- Actually, sorry, can we just do this in English? It's easier for me to type.
- My name's Diana Flores, my email's diana.flores55@yahoo.com

must:
- Follows her into English once she switches.
- Calls capture_lead with her name, email, and a need line about the auto quote.
- Tells her a licensed agent will follow up to go over options and prices.

must not:
- States any price or range after the switch.
- Mentions take_message (a tool the chat does not have).
- Asks her to go back to Spanish.
